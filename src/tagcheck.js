const fs = require('fs');
const path = require('path');
const { NOTE_ROOT, LABEL_MAP_PATH } = require('./config');
const { parseFrontMatter, hasPlantTag } = require('./frontmatter');
const { buildTagSegmentsWithOriginals } = require('./taxonomy');
const { loadLabelMap } = require('./utils');
const { searchTaxon, getEntityData, getParentChain } = require('./wikidata');

function getPlantNotesWithTags() {
  const files = fs.readdirSync(NOTE_ROOT);
  const tags = [];
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const fp = path.join(NOTE_ROOT, f);
    try {
      const content = fs.readFileSync(fp, 'utf-8');
      const fm = parseFrontMatter(content);
      if (fm && hasPlantTag(fm)) {
        for (const t of fm.tags) {
          if (t.startsWith('life/eukaryota/plantae')) {
            tags.push(t);
          }
        }
      }
    } catch {}
  }
  return tags;
}

function countPrefix(allTags, prefix) {
  return allTags.filter(t => t === prefix || t.startsWith(prefix + '/')).length;
}

const readline = require('readline');

function askYesNo(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
    });
  });
}

function analyzeHierarchy(tag) {
  const allTags = getPlantNotesWithTags();
  const segments = tag.split('/');
  const rows = [];
  let firstOnlyChild = null;

  for (let i = 0; i < segments.length; i++) {
    const prefix = segments.slice(0, i + 1).join('/');
    const count = countPrefix(allTags, prefix);
    rows.push({ segment: segments[i], depth: i, prefix, count });
    if (count <= 1 && firstOnlyChild === null) {
      firstOnlyChild = { segment: segments[i], depth: i, count };
    }
  }

  return { rows, firstOnlyChild, allTags, segments };
}

function printHierarchyRows(rows, firstOnlyChild, segments, tag, noteName) {
  console.log(`\nChecking hierarchy for: ${noteName}`);
  console.log(`Tag: ${tag}\n`);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const indent = i === 0 ? '' : '  '.repeat(i) + '└ ';
    let countStr;
    if (r.count === 0) countStr = '0 notes (unpopulated)';
    else if (r.count === 1) countStr = '1 note';
    else countStr = `${r.count} notes`;
    let line = `${indent}${r.segment} — ${countStr}`;
    if (r.count === 1) {
      line += '  ← only child';
    } else if (r.count === 0) {
      line += '  ← empty';
    }
    console.log(line);
  }
  console.log('');

  if (!firstOnlyChild) return;

  const isTerminal = firstOnlyChild.depth === segments.length - 1;

  if (isTerminal && firstOnlyChild.count === 0) {
    console.log(`No notes yet under "${firstOnlyChild.segment}" — this would be the first. Normal.`);
  } else if (isTerminal) {
    console.log(`Only child at terminal segment "${firstOnlyChild.segment}" — normal (only note in this taxon).`);
  } else if (firstOnlyChild.count === 0) {
    console.log(`${'─'.repeat(50)}`);
    console.log(`⚠  Empty branch at "${firstOnlyChild.segment}" (depth ${firstOnlyChild.depth})`);
    console.log(`   No existing notes use this path segment. Possible causes:`);
    console.log(`   • The label map is not skipping or normalizing this segment`);
    console.log(`   • Wikidata returned an intermediate clade not in your established convention`);
    console.log(`   • A spelling/typo mismatch in one of the tag segments`);
    console.log(`   • You're expanding into an unpopulated higher-rank branch`);
    console.log(`${'─'.repeat(50)}`);
  } else {
    console.log(`${'─'.repeat(50)}`);
    console.log(`⚠  Only child at "${firstOnlyChild.segment}" (depth ${firstOnlyChild.depth})`);
    console.log(`   Only one note exists on this path. Possible causes:`);
    console.log(`   • A spelling/typo mismatch in one of the tag segments`);
    console.log(`   • Wikidata returned an unexpected or new path`);
    console.log(`   • You're genuinely expanding into a sparse branch`);
    console.log(`${'─'.repeat(50)}`);
  }
}

function getUnrecognizedClades(rows, segments, allTags, originals) {
  const knownSegments = new Set();
  for (const t of allTags) {
    for (const s of t.split('/')) {
      knownSegments.add(s);
    }
  }

  return rows
    .filter(r => r.count === 0 && r.depth >= 3 && r.depth < segments.length - 1)
    .filter(r => !knownSegments.has(r.segment))
    .map(r => originals && originals[r.depth] ? originals[r.depth] : r.segment)
    .filter(Boolean);
}

function addToLabelMap(labels) {
  const mapPath = LABEL_MAP_PATH;
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
  let addedCount = 0;
  for (const lbl of labels) {
    if (map[lbl] === undefined) {
      map[lbl] = null;
      addedCount++;
    }
  }
  if (addedCount > 0) {
    fs.writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n', 'utf-8');
  }
  return addedCount;
}

function rebuildTag(labelMap, ancestors, entityId) {
  const { segments } = buildTagSegmentsWithOriginals(ancestors, entityId, labelMap);
  return segments.join('/');
}

async function printHierarchy(tag, noteName, originals) {
  const { rows, firstOnlyChild, allTags, segments } = analyzeHierarchy(tag);
  printHierarchyRows(rows, firstOnlyChild, segments, tag, noteName);
  return rows;
}

async function checkAndPruneTag(tag, originals, noteName, autoApply, isNew, ancestors, entityId) {
  const { rows, firstOnlyChild, allTags, segments } = analyzeHierarchy(tag);
  printHierarchyRows(rows, firstOnlyChild, segments, tag, noteName);

  if (!firstOnlyChild || firstOnlyChild.count !== 0 || firstOnlyChild.depth === segments.length - 1) {
    return tag;
  }

  const unrecognized = getUnrecognizedClades(rows, segments, allTags, originals);
  if (unrecognized.length === 0) return tag;

  if (autoApply || isNew) {
    const unique = [...new Set(unrecognized)];
    console.log(`\nUnrecognized clades: ${unique.join(', ')}`);
    const shouldPrune = await askYesNo('Add these to label-map.json as null to skip? [y/N] ');
    if (!shouldPrune) return tag;

    const added = addToLabelMap(unique);
    if (added === 0) {
      console.log('All labels already in map.');
      return tag;
    }

    console.log(`✓ Added ${added} entr${added > 1 ? 'ies' : 'y'} to label-map.json`);
    console.log('Rebuilding tag...\n');

    const newLabelMap = loadLabelMap(LABEL_MAP_PATH);
    const newTag = rebuildTag(newLabelMap, ancestors, entityId);
    console.log(`Rebuilt tag: ${newTag}\n`);

    const recheck = analyzeHierarchy(newTag);
    printHierarchyRows(recheck.rows, recheck.firstOnlyChild, recheck.segments, newTag, noteName);

    return newTag;
  }

  return tag;
}

async function resolveTagForNote(noteName) {
  const filepath = path.join(NOTE_ROOT, noteName + '.md');

  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const fm = parseFrontMatter(content);
    if (fm && hasPlantTag(fm)) {
      const tag = fm.tags.find(t => t.startsWith('life/eukaryota/plantae'));
      if (tag) return { tag };
    }
  } catch (e) {
    return { error: `Cannot read note '${noteName}': ${e.message}` };
  }

  console.log(`Note has no plant tag yet — fetching taxonomy from Wikidata...\n`);
  const labelMap = loadLabelMap(LABEL_MAP_PATH);
  const results = await searchTaxon(noteName);
  if (results.length === 0) {
    return { error: `'${noteName}' not found on Wikidata` };
  }
  const entity = await getEntityData(results[0].id);
  if (!entity) {
    return { error: `Could not fetch Wikidata data for '${noteName}'` };
  }
  const isValidTaxon = entity.instanceOf.some(id => ['Q16521', 'Q7136226'].includes(id));
  if (!isValidTaxon) {
    return { error: `'${noteName}' is not a taxon on Wikidata` };
  }
  const ancestors = await getParentChain(entity.id);
  const { segments, originals } = buildTagSegmentsWithOriginals(ancestors, entity.id, labelMap);
  const tag = segments.join('/');
  console.log(`Resolved tag: ${tag}\n`);

  return { tag, originals, ancestors, entityId: entity.id };
}

module.exports = {
  getPlantNotesWithTags,
  countPrefix,
  printHierarchy,
  checkAndPruneTag,
  resolveTagForNote
};
