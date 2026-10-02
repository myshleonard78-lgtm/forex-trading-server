/**
 * Builds a strategy object (matching the {id, symbol, signal()} shape
 * TradeExecutor expects) from a plain-data definition — so strategies can be
 * created at runtime from a description, not just hand-written in code.
 *
 * Definition shape:
 * {
 *   id: "my-strategy-1",
 *   symbol: "R_100",
 *   indicator: "rsi",               // only "rsi" supported for now
 *   buyWhen:  { operator: "<", value: 30 },   // e.g. buy when RSI < 30
 *   sellWhen: { operator: ">", value: 70 },   // e.g. sell when RSI > 70
 *   description: "Buy oversold, sell overbought on the 100 volatility index"
 * }
 * Either buyWhen or sellWhen can be omitted if the strategy is one-directional.
 */
function evalCondition(value, condition) {
  if (!condition) return false;
  const { operator, value: threshold } = condition;
  switch (operator) {
    case '<': return value < threshold;
    case '<=': return value <= threshold;
    case '>': return value > threshold;
    case '>=': return value >= threshold;
    case '==': return value === threshold;
    default: return false;
  }
}

function makeRuleStrategy(def) {
  return {
    id: def.id,
    symbol: def.symbol || 'R_100',
    definition: def, // kept for display/debugging on the dashboard
    signal(marketData) {
      const value = marketData[def.indicator || 'rsi'];
      if (value === undefined) return 'hold';
      if (evalCondition(value, def.buyWhen)) return 'buy';
      if (evalCondition(value, def.sellWhen)) return 'sell';
      return 'hold';
    },
  };
}

module.exports = { makeRuleStrategy, evalCondition };

