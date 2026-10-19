const { computeDigitStats } = require('../market/digitStats');
const { pickBestBarrier, pickTargetDigit, computeEvenOddSkew, computeGroupSkew } = require('./adaptiveDigitHelpers');

/**
 * True rolling backtest — recomputes hot/cold stats fresh from the
 * preceding windowSize ticks at EVERY point as it scans through history,
 * matching how the live executor actually behaves. windowSize comes from
 * the strategy definition (def.windowSize), so a 50-tick or 30-tick
 * strategy is backtested with that same short lookback, not a generic one.
 *
 * Approximates the pause-circuit-breaker by skipping entries for roughly
 * pauseMinutes worth of ticks after maxConsecutiveLosses is hit, assuming
 * ~1 tick/second (Deriv's synthetic indices tick at a fixed, steady rate) —
 * stated plainly as an approximation, not an exact replay of pause timing.
 */
function backtestAdaptiveDigit(def, prices) {
  const windowSize = def.windowSize || 200;
  const decimals = computeDigitStats(prices.slice(0, 50)).decimals;
  const digits = prices.map((p) => Number(Number(p).toFixed(decimals)).toString().slice(-1)).map(Number);

  let wins = 0, losses = 0;
  let consecutiveLosses = 0;
  let pausedUntilIndex = -1;
  const minEdgePct = def.minEdgePct || (def.mode === 'even-odd' ? 5 : 3);
  const approxTicksPerSecond = 1;

  for (let i = windowSize; i < digits.length - 1; i++) {
    if (i < pausedUntilIndex) continue;

    const windowDigits = digits.slice(i - windowSize, i);
    const counts = new Array(10).fill(0);
    windowDigits.forEach((d) => counts[d]++);
    const stats = counts.map((count, digit) => ({ digit, pct: (count / windowSize) * 100 }));

    let plan = null;
    if (def.mode === 'over-under') {
      const result = pickBestBarrier(def.direction, stats, minEdgePct);
      if (result) plan = { contractType: def.direction, barrier: result.barrier };
    } else if (def.mode === 'over-under-group') {
      const result = computeGroupSkew(stats);
      const threshold = def.groupThresholdPct || 70;
      if ((result.strongerSide === 'over' ? result.overPct : result.underPct) >= threshold) {
        plan = { contractType: result.strongerSide === 'over' ? 'DIGITOVER' : 'DIGITUNDER', barrier: def.barrierDigit };
      }
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

    if (won) {
      wins++;
      consecutiveLosses = 0;
    } else {
      losses++;
      consecutiveLosses++;
      if (def.maxConsecutiveLosses && consecutiveLosses >= def.maxConsecutiveLosses && def.pauseMinutes) {
        pausedUntilIndex = i + def.pauseMinutes * 60 * approxTicksPerSecond;
        consecutiveLosses = 0;
      }
    }
  }

  const total = wins + losses;
  return {
    sampleSize: prices.length,
    simulatedEntries: total,
    wins,
    losses,
    winRatePct: total ? Math.round((wins / total) * 1000) / 10 : 0,
    note: `True rolling backtest using a ${windowSize}-tick window, recomputed at every point. Pause-after-losses is approximated assuming ~1 tick/second — real pause timing may differ slightly.`,
  };
}

module.exports = { backtestAdaptiveDigit };
