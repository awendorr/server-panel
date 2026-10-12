#!/usr/bin/env node
// Kullanım: npm run rename-user -- <eski_ad> <yeni_ad>
const [oldName, newName] = process.argv.slice(2);
if (!oldName || !newName) {
  console.error('Kullanım: npm run rename-user -- <eski_ad> <yeni_ad>');
  process.exit(1);
}
if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(newName)) {
  console.error('Kullanıcı adı 3-32 karakter olmalı (harf, rakam, _ . -).');
  process.exit(1);
}
const db = require('../db');
const user = db.prepare('SELECT id FROM users WHERE username = ?').get(oldName);
if (!user) {
  console.error(`"${oldName}" adında kullanıcı yok.`);
  process.exit(1);
}
if (db.prepare('SELECT id FROM users WHERE username = ?').get(newName)) {
  console.error(`"${newName}" adı zaten kullanılıyor.`);
  process.exit(1);
}
db.transaction(() => {
  db.prepare('UPDATE users SET username = ? WHERE id = ?').run(newName, user.id);
  // Açık oturumlar eski adı taşıdığı için kapatılır; yeni adla tekrar giriş yapılır
  db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(user.id);
})();
console.log(`"${oldName}" → "${newName}" olarak değiştirildi. Panelde yeniden giriş yapın.`);
