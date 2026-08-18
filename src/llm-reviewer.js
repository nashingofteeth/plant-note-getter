// Hybrid LLM reviewer: runs the deterministic regex extraction unchanged,
// then asks a local model for any missed common names. LLM proposals are only
// kept if they pass the same deterministic gauntlet as regex captures
// (in-text presence, extractNamesFromCapture cleaning, junk classifiers,
// CJK/abbreviated-binomial rejection, dedup). The LLM can never remove or
// reorder regex names, and a missing/broken completer degrades to regex-only.

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

const SYSTEM_PROMPT =
  'You extract common (vernacular) names of a plant taxon from Wikipedia text. ' +
  'Return ONLY a JSON array of strings. Each element is a single common name ' +
  'stated verbatim in the text. Exclude scientific (Latin) names, geographic ' +
  'terms, morphological descriptions, pronunciation guides, and anything not ' +
  'literally present in the text. Do not invent or paraphrase. If there are ' +
  'none, return [].';

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

function buildPrompt(text, base) {
  const baseList = base.length ? base.join(', ') : 'none';
  return (
    `Wikipedia text:\n\n${text}\n\n` +
    `Names already extracted by existing rules:\n${baseList}\n\n` +
    'Return the JSON array of ALL OTHER common names stated in the text ' +
    '(exclude the ones already listed).'
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

// Advisory second pass over a Wikipedia extract.
//   options.completer     async (system, user) => string (from llm-backend); null disables
//   options.maxInputChars  cap for the extract sent to the model (default 16000)
//   options.gate          'always' (default) or 'auto' (skip when base list is already long)
//   options.autoGateMinBase  base-name count above which 'auto' gates out the LLM
// Returns { names, trace } where trace mirrors traceExtraction plus:
//   trace.reason   why the LLM pass did/didn't run or what it found
//   trace.proposed raw LLM candidates, trace.kept accepted, trace.dropped rejected
//   trace.catches  [{ name, sentence, gate }] for the review-gap tally log
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

  const proposed = parseNamesJson(response);
  trace.reason = proposed.length ? 'llm-reviewed' : 'llm-empty';
  trace.proposed = proposed;

  const extractLower = text.toLowerCase();
  const seenKeys = new Set(base.map(normalizeNameKey));
  const kept = [];
  const dropped = [];
  for (const candidate of proposed) {
    const outcome = verifyCandidate(candidate, extractLower, seenKeys);
    if (outcome.dropped) {
      dropped.push({ name: candidate, reason: outcome.dropped });
    } else {
      kept.push(outcome.name);
    }
  }

  trace.kept = kept;
  trace.dropped = dropped;
  trace.catches = kept.length ? attributeCatches(text, kept) : [];
  result.names = [...base, ...kept];
  return result;
}

module.exports = {
  reviewExtractWikipediaNames,
  parseNamesJson,
  verifyCandidate,
  buildPrompt,
  SYSTEM_PROMPT
};