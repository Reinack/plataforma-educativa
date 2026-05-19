const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { redirectIfAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/login', redirectIfAuth, (req, res) => {
  res.render('auth/login', { title: 'Iniciar sesión', layout: 'layouts/auth' });
});

router.post('/login', redirectIfAuth, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    req.flash('error', 'Completá usuario y contraseña.');
    return res.redirect('/login');
  }
  const user = await db.prepare('SELECT * FROM usuarios WHERE username = ?').get(username.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    req.flash('error', 'Usuario o contraseña incorrectos.');
    return res.redirect('/login');
  }
  if (!user.activo) {
    req.flash('error', 'Tu cuenta está desactivada. Contactá al administrador.');
    return res.redirect('/login');
  }
  req.session.user = {
    id: user.id, nombre: user.nombre, username: user.username, rol: user.rol, avatar: user.avatar
  };
  res.redirect(user.rol === 'admin' ? '/admin' : '/dashboard');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
