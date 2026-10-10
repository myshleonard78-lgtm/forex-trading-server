const { getLosingDigits } = require('./digitPatternHelpers');

/**
 * Scans candidate barriers and picks whichever currently gives the best
 * edge — i.e. its losing digits are colder than "fair" (10% each) by at
 * least minEdgePct. Returns null if nothing clears that bar.
 */
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

/** Picks the coldest or hottest digit as the Match/Differ target, if its deviation from fair (10%) clears minEdgePct */
function pickTargetDigit(selection, digitStats, minEdgePct) {
  const sorted = [...digitStats].sort((a, b) => (selection === 'coldest' ? a.pct - b.pct : b.pct - a.pct));
  const target = sorted[0];
  const edge = Math.abs(target.pct - 10);
  return edge >= minEdgePct ? { digit: target.digit, pct: target.pct, edge } : null;
}

/** Current even vs odd split, and which side is currently less frequent */
function computeEvenOddSkew(digitStats) {
  const evenPct = digitStats.filter((d) => d.digit % 2 === 0).reduce((s, d) => s + d.pct, 0);
  const oddPct = digitStats.filter((d) => d.digit % 2 === 1).reduce((s, d) => s + d.pct, 0);
  const skew = Math.abs(evenPct - oddPct);
  const lessFrequentSide = evenPct < oddPct ? 'even' : 'odd';
  return { evenPct, oddPct, skew, lessFrequentSide };
}

module.exports = { pickBestBarrier, pickTargetDigit, computeEvenOddSkew };
