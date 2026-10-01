const config = require('../config');
const { logEvent } = require('../logging/decisionLog');

class StrategyTrial {
  constructor(strategyId) {
    this.strategyId = strategyId;
    this.trades = [];
    this.startedAt = new Date();
    this.peakBalance = 0;
    this.runningBalance = 0;
    this.status = 'active';
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
    const losses = Math.abs(this.trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
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

  todaysTrades() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return this.trades.filter((t) => t.timestamp.getTime() >= cutoff);
  }

  isDueForEvaluation(maxDaysAllowed) {
    return this.tradeCount >= config.gate.minTrades || this.daysRunning >= maxDaysAllowed;
  }

  evaluate(elapsedTrialDays) {
    if (this.drawdownPct >= config.gate.maxDemoDrawdownPct) {
      return 'discard';
    }
    if (this.tradeCount < config.gate.minTrades) {
      const usedUp = elapsedTrialDays >= config.gate.maxTrialDays;
      return usedUp ? 'discard' : 'extend';
    }
    const passes =
      this.winRatePct >= config.gate.minWinRatePct && this.profitFactor >= config.gate.minProfitFactor;
    return passes ? 'promote' : 'discard';
  }

  /** Plain-object snapshot for the dashboard / API responses */
  toSummary() {
    return {
      strategyId: this.strategyId,
      status: this.status,
      tradeCount: this.tradeCount,
      winRatePct: Number(this.winRatePct.toFixed(1)),
      profitFactor: this.profitFactor === Infinity ? null : Number(this.profitFactor.toFixed(2)),
      drawdownPct: Number(this.drawdownPct.toFixed(1)),
      daysRunning: Number(this.daysRunning.toFixed(1)),
      gateMinTrades: config.gate.minTrades,
      gateMinWinRatePct: config.gate.minWinRatePct,
      gateMinProfitFactor: config.gate.minProfitFactor,
      recentTrades: this.trades.slice(-20).map((t) => ({ pnl: t.pnl, timestamp: t.timestamp })),
    };
  }
}

class TrialManager {
  constructor() {
    this.trials = new Map();
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

  evaluateAll() {
    const elapsedTrialDays = (Date.now() - this.trialStartedAt.getTime()) / 86400000;
    const decisions = [];

    for (const trial of this.trials.values()) {
      if (trial.status !== 'active') continue;
      const verdict = trial.evaluate(elapsedTrialDays);

      if (verdict === 'promote') {
        trial.status = 'promoted';
        logEvent({ type: 'strategy_promoted', strategyId: trial.strategyId, winRatePct: trial.winRatePct, profitFactor: trial.profitFactor, tradeCount: trial.tradeCount });
      } else if (verdict === 'discard') {
        trial.status = 'discarded';
        logEvent({ type: 'strategy_discarded', strategyId: trial.strategyId, winRatePct: trial.winRatePct, profitFactor: trial.profitFactor, tradeCount: trial.tradeCount, drawdownPct: trial.drawdownPct });
      }
      decisions.push({ strategyId: trial.strategyId, verdict });
    }
    return decisions;
  }

  rankEligible() {
    return [...this.trials.values()]
      .filter((t) => t.tradeCount >= config.gate.minTrades)
      .sort((a, b) => b.profitFactor - a.profitFactor);
  }

  /** All strategies' summaries — for the dashboard */
  toSummaryList() {
    return [...this.trials.values()].map((t) => t.toSummary());
  }
}

module.exports = { TrialManager, StrategyTrial };
