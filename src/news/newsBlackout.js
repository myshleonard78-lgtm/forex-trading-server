const config = require('../config');

/**
 * STUB — wire this up to a real economic calendar API (Forex Factory calendar,
 * Finnhub, or Trading Economics), NOT investing.com directly (no public API,
 * scraping violates their ToS).
 *
 * Expected shape once implemented: fetch upcoming high-impact events for the
 * symbols you trade, and return true if we're within `blackoutMinutes` of one.
 */
async function isInNewsBlackout(symbol) {
  // TODO: replace with a real API call, cache results for a few minutes
  // const events = await fetchUpcomingHighImpactEvents(symbol);
  // return events.some(e => Math.abs(e.time - Date.now()) < config.news.blackoutMinutes * 60000);
  return false;
}

module.exports = { isInNewsBlackout };
