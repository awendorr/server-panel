const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const files = require('../services/fileService');
const audit = require('../services/auditService');
const config = require('../config');

const router = express.Router();
const MAX_UPLOAD_BYTES = config.maxUploadBytes;

const str = (v) => (typeof v === 'string' ? v : undefined);

router.get('/list', async (req, res, next) => {
  try { res.json(await files.list(str(req.query.path))); } catch (err) { next(err); }
});

router.get('/read', async (req, res, next) => {
  try { res.json(await files.read(str(req.query.path))); } catch (err) { next(err); }
});

router.get('/download', async (req, res, next) => {
  try {
    const f = await files.statFile(str(req.query.path));
    audit.log(req, 'file.download', { target: f.path, details: { size: f.size } });
    res.download(f.path, path.basename(f.path), { dotfiles: 'allow' });
  } catch (err) { next(err); }
});

router.put('/write', async (req, res, next) => {
  const p = str(req.body.path);
  try {
    const r = await files.write(p, req.body.content, req.body.expectedMtime);
    audit.log(req, 'file.write', { target: r.path, details: { size: r.size, created: r.created } });
    res.json(r);
  } catch (err) {
    audit.log(req, 'file.write', { target: p, details: { error: err.message }, success: false });
    next(err);
  }
});

router.post('/mkdir', async (req, res, next) => {
  try {
    const r = await files.mkdir(str(req.body.path), req.body.name);
    audit.log(req, 'file.mkdir', { target: r.path });
    res.json(r);
  } catch (err) { next(err); }
});

router.post('/rename', async (req, res, next) => {
  try {
    const r = await files.rename(str(req.body.path), req.body.name);
    audit.log(req, 'file.rename', { target: r.from, details: { to: r.to } });
    res.json(r);
  } catch (err) { next(err); }
});

router.delete('/', async (req, res, next) => {
  const p = str(req.query.path);
  try {
    const r = await files.remove(p);
    audit.log(req, 'file.delete', { target: r.path, details: { type: r.type } });
    res.json({ ok: true });
  } catch (err) {
    audit.log(req, 'file.delete', { target: p, details: { error: err.message }, success: false });
    next(err);
  }
});

// Yükleme: hedef klasör önce doğrulanır, dosya o klasörde geçici adla yazılıp sonra yeniden adlandırılır
async function uploadTarget(req, res, next) {
  try {
    const { real } = await files.resolveSafe(str(req.query.path));
    if (!(await fsp.stat(real)).isDirectory()) throw files.httpError(400, 'Hedef bir klasör değil');
    req.uploadDir = real;
    next();
  } catch (err) { next(err); }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, req.uploadDir),
    filename: (req, file, cb) => cb(null, `.upload-${crypto.randomBytes(6).toString('hex')}.part`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 20 },
});

router.post('/upload', uploadTarget, (req, res, next) => {
  upload.array('files')(req, res, async (err) => {
    const cleanup = () => Promise.all((req.files || []).map((f) => fsp.rm(f.path, { force: true })));
    if (err) {
      await cleanup();
      if (err.code === 'LIMIT_FILE_SIZE') return next(files.httpError(413, `Dosya çok büyük (en fazla ${MAX_UPLOAD_BYTES / 1048576} MB)`));
      return next(err);
    }
    const overwrite = req.query.overwrite === '1';
    const done = [];
    try {
      for (const f of req.files || []) {
        // Tarayıcılar dosya adını latin1 olarak gönderir; UTF-8'e çevir
        const original = Buffer.from(f.originalname, 'latin1').toString('utf8');
        const name = files.safeName(path.basename(original));
        const dest = path.join(req.uploadDir, name);
        const existing = await fsp.lstat(dest).catch(() => null);
        if (existing && !overwrite) throw files.httpError(409, `"${name}" zaten var`);
        if (existing) {
          if (!existing.isFile()) throw files.httpError(409, `"${name}" bir dosya değil, üzerine yazılamaz`);
          // Var olan dosyanın izinlerini ve sahibini koru (ör. 0600 bir .env herkese açık olmasın)
          await fsp.chown(f.path, existing.uid, existing.gid)
            .catch(() => fsp.chown(f.path, -1, existing.gid)).catch(() => {});
          await fsp.chmod(f.path, existing.mode & 0o7777);
        }
        await fsp.rename(f.path, dest);
        done.push({ name, size: f.size });
        audit.log(req, 'file.upload', { target: dest, details: { size: f.size, overwrite } });
      }
      res.json({ uploaded: done });
    } catch (e) {
      await cleanup();
      next(e);
    }
  });
});

module.exports = router;
