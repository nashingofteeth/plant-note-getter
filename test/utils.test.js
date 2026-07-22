const assert = require('node:assert');
const { sanitizeFilename, formatAlias, getCurrentDate, isEmptyValue } = require('../src/utils');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
    failed++;
  }
}

// ─── sanitizeFilename ───────────────────────────────────────────────────────

test('sanitizeFilename: strips all filesystem-unsafe characters', () => {
  // every char in the regex class appears here
  assert.strictEqual(sanitizeFilename('Name/With\\*?"<>|Chars'), 'NameWithChars.md');
});

test('sanitizeFilename: preserves spaces, hyphens, underscores, dots', () => {
  assert.strictEqual(sanitizeFilename('Eschscholzia-californica var. subsp.'), 'Eschscholzia-californica var. subsp..md');
});

test('sanitizeFilename: always appends .md', () => {
  assert.ok(sanitizeFilename('Anything').endsWith('.md'));
});

// ─── formatAlias ────────────────────────────────────────────────────────────

test('formatAlias: quotes names containing colons (YAML safety)', () => {
  assert.strictEqual(formatAlias('name: with colon'), '"name: with colon"');
});

test('formatAlias: does not quote names without colons', () => {
  assert.strictEqual(formatAlias('red oak'), 'red oak');
});

// ─── getCurrentDate ─────────────────────────────────────────────────────────

test('getCurrentDate: returns YYYY-MM-DD format', () => {
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(getCurrentDate()));
});

// ─── isEmptyValue ───────────────────────────────────────────────────────────

test('isEmptyValue: null, undefined, empty string, empty array are empty', () => {
  assert.strictEqual(isEmptyValue(null), true);
  assert.strictEqual(isEmptyValue(undefined), true);
  assert.strictEqual(isEmptyValue(''), true);
  assert.strictEqual(isEmptyValue([]), true);
});

test('isEmptyValue: whitespace-only string is empty', () => {
  assert.strictEqual(isEmptyValue('   '), true);
});

test('isEmptyValue: non-empty values are not empty', () => {
  assert.strictEqual(isEmptyValue('hello'), false);
  assert.strictEqual(isEmptyValue(['a']), false);
  assert.strictEqual(isEmptyValue({ a: 1 }), false);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
process.exit(failed > 0 ? 1 : 0);
