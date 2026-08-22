// Guards against biologically impossible / internally inconsistent taxonomy
// chains. These run on the canonical tag segments and the raw ancestor chain
// so that corrupted Wikidata P171 data cannot silently produce a wrong note tag.

const { RANK_BREADTH } = require('./ranks');

// Mutually exclusive major clades. No single taxon's chain may contain more
// than one member of any of these groups (a plant cannot be both a monocot and
// an eudicot, nor both an angiosperm and a gymnosperm).
const EXCLUSIVE_CLADE_GROUPS = [
  ['angiosperms', 'gymnospermae'],
  ['monocots', 'eudicots', 'magnoliids', 'dicots'],
];

const MAJOR_CLADE_INDEX = {};
for (const group of EXCLUSIVE_CLADE_GROUPS) {
  for (const name of group) MAJOR_CLADE_INDEX[name] = group;
}

// Return the canonical segments belonging to clades that conflict with the
// first (lowest, most specific) major clade present in the chain. Each mutually
// exclusive group is tracked independently (e.g. a chain may legitimately
// contain both `angiosperms` and `eudicots`, but never two members of the
// monocots/eudicots/magnoliids group).
function findExclusiveCladeViolations(segments) {
  const chosen = {}; // group key -> first clade seen from that group
  const violations = [];
  for (const seg of segments) {
    const group = MAJOR_CLADE_INDEX[seg];
    if (!group) continue;
    const key = group.join('|');
    if (chosen[key] === undefined) {
      chosen[key] = seg;
    } else if (chosen[key] !== seg) {
      violations.push(seg);
    }
  }
  const chosenClade = Object.keys(chosen)
    .map(k => chosen[k])
    .filter(Boolean)
    .sort()
    .join(', ');
  return { chosenClade, violations };
}

// Chains are ordered broadest -> most specific (kingdom ... genus, species).
// Broad ranks (class and above) are often inconsistently named on Wikidata
// (division/subdivision interleaving), so we only treat a rank as an inversion
// once we have descended to a genuinely specific rank (order or finer): any
// subsequent rank broader than the previously seen specific rank means the P171
// link jumped back up the hierarchy.
function findRankInversions(ancestors) {
  let lastSpecific = Infinity;
  const inversions = [];
  for (const a of ancestors) {
    const b = RANK_BREADTH[a.rankLabel || ''];
    if (b === undefined) continue; // no rank / clade
    if (b <= 40) { // order or more specific
      if (b > lastSpecific) inversions.push(a);
      else lastSpecific = b;
    }
  }
  return inversions;
}

function guardSegments(segments) {
  const clade = findExclusiveCladeViolations(segments);
  if (clade.violations.length) {
    console.warn(
      `\n[guard] Conflicting major clades in taxonomy chain: kept "${clade.chosenClade}", ` +
      `dropped "${clade.violations.join('", "')}". This usually indicates bad Wikidata P171 data.`
    );
  }
  const keep = new Set(clade.violations);
  return segments.filter(s => !keep.has(s));
}

module.exports = {
  EXCLUSIVE_CLADE_GROUPS,
  findExclusiveCladeViolations,
  findRankInversions,
  guardSegments,
};
