const config = require('../config');
const { logEvent } = require('../logging/decisionLog');

/**
 * All trade-permission decisions run through here first.
 */
class RiskManager {
  constructor(startingBalance) {
    this.balance = startingBalance;
    this.dayStartBalance = startingBalance;
    this.dayKey = this._todayKey();
    this.halted = false;
    this.haltedForAuthIssue = false; // true only when halted due to a Deriv connection problem, not a manual/user halt — lets us auto-resume once reconnected
  }

  _todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  _rolloverDayIfNeeded() {
    const today = this._todayKey();
    if (today !== this.dayKey) {
      this.dayKey = today;
      this.dayStartBalance = this.balance;
      logEvent({ type: 'daily_reset', balance: this.balance });
    }
  }

  recordTradeResult(pnl) {
    this.balance += pnl;
    this._rolloverDayIfNeeded();
  }

  todaysLoss() {
    this._rolloverDayIfNeeded();
    return Math.max(0, this.dayStartBalance - this.balance);
  }

  canTrade() {
    if (this.halted) return false;
    this._rolloverDayIfNeeded();
    if (this.todaysLoss() >= config.risk.dailyLossLimit) {
      logEvent({ type: 'daily_loss_limit_hit', loss: this.todaysLoss() });
      return false;
    }
    return true;
  }

  /** Stake size for the next trade — rounded to 2 decimals, since Deriv rejects finer amounts */
  getPositionSize() {
    const raw = this.balance * (config.risk.riskPerTradePct / 100);
    const remainingDailyAllowance = config.risk.dailyLossLimit - this.todaysLoss();
    const capped = Math.max(0, Math.min(raw, remainingDailyAllowance));
    return Math.floor(capped * 100) / 100; // floor, not round, so we never exceed the allowance
  }

  haltTrading(reason) {
    this.halted = true;
    this.haltedForAuthIssue = false;
    logEvent({ type: 'manual_halt', reason });
  }

  /** Halt specifically due to a Deriv connection/auth problem — recoverable automatically */
  haltForAuthIssue(reason) {
    this.halted = true;
    this.haltedForAuthIssue = true;
    logEvent({ type: 'auth_halt', reason });
  }

  resumeTrading() {
    this.halted = false;
    this.haltedForAuthIssue = false;
    logEvent({ type: 'manual_resume' });
  }
}

module.exports = RiskManager;
