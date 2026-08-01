const config = require('./config');
const DerivClient = require('./execution/derivClient');
const TradeExecutor = require('./execution/tradeExecutor');
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

  // Safety net: an unhandled rejection anywhere should never silently kill
  // a 24/7 trading process. Log it and halt trading rather than crash —
  // crashing meant Render kept restarting into the same failure on a loop.
  process.on('unhandledRejection', (reason) => {
    logEvent({ type: 'unhandled_rejection', reason });
    if (riskManagerRef) riskManagerRef.haltTrading('unhandled rejection — see decision log');
  });

  const startingBalance =
    config.mode === 'live' ? config.risk.liveStartBalance : 10000; // demo balance per Deriv's default

  const riskManager = new RiskManager(startingBalance);
  riskManagerRef = riskManager;
  const trialManager = new TrialManager();

  // Safety check run on every reconnect, before resuming anything else
  const reattachOpenPositions = async () => {
    const positions = await deriv.getOpenPositions();
    logEvent({ type: 'reconnect_position_check', positions });
    // TODO: re-verify each open contract still has its stop-loss condition tracked
  };

  // PAT-based auth (see src/execution/derivAccounts.js) — no login flow
  // needed; the same token is used to discover accounts and request a
  // fresh OTP connect URL on every (re)connect.
  const getToken = () => config.deriv.token;

  const onAuthFailed = (reason, err) => {
    logEvent({ type: 'auth_failed', reason, err });
    riskManager.haltTrading(`deriv auth failed (${reason}) — check DERIV_API_TOKEN`);
    sendWhatsAppMessage(
      `⚠️ Trading halted: Deriv connection failed (${reason}). Check the DERIV_API_TOKEN ` +
        `environment variable is set to a valid PAT for your demo account.`
    );
  };

  const deriv = new DerivClient({
    onOpenPositionsRecheck: reattachOpenPositions,
    getToken,
    onAuthFailed,
    wantDemo: config.mode !== 'live',
  });
  deriv.connect();

  const controlApp = startControlServer(riskManager);
  listen(controlApp);

  if (!config.deriv.token) {
    console.log(
      'No DERIV_API_TOKEN set. Generate a PAT for your demo account at ' +
        'app.deriv.com/account/api-token and set it as an environment variable.'
    );
  }

  scheduleDailySummary({ trialManager, riskManager });

  // --- Register strategies to trial ---
  // TODO: replace with strategies sourced + parsed from social media monitoring
  const strategies = [exampleRsiStrategy()];
  strategies.forEach((s) => trialManager.startTrial(s.id));

  // --- Main loop: check gate decisions daily ---
  setInterval(() => {
    const decisions = trialManager.evaluateAll();
    decisions.forEach((d) => {
      if (d.verdict === 'promote') {
        // TODO: switch that strategy's execution target from demo to live,
        // starting at 25% position size per the agreed ramp-up schedule.
        // Until that's built, promotion is a signal for YOU to act on, not
        // something the server does automatically — nothing trades real
        // money until the live account is funded and TRADING_MODE is
        // switched to 'live'.
        logEvent({ type: 'ready_for_live_ramp', strategyId: d.strategyId });
        sendWhatsAppMessage(
          `✅ Strategy "${d.strategyId}" passed the demo trial (≥40 trades, ≥80% win rate, ` +
            `profit factor >1.5). To go live: fund your real Deriv account with $10, then ` +
            `let me know and I'll switch it over at 25% position size to start.`
        );
      } else if (d.verdict === 'discard') {
        sendWhatsAppMessage(
          `❌ Strategy "${d.strategyId}" was discarded (didn't meet the win rate/profit ` +
            `factor bar, or hit the drawdown limit). No action needed on your end.`
        );
      }
    });
  }, 24 * 60 * 60 * 1000); // once a day

  // --- Per-strategy trading loop ---
  // One TradeExecutor per strategy: subscribes to its symbol's ticks, computes
  // indicators via the shared price feed, asks the strategy for a signal, and
  // (if risk/news checks pass) places and tracks a real trade through to
  // settlement. Started once the OTP-based connection is live so we're not
  // subscribing before we're actually authenticated.
  const priceFeed = new PriceFeed();
  let executorsStarted = false;

  deriv.on('connected', () => {
    if (executorsStarted) return; // avoid duplicate subscriptions on reconnect
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
