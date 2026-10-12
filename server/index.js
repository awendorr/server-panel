const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const config = require('./config');

const configErrors = config.validate();
if (configErrors.length) {
  configErrors.forEach((e) => console.error('[yapılandırma]', e));
  process.exit(1);
}

const db = require('./db');
const SqliteStore = require('./services/sessionStore');
const metricsService = require('./services/metricsService');
const metricsStore = require('./services/metricsStore');
const audit = require('./services/auditService');
const alertService = require('./services/alertService');
const rateLimit = require('./middleware/rateLimit');
const { helmetMiddleware, csrfProtection } = require('./middleware/security');
const { requireAuth, requireAuthPage } = require('./middleware/auth');
const { setupSockets } = require('./sockets');

const PUBLIC = path.join(config.root, 'public');
const NODE_MODULES = path.join(config.root, 'node_modules');

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

const sessionStore = new SqliteStore({ ttlMs: config.sessionTtlMs });
const sessionMiddleware = session({
  name: 'panel.sid',
  secret: config.sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: 'auto', // HTTPS (Nginx) arkasında otomatik secure
    maxAge: config.sessionTtlMs,
  },
});

app.use(helmetMiddleware());
app.use(sessionMiddleware);

// Tarayıcı kütüphaneleri: CDN yerine yerel node_modules'tan
const vendor = (p) => express.static(path.join(NODE_MODULES, p), { maxAge: '7d' });
app.use('/vendor/chart.js', vendor('chart.js/dist'));
app.use('/vendor/xterm', vendor('@xterm/xterm'));
app.use('/vendor/xterm-fit', vendor('@xterm/addon-fit/lib'));
app.use('/vendor/monaco', vendor('monaco-editor/min'));

// Sayfalar
app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.sendFile(path.join(PUBLIC, 'login.html'));
});
app.get('/', requireAuthPage, (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.use(express.static(PUBLIC, { index: false }));

// API
app.use('/api/auth', express.json({ limit: '16kb' }), require('./routes/auth'));
// Buradan sonraki tüm API'ler giriş + CSRF ister; büyük gövdeler (dosya kaydetme) ancak girişten sonra kabul edilir
app.use('/api', requireAuth, csrfProtection, express.json({ limit: '6mb' }), (req, res, next) => {
  if (!req.body) req.body = {};
  next();
});
app.use('/api/metrics', require('./routes/metrics'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/pm2', require('./routes/pm2'));
app.use('/api/files', require('./routes/files'));
app.use('/api/system', require('./routes/system'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Bulunamadı' }));

// Hata yakalayıcı: ayrıntıyı loga yaz, istemciye genel mesaj dön
app.use((err, req, res, _next) => {
  console.error('[hata]', err);
  res.status(err.status || 500).json({ error: err.expose ? err.message : 'Sunucu hatası' });
});

const server = http.createServer(app);
const io = setupSockets(server, sessionMiddleware);
app.locals.io = io;

metricsService.on('sample', metricsStore.record);
alertService.init();
metricsService.on('sample', (s) => {
  try { alertService.evaluate(s); } catch (err) { console.error('[uyarı] değerlendirme hatası:', err.message); }
});
metricsService.start().catch((err) => console.error('[metrics] başlatılamadı:', err));

function cleanup() {
  try {
    metricsStore.cleanup();
    audit.cleanup();
    alertService.cleanup();
    rateLimit.cleanup();
    sessionStore.cleanup();
  } catch (err) {
    console.error('[temizlik]', err.message);
  }
}
cleanup();
setInterval(cleanup, 10 * 60 * 1000).unref();

server.listen(config.port, config.host, () => {
  console.log(`Panel http://${config.host}:${config.port} adresinde çalışıyor`);
});

function shutdown() {
  metricsService.stop();
  require('./services/pm2Service').disconnect();
  metricsStore.flushAll();
  io.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
