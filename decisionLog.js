const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '..', '..', 'decision-log.jsonl');

/** One JSON line per event — easy to tail, grep, or load into a spreadsheet later */
function logEvent(event) {
  const record = { timestamp: new Date().toISOString(), ...event };
  fs.appendFileSync(LOG_PATH, JSON.stringify(record) + '\n');
  // Also print to console so it shows up in Render's logs in real time
  console.log(`[${record.timestamp}] ${record.type}`, record);
}

function readLog() {
  if (!fs.existsSync(LOG_PATH)) return [];
  return fs
    .readFileSync(LOG_PATH, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

module.exports = { logEvent, readLog };
