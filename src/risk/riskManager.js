const config = require('../config');
const { logEvent } = require('../logging/decisionLog');

/**
 * All trade-permission decisions run through here first.
 * Nothing executes a trade without checking canTrade() and getPositionSize().
 */
class RiskManager {
  constructor(startingBalance) {
    this.balance = startingBalance;
    this.dayStartBalance = startingBalance;
    this.dayKey = this._todayKey();
    this.halted = false; // manual kill switch
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

  /** Call after every closed trade to update balance and daily P&L tracking */
  recordTradeResult(pnl) {
    this.balance += pnl;
    this._rolloverDayIfNeeded();
  }

  /** Today's realized loss so far, as a positive number (0 if in profit) */
  todaysLoss() {
    this._rolloverDayIfNeeded();
    return Math.max(0, this.dayStartBalance - this.balance);
  }

  /** True if trading is currently allowed */
  canTrade() {
    if (this.halted) return false;
    this._rolloverDayIfNeeded();
    if (this.todaysLoss() >= config.risk.dailyLossLimit) {
      logEvent({ type: 'daily_loss_limit_hit', loss: this.todaysLoss() });
      return false;
    }
    return true;
  }

  /** Stake size for the next trade, based on % risk of current balance */
  getPositionSize() {
    const raw = this.balance * (config.risk.riskPerTradePct / 100);
    // Never risk more than what's left of today's allowance
    const remainingDailyAllowance = config.risk.dailyLossLimit - this.todaysLoss();
    return Math.max(0, Math.min(raw, remainingDailyAllowance));
  }

  haltTrading(reason) {
    this.halted = true;
    logEvent({ type: 'manual_halt', reason });
  }

  resumeTrading() {
    this.halted = false;
    logEvent({ type: 'manual_resume' });
  }
}

module.exports = RiskManager;
