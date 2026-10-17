const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { tipoArchivo, TIPO_META } = require('../utils/fileTypes');

const router = express.Router();
router.use(requireAdmin);

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'material');
const videoDir = path.join(__dirname, '..', '..', 'uploads', 'videos');
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(videoDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, videoDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  }
});
const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^video\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Solo archivos de video.'));
  }
});

function youtubeToEmbed(url) {
  if (!url) return '';
  url = url.trim();
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  const v = url.match(/vimeo\.com\/(\d+)/);
  if (v) return `https://player.vimeo.com/video/${v[1]}`;
  return url;
}

// ============== DASHBOARD ==============
router.get('/', async (req, res) => {
  const [
    usuariosRow, cursosRow, cursosPubRow, clasesRow,
    materialesRow, postsRow, inscripcionesRow, certificadosRow
  ] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS c FROM usuarios WHERE rol = 'alumno'").get(),
    db.prepare('SELECT COUNT(*) AS c FROM cursos').get(),
    db.prepare('SELECT COUNT(*) AS c FROM cursos WHERE publicado = 1').get(),
    db.prepare(`SELECT COUNT(*) AS c FROM clases_vivo WHERE fecha_hora >= NOW()`).get(),
    db.prepare('SELECT COUNT(*) AS c FROM material').get(),
    db.prepare('SELECT COUNT(*) AS c FROM posts_comunidad').get(),
    db.prepare('SELECT COUNT(*) AS c FROM inscripciones').get(),
    db.prepare('SELECT COUNT(*) AS c FROM certificados').get()
  ]);

  const stats = {
    usuarios: usuariosRow?.c || 0,
    cursos: cursosRow?.c || 0,
    cursosPub: cursosPubRow?.c || 0,
    clases: clasesRow?.c || 0,
    materiales: materialesRow?.c || 0,
    posts: postsRow?.c || 0,
    inscripciones: inscripcionesRow?.c || 0,
    certificados: certificadosRow?.c || 0
  };

  const [ultimosUsuarios, topCursos] = await Promise.all([
    db.prepare(`SELECT id, nombre, username, fecha_creacion FROM usuarios WHERE rol='alumno' ORDER BY fecha_creacion DESC LIMIT 5`).all(),
    db.prepare(`
      SELECT c.id, c.titulo, COUNT(i.id)::int AS inscriptos FROM cursos c
      LEFT JOIN inscripciones i ON i.curso_id = c.id GROUP BY c.id ORDER BY inscriptos DESC LIMIT 5
    `).all()
  ]);

  res.render('admin/dashboard', { title: 'Panel admin', stats, ultimosUsuarios, topCursos });
});

// ============== USUARIOS ==============
router.get('/usuarios', async (req, res) => {
  const { q, rol } = req.query;
  let sql = 'SELECT id, nombre, username, rol, activo, avatar, fecha_creacion FROM usuarios WHERE 1=1';
  const params = [];
  if (q && q.trim()) {
    sql += ' AND (LOWER(nombre) LIKE ? OR LOWER(username) LIKE ?)';
    const term = `%${q.trim().toLowerCase()}%`;
    params.push(term, term);
  }
  if (rol && ['admin','profesor','soporte','alumno'].includes(rol)) {
    sql += ' AND rol = ?';
    params.push(rol);
  }
  sql += ' ORDER BY fecha_creacion DESC';
  const usuarios = await db.prepare(sql).all(...params);

  const [adminRow, profesorRow, soporteRow, alumnoRow] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS c FROM usuarios WHERE rol = 'admin'").get(),
    db.prepare("SELECT COUNT(*) AS c FROM usuarios WHERE rol = 'profesor'").get(),
    db.prepare("SELECT COUNT(*) AS c FROM usuarios WHERE rol = 'soporte'").get(),
    db.prepare("SELECT COUNT(*) AS c FROM usuarios WHERE rol = 'alumno'").get()
  ]);
  const conteoPorRol = {
    admin: adminRow?.c || 0,
    profesor: profesorRow?.c || 0,
    soporte: soporteRow?.c || 0,
    alumno: alumnoRow?.c || 0
  };

  res.render('admin/usuarios/lista', { title: 'Usuarios', usuarios, q, rol, conteoPorRol });
});

router.get('/usuarios/nuevo', (req, res) => {
  res.render('admin/usuarios/form', { title: 'Nuevo usuario', user: null });
});

router.post('/usuarios/nuevo', async (req, res) => {
  const { nombre, username, password, rol } = req.body;
  if (!nombre || !username || !password) { req.flash('error', 'Faltan campos.'); return res.redirect('/admin/usuarios/nuevo'); }
  const userLimpio = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(userLimpio)) {
    req.flash('error', 'El usuario debe tener 3-30 caracteres (letras, números, . _ -).');
    return res.redirect('/admin/usuarios/nuevo');
  }
  const rolFinal = ['admin','alumno','soporte','profesor'].includes(rol) ? rol : 'alumno';
  try {
    await db.prepare('INSERT INTO usuarios (nombre, username, password_hash, rol) VALUES (?, ?, ?, ?)')
      .run(nombre.trim(), userLimpio, bcrypt.hashSync(password, 10), rolFinal);
    req.flash('success', `Usuario "${userLimpio}" creado.`);
    res.redirect('/admin/usuarios');
  } catch {
    req.flash('error', 'Ese usuario ya existe.');
    res.redirect('/admin/usuarios/nuevo');
  }
});

router.get('/usuarios/:id', async (req, res) => {
  const user = await db.prepare('SELECT id, nombre, username, rol, activo, bio, avatar FROM usuarios WHERE id = ?').get(req.params.id);
  if (!user) return res.redirect('/admin/usuarios');
  res.render('admin/usuarios/form', { title: 'Editar usuario', user });
});

router.post('/usuarios/:id', async (req, res) => {
  const { nombre, username, rol, activo, password } = req.body;
  const userLimpio = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(userLimpio)) {
    req.flash('error', 'El usuario debe tener 3-30 caracteres (letras, números, . _ -).');
    return res.redirect(`/admin/usuarios/${req.params.id}`);
  }
  const rolFinal = ['admin','alumno','soporte','profesor'].includes(rol) ? rol : 'alumno';
  let sql = 'UPDATE usuarios SET nombre = ?, username = ?, rol = ?, activo = ?';
  const params = [nombre.trim(), userLimpio, rolFinal, activo ? 1 : 0];
  if (password && password.trim()) {
    sql += ', password_hash = ?';
    params.push(bcrypt.hashSync(password, 10));
  }
  sql += ' WHERE id = ?';
  params.push(req.params.id);
  try {
    await db.prepare(sql).run(...params);
    req.flash('success', 'Usuario actualizado.');
  } catch {
    req.flash('error', 'Ese usuario ya existe.');
  }
  res.redirect('/admin/usuarios');
});

router.post('/usuarios/:id/eliminar', async (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id) {
    req.flash('error', 'No podés eliminar tu propia cuenta.');
    return res.redirect('/admin/usuarios');
  }
  await db.prepare('DELETE FROM usuarios WHERE id = ?').run(req.params.id);
  req.flash('success', 'Usuario eliminado.');
  res.redirect('/admin/usuarios');
});

// ============== CATEGORÍAS ==============
router.get('/categorias', async (req, res) => {
  const cats = await db.prepare(`
    SELECT c.*, (SELECT COUNT(*)::int FROM cursos WHERE categoria_id = c.id) AS num_cursos
    FROM categorias c ORDER BY c.nombre
  `).all();
  res.render('admin/categorias', { title: 'Categorías', cats });
});

router.post('/categorias/nueva', async (req, res) => {
  const { nombre } = req.body;
  if (nombre && nombre.trim()) {
    try { await db.prepare('INSERT INTO categorias (nombre) VALUES (?)').run(nombre.trim()); }
    catch { req.flash('error', 'Ya existe.'); }
  }
  res.redirect('/admin/categorias');
});

router.post('/categorias/:id/eliminar', async (req, res) => {
  await db.prepare('DELETE FROM categorias WHERE id = ?').run(req.params.id);
  res.redirect('/admin/categorias');
});

// ============== CURSOS ==============
router.get('/cursos', async (req, res) => {
  const cursos = await db.prepare(`
    SELECT c.*, cat.nombre AS categoria,
      (SELECT COUNT(*)::int FROM inscripciones WHERE curso_id = c.id) AS inscriptos,
      (SELECT COUNT(*)::int FROM modulos WHERE curso_id = c.id) AS num_modulos
    FROM cursos c LEFT JOIN categorias cat ON c.categoria_id = cat.id ORDER BY c.fecha_creacion DESC
  `).all();
  res.render('admin/cursos/lista', { title: 'Cursos', cursos });
});

router.get('/cursos/nuevo', async (req, res) => {
  const [cats, profesores] = await Promise.all([
    db.prepare('SELECT * FROM categorias ORDER BY nombre').all(),
    db.prepare("SELECT id, nombre FROM usuarios WHERE rol = 'profesor' AND activo = 1 ORDER BY nombre").all()
  ]);
  res.render('admin/cursos/form', { title: 'Nuevo curso', curso: null, cats, profesores });
});

router.post('/cursos/nuevo', async (req, res) => {
  const { titulo, descripcion, categoria_id, instructor, publicado } = req.body;
  const info = await db.prepare('INSERT INTO cursos (titulo, descripcion, categoria_id, instructor, publicado) VALUES (?, ?, ?, ?, ?)')
    .run(titulo.trim(), (descripcion||'').trim(), categoria_id || null, (instructor||'').trim(), publicado ? 1 : 0);
  req.flash('success', 'Curso creado.');
  res.redirect(`/admin/cursos/${info.lastInsertRowid}`);
});

router.get('/cursos/:id', async (req, res) => {
  const curso = await db.prepare('SELECT * FROM cursos WHERE id = ?').get(req.params.id);
  if (!curso) return res.redirect('/admin/cursos');

  const [cats, profesores, modulos, alumnos] = await Promise.all([
    db.prepare('SELECT * FROM categorias ORDER BY nombre').all(),
    db.prepare("SELECT id, nombre FROM usuarios WHERE rol = 'profesor' AND activo = 1 ORDER BY nombre").all(),
    db.prepare('SELECT * FROM modulos WHERE curso_id = ? ORDER BY orden, id').all(curso.id),
    db.prepare(`
      SELECT u.id, u.nombre, u.username,
        EXISTS(SELECT 1 FROM inscripciones WHERE usuario_id = u.id AND curso_id = ?)::int AS asignado
      FROM usuarios u WHERE u.rol = 'alumno' AND u.activo = 1
      ORDER BY u.nombre
    `).all(curso.id)
  ]);

  for (const m of modulos) {
    m.videos = await db.prepare('SELECT * FROM lecciones WHERE modulo_id = ? ORDER BY orden, id').all(m.id);
  }

  res.render('admin/cursos/form', { title: `Editar curso · ${curso.titulo}`, curso, cats, profesores, modulos, alumnos });
});

router.post('/cursos/:id/asignar', async (req, res) => {
  const cursoId = req.params.id;
  const { alumnos } = req.body;
  const ids = Array.isArray(alumnos) ? alumnos : alumnos ? [alumnos] : [];

  const prevs = (await db.prepare('SELECT usuario_id FROM inscripciones WHERE curso_id = ?').all(cursoId)).map(r => r.usuario_id);
  await db.prepare('DELETE FROM inscripciones WHERE curso_id = ?').run(cursoId);

  for (const id of ids) {
    await db.prepare('INSERT OR IGNORE INTO inscripciones (usuario_id, curso_id) VALUES (?, ?)').run(parseInt(id), cursoId);
  }

  const curso = await db.prepare('SELECT titulo FROM cursos WHERE id = ?').get(cursoId);
  const nuevos = ids.map(i => parseInt(i)).filter(i => !prevs.includes(i));
  for (const uid of nuevos) {
    await db.prepare("INSERT INTO notificaciones (usuario_id, tipo, mensaje, link) VALUES (?, 'curso', ?, ?)")
      .run(uid, `Te asignaron el curso "${curso.titulo}"`, `/cursos/${cursoId}`);
  }

  req.flash('success', `Asignación actualizada (${ids.length} alumnos).`);
  res.redirect(`/admin/cursos/${cursoId}`);
});

router.post('/cursos/:id', async (req, res) => {
  const { titulo, descripcion, categoria_id, instructor, publicado } = req.body;
  await db.prepare('UPDATE cursos SET titulo=?, descripcion=?, categoria_id=?, instructor=?, publicado=? WHERE id=?')
    .run(titulo.trim(), (descripcion||'').trim(), categoria_id || null, (instructor||'').trim(), publicado ? 1 : 0, req.params.id);
  req.flash('success', 'Curso actualizado.');
  res.redirect(`/admin/cursos/${req.params.id}`);
});

router.post('/cursos/:id/eliminar', async (req, res) => {
  await db.prepare('DELETE FROM cursos WHERE id = ?').run(req.params.id);
  req.flash('success', 'Curso eliminado.');
  res.redirect('/admin/cursos');
});

router.post('/cursos/:id/modulos', async (req, res) => {
  const { titulo, orden } = req.body;
  await db.prepare('INSERT INTO modulos (curso_id, titulo, orden) VALUES (?, ?, ?)')
    .run(req.params.id, titulo.trim(), parseInt(orden) || 0);
  res.redirect(`/admin/cursos/${req.params.id}`);
});

router.post('/modulos/:id/eliminar', async (req, res) => {
  const m = await db.prepare('SELECT curso_id FROM modulos WHERE id = ?').get(req.params.id);
  await db.prepare('DELETE FROM modulos WHERE id = ?').run(req.params.id);
  res.redirect(`/admin/cursos/${m.curso_id}`);
});

router.post('/modulos/:id/videos', uploadVideo.single('video_file'), async (req, res) => {
  const { titulo, descripcion, video_url, duracion_min, orden } = req.body;
  const moduloId = req.params.id;

  let urlFinal = '';
  let pathFinal = '';
  if (req.file) {
    pathFinal = path.join('uploads', 'videos', req.file.filename).replace(/\\/g, '/');
  } else if (video_url && video_url.trim()) {
    urlFinal = youtubeToEmbed(video_url);
  }

  if (!titulo || !titulo.trim()) {
    req.flash('error', 'El título es obligatorio.');
    const m = await db.prepare('SELECT curso_id FROM modulos WHERE id = ?').get(moduloId);
    return res.redirect(`/admin/cursos/${m.curso_id}`);
  }
  if (!urlFinal && !pathFinal) {
    req.flash('error', 'Subí un archivo o pegá un link de YouTube.');
    const m = await db.prepare('SELECT curso_id FROM modulos WHERE id = ?').get(moduloId);
    return res.redirect(`/admin/cursos/${m.curso_id}`);
  }

  await db.prepare('INSERT INTO lecciones (modulo_id, titulo, descripcion, video_url, video_path, duracion_min, orden) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(moduloId, titulo.trim(), (descripcion||'').trim(), urlFinal, pathFinal, parseInt(duracion_min)||0, parseInt(orden)||0);

  const m = await db.prepare('SELECT curso_id FROM modulos WHERE id = ?').get(moduloId);
  req.flash('success', 'Video agregado.');
  res.redirect(`/admin/cursos/${m.curso_id}`);
});

router.post('/videos/:id/editar', async (req, res) => {
  const { titulo, descripcion, video_url } = req.body;
  if (!titulo || !titulo.trim()) return res.redirect('back');

  const l = await db.prepare('SELECT modulo_id FROM lecciones WHERE id = ?').get(req.params.id);
  if (!l) return res.redirect('/admin/cursos');

  const urlFinal = video_url && video_url.trim() ? youtubeToEmbed(video_url) : null;

  await db.prepare('UPDATE lecciones SET titulo = ?, descripcion = ?, video_url = COALESCE(?, video_url) WHERE id = ?')
    .run(titulo.trim(), (descripcion || '').trim(), urlFinal, req.params.id);

  const m = await db.prepare('SELECT curso_id FROM modulos WHERE id = ?').get(l.modulo_id);
  req.flash('success', 'Video actualizado correctamente.');
  res.redirect(`/admin/cursos/${m.curso_id}`);
});

router.post('/videos/:id/eliminar', async (req, res) => {
  const l = await db.prepare('SELECT modulo_id, video_path FROM lecciones WHERE id = ?').get(req.params.id);
  if (!l) return res.redirect('/admin/cursos');
  if (l.video_path) {
    const full = path.join(__dirname, '..', '..', l.video_path);
    if (fs.existsSync(full)) try { fs.unlinkSync(full); } catch (e) {}
  }
  const m = await db.prepare('SELECT curso_id FROM modulos WHERE id = ?').get(l.modulo_id);
  await db.prepare('DELETE FROM lecciones WHERE id = ?').run(req.params.id);
  res.redirect(`/admin/cursos/${m.curso_id}`);
});

// ============== CLASES EN VIVO ==============
router.get('/clases', async (req, res) => {
  const clases = await db.prepare(`
    SELECT cl.*, c.titulo AS curso_titulo FROM clases_vivo cl
    LEFT JOIN cursos c ON cl.curso_id = c.id ORDER BY cl.fecha_hora DESC
  `).all();
  res.render('admin/clases/lista', { title: 'Clases en vivo', clases });
});

router.get('/clases/nueva', async (req, res) => {
  const [cursos, profesores] = await Promise.all([
    db.prepare('SELECT id, titulo FROM cursos').all(),
    db.prepare("SELECT id, nombre FROM usuarios WHERE rol = 'profesor' AND activo = 1 ORDER BY nombre").all()
  ]);
  res.render('admin/clases/form', { title: 'Nueva clase', clase: null, cursos, profesores });
});

router.post('/clases/nueva', async (req, res) => {
  const { titulo, descripcion, instructor_id, fecha_hora, duracion_min, link, curso_id, publicado } = req.body;
  const cursoIdFinal = curso_id || null;

  const profesor = instructor_id
    ? await db.prepare("SELECT id, nombre FROM usuarios WHERE id = ? AND rol = 'profesor'").get(instructor_id)
    : null;
  if (!profesor) {
    req.flash('error', 'Seleccioná un profesor válido.');
    return res.redirect('/admin/clases/nueva');
  }

  const info = await db.prepare('INSERT INTO clases_vivo (titulo, descripcion, instructor, instructor_id, fecha_hora, duracion_min, link, curso_id, publicado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(titulo.trim(), (descripcion||'').trim(), profesor.nombre, profesor.id, fecha_hora, parseInt(duracion_min)||60, (link||'').trim(), cursoIdFinal, publicado ? 1 : 0);

  await db.prepare("INSERT INTO notificaciones (usuario_id, tipo, mensaje, link) VALUES (?, 'clase', ?, ?)")
    .run(profesor.id, `Te asignaron una clase en vivo: ${titulo.trim()}`, `/clases/${info.lastInsertRowid}`);

  const alumnos = cursoIdFinal
    ? await db.prepare(`SELECT u.id FROM usuarios u JOIN inscripciones i ON i.usuario_id = u.id WHERE u.rol = 'alumno' AND u.activo = 1 AND i.curso_id = ?`).all(cursoIdFinal)
    : await db.prepare("SELECT id FROM usuarios WHERE rol = 'alumno' AND activo = 1").all();

  for (const a of alumnos) {
    await db.prepare("INSERT INTO notificaciones (usuario_id, tipo, mensaje, link) VALUES (?, 'clase', ?, '/clases')")
      .run(a.id, `Nueva clase en vivo: ${titulo.trim()}`);
  }

  req.flash('success', `Clase creada (${alumnos.length} alumno${alumnos.length === 1 ? '' : 's'} notificado${alumnos.length === 1 ? '' : 's'}, profesor ${profesor.nombre} avisado).`);
  res.redirect('/admin/clases');
});

router.get('/clases/:id', async (req, res) => {
  const clase = await db.prepare('SELECT * FROM clases_vivo WHERE id = ?').get(req.params.id);
  if (!clase) return res.redirect('/admin/clases');
  const [cursos, profesores] = await Promise.all([
    db.prepare('SELECT id, titulo FROM cursos').all(),
    db.prepare("SELECT id, nombre FROM usuarios WHERE rol = 'profesor' AND activo = 1 ORDER BY nombre").all()
  ]);
  res.render('admin/clases/form', { title: 'Editar clase', clase, cursos, profesores });
});

router.post('/clases/:id', async (req, res) => {
  const { titulo, descripcion, instructor_id, fecha_hora, duracion_min, link, curso_id, publicado } = req.body;
  const profesor = instructor_id
    ? await db.prepare("SELECT id, nombre FROM usuarios WHERE id = ? AND rol = 'profesor'").get(instructor_id)
    : null;
  if (!profesor) {
    req.flash('error', 'Seleccioná un profesor válido.');
    return res.redirect(`/admin/clases/${req.params.id}`);
  }

  const prev = await db.prepare('SELECT instructor_id FROM clases_vivo WHERE id = ?').get(req.params.id);

  await db.prepare('UPDATE clases_vivo SET titulo=?, descripcion=?, instructor=?, instructor_id=?, fecha_hora=?, duracion_min=?, link=?, curso_id=?, publicado=? WHERE id=?')
    .run(titulo.trim(), (descripcion||'').trim(), profesor.nombre, profesor.id, fecha_hora, parseInt(duracion_min)||60, (link||'').trim(), curso_id || null, publicado ? 1 : 0, req.params.id);

  if (prev && prev.instructor_id !== profesor.id) {
    await db.prepare("INSERT INTO notificaciones (usuario_id, tipo, mensaje, link) VALUES (?, 'clase', ?, ?)")
      .run(profesor.id, `Te asignaron una clase en vivo: ${titulo.trim()}`, `/clases/${req.params.id}`);
  }

  req.flash('success', 'Clase actualizada.');
  res.redirect('/admin/clases');
});

router.post('/clases/:id/eliminar', async (req, res) => {
  await db.prepare('DELETE FROM clases_vivo WHERE id = ?').run(req.params.id);
  res.redirect('/admin/clases');
});

// ============== MATERIAL ==============
router.get('/material', async (req, res) => {
  const { q, curso_id, tipo } = req.query;
  let sql = `
    SELECT m.*, c.titulo AS curso_titulo
    FROM material m LEFT JOIN cursos c ON m.curso_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (q && q.trim()) {
    sql += ' AND (LOWER(m.titulo) LIKE ? OR LOWER(m.descripcion) LIKE ? OR LOWER(m.archivo_nombre) LIKE ?)';
    const term = `%${q.trim().toLowerCase()}%`;
    params.push(term, term, term);
  }
  if (curso_id === 'general') {
    sql += ' AND m.curso_id IS NULL';
  } else if (curso_id) {
    sql += ' AND m.curso_id = ?';
    params.push(curso_id);
  }
  sql += ' ORDER BY m.fecha DESC';
  let materiales = await db.prepare(sql).all(...params);

  materiales.forEach(m => {
    m.tipo = tipoArchivo(m.mime_type, m.archivo_nombre);
    m.tipo_meta = TIPO_META[m.tipo];
  });
  if (tipo && TIPO_META[tipo]) {
    materiales = materiales.filter(m => m.tipo === tipo);
  }

  const cursos = await db.prepare('SELECT id, titulo FROM cursos ORDER BY titulo').all();
  res.render('admin/material/lista', {
    title: 'Material Descargable',
    materiales, cursos, q, curso_id, tipo, TIPO_META
  });
});

router.get('/material/nuevo', async (req, res) => {
  const cursos = await db.prepare('SELECT id, titulo FROM cursos ORDER BY titulo').all();
  res.render('admin/material/form', { title: 'Subir material', cursos, material: null });
});

router.post('/material/nuevo', upload.single('archivo'), async (req, res) => {
  if (!req.file) { req.flash('error', 'Seleccioná un archivo.'); return res.redirect('/admin/material/nuevo'); }
  const { titulo, descripcion, curso_id } = req.body;
  const relPath = path.join('uploads', 'material', req.file.filename).replace(/\\/g, '/');
  await db.prepare(`INSERT INTO material (titulo, descripcion, archivo_nombre, archivo_path, mime_type, tamano_bytes, curso_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run((titulo||req.file.originalname).trim(), (descripcion||'').trim(), req.file.originalname, relPath, req.file.mimetype, req.file.size, curso_id || null);
  req.flash('success', 'Material subido.');
  res.redirect('/admin/material');
});

router.get('/material/:id/editar', async (req, res) => {
  const material = await db.prepare('SELECT * FROM material WHERE id = ?').get(req.params.id);
  if (!material) { req.flash('error', 'Material no encontrado.'); return res.redirect('/admin/material'); }
  const cursos = await db.prepare('SELECT id, titulo FROM cursos ORDER BY titulo').all();
  res.render('admin/material/form', { title: `Editar · ${material.titulo}`, cursos, material });
});

router.post('/material/:id/editar', upload.single('archivo'), async (req, res) => {
  const existente = await db.prepare('SELECT * FROM material WHERE id = ?').get(req.params.id);
  if (!existente) { req.flash('error', 'Material no encontrado.'); return res.redirect('/admin/material'); }

  const { titulo, descripcion, curso_id } = req.body;

  if (req.file) {
    const full = path.join(__dirname, '..', '..', existente.archivo_path);
    if (fs.existsSync(full)) try { fs.unlinkSync(full); } catch (e) {}
    const relPath = path.join('uploads', 'material', req.file.filename).replace(/\\/g, '/');
    await db.prepare(`UPDATE material SET titulo=?, descripcion=?, curso_id=?, archivo_nombre=?, archivo_path=?, mime_type=?, tamano_bytes=? WHERE id=?`)
      .run((titulo||req.file.originalname).trim(), (descripcion||'').trim(), curso_id || null, req.file.originalname, relPath, req.file.mimetype, req.file.size, req.params.id);
  } else {
    await db.prepare('UPDATE material SET titulo=?, descripcion=?, curso_id=? WHERE id=?')
      .run((titulo||existente.titulo).trim(), (descripcion||'').trim(), curso_id || null, req.params.id);
  }

  req.flash('success', 'Material actualizado.');
  res.redirect('/admin/material');
});

router.post('/material/:id/eliminar', async (req, res) => {
  const m = await db.prepare('SELECT archivo_path FROM material WHERE id = ?').get(req.params.id);
  if (m) {
    const full = path.join(__dirname, '..', '..', m.archivo_path);
    if (fs.existsSync(full)) try { fs.unlinkSync(full); } catch (e) {}
    await db.prepare('DELETE FROM material WHERE id = ?').run(req.params.id);
  }
  res.redirect('/admin/material');
});

// ============== COMUNIDAD (moderación) ==============
router.get('/comunidad', async (req, res) => {
  const { q, curso_id, fijado } = req.query;
  let sql = `
    SELECT p.*, u.nombre AS autor, c.titulo AS curso_titulo,
      (SELECT COUNT(*)::int FROM comentarios WHERE post_id = p.id) AS num_com,
      (SELECT COUNT(*)::int FROM likes_post WHERE post_id = p.id) AS num_likes
    FROM posts_comunidad p
    JOIN usuarios u ON p.usuario_id = u.id
    LEFT JOIN cursos c ON p.curso_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (q && q.trim()) {
    sql += ' AND (LOWER(p.titulo) LIKE ? OR LOWER(p.contenido) LIKE ? OR LOWER(u.nombre) LIKE ?)';
    const term = `%${q.trim().toLowerCase()}%`;
    params.push(term, term, term);
  }
  if (curso_id === 'general') {
    sql += ' AND p.curso_id IS NULL';
  } else if (curso_id) {
    sql += ' AND p.curso_id = ?';
    params.push(curso_id);
  }
  if (fijado === '1') sql += ' AND p.fijado = 1';
  sql += ' ORDER BY p.fijado DESC, p.fecha DESC';
  const posts = await db.prepare(sql).all(...params);

  const [cursos, generalRow, totalRow, fijadosRow] = await Promise.all([
    db.prepare(`
      SELECT c.id, c.titulo, (SELECT COUNT(*)::int FROM posts_comunidad WHERE curso_id = c.id) AS num_posts
      FROM cursos c ORDER BY c.titulo
    `).all(),
    db.prepare('SELECT COUNT(*) AS c FROM posts_comunidad WHERE curso_id IS NULL').get(),
    db.prepare('SELECT COUNT(*) AS c FROM posts_comunidad').get(),
    db.prepare('SELECT COUNT(*) AS c FROM posts_comunidad WHERE fijado = 1').get()
  ]);

  res.render('admin/comunidad', {
    title: 'Moderación comunidad',
    posts, cursos, q, curso_id, fijado,
    totalGeneral: generalRow?.c || 0,
    totalPosts: totalRow?.c || 0,
    totalFijados: fijadosRow?.c || 0
  });
});

router.post('/comunidad/:id/fijar', async (req, res) => {
  const p = await db.prepare('SELECT fijado FROM posts_comunidad WHERE id = ?').get(req.params.id);
  await db.prepare('UPDATE posts_comunidad SET fijado = ? WHERE id = ?').run(p.fijado ? 0 : 1, req.params.id);
  res.redirect('/admin/comunidad');
});

router.post('/comunidad/:id/eliminar', async (req, res) => {
  await db.prepare('DELETE FROM posts_comunidad WHERE id = ?').run(req.params.id);
  res.redirect('/admin/comunidad');
});

// ============== ESTADÍSTICAS ==============
router.get('/estadisticas', async (req, res) => {
  const [cursosPop, alumnosActivos] = await Promise.all([
    db.prepare(`
      SELECT c.titulo, COUNT(i.id)::int AS inscriptos,
        (SELECT COUNT(*)::int FROM progreso_lecciones pl JOIN lecciones l ON pl.leccion_id = l.id JOIN modulos m ON l.modulo_id = m.id WHERE m.curso_id = c.id) AS leccs_vistas
      FROM cursos c LEFT JOIN inscripciones i ON i.curso_id = c.id GROUP BY c.id ORDER BY inscriptos DESC LIMIT 10
    `).all(),
    db.prepare(`
      SELECT u.nombre, u.username,
        (SELECT COUNT(*)::int FROM inscripciones WHERE usuario_id = u.id) AS cursos,
        (SELECT COUNT(*)::int FROM progreso_lecciones WHERE usuario_id = u.id) AS lecciones
      FROM usuarios u WHERE u.rol = 'alumno'
      ORDER BY lecciones DESC LIMIT 10
    `).all()
  ]);
  res.render('admin/estadisticas', { title: 'Estadísticas', cursosPop, alumnosActivos });
});

module.exports = router;
