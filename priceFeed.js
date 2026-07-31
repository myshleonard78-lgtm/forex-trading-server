const { computeRSI } = require('./indicators');

const MAX_HISTORY = 200; // plenty for RSI(14) and room to extend to other indicators later

class PriceFeed {
  constructor() {
    this.pricesBySymbol = new Map(); // symbol -> number[]
  }

  addTick(symbol, price) {
    const list = this.pricesBySymbol.get(symbol) || [];
    list.push(price);
    if (list.length > MAX_HISTORY) list.shift();
    this.pricesBySymbol.set(symbol, list);
  }

  /** Returns the current indicator snapshot for a symbol, or null if not enough data yet */
  getMarketData(symbol) {
    const prices = this.pricesBySymbol.get(symbol) || [];
    const rsi = computeRSI(prices);
    if (rsi === null) return null;
    return { rsi, lastPrice: prices[prices.length - 1] };
  }
}

module.exports = PriceFeed;
