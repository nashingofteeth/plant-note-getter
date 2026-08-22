// Mock ancestor chains verified against live Wikidata queries (2026-07-22).
// Only relevant ancestors are included — skipped ranks (subdivision, subfamily,
// tribe, section, superdomain, etc.) are omitted for conciseness.

const { test } = require('node:test');
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
    name: 'podocarp (podocarpaceae injection adds pinopsida + araucariales)',
    ancestors: [
      { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
      { id: 'Q27133', label: 'tracheophyte', rankLabel: 'division' },
      { id: 'Q25814', label: 'Spermatophyta', rankLabel: 'subdivision' },
      { id: 'Q56639776', label: 'Acrogymnospermae', rankLabel: null },
      { id: 'Q132825', label: 'conifer', rankLabel: 'division' },
      { id: 'Q156319', label: 'Podocarpaceae', rankLabel: 'family' },
      { id: 'Q157749', label: 'Podocarpus', rankLabel: 'genus' },
      { id: 'Q599622', label: 'Podocarpus totara', rankLabel: 'species' },
    ],
    ownId: 'Q599622',
    expected: 'life/eukaryota/plantae/tracheophytes/spermatophytes/gymnospermae/pinophyta/pinopsida/araucariales/podocarpaceae/podocarpus',
  },
  {
    name: 'taxus (taxaceae injection adds pinopsida + cupressales)',
    ancestors: [
      { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
      { id: 'Q27133', label: 'tracheophyte', rankLabel: 'division' },
      { id: 'Q25814', label: 'Spermatophyta', rankLabel: 'subdivision' },
      { id: 'Q56639776', label: 'Acrogymnospermae', rankLabel: null },
      { id: 'Q132825', label: 'conifer', rankLabel: 'division' },
      { id: 'Q1755504', label: 'Taxaceae', rankLabel: 'family' },
      { id: 'Q27355', label: 'Taxus', rankLabel: 'genus' },
      { id: 'Q148829', label: 'Taxus baccata', rankLabel: 'species' },
    ],
    ownId: 'Q148829',
    expected: 'life/eukaryota/plantae/tracheophytes/spermatophytes/gymnospermae/pinophyta/pinopsida/cupressales/taxaceae/taxus',
  },
  {
    name: 'sciadopitys (_overrides fixes equisetophyta/cupressales corruption)',
    ancestors: [
      { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
      { id: 'Q99867', label: 'Equisetophyta', rankLabel: 'division' },
      { id: 'Q99868', label: 'Equisetopsida', rankLabel: 'class' },
      { id: 'Q108546', label: 'Cupressales', rankLabel: 'order' },
      { id: 'Q1202721', label: 'Sciadopityaceae', rankLabel: 'family' },
      { id: 'Q161648', label: 'Sciadopitys', rankLabel: 'genus' },
      { id: 'Q161649', label: 'Sciadopitys verticillata', rankLabel: 'species' },
    ],
    ownId: 'Q161649',
    expected: 'life/eukaryota/plantae/tracheophytes/spermatophytes/gymnospermae/pinophyta/pinopsida/pinales/sciadopityaceae/sciadopitys',
  },
  {
    name: 'maianthemum (_overrides fixes solanales/solanaceae corruption)',
    ancestors: [
      { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
      { id: 'Q25314', label: 'Angiosperms', rankLabel: null },
      { id: 'Q165468', label: 'Eudicots', rankLabel: null },
      { id: 'Q21723', label: 'Solanales', rankLabel: 'order' },
      { id: 'Q134172', label: 'Solanaceae', rankLabel: 'family' },
      { id: 'Q161408', label: 'Nolanoideae', rankLabel: 'subfamily' },
      { id: 'Q157848', label: 'Maianthemum', rankLabel: 'genus' },
      { id: 'Q3486643', label: 'Maianthemum racemosum', rankLabel: 'species' },
    ],
    ownId: 'Q3486643',
    expected: 'life/eukaryota/plantae/tracheophytes/spermatophytes/angiosperms/monocots/asparagales/asparagaceae/maianthemum',
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

for (const { name, ancestors, ownId, expected } of TESTS) {
  test(name, () => {
    const actual = buildTag(ancestors, ownId, labelMap);
    assert.strictEqual(actual, expected, `Mismatch for "${name}"\n  actual:   ${actual}\n  expected: ${expected}`);
  });
}
