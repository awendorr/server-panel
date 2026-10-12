const express = require('express');
const userService = require('../services/userService');
const audit = require('../services/auditService');
const { reserveAttempt, attemptSucceeded, shouldLogBlock } = require('../middleware/rateLimit');
const { ensureCsrfToken, csrfProtection } = require('../middleware/security');
const { isActive, requireAuth } = require('../middleware/auth');

const router = express.Router();

// Aynı anda en fazla bu kadar bcrypt doğrulaması: giriş seli CPU'yu kilitlemesin
const MAX_VERIFY_IN_FLIGHT = 4;
let verifyInFlight = 0;

function waitText(ms) {
  const sec = Math.ceil(ms / 1000);
  return sec < 90 ? `${sec} saniye` : `${Math.ceil(sec / 60)} dakika`;
}

// Giriş sayfası için: hiç kullanıcı var mı?
router.get('/status', (req, res) => {
  res.json({ hasUsers: userService.count() > 0, loggedIn: isActive(req.session) });
});

router.post('/login', async (req, res, next) => {
  try {
    // Sadece JSON kabul et: başka sitelerden basit form POST'larını engeller
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON bekleniyor' });

    const username = typeof req.body.username === 'string' ? req.body.username.trim().slice(0, 64) : '';
    const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 1024) : '';
    const ip = req.ip;

    if (verifyInFlight >= MAX_VERIFY_IN_FLIGHT) {
      res.set('Retry-After', '2');
      return res.status(503).json({ error: 'Sunucu meşgul, birkaç saniye sonra tekrar deneyin.' });
    }

    const slot = reserveAttempt(ip, username);
    if (slot.wait) {
      if (shouldLogBlock(slot.key, slot.wait)) audit.log(req, 'auth.login_blocked', { username, success: false });
      res.set('Retry-After', Math.ceil(slot.wait / 1000));
      return res.status(429).json({
        error: `Çok fazla hatalı deneme. ${waitText(slot.wait)} sonra tekrar deneyin.`,
      });
    }

    let user;
    verifyInFlight++;
    try {
      user = await userService.verify(username, password);
    } finally {
      verifyInFlight--;
    }
    if (!user) {
      audit.log(req, 'auth.login', { username, success: false });
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
    }
    attemptSucceeded(slot.attemptId, user.username, ip);

    // Session fixation'a karşı yeni oturum kimliği
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.loginAt = Date.now();
      const csrfToken = ensureCsrfToken(req);
      req.session.save((err2) => {
        if (err2) return next(err2);
        audit.log(req, 'auth.login', { username: user.username });
        res.json({ username: user.username, csrfToken });
      });
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ username: req.session.username, csrfToken: ensureCsrfToken(req) });
});

router.post('/logout', requireAuth, csrfProtection, (req, res, next) => {
  audit.log(req, 'auth.logout');
  const sid = req.sessionID;
  req.session.destroy((err) => {
    if (err) return next(err);
    // Bu oturuma ait açık soketleri (canlı veri, terminal) kapat
    const io = req.app.locals.io;
    if (io) io.in(`sess:${sid}`).disconnectSockets(true);
    res.clearCookie('panel.sid');
    res.json({ ok: true });
  });
});

module.exports = router;
