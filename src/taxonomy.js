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

function buildTagSegments(ancestors, ownId, labelMap) {
  const segments = ['life', 'eukaryota', 'plantae'];

  for (const a of ancestors) {
    if (a.id === ownId) continue;

    let label = a.label;
    if (label.startsWith('Q') && label.length > 1 && !isNaN(label.slice(1))) continue;

    if (label.startsWith('super')) continue;

    const mapped = labelMap[label] ?? labelMap[label.toLowerCase()];
    if (mapped === null) continue;
    if (mapped) label = mapped;

    const rank = a.rankLabel;
    if (rank && (SKIP_RANKS.has(rank) || rank.startsWith('sub') || rank === 'domain')) {
      if (!mapped) continue;
    }

    const seg = label.toLowerCase().replace(/\s+/g, '_');
    if (segments[segments.length - 1] !== seg) {
      segments.push(seg);
    }
  }

  return segments;
}

function buildTag(ancestors, ownId, labelMap) {
  return buildTagSegments(ancestors, ownId, labelMap).join('/');
}

function buildTagSegmentsWithOriginals(ancestors, ownId, labelMap) {
  const segments = ['life', 'eukaryota', 'plantae'];
  const originals = ['', '', ''];

  for (const a of ancestors) {
    if (a.id === ownId) continue;

    let label = a.label;
    if (label.startsWith('Q') && label.length > 1 && !isNaN(label.slice(1))) continue;

    if (label.startsWith('super')) continue;

    const originalLabel = label;
    const mapped = labelMap[label] ?? labelMap[label.toLowerCase()];
    if (mapped === null) continue;
    if (mapped) label = mapped;

    const rank = a.rankLabel;
    if (rank && (SKIP_RANKS.has(rank) || rank.startsWith('sub') || rank === 'domain')) {
      if (!mapped) continue;
    }

    const seg = label.toLowerCase().replace(/\s+/g, '_');
    if (segments[segments.length - 1] !== seg) {
      segments.push(seg);
      originals.push(originalLabel);
    }
  }

  return { segments, originals };
}

function buildWikipediaUrl(entity) {
  return entity.wikipediaUrl || null;
}

function stripArticle(name) {
  return name.replace(/^(the|a|an|and|just|simply)\s+/i, '').trim();
}

function buildAliases(entity) {
  const aliases = [];
  if (entity.commonNames && entity.commonNames.length > 0) {
    const seen = new Set();
    for (const name of entity.commonNames) {
      const normalized = stripArticle(name);
      const lower = normalized.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        aliases.push(normalized);
      }
    }
  }
  if (entity.aliases && entity.aliases.length > 0) {
    const lowerAliases = aliases.map(a => a.toLowerCase());
    for (const alias of entity.aliases) {
      if (!lowerAliases.includes(alias.toLowerCase()) && alias.toLowerCase() !== entity.scientificName.toLowerCase()) {
        aliases.push(alias);
      }
    }
  }
  return aliases.length > 0 ? aliases : null;
}

module.exports = {
  buildTag,
  buildTagSegments,
  buildTagSegmentsWithOriginals,
  buildWikipediaUrl,
  buildAliases
};
