const config = require('../config');
const { logEvent } = require('../logging/decisionLog');

/**
 * One StrategyTrial per candidate strategy running on the demo account.
 * All demo trades MUST be sized as if on the live account (see riskManager),
 * so results are representative of real conditions — never let a demo
 * trial size trades using the demo account's large/unlimited balance.
 */
class StrategyTrial {
  constructor(strategyId) {
    this.strategyId = strategyId;
    this.trades = []; // { pnl, timestamp }
    this.startedAt = new Date();
    this.peakBalance = 0;
    this.runningBalance = 0;
    this.status = 'active'; // active | promoted | demoted | discarded
  }

  recordTrade(pnl) {
    this.trades.push({ pnl, timestamp: new Date() });
    this.runningBalance += pnl;
    this.peakBalance = Math.max(this.peakBalance, this.runningBalance);
  }

  get tradeCount() {
    return this.trades.length;
  }

  get winRatePct() {
    if (this.trades.length === 0) return 0;
    const wins = this.trades.filter((t) => t.pnl > 0).length;
    return (wins / this.trades.length) * 100;
  }

  get profitFactor() {
    const gains = this.trades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
    const losses = Math.abs(
      this.trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0)
    );
    if (losses === 0) return gains > 0 ? Infinity : 0;
    return gains / losses;
  }

  get drawdownPct() {
    if (this.peakBalance <= 0) return 0;
    return ((this.peakBalance - this.runningBalance) / this.peakBalance) * 100;
  }

  get daysRunning() {
    return (Date.now() - this.startedAt.getTime()) / (1000 * 60 * 60 * 24);
  }

  /** Trades from the last 24h — used for the daily WhatsApp summary */
  todaysTrades() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return this.trades.filter((t) => t.timestamp.getTime() >= cutoff);
  }

  /** Has this trial run long enough that a decision must be made? */
  isDueForEvaluation(maxDaysAllowed) {
    return this.tradeCount >= config.gate.minTrades || this.daysRunning >= maxDaysAllowed;
  }

  /** Full gate check: returns 'promote' | 'discard' | 'extend' */
  evaluate(elapsedTrialDays) {
    if (this.drawdownPct >= config.gate.maxDemoDrawdownPct) {
      return 'discard'; // drawdown breach ends it regardless of trade count
    }

    if (this.tradeCount < config.gate.minTrades) {
      // Not enough data yet — extend if there's still runway, else discard
      const usedUp = elapsedTrialDays >= config.gate.maxTrialDays;
      return usedUp ? 'discard' : 'extend';
    }

    const passes =
      this.winRatePct >= config.gate.minWinRatePct &&
      this.profitFactor >= config.gate.minProfitFactor;

    return passes ? 'promote' : 'discard';
  }
}

class TrialManager {
  constructor() {
    this.trials = new Map(); // strategyId -> StrategyTrial
    this.trialStartedAt = new Date();
  }

  startTrial(strategyId) {
    const trial = new StrategyTrial(strategyId);
    this.trials.set(strategyId, trial);
    logEvent({ type: 'trial_started', strategyId });
    return trial;
  }

  recordTrade(strategyId, pnl) {
    const trial = this.trials.get(strategyId);
    if (!trial) throw new Error(`No active trial for ${strategyId}`);
    trial.recordTrade(pnl);
  }

  /** Run this on a schedule (e.g. daily) to sweep all active trials for decisions */
  evaluateAll() {
    const elapsedTrialDays = (Date.now() - this.trialStartedAt.getTime()) / 86400000;
    const decisions = [];

    for (const trial of this.trials.values()) {
      if (trial.status !== 'active') continue;
      const verdict = trial.evaluate(elapsedTrialDays);

      if (verdict === 'promote') {
        trial.status = 'promoted';
        logEvent({
          type: 'strategy_promoted',
          strategyId: trial.strategyId,
          winRatePct: trial.winRatePct,
          profitFactor: trial.profitFactor,
          tradeCount: trial.tradeCount,
        });
      } else if (verdict === 'discard') {
        trial.status = 'discarded';
        logEvent({
          type: 'strategy_discarded',
          strategyId: trial.strategyId,
          winRatePct: trial.winRatePct,
          profitFactor: trial.profitFactor,
          tradeCount: trial.tradeCount,
          drawdownPct: trial.drawdownPct,
        });
      }
      // 'extend' -> leave status as 'active', just keep collecting trades

      decisions.push({ strategyId: trial.strategyId, verdict });
    }

    return decisions;
  }

  /** Among currently-eligible (>= min trades) active/promoted trials, rank by profit factor */
  rankEligible() {
    return [...this.trials.values()]
      .filter((t) => t.tradeCount >= config.gate.minTrades)
      .sort((a, b) => b.profitFactor - a.profitFactor);
  }
}

module.exports = { TrialManager, StrategyTrial };
