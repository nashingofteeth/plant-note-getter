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

module.exports = { SKIP_RANKS, RANK_PREFERENCE, RANK_LABELS };
