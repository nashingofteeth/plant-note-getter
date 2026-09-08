// Review-gap tally log. Each run where the LLM reviewer finds (or drops) names
// appends one JSONL record — but a record whose review content (taxon +
// baseNames + llmAdded + llmRemoved) already exists in the file is skipped:
// re-running a taxon re-derives the same diff, and duplicates would inflate
// the tally. Content changes (e.g. after a regex patch) produce a new record.
// The tally script (scripts/review-tally.js) reads this file and surfaces
// recurring catches as candidate regression tests for the regex pipeline in
// src/wiki-extract.js.

const fs = require('fs');
const path = require('path');

// Content identity for dedup — volatile fields (date, extract snapshot) and
// formatting-only fields (extractLength) are excluded.
function recordKey(record) {
  return JSON.stringify([
    record.taxon,
    record.wikipediaTitle,
    record.baseNames,
    record.llmAdded,
    record.llmRemoved
  ]);
}

function appendReviewRecord(record, logPath) {
  if (!logPath) return;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    let existingKeys = new Set();
    if (fs.existsSync(logPath)) {
      existingKeys = new Set(
        fs
          .readFileSync(logPath, 'utf-8')
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            try {
              return recordKey(JSON.parse(line));
            } catch {
              return null;
            }
          })
          .filter(Boolean)
      );
      if (existingKeys.has(recordKey(record))) return;
    }
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf-8');
  } catch (err) {
    console.warn(`[review-log] write failed: ${err && err.message ? err.message : err}`);
  }
}

module.exports = { appendReviewRecord, recordKey };