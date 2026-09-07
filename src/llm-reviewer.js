// End-of-Wikipedia LLM reviewer: sits after the deterministic regex
// extraction, receives the Wikipedia extract plus the deterministic base
// list, and decides what to add or remove. The LLM's decisions are applied
// verbatim (trim + empty-filter + case-insensitive dedup only) — there is no
// deterministic junk-classifier layer after the model. Corrections are logged
// (see review-log.js) so the deterministic pipeline can be patched later.
//
// Only Wikipedia-derived names are in scope: other sources (Wikidata, GBIF)
// have standardized structures where an LLM adds no value. A missing/broken
// completer degrades to the deterministic list unchanged.

const { normalizeNameKey } = require('./utils');

// Categories are informational only (recorded in the log to guide future
// regex patches). They are not enforced — any string is accepted.
const REVIEWER_JSON_SCHEMA = {
  type: 'object',
  properties: {
    add: { type: 'array', items: { type: 'string' } },
    remove: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          category: { type: 'string' }
        },
        required: ['name']
      }
    }
  },
  required: ['add', 'remove']
};

const SYSTEM_PROMPT =
  'You review common (vernacular) names of a plant taxon that a regex pipeline ' +
  'extracted from the taxon\'s Wikipedia article. The prompt names the taxon, ' +
  'gives the article text, and lists the extracted names. Return ONLY a JSON ' +
  'object with two keys:\n' +
  "- 'add': an array of strings — common names people actually use FOR this " +
  'taxon itself, stated verbatim in the text, missing from the list.\n' +
  "- 'remove': an array of objects { name, category } — list entries that are " +
  'NOT genuine common names of this taxon. Categories:\n' +
  "  - 'broken-capture': sentence fragments, ungrammatical spans, or stray " +
  "phrases from sloppy extraction (e.g. 'although once included', 'which " +
  'means shut happy\'). Always remove these.\n' +
  "  - 'generic': vague words like 'tree', 'shrub', 'plant' that fit any plant.\n" +
  "  - 'geographic': place names, regions, or geographic features, not the plant.\n" +
  "  - 'morphological': structural descriptors like 'lanceolate'.\n" +
  "  - 'procedural': extraction artifacts like a leading 'known as'.\n\n" +
  "Rules for 'add':\n" +
  '- Names must refer to THIS taxon (species, genus, or family) — never to ' +
  'member species, crops, products, pests, or dishes. In a family or genus ' +
  'article, do not add crop or member-species names (e.g. for Fabaceae: no ' +
  "'peanut', 'alfalfa', 'chickpeas').\n" +
  "- Names built on the taxon's own head noun are excellent (e.g. 'pea " +
  "family', 'common oak').\n" +
  '- Exclude scientific Latin names of any organism (including pests, ' +
  'diseases, and fungi) and infraspecific Latin forms with rank markers ' +
  '(fo., var., subsp., ssp.).\n' +
  '- Exclude dishes, cooked foods, tools, or objects made from the plant, ' +
  'person names, named geographic features, pronunciation guides, and ' +
  'anything not literally present in the text.\n' +
  "- Regional non-English vernaculars for the taxon itself are welcome.\n\n" +
  "Rules for 'remove':\n" +
  "- Never remove genuine family or genus names (e.g. 'pea family', 'legume " +
  'family\') or the taxon\'s single best-known name.\n' +
  '- Never remove a name merely because it is regional or informal.\n' +
  'Do not invent, paraphrase, or translate. Empty arrays allowed.';

function capInput(text, maxInputChars) {
  if (!maxInputChars || text.length <= maxInputChars) return text;
  return text.slice(0, maxInputChars);
}

// Parse a possibly-fenced or noisy completion into a list of candidate strings.
function parseNamesJson(raw) {
  if (!raw) return [];
  let text = String(raw).trim();
  if (!text) return [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((x) => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean);
}

// Parse a reviewer completion into { add, remove }. Tolerates code fences and
// prose. Backward compatible: a bare JSON array is treated as add-only.
function parseReviewJson(raw) {
  const empty = { add: [], remove: [] };
  if (!raw) return empty;
  let text = String(raw).trim();
  if (!text) return empty;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) text = fence[1].trim();
  if (/^\[/.test(text)) {
    return { add: parseNamesJson(text), remove: [] };
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return empty;
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
  const add = Array.isArray(parsed.add)
    ? parsed.add
        .filter((x) => typeof x === 'string')
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
  const remove = Array.isArray(parsed.remove)
    ? parsed.remove
        .filter((x) => x && typeof x === 'object')
        .map((x) => ({
          name: typeof x.name === 'string' ? x.name.trim() : '',
          category: typeof x.category === 'string' ? x.category.trim().toLowerCase() : ''
        }))
        .filter((x) => x.name)
    : [];
  return { add, remove };
}

function buildPrompt(text, base, taxon) {
  const baseList = base.length ? base.join(', ') : 'none';
  return (
    `The article is about the plant taxon: ${taxon || 'unknown'}.\n\n` +
    `Wikipedia text:\n\n${text}\n\n` +
    `Names already extracted by existing rules:\n${baseList}\n\n` +
    'Return the JSON object with "add" = common names FOR this taxon that are ' +
    'missing from the list, and "remove" = list entries that are not genuine ' +
    'common names of this taxon (each with a category).'
  );
}

// End-of-Wikipedia review.
//   input.extract       full Wikipedia extract text
//   input.baseNames     deterministic extraction output (Wikipedia-only)
//   input.taxon         scientific name of the taxon (grounds the model)
//   options.completer   async (system, user, { jsonSchema }) => string (from
//                       llm-backend); null disables.
//   options.maxInputChars cap for the extract sent to the model (default 16000)
// Returns { names, added, removed, reason } where names is the final
// Wikipedia list (base minus removals plus additions, order preserved),
// added/removed are applied LLM decisions for CLI display and logging.
async function reviewWikipediaNames(input = {}, options = {}) {
  const extract = input.extract || '';
  const base = [...(input.baseNames || [])];
  const completer = options.completer || input.completer || null;
  const result = { names: [...base], added: [], removed: [], reason: 'llm-disabled' };

  if (!completer) return result;
  if (!extract) return result;

  const capped = capInput(extract, options.maxInputChars || input.maxInputChars || 16000);
  const prompt = buildPrompt(capped, base, input.taxon);
  let response;
  try {
    response = await completer(SYSTEM_PROMPT, prompt, { jsonSchema: REVIEWER_JSON_SCHEMA });
  } catch (err) {
    result.reason = `completer-error: ${err && err.message ? err.message : err}`;
    return result;
  }

  const parsed = parseReviewJson(response);
  if (!parsed.add.length && !parsed.remove.length) {
    result.reason = 'llm-empty';
    return result;
  }
  result.reason = 'llm-reviewed';

  // Adds: trim + drop empties + case-insensitive dedup against base and
  // among themselves. No junk classifiers — the LLM decides.
  const seenKeys = new Set(base.map(normalizeNameKey));
  const added = [];
  for (const candidate of parsed.add) {
    const name = String(candidate).trim();
    if (!name) continue;
    const key = normalizeNameKey(name);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    added.push(name);
  }

  // Removes: key-match against the base list so the LLM can only veto
  // Wikipedia-derived names it was shown. Unknown names are ignored.
  // Categories are kept as informational metadata for the log.
  const baseKeys = new Set(base.map(normalizeNameKey));
  const removed = [];
  const removedKeys = new Set();
  for (const candidate of parsed.remove) {
    const key = normalizeNameKey(candidate.name);
    if (!baseKeys.has(key)) continue;
    if (removedKeys.has(key)) continue;
    removedKeys.add(key);
    removed.push({ name: candidate.name, category: candidate.category || '' });
  }

  const removedKeySet = new Set(removed.map((r) => normalizeNameKey(r.name)));
  const baseNameByKey = new Map(base.map((n) => [normalizeNameKey(n), n]));
  const removedNames = removed.map((r) => baseNameByKey.get(normalizeNameKey(r.name)));

  result.added = added;
  result.removed = removedNames.map((name, i) => ({
    name,
    category: removed[i].category
  }));
  result.names = [...base.filter((n) => !removedKeySet.has(normalizeNameKey(n))), ...added];
  return result;
}

module.exports = {
  reviewWikipediaNames,
  parseNamesJson,
  parseReviewJson,
  buildPrompt,
  SYSTEM_PROMPT,
  REVIEWER_JSON_SCHEMA
};
