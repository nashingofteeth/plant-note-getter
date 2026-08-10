const { fetchJSON, rateLimit, GBIF_API, WIKIPEDIA_MEDIAWIKI_API } = require('./api-client');
const { stripArticle, normalizeNameKey } = require('./utils');
const { parseGbifVernacularName, extractWikipediaCommonNames } = require('./wiki-extract');

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
    for (const normalized of parseGbifVernacularName(r.vernacularName)) {
      const dedupKey = normalizeNameKey(normalized);
      if (!seen.has(dedupKey)) {
        seen.add(dedupKey);
        names.push(normalized);
      }
    }
  }

  return names;
}

async function fetchWikipediaCommonNames(wikipediaTitle) {
  if (!wikipediaTitle) return [];

  await rateLimit();
  const url = `${WIKIPEDIA_MEDIAWIKI_API}?action=query&prop=extracts&explaintext=&redirects=&titles=${encodeURIComponent(wikipediaTitle)}&format=json`;
  const data = await fetchJSON(url);
  const pages = data?.query?.pages;
  if (!pages) return [];
  const extract = Object.values(pages)[0]?.extract;
  if (!extract) return [];

  return extractWikipediaCommonNames(extract);
}

module.exports = {
  fetchGbifCommonNames,
  fetchWikipediaCommonNames
};
