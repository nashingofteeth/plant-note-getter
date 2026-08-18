const { test } = require('node:test');
const assert = require('node:assert');
const { reviewExtractWikipediaNames, parseNamesJson, verifyCandidate } = require('../src/llm-reviewer');

const OAK =
  'Quercus robur, pedunculate oak, European oak, or English oak, is a species of flowering plant in the beech and oak family, Fagaceae. The leaves are lanceolate and green. The flowers are catkins. This species is widely planted in parks.';

const SAMBUCUS =
  'Sambucus nigra is a temperate species of tree or shrub in the family Viburnaceae native to the Azores, Europe, and the Middle East. Common names include elder, elderberry, black elder, European elder, European elderberry, and European black elderberry.';

const HEDGE_OAK =
  'Quercus robur, known to farmers simply as "hedge oak", is a large deciduous tree of the Fagaceae family.';

const BOUNDARY_OAK =
  'Quercus robur is a species of oak. Gardeners often refer to it as the "boundary oak".';

function completerReturning(text) {
  return async () => text;
}

test('reviewExtractWikipediaNames: no completer degrades to regex-only fallback', async () => {
  const { names, trace } = await reviewExtractWikipediaNames(OAK, { completer: null });
  assert.deepStrictEqual(names, ['pedunculate oak', 'European oak', 'English oak']);
  assert.strictEqual(trace.reason, 'llm-disabled');
});

test('reviewExtractWikipediaNames: keeps a valid catch the regex missed (parsed-no-capture)', async () => {
  const { names, trace } = await reviewExtractWikipediaNames(HEDGE_OAK, {
    completer: completerReturning('["hedge oak"]')
  });
  assert.deepStrictEqual(names, ['hedge oak']);
  assert.deepStrictEqual(trace.kept, ['hedge oak']);
  assert.strictEqual(trace.catches[0].gate, 'parsed-no-capture');
});

test('reviewExtractWikipediaNames: keeps a catch from a gated (skipped) sentence', async () => {
  const { names, trace } = await reviewExtractWikipediaNames(BOUNDARY_OAK, {
    completer: completerReturning('["boundary oak"]')
  });
  assert.deepStrictEqual(names, ['boundary oak']);
  assert.strictEqual(trace.catches[0].gate, 'skipped');
});

test('reviewExtractWikipediaNames: drops a hallucination not present in the text', async () => {
  const { names, trace } = await reviewExtractWikipediaNames(HEDGE_OAK, {
    completer: completerReturning('["purple oak"]')
  });
  assert.deepStrictEqual(names, []);
  assert.deepStrictEqual(trace.dropped, [{ name: 'purple oak', reason: 'not-in-text' }]);
});

test('reviewExtractWikipediaNames: drops generic junk', async () => {
  const { names, trace } = await reviewExtractWikipediaNames(HEDGE_OAK, {
    completer: completerReturning('["tree", "hedge oak"]')
  });
  assert.deepStrictEqual(names, ['hedge oak']);
  assert.ok(trace.dropped.some((d) => d.name === 'tree' && d.reason === 'isGenericJunk'));
});

test('reviewExtractWikipediaNames: drops duplicates of base names (casing-insensitive)', async () => {
  const { names, trace } = await reviewExtractWikipediaNames(OAK, {
    completer: completerReturning('["English Oak"]')
  });
  assert.deepStrictEqual(names, ['pedunculate oak', 'European oak', 'English oak']);
  assert.deepStrictEqual(trace.dropped, [{ name: 'English Oak', reason: 'duplicate' }]);
});

test('reviewExtractWikipediaNames: dedupes between two proposed candidates', async () => {
  const { names } = await reviewExtractWikipediaNames(HEDGE_OAK, {
    completer: completerReturning('["hedge oak", "Hedge Oak"]')
  });
  assert.deepStrictEqual(names, ['hedge oak']);
});

test('reviewExtractWikipediaNames: malformed completion adds nothing', async () => {
  const { names, trace } = await reviewExtractWikipediaNames(HEDGE_OAK, {
    completer: completerReturning('Sorry, I could not find any.')
  });
  assert.deepStrictEqual(names, []);
  assert.strictEqual(trace.reason, 'llm-empty');
});

test('reviewExtractWikipediaNames: code-fenced JSON completion is parsed', async () => {
  const { names } = await reviewExtractWikipediaNames(HEDGE_OAK, {
    completer: completerReturning('```json\n["hedge oak"]\n```')
  });
  assert.deepStrictEqual(names, ['hedge oak']);
});

test('reviewExtractWikipediaNames: completer error degrades to regex-only', async () => {
  const boom = async () => {
    throw new Error('model exploded');
  };
  const { names, trace } = await reviewExtractWikipediaNames(HEDGE_OAK, { completer: boom });
  assert.deepStrictEqual(names, []);
  assert.match(trace.reason, /^completer-error: model exploded$/);
});

test('reviewExtractWikipediaNames: auto gate skips the LLM when base is already long', async () => {
  let called = false;
  const { names, trace } = await reviewExtractWikipediaNames(SAMBUCUS, {
    completer: async () => {
      called = true;
      return '[]';
    },
    gate: 'auto',
    autoGateMinBase: 4
  });
  assert.strictEqual(called, false);
  assert.strictEqual(trace.reason, 'gated-auto');
  assert.ok(names.length >= 6);
});

test('reviewExtractWikipediaNames: trace.catches attributes sentence and gate', async () => {
  const { trace } = await reviewExtractWikipediaNames(HEDGE_OAK, {
    completer: completerReturning('["hedge oak"]')
  });
  assert.strictEqual(trace.catches.length, 1);
  assert.strictEqual(trace.catches[0].name, 'hedge oak');
  assert.match(trace.catches[0].sentence, /known to farmers simply as/);
});

test('reviewExtractWikipediaNames: maxInputChars caps the extract sent to the model', async () => {
  let sent = '';
  await reviewExtractWikipediaNames(OAK + '\n\nExtra filler text that should never reach the model.', {
    completer: async (_system, user) => {
      sent = user;
      return '[]';
    },
    maxInputChars: 40
  });
  assert.ok(!sent.includes('Extra filler text'), 'filler beyond the cap should not reach the model');
});

// ─── parseNamesJson ─────────────────────────────────────────────────────────

test('parseNamesJson: strips prose around the array', () => {
  assert.deepStrictEqual(parseNamesJson('Here are the names: ["a", "b"] and that is all.'), ['a', 'b']);
});

test('parseNamesJson: strips JSON code fences', () => {
  assert.deepStrictEqual(parseNamesJson('```json\n["a"]\n```'), ['a']);
});

test('parseNamesJson: non-array or unparseable returns empty', () => {
  assert.deepStrictEqual(parseNamesJson('{"a":1}'), []);
  assert.deepStrictEqual(parseNamesJson('no brackets here'), []);
  assert.deepStrictEqual(parseNamesJson(null), []);
  assert.deepStrictEqual(parseNamesJson(''), []);
});

// ─── verifyCandidate ────────────────────────────────────────────────────────

test('verifyCandidate: rejects abbreviated binomials and CJK', () => {
  assert.strictEqual(verifyCandidate('Q. robur', 'q. robur'.toLowerCase(), new Set()).dropped, 'abbreviated-binomial');
  assert.strictEqual(verifyCandidate('橡树', '橡树'.toLowerCase(), new Set()).dropped, 'hasCJK');
});