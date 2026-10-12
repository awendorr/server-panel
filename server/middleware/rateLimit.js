const db = require('../db');
const config = require('../config');

const countFailedByIp = db.prepare(
  'SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND success = 0 AND created_at > ?'
);
const countFailedByUser = db.prepare(
  'SELECT COUNT(*) AS n FROM login_attempts WHERE username = ? AND success = 0 AND created_at > ?'
);
const oldestFailedByIp = db.prepare(
  'SELECT MIN(created_at) AS t FROM login_attempts WHERE ip = ? AND success = 0 AND created_at > ?'
);
const insertAttempt = db.prepare(
  'INSERT INTO login_attempts (ip, username, success, created_at) VALUES (?, ?, ?, ?)'
);

// Kilitliyse kalan süreyi (ms) döner, değilse 0
function lockRemaining(ip, username) {
  const since = Date.now() - config.loginWindowMs;
  const byIp = countFailedByIp.get(ip, since).n;
  // Kullanıcı adı başına daha yüksek limit: farklı IP'lerden dağıtık denemelere karşı
  const byUser = username ? countFailedByUser.get(username, since).n : 0;
  if (byIp < config.loginMaxAttempts && byUser < config.loginMaxAttempts * 3) return 0;
  const oldest = oldestFailedByIp.get(ip, since).t || Date.now();
  return Math.max(1000, oldest + config.loginWindowMs - Date.now());
}

function recordAttempt(ip, username, success) {
  insertAttempt.run(ip, username || null, success ? 1 : 0, Date.now());
}

function cleanup() {
  db.prepare('DELETE FROM login_attempts WHERE created_at < ?').run(Date.now() - 86400 * 1000);
}

module.exports = { lockRemaining, recordAttempt, cleanup };
