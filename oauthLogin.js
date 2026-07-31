const config = require('../config');
const tokenStore = require('./tokenStore');
const { logEvent } = require('../logging/decisionLog');

/**
 * Classic Deriv OAuth login flow. Visiting /auth/login sends you to Deriv's
 * login/consent page; after you approve, Deriv redirects back to
 * /auth/callback with one acctN/tokenN/curN triplet PER linked account
 * (demo AND real together), e.g.:
 *
 *   /auth/callback?acct1=VRTC1234567&token1=a1-xxxx&cur1=usd
 *                 &acct2=CR7654321&token2=a1-yyyy&cur2=usd
 *
 * Account IDs starting with VR are virtual (demo); everything else is real.
 * This is what lets us pick the demo account programmatically instead of
 * relying on whatever the dashboard UI happened to show.
 *
 * Docs: https://developers.deriv.com/docs/intro/oauth/
 */
function registerAuthRoutes(app) {
  app.get('/auth/login', (req, res) => {
    const url = `https://oauth.deriv.com/oauth2/authorize?app_id=${config.deriv.appId}`;
    res.redirect(url);
  });

  app.get('/auth/callback', (req, res) => {
    const query = req.query;
    const accounts = {};
    let i = 1;

    while (query[`acct${i}`]) {
      const acctId = query[`acct${i}`];
      const token = query[`token${i}`];
      const currency = query[`cur${i}`];
      const isDemo = /^VR/i.test(acctId); // VRTC / VRW = virtual (demo)

      accounts[acctId] = { token, currency, isDemo, linkedAt: new Date().toISOString() };
      i++;
    }

    if (Object.keys(accounts).length === 0) {
      logEvent({ type: 'oauth_callback_no_accounts', query });
      return res.status(400).send('No accounts returned from Deriv. Try /auth/login again.');
    }

    tokenStore.saveAccounts(accounts);
    logEvent({
      type: 'oauth_accounts_linked',
      accountIds: Object.keys(accounts),
      demoAccountFound: Object.values(accounts).some((a) => a.isDemo),
    });

    res.send(
      'Deriv account(s) linked successfully. Demo and real tokens (if present) have been ' +
        'saved. You can close this tab.'
    );
  });
}

module.exports = { registerAuthRoutes };
