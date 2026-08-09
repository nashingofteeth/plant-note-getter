const { test } = require('node:test');
const assert = require('node:assert');
const { sanitizeFilename, formatAlias, getCurrentDate, isEmptyValue, stripArticle, normalizeNameKey, cleanName } = require('../src/utils');

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

// ─── stripArticle ────────────────────────────────────────────────────────────

test('stripArticle: strips leading articles and filler words', () => {
  assert.strictEqual(stripArticle('the oak'), 'oak');
  assert.strictEqual(stripArticle('a shrub'), 'shrub');
  assert.strictEqual(stripArticle('an herb'), 'herb');
  assert.strictEqual(stripArticle('and more'), 'more');
  assert.strictEqual(stripArticle('or something'), 'something');
  assert.strictEqual(stripArticle('just oak'), 'oak');
  assert.strictEqual(stripArticle('simply oak'), 'oak');
});

test('stripArticle: case insensitive', () => {
  assert.strictEqual(stripArticle('The Oak'), 'Oak');
  assert.strictEqual(stripArticle('THE OAK'), 'OAK');
});

test('stripArticle: no article to strip returns unchanged', () => {
  assert.strictEqual(stripArticle('oak tree'), 'oak tree');
});

test('stripArticle: empty string', () => {
  assert.strictEqual(stripArticle(''), '');
});

// ─── normalizeNameKey ───────────────────────────────────────────────────────

test('normalizeNameKey: lowercases and strips leading articles', () => {
  assert.strictEqual(normalizeNameKey('The Oak'), 'oak');
  assert.strictEqual(normalizeNameKey('A Shrub'), 'shrub');
});

test('normalizeNameKey: strips possessive "s so variants dedup together', () => {
  assert.strictEqual(normalizeNameKey("David's viburnum"), 'david viburnum');
  assert.strictEqual(normalizeNameKey('David viburnum'), 'david viburnum');
});

test('normalizeNameKey: does not strip "s from non-possessive words', () => {
  // "viburnums" (plural) must NOT collapse to "viburnum"
  assert.notStrictEqual(normalizeNameKey('viburnums'), 'viburnum');
});

test('normalizeNameKey: possessive marker requires word boundary', () => {
  // "ts" inside a word is untouched
  assert.strictEqual(normalizeNameKey('sweetbriars'), 'sweetbriars');
  // genuine possessive at word end is stripped
  assert.strictEqual(normalizeNameKey('David\'s'), 'david');
});

test('normalizeNameKey: preserves casing differences only for comparison', () => {
  assert.strictEqual(normalizeNameKey('RED OAK'), 'red oak');
  assert.strictEqual(normalizeNameKey('red oak'), 'red oak');
});

// ─── cleanName ──────────────────────────────────────────────────────────────

test('cleanName: strips article and trailing periods', () => {
  assert.strictEqual(cleanName('the oak.'), 'oak');
  assert.strictEqual(cleanName('oak tree...'), 'oak tree');
});

test('cleanName: leaves other names unchanged', () => {
  assert.strictEqual(cleanName('Red Oak'), 'Red Oak');
});
