// End-of-Wikipedia LLM reviewer: sits after the deterministic regex
// extraction, receives the Wikipedia extract plus the deterministic base
// list (and the taxon's scientific name for grounding), and runs two
// focused passes: a remove pass that marks junk in the list, then an add
// pass that finds missed names against the cleaned list. The LLM's
// decisions are applied verbatim (trim + empty-filter + case-insensitive
// dedup for adds; base-name key-match for removes) — there is no
// deterministic junk-classifier layer after the model. Corrections are
// logged (see review-log.js) so the deterministic pipeline can be patched
// later.
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

const ADD_SYSTEM_PROMPT =
  'You find common (vernacular) names of a plant taxon in its Wikipedia ' +
  'article that a regex pipeline missed. The prompt names the taxon (with ' +
  'its rank), gives the article text, and lists the names already ' +
  'extracted. Return ONLY a JSON object: {"add": [...]} — common names ' +
  'people actually use FOR this taxon itself, stated verbatim in the text, ' +
  'missing from the list. Leave "remove" empty.\n' +
  'Scope rule (most important): a common name of THIS taxon is a name that ' +
  'refers to the taxon itself, the way people name it in everyday speech. ' +
  'Member species, crops, and products of the taxon are NOT names of the ' +
  'taxon. In a family or genus article the text usually lists many member ' +
  'species and crops — expect to add NOTHING from such lists. The only ' +
  "acceptable adds there are names denoting the group itself (e.g. for " +
  "Fabaceae: 'pea family', 'legume family', 'pulse family'). Never add " +
  'scientific Latin genus or species names (e.g. \'vicia\', ' +
  "'glycyrrhiza').\n" +
  "- Names built on the taxon's own head noun are excellent (e.g. 'pea " +
  "family', 'common oak').\n" +
  '- Exclude cultivar, trade-mark, and cultivated-form names (e.g. ' +
  "'Summer Chocolate', 'Ishii Weeping', 'Pendula', 'Rosea') and person " +
  "names (e.g. 'Ernest Wilson'), even when the text lists them under " +
  "'Cultivars'.\n" +
  '- Exclude scientific Latin names of any organism (including pests, ' +
  'diseases, and fungi) and infraspecific Latin forms with rank markers ' +
  '(fo., var., subsp., ssp.).\n' +
  '- Exclude dishes, cooked foods, tools, or objects made from the plant, ' +
  'named geographic features, pronunciation guides, and anything not ' +
  'literally present in the text.\n' +
  '- Regional non-English vernaculars for the taxon itself are welcome.\n' +
  'Do not invent, paraphrase, or translate. When unsure, leave it out. ' +
  'Empty arrays allowed.';

const REMOVE_SYSTEM_PROMPT =
  'You clean a list of common (vernacular) names of a plant taxon that a ' +
  "regex pipeline extracted from the taxon's Wikipedia article. The prompt " +
  'names the taxon, gives the article text, and lists the extracted names. ' +
  'Return ONLY a JSON object: {"remove": [{name, category}]} — entries that ' +
  'are NOT genuine vernacular names of this taxon. Leave "add" empty.\n' +
  'Categories:\n' +
  "  - 'broken-capture': sentence fragments, ungrammatical spans, or stray " +
  "phrases from sloppy extraction (e.g. 'although once included', 'which " +
  "means shut happy', 'To add to the confusion', 'are also known as " +
  "mimosa'). An entry that starts with a verb or conjunction is a fragment " +
  'even when it embeds a real name inside — remove it. Always remove ' +
  'these.\n' +
  "  - 'generic': a bare category word only ('tree', 'shrub', 'berry', " +
  "'plant'). A vernacular name is NOT generic just because it sounds " +
  "descriptive (e.g. 'shadberries', 'sleeping tree' are genuine names).\n" +
  "  - 'geographic': place names, regions, or geographic features, not the plant.\n" +
  "  - 'morphological': structural descriptors like 'lanceolate'.\n" +
  "  - 'procedural': extraction artifacts like a leading 'known as'.\n" +
  "  - 'cultivar': cultivar, trade-mark, or cultivated-form names (e.g. " +
  "'Rosea', 'Summer Chocolate'), and person names (e.g. 'E.H.Wilson').\n\n" +
  'Never remove:\n' +
  "- Genuine family or genus names (e.g. 'pea family', 'legume family') or " +
  "the taxon's single best-known name.\n" +
  '- Names merely because they are regional or informal.\n' +
  "- Names shared with another plant (e.g. 'mimosa' also names an Acacia) — " +
  'a shared name is still genuine for this taxon.\n' +
  "- Singular or plural variants of a vernacular name (e.g. 'shadberry' / " +
  "'shadberries'), or a name built from a head noun plus a modifier of " +
  "this taxon (e.g. 'silk tree', 'mimosa tree').\n" +
  'When unsure whether an entry is a genuine name, keep it. Do not invent ' +
  'or paraphrase. Empty arrays allowed.';

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

function promptHead(text, base, taxon, rank) {
  const baseList = base.length ? base.join(', ') : 'none';
  return (
    `The article is about the plant taxon: ${taxon || 'unknown'}` +
    `${rank ? ` (${rank})` : ''}.\n\n` +
    `Wikipedia text:\n\n${text}\n\n` +
    `Names already extracted by existing rules:\n${baseList}\n\n`
  );
}

function buildAddPrompt(text, base, taxon, rank) {
  return (
    promptHead(text, base, taxon, rank) +
    'Return the JSON object with "add" = common names FOR this taxon that ' +
    'are missing from the list (leave "remove" empty).'
  );
}

function buildRemovePrompt(text, base, taxon, rank) {
  return (
    promptHead(text, base, taxon, rank) +
    'Return the JSON object with "remove" = list entries that are not ' +
    'genuine common names of this taxon, each with a category (leave "add" ' +
    'empty).'
  );
}

// End-of-Wikipedia review, run as two focused passes (small models are far
// more reliable single-task):
//   pass 1 (remove): mark junk in the deterministic list
//   pass 2 (add):    find missing names against the cleaned list
//
//   input.extract       full Wikipedia extract text
//   input.baseNames     deterministic extraction output (Wikipedia-only)
//   input.taxon         scientific name of the taxon (grounds the model)
//   input.rank          taxonomic rank label, e.g. 'family' (grounds scope)
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
  const schema = { jsonSchema: REVIEWER_JSON_SCHEMA };
  let firstError = null;

  // Pass 1 — remove: the LLM may only veto names it was shown (base-list
  // key-match); categories are informational metadata for the log.
  const baseNameByKey = new Map(base.map((n) => [normalizeNameKey(n), n]));
  const removedKeys = new Set();
  const removed = [];
  if (base.length) {
    let response = null;
    try {
      response = await completer(
        REMOVE_SYSTEM_PROMPT,
        buildRemovePrompt(capped, base, input.taxon, input.rank),
        schema
      );
    } catch (err) {
      firstError = err;
    }
    if (response !== null) {
      for (const candidate of parseReviewJson(response).remove) {
        const key = normalizeNameKey(candidate.name);
        if (!baseNameByKey.has(key)) continue;
        if (removedKeys.has(key)) continue;
        removedKeys.add(key);
        removed.push({ name: baseNameByKey.get(key), category: candidate.category || '' });
      }
    }
  }

  // Pass 2 — add: the add pass sees the ORIGINAL base list (not the
  // post-removal list), so it cannot re-propose entries pass 1 just removed;
  // dedup against base keys blocks any contradiction. No junk classifiers —
  // the LLM decides.
  const afterRemoval = base.filter((n) => !removedKeys.has(normalizeNameKey(n)));
  const added = [];
  let response2 = null;
  try {
    response2 = await completer(
      ADD_SYSTEM_PROMPT,
      buildAddPrompt(capped, base, input.taxon, input.rank),
      schema
    );
  } catch (err) {
    if (!firstError) firstError = err;
  }
  if (response2 !== null) {
    const seenKeys = new Set(base.map(normalizeNameKey));
    for (const candidate of parseReviewJson(response2).add) {
      const name = String(candidate).trim();
      if (!name) continue;
      const key = normalizeNameKey(name);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      added.push(name);
    }
  }

  if (!added.length && !removed.length) {
    if (firstError) {
      result.reason = `completer-error: ${firstError && firstError.message ? firstError.message : firstError}`;
    } else {
      result.reason = 'llm-empty';
    }
    return result;
  }

  result.added = added;
  result.removed = removed;
  result.names = [...afterRemoval, ...added];
  result.reason = 'llm-reviewed';
  return result;
}

module.exports = {
  reviewWikipediaNames,
  parseNamesJson,
  parseReviewJson,
  promptHead,
  buildAddPrompt,
  buildRemovePrompt,
  ADD_SYSTEM_PROMPT,
  REMOVE_SYSTEM_PROMPT,
  REVIEWER_JSON_SCHEMA
};
