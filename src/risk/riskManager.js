const { logEvent } = require('../logging/decisionLog');

/**
 * All trade-permission decisions run through here first.
 *
 * dailyLossLimit is passed in (not read from a single global config) because
 * it differs between demo and live: live uses the fixed $2 cap agreed on;
 * demo uses a percentage of the (much larger) demo balance, since it's not
 * real money and the goal is gathering enough trades quickly, not protecting
 * capital. See index.js for how each is computed.
 */
class RiskManager {
  constructor(startingBalance, dailyLossLimit, riskPerTradePct) {
    this.balance = startingBalance;
    this.dayStartBalance = startingBalance;
    this.dayKey = this._todayKey();
    this.halted = false;
    this.haltedForAuthIssue = false;
    this.dailyLossLimit = dailyLossLimit;
    this.riskPerTradePct = riskPerTradePct;
    this._loggedDailyLimitHitToday = false;
  }

  _todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  _rolloverDayIfNeeded() {
    const today = this._todayKey();
    if (today !== this.dayKey) {
      this.dayKey = today;
      this.dayStartBalance = this.balance;
      this._loggedDailyLimitHitToday = false;
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
    if (this.todaysLoss() >= this.dailyLossLimit) {
      if (!this._loggedDailyLimitHitToday) {
        logEvent({ type: 'daily_loss_limit_hit', loss: this.todaysLoss(), limit: this.dailyLossLimit });
        this._loggedDailyLimitHitToday = true; // log once per day, not on every tick
      }
      return false;
    }
    return true;
  }

  /** Stake size for the next trade — rounded to 2 decimals, since Deriv rejects finer amounts */
  getPositionSize() {
    const raw = this.balance * (this.riskPerTradePct / 100);
    const remainingDailyAllowance = this.dailyLossLimit - this.todaysLoss();
    const capped = Math.max(0, Math.min(raw, remainingDailyAllowance));
    return Math.floor(capped * 100) / 100;
  }

  /** Called when switching between demo/live, or if the demo balance moves meaningfully */
  setDailyLossLimit(limit) {
    this.dailyLossLimit = limit;
    logEvent({ type: 'daily_loss_limit_updated', limit });
  }

  haltTrading(reason) {
    this.halted = true;
    this.haltedForAuthIssue = false;
    logEvent({ type: 'manual_halt', reason });
  }

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
