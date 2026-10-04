const { DigitWindow } = require('./digitWindow');

const ALL_SYMBOLS = ['R_10', '1HZ10V', 'R_25', '1HZ25V', 'R_50', '1HZ50V', 'R_75', '1HZ75V', 'R_100', '1HZ100V'];

/**
 * Keeps a live, always-warm rolling window for every known symbol — fed
 * directly off the real tick stream, not polled. "Every tick matters": this
 * is what makes the dashboard's live price and digit circles update the
 * instant a tick arrives, not on a timer.
 */
function initLiveMarketStreams(deriv) {
  const windows = {};
  ALL_SYMBOLS.forEach((s) => { windows[s] = new DigitWindow(1000); });

  const subscribeAll = () => {
    ALL_SYMBOLS.forEach((s) => deriv.subscribeTicks(s).catch(() => {}));
  };
  deriv.on('connected', subscribeAll);

  deriv.on('tick', (msg) => {
    if (!msg.tick) return;
    const { symbol, quote } = msg.tick;
    if (windows[symbol]) windows[symbol].push(Number(quote));
  });

  return { getWindow: (symbol) => windows[symbol], ALL_SYMBOLS };
}

module.exports = { initLiveMarketStreams, ALL_SYMBOLS };
