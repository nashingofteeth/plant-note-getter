const { test } = require('node:test');
const assert = require('node:assert');
const { extractWikipediaCommonNames, traceExtraction } = require('../src/wiki-extract');

const CHAMOMILE =
  'Chamaemelum nobile, commonly known as chamomile (also spelled camomile), is a low perennial plant found in dry fields and around gardens and cultivated grounds in Europe, North America, and South America.';

const HAWTHORN =
  'Crataegus rhipidophylla is a species of hawthorn which occurs naturally from southern Scandinavia and the Baltic region to France, the Balkan Peninsula, Turkey, Caucasia, and Ukraine. It is poorly known as a landscape and garden plant, but seems to have potential for those uses.';

const PLATANUS = 'Platanus ( PLAT-ən-əss) is a genus consisting of a small number of tree species.';

const SAMBUCUS =
  'Sambucus nigra is a temperate species of tree or shrub in the family Viburnaceae native to the Azores, Europe, and the Middle East. Common names include elder, elderberry, black elder, European elder, European elderberry, and European black elderberry.';

const OAK =
  'Quercus robur, pedunculate oak, European oak, or English oak, is a species of flowering plant in the beech and oak family, Fagaceae. The leaves are lanceolate and green. The flowers are catkins. This species is widely planted in parks.';

test('traceExtraction: names match extractWikipediaCommonNames output', () => {
  for (const text of [CHAMOMILE, SAMBUCUS, OAK, HAWTHORN, PLATANUS]) {
    const trace = traceExtraction(text);
    assert.deepStrictEqual(
      trace.names,
      extractWikipediaCommonNames(text),
      `Parity mismatch for "${text.slice(0, 40)}..."`
    );
  }
});

test('traceExtraction: captures carry the originating rule label', () => {
  const trace = traceExtraction(CHAMOMILE);
  assert.deepStrictEqual(trace.captures, [
    { name: 'chamomile', rule: 'R1' },
    { name: 'camomile', rule: 'R1' },
  ]);

  const sambucus = traceExtraction(SAMBUCUS);
  assert.ok(sambucus.captures.length === 6, 'all six elders captured');
  assert.ok(sambucus.captures.every((c) => c.rule === 'R12'), 'all labeled R12');
});

test('traceExtraction: rejected entries record the rule and the rejection reason', () => {
  const chamomile = traceExtraction(CHAMOMILE);
  assert.ok(
    chamomile.rejected.some((r) => r.name === 'chamomile' && r.rule === 'R8' && r.by === 'duplicate'),
    'expected R8 duplicate rejection for chamomile'
  );

  const hawthorn = traceExtraction(HAWTHORN);
  assert.ok(
    hawthorn.rejected.some((r) => r.name === 'landscape' && r.rule === 'R41' && r.by === 'isGenericJunk'),
    'expected R41 junk rejection for "landscape"'
  );

  const platanus = traceExtraction(PLATANUS);
  assert.ok(
    platanus.rejected.some((r) => r.name === 'PLAT-ən-əss' && r.rule === 'R6c' && r.by === 'isPronunciationNotation'),
    'expected R6c pronunciation rejection'
  );
});

test('traceExtraction: rejected entries never leak into names', () => {
  const hawthorn = traceExtraction(HAWTHORN);
  assert.deepStrictEqual(hawthorn.names, []);
  assert.deepStrictEqual(hawthorn.captures, []);

  const platanus = traceExtraction(PLATANUS);
  assert.deepStrictEqual(platanus.names, []);
  assert.deepStrictEqual(platanus.captures, []);
});

test('traceExtraction: skippedSentences lists gated non-taxonomic sentences', () => {
  const trace = traceExtraction(OAK);
  assert.deepStrictEqual(trace.skippedSentences, [
    { sentence: 'The leaves are lanceolate and green.' },
    { sentence: 'The flowers are catkins.' },
    { sentence: 'This species is widely planted in parks.' },
  ]);
});
