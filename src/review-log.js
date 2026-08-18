// Review-gap tally log. Each run where the LLM reviewer finds (or drops) names
// appends one JSONL record. The tally script (scripts/review-tally.js) reads
// this file and surfaces recurring catches as candidate regression tests for
// the regex pipeline in src/wiki-extract.js.

const fs = require('fs');
const path = require('path');

function appendReviewRecord(record, logPath) {
  if (!logPath) return;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf-8');
  } catch (err) {
    console.warn(`[review-log] write failed: ${err && err.message ? err.message : err}`);
  }
}

module.exports = { appendReviewRecord };