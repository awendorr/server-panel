const db = require('../db');

const RAW_BUCKET_MS = 10 * 1000;
const MINUTE_MS = 60 * 1000;
const RAW_RETENTION_MS = 24 * 3600 * 1000;
const MINUTE_RETENTION_MS = 7 * 86400 * 1000;

// Grafik aralıkları: hangi tablodan, hangi gruplama ile
const RANGES = {
  '1h': { span: 3600 * 1000, table: 'raw', bucket: RAW_BUCKET_MS },
  '24h': { span: 24 * 3600 * 1000, table: 'raw', bucket: MINUTE_MS },
  '7d': { span: 7 * 86400 * 1000, table: 'minute', bucket: 5 * MINUTE_MS },
};

const insertRaw = db.prepare(`
  INSERT OR REPLACE INTO metrics_raw
  (ts, cpu_total, cpu_cores, cpu_temp, load_1, load_5, load_15, mem_used, mem_total,
   swap_used, swap_total, disk_read_bps, disk_write_bps, net_rx_bps, net_tx_bps, uptime)
  VALUES (@ts, @cpu_total, @cpu_cores, @cpu_temp, @load_1, @load_5, @load_15, @mem_used, @mem_total,
   @swap_used, @swap_total, @disk_read_bps, @disk_write_bps, @net_rx_bps, @net_tx_bps, @uptime)
`);
const insertMinute = db.prepare(`
  INSERT OR REPLACE INTO metrics_minute
  (ts, cpu_avg, cpu_max, cpu_temp_avg, load_1_avg, mem_used_avg, mem_total, swap_used_avg, swap_total,
   disk_read_bps_avg, disk_write_bps_avg, net_rx_bps_avg, net_tx_bps_avg)
  VALUES (@ts, @cpu_avg, @cpu_max, @cpu_temp_avg, @load_1_avg, @mem_used_avg, @mem_total, @swap_used_avg,
   @swap_total, @disk_read_bps_avg, @disk_write_bps_avg, @net_rx_bps_avg, @net_tx_bps_avg)
`);
const insertDisk = db.prepare(
  'INSERT OR REPLACE INTO disk_usage (ts, mount, fs, used, size) VALUES (?, ?, ?, ?, ?)'
);

// Basit ortalama biriktirici: null değerleri atlar
class Acc {
  constructor(key) { this.key = key; this.sums = {}; this.counts = {}; this.max = {}; this.last = null; }
  add(name, v) {
    if (v === null || v === undefined || !Number.isFinite(v)) return;
    this.sums[name] = (this.sums[name] || 0) + v;
    this.counts[name] = (this.counts[name] || 0) + 1;
    this.max[name] = Math.max(this.max[name] ?? -Infinity, v);
  }
  avg(name, round = false) {
    if (!this.counts[name]) return null;
    const v = this.sums[name] / this.counts[name];
    return round ? Math.round(v) : v;
  }
  peak(name) { return this.counts[name] ? this.max[name] : null; }
}

let rawAcc = null;
let minAcc = null;

function addSample(acc, s) {
  acc.add('cpu', s.cpu.total);
  acc.add('temp', s.cpu.temp);
  acc.add('load1', s.load[0]);
  acc.add('load5', s.load[1]);
  acc.add('load15', s.load[2]);
  if (s.mem) {
    acc.add('memUsed', s.mem.used);
    acc.add('swapUsed', s.mem.swapUsed);
  }
  acc.add('read', s.diskIO.readBps);
  acc.add('write', s.diskIO.writeBps);
  acc.add('rx', s.net.rxBps);
  acc.add('tx', s.net.txBps);
  s.cpu.cores.forEach((c, i) => acc.add(`core${i}`, c));
  acc.last = s;
}

function flushRaw(acc) {
  const s = acc.last;
  const cores = s.cpu.cores.map((_, i) => {
    const v = acc.avg(`core${i}`);
    return v === null ? null : Math.round(v * 10) / 10;
  });
  insertRaw.run({
    ts: acc.key,
    cpu_total: acc.avg('cpu'),
    cpu_cores: JSON.stringify(cores),
    cpu_temp: acc.avg('temp'),
    load_1: acc.avg('load1'),
    load_5: acc.avg('load5'),
    load_15: acc.avg('load15'),
    mem_used: acc.avg('memUsed', true),
    mem_total: s.mem ? s.mem.total : null,
    swap_used: acc.avg('swapUsed', true),
    swap_total: s.mem ? s.mem.swapTotal : null,
    disk_read_bps: acc.avg('read', true),
    disk_write_bps: acc.avg('write', true),
    net_rx_bps: acc.avg('rx', true),
    net_tx_bps: acc.avg('tx', true),
    uptime: Math.round(s.uptime),
  });
}

function flushMinute(acc) {
  const s = acc.last;
  db.transaction(() => {
    insertMinute.run({
      ts: acc.key,
      cpu_avg: acc.avg('cpu'),
      cpu_max: acc.peak('cpu'),
      cpu_temp_avg: acc.avg('temp'),
      load_1_avg: acc.avg('load1'),
      mem_used_avg: acc.avg('memUsed', true),
      mem_total: s.mem ? s.mem.total : null,
      swap_used_avg: acc.avg('swapUsed', true),
      swap_total: s.mem ? s.mem.swapTotal : null,
      disk_read_bps_avg: acc.avg('read', true),
      disk_write_bps_avg: acc.avg('write', true),
      net_rx_bps_avg: acc.avg('rx', true),
      net_tx_bps_avg: acc.avg('tx', true),
    });
    for (const d of s.disks) insertDisk.run(acc.key, d.mount, d.fs, d.used, d.size);
  })();
}

function record(sample) {
  const rawKey = Math.floor(sample.ts / RAW_BUCKET_MS) * RAW_BUCKET_MS;
  const minKey = Math.floor(sample.ts / MINUTE_MS) * MINUTE_MS;
  try {
    if (rawAcc && rawAcc.key !== rawKey) flushRaw(rawAcc);
    if (minAcc && minAcc.key !== minKey) flushMinute(minAcc);
  } catch (err) {
    console.error('[metrics] kaydedilemedi:', err.message);
  }
  if (!rawAcc || rawAcc.key !== rawKey) rawAcc = new Acc(rawKey);
  if (!minAcc || minAcc.key !== minKey) minAcc = new Acc(minKey);
  addSample(rawAcc, sample);
  addSample(minAcc, sample);
}

function history(range) {
  const r = RANGES[range];
  const from = Date.now() - r.span;
  const b = r.bucket;
  let rows;
  if (r.table === 'raw') {
    rows = db.prepare(`
      SELECT (ts / ${b}) * ${b} AS ts,
        AVG(cpu_total) AS cpu, AVG(cpu_temp) AS temp,
        AVG(load_1) AS load1, AVG(load_5) AS load5, AVG(load_15) AS load15,
        AVG(mem_used * 100.0 / NULLIF(mem_total, 0)) AS mem,
        AVG(swap_used * 100.0 / NULLIF(swap_total, 0)) AS swap,
        AVG(disk_read_bps) AS read, AVG(disk_write_bps) AS write,
        AVG(net_rx_bps) AS rx, AVG(net_tx_bps) AS tx
      FROM metrics_raw WHERE ts >= ? GROUP BY ts / ${b} ORDER BY ts
    `).all(from);
  } else {
    rows = db.prepare(`
      SELECT (ts / ${b}) * ${b} AS ts,
        AVG(cpu_avg) AS cpu, AVG(cpu_temp_avg) AS temp,
        AVG(load_1_avg) AS load1, NULL AS load5, NULL AS load15,
        AVG(mem_used_avg * 100.0 / NULLIF(mem_total, 0)) AS mem,
        AVG(swap_used_avg * 100.0 / NULLIF(swap_total, 0)) AS swap,
        AVG(disk_read_bps_avg) AS read, AVG(disk_write_bps_avg) AS write,
        AVG(net_rx_bps_avg) AS rx, AVG(net_tx_bps_avg) AS tx
      FROM metrics_minute WHERE ts >= ? GROUP BY ts / ${b} ORDER BY ts
    `).all(from);
  }
  return { range, bucketMs: b, points: rows };
}

function cleanup() {
  const now = Date.now();
  db.prepare('DELETE FROM metrics_raw WHERE ts < ?').run(now - RAW_RETENTION_MS);
  db.prepare('DELETE FROM metrics_minute WHERE ts < ?').run(now - MINUTE_RETENTION_MS);
  db.prepare('DELETE FROM disk_usage WHERE ts < ?').run(now - MINUTE_RETENTION_MS);
}

// Kapanışta yarım kalan kovaları yaz
function flushAll() {
  try {
    if (rawAcc) flushRaw(rawAcc);
    if (minAcc) flushMinute(minAcc);
  } catch (_) { /* yok say */ }
}

module.exports = { RANGES, record, history, cleanup, flushAll };
