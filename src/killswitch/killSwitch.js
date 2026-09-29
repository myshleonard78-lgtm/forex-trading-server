const express = require('express');
const config = require('../config');

/**
 * Minimal HTTP control surface. Your WhatsApp bot (or you, directly) calls
 * these endpoints.
 *
 * POST /halt   { secret, reason }
 * POST /resume { secret }
 * POST /mode   { secret, mode: 'demo' | 'live' }
 * GET  /status
 */
function startControlServer(riskManager, { onModeChange, getMode } = {}) {
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

  app.get('/status', (req, res) => {
    res.json({
      halted: riskManager.halted,
      balance: riskManager.balance,
      todaysLoss: riskManager.todaysLoss(),
      mode: getMode ? getMode() : undefined,
    });
  });

  return app; // caller mounts additional routes before listen()
}

function listen(app) {
  app.listen(config.killSwitch.port, () => {
    console.log(`Control server listening on port ${config.killSwitch.port}`);
  });
}

module.exports = { startControlServer, listen };
