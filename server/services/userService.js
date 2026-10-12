const bcrypt = require('bcrypt');
const db = require('../db');

const BCRYPT_COST = 12;
// Kullanıcı bulunamadığında da bcrypt çalışsın diye (zamanlama farkı olmasın)
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

function count() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function findByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

async function create(username, password) {
  if (!USERNAME_RE.test(username)) throw new Error('Kullanıcı adı 3-32 karakter olmalı (harf, rakam, _ . -).');
  if (!password || password.length < 10) throw new Error('Şifre en az 10 karakter olmalı.');
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  const existing = findByUsername(username);
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, existing.id);
    return { id: existing.id, updated: true };
  }
  const r = db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, hash, Date.now());
  return { id: r.lastInsertRowid, updated: false };
}

async function verify(username, password) {
  const user = typeof username === 'string' ? findByUsername(username) : null;
  const ok = await bcrypt.compare(String(password || ''), user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) return null;
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), user.id);
  return { id: user.id, username: user.username };
}

module.exports = { count, create, verify, findByUsername };
