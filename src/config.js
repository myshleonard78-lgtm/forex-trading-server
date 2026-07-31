require('dotenv').config();

module.exports = {
  deriv: {
    appId: process.env.DERIV_APP_ID,
    // Optional fallback if you ever want to test with a manually-pasted PAT
    // instead of going through /auth/login. Normal operation uses tokens
    // saved by the OAuth callback (see src/auth/tokenStore.js) instead.
    token: process.env.DERIV_API_TOKEN || null,
    wsUrl: process.env.DERIV_WS_URL || 'wss://ws.derivws.com/websockets/v3',
    oauthLoginUrl: 'https://oauth.deriv.com/oauth2/authorize',
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
