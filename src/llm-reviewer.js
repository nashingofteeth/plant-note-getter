// Hybrid LLM reviewer: runs the deterministic regex extraction unchanged,
// then asks a local model for missed common names (add pass) and for noise in
// the regex output (reject pass). LLM proposals are only honored if they pass
// the same deterministic gauntlet as regex captures: additions need verbatim
// in-text presence + cleaning + junk classifiers + dedup; removals must
// key-match a name the regex actually captured and carry an allowlisted
// category. The LLM can never reorder regex names, and a missing/broken
// completer degrades to regex-only.

const {
  extractWikipediaCommonNames,
  extractNamesFromCapture,
  traceExtraction,
  getSentences,
  isGenericJunk,
  isGeographicJunk,
  isProcedural,
  isAbbreviatedBinomialLike,
  hasCJK
} = require('./wiki-extract');
const { stripArticle, normalizeNameKey } = require('./utils');

const REJECT_CATEGORIES = new Set([
  'generic',
  'geographic',
  'morphological',
  'procedural',
  'broken-capture'
]);

const SYSTEM_PROMPT =
  'You extract common (vernacular) names of a plant taxon from Wikipedia text. ' +
  'Return ONLY a JSON object with two keys:\n' +
  "- 'add': an array of strings — single common names stated verbatim in the " +
  'text that are NOT already in the provided list.\n' +
  "- 'remove': an array of objects { name, category } — entries in the provided " +
  'list that are NOT genuine common names of this plant. Valid categories: ' +
  'generic, geographic, morphological, procedural, broken-capture.\n' +
  'Exclude scientific (Latin) names, geographic terms, morphological ' +
  'descriptions, pronunciation guides, and anything not literally present in ' +
  'the text. Do not invent or paraphrase. Empty arrays allowed.';

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

function buildPrompt(text, base) {
  const baseList = base.length ? base.join(', ') : 'none';
  return (
    `Wikipedia text:\n\n${text}\n\n` +
    `Names already extracted by existing rules:\n${baseList}\n\n` +
    'Return the JSON object with "add" = common names in the text that are ' +
    'missing from the list, and "remove" = list entries that are not genuine ' +
    'common names of this plant (each with a category).'
  );
}

function findEnclosingSentence(text, name) {
  const idx = text.toLowerCase().indexOf(name.toLowerCase());
  if (idx === -1) return '';
  let start = 0;
  for (const sentence of getSentences(text)) {
    const rel = text.indexOf(sentence, start);
    if (rel === -1) continue;
    const end = rel + sentence.length;
    if (idx >= rel && idx < end) return sentence;
    start = rel + sentence.length;
  }
  return '';
}

// Map each kept name to its originating sentence, and whether that sentence
// was gated out of the regex scan ('skipped') or scanned but missed by every
// rule ('parsed-no-capture').
function attributeCatches(text, kept) {
  const skipped = new Set(traceExtraction(text).skippedSentences.map((s) => s.sentence));
  return kept.map((name) => {
    const sentence = findEnclosingSentence(text, name);
    return { name, sentence, gate: skipped.has(sentence) ? 'skipped' : 'parsed-no-capture' };
  });
}

// Verify one LLM-proposed candidate against the deterministic gauntlet.
// Returns { name } on success or { dropped: reason } on failure.
function verifyCandidate(candidate, extractLower, seenKeys) {
  const cleaned = extractNamesFromCapture(candidate, null, 'LLM');
  const target = (cleaned && cleaned[0]) || stripArticle(candidate).trim();
  if (!target) return { dropped: 'empty' };
  if (isAbbreviatedBinomialLike(target)) return { dropped: 'abbreviated-binomial' };
  if (hasCJK(target)) return { dropped: 'hasCJK' };
  if (!extractLower.includes(target.toLowerCase())) return { dropped: 'not-in-text' };
  if (isGenericJunk(target)) return { dropped: 'isGenericJunk' };
  if (isGeographicJunk(target)) return { dropped: 'isGeographicJunk' };
  if (isProcedural(target)) return { dropped: 'isProcedural' };
  const key = normalizeNameKey(target);
  if (seenKeys.has(key)) return { dropped: 'duplicate' };
  seenKeys.add(key);
  return { name: target };
}

// Verify one LLM-proposed removal against the deterministic veto gauntlet.
// The name must key-match a name the regex actually captured, and the category
// must be allowlisted. Returns { vetoed: true } on success or
// { ignored: reason } on failure.
function verifyVeto(candidate, baseKeys) {
  if (!candidate || typeof candidate !== 'object' || !candidate.name) {
    return { ignored: 'malformed' };
  }
  const key = normalizeNameKey(candidate.name);
  if (!baseKeys.has(key)) return { ignored: 'not-a-base-name' };
  if (!REJECT_CATEGORIES.has(candidate.category)) {
    return { ignored: `unknown-category:${candidate.category}` };
  }
  return { vetoed: true };
}

// Advisory second pass over a Wikipedia extract.
//   options.completer     async (system, user) => string (from llm-backend); null disables
//   options.maxInputChars  cap for the extract sent to the model (default 16000)
//   options.gate          'always' (default) or 'auto' (skip when base list is already long)
//   options.autoGateMinBase  base-name count above which 'auto' gates out the LLM
//   options.rejectEnabled if false, no removal is applied (add-only)
//   options.rejectMax     max removals applied per article (default 3)
// Returns { names, trace } where trace mirrors traceExtraction plus:
//   trace.reason   why the LLM pass did/didn't run or what it found
//   trace.proposed raw LLM candidates, trace.kept accepted, trace.dropped rejected
//   trace.vetoed applied removals, trace.vetoIgnored ignored removal candidates
//   trace.catches  [{ name, sentence, gate }] for the review-gap tally log
//   trace.removals [{ name, sentence, gate, category }] applied removals for the log
async function reviewExtractWikipediaNames(text, options = {}) {
  const trace = { reason: 'llm-disabled' };
  const base = extractWikipediaCommonNames(text);
  const result = { names: [...base], trace };

  const completer = options.completer || null;
  if (!completer) return result;

  if (options.gate === 'auto' && base.length >= (options.autoGateMinBase || 4)) {
    trace.reason = 'gated-auto';
    return result;
  }

  const extract = capInput(text, options.maxInputChars || 16000);
  const prompt = buildPrompt(extract, base);
  let response;
  try {
    response = await completer(SYSTEM_PROMPT, prompt);
  } catch (err) {
    trace.reason = `completer-error: ${err && err.message ? err.message : err}`;
    return result;
  }

  const parsed = parseReviewJson(response);
  trace.reason =
    parsed.add.length || parsed.remove.length ? 'llm-reviewed' : 'llm-empty';
  trace.proposed = parsed.add;

  const extractLower = text.toLowerCase();
  const baseKeys = new Set(base.map(normalizeNameKey));
  const seenKeys = new Set(baseKeys);
  const kept = [];
  const dropped = [];
  for (const candidate of parsed.add) {
    const outcome = verifyCandidate(candidate, extractLower, seenKeys);
    if (outcome.dropped) {
      dropped.push({ name: candidate, reason: outcome.dropped });
    } else {
      kept.push(outcome.name);
    }
  }

  const rejectEnabled = options.rejectEnabled !== false;
  const vetoed = [];
  const vetoIgnored = [];
  if (rejectEnabled) {
    const rejectMax = options.rejectMax || 3;
    const vetoedKeys = new Set();
    for (const candidate of parsed.remove) {
      if (vetoed.length >= rejectMax) {
        vetoIgnored.push({ name: candidate.name, reason: 'over-cap' });
        continue;
      }
      const outcome = verifyVeto(candidate, baseKeys);
      if (outcome.vetoed) {
        if (vetoedKeys.has(normalizeNameKey(candidate.name))) {
          vetoIgnored.push({ name: candidate.name, reason: 'duplicate' });
          continue;
        }
        vetoedKeys.add(normalizeNameKey(candidate.name));
        vetoed.push(candidate.name);
      } else {
        vetoIgnored.push({ name: candidate.name, reason: outcome.ignored });
      }
    }
  }

  const vetoSet = new Set(vetoed.map(normalizeNameKey));
  const namesAfterVeto = base.filter((n) => !vetoSet.has(normalizeNameKey(n)));
  const removed = base.filter((n) => vetoSet.has(normalizeNameKey(n)));

  trace.kept = kept;
  trace.dropped = dropped;
  trace.vetoed = vetoed;
  trace.vetoIgnored = vetoIgnored;
  trace.catches = kept.length ? attributeCatches(text, kept) : [];
  trace.removals = removed.length ? attributeCatches(text, removed) : [];
  trace.removals = trace.removals.map((r) => {
    const cat =
      parsed.remove.find((c) => normalizeNameKey(c.name) === normalizeNameKey(r.name)) || {};
    return { ...r, category: cat.category || '' };
  });
  result.names = [...namesAfterVeto, ...kept];
  return result;
}

module.exports = {
  reviewExtractWikipediaNames,
  parseNamesJson,
  parseReviewJson,
  verifyCandidate,
  verifyVeto,
  buildPrompt,
  SYSTEM_PROMPT,
  REJECT_CATEGORIES
};