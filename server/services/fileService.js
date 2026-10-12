const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

const MAX_EDIT_BYTES = 5 * 1024 * 1024;
const MAX_ENTRIES = 5000;

function httpError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}

let realRoot = null;
function root() {
  if (!realRoot) realRoot = fs.realpathSync(config.fileRoot);
  return realRoot;
}

function isInside(base, p) {
  if (base === path.sep) return path.isAbsolute(p);
  return p === base || p.startsWith(base + path.sep);
}

/**
 * Kullanıcının verdiği yolu güvenli bir mutlak yola çevirir.
 * - Kök (FILE_ROOT) dışına çıkan yollar (../, mutlak yol, symlink) reddedilir.
 * - mustExist=false ise yol henüz yoksa üst klasörü doğrulanır (yeni dosya/klasör için).
 */
async function resolveSafe(input, { mustExist = true } = {}) {
  if (typeof input !== 'string' || !input.length || input.length > 4096 || input.includes('\0')) {
    throw httpError(400, 'Geçersiz yol');
  }
  const base = root();
  const abs = path.resolve(base, input);
  if (!isInside(base, abs)) throw httpError(403, 'Bu yola erişim izni yok');

  try {
    const real = await fsp.realpath(abs);
    if (!isInside(base, real)) throw httpError(403, 'Bağlantı (symlink) izin verilen kök dışına çıkıyor');
    return { abs, real, exists: true };
  } catch (err) {
    if (err.status) throw err;
    if (err.code !== 'ENOENT') throw httpError(400, `Yol okunamadı: ${err.code}`);
    if (mustExist) throw httpError(404, 'Dosya ya da klasör bulunamadı');
    const parentReal = await fsp.realpath(path.dirname(abs)).catch(() => {
      throw httpError(404, 'Üst klasör bulunamadı');
    });
    if (!isInside(base, parentReal)) throw httpError(403, 'Bu yola erişim izni yok');
    return { abs: path.join(parentReal, path.basename(abs)), real: null, exists: false };
  }
}

// Yalnızca tek bir ad (klasör ayırıcı içermeyen) kabul et
function safeName(name) {
  if (typeof name !== 'string') throw httpError(400, 'Geçersiz ad');
  const n = name.trim();
  if (!n || n === '.' || n === '..' || n.length > 255 || /[/\\\0]/.test(n)) throw httpError(400, 'Geçersiz ad');
  return n;
}

function modeString(mode) {
  const chars = ['r', 'w', 'x'];
  let s = '';
  for (let i = 8; i >= 0; i--) s += mode & (1 << i) ? chars[(8 - i) % 3] : '-';
  return s;
}

function defaultDir() {
  const home = os.homedir();
  return isInside(root(), home) ? home : root();
}

async function list(input) {
  const { real } = await resolveSafe(input || defaultDir());
  const st = await fsp.stat(real);
  if (!st.isDirectory()) throw httpError(400, 'Bu bir klasör değil');
  const dirents = await fsp.readdir(real, { withFileTypes: true });
  const entries = await Promise.all(dirents.slice(0, MAX_ENTRIES).map(async (d) => {
    const full = path.join(real, d.name);
    try {
      const l = await fsp.lstat(full);
      let type = l.isDirectory() ? 'dir' : l.isFile() ? 'file' : 'other';
      let linkTarget = null;
      if (l.isSymbolicLink()) {
        linkTarget = await fsp.readlink(full).catch(() => null);
        const t = await fsp.stat(full).catch(() => null);
        type = t ? (t.isDirectory() ? 'dir' : 'file') : 'broken';
      }
      return {
        name: d.name, type, symlink: l.isSymbolicLink(), linkTarget,
        size: l.size, mtime: l.mtimeMs, mode: modeString(l.mode), uid: l.uid,
      };
    } catch (_) {
      return { name: d.name, type: 'other', size: 0, mtime: 0, mode: '?????????' };
    }
  }));
  entries.sort((a, b) => (a.type === 'dir') !== (b.type === 'dir') ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, 'tr'));
  const parent = real === root() ? null : path.dirname(real);
  return { path: real, parent, root: root(), entries, truncated: dirents.length > MAX_ENTRIES };
}

async function read(input) {
  const { real } = await resolveSafe(input);
  const st = await fsp.stat(real);
  if (!st.isFile()) throw httpError(400, 'Bu bir dosya değil');
  const base = { path: real, size: st.size, mtime: st.mtimeMs };
  if (st.size > MAX_EDIT_BYTES) return { ...base, tooLarge: true };
  const buf = await fsp.readFile(real);
  // İlk 8 KB'ta NUL baytı varsa ikili dosya say
  if (buf.subarray(0, 8192).includes(0)) return { ...base, binary: true };
  return { ...base, content: buf.toString('utf8') };
}

// Atomik yazma: geçici dosyaya yaz, sonra yerine taşı (izinleri koru)
async function write(input, content, expectedMtime) {
  if (typeof content !== 'string') throw httpError(400, 'İçerik eksik');
  if (Buffer.byteLength(content) > MAX_EDIT_BYTES) throw httpError(413, 'Dosya düzenleme için çok büyük');
  const target = await resolveSafe(input, { mustExist: false });
  const dest = target.real || target.abs;
  let mode = 0o644;
  if (target.exists) {
    const st = await fsp.stat(dest);
    if (!st.isFile()) throw httpError(400, 'Bu bir dosya değil');
    // Açıldıktan sonra başka biri değiştirdiyse üzerine yazma
    if (expectedMtime && Math.abs(st.mtimeMs - expectedMtime) > 1) {
      throw httpError(409, 'Dosya siz düzenlerken değişti. Yeniden açıp tekrar deneyin.');
    }
    mode = st.mode & 0o7777;
  }
  const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  await fsp.writeFile(tmp, content, { mode });
  try {
    if (target.exists) {
      const st = await fsp.stat(dest);
      await fsp.chown(tmp, st.uid, st.gid).catch(() => {});
    }
    await fsp.rename(tmp, dest);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  const st = await fsp.stat(dest);
  return { path: dest, size: st.size, mtime: st.mtimeMs, created: !target.exists };
}

async function mkdir(dirInput, name) {
  const { real } = await resolveSafe(dirInput);
  const dest = path.join(real, safeName(name));
  await fsp.mkdir(dest).catch((err) => {
    if (err.code === 'EEXIST') throw httpError(409, 'Bu adda bir öğe zaten var');
    throw err;
  });
  return { path: dest };
}

async function rename(input, newName) {
  const { abs } = await resolveSafe(input);
  const dest = path.join(path.dirname(abs), safeName(newName));
  if (fs.existsSync(dest)) throw httpError(409, 'Bu adda bir öğe zaten var');
  await fsp.rename(abs, dest);
  return { from: abs, to: dest };
}

async function remove(input) {
  // Bağlantının kendisini sil, hedefini değil
  const { abs } = await resolveSafe(input);
  if (abs === root() || abs === path.sep) throw httpError(400, 'Kök klasör silinemez');
  const st = await fsp.lstat(abs);
  await fsp.rm(abs, { recursive: st.isDirectory(), force: false });
  return { path: abs, type: st.isDirectory() ? 'dir' : 'file' };
}

async function statFile(input) {
  const { real } = await resolveSafe(input);
  const st = await fsp.stat(real);
  if (!st.isFile()) throw httpError(400, 'Yalnızca dosyalar indirilebilir');
  return { path: real, size: st.size };
}

module.exports = { resolveSafe, safeName, list, read, write, mkdir, rename, remove, statFile, httpError, MAX_EDIT_BYTES };
