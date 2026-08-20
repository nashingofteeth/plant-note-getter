const { test } = require('node:test');
const assert = require('node:assert');
const {
  reviewExtractWikipediaNames,
  parseNamesJson,
  parseReviewJson,
  verifyCandidate,
  verifyVeto,
  REJECT_CATEGORIES
} = require('../src/llm-reviewer');

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

// ─── noise-rejection (veto) pass ────────────────────────────────────────────

const PINE_NOISE =
  'Pinus sylvestris, the scots pine, is a species of conifer. Common names include scots pine and lanceolate.';

test('reviewExtractWikipediaNames: removes a base name the LLM vetoes (allowlisted category)', async () => {
  const { names, trace } = await reviewExtractWikipediaNames(PINE_NOISE, {
    completer: completerReturning(
      JSON.stringify({ add: [], remove: [{ name: 'lanceolate', category: 'morphological' }] })
    )
  });
  assert.deepStrictEqual(names, ['scots pine']);
  assert.deepStrictEqual(trace.vetoed, ['lanceolate']);
  assert.strictEqual(trace.removals.length, 1);
  assert.strictEqual(trace.removals[0].name, 'lanceolate');
  assert.strictEqual(trace.removals[0].category, 'morphological');
});

test('reviewExtractWikipediaNames: ignores a veto whose name the regex did not produce', async () => {
  const { names, trace } = await reviewExtractWikipediaNames(PINE_NOISE, {
    completer: completerReturning(
      JSON.stringify({ add: [], remove: [{ name: 'purple pine', category: 'generic' }] })
    )
  });
  assert.deepStrictEqual(names, ['scots pine', 'lanceolate']);
  assert.deepStrictEqual(trace.vetoIgnored, [{ name: 'purple pine', reason: 'not-a-base-name' }]);
  assert.deepStrictEqual(trace.vetoed, []);
});

test('reviewExtractWikipediaNames: ignores a veto with an unknown category', async () => {
  const { names, trace } = await reviewExtractWikipediaNames(PINE_NOISE, {
    completer: completerReturning(
      JSON.stringify({ add: [], remove: [{ name: 'lanceolate', category: 'made-up' }] })
    )
  });
  assert.deepStrictEqual(names, ['scots pine', 'lanceolate']);
  assert.deepStrictEqual(trace.vetoIgnored, [
    { name: 'lanceolate', reason: 'unknown-category:made-up' }
  ]);
});

test('reviewExtractWikipediaNames: malformed removal entry is ignored', async () => {
  const { names, trace } = await reviewExtractWikipediaNames(PINE_NOISE, {
    completer: completerReturning(JSON.stringify({ add: [], remove: [{ noName: 1 }] }))
  });
  assert.deepStrictEqual(names, ['scots pine', 'lanceolate']);
  assert.deepStrictEqual(trace.vetoed, []);
});

test('reviewExtractWikipediaNames: caps the number of vetoes per article', async () => {
  const text =
    'Pinus sylvestris, the scots pine, is a conifer. Common names include scots pine, lanceolate and needle.';
  const { names, trace } = await reviewExtractWikipediaNames(text, {
    completer: completerReturning(
      JSON.stringify({
        add: [],
        remove: [
          { name: 'lanceolate', category: 'morphological' },
          { name: 'needle', category: 'morphological' }
        ]
      })
    ),
    rejectMax: 1
  });
  assert.deepStrictEqual(names, ['scots pine', 'needle']);
  assert.deepStrictEqual(trace.vetoed, ['lanceolate']);
  assert.deepStrictEqual(trace.vetoIgnored, [{ name: 'needle', reason: 'over-cap' }]);
});

test('reviewExtractWikipediaNames: rejectEnabled=false keeps all base names (add-only)', async () => {
  const { names, trace } = await reviewExtractWikipediaNames(PINE_NOISE, {
    completer: completerReturning(
      JSON.stringify({ add: [], remove: [{ name: 'lanceolate', category: 'morphological' }] })
    ),
    rejectEnabled: false
  });
  assert.deepStrictEqual(names, ['scots pine', 'lanceolate']);
  assert.deepStrictEqual(trace.vetoed, []);
});

test('reviewExtractWikipediaNames: broken-capture noise is removed and attributed', async () => {
  const text =
    'Quercus robur is a species of flowering plant. In North America it is often called the "boundary oak" by local woodworkers.';
  const leaky = 'boundary oak" by local woodworkers';
  const { names, trace } = await reviewExtractWikipediaNames(text, {
    completer: completerReturning(
      JSON.stringify({ add: [], remove: [{ name: leaky, category: 'broken-capture' }] })
    )
  });
  assert.deepStrictEqual(names, []);
  assert.strictEqual(trace.removals.length, 1);
  assert.strictEqual(trace.removals[0].category, 'broken-capture');
  assert.match(trace.removals[0].sentence, /called the/);
});

// ─── parseReviewJson ────────────────────────────────────────────────────────

test('parseReviewJson: parses the object shape { add, remove }', () => {
  assert.deepStrictEqual(
    parseReviewJson('{"add":["a"],"remove":[{"name":"b","category":"generic"}]}'),
    { add: ['a'], remove: [{ name: 'b', category: 'generic' }] }
  );
});

test('parseReviewJson: bare array response is treated as add-only (backward compat)', () => {
  assert.deepStrictEqual(parseReviewJson('["a", "b"]'), { add: ['a', 'b'], remove: [] });
});

test('parseReviewJson: strips code fences and normalizes categories', () => {
  assert.deepStrictEqual(
    parseReviewJson('```json\n{"add":[],"remove":[{"name":"b","category":"Broken-Capture"}]}\n```'),
    { add: [], remove: [{ name: 'b', category: 'broken-capture' }] }
  );
});

test('parseReviewJson: unparseable or non-object returns empty', () => {
  assert.deepStrictEqual(parseReviewJson('nope'), { add: [], remove: [] });
  assert.deepStrictEqual(parseReviewJson(null), { add: [], remove: [] });
});

// ─── verifyVeto ─────────────────────────────────────────────────────────────

test('verifyVeto: enforces base-name match and allowlisted category', () => {
  const baseKeys = new Set(['scots pine'.toLowerCase()]);
  assert.deepStrictEqual(verifyVeto({ name: 'Scots Pine', category: 'generic' }, baseKeys), {
    vetoed: true
  });
  assert.deepStrictEqual(verifyVeto({ name: 'nope', category: 'generic' }, baseKeys), {
    ignored: 'not-a-base-name'
  });
  assert.deepStrictEqual(verifyVeto({ name: 'scots pine', category: 'nonsense' }, baseKeys), {
    ignored: 'unknown-category:nonsense'
  });
});

test('REJECT_CATEGORIES allows the expected noise classes', () => {
  assert.deepStrictEqual(
    [...REJECT_CATEGORIES].sort(),
    ['broken-capture', 'generic', 'geographic', 'morphological', 'procedural']
  );
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