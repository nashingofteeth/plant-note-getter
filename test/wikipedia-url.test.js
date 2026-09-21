const { test } = require('node:test');
const assert = require('node:assert');
const { parseWikipediaUrl } = require('../src/utils');

test('parseWikipediaUrl: canonical https URL with underscores', () => {
  assert.deepStrictEqual(parseWikipediaUrl('https://en.wikipedia.org/wiki/Quercus_robur'), {
    lang: 'en',
    title: 'Quercus robur'
  });
});

test('parseWikipediaUrl: http and mobile subdomain', () => {
  assert.deepStrictEqual(parseWikipediaUrl('http://en.wikipedia.org/wiki/Populus'), {
    lang: 'en',
    title: 'Populus'
  });
  assert.deepStrictEqual(parseWikipediaUrl('https://en.m.wikipedia.org/wiki/Populus_tremuloides'), {
    lang: 'en',
    title: 'Populus tremuloides'
  });
});

test('parseWikipediaUrl: percent-encoded spaces and anchors', () => {
  assert.deepStrictEqual(parseWikipediaUrl('https://en.wikipedia.org/wiki/Eschscholzia%20californica'), {
    lang: 'en',
    title: 'Eschscholzia californica'
  });
  assert.deepStrictEqual(parseWikipediaUrl('https://en.wikipedia.org/wiki/Quercus_robur#Etymology'), {
    lang: 'en',
    title: 'Quercus robur'
  });
  assert.deepStrictEqual(parseWikipediaUrl('https://en.wikipedia.org/wiki/Quercus_robur?wprov=sfti1'), {
    lang: 'en',
    title: 'Quercus robur'
  });
});

test('parseWikipediaUrl: titles with special characters round-trip', () => {
  assert.deepStrictEqual(parseWikipediaUrl('https://en.wikipedia.org/wiki/Lysimachia_borealis'), {
    lang: 'en',
    title: 'Lysimachia borealis'
  });
  assert.deepStrictEqual(
    parseWikipediaUrl('https://en.wikipedia.org/wiki/Thymus_vulgaris_(page_does_not_exist)'),
    { lang: 'en', title: 'Thymus vulgaris (page does not exist)' }
  );
});

test('parseWikipediaUrl: non-English language is detected, not rejected', () => {
  assert.deepStrictEqual(parseWikipediaUrl('https://de.wikipedia.org/wiki/Stieleiche'), {
    lang: 'de',
    title: 'Stieleiche'
  });
});

test('parseWikipediaUrl: bare taxon names and non-wiki URLs return null', () => {
  assert.strictEqual(parseWikipediaUrl('Quercus robur'), null);
  assert.strictEqual(parseWikipediaUrl(''), null);
  assert.strictEqual(parseWikipediaUrl(null), null);
  assert.strictEqual(parseWikipediaUrl('https://en.wikipedia.org/w/index.php?title=Quercus_robur'), null);
  assert.strictEqual(parseWikipediaUrl('https://example.org/wiki/Quercus_robur'), null);
  assert.strictEqual(parseWikipediaUrl('https://en.wikipedia.org/wiki/'), null);
});

test('parseWikipediaUrl: surrounding whitespace is tolerated', () => {
  assert.deepStrictEqual(parseWikipediaUrl('  https://en.wikipedia.org/wiki/Quercus_robur  '), {
    lang: 'en',
    title: 'Quercus robur'
  });
});
