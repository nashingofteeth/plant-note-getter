const assert = require('node:assert');
const { extractWikipediaCommonNames } = require('../src/wikidata');

const TESTS = [
  {
    name: 'Eschscholzia californica (appositive with article, or connector)',
    extract: 'Eschscholzia californica, the California poppy, golden poppy, Mexican poppy, California sunlight or cup of gold, is a species of flowering plant in the family Papaveraceae, native to the United States and Mexico.',
    expected: ['California poppy', 'golden poppy', 'Mexican poppy', 'California sunlight', 'cup of gold'],
  },
  {
    name: 'Stellaria media (appositive without article, single name)',
    extract: 'Stellaria media, chickweed, is an annual flowering plant in the family Caryophyllaceae.',
    expected: ['chickweed'],
  },
  {
    name: 'Lactuca serriola (also called — Pattern E, with parenthetical aside)',
    extract: 'Lactuca serriola, also called prickly lettuce, milk thistle (not to be confused with Silybum marianum, also called milk thistle), compass plant, and scarole, is an annual or biennial plant in the tribe Cichorieae within the family Asteraceae.',
    expected: ['prickly lettuce', 'milk thistle', 'compass plant', 'scarole'],
  },
  {
    name: 'Origanum onites (appositive with article, or connector, language qualifier, Greek parenthetical)',
    extract: 'Origanum onites, the Cretan oregano, Greek oregano, pot marjoram or Ellinikí rίgani in Greek (Ελληνική ρίγανη), is a plant species in the genus Origanum found in Sicily, Greece and Turkey.',
    expected: ['Cretan oregano', 'Greek oregano', 'pot marjoram', 'Ellinikí rίgani'],
  },
  {
    name: 'Malephora crocea (known by the common names)',
    extract: "Malephora crocea is a species of succulent perennial flowering plant in the ice plant family known by the common names 'coppery mesemb' and 'red ice plant'.",
    expected: ['coppery mesemb', 'red ice plant'],
  },
  {
    name: 'Lewisia cotyledon (known by the common names)',
    extract: 'Lewisia cotyledon is a species of flowering plant in the family Montiaceae known by the common names Siskiyou lewisia and cliff maids.',
    expected: ['Siskiyou lewisia', 'cliff maids'],
  },
  {
    name: 'Oreomecon crocea (appositive without article, common name prefix)',
    extract: 'Oreomecon crocea, common name ice poppy, is a species of flowering plant in the poppy family.',
    expected: ['ice poppy'],
  },
  {
    name: 'Viburnum edule (appositive with article, long list, no comma before verb)',
    extract: 'Viburnum edule, the squashberry, mooseberry, moosomin, moosewood viburnum, pembina, pimina, highbush cranberry, or lowbush cranberry is a species of shrub.',
    expected: ['squashberry', 'mooseberry', 'moosomin', 'moosewood viburnum', 'pembina', 'pimina', 'highbush cranberry', 'lowbush cranberry'],
  },
  {
    name: 'Ulmus americana (generally known as — Pattern D)',
    extract: 'Ulmus americana, generally known as the American elm or, less commonly, as the white elm or water elm, is a species of elm native to eastern North America.',
    expected: ['American elm', 'white elm', 'water elm'],
  },
  {
    name: 'Populus (Pattern G — English names include, with empty parens)',
    extract: 'Populus is a genus of 25\u201330 species of deciduous flowering plants in the family Salicaceae, native to most of the Northern Hemisphere. English names variously applied to different species include poplar ( ), aspen, and cottonwood.',
    expected: ['poplar', 'aspen', 'cottonwood'],
  },
  {
    name: 'Sambucus nigra (Pattern F — Common names include)',
    extract: 'Sambucus nigra is a temperate species of tree or shrub in the family Viburnaceae native to the Azores, Europe, and the Middle East. Common names include elder, elderberry, black elder, European elder, European elderberry, and European black elderberry.',
    expected: ['elder', 'elderberry', 'black elder', 'European elder', 'European elderberry', 'European black elderberry'],
  },
  {
    name: 'Allium tricoccum (Pattern A — parenthetical with commonly known as)',
    extract: 'Allium tricoccum (commonly known as ramps, ramson, wild leek, wood leek, or wild garlic) is a bulbous perennial flowering plant in the amaryllis family Amaryllidaceae.',
    expected: ['ramps', 'ramson', 'wild leek', 'wood leek', 'wild garlic'],
  },
  {
    name: 'Asimina triloba (appositive with article, among many regional names filler)',
    extract: 'Asimina triloba, the American papaw, pawpaw, paw paw, or paw-paw, among many regional names, is a species of small deciduous tree.',
    expected: ['American papaw', 'pawpaw', 'paw paw', 'paw-paw'],
  },
  {
    name: 'Rosa rubiginosa (Pattern A — parenthetical with syn. filter)',
    extract: 'Rosa rubiginosa (sweet briar, sweetbriar rose, sweet brier or eglantine; syn. R. eglanteria) is a species of rose native to Europe and western Asia.',
    expected: ['sweet briar', 'sweetbriar rose', 'sweet brier', 'eglantine'],
  },
  {
    name: 'Jasminum officinale (Pattern D + I — also known as in second paragraph)',
    extract: 'Jasminum officinale, known as the common jasmine or simply jasmine, is a species of flowering plant in the olive family Oleaceae. It is native to the Caucasus and parts of Asia, also widely naturalized.\nIt is also known as summer jasmine, poet\'s jasmine, white jasmine, true jasmine or jessamine, and is particularly valued by gardeners throughout the temperate world for the intense fragrance of its flowers in summer. It is also the National flower of Pakistan.',
    expected: ['common jasmine', 'jasmine', 'summer jasmine', 'poet\'s jasmine', 'white jasmine', 'true jasmine', 'jessamine'],
  },
  {
    name: 'Iris foetidissima (Pattern D should not cross sentences — no "bruised")',
    extract: 'Iris foetidissima, the stinking iris, gladdon, Gladwin iris, roast-beef plant, or stinking gladwin, is a species of flowering plant in the family Iridaceae, found in open woodland, hedgebanks and on sea-cliffs.\nIts natural range is Western Europe, including England (south of Durham) and also Ireland, and from France south and east to N. Africa, Italy and Greece. \n\nIt is one of two iris species native to Britain, the other being the yellow iris (Iris pseudacorus).\nIt has tufts of dark green leaves. Its flowers are usually of a dull, leaden-blue colour, or dull buff-yellow tinged with blue. The petals have delicate veining. It blooms between June and July, but the flowers only last a day or so.\nThe green seed capsules, which remain attached to the plant throughout the winter, are 5\u20138 cm (2\u20133 in) long; and the seeds are scarlet.\nIt is known as "stinking" because some people find the smell of its leaves unpleasant when crushed or bruised, an odour that has been described as "beefy". Its common names of \'gladdon\' and \'gladwyn\' or \'gladwin\', are in reference to an old word for a sword (Latin gladius) due to the shape of the iris\'s leaves.\nThis plant is cultivated in gardens in the temperate zones. Both the species and its cultivar \'Variegata\' have gained the Royal Horticultural Society\'s Award of Garden Merit.',
    expected: ['stinking iris', 'gladdon', 'Gladwin iris', 'roast-beef plant', 'stinking gladwin'],
  },
];

let passed = 0;
let failed = 0;

for (const { name, extract, expected } of TESTS) {
  try {
    const actual = extractWikipediaCommonNames(extract);
    assert.deepStrictEqual(
      actual.sort(),
      expected.slice().sort(),
      `Mismatch for "${name}"\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`
    );
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
