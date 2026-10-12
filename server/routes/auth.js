const express = require('express');
const userService = require('../services/userService');
const audit = require('../services/auditService');
const { lockRemaining, recordAttempt } = require('../middleware/rateLimit');
const { ensureCsrfToken, csrfProtection } = require('../middleware/security');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Giriş sayfası için: hiç kullanıcı var mı?
router.get('/status', (req, res) => {
  res.json({ hasUsers: userService.count() > 0, loggedIn: !!req.session.userId });
});

router.post('/login', async (req, res, next) => {
  try {
    // Sadece JSON kabul et: başka sitelerden basit form POST'larını engeller
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON bekleniyor' });

    const username = typeof req.body.username === 'string' ? req.body.username.trim().slice(0, 64) : '';
    const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 1024) : '';
    const ip = req.ip;

    const wait = lockRemaining(ip, username);
    if (wait > 0) {
      audit.log(req, 'auth.login_blocked', { username, success: false });
      res.set('Retry-After', Math.ceil(wait / 1000));
      return res.status(429).json({
        error: `Çok fazla hatalı deneme. ${Math.ceil(wait / 60000)} dakika sonra tekrar deneyin.`,
      });
    }

    const user = await userService.verify(username, password);
    recordAttempt(ip, username, !!user);
    if (!user) {
      audit.log(req, 'auth.login', { username, success: false });
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
    }

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
    // Bu oturuma ait açık soketleri (canlı veri, ileride terminal) kapat
    const io = req.app.locals.io;
    if (io) io.in(`sess:${sid}`).disconnectSockets(true);
    res.clearCookie('panel.sid');
    res.json({ ok: true });
  });
});

module.exports = router;
