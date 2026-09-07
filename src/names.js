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

async function collectCommonNames(entity, candidateEntities, { reviewDecision } = {}) {
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
  if (wikiArticle) {
    if (!entity.wikipediaTitle || entity.wikipediaTitle !== wikiArticle.wikipediaTitle) {
      entity.wikipediaTitle = wikiArticle.wikipediaTitle;
    }
    if (!entity.wikipediaUrl) {
      entity.wikipediaUrl = wikiArticle.wikipediaUrl;
    }
    // End-of-Wikipedia LLM review (Wikipedia-only). Only runs when a
    // reviewDecision callback is supplied (app.js): without a human path
    // there is nothing to accept, so the LLM is not invoked at all. The
    // proposal is applied to the list and recorded in the review log only
    // when the callback accepts it; declined proposals leave the
    // deterministic list untouched and are not recorded.
    let wikiNamesRaw = wikiArticle.names || [];
    bySource.wikipediaBase = [...wikiNamesRaw];
    const config = require('./config');
    if (wikiArticle.extract && config.LLM_ENABLED && typeof reviewDecision === 'function') {
      const { getCompleter } = require('./llm-backend');
      const { reviewWikipediaNames } = require('./llm-reviewer');
      const { appendReviewRecord } = require('./review-log');
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
        const accepted = await reviewDecision({
          taxon: entity.scientificName || entity.wikipediaTitle,
          rank: entity.rankLabel,
          baseNames: bySource.wikipediaBase,
          added: reviewed.added,
          removed: reviewed.removed
        });
        if (accepted) {
          wikiNamesRaw = reviewed.names;
          bySource.llmAdded = [...reviewed.added];
          bySource.llmRemoved = reviewed.removed.map((r) => r.name);
          appendReviewRecord(
            {
              taxon: entity.scientificName || entity.wikipediaTitle,
              wikipediaTitle: wikiArticle.wikipediaTitle,
              date: new Date().toISOString(),
              extract: wikiArticle.extract.slice(0, 2000),
              extractLength: wikiArticle.extract.length,
              baseNames: bySource.wikipediaBase,
              llmAdded: reviewed.added,
              llmRemoved: reviewed.removed
            },
            config.REVIEW_LOG_PATH
          );
        }
      }
    }
    const wikiSeen = new Set();
    for (const name of wikiNamesRaw) {
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
    bySource.wikipedia = [...wikiNamesRaw];
  }

  return { names: buildAliases(entity), bySource };
}

module.exports = {
  buildAliases,
  collectCommonNames,
  resolveWikipediaArticle
};
