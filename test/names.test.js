const { test } = require('node:test');
const assert = require('node:assert');

// Enable the LLM reviewer for the wiring test below. config.js is loaded
// lazily inside collectCommonNames, so this must be set before the first
// call (stubs without `extract` never reach the reviewer, so the rest of
// the suite is unaffected).
process.env.LLM_ENABLED = 'true';

// Stub the API functions BEFORE names.js loads, so its destructured refs
// point at the stubs (deterministic, no API calls).
const commonNames = require('../src/common-names-fetch');
commonNames.fetchGbifCommonNames = async () => [];
commonNames.fetchWikipediaArticle = async () => null;
const GBIF_STUB = commonNames.fetchGbifCommonNames;
const WIKI_STUB = commonNames.fetchWikipediaArticle;

// Pre-require the lazy LLM modules so the stubs replace the cached exports
// names.js will pick up at call time.
const llmBackend = require('../src/llm-backend');
const reviewLog = require('../src/review-log');
const LLM_COMPLETER_STUB = llmBackend.getCompleter;
const REVIEW_LOG_STUB = reviewLog.appendReviewRecord;

function stubCommonNames({ gbif = [], wikipedia = [], extract = null } = {}) {
  commonNames.fetchGbifCommonNames = async () => [...gbif];
  commonNames.fetchWikipediaArticle = async (title) =>
    wikipedia.length > 0 || extract
      ? {
          wikipediaTitle: title,
          wikipediaUrl: `https://en.wikipedia.org/wiki/${title.replace(/ /g, '_')}`,
          extract,
          names: [...wikipedia]
        }
      : null;
}

function resetStubs() {
  commonNames.fetchGbifCommonNames = GBIF_STUB;
  commonNames.fetchWikipediaArticle = WIKI_STUB;
  llmBackend.getCompleter = LLM_COMPLETER_STUB;
  reviewLog.appendReviewRecord = REVIEW_LOG_STUB;
}

const { collectCommonNames, buildAliases } = require('../src/names');
const { normalizeNameKey } = require('../src/utils');

// ─── buildAliases ───────────────────────────────────────────────────────────

test('buildAliases: common names come first, then wikidata aliases', () => {
  const entity = { commonNames: ['second'], aliases: ['first'], scientificName: 'Quercus' };
  assert.deepStrictEqual(buildAliases(entity), ['second', 'first']);
});

test('buildAliases: case-insensitive dedup keeps first occurrence', () => {
  const entity = { commonNames: ['Oak', 'oak', 'OAK'], aliases: [], scientificName: 'X' };
  assert.deepStrictEqual(buildAliases(entity), ['Oak']);
});

test('buildAliases: scientific name excluded even with different casing', () => {
  const entity = { commonNames: [], aliases: ['quercus rubra', 'red oak'], scientificName: 'Quercus rubra' };
  assert.deepStrictEqual(buildAliases(entity), ['red oak']);
});

test('buildAliases: returns null when nothing to alias', () => {
  assert.strictEqual(buildAliases({ commonNames: [], aliases: [], scientificName: 'X' }), null);
  assert.strictEqual(buildAliases({ scientificName: 'X' }), null);
});

// ─── collectCommonNames ─────────────────────────────────────────────────────

test('collectCommonNames: P1843 first, then GBIF, then Wikipedia; provenance reported', async () => {
  stubCommonNames({ gbif: ['gbif name'], wikipedia: ['wiki name'] });
  const entity = {
    id: 'Q1',
    scientificName: 'Test thing',
    commonNames: ['wikidata name'],
    aliases: [],
    gbifId: 123,
    wikipediaTitle: 'Test thing'
  };
  const { names, bySource } = await collectCommonNames(entity, []);
  assert.deepStrictEqual(names, ['wikidata name', 'gbif name', 'wiki name']);
  assert.deepStrictEqual(bySource.wikidata, ['wikidata name']);
  assert.deepStrictEqual(bySource.wikidataAliases, []);
  assert.deepStrictEqual(bySource.gbif, ['gbif name']);
  assert.deepStrictEqual(bySource.wikipedia, ['wiki name']);
  resetStubs();
});

test('collectCommonNames: GBIF deduped against P1843 names (case-insensitive, article-insensitive)', async () => {
  stubCommonNames({ gbif: ['the Oak', 'Red Oak'] });
  const entity = {
    id: 'Q1',
    scientificName: 'Quercus rubra',
    commonNames: ['oak'],
    aliases: [],
    gbifId: 123
  };
  const { names, bySource } = await collectCommonNames(entity, []);
  assert.deepStrictEqual(names, ['oak', 'Red Oak']);
  assert.deepStrictEqual(bySource.gbif, ['the Oak', 'Red Oak']);
  resetStubs();
});

test('collectCommonNames: possessive variants deduped at merge (David vs David\'s)', async () => {
  stubCommonNames({ gbif: ["David's viburnum"] });
  const entity = {
    id: 'Q1',
    scientificName: 'Viburnum davidii',
    commonNames: ['David viburnum'],
    aliases: [],
    gbifId: 123
  };
  const { names } = await collectCommonNames(entity, []);
  assert.deepStrictEqual(names, ['David viburnum']);
  resetStubs();
});

test('collectCommonNames: Wikipedia casing wins over existing duplicate', async () => {
  stubCommonNames({ wikipedia: ['Red Oak'] });
  const entity = {
    id: 'Q1',
    scientificName: 'Quercus rubra',
    commonNames: ['red oak'],
    aliases: [],
    wikipediaTitle: 'Quercus rubra'
  };
  const { names, bySource } = await collectCommonNames(entity, []);
  assert.deepStrictEqual(names, ['Red Oak']);
  assert.deepStrictEqual(bySource.wikipedia, ['Red Oak']);
  resetStubs();
});

test('collectCommonNames: Wikipedia name deduped against GBIF name (casing wins)', async () => {
  stubCommonNames({ gbif: ['snowball tree'], wikipedia: ['Snowball tree'] });
  const entity = {
    id: 'Q1',
    scientificName: 'Viburnum opulus',
    commonNames: [],
    aliases: [],
    gbifId: 123,
    wikipediaTitle: 'Viburnum opulus'
  };
  const { names } = await collectCommonNames(entity, []);
  assert.deepStrictEqual(names, ['Snowball tree']);
  resetStubs();
});

test('collectCommonNames: no GBIF fetch when gbifId missing', async () => {
  stubCommonNames({ gbif: ['should not appear'] });
  const entity = {
    id: 'Q1',
    scientificName: 'Test thing',
    commonNames: ['wikidata name'],
    aliases: []
  };
  const { names, bySource } = await collectCommonNames(entity, []);
  assert.deepStrictEqual(names, ['wikidata name']);
  assert.strictEqual(bySource.gbif, undefined);
  resetStubs();
});

test('collectCommonNames: no Wikipedia fetch when no wikipediaTitle and no scientific name to fall back to', async () => {
  stubCommonNames({ wikipedia: ['should not appear'] });
  const entity = {
    id: 'Q1',
    commonNames: ['wikidata name'],
    aliases: []
  };
  const { names, bySource } = await collectCommonNames(entity, []);
  assert.deepStrictEqual(names, ['wikidata name']);
  assert.strictEqual(bySource.wikipedia, undefined);
  resetStubs();
});

test('collectCommonNames: falls back to scientific name when wikipediaTitle missing', async () => {
  stubCommonNames({ wikipedia: ['Baker cypress'] });
  const entity = {
    id: 'Q1',
    scientificName: 'Hesperocyparis bakeri',
    commonNames: [],
    aliases: []
  };
  const { names, bySource } = await collectCommonNames(entity, []);
  assert.strictEqual(entity.wikipediaTitle, 'Hesperocyparis bakeri');
  assert.strictEqual(entity.wikipediaUrl, 'https://en.wikipedia.org/wiki/Hesperocyparis_bakeri');
  assert.deepStrictEqual(bySource.wikipedia, ['Baker cypress']);
  assert.deepStrictEqual(names, ['Baker cypress']);
  resetStubs();
});

test('collectCommonNames: wikipediaTitle propagated from synonym candidate triggers Wikipedia fetch', async () => {
  stubCommonNames({ wikipedia: ['species common name'] });
  const primary = {
    id: 'Q1',
    scientificName: 'Saxegothaea',
    commonNames: [],
    aliases: [],
    taxonSynonymIds: ['Q2']
  };
  const candidate = {
    id: 'Q2',
    scientificName: 'Saxegothaea conspicua',
    commonNames: [],
    aliases: [],
    synonymOfIds: ['Q1'],
    wikipediaTitle: 'Saxegothaea'
  };
  const { names, bySource } = await collectCommonNames(primary, [candidate]);
  assert.deepStrictEqual(bySource.wikipedia, ['species common name']);
  assert.ok(names.includes('species common name'));
  resetStubs();
});

test('collectCommonNames: synonym common names merged from candidate entities', async () => {
  stubCommonNames({});
  const primary = {
    id: 'Q1',
    scientificName: 'Quercus rubra',
    commonNames: ['red oak'],
    aliases: [],
    taxonSynonymIds: ['Q2']
  };
  const candidate = {
    id: 'Q2',
    scientificName: 'Quercus borealis',
    commonNames: ['northern red oak'],
    aliases: [],
    synonymOfIds: ['Q1']
  };
  const { names, bySource } = await collectCommonNames(primary, [candidate]);
  assert.ok(names.includes('northern red oak'), 'synonym common name merged');
  assert.deepStrictEqual(bySource.wikidata, ['red oak', 'northern red oak']);
  resetStubs();
});

test('collectCommonNames: Wikidata aliases reported and included in final names', async () => {
  stubCommonNames({});
  const entity = {
    id: 'Q1',
    scientificName: 'Viburnum',
    commonNames: ['Guelder Rose', 'Snowball tree'],
    aliases: ['sweet viburnum'],
    gbifId: 2888580,
    wikipediaTitle: 'Viburnum'
  };
  const { names, bySource } = await collectCommonNames(entity, []);
  assert.deepStrictEqual(bySource.wikidataAliases, ['sweet viburnum']);
  assert.ok(names.includes('sweet viburnum'));
  resetStubs();
});

test('collectCommonNames: populate and interactive paths use same function (parity check)', async () => {
  stubCommonNames({ gbif: ['arrowwood'], wikipedia: [] });
  const entity = {
    id: 'Q1',
    scientificName: 'Viburnum',
    commonNames: ['Guelder Rose'],
    aliases: ['sweet viburnum'],
    gbifId: 2888580,
    wikipediaTitle: 'Viburnum'
  };
  const first = await collectCommonNames(entity, []);
  const entity2 = {
    id: 'Q1',
    scientificName: 'Viburnum',
    commonNames: ['Guelder Rose'],
    aliases: ['sweet viburnum'],
    gbifId: 2888580,
    wikipediaTitle: 'Viburnum'
  };
  const second = await collectCommonNames(entity2, []);
  assert.deepStrictEqual(first.names, second.names);
  assert.deepStrictEqual(first.bySource, second.bySource);
  resetStubs();
});

// ─── end-of-Wikipedia LLM review wiring ─────────────────────────────────────

test('collectCommonNames: review merged before return; logReview logs on demand', async () => {
  const logged = [];
  let reviewStarted = false;
  reviewLog.appendReviewRecord = (record, logPath) => logged.push({ record, logPath });
  llmBackend.getCompleter = async () =>
    async () =>
      JSON.stringify({
        add: ['llm catch'],
        remove: [{ name: 'regex noise', category: 'morphological' }]
      });
  stubCommonNames({ wikipedia: ['regex noise', 'keeper'], extract: 'Wiki text about the plant.' });
  const entity = {
    id: 'Q1',
    scientificName: 'Test thing',
    commonNames: ['wikidata name'],
    aliases: [],
    wikipediaTitle: 'Test thing'
  };
  const { names, bySource, logReview } = await collectCommonNames(entity, [], {
    onReviewStart: () => {
      reviewStarted = true;
    }
  });
  // Loading hook fired for the review round-trip.
  assert.ok(reviewStarted, 'onReviewStart should fire when the review begins');
  // Review already merged before return; diff reported per source.
  assert.deepStrictEqual(bySource.wikipediaBase, ['regex noise', 'keeper']);
  assert.deepStrictEqual(bySource.llmAdded, ['llm catch']);
  assert.deepStrictEqual(bySource.llmRemoved, ['regex noise']);
  assert.deepStrictEqual(bySource.wikipedia, ['keeper', 'llm catch']);
  assert.deepStrictEqual(names, ['wikidata name', 'keeper', 'llm catch']);
  // Nothing recorded until the caller logs.
  assert.strictEqual(logged.length, 0);
  assert.strictEqual(typeof logReview, 'function');
  logReview();
  assert.strictEqual(logged.length, 1);
  assert.deepStrictEqual(logged[0].record.llmAdded, ['llm catch']);
  assert.deepStrictEqual(logged[0].record.llmRemoved, [
    { name: 'regex noise', category: 'morphological' }
  ]);
  assert.deepStrictEqual(logged[0].record.baseNames, ['regex noise', 'keeper']);
  assert.ok(logged[0].record.extract.startsWith('Wiki text'));
  assert.ok(logged[0].logPath);
  resetStubs();
});

test('collectCommonNames: without logReview the applied review is recorded nowhere', async () => {
  const logged = [];
  reviewLog.appendReviewRecord = (record, logPath) => logged.push({ record, logPath });
  llmBackend.getCompleter = async () =>
    async () =>
      JSON.stringify({
        add: ['llm catch'],
        remove: [{ name: 'regex noise', category: 'morphological' }]
      });
  stubCommonNames({ wikipedia: ['regex noise', 'keeper'], extract: 'Wiki text about the plant.' });
  const entity = {
    id: 'Q1',
    scientificName: 'Test thing',
    commonNames: ['wikidata name'],
    aliases: [],
    wikipediaTitle: 'Test thing'
  };
  const { bySource } = await collectCommonNames(entity, []);
  assert.ok(bySource.llmAdded);
  assert.strictEqual(logged.length, 0);
  resetStubs();
});

test('collectCommonNames: review removals keep Wikidata-corroborated names', async () => {
  reviewLog.appendReviewRecord = () => {};
  llmBackend.getCompleter = async () =>
    async () =>
      JSON.stringify({
        add: [],
        remove: [
          { name: 'shared name', category: 'generic' },
          { name: 'wiki only', category: 'generic' }
        ]
      });
  stubCommonNames({ wikipedia: ['shared name', 'wiki only'], extract: 'Wiki text.' });
  const entity = {
    id: 'Q1',
    scientificName: 'Test thing',
    commonNames: ['shared name'],
    aliases: [],
    wikipediaTitle: 'Test thing'
  };
  const { logReview } = await collectCommonNames(entity, []);
  const keys = entity.commonNames.map(normalizeNameKey);
  // 'shared name' survives (corroborated by Wikidata); 'wiki only' is stripped.
  assert.ok(keys.includes(normalizeNameKey('shared name')));
  assert.ok(!keys.includes(normalizeNameKey('wiki only')));
  logReview();
  resetStubs();
});

test('collectCommonNames: review runs without callbacks; no proposal leaves logReview null', async () => {
  let completerCalled = false;
  reviewLog.appendReviewRecord = () => {
    throw new Error('should not log when the model proposes nothing');
  };
  llmBackend.getCompleter = async () =>
    async () => {
      completerCalled = true;
      return '[]';
    };
  stubCommonNames({ wikipedia: ['wiki name'], extract: 'Wiki text about the plant.' });
  const entity = {
    id: 'Q1',
    scientificName: 'Test thing',
    commonNames: [],
    aliases: [],
    wikipediaTitle: 'Test thing'
  };
  const { names, bySource, logReview } = await collectCommonNames(entity, []);
  assert.strictEqual(completerCalled, true);
  assert.strictEqual(bySource.llmAdded, undefined);
  assert.strictEqual(logReview, null);
  assert.deepStrictEqual(bySource.wikipedia, ['wiki name']);
  assert.deepStrictEqual(names, ['wiki name']);
  resetStubs();
});

test('collectCommonNames: no LLM review without extract (stubs stay deterministic)', async () => {
  let completerCalled = false;
  reviewLog.appendReviewRecord = () => {
    throw new Error('should not log without extract');
  };
  llmBackend.getCompleter = async () =>
    async () => {
      completerCalled = true;
      return '[]';
    };
  stubCommonNames({ wikipedia: ['wiki name'] });
  const entity = {
    id: 'Q1',
    scientificName: 'Test thing',
    commonNames: [],
    aliases: [],
    wikipediaTitle: 'Test thing'
  };
  const { names, bySource, logReview } = await collectCommonNames(entity, []);
  assert.strictEqual(completerCalled, false);
  assert.deepStrictEqual(bySource.wikipedia, ['wiki name']);
  assert.strictEqual(bySource.llmAdded, undefined);
  assert.strictEqual(logReview, null);
  assert.deepStrictEqual(names, ['wiki name']);
  resetStubs();
});
