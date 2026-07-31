/**
 * Every strategy is a plain object with an id and a signal function.
 * Strategies sourced from social media should be converted into this exact
 * shape by a parsing step BEFORE they ever reach the trial manager — vague
 * posts ("market feels bullish") that can't be expressed as a concrete rule
 * should be filtered out at that parsing step, not passed through.
 *
 * signal(marketData) returns one of: 'buy' | 'sell' | 'hold'
 */
function exampleRsiStrategy() {
  return {
    id: 'rsi-reversion-v1',
    symbol: 'R_100', // Deriv synthetic index, or your chosen FX pair
    signal(marketData) {
      const { rsi } = marketData; // assumes an indicator pipeline computes this upstream
      if (rsi < 30) return 'buy';
      if (rsi > 70) return 'sell';
      return 'hold';
    },
  };
}

module.exports = { exampleRsiStrategy };
