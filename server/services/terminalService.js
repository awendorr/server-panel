const os = require('os');
const pty = require('node-pty');
const crypto = require('crypto');

const MAX_PER_SOCKET = 8;
const MAX_TOTAL = 32;
const sessions = new Map(); // id -> { pty, socketId, startedAt }

function defaultShell() {
  return process.env.SHELL || '/bin/bash';
}

// Kabuğa yalnızca normal bir girişte de olan değişkenler geçer. Panelin ve pm2'nin kendi
// değişkenleri (SESSION_SECRET, PORT, NODE_ENV, pm_id ...) terminalden başlatılan uygulamalara
// sızmasın. `-l` ile açılan kabuk gerisini /etc/profile ve ~/.profile'dan yükler.
const PASS_ENV = new Set([
  'HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH', 'LANG', 'LANGUAGE', 'TZ', 'TMPDIR', 'MAIL',
  'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'PM2_HOME',
  'http_proxy', 'https_proxy', 'no_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
]);

function shellEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (PASS_ENV.has(k) || k.startsWith('LC_')) env[k] = v;
  }
  const me = os.userInfo();
  env.HOME = env.HOME || me.homedir;
  env.USER = env.USER || me.username;
  env.LOGNAME = env.LOGNAME || me.username;
  env.PATH = env.PATH || '/usr/local/bin:/usr/bin:/bin';
  return env;
}

function clampSize(cols, rows) {
  const c = Number.isInteger(cols) ? Math.min(Math.max(cols, 20), 500) : 80;
  const r = Number.isInteger(rows) ? Math.min(Math.max(rows, 5), 200) : 24;
  return [c, r];
}

function countFor(socketId) {
  let n = 0;
  for (const s of sessions.values()) if (s.socketId === socketId) n++;
  return n;
}

function open(socketId, { cols, rows }, onData, onExit) {
  if (countFor(socketId) >= MAX_PER_SOCKET) throw new Error(`En fazla ${MAX_PER_SOCKET} terminal sekmesi açılabilir`);
  if (sessions.size >= MAX_TOTAL) throw new Error('Sunucudaki terminal sınırına ulaşıldı');
  const [c, r] = clampSize(cols, rows);
  const id = crypto.randomBytes(8).toString('hex');
  const shell = defaultShell();

  const env = { ...shellEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor' };

  const proc = pty.spawn(shell, ['-l'], {
    name: 'xterm-256color',
    cols: c,
    rows: r,
    cwd: os.homedir(),
    env,
  });
  sessions.set(id, { pty: proc, socketId, startedAt: Date.now(), shell });
  proc.onData((data) => onData(id, data));
  proc.onExit(({ exitCode }) => {
    sessions.delete(id);
    onExit(id, exitCode);
  });
  return { id, shell, pid: proc.pid };
}

function get(id, socketId) {
  const s = sessions.get(id);
  return s && s.socketId === socketId ? s : null;
}

function write(id, socketId, data) {
  const s = get(id, socketId);
  if (s && typeof data === 'string') s.pty.write(data);
}

function resize(id, socketId, cols, rows) {
  const s = get(id, socketId);
  if (!s) return;
  const [c, r] = clampSize(cols, rows);
  try { s.pty.resize(c, r); } catch (_) { /* süreç bitmiş olabilir */ }
}

function close(id, socketId) {
  const s = get(id, socketId);
  if (!s) return false;
  sessions.delete(id);
  try { s.pty.kill(); } catch (_) { /* yok say */ }
  return true;
}

function closeAllFor(socketId) {
  const closed = [];
  for (const [id, s] of sessions) {
    if (s.socketId === socketId) {
      close(id, socketId);
      closed.push({ id, startedAt: s.startedAt });
    }
  }
  return closed;
}

module.exports = { open, write, resize, close, closeAllFor };
