const express = require('express');
const system = require('../services/systemService');

const router = express.Router();

router.get('/processes', async (req, res, next) => {
  try { res.json(await system.processes(req.query.sort === 'mem' ? 'mem' : 'cpu')); } catch (err) { next(err); }
});
router.get('/services', async (req, res, next) => {
  try { res.json(await system.services()); } catch (err) { next(err); }
});
router.get('/ports', async (req, res, next) => {
  try { res.json(await system.ports()); } catch (err) { next(err); }
});

module.exports = router;
