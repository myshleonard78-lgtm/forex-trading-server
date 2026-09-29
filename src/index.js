const config = require('./config');
const DerivClient = require('./execution/derivClient');
const TradeExecutor = require('./execution/tradeExecutor');
const { listAccounts, pickAccount } = require('./execution/derivAccounts');
const PriceFeed = require('./data/priceFeed');
const RiskManager = require('./risk/riskManager');
const { TrialManager } = require('./trials/trialManager');
const { startControlServer, listen } = require('./killswitch/killSwitch');
const { logEvent } = require('./logging/decisionLog');
const { exampleRsiStrategy } = require('./strategies/strategyBase');
const { sendWhatsAppMessage } = require('./notifications/whatsapp');
const { scheduleDailySummary } = require('./notifications/dailySummary');

async function main() {
  let riskManagerRef = null;

  process.on('unhandledRejection', (reason) => {
    logEvent({ type: 'unhandled_rejection', reason });
    if (riskManagerRef) riskManagerRef.haltTrading('unhandled rejection — see decision log');
  });

  let currentIsDemo = config.mode !== 'live';
  const startingBalance = currentIsDemo ? 10000 : config.risk.liveStartBalance;

  const riskManager = new RiskManager(startingBalance);
  riskManagerRef = riskManager;
  const trialManager = new TrialManager();

  const reattachOpenPositions = async () => {
    const positions = await deriv.getOpenPositions();
    logEvent({ type: 'reconnect_position_check', positions });
  };

  const getToken = () => config.deriv.token;

  const onAuthFailed = (reason, err) => {
    logEvent({ type: 'auth_failed', reason, err });
    riskManager.haltTrading(`deriv auth failed (${reason}) — check DERIV_API_TOKEN`);
    sendWhatsAppMessage(
      `⚠️ Trading halted: Deriv connection failed (${reason}). Check the DERIV_API_TOKEN ` +
        `environment variable is set to a valid PAT.`
    );
  };

  const deriv = new DerivClient({
    onOpenPositionsRecheck: reattachOpenPositions,
    getToken,
    onAuthFailed,
    wantDemo: currentIsDemo,
  });
  deriv.connect();

  // Switches the bot between the demo and real account. No new token is
  // needed — one PAT sees both accounts; this just closes and reconnects
  // against the other one's OTP. Also re-syncs the risk manager's balance
  // to that account's real balance so daily-loss tracking starts correct.
  const switchMode = async (mode) => {
    const wantDemo = mode === 'demo';
    const token = getToken();
    const accounts = await listAccounts(token);
    const account = pickAccount(accounts, wantDemo);
    const balance = Number(account.balance);

    currentIsDemo = wantDemo;
    riskManager.balance = balance;
    riskManager.dayStartBalance = balance;
    deriv.switchTarget(wantDemo);

    logEvent({ type: 'mode_switched', mode, balance });
    sendWhatsAppMessage(`🔁 Switched to ${mode.toUpperCase()} trading. Balance: $${balance}`);
  };

  const controlApp = startControlServer(riskManager, {
    onModeChange: switchMode,
    getMode: () => (currentIsDemo ? 'demo' : 'live'),
  });
  listen(controlApp);

  if (!config.deriv.token) {
    console.log(
      'No DERIV_API_TOKEN set. Generate a PAT at app.deriv.com/account/api-token and set it ' +
        'as an environment variable.'
    );
  }

  scheduleDailySummary({ trialManager, riskManager });

  const strategies = [exampleRsiStrategy()];
  strategies.forEach((s) => trialManager.startTrial(s.id));

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
        sendWhatsAppMessage(
          `❌ Strategy "${d.strategyId}" was discarded (didn't meet the win rate/profit ` +
            `factor bar, or hit the drawdown limit). No action needed on your end.`
        );
      }
    });
  }, 24 * 60 * 60 * 1000);

  const priceFeed = new PriceFeed();
  let executorsStarted = false;

  deriv.on('connected', () => {
    if (executorsStarted) return;
    executorsStarted = true;

    strategies.forEach((strategy) => {
      const executor = new TradeExecutor({
        strategy,
        deriv,
        priceFeed,
        riskManager,
        trialManager,
      });
      executor.start();
      logEvent({ type: 'executor_started', strategyId: strategy.id, symbol: strategy.symbol });
    });
  });

  console.log(`Trading server started in ${config.mode} mode.`);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
