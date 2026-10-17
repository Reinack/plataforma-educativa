const express = require('express');
const db = require('../config/db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

router.get('/', async (req, res) => {
  const userId = req.session.user.id;
  const esAlumno = req.session.user.rol === 'alumno';
  const esProfesor = req.session.user.rol === 'profesor';

  const inscripciones = await db.prepare(`
    SELECT c.id, c.titulo, c.descripcion, c.instructor, cat.nombre AS categoria,
      (SELECT COUNT(*)::int FROM lecciones l JOIN modulos m ON l.modulo_id = m.id WHERE m.curso_id = c.id) AS total_lecciones,
      (SELECT COUNT(*)::int FROM progreso_lecciones p JOIN lecciones l ON p.leccion_id = l.id JOIN modulos m ON l.modulo_id = m.id WHERE p.usuario_id = ? AND m.curso_id = c.id) AS completadas
    FROM inscripciones i
    JOIN cursos c ON i.curso_id = c.id
    LEFT JOIN categorias cat ON c.categoria_id = cat.id
    WHERE i.usuario_id = ?
    ORDER BY i.fecha DESC
    LIMIT 4
  `).all(userId, userId);

  let proximasClases;
  if (esAlumno) {
    proximasClases = await db.prepare(`
      SELECT * FROM clases_vivo
      WHERE publicado = 1 AND fecha_hora >= NOW()
        AND (curso_id IS NULL OR EXISTS(
          SELECT 1 FROM inscripciones i WHERE i.curso_id = clases_vivo.curso_id AND i.usuario_id = ?
        ))
      ORDER BY fecha_hora ASC LIMIT 3
    `).all(userId);
  } else if (esProfesor) {
    proximasClases = await db.prepare(`
      SELECT * FROM clases_vivo
      WHERE publicado = 1 AND fecha_hora >= NOW()
        AND (instructor_id = ? OR instructor_id IS NULL)
      ORDER BY fecha_hora ASC LIMIT 3
    `).all(userId);
  } else {
    proximasClases = await db.prepare(`
      SELECT * FROM clases_vivo
      WHERE publicado = 1 AND fecha_hora >= NOW()
      ORDER BY fecha_hora ASC LIMIT 3
    `).all();
  }

  let ultimosPosts;
  if (esAlumno) {
    ultimosPosts = await db.prepare(`
      SELECT p.id, p.titulo, p.fecha, u.nombre AS autor
      FROM posts_comunidad p
      JOIN usuarios u ON p.usuario_id = u.id
      WHERE p.curso_id IS NULL OR EXISTS(
        SELECT 1 FROM inscripciones i WHERE i.curso_id = p.curso_id AND i.usuario_id = ?
      )
      ORDER BY p.fecha DESC LIMIT 5
    `).all(userId);
  } else {
    ultimosPosts = await db.prepare(`
      SELECT p.id, p.titulo, p.fecha, u.nombre AS autor
      FROM posts_comunidad p
      JOIN usuarios u ON p.usuario_id = u.id
      ORDER BY p.fecha DESC LIMIT 5
    `).all();
  }

  const cursosInscritosRow = await db.prepare('SELECT COUNT(*) AS c FROM inscripciones WHERE usuario_id = ?').get(userId);
  const leccionesRow = await db.prepare('SELECT COUNT(*) AS c FROM progreso_lecciones WHERE usuario_id = ?').get(userId);

  let proximasClasesCount;
  if (esAlumno) {
    const r = await db.prepare(`
      SELECT COUNT(*) AS c FROM clases_vivo
      WHERE publicado = 1 AND fecha_hora >= NOW()
        AND (curso_id IS NULL OR EXISTS(SELECT 1 FROM inscripciones i WHERE i.curso_id = clases_vivo.curso_id AND i.usuario_id = ?))
    `).get(userId);
    proximasClasesCount = r?.c || 0;
  } else if (esProfesor) {
    const r = await db.prepare(`
      SELECT COUNT(*) AS c FROM clases_vivo
      WHERE publicado = 1 AND fecha_hora >= NOW()
        AND (instructor_id = ? OR instructor_id IS NULL)
    `).get(userId);
    proximasClasesCount = r?.c || 0;
  } else {
    const r = await db.prepare(`
      SELECT COUNT(*) AS c FROM clases_vivo WHERE publicado = 1 AND fecha_hora >= NOW()
    `).get();
    proximasClasesCount = r?.c || 0;
  }

  const stats = {
    cursosInscritos: cursosInscritosRow?.c || 0,
    leccionesCompletadas: leccionesRow?.c || 0,
    proximasClases: proximasClasesCount
  };

  res.render('dashboard/index', { title: 'Inicio', inscripciones, proximasClases, ultimosPosts, stats });
});

module.exports = router;
