const fs = require('fs');
const os = require('os');
const path = require('path');
const pm2 = require('pm2');
const { EventEmitter } = require('events');

const PM2_HOME = process.env.PM2_HOME || path.join(os.homedir(), '.pm2');
const DUMP_FILE = path.join(PM2_HOME, 'dump.pm2');
const ACTIONS = ['start', 'stop', 'restart', 'delete'];
const TAIL_BYTES = 64 * 1024;

const emitter = new EventEmitter();
let connectPromise = null;
let busStarted = false;

function call(fn, ...args) {
  return new Promise((resolve, reject) => {
    pm2[fn](...args, (err, res) => (err ? reject(err) : resolve(res)));
  });
}

// pm2 daemon'una bağlan (çalışmıyorsa başlatır). Bağlantı kopunca tekrar dener.
function connect() {
  if (!connectPromise) {
    connectPromise = call('connect').catch((err) => {
      connectPromise = null;
      throw err;
    });
  }
  return connectPromise;
}

// `pm2 save` ile kaydedilmiş, açılışta otomatik başlayacak süreç adları
function savedNames() {
  try {
    const dump = JSON.parse(fs.readFileSync(DUMP_FILE, 'utf8'));
    return new Set(dump.map((p) => p.name));
  } catch (_) {
    return new Set();
  }
}

async function list() {
  await connect();
  const procs = await call('list');
  const saved = savedNames();
  return procs.map((p) => {
    const env = p.pm2_env || {};
    return {
      id: p.pm_id,
      name: p.name,
      pid: p.pid,
      status: env.status,
      cpu: p.monit ? p.monit.cpu : null,
      memory: p.monit ? p.monit.memory : null,
      restarts: env.restart_time || 0,
      unstableRestarts: env.unstable_restarts || 0,
      uptime: env.status === 'online' && env.pm_uptime ? Date.now() - env.pm_uptime : null,
      mode: env.exec_mode === 'cluster_mode' ? 'cluster' : 'fork',
      script: env.pm_exec_path,
      cwd: env.pm_cwd,
      version: env.version || null,
      user: env.username || null,
      saved: saved.has(p.name),
      isPanel: String(p.pm_id) === String(process.env.pm_id),
    };
  });
}

async function describe(id) {
  await connect();
  const res = await call('describe', id);
  if (!res || !res.length) {
    const err = new Error('Süreç bulunamadı');
    err.status = 404;
    err.expose = true;
    throw err;
  }
  return res[0];
}

async function action(id, act) {
  if (!ACTIONS.includes(act)) throw Object.assign(new Error('Geçersiz işlem'), { status: 400, expose: true });
  await describe(id); // önce var olduğunu doğrula
  // Durmuş bir süreci başlatmak için pm2 restart kullanılır
  const fn = act === 'start' ? 'restart' : act;
  await call(fn, id);
}

// Log dosyasının son kısmını oku (sekme açıldığında geçmişi göstermek için)
function tailFile(file, bytes = TAIL_BYTES) {
  return new Promise((resolve) => {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return resolve('');
      const start = Math.max(0, st.size - bytes);
      const chunks = [];
      fs.createReadStream(file, { start, end: st.size })
        .on('data', (c) => chunks.push(c))
        .on('end', () => {
          let text = Buffer.concat(chunks).toString('utf8');
          if (start > 0) text = text.slice(text.indexOf('\n') + 1); // yarım satırı at
          resolve(text);
        })
        .on('error', () => resolve(''));
    });
  });
}

async function recentLogs(id) {
  const p = await describe(id);
  const env = p.pm2_env || {};
  const [out, err] = await Promise.all([tailFile(env.pm_out_log_path), tailFile(env.pm_err_log_path)]);
  return { out, err };
}

// pm2 olay yolunu dinle: canlı loglar
async function startBus() {
  if (busStarted) return;
  busStarted = true;
  try {
    await connect();
    const bus = await call('launchBus');
    const forward = (type) => (packet) => {
      if (!packet || !packet.process) return;
      emitter.emit('log', { id: packet.process.pm_id, name: packet.process.name, type, data: packet.data, at: packet.at || Date.now() });
    };
    bus.on('log:out', forward('out'));
    bus.on('log:err', forward('err'));
    bus.on('process:event', (e) => emitter.emit('event', { id: e.process && e.process.pm_id, event: e.event }));
  } catch (err) {
    busStarted = false;
    console.error('[pm2] olay yolu başlatılamadı:', err.message);
  }
}

function disconnect() {
  try { pm2.disconnect(); } catch (_) { /* yok say */ }
}

module.exports = { list, action, recentLogs, startBus, disconnect, on: emitter.on.bind(emitter), ACTIONS };
