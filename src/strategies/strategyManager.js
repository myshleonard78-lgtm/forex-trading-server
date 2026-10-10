const TradeExecutor = require('../execution/tradeExecutor');
const DigitPatternExecutor = require('../execution/digitPatternExecutor');
const AdaptiveDigitExecutor = require('../execution/adaptiveDigitExecutor');
const { makeRuleStrategy } = require('./ruleStrategy');
const { logEvent } = require('../logging/decisionLog');

/**
 * Owns the live set of strategies: creates an executor + trial for each,
 * and can add/remove strategies at runtime without a redeploy. Supports
 * three executor kinds — indicator-threshold (TradeExecutor), fixed digit
 * pattern (DigitPatternExecutor), and adaptive digit targeting
 * (AdaptiveDigitExecutor) — behind one common add/remove/start interface.
 */
class StrategyManager {
  constructor({ deriv, priceFeed, riskManager, trialManager }) {
    this.deriv = deriv;
    this.priceFeed = priceFeed;
    this.riskManager = riskManager;
    this.trialManager = trialManager;
    this.executors = new Map(); // id -> executor (TradeExecutor | DigitPatternExecutor)
  }

  /** Register a strategy object directly (used at startup for hand-written strategies) */
  addStrategyObject(strategy) {
    const executor = new TradeExecutor({
      strategy,
      deriv: this.deriv,
      priceFeed: this.priceFeed,
      riskManager: this.riskManager,
      trialManager: this.trialManager,
    });
    this._register(strategy.id, strategy.symbol, executor);
    return executor;
  }

  /** Add a strategy from a plain-data definition. def.kind: 'rsi' (default) | 'digit-pattern' | 'adaptive-digit' */
  addFromDefinition(def) {
    if (this.executors.has(def.id)) {
      throw new Error(`Strategy id "${def.id}" already exists`);
    }

    if (def.kind === 'digit-pattern') {
      const executor = new DigitPatternExecutor({
        definition: def,
        deriv: this.deriv,
        riskManager: this.riskManager,
        trialManager: this.trialManager,
      });
      this._register(def.id, def.symbol, executor);
      return executor;
    }

    if (def.kind === 'adaptive-digit') {
      const executor = new AdaptiveDigitExecutor({
        definition: def,
        deriv: this.deriv,
        riskManager: this.riskManager,
        trialManager: this.trialManager,
      });
      this._register(def.id, def.symbol, executor);
      return executor;
    }

    const strategy = makeRuleStrategy(def);
    return this.addStrategyObject(strategy);
  }

  _register(id, symbol, executor) {
    this.executors.set(id, executor);
    this.trialManager.startTrial(id);
    if (this.deriv.authorized) executor.start();
    logEvent({ type: 'strategy_added', strategyId: id, symbol });
  }

  removeStrategy(id) {
    const executor = this.executors.get(id);
    if (!executor) throw new Error(`No strategy with id "${id}"`);
    executor.stop();
    this.executors.delete(id);
    logEvent({ type: 'strategy_removed', strategyId: id });
  }

  startAll() {
    this.executors.forEach((executor) => executor.start());
  }

  findExecutorForSymbol(symbol) {
    return [...this.executors.values()].find((e) => e.strategy.symbol === symbol);
  }
}

module.exports = StrategyManager;
