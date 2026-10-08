/**
 * Shared between live execution and backtesting: computes which digits
 * would LOSE the trade for Over/Under contracts, given the barrier.
 * Over X: digit > X wins, so 0..X lose.
 * Under X: digit < X wins, so X..9 lose.
 * Match/Differ/Even/Odd don't have a clean "losing digit set" the same
 * way, so this returns null for those — the check is simply skipped.
 */
function getLosingDigits(contractType, barrierDigit) {
  if (contractType === 'DIGITOVER') {
    return Array.from({ length: barrierDigit + 1 }, (_, i) => i); // 0..barrier
  }
  if (contractType === 'DIGITUNDER') {
    return Array.from({ length: 10 - barrierDigit }, (_, i) => barrierDigit + i); // barrier..9
  }
  return null;
}

/** True if every losing digit is currently at or below maxPct (skips the check if not applicable) */
function losingDigitsUnderThreshold(contractType, barrierDigit, maxPct, digitStatsArray) {
  if (!maxPct) return true; // no threshold set — don't block
  const losingDigits = getLosingDigits(contractType, barrierDigit);
  if (!losingDigits) return true; // not applicable to this contract type
  return losingDigits.every((d) => digitStatsArray[d].pct <= maxPct);
}

module.exports = { getLosingDigits, losingDigitsUnderThreshold };
