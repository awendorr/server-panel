const express = require('express');
const alerts = require('../services/alertService');
const audit = require('../services/auditService');

const router = express.Router();
const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error('Geçersiz kimlik'), { status: 400, expose: true });
  return n;
};

router.get('/rules', (req, res) => res.json(alerts.rules()));

router.post('/rules', (req, res) => {
  const r = alerts.createRule(req.body);
  audit.log(req, 'alert.rule_create', { target: r.metric, details: r });
  res.json(r);
});

router.put('/rules/:id', (req, res) => {
  const r = alerts.updateRule(id(req.params.id), req.body);
  audit.log(req, 'alert.rule_update', { target: r.metric, details: r });
  res.json(r);
});

router.delete('/rules/:id', (req, res) => {
  const r = alerts.deleteRule(id(req.params.id));
  audit.log(req, 'alert.rule_delete', { target: r.metric, details: r });
  res.json({ ok: true });
});

router.get('/events', (req, res) => {
  res.json(alerts.events({ limit: parseInt(req.query.limit, 10) || 100, active: req.query.active === '1' }));
});

router.post('/events/ack-all', (req, res) => { alerts.ackAll(); res.json({ ok: true }); });
router.post('/events/:id/ack', (req, res) => { alerts.ack(id(req.params.id)); res.json({ ok: true }); });

module.exports = router;
