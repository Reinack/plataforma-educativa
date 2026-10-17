const express = require('express');
const db = require('../config/db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

const CONV_SQL = `
  SELECT u.id, u.nombre, u.rol,
    (SELECT contenido FROM mensajes m WHERE (m.remitente_id = u.id AND m.destinatario_id = ?) OR (m.remitente_id = ? AND m.destinatario_id = u.id) ORDER BY m.fecha DESC LIMIT 1) AS ultimo,
    (SELECT fecha FROM mensajes m WHERE (m.remitente_id = u.id AND m.destinatario_id = ?) OR (m.remitente_id = ? AND m.destinatario_id = u.id) ORDER BY m.fecha DESC LIMIT 1) AS fecha,
    (SELECT COUNT(*)::int FROM mensajes m WHERE m.remitente_id = u.id AND m.destinatario_id = ? AND m.leido = 0) AS no_leidos
  FROM usuarios u
  WHERE u.id != ? AND u.activo = 1 AND (
    EXISTS(SELECT 1 FROM mensajes m WHERE (m.remitente_id = u.id AND m.destinatario_id = ?) OR (m.remitente_id = ? AND m.destinatario_id = u.id))
    OR u.rol IN ('admin','soporte','profesor')
  )
  ORDER BY fecha DESC NULLS LAST, u.rol DESC
`;

router.get('/', async (req, res) => {
  const userId = req.session.user.id;
  const conversaciones = await db.prepare(CONV_SQL).all(userId, userId, userId, userId, userId, userId, userId, userId);
  res.render('mensajes/lista', { title: 'Mensajes', conversaciones, activeId: null });
});

router.get('/con/:id', async (req, res) => {
  const userId = req.session.user.id;
  const otroId = parseInt(req.params.id);
  const otro = await db.prepare('SELECT id, nombre, rol FROM usuarios WHERE id = ?').get(otroId);
  if (!otro) return res.redirect('/mensajes');

  await db.prepare('UPDATE mensajes SET leido = 1 WHERE remitente_id = ? AND destinatario_id = ?').run(otroId, userId);

  const mensajes = await db.prepare(`
    SELECT * FROM mensajes
    WHERE (remitente_id = ? AND destinatario_id = ?) OR (remitente_id = ? AND destinatario_id = ?)
    ORDER BY fecha ASC
  `).all(userId, otroId, otroId, userId);

  const conversaciones = await db.prepare(CONV_SQL).all(userId, userId, userId, userId, userId, userId, userId, userId);

  res.render('mensajes/lista', { title: `Chat con ${otro.nombre}`, conversaciones, activeId: otroId, otro, mensajes });
});

router.post('/con/:id', async (req, res) => {
  const userId = req.session.user.id;
  const destId = parseInt(req.params.id);
  const { contenido } = req.body;
  if (contenido && contenido.trim()) {
    await db.prepare('INSERT INTO mensajes (remitente_id, destinatario_id, contenido) VALUES (?, ?, ?)')
      .run(userId, destId, contenido.trim());
    await db.prepare("INSERT INTO notificaciones (usuario_id, tipo, mensaje, link) VALUES (?, 'mensaje', ?, ?)")
      .run(destId, `${req.session.user.nombre} te envió un mensaje`, `/mensajes/con/${userId}`);
  }
  res.redirect(`/mensajes/con/${destId}`);
});

router.get('/nuevo', async (req, res) => {
  const userId = req.session.user.id;
  const usuarios = await db.prepare('SELECT id, nombre, rol FROM usuarios WHERE id != ? AND activo = 1 ORDER BY nombre').all(userId);
  res.render('mensajes/nuevo', { title: 'Nuevo mensaje', usuarios });
});

module.exports = router;
