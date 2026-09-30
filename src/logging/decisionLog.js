const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const LOG_PATH = path.join(__dirname, '..', '..', 'decision-log.jsonl');
const emitter = new EventEmitter();

/** One JSON line per event — easy to tail, grep, or load into a spreadsheet later */
function logEvent(event) {
  const record = { timestamp: new Date().toISOString(), ...event };
  fs.appendFileSync(LOG_PATH, JSON.stringify(record) + '\n');
  console.log(`[${record.timestamp}] ${record.type}`, record);
  emitter.emit('event', record); // lets index.js wire up WhatsApp error alerts without a circular import
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

/** Subscribe to every logged event, e.g. to forward certain types to WhatsApp */
function onEvent(callback) {
  emitter.on('event', callback);
}

module.exports = { logEvent, readLog, onEvent };
