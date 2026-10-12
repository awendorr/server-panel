// HTTP istekleri için: oturum yoksa 401
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Giriş gerekli' });
}

// Sayfa istekleri için: oturum yoksa giriş sayfasına yönlendir
function requireAuthPage(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.redirect('/login');
}

// Socket.IO bağlantıları için
function socketAuth(socket, next) {
  const sess = socket.request.session;
  if (sess && sess.userId) return next();
  const err = new Error('unauthorized');
  err.data = { code: 401 };
  return next(err);
}

module.exports = { requireAuth, requireAuthPage, socketAuth };
