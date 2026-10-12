const db = require('../db');
const config = require('../config');

const insert = db.prepare(`
  INSERT INTO audit_log (ts, user_id, username, ip, action, target, details, success)
  VALUES (@ts, @user_id, @username, @ip, @action, @target, @details, @success)
`);

// ctx: Express req veya Socket.IO socket (ikisi de session ve ip taşır)
function contextInfo(ctx) {
  if (!ctx) return { user_id: null, username: null, ip: null };
  const req = ctx.request || ctx; // socket.request ya da req
  const sess = req.session || {};
  let ip = req.ip;
  if (ctx.handshake) {
    // Express'in 'trust proxy 1' ayarıyla aynı: en sağdaki adresi Nginx ekler, soldakiler istemcinin yazdığıdır
    const fwd = config.trustProxy && ctx.handshake.headers['x-forwarded-for'];
    ip = fwd ? String(fwd).split(',').pop().trim() : ctx.handshake.address;
  }
  return { user_id: sess.userId || null, username: sess.username || null, ip: ip || null };
}

function log(ctx, action, { target = null, details = null, success = true, username } = {}) {
  const info = contextInfo(ctx);
  try {
    insert.run({
      ts: Date.now(),
      user_id: info.user_id,
      username: username || info.username,
      ip: info.ip,
      action,
      target: target == null ? null : String(target),
      details: details == null ? null : JSON.stringify(details),
      success: success ? 1 : 0,
    });
  } catch (err) {
    console.error('[audit] yazılamadı:', err.message);
  }
}

function list({ limit = 100, before, action } = {}) {
  const where = [];
  const params = {};
  if (before) { where.push('ts < @before'); params.before = before; }
  if (action) { where.push('action LIKE @action'); params.action = `${action}%`; }
  params.limit = Math.min(Math.max(limit, 1), 500);
  const sql = `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY ts DESC LIMIT @limit`;
  return db.prepare(sql).all(params);
}

function cleanup() {
  const cutoff = Date.now() - config.auditRetentionDays * 86400 * 1000;
  db.prepare('DELETE FROM audit_log WHERE ts < ?').run(cutoff);
  // Satır sınırı: kayıt seli diski dolduramasın
  db.prepare(`DELETE FROM audit_log WHERE id <= (
    SELECT id FROM audit_log ORDER BY id DESC LIMIT 1 OFFSET ?
  )`).run(config.auditMaxRows);
}

module.exports = { log, list, cleanup };
