require('dotenv').config();

module.exports = {
  deriv: {
    appId: process.env.DERIV_APP_ID,
    token: process.env.DERIV_API_TOKEN || null,
    restBase: process.env.DERIV_REST_BASE || 'https://api.derivws.com/trading/v1/options',
  },
  mode: process.env.TRADING_MODE || 'demo',
  risk: {
    liveStartBalance: Number(process.env.LIVE_ACCOUNT_START_BALANCE || 10),
    // Live: fixed dollar cap, exactly as agreed — real money stays protected.
    liveDailyLossLimit: Number(process.env.LIVE_DAILY_LOSS_LIMIT || 2),
    // Demo: a % of the (much larger) demo balance instead of the live $ figure —
    // it's not real money, and the trial needs enough daily trade volume to
    // reach the 40-trade minimum in a reasonable time.
    demoDailyLossLimitPct: Number(process.env.DEMO_DAILY_LOSS_LIMIT_PCT || 5),
    riskPerTradePct: Number(process.env.RISK_PER_TRADE_PCT || 0.75),
  },
  gate: {
    minTrades: Number(process.env.MIN_TRADES_FOR_EVAL || 40),
    minWinRatePct: Number(process.env.MIN_WIN_RATE_PCT || 80),
    minProfitFactor: Number(process.env.MIN_PROFIT_FACTOR || 1.5),
    maxDemoDrawdownPct: Number(process.env.MAX_DEMO_DRAWDOWN_PCT || 20),
    extensionDays: Number(process.env.TRIAL_EXTENSION_DAYS || 3),
    maxTrialDays: Number(process.env.TRIAL_MAX_DAYS || 14),
  },
  killSwitch: {
    secret: process.env.KILL_SWITCH_SECRET,
    port: Number(process.env.PORT || 3000),
  },
  news: {
    apiKey: process.env.NEWS_API_KEY,
    blackoutMinutes: Number(process.env.NEWS_BLACKOUT_MINUTES || 20),
  },
  whatsapp: {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || null,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    recipientNumber: process.env.WHATSAPP_RECIPIENT_NUMBER || null,
  },
};
