// Her eleman bir şema sürümü. Yeni değişiklikler listenin sonuna eklenir.
const migrations = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    last_login_at INTEGER
  );

  CREATE TABLE sessions (
    sid     TEXT PRIMARY KEY,
    sess    TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_expires ON sessions(expires);

  CREATE TABLE login_attempts (
    id         INTEGER PRIMARY KEY,
    ip         TEXT NOT NULL,
    username   TEXT,
    success    INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_login_attempts_ip_time ON login_attempts(ip, created_at);
  CREATE INDEX idx_login_attempts_user_time ON login_attempts(username, created_at);

  CREATE TABLE metrics_raw (
    ts             INTEGER PRIMARY KEY,
    cpu_total      REAL,
    cpu_cores      TEXT,
    cpu_temp       REAL,
    load_1         REAL,
    load_5         REAL,
    load_15        REAL,
    mem_used       INTEGER,
    mem_total      INTEGER,
    swap_used      INTEGER,
    swap_total     INTEGER,
    disk_read_bps  INTEGER,
    disk_write_bps INTEGER,
    net_rx_bps     INTEGER,
    net_tx_bps     INTEGER,
    uptime         INTEGER
  );

  CREATE TABLE metrics_minute (
    ts                 INTEGER PRIMARY KEY,
    cpu_avg            REAL,
    cpu_max            REAL,
    cpu_temp_avg       REAL,
    load_1_avg         REAL,
    mem_used_avg       INTEGER,
    mem_total          INTEGER,
    swap_used_avg      INTEGER,
    swap_total         INTEGER,
    disk_read_bps_avg  INTEGER,
    disk_write_bps_avg INTEGER,
    net_rx_bps_avg     INTEGER,
    net_tx_bps_avg     INTEGER
  );

  CREATE TABLE disk_usage (
    ts    INTEGER NOT NULL,
    mount TEXT NOT NULL,
    fs    TEXT,
    used  INTEGER NOT NULL,
    size  INTEGER NOT NULL,
    PRIMARY KEY (ts, mount)
  );

  CREATE TABLE alert_rules (
    id           INTEGER PRIMARY KEY,
    metric       TEXT NOT NULL CHECK (metric IN ('cpu','ram','swap','disk')),
    target       TEXT,
    threshold    REAL NOT NULL,
    duration_sec INTEGER NOT NULL DEFAULT 60,
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE alert_events (
    id           INTEGER PRIMARY KEY,
    rule_id      INTEGER REFERENCES alert_rules(id) ON DELETE SET NULL,
    metric       TEXT NOT NULL,
    target       TEXT,
    value        REAL NOT NULL,
    threshold    REAL NOT NULL,
    started_at   INTEGER NOT NULL,
    resolved_at  INTEGER,
    acknowledged INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_alert_events_started ON alert_events(started_at);

  CREATE TABLE audit_log (
    id       INTEGER PRIMARY KEY,
    ts       INTEGER NOT NULL,
    user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    username TEXT,
    ip       TEXT,
    action   TEXT NOT NULL,
    target   TEXT,
    details  TEXT,
    success  INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX idx_audit_ts ON audit_log(ts);
  CREATE INDEX idx_audit_action ON audit_log(action);
  `,
  // 2: varsayılan uyarı kuralları
  `
  INSERT INTO alert_rules (metric, target, threshold, duration_sec, enabled, created_at) VALUES
    ('cpu',  NULL, 90, 120, 1, CAST(strftime('%s','now') AS INTEGER) * 1000),
    ('ram',  NULL, 90, 120, 1, CAST(strftime('%s','now') AS INTEGER) * 1000),
    ('disk', NULL, 90,  60, 1, CAST(strftime('%s','now') AS INTEGER) * 1000);
  `,
];

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get();
  let current = row ? row.version : 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();

  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]);
      db.prepare('UPDATE schema_version SET version = ?').run(v + 1);
    })();
    current = v + 1;
  }
  return current;
}

module.exports = { migrate };
