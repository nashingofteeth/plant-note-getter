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

async function collectCommonNames(entity, candidateEntities) {
  const synonymData = await collectSynonymData(entity, candidateEntities);
  entity.wikipediaUrl = synonymData.wikipediaUrl;
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

  let wikiNamesRaw = [];
  if (entity.wikipediaTitle) {
    wikiNamesRaw = await commonNamesModule.fetchWikipediaCommonNames(entity.wikipediaTitle);
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
  collectCommonNames
};
