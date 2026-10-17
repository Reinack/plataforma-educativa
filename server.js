require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const expressLayouts = require('express-ejs-layouts');
const pgSession = require('connect-pg-simple')(session);

const db = require('./src/config/db');
const helpers = require('./src/utils/helpers');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(session({
  store: new pgSession({
    pool: db.pool,
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'cambia-este-secreto-en-produccion',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(flash());

app.use(async (req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = {
    success: req.flash('success'),
    error: req.flash('error'),
    info: req.flash('info')
  };
  res.locals.helpers = helpers;
  res.locals.path = req.path;

  if (req.session.user) {
    try {
      const unreadRow = await db.prepare(
        'SELECT COUNT(*) AS c FROM notificaciones WHERE usuario_id = ? AND leido = 0'
      ).get(req.session.user.id);
      const unreadMsgRow = await db.prepare(
        'SELECT COUNT(*) AS c FROM mensajes WHERE destinatario_id = ? AND leido = 0'
      ).get(req.session.user.id);
      res.locals.notifCount = unreadRow?.c || 0;
      res.locals.mensajesCount = unreadMsgRow?.c || 0;
    } catch {
      res.locals.notifCount = 0;
      res.locals.mensajesCount = 0;
    }
  } else {
    res.locals.notifCount = 0;
    res.locals.mensajesCount = 0;
  }
  next();
});

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect(req.session.user.rol === 'admin' ? '/admin' : '/dashboard');
  res.redirect('/login');
});

app.use('/', require('./src/routes/auth'));
app.use('/dashboard', require('./src/routes/dashboard'));
app.use('/cursos', require('./src/routes/cursos'));
app.use('/clases', require('./src/routes/clases'));
app.use('/material', require('./src/routes/material'));
app.use('/comunidad', require('./src/routes/comunidad'));
app.use('/mensajes', require('./src/routes/mensajes'));
app.use('/notificaciones', require('./src/routes/notificaciones'));
app.use('/manual', require('./src/routes/manual'));
app.use('/perfil', require('./src/routes/perfil'));
app.use('/admin', require('./src/routes/admin'));

app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'No encontrado' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('errors/500', { title: 'Error', error: err });
});

(async () => {
  try {
    await db.init();
    app.listen(PORT, () => {
      console.log(`\n✓ Plataforma educativa corriendo en http://localhost:${PORT}`);
      console.log(`  Admin:   admin   /  admin123`);
      console.log(`  Alumno:  alumno  / alumno123\n`);
    });
  } catch (err) {
    console.error('Error iniciando la base de datos:', err);
    process.exit(1);
  }
})();
