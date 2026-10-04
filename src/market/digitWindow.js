/**
 * Maintains a rolling window (up to 1000) of recent tick digits/prices for
 * one symbol, fed from the live tick stream — so pattern strategies can
 * check "is this digit currently hot/cold" and "what was N ticks ago"
 * without re-fetching history on every tick.
 */
class DigitWindow {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.digits = []; // oldest first
    this.decimals = null;
  }

  _detectDecimals(price) {
    const str = String(price);
    const dot = str.indexOf('.');
    return dot !== -1 ? str.length - dot - 1 : 2;
  }

  push(price) {
    if (this.decimals === null) this.decimals = this._detectDecimals(price);
    const fixed = Number(price).toFixed(this.decimals);
    const digit = Number(fixed[fixed.length - 1]);
    this.digits.push(digit);
    if (this.digits.length > this.maxSize) this.digits.shift();
    return digit;
  }

  /** Digit from N ticks ago (1 = the previous tick). Null if not enough history yet. */
  digitBack(n) {
    const idx = this.digits.length - 1 - n;
    return idx >= 0 ? this.digits[idx] : null;
  }

  /** Current rank classification for every digit 0-9, same scheme as the dashboard circles */
  computeRanks() {
    const counts = new Array(10).fill(0);
    this.digits.forEach((d) => counts[d]++);
    const total = this.digits.length;
    const stats = counts.map((count, digit) => ({ digit, count, pct: total ? (count / total) * 100 : 0, rank: null }));

    const sorted = [...stats].sort((a, b) => b.count - a.count);
    if (sorted.length >= 4 && total > 0) {
      sorted[0].rank = 'most';
      sorted[1].rank = '2nd-most';
      sorted[sorted.length - 2].rank = '2nd-least';
      sorted[sorted.length - 1].rank = 'least';
    }
    return stats; // indexable by .find(s => s.digit === x), or just stats[x] since sorted by digit originally
  }

  rankOf(digit) {
    return this.computeRanks()[digit].rank; // null | 'most' | '2nd-most' | '2nd-least' | 'least'
  }

  get size() {
    return this.digits.length;
  }
}

/** Does a digit's current rank satisfy a required classification? */
function rankSatisfies(rank, requirement) {
  if (requirement === 'any') return true;
  if (requirement === 'normal') return rank === null;
  if (requirement === 'hot') return rank === 'most' || rank === '2nd-most';
  if (requirement === 'cold') return rank === '2nd-least' || rank === 'least';
  return false;
}

module.exports = { DigitWindow, rankSatisfies };
                             
