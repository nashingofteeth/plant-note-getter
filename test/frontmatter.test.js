const assert = require('node:assert');
const { parseFrontMatter, analyzeMissingProperties, updateFrontMatter, hasPlantTag, generateFrontMatter } = require('../src/frontmatter');
const labelMap = require('../label-map.json');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
    failed++;
  }
}

// ─── parseFrontMatter ───────────────────────────────────────────────────────

test('parseFrontMatter: returns null when no front matter delimiters', () => {
  assert.strictEqual(parseFrontMatter('No front matter here'), null);
});

test('parseFrontMatter: parses tags, scalars, and arrays from real note format', () => {
  const content = [
    '---',
    'tags:',
    '  - life/eukaryota/plantae/tracheophytes/spermatophytes/angiosperms',
    'aliases:',
    '  - California poppy',
    '  - golden poppy',
    'created: 2026-07-22',
    'modified: 2026-07-22',
    'rank: species',
    'wikipedia: https://en.wikipedia.org/wiki/Eschscholzia_californica',
    '---',
    '',
    '# Eschscholzia californica',
    ''
  ].join('\n');
  const fm = parseFrontMatter(content);
  assert.deepStrictEqual(fm.tags, ['life/eukaryota/plantae/tracheophytes/spermatophytes/angiosperms']);
  assert.deepStrictEqual(fm.aliases, ['California poppy', 'golden poppy']);
  assert.strictEqual(fm.rank, 'species');
  assert.strictEqual(fm.wikipedia, 'https://en.wikipedia.org/wiki/Eschscholzia_californica');
  assert.strictEqual(fm.created, '2026-07-22');
});

test('parseFrontMatter: YAML boolean true/false not treated as strings', () => {
  const fm = parseFrontMatter('---\nflag: true\n---\n');
  assert.strictEqual(fm.flag, true);
  assert.notStrictEqual(fm.flag, 'true');
});

test('parseFrontMatter: empty value becomes null', () => {
  const fm = parseFrontMatter('---\nwikipedia: \n---\n');
  assert.strictEqual(fm.wikipedia, null);
});

test('parseFrontMatter: empty array value becomes null', () => {
  const fm = parseFrontMatter('---\ntags: []\n---\n');
  assert.strictEqual(fm.tags, null);
});

test('parseFrontMatter: preserves URL colons and slashes', () => {
  const fm = parseFrontMatter('---\nwikipedia: https://en.wikipedia.org/wiki/Quercus_rubra\n---\n');
  assert.strictEqual(fm.wikipedia, 'https://en.wikipedia.org/wiki/Quercus_rubra');
});

// ─── hasPlantTag ────────────────────────────────────────────────────────────

test('hasPlantTag: true for plant tag', () => {
  assert.strictEqual(hasPlantTag({ tags: ['life/eukaryota/plantae/tracheophytes'] }), true);
});

test('hasPlantTag: false for empty tags array', () => {
  assert.strictEqual(hasPlantTag({ tags: [] }), false);
});

test('hasPlantTag: false when tags is not an array', () => {
  assert.strictEqual(hasPlantTag({ tags: 'life/eukaryota/plantae' }), false);
});

test('hasPlantTag: false for unrelated tag', () => {
  assert.strictEqual(hasPlantTag({ tags: ['some/other/tag'] }), false);
});

// ─── analyzeMissingProperties ───────────────────────────────────────────────

test('analyzeMissingProperties: detects all missing when empty front matter', () => {
  const fm = {};
  const { missing } = analyzeMissingProperties(fm);
  assert.ok(missing.includes('tags'));
  assert.ok(missing.includes('rank'));
  assert.ok(missing.includes('wikipedia'));
  assert.ok(missing.includes('aliases'));
});

test('analyzeMissingProperties: does not report present fields as missing', () => {
  const fm = {
    tags: ['life/eukaryota/plantae/tracheophytes'],
    rank: 'species',
    wikipedia: 'https://example.com',
    aliases: ['oak']
  };
  const entity = { rankLabel: 'species', wikipediaUrl: 'https://example.com', commonNames: ['oak'], scientificName: 'Quercus' };
  const { missing } = analyzeMissingProperties(fm, entity, [], {});
  assert.deepStrictEqual(missing, []);
});

test('analyzeMissingProperties: fills rank and wikipedia from entity', () => {
  const fm = { tags: ['life/eukaryota/plantae'] };
  const entity = { rankLabel: 'genus', wikipediaUrl: 'https://example.com' };
  const { updates } = analyzeMissingProperties(fm, entity, [], {});
  assert.strictEqual(updates.rank, 'genus');
  assert.strictEqual(updates.wikipedia, 'https://example.com');
});

test('analyzeMissingProperties: merges new aliases without dropping existing', () => {
  const fm = { tags: ['life/eukaryota/plantae'], rank: 'species', aliases: ['existing'] };
  const entity = { rankLabel: 'species', commonNames: ['existing', 'new name'], scientificName: 'Quercus' };
  const { missing, updates } = analyzeMissingProperties(fm, entity, [], {});
  assert.ok(missing.includes('aliases'));
  assert.deepStrictEqual(updates.aliases, ['existing', 'new name']);
});

test('analyzeMissingProperties: no alias update when entity has no common names', () => {
  const fm = { tags: ['life/eukaryota/plantae'], rank: 'species', aliases: ['existing'] };
  const entity = { rankLabel: 'species', commonNames: [], scientificName: 'Quercus' };
  const { missing } = analyzeMissingProperties(fm, entity, [], {});
  assert.ok(!missing.includes('aliases'));
});

test('analyzeMissingProperties: tags with wrong prefix are missing', () => {
  const fm = { tags: ['some/other/tag'] };
  const { missing } = analyzeMissingProperties(fm);
  assert.ok(missing.includes('tags'));
});

test('analyzeMissingProperties: does not add aliases when no new ones from entity', () => {
  const fm = { tags: ['life/eukaryota/plantae'], aliases: ['Oak', 'oak'] };
  const entity = { commonNames: ['oak'], scientificName: 'Quercus' };
  const { updates } = analyzeMissingProperties(fm, entity, [], {});
  // all entity aliases already present — updates should have no aliases key
  assert.strictEqual(updates.aliases, undefined);
});

// ─── updateFrontMatter ──────────────────────────────────────────────────────

test('updateFrontMatter: replaces tag array exactly', () => {
  const content = '---\ntags:\n  - old/tag\nrank: species\n---\n\nBody here\n';
  const result = updateFrontMatter(content, { tags: ['new/tag'] });
  assert.ok(result.includes('tags:'));
  assert.ok(result.includes('  - new/tag'));
  assert.ok(!result.includes('old/tag'));
  // body preserved
  assert.ok(result.includes('Body here'));
});

test('updateFrontMatter: replaces aliases exactly', () => {
  const content = '---\ntags:\n  - life/eukaryota/plantae\naliases:\n  - old name\n---\n\nBody\n';
  const result = updateFrontMatter(content, { aliases: ['new name', 'other'] });
  assert.ok(result.includes('aliases:'));
  assert.ok(result.includes('  - new name'));
  assert.ok(result.includes('  - other'));
  assert.ok(!result.includes('old name'));
});

test('updateFrontMatter: replaces scalar value', () => {
  const content = '---\ntags:\n  - life/eukaryota/plantae\nrank: genus\n---\n\nBody\n';
  const result = updateFrontMatter(content, { rank: 'species' });
  assert.ok(result.includes('rank: species'));
  assert.ok(!result.includes('rank: genus'));
});

test('updateFrontMatter: always refreshes modified date', () => {
  const content = '---\ntags:\n  - life/eukaryota/plantae\nmodified: 2020-01-01\n---\n';
  const result = updateFrontMatter(content, {});
  assert.ok(!result.includes('2020-01-01'));
  assert.ok(result.includes('modified:'));
});

test('updateFrontMatter: inserts new properties before created', () => {
  const content = '---\ntags:\n  - life/eukaryota/plantae\ncreated: 2026-07-22\n---\n';
  const result = updateFrontMatter(content, { wikipedia: 'https://example.com' });
  const wikiIdx = result.indexOf('wikipedia: https://example.com');
  const createdIdx = result.indexOf('created:');
  assert.ok(wikiIdx < createdIdx, 'wikipedia should come before created');
});

test('updateFrontMatter: passes through content with no front matter', () => {
  const content = 'No front matter here';
  assert.strictEqual(updateFrontMatter(content, { rank: 'genus' }), content);
});

test('updateFrontMatter: preserves full body after front matter', () => {
  const content = '---\ntags:\n  - life/eukaryota/plantae\n---\n\n# Heading\n\nParagraph one.\n\nParagraph two.\n';
  const result = updateFrontMatter(content, { rank: 'genus' });
  assert.ok(result.includes('# Heading'));
  assert.ok(result.includes('Paragraph one.'));
  assert.ok(result.includes('Paragraph two.'));
});

test('updateFrontMatter: output starts and ends with front matter delimiters', () => {
  const content = '---\ntags:\n  - life/eukaryota/plantae\n---\n\nBody\n';
  const result = updateFrontMatter(content, { rank: 'genus' });
  assert.ok(result.startsWith('---\n'));
  // find the closing ---
  const afterFirst = result.indexOf('---\n') + 4;
  const secondDash = result.indexOf('---', afterFirst);
  assert.ok(secondDash > 0, 'should have closing ---');
});

// ─── generateFrontMatter ────────────────────────────────────────────────────

test('generateFrontMatter: produces valid front matter block with all fields', () => {
  const entity = {
    id: 'Q123',
    rankLabel: 'genus',
    commonNames: [],
    aliases: [],
    scientificName: 'Testus',
    wikipediaUrl: 'https://example.com'
  };
  const ancestors = [
    { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q123', label: 'Testus', rankLabel: 'genus' }
  ];
  const fm = generateFrontMatter(entity, ancestors, {});
  assert.ok(fm.startsWith('---\n'));
  assert.ok(fm.includes('tags:'));
  assert.ok(fm.includes('life/eukaryota/plantae'));
  assert.ok(fm.includes('rank: genus'));
  assert.ok(fm.includes('wikipedia: https://example.com'));
  assert.ok(fm.includes('created:'));
  assert.ok(fm.includes('modified:'));
  // must end with closing --- plus blank line for body
  assert.ok(fm.endsWith('---\n\n'));
});

test('generateFrontMatter: omits rank and wikipedia when null', () => {
  const entity = {
    id: 'Q123',
    rankLabel: null,
    commonNames: [],
    aliases: [],
    scientificName: 'Testus',
    wikipediaUrl: null
  };
  const fm = generateFrontMatter(entity, [], {});
  assert.ok(!fm.includes('rank:'));
  assert.ok(!fm.includes('wikipedia:'));
});

test('generateFrontMatter: aliases with colons are quoted for YAML safety', () => {
  const entity = {
    id: 'Q123',
    rankLabel: 'species',
    commonNames: ['normal name', 'name: with colon'],
    aliases: [],
    scientificName: 'Testus',
    wikipediaUrl: null
  };
  const fm = generateFrontMatter(entity, [], {});
  assert.ok(fm.includes('  - normal name'));
  assert.ok(fm.includes('  - "name: with colon"'));
});

test('generateFrontMatter: produces parseable round-trip', () => {
  const entity = {
    id: 'Q158795',
    rankLabel: 'species',
    commonNames: ['red oak'],
    aliases: ['Quercus rubra'],
    scientificName: 'Quercus rubra',
    wikipediaUrl: 'https://en.wikipedia.org/wiki/Quercus_rubra'
  };
  const ancestors = [
    { id: 'Q756', label: 'plant', rankLabel: 'kingdom' },
    { id: 'Q27133', label: 'tracheophyte', rankLabel: 'division' },
    { id: 'Q147525', label: 'Quercus rubra', rankLabel: 'species' }
  ];
  const fm = generateFrontMatter(entity, ancestors, labelMap);
  const parsed = parseFrontMatter(fm);
  assert.ok(parsed, 'generated front matter should be parseable');
  assert.ok(parsed.tags[0].startsWith('life/eukaryota/plantae'), 'tag should start with plantae prefix');
  // buildAliases excludes the scientific name, so only 'red oak' survives
  assert.deepStrictEqual(parsed.aliases, ['red oak']);
  assert.strictEqual(parsed.rank, 'species');
  assert.strictEqual(parsed.wikipedia, 'https://en.wikipedia.org/wiki/Quercus_rubra');
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
process.exit(failed > 0 ? 1 : 0);
