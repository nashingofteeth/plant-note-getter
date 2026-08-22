const { fetchJSON, fetchSparql, rateLimit, WIKIDATA_API, GBIF_API } = require('./api-client');
const { stripArticle, normalizeNameKey, TAXON_Q_IDS } = require('./utils');
const { RANK_LABELS, RANK_PREFERENCE } = require('./ranks');
const { askChoice } = require('./prompt');

const MAX_FALLBACK_DEPTH = 8;

const GBIF_MATCH_PARENT = {
  species: 'genus',
  nothospecies: 'genus',
  subspecies: 'species',
  subgenus: 'genus',
  genus: 'family',
  subfamily: 'family',
  tribe: 'subfamily',
  family: 'order',
  order: 'class',
  class: 'phylum',
  phylum: 'kingdom',
  kingdom: null
};

async function searchTaxon(name) {
  await rateLimit();
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: name,
    language: 'en',
    limit: 10,
    format: 'json'
  });
  const data = await fetchJSON(`${WIKIDATA_API}?${params}`);
  if (data.search && data.search.length > 0) {
    return data.search.map(item => ({
      id: item.id,
      label: item.label,
      description: item.description,
      match: item.match
    }));
  }

  console.log(`  No Wikidata results for '${name}', trying GBIF fallback...`);
  try {
    const gbifData = await fetchJSON(`${GBIF_API}/match?name=${encodeURIComponent(name)}`);
    if (gbifData && gbifData.usageKey && gbifData.matchType !== 'NONE') {
      const gbifId = gbifData.usageKey;
      const query = `SELECT ?item WHERE { ?item wdt:P846 "${gbifId}" }`;
      const sparqlData = await fetchSparql(`SELECT ?item WHERE { ?item wdt:P846 "${gbifId}" }`);
      if (sparqlData.results?.bindings?.length > 0) {
        const qId = sparqlData.results.bindings[0].item.value.split('/').pop();
        const labelData = await fetchJSON(`${WIKIDATA_API}?${new URLSearchParams({
          action: 'wbgetentities',
          ids: qId,
          props: 'labels',
          languages: 'en|mul',
          format: 'json'
        })}`);
        const label = labelData.entities?.[qId]?.labels?.en?.value || gbifData.canonicalName || name;
        console.log(`  GBIF fallback resolved to ${qId} (${label})`);
        return [{ id: qId, label, description: gbifData.canonicalName || null, match: { type: 'gbif_fallback' } }];
      }
    }
  } catch (e) {
    console.log(`  GBIF fallback failed: ${e.message}`);
  }

  return [];
}

async function resolveTaxon(input, selectIndex) {
  const results = await searchTaxon(input);

  if (results.length === 0) {
    throw new Error(`'${input}' not found on Wikidata`);
  }

  let selected = results[0];
  const entityCache = new Map();

  if (results.length > 1) {
    const entitiesMap = await getEntitiesData(results.map(r => r.id));
    for (const [id, entity] of entitiesMap) {
      entityCache.set(id, entity);
    }

    const taxonResults = [];
    for (const r of results) {
      const entity = entitiesMap.get(r.id);
      if (entity && entity.instanceOf.some(id => TAXON_Q_IDS.includes(id))) {
        taxonResults.push({ ...r, rankLabel: entity.rankLabel });
      }
    }

    if (taxonResults.length === 0) {
      throw new Error(`'${input}' found but no taxon results`);
    }

    if (taxonResults.length === 1) {
      selected = taxonResults[0];
      console.log(`  Using: ${selected.label} (${selected.rankLabel || 'taxon'})`);
    } else if (selectIndex !== undefined && selectIndex >= 0 && selectIndex < taxonResults.length) {
      selected = taxonResults[selectIndex];
      console.log(`  Selected [${selectIndex + 1}]: ${selected.label} (${selected.rankLabel || 'taxon'})`);
    } else {
      console.log(`  ${taxonResults.length} taxa found:\n`);
      const idx = await askChoice(taxonResults, 'Select taxon');
      selected = taxonResults[idx];
    }
  } else {
    console.log(`  Found: ${selected.label}`);
  }

  const entity = entityCache.get(selected.id) || await getEntityData(selected.id);
  if (!entity) {
    throw new Error(`Could not fetch data for ${selected.id}`);
  }

  if (!entity.instanceOf.some(id => TAXON_Q_IDS.includes(id))) {
    throw new Error(`'${input}' is not a taxon or clade on Wikidata`);
  }

  const candidateEntities = [...entityCache.values()].filter(e => e && e.id !== selected.id);

  return { selected, entity, candidateEntities };
}

function getLabel(labels) {
  if (labels?.en?.value) return labels.en.value;
  if (labels?.mul?.value) return labels.mul.value;
  if (labels?.sla?.value) return labels.sla.value;
  return null;
}

function parseEntity(id, entity) {
  if (!entity) return null;

  const claims = entity.claims || {};

  const rankId = claims.P105?.[0]?.mainsnak?.datavalue?.value?.id;
  let rankLabel = RANK_LABELS[rankId] || null;

  const parentIds = (claims.P171 || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);

  const instanceOf = (claims.P31 || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);

  const replacedSynonymIds = (claims.P694 || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
  const taxonSynonymIds = (claims.P1420 || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
  const synonymOfIds = (claims.P12763 || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
  const replacedSynonymOfIds = (claims.P12764 || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);

  const commonNames = [];
  if (claims.P1843) {
    for (const claim of claims.P1843) {
      const val = claim.mainsnak?.datavalue?.value;
      if (val?.language === 'en' || val?.language === 'en-ca' || val?.language === 'en-gb') {
        // Split on both commas and periods used as separators
        const parts = val.text.replace(/\.+$/, '').split(/\s*,\s*/);
        for (const part of parts) {
          for (const sub of part.split(/\.\s+/)) {
            const trimmed = sub.trim().replace(/\.+$/, '');
            if (trimmed) commonNames.push(trimmed);
          }
        }
      }
    }
  }

  const aliases = [];
  if (entity.aliases?.en) {
    for (const a of entity.aliases.en) {
      aliases.push(a.value);
    }
  }

  const scientificName = claims.P225?.[0]?.mainsnak?.datavalue?.value || getLabel(entity.labels) || id;

  const gbifId = claims.P846?.[0]?.mainsnak?.datavalue?.value || null;

  let wikipediaUrl = null;
  let wikipediaTitle = null;
  if (entity.sitelinks?.enwiki?.title) {
    wikipediaTitle = entity.sitelinks.enwiki.title;
    const title = wikipediaTitle.replace(/ /g, '_');
    wikipediaUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
  }

  const label = getLabel(entity.labels) || id;

  return {
    id,
    label,
    scientificName,
    rankId,
    rankLabel,
    parentIds,
    instanceOf,
    replacedSynonymIds,
    taxonSynonymIds,
    synonymOfIds,
    replacedSynonymOfIds,
    commonNames,
    aliases,
    gbifId,
    wikipediaUrl,
    wikipediaTitle
  };
}

async function getEntitiesData(ids) {
  if (!ids || ids.length === 0) return new Map();
  await rateLimit();
  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: ids.join('|'),
    props: 'claims|aliases|sitelinks|labels|descriptions',
    languages: 'en|mul',
    format: 'json'
  });
  const data = await fetchJSON(`${WIKIDATA_API}?${params}`);
  const map = new Map();
  for (const [id, raw] of Object.entries(data.entities || {})) {
    map.set(id, parseEntity(id, raw));
  }
  return map;
}

async function getEntityData(id) {
  const map = await getEntitiesData([id]);
  return map.get(id) || null;
}

function pickBestParent(parentIds, ancestorMap) {
  const valid = parentIds.filter(pid => ancestorMap.has(pid));
  if (valid.length === 0) return parentIds[0] || null;
  if (valid.length === 1) return valid[0];

  const ranked = valid.map(pid => {
    const a = ancestorMap.get(pid);
    const prefIndex = RANK_PREFERENCE.indexOf(a.rankLabel || '');
    return { id: pid, rank: prefIndex === -1 ? 999 : prefIndex };
  });
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked[0].id;
}

async function gbifFallback(id, depth) {
  let entity;
  try {
    entity = await getEntityData(id);
  } catch {
    return null;
  }
  if (!entity || !entity.scientificName) return null;

  let match;
  try {
    await rateLimit();
    match = await fetchJSON(`${GBIF_API}/match?name=${encodeURIComponent(entity.scientificName)}`);
  } catch {
    return null;
  }
  if (!match || match.matchType === 'NONE') return null;

  const ownRank = entity.rankLabel || 'species';
  const parentRankKey = GBIF_MATCH_PARENT[ownRank] || 'genus';
  if (!parentRankKey) return null;
  const parentName = match[parentRankKey];
  if (!parentName || typeof parentName !== 'string') return null;

  let results;
  try {
    results = await searchTaxon(parentName);
  } catch {
    return null;
  }
  if (!results || results.length === 0) return null;

  let parentEntity;
  try {
    parentEntity = await getEntityData(results[0].id);
  } catch {
    return null;
  }
  if (!parentEntity) return null;
  if (!parentEntity.instanceOf.some(x => TAXON_Q_IDS.includes(x))) return null;

  return getParentChain(parentEntity.id, depth + 1);
}

async function getParentChain(id, depth = 0) {
  await rateLimit();
  const query = `SELECT ?taxon ?taxonLabel ?rank ?rankLabel ?parent WHERE {
  wd:${id} wdt:P171* ?taxon.
  OPTIONAL { ?taxon wdt:P105 ?rank. }
  OPTIONAL { ?taxon wdt:P171 ?parent. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}`;
  const data = await fetchSparql(query);
  const bindings = data.results?.bindings || [];

  const ancestors = new Map();
  for (const b of bindings) {
    const tid = b.taxon?.value?.split('/').pop();
    if (!tid) continue;
    if (!ancestors.has(tid)) {
      ancestors.set(tid, {
        id: tid,
        label: b.taxonLabel?.value || tid,
        rankId: b.rank?.value?.split('/').pop() || null,
        rankLabel: b.rankLabel?.value || null,
        parentIds: new Set()
      });
    }
    if (b.parent) {
      const pid = b.parent.value.split('/').pop();
      if (pid && pid !== tid) {
        ancestors.get(tid).parentIds.add(pid);
      }
    }
  }

  const chain = [];
  const visited = new Set();
  let currentId = id;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const info = ancestors.get(currentId);
    if (!info) break;

    chain.unshift({
      id: info.id,
      label: info.label,
      rankId: info.rankId,
      rankLabel: info.rankLabel
    });

    const validParents = [...info.parentIds].filter(pid => ancestors.has(pid));
    if (validParents.length === 0) break;
    currentId = validParents.length === 1 ? validParents[0] : pickBestParent(validParents, ancestors);
  }

  if (chain.length <= 1 && depth < MAX_FALLBACK_DEPTH) {
    const fallback = await gbifFallback(id, depth);
    if (fallback && fallback.length > chain.length) return fallback;
  }

  return chain;
}

function isSynonymOf(primaryEntity, candidateEntity) {
  if (!primaryEntity || !candidateEntity) return false;
  if ((primaryEntity.taxonSynonymIds || []).includes(candidateEntity.id)) return true;
  if ((primaryEntity.replacedSynonymOfIds || []).includes(candidateEntity.id)) return true;
  if ((candidateEntity.synonymOfIds || []).includes(primaryEntity.id)) return true;
  if ((candidateEntity.replacedSynonymIds || []).includes(primaryEntity.id)) return true;

  const primaryName = (primaryEntity.scientificName || primaryEntity.label || '').toLowerCase();
  if (candidateEntity.wikipediaTitle && candidateEntity.wikipediaTitle.replace(/_/g, ' ').toLowerCase() === primaryName) return true;

  return false;
}

async function collectSynonymData(primaryEntity, candidateEntities) {
  const mergedCommonNames = [...(primaryEntity.commonNames || [])];
  const seen = new Set(mergedCommonNames.map(n => normalizeNameKey(n)));
  const existingAliasKeys = new Set((primaryEntity.aliases || []).map(a => normalizeNameKey(a)));
  const synonymNames = [];
  let wikipediaUrl = primaryEntity.wikipediaUrl;
  let wikipediaTitle = primaryEntity.wikipediaTitle;

  if (!candidateEntities?.length) {
    return { wikipediaUrl, wikipediaTitle, commonNames: mergedCommonNames, synonymNames };
  }

  for (const candidate of candidateEntities) {
    if (candidate.id === primaryEntity.id) continue;
    if (!isSynonymOf(primaryEntity, candidate)) continue;

    for (const name of (candidate.commonNames || [])) {
      const normalized = stripArticle(name);
      const key = normalizeNameKey(normalized);
      if (!seen.has(key)) {
        seen.add(key);
        mergedCommonNames.push(normalized);
      }
    }

    const synName = candidate.scientificName || candidate.label;
    if (synName) {
      const key = normalizeNameKey(synName);
      if (!seen.has(key) && !existingAliasKeys.has(key) && key !== normalizeNameKey(primaryEntity.scientificName || '')) {
        synonymNames.push(synName);
        existingAliasKeys.add(key);
      }
    }

    if (!wikipediaUrl && candidate.wikipediaUrl) {
      wikipediaUrl = candidate.wikipediaUrl;
    }

    if (!wikipediaTitle && candidate.wikipediaTitle) {
      wikipediaTitle = candidate.wikipediaTitle;
    }
  }

  return { wikipediaUrl, wikipediaTitle, commonNames: mergedCommonNames, synonymNames };
}

module.exports = {
  searchTaxon,
  resolveTaxon,
  getEntityData,
  getParentChain,
  isSynonymOf,
  collectSynonymData
};
