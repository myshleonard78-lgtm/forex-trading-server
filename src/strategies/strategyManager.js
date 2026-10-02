const TradeExecutor = require('../execution/tradeExecutor');
const { makeRuleStrategy } = require('./ruleStrategy');
const { logEvent } = require('../logging/decisionLog');

/**
 * Owns the live set of strategies: creates an executor + trial for each,
 * and can add/remove strategies at runtime (e.g. from the dashboard) without
 * a redeploy.
 */
class StrategyManager {
  constructor({ deriv, priceFeed, riskManager, trialManager }) {
    this.deriv = deriv;
    this.priceFeed = priceFeed;
    this.riskManager = riskManager;
    this.trialManager = trialManager;
    this.executors = new Map(); // id -> TradeExecutor
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
    this.executors.set(strategy.id, executor);
    this.trialManager.startTrial(strategy.id);
    if (this.deriv.authorized) executor.start();
    logEvent({ type: 'strategy_added', strategyId: strategy.id, symbol: strategy.symbol });
    return executor;
  }

  /** Add a strategy from a plain-data definition (e.g. from the dashboard's strategy chat) */
  addFromDefinition(def) {
    if (this.executors.has(def.id)) {
      throw new Error(`Strategy id "${def.id}" already exists`);
    }
    const strategy = makeRuleStrategy(def);
    return this.addStrategyObject(strategy);
  }

  removeStrategy(id) {
    const executor = this.executors.get(id);
    if (!executor) throw new Error(`No strategy with id "${id}"`);
    executor.stop();
    this.executors.delete(id);
    logEvent({ type: 'strategy_removed', strategyId: id });
  }

  /** Called once the Deriv connection is (re)established */
  startAll() {
    this.executors.forEach((executor) => executor.start());
  }

  /** Match an open contract (from reconnect recovery) to its owning executor */
  findExecutorForSymbol(symbol) {
    return [...this.executors.values()].find((e) => e.strategy.symbol === symbol);
  }
}

module.exports = StrategyManager;
