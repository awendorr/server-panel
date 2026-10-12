const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const ROOT = path.join(__dirname, '..');

function int(name, def) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : def;
}

const config = {
  root: ROOT,
  host: process.env.HOST || '127.0.0.1',
  port: int('PORT', 7319),
  sessionSecret: process.env.SESSION_SECRET || '',
  sessionTtlMs: int('SESSION_TTL_HOURS', 12) * 3600 * 1000,
  dbPath: path.resolve(ROOT, process.env.DB_PATH || './data/panel.db'),
  fileRoot: path.resolve(process.env.FILE_ROOT || '/'),
  trustProxy: process.env.TRUST_PROXY === '1',
  metricsIntervalMs: Math.max(1000, int('METRICS_INTERVAL_MS', 2000)),
  auditRetentionDays: int('AUDIT_RETENTION_DAYS', 90),
  loginMaxAttempts: int('LOGIN_MAX_ATTEMPTS', 5),
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
