const { stripArticle, isAbbreviatedBinomial, cleanName, normalizeNameKey } = require('./utils');
const { collectSynonymData } = require('./wikidata');
const commonNamesModule = require('./common-names-fetch');

function buildAliases(entity) {
  const aliases = [];
  if (entity.commonNames && entity.commonNames.length > 0) {
    const sciKey = normalizeNameKey(entity.scientificName || '');
    const seen = new Set();
    for (const name of entity.commonNames) {
      const normalized = stripArticle(name);
      if (isAbbreviatedBinomial(normalized)) continue;
      const key = normalizeNameKey(normalized);
      if (!seen.has(key) && key !== sciKey) {
        seen.add(key);
        aliases.push(normalized);
      }
    }
  }
  if (entity.aliases && entity.aliases.length > 0) {
    const aliasKeys = aliases.map(a => normalizeNameKey(a));
    for (const alias of entity.aliases) {
      const parts = alias.split(/\s*,\s*/);
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        if (isAbbreviatedBinomial(trimmed)) continue;
        const key = normalizeNameKey(trimmed);
        if (!aliasKeys.includes(key) && key !== normalizeNameKey(entity.scientificName || '')) {
          aliasKeys.push(key);
          aliases.push(trimmed);
        }
      }
    }
  }
  return aliases.length > 0 ? aliases : null;
}

async function resolveWikipediaArticle(entity) {
  const titles = [];
  if (entity.wikipediaTitle) titles.push(entity.wikipediaTitle);
  const sci = entity.scientificName || entity.label;
  if (sci) titles.push(sci);
  for (const title of titles) {
    const article = await commonNamesModule.fetchWikipediaArticle(title);
    if (article) return article;
  }
  return null;
}

async function collectCommonNames(entity, candidateEntities, { onReviewStart } = {}) {
  let finalizeReview = null; // set when the LLM proposes changes (deferred decision)
  const synonymData = await collectSynonymData(entity, candidateEntities);
  entity.wikipediaUrl = synonymData.wikipediaUrl;
  entity.wikipediaTitle = synonymData.wikipediaTitle;
  entity.commonNames = synonymData.commonNames;
  const bySource = {
    wikidata: [...(entity.commonNames || [])]
  };
  const entityWikidataAliases = [...(entity.aliases || [])];
  bySource.wikidataAliases = [...entityWikidataAliases];
  if (synonymData.synonymNames.length > 0) {
    entity.aliases = [...entityWikidataAliases, ...synonymData.synonymNames];
  }

  let gbifNamesRaw = [];
  const gbifId = entity.gbifId;
  if (gbifId) {
    gbifNamesRaw = await commonNamesModule.fetchGbifCommonNames(gbifId);
    const seenKeys = new Set(
      [...(entity.commonNames || []), ...(entity.aliases || [])].map(n => normalizeNameKey(n))
    );
    for (const name of gbifNamesRaw) {
      const normalized = cleanName(name);
      const key = normalizeNameKey(normalized);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        entity.commonNames.push(normalized);
      }
    }
    bySource.gbif = [...gbifNamesRaw];
  }

  const wikiArticle = await resolveWikipediaArticle(entity);
  // Merge a Wikipedia name list into entity.commonNames (dedup, casing-wins).
  const mergeWikipediaNames = (namesList) => {
    const wikiSeen = new Set();
    for (const name of namesList) {
      const normalized = cleanName(name);
      const key = normalizeNameKey(normalized);
      if (wikiSeen.has(key)) continue;
      wikiSeen.add(key);
      const existingIdx = (entity.commonNames || []).findIndex(n => normalizeNameKey(n) === key);
      if (existingIdx !== -1) {
        if (entity.commonNames[existingIdx] !== normalized) {
          entity.commonNames[existingIdx] = normalized;
        }
      } else {
        entity.commonNames.push(normalized);
      }
    }
  };
  if (wikiArticle) {
    if (!entity.wikipediaTitle || entity.wikipediaTitle !== wikiArticle.wikipediaTitle) {
      entity.wikipediaTitle = wikiArticle.wikipediaTitle;
    }
    if (!entity.wikipediaUrl) {
      entity.wikipediaUrl = wikiArticle.wikipediaUrl;
    }
    // End-of-Wikipedia LLM review (Wikipedia-only). Runs when enabled and
    // there is an extract; the proposal is stashed in bySource.llmProposal —
    // the working list stays deterministic. The caller decides via
    // finalizeReview(accepted): acceptance applies the diff to the merged
    // names (Wikipedia-sourced entries only — names corroborated by
    // Wikidata/GBIF are never removed), appends the review-log record, and
    // returns the recomputed aliases. Decline is a no-op and records
    // nothing.
    const wikiNamesRaw = wikiArticle.names || [];
    bySource.wikipediaBase = [...wikiNamesRaw];
    const config = require('./config');
    let pendingReview = null;
    if (wikiArticle.extract && config.LLM_ENABLED) {
      const { getCompleter } = require('./llm-backend');
      const { reviewWikipediaNames } = require('./llm-reviewer');
      const { appendReviewRecord } = require('./review-log');
      if (typeof onReviewStart === 'function') onReviewStart();
      const completer = await getCompleter();
      const reviewed = await reviewWikipediaNames(
        {
          extract: wikiArticle.extract,
          baseNames: wikiNamesRaw,
          taxon: entity.scientificName || entity.wikipediaTitle,
          rank: entity.rankLabel
        },
        { completer, maxInputChars: config.LLM_MAX_INPUT_CHARS }
      );
      if (reviewed.added.length || reviewed.removed.length) {
        pendingReview = {
          added: reviewed.added,
          removed: reviewed.removed,
          reviewedNames: reviewed.names,
          appendReviewRecord,
          config
        };
        bySource.llmProposal = {
          baseNames: [...bySource.wikipediaBase],
          added: [...reviewed.added],
          removed: reviewed.removed.map((r) => ({ name: r.name, category: r.category }))
        };
      }
    }
    mergeWikipediaNames(wikiNamesRaw);
    bySource.wikipedia = [...wikiNamesRaw];

    if (pendingReview) {
      const { added, removed, reviewedNames, appendReviewRecord, config: cfg } = pendingReview;
      const taxonName = entity.scientificName || entity.wikipediaTitle;
      finalizeReview = (accepted) => {
        if (accepted) {
          // Adds: same merge rules as the deterministic list.
          mergeWikipediaNames(added);
          // Removes: strip Wikipedia-sourced entries only — names
          // corroborated by Wikidata/GBIF survive.
          const protectedKeys = new Set(
            [
              ...(bySource.wikidata || []),
              ...(bySource.wikidataAliases || []),
              ...(bySource.gbif || [])
            ].map((n) => normalizeNameKey(n))
          );
          const removedKeys = new Set(removed.map((r) => normalizeNameKey(r.name)));
          entity.commonNames = entity.commonNames.filter(
            (n) => !(removedKeys.has(normalizeNameKey(n)) && !protectedKeys.has(normalizeNameKey(n)))
          );
          bySource.wikipedia = [...reviewedNames];
          bySource.llmAdded = [...added];
          bySource.llmRemoved = removed.map((r) => r.name);
          appendReviewRecord(
            {
              taxon: taxonName,
              wikipediaTitle: wikiArticle.wikipediaTitle,
              date: new Date().toISOString(),
              extract: wikiArticle.extract.slice(0, 2000),
              extractLength: wikiArticle.extract.length,
              baseNames: bySource.wikipediaBase,
              llmAdded: added,
              llmRemoved: removed
            },
            cfg.REVIEW_LOG_PATH
          );
        }
        return buildAliases(entity);
      };
    }
  }

  return { names: buildAliases(entity), bySource, finalizeReview };
}

module.exports = {
  buildAliases,
  collectCommonNames,
  resolveWikipediaArticle
};
