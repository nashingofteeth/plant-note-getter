const { test } = require('node:test');
const assert = require('node:assert');
const { extractWikipediaCommonNames, parseGbifVernacularName } = require('../src/wiki-extract');

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
    expected: ['Joshua tree', 'yucca palm', 'tree yucca', 'palm tree yucca', 'izote de desierto'],
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
    expected: ['common walnut', 'English walnut'],
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
    name: 'Populus deltoides (subspecies appositives in Variation section; individual tree "Balmville Tree" not a common name)',
    extract: 'Populus deltoides, the eastern cottonwood or necklace poplar, is a species of cottonwood poplar native to North America.\n\n== Variation ==\nThe species is divided into three subspecies or up to five varieties.\nPopulus deltoides subsp. deltoides, eastern cottonwood is found in southeastern Canada and the eastern United States.\nP. d. monilifera (Aiton) Eckenw., the plains cottonwood (syn. P. deltoides var. occidentalis Rydb.; P. sargentii Dode) ranges from southcentral Canada to the central United States.\nP. d. wislizeni (S.Watson) Eckenw., the Rio Grande cottonwood (syn. P. wislizeni (S.Watson) Sarg.; P. fremontii var. wislizeni S.Watson) grows from southern Colorado south through Texas to northeastern Mexico.\n\n== Oldest and largest ==\nThe Balmville Tree (felled in 2015 at approximately 316 years old) was the oldest eastern cottonwood in the United States.',
    expected: ['eastern cottonwood', 'necklace poplar', 'plains cottonwood', 'Rio Grande cottonwood'],
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
