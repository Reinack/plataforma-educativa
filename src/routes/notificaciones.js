const express = require('express');
const db = require('../config/db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

router.get('/', async (req, res) => {
  const notifs = await db.prepare(
    'SELECT * FROM notificaciones WHERE usuario_id = ? ORDER BY fecha DESC LIMIT 100'
  ).all(req.session.user.id);
  await db.prepare('UPDATE notificaciones SET leido = 1 WHERE usuario_id = ?').run(req.session.user.id);
  res.render('notificaciones/lista', { title: 'Notificaciones', notifs });
});

router.post('/limpiar', async (req, res) => {
  await db.prepare('DELETE FROM notificaciones WHERE usuario_id = ?').run(req.session.user.id);
  res.redirect('/notificaciones');
});

module.exports = router;
