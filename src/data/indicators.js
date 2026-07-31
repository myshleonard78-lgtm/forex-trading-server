/**
 * Standard 14-period RSI (Wilder's smoothing). Feed it prices in chronological
 * order (oldest first); returns null until there's enough history to compute.
 */
function computeRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;

  const relevant = prices.slice(-(period + 1));
  let gains = 0;
  let losses = 0;

  for (let i = 1; i < relevant.length; i++) {
    const change = relevant[i] - relevant[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

module.exports = { computeRSI };
