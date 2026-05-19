const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { requireLogin } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'public', 'uploads', 'avatars');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, 'avatar-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const router = express.Router();
router.use(requireLogin);

router.get('/', async (req, res) => {
  const user = await db.prepare('SELECT id, nombre, username, rol, bio, avatar, fecha_creacion FROM usuarios WHERE id = ?')
    .get(req.session.user.id);
  const cursosRow = await db.prepare('SELECT COUNT(*) AS c FROM inscripciones WHERE usuario_id = ?').get(user.id);
  const leccionesRow = await db.prepare('SELECT COUNT(*) AS c FROM progreso_lecciones WHERE usuario_id = ?').get(user.id);
  const postsRow = await db.prepare('SELECT COUNT(*) AS c FROM posts_comunidad WHERE usuario_id = ?').get(user.id);
  const stats = {
    cursos: cursosRow?.c || 0,
    lecciones: leccionesRow?.c || 0,
    posts: postsRow?.c || 0
  };
  res.render('perfil/index', { title: 'Mi perfil', user, stats });
});

router.post('/actualizar', upload.single('avatar'), async (req, res) => {
  const { nombre, bio } = req.body;
  let avatarPath = null;
  if (req.file) {
    avatarPath = '/uploads/avatars/' + req.file.filename;
    const u = await db.prepare('SELECT avatar FROM usuarios WHERE id = ?').get(req.session.user.id);
    if (u && u.avatar) {
      const fullPath = path.join(__dirname, '..', '..', 'public', u.avatar);
      if (fs.existsSync(fullPath)) try { fs.unlinkSync(fullPath); } catch (e) {}
    }
  }

  if (avatarPath) {
    await db.prepare('UPDATE usuarios SET nombre = ?, bio = ?, avatar = ? WHERE id = ?')
      .run(nombre.trim(), (bio || '').trim(), avatarPath, req.session.user.id);
    req.session.user.avatar = avatarPath;
  } else {
    await db.prepare('UPDATE usuarios SET nombre = ?, bio = ? WHERE id = ?')
      .run(nombre.trim(), (bio || '').trim(), req.session.user.id);
  }

  req.session.user.nombre = nombre.trim();
  req.flash('success', 'Perfil actualizado.');
  res.redirect('/perfil');
});

router.post('/password', async (req, res) => {
  const { actual, nueva, nueva2 } = req.body;
  const u = await db.prepare('SELECT password_hash FROM usuarios WHERE id = ?').get(req.session.user.id);
  if (!bcrypt.compareSync(actual, u.password_hash)) {
    req.flash('error', 'La contraseña actual es incorrecta.');
    return res.redirect('/perfil');
  }
  if (!nueva || nueva.length < 6) {
    req.flash('error', 'La nueva contraseña debe tener al menos 6 caracteres.');
    return res.redirect('/perfil');
  }
  if (nueva !== nueva2) {
    req.flash('error', 'Las contraseñas no coinciden.');
    return res.redirect('/perfil');
  }
  await db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(nueva, 10), req.session.user.id);
  req.flash('success', 'Contraseña actualizada.');
  res.redirect('/perfil');
});

module.exports = router;
