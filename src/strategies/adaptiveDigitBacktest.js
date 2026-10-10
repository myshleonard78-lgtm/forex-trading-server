const { computeDigitStats } = require('../market/digitStats');
const { pickBestBarrier, pickTargetDigit, computeEvenOddSkew } = require('./adaptiveDigitHelpers');

const ROLLING_WINDOW = 200;

/**
 * True rolling backtest — unlike the fixed-rule pattern backtest (which
 * uses one static snapshot of the full sample), this recomputes hot/cold
 * stats fresh from the preceding 200 ticks at EVERY point as it scans
 * through history. That matches how the live executor actually behaves,
 * since "adaptive" is specifically about recalculating continuously.
 */
function backtestAdaptiveDigit(def, prices) {
  const decimals = computeDigitStats(prices.slice(0, 50)).decimals;
  const digits = prices.map((p) => Number(Number(p).toFixed(decimals)).toString().slice(-1)).map(Number);

  let wins = 0, losses = 0;
  const minEdgePct = def.minEdgePct || (def.mode === 'even-odd' ? 5 : 3);

  for (let i = ROLLING_WINDOW; i < digits.length - 1; i++) {
    const windowDigits = digits.slice(i - ROLLING_WINDOW, i);
    const counts = new Array(10).fill(0);
    windowDigits.forEach((d) => counts[d]++);
    const stats = counts.map((count, digit) => ({ digit, pct: (count / ROLLING_WINDOW) * 100 }));

    let plan = null;
    if (def.mode === 'over-under') {
      const result = pickBestBarrier(def.direction, stats, minEdgePct);
      if (result) plan = { contractType: def.direction, barrier: result.barrier };
    } else if (def.mode === 'matches-differs') {
      const result = pickTargetDigit(def.targetSelection || 'coldest', stats, minEdgePct);
      if (result) plan = { contractType: def.direction, barrier: result.digit };
    } else if (def.mode === 'even-odd') {
      const result = computeEvenOddSkew(stats);
      if (result.skew >= minEdgePct) {
        const biasMode = def.biasMode || 'reversion';
        const side = biasMode === 'reversion' ? result.lessFrequentSide : (result.lessFrequentSide === 'even' ? 'odd' : 'even');
        plan = { contractType: side === 'even' ? 'DIGITEVEN' : 'DIGITODD', barrier: null };
      }
    }

    if (!plan) continue;

    const resultDigit = digits[i + 1];
    let won = false;
    if (plan.contractType === 'DIGITOVER') won = resultDigit > plan.barrier;
    else if (plan.contractType === 'DIGITUNDER') won = resultDigit < plan.barrier;
    else if (plan.contractType === 'DIGITMATCH') won = resultDigit === plan.barrier;
    else if (plan.contractType === 'DIGITDIFF') won = resultDigit !== plan.barrier;
    else if (plan.contractType === 'DIGITEVEN') won = resultDigit % 2 === 0;
    else if (plan.contractType === 'DIGITODD') won = resultDigit % 2 === 1;

    won ? wins++ : losses++;
  }

  const total = wins + losses;
  return {
    sampleSize: prices.length,
    simulatedEntries: total,
    wins,
    losses,
    winRatePct: total ? Math.round((wins / total) * 1000) / 10 : 0,
    note: 'True rolling backtest — hot/cold stats recomputed fresh from the preceding 200 ticks at every point, matching how live trading actually evaluates it.',
  };
}

module.exports = { backtestAdaptiveDigit };
