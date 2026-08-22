const SKIP_RANKS = new Set([
  'subkingdom', 'subphylum', 'subdivision', 'subclass', 'suborder',
  'subfamily', 'subtribe', 'subgenus', 'subspecies',
  'superdomain', 'superkingdom', 'superdivision', 'superphylum', 'superclass',
  'infrakingdom', 'infraphylum', 'infraclass', 'infraorder',
  'domain', 'section', 'series', 'variety', 'form', 'forma',
  'strain', 'population', 'subvariety', 'subform',
  'nothoform', 'nothospecies', 'nothosubspecies',
  'tribe', 'subtribe', 'cohort', 'subcohort', 'infraspecies',
  'pathogroup', 'serogroup', 'serotype', 'biovar', 'chemovar'
]);

const RANK_PREFERENCE = [
  'kingdom', 'phylum', 'division', 'class', 'order', 'family', 'genus', 'species',
  'superkingdom', 'superphylum', 'superclass', 'superorder', 'superfamily'
];

const RANK_LABELS = {
  Q36732: 'kingdom',
  Q24017465: 'division',
  Q30097924: 'class',
  Q36602: 'order',
  Q35409: 'family',
  Q34740: 'genus',
  Q7432: 'species',
  Q1306176: 'nothospecies',
  Q19858692: 'superkingdom',
  Q14592334: 'phylum',
  Q105019: 'subspecies',
  Q3238261: 'subgenus',
  Q7486537: 'subfamily',
  Q5866644: 'suborder',
  Q11390: 'subdivision',
  Q148346: 'subclass',
  Q3238165: 'subtribe',
  Q171394: 'infraclass',
  Q315130: 'infraorder',
  Q501274: 'infrakingdom',
  Q7136226: 'clade',
  Q1145090: 'variety',
  Q1748487: 'form',
  Q160240: 'section',
  Q207370: 'series',
  Q35410: 'tribe',
  Q205302: 'subtribe',
  Q227936: 'tribe',
  Q164280: 'subfamily',
  Q37517: 'order',
  Q334460: 'class',
  Q2869638: 'superfamily',
  Q3344711: 'infraorder',
  Q146481: 'domain',
  Q22666877: 'superdomain',
  Q2997417: 'no rank',
  Q1425109: 'no rank'
};

// Breadth ordering for rank-monotonicity guards: lower = more specific.
// As we walk from species toward kingdom/domain, breadth must be non-decreasing.
const RANK_BREADTH = {
  species: 0, nothospecies: 0, infraspecies: 0, subspecies: 0,
  variety: 0, form: 0, forma: 0, section: 0, series: 0, strain: 0,
  subgenus: 5, genus: 10, subtribe: 15, tribe: 15, subfamily: 20,
  family: 30, suborder: 35, order: 40, subclass: 45, class: 50,
  subphylum: 55, subdivision: 55, phylum: 60, division: 60,
  subkingdom: 65, kingdom: 70, infrakingdom: 68,
  domain: 80, superdomain: 85, superkingdom: 90,
};

module.exports = { SKIP_RANKS, RANK_PREFERENCE, RANK_LABELS, RANK_BREADTH };
