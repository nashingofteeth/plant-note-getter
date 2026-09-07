const { test } = require('node:test');
const assert = require('node:assert');
const {
  reviewWikipediaNames,
  parseNamesJson,
  parseReviewJson,
  buildPrompt,
  SYSTEM_PROMPT,
  REVIEWER_JSON_SCHEMA
} = require('../src/llm-reviewer');

const BASE = ['pedunculate oak', 'European oak', 'English oak'];
const EXTRACT =
  'Quercus robur, pedunculate oak, European oak, or English oak, is a species of flowering plant. ' +
  'In North America it is often called the "boundary oak".';

function completerReturning(text) {
  return async () => text;
}

test('reviewWikipediaNames: no completer returns the base list unchanged', async () => {
  const { names, added, removed, reason } = await reviewWikipediaNames(
    { extract: EXTRACT, baseNames: BASE },
    { completer: null }
  );
  assert.deepStrictEqual(names, BASE);
  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(removed, []);
  assert.strictEqual(reason, 'llm-disabled');
});

test('reviewWikipediaNames: no extract returns the base list unchanged', async () => {
  const { names, reason } = await reviewWikipediaNames(
    { extract: '', baseNames: BASE },
    { completer: completerReturning('["hedge oak"]') }
  );
  assert.deepStrictEqual(names, BASE);
  assert.strictEqual(reason, 'llm-disabled');
});

test('reviewWikipediaNames: applies adds (appended, base order preserved)', async () => {
  const { names, added, removed, reason } = await reviewWikipediaNames(
    { extract: EXTRACT, baseNames: [] },
    { completer: completerReturning('["boundary oak"]') }
  );
  assert.deepStrictEqual(names, ['boundary oak']);
  assert.deepStrictEqual(added, ['boundary oak']);
  assert.deepStrictEqual(removed, []);
  assert.strictEqual(reason, 'llm-reviewed');
});

test('reviewWikipediaNames: base names are kept in order with adds appended', async () => {
  const { names } = await reviewWikipediaNames(
    { extract: EXTRACT, baseNames: BASE },
    { completer: completerReturning('["boundary oak"]') }
  );
  assert.deepStrictEqual(names, [...BASE, 'boundary oak']);
});

test('reviewWikipediaNames: applies removes (base casing reported, category passthrough)', async () => {
  const text =
    'Pinus sylvestris, the scots pine, is a species of conifer. Common names include scots pine and lanceolate.';
  const { names, added, removed } = await reviewWikipediaNames(
    { extract: text, baseNames: ['scots pine', 'lanceolate'] },
    {
      completer: completerReturning(
        JSON.stringify({ add: [], remove: [{ name: 'Lanceolate', category: 'morphological' }] })
      )
    }
  );
  assert.deepStrictEqual(names, ['scots pine']);
  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(removed, [{ name: 'lanceolate', category: 'morphological' }]);
});

test('reviewWikipediaNames: remove of a name outside the base list is ignored', async () => {
  const { names, removed } = await reviewWikipediaNames(
    { extract: EXTRACT, baseNames: BASE },
    {
      completer: completerReturning(
        JSON.stringify({ add: [], remove: [{ name: 'purple pine', category: 'generic' }] })
      )
    }
  );
  assert.deepStrictEqual(names, BASE);
  assert.deepStrictEqual(removed, []);
});

test('reviewWikipediaNames: category is informational — unknown category still applied', async () => {
  const { names, removed } = await reviewWikipediaNames(
    { extract: EXTRACT, baseNames: ['lanceolate'] },
    {
      completer: completerReturning(
        JSON.stringify({ add: [], remove: [{ name: 'lanceolate', category: 'made-up' }] })
      )
    }
  );
  assert.deepStrictEqual(names, []);
  assert.deepStrictEqual(removed, [{ name: 'lanceolate', category: 'made-up' }]);
});

test('reviewWikipediaNames: duplicate removes collapse to one', async () => {
  const { names, removed } = await reviewWikipediaNames(
    { extract: EXTRACT, baseNames: ['lanceolate', 'scots pine'] },
    {
      completer: completerReturning(
        JSON.stringify({
          add: [],
          remove: [
            { name: 'lanceolate', category: 'morphological' },
            { name: 'Lanceolate', category: 'generic' }
          ]
        })
      )
    }
  );
  assert.deepStrictEqual(names, ['scots pine']);
  assert.deepStrictEqual(removed, [{ name: 'lanceolate', category: 'morphological' }]);
});

test('reviewWikipediaNames: add duplicate of a base name is skipped (case-insensitive)', async () => {
  const { names, added } = await reviewWikipediaNames(
    { extract: EXTRACT, baseNames: BASE },
    { completer: completerReturning('["English Oak"]') }
  );
  assert.deepStrictEqual(names, BASE);
  assert.deepStrictEqual(added, []);
});

test('reviewWikipediaNames: duplicate adds collapse to one', async () => {
  const { names, added } = await reviewWikipediaNames(
    { extract: EXTRACT, baseNames: [] },
    { completer: completerReturning('["hedge oak", "Hedge Oak"]') }
  );
  assert.deepStrictEqual(names, ['hedge oak']);
  assert.deepStrictEqual(added, ['hedge oak']);
});

test('reviewWikipediaNames: malformed completion changes nothing', async () => {
  const { names, added, removed, reason } = await reviewWikipediaNames(
    { extract: EXTRACT, baseNames: BASE },
    { completer: completerReturning('Sorry, I could not find any.') }
  );
  assert.deepStrictEqual(names, BASE);
  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(removed, []);
  assert.strictEqual(reason, 'llm-empty');
});

test('reviewWikipediaNames: empty arrays change nothing', async () => {
  const { names, reason } = await reviewWikipediaNames(
    { extract: EXTRACT, baseNames: BASE },
    { completer: completerReturning('{"add":[],"remove":[]}') }
  );
  assert.deepStrictEqual(names, BASE);
  assert.strictEqual(reason, 'llm-empty');
});

test('reviewWikipediaNames: code-fenced JSON completion is parsed', async () => {
  const { names } = await reviewWikipediaNames(
    { extract: EXTRACT, baseNames: [] },
    { completer: completerReturning('```json\n["hedge oak"]\n```') }
  );
  assert.deepStrictEqual(names, ['hedge oak']);
});

test('reviewWikipediaNames: completer error returns the base list unchanged', async () => {
  const boom = async () => {
    throw new Error('model exploded');
  };
  const { names, added, removed, reason } = await reviewWikipediaNames(
    { extract: EXTRACT, baseNames: BASE },
    { completer: boom }
  );
  assert.deepStrictEqual(names, BASE);
  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(removed, []);
  assert.match(reason, /^completer-error: model exploded$/);
});

test('reviewWikipediaNames: maxInputChars caps the extract sent to the model', async () => {
  let sent = '';
  await reviewWikipediaNames(
    {
      extract: EXTRACT + '\n\nExtra filler text that should never reach the model.',
      baseNames: BASE
    },
    {
      completer: async (_system, user) => {
        sent = user;
        return '[]';
      },
      maxInputChars: 40
    }
  );
  assert.ok(!sent.includes('Extra filler text'), 'filler beyond the cap should not reach the model');
  assert.ok(sent.includes('pedunculate oak'), 'base list reaches the model');
});

test('reviewWikipediaNames: passes the JSON schema to the completer', async () => {
  const seen = [];
  const completer = async (system, user, options) => {
    seen.push({ system, user, options });
    return '{"add":[],"remove":[]}';
  };
  await reviewWikipediaNames({ extract: EXTRACT, baseNames: [] }, { completer });
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].system, SYSTEM_PROMPT);
  assert.ok(seen[0].user.includes('boundary oak'));
  assert.deepStrictEqual(seen[0].options, { jsonSchema: REVIEWER_JSON_SCHEMA });
});

test('buildPrompt: includes the extract and the base list', () => {
  const prompt = buildPrompt('Some wiki text.', ['oak', 'pine']);
  assert.ok(prompt.includes('Some wiki text.'));
  assert.ok(prompt.includes('oak, pine'));
  const empty = buildPrompt('Some wiki text.', []);
  assert.ok(empty.includes('none'));
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

// ─── REVIEWER_JSON_SCHEMA ─────────────────────────────────────────────────

test('REVIEWER_JSON_SCHEMA: {add, remove} contract; category is a free string', () => {
  assert.strictEqual(REVIEWER_JSON_SCHEMA.type, 'object');
  assert.deepStrictEqual(REVIEWER_JSON_SCHEMA.required, ['add', 'remove']);
  assert.strictEqual(REVIEWER_JSON_SCHEMA.properties.add.type, 'array');
  const removeItems = REVIEWER_JSON_SCHEMA.properties.remove.items;
  assert.deepStrictEqual(removeItems.required, ['name']);
  assert.strictEqual(removeItems.properties.category.type, 'string');
  assert.strictEqual(removeItems.properties.category.enum, undefined);
});

test('SYSTEM_PROMPT describes the add/remove contract and exclusions', () => {
  assert.match(SYSTEM_PROMPT, /'add'/);
  assert.match(SYSTEM_PROMPT, /'remove'/);
  assert.match(SYSTEM_PROMPT, /scientific \(Latin\) names/);
  assert.match(SYSTEM_PROMPT, /fo\., var\., subsp\./);
});
