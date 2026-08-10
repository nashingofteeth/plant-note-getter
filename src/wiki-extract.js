const { stripArticle } = require('./utils');

// Parse a single GBIF vernacular-name string into zero or more common names.
function parseGbifVernacularName(raw) {
  if (!raw) return [];
  const clean = raw.replace(/\s*\[.*?\]\s*/g, ' ').trim();
  return clean
    .split(/\s*,\s*/)
    .filter(Boolean)
    .map(stripArticle)
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// RECONSTRUCTION TASK FOR FUTURE AGENT
// ─────────────────────────────────────────────────────────────────────────────
// The two functions below are intentional blank stubs. The previous extraction
// implementation was removed in full and must be rebuilt from the ground up.
//
// Behavioural contract (the only spec that matters):
//   - `extractWikipediaCommonNames(text)`  text in -> string[]
//     Plain-text Wikipedia article body in; complete, deduplicated list of the
//     common/vernacular names the article applies to its subject out. Empty
//     array when nothing qualifies.
//   - `extractNamesFromCapture(captured)`  string -> string[]
//     A passage of text that names the subject in; the clean list of names it
//     contains, with explanatory, descriptive, and scientific-name content
//     removed.
//
// Requirements:
//   1. The behavioural spec is defined by the test suites in
//      test/common-names.test.js and test/wikidata.test.js (hardcoded inputs,
//      no API calls). Drive the rebuild from those assertions; the failing
//      cases are the TODO list, and every existing case must stay green.
//   2. Prefer a small number of general, structural rules that generalise
//      across many natural-language constructions over narrow, one-off
//      special cases.
//   3. Keep both functions pure: no network, no filesystem, no process I/O.
//   4. Do not modify `parseGbifVernacularName` below.
//   5. The live path src/common-names-fetch.js delegates to
//      extractWikipediaCommonNames; once this is implemented its behaviour is
//      covered automatically.
//   6. Verify with `npm test` after any change.
// ─────────────────────────────────────────────────────────────────────────────

function extractNamesFromCapture(captured) {
  return [];
}

function extractWikipediaCommonNames(text) {
  return [];
}

module.exports = {
  parseGbifVernacularName,
  extractNamesFromCapture,
  extractWikipediaCommonNames
};