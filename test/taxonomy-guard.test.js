const { test } = require('node:test');
const assert = require('node:assert');
const { buildTag } = require('../src/taxonomy');
const {
  findExclusiveCladeViolations,
  findRankInversions,
} = require('../src/taxonomy-guard');
const labelMap = require('../label-map.json');

// ─── findExclusiveCladeViolations ────────────────────────────────────────────

test('guard: valid angiosperm+eudicot chain has no clade violation', () => {
  const segments = ['life', 'eukaryota', 'plantae', 'tracheophytes', 'spermatophytes', 'angiosperms', 'eudicots', 'rosids'];
  const { violations } = findExclusiveCladeViolations(segments);
  assert.deepStrictEqual(violations, []);
});

test('guard: chain mixing monocots and eudicots flags the later clade', () => {
  const segments = ['life', 'eukaryota', 'plantae', 'angiosperms', 'monocots', 'asparagales', 'eudicots'];
  const { violations } = findExclusiveCladeViolations(segments);
  assert.deepStrictEqual(violations, ['eudicots']);
});

test('guard: chain mixing angiosperms and gymnosperms flags the later clade', () => {
  const segments = ['life', 'eukaryota', 'plantae', 'angiosperms', 'eudicots', 'gymnospermae'];
  const { violations } = findExclusiveCladeViolations(segments);
  assert.deepStrictEqual(violations, ['gymnospermae']);
});

test('guard: buildTag drops the conflicting clade from a mixed chain', () => {
  // Simulates a broken Wikidata chain where a taxon is routed through both
  // monocots and eudicots. The later (eudicots) clade should be dropped.
  const ancestors = [
    { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q25314', label: 'Angiosperms', rankLabel: null },
    { id: 'Q165468', label: 'Monocots', rankLabel: null },
    { id: 'Q219688', label: 'Asparagales', rankLabel: 'order' },
    { id: 'Q25938', label: 'Asparagaceae', rankLabel: 'family' },
    { id: 'Q165468', label: 'Eudicots', rankLabel: null }, // conflicting, should drop
    { id: 'Q12345', label: 'Maianthemum', rankLabel: 'genus' },
    { id: 'Q99999', label: 'Maianthemum racemosum', rankLabel: 'species' },
  ];
  const tag = buildTag(ancestors, 'Q99999', labelMap);
  assert.ok(tag.includes('/monocots/'), 'should keep monocots');
  assert.ok(!tag.includes('/eudicots/'), 'should drop eudicots');
  assert.ok(tag.endsWith('/maianthemum'));
});

// ─── _overrides (parent-chain override) ─────────────────────────────────────

test('guard: _overrides replaces a broken Wikidata P171 lineage', () => {
  // Real broken chain for Maianthemum racemosum (Q3486643): the genus is routed
  // through Nolanoideae (a Solanaceae subfamily) instead of Asparagaceae.
  const ancestors = [
    { id: 'Q879246', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q192154', label: 'tracheophyte', rankLabel: 'division' },
    { id: 'Q25814', label: 'Spermatophyta', rankLabel: 'subdivision' },
    { id: 'Q25314', label: 'Angiosperms', rankLabel: null },
    { id: 'Q165468', label: 'Eudicots', rankLabel: null },
    { id: 'Q869087', label: 'Asterids', rankLabel: null },
    { id: 'Q21723', label: 'Solanales', rankLabel: 'order' },
    { id: 'Q134172', label: 'Solanaceae', rankLabel: 'family' },
    { id: 'Q161408', label: 'Nolanoideae', rankLabel: 'subfamily' },
    { id: 'Q157848', label: 'Maianthemum', rankLabel: 'genus' },
    { id: 'Q3486643', label: 'Maianthemum racemosum', rankLabel: 'species' },
  ];
  const tag = buildTag(ancestors, 'Q3486643', labelMap);
  assert.strictEqual(
    tag,
    'life/eukaryota/plantae/tracheophytes/spermatophytes/angiosperms/monocots/asparagales/asparagaceae/maianthemum'
  );
  assert.ok(!tag.includes('solanales') && !tag.includes('solanaceae'), 'broken lineage should be dropped');
  assert.ok(!tag.includes('eudicots'), 'conflicting clade should not appear');
});

// ─── findRankInversions ──────────────────────────────────────────────────────

test('guard: valid broad-to-specific chain has no rank inversion', () => {
  const ancestors = [
    { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q27133', label: 'tracheophyte', rankLabel: 'division' },
    { id: 'Q21881', label: 'Fagales', rankLabel: 'order' },
    { id: 'Q145977', label: 'Fagaceae', rankLabel: 'family' },
    { id: 'Q12004', label: 'oak', rankLabel: 'genus' },
    { id: 'Q147525', label: 'Quercus rubra', rankLabel: 'species' },
  ];
  assert.deepStrictEqual(findRankInversions(ancestors), []);
});

test('guard: genus appearing before a family is flagged as an inversion', () => {
  const ancestors = [
    { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q12004', label: 'oak', rankLabel: 'genus' },   // narrower first
    { id: 'Q145977', label: 'Fagaceae', rankLabel: 'family' }, // then broader: inverted
    { id: 'Q147525', label: 'Quercus rubra', rankLabel: 'species' },
  ];
  const inv = findRankInversions(ancestors);
  assert.ok(inv.length >= 1, 'should flag at least one inversion');
});

test('guard: buildTag drops a rank-inverted ancestor', () => {
  const ancestors = [
    { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q12004', label: 'oak', rankLabel: 'genus' },   // narrower first (inverted)
    { id: 'Q145977', label: 'Fagaceae', rankLabel: 'family' }, // broader, dropped
    { id: 'Q147525', label: 'Quercus rubra', rankLabel: 'species' },
  ];
  const tag = buildTag(ancestors, 'Q147525', labelMap);
  assert.ok(tag.includes('/quercus'), 'genus should survive');
  assert.ok(!tag.includes('fagaceae'), 'inverted family should be dropped');
});
