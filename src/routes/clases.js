const express = require('express');
const db = require('../config/db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

function filtroAlumno(user) {
  if (user.rol === 'alumno') {
    return {
      sql: `AND (cl.curso_id IS NULL OR EXISTS(
              SELECT 1 FROM inscripciones i WHERE i.curso_id = cl.curso_id AND i.usuario_id = ?
            ))`,
      params: [user.id]
    };
  }
  if (user.rol === 'profesor') {
    return {
      sql: 'AND (cl.instructor_id = ? OR cl.instructor_id IS NULL)',
      params: [user.id]
    };
  }
  return { sql: '', params: [] };
}

router.get('/', async (req, res) => {
  const user = req.session.user;
  const filtro = filtroAlumno(user);

  const proximas = await db.prepare(`
    SELECT cl.*, c.titulo AS curso_titulo
    FROM clases_vivo cl LEFT JOIN cursos c ON cl.curso_id = c.id
    WHERE cl.publicado = 1 AND cl.fecha_hora >= NOW()
      ${filtro.sql}
    ORDER BY cl.fecha_hora ASC
  `).all(...filtro.params);

  const pasadas = await db.prepare(`
    SELECT cl.*, c.titulo AS curso_titulo
    FROM clases_vivo cl LEFT JOIN cursos c ON cl.curso_id = c.id
    WHERE cl.publicado = 1 AND cl.fecha_hora < NOW()
      ${filtro.sql}
    ORDER BY cl.fecha_hora DESC LIMIT 20
  `).all(...filtro.params);

  res.render('clases/lista', { title: 'Clases en vivo', proximas, pasadas });
});

router.get('/:id', async (req, res) => {
  const user = req.session.user;
  const clase = await db.prepare(`
    SELECT cl.*, c.titulo AS curso_titulo
    FROM clases_vivo cl LEFT JOIN cursos c ON cl.curso_id = c.id
    WHERE cl.id = ? AND cl.publicado = 1
  `).get(req.params.id);
  if (!clase) return res.status(404).render('errors/404', { title: 'No encontrada' });

  if (user.rol === 'alumno' && clase.curso_id) {
    const ok = await db.prepare('SELECT 1 FROM inscripciones WHERE usuario_id = ? AND curso_id = ?')
      .get(user.id, clase.curso_id);
    if (!ok) return res.status(403).render('errors/403', { title: 'Sin acceso' });
  }

  if (user.rol === 'profesor' && clase.instructor_id && clase.instructor_id !== user.id) {
    return res.status(403).render('errors/403', { title: 'Sin acceso' });
  }

  res.render('clases/detalle', { title: clase.titulo, clase });
});

module.exports = router;
