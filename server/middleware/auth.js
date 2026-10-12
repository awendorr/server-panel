const config = require('../config');

// Oturum açık mı? Kullanılsa bile SESSION_MAX_HOURS'tan eski girişler geçersiz sayılır.
function isActive(sess) {
  return !!(sess && sess.userId && sess.loginAt && Date.now() - sess.loginAt < config.sessionMaxMs);
}

function expire(req) {
  if (req.session && req.session.userId) req.session.destroy(() => {});
}

// HTTP istekleri için: oturum yoksa 401
function requireAuth(req, res, next) {
  if (isActive(req.session)) return next();
  expire(req);
  return res.status(401).json({ error: 'Giriş gerekli' });
}

// Sayfa istekleri için: oturum yoksa giriş sayfasına yönlendir
function requireAuthPage(req, res, next) {
  if (isActive(req.session)) return next();
  expire(req);
  return res.redirect('/login');
}

// Socket.IO bağlantıları için
function socketAuth(socket, next) {
  if (isActive(socket.request.session)) return next();
  const err = new Error('unauthorized');
  err.data = { code: 401 };
  return next(err);
}

module.exports = { isActive, requireAuth, requireAuthPage, socketAuth };
