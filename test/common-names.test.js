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
    name: 'Allium tricoccum full (Pattern A + I trap — no indigenous cuisines)',
    extract: 'Allium tricoccum (commonly known as ramps, ramson, wild leek, wood leek, or wild garlic) is a bulbous perennial flowering plant in the amaryllis family Amaryllidaceae. It is a North American species of wild onion or garlic found in eastern North America. Many of the common English names for this plant are also used for other Allium species, particularly the similar Allium ursinum, which is native to Eurasia.  An edible plant, Allium tricoccum is used in a variety of North American and indigenous cuisines, and has also been used by Native Americans in traditional medicine. A French rendering (chicagou) of a Miami–Illinois name for this plant is the namesake of the American city of Chicago.',
    expected: ['ramps', 'ramson', 'wild leek', 'wood leek', 'wild garlic'],
  },
  {
    name: 'Rubus idaeus (Pattern A — "also called" prefix in middle segment)',
    extract: 'Rubus idaeus (raspberry, also called red raspberry or occasionally European red raspberry to distinguish it from other raspberry species) is a red-fruited species of Rubus native to Eurasia and commonly cultivated in other temperate regions.',
    expected: ['raspberry', 'red raspberry'],
  },
  {
    name: 'Quercus robur (Pattern C — comma-separated list without article)',
    extract: 'Quercus robur, pedunculate oak, European oak, or English oak, is a species of flowering plant in the beech and oak family, Fagaceae.',
    expected: ['pedunculate oak', 'European oak', 'English oak'],
  },
  {
    name: 'Olea europaea (Pattern A — "botanical name" prefix stripped)',
    extract: 'The olive (botanical name Olea europaea, "European olive") is a species of subtropical evergreen tree in the family Oleaceae.',
    expected: ['European olive'],
  },
  {
    name: 'Rubus parviflorus (Pattern B should not match relative clause — no "fruit of which")',
    extract: 'Rubus parviflorus, the fruit of which is commonly called the thimbleberry or redcap, is a species of Rubus with large hairy leaves and no thorns.',
    expected: ['thimbleberry', 'redcap'],
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
    name: 'Crataegus rhipidophylla (Pattern B should not consume past 100 chars — no geographic terms)',
    extract: 'Crataegus rhipidophylla is a species of hawthorn which occurs naturally from southern Scandinavia and the Baltic region to France, the Balkan Peninsula, Turkey, Caucasia, and Ukraine. It is poorly known as a landscape and garden plant, but seems to have potential for those uses.',
    expected: [],
  },
  {
    name: 'Abies balsamea (Pattern J — "X or Y is" construction)',
    extract: 'Abies balsamea or balsam fir is a North American fir, native to most of eastern and central Canada (Newfoundland west to central Alberta) and the northeastern United States (Minnesota east to Maine, and south in the Appalachian Mountains to West Virginia).',
    expected: ['balsam fir'],
  },
  {
    name: 'Abronia latifolia (Pattern K — "known commonly as X, or Y. It is")',
    extract: 'The perennial flower Abronia latifolia or Abronia arenaria is a species of sand-verbena known commonly as the coastal sand-verbena, or yellow sand-verbena. It is native to the west coast of North America.',
    expected: ['coastal sand-verbena', 'yellow sand-verbena'],
  },
  {
    name: 'Acer buergerianum (Pattern A — parenthetical with semicolons and Chinese translations)',
    extract: 'Acer buergerianum (trident maple; simplified Chinese: 三角枫; traditional Chinese: 三角楓; pinyin: sānjiǎofēng) is a species of maple native to eastern China (from Shandong west to southeastern Gansu, south to Guangdong, and southwest to Sichuan), Taiwan and Japan.',
    expected: ['trident maple'],
  },
  {
    name: 'Farfugium japonicum (Pattern A — parenthetical "syn." filtered out)',
    extract: 'Farfugium japonicum (syn. Ligularia tussilaginea) is a species of flowering plant in the family Asteraceae, also known as leopard plant, green leopard plant or tractor seat plant. It is native to streams and seashores of Japan, where it is called tsuwabuki (石蕗).\n\n',
    expected: ['leopard plant', 'green leopard plant', 'tractor seat plant', 'tsuwabuki'],
  },
  {
    name: 'Iris foetidissima (Pattern D should not cross sentences — no "bruised")',
    extract: 'Iris foetidissima, the stinking iris, gladdon, Gladwin iris, roast-beef plant, or stinking gladwin, is a species of flowering plant in the family Iridaceae, found in open woodland, hedgebanks and on sea-cliffs.\nIts natural range is Western Europe, including England (south of Durham) and also Ireland, and from France south and east to N. Africa, Italy and Greece. \n\nIt is one of two iris species native to Britain, the other being the yellow iris (Iris pseudacorus).\nIt has tufts of dark green leaves. Its flowers are usually of a dull, leaden-blue colour, or dull buff-yellow tinged with blue. The petals have delicate veining. It blooms between June and July, but the flowers only last a day or so.\nThe green seed capsules, which remain attached to the plant throughout the winter, are 5\u20138 cm (2\u20133 in) long; and the seeds are scarlet.\nIt is known as "stinking" because some people find the smell of its leaves unpleasant when crushed or bruised, an odour that has been described as "beefy". Its common names of \'gladdon\' and \'gladwyn\' or \'gladwin\', are in reference to an old word for a sword (Latin gladius) due to the shape of the iris\'s leaves.\nThis plant is cultivated in gardens in the temperate zones. Both the species and its cultivar \'Variegata\' have gained the Royal Horticultural Society\'s Award of Garden Merit.',
    expected: ['stinking iris', 'gladdon', 'Gladwin iris', 'roast-beef plant', 'stinking gladwin'],
  },
  {
    name: 'Pelargonium (Pattern E — "commonly called" with period before next sentence)',
    extract: 'Pelargonium () is a genus of flowering plants commonly called geraniums, pelargoniums, or storksbills. It includes about 280 species of perennials, succulents, and shrubs.',
    expected: ['geraniums', 'pelargoniums', 'storksbills'],
  },
  {
    name: 'Erigeron glaucus (Pattern H — singular "common name" not just "common names")',
    extract: 'Erigeron glaucus is a species of flowering plant in the family Asteraceae known by the common name seaside fleabane, beach aster, or seaside daisy. It is native to the  West Coast of the United States.',
    expected: ['seaside fleabane', 'beach aster', 'seaside daisy'],
  },
  {
    name: 'Quercus agrifolia (Pattern A2 — "The common name (ScientificName)")',
    extract: 'The coast live oak (Quercus agrifolia), also called the California live oak, is a live oak (an semi-evergreen oak) native to the California Floristic Province.',
    expected: ['coast live oak', 'California live oak'],
  },
  {
    name: 'Narcissus pseudonarcissus ("commonly named" prefix stripped)',
    extract: 'Narcissus pseudonarcissus, commonly named the wild daffodil or Lent lily (Welsh: Cennin Pedr), is a perennial flowering plant.',
    expected: ['wild daffodil', 'Lent lily'],
  },
  {
    name: 'Tillandsia usneoides (Pattern A — common name before parenthetical, not scientific name inside)',
    extract: 'Spanish moss (Tillandsia usneoides) is an epiphytic flowering plant that often grows upon large trees in tropical and subtropical climates.',
    expected: ['Spanish moss'],
  },
  {
    name: 'Oreomecon nudicaulis ("synonym" prefix filtered)',
    extract: 'Oreomecon nudicaulis, synonym Papaver nudicaule, the Iceland poppy, is a boreal flowering plant.',
    expected: ['Iceland poppy'],
  },
  {
    name: 'Alstroemeria aurea (Pattern M — "The name X is often applied to")',
    extract: 'Alstroemeria aurea is a species of flowering plant in the family Alstroemeriaceae, native to Chile and Argentina, but naturalised in Australia, New Zealand and the United Kingdom. It is also widely cultivated as an ornamental.\n\n\n== Common names ==\nCommon names include yellow alstroemeria, though cultivars have been selected in a range of colours. The name Peruvian lily is often applied to this and other species of Alstroemeriaceae, despite the fact that most are not native to that country.',
    expected: ['yellow alstroemeria', 'Peruvian lily'],
  },
  {
    name: 'Leucanthemum (Pattern F — "Common names for X usually include" with parenthetical examples)',
    extract: 'Leucanthemum is a genus of flowering plants in the aster family, Asteraceae. Species range naturally from Europe through the Caucasus, Turkey, Iran, Central Asia, and Siberia to the Russian Far East. Some species are known on other continents as introduced species, and some are cultivated as ornamental plants. The name Leucanthemum derives from the Greek words λευκός – leukos ("white") and ἄνθεμον – anthemon ("flower").  Common names for Leucanthemum species usually include the name daisy (e.g. ox-eye daisy, Shasta daisy), but "daisy" can also refer to numerous other genera in the Asteraceae family.',
    expected: ['daisy', 'ox-eye daisy', 'Shasta daisy'],
  },
  {
    name: 'Clematis montana (Pattern B — "also" prefix in middle segment)',
    extract: 'Clematis montana, the mountain clematis, also Himalayan clematis or anemone clematis, is a flowering plant in the buttercup family Ranunculaceae.',
    expected: ['mountain clematis', 'Himalayan clematis', 'anemone clematis'],
  },
  {
    name: 'Arachis hypogaea (Pattern E — geographic qualifiers in parentheticals)',
    extract: 'The peanut (Arachis hypogaea), also known as the groundnut, goober (US, via Kikongo), goober pea, pindar (US, via Kikongo) or monkey nut (UK), is a legume crop grown mainly for its edible seeds.',
    expected: ['peanut', 'groundnut', 'goober', 'goober pea', 'pindar', 'monkey nut'],
  },
  {
    name: 'Chamaecyparis obtusa (CJK characters filtered)',
    extract: 'Chamaecyparis obtusa is a species of Chamaecyparis, native to central Japan. It is an important tree in Japanese forestry, called hinoki. Common names include Japanese cypress, hinoki cypress, hinoki, and 桧.',
    expected: ['Japanese cypress', 'hinoki cypress', 'hinoki'],
  },
  {
    name: 'Arctostaphylos uva-ursi (Pattern A fallback — name before descriptive parenthetical, Pattern F — "exist...such as")',
    extract: 'Arctostaphylos uva-ursi is a plant species of the genus Arctostaphylos widely distributed across circumboreal regions of the subarctic Northern Hemisphere. Kinnikinnick (from the Unami language for smoking "mixture") is a common name in Canada and the United States. Growing up to 30 centimetres (12 inches) in height, the leaves are evergreen. The flowers are white to pink and the fruit is a red berry.\nOne of several related species referred to as bearberry, its specific epithet uva-ursi means "grape of the bear" in Latin, similar to the meaning of the generic epithet Arctostaphylos (Greek for "bear grapes").\n\n== Etymology ==\nThe genus name of Arctostaphylos uva-ursi comes from the Greek words arctos (meaning bear) and staphyle (meaning "bunch of grapes") in reference to the fruits which form grape-like clusters. In the wild, the fruits are commonly eaten by bears. The specific epithet, uva-ursi, comes from the Latin words uva (meaning grape) and ursus (bear), reflected by the bearberry nickname.\nThe common name, kinnikinnick, is an Algonquin word meaning "smoking mixture". Native Americans and early pioneers smoked the dried uva-ursi leaves and bark alone or mixed with other herbs, tobacco or dried dogwood bark in pipes. Numerous common names exist, depending on region, such as mealberry, sandberry, mountain-box, fox-plum, hog-crawberry, and barren myrtle.',
    expected: ['Kinnikinnick', 'mealberry', 'sandberry', 'mountain-box', 'fox-plum', 'hog-crawberry', 'barren myrtle'],
  },
  {
    name: 'Arisaema triphyllum (Pattern B + N — appositive + "referred to as")',
    extract: 'Arisaema triphyllum, the Jack-in-the-pulpit, is a species of flowering plant in the arum family Araceae. It is a member of the Arisaema triphyllum complex, a group of four or five closely related taxa in eastern North America. The specific name triphyllum means "three-leaved", a characteristic feature of the species, which is also referred to as Indian turnip, bog onion, and brown dragon.',
    expected: ['Jack-in-the-pulpit', 'Indian turnip', 'bog onion', 'brown dragon'],
  },
  {
    name: 'Wisteria frutescens (Pattern D negative lookbehind — no "previously known as")',
    extract: 'Wisteria frutescens (common names American wisteria, swamp wisteria, Mississippi wisteria, and Atlantic wisteria) is a woody, deciduous, perennial climbing vine.\nRhizobium radiobacter, previously known as Agrobacterium tumefaciens and commonly as crown gall, is a soil-borne bacterium that occasionally infects wisteria.',
    expected: ['American wisteria', 'swamp wisteria', 'Mississippi wisteria', 'Atlantic wisteria'],
  },
  {
    name: 'Aegagropila brownii (Pattern A — single-word name before parenthetical)',
    extract: 'Marimo (also known as Cladophora ball, moss ball, moss ball pet, or lake ball) is a rare growth form of Aegagropila brownii (a species of filamentous green algae) in which the algae grow into large green spheres with a velvety appearance.\nThe species can be found in a number of lakes and rivers in Japan and Northern Europe. Colonies of marimo balls are known to form in Japan and Iceland, but their population has been declining.',
    expected: ['Marimo', 'Cladophora ball', 'moss ball', 'moss ball pet', 'lake ball'],
  },
  {
    name: 'Lilium regale (geographic qualifier "in New Zealand" filtered)',
    extract: "Lilium regale, called the regal lily, royal lily, king's lily,or, in New Zealand, the Christmas lily, is a species of flowering plant in the lily family Liliaceae, with trumpet-shaped flowers.",
    expected: ['regal lily', 'royal lily', "king's lily", 'Christmas lily'],
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
