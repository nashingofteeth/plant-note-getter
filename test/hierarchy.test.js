// Mock ancestor chains verified against live Wikidata queries (2026-07-22).
// Only relevant ancestors are included — skipped ranks (subdivision, subfamily,
// tribe, section, superdomain, etc.) are omitted for conciseness.

const assert = require('node:assert');
const { buildTag } = require('../src/taxonomy');
const labelMap = require('../label-map.json');

const TESTS = [
  {
    name: 'juniper (no tracheophyte/spermatophyta/pinopsida in chain)',
    ancestors: [
      { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
      { id: 'Q133712', label: 'Gymnospermae', rankLabel: 'division' },
      { id: 'Q9849989', label: 'Coniferae', rankLabel: 'class' },
      { id: 'Q146037', label: 'Cupressaceae', rankLabel: 'family' },
      { id: 'Q25662', label: 'Juniperus', rankLabel: 'genus' },
      { id: 'Q148630', label: 'Juniperus sabina', rankLabel: 'species' },
    ],
    ownId: 'Q148630',
    expected: 'life/eukaryota/plantae/tracheophytes/spermatophytes/gymnospermae/pinophyta/pinopsida/cupressales/cupressaceae/juniperus',
  },
  {
    name: 'pine (has tracheophyte/spermatophyta/pinopsida in chain)',
    ancestors: [
      { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
      { id: 'Q27133', label: 'tracheophyte', rankLabel: 'division' },
      { id: 'Q25814', label: 'Spermatophyta', rankLabel: 'subdivision' },
      { id: 'Q56639776', label: 'Acrogymnospermae', rankLabel: null },
      { id: 'Q132825', label: 'conifer', rankLabel: 'division' },
      { id: 'Q1329304', label: 'Pinopsida', rankLabel: 'class' },
      { id: 'Q1000370', label: 'Pinales', rankLabel: 'order' },
      { id: 'Q101680', label: 'Pinaceae', rankLabel: 'family' },
      { id: 'Q12024', label: 'Pinus', rankLabel: 'genus' },
      { id: 'Q157230', label: 'Pinus strobus', rankLabel: 'species' },
    ],
    ownId: 'Q157230',
    expected: 'life/eukaryota/plantae/tracheophytes/spermatophytes/gymnospermae/pinophyta/pinopsida/pinales/pinaceae/pinus',
  },
  {
    name: 'angiosperm (unaffected by conifer map)',
    ancestors: [
      { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
      { id: 'Q27133', label: 'tracheophyte', rankLabel: 'division' },
      { id: 'Q25814', label: 'Spermatophyta', rankLabel: 'subdivision' },
      { id: 'Q25314', label: 'Angiosperms', rankLabel: null },
      { id: 'Q165468', label: 'Eudicots', rankLabel: null },
      { id: 'Q21021', label: 'Ranunculales', rankLabel: 'order' },
      { id: 'Q144723', label: 'Papaveraceae', rankLabel: 'family' },
      { id: 'Q161926', label: 'Eschscholzia', rankLabel: 'genus' },
      { id: 'Q158795', label: 'Eschscholzia californica', rankLabel: 'species' },
    ],
    ownId: 'Q158795',
    expected: 'life/eukaryota/plantae/tracheophytes/spermatophytes/angiosperms/eudicots/ranunculales/papaveraceae/eschscholzia',
  },
  {
    name: 'fern (uses pteridophyta injection)',
    ancestors: [
      { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
      { id: 'Q27133', label: 'tracheophyte', rankLabel: 'division' },
      { id: 'Q178249', label: 'Pteridophyta', rankLabel: 'division' },
      { id: 'Q373615', label: 'Polypodiopsida', rankLabel: 'class' },
      { id: 'Q834805', label: 'Polypodiales', rankLabel: 'order' },
      { id: 'Q849350', label: 'Polypodiaceae', rankLabel: 'family' },
      { id: 'Q1135685', label: 'Polypodium', rankLabel: 'genus' },
      { id: 'Q3007914', label: 'Polypodium virginianum', rankLabel: 'species' },
    ],
    ownId: 'Q3007914',
    expected: 'life/eukaryota/plantae/tracheophytes/pteridophyta/polypodiophyta/polypodiopsida/polypodiales/polypodiaceae/polypodium',
  },
  {
    name: 'oak (rosid tree, uses quercus mapping)',
    ancestors: [
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
    ],
    ownId: 'Q147525',
    expected: 'life/eukaryota/plantae/tracheophytes/spermatophytes/angiosperms/eudicots/rosids/fagales/fagaceae/quercus',
  },
];

let passed = 0;
let failed = 0;

for (const { name, ancestors, ownId, expected } of TESTS) {
  try {
    const actual = buildTag(ancestors, ownId, labelMap);
    assert.strictEqual(actual, expected, `Mismatch for "${name}"\n  actual:   ${actual}\n  expected: ${expected}`);
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed out of ${TESTS.length} tests`);
process.exit(failed > 0 ? 1 : 0);
