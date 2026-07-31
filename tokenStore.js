const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', '..', 'deriv-tokens.json');

/**
 * Shape stored on disk:
 * {
 *   "VRTC1234567": { token: "a1-xxxx", currency: "usd", isDemo: true,  linkedAt: "..." },
 *   "CR7654321":   { token: "a1-yyyy", currency: "usd", isDemo: false, linkedAt: "..." }
 * }
 *
 * Deriv account IDs starting with VR (VRTC/VRW) are virtual/demo accounts;
 * CR/CRW etc. are real accounts. That prefix is what lets the callback pick
 * the right one automatically instead of guessing from the UI.
 */
function readAll() {
  if (!fs.existsSync(STORE_PATH)) return {};
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

function saveAccounts(accounts) {
  const existing = readAll();
  const merged = { ...existing, ...accounts };
  fs.writeFileSync(STORE_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

function getDemoToken() {
  const all = readAll();
  const demoEntry = Object.values(all).find((a) => a.isDemo);
  return demoEntry ? demoEntry.token : null;
}

function getRealToken() {
  const all = readAll();
  const realEntry = Object.values(all).find((a) => !a.isDemo);
  return realEntry ? realEntry.token : null;
}

module.exports = { readAll, saveAccounts, getDemoToken, getRealToken };
