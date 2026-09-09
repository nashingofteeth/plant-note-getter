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
          quote: { type: 'string' },
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
  '- Never add galls, diseases, or pests (e.g. \'oak apple\', ' +
  "'oak marble gall', 'pineapple gall') — those belong to other organisms, " +
  'not this plant.\n' +
  '- Never add names of individual organisms: famous specimen trees ' +
  "(e.g. 'Major Oak', 'Bowthorpe Oak', 'Carroll Oak') name one particular " +
  'plant, not the taxon.\n' +
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
  '- Add a name only when the text presents it AS a name of this taxon ' +
  '(naming verbs, appositives, common-name lists) — never pull candidates ' +
  'out of passing mentions, anecdotes, or lists of other things.\n' +
  '- Return at most 10 names. On long articles with many candidate ' +
  'strings, keep only the strongest naming-construction matches so the ' +
  'output stays within budget.\n' +
  '- Regional non-English vernaculars for the taxon itself are welcome.\n' +
  'Do not invent, paraphrase, or translate. When unsure, leave it out. ' +
  'Empty arrays allowed.';

const REMOVE_SYSTEM_PROMPT =
  'You clean a list of common (vernacular) names of a plant taxon that a ' +
  "regex pipeline extracted from the taxon's Wikipedia article. The prompt " +
  'names the taxon, gives the article text, and lists the extracted names. ' +
  'For EVERY listed entry, decide keep or remove, and return ONLY a JSON ' +
  'object: {"remove": [{name, verdict, quote, category}]} with verdict ' +
  '"keep" or "remove" — one object per entry, in the same order. For each ' +
  'verdict remove, "quote" MUST be the exact article span that proves the ' +
  'entry is not a genuine name of this taxon; if you cannot quote such a ' +
  'span, verdict keep. Leave "add" empty.\n' +
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
  "- Names whose etymology the text explains: 'its Persian name shabkhosb " +
  'means "night sleeper"' + "' or 'the Chinese common name hehuan, which " +
  'means "shut happy" and symbolizes a happy couple\' — the explanation is ' +
  'about the name, not instead of it. Etymology and meaning sentences keep ' +
  "their names (verdict keep for the name, ignore the explanation).\n" +
  "- Names scoped to a variety, subspecies, or cultivar group OF this taxon " +
  "('Common names for varieties of var. foliosum include radicchio, " +
  "endive...') — variety-level names are still names FOR this taxon. Keep " +
  "them.\n" +
  'When unsure whether an entry is a genuine name, verdict keep.\n' +
  'Remove rules (verdict remove, with a category):\n' +
  "- 'broken-capture': sentence fragments, ungrammatical spans, or stray " +
  "phrases from sloppy extraction (e.g. 'although once included', 'which " +
  "means shut happy', 'To add to the confusion', 'are also known as " +
  "mimosa'), including detached place fragments ('from Verona'), entries " +
  'wrapped in stray quotation marks (e.g. \'"figwort"\'), and phrases ' +
  "about other members of the family (e.g. 'other members of the " +
  'Scrophulariaceae\'). An entry that starts with a verb, conjunction, or ' +
  'preposition is a fragment even when it embeds a real name inside.\n' +
  "- 'generic': a bare category word only ('tree', 'shrub', 'berry', " +
  "'plant'). A vernacular name is NOT generic just because it sounds " +
  "descriptive (e.g. 'shadberries', 'sleeping tree' are genuine names).\n" +
  "- 'geographic': names that ARE places or geographic features (e.g. " +
  "'Bight of Biafra') — not plant names that merely mention a region. A " +
  "bare place with no plant word in it ('Oregon', 'California', 'Verona') " +
  "is never a common name, even inside a naming sentence ('is native to " +
  "both California and Oregon') — remove it. Regional plant names that " +
  "combine a place with a plant word ('Russian olive', 'Canada yew') are " +
  "genuine — keep those.\n" +
  "- 'morphological': structural descriptors like 'lanceolate', and " +
  "plant-part/anatomy terms — any entry naming a PART of the plant rather " +
  "than the plant itself ('mouth', 'trigger hairs', 'utricles', 'bark', " +
  "'roots') is not a name of the taxon.\n" +
  "- 'procedural': extraction artifacts like a leading 'known as', and " +
  "meta-language about names (an entry like 'word gooseberry' from a " +
  "sentence about names including a word — describing names is not " +
  "itself a name).\n" +
  "- 'cultivar': person names (e.g. 'E.H.Wilson') and scientific-form " +
  'strings — entries whose wording is a Latin binomial or contains a ' +
  "quote-epithet (e.g. \"Salix alba 'Vitellina-Tristis'\") are not " +
  'vernacular names. But a plain-English vernacular name of a cultivar ' +
  "(e.g. 'golden weeping willow') is a genuine regional name — keep it.\n" +
  "  - 'other-organism': names of other organisms mentioned in passing — " +
  "bacteria, fungi, pests, diseases (e.g. 'diazotrophs', 'Fusarium'), and " +
  'scientific Latin names of any organism. Do NOT use this for regional ' +
  'plant names of this taxon.\n' +
  'Do not invent or paraphrase. Empty arrays allowed.';

function capInput(text, maxInputChars) {
  if (!maxInputChars || text.length <= maxInputChars) return text;
  return text.slice(0, maxInputChars);
}

// Detect a completion cut off mid-stream when the token budget ran out:
// an opening brace/bracket with no matching close. Short prose refusals
// ('Sorry, ...') have no opening delimiter and are NOT truncation.
function looksTruncated(raw) {
  if (!raw) return false;
  const text = String(raw).trim();
  if (!text) return false;
  const openBrace = text.indexOf('{');
  const closeBrace = text.lastIndexOf('}');
  if (openBrace !== -1 && closeBrace <= openBrace) return true;
  if (/^\[/.test(text) && text.lastIndexOf(']') === -1) return true;
  return false;
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
          quote: typeof x.quote === 'string' ? x.quote.trim() : '',
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
    'are missing from the list (at most 10; leave "remove" empty). ' +
    'Never add galls, diseases, pests, or individual specimen trees.'
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
  let truncated = false;

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
      const parsed = parseReviewJson(response);
      if (!parsed.add.length && !parsed.remove.length && looksTruncated(response)) {
        truncated = true;
      }
      for (const candidate of parsed.remove) {
        const key = normalizeNameKey(candidate.name);
        if (!baseNameByKey.has(key)) continue;
        if (removedKeys.has(key)) continue;
        // Per-entry verdict from the remove pass; absent verdict (free-form
        // completers) keeps the legacy remove behavior.
        if (candidate.verdict === 'keep') continue;
        removedKeys.add(key);
        removed.push({
          name: baseNameByKey.get(key),
          category: candidate.category || '',
          quote: candidate.quote || ''
        });
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
    const parsed2 = parseReviewJson(response2);
    if (!parsed2.add.length && !parsed2.remove.length && looksTruncated(response2)) {
      truncated = true;
    }
    const seenKeys = new Set(base.map(normalizeNameKey));
    for (const candidate of parsed2.add) {
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
    } else if (truncated) {
      result.reason = 'llm-truncated';
      console.warn(
        `[llm] reviewer output looked truncated (token budget) for ${input.taxon || 'unknown'} — no names applied`
      );
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
