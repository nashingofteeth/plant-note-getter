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

  let names = extractWikipediaCommonNames(extract);

  // Hybrid LLM reviewer (advisory second pass). Lazy requires keep module
  // load cheap and allow tests to stub fetchWikipediaCommonNames offline.
  const config = require('./config');
  if (config.LLM_ENABLED) {
    const { getCompleter } = require('./llm-backend');
    const { reviewExtractWikipediaNames } = require('./llm-reviewer');
    const { appendReviewRecord } = require('./review-log');

    const completer = await getCompleter();
    const { names: reviewed, trace } = await reviewExtractWikipediaNames(extract, {
      completer,
      maxInputChars: config.LLM_MAX_INPUT_CHARS,
      gate: config.LLM_GATE,
      rejectEnabled: config.LLM_REJECT_ENABLED,
      rejectMax: config.LLM_REJECT_MAX
    });
    if (
      (trace.kept && trace.kept.length) ||
      (trace.removals && trace.removals.length)
    ) {
      names = reviewed;
    }

    const hasCatches = trace.catches && trace.catches.length;
    const hasDrops = trace.dropped && trace.dropped.length;
    const hasRemovals = trace.removals && trace.removals.length;
    if (config.REVIEW_LOG_ALL || hasCatches || hasDrops || hasRemovals) {
      appendReviewRecord(
        {
          taxon: wikipediaTitle,
          wikipediaTitle,
          date: new Date().toISOString(),
          extract,
          baseNames: extractWikipediaCommonNames(extract),
          llmAdded: trace.kept || [],
          catches: trace.catches || [],
          dropped: trace.dropped || [],
          llmRemoved: trace.removals || []
        },
        config.REVIEW_LOG_PATH
      );
    }
  }

  return names;
}

module.exports = {
  fetchGbifCommonNames,
  fetchWikipediaCommonNames
};
