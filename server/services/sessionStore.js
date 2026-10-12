const session = require('express-session');
const db = require('../db');

// express-session için SQLite deposu
class SqliteStore extends session.Store {
  constructor({ ttlMs }) {
    super();
    this.ttlMs = ttlMs;
    this.stmts = {
      get: db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?'),
      set: db.prepare(`INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
                       ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`),
      destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
      cleanup: db.prepare('DELETE FROM sessions WHERE expires <= ?'),
    };
  }

  expiry(sess) {
    const e = sess && sess.cookie && sess.cookie.expires;
    return e ? new Date(e).getTime() : Date.now() + this.ttlMs;
  }

  get(sid, cb) {
    try {
      const row = this.stmts.get.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (err) { cb(err); }
  }

  set(sid, sess, cb) {
    try {
      this.stmts.set.run(sid, JSON.stringify(sess), this.expiry(sess));
      cb && cb(null);
    } catch (err) { cb && cb(err); }
  }

  destroy(sid, cb) {
    try {
      this.stmts.destroy.run(sid);
      cb && cb(null);
    } catch (err) { cb && cb(err); }
  }

  touch(sid, sess, cb) {
    try {
      this.stmts.touch.run(this.expiry(sess), sid);
      cb && cb(null);
    } catch (err) { cb && cb(err); }
  }

  cleanup() {
    this.stmts.cleanup.run(Date.now());
  }
}

module.exports = SqliteStore;
