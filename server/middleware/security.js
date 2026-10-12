const crypto = require('crypto');
const helmet = require('helmet');
const config = require('../config');

function helmetMiddleware() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        // SSH tüneli (düz http) üzerinden kullanımda istekleri https'e yükseltme
        upgradeInsecureRequests: config.trustProxy ? [] : null,
      },
    },
    hsts: config.trustProxy,
    crossOriginEmbedderPolicy: false,
  });
}

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Değişiklik yapan isteklerde X-CSRF-Token başlığını doğrula
function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.get('X-CSRF-Token');
  if (!req.session || !req.session.csrfToken || !safeEqual(token, req.session.csrfToken)) {
    return res.status(403).json({ error: 'Geçersiz CSRF token' });
  }
  return next();
}

// İstek Origin'i panelin kendi adresiyle aynı mı (Socket.IO el sıkışması için)
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // tarayıcı dışı istemciler; oturum cookie'si yine gerekli
  try {
    const host = req.headers['x-forwarded-host'] && config.trustProxy
      ? req.headers['x-forwarded-host']
      : req.headers.host;
    return new URL(origin).host === host;
  } catch (_) {
    return false;
  }
}

module.exports = { helmetMiddleware, ensureCsrfToken, csrfProtection, sameOrigin };
