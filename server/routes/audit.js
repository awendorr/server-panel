const express = require('express');
const audit = require('../services/auditService');

const router = express.Router();

router.get('/', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100;
  const before = parseInt(req.query.before, 10) || undefined;
  const action = typeof req.query.action === 'string' ? req.query.action.slice(0, 64) : undefined;
  res.json(audit.list({ limit, before, action }));
});

module.exports = router;
