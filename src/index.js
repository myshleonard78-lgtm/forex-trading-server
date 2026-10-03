const config = require('./config');
const DerivClient = require('./execution/derivClient');
const StrategyManager = require('./strategies/strategyManager');
const { listAccounts, pickAccount } = require('./execution/derivAccounts');
const PriceFeed = require('./data/priceFeed');
const RiskManager = require('./risk/riskManager');
const { TrialManager } = require('./trials/trialManager');
const { startControlServer, listen } = require('./killswitch/killSwitch');
const { logEvent, onEvent } = require('./logging/decisionLog');
const { exampleRsiStrategy } = require('./strategies/strategyBase');
const { computeDigitStats } = require('./market/digitStats');
const { sendWhatsAppMessage } = require('./notifications/whatsapp');
const { scheduleDailySummary } = require('./notifications/dailySummary');

function computeDailyLossLimit(isDemo, balance) {
  return isDemo
    ? Math.round(balance * (config.risk.demoDailyLossLimitPct / 100) * 100) / 100
    : config.risk.liveDailyLossLimit;
}

async function main() {
  let riskManagerRef = null;

  process.on('unhandledRejection', (reason) => {
    logEvent({ type: 'unhandled_rejection', reason });
    if (riskManagerRef) riskManagerRef.haltTrading('unhandled rejection — see decision log');
  });

  let currentIsDemo = config.mode !== 'live';
  const startingBalance = currentIsDemo ? 10000 : config.risk.liveStartBalance;
  const initialDailyLossLimit = computeDailyLossLimit(currentIsDemo, startingBalance);

  const riskManager = new RiskManager(startingBalance, initialDailyLossLimit, config.risk.riskPerTradePct);
  riskManagerRef = riskManager;
  const trialManager = new TrialManager();
  const priceFeed = new PriceFeed();

  const reattachOpenPositions = async () => {
    const res = await deriv.getOpenPositions();
    const contracts = (res.portfolio && res.portfolio.contracts) || [];
    logEvent({ type: 'reconnect_position_check', count: contracts.length });

    for (const contract of contracts) {
      const executor = strategyManager.findExecutorForSymbol(contract.underlying_symbol);
      if (executor) {
        await executor.resumeTracking(contract.contract_id);
      } else {
        logEvent({ type: 'orphaned_contract_no_matching_strategy', contract });
      }
    }
  };

  const getToken = () => config.deriv.token;

  const onAuthFailed = (reason, err) => {
    logEvent({ type: 'auth_failed', reason, err });
    riskManager.haltForAuthIssue(`deriv connection failed (${reason})`);
    sendWhatsAppMessage(
      `⚠️ Trading paused: Deriv connection failed (${reason}). This may be a temporary ` +
        `Deriv outage — trading will resume automatically once reconnected. If it doesn't, ` +
        `check the DERIV_API_TOKEN environment variable.`
    );
  };

  const deriv = new DerivClient({
    onOpenPositionsRecheck: reattachOpenPositions,
    getToken,
    onAuthFailed,
    wantDemo: currentIsDemo,
  });

  const strategyManager = new StrategyManager({ deriv, priceFeed, riskManager, trialManager });

  deriv.connect();

  const switchMode = async (mode) => {
    const wantDemo = mode === 'demo';
    const token = getToken();
    const accounts = await listAccounts(token);
    const account = pickAccount(accounts, wantDemo);
    const balance = Number(account.balance);

    currentIsDemo = wantDemo;
    riskManager.balance = balance;
    riskManager.dayStartBalance = balance;
    riskManager.setDailyLossLimit(computeDailyLossLimit(wantDemo, balance));
    deriv.switchTarget(wantDemo);

    logEvent({ type: 'mode_switched', mode, balance });
    sendWhatsAppMessage(`🔁 Switched to ${mode.toUpperCase()} trading. Balance: $${balance}`);
  };

  const getDashboardData = async () => {
    let positions = [];
    try {
      const res = await deriv.getOpenPositions();
      positions = (res.portfolio && res.portfolio.contracts) || [];
    } catch (err) {
      logEvent({ type: 'dashboard_positions_fetch_failed', error: String(err) });
    }

    return {
      mode: currentIsDemo ? 'demo' : 'live',
      connected: deriv.authorized,
      halted: riskManager.halted,
      haltedForAuthIssue: riskManager.haltedForAuthIssue,
      balance: riskManager.balance,
      todaysLoss: riskManager.todaysLoss(),
      dailyLossLimit: riskManager.dailyLossLimit,
      riskPerTradePct: riskManager.riskPerTradePct,
      openPositions: positions,
      strategies: trialManager.toSummaryList(),
      updatedAt: new Date().toISOString(),
    };
  };

  const addStrategy = (definition) => {
    if (!definition || !definition.id) throw new Error('definition.id is required');
    strategyManager.addFromDefinition(definition);
    sendWhatsAppMessage(`🧪 New strategy "${definition.id}" added and now testing on demo: ${definition.description || ''}`);
  };

  const removeStrategy = (id) => {
    strategyManager.removeStrategy(id);
    sendWhatsAppMessage(`🗑️ Strategy "${id}" removed.`);
  };

  const getTickData = async (symbol, count) => {
    const res = await deriv.getTickHistory(symbol, count);
    const prices = (res.history && res.history.prices) || [];
    return { symbol, prices };
  };

  const getDigitStats = async (symbol, count) => {
    const res = await deriv.getTickHistory(symbol, count);
    const prices = (res.history && res.history.prices) || [];
    return { symbol, ...computeDigitStats(prices) };
  };

  const controlApp = startControlServer(riskManager, {
    onModeChange: switchMode,
    getMode: () => (currentIsDemo ? 'demo' : 'live'),
    getDashboardData,
    addStrategy,
    removeStrategy,
    getTickData,
    getDigitStats,
  });
  listen(controlApp);

  if (!config.deriv.token) {
    console.log('No DERIV_API_TOKEN set. Generate a PAT at app.deriv.com/account/api-token.');
  }

  scheduleDailySummary({ trialManager, riskManager });

  const ALERT_EVENT_TYPES = new Set([
    'trade_entry_failed', 'connect_url_failed', 'deriv_otp_failed',
    'deriv_accounts_fetch_failed', 'ws_error', 'unhandled_rejection',
    'no_matching_account', 'no_token_available', 'position_recheck_failed',
  ]);
  const lastAlertSentAt = new Map();
  const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

  onEvent((record) => {
    if (!ALERT_EVENT_TYPES.has(record.type)) return;
    const last = lastAlertSentAt.get(record.type) || 0;
    if (Date.now() - last < ALERT_COOLDOWN_MS) return;
    lastAlertSentAt.set(record.type, Date.now());

    let detail = JSON.stringify(record);
    if (detail.length > 800) detail = detail.slice(0, 800) + '…';
    sendWhatsAppMessage(`🐛 Trading server error: ${record.type}\n\n${detail}\n\nSend this to Claude to fix.`);
  });

  strategyManager.addStrategyObject(exampleRsiStrategy());

  setInterval(() => {
    const decisions = trialManager.evaluateAll();
    decisions.forEach((d) => {
      if (d.verdict === 'promote') {
        logEvent({ type: 'ready_for_live_ramp', strategyId: d.strategyId });
        sendWhatsAppMessage(
          `✅ Strategy "${d.strategyId}" passed the demo trial (≥40 trades, ≥80% win rate, ` +
            `profit factor >1.5). To go live: fund your real Deriv account with $10, then ` +
            `send "switch to live" and I'll move it over.`
        );
      } else if (d.verdict === 'discard') {
        strategyManager.removeStrategy(d.strategyId);
        sendWhatsAppMessage(
          `❌ Strategy "${d.strategyId}" was discarded (didn't meet the win rate/profit ` +
            `factor bar, or hit the drawdown limit) and has been removed.`
        );
      }
    });
  }, 24 * 60 * 60 * 1000);

  deriv.on('connected', () => {
    if (riskManager.haltedForAuthIssue) {
      riskManager.resumeTrading();
      sendWhatsAppMessage('✅ Reconnected to Deriv — trading resumed automatically.');
    }
    strategyManager.startAll();
  });

  console.log(`Trading server started in ${config.mode} mode.`);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
