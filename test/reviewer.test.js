const { test } = require('node:test');
const assert = require('node:assert');
const {
  reviewWikipediaNames,
  parseNamesJson,
  parseReviewJson,
  buildAddPrompt,
  buildRemovePrompt,
  ADD_SYSTEM_PROMPT,
  REMOVE_SYSTEM_PROMPT,
  REVIEWER_JSON_SCHEMA,
  REMOVE_JSON_SCHEMA
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
        JSON.stringify({ add: [], remove: [{ name: 'Lanceolate', quote: '', category: 'morphological' }] })
      )
    }
  );
  assert.deepStrictEqual(names, ['scots pine']);
  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(removed, [{ name: 'lanceolate', quote: '', category: 'morphological' }]);
});

test('reviewWikipediaNames: remove of a name outside the base list is ignored', async () => {
  const { names, removed } = await reviewWikipediaNames(
    { extract: EXTRACT, baseNames: BASE },
    {
      completer: completerReturning(
        JSON.stringify({ add: [], remove: [{ name: 'purple pine', quote: '', category: 'generic' }] })
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
        JSON.stringify({ add: [], remove: [{ name: 'lanceolate', quote: '', category: 'made-up' }] })
      )
    }
  );
  assert.deepStrictEqual(names, []);
  assert.deepStrictEqual(removed, [{ name: 'lanceolate', quote: '', category: 'made-up' }]);
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
  assert.deepStrictEqual(removed, [{ name: 'lanceolate', quote: '', category: 'morphological' }]);
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

test('reviewWikipediaNames: two passes, both with schema and taxon grounding', async () => {
  const seen = [];
  const completer = async (system, user, options) => {
    seen.push({ system, user, options });
    return '{"add":[],"remove":[]}';
  };
  await reviewWikipediaNames(
    { extract: EXTRACT, baseNames: BASE, taxon: 'Quercus robur' },
    { completer }
  );
  assert.strictEqual(seen.length, 2);
  // Pass 1: remove, over the full base list.
  assert.strictEqual(seen[0].system, REMOVE_SYSTEM_PROMPT);
  assert.ok(seen[0].user.includes('pedunculate oak'));
  assert.ok(seen[0].user.includes('Quercus robur'));
  // Pass 2: add, over the (unchanged) list.
  assert.strictEqual(seen[1].system, ADD_SYSTEM_PROMPT);
  assert.ok(seen[1].user.includes('boundary oak'));
  assert.ok(seen[1].user.includes('Quercus robur'));
  assert.deepStrictEqual(seen[0].options, { jsonSchema: REMOVE_JSON_SCHEMA });
  assert.deepStrictEqual(seen[1].options, { jsonSchema: REVIEWER_JSON_SCHEMA });
});

test('reviewWikipediaNames: add pass sees the base list (no pass-contradiction)', async () => {
  const users = [];
  const completer = async (system, user) => {
    users.push(user);
    if (system === REMOVE_SYSTEM_PROMPT) {
      return JSON.stringify({ add: [], remove: [{ name: 'junk', category: 'generic' }] });
    }
    return '["fresh name"]';
  };
  const { names, added, removed } = await reviewWikipediaNames(
    { extract: EXTRACT, baseNames: ['keeper', 'junk'] },
    { completer }
  );
  assert.strictEqual(users.length, 2);
  assert.ok(users[0].includes('keeper, junk'));
  // The add pass is shown the original list, so a removed name cannot be
  // re-proposed through dedup.
  assert.ok(users[1].includes('keeper, junk'));
  assert.deepStrictEqual(removed, [{ name: 'junk', quote: '', category: 'generic' }]);
  assert.deepStrictEqual(added, ['fresh name']);
  assert.deepStrictEqual(names, ['keeper', 'fresh name']);
});

test('reviewWikipediaNames: remove-pass verdicts — keep spares, remove applies, absent removes', async () => {
  const users = [];
  const completer = async (system, user) => {
    users.push(user);
    if (system === REMOVE_SYSTEM_PROMPT) {
      return JSON.stringify({
        remove: [
          { name: 'keeper', verdict: 'keep', quote: '', category: '' },
          { name: 'junk', verdict: 'remove', quote: '', category: 'generic' },
          { name: 'legacy', category: 'broken-capture' }
        ]
      });
    }
    return '[]';
  };
  const { names, removed } = await reviewWikipediaNames(
    { extract: EXTRACT, baseNames: ['keeper', 'junk', 'legacy'] },
    { completer }
  );
  assert.deepStrictEqual(removed, [
    { name: 'junk', quote: '', category: 'generic' },
    { name: 'legacy', quote: '', category: 'broken-capture' }
  ]);
  assert.deepStrictEqual(names, ['keeper']);
});

test('reviewWikipediaNames: remove pass passes REMOVE_JSON_SCHEMA to the completer', async () => {
  const seen = [];
  const completer = async (system, user, options) => {
    seen.push({ system, options });
    return '{"remove":[]}';
  };
  await reviewWikipediaNames({ extract: EXTRACT, baseNames: BASE }, { completer });
  assert.strictEqual(seen[0].system, REMOVE_SYSTEM_PROMPT);
  assert.deepStrictEqual(seen[0].options, { jsonSchema: REMOVE_JSON_SCHEMA });
});

test('REMOVE_JSON_SCHEMA: per-entry verdict contract', () => {
  assert.strictEqual(REMOVE_JSON_SCHEMA.type, 'object');
  assert.deepStrictEqual(REMOVE_JSON_SCHEMA.required, ['remove']);
  const items = REMOVE_JSON_SCHEMA.properties.remove.items;
  assert.deepStrictEqual(items.required, ['name', 'verdict']);
  assert.deepStrictEqual(items.properties.verdict.enum, ['keep', 'remove']);
});

test('buildAddPrompt / buildRemovePrompt: taxon, extract, base list, and task line', () => {
  const add = buildAddPrompt('Some wiki text.', ['oak', 'pine'], 'Quercus robur');
  assert.ok(add.includes('Quercus robur'));
  assert.ok(add.includes('Some wiki text.'));
  assert.ok(add.includes('oak, pine'));
  assert.match(add, /"add"/);
  assert.match(add, /leave "remove" empty/);
  const remove = buildRemovePrompt('Some wiki text.', ['oak'], 'Quercus robur');
  assert.match(remove, /"remove"/);
  assert.match(remove, /leave "add" empty/);
  const empty = buildAddPrompt('Some wiki text.', [], 'Quercus robur');
  assert.ok(empty.includes('none'));
});

// ─── parseReviewJson ────────────────────────────────────────────────────────

test('parseReviewJson: parses the object shape { add, remove }', () => {
  assert.deepStrictEqual(
    parseReviewJson('{"add":["a"],"remove":[{"name":"b","category":"generic"}]}'),
    { add: ['a'], remove: [{ name: 'b', verdict: '', quote: '', category: 'generic' }] }
  );
});

test('parseReviewJson: carries per-entry verdict through', () => {
  assert.deepStrictEqual(
    parseReviewJson('{"add":[],"remove":[{"name":"b","verdict":"Keep","category":"generic"}]}'),
    { add: [], remove: [{ name: 'b', verdict: 'keep', quote: '', category: 'generic' }] }
  );
});

test('parseReviewJson: bare array response is treated as add-only (backward compat)', () => {
  assert.deepStrictEqual(parseReviewJson('["a", "b"]'), { add: ['a', 'b'], remove: [] });
});

test('parseReviewJson: strips code fences and normalizes categories', () => {
  assert.deepStrictEqual(
    parseReviewJson('```json\n{"add":[],"remove":[{"name":"b","category":"Broken-Capture"}]}\n```'),
    { add: [], remove: [{ name: 'b', verdict: '', quote: '', category: 'broken-capture' }] }
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

test('ADD_SYSTEM_PROMPT: scope, head-noun, and exclusion rules', () => {
  assert.match(ADD_SYSTEM_PROMPT, /FOR this\s+taxon itself/);
  assert.match(ADD_SYSTEM_PROMPT, /Fabaceae/);
  assert.match(ADD_SYSTEM_PROMPT, /'pea family', 'common oak'/);
  assert.match(ADD_SYSTEM_PROMPT, /'Summer Chocolate', 'Ishii Weeping', 'Pendula', 'Rosea'/);
  assert.match(ADD_SYSTEM_PROMPT, /'Ernest Wilson'/);
  assert.match(ADD_SYSTEM_PROMPT, /cultivars include' lists/);
  assert.match(ADD_SYSTEM_PROMPT, /'Darjeeling tea', 'Nilgiri tea'/);
  assert.match(ADD_SYSTEM_PROMPT, /never merge or splice/);
  assert.match(ADD_SYSTEM_PROMPT, /scientific Latin names/);
  assert.match(ADD_SYSTEM_PROMPT, /fo\., var\., subsp\./);
  assert.match(ADD_SYSTEM_PROMPT, /When unsure, leave it out/);
});

test('REMOVE_SYSTEM_PROMPT: verdict contract, categories, guardrails, keep-bias', () => {
  assert.match(REMOVE_SYSTEM_PROMPT, /decide keep or remove/);
  assert.match(REMOVE_SYSTEM_PROMPT, /one object per entry/);
  assert.match(REMOVE_SYSTEM_PROMPT, /'broken-capture'/);
  assert.match(REMOVE_SYSTEM_PROMPT, /starts with a verb, conjunction, or preposition/);
  assert.match(REMOVE_SYSTEM_PROMPT, /'from Verona'/);
  assert.match(REMOVE_SYSTEM_PROMPT, /'shadberries', 'sleeping tree' are genuine/);
  // Enumerated naming lists: no cherry-picking members.
  assert.match(
    REMOVE_SYSTEM_PROMPT,
    /commonly known as\s+licorice fern, many-footed fern, and sweet root/
  );
  assert.match(REMOVE_SYSTEM_PROMPT, /[Gg]enuine family or genus names/);
  assert.match(REMOVE_SYSTEM_PROMPT, /best-known name/);
  assert.match(REMOVE_SYSTEM_PROMPT, /'common' \+ head-noun forms/);
  assert.match(REMOVE_SYSTEM_PROMPT, /eastern hemlock-spruce/);
  assert.match(REMOVE_SYSTEM_PROMPT, /shared with another plant/);
  assert.match(REMOVE_SYSTEM_PROMPT, /'shadberry' \/ 'shadberries'/);
  assert.match(REMOVE_SYSTEM_PROMPT, /When unsure whether an entry is a genuine name, verdict keep/);
  assert.match(REMOVE_SYSTEM_PROMPT, /'cultivar'/);
  // Regional plant names are not geographic junk.
  assert.match(REMOVE_SYSTEM_PROMPT, /'Bight of Biafra'/);
  assert.match(REMOVE_SYSTEM_PROMPT, /'Russian olive', 'pruche du Canada', 'radiki', 'stamnagathi'/);
  // Eval-driven escape classes: Latin+cultivar strings, anatomy terms,
  // quote-wrapped captures, family-member fragments — and the guardrail
  // that plain-English cultivar vernaculars survive.
  assert.match(REMOVE_SYSTEM_PROMPT, /"Salix alba 'Vitellina-Tristis'"/);
  assert.match(REMOVE_SYSTEM_PROMPT, /'golden weeping willow'\) is a genuine regional name/);
  assert.match(REMOVE_SYSTEM_PROMPT, /'mouth', 'trigger hairs', 'utricles', 'bark',/);
  assert.match(REMOVE_SYSTEM_PROMPT, /'other members of the Scrophulariaceae'/);
});
