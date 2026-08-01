require('dotenv').config();

module.exports = {
  deriv: {
    appId: process.env.DERIV_APP_ID, // your alphanumeric App ID from developers.deriv.com
    // PAT (Personal Access Token) from app.deriv.com/account/api-token — the
    // supported auth method for the new API that doesn't expire hourly like
    // OAuth access tokens do. Generate one against your DEMO account.
    token: process.env.DERIV_API_TOKEN || null,
    // New API base — REST for account discovery + OTP, WS reached via a
    // per-account OTP URL (see src/execution/derivAccounts.js)
    restBase: process.env.DERIV_REST_BASE || 'https://api.derivws.com/trading/v1/options',
  },
  mode: process.env.TRADING_MODE || 'demo', // 'demo' | 'live'
  risk: {
    liveStartBalance: Number(process.env.LIVE_ACCOUNT_START_BALANCE || 10),
    dailyLossLimit: Number(process.env.LIVE_DAILY_LOSS_LIMIT || 2),
    riskPerTradePct: Number(process.env.RISK_PER_TRADE_PCT || 0.75), // % of balance risked per trade
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
    // Your own number to send alerts TO (include country code, no +, e.g. 2547XXXXXXXX)
    recipientNumber: process.env.WHATSAPP_RECIPIENT_NUMBER || null,
  },
};
