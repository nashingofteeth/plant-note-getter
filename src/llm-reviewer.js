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

// Schema for the remove pass: the model must return a verdict for EVERY
// listed entry (forcing per-name evaluation instead of cherry-picking
// victims). verdict 'keep' entries are never applied.
const REMOVE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    remove: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          verdict: { type: 'string', enum: ['keep', 'remove'] },
          category: { type: 'string' }
        },
        required: ['name', 'verdict']
      }
    }
  },
  required: ['remove']
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
  "Fabaceae: 'pea family', 'legume family', 'pulse family'). A name that " +
  'combines a place or species qualifier with the head noun (e.g. ' +
  "'Pacific yew', 'Mexican yew' for the genus Taxus) names a member " +
  'species, NOT this taxon — never add it, even though it contains the ' +
  'head noun. Never add scientific Latin genus or species names (e.g. ' +
  "'vicia', 'glycyrrhiza').\n" +
  "- Names built on the taxon's own head noun with a qualifier that " +
  'applies to the whole group are excellent (e.g. \'pea family\', ' +
  "'common oak', 'golden yews').\n" +
  '- Exclude cultivar, trade-mark, and cultivated-form names (e.g. ' +
  "'Summer Chocolate', 'Ishii Weeping', 'Pendula', 'Rosea') and person " +
  "names (e.g. 'Ernest Wilson'). Never add from 'cultivars include' lists " +
  "(e.g. 'Japanese cultivars include: Benifuuki, Fushun, Yabukita'), and " +
  'never add regional product names (e.g. \'Darjeeling tea\', ' +
  "'Nilgiri tea') — those are products, not names of the plant.\n" +
  '- Use each name\'s exact wording from the text — never merge or splice ' +
  "pieces of different names into a composite (no 'Chinese Western Yunnan " +
  "Assam tea' style splices).\n" +
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
  'For EVERY listed entry, decide keep or remove, and return ONLY a JSON ' +
  'object: {"remove": [{name, verdict, category}]} with verdict "keep" or ' +
  '"remove" — one object per entry, in the same order. Leave "add" empty.\n' +
  'Keep rules (these are genuine names of the taxon):\n' +
  "- Names enumerated together after a naming verb ('commonly known as " +
  "licorice fern, many-footed fern, and sweet root') are ALL genuine — " +
  'every member of such an enumeration is keep.\n' +
  "- Genuine family or genus names (e.g. 'pea family', 'legume family') and " +
  "the taxon's single best-known name.\n" +
  "- 'common' + head-noun forms (e.g. 'common chicory', 'common oak'), " +
  'hyphenated compounds (e.g. \'eastern hemlock-spruce\'), and names built ' +
  "from a head noun plus a modifier of this taxon (e.g. 'silk tree', " +
  "'mimosa tree').\n" +
  '- Regional plant names (e.g. \'Russian olive\', \'pruche du Canada\', ' +
  "'radiki', 'stamnagathi') and informal names.\n" +
  "- Names shared with another plant (e.g. 'mimosa' also names an Acacia).\n" +
  "- Singular or plural variants of a vernacular name (e.g. 'shadberry' / " +
  "'shadberries').\n" +
  'When unsure whether an entry is a genuine name, verdict keep.\n' +
  'Remove rules (verdict remove, with a category):\n' +
  "- 'broken-capture': sentence fragments, ungrammatical spans, or stray " +
  "phrases from sloppy extraction (e.g. 'although once included', 'which " +
  "means shut happy', 'To add to the confusion', 'are also known as " +
  "mimosa'), including detached place fragments ('from Verona'). An entry " +
  'that starts with a verb, conjunction, or preposition is a fragment even ' +
  'when it embeds a real name inside.\n' +
  "- 'generic': a bare category word only ('tree', 'shrub', 'berry', " +
  "'plant'). A vernacular name is NOT generic just because it sounds " +
  "descriptive (e.g. 'shadberries', 'sleeping tree' are genuine names).\n" +
  "- 'geographic': names that ARE places or geographic features (e.g. " +
  "'Bight of Biafra') — not plant names that merely mention a region.\n" +
  "- 'morphological': structural descriptors like 'lanceolate'.\n" +
  "- 'procedural': extraction artifacts like a leading 'known as'.\n" +
  "- 'cultivar': cultivar, trade-mark, or cultivated-form names (e.g. " +
  "'Rosea', 'Summer Chocolate'), and person names (e.g. 'E.H.Wilson').\n" +
  "  - 'other-organism': names of other organisms mentioned in passing — " +
  "bacteria, fungi, pests, diseases (e.g. 'diazotrophs', 'Fusarium'), and " +
  'scientific Latin names of any organism. Do NOT use this for regional ' +
  'plant names of this taxon.\n' +
  'Do not invent or paraphrase. Empty arrays allowed.';

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
          verdict: typeof x.verdict === 'string' ? x.verdict.trim().toLowerCase() : '',
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
    'Return the JSON object with a "remove" verdict ("keep" or "remove") ' +
    'for EVERY listed entry, each with a category (leave "add" empty).'
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
        { jsonSchema: REMOVE_JSON_SCHEMA }
      );
    } catch (err) {
      firstError = err;
    }
    if (response !== null) {
      for (const candidate of parseReviewJson(response).remove) {
        const key = normalizeNameKey(candidate.name);
        if (!baseNameByKey.has(key)) continue;
        if (removedKeys.has(key)) continue;
        // Per-entry verdict from the remove pass; absent verdict (free-form
        // completers) keeps the legacy remove behavior.
        if (candidate.verdict === 'keep') continue;
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
      { jsonSchema: REVIEWER_JSON_SCHEMA }
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
  REVIEWER_JSON_SCHEMA,
  REMOVE_JSON_SCHEMA
};
