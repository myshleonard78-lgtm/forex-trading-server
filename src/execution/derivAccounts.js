const config = require('../config');
const { logEvent } = require('../logging/decisionLog');

/**
 * New Deriv API (developers.deriv.com) account discovery + connection setup.
 * Auth is via PAT (Bearer token) — no OAuth login flow needed for this.
 *
 * Flow: list accounts -> pick the demo (or real) one -> request a one-time
 * password (OTP) for it -> that response includes a ready-to-use WebSocket
 * URL. The OTP is short-lived and single-use, so this must be re-run on
 * every (re)connect — never cache the WS URL across reconnects.
 */

async function listAccounts(token) {
  const res = await fetch(`${config.deriv.restBase}/accounts`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Deriv-App-ID': config.deriv.appId,
    },
  });
  const rawText = await res.text();
  let body;
  try {
    body = JSON.parse(rawText);
  } catch {
    body = rawText; // non-JSON error page — surface it as-is rather than crash
  }
  if (!res.ok) {
    logEvent({ type: 'deriv_accounts_fetch_failed', status: res.status, body });
    throw new Error(`Failed to list Deriv accounts: ${res.status} — ${JSON.stringify(body)}`);
  }
  return body;
}

/**
 * Picks the demo or real account from the accounts list. Field names for
 * "is this a demo account" aren't fully confirmed from docs alone — this
 * checks a few likely shapes defensively and logs what it actually saw so
 * we can correct this quickly if Deriv's real response differs.
 */
function pickAccount(accounts, wantDemo) {
  const list = Array.isArray(accounts) ? accounts : accounts.accounts || accounts.data || [];
  logEvent({ type: 'deriv_accounts_seen', accounts: list });

  const isDemo = (acct) =>
    acct.is_virtual === true ||
    acct.isVirtual === true ||
    acct.type === 'demo' ||
    acct.account_type === 'demo' ||
    /^VR/i.test(acct.loginid || acct.account_id || acct.id || '');

  const match = list.find((a) => (wantDemo ? isDemo(a) : !isDemo(a)));
  if (!match) {
    logEvent({ type: 'no_matching_account', wantDemo, accounts: list });
    throw new Error(`No ${wantDemo ? 'demo' : 'real'} account found in Deriv accounts list`);
  }
  return match;
}

async function getConnectUrl(token, wantDemo) {
  const accounts = await listAccounts(token);
  const account = pickAccount(accounts, wantDemo);
  const accountId = account.account_id || account.id || account.loginid;

  const res = await fetch(`${config.deriv.restBase}/accounts/${accountId}/otp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Deriv-App-ID': config.deriv.appId,
    },
  });
  const rawText = await res.text();
  let body;
  try {
    body = JSON.parse(rawText);
  } catch {
    body = rawText;
  }
  if (!res.ok) {
    logEvent({ type: 'deriv_otp_failed', status: res.status, body });
    throw new Error(`Failed to get Deriv OTP: ${res.status} — ${JSON.stringify(body)}`);
  }
  return body.url;
}

module.exports = { listAccounts, pickAccount, getConnectUrl };
