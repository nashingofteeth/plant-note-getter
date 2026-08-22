const { test } = require('node:test');
const assert = require('node:assert');
const { getUnrecognizedClades, unrecognizedCladesToOffer } = require('../src/tagcheck');

const SEGMENTS = [
  'life', 'eukaryota', 'plantae', 'tracheophytes', 'spermatophytes',
  'angiosperms', 'eudicots', 'rosids', 'fabales', 'fabaceae',
  'inverted_repeat-lacking_clade', 'vicia'
];

const ORIGINALS = [
  '', '', '', 'tracheophyte', 'Spermatophyta', 'Angiosperms', 'Eudicots',
  'Rosids', 'Fabales', 'Fabaceae', 'Inverted repeat-lacking clade', 'Vicia'
];

// Existing notes: Vicia sativa reaches fabaceae/vicia without the clade segment,
// plus two notes that reach rosids via fagales (so fabales/vicia count 1).
const ALL_TAGS = [
  'life/eukaryota/plantae/tracheophytes/spermatophytes/angiosperms/eudicots/rosids/fabales/fabaceae/vicia',
  'life/eukaryota/plantae/tracheophytes/spermatophytes/angiosperms/eudicots/rosids/fagales/fagaceae/quercus',
  'life/eukaryota/plantae/tracheophytes/spermatophytes/angiosperms/eudicots/rosids/fagales/fagaceae/quercus'
];

function makeRows(segments) {
  return segments.map((segment, i) => {
    const prefix = segments.slice(0, i + 1).join('/');
    const count = ALL_TAGS.filter(t => t === prefix || t.startsWith(prefix + '/')).length;
    return { segment, depth: i, prefix, count };
  });
}

test('unrecognizedCladesToOffer: offers unmapped clade hiding under a count-1 branch', () => {
  const rows = makeRows(SEGMENTS);
  const firstOnlyChild = rows.find(r => r.count <= 1);
  assert.strictEqual(firstOnlyChild.segment, 'fabales');
  assert.strictEqual(firstOnlyChild.count, 1);

  const offer = unrecognizedCladesToOffer(rows, SEGMENTS, ALL_TAGS, ORIGINALS, firstOnlyChild);
  assert.deepStrictEqual(offer, ['Inverted repeat-lacking clade']);
});

test('getUnrecognizedClades: excludes known segments (fabales, fabaceae, vicia)', () => {
  const rows = makeRows(SEGMENTS);
  const clades = getUnrecognizedClades(rows, SEGMENTS, ALL_TAGS, ORIGINALS);
  assert.deepStrictEqual(clades, ['Inverted repeat-lacking clade']);
});

test('unrecognizedCladesToOffer: returns [] when no first-only-child exists', () => {
  const rows = makeRows(SEGMENTS);
  assert.deepStrictEqual(unrecognizedCladesToOffer(rows, SEGMENTS, ALL_TAGS, ORIGINALS, null), []);
});
