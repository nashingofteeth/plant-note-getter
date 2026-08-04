const { PLANT_TAG_BASE } = require('./utils');
const { buildAliases } = require('./names');
const { SKIP_RANKS } = require('./ranks');

function buildTagSegments(ancestors, ownId, labelMap) {
  const injections = labelMap._inject || {};
  const segments = [...PLANT_TAG_BASE];

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

    if (injections[seg]) {
      for (const inj of injections[seg]) {
        if (!segments.includes(inj)) {
          segments.push(inj);
        }
      }
    }

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
  const injections = labelMap._inject || {};
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

module.exports = {
  buildTag,
  buildTagSegments,
  buildTagSegmentsWithOriginals,
  buildAliases
};