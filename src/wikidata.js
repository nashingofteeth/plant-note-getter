const https = require('https');
const http = require('http');

function stripArticle(name) {
  return name.replace(/^(the|a|an|and|or|just|simply)\s+/i, '').trim();
}

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const GBIF_API = 'https://api.gbif.org/v1/species';
const USER_AGENT = 'plant-note-getter/1.0.0 (https://github.com/nashingofteeth/plant-note-getter)';

let lastRequestTime = 0;
const MIN_INTERVAL = 600;

async function rateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_INTERVAL - elapsed));
  }
  lastRequestTime = Date.now();
}

function fetchJSON(url, body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const transport = isHttps ? https : http;
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: body ? 'POST' : 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
      }
    };
    if (body) {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : new URLSearchParams(body).toString());
    }
    req.end();
  });
}

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
      const sparqlData = await fetchJSON(`${SPARQL_ENDPOINT}?${new URLSearchParams({ query, format: 'json' })}`);
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

function getLabel(labels) {
  if (labels?.en?.value) return labels.en.value;
  if (labels?.mul?.value) return labels.mul.value;
  if (labels?.sla?.value) return labels.sla.value;
  return null;
}

async function getEntityData(id) {
  await rateLimit();
  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: id,
    props: 'claims|aliases|sitelinks|labels|descriptions',
    languages: 'en|mul',
    format: 'json'
  });
  const data = await fetchJSON(`${WIKIDATA_API}?${params}`);
  const entity = data.entities?.[id];
  if (!entity) return null;

  const claims = entity.claims || {};

  const rankId = claims.P105?.[0]?.mainsnak?.datavalue?.value?.id;
  let rankLabel = RANK_LABELS[rankId] || null;
  if (!rankLabel && rankId) {
    rankLabel = rankId;
  }

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
        const parts = val.text.replace(/\.+$/, '').split(/\s*,\s*/);
        for (const part of parts) {
          const trimmed = part.trim().replace(/\.+$/, '');
          if (trimmed) commonNames.push(trimmed);
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

const RANK_PREFERENCE = [
  'kingdom', 'phylum', 'division', 'class', 'order', 'family', 'genus', 'species',
  'superkingdom', 'superphylum', 'superclass', 'superorder', 'superfamily'
];

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

async function getParentChain(id) {
  await rateLimit();
  const query = `SELECT ?taxon ?taxonLabel ?rank ?rankLabel ?parent WHERE {
  wd:${id} wdt:P171* ?taxon.
  OPTIONAL { ?taxon wdt:P105 ?rank. }
  OPTIONAL { ?taxon wdt:P171 ?parent. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}`;
  const data = await fetchJSON(`${SPARQL_ENDPOINT}?${new URLSearchParams({ query, format: 'json' })}`);
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

  return chain;
}

async function fetchGbifCommonNames(gbifId) {
  if (!gbifId) return [];

  await rateLimit();
  const url = `${GBIF_API}/${encodeURIComponent(gbifId)}/vernacularNames?limit=100`;
  const data = await fetchJSON(url);

  const nonEnglishNames = new Set();
  for (const r of data.results || []) {
    if (r.language === 'eng' || !r.vernacularName) continue;
    nonEnglishNames.add(stripArticle(r.vernacularName).toLowerCase());
  }

  const names = [];
  const seen = new Set();
  for (const r of data.results || []) {
    if (r.language !== 'eng') continue;
    if (!r.vernacularName) continue;
    const clean = r.vernacularName.replace(/\s*\[.*?\]\s*/g, ' ').replace(/,?\s+(?:or|and)\s+/gi, ', ').trim();
    const parts = clean.split(/\s*,\s*/).filter(Boolean);
    for (const name of parts) {
      const normalized = stripArticle(name);
      if (!normalized) continue;
      const lower = normalized.toLowerCase();
      if (nonEnglishNames.has(lower)) continue;
      if (!seen.has(lower)) {
        seen.add(lower);
        names.push(normalized);
      }
    }
  }

  if (names.length > 0) {
    console.log(`  [gbif] common names: ${names.join(', ')}`);
  }

  return names;
}

const WIKIPEDIA_MEDIAWIKI_API = 'https://en.wikipedia.org/w/api.php';

const WIKI_PATTERNS = [
  // A: Parenthetical: "ScientificName (name1, name2, or name3) is/are/was/were..."
  // Only match within first 100 chars to avoid mid-text parentheticals like "(nuts)"
  (text) => {
    const m = text.match(/^[^(]{1,100}\(([^)]+)\)\s+(?:is|are|was|were|has|have|refers)\b/i);
    return m || null;
  },

  // J: "ScientificName or commonName is/are..." (no commas, e.g., "Abies balsamea or balsam fir is...")
  (text) => text.match(/^[A-Z][a-z]+\s+[a-z]+\s+or\s+(.+?)\s+(?:is|are|was|were|has|have)\b/i),

  // B: Appositive with article: "ScientificName, the/a/an names list, is/are..."
  // Handle both "names, is" and "names is" (no comma before verb)
  // Use negative lookbehind to reject relative clause fragments ending in
  // "which" or "that" (e.g., "the fruit of which is")
  (text) => text.match(/^[^,]{1,100},\s+(?:the|a|an)\s+(.+?)(?<!\b(?:which|that))\s*,?\s+(?:is|are|was|were|has|have)\b/i),

  // C: Appositive without article: "ScientificName, commonName, is/are..."
  // NOT preceded by "the", "a", or "an"
  // Lazy non-period capture to support comma-separated name lists
  (text) => text.match(/^[^,]+,\s+(?!(?:the|a|an)\s)([^.]+?),\s+(?:is|are|was|were|has|have)\b/i),

  // D: "known as" / "commonly known as" / "also known as"
  // Lazy capture, non-period chars to prevent crossing sentence boundaries
  (text) => text.match(/(?:commonly\s+|also\s+)?known\s+(?:commonly\s+)?as\s+([^.]+?),\s+(?:is|are|was|were|has|have|refers)\b/i),

  // K: "known as X. It/They is/are" — verb in next sentence (e.g., "known as X, or Y. It is")
  (text) => text.match(/(?:commonly\s+|also\s+)?known\s+(?:commonly\s+)?as\s+([^.]+)\.\s+(?:It|They)\s+(?:is|are|was|were)\b/i),

  // L: "where it is called X" at end of sentence (e.g., "where it is called tsuwabuki (石蕗).")
  (text) => text.match(/where\s+it\s+is\s+called\s+(.+?)\.(?:\s+[A-Z]|\s*$)/i),

  // E: "also/often/sometimes/commonly called"
  (text) => text.match(/(?:also|often|sometimes|commonly)\s+called\s+(.+),\s+(?:is|are|was|were|has|have)\b/i),

  // F: "Common names include/are" / "Other common names include/are"
  // Lazy match to stop at the first sentence-ending period
  (text) => text.match(/(?:other\s+)?common\s+names\s+(?:for\s+\S+\s+)?(?:include|are)\s+(.+?)\.(?:\s+[A-Z]|$)/i),

  // G: "English/vernacular names variously applied/include"
  (text) => text.match(/(?:english|vernacular)\s+names\b[\s\S]*?include\s+(.+?)\.(?:\s+[A-Z]|$)/i),

  // H: "known by the common names X, Y, and Z"
  (text) => text.match(/known by the common names\s+(.+?)\.(?:\s+[A-Z]|$)/i),

  // I: "also/commonly known as/called X, Y, and Z, and is/are..." (second+ paragraph constructions)
  // Constrain to current sentence — don't cross period boundaries
  (text) => {
    const clean = text.replace(/\n+/g, ' ');
    const m = clean.match(/(?:also|commonly)\s+(?:known\s+as|called)\s+([^.;]+?),\s+and\s+(?:is|are|was|were|has|have)\b/i);
    return m || null;
  },
];

function extractNamesFromCapture(captured) {
  const names = [];
  const seen = new Set();

  let segment = captured;

  // Strip introductory prefixes like "commonly known as", "also known as", "also called"
  segment = segment.replace(/^(?:commonly\s+)?(?:also\s+)?(?:(?:known\s+(?:commonly\s+)?as)|(?:also\s+)?called)\s+/i, '');

  // Remove bracketed content: (pronunciation), [...], etc.
  segment = segment.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '');
  // Strip leading/trailing non-word chars
  segment = segment.trim().replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, '');

  // Split on semicolons and take the part before any synonym mention
  const semiParts = segment.split(';');
  segment = semiParts[0];
  for (let i = 1; i < semiParts.length; i++) {
    if (/^\s*syn/i.test(semiParts[i])) break;
    segment += ';' + semiParts[i];
  }

  // Replace "and", "or" (with or without adjacent commas) with commas
  // Use word boundaries to avoid matching inside words like "oregano" or "andromeda"
  segment = segment.replace(/,?\s+\b(?:and|or)\b\s*,?\s*/gi, ',');
  // Clean up double commas and comma-whitespace
  segment = segment.replace(/\s*,\s*,/g, ',').replace(/,\s*,/g, ',').trim();

  for (const raw of segment.split(/\s*[,;]\s*/)) {
    let name = raw.replace(/^["'\u201C\u201D\s]+|["'\u201C\u201D\s.,;:]+$/g, '').trim();
    if (!name) continue;

    // Strip leading "common name", "common names", "vernacular name" etc.
    name = name.replace(/^(?:common|vernacular|local)\s+names?\s*/i, '').trim();
    if (!name) continue;

    // Strip "also called", "also known as" from individual segments
    name = name.replace(/^(?:also|commonly|often|sometimes)\s+(?:called|known\s+as)\s+/i, '').trim();
    if (!name) continue;

    // Skip "syn. " prefixed names (taxonomic synonym notation, not common names)
    if (/^syn\.\s+/i.test(name)) continue;

    // Skip "botanical name", "scientific name" labels (these introduce the scientific name, not a common name)
    if (/^(?:botanical|scientific)\s+name\s+/i.test(name)) continue;

    // Skip if over 5 words (likely not a common name)
    if (name.split(/\s+/).length > 5) continue;

    // Strip leading "as" (from "known as" constructions)  
    let normalized = name.replace(/^as\s+/i, '').trim();
    normalized = stripArticle(normalized);

    // Strip trailing language qualifiers like "in Greek", "in Latin"
    normalized = normalized.replace(/\s+in\s+(?:greek|latin|french|spanish|italian|german|portuguese|dutch|turkish|russian|polish|czech|swedish|danish|norwegian|finnish|hungarian|romanian|ukrainian|bulgarian|croatian|serbian|slovak|slovenian|lithuanian|latvian|estonian|icelandic|irish|welsh|gaelic|basque|catalan|arabic|hebrew|persian|hindi|urdu|bengali|tamil|telugu|kannada|malayalam|chinese|japanese|korean|vietnamese|thai|burmese|khmer|indonesian|malay|tagalog|swahili|zulu|hausa|yoruba|amharic|georgian|armenian|azerbaijani|kazakh|nepali|sinhala|tibetan|mongolian|english|native)\s*$/i, '').trim();

    if (!normalized) continue;

    // Skip label-value pairs (e.g. "simplified Chinese: 三角枫", "pinyin: sānjiǎofēng")
    if (/^[\w\s]+:/.test(normalized)) continue;

    // Skip pure rank terms
    if (/^(species|subgenus|genus|family|order|class|phylum|kingdom|variety|subspecies|hybrid|cultivar|form|type)$/i.test(normalized)) continue;

    const lower = normalized.toLowerCase();

    // Skip stopwords
    if (/^(or|and|the|in|of|for|a|an|is|are|was|were|with|by|on|at|its|their|this|that|these|those)$/i.test(lower)) continue;

    // Skip filler starts and descriptive phrases
    if (/^(primarily|especially|particularly|usually|typically|including|such\s+as|e\.g\.|i\.e\.|sometimes|called|known|commonly|among|which|where|when|less)\b/i.test(lower)) continue;
    if (/^(among\s+(?:many|other)|more\s+commonly)/i.test(lower)) continue;

    // Skip if it looks like a scientific name (e.g. "R. eglanteria")
    if (/^[A-Z]\.\s+[a-z]+/.test(normalized)) continue;
    if (/^[A-Z][a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+/.test(normalized) && !normalized.includes('-')) continue;
    if (normalized.split(/\s+/).length >= 3 && /^[A-Z][a-z]*\./.test(normalized)) continue;

    // Skip names with numeric digits or standalone abbreviations
    if (/\d/.test(lower)) continue;

    // Skip generic food/plant terms that aren't meaningful common names
    if (/^(nuts?|seeds?|fruit|leaves|flowers?|bark|wood|roots?|oil|tree|shrub|herb|plant|weeds?|berries?)$/i.test(normalized)) continue;

    if (!seen.has(lower)) {
      seen.add(lower);
      names.push(normalized);
    }
  }
  return names;
}

async function fetchWikipediaCommonNames(wikipediaTitle) {
  if (!wikipediaTitle) return [];

  await rateLimit();
  const url = `${WIKIPEDIA_MEDIAWIKI_API}?action=query&prop=extracts&exintro=&explaintext=&titles=${encodeURIComponent(wikipediaTitle)}&format=json`;
  const data = await fetchJSON(url);
  const pages = data?.query?.pages;
  if (!pages) return [];
  const extract = Object.values(pages)[0]?.extract;
  if (!extract) return [];

  const names = [];
  const seen = new Set();
  for (let pi = 0; pi < WIKI_PATTERNS.length; pi++) {
    const m = WIKI_PATTERNS[pi](extract);
    if (!m) continue;
    const captured = m[1];
    const extracted = extractNamesFromCapture(captured);
    for (const name of extracted) {
      const lower = name.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        names.push(name);
      }
    }
  }

  if (names.length > 0) {
    console.log(`  [wikipedia] common names: ${names.join(', ')}`);
  }

  return names;
}

const RANK_LABELS = {
  Q36732: 'kingdom',
  Q24017465: 'division',
  Q30097924: 'class',
  Q36602: 'order',
  Q35409: 'family',
  Q34740: 'genus',
  Q7432: 'species',
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
  const seen = new Set(mergedCommonNames.map(n => n.toLowerCase()));
  const existingAliasLower = new Set((primaryEntity.aliases || []).map(a => a.toLowerCase()));
  const synonymNames = [];
  let wikipediaUrl = primaryEntity.wikipediaUrl;
  let synonymCount = 0;
  let newCommonCount = 0;
  let wikiFromSynonym = false;

  if (!candidateEntities?.length) {
    return { wikipediaUrl, commonNames: mergedCommonNames, synonymNames };
  }

  for (const candidate of candidateEntities) {
    if (candidate.id === primaryEntity.id) continue;
    if (!isSynonymOf(primaryEntity, candidate)) continue;

    synonymCount++;

    for (const name of (candidate.commonNames || [])) {
      const normalized = stripArticle(name);
      const lower = normalized.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        mergedCommonNames.push(normalized);
        newCommonCount++;
      }
    }

    const synName = candidate.scientificName || candidate.label;
    if (synName) {
      const lower = synName.toLowerCase();
      if (!seen.has(lower) && !existingAliasLower.has(lower) && lower !== (primaryEntity.scientificName || '').toLowerCase()) {
        synonymNames.push(synName);
        existingAliasLower.add(lower);
      }
    }

    if (!wikipediaUrl && candidate.wikipediaUrl) {
      wikipediaUrl = candidate.wikipediaUrl;
      wikiFromSynonym = true;
    }
  }

  if (synonymCount > 0) {
    const parts = [];
    if (wikiFromSynonym) parts.push('wikipedia');
    if (newCommonCount > 0) parts.push(`${newCommonCount} common name(s)`);
    if (synonymNames.length > 0) parts.push(`${synonymNames.length} synonym name(s)`);
    console.log(`  [synonyms] ${synonymCount} verified synonym(s) contributed: ${parts.join(', ')}`);
  }

  return { wikipediaUrl, commonNames: mergedCommonNames, synonymNames };
}

function extractWikipediaCommonNames(text) {
  const names = [];
  const seen = new Set();
  for (let pi = 0; pi < WIKI_PATTERNS.length; pi++) {
    const m = WIKI_PATTERNS[pi](text);
    if (!m) continue;
    const captured = m[1];
    const extracted = extractNamesFromCapture(captured);
    for (const name of extracted) {
      const lower = name.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        names.push(name);
      }
    }
  }
  return names;
}

module.exports = {
  searchTaxon,
  getEntityData,
  getParentChain,
  isSynonymOf,
  collectSynonymData,
  fetchGbifCommonNames,
  fetchWikipediaCommonNames,
  extractNamesFromCapture,
  extractWikipediaCommonNames,
  stripArticle
};
