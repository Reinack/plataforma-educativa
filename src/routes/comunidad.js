const express = require('express');
const db = require('../config/db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

async function cursosVisibles(user) {
  if (user.rol === 'alumno') {
    return db.prepare(`
      SELECT c.id, c.titulo
      FROM cursos c JOIN inscripciones i ON i.curso_id = c.id
      WHERE i.usuario_id = ?
      ORDER BY c.titulo
    `).all(user.id);
  }
  return db.prepare('SELECT id, titulo FROM cursos ORDER BY titulo').all();
}

function filtroPostsVisibles(user) {
  if (user.rol === 'alumno') {
    return {
      sql: `AND (p.curso_id IS NULL OR EXISTS(
              SELECT 1 FROM inscripciones i WHERE i.curso_id = p.curso_id AND i.usuario_id = ?
            ))`,
      params: [user.id]
    };
  }
  return { sql: '', params: [] };
}

async function puedeVerPost(user, post) {
  if (user.rol !== 'alumno') return true;
  if (!post.curso_id) return true;
  const r = await db.prepare('SELECT 1 FROM inscripciones WHERE usuario_id = ? AND curso_id = ?')
    .get(user.id, post.curso_id);
  return !!r;
}

router.get('/', async (req, res) => {
  const user = req.session.user;
  const cursos = await cursosVisibles(user);
  const visibilidad = filtroPostsVisibles(user);

  const { curso_id } = req.query;
  let filtroCurso = '';
  const filtroCursoParams = [];
  if (curso_id === 'general') {
    filtroCurso = ' AND p.curso_id IS NULL';
  } else if (curso_id) {
    const permitido = cursos.some(c => String(c.id) === String(curso_id));
    if (permitido) {
      filtroCurso = ' AND p.curso_id = ?';
      filtroCursoParams.push(curso_id);
    }
  }

  const posts = await db.prepare(`
    SELECT p.*, u.nombre AS autor, c.titulo AS curso_titulo,
      (SELECT COUNT(*)::int FROM comentarios WHERE post_id = p.id) AS num_comentarios,
      (SELECT COUNT(*)::int FROM likes_post WHERE post_id = p.id) AS num_likes,
      EXISTS(SELECT 1 FROM likes_post WHERE post_id = p.id AND usuario_id = ?)::int AS me_gusta
    FROM posts_comunidad p
    JOIN usuarios u ON p.usuario_id = u.id
    LEFT JOIN cursos c ON p.curso_id = c.id
    WHERE 1=1 ${visibilidad.sql} ${filtroCurso}
    ORDER BY p.fijado DESC, p.fecha DESC
  `).all(user.id, ...visibilidad.params, ...filtroCursoParams);

  res.render('comunidad/lista', { title: 'Comunidad', posts, cursos, curso_id });
});

router.get('/nuevo', async (req, res) => {
  const cursos = await cursosVisibles(req.session.user);
  const preCurso = req.query.curso_id || '';
  res.render('comunidad/nuevo', { title: 'Nuevo post', cursos, preCurso });
});

router.post('/nuevo', async (req, res) => {
  const user = req.session.user;
  const { titulo, contenido, curso_id } = req.body;
  if (!titulo || !contenido) {
    req.flash('error', 'Completá título y contenido.');
    return res.redirect('/comunidad/nuevo');
  }

  let cursoIdFinal = null;
  if (curso_id && curso_id !== 'general') {
    if (user.rol === 'alumno') {
      const ok = await db.prepare('SELECT 1 FROM inscripciones WHERE usuario_id = ? AND curso_id = ?')
        .get(user.id, curso_id);
      if (!ok) {
        req.flash('error', 'No podés publicar en una comunidad de un curso que no tenés asignado.');
        return res.redirect('/comunidad/nuevo');
      }
    }
    const cursoExiste = await db.prepare('SELECT 1 FROM cursos WHERE id = ?').get(curso_id);
    if (!cursoExiste) {
      req.flash('error', 'Curso inválido.');
      return res.redirect('/comunidad/nuevo');
    }
    cursoIdFinal = curso_id;
  }

  await db.prepare('INSERT INTO posts_comunidad (usuario_id, curso_id, titulo, contenido) VALUES (?, ?, ?, ?)')
    .run(user.id, cursoIdFinal, titulo.trim(), contenido.trim());
  req.flash('success', 'Post publicado.');
  res.redirect(cursoIdFinal ? `/comunidad?curso_id=${cursoIdFinal}` : '/comunidad');
});

router.get('/:id', async (req, res) => {
  const user = req.session.user;
  const post = await db.prepare(`
    SELECT p.*, u.nombre AS autor, c.titulo AS curso_titulo,
      (SELECT COUNT(*)::int FROM likes_post WHERE post_id = p.id) AS num_likes,
      EXISTS(SELECT 1 FROM likes_post WHERE post_id = p.id AND usuario_id = ?)::int AS me_gusta
    FROM posts_comunidad p
    JOIN usuarios u ON p.usuario_id = u.id
    LEFT JOIN cursos c ON p.curso_id = c.id
    WHERE p.id = ?
  `).get(user.id, req.params.id);
  if (!post) return res.status(404).render('errors/404', { title: 'No encontrado' });
  if (!await puedeVerPost(user, post)) return res.status(403).render('errors/403', { title: 'Sin acceso' });

  const comentarios = await db.prepare(`
    SELECT c.*, u.nombre AS autor FROM comentarios c JOIN usuarios u ON c.usuario_id = u.id
    WHERE c.post_id = ? ORDER BY c.fecha ASC
  `).all(post.id);
  res.render('comunidad/detalle', { title: post.titulo, post, comentarios });
});

router.post('/:id/comentar', async (req, res) => {
  const user = req.session.user;
  const post = await db.prepare('SELECT id, usuario_id, curso_id FROM posts_comunidad WHERE id = ?').get(req.params.id);
  if (!post) return res.redirect('/comunidad');
  if (!await puedeVerPost(user, post)) return res.status(403).render('errors/403', { title: 'Sin acceso' });

  const { contenido } = req.body;
  if (contenido && contenido.trim()) {
    await db.prepare('INSERT INTO comentarios (post_id, usuario_id, contenido) VALUES (?, ?, ?)')
      .run(req.params.id, user.id, contenido.trim());
    if (post.usuario_id !== user.id) {
      await db.prepare("INSERT INTO notificaciones (usuario_id, tipo, mensaje, link) VALUES (?, 'comentario', ?, ?)")
        .run(post.usuario_id, `${user.nombre} comentó en tu post`, `/comunidad/${req.params.id}`);
    }
  }
  res.redirect(`/comunidad/${req.params.id}`);
});

router.post('/:id/like', async (req, res) => {
  const user = req.session.user;
  const post = await db.prepare('SELECT id, curso_id FROM posts_comunidad WHERE id = ?').get(req.params.id);
  if (!post) return res.redirect('/comunidad');
  if (!await puedeVerPost(user, post)) return res.status(403).render('errors/403', { title: 'Sin acceso' });

  const existe = await db.prepare('SELECT id FROM likes_post WHERE post_id = ? AND usuario_id = ?').get(req.params.id, user.id);
  if (existe) {
    await db.prepare('DELETE FROM likes_post WHERE id = ?').run(existe.id);
  } else {
    await db.prepare('INSERT INTO likes_post (post_id, usuario_id) VALUES (?, ?)').run(req.params.id, user.id);
  }
  res.redirect(req.get('Referrer') || '/comunidad');
});

router.post('/:id/eliminar', async (req, res) => {
  const post = await db.prepare('SELECT usuario_id FROM posts_comunidad WHERE id = ?').get(req.params.id);
  if (!post) return res.redirect('/comunidad');
  if (post.usuario_id !== req.session.user.id && req.session.user.rol !== 'admin') {
    req.flash('error', 'No podés borrar este post.');
    return res.redirect('/comunidad');
  }
  await db.prepare('DELETE FROM posts_comunidad WHERE id = ?').run(req.params.id);
  req.flash('success', 'Post eliminado.');
  res.redirect('/comunidad');
});

module.exports = router;
