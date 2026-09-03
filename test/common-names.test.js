const { test } = require('node:test');
const assert = require('node:assert');
const { extractWikipediaCommonNames, parseGbifVernacularName } = require('../src/wiki-extract');

const TESTS = [
  {
    name: 'Lavandula latifolia (appositive "known as" list with "or" connector, demonym "Portuguese" prefix)',
    extract: 'Lavandula latifolia, known as broadleaved lavender, spike lavender, aspic lavender or Portuguese lavender, is a flowering plant in the family Lamiaceae, native to the western Mediterranean basin.',
    expected: ['broadleaved lavender', 'spike lavender', 'aspic lavender', 'Portuguese lavender'],
  },
  {
    name: 'Callicarpa (genus Selected species names filtered — species-level names not genus aliases)',
    extract: 'Callicarpa, commonly known as beautyberry, is a genus of shrubs and small trees in the family Lamiaceae.\n\n== Selected species ==\n\nCallicarpa americana (American beautyberry) is native to the southeastern United States.\nCallicarpa japonica (Japanese beautyberry), native to Japan, is also cultivated in gardens. It is called Murasakishikibu in Japanese, in honor of Murasaki Shikibu.\nCallicarpa dichotoma (Purple beautyberry), native to Japan, China, and Korea.',
    expected: ['beautyberry'],
  },
  {
    name: 'Eschscholzia californica (appositive with article, or connector)',
    extract: 'Eschscholzia californica, the California poppy, golden poppy, Mexican poppy, California sunlight or cup of gold, is a species of flowering plant in the family Papaveraceae, native to the United States and Mexico.',
    expected: ['California poppy', 'golden poppy', 'Mexican poppy', 'California sunlight', 'cup of gold'],
  },
  {
    name: 'Erica vagans (appositive, place-name prefix "Cornish" not binomial-lookalike)',
    extract: 'Erica vagans, the Cornish heath or wandering heath, is a species of flowering plant in the family Ericaceae, native to Ireland, Cornwall, western France and Spain.',
    expected: ['Cornish heath', 'wandering heath'],
  },
  {
    name: 'Stellaria media (appositive without article, single name)',
    extract: 'Stellaria media, chickweed, is an annual flowering plant in the family Caryophyllaceae.',
    expected: ['chickweed'],
  },
  {
    name: 'Lactuca serriola (also called, with parenthetical aside)',
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
    name: 'Mimulus ringens (known by the common names — place-name prefix "Allegheny")',
    extract: 'Mimulus ringens is a species of monkeyflower known by the common names Allegheny monkeyflower and square-stemmed monkeyflower.',
    expected: ['Allegheny monkeyflower', 'square-stemmed monkeyflower'],
  },
  {
    name: 'Catharanthus roseus (place-name prefix "Madagascar" not binomial-lookalike)',
    extract: 'Catharanthus roseus, commonly known as bright eyes, Cape periwinkle, graveyard plant, Madagascar periwinkle, old maid, pink periwinkle, rose periwinkle, is a perennial species of flowering plant in the family Apocynaceae.',
    expected: ['bright eyes', 'Cape periwinkle', 'graveyard plant', 'Madagascar periwinkle', 'old maid', 'pink periwinkle', 'rose periwinkle'],
  },
  {
    name: 'Catharanthus roseus (has many vernacular names among which are X, Y, Z)',
    extract: 'Catharanthus roseus, commonly known as bright eyes, Cape periwinkle, graveyard plant, Madagascar periwinkle, old maid, pink periwinkle, rose periwinkle, is a perennial species of flowering plant in the family Apocynaceae. It has many vernacular names among which are arivotaombelona or rivotambelona, tonga, tongatse or trongatse, tsimatiririnina, and vonenina.',
    expected: ['bright eyes', 'Cape periwinkle', 'graveyard plant', 'Madagascar periwinkle', 'old maid', 'pink periwinkle', 'rose periwinkle', 'arivotaombelona', 'rivotambelona', 'tonga', 'tongatse', 'trongatse', 'tsimatiririnina', 'vonenina'],
  },
  {
    name: 'Oreomecon crocea (appositive without article, common name prefix)',
    extract: 'Oreomecon crocea, common name ice poppy, is a species of flowering plant in the poppy family.',
    expected: ['ice poppy'],
  },
  {
    name: 'Delosperma (etymology gloss parenthetical "(\'delos\'=evident, \'sperma\'=seed)" not common names)',
    extract: "Delosperma ('delos'=evident, 'sperma'=seed) is a genus of around 170 species of succulent plants, formerly included in Mesembryanthemum in the family Aizoaceae.",
    expected: [],
  },
  {
    name: 'Viburnum edule (appositive with article, long list, no comma before verb)',
    extract: 'Viburnum edule, the squashberry, mooseberry, moosomin, moosewood viburnum, pembina, pimina, highbush cranberry, or lowbush cranberry is a species of shrub.',
    expected: ['squashberry', 'mooseberry', 'moosomin', 'moosewood viburnum', 'pembina', 'pimina', 'highbush cranberry', 'lowbush cranberry'],
  },
  {
    name: 'Ulmus americana (generally known as)',
    extract: 'Ulmus americana, generally known as the American elm or, less commonly, as the white elm or water elm, is a species of elm native to eastern North America.',
    expected: ['American elm', 'white elm', 'water elm'],
  },
  {
    name: 'Populus (English names include, with empty parens)',
    extract: 'Populus is a genus of 25\u201330 species of deciduous flowering plants in the family Salicaceae, native to most of the Northern Hemisphere. English names variously applied to different species include poplar ( ), aspen, and cottonwood.',
    expected: ['poplar', 'aspen', 'cottonwood'],
  },
  {
    name: 'Sambucus nigra (Common names include)',
    extract: 'Sambucus nigra is a temperate species of tree or shrub in the family Viburnaceae native to the Azores, Europe, and the Middle East. Common names include elder, elderberry, black elder, European elder, European elderberry, and European black elderberry.',
    expected: ['elder', 'elderberry', 'black elder', 'European elder', 'European elderberry', 'European black elderberry'],
  },
  {
    name: 'Allium tricoccum (parenthetical with commonly known as)',
    extract: 'Allium tricoccum (commonly known as ramps, ramson, wild leek, wood leek, or wild garlic) is a bulbous perennial flowering plant in the amaryllis family Amaryllidaceae.',
    expected: ['ramps', 'ramson', 'wild leek', 'wood leek', 'wild garlic'],
  },
  {
    name: 'Allium tricoccum full (larger extract — no indigenous cuisines)',
    extract: 'Allium tricoccum (commonly known as ramps, ramson, wild leek, wood leek, or wild garlic) is a bulbous perennial flowering plant in the amaryllis family Amaryllidaceae. It is a North American species of wild onion or garlic found in eastern North America. Many of the common English names for this plant are also used for other Allium species, particularly the similar Allium ursinum, which is native to Eurasia.  An edible plant, Allium tricoccum is used in a variety of North American and indigenous cuisines, and has also been used by Native Americans in traditional medicine. A French rendering (chicagou) of a Miami–Illinois name for this plant is the namesake of the American city of Chicago.',
    expected: ['ramps', 'ramson', 'wild leek', 'wood leek', 'wild garlic'],
  },
  {
    name: 'Rubus idaeus ("also called" in middle segment)',
    extract: 'Rubus idaeus (raspberry, also called red raspberry or occasionally European red raspberry to distinguish it from other raspberry species) is a red-fruited species of Rubus native to Eurasia and commonly cultivated in other temperate regions.',
    expected: ['raspberry', 'red raspberry'],
  },
  {
    name: 'Quercus robur (comma-separated list without article)',
    extract: 'Quercus robur, pedunculate oak, European oak, or English oak, is a species of flowering plant in the beech and oak family, Fagaceae.',
    expected: ['pedunculate oak', 'European oak', 'English oak'],
  },
  {
    name: 'Olea europaea ("botanical name" prefix stripped)',
    extract: 'The olive (botanical name Olea europaea, "European olive") is a species of subtropical evergreen tree in the family Oleaceae.',
    expected: ['European olive'],
  },
  {
    name: 'Rubus parviflorus (relative clause not matched — no "fruit of which")',
    extract: 'Rubus parviflorus, the fruit of which is commonly called the thimbleberry or redcap, is a species of Rubus with large hairy leaves and no thorns.',
    expected: ['thimbleberry', 'redcap'],
  },
  {
    name: 'Asimina triloba (appositive with article, among many regional names filler)',
    extract: 'Asimina triloba, the American papaw, pawpaw, paw paw, or paw-paw, among many regional names, is a species of small deciduous tree.',
    expected: ['American papaw', 'pawpaw', 'paw paw', 'paw-paw'],
  },
  {
    name: 'Rosa rubiginosa (parenthetical with syn. filter)',
    extract: 'Rosa rubiginosa (sweet briar, sweetbriar rose, sweet brier or eglantine; syn. R. eglanteria) is a species of rose native to Europe and western Asia.',
    expected: ['sweet briar', 'sweetbriar rose', 'sweet brier', 'eglantine'],
  },
  {
    name: 'Jasminum officinale (also known as in second paragraph)',
    extract: 'Jasminum officinale, known as the common jasmine or simply jasmine, is a species of flowering plant in the olive family Oleaceae. It is native to the Caucasus and parts of Asia, also widely naturalized.\nIt is also known as summer jasmine, poet\'s jasmine, white jasmine, true jasmine or jessamine, and is particularly valued by gardeners throughout the temperate world for the intense fragrance of its flowers in summer. It is also the National flower of Pakistan.',
    expected: ['common jasmine', 'jasmine', 'summer jasmine', 'poet\'s jasmine', 'white jasmine', 'true jasmine', 'jessamine'],
  },
  {
    name: 'Crataegus rhipidophylla (no over-consumption — no geographic terms)',
    extract: 'Crataegus rhipidophylla is a species of hawthorn which occurs naturally from southern Scandinavia and the Baltic region to France, the Balkan Peninsula, Turkey, Caucasia, and Ukraine. It is poorly known as a landscape and garden plant, but seems to have potential for those uses.',
    expected: [],
  },
  {
    name: 'Abies balsamea ("X or Y is" construction)',
    extract: 'Abies balsamea or balsam fir is a North American fir, native to most of eastern and central Canada (Newfoundland west to central Alberta) and the northeastern United States (Minnesota east to Maine, and south in the Appalachian Mountains to West Virginia).',
    expected: ['balsam fir'],
  },
  {
    name: 'Abronia latifolia ("known commonly as X, or Y. It is")',
    extract: 'The perennial flower Abronia latifolia or Abronia arenaria is a species of sand-verbena known commonly as the coastal sand-verbena, or yellow sand-verbena. It is native to the west coast of North America.',
    expected: ['coastal sand-verbena', 'yellow sand-verbena'],
  },
  {
    name: 'Acer buergerianum (parenthetical with semicolons and Chinese translations)',
    extract: 'Acer buergerianum (trident maple; simplified Chinese: 三角枫; traditional Chinese: 三角楓; pinyin: sānjiǎofēng) is a species of maple native to eastern China (from Shandong west to southeastern Gansu, south to Guangdong, and southwest to Sichuan), Taiwan and Japan.',
    expected: ['trident maple'],
  },
  {
    name: 'Farfugium japonicum (parenthetical "syn." filtered out)',
    extract: 'Farfugium japonicum (syn. Ligularia tussilaginea) is a species of flowering plant in the family Asteraceae, also known as leopard plant, green leopard plant or tractor seat plant. It is native to streams and seashores of Japan, where it is called tsuwabuki (石蕗).\n\n',
    expected: ['leopard plant', 'green leopard plant', 'tractor seat plant', 'tsuwabuki'],
  },
  {
    name: 'Iris foetidissima (no cross-sentence overreach — no "bruised")',
    extract: 'Iris foetidissima, the stinking iris, gladdon, Gladwin iris, roast-beef plant, or stinking gladwin, is a species of flowering plant in the family Iridaceae, found in open woodland, hedgebanks and on sea-cliffs.\nIts natural range is Western Europe, including England (south of Durham) and also Ireland, and from France south and east to N. Africa, Italy and Greece. \n\nIt is one of two iris species native to Britain, the other being the yellow iris (Iris pseudacorus).\nIt has tufts of dark green leaves. Its flowers are usually of a dull, leaden-blue colour, or dull buff-yellow tinged with blue. The petals have delicate veining. It blooms between June and July, but the flowers only last a day or so.\nThe green seed capsules, which remain attached to the plant throughout the winter, are 5\u20138 cm (2\u20133 in) long; and the seeds are scarlet.\nIt is known as "stinking" because some people find the smell of its leaves unpleasant when crushed or bruised, an odour that has been described as "beefy". Its common names of \'gladdon\' and \'gladwyn\' or \'gladwin\', are in reference to an old word for a sword (Latin gladius) due to the shape of the iris\'s leaves.\nThis plant is cultivated in gardens in the temperate zones. Both the species and its cultivar \'Variegata\' have gained the Royal Horticultural Society\'s Award of Garden Merit.',
    expected: ['stinking iris', 'gladdon', 'Gladwin iris', 'roast-beef plant', 'stinking gladwin'],
  },
  {
    name: 'Pelargonium ("commonly called" with period before next sentence)',
    extract: 'Pelargonium () is a genus of flowering plants commonly called geraniums, pelargoniums, or storksbills. It includes about 280 species of perennials, succulents, and shrubs.',
    expected: ['geraniums', 'pelargoniums', 'storksbills'],
  },
  {
    name: 'Erigeron glaucus (singular "common name" not just "common names")',
    extract: 'Erigeron glaucus is a species of flowering plant in the family Asteraceae known by the common name seaside fleabane, beach aster, or seaside daisy. It is native to the  West Coast of the United States.',
    expected: ['seaside fleabane', 'beach aster', 'seaside daisy'],
  },
  {
    name: 'Quercus agrifolia ("The common name (ScientificName)")',
    extract: 'The coast live oak (Quercus agrifolia), also called the California live oak, is a live oak (an semi-evergreen oak) native to the California Floristic Province.',
    expected: ['coast live oak', 'California live oak'],
  },
  {
    name: 'Narcissus pseudonarcissus ("commonly named" prefix stripped)',
    extract: 'Narcissus pseudonarcissus, commonly named the wild daffodil or Lent lily (Welsh: Cennin Pedr), is a perennial flowering plant.',
    expected: ['wild daffodil', 'Lent lily'],
  },
  {
    name: 'Tillandsia usneoides (common name before parenthetical, not scientific name inside)',
    extract: 'Spanish moss (Tillandsia usneoides) is an epiphytic flowering plant that often grows upon large trees in tropical and subtropical climates.',
    expected: ['Spanish moss'],
  },
  {
    name: 'Oreomecon nudicaulis ("synonym" prefix filtered)',
    extract: 'Oreomecon nudicaulis, synonym Papaver nudicaule, the Iceland poppy, is a boreal flowering plant.',
    expected: ['Iceland poppy'],
  },
  {
    name: 'Alstroemeria aurea ("The name X is often applied to")',
    extract: 'Alstroemeria aurea is a species of flowering plant in the family Alstroemeriaceae, native to Chile and Argentina, but naturalised in Australia, New Zealand and the United Kingdom. It is also widely cultivated as an ornamental.\n\n\n== Common names ==\nCommon names include yellow alstroemeria, though cultivars have been selected in a range of colours. The name Peruvian lily is often applied to this and other species of Alstroemeriaceae, despite the fact that most are not native to that country.',
    expected: ['yellow alstroemeria', 'Peruvian lily'],
  },
  {
    name: 'Leucanthemum ("Common names for X usually include" with parenthetical examples)',
    extract: 'Leucanthemum is a genus of flowering plants in the aster family, Asteraceae. Species range naturally from Europe through the Caucasus, Turkey, Iran, Central Asia, and Siberia to the Russian Far East. Some species are known on other continents as introduced species, and some are cultivated as ornamental plants. The name Leucanthemum derives from the Greek words λευκός – leukos ("white") and ἄνθεμον – anthemon ("flower").  Common names for Leucanthemum species usually include the name daisy (e.g. ox-eye daisy, Shasta daisy), but "daisy" can also refer to numerous other genera in the Asteraceae family.',
    expected: ['daisy', 'ox-eye daisy', 'Shasta daisy'],
  },
  {
    name: 'Clematis montana ("also" prefix in middle segment)',
    extract: 'Clematis montana, the mountain clematis, also Himalayan clematis or anemone clematis, is a flowering plant in the buttercup family Ranunculaceae.',
    expected: ['mountain clematis', 'Himalayan clematis', 'anemone clematis'],
  },
  {
    name: 'Arachis hypogaea (geographic qualifiers in parentheticals)',
    extract: 'The peanut (Arachis hypogaea), also known as the groundnut, goober (US, via Kikongo), goober pea, pindar (US, via Kikongo) or monkey nut (UK), is a legume crop grown mainly for its edible seeds.',
    expected: ['peanut', 'groundnut', 'goober', 'goober pea', 'pindar', 'monkey nut'],
  },
  {
    name: 'Chamaecyparis obtusa (CJK characters filtered)',
    extract: 'Chamaecyparis obtusa is a species of Chamaecyparis, native to central Japan. It is an important tree in Japanese forestry, called hinoki. Common names include Japanese cypress, hinoki cypress, hinoki, and 桧.',
    expected: ['Japanese cypress', 'hinoki cypress', 'hinoki'],
  },
  {
    name: 'Arctostaphylos uva-ursi (name before descriptive parenthetical; "exist...such as")',
    extract: 'Arctostaphylos uva-ursi is a plant species of the genus Arctostaphylos widely distributed across circumboreal regions of the subarctic Northern Hemisphere. Kinnikinnick (from the Unami language for smoking "mixture") is a common name in Canada and the United States. Growing up to 30 centimetres (12 inches) in height, the leaves are evergreen. The flowers are white to pink and the fruit is a red berry.\nOne of several related species referred to as bearberry, its specific epithet uva-ursi means "grape of the bear" in Latin, similar to the meaning of the generic epithet Arctostaphylos (Greek for "bear grapes").\n\n== Etymology ==\nThe genus name of Arctostaphylos uva-ursi comes from the Greek words arctos (meaning bear) and staphyle (meaning "bunch of grapes") in reference to the fruits which form grape-like clusters. In the wild, the fruits are commonly eaten by bears. The specific epithet, uva-ursi, comes from the Latin words uva (meaning grape) and ursus (bear), reflected by the bearberry nickname.\nThe common name, kinnikinnick, is an Algonquin word meaning "smoking mixture". Native Americans and early pioneers smoked the dried uva-ursi leaves and bark alone or mixed with other herbs, tobacco or dried dogwood bark in pipes. Numerous common names exist, depending on region, such as mealberry, sandberry, mountain-box, fox-plum, hog-crawberry, and barren myrtle.',
    expected: ['Kinnikinnick', 'mealberry', 'sandberry', 'mountain-box', 'fox-plum', 'hog-crawberry', 'barren myrtle'],
  },
  {
    name: 'Arisaema triphyllum (appositive + "referred to as")',
    extract: 'Arisaema triphyllum, the Jack-in-the-pulpit, is a species of flowering plant in the arum family Araceae. It is a member of the Arisaema triphyllum complex, a group of four or five closely related taxa in eastern North America. The specific name triphyllum means "three-leaved", a characteristic feature of the species, which is also referred to as Indian turnip, bog onion, and brown dragon.',
    expected: ['Jack-in-the-pulpit', 'Indian turnip', 'bog onion', 'brown dragon'],
  },
  {
    name: 'Coffea (pronoun descriptive clauses after "referred to as" rejected)',
    extract: 'The fruit is often referred to as a "coffee cherry", and it contains two seeds, called "coffee beans".',
    expected: ['coffee cherry', 'coffee beans'],
  },
  {
    name: 'Coffea (aliases of other species in parenthetical binomial rejected)',
    extract: 'The coffee trade relies heavily on two of the over 120 species, Coffea arabica (commonly known simply as "Arabica"), which accounts for around 55% of the world\'s coffee production, and Coffea canephora (known as "Robusta"), which accounts for around 45%.',
    expected: [],
  },
  {
    name: 'Wisteria frutescens (no "previously known as")',
    extract: 'Wisteria frutescens (common names American wisteria, swamp wisteria, Mississippi wisteria, and Atlantic wisteria) is a woody, deciduous, perennial climbing vine.\nRhizobium radiobacter, previously known as Agrobacterium tumefaciens and commonly as crown gall, is a soil-borne bacterium that occasionally infects wisteria.',
    expected: ['American wisteria', 'swamp wisteria', 'Mississippi wisteria', 'Atlantic wisteria'],
  },
  {
    name: 'Aegagropila brownii (single-word name before parenthetical)',
    extract: 'Marimo (also known as Cladophora ball, moss ball, moss ball pet, or lake ball) is a rare growth form of Aegagropila brownii (a species of filamentous green algae) in which the algae grow into large green spheres with a velvety appearance.\nThe species can be found in a number of lakes and rivers in Japan and Northern Europe. Colonies of marimo balls are known to form in Japan and Iceland, but their population has been declining.',
    expected: ['Marimo', 'Cladophora ball', 'moss ball', 'moss ball pet', 'lake ball'],
  },
  {
    name: 'Lilium regale (geographic qualifier "in New Zealand" filtered)',
    extract: "Lilium regale, called the regal lily, royal lily, king's lily,or, in New Zealand, the Christmas lily, is a species of flowering plant in the lily family Liliaceae, with trumpet-shaped flowers.",
    expected: ['regal lily', 'royal lily', "king's lily", 'Christmas lily'],
  },
  {
    name: 'Pinus palustris (scientific name in parenthetical not leaked)',
    extract: 'The longleaf pine (Pinus palustris) is a pine species native to the Southeastern United States, found along the coastal plain from East Texas to southern Virginia, extending into northern and central Florida.',
    expected: ['longleaf pine'],
  },
  {
    name: 'Cornus controversa (taxonomic annotation between ) and verb)',
    extract: 'Cornus controversa (wedding cake tree), syn. Swida controversa, is a species of flowering plant in the dogwood family Cornaceae.',
    expected: ['wedding cake tree'],
  },
  {
    name: 'Picea engelmannii ("with the common names" lists names directly)',
    extract: 'Picea engelmannii, with the common names Engelmann spruce, mountain spruce, and silver spruce, is a species of spruce native to western North America.',
    expected: ['Engelmann spruce', 'mountain spruce', 'silver spruce'],
  },
  {
    name: 'Elegia tectorum ("more commonly X" construction)',
    extract: 'Elegia tectorum, previously Chondropetalum tectorum or Restio tectorum, more commonly Cape thatching reed, or dakriet (in Afrikaans), is a member of the restio family, Restionaceae.',
    expected: ['Cape thatching reed', 'dakriet'],
  },
  {
    name: 'Phedimus spurius ("formerly" prefix stripped from segments)',
    extract: 'Phedimus spurius, formerly Sedum spurium, the Caucasian stonecrop or two-row stonecrop, is a species of flowering plant in the family Crassulaceae.',
    expected: ['Caucasian stonecrop', 'two-row stonecrop'],
  },
  {
    name: 'Arrhenatherum elatius (intro with abbreviation period, habitat with other species in parens)',
    extract: "Arrhenatherum elatius is a species of flowering plant in the grass family Poaceae, commonly known as false oat-grass, and also bulbous oat grass (subsp. bulbosum), tall oat-grass, tall meadow oat, onion couch and tuber oat-grass. It is native throughout Europe (including Iceland), and also western and southwestern Asia (south to Jordan and Iran), and northwestern Africa (Morocco to Tunisia). This tufted grass is sometimes used as an ornamental grass and is sometimes marketed as \"cat grass\".\nOutside of its native range it can be found elsewhere as an introduced species. It is found especially in prairies, at the side of roads and in uncultivated fields. The bulbous subspecies can be a weed of arable land. It is palatable grass for livestock and is used both as forage (pasture) and fodder (hay and silage).\n\n\n== Description ==\nThis coarse grass can grow to 1.80 m (6 ft) tall. The leaves are 4\u201310 mm (0\u20130 in) wide, bright green, broad, slightly hairy, and rough. The ligule is 1\u20133 mm (0\u20130 in) long and smooth edged. The panicle is up to 30 cm (12 in), and the bunched spikelets have projecting and angled awns up to 17 mm (1 in) long, green or purplish. The panicles often remain into winter. The spikelets are oblong or gaping. It flowers from June to September.  The roots are yellow.\nFour subspecies are currently accepted by Kew's Plants of the World:\n\nArrhenatherum elatius subsp. elatius, the typical (nominate) subspecies.\nArrhenatherum elatius subsp. bulbosum (syn. Arrhenatherum tuberosum), onion couch or tuber oat-grass, distinguished by the presence of corms at the base of the stem, by which it propagates. It occurs in vegetated shingle and arable land.\nArrhenatherum elatius subsp. cypricola (Cyprus, endemic).\nArrhenatherum elatius subsp. sardoum (western Mediterranean region).\n\n\n== Habitat ==\nArrhenatherum elatius is a principal species in two UK National Vegetation Classification habitat communities: the very widespread MG1 (Arrhenatherum elatius grassland) and the much rarer MG2 (Arrhenatherum elatius - Filipendula ulmaria tall-herb grassland). This means that it can be found with species such as Dactylis glomerata (also known as cock's-foot and orchard grass), and Filipendula ulmaria (also known as meadow-sweet).\nIt is found on road verges, along hedges and riverbanks.\nIt can colonise and stabilise limestone scree, bare calcareous cliffs, maritime shingle and coastal dunes.",
    expected: ['false oat-grass', 'bulbous oat grass', 'tall oat-grass', 'tall meadow oat', 'onion couch', 'tuber oat-grass'],
  },
  {
    name: 'Hibiscus mutabilis ("Alternative names ... are X and Y")',
    extract: 'Hibiscus mutabilis, also known as the cotton rose or rosemallow, a plant long cultivated for its showy flowers. Originally native to southern China, where it is known as 木芙蓉, ("Mùfúróng")[1]it is now found on all continents except Antarctica. It is a mallow (family Malvaceae) not a true rose (family Rosaceae). Alternative names in parts of the United States are Confederate rose and Dixie rosemallow.',
    expected: ['cotton rose', 'rosemallow', 'Confederate rose', 'Dixie rosemallow'],
  },
  {
    name: 'Calystegia silvatica (parens not mistaken for scientific name; section list)',
    extract: 'Calystegia silvatica (large bindweed) is the largest species of bindweed and is a strong rampant climber. It is native to southern Europe but has been introduced to many other areas because it is an attractive garden plant. Calystegia silvatica subsp. fraterniflora (Mack. & Bush) Brummitt (short-stalked false bindweed) is native to North America.\nIt has large, arrow-shaped leaves and showy white trumpet-shaped flowers up to 9 centimeters in diameter. It is considered a weed in some areas where it has escaped cultivation and now grows wild. It spreads easily via hardy rhizomes. There are several subspecies.\n\n\n== Description ==\nLarge bindweed is a glabrous herbaceous perennial that twines in a counter-clockwise direction to a height of up to 5 m. The leaves are arranged alternately on the spiralling stem on petioles up to 15 cm. The leaves are dull green above and paler below, simple and sagittate (arrowhead shaped), up to 15 cm long and up to 9 cm wide.\nThe flowers are white, sometimes narrowly pink on the outside only, produced from late spring to the end of summer (between July and September in northern Europe). The buds are enclosed by large (4.8 cm long), ovate, green bracteoles pouched at the base; during anthesis they strongly overlap. The open flowers are trumpet-shaped and 6\u20139 cm diameter. After flowering, the fruit develops as an almost spherical capsule, which is hidden by the bracts. It is 1 cm in diameter, containing two to four large, dark brown or black seeds that are shaped like quartered oranges.\n\n\n== Identification ==\nThe best way to separate large bindweed from hedge bindweed (C. sepium) in flower is by the bracteoles, which subtend the flower and wholly or partially encompass the sepals. Large bindweed has short, wider bracteoles which overlap where they meet, whereas hedge bindweed has narrower, longer ones which leave a gap between them, allowing a glimpse of the sepals.\n\nVegetatively, large bindweed can be distinguished from hedge bindweed by the shape of the sinus - the gap between the lobes at the base of the leaves. The former has a U-shaped sinus, in contrast to the usually V-shaped one in the latter.\n\n\n== Taxonomy ==\nCommon names include "morning glory" (a name which is shared with hundreds of other species) and "giant bindweed".',
    expected: ['large bindweed', 'short-stalked false bindweed', 'morning glory', 'giant bindweed'],
  },
  {
    name: 'Dicentra formosa ("and native to Asia" geographic filter)',
    extract: 'Dicentra formosa (western, wild or Pacific bleeding-heart) is a species of flowering plant in the poppy family, Papaveraceae. The popular related plant, Lamprocapnos spectabilis, also called "bleeding heart" and native to Asia, was formerly placed in the same genus.',
    expected: ['western', 'wild', 'Pacific bleeding-heart', 'bleeding heart'],
  },
  {
    name: '("species of" and "native to" descriptive overflow filtered)',
    extract: 'Eucalyptus camaldulensis, commonly known as river red gum, a species of tree in the family Myrtaceae, native to Australia. It is grown in many parts of the world.',
    expected: ['river red gum'],
  },
  {
    name: 'Chamaenerion angustifolium (descriptive junk filtered, Ivan-Chai kept)',
    extract: 'In Russia, fireweed is made into a tea known as Ivan-Chai (Ivan-Tea) or Koporsky tea (from the town of Koporye, where it has been produced since the 13th century). They use it as highly prized medicinal herb too. The popularity of fireweed tea perhaps stems from the similarity of its production to that of common black tea (Camellia sinensis), leading to a richly flavoured and deeply coloured herbal tea, with no caffeine. It is commercially sold in a blend with mint or thyme.',
    expected: ['Ivan-Chai'],
  },
  {
    name: 'Lyonothamnus (abbreviation period + rank-prefix filter)',
    extract: 'Lyonothamnus floribundus, which is known by the common name Channel Island ironwood, and the subspecies L. f. ssp. aspleniifolius and L. f. ssp. floribundus.\n\n== Description ==',
    expected: ['Channel Island ironwood'],
  },
  {
    name: 'Eucalyptus marginata (family name "Myrtaceae" filtered)',
    extract: 'Eucalyptus marginata, commonly known as jarrah, is a plant in the myrtle family, Myrtaceae and is endemic to the south-west of Western Australia. It is a tree with rough, fibrous bark.',
    expected: ['jarrah'],
  },
  {
    name: 'Crassula ovata (country name "Mozambique" filtered)',
    extract: 'Crassula ovata, commonly known as jade plant, lucky plant, money plant or money tree, is a succulent plant with small pink or white flowers that is native to the KwaZulu-Natal and Eastern Cape provinces of South Africa, and Mozambique.',
    expected: ['jade plant', 'lucky plant', 'money plant', 'money tree'],
  },
  {
    name: 'Betula pubescens (cross-sentence boundary fix, no geographic junk)',
    extract: 'Betula pubescens (syn. Betula alba), commonly known as downy birch and also as moor birch, white birch, European white birch or hairy birch, is a species of deciduous tree, native and abundant throughout northern Europe and northern Asia, growing further north than any other broadleaf tree. It is closely related to, and often confused with, the silver birch (B. pendula), but grows in wetter places with heavier soils and poorer drainage; smaller trees can also be confused with the dwarf birch (B. nana).',
    expected: ['downy birch', 'moor birch', 'white birch', 'European white birch', 'hairy birch'],
  },
  {
    name: 'Cosmic Crisp (cross-sentence fix, no "cross between" or "apple")',
    extract: 'Cosmic Crisp is an American apple with the cultivar designation WA 38, a cross between Honeycrisp and Enterprise apples. Breeding began in 1997 at Washington State University, and the apple was commercially released in 2019. The Cosmic Crisp has seen strong and growing sales since its launch.',
    expected: [],
  },
  {
    name: 'Yucca brevifolia (language qualifier "Spanish" filtered from parenthetical)',
    extract: 'Yucca brevifolia (also known as the Joshua tree, yucca palm, tree yucca, and palm tree yucca) is a plant species belonging to the genus Yucca. It is tree-like in appearance, which is reflected in its common names.\n\nIt is also called izote de desierto (Spanish, "desert dagger"). It is also called hunuvat chiy\'a or humwichawa by the indigenous Cahuilla.',
    expected: ['Joshua tree', 'yucca palm', 'tree yucca', 'palm tree yucca', 'izote de desierto', "hunuvat chiy'a", 'humwichawa'],
  },
  {
    name: 'Pinus attenuata (scientific name in apposition rejected; parenthetical synonym rejected)',
    extract: 'The knobcone pine, Pinus attenuata (also called Pinus tuberculata), is a tree that grows in mild climates on poor soils. It ranges from the mountains of southern Oregon to Baja California with the greatest concentration in northern California and the Oregon-California border.',
    expected: [],
  },
  {
    name: 'Pyrus pyrifolia ("known by many names" not "common names", no extraction)',
    extract: 'Pyrus pyrifolia is a species of pear tree native to southern China and northern Indochina that has been introduced to Korea, Japan and other parts of the world. The tree\'s edible fruit is known by many names, including Asian pear, Persian pear, Japanese pear, Chinese pear, Korean pear, Taiwanese pear, apple pear, zodiac pear, three-halves pear, papple, naspati, and sand pear.',
    expected: [],
  },
  {
    name: 'Carduus pycnocephalus ("with common names including" prefix)',
    extract: 'Carduus pycnocephalus, with common names including Italian thistle, Italian plumeless thistle, and Plymouth thistle, is a species of thistle.',
    expected: ['Italian thistle', 'Italian plumeless thistle', 'Plymouth thistle'],
  },
  {
    name: 'Nepenthes ampullaria (etymology parenthetical filtered — "meaning")',
    extract: 'Nepenthes ampullaria (; Latin ampulla meaning "flask") is a very distinctive and widespread species of tropical pitcher plant, present in Borneo, the Maluku Islands, New Guinea, Peninsular Malaysia, Singapore, Sumatra, and Thailand.',
    expected: [],
  },
  {
    name: 'Valencia orange (cultivar list junk filtered — trade names not extracted)',
    extract: 'Biondo Comune ("ordinary blond"): widely grown in the Mediterranean basin, especially in North Africa, Egypt, Greece (where it is called "koines"), Italy (where it is also known as "Liscio"), and Spain; it also is called "Beledi" and "Nostrale"; in Italy, this variety ripens in December, earlier than the competing Tarocco variety',
    expected: [],
  },
  {
    name: 'Digitalis ("commonly called X." capitalized word fallback)',
    extract: 'Digitalis is a genus of about 20 species of herbaceous perennial plants, shrubs, and biennials, commonly called foxgloves.\nDigitalis is native to Europe, Western Asia, and northwestern Africa.',
    expected: ['foxgloves'],
  },
  {
    name: 'Juglans regia ("known by various common names")',
    extract: 'Juglans regia, known by various common names including the common walnut, English walnut, or Persian walnut amongst other names, is a species of walnut.',
    expected: ['English walnut', 'Persian walnut', 'common walnut'],
  },
  {
    name: 'Camellia sasanqua ("with common name" prefix strip)',
    extract: 'Camellia sasanqua, with common name Sasanqua camellia or Christmas camellia, is a species of Camellia.',
    expected: ['Sasanqua camellia', 'Christmas camellia'],
  },
  {
    name: 'Galanthus (etymology parenthetical "from Ancient Greek" skipped)',
    extract: 'Galanthus (from Ancient Greek γάλα, (gála, "milk") + ἄνθος (ánthos, "flower")), or snowdrop, is a small genus of bulbous perennial herbaceous plants.',
    expected: ['snowdrop'],
  },
  {
    name: 'Allium cepa ("from Latin" epithet stripped)',
    extract: 'The onion (Allium cepa L., from Latin cepa), also known as the bulb onion or common onion, is a vegetable that is the most widely cultivated species of the genus Allium.',
    expected: ['bulb onion', 'common onion'],
  },
  {
    name: 'Platanus (pronunciation notation "PLAT-ən-əss" filtered)',
    extract: 'Platanus ( PLAT-ən-əss) is a genus consisting of a small number of tree species.',
    expected: [],
  },
  {
    name: 'Sabal palmetto (botanical phrase "terminal bud" filtered)',
    extract: 'The growing heart of the new fronds, also known as the terminal bud, gives the tree its "cabbage" name, since this is extracted as a food and tastes like other undifferentiated plant meristem tissue, such as the heart of a cabbage or artichoke.',
    expected: [],
  },
  {
    name: 'Hosta (parenthetical — "alpines" generic term filtered)',
    extract: 'Hosta (also known as hostas, plantain lilies, and alpines) is a genus of plants commonly known as hostas.',
    expected: ['Hosta', 'hostas', 'plantain lilies'],
  },
  {
    name: 'Populus tremula (hybrid "×" notation filtered; captures grey poplar)',
    extract: 'Populus tremula (commonly called aspen, common aspen) is a species. Its hybrid with Populus alba, known as grey poplar, Populus × canescens, is widely found in Europe.',
    expected: ['aspen', 'common aspen', 'grey poplar'],
  },
  {
    name: 'Centaurea cyanus ("Other names include" without "common")',
    extract: "Centaurea cyanus, commonly known as cornflower or bachelor's button (among other names), is an annual flowering plant in the family Asteraceae native to Europe. In the past, it often grew as a weed in cornfields (in the broad sense of \"corn\", referring to grains, such as wheat, barley, rye, or oats), hence its name.\nC. cyanus is now endangered in its native habitat by agricultural intensification, particularly by over-use of herbicides. However, it is now also naturalized in many other parts of the world, including North America and parts of Australia.\n\n== Description ==\n\nCentaurea cyanus is an annual plant growing to 20\u2013100 centimetres (8\u201339 in) tall, with grey-green branched stems. The leaves are lanceolate and 3\u201310 cm (1\u20134 in) long. The flowers are most commonly an intense blue colour and arranged in flowerheads (capitula) of 1.5\u20133 cm diameter, with a ring of a few large, spreading ray florets surrounding a central cluster of disc florets. The blue pigment is protocyanin, which in roses is red. Fruits are approx. 3.5 mm long with 2\u20133 mm-long pappus bristles. It flowers all summer.\n\n== Taxonomy ==\nCentaurea cyanus was given its scientific name in 1753 by Carl Linnaeus. It is classified in the genus Centaurea as part of the Asteraceae family. The species has no accepted subspecies, but has one among its 21 synonyms.\n\n=== Genetics ===\nCentaurea cyanus is a diploid flower (2n = 24). The genetic diversity within populations is high, although there could be a future decline in\n\n== Names ===\nThe genus name, Centaurea, is derived from the Greek \u03ba\u03ad\u03bd\u03c4\u03b1\u03c5\u03c1\u03bf\u03c2 (k\u00e9ntaura) meaning \"centaur\". The species name, cyanus, is Botanical Latin also taken from the Ancient Greek \u03ba\u03cd\u03b1\u03bd\u03bf\u03c2 (k\u00faanos) meaning \"dark blue\" as a reference to the color of the flowers. \nThe common name bachelor's button is an allusion to the shape of the flowers. Originally the bachelor's buttons was applied to the double form of the common buttercup (Ranunculus acris), but it has been applied to various round flowers. The name cornflower is often used for this species in particular, but is also used for other weedy species that grow among corn in the sense of any grain crop such as the common corncockle. The name bluebottle continues in common use, having been coined in the form blewbothel around 1450.\nOther names include blue cap, a rare English regional name, blue blobs, blue bonnet, bluet, cornbottle, boutonierre flower, ragged robin, and gogglebuster. Though the name ragged sailor is applied to the species, it is also sometimes used for chicory (Cichorium intybus). The name hurtsickle or hurt-sickle, dates to the late 1500s. This name came from farmers believing that it would blunt their sickles when cutting fields.",
    expected: ["bachelor's button", 'blue blobs', 'blue bonnet', 'blue cap', 'bluet', 'boutonierre flower', 'cornbottle', 'cornflower', 'gogglebuster', 'ragged robin', 'ragged sailor'],
  },
  {
    name: 'Hevea brasiliensis ("most commonly" fragment filtered)',
    extract: 'Hevea brasiliensis, the Pará rubber tree, sharinga tree, seringueira, or, most commonly, rubber tree or rubber plant, is a flowering plant belonging to the spurge family.',
    expected: ['Pará rubber tree', 'sharinga tree', 'seringueira', 'rubber tree', 'rubber plant'],
  },
  {
    name: 'Vanilla planifolia (unmatched paren from abbreviated binomial; single-letter filtered; "often simply referred to as")',
    extract: 'Vanilla planifolia is a species of vanilla orchid native to Mexico, Central America, Colombia, and Brazil. It is one of the primary sources for vanilla flavouring, due to its high vanillin content. Common names include flat-leaved vanilla and  West Indian vanilla (which is also used for the Pompona vanilla, V. pompona), though it is often simply referred to as vanilla. It was first scientifically named in 1808.',
    expected: ['flat-leaved vanilla', 'West Indian vanilla', 'vanilla'],
  },
  {
    name: 'Abies grandis (quoted lumber-jargon "referred to as" rejected)',
    extract: 'Abies grandis (grand fir, giant fir, lowland white fir, great silver fir, western white fir, Vancouver fir, or Oregon fir) is a fir native to northwestern North America.\nIn the North American logging industry, the grand fir is often referred to as "hem fir", with hem fir being a number of species with interchangeable types of wood (specifically the California red fir, noble fir, Pacific silver fir, white fir, and western hemlock). Grand fir is often shipped along with these other species. It can also referred to as "white fir" lumber, an umbrella term also referring to Abies amabilis (Pacific silver fir), Abies concolor (White fir), and Abies magnifica (Red fir).\nThe intergrades are often referred to as "Abies grandis x concolor", a variety which itself intergrades into Abies concolor lowiana farther south, around the California state line.',
    expected: ['grand fir', 'giant fir', 'lowland white fir', 'great silver fir', 'western white fir', 'Vancouver fir', 'Oregon fir'],
  },
  {
    name: 'Chamaemelum nobile ("with various common names, such as"; "(also spelled X)" parenthetical)',
    extract: "Chamaemelum nobile, commonly known as chamomile (also spelled camomile), is a low perennial plant found in dry fields and around gardens and cultivated grounds in Europe, North America, and South America. Its synonym is Anthemis nobilis, with various common names, such as Roman chamomile, English chamomile, garden chamomile, ground apple, low chamomile, mother's daisy or whig plant.",
    expected: ['chamomile', 'camomile', 'Roman chamomile', 'English chamomile', 'garden chamomile', 'ground apple', 'low chamomile', "mother's daisy", 'whig plant'],
  },
  {
    name: 'Hoya carnosa (anatomical term "spurs" rejected; bare "referred to as" single lowercase word not a common name)',
    extract: 'Hoya carnosa, the porcelain flower or wax plant, is a species of flowering plant in the family Apocynaceae, native to East Asia.\nThe inflorescence is made up of numerous flowers, hanging or more upright, which are grouped in an umbel.\nLike most species of Hoya, H. carnosa flowers grow from specialised perennial peduncles; sometimes these structures are referred to as spurs. These appear from the axils of the leaves and stem; flowers may not be produced when the spurs first appear, but in time buds emerge from their tips.',
    expected: ['porcelain flower', 'wax plant'],
  },
  {
    name: 'Ziziphus jujuba (bare "referred to as", e.g., "are referred to as black jujubes")',
    extract: 'Smoked jujubes are consumed in Vietnam and are referred to as black jujubes. A drink can be made by crushing the pulp in water.',
    expected: ['black jujubes'],
  },
  {
    name: 'Ziziphus jujuba (food gloss "pickle" filtered out; keeps Bogori and Bogori aachar)',
    extract: 'They are used for making pickles (কুলের আচার) in west Bengal and Bangladesh. In Assam it is known as "Bogori" and the pickle, Bogori aachar (বগৰি আচাৰ), is famous.',
    expected: ['Bogori', 'Bogori aachar'],
  },
  {
    name: 'Borago officinalis (leading name before pronunciation/synonym parenthetical)',
    extract: 'Borage (  or ; Borago officinalis), also known as starflower, is an annual herb in the flowering plant family Boraginaceae native to the Mediterranean region.',
    expected: ['Borage', 'starflower'],
  },
  {
    name: 'Arctostaphylos manzanita ("has the common names X and Y")',
    extract: 'One of many species of manzanita, Arctostaphylos manzanita has the common names common manzanita and whiteleaf manzanita.\nArctostaphylos manzanita is endemic to California.',
    expected: ['common manzanita', 'whiteleaf manzanita'],
  },
  {
    name: 'Cedrus ("with the common English name X")',
    extract: 'Cedrus, with the common English name cedar, is a genus of coniferous trees in the plant family Pinaceae (subfamily Abietoideae).',
    expected: ['cedar'],
  },
  {
    name: 'Rutaceae ("commonly known as the rue or citrus family" expands to both)',
    extract: 'The Rutaceae () is a family, commonly known as the rue or citrus family, of flowering plants, usually placed in the order Sapindales.',
    expected: ['rue family', 'citrus family'],
  },
  {
    name: 'Rubiaceae ("the coffee, madder, or bedstraw family" — 3-item shared head expands to all)',
    extract: 'Rubiaceae is a family of flowering plants, commonly known as the coffee, madder, or bedstraw family. It consists of terrestrial trees, shrubs, lianas, or herbs that are recognizable by simple, opposite leaves.',
    expected: ['coffee family', 'madder family', 'bedstraw family'],
  },
  {
    name: 'Rubiaceae (mechanism gloss "Secondary pollen presentation (also known as stylar pollen presentation or ixoroid pollen mechanism)" not extracted as common names)',
    extract: 'Rubiaceae is a family of flowering plants, commonly known as the coffee, madder, or bedstraw family. Secondary pollen presentation (also known as stylar pollen presentation or ixoroid pollen mechanism) is especially known from the Gardenieae and related tribes.',
    expected: ['coffee family', 'madder family', 'bedstraw family'],
  },
  {
    name: 'Silphium (genus) ("commonly known as rosinweeds, are herbaceous..." — R8 must stop at the comma+copula, not swallow the descriptive tail)',
    extract: 'Silphium is a genus of North American plants in the tribe Heliantheae within the family Asteraceae.\nMembers of the genus, commonly known as rosinweeds, are herbaceous perennial plants growing to 0.2 m (8 in) to more than 2.5 m (8 ft 2 in) tall, with yellow (rarely white) flowerheads that resemble sunflowers. In the rosinweeds, the ray florets in the head are female and the disc florets are male; this differs from sunflowers, where ray florets are sterile and disc florets are perfect, capable of producing both pollen and seeds.\nThe name of the genus comes from the Ancient Greek word for a North African plant whose identity has been lost, though it is known its gum or juice was prized by the ancients as a medicine and a condiment.',
    expected: ['rosinweeds'],
  },
  {
    name: 'Cyperaceae ("a family of ... plants known as sedges" with no true-sedges leak)',
    extract: 'The Cyperaceae () are a family of  graminoid (grass-like), monocotyledonous flowering plants known as sedges. The family contains around 5,500 described species in about 90 genera \u2013 the largest being the "true sedges" (Carex), with over 2,000 species.',
    expected: ['sedges'],
  },
  {
    name: 'Erigeron speciosus ("known by the common names" before a == Description == section)',
    extract: 'Erigeron speciosus is a widespread North American species of flowering plants in the family Asteraceae known by the common names aspen fleabane, garden fleabane, and showy fleabane.\n\n\n== Description ==\nE. speciosus can exceed 60 cm (24 in) in height.',
    expected: ['aspen fleabane', 'garden fleabane', 'showy fleabane'],
  },
  {
    name: 'Thuja ("Members are commonly known as X, Y, or Z" with parenthetical aside)',
    extract: 'Thuja ( THEW-y\u0259) is a genus of coniferous tree or shrub in the Cupressaceae (cypress family). There are five species in the genus. Members are commonly known as arborvitaes (from the Latin term for \'tree of life\'), thujas, or New World false cedars.\n\n== Description ==',
    expected: ['arborvitaes', 'thujas', 'New World false cedars'],
  },
  {
    name: 'Philadelphus ("() (mock-orange) is a genus")',
    extract: 'Philadelphus () (mock-orange) is a genus of about 60 species of shrubs from 3\u201320 ft (1\u20136 m) tall, native to North America and southern Europe.',
    expected: ['mock-orange'],
  },
  {
    name: 'Allium schoenoprasum ("Chives, scientific name Allium schoenoprasum, is")',
    extract: 'Chives, scientific name Allium schoenoprasum, is a species of flowering plant in the family Amaryllidaceae.',
    expected: ['Chives'],
  },
  {
    name: 'Urtica dioica ("or just a nettle or stinger" strips article iteratively)',
    extract: 'Urtica dioica, often known as common nettle, burn nettle, stinging nettle, nettle leaf, or just a nettle or stinger, is an herbaceous perennial flowering plant in the family Urticaceae.',
    expected: ['common nettle', 'burn nettle', 'stinging nettle', 'nettle leaf', 'nettle', 'stinger'],
  },
  {
    name: 'Cecropia false positive — "referred to as a dioecious species" rejected',
    extract: 'Cecropia species have staminate and pistillate flowers on separate trees, more commonly referred to as a dioecious species. The fruits are achenes enveloped by a fleshy perianths.',
    expected: [],
  },
  {
    name: 'Cecropia false positive — fruit "known as snake fingers" rejected',
    extract: 'Cecropia fruit, known as snake fingers, are a popular food of diverse animals, including bats.',
    expected: [],
  },
  {
    name: 'Ruscus aculeatus (must not cross sentence boundary into "seeds are bird-distributed")',
    extract: 'Ruscus aculeatus, known as butcher\'s-broom, is a low evergreen dioecious Eurasian shrub, with flat shoots known as cladodes that give the appearance of stiff, spine-tipped leaves. Small greenish flowers appear in spring, and are borne singly in the centre of the cladodes. The female flowers are followed by a red berry, and the seeds are bird-distributed, but the plant also spreads vegetatively by means of rhizomes. It is native to Eurasia and some northern parts of Africa.',
    expected: ["butcher's-broom"],
  },
  {
    name: 'Maackia amurensis ("common names are from..." provenance junk filtered)',
    extract: 'Maackia amurensis, commonly known as the Amur maackia, is a species of tree in the family Fabaceae that can grow 15 metres (49 ft) tall. The species epithet and common names are from the Amur River region, where the tree originated; it occurs in northeastern China, Korea, and Russia.',
    expected: ['Amur maackia'],
  },
  {
    name: 'Erica (English common names X and Y are shared by closely related genera)',
    extract: 'Erica is a genus of roughly 857 species of flowering plants in the family Ericaceae. The English common names heath and heather are shared by some closely related genera of similar appearance.',
    expected: ['heath', 'heather'],
  },
  {
    name: 'Erica ("winter (or spring) heather" quoted distinction; Cape heaths collective name)',
    extract: 'Erica is sometimes referred to as "winter (or spring) heather" to distinguish it from Calluna "summer (or autumn) heather". Around 690 of the species are endemic to South Africa, and these are often called the Cape heaths, forming the largest genus in the fynbos.',
    expected: ['winter heather', 'spring heather', 'Cape heaths'],
  },
  {
    name: 'Erica (species-specific names excluded: tree heather/broom heather/tree heath/besom heath)',
    extract: 'Most European species are dwarf shrubs, growing 20–80 cm tall. The largest are the tree heather (Erica arborea) and the broom heather (Erica scoparia), which can reach 6–10 meters. Most of the species of Erica are small shrubs from 20–150 centimetres (8–59 inches) high, though some are taller; the tallest are E. arborea (tree heath) and E. scoparia (besom heath), both of which can reach up to 7 metres (23 feet) tall.',
    expected: [],
  },
  {
    name: 'Erica (full article: heath, heather, winter/spring heather, Cape heaths)',
    extract: 'Erica is a genus of roughly 857 species of flowering plants in the family Ericaceae. The English common names heath and heather are shared by some closely related genera of similar appearance. Erica is sometimes referred to as "winter (or spring) heather" to distinguish it from Calluna "summer (or autumn) heather". Around 690 of the species are endemic to South Africa, and these are often called the Cape heaths, forming the largest genus in the fynbos.',
    expected: ['heath', 'heather', 'winter heather', 'spring heather', 'Cape heaths'],
  },
  {
    name: 'Yucca (Names section: common names list, Adam\'s needle possessive binomial)',
    extract: 'In addition to yucca, they are also known as Adam\'s needle or Spanish-bayonet. The name yucca is used as an English common name for plant species in the genus. It is also known as Adam\'s needle or as Spanish-bayonet. Other common names for some species include Spanish dagger, shin dagger, soapweed, or soaptree. In the plant trade they are sometimes known as palm lilies.',
    expected: ['yucca', "Adam's needle", 'Spanish-bayonet', 'Spanish dagger', 'shin dagger', 'soapweed', 'soaptree', 'palm lilies'],
  },
  {
    name: 'Yucca (no "it" from "In the other half", no "discovery that Yucca", no "like plants")',
    extract: 'In the other half, it is a fleshy fruit. In particular, the discovery that Yucca, like plants in Agave, has 5 large and 20 small chromosomes was a large factor in reconsidering their relationship.',
    expected: [],
  },
  {
    name: 'Yucca (flor de izote attributed to the specific species Yucca gigantea, not the genus — not extracted)',
    extract: 'The yucca, specifically Yucca gigantea, is the national flower of El Salvador, where it is known as flor de izote.',
    expected: [],
  },
  {
    name: 'Yucca (regional flower names: yucca flowers broadly called flor de izote in Mexico, flores de palma, guayas, cuaresmeñas, chochos, chochas)',
    extract: 'In addition to being called flor de izote in Mexico, yucca flowers are also called flores de palma (palm flowers) in Hidalgo and San Luis Potosí, guayas, cuaresmeñas, or chochos in Veracruz, and chochas in Tamaulipas.',
    expected: ['flor de izote', 'flores de palma', 'guayas', 'cuaresmeñas', 'chochos', 'chochas'],
  },
  {
    name: 'Agave ovatifolia ("Agave Noah" quoted name, no stray trailing quote)',
    extract: 'Agave ovatifolia, the whale\'s tongue agave, is a species of flowering plant in the family Asparagaceae. Plants were first found by nickel (1870) and known as "Agave Noah".',
    expected: ['whale\'s tongue agave', 'Agave Noah'],
  },
  {
    name: 'Claytonia perfoliata (indigenous-language quoted names, R25 hedge interjection "or, possibly,")',
    extract: 'Claytonia perfoliata, commonly known as miner\'s lettuce or winter purslane, is a flowering plant in the family Montiaceae.\n\n\n=== Names ===\nC. perfoliata is called \'piyada̠\' in the Western Mono language and \'palsingat\' in Ivilyuat — two Native American languages of California or \'rooreh\' in (Ohlone language) The name Rooreh has been adopted by the Jepson Herbarium at University of California, Berkeley.\n\n\n== Uses ==\nThe plant is known as palsingat or, possibly, lahchumeek in Ivilyuat and it was eaten fresh or boiled as a green by the Ivilyuqaletem (Cahuilla) people of Southern California.',
    expected: ["miner's lettuce", 'winter purslane', 'piyada̠', 'palsingat', 'rooreh', 'lahchumeek'],
  },
  {
    name: 'Eutrochium (hyphenated proper-name compound "Joe-Pye weeds"; "such" rejected)',
    extract: 'Eutrochium is a North American genus of herbaceous flowering plants in the family Asteraceae. They are commonly referred to as Joe-Pye weeds. They are native to the United States and Canada, and have non-dissected foliage and pigmented flowers.',
    expected: ['Joe-Pye weeds'],
  },
  {
    name: 'Heptacodium miconioides (Standard Chinese regional name "qī zi huā" from naming sentences)',
    extract: 'Heptacodium miconioides, the seven-son flower, is a species of flowering plant. It is the sole species in the monotypic genus Heptacodium, of the honeysuckle family Caprifoliaceae. The common name "seven-son flower" is a direct translation of the Standard Chinese name 七子花 qī zi huā.\n\n\n== Etymology ==\nThe common name in Standard Chinese 七子花 (qī zi huā) is composed of the characters 七 (qī) \'seven\', 子 (zi) \'son\' / \'child\' and 花 (huā) \'flower\' - whence \'Seven Son(s) Flower\' (\'Flower with seven children\').',
    expected: ['seven-son flower', 'qī zi huā'],
  },
  {
    name: 'Hylotelephium telephium (intro "known as …, and garden stonecrop is a …" trailing list item; section repeats the rest)',
    extract: 'Hylotelephium telephium (synonym Sedum telephium), known as orpine, livelong, frog\'s-stomach, harping Johnny, life-everlasting, live-forever, midsummer-men, Orphan John, witch\'s moneybags, and garden stonecrop is a succulent perennial plant of the family Crassulaceae native to Eurasia.\n\n== Common names ==\nHylotelephium telephium has earned many common names in English, including orpine, livelong, life-everlasting, live-forever, frog\'s-stomach, harping Johnny, midsummer-men, orphan John and witch\'s moneybags.',
    expected: ['orpine', 'livelong', 'frog\'s-stomach', 'harping Johnny', 'life-everlasting', 'live-forever', 'midsummer-men', 'orphan John', 'witch\'s moneybags', 'garden stonecrop'],
  },
  {
    name: 'Populus deltoides (subspecies appositives in Variation section; individual tree "Balmville Tree" not a common name)',
    extract: 'Populus deltoides, the eastern cottonwood or necklace poplar, is a species of cottonwood poplar native to North America.\n\n== Variation ==\nThe species is divided into three subspecies or up to five varieties.\nPopulus deltoides subsp. deltoides, eastern cottonwood is found in southeastern Canada and the eastern United States.\nP. d. monilifera (Aiton) Eckenw., the plains cottonwood (syn. P. deltoides var. occidentalis Rydb.; P. sargentii Dode) ranges from southcentral Canada to the central United States.\nP. d. wislizeni (S.Watson) Eckenw., the Rio Grande cottonwood (syn. P. wislizeni (S.Watson) Sarg.; P. fremontii var. wislizeni S.Watson) grows from southern Colorado south through Texas to northeastern Mexico.\n\n== Oldest and largest ==\nThe Balmville Tree (felled in 2015 at approximately 316 years old) was the oldest eastern cottonwood in the United States.',
    expected: ['eastern cottonwood', 'necklace poplar', 'plains cottonwood', 'Rio Grande cottonwood'],
  },
  {
    name: 'Saxegothaea conspicua (or sometimes as X and Y; R25 must not truncate name list at connectors)',
    extract: 'Saxegothaea is a genus comprising a single species, Saxegothaea conspicua. It is a conifer in the podocarp family Podocarpaceae, native to southern South America. It grows in Chile and Argentina from 35\u00b0 to 46\u00b0 South latitude; in its northernmost natural distribution it grows between 800 and 1000 (2600\u20133300 ft) m above sea level and in the south it lives at sea level. The species is most often known by its genus name, or sometimes as female maniu (a translation of its name in Spanish) and Prince Albert\'s yew; in South America it is known as ma\u00f1\u00edo hembra or mani\u00fa hembra.',
    expected: ['female maniu', "Prince Albert's yew", 'ma\u00f1\u00edo hembra', 'mani\u00fa hembra'],
  },
  {
    name: 'Tamarix chinensis (referred to by the common names X and Y or Z)',
    extract: 'Tamarix chinensis is a species of flowering plant in the family Tamaricaceae. It is sometimes referred to by the common names five-stamen tamarisk and Chinese tamarisk or saltcedar. It is native to China and Korea.',
    expected: ['five-stamen tamarisk', 'Chinese tamarisk', 'saltcedar'],
  },
  {
    name: 'Phyllostachys aurea (It is commonly known by the names X, Y, Z, and W (place qualifier))',
    extract: 'Phyllostachys aurea is a species of bamboo, and is of the \'running bamboo\' type, belonging to the diverse Bambuseae tribe. It is native to Fujian and Zhejiang in China. It is commonly known by the names fishpole bamboo, golden bamboo, monk\'s belly bamboo, and fairyland bamboo (Australia).',
    expected: ['fishpole bamboo', 'golden bamboo', 'monk\'s belly bamboo', 'fairyland bamboo'],
  },
  {
    name: 'Asclepias tuberosa (commonly known as X because of explanatory clause; R8 must stop at "because")',
    extract: 'Asclepias tuberosa, commonly known as butterfly weed or pleurisy root, is a species of milkweed native to eastern and southwestern North America. It is commonly known as butterfly weed because of the butterflies that are attracted to the plant by its color and its copious production of nectar.',
    expected: ['butterfly weed', 'pleurisy root'],
  },
  {
    name: 'Asclepias tuberosa (Common names section; geographic place-name prefix "Canada")',
    extract: '== Common names ==\nCommon names include butterfly weed, Canada root, chieger flower, chiggerflower, fluxroot, Indian paintbrush, Indian posy, orange milkweed, orange root, orange swallow-wort, pleurisy root, silky swallow-wort, tuber root, yellow milkweed, white-root, windroot, butterfly love, butterflyweed, and butterfly milkweed.',
    expected: ['butterfly weed', 'Canada root', 'chieger flower', 'chiggerflower', 'fluxroot', 'Indian paintbrush', 'Indian posy', 'orange milkweed', 'orange root', 'orange swallow-wort', 'pleurisy root', 'silky swallow-wort', 'tuber root', 'yellow milkweed', 'white-root', 'windroot', 'butterfly love', 'butterflyweed', 'butterfly milkweed'],
  },
  {
    name: 'Lilium candidum (appositive "the X or Y", title-prefix "Madonna" not binomial-lookalike)',
    extract: 'Lilium candidum, the Madonna lily or white lily, is a plant in the true lily family.',
    expected: ['Madonna lily', 'white lily'],
  },
  {
    name: 'Pseudocydonia sinensis (Names section: CJK-annotated names mùguā, mogwa-namu, mogwa, karin, wa-mokka; no sentence-fragment junk)',
    extract: 'Pseudocydonia sinensis or Chinese quince (Chinese: 木瓜; pinyin: mùguā) is a deciduous or semi-evergreen tree in the family Rosaceae, native to southern and eastern China. It is the sole species in the genus Pseudocydonia. Its hard, astringent fruit is used in traditional Chinese medicine and as a food in East Asia. Trees are generally 10\u201318 metres (33\u201359 ft) tall.\nThe tree is closely related to the east Asian genus Chaenomeles, and is sometimes placed as Chaenomeles sinensis, but lacks thorns and has single, not clustered, flowers. Chinese quince is further distinguished from quince, Cydonia oblonga, by its serrated leaves and lack of fuzz.\n\n== Names ==\nIn China, both the tree and its fruit are called mùguā (木瓜), which also refers to papaya and the flowering quince (Chaenomeles speciosa). In Korea the tree is called mogwa-namu (모과나무) and the fruit mogwa (모과; from mokgwa (Korean: 목과; Hanja: 木瓜), the Korean reading of the Chinese characters). In Japan, both tree and fruit are called karin (花梨; rarely 榠樝) except in medicine where the fruit is called wa-mokka (和木瓜) from the Chinese and Korean names.',
    expected: ['Chinese quince', 'mùguā', 'mogwa-namu', 'mogwa', 'karin', 'wa-mokka'],
  },
  {
    name: 'Zizania (Wild rice: R10, R59, R25, R1, R2, R33)',
    extract: "Wild rice, also called manoomin, mnomen, psíŋ, Canada rice, Indian rice, or water oats, is any of four species of grasses that form the genus Zizania, and the grain that can be harvested from them. The grain was historically and is still gathered and eaten in North America and, to a lesser extent, China, where the plant's stem is used as a vegetable.\nWild rice and domesticated rice (Oryza sativa and Oryza glaberrima) are in the same botanical tribe Oryzeae. Wild-rice grains have a chewy outer sheath with a tender inner grain that has a slightly vegetal taste.\nThe plants grow in shallow water in small lakes and slow-flowing streams; often, only the flowering head of wild rice rises above the water. The grain is eaten by dabbling ducks and other aquatic wildlife.\n\n\n== Etymology ==\nThe name manoomin comes from the Ojibwe term ᒪᓅᒥᓐ manoomin meaning 'harvesting grain' (commonly translated 'good grain').\n\n\n== Species ==\nThree species of wild rice are native to North America:\n\nNorthern wild rice (Zizania palustris) is an annual plant native to the Great Lakes region of North America, the aquatic areas of the Boreal Forest regions of Northern Ontario, Alberta, Saskatchewan and Manitoba in Canada and Minnesota, Wisconsin, Michigan and Idaho in the US.\nSouthern or annual wild rice (Z. aquatica), also an annual, grows in the Saint Lawrence River, the state of Florida, and on the Atlantic and Gulf coasts of the United States.\nTexas wild rice (Z. texana) is a perennial plant found only in a small area along the San Marcos River in central Texas.\nOne species is native to Asia:\n\nManchurian wild rice (Z. latifolia; incorrect synonym: Z. caduciflora) is a perennial native to China.\nTexas wild rice is in danger of extinction due to pollution and loss of suitable habitat in its limited range. The pollen of Texas wild rice can only travel about 30 in (76 cm) away from a parent plant. If a receptive female flower receives no pollen, no seeds are produced. Manchurian wild rice has almost disappeared from the wild in its native range, but has been accidentally introduced into the wild in New Zealand and is considered an invasive species there.\nThe genomes of northern and Manchurian wild rices have been sequenced. There appears to be a whole genome duplication after the genus split from Oryza.\n\n\n== Culinary use ==\n\nThe species most commonly harvested as grain are the annual species: Zizania palustris and Zizania aquatica. The former, though now domesticated and grown commercially, is still often gathered from lakes in the traditional manner, especially by indigenous peoples in North America; the latter was also used extensively in the past. The stems and root shoots also contain an edible portion on the interior.\n\n\n=== Use by Native Americans ===\nNative Americans and others harvest wild rice by canoeing into a stand of plants, and bending the ripe grain heads with two small wooden poles/sticks called \"knockers\" or \"flails\", so as to thresh the seeds into the canoe. One person vans (or \"knocks\") rice into the canoe while the other paddles slowly or uses a push pole. The plants are not beaten with the knockers, but require only a gentle brushing to dislodge the mature grain. Some seeds fall to the muddy bottom and germinate later in the year. The size of the knockers, as well as other details, are prescribed in state and tribal law. By Minnesota statute, knockers must be at most 1 in (2.5 cm) diameter, 30 in (76 cm) long, and 1 lb (450 g) weight.\n\nSeveral Native American cultures, such as the Ojibwe, consider wild rice to be a sacred component of their culture.\nIn 2018, the White Earth Nation of Ojibwe granted manoomin certain rights (sometimes compared to rights of nature or to granting it legal personhood), including the right to exist and flourish; in August 2021, the Ojibwe filed a lawsuit on behalf of wild rice to stop the Enbridge Line 3 oil sands pipeline, which puts the plant's habitat at risk.\nTribes that are recorded as historically harvesting Zizania aquatica are the Dakota, Menominee, Meskwaki, Ojibwe, Cree, Omaha, Ponca, Thompson, and Ho-Chunk (Winnebago). Native people who utilized Zizania palustris are the Ojibwe, Ottawa/Odawa and Potawatomi. Ways of preparing it varied from stewing the grains with venison stock and/or maple syrup, making it into stuffings for wild birds, or even steaming it into sweets like puffed rice, or rice pudding sweetened with maple syrup. For these groups, the harvest of wild rice is an important cultural (and often economic) event. The Omǣqnomenēwak tribe take their name, and the name Omanoominii that the neighboring Ojibwa use for them, from this plant. Many places in Illinois, Indiana, Manitoba, Michigan, Minnesota, Ontario, Saskatchewan, and Wisconsin are named after this plant, including Mahnomen, Minnesota, and Menomonie, Wisconsin; many lakes and streams bear the name \"Rice\", \"Wildrice\", \"Wild Rice\", or \"Zizania\".\n\n\n=== Commercialisation ===\n\nBecause of its nutritional value and taste, wild rice increased in popularity in the late 20th century, and commercial cultivation began in the U.S. and Canada to supply the increased demand. In 1950, James and Gerald Godward started experimenting with wild rice in a one-acre meadow north of Brainerd, Minnesota. They constructed dikes around the acre, dug ditches for drainage, and put in water controls. In the fall, they tilled the soil. Then, in the spring of 1951, they acquired 50 lb (23 kg) of seed from Wildlife Nurseries Inc. They scattered the seed onto the soil, diked it in, and flooded the paddy. Much to their surprise, since they were told wild rice needs flowing water to grow well, the seeds sprouted and produced a crop. They continued to experiment with wild rice throughout the early 1950s and were the first to officially cultivate the previously wild crop.\nIn the United States, the main producers are California and Minnesota (where it is the official state grain), and it is mainly cultivated in paddy fields. In Canada, it is usually harvested from natural bodies of water; the largest producer is Saskatchewan. Wild rice is also produced in Hungary and Australia. In Hungary, cultivation started in 1989.\n\n\n=== Manchurian wild rice ===\nManchurian wild rice (Chinese: 菰; pinyin: gū), gathered from the wild, was once an important grain in ancient China. It is now very rare in the wild, and its use as a grain has completely disappeared in China, though it continues to be cultivated for its stems.\n\nThe swollen crisp white stems of Manchurian wild rice are grown as a vegetable, popular in East and Southeast Asia. The swelling occurs because of infection with the smut fungus Ustilago esculenta. The fungus prevents the plant from flowering, so the crop is propagated asexually, the infection being passed from mother plant to daughter plant. Harvest must be made between about 120 days and 170 days after planting, after the stem begins to swell, but before the infection reaches its reproductive stage, when the stem will begin to turn black and eventually disintegrate into fungal spores.\nThe vegetable is especially common in China, where it is known as gāosǔn (高筍) or jiāobái (茭白). In Japan it is known as makomodake (マコモダケ). Other names which may be used in English include coba and water bamboo. Importation of the vegetable to the United States is prohibited in order to protect North American species from the smut fungus.\n\n\n=== Nutrition ===\n\nWild rice is relatively high in protein, the amino acid lysine and dietary fiber, and low in fat. Nutritional analysis shows wild rice to be the grain second only to oats in protein content per 100 calories. Like true rice, it does not contain gluten. It is also a good source of certain minerals and B vitamins. One cup of cooked wild rice provides 5% or more of the daily value of thiamin, riboflavin, iron, and potassium; 10% or more of the daily value of niacin, vitamin B6, folate, magnesium, phosphorus; 15% of zinc; and over 20% of manganese.\n\n\n=== Dishes in Minnesotan cuisine ===\nWild rice is a common ingredient in Minnesotan cooking, it is a main ingredient in Manoomin porridge, wild rice pancakes, hotdish, wild rice soup, cranberry wild rice bread, and wild rice salad.\n\n\n=== Safety ===\nWild rice seeds can be infected by the highly toxic fungus ergot, which is dangerous if eaten. Infected grains have pink or purplish blotches or growths of the fungus, from the size of a seed to several times larger.\n\n\n== Archaeology of wild rice ==\n\n\n=== Food source ===\nAnthropologists since the early 1900s have focused on wild rice as a food source, often with an emphasis on the harvesting of the aquatic plant in the Lake Superior region by the Menominee, Woodland Dakota, and Anishinaabe people, also known as the Chippewa, Ojibwa and Ojibwe. The Smithsonian Institution's Bureau of American Ethnology published The Wild Rice Gatherers in the Upper Great Lakes: A Study in American Primitive Economics by Albert Ernest Jenks in 1901. In addition to his fieldwork interviewing members of various tribal communities, Jenks examined the accounts of explorers, fur traders and government agents from the early 1600s to the late 1800s to detail an \"aboriginal economic activity which is absolutely unique, and in which no article is employed not of aboriginal conception and workmanship\". His study further notes wild rice's importance in the fur-trading era because the region would have been nearly inaccessible if not for the availability of wild rice and the ability to store it for long periods of time. Wild rice's social and economic importance has continued into present times for the Anishinaabe and other north woods tribal members despite the availability of more easily obtainable food sources.\n\n\n=== Processing by various cultures ===\n\nThe continued use of wild rice from ancient to modern times has provided opportunities to examine the plant's processing by various cultures through the archaeological record they left behind during their occupation of seasonal ricing camps. Early ethnographic reports, tribal accounts and historical writings also inform archaeological research in the human use of wild rice. For example, geographer and ethnologist Henry Schoolcraft in the mid-1800s wrote about depressions in the ground on the shore of a lake with wild rice growing in the water. He wrote that wild rice processors placed animal hides in the holes, filled them with rice and stomped on the rice to thresh it. These jigging pits are part of the husking needed to process wild rice, and archaeologists see these holes in the soil stratigraphy in archaeological excavations today. Such historical records from the post-contact period in the Lake Superior region focus on Anishinaabe harvesting and processing techniques. Archaeological investigations of wild rice processing from the American era, before and after the creation of federal Indian reservations, also provide information on the loss of traditional harvesting areas, as 1800s fur trader and Indian interpreter Benjamin G. Armstrong wrote about outsiders \"who claimed to have acquired title to all the swamps and overflowed lakes on the reservations, depriving the Indians of their rice fields, cranberry marshes and hay meadows\".\nDespite the close association of the Anishinaabe and wild rice today, indigenous use of this food for subsistence also predates their arrival in the Lake Superior region. The Anishinaabe today were part of a larger Algonquian group who left eastern North America on a centuries-long journey to the west along the St. Lawrence River and Great Lakes. The Anishinaabe migration story details a vision to follow a giant clam shell in the sky to a place where the food grows on the water. This journey ended between the late 1400s and early 1600s in the Lake Superior wild rice country when they encountered the plant.\n\n\n=== Prehistory ===\nArchaeological and other scientific investigations have focused on the prehistoric exploitation of wild rice by humans, including: \n\nthe Menominee, named by the Anishinaabe for their intensive focus on wild rice harvesting,\nthe Anishinaabe,\nthe so-called proto-Anishinaabe, who may have later transformed into this culture from an earlier form,\nother indigenous groups who exist today, such as the Sioux people, and\narchaeological-categorized cultures from the Initial and Terminal Woodland periods, whose living lineages today are more difficult to identify.\nA seminal 1969 archaeological study indicated the prehistoric nature of indigenous wild rice harvesting and processing through radiocarbon dating, putting to rest the argument made by some European-Americans that wild rice production did not begin until post-contact times. Researchers tested clay linings of thermal features and jigging pits associated with parching and threshing of the plant.\nBut a more precise dating of the antiquity of human use of wild rice and the appearance of the plant itself in lakes and streams have been the subjects of continuing academic debates. These disputes may be framed around these questions: When did wild rice first appear in various areas of the region? When was it plentiful enough to be harvested in quantities to be a significant food source? What is the relationship of wild rice to the introduction of pottery and to increases in indigenous populations in the past 2,000 years? \"The use of wild rice by and its influence on prehistoric people in northeast Minnesota has led to much argument among archaeologists and paleoecologists\".\nAs an example, archaeologists divide human occupation of northeast Minnesota into numerous time periods. They are: \n\nthe Paleo-Indian period from 7,000 years ago (5000 BC) extending back to an uncertain time, after the glaciers receded from the last Ice Age;\nthe Archaic period, from 2,500 to 7,000 years ago (5000–500 BC);\nthe Initial Woodland period, from 2,500 to 1,300 years ago (500 BC–700 AD);\nthe Terminal Woodland period, from 1,300 to 400 years ago (700–1600 AD); and\nthe historical period after that time.\nThese rough dates are open to debate and vary by location in the state. In general, two lines of inquiry have focused on archaeological wild rice: \n\nThe radiocarbon dating of charred wild rice seeds or the associated charcoal left behind during the parching stage of rice production, and\nExamination of preserved wild rice seeds associated with specific prehistoric pottery styles found in excavations of processing sites.\nDifferent pottery styles in northern Minnesota are linked to certain times in the Initial and Terminal Woodland periods stretching from around 500 BC to the time of contact between indigenous peoples and Europeans. To place this in context, \"Although ceramics may have appeared as early as 2,000 BC in the southeastern United States, it is about 1,500 years later that they became evident in the Midwest\". After European contact, indigenous wild rice processors generally abandoned ceramic vessels in favor of metal kettles.\n\n\n=== Woodland period ===\n\nThe Initial Woodland period in northeast Minnesota marks the beginning of the use of pottery and burial mound building in the archaeological record. The Initial Woodland also experienced an increase in indigenous population. One hypothesis is that wild rice as a food source was related to these three developments. An example of a northeast Minnesota wild rice location, the Big Rice site in the Superior National Forest, considered a classic Initial and Terminal Woodland period type site, illustrates the methods of archaeological investigations into the plant's use by humans through time. Archaeological techniques along with ethnographic records and tribal oral testimony, when taken together, suggest use of this particular lakeside site since 50 BCE.\nOn its own, accelerator mass spectrometry (AMS) radiocarbon dating of wild rice seeds and charcoal samples from the Big Rice itself indicated indigenous use of this site dating to 2,050 years ago.\nFurthermore, all excavation levels that solely contained ceramics only used during the Initial Woodland period (known as Laurel pottery complex) also included wild rice seeds. This indicated the use of wild rice during the Initial Woodland period, according to the study.\nExcavators have documented more than 50,000 pottery shards from the site from the Initial and Terminal Woodland periods. Specifically, researchers analyzed ceramic rimsherds of Laurel pottery from the Initial Woodland period and Blackduck, Sandy Lake and Selkirk pottery styles from the Terminal Woodland period. Each pottery type had wild rice seeds associated with it in the soil layers of archaeological deposits. These soil layers were not contaminated with pottery from other eras.\nThis suggests intensive exploitation of the site for wild rice processing through these time periods by different cultures. For example, archaeologists often associate Sandy Lake pottery with the Sioux people, who were later displaced by the Anishinaabe and possibly other Algonquian migrants. Archaeologists often associate Selkirk pottery with the Cree people, an Algonquian group.\nAn examination of the pollen sequence at Big Rice indicates that wild rice existed in \"harvestable quantities\" 3,600 years ago during the Archaic period. This date is 1,600 years before the AMS radiocarbon date of human-processed charred wild rice seeds at the site during the Initial Woodland period, although there is no archaeological evidence of human use of the wild rice at the site that far back in time as of yet.\n\n\n== See also ==\nCamargue red rice\nOryza barthii\n\n\n== References ==\n\n\n== External links ==\n\nUSDA Plants Profile for Zizania palustris\nUSDA Plants Profile for Zizania aquatica\nUSDA Plants Profile for Zizania texana",
    expected: ["Canada rice","Indian rice","Manchurian wild rice","Northern wild rice","Southern wild rice","Texas wild rice","annual wild rice","coba","makomodake","manoomin","mnomen","psíŋ","water bamboo","water oats"],
  },
  {
    name: 'Zingiber spectabile ("known in the West by the common name" + referred-to-as quote names)',
    extract: "Zingiber spectabile is a species of true ginger, native to Maritime Southeast Asia.  It is primarily grown in the West as an ornamental plant, although it has been used in South-East Asia as a medicinal herb.\n\n\n== Name ==\nThe scientific name of the species is Zingiber spectabile.  \"Zingiber\" is originally from a Sanskrit word that means \"shaped like a horn\" and refers to the horn-shaped leaves of most species of ginger.  \"Spectabile\" is derived from the Latin spectabilis, meaning 'visible' or 'spectacular'.\nThe plant is commonly known in the West by the common name \"beehive ginger\", due to its unusual inflorescences which resemble a skep beehive.  It is also referred to by the common names \"Ginger wort\" or \"Malaysian ginger\".\n\n\n== Description ==\n\nIn common with most plants in genus Zingiber, the leaves of the plant are long and mostly oblong shaped, tapering to a single point at their tip.  Under ideal circumstances, the plant can reach a height of 4.5 metres (15 ft), or even more.\nThe plant's inflorescence is set atop a spike and can measure up to 30 centimetres (12 in) in height.  The bracts attached to the structure can differ in colour, from white, to yellow, orange, or even red, often darkening as the bracts mature and develop.  The flowers themselves are small, with purple petals and yellow spots, and a fragile, papery texture.\n\n\n== Uses ==\nIn Indonesia, the plant has been used in traditional medicine to treat inflammation of the eyes.  It is prepared for use by pounding the leaves of the plant into a thick paste, and then topically applying it to the required part of the body.  It has also been recorded being used to treat burns, as a treatment for headaches and back pain, and as an agent for food preservation.\nAcademic research has found that the plant has antimicrobial properties, and significant concentrations of the Zerumbone synthase enzyme, which may be effective in treating colon cancer.\n\n\n== References ==",
    expected: ["beehive ginger","Ginger wort","Malaysian ginger"],
  },
  {
    name: 'Zinnia elegans (syn. + known-as list; R56; "youth-and-age" preserved)',
    extract: "Zinnia elegans (syn. Zinnia violacea) known as youth-and-age, common zinnia or elegant zinnia, is an annual flowering plant in the family Asteraceae. It is native to Mexico but grown as an ornamental in many places and naturalised in several places, including scattered locations in South and Central America, the West Indies, the United States, Australia, and Italy.\n\n\n== Description ==\nThe uncultivated plant grows to about 15 cm (5.27 in) in height. It has solitary flower heads about 5 cm (2 in) across. The purple ray  florets surround black and yellow discs. The lanceolate leaves are opposite the flower heads. Flowering occurs during the summer months.\n\n\n== History ==\nThe species was first collected in 1789 at Tixtla, Guerrero, by Sessé and Mociño. It was formally described as Zinnia violacea by Cavanilles in 1791. Jacquin described it again in 1792 as Zinnia elegans, which was the name that Sessé and Moçiño had used in their manuscript of Plantae Novae Hispaniae, which was not published until 1890. The genus was named by Carl von Linné after the German botanist Johann Gottfried Zinn, who described the species now known as Zinnia peruviana in 1757 as Rudbeckia foliis oppositis hirsutis ovato-acutis, calyce imbricatus, radii petalis pistillatis. Linné realised that it was not a Rudbeckia.\n\n\n== Cultivation ==\nThe garden zinnia was bred via hybridisation from the wild form. Zinnias are popular garden plants with hundreds of cultivars in many flower colours, sizes and forms. There are giant forms with flower heads up to 15 cm (6 in) in diameter.\nFlower colours range from white and cream to pinks, reds, and purples, to green, yellow, apricot, orange, salmon, and bronze. Some are striped, speckled or bicoloured. There are \"pom-pom\" forms that resemble dahlias. Sizes range from dwarf varieties of less than 15 cm (6 in) in height to 90 cm (3 ft) tall. The powdery mildew common to zinnias in humid climates is less common in recently developed varieties, which are resistant.\nThe following have won the Royal Horticultural Society's Award of Garden Merit:\n\nOther cultivars include 'Magellan', 'Envy Double', 'Fireworks', 'Blue Point Purple', 'Profusion Cherry', 'Profusion Orange', 'Star Gold', 'Star Orange', and several white-flowered types such as 'Crystal White', 'Purity', and 'Profusion White'. Mixed-colour seed selections are available.\n\n\n=== Growth ===\nZinnias grow easily and prefer well-drained, loamy soil and full sun. They grow best in dry, warm, frost-free regions, and many kinds are drought-tolerant. As they do not tolerate freezing temperatures, in temperate zones they must be sown after all danger of frost has passed. Alternatively, they may be sown under cover and carefully transplanted into their final positions when the soil warms up.\n\n\n== Gallery ==\n\n\n== References ==\n\n\n== General sources ==\nFloridata: Zinnia elegans\nPlant of the week: Zinnia elegans\nGarden Guides: Zinnia elegans\nWildflower Information: Zinnia elegans Archived 2016-09-16 at the Wayback Machine\nNorth Carolina State University: Zinnia elegans Archived 2013-09-03 at the Wayback Machine\nFlowers of India: Zinnia elegans\nKew Plant List\nThe International Plant Names Index\n\n\n== External links ==\n Media related to Zinnia elegans at Wikimedia Commons\n Data related to Zinnia at Wikispecies",
    expected: ["common zinnia","elegant zinnia","youth-and-age"],
  },
  {
    name: 'Brassica rapa subsp. chinensis (dialect-annotated list; R57; R58 spellings)',
    extract: "Bok choy (American English, Canadian English, and Australian English), pak choi (British English, South African English, and Caribbean English) or pok choi is a type of Chinese cabbage (Brassica rapa subsp. chinensis) cultivated as a leaf vegetable to be used as food. Varieties do not form heads and have green leaf blades with lighter bulbous bottoms instead, forming a cluster reminiscent of mustard greens. Its flavor is described as being between spinach and water chestnuts but slightly sweeter, with a mildly peppery undertone. The green leaves have a stronger flavor than the white bulb.\nChinensis varieties are popular in southern China, East Asia, and Southeast Asia. Originally classified as Brassica chinensis by Carl Linnaeus, they are now considered a subspecies of Brassica rapa. They are a member of the family Brassicaceae.\n\n\n== Spelling and naming variations ==\n\nOther than the term \"Chinese cabbage\", the most widely used name in North America for the chinensis variety is bok choy (Cantonese for \"white vegetable\") or siu bok choy (Cantonese, for \"small white vegetable\", as opposed to dai bok choy meaning \"big white vegetable\", referring to the larger napa cabbage). It is also sometimes spelled as pak choi, bok choi, and pak choy. In the UK, South Africa, and the Caribbean the term pak choi is used. Less commonly, the names Chinese chard, Chinese mustard, celery mustard, and spoon cabbage are also used.\nThere are two main types of bok choy, collectively called 小白菜 xiǎo bái cài (\"small white vegetable\") in Mandarin. One is white bok choy (Chinese: 奶白菜; lit. 'milky white vegetable') with dark green blades and white stalks, which is primarily cultivated in South China, and in Cantonese it is simply called baak choi (Chinese: 白菜; lit. 'white vegetable'; the same characters pronounced bái cài by Mandarin speakers are preferably used for napa cabbage). The other is green bok choy (Chinese: 青白菜; lit. 'green white vegetable'; Chinese: 青菜; lit. 'green vegetable'; Chinese: 上海青; lit. 'Shanghai green'; Chinese: 青梗菜; lit. 'green-stalk vegetable'; Chinese: 小唐菜; lit. 'small Chinese vegetable') with light green stalks, which is more common in East China; the young and tender plants of green bok choy is called baby bok choy (Chinese: 雞毛菜; lit. 'chicken-feather vegetable'), which is less crisp and therefore may become too soft if overcooked.\nIn Australia, the New South Wales Department of Primary Industries has redefined many transcribed names to refer to specific cultivars. They have introduced the word buk choy to refer to white bok choy and redefined pak choy to refer to green bok choy.\n\n\n== Uses ==\n\n\n=== Cooking ===\n\nBok choy cooks in 2 to 3 minutes by steaming, stir-frying, or simmering in water (8 minutes if steamed whole). The leaves cook faster than the stem. It is often used in similar ways to other leafy vegetables such as spinach and cabbage. It can also be eaten raw. It is commonly used in salads.\n\n\n=== Preserving ===\nDried bok choy is saltier and sweeter. Pickled bok choy remains edible for months. Immature plants have the sweetest, tenderest stems and leaves.\n\n\n== Nutritional value ==\n\nThe raw vegetable is 95% water, 2% carbohydrates, 1% protein and less than 1% fat. In a 100-gram (3+1⁄2-ounce) reference serving, raw bok choy provides 54 kilojoules (13 food calories) of food energy and is a rich source (20% or more of the Daily Value, DV) of vitamin A (30% DV), vitamin C (54% DV) and vitamin K (44% DV), while providing folate, vitamin B6 and calcium in moderate amounts (10–17% DV).\n\n\n== Growing Preferences ==\nBok choy prefers fertile, well-draining soil, high in organic matter with a pH of 6.0 to 7.5.  amend with compost or well-rotted manure before planting.  it's a heavy feeder, especially nitrogen, and needs consistently moist soil throughout the season. Drying out or temperatures above 70° Fahrenheit (21 °C) will trigger bolting. Ideal temperature range is 55° to 70° Fahrenheit and most varieties mature in 30 to 60 days.\n\n\n== History ==\n\nBok choy evolved from the mustard plant in China, where it has been cultivated since the 5th century CE. It can be traced to the Yangtze River delta area, one of the world's oldest agricultural regions. It also has been traced to the Yellow River Valley where archaeologists found Chinese cabbage seeds dating back 6,000 years.\nAs bok choy grew in use, it spread to other parts of Asia and was eventually cultivated in countries such as Japan, Malaysia, Indonesia, and the Philippines. Bok choy plantations were present in Japan and Malaya by the early 19th century. In Malaya, bok choy was not commonly consumed by the poor.\nThe vegetable was introduced to Europe in the mid-18th century. A Swede named Osbeck brought bok choy seeds to Europe during the same time period Jesuit missionaries brought similar strains of the vegetable to German scientists working in Russia. Bok choy was introduced to North America in the 19th century, but did not gain in use for another century.\n\n\n== Gallery ==\n\n\n== See also ==\nChoy sum\nGai lan\nList of leaf vegetables\n Food portal\n\n\n== References ==\n\n\n== External links ==\nSchuh, Marissa. \"Growing Chinese cabbage and bok choy in home gardens\".\n Media related to Brassica rapa subsp. chinensis at Wikimedia Commons",
    expected: ["Bok choy","bok choi","pak choi","pak choy","pok choi"],
  },
  {
    name: 'Cauliflower (R5 single-word appositive; R24 comma-less "curd called"; R51)',
    extract: "Cauliflower (Brassica oleracea var. botrytis) is a vegetable belonging to the species Brassica oleracea in the family Brassicaceae (the mustard or cabbage family). It is one of several cultivated forms of the species along with cabbage, broccoli, Brussels sprouts, kale, kohlrabi, and others. The edible portion of the plant is its dense head of undeveloped flower buds known as the \"curd\". The head is usually white but may also be green, orange, or purple. Several cultivars exist, including the Romanesco variety, whose spiral curds grow in fractal patterns.\nCauliflower was domesticated in the Mediterranean region during antiquity, most likely by selective breeding of wild cabbage. It is grown worldwide as a cool-season crop and is widely used in cooking, where it may be eaten raw, steamed, roasted, or incorporated into other dishes. World cauliflower production (combined with broccoli) in 2024 was 27 million tonnes, led by China and India with 73% of the total.\n\n\n== Description ==\nThere are four major groups of cauliflower.\n\nItalian: This specimen is diverse in appearance, biennial, and annual in type. This group includes white, Romanesco, and various brown, green, purple, and yellow cultivars. This type is the ancestral form from which the others were derived.\nNorthern European annuals: These are used in Europe and North America for summer and fall harvests. They were developed in Germany in the 18th century and include the old cultivars Erfurt and Snowball.\nNorthwest biennial: Used in Europe for winter and early spring harvest, developed in France in the 19th century and includes the old cultivars Angers and Roscoff.\nAsian: A tropical cauliflower used in China and India, it was developed in India during the 19th century from the now-abandoned Cornish type and includes old varieties Early Benaras and Early Patna.\n\n\n=== Domestication ===\nCauliflowers are an \"arrested inflorescence\" subspecies of B. oleracea that arose around 2,500 years ago. Genomic analysis finds initially evolved from broccoli with three MADS-box genes, playing roles in its curd formation. Nine loci and candidate genes are linked with morphological and biological characters.\n\n\n=== Varieties ===\nThere are hundreds of historic and current commercial varieties used around the world. A comprehensive list of about 80 North American varieties is maintained at North Carolina State University.\n\n\n=== Colors ===\nWhite cauliflower is the most common color of cauliflower, having a contrasting white head (also called \"curd\", having a similar appearance to cheese curd), surrounded by green leaves.\nOrange cauliflower contains beta-carotene as the orange pigment, a provitamin A compound. This orange trait originated from a natural mutant found in a cauliflower field in Canada. Cultivars include 'Cheddar' and 'Orange Bouquet'.\nGreen cauliflower in the B. oleracea Botrytis Group is sometimes called broccoflower. It is available in the normal curd (head) shape and with a fractal spiral curd called Romanesco broccoli. Both have been commercially available in the U.S. and Europe since the early 1990s. Green-headed varieties include 'Alverda, 'Green Goddess', and 'Vorda'. Romanesco varieties include 'Minaret' and 'Veronica'.\nThe purple color is caused by the presence of anthocyanins, water-soluble pigments that are found in many other plants and plant-based products, such as red cabbage and red wine. Varieties include 'Graffiti' and 'Purple Cape'.\n\n\n=== Phytochemicals ===\nCauliflower contains several non-nutrient phytochemicals common in the cabbage family that are under preliminary research for their potential properties, including isothiocyanates and glucosinolates. Boiling reduces the levels of cauliflower glucosinolates, while other cooking methods, such as steaming, microwaving, and stir frying, have no significant effect on glucosinolate levels.\n\n\n== Etymology ==\nThe word \"cauliflower\" derives from the Italian cavolfiore, meaning \"cabbage flower\". The ultimate origin of the name is from the Latin words caulis (cabbage) and flōs (flower).\n\n\n== Nutrition ==\n\nRaw cauliflower is 92% water, 5% carbohydrates, 2% protein, and contains negligible fat (table). In a reference amount of 100 grams (3.5 oz), raw cauliflower provides 25 calories of food energy, and has a high content (20% or more of the Daily Value, DV) of vitamin C (54% DV) and moderate levels of several B vitamins, vitamin K, and potassium (10–14% DV; table). Contents of other micronutrients are low (below 5% DV).\n\n\n== Cultivation ==\n\n\n=== History ===\nCauliflower is the result of selective breeding and likely arose in the Mediterranean region, possibly from broccoli.\nPliny the Elder  included cyma among cultivated plants he described in Natural History: \"Ex omnibus brassicae generibus suavissima est cyma\" (\"Of all the varieties of cabbage the most pleasant-tasted is cyma\"). Pliny's description likely refers to the flowering heads of an earlier cultivated variety of Brassica oleracea.\nIn the Middle Ages, early forms of cauliflower were associated with the island of Cyprus, with the 12th- and 13th-century Arab botanists Ibn al-'Awwam and Ibn al-Baitar claiming its origin to be Cyprus. This association continued into Western Europe, where cauliflowers were sometimes known as Cyprus colewort, and there was extensive trade in Western Europe in cauliflower seeds from Cyprus, under the French Lusignan rulers of the island, until well into the 16th century.\nIt is thought to have been introduced into Italy from Cyprus or the east coast of the Mediterranean around 1490 and then spread to other European countries in the following centuries.\nFrançois Pierre La Varenne employed chouxfleurs in Le cuisinier françois. They were introduced to France from Genoa in the 16th century and are featured in Olivier de Serres' Théâtre de l'agriculture (1600), as cauli-fiori \"as the Italians call it, which are still rather rare in France; they hold an honorable place in the garden because of their delicacy\", but they did not commonly appear on grand tables until the time of Louis XIV. It was introduced to India in 1822 by the British.\n\n\n=== Horticulture ===\nCauliflower is relatively difficult to grow compared to cabbage, with common problems such as an underdeveloped head and poor curd quality.\n\n\n==== Climate ===\nBecause the weather is a limiting factor for producing cauliflower, the plant grows best in moderate daytime temperatures 21–29 °C (70–85 °F), with plentiful sun and moist soil conditions high in organic matter and sandy soils. The earliest maturity possible for cauliflower is 7 to 12 weeks from transplanting. In the northern hemisphere, fall season plantings in July may enable harvesting before autumn frost.\nLong periods of sun exposure in hot summer weather may cause cauliflower heads to discolor with a red-purple hue.\n\n\n==== Seeding and transplanting ===\nTransplantable cauliflowers can be produced in containers such as flats, hotbeds, or fields. In soil that is loose, well-drained, and fertile, field seedlings are shallow-planted 1 cm (1⁄2 in) and thinned by ample space – about 12 plants per 30 cm (1 ft). Ideal growing temperatures are about 18 °C (65 °F) when seedlings are 25 to 35 days old. Applications of fertilizer to developing seedlings begin when leaves appear, usually with a starter solution weekly.\nTransplanting to the field normally begins in late spring and may continue until mid-summer. Row spacing is about 38–46 cm (15–18 in). Rapid vegetative growth after transplanting may benefit from such procedures as avoiding spring frosts, using starter solutions high in phosphorus, irrigating weekly, and applying fertilizer.\n\n\n==== Disorders, pests, and diseases ===\nThe most important disorders affecting cauliflower quality are a hollow stem, stunted head growth or buttoning, ricing, browning, and leaf-tip burn. Among major pests affecting cauliflower are aphids, root maggots, cutworms, moths, flea beetles, and the seedcorn maggot, Delia platura. The plant is susceptible to black rot, black leg, club root, black leaf spot, and downy mildew.\n\n\n==== Harvesting ===\nWhen cauliflower is mature, heads appear clear white, compact, and 15–20 cm (6–8 in) in diameter, and should be cooled shortly after harvest. Forced air cooling to remove heat from the field during hot weather may be needed for optimal preservation. Short-term storage is possible using cool, high-humidity storage conditions.\n\n\n==== Pollination ===\nMany species of blowflies, including Calliphora vomitoria, are known pollinators of cauliflower.\n\n\n=== Production ===\nIn 2024, world production of cauliflower (combined for production reports with broccoli) was 27 million tonnes, led by China and India which together had 73% of the total (table). Secondary producers were the United States, Mexico, and Spain.\n\n\n== Culinary ==\nCauliflower heads can be roasted, grilled, boiled, fried, steamed, pickled, or eaten raw. When cooking, the outer leaves and thick stalks are typically removed, leaving only the florets (the edible \"curd\" or \"head\"). The leaves are also edible but are often discarded.\nCauliflower can be used as a low-calorie, gluten-free alternative to rice and flour. Between 2012 and 2016, cauliflower production in the United States increased by 63%, and cauliflower-based product sales increased by 71% between 2017 and 2018. Cauliflower rice is made by pulsing cauliflower florets and cooking the result in oil. Cauliflower pizza crust is made from cauliflower flour. Mashed cauliflower is a low-carbohydrate alternative to mashed potatoes.\n\n\n== In culture ==\n\nCauliflower has been noticed by mathematicians for its distinct fractal dimension, calculated to be roughly 2.8. One of the fractal properties of cauliflower is that every branch, or \"module\", is similar to the entire cauliflower. Another quality, also present in other plant species, is that the angle between \"modules\", as they become more distant from the center, is 360 degrees divided by the golden ratio.\nThe fancied resemblance of the shape of a boxer's ear to a cauliflower gave rise to the term \"cauliflower ear\".\n\n\n== References ==\n\n\n== Further reading ==\nS. R. Sharma, Praveen K. Singh, Veronique Chable, et al. (2004). \"A Review of Hybrid Cauliflower Development\". Journal of New Seeds. 6 (2–3): 151. doi:10.1300/J153v06n02_08. S2CID 85136416.\n\n\n== External links ==\n\nPROTAbase on Brassica oleracea (cauliflower and broccoli)\nOrange Cauliflower Development",
    expected: ["Cauliflower","Cyprus colewort","Romanesco broccoli","broccoflower"],
  },
  {
    name: 'Ziziphus jujuba (R60 leading name + "sometimes"; R1/R7/R8/R10 lists; R43 food)',
    extract: "Jujube (UK ; US  or ), sometimes jujuba, scientific name Ziziphus jujuba, and also called red date, Chinese date, and Chinese jujube, is a species in the genus Ziziphus in the buckthorn family Rhamnaceae. It is often confused with the closely related Indian jujube, Z. mauritiana. The jujube tolerates a diverse range of climates, from temperate to tropical. Its origin is thought to be in eastern Asia, but it has been widely dispersed through cultivation, and is today cultivated in gardens as a shrub as well as in agriculture as a food crop. Its fruit is eaten freshly harvested as well as dried and candied.\n\n\n== Description ==\nIt is a small deciduous tree or shrub reaching a height of 5–10 metres (16–33 feet), usually with thorny branches. The leaves are shiny-green, ovate-acute, 2–7 centimetres (3⁄4–2+3⁄4 inches) long and 1–3 cm (3⁄8–1+1⁄8 in) wide, with three conspicuous veins at the base, and a finely toothed margin. Leaves of trees grown in the climate region in Turkey measure average between 3.8–4.28 cm in length and 1.79–1.98 cm in width. The flowers are small, 5 millimetres (1⁄4 in) wide, with five inconspicuous yellowish-green petals.\n\nThe fruit is an edible oval drupe 1.5–3 cm (5⁄8–1+1⁄8 in) deep; when immature it is smooth-green, with the consistency and taste of an apple with lower acidity, maturing brown to purplish-black, and eventually wrinkled, looking like a small date. There is a single hard kernel, similar to an olive stone, containing two seeds. Modern cultivated jujubes have kernels up to 3.8 times larger than those of wild jujubes.\n\n\n=== Chemistry ===\nThe leaves contain saponin and ziziphin, which suppresses the ability to perceive sweet taste.\nFlavinoids found in the fruits include Kaempferol 3-O-rutinoside, Quercetine 3-O-robinobioside, Quercetine 3-O-rutinoside. Terpenoids such as colubrinic acid, zizyberenalic acid, and alphitolic acid were found in the fruits.\n\n\n== Taxonomy ==\nThe ultimate source of the name is Ancient Greek ζίζυφον zízyphon. This was borrowed into Classical Latin as zizyphum (used for the fruit) and zizyphus (the tree). A descendant of the Latin word into a Romance language, which may have been French jujube or medieval Latin jujuba, in turn gave rise to the common English jujube. The name jujube is not related to jojoba referring to a different unrelated species Simmondsia chinensis, which is a loan from Spanish jojoba, itself borrowed from hohohwi, the name of that plant in the Oʼodham language.\nThe binomial name has a complex history, due to a combination of botanical naming regulations, and variations in spelling. It was first named in the binomial system by Carl Linnaeus as Rhamnus zizyphus, in Species Plantarum (1753). Philip Miller, in his Gardener's Dictionary, considered that the jujube and its relatives were sufficiently distinct from Rhamnus to be placed in a separate genus (as it had already been by the pre-Linnaean author Tournefort in 1700), and in the 1768 edition he gave it the name Ziziphus jujuba (using Tournefort's spelling for the genus name). For the species name, he used a different name, as tautonyms (repetition of exactly the same name in the genus and species) are not permitted in botanical naming. However, because of Miller's slightly different spelling, the combination of the earlier species name (from Linnaeus) with the new genus, Ziziphus zizyphus, is not a tautonym, and was therefore permitted as a botanical name. This combination was made by Hermann Karsten in 1882. In 2006, a proposal was made to suppress the name Ziziphus zizyphus in favour of Ziziphus jujuba, and this proposal was accepted in 2011. Ziziphus jujuba is thus the correct scientific name for this species.\nThe fruit is also commonly known as red date, Chinese date, and Chinese jujube. It is often confused with the closely related Indian jujube, Z. mauritiana.\n\n\n== Distribution and habitat ==\nIts precise natural distribution is uncertain due to extensive cultivation. However, its origin is thought to be in eastern Asia, in southern and central China, India, Korea, and Japan, and possibly also southwestern Asia between Lebanon, and southeastern Europe, though more likely introduced there.\nThe Chinese jujube enjoys a diverse range of climates from temperate to tropical (whereas the Indian jujube is restricted to warmer subtropical and tropical climates). The tree tolerates a wide range of temperatures and rainfall, though it requires hot summers and sufficient water for acceptable fruiting. Unlike most of the other species in the genus, it tolerates fairly cold winters, surviving temperatures down to about −15 °C (5 °F), and the tree is, for instance, commonly cultivated in Beijing. This wide tolerance enables the jujube to grow in mountain or desert habitats, provided there is access to underground water throughout the summer. The jujube or Z. jujuba grows in cool regions of Asia; five or more other species of Ziziphus on the other hand are widely distributed in milder climates to warmer deserts of Asia and Africa.\nThis plant has been introduced in Madagascar and grows as an invasive species in the western part of the island, threatening mostly protected areas. It is cultivated in parts of southern California.\n\n\n== Ecology ==\nIn Madagascar, it is widely eaten by free-ranging zebus, and its seeds grow easily in zebu faeces.\n\n\n== Cultivation ==\nChinese jujubes have been grown in parts of Asia for thousands of years. Wild jujube kernels have been found in three sites on the Qi River basin of northern China dating to the Neolithic period. It may have originated in Syria, but was distributed across the Mediterranean region at least 3,000 years ago. Today, it is most widely grown in China. The tree is tolerant of droughts and flooding, and can be cultivated on a large scale.\nJujubes are grown as a garden shrub throughout most of the southern half of North America, doing particularly well in parts of California. Cultivars include Li, Lang, Sherwood, Silverhill (also known as Tiger Tooth), So, Shui Men, and GA 866.\nAgricultural growers have started to plant Chinese jujubes in Australia since around 2000. A family farm in Renmark, South Australia has been growing the fruit since 2015. Seeka, the largest producer of kiwi fruit and nashi pears in Australia, produces abundant crops of jujubes, and was looking at exporting some of its output as the dried product. In 2023 the company was planning to expand its production by planting around 40,000 jujube trees on its land near Shepparton, Victoria. By mid-2025, there were about 60 growers and around 50,000 trees planted in Australia, according to AgriFutures Australia. Growers said that a national body was needed to establish export markets and create more public awareness of the fruit domestically.\n\n\n== Pests ==\n\nWitch's broom, prevalent in China and Korea, is the main disease affecting jujubes, though plantings in North America currently are not affected by any pests or diseases. In Europe, the last several years have seen some 80%–90% of the jujube crop eaten by insect larvae, including those of the false codling moth (Thaumatotibia leucotreta).\n\n\n== Uses ==\n\n\n=== Culinary ===\nFreshly harvested and candied dried fruit are often eaten as a snack or with coffee. Smoked jujubes are consumed in Vietnam and are referred to as black jujubes. A drink can be made by crushing the pulp in water. Both China and Korea produce a sweetened tea syrup containing jujube fruit in glass jars, and canned jujube tea or jujube tea in the form of teabags. To a lesser extent, jujube fruit is made into juice and jujube vinegar (called 枣醋 or 紅枣醋 in Chinese). They are used for making pickles (কুলের আচার) in west Bengal and Bangladesh. In Assam it is known as \"Bogori\" and the pickle, Bogori aachar (বগৰি আচাৰ), is famous. In China, a wine made from jujube fruit is called hong zao jiu (紅枣酒).\nSometimes pieces of jujube fruit are preserved by storing them in a jar filled with baijiu (Chinese liquor), which allows them to be kept fresh for a long time, especially through the winter. Such jujubes are called zui zao (醉枣; literally \"drunk jujube\"). The fruit is also a significant ingredient in a wide variety of Chinese delicacies (e.g. 甑糕 jing gao, a steamed rice cake).\nIn Vietnam and Taiwan, fully mature, nearly ripe fruit is harvested and sold on the local markets and also exported to Southeast Asian countries. The dried fruit is used in desserts in China and Vietnam, such as ching bo leung, a cold beverage that includes the dried jujube, longan, fresh seaweed, barley, and lotus seeds.\nIn Korea, jujubes are called daechu (대추) and are used in daechucha, yakshik and samgyetang.\nOn his visit to Medina, the 19th-century English explorer, Sir Richard Burton, observed that the local varieties of the fruit were widely eaten. He describes its taste as like \"a bad plum, an unripe cherry, and an insipid apple\". He gives the local names for three varieties as \"Hindi (Indian), Baladi (native), Tamri (date-like).\" A hundred years ago, a close variety was common in the Jordan valley and around Jerusalem. The bedouin valued the fruit, calling it nabk. It could be dried and kept for winter or made into a paste which was used as bread.\nIn Persian cuisine, the dried drupes are known as annab, while in neighboring Armenia, it is commonly eaten as a snack, and is known as unab. Confusion in the common name apparently is widespread. The unab is Z. jujuba. Rather, ber is used for three other cultivated or wild species, e.g., Z. spina-christi, Z. mauritiana and Z. nummularia in parts of India and is eaten both fresh and dried. The Arabic name sidr is used for Ziziphus species other than Z. jujuba.\nTraditionally in India, the fruits are dried in the sun and the hard seeds removed, after which the dried flesh is pounded with tamarind, red chillies, salt, and jaggery. In some parts of the Indian state of Tamil Nadu, fresh whole ripe fruit is crushed with the above ingredients and sun-dried to make cakes called ilanthai vadai or regi vadiyalu (Telugu). It is also commonly consumed as a snack.\nIn Northern and Northeastern India the fruit is eaten fresh with salt and chilli flakes and also preserved as candy, jam or pickle with oil and spices.\nIn Madagascar, jujube fruit is eaten fresh or dried. People also use it to make jam. A jujube honey is produced in the Atlas Mountains of Morocco.\nItaly has an alcoholic syrup called brodo di giuggiole.\nIn Croatia, especially Dalmatia, jujubes are used in marmalades, juices, and rakija (fruit brandy).\nIn Senegal and The Gambia, jujube is called Sii dem or Ceedem, and the fruit is used as snack, and also turned into a dried paste favoured as a sweetmeat by schoolchildren.\nIn Australia jujube beer is made.\nThe commercial jujube candy popular in movie theaters originally contained jujube juice but now uses other flavorings.\nIn Laoling, China, jujube juice and wine are made.\n\n\n=== Traditional Chinese medicine ===\nThe fruit and its seeds are used in Traditional Chinese Medicine, Traditional Korean Medicine and Kampo for many purposes. Some investigational research indicates possibilities related to their traditional use to alleviate stress and for sedation. In these systems, it is also believed to have uses as an antiseptic/antifungal agent, anti-inflammatory, contraceptive, and muscle relaxer. It is also thought to help in regulation of blood pressure, stimulate the immune system, prevent ulcers and aid in wound healing. Jujube fruit is also combined with other herbs to treat colds and influenza. It is used to protect and heal the kidneys, heart, and spleen. Jujube is also one of the ingredients used in Chinese medicine to modulate the effects of other herbs, preventing overpowering effects or clashing properties.\nThe fruit contains many different healthy properties like vitamins and amino acids.\n\n\n=== Other uses ===\nIn Japan, the natsume has given its name to a style of tea caddy used in the Japanese tea ceremony, due to the similar shape. Its hard, oily wood was, along with pear, used for woodcuts to print books starting in the 8th century and continuing through the 19th in China and neighboring countries. As many as 2000 copies could be produced from one jujube woodcut.\nThe timber is sometimes used for small items, such as tuning pegs for instruments. Select grade Jujube timber is often used in traditional Asian instruments for fingerboard, pegs, rests & soundposts, ribs & necks etc. It has a medium to hard density similar to luthier grade European maple and has excellent tonal qualities. Jujube Wood can be found in local folk instruments from Ceylon/India thru to China/Korea; it is also commonly used in China in violin & cello making for overseas export, though usually stained black to imitate the look of ebony.\n\n\n== Culture ==\nIn Arabic-speaking regions the jujube and alternatively the species Z. lotus are closely related to the lote-trees (sing. سدرة sidrah, pl.  سدر sidr) which are mentioned in the Quran, while in Palestine the species Z. spina-christi is called sidr.\nAn ancient jujube tree in the city Al-Qurnah, Iraq, is claimed by locals as the Tree of Knowledge mentioned in the Bible. Local tradition holds that the place where the city was built was the original site of the Garden of Eden (a passage in the Book of Genesis creation narrative says that a river flowed from the garden and split into Tigris and Euphrates rivers, where the city is currently). The tree is a tourist spot in the town.\nJujube tree is important in Hinduism too as Vishnu is worshipped in a major temple, in Badrinath, from the Sanskrit compound Badarīnātha, consisting of the terms badarī (jujube tree) and nātha (lord), an epithet of Vishnu. It is also known as Badarikashrama.\n\n\n== See also ==\nDate palm – Palm tree cultivated for its sweet fruit\n\n\n== References ==\n\n\n== Further reading ==\nFruits of Warm Climates. Julia. F. Morton, Yan Lin Aung, FL: 1986.\n\n\n== External links ==\n\nNutritional data for the jujube",
    expected: ["Badarikashrama","Bogori","Bogori aachar","Chinese date","Chinese jujube","Jujube","black jujubes","jujuba","red date","unab"],
  },
  {
    name: 'Capsicum annuum / Bell pepper (R61 leading name + non-binomial alias-list parenthetical)',
    extract: 'The bell pepper (also known as sweet pepper, paprika, pepper, capsicum  or, in some parts of the U.S. Midwest, mango) is the fruit of plants in the Grossum Group of the species Capsicum annuum.',
    expected: ['bell pepper', 'sweet pepper', 'paprika', 'pepper', 'capsicum', 'mango'],
  },
  {
    name: 'Actinidia deliciosa / Kiwifruit (R62 "X (shortened to Y), or Z (...), is"; transliteration/has-have terminators)',
    extract: "Kiwifruit (often shortened to kiwi), or Chinese gooseberry (traditional Chinese: 獼猴桃; simplified Chinese: 猕猴桃; pinyin: míhóutáo), is the edible berry of several species of woody vines in the genus Actinidia.\nIn modern-day Chinese, the fruit is often referred to as qíyìguǒ (Chinese: 奇异果), a transliteration from English.\nAmong these are Hongyang, a red-fleshed kiwifruit selected in Sichuan from seedlings raised from wild-collected seeds, Jinyan, a yellow-fleshed variety, and Donghong, another red-fleshed cultivar, also known as Oriental Red.\nOther species that are commonly eaten include A. arguta (hardy kiwifruit, also known as kiwiberries).\nThey are referred to as kiwi berry, baby kiwi, dessert kiwi, grape kiwi, or cocktail kiwi.\nThe gold kiwifruit, also known as the yellow kiwi or golden kiwifruit, has smooth, bronze skin, with a beak shape at the stem attachment.",
    expected: ['Kiwifruit', 'kiwi', 'Chinese gooseberry', 'Oriental Red', 'kiwiberries', 'kiwi berry', 'baby kiwi', 'dessert kiwi', 'grape kiwi', 'cocktail kiwi', 'yellow kiwi', 'golden kiwifruit'],
  },
  {
    name: 'Brassica rapa / Rapini (R5 lead + R6c pronunciation-gloss list; all-caps acronym rejected)',
    extract: 'Rapini  (broccoli rabe or raab;  RAHB) is a green cruciferous vegetable, with the leaves, buds, and stems all being edible; the buds somewhat resemble broccoli. Rapini is known for its bitter taste, and is particularly associated with Mediterranean cuisine.\nNative to Europe, the plant is a member of the tribe Brassiceae of the Brassicaceae (mustard family). Rapini is classified scientifically as Brassica rapa var. ruvo, or Brassica rapa subsp. sylvestris var. esculenta. It is also known as broccoletti, broccoli raab, broccoli rabe, spring raab, and ruvo kale. Turnip and bok choy are different varieties (or subspecies) of this species.',
    expected: ['Rapini', 'broccoli rabe', 'raab', 'broccoletti', 'broccoli raab', 'spring raab', 'ruvo kale'],
  },
  {
    name: 'Rubus idaeus / Raspberry (R10 "also called" clause-remainder rejects verb-phrase/colon-stopword; R1 disease-remainder rejected)',
    extract: 'The raspberry is the edible fruit of several plant species in the genus Rubus of the rose family, most of which are in the subgenus Idaeobatus.\nSeveral species of Rubus, also called raspberries, are classified in other subgenera, including:\nBotrytis cinerea, or gray mold, is a common fungal infection of raspberries and other soft fruit under wet conditions.',
    expected: ['raspberries'],
  },
  {
    name: 'Abies fraseri / Fraser fir (Section:Names time-frame/participle rejects; R41 "because" terminator; "Fraser fir" generic-last-word exemption)',
    extract: "Abies fraseri, commonly known as Fraser's fir, or Fraser fir, is an endangered species of fir in the order Pinales native to the Appalachian Mountains of the southeastern United States.\n\n\n== Names ==\n\nThe species Abies fraseri is named after the Scottish botanist John Fraser (1750–1811), who made numerous botanical collections in the region.\nIn the past, it was also sometimes known as \"she-balsam\" because resin could be \"milked\" from its bark blisters, in contrast to the \"he balsam\" (or Picea rubens, the red spruce) which could not be milked. It has also been called southern balsam fir, inviting confusion with A. balsamea.",
    expected: ["Fraser's fir", 'Fraser fir', 'she-balsam', 'southern balsam fir'],
  },
  {
    name: 'Abies balsamea / Balsam fir (R11 quoted habitat phrase rejected at segment level for both R11 and R50)',
    extract: 'Abies balsamea or balsam fir is a North American fir, native to most of eastern and central Canada.\nFlat – sometimes referred to as "dry swamps", these areas are better drained than swamps but still retain moisture well.',
    expected: ['balsam fir'],
  },
  {
    name: 'Sorbaria sorbifolia ("common name also spelled X" spelling variant; "lit. \'pearl plum\'" gloss stripped to pearl plum)',
    extract: "Sorbaria sorbifolia, the false spiraea, is a species of flowering plant in the family Rosaceae. The common name is also spelled false spirea. Other common names include false goat's beard, sorb-leaved schizonotus, Ural false spirea, and in Chinese: 珍珠梅; pinyin: zhen zhu mei; lit. 'pearl plum'.",
    expected: ['false spiraea', 'false spirea', 'false goat\'s beard', 'sorb-leaved schizonotus', 'Ural false spirea', 'zhen zhu mei', 'pearl plum'],
  },
  {
    name: 'Pinus strobiformis (taxonomic rank "subgenus" rejected from appositive)',
    extract: 'Pinus strobiformis, also known as Chihuahua white pine, is a medium-sized white pine tree. Pinus strobiformis, a member of the white pine group, Pinus subgenus Strobus, is a straight, slender tree.',
    expected: ['Chihuahua white pine'],
  },
  {
    name: 'Quercus (taxonomic ranks section, subsection, series rejected)',
    extract: 'Quercus alba, the white oak, is a tree. Quercus section Lobatae is a taxonomic section. Quercus subsection Caninae is a subsection. Quercus series Phacocystis is a series.',
    expected: ['white oak'],
  },
  /* === REFINEMENT BATCH (28 species) — red tests; engine NOT yet fixed === */

  {
    name: 'Sambucus (commonly referred to as elder / elderflower / elderberry)',
    extract: 'Sambucus is a genus of between 20 and 30 species of flowering plants in the family Viburnaceae. The various species are commonly referred to as elder, with the flowers as elderflower, and the fruit as elderberry. Native to Europe and West Asia, the plant is distributed to northwest Africa.',
    expected: ['elder', 'elderflower', 'elderberry'],
  },
  {
    name: 'Sambucus (folklore "Elder Mother" is not a common name)',
    extract: 'If an elder tree was cut down, a spirit known as the Elder Mother would be released and take her revenge.',
    expected: [],
  },
  {
    name: 'Rhododendron pseudochrysanthum (lit. gloss "Alishan azalea" + appositive "false-gold-flower rhododendron")',
    extract: 'Rhododendron pseudochrysanthum (Chinese: 阿里山杜鵑; pinyin: Ālǐshān dùjuān; lit. \'Alishan azalea\'), the false-gold-flower rhododendron, is a species of flowering plant in the heath family Ericaceae, native to Taiwan.',
    expected: ['Alishan azalea', 'false-gold-flower rhododendron'],
  },
  {
    name: 'Podophyllum delavayi (appositive "Chinese mayapple" + standalone "mayapple")',
    extract: 'Podophyllum delavayi, the Chinese mayapple, is a herbaceous perennial plant in the family Berberidaceae native to South-Central China. Deep red flowers appear in May (hence the name mayapple) and are somewhat foul-scented to attract its pollinators.',
    expected: ['Chinese mayapple', 'mayapple'],
  },
  {
    name: 'Photinia × fraseri (known as X and Y — hybrid × not blocking)',
    extract: 'Photinia × fraseri, known as red tip photinia and Christmas berry, is a nothospecies in the rose family, Rosaceae. It is a hybrid between Photinia glabra and Photinia serratifolia.',
    expected: ['red tip photinia', 'Christmas berry'],
  },
  {
    name: 'Phlox carolina (cultivar clause "as known as wedding phlox, with white flowers" is not a species common name)',
    extract: "The most common cultivar is known as the 'Miss Lingard,' as known as wedding phlox, with white flowers and is a popular floral arrangement used for weddings.",
    expected: [],
  },
  {
    name: 'Onoclea sensibilis ("aka Maxim." taxonomic abbreviation is not a common name)',
    extract: 'Onoclea sensibilis has two geographically disjunctive varieties. Onoclea sensibilis var. sensibilis is native to North America. Onoclea sensibilis var. interrupta Maximowicz (aka Maxim.) is native to Southeast Siberia, Japan and China.',
    expected: [],
  },
  {
    name: 'Lonicera ligustrina (appositive "privet-like honeysuckle")',
    extract: 'Lonicera ligustrina (女贞叶忍冬, nü zhen ye ren dong), the privet-like honeysuckle, is a species of honeysuckle found in the central and eastern Himalayas of Bhutan, India, Nepal, and in southern and central China.',
    expected: ['privet-like honeysuckle'],
  },
  {
    name: 'Chamaecyparis formosensis (parenthetical "Formosan cypress, Taiwan cypress, Taiwan red cypress")',
    extract: 'Chamaecyparis formosensis (Formosan cypress, Taiwan cypress, Taiwan red cypress; Chinese: 紅檜/红桧 hóngguì, Taiwan pron. hóngkuài) is a species of large conifer, endemic to Taiwan, where it grows in the central mountains at moderate to high altitudes of 1000–2900 m.',
    expected: ['Formosan cypress', 'Taiwan cypress', 'Taiwan red cypress'],
  },
  {
    name: 'Alchemilla (genus common name "lady\'s mantle")',
    extract: 'Alchemilla is a genus of herbaceous perennial plants in the family Rosaceae, with the common name lady\'s mantle applied generically as well as specifically to Alchemilla mollis when referred to as a garden plant.',
    expected: ['lady\'s mantle'],
  },
  {
    name: 'Corylus (genus common names "hazel" / "hazelnut")',
    extract: 'Hazels are plants of the genus Corylus of deciduous trees and large shrubs native to the temperate Northern Hemisphere. The fruit of the hazel is the hazelnut; the trees are also grown as ornaments in hedges or gardens.',
    expected: ['hazel', 'hazelnut'],
  },
  {
    name: 'Vicia lens (family "commonly known as legume or bean family" is not a common name)',
    extract: 'The genus Vicia is part of the subfamily Faboideae which is contained in the flowering plant family Fabaceae or commonly known as legume or bean family, of the order Fabales in the kingdom Plantae.',
    expected: [],
  },
  {
    name: 'Helleborus viridis (appositive + "Other common names include" list)',
    extract: 'Helleborus viridis, commonly called green hellebore, is a species of flowering plant in the buttercup family Ranunculaceae, native to central and western Europe, including southern England. All parts of the plant are poisonous. Other common names recorded include bastard hellebore, bear\'s foot, and boar\'s foot.',
    expected: ['green hellebore', 'bastard hellebore', 'bear\'s foot', 'boar\'s foot'],
  },
  {
    name: 'Geranium psilostemon ("commonly called Armenian cranesbill" prefix stripped)',
    extract: 'Geranium psilostemon, commonly called Armenian cranesbill, is a species of hardy flowering herbaceous perennial plant in the genus Geranium, family Geraniaceae.',
    expected: ['Armenian cranesbill'],
  },
  {
    name: 'Carya tomentosa (insect pests "fruit-tree leafroller" etc. are not the plant\'s common names)',
    extract: 'The fruit-tree leafroller (Archips argyrospila) and the hickory leafroller (Argyrotaenia juglandana) are the most common leaf feeders. The giant bark aphid (Longistigma caryae) is common on hickory bark. The European fruit lecanium (Parthnolecanium corni) is common on hickories.',
    expected: [],
  },
  {
    name: 'Cardamine flexuosa ("known as chaantruk ... often used to garnish eromba" trailing junk)',
    extract: 'In the Northeast Indian state of Manipur, where it is known as chaantruk, C. flexuosa is eaten as an aromatic herb, often used to garnish eromba.',
    expected: ['chaantruk'],
  },
  {
    name: 'Amaryllis belladonna ("List of plants known as lily" see-also yields bare "lily" junk)',
    extract: '== See also ==\nList of plants known as lily\nA Jersey Lily, an 1878 painting by John Everett Millais',
    expected: [],
  },
  {
    name: 'Maianthemum racemosum (appositive list "feathery false lily of the valley" missed)',
    extract: 'Maianthemum racemosum, the treacleberry, feathery false lily of the valley, false Solomon\'s seal, Solomon\'s plume or false spikenard, is a species of flowering plant native to North America.',
    expected: ['treacleberry', 'feathery false lily of the valley', 'false Solomon\'s seal', 'Solomon\'s plume', 'false spikenard'],
  },
  {
    name: 'Gunnera tinctoria (misses "Chilean rhubarb"/"pangue"; wrongly keeps "nalqueros" people)',
    extract: 'Gunnera tinctoria, known as giant-rhubarb, Chilean rhubarb, quirusilla or nalca, is a flowering plant species native to southern Chile. In its native Chile, where it is called nalca or pangue, it is used in a similar way to European rhubarb.',
    expected: ['giant-rhubarb', 'Chilean rhubarb', 'quirusilla', 'nalca', 'pangue'],
  },
  {
    name: 'Lentil (rejects subspecific scientific names and descriptive "ancestor of" phrase)',
    extract: 'The primary ancestor of cultivated lentils (Vicia lens, previously Lens culinaris or Lens esculentis) is the wild taxa Lens orientalis. Following reassignment to genus Vicia, they may also be referred to as Vicia lens subsp. culinaris and Vicia lens subsp. orientalis.',
    expected: [],
  },
  {
    name: 'Lentil (rejects single colour words and "respectively" trait list)',
    extract: 'Common cotyledon colours are an orange-red colour and a light yellow, usually just called "red" (occasionally "orange") and "yellow" respectively.',
    expected: [],
  },
  {
    name: 'Lentil (rejects generic "taxa" quoted term)',
    extract: 'The seven members are often referred to as "taxa" instead of "species" and/or "subspecies", as while it is broadly agreed there are seven of them, whether they constitute distinct species is not broadly agreed on.',
    expected: [],
  },
  {
    name: 'Lentil (captures "dal" — plant noun + parenthetical + known as + verb)',
    extract: 'In cuisines of the Indian subcontinent, where lentils are a staple, split lentils (often with their hulls removed) known as dal are often cooked into a thick curry.',
    expected: ['dal'],
  },
  {
    name: 'Lentil (rejects market/cultivar "-types" classifications)',
    extract: 'These lentils are sometimes referred to by notable historic cultivars instead of by size, especially in North America: for example, small green lentils may be referred to as Eston-types, large green lentils as Laird-types, and large brown lentils as Brewer-types.',
    expected: [],
  },
  {
    name: 'Cladrastis kentukea ("sometimes also called" with adverb+also insert; appositive or-pair)',
    extract: 'Cladrastis kentukea, the Kentucky yellowwood or American yellowwood (syn. C. lutea, C. tinctoria), is a species of Cladrastis native to the Southeastern United States. The tree is sometimes also called Virgilia.',
    expected: ['Kentucky yellowwood', 'American yellowwood', 'Virgilia'],
  },
  {
    name: 'Halesia carolina (little silverbells — lit. prefix must not truncate "little")',
    extract: 'Halesia carolina, commonly called Carolina silverbells or little silverbells, is a species of flowering plant in the family Styracaceae, native to the southeastern United States.',
    expected: ['Carolina silverbells', 'little silverbells'],
  },
  {
    name: 'Anemopsis (with the common names X or Y. — terminator at sentence end)',
    extract: 'The monotypic genus Anemopsis has only one species, Anemopsis californica, with the common names yerba mansa or lizard tail. It is a perennial herb in the lizard tail family (Saururaceae) and prefers very wet soil or shallow water.',
    expected: ['yerba mansa', 'lizard tail'],
  },
  {
    name: 'Symphyotrichum hallii (commonly known as Hall\'s aster — reject pronoun "it")',
    extract: 'Symphyotrichum hallii (formerly Aster hallii) is a species of flowering plant in the family Asteraceae endemic to western Oregon and Washington states. Commonly known as Hall\'s aster, it is a perennial, herbaceous plant with a long rhizome that creates colonies of itself.',
    expected: ["Hall's aster"],
  },
  {
    name: 'Koeleria macrantha (prairie Junegrass in North America — geographic qualifier stripped)',
    extract: 'Koeleria macrantha is a species of grass known by the common name prairie Junegrass in North America and crested hair-grass in the UK. It is widespread across much of Eurasia and North America.',
    expected: ['prairie Junegrass', 'crested hair-grass'],
  },
  {
    name: 'Parthenocissus tricuspidata (by the name woodbine — prefix stripped)',
    extract: 'Parthenocissus tricuspidata is a species of flowering plant in the grape family (Vitaceae) native to eastern Asia (Korea, Japan, and northern and eastern China), where it thrives in floodplain bushes, riverside woodland and moist mountain mixed forests. Although unrelated to true ivy, it is commonly known as Boston ivy, grape ivy, Japanese ivy, and also as Japanese creeper, and by the name woodbine (though the latter may refer to a number of different vine species).',
    expected: ['Boston ivy', 'grape ivy', 'Japanese ivy', 'Japanese creeper', 'woodbine'],
  },
  {
    name: 'Halenia deflexa (also known as green gentian or spurred gentian — reject "a")',
    extract: 'Halenia deflexa, also known as green gentian or spurred gentian, is a plant in the gentian family (Gentianaceae). This species grows in wetlands and moist forests across much of the northern United States and Canada.',
    expected: ['green gentian', 'spurred gentian'],
  },
  {
    name: 'Washingtonia (desert fan palm only — reject "first U.S. President" and "prolonged cold")',
    extract: 'Washingtonia is a monotypic genus of monoecious palms, native to the southwestern United States (in Arizona, California, and Nevada) and northwest Mexico (in Baja California, Baja California Sur, and Sonora). Commonly known as the desert fan palm, the genus was named in honor of George Washington, the first U.S. President, by the German botanist Hermann Wendland in 1879. Intolerance of wet, prolonged cold is the main reason the Washingtonia palms do not grow in many temperate climates.',
    expected: ['desert fan palm'],
  },
  {
    name: 'Salix scouleriana (Other names occasionally used include — fire willow etc.)',
    extract: 'Salix scouleriana (Scouler\'s willow; syn. S. brachystachys Benth., S. capreoides Anderss., S. flavescens Nutt., S. nuttallii Sarg., S. stagnalis Nutt.) is a species of willow native to northwestern North America. Other names occasionally used include fire willow, Nuttall willow, mountain willow, and black willow.',
    expected: ["Scouler's willow", 'fire willow', 'Nuttall willow', 'mountain willow', 'black willow'],
  },
  {
    name: 'Betonica officinalis (Other vernacular names include — wood betony etc.)',
    extract: 'Betonica officinalis, common name betony is a species of flowering plant in the mint family Lamiaceae, native to Europe, western Asia, and northern Africa. Other vernacular names include wood betony, common hedgenettle, purple betony, bishopwort, or bishop\'s wort.',
    expected: ['betony', 'wood betony', 'common hedgenettle', 'purple betony', 'bishopwort', "bishop's wort"],
  },
  {
    name: 'Caryopteris × clandonensis (hybrid appositive the bluebeard etc.)',
    extract: 'Caryopteris × clandonensis, the bluebeard, blue mist, blue-mist shrub, or blue spirea, is an artificial hybrid species of flowering plant in the family Lamiaceae. Its parents are Caryopteris incana (from southern China, Taiwan, Korea, and Japan) and Caryopteris mongholica (from southern Siberia, Mongolia, and northern China).',
    expected: ['bluebeard', 'blue mist', 'blue-mist shrub', 'blue spirea'],
  },
  {
    name: 'Brassica (informally known as cruciferous vegetables etc. — reject etymology)',
    extract: 'Brassica () is a genus of plants in the cabbage and mustard family (Brassicaceae). The members of the genus are informally known as cruciferous vegetables, cabbages, mustard plants, or simply brassicas. Crops from this genus are sometimes called cole crops—derived from the Latin caulis, denoting the stem or stalk of a plant.',
    expected: ['cruciferous vegetables', 'cabbages', 'mustard plants', 'brassicas', 'cole crops'],
  },
  {
    name: 'Valeriana officinalis (Other names include garden valerian etc. — reject "often grown in gardens"/"but"/"red valerian")',
    extract: 'Valeriana officinalis is an herbaceous perennial flowering plant in the family Caprifoliaceae, native to Europe and southwestern Asia. Other names used for this plant include garden valerian (to distinguish it from other Valeriana species), garden heliotrope (although not related to Heliotropium), setwall (though this originally meant zedoary, from which it is etymologically derived) and all-heal (which is also used for plants in the genus Stachys). Valeriana rubra, red valerian, often grown in gardens, is also sometimes referred to as "valerian", but is a different species. Valerian is also called cat\'s love due to its catnip-like effects.',
    expected: ['garden valerian', 'garden heliotrope', 'setwall', 'all-heal', "cat's love"],
  },
  {
    name: 'Spiraea douglasii (Douglas\' spirea with possessive apostrophe)',
    extract: 'Spiraea douglasii is a species of flowering plant in the rose family. Common names include hardhack, hardhack steeplebush, Douglas\' spirea, douglasspirea, steeplebush, and rose spirea.',
    expected: ['hardhack', 'hardhack steeplebush', "Douglas' spirea", 'douglasspirea', 'steeplebush', 'rose spirea'],
  },
  {
    name: 'Vernonia (intro plural passive "are known as ironweeds" + "in the Igbo language" list qualifier; species-scoped names excluded)',
    extract: 'Vernonia is a genus of about 350 species of forbs and shrubs in the family Asteraceae. Some species of this genus are known as ironweeds. Some species are edible and of economic value.\n\n== Uses ==\n\n=== Food, medicine and oilseed ===\nSeveral species of Vernonia, including V. calvoana, V. amygdalina, and V. colorata, are eaten as leaf vegetables. Common names for these species include bitterleaf, onugbu in the Igbo language, ewuro and ndole. In Brazil, V. condensata is commonly known as "figatil" or "necroton" and used in local traditional medicine.',
    expected: ['ironweeds'],
  },
  {
    name: 'Vernonia (plural subject "are known as" passive naming statement)',
    extract: 'Some species of this genus are known as ironweeds.',
    expected: ['ironweeds'],
  },
  {
    name: 'Vernonia (species-scoped names excluded — "Common names for these species" + abbreviated-binomial subject)',
    extract: 'Several species of Vernonia, including V. calvoana, V. amygdalina, and V. colorata, are eaten as leaf vegetables. Common names for these species include bitterleaf, onugbu, ewuro and ndole. In Brazil, V. condensata is commonly known as "figatil" or "necroton" and used in local traditional medicine.',
    expected: [],
  },
  {
    name: 'Thalictrum (R5 single-word lead + R6c parenthetical on a mechanism-definition Ecology sentence rejected; only Meadow-rue extracted)',
    extract: 'Thalictrum ( ) is a genus of 120–200 species of herbaceous perennial flowering plants in the buttercup family, Ranunculaceae, native mostly to temperate regions. Meadow-rue is a common name for plants in this genus.\nDespite their common name of "meadow-rue", Thalictrum species are not closely related to the true rue (family Rutaceae), but resemble its members in having compound leaves twice or thrice divided.\n\n== Ecology ==\nAnemophily (wind pollination) is a characteristic of some members this genus, as seen in Thalictrum fendleri and Thalictrum dioicum.',
    expected: ['Meadow-rue'],
  },
  {
    name: 'Salvia (intro "referred to as" tail clause junk + Latin-name quotes rejected; only "sage" extracted)',
    extract: 'Salvia () is the largest genus of plants in the sage family Lamiaceae, with just under 1,000 species of shrubs, herbaceous perennials, and annuals. Within the Lamiaceae, Salvia is part of the tribe Mentheae within the subfamily Nepetoideae.  One of several genera commonly referred to as sage, it includes two widely used herbs, Salvia officinalis (common sage, or just "sage") and Salvia rosmarinus (rosemary, formerly Rosmarinus officinalis). \nThe genus is distributed throughout the Old World and the Americas (over 900 total species), with three distinct regions of diversity: Central America and South America (approximately 600 species); Central Asia and the Mediterranean (250 species); Eastern Asia (90 species).\n\n== Etymology ==\nThe name Salvia derives from Latin salvia (sage), from salvus (safe, secure, healthy), an adjective related to salūs (health, well-being, prosperity or salvation), and salvēre (to feel healthy, to heal). Pliny the Elder was the first author known to describe a plant called "Salvia" by the Romans, likely describing the type species for the genus Salvia, Salvia officinalis.\nThe common modern English name sage derives from Middle English sawge, which was borrowed from Old French sauge, from Latin salvia (the source of the botanical name). When used without modifiers, the name "sage" generally refers to Salvia officinalis ("common sage" or "culinary sage"), although it is used with modifiers to refer to any member of the genus. The ornamental species are commonly referred to by their genus name Salvia.',
    expected: ['sage'],
  },
  {
    name: 'Arnoglossum (genus) ("They have the common name X because..." — plural-subject have-variant of R19)',
    extract: 'Arnoglossum is a North American genus of plants in the family Asteraceae, described as a genus in 1817. They have the common name Indian plantain because they resemble the unrelated common plantain (Plantago spp.).',
    expected: ['Indian plantain'],
  },
  {
    name: 'Chilopsis (R15 "known commonly as X or Y because of..." — R15 must stop at "because", mirroring R8)',
    extract: 'Chilopsis is a monotypic genus of flowering plants containing the single species Chilopsis linearis. It is known commonly as desert willow or desert-willow because of its willow-like leaves, but it is not a true willow – being instead a member of the catalpa family.',
    expected: ['desert willow', 'desert-willow'],
  },
  {
    name: 'Echinocereus (R41 "sometimes known as X, a term also used for Y and Z" — trailing shared-term clause must not leak Y/Z as names)',
    extract: 'Echinocereus is a genus of ribbed, usually small to medium-sized, cylindrical shaped cacti, comprising about 70 species native to the southern United States and Mexico in very sunny, rocky places. Usually the flowers are large and the fruit edible.\nThe name comes from the Ancient Greek ἐχῖνος (echinos), meaning "sea urchin", and the Latin cereus meaning "candle". They are sometimes known as hedgehog cacti, a term also used for the Pediocactus and Echinopsis.',
    expected: ['hedgehog cacti'],
  },
  {
    name: 'Cleomella serrulata (unquoted indigenous "called X in the <Lang> language" list; intro + Navajo/Hopi/Zuni names)',
    extract: "Cleomella serrulata (syns. Cleome serrulata and Peritoma serrulata), commonly known as Rocky Mountain beeplant/beeweed, stinking-clover, bee spider-flower, skunk weed, Navajo spinach, and guaco, is a species of annual plant in the genus Cleomella. Many species of insects are attracted to it, especially bees, which helps in the pollination of nearby plants. It is native to southern Canada and the western and central United States. The plant has often been used for food, to make dyes for paint, and as a treatment in traditional medicine.\n\n\n== Description ==\nThe plant is called waaʼ in the Navajo language, tumi in the Hopi language, and both aʼpilalu and ado꞉we in the Zuni language.",
    expected: ['Rocky Mountain beeplant', 'Rocky Mountain beeweed', 'stinking-clover', 'bee spider-flower', 'skunk weed', 'Navajo spinach', 'guaco', 'waaʼ', 'tumi', 'aʼpilalu', 'ado꞉we'],
  },
  {
    name: 'Lunaria annua (Names-section list header, In-language qualifier, in-X-as prefix, which-clause junk, sometimes-called prefix, sillicle fruit term)',
    extract: "Lunaria annua, commonly called honesty or annual honesty, is a species of flowering plant in the cabbage and mustard family Brassicaceae. It is native to southern Europe, and cultivated throughout the temperate world.\n\n\n== Description ==\nIt is an annual or biennial growing to 90 cm (35 in) tall by 30 cm (12 in) broad, with large, coarse, pointed oval leaves with marked serrations. The leaves are hairy, the lower ones long-stalked, the upper ones stalkless. In spring and summer it bears terminal racemes of white, pink or violet flowers, followed by a kind of showy, green-through-light-brown, translucent, disc-shaped silique called a sillicle (not true botanical seedpods), sometimes called moonpennies.  When a silique is ripe and dry, a valve on each of its sides readily falls off, and its seeds fall off a central membrane which has a silvery sheen, 3–8 cm (1–3 in) in diameter; the membrane can persist on a plant throughout a winter depending on the weather. These sillicles are much used in dry floral arrangements.\n\n\n== Distribution ==\nLunaria annua is native to southern Europe from Spain to Romania, and has been introduced to many other parts of the world with temperate climates.\n\n\n== Names ==\nThe Latin name lunaria means 'moon-shaped' and refers to the shape and appearance of this species' siliques. The common name \"honesty\" arose in the 16th century and relates to the translucence of its silique membranes, which \"truthfully\" reveal their contents. Additional English names include money plant, moneywort, penny flower, silver dollar, and money-in-both-pockets, Chinese money, or Chinese coins. These, too, reference the silique membranes, which have the appearance of silvery coins. In French, it is known as monnaie du pape (\"Pope's money\").  In Denmark it is known as judaspenge and in Dutch-speaking countries as judaspenning (both meaning \"coins of Judas\"), an allusion to the story of Judas Iscariot and the thirty pieces of silver he was paid for betraying Christ.\n\n\n== Symbolism ==\nAccording to the Victorian era language of flowers published by American Sarah Josepha Hale, the plant represents fascination or sentiment. In other systems its meanings include honesty and money. In witchcraft, the honesty plant is considered protective, being thought to keep away monsters, evil spirits, and demons. The plant is also used in spells for prosperity, the flat pods (when ripe and silvery) resembling coins and therefore being seen as symbolising promises of wealth. In the earliest surviving recipe for a flying ointment (recorded by Bavarian physician Johannes Hartlieb circa 1440), Lunaria is included as the herbal ingredient corresponding astrologically to the moon and therefore to be picked on the lunar day of Monday.\n\n\n== Cultivation ==\nThis plant is easy to grow from seed and tends to naturalize. It is usually grown as a biennial, being sown one year to flower the next. It is suitable for cultivation in a shady or dappled area, or in a wildflower garden, and the flowers and dried siliques are often seen in flower arrangements. Numerous varieties and cultivars are available, of which the white-flowered L. annua var. albiflora and the variegated white L. annua var. albiflora 'Alba Variegata' have won the Royal Horticultural Society's Award of Garden Merit.\n\n\n== Gallery ==\n\n\n== See also ==\n\nDame's violet, Hesperis matronalis, a similar and related plant, but with long cylindrical seedpods instead of flat papery disks\nLunaria rediviva, perennial honesty\nPilea peperomioides, another plant known colloquially as the Chinese money plant\n\n\n== References ==\n\n\n== External links ==\n\nJepson Manual Treatment\nUSDA Plants Profile\nPhoto gallery",
    expected: ['honesty', 'annual honesty', 'moonpennies', 'money plant', 'moneywort', 'penny flower', 'silver dollar', 'money-in-both-pockets', 'Chinese money', 'Chinese coins', 'monnaie du pape', 'judaspenge', 'judaspenning'],
  },
];

const GBIF_TESTS = [
  {
    name: 'Zinnia elegans: simple single name',
    raw: 'Common Zinnia',
    expected: ['Common Zinnia'],
  },
  {
    name: 'Zinnia elegans: compound "or" name never split into fragments',
    raw: 'Elegant Or Garden Zinnia',
    expected: ['Elegant Or Garden Zinnia'],
  },
  {
    name: 'Zinnia elegans: compound "and" name never split into fragments',
    raw: 'Youth and old age',
    expected: ['Youth and old age'],
  },
  {
    name: 'Zinnia elegans: bracketed source annotation stripped',
    raw: 'Youth-and-age [TAXREF]',
    expected: ['Youth-and-age'],
  },
  {
    name: 'comma-separated bundle splits on commas only',
    raw: 'youth-and-age, youth-and-old-age',
    expected: ['youth-and-age', 'youth-and-old-age'],
  },
  {
    name: 'leading article stripped',
    raw: 'The common zinnia',
    expected: ['common zinnia'],
  },
  {
    name: 'empty and null inputs return empty array',
    raw: '',
    expected: [],
  },
  {
    name: 'null input returns empty array',
    raw: null,
    expected: [],
  },
];

for (const { name, raw, expected } of GBIF_TESTS) {
  test(`parseGbifVernacularName: ${name}`, () => {
    const actual = parseGbifVernacularName(raw);
    assert.deepStrictEqual(
      actual.sort(),
      expected.slice().sort(),
      `Mismatch for "${name}"\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`
    );
  });
}

for (const { name, extract, expected } of TESTS) {
  test(`extractWikipediaCommonNames: ${name}`, () => {
    const actual = extractWikipediaCommonNames(extract);
    assert.deepStrictEqual(
      actual.sort(),
      expected.slice().sort(),
      `Mismatch for "${name}"\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`
    );
  });
}
