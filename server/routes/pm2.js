const express = require('express');
const pm2Service = require('../services/pm2Service');
const audit = require('../services/auditService');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    res.json(await pm2Service.list());
  } catch (err) {
    next(Object.assign(err, { status: 503, expose: true, message: 'PM2 ile bağlantı kurulamadı: ' + err.message }));
  }
});

router.get('/:id/logs', async (req, res, next) => {
  try {
    res.json(await pm2Service.recentLogs(parseId(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/:action', async (req, res, next) => {
  const id = parseId(req.params.id);
  const act = req.params.action;
  const name = typeof req.body.name === 'string' ? req.body.name.slice(0, 128) : undefined;
  try {
    await pm2Service.action(id, act);
    audit.log(req, `pm2.${act}`, { target: name || id, details: { id } });
    res.json({ ok: true });
  } catch (err) {
    audit.log(req, `pm2.${act}`, { target: name || id, details: { id, error: err.message }, success: false });
    if (!err.status) Object.assign(err, { status: 500, expose: true });
    next(err);
  }
});

function parseId(v) {
  const id = Number(v);
  if (!Number.isInteger(id) || id < 0) throw Object.assign(new Error('Geçersiz süreç'), { status: 400, expose: true });
  return id;
}

module.exports = router;
