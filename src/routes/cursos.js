const express = require('express');
const db = require('../config/db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

async function puedeVer(user, cursoId) {
  if (['admin', 'soporte', 'profesor'].includes(user.rol)) return true;
  const r = await db.prepare('SELECT 1 FROM inscripciones WHERE usuario_id = ? AND curso_id = ?').get(user.id, cursoId);
  return !!r;
}

router.get('/', async (req, res) => {
  const user = req.session.user;
  const { categoria, q } = req.query;
  const params = [];
  let sql;

  if (user.rol === 'alumno') {
    sql = `
      SELECT c.*, cat.nombre AS categoria,
        (SELECT COUNT(*)::int FROM lecciones l JOIN modulos m ON l.modulo_id = m.id WHERE m.curso_id = c.id) AS total_lecciones
      FROM cursos c
      LEFT JOIN categorias cat ON c.categoria_id = cat.id
      INNER JOIN inscripciones i ON i.curso_id = c.id AND i.usuario_id = ?
      WHERE 1=1
    `;
    params.push(user.id);
  } else {
    sql = `
      SELECT c.*, cat.nombre AS categoria,
        (SELECT COUNT(*)::int FROM lecciones l JOIN modulos m ON l.modulo_id = m.id WHERE m.curso_id = c.id) AS total_lecciones
      FROM cursos c
      LEFT JOIN categorias cat ON c.categoria_id = cat.id
      WHERE c.publicado = 1
    `;
  }
  if (categoria) { sql += ' AND c.categoria_id = ?'; params.push(categoria); }
  if (q) { sql += ' AND (c.titulo LIKE ? OR c.descripcion LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY c.fecha_creacion DESC';

  const cursos = await db.prepare(sql).all(...params);
  const categorias = await db.prepare('SELECT * FROM categorias ORDER BY nombre').all();
  res.render('cursos/lista', { title: 'Mis cursos', cursos, categorias, filtroCategoria: categoria, q });
});

router.get('/:id', async (req, res) => {
  const user = req.session.user;
  const curso = await db.prepare(`
    SELECT c.*, cat.nombre AS categoria
    FROM cursos c LEFT JOIN categorias cat ON c.categoria_id = cat.id
    WHERE c.id = ?
  `).get(req.params.id);
  if (!curso) return res.status(404).render('errors/404', { title: 'No encontrado' });

  if (!await puedeVer(user, curso.id)) {
    return res.status(403).render('errors/403', { title: 'Sin acceso' });
  }

  const modulos = await db.prepare('SELECT * FROM modulos WHERE curso_id = ? ORDER BY orden, id').all(curso.id);

  for (const m of modulos) {
    m.videos = await db.prepare(`
      SELECT l.*, EXISTS(SELECT 1 FROM progreso_lecciones p WHERE p.leccion_id = l.id AND p.usuario_id = ?)::int AS completado
      FROM lecciones l WHERE l.modulo_id = ? ORDER BY l.orden, l.id
    `).all(user.id, m.id);
  }

  const totalVideos = modulos.reduce((s, m) => s + m.videos.length, 0);
  const completadas = modulos.reduce((s, m) => s + m.videos.filter(l => l.completado).length, 0);
  const progreso = totalVideos ? Math.round(completadas * 100 / totalVideos) : 0;

  const materiales = await db.prepare('SELECT * FROM material WHERE curso_id = ?').all(curso.id);

  res.render('cursos/detalle', {
    title: curso.titulo, curso, modulos, progreso, completadas, totalVideos, materiales
  });
});

router.get('/:cursoId/videos/:videoId', async (req, res) => {
  const user = req.session.user;
  const { cursoId, videoId } = req.params;

  if (!await puedeVer(user, cursoId)) {
    return res.status(403).render('errors/403', { title: 'Sin acceso' });
  }

  const video = await db.prepare(`
    SELECT l.*, m.titulo AS modulo_titulo, m.curso_id, c.titulo AS curso_titulo
    FROM lecciones l JOIN modulos m ON l.modulo_id = m.id JOIN cursos c ON m.curso_id = c.id
    WHERE l.id = ? AND c.id = ?
  `).get(videoId, cursoId);
  if (!video) return res.status(404).render('errors/404', { title: 'No encontrado' });

  const completadaRow = await db.prepare('SELECT 1 FROM progreso_lecciones WHERE usuario_id = ? AND leccion_id = ?').get(user.id, videoId);
  const completada = !!completadaRow;

  const todos = await db.prepare(`
    SELECT l.id FROM lecciones l JOIN modulos m ON l.modulo_id = m.id
    WHERE m.curso_id = ? ORDER BY m.orden, m.id, l.orden, l.id
  `).all(cursoId);
  const idx = todos.findIndex(l => l.id == videoId);
  const anterior = idx > 0 ? todos[idx - 1].id : null;
  const siguiente = idx < todos.length - 1 ? todos[idx + 1].id : null;

  res.render('cursos/video', { title: video.titulo, video, completada, anterior, siguiente, cursoId });
});

router.post('/:cursoId/videos/:videoId/completar', async (req, res) => {
  const user = req.session.user;
  const { cursoId, videoId } = req.params;
  if (!await puedeVer(user, cursoId)) return res.status(403).render('errors/403', { title: 'Sin acceso' });

  try {
    await db.prepare('INSERT INTO progreso_lecciones (usuario_id, leccion_id) VALUES (?, ?)').run(user.id, videoId);
  } catch { /* ya estaba */ }

  res.redirect(`/cursos/${cursoId}/videos/${videoId}`);
});

module.exports = router;
