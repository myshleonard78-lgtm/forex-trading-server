/**
 * Computes last-digit frequency distribution from a list of prices — the
 * basis for digit-based contracts (Over/Under, Matches/Differs, Even/Odd).
 * Deriv's synthetic indices quote prices to a fixed number of decimals per
 * symbol; the "digit" is the final decimal digit of each tick.
 */
function detectDecimals(prices) {
  let maxDecimals = 0;
  for (const p of prices.slice(0, 50)) {
    const str = String(p);
    const dot = str.indexOf('.');
    if (dot !== -1) maxDecimals = Math.max(maxDecimals, str.length - dot - 1);
  }
  return maxDecimals || 2; // most Deriv synthetics use 2 decimals
}

function lastDigitOf(price, decimals) {
  const fixed = Number(price).toFixed(decimals);
  return Number(fixed[fixed.length - 1]);
}

function computeDigitStats(prices) {
  const decimals = detectDecimals(prices);
  const counts = new Array(10).fill(0);

  prices.forEach((p) => {
    const digit = lastDigitOf(p, decimals);
    counts[digit]++;
  });

  const total = prices.length;
  const stats = counts.map((count, digit) => ({
    digit,
    count,
    pct: total ? Math.round((count / total) * 1000) / 10 : 0,
    rank: null,
  }));

  // Rank only the extremes, as requested: most, 2nd-most, 2nd-least, least
  const sorted = [...stats].sort((a, b) => b.count - a.count);
  if (sorted.length >= 4) {
    sorted[0].rank = 'most';
    sorted[1].rank = '2nd-most';
    sorted[sorted.length - 2].rank = '2nd-least';
    sorted[sorted.length - 1].rank = 'least';
  }

  return { decimals, sampleSize: total, digits: stats };
}

module.exports = { computeDigitStats, detectDecimals, lastDigitOf };
