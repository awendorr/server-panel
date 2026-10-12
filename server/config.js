const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ROOT = path.join(__dirname, '..');

// .env process.env'e yazılmaz: terminalde açılan kabuklara ve oradan başlatılan
// uygulamalara panelin PORT, HOST, DB_PATH gibi ayarları geçmesin.
// Gerçek ortam değişkenleri .env'deki değerlerden önceliklidir.
let fileEnv = {};
try {
  fileEnv = dotenv.parse(fs.readFileSync(path.join(ROOT, '.env')));
} catch (_) { /* .env yoksa yalnızca ortam değişkenleri */ }
const env = { ...fileEnv, ...process.env };

function int(name, def) {
  const v = parseInt(env[name], 10);
  return Number.isFinite(v) ? v : def;
}

const config = {
  root: ROOT,
  host: env.HOST || '127.0.0.1',
  port: int('PORT', 7319),
  sessionSecret: env.SESSION_SECRET || '',
  sessionTtlMs: int('SESSION_TTL_HOURS', 12) * 3600 * 1000,
  sessionMaxMs: int('SESSION_MAX_HOURS', 168) * 3600 * 1000,
  dbPath: path.resolve(ROOT, env.DB_PATH || './data/panel.db'),
  fileRoot: path.resolve(env.FILE_ROOT || '/'),
  maxUploadBytes: Math.max(1, int('MAX_UPLOAD_MB', 100)) * 1024 * 1024,
  trustProxy: env.TRUST_PROXY === '1',
  metricsIntervalMs: Math.max(1000, int('METRICS_INTERVAL_MS', 2000)),
  auditRetentionDays: int('AUDIT_RETENTION_DAYS', 90),
  auditMaxRows: Math.max(1000, int('AUDIT_MAX_ROWS', 100000)),
  loginMaxAttempts: Math.max(1, int('LOGIN_MAX_ATTEMPTS', 5)),
  loginWindowMs: int('LOGIN_WINDOW_MIN', 15) * 60 * 1000,
};

function validate() {
  const errors = [];
  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    errors.push('SESSION_SECRET en az 32 karakter olmalı (.env dosyasına bakın).');
  }
  if (!['127.0.0.1', '::1', 'localhost'].includes(config.host)) {
    console.warn(`[uyarı] HOST=${config.host}: panel dış ağa açılıyor olabilir. 127.0.0.1 önerilir.`);
  }
  return errors;
}

module.exports = { ...config, validate };
