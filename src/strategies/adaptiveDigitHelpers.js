const { getLosingDigits } = require('./digitPatternHelpers');

function pickBestBarrier(direction, digitStats, minEdgePct, barrierRange) {
  const range = barrierRange || (direction === 'DIGITOVER' ? [0, 7] : [2, 9]);
  let best = null;
  for (let b = range[0]; b <= range[1]; b++) {
    const losingDigits = getLosingDigits(direction, b);
    if (!losingDigits) continue;
    const losingPct = losingDigits.reduce((s, d) => s + digitStats[d].pct, 0);
    const fairPct = losingDigits.length * 10;
    const edge = fairPct - losingPct;
    if (!best || edge > best.edge) best = { barrier: b, edge, losingPct, fairPct };
  }
  return best && best.edge >= minEdgePct ? best : null;
}

function pickTargetDigit(selection, digitStats, minEdgePct) {
  const sorted = [...digitStats].sort((a, b) => (selection === 'coldest' ? a.pct - b.pct : b.pct - a.pct));
  const target = sorted[0];
  const edge = Math.abs(target.pct - 10);
  return edge >= minEdgePct ? { digit: target.digit, pct: target.pct, edge } : null;
}

function computeEvenOddSkew(digitStats) {
  const evenPct = digitStats.filter((d) => d.digit % 2 === 0).reduce((s, d) => s + d.pct, 0);
  const oddPct = digitStats.filter((d) => d.digit % 2 === 1).reduce((s, d) => s + d.pct, 0);
  const skew = Math.abs(evenPct - oddPct);
  const lessFrequentSide = evenPct < oddPct ? 'even' : 'odd';
  return { evenPct, oddPct, skew, lessFrequentSide };
}

/**
 * Splits digits into the "Under" group (0-4) and "Over" group (5-9) and
 * reports which side currently dominates. Used for the group-threshold
 * strategy style: trade a FIXED barrier (not a scanned optimal one) once
 * one group's share crosses a threshold (e.g. 70%).
 */
function computeGroupSkew(digitStats) {
  const underPct = digitStats.filter((d) => d.digit <= 4).reduce((s, d) => s + d.pct, 0);
  const overPct = digitStats.filter((d) => d.digit >= 5).reduce((s, d) => s + d.pct, 0);
  const skew = Math.abs(overPct - underPct);
  const strongerSide = overPct > underPct ? 'over' : 'under';
  return { underPct, overPct, skew, strongerSide };
}

module.exports = { pickBestBarrier, pickTargetDigit, computeEvenOddSkew, computeGroupSkew };
