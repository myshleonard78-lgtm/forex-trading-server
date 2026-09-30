const WebSocket = require('ws');
const EventEmitter = require('events');
const config = require('../config');
const { logEvent } = require('../logging/decisionLog');
const { getConnectUrl } = require('./derivAccounts');

/**
 * Thin wrapper around Deriv's new API (developers.deriv.com).
 *
 * Connection model: authenticates via a one-time password (OTP) baked into
 * the WebSocket URL, fetched fresh via REST (using a PAT) on every single
 * connect — OTPs are short-lived and single-use, so never cached across
 * reconnects.
 *
 * Trading message protocol (ticks, proposal, buy, proposal_open_contract,
 * sell) is the same JSON-RPC-style shape as the old API.
 */
class DerivClient extends EventEmitter {
  /**
   * @param {Function} getToken - returns the PAT to use for account
   *   discovery + OTP requests.
   * @param {boolean} wantDemo - true for the demo account, false for real.
   *   Mutable at runtime via switchTarget().
   */
  constructor({ onOpenPositionsRecheck, getToken, onAuthFailed, wantDemo = true } = {}) {
    super();
    this.ws = null;
    this.reqId = 1;
    this.pending = new Map(); // req_id -> {resolve, reject}
    this.backoffMs = 1000;
    this.maxBackoffMs = 60000;
    this.onOpenPositionsRecheck = onOpenPositionsRecheck || (async () => {});
    this.getToken = getToken || (() => config.deriv.token);
    this.onAuthFailed = onAuthFailed || (() => {});
    this.wantDemo = wantDemo;
    this.authorized = false;
    this._switching = false; // suppresses normal backoff delay during a deliberate switch
  }

  async connect() {
    const token = this.getToken();
    if (!token) {
      logEvent({ type: 'no_token_available' });
      this.onAuthFailed('no_token');
      return;
    }

    let url;
    try {
      url = await getConnectUrl(token, this.wantDemo);
    } catch (err) {
      logEvent({ type: 'connect_url_failed', error: String(err) });
      this.authorized = false;
      this.onAuthFailed('connect_url_failed', err);
      setTimeout(() => this.connect(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
      return;
    }

    this.ws = new WebSocket(url);

    this.ws.on('open', async () => {
      this.backoffMs = 1000;
      this.authorized = true;
      logEvent({ type: 'ws_connected', account: this.wantDemo ? 'demo' : 'real' });

      // Deriv's WebSocket times out an idle connection — send a lightweight
      // ping periodically to keep it alive between real requests. Without
      // this the connection was dying and reconnecting roughly every 60s.
      this._pingInterval = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this._send({ ping: 1 }).catch(() => {});
        }
      }, 30000);

      this.emit('connected');

      try {
        await this.onOpenPositionsRecheck();
      } catch (err) {
        logEvent({ type: 'position_recheck_failed', error: err });
      }
    });

    this.ws.on('message', (raw) => this._handleMessage(raw));

    this.ws.on('close', () => {
      logEvent({ type: 'ws_closed', backoffMs: this.backoffMs });
      this.authorized = false;
      if (this._pingInterval) {
        clearInterval(this._pingInterval);
        this._pingInterval = null;
      }
      const delay = this._switching ? 500 : this.backoffMs;
      this._switching = false;
      setTimeout(() => this.connect(), delay);
      this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    });

    this.ws.on('error', (err) => {
      logEvent({ type: 'ws_error', message: err.message });
    });
  }

  /**
   * Switch which account (demo/live) this client trades on. Closes the
   * current connection so it reconnects fresh against the new account's
   * OTP — no new token needed, since one PAT can see both accounts.
   */
  switchTarget(wantDemo) {
    if (wantDemo === this.wantDemo) return;
    logEvent({ type: 'mode_switch_requested', to: wantDemo ? 'demo' : 'real' });
    this.wantDemo = wantDemo;
    this._switching = true;
    if (this.ws) {
      this.ws.close();
    } else {
      this.connect();
    }
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
    if (msg.msg_type) this.emit(msg.msg_type, msg);
  }

  _send(payload) {
    const req_id = this.reqId++;
    return new Promise((resolve, reject) => {
      this.pending.set(req_id, { resolve, reject });
      this.ws.send(JSON.stringify({ ...payload, req_id }));
    });
  }

  subscribeTicks(symbol) {
    return this._send({ ticks: symbol, subscribe: 1 });
  }

  getProposal(params) {
    return this._send({ proposal: 1, ...params });
  }

  buyContract(proposalId, price) {
    return this._send({ buy: proposalId, price });
  }

  sellContract(contractId, price = 0) {
    return this._send({ sell: contractId, price });
  }

  getOpenPositions() {
    return this._send({ portfolio: 1 });
  }

  subscribeContract(contractId) {
    return this._send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
  }
}

module.exports = DerivClient;
