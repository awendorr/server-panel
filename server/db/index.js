const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');
const { migrate } = require('./migrations');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true, mode: 0o700 });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

try {
  fs.chmodSync(config.dbPath, 0o600);
} catch (_) { /* yok say */ }

migrate(db);

module.exports = db;
