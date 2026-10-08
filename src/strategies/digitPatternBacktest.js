const { computeDigitStats } = require('../market/digitStats');
const { losingDigitsUnderThreshold } = require('./digitPatternHelpers');

/**
 * Replays a digit-pattern definition against historical ticks to estimate
 * how it would have performed, before it ever risks a real (demo) trade.
 *
 * SIMPLIFICATION, stated plainly: hot/cold rank is computed ONCE from the
 * full historical sample (a static snapshot), not recomputed tick-by-tick
 * as a true rolling window would be. Live trading uses a real rolling
 * window (see digitWindow.js) — this backtest is a reasonable approximation
 * for a quick preview, not a perfect simulation of live conditions.
 */
function backtestDigitPattern(def, prices) {
  const stats = computeDigitStats(prices);
  const rankByDigit = {};
  stats.digits.forEach((d) => { rankByDigit[d.digit] = d.rank; });

  const rankSatisfies = (rank, requirement) => {
    if (requirement === 'any') return true;
    if (requirement === 'normal') return rank === null;
    if (requirement === 'hot') return rank === 'most' || rank === '2nd-most';
    if (requirement === 'cold') return rank === '2nd-least' || rank === 'least';
    return false;
  };

  const decimals = stats.decimals;
  const digits = prices.map((p) => Number(Number(p).toFixed(decimals)).toString().slice(-1)).map(Number);

  const barrierOk = rankSatisfies(rankByDigit[def.barrierDigit], def.barrierMustBe || 'any');
  const entryOk = (digit) => rankSatisfies(rankByDigit[digit], def.entryMustBe || 'any');
  const losingDigitsOk = losingDigitsUnderThreshold(def.contractType, def.barrierDigit, def.maxLosingDigitPct, stats.digits);

  let armed = true;
  let wins = 0, losses = 0;
  const trades = [];

  for (let i = (def.priorDigitsBack || 1); i < digits.length; i++) {
    const digit = digits[i];

    if ((def.resetDigits || []).includes(digit)) {
      armed = true;
      continue;
    }

    if (!armed) continue;
    if (!(def.entryDigits || []).includes(digit)) continue;
    if (!entryOk(digit)) continue;
    if (!barrierOk) continue;
    if (!losingDigitsOk) continue;

    const priorDigit = digits[i - (def.priorDigitsBack || 1)];
    if ((def.excludeIfPriorDigitIn || []).includes(priorDigit)) continue;

    // Entry "taken" — evaluate outcome using the actual next tick's digit
    // against the contract's win condition (this part mirrors real contract rules)
    const resultDigit = digits[i + 1];
    if (resultDigit === undefined) break;

    let won = false;
    if (def.contractType === 'DIGITOVER') won = resultDigit > def.barrierDigit;
    else if (def.contractType === 'DIGITUNDER') won = resultDigit < def.barrierDigit;
    else if (def.contractType === 'DIGITMATCH') won = resultDigit === def.barrierDigit;
    else if (def.contractType === 'DIGITDIFF') won = resultDigit !== def.barrierDigit;
    else if (def.contractType === 'DIGITEVEN') won = resultDigit % 2 === 0;
    else if (def.contractType === 'DIGITODD') won = resultDigit % 2 === 1;

    won ? wins++ : losses++;
    trades.push({ index: i, entryDigit: digit, priorDigit, resultDigit, won });
    armed = false; // combined gate, same as live: must see a reset digit before next entry
  }

  const total = wins + losses;
  return {
    sampleSize: prices.length,
    simulatedEntries: total,
    wins,
    losses,
    winRatePct: total ? Math.round((wins / total) * 1000) / 10 : 0,
    note: 'Approximation: hot/cold ranks use a static snapshot of the full sample, not a true tick-by-tick rolling window.',
  };
}

module.exports = { backtestDigitPattern };
