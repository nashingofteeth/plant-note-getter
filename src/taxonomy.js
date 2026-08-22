const { PLANT_TAG_BASE } = require('./utils');
const { buildAliases } = require('./names');
const { SKIP_RANKS, RANK_BREADTH } = require('./ranks');
const { guardSegments, findRankInversions, findExclusiveCladeViolations } = require('./taxonomy-guard');

// Walk the ancestor chain, applying label-map remaps/injections/rank-skips and
// per-taxon parent-chain overrides. Returns the final segments and the
// per-segment original labels (injected/override segments reuse their
// canonical label).
function buildTagSegmentsRaw(ancestors, ownId, labelMap) {
  const injections = labelMap._inject || {};
  const overrides = labelMap._overrides || {};
  const segments = [...PLANT_TAG_BASE];
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

    // Per-taxon parent-chain override: replace the whole lineage accumulated so
    // far with an explicit canonical path. Used to work around known-bad
    // Wikidata P171 chains (e.g. Maianthemum routed through Solanaceae,
    // Sciadopitys through equisetophyta/cupressales). The value is the full
    // path from the base up to and including this taxon; processing continues
    // so narrower ancestors (genus, species) still append.
    const override = overrides[seg];
    if (override) {
      const path = [...PLANT_TAG_BASE, ...override];
      const pathOriginals = [...PLANT_TAG_BASE.map(() => ''), ...override];
      segments.length = 0;
      segments.push(...path);
      originals.length = 0;
      originals.push(...pathOriginals);
      continue;
    }

    if (injections[seg]) {
      for (const inj of injections[seg]) {
        if (!segments.includes(inj)) {
          segments.push(inj);
          originals.push(inj);
        }
      }
    }

    if (segments[segments.length - 1] !== seg) {
      segments.push(seg);
      originals.push(originalLabel);
    }
  }

  return { segments, originals };
}

// Rank-monotonicity guard: a narrower rank appearing after a broader one means
// a broken P171 link. Drop the offending ancestor and warn.
function applyRankGuard(ancestors, ownId, labelMap) {
  const inversions = findRankInversions(ancestors);
  if (!inversions.length) return ancestors;
  const badIds = new Set(inversions.map(a => a.id));
  console.warn(
    `\n[guard] Rank inversion in taxonomy chain: dropping "${inversions
      .map(a => a.label)
      .join('", "')}". This usually indicates bad Wikidata P171 data.`
  );
  return ancestors.filter(a => a.id === ownId || !badIds.has(a.id));
}

function buildTagSegments(ancestors, ownId, labelMap) {
  const cleaned = applyRankGuard(ancestors, ownId, labelMap);
  const { segments } = buildTagSegmentsRaw(cleaned, ownId, labelMap, 'clean');
  return guardSegments(segments);
}

function buildTag(ancestors, ownId, labelMap) {
  return buildTagSegments(ancestors, ownId, labelMap).join('/');
}

function buildTagSegmentsWithOriginals(ancestors, ownId, labelMap) {
  const cleaned = applyRankGuard(ancestors, ownId, labelMap);
  const { segments, originals } = buildTagSegmentsRaw(cleaned, ownId, labelMap, 'withOriginals');

  const clade = findExclusiveCladeViolations(segments);
  if (clade.violations.length) {
    console.warn(
      `\n[guard] Conflicting major clades in taxonomy chain: kept "${clade.chosenClade}", ` +
      `dropped "${clade.violations.join('", "')}". This usually indicates bad Wikidata P171 data.`
    );
  }
  const drop = new Set(clade.violations);
  const filteredSegments = segments.filter(s => !drop.has(s));
  const filteredOriginals = originals.filter((_, i) => !drop.has(segments[i]));

  return { segments: filteredSegments, originals: filteredOriginals };
}

module.exports = {
  buildTag,
  buildTagSegments,
  buildTagSegmentsWithOriginals,
  buildAliases
};