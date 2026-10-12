const db = require('../db');
const config = require('../config');

// Sınır aşılınca giriş tamamen kapanmaz; her yeni deneme için giderek artan bir bekleme
// uygulanır (30 sn, 1 dk, 2 dk ... en fazla pencere kadar). Böylece deneme hızı düşük kalır,
// ama başkası hatalı deneme yapsa bile doğru şifreyle bir süre sonra girilebilir.
const BASE_DELAY_MS = 30 * 1000;

const statsByIp = db.prepare(
  'SELECT COUNT(*) AS n, MAX(created_at) AS last FROM login_attempts WHERE ip = ? AND success = 0 AND created_at > ?'
);
const statsByUser = db.prepare(
  'SELECT COUNT(*) AS n, MAX(created_at) AS last FROM login_attempts WHERE username = ? AND success = 0 AND created_at > ?'
);
const insertAttempt = db.prepare(
  'INSERT INTO login_attempts (ip, username, success, created_at) VALUES (?, ?, 0, ?)'
);
const markSuccess = db.prepare('UPDATE login_attempts SET success = 1 WHERE id = ?');
const clearFailures = db.prepare('DELETE FROM login_attempts WHERE username = ? AND ip = ? AND success = 0');

// SSH tüneli ve aynı sunucudaki her istemci 127.0.0.1'den gelir: IP sınırı orada herkesi
// tek kovaya koyar, bu yüzden yerel adreslerde yalnızca kullanıcı adı sınırı uygulanır.
function isLoopback(ip) {
  return !ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('::ffff:127.');
}

function waitFor({ n, last }, now, max) {
  if (n < max) return 0;
  const delay = Math.min(BASE_DELAY_MS * 2 ** Math.min(n - max, 20), config.loginWindowMs);
  return Math.max(0, last + delay - now);
}

// Kontrol ve kayıt tek adımda (await yok): paralel istekler sınırı aşamaz.
// Bekleme gerekiyorsa { wait, key } döner, değilse denemeyi hatalı olarak kaydedip { attemptId } döner.
function reserveAttempt(ip, username) {
  const now = Date.now();
  const since = now - config.loginWindowMs;
  const checks = [];
  if (!isLoopback(ip)) checks.push([`ip:${ip}`, statsByIp.get(ip, since), config.loginMaxAttempts]);
  // Kullanıcı adı sınırı daha yüksek: tek bir IP kendi sınırına takılmadan hesabı kilitleyemesin
  if (username) checks.push([`user:${username}`, statsByUser.get(username, since), config.loginMaxAttempts * 3]);
  for (const [key, stats, max] of checks) {
    const wait = waitFor(stats, now, max);
    if (wait > 0) return { wait, key };
  }
  return { attemptId: insertAttempt.run(ip, username || null, now).lastInsertRowid };
}

// Doğru şifreyle girildiyse bu istemcinin bu kullanıcı adıyla yaptığı hatalı denemeler sıfırlanır
const attemptSucceeded = db.transaction((attemptId, username, ip) => {
  markSuccess.run(attemptId);
  clearFailures.run(username, ip);
});

// Engellenen her istek audit'e yazılırsa giriş yapmamış biri tabloyu doldurabilir:
// her bekleme dönemi için yalnızca ilk engeli yaz.
const blockedLogged = new Map(); // key -> bekleme bitiş zamanı
function shouldLogBlock(key, wait) {
  const now = Date.now();
  const until = blockedLogged.get(key);
  if (until && until > now) return false;
  if (blockedLogged.size > 10000) blockedLogged.clear();
  blockedLogged.set(key, now + wait);
  return true;
}

function cleanup() {
  db.prepare('DELETE FROM login_attempts WHERE created_at < ?').run(Date.now() - 86400 * 1000);
  const now = Date.now();
  for (const [key, until] of blockedLogged) if (until <= now) blockedLogged.delete(key);
}

module.exports = { reserveAttempt, attemptSucceeded, shouldLogBlock, cleanup };
