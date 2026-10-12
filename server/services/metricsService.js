const os = require('os');
const { EventEmitter } = require('events');
const si = require('systeminformation');
const config = require('../config');

// Kullanıcıya gösterilmeyecek sanal/geçici dosya sistemleri
const IGNORED_FS = new Set(['tmpfs', 'devtmpfs', 'overlay', 'squashfs', 'ramfs', 'proc', 'sysfs', 'cgroup', 'cgroup2', 'nsfs', 'autofs']);
const DISK_REFRESH_MS = 10000;

const emitter = new EventEmitter();
let latest = null;
let timer = null;
let diskCache = { at: 0, data: [] };
let running = false;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

async function readDisks() {
  if (Date.now() - diskCache.at < DISK_REFRESH_MS) return diskCache.data;
  const list = await si.fsSize().catch(() => []);
  const seen = new Set();
  const data = list
    .filter((d) => d.size > 0 && !IGNORED_FS.has(d.type) && !String(d.type).startsWith('fuse.'))
    .filter((d) => (seen.has(d.mount) ? false : seen.add(d.mount)))
    .map((d) => ({ fs: d.fs, type: d.type, mount: d.mount, size: d.size, used: d.used, use: num(d.use) }));
  diskCache = { at: Date.now(), data };
  return data;
}

async function sample() {
  const [load, temp, mem, disks, fsStats, net] = await Promise.all([
    si.currentLoad().catch(() => null),
    si.cpuTemperature().catch(() => null),
    si.mem().catch(() => null),
    readDisks(),
    si.fsStats().catch(() => null),
    si.networkStats('*').catch(() => []),
  ]);

  const ifaces = (net || []).filter((n) => n.iface !== 'lo');
  const sum = (key) => {
    const vals = ifaces.map((n) => num(n[key])).filter((v) => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const [l1, l5, l15] = os.loadavg();

  return {
    ts: Date.now(),
    cpu: {
      total: load ? num(load.currentLoad) : null,
      cores: load ? load.cpus.map((c) => num(c.load)) : [],
      temp: temp ? num(temp.main) : null,
    },
    load: [l1, l5, l15],
    mem: mem ? {
      total: mem.total,
      used: mem.active, // önbellek/buffer hariç gerçek kullanım
      available: mem.available,
      swapTotal: mem.swaptotal,
      swapUsed: mem.swapused,
    } : null,
    disks,
    diskIO: {
      readBps: fsStats ? num(fsStats.rx_sec) : null,
      writeBps: fsStats ? num(fsStats.wx_sec) : null,
    },
    net: {
      rxBps: sum('rx_sec'),
      txBps: sum('tx_sec'),
      ifaces: ifaces.map((n) => ({ iface: n.iface, rxBps: num(n.rx_sec), txBps: num(n.tx_sec) })),
    },
    uptime: os.uptime(),
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    cpuCount: os.cpus().length,
  };
}

async function tick() {
  if (running) return; // önceki ölçüm bitmeden yenisini başlatma
  running = true;
  try {
    latest = await sample();
    emitter.emit('sample', latest);
  } catch (err) {
    console.error('[metrics] ölçüm hatası:', err.message);
  } finally {
    running = false;
  }
}

async function start() {
  // fsStats ve networkStats ilk çağrıda hız hesaplayamaz; ısındır
  await Promise.all([si.fsStats().catch(() => null), si.networkStats('*').catch(() => null), si.currentLoad().catch(() => null)]);
  await tick();
  timer = setInterval(tick, config.metricsIntervalMs);
}

function stop() {
  if (timer) clearInterval(timer);
}

module.exports = { start, stop, on: emitter.on.bind(emitter), getLatest: () => latest };
