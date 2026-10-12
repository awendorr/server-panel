const express = require('express');
const metricsStore = require('../services/metricsStore');
const metricsService = require('../services/metricsService');

const router = express.Router();

// Son anlık değerler (sayfa ilk açıldığında)
router.get('/current', (req, res) => {
  res.json(metricsService.getLatest());
});

// Geçmiş: range = 1h | 24h | 7d
router.get('/history', (req, res) => {
  const range = String(req.query.range || '24h');
  if (!metricsStore.RANGES[range]) return res.status(400).json({ error: 'Geçersiz aralık' });
  res.json(metricsStore.history(range));
});

module.exports = router;
