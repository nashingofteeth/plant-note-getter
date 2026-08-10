const { test } = require('node:test');
const assert = require('node:assert');

// Stub the API functions BEFORE names.js loads, so its destructured refs
// point at the stubs (deterministic, no API calls).
const commonNames = require('../src/common-names-fetch');
commonNames.fetchGbifCommonNames = async () => [];
commonNames.fetchWikipediaCommonNames = async () => [];
const GBIF_STUB = commonNames.fetchGbifCommonNames;
const WIKI_STUB = commonNames.fetchWikipediaCommonNames;

function stubCommonNames({ gbif = [], wikipedia = [] } = {}) {
  commonNames.fetchGbifCommonNames = async () => [...gbif];
  commonNames.fetchWikipediaCommonNames = async () => [...wikipedia];
}

function resetStubs() {
  commonNames.fetchGbifCommonNames = GBIF_STUB;
  commonNames.fetchWikipediaCommonNames = WIKI_STUB;
}

const { collectCommonNames, buildAliases } = require('../src/names');

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

test('collectCommonNames: no Wikipedia fetch when wikipediaTitle missing', async () => {
  stubCommonNames({ wikipedia: ['should not appear'] });
  const entity = {
    id: 'Q1',
    scientificName: 'Test thing',
    commonNames: ['wikidata name'],
    aliases: []
  };
  const { names, bySource } = await collectCommonNames(entity, []);
  assert.deepStrictEqual(names, ['wikidata name']);
  assert.strictEqual(bySource.wikipedia, undefined);
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
