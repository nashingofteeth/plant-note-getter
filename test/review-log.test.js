const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendReviewRecord } = require('../src/review-log');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'review-log-'));
}

test('appendReviewRecord: creates parent dirs and writes JSONL', () => {
  const dir = tmpDir();
  const logPath = path.join(dir, 'nested', 'review-gaps.jsonl');
  appendReviewRecord({ taxon: 'Quercus robur', llmAdded: ['hedge oak'] }, logPath);
  const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
  assert.strictEqual(lines.length, 1);
  assert.deepStrictEqual(JSON.parse(lines[0]), {
    taxon: 'Quercus robur',
    llmAdded: ['hedge oak']
  });
});

test('appendReviewRecord: appends rather than overwrites', () => {
  const dir = tmpDir();
  const logPath = path.join(dir, 'review-gaps.jsonl');
  appendReviewRecord({ taxon: 'A' }, logPath);
  appendReviewRecord({ taxon: 'B' }, logPath);
  const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
  assert.strictEqual(lines.length, 2);
  assert.deepStrictEqual(JSON.parse(lines[0]), { taxon: 'A' });
  assert.deepStrictEqual(JSON.parse(lines[1]), { taxon: 'B' });
});

test('appendReviewRecord: null path is a no-op', () => {
  assert.doesNotThrow(() => appendReviewRecord({ taxon: 'A' }, null));
  assert.doesNotThrow(() => appendReviewRecord({ taxon: 'A' }, undefined));
});

test('appendReviewRecord: unwritable path warns but does not throw', () => {
  const dir = tmpDir();
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, '');
  const badPath = path.join(blocker, 'review-gaps.jsonl');
  assert.doesNotThrow(() => appendReviewRecord({ taxon: 'A' }, badPath));
});