const TradeExecutor = require('../execution/tradeExecutor');
const DigitPatternExecutor = require('../execution/digitPatternExecutor');
const AdaptiveDigitExecutor = require('../execution/adaptiveDigitExecutor');
const { makeRuleStrategy } = require('./ruleStrategy');
const { logEvent } = require('../logging/decisionLog');
const db = require('../persistence/db');

/**
 * Owns the live set of strategies: creates an executor + trial for each,
 * and can add/remove strategies at runtime without a redeploy. Supports
 * three executor kinds — indicator-threshold (TradeExecutor), fixed digit
 * pattern (DigitPatternExecutor), and adaptive digit targeting
 * (AdaptiveDigitExecutor) — behind one common add/remove/start interface.
 * Persists every strategy's definition + trades to Supabase so progress
 * survives restarts/redeploys instead of resetting to zero every time.
 */
class StrategyManager {
  constructor({ deriv, priceFeed, riskManager, trialManager }) {
    this.deriv = deriv;
    this.priceFeed = priceFeed;
    this.riskManager = riskManager;
    this.trialManager = trialManager;
    this.executors = new Map();
  }

  addStrategyObject(strategy, { skipPersist = false, startedAt } = {}) {
    const executor = new TradeExecutor({
      strategy,
      deriv: this.deriv,
      priceFeed: this.priceFeed,
      riskManager: this.riskManager,
      trialManager: this.trialManager,
    });
    if (!skipPersist) {
      db.saveStrategy({ id: strategy.id, kind: 'rsi', definition: { symbol: strategy.symbol } });
    }
    this._register(strategy.id, strategy.symbol, executor, startedAt);
    return executor;
  }

  addFromDefinition(def, { skipPersist = false, startedAt } = {}) {
    if (this.executors.has(def.id)) {
      throw new Error(`Strategy id "${def.id}" already exists`);
    }
    if (!skipPersist) {
      db.saveStrategy({ id: def.id, kind: def.kind || 'rule', definition: def });
    }

    if (def.kind === 'digit-pattern') {
      const executor = new DigitPatternExecutor({
        definition: def,
        deriv: this.deriv,
        riskManager: this.riskManager,
        trialManager: this.trialManager,
      });
      this._register(def.id, def.symbol, executor, startedAt);
      return executor;
    }

    if (def.kind === 'adaptive-digit') {
      const executor = new AdaptiveDigitExecutor({
        definition: def,
        deriv: this.deriv,
        riskManager: this.riskManager,
        trialManager: this.trialManager,
      });
      this._register(def.id, def.symbol, executor, startedAt);
      return executor;
    }

    const strategy = makeRuleStrategy(def);
    return this.addStrategyObject(strategy, { skipPersist: true, startedAt });
  }

  _register(id, symbol, executor, startedAt) {
    this.executors.set(id, executor);
    this.trialManager.startTrial(id, startedAt);
    if (this.deriv.authorized) executor.start();
    logEvent({ type: 'strategy_added', strategyId: id, symbol });
  }

  removeStrategy(id, status = 'removed') {
    const executor = this.executors.get(id);
    if (!executor) throw new Error(`No strategy with id "${id}"`);
    executor.stop();
    this.executors.delete(id);
    db.markStrategyStatus(id, status);
    logEvent({ type: 'strategy_removed', strategyId: id, status });
  }

  startAll() {
    this.executors.forEach((executor) => executor.start());
  }

  findExecutorForSymbol(symbol) {
    return [...this.executors.values()].find((e) => e.strategy.symbol === symbol);
  }
}

module.exports = StrategyManager;
    
