const express = require('express');
const config = require('../config');

/**
 * Minimal HTTP control surface. Your WhatsApp bot calls these endpoints
 * when you message it "halt trading" / "resume trading".
 *
 * POST /halt   { secret, reason }
 * POST /resume { secret }
 * GET  /status
 */
function startControlServer(riskManager) {
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

  app.get('/status', (req, res) => {
    res.json({
      halted: riskManager.halted,
      balance: riskManager.balance,
      todaysLoss: riskManager.todaysLoss(),
    });
  });

  return app; // caller mounts additional routes (e.g. /auth/*) before listen()
}

function listen(app) {
  app.listen(config.killSwitch.port, () => {
    console.log(`Control server listening on port ${config.killSwitch.port}`);
  });
}

module.exports = { startControlServer, listen };
