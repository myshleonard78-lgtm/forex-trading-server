const express = require('express');
const config = require('../config');

/**
 * Minimal HTTP control + data surface.
 *
 * POST   /halt       { secret, reason }
 * POST   /resume      { secret }
 * POST   /mode       { secret, mode: 'demo' | 'live' }
 * POST   /strategies { secret, definition }  — add a new strategy at runtime
 * DELETE /strategies/:id { secret }          — remove a strategy
 * GET    /status
 * GET    /dashboard-data?key=...
 */
function startControlServer(riskManager, { onModeChange, getMode, getDashboardData, addStrategy, removeStrategy, getTickData, getDigitStats } = {}) {
  const app = express();
  app.use(express.json());

  const checkSecret = (req, res, next) => {
    if (req.body.secret !== config.killSwitch.secret) {
      return res.status(401).json({ error: 'invalid secret' });
    }
    next();
  };

  app.post('/halt', checkSecret, (req, res) => {
    riskManager.haltTrading(req.body.reason || 'manual halt via control endpoint');
    res.json({ halted: true });
  });

  app.post('/resume', checkSecret, (req, res) => {
    riskManager.resumeTrading();
    res.json({ halted: false });
  });

  app.post('/mode', checkSecret, async (req, res) => {
    const { mode } = req.body;
    if (mode !== 'demo' && mode !== 'live') {
      return res.status(400).json({ error: "mode must be 'demo' or 'live'" });
    }
    try {
      await onModeChange(mode);
      res.json({ mode });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/strategies', checkSecret, (req, res) => {
    try {
      addStrategy(req.body.definition);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.delete('/strategies/:id', checkSecret, (req, res) => {
    try {
      removeStrategy(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.get('/status', (req, res) => {
    res.json({
      halted: riskManager.halted,
      balance: riskManager.balance,
      todaysLoss: riskManager.todaysLoss(),
      dailyLossLimit: riskManager.dailyLossLimit,
      mode: getMode ? getMode() : undefined,
    });
  });

  // Recent price history for a symbol — powers the Strategy Builder's
  // live Rise/Fall chart.
  app.get('/market/ticks', async (req, res) => {
    if (req.query.key !== config.killSwitch.secret) return res.status(401).json({ error: 'invalid key' });
    try {
      const symbol = req.query.symbol || 'R_100';
      const count = Math.min(Number(req.query.count) || 100, 1000);
      const data = await getTickData(symbol, count);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Last-digit frequency breakdown — powers the digit-contract circles.
  app.get('/market/digit-stats', async (req, res) => {
    if (req.query.key !== config.killSwitch.secret) return res.status(401).json({ error: 'invalid key' });
    try {
      const symbol = req.query.symbol || 'R_100';
      const count = Math.min(Number(req.query.count) || 1000, 1000);
      const data = await getDigitStats(symbol, count);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/dashboard-data', async (req, res) => {
    if (req.query.key !== config.killSwitch.secret) {
      return res.status(401).json({ error: 'invalid key' });
    }
    try {
      const data = await getDashboardData();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return app;
}

function listen(app) {
  app.listen(config.killSwitch.port, () => {
    console.log(`Control server listening on port ${config.killSwitch.port}`);
  });
}

module.exports = { startControlServer, listen };
