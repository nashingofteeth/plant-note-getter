const assert = require('node:assert');
const { isSynonymOf, stripArticle, extractNamesFromCapture } = require('../src/wikidata');

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

// ─── stripArticle ───────────────────────────────────────────────────────────

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

// ─── isSynonymOf ────────────────────────────────────────────────────────────

test('isSynonymOf: candidate in primary taxonSynonymIds', () => {
  const primary = { id: 'Q1', taxonSynonymIds: ['Q2'] };
  const candidate = { id: 'Q2' };
  assert.strictEqual(isSynonymOf(primary, candidate), true);
});

test('isSynonymOf: candidate in primary replacedSynonymOfIds', () => {
  const primary = { id: 'Q1', replacedSynonymOfIds: ['Q3'] };
  const candidate = { id: 'Q3' };
  assert.strictEqual(isSynonymOf(primary, candidate), true);
});

test('isSynonymOf: primary in candidate synonymOfIds', () => {
  const primary = { id: 'Q1' };
  const candidate = { id: 'Q2', synonymOfIds: ['Q1'] };
  assert.strictEqual(isSynonymOf(primary, candidate), true);
});

test('isSynonymOf: primary in candidate replacedSynonymIds', () => {
  const primary = { id: 'Q1' };
  const candidate = { id: 'Q2', replacedSynonymIds: ['Q1'] };
  assert.strictEqual(isSynonymOf(primary, candidate), true);
});

test('isSynonymOf: Wikipedia title match as fallback', () => {
  const primary = { id: 'Q1', scientificName: 'Quercus rubra' };
  const candidate = { id: 'Q2', wikipediaTitle: 'Quercus_rubra' };
  assert.strictEqual(isSynonymOf(primary, candidate), true);
});

test('isSynonymOf: Wikipedia title case-insensitive', () => {
  const primary = { id: 'Q1', scientificName: 'quercus rubra' };
  const candidate = { id: 'Q2', wikipediaTitle: 'Quercus_rubra' };
  assert.strictEqual(isSynonymOf(primary, candidate), true);
});

test('isSynonymOf: uses label when no scientificName', () => {
  const primary = { id: 'Q1', label: 'Red Oak' };
  const candidate = { id: 'Q2', wikipediaTitle: 'Red_Oak' };
  assert.strictEqual(isSynonymOf(primary, candidate), true);
});

test('isSynonymOf: false when no ID overlap and no title match', () => {
  const primary = { id: 'Q1', scientificName: 'Quercus rubra' };
  const candidate = { id: 'Q2', scientificName: 'Pinus strobus' };
  assert.strictEqual(isSynonymOf(primary, candidate), false);
});

test('isSynonymOf: false when IDs differ and title does not match', () => {
  const primary = { id: 'Q1', scientificName: 'Quercus rubra' };
  const candidate = { id: 'Q2', wikipediaTitle: 'Pinus_strobus' };
  assert.strictEqual(isSynonymOf(primary, candidate), false);
});

test('isSynonymOf: null inputs return false', () => {
  assert.strictEqual(isSynonymOf(null, { id: 'Q1' }), false);
  assert.strictEqual(isSynonymOf({ id: 'Q1' }, null), false);
  assert.strictEqual(isSynonymOf(null, null), false);
});

test('isSynonymOf: empty synonym arrays return false', () => {
  const primary = { id: 'Q1', taxonSynonymIds: [], replacedSynonymOfIds: [] };
  const candidate = { id: 'Q2', synonymOfIds: [], replacedSynonymIds: [] };
  assert.strictEqual(isSynonymOf(primary, candidate), false);
});

test('isSynonymOf: same id is not treated as synonym', () => {
  const primary = { id: 'Q1' };
  const candidate = { id: 'Q1' };
  // the function checks ID membership, not equality — same id won't be in synonym arrays
  assert.strictEqual(isSynonymOf(primary, candidate), false);
});

// ─── extractNamesFromCapture ────────────────────────────────────────────────

test('extractNamesFromCapture: comma-separated list with articles stripped', () => {
  const result = extractNamesFromCapture('the California poppy, the golden poppy');
  assert.deepStrictEqual(result, ['California poppy', 'golden poppy']);
});

test('extractNamesFromCapture: "and"/"or" connectors become commas', () => {
  const result = extractNamesFromCapture('sweet briar, sweetbriar rose, sweet brier or eglantine');
  assert.deepStrictEqual(result, ['sweet briar', 'sweetbriar rose', 'sweet brier', 'eglantine']);
});

test('extractNamesFromCapture: parenthetical content stripped', () => {
  const result = extractNamesFromCapture('milk thistle (not to be confused with Silybum marianum), compass plant');
  assert.deepStrictEqual(result, ['milk thistle', 'compass plant']);
});

test('extractNamesFromCapture: semicolon and synonym info stripped', () => {
  const result = extractNamesFromCapture('sweet briar, sweetbriar rose; syn. R. eglanteria');
  assert.deepStrictEqual(result, ['sweet briar', 'sweetbriar rose']);
});

test('extractNamesFromCapture: language qualifiers stripped', () => {
  const result = extractNamesFromCapture('Ellinikí rίgani in Greek, oregano');
  assert.deepStrictEqual(result, ['Ellinikí rίgani', 'oregano']);
});

test('extractNamesFromCapture: leading "common name" prefix stripped', () => {
  const result = extractNamesFromCapture('common name ice poppy');
  assert.deepStrictEqual(result, ['ice poppy']);
});

test('extractNamesFromCapture: leading "as" only stripped with whitespace', () => {
  assert.deepStrictEqual(
    extractNamesFromCapture('as prickly lettuce, compass plant'),
    ['prickly lettuce', 'compass plant']
  );
  // without space, "as" is part of the word
  assert.deepStrictEqual(
    extractNamesFromCapture('asparagus, compass plant'),
    ['asparagus', 'compass plant']
  );
});

test('extractNamesFromCapture: skips rank terms, stopwords, and filler phrases', () => {
  assert.deepStrictEqual(extractNamesFromCapture('species, genus, family'), []);
  assert.deepStrictEqual(extractNamesFromCapture('or, and, the, in, of'), []);
  assert.deepStrictEqual(extractNamesFromCapture('primarily, especially, including, such as'), []);
});

test('extractNamesFromCapture: skips numeric and generic plant terms', () => {
  assert.deepStrictEqual(extractNamesFromCapture('name1, 2name'), []);
  assert.deepStrictEqual(extractNamesFromCapture('tree, shrub, herb, plant'), []);
});

test('extractNamesFromCapture: strips quotes and trailing periods', () => {
  assert.deepStrictEqual(
    extractNamesFromCapture("'coppery mesemb', 'red ice plant'"),
    ['coppery mesemb', 'red ice plant']
  );
  assert.deepStrictEqual(
    extractNamesFromCapture('name one, name two.'),
    ['name one', 'name two']
  );
});

test('extractNamesFromCapture: deduplicates case-insensitively', () => {
  assert.deepStrictEqual(extractNamesFromCapture('oak, Oak, OAK'), ['oak']);
});

test('extractNamesFromCapture: skips single-initial scientific names', () => {
  assert.deepStrictEqual(extractNamesFromCapture('R. eglanteria'), []);
});

test('extractNamesFromCapture: multi-word and hyphenated names preserved', () => {
  assert.deepStrictEqual(
    extractNamesFromCapture('California poppy, paw-paw, wild leek'),
    ['California poppy', 'paw-paw', 'wild leek']
  );
});

test('extractNamesFromCapture: skips names over 5 words', () => {
  assert.deepStrictEqual(
    extractNamesFromCapture('this is a very long name that has many words'),
    []
  );
});

test('extractNamesFromCapture: empty string returns empty array', () => {
  assert.deepStrictEqual(extractNamesFromCapture(''), []);
});

test('extractNamesFromCapture: filler lead-ins filtered but real names kept', () => {
  assert.deepStrictEqual(
    extractNamesFromCapture('among many regional names, oak'),
    ['oak']
  );
  assert.deepStrictEqual(
    extractNamesFromCapture('more commonly known as, oak'),
    ['oak']
  );
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
process.exit(failed > 0 ? 1 : 0);
