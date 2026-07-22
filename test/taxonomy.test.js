const assert = require('node:assert');
const { buildAliases, buildWikipediaUrl, buildTagSegmentsWithOriginals, buildTag } = require('../src/taxonomy');
const labelMap = require('../label-map.json');

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

// ─── buildAliases ───────────────────────────────────────────────────────────

test('buildAliases: common names come first, then wikidata aliases', () => {
  const entity = { commonNames: ['second'], aliases: ['first'], scientificName: 'Quercus' };
  assert.deepStrictEqual(buildAliases(entity), ['second', 'first']);
});

test('buildAliases: case-insensitive dedup keeps first occurrence', () => {
  // 'Oak' and 'oak' should dedup — if code fails to lowercase, both survive
  const entity = { commonNames: ['Oak', 'oak', 'OAK'], aliases: [], scientificName: 'X' };
  assert.deepStrictEqual(buildAliases(entity), ['Oak']);
});

test('buildAliases: wikidata alias deduped against common name (case-insensitive)', () => {
  // 'Red Oak' (alias) vs 'red oak' (common) — alias should be dropped
  const entity = { commonNames: ['red oak'], aliases: ['Red Oak'], scientificName: 'X' };
  const result = buildAliases(entity);
  assert.deepStrictEqual(result, ['red oak']);
  // if dedup is case-sensitive, this would be ['red oak', 'Red Oak']
});

test('buildAliases: scientific name excluded even with different casing', () => {
  const entity = { commonNames: [], aliases: ['quercus rubra', 'red oak'], scientificName: 'Quercus rubra' };
  assert.deepStrictEqual(buildAliases(entity), ['red oak']);
});

test('buildAliases: strips leading articles from common names', () => {
  const entity = { commonNames: ['the oak', 'a shrub'], aliases: [], scientificName: 'X' };
  assert.deepStrictEqual(buildAliases(entity), ['oak', 'shrub']);
});

test('buildAliases: returns null when nothing to alias', () => {
  assert.strictEqual(buildAliases({ commonNames: [], aliases: [], scientificName: 'X' }), null);
  assert.strictEqual(buildAliases({ scientificName: 'X' }), null);
});

// ─── buildWikipediaUrl ──────────────────────────────────────────────────────

test('buildWikipediaUrl: returns url or null', () => {
  assert.strictEqual(buildWikipediaUrl({ wikipediaUrl: 'https://example.com' }), 'https://example.com');
  assert.strictEqual(buildWikipediaUrl({}), null);
  assert.strictEqual(buildWikipediaUrl({ wikipediaUrl: null }), null);
});

// ─── buildTagSegmentsWithOriginals ──────────────────────────────────────────

test('buildTagSegmentsWithOriginals: full angiosperm chain with correct originals', () => {
  const ancestors = [
    { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q27133', label: 'tracheophyte', rankLabel: 'division' },
    { id: 'Q25814', label: 'Spermatophyta', rankLabel: 'subdivision' },
    { id: 'Q25314', label: 'Angiosperms', rankLabel: null },
    { id: 'Q165468', label: 'Eudicots', rankLabel: null },
    { id: 'Q21021', label: 'Ranunculales', rankLabel: 'order' },
    { id: 'Q144723', label: 'Papaveraceae', rankLabel: 'family' },
    { id: 'Q161926', label: 'Eschscholzia', rankLabel: 'genus' },
    { id: 'Q158795', label: 'Eschscholzia californica', rankLabel: 'species' },
  ];
  const { segments, originals } = buildTagSegmentsWithOriginals(ancestors, 'Q158795', labelMap);
  assert.deepStrictEqual(segments, [
    'life', 'eukaryota', 'plantae', 'tracheophytes', 'spermatophytes',
    'angiosperms', 'eudicots', 'ranunculales', 'papaveraceae', 'eschscholzia'
  ]);
  // originals[3] should be 'tracheophyte' (mapped to 'tracheophytes')
  // originals[5] should be 'Angiosperms' (no mapping, kept as-is lowercased)
  assert.strictEqual(originals[3], 'tracheophyte');
  assert.strictEqual(originals[5], 'Angiosperms');
  assert.strictEqual(originals[7], 'Ranunculales');
  assert.strictEqual(originals[8], 'Papaveraceae');
});

test('buildTagSegmentsWithOriginals: gymnospermae injection inserts tracheophytes + spermatophytes', () => {
  const ancestors = [
    { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q133712', label: 'Gymnospermae', rankLabel: 'division' },
    { id: 'Q9849989', label: 'Coniferae', rankLabel: 'class' },
    { id: 'Q146037', label: 'Cupressaceae', rankLabel: 'family' },
    { id: 'Q25662', label: 'Juniperus', rankLabel: 'genus' },
    { id: 'Q148630', label: 'Juniperus sabina', rankLabel: 'species' },
  ];
  const { segments } = buildTagSegmentsWithOriginals(ancestors, 'Q148630', labelMap);
  const tracheoIdx = segments.indexOf('tracheophytes');
  const spermaIdx = segments.indexOf('spermatophytes');
  const gymnoIdx = segments.indexOf('gymnospermae');
  assert.ok(tracheoIdx < gymnoIdx, 'tracheophytes should come before gymnospermae');
  assert.ok(spermaIdx < gymnoIdx, 'spermatophytes should come before gymnospermae');
});

test('buildTagSegmentsWithOriginals: skips own entity in ancestors', () => {
  const ancestors = [
    { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q123', label: 'MyGenus', rankLabel: 'genus' },
  ];
  const { segments } = buildTagSegmentsWithOriginals(ancestors, 'Q123', labelMap);
  assert.ok(!segments.includes('mygenus'));
});

test('buildTagSegmentsWithOriginals: skips Q-code labels (no human-readable name)', () => {
  const ancestors = [
    { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q99999', label: 'Q12345', rankLabel: null },
    { id: 'Q123', label: 'MyGenus', rankLabel: 'genus' },
  ];
  const { segments } = buildTagSegmentsWithOriginals(ancestors, 'Q123', labelMap);
  assert.ok(!segments.includes('q12345'));
});

test('buildTagSegmentsWithOriginals: skips labels starting with "super"', () => {
  const ancestors = [
    { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q99999', label: 'superrosids', rankLabel: null },
    { id: 'Q123', label: 'MyGenus', rankLabel: 'genus' },
  ];
  const { segments } = buildTagSegmentsWithOriginals(ancestors, 'Q123', labelMap);
  assert.ok(!segments.includes('superrosids'));
});

test('buildTagSegmentsWithOriginals: null mapping in label-map excludes taxon', () => {
  const ancestors = [
    { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q99999', label: 'biota', rankLabel: null },
    { id: 'Q123', label: 'MyGenus', rankLabel: 'genus' },
  ];
  const { segments } = buildTagSegmentsWithOriginals(ancestors, 'Q123', labelMap);
  assert.ok(!segments.includes('biota'));
});

test('buildTagSegmentsWithOriginals: mapped label replaces original in segments', () => {
  const ancestors = [
    { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q12004', label: 'oak', rankLabel: 'genus' },
    { id: 'Q147525', label: 'Quercus rubra', rankLabel: 'species' },
  ];
  const { segments } = buildTagSegmentsWithOriginals(ancestors, 'Q147525', labelMap);
  assert.ok(segments.includes('quercus'), 'should have quercus (mapped from oak)');
  assert.ok(!segments.includes('oak'), 'should not have oak');
});

test('buildTagSegmentsWithOriginals: dedupes when two ancestors map to same segment', () => {
  const ancestors = [
    { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q99999', label: 'Pinophyta', rankLabel: 'division' },
    { id: 'Q99998', label: 'conifer', rankLabel: 'division' },
    { id: 'Q123', label: 'Pinus', rankLabel: 'genus' },
  ];
  const { segments } = buildTagSegmentsWithOriginals(ancestors, 'Q123', labelMap);
  const count = segments.filter(s => s === 'pinophyta').length;
  assert.strictEqual(count, 1, 'pinophyta should appear exactly once, got ' + count);
});

test('buildTagSegmentsWithOriginals: coniferae maps to pinophyta not coniferae', () => {
  const ancestors = [
    { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q9849989', label: 'Coniferae', rankLabel: 'class' },
    { id: 'Q123', label: 'Pinus', rankLabel: 'genus' },
  ];
  const { segments } = buildTagSegmentsWithOriginals(ancestors, 'Q123', labelMap);
  assert.ok(segments.includes('pinophyta'));
  assert.ok(!segments.includes('coniferae'));
});

test('buildTagSegmentsWithOriginals: acrogymnospermae maps to gymnospermae', () => {
  const ancestors = [
    { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q56639776', label: 'Acrogymnospermae', rankLabel: null },
    { id: 'Q123', label: 'Pinus', rankLabel: 'genus' },
  ];
  const { segments } = buildTagSegmentsWithOriginals(ancestors, 'Q123', labelMap);
  assert.ok(segments.includes('gymnospermae'));
  assert.ok(!segments.includes('acrogymnospermae'));
});

test('buildTagSegmentsWithOriginals: cupressaceae injection adds pinopsida + cupressales', () => {
  const ancestors = [
    { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q146037', label: 'Cupressaceae', rankLabel: 'family' },
    { id: 'Q123', label: 'Juniperus', rankLabel: 'genus' },
  ];
  const { segments } = buildTagSegmentsWithOriginals(ancestors, 'Q123', labelMap);
  const cupIdx = segments.indexOf('cupressaceae');
  assert.ok(segments.includes('pinopsida'), 'should inject pinopsida');
  assert.ok(segments.includes('cupressales'), 'should inject cupressales');
  assert.ok(segments.indexOf('pinopsida') < cupIdx, 'pinopsida before cupressaceae');
  assert.ok(segments.indexOf('cupressales') < cupIdx, 'cupressales before cupressaceae');
});

// ─── buildTag (integration) ─────────────────────────────────────────────────

test('buildTag: oak produces expected full tag', () => {
  const ancestors = [
    { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q27133', label: 'tracheophyte', rankLabel: 'division' },
    { id: 'Q25814', label: 'Spermatophyta', rankLabel: 'subdivision' },
    { id: 'Q25314', label: 'Angiosperms', rankLabel: null },
    { id: 'Q165468', label: 'Eudicots', rankLabel: null },
    { id: 'Q338878', label: 'Rosids', rankLabel: null },
    { id: 'Q21881', label: 'Fagales', rankLabel: 'order' },
    { id: 'Q145977', label: 'Fagaceae', rankLabel: 'family' },
    { id: 'Q12004', label: 'oak', rankLabel: 'genus' },
    { id: 'Q147525', label: 'Quercus rubra', rankLabel: 'species' },
  ];
  const tag = buildTag(ancestors, 'Q147525', labelMap);
  assert.strictEqual(tag, 'life/eukaryota/plantae/tracheophytes/spermatophytes/angiosperms/eudicots/rosids/fagales/fagaceae/quercus');
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
process.exit(failed > 0 ? 1 : 0);
