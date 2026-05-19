function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    req.flash('error', 'Tenés que iniciar sesión.');
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    req.flash('error', 'Tenés que iniciar sesión.');
    return res.redirect('/login');
  }
  if (req.session.user.rol !== 'admin') {
    return res.status(403).render('errors/403', { title: 'Acceso denegado' });
  }
  next();
}

function redirectIfAuth(req, res, next) {
  if (req.session && req.session.user) return res.redirect('/dashboard');
  next();
}

module.exports = { requireLogin, requireAdmin, redirectIfAuth };
