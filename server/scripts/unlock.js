#!/usr/bin/env node
// Kullanım: npm run unlock
// Hatalı giriş denemelerinden doğan bekleme süresini sıfırlar (sunucuda, SSH ile bağlanıp çalıştırın).
const db = require('../db');

const r = db.prepare('DELETE FROM login_attempts').run();
console.log(`Giriş denemesi kayıtları temizlendi (${r.changes}). Çalışan panelde hemen geçerli.`);
