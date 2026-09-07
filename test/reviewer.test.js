const { test } = require('node:test');
const assert = require('node:assert');
const {
  reviewExtractWikipediaNames,
  parseNamesJson,
  parseReviewJson,
  verifyCandidate,
  verifyVeto,
  SYSTEM_PROMPT,
  REVIEWER_JSON_SCHEMA,
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

test('reviewExtractWikipediaNames: clean regex capture stands; stale broken-capture veto is ignored', async () => {
  const text =
    'Quercus robur is a species of flowering plant. In North America it is often called the "boundary oak" by local woodworkers.';
  const leaky = 'boundary oak" by local woodworkers';
  const { names, trace } = await reviewExtractWikipediaNames(text, {
    completer: completerReturning(
      JSON.stringify({ add: [], remove: [{ name: leaky, category: 'broken-capture' }] })
    )
  });
  // The regex now captures the name cleanly (no stray quote), so the stale
  // leaky veto no longer key-matches a base name and is ignored.
  assert.deepStrictEqual(names, ['boundary oak by local woodworkers']);
  assert.deepStrictEqual(trace.vetoed, []);
  assert.deepStrictEqual(trace.vetoIgnored, [{ name: leaky, reason: 'not-a-base-name' }]);
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

// ─── eval-driven gates (Elaeis/Lagenaria vault samples) ────────────────────

test('verifyCandidate: drops infraspecific Latin forms (fo./var./subsp.)', () => {
  const text =
    'elais guineensis fo. dura and elais guineensis var. pisifera grow here. ' +
    'pinus ponderosa subsp. benthamiana stands tall.';
  assert.strictEqual(verifyCandidate('Elais guineensis fo. dura', text, new Set()).dropped, 'latin-form');
  assert.strictEqual(verifyCandidate('Elais guineensis var. pisifera', text, new Set()).dropped, 'latin-form');
  assert.strictEqual(verifyCandidate('Pinus ponderosa subsp. benthamiana', text, new Set()).dropped, 'latin-form');
});

test('verifyCandidate: drops geographic feature phrases but keeps plant nouns', () => {
  const text =
    'renamed the bight of biafra. called the palm oil coast by europeans. ' +
    'bay rum is fragrant. the coast redwood towers. mountain laurel blooms. ' +
    'the coast live oak stands.';
  assert.strictEqual(verifyCandidate('Bight of Biafra', text, new Set()).dropped, 'isGeographicJunk');
  assert.strictEqual(verifyCandidate('Palm oil coast', text, new Set()).dropped, 'isGeographicJunk');
  assert.ok(verifyCandidate('Bay rum', text, new Set()).name);
  assert.ok(verifyCandidate('coast redwood', text, new Set()).name);
  assert.ok(verifyCandidate('mountain laurel', text, new Set()).name);
  assert.ok(verifyCandidate('Coast live oak', text, new Set()).name);
});

test('verifyCandidate: drops pest and disease terms', () => {
  const text =
    'the coconut rhinoceros beetle bores into trunks. white rot kills buds. ' +
    'red ring disease spreads fast. bagworm moths defoliate. oil palm grows here.';
  assert.strictEqual(verifyCandidate('coconut rhinoceros beetle', text, new Set()).dropped, 'other-organism');
  assert.strictEqual(verifyCandidate('Bagworm moths', text, new Set()).dropped, 'other-organism');
  assert.strictEqual(verifyCandidate('white rot', text, new Set()).dropped, 'disease');
  assert.strictEqual(verifyCandidate('red ring disease', text, new Set()).dropped, 'disease');
  assert.ok(verifyCandidate('oil palm', text, new Set()).name);
});

// ─── REVIEWER_JSON_SCHEMA ─────────────────────────────────────────────────

test('REVIEWER_JSON_SCHEMA mirrors the {add, remove} contract and category allowlist', () => {
  assert.strictEqual(REVIEWER_JSON_SCHEMA.type, 'object');
  assert.deepStrictEqual(REVIEWER_JSON_SCHEMA.required, ['add', 'remove']);
  assert.strictEqual(REVIEWER_JSON_SCHEMA.properties.add.type, 'array');
  const removeItems = REVIEWER_JSON_SCHEMA.properties.remove.items;
  assert.deepStrictEqual(removeItems.required, ['name', 'category']);
  assert.deepStrictEqual(
    removeItems.properties.category.enum.sort(),
    [...REJECT_CATEGORIES].sort()
  );
});

test('reviewExtractWikipediaNames: passes the JSON schema to the completer', async () => {
  const seen = [];
  const completer = async (system, user, options) => {
    seen.push({ system, user, options });
    return '{"add":[],"remove":[]}';
  };
  const { names } = await reviewExtractWikipediaNames(BOUNDARY_OAK, { completer });
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].system, SYSTEM_PROMPT);
  assert.ok(seen[0].user.includes('boundary oak'));
  assert.deepStrictEqual(seen[0].options, { jsonSchema: REVIEWER_JSON_SCHEMA });
  assert.deepStrictEqual(names, []);
});