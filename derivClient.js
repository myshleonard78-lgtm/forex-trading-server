const WebSocket = require('ws');
const EventEmitter = require('events');
const config = require('../config');
const { logEvent } = require('../logging/decisionLog');

/**
 * Thin wrapper around the Deriv WebSocket API.
 * Docs: https://api.deriv.com  (app registration required for a real app_id)
 *
 * Handles:
 *  - connect + authorize
 *  - auto-reconnect with exponential backoff (capped)
 *  - re-checking open positions immediately after reconnect, before
 *    accepting any new trade signals (safety before speed)
 */
class DerivClient extends EventEmitter {
  /**
   * @param {Function} getToken - returns the current token to authorize with
   *   (e.g. tokenStore.getDemoToken). Called fresh on every (re)connect, so
   *   swapping the underlying token (after a re-login) takes effect on the
   *   next reconnect without restarting the process.
   */
  constructor({ onOpenPositionsRecheck, getToken, onAuthFailed } = {}) {
    super();
    this.ws = null;
    this.reqId = 1;
    this.pending = new Map(); // req_id -> {resolve, reject}
    this.backoffMs = 1000;
    this.maxBackoffMs = 60000;
    this.onOpenPositionsRecheck = onOpenPositionsRecheck || (async () => {});
    this.getToken = getToken || (() => config.deriv.token);
    this.onAuthFailed = onAuthFailed || (() => {});
    this.authorized = false;
  }

  connect() {
    const url = `${config.deriv.wsUrl}?app_id=${config.deriv.appId}`;
    this.ws = new WebSocket(url);

    this.ws.on('open', async () => {
      this.backoffMs = 1000; // reset backoff on a clean connect
      logEvent({ type: 'ws_connected' });
      await this.authorize();
      // Safety first: re-verify open positions / stop-loss state before
      // resuming anything else.
      await this.onOpenPositionsRecheck();
    });

    this.ws.on('message', (raw) => this._handleMessage(raw));

    this.ws.on('close', () => {
      logEvent({ type: 'ws_closed', backoffMs: this.backoffMs });
      this.authorized = false;
      setTimeout(() => this.connect(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    });

    this.ws.on('error', (err) => {
      logEvent({ type: 'ws_error', message: err.message });
      // 'close' fires after 'error' — reconnect handled there
    });
  }

  _handleMessage(raw) {
    const msg = JSON.parse(raw.toString());
    const { req_id } = msg;
    if (req_id && this.pending.has(req_id)) {
      const { resolve, reject } = this.pending.get(req_id);
      this.pending.delete(req_id);
      if (msg.error) reject(msg.error);
      else resolve(msg);
    }
    // Emit regardless of whether req_id was pending — this is what lets
    // subsequent pushes on a subscription (ticks, open-contract updates)
    // reach listeners after the first response already resolved the promise.
    if (msg.msg_type) this.emit(msg.msg_type, msg);
  }

  _send(payload) {
    const req_id = this.reqId++;
    return new Promise((resolve, reject) => {
      this.pending.set(req_id, { resolve, reject });
      this.ws.send(JSON.stringify({ ...payload, req_id }));
    });
  }

  async authorize() {
    const token = this.getToken();
    if (!token) {
      logEvent({ type: 'no_token_available' });
      this.onAuthFailed('no_token');
      return null;
    }
    try {
      const res = await this._send({ authorize: token });
      this.authorized = true;
      return res;
    } catch (err) {
      // Token missing, revoked, or (if Deriv ever expires OAuth-issued
      // tokens) expired — either way, surface it instead of retrying blind.
      logEvent({ type: 'authorize_failed', error: err });
      this.authorized = false;
      this.onAuthFailed('rejected', err);
      return null;
    }
  }

  /** Subscribe to live tick stream for a symbol, e.g. 'R_100' for a Deriv synthetic index */
  subscribeTicks(symbol) {
    return this._send({ ticks: symbol, subscribe: 1 });
  }

  /** Get a price quote for a proposed contract before buying */
  getProposal(params) {
    // params: { contract_type, symbol, amount, duration, duration_unit, basis: 'stake' }
    return this._send({ proposal: 1, ...params });
  }

  /** Execute a trade */
  buyContract(proposalId, price) {
    return this._send({ buy: proposalId, price });
  }

  /** Close a still-open contract, e.g. on kill-switch or stop-loss trigger */
  sellContract(contractId, price = 0) {
    return this._send({ sell: contractId, price });
  }

  getOpenPositions() {
    return this._send({ portfolio: 1 });
  }

  /**
   * Subscribe to updates for one open contract until it settles.
   * Listen via deriv.on('proposal_open_contract', msg => ...) and check
   * msg.proposal_open_contract.is_sold to know when it's finished, with
   * .profit giving the realized P&L.
   */
  subscribeContract(contractId) {
    return this._send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
  }
}

module.exports = DerivClient;
