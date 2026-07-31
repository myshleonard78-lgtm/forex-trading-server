# Forex Trading Server (Deriv-first)

Automated pipeline: source strategies → demo trial → promotion gate → risk-managed live execution.

## Authentication (OAuth login, no manual token pasting)
Instead of copying a Personal Access Token out of the Deriv dashboard (which ties to
whichever account happened to be active, and — per Deriv's newer token pages — may expire),
this app logs in via Deriv's OAuth flow:

1. Start the server (`npm start`)
2. Visit `http://localhost:3000/auth/login` (or your deployed URL) in a browser
3. Log into Deriv and approve the app
4. You're redirected to `/auth/callback`, which receives a token for **every** linked
   account (demo and real) in one shot, tags each one demo/real by its account-ID prefix
   (`VR...` = demo), and saves them to `deriv-tokens.json`
5. From then on, the bot automatically uses the demo token while `TRADING_MODE=demo`, and
   the real one once you switch to `TRADING_MODE=live` — no re-pasting anything

If a token ever stops working (revoked, or found to expire), `derivClient.js` detects the
failed `authorize` call, halts trading via the risk manager, and logs an
`auth_failed_needs_relogin` event pointing back to `/auth/login` — the TODO in `index.js`
is to route that same alert through the WhatsApp bot so you get pinged instead of having to
watch the logs.

**Note on redirect URI:** the app you registered on developers.deriv.com needs its redirect
URI set to wherever `/auth/callback` will actually be reachable (e.g.
`https://your-app.onrender.com/auth/callback` once deployed, or `http://localhost:3000/auth/callback`
for local testing).

## What's fully implemented
- **OAuth login flow** (`src/auth/oauthLogin.js`, `src/auth/tokenStore.js`) — `/auth/login`
  + `/auth/callback`, auto-tags demo vs real accounts, persists tokens to disk.
- **Deriv WebSocket client** (`src/execution/derivClient.js`) — connect, authorize, subscribe to
  ticks, get proposals, buy/sell contracts, track an open contract to settlement, auto-reconnect
  with exponential backoff, and a safety re-check of open positions immediately after any
  reconnect. Pulls its token from the token store live on every (re)connect, and surfaces a
  clear event (plus a trading halt) if authorization ever fails.
- **RSI indicator + rolling price feed** (`src/data/indicators.js`, `src/data/priceFeed.js`) —
  computes a real 14-period RSI from live ticks per symbol.
- **End-to-end trading loop** (`src/execution/tradeExecutor.js`) — ticks → indicators →
  strategy signal → risk check → news check → position size → proposal → buy → track to
  settlement → record P&L into both the risk manager and the trial manager. One executor
  per strategy, one open position at a time per strategy.
- **Risk manager** (`src/risk/riskManager.js`) — daily loss cap enforcement, position sizing
  (% of balance, capped by remaining daily allowance), manual halt/resume.
- **Trial manager** (`src/trials/trialManager.js`) — tracks win rate, profit factor, drawdown,
  and trade count per strategy; applies the full promotion gate (≥40 trades, ≥80% win rate,
  ≥1.5 profit factor, <20% drawdown) with the 3-day-increment / 14-day-max extension rule;
  ranks eligible strategies by profit factor.
- **Decision log** (`src/logging/decisionLog.js`) — append-only JSONL file of every event
  (promotions, discards, halts, reconnects, trade opens/closes) — exportable to a
  spreadsheet anytime.
- **Kill switch control server** (`src/killswitch/killSwitch.js`) — `/halt`, `/resume`,
  `/status` HTTP endpoints, meant to be called from your WhatsApp bot.
- **WhatsApp notifications** (`src/notifications/whatsapp.js`, `src/notifications/dailySummary.js`)
  — sends via the same Meta WhatsApp Cloud API your whatsapp-ai-bot uses. You get:
  - An instant alert if Deriv
