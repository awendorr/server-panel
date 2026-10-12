const fs = require('fs/promises');
const { execFile } = require('child_process');
const si = require('systeminformation');

const MAX_PROCESSES = 500;

async function processes(sort = 'cpu') {
  const data = await si.processes();
  const list = data.list
    .filter((p) => p.pid > 0)
    .map((p) => ({
      pid: p.pid,
      ppid: p.parentPid,
      name: p.name,
      user: p.user,
      state: p.state,
      cpu: Math.round((p.cpu || 0) * 10) / 10,
      mem: Math.round((p.mem || 0) * 10) / 10,
      rss: (p.memRss || 0) * 1024,
      started: p.started,
      command: [p.command, p.params].filter(Boolean).join(' ').slice(0, 500),
    }));
  const key = sort === 'mem' ? 'mem' : 'cpu';
  list.sort((a, b) => b[key] - a[key] || b.rss - a.rss);
  return {
    total: data.all, running: data.running, sleeping: data.sleeping, blocked: data.blocked,
    list: list.slice(0, MAX_PROCESSES),
  };
}

function run(cmd, args, timeout = 8000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LANG: 'C', SYSTEMD_COLORS: '0' } },
      (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout)));
  });
}

async function services() {
  let units;
  try {
    units = await run('systemctl', ['list-units', '--type=service', '--all', '--no-legend', '--plain', '--no-pager']);
  } catch (err) {
    return { available: false, error: err.message.split('\n')[0], list: [] };
  }
  const enabled = new Map();
  try {
    const files = await run('systemctl', ['list-unit-files', '--type=service', '--no-legend', '--no-pager']);
    for (const line of files.split('\n')) {
      const [unit, state] = line.trim().split(/\s+/);
      if (unit) enabled.set(unit, state);
    }
  } catch (_) { /* isteğe bağlı bilgi */ }

  const list = units.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.replace(/^●\s*/, '').split(/\s+/);
    const [unit, load, active, sub, ...desc] = parts;
    return { unit, load, active, sub, description: desc.join(' '), enabled: enabled.get(unit) || null };
  }).filter((s) => s.unit && s.unit.endsWith('.service'));
  return { available: true, list };
}

// ---- Açık portlar: /proc/net üzerinden (ss/netstat gerektirmez) ----
function parseAddr(hex, v6) {
  const [ipHex, portHex] = hex.split(':');
  const port = parseInt(portHex, 16);
  let ip;
  if (!v6) {
    ip = ipHex.match(/../g).reverse().map((b) => parseInt(b, 16)).join('.');
  } else {
    // 4 baytlık gruplar little-endian; sonra en uzun sıfır dizisini :: ile kısalt
    const bytes = ipHex.match(/.{8}/g).map((w) => w.match(/../g).reverse().join('')).join('');
    const groups = bytes.match(/.{4}/g).map((g) => parseInt(g, 16).toString(16));
    if (groups.slice(0, 5).every((g) => g === '0') && groups[5] === 'ffff') {
      ip = '::ffff:' + [groups[6], groups[7]].map((g) => parseInt(g, 16)).map((n) => `${n >> 8}.${n & 255}`).join('.');
    } else {
      let best = [-1, 0];
      for (let i = 0; i < 8; i++) {
        let j = i;
        while (j < 8 && groups[j] === '0') j++;
        if (j - i > best[1]) best = [i, j - i];
        i = j;
      }
      ip = best[1] > 1
        ? `${groups.slice(0, best[0]).join(':')}::${groups.slice(best[0] + best[1]).join(':')}`
        : groups.join(':');
    }
  }
  return { ip, port };
}

async function readNet(file, proto, v6) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch (_) { return []; }
  return text.split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length > 9).map((c) => {
    const local = parseAddr(c[1], v6);
    return { proto, state: c[3], ip: local.ip, port: local.port, uid: Number(c[7]), inode: c[9] };
  }).filter((s) => (proto.startsWith('tcp') ? s.state === '0A' : s.state === '07') && s.inode !== '0');
}

async function socketOwners() {
  const owners = new Map();
  let pids;
  try { pids = (await fs.readdir('/proc')).filter((d) => /^\d+$/.test(d)); } catch (_) { return owners; }
  await Promise.all(pids.map(async (pid) => {
    let fds;
    try { fds = await fs.readdir(`/proc/${pid}/fd`); } catch (_) { return; } // başka kullanıcının süreci
    let name = null;
    for (const fd of fds) {
      const link = await fs.readlink(`/proc/${pid}/fd/${fd}`).catch(() => '');
      const m = link.match(/^socket:\[(\d+)\]$/);
      if (m && !owners.has(m[1])) {
        if (name === null) name = (await fs.readFile(`/proc/${pid}/comm`, 'utf8').catch(() => '?')).trim();
        owners.set(m[1], { pid: Number(pid), name });
      }
    }
  }));
  return owners;
}

async function userNames() {
  const map = new Map();
  try {
    const text = await fs.readFile('/etc/passwd', 'utf8');
    for (const line of text.split('\n')) {
      const p = line.split(':');
      if (p.length > 2) map.set(Number(p[2]), p[0]);
    }
  } catch (_) { /* yok say */ }
  return map;
}

async function ports() {
  const [sockets, owners, users] = await Promise.all([
    Promise.all([
      readNet('/proc/net/tcp', 'tcp', false), readNet('/proc/net/tcp6', 'tcp6', true),
      readNet('/proc/net/udp', 'udp', false), readNet('/proc/net/udp6', 'udp6', true),
    ]).then((a) => a.flat()),
    socketOwners(),
    userNames(),
  ]);
  const seen = new Set();
  const list = [];
  for (const s of sockets) {
    const key = `${s.proto}:${s.ip}:${s.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const o = owners.get(s.inode);
    list.push({
      proto: s.proto, address: s.ip, port: s.port,
      pid: o ? o.pid : null, process: o ? o.name : null,
      user: users.get(s.uid) || String(s.uid),
      public: !(s.ip === '::1' || s.ip.startsWith('127.') || s.ip.startsWith('::ffff:127.')),
    });
  }
  list.sort((a, b) => a.port - b.port || a.proto.localeCompare(b.proto));
  return { list, partial: process.getuid && process.getuid() !== 0 };
}

module.exports = { processes, services, ports, parseAddr };

