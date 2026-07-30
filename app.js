#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { NOTE_ROOT, LABEL_MAP_PATH } = require('./src/config');
const { sanitizeFilename, loadLabelMap, stripArticle, TAXON_Q_IDS, cleanName } = require('./src/utils');
const { searchTaxon, getEntityData, getParentChain, collectSynonymData } = require('./src/wikidata');
const { fetchGbifCommonNames, fetchWikipediaCommonNames } = require('./src/common-names');
const { buildTagSegmentsWithOriginals, buildAliases } = require('./src/taxonomy');
const { generateFrontMatter, parseFrontMatter, analyzeMissingProperties, updateFrontMatter } = require('./src/frontmatter');
const { createNoteFile, populateMissingProperties } = require('./src/notes');
const { checkAndPruneTag, printHierarchy, resolveTagForNote } = require('./src/tagcheck');

function printSection(title) {
  const line = '\u2500'.repeat(3) + ' ' + title + ' ' + '\u2500'.repeat(Math.max(1, 60 - title.length - 4));
  console.log('\n' + line + '\n');
}

function formatList(items, maxInline) {
  if (!items || items.length === 0) return '';
  if (items.length <= (maxInline || 10)) return items.join(', ');
  return items.slice(0, maxInline || 10).join(', ') + ', ...';
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: plant-note "Scientific Name" [--apply]');
    console.error('       plant-note --populate [--apply]');
    console.error('       plant-note --check "Note Name"');
    console.error('');
    console.error('Options:');
    console.error('  --apply    Auto-apply updates to existing files without prompting');
    console.error('  --check    Show tag hierarchy child counts for a note');
    console.error('');
    console.error('Examples:');
    console.error('  plant-note "Populus"');
    console.error('  plant-note "Populus" --apply');
    console.error('  plant-note "Eschscholzia californica"');
    console.error('  plant-note --populate');
    console.error('  plant-note --populate --apply');
    console.error('  plant-note --check "Lysimachia borealis"');
    process.exit(1);
  }

  if (args.includes('--populate')) {
    const applyChanges = args.includes('--apply');
    await populateMissingProperties(applyChanges);
    return;
  }

  if (args.includes('--check')) {
    const checkName = args.filter(a => a !== '--check' && a !== '--apply').join(' ').trim();
    if (!checkName) {
      console.error('Error: --check requires a note name');
      console.error('Usage: plant-note --check "Note Name"');
      process.exit(1);
    }
    printSection('Hierarchy Check');
    const result = await resolveTagForNote(checkName);
    if (result.error) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }
    await printHierarchy(result.tag, checkName, result.originals);
    return;
  }

  const autoApply = args.includes('--apply');
  const input = args.filter(a => a !== '--apply').join(' ');

  printSection('Wikidata Search');

  console.log(`  Searching for: ${input}`);

  try {
    const results = await searchTaxon(input);

    if (results.length === 0) {
      console.error(`Error: '${input}' not found on Wikidata`);
      process.exit(1);
    }

    let selected = results[0];
    const entityCache = new Map();

    if (results.length > 1) {
      const taxonResults = [];
      for (const r of results) {
        const entity = await getEntityData(r.id);
        entityCache.set(r.id, entity);
        if (entity && entity.instanceOf.some(id => TAXON_Q_IDS.includes(id))) {
          taxonResults.push({ ...r, rankLabel: entity.rankLabel });
        }
      }

      if (taxonResults.length === 0) {
        console.error(`Error: '${input}' found but no taxon results`);
        process.exit(1);
      }

      if (taxonResults.length === 1) {
        selected = taxonResults[0];
        console.log(`  Using: ${selected.label} (${selected.rankLabel || 'taxon'})`);
      } else {
        console.log(`  ${taxonResults.length} taxa found:\n`);
        taxonResults.forEach((r, i) => {
          const rankStr = r.rankLabel ? ` (${r.rankLabel})` : '';
          console.log(`  ${i + 1}. ${r.label}${rankStr} — ${r.description || 'no description'}`);
        });
        console.log(`\n  Using first result: ${taxonResults[0].label}`);
        selected = taxonResults[0];
      }
    } else {
      console.log(`  Found: ${selected.label}`);
    }

    const entity = entityCache.get(selected.id) || await getEntityData(selected.id);
    if (!entity) {
      console.error(`Error: Could not fetch data for ${selected.id}`);
      process.exit(1);
    }

    const isValidTaxon = entity.instanceOf.some(id => TAXON_Q_IDS.includes(id));
    if (!isValidTaxon) {
      console.error(`Error: '${input}' is not a taxon or clade on Wikidata`);
      process.exit(1);
    }

    const candidateEntities = [...entityCache.values()].filter(e => e && e.id !== selected.id);
    const synonymData = await collectSynonymData(entity, candidateEntities);
    entity.wikipediaUrl = synonymData.wikipediaUrl;
    entity.commonNames = synonymData.commonNames;
    const entityWikidataAliases = [...(entity.aliases || [])];
    if (synonymData.synonymNames.length > 0) {
      entity.aliases = [...entityWikidataAliases, ...synonymData.synonymNames];
    }
    let gbifNamesRaw = [];
    const gbifId = entity.gbifId;
    if (gbifId) {
      gbifNamesRaw = await fetchGbifCommonNames(gbifId);
      const seenLower = new Set((entity.commonNames || []).map(n => stripArticle(n).toLowerCase()));
      for (const name of gbifNamesRaw) {
        const normalized = cleanName(name);
        const lower = normalized.toLowerCase();
        if (!seenLower.has(lower)) {
          seenLower.add(lower);
          entity.commonNames.push(normalized);
        }
      }
    }

    let wikiNamesRaw = [];
    if (entity.wikipediaTitle) {
      wikiNamesRaw = await fetchWikipediaCommonNames(entity.wikipediaTitle);
      const wikiSeen = new Set();
      for (const name of wikiNamesRaw) {
        const normalized = cleanName(name);
        const lower = normalized.toLowerCase();
        if (wikiSeen.has(lower)) continue;
        wikiSeen.add(lower);
        const existingIdx = (entity.commonNames || []).findIndex(n => stripArticle(n).toLowerCase() === lower);
        if (existingIdx !== -1) {
          if (entity.commonNames[existingIdx] !== normalized) {
            entity.commonNames[existingIdx] = normalized;
          }
        } else {
          entity.commonNames.push(normalized);
        }
      }
    }

    const aliases = buildAliases(entity);

    printSection('Entity');

    console.log(`  Scientific name: ${entity.scientificName} (${entity.id})`);
    console.log(`  Rank: ${entity.rankLabel || 'unknown'}`);
    console.log('  Aliases:');
    if (entityWikidataAliases.length > 0) console.log(`    (Wikidata): ${entityWikidataAliases.join(', ')}`);
    if (gbifNamesRaw.length > 0) console.log(`    (GBIF): ${gbifNamesRaw.join(', ')}`);
    if (wikiNamesRaw.length > 0) console.log(`    (Wikipedia): ${wikiNamesRaw.join(', ')}`);
    console.log(`    (Combined): ${aliases ? aliases.join(', ') : '(none)'}`);
    if (entity.wikipediaUrl) console.log(`  Wikipedia: ${entity.wikipediaUrl}`);

    printSection('Taxonomy');

    console.log('  Fetching taxonomic hierarchy...');
    const ancestors = await getParentChain(entity.id);
    console.log(`  Found ${ancestors.length} ancestors in the chain.\n`);

    const labelMap = loadLabelMap(LABEL_MAP_PATH);
    const { segments, originals } = buildTagSegmentsWithOriginals(ancestors, entity.id, labelMap);
    let tag = segments.join('/');

    console.log(`  Tag: ${tag}`);

    const noteName = entity.scientificName || entity.label;
    const filename = sanitizeFilename(entity.scientificName);
    const filepath = path.join(NOTE_ROOT, filename);
    const isNew = !fs.existsSync(filepath);
    tag = await checkAndPruneTag(tag, originals, noteName, autoApply, isNew, ancestors, entity.id);

    const finalLabelMap = loadLabelMap(LABEL_MAP_PATH);
    const content = generateFrontMatter(entity, ancestors, finalLabelMap);

    printSection('Note');

    console.log(`  Filename: ${filename}`);
    console.log(`  Tag: ${tag}`);
    if (aliases) console.log(`  Aliases: ${aliases.join(', ')}`);
    console.log(`  Rank: ${entity.rankLabel}`);
    if (entity.wikipediaUrl) console.log(`  Wikipedia: ${entity.wikipediaUrl}`);

    const result = createNoteFile(filename, content);

    printSection('Status');

    if (result.created) {
      console.log('  File created.');
    } else if (result.exists) {
      const { missing, updates } = analyzeMissingProperties(
        result.frontMatter,
        entity,
        ancestors,
        finalLabelMap
      );

      if (missing.length === 0) {
        console.log('  Already exists — all properties filled.');
        return;
      }

      console.log(`  Already exists — missing: ${missing.join(', ')}`);
      if (Object.keys(updates).length > 0) {
        console.log('  Available updates:');
        for (const [k, v] of Object.entries(updates)) {
          let display = Array.isArray(v) ? v.join(', ') : v;
          if (k === 'aliases' && Array.isArray(v) && result.frontMatter?.aliases) {
            const existingLower = new Set(result.frontMatter.aliases.map(a => a.toLowerCase()));
            const newAliases = v.filter(a => !existingLower.has(a.toLowerCase()));
            display = newAliases.join(', ');
          }
          console.log(`    ${k}: ${display}`);
        }
        if (autoApply) {
          console.log('\n  --apply flag detected, updating...');
          const updatedContent = updateFrontMatter(result.content, updates);
          fs.writeFileSync(result.filepath, updatedContent, 'utf-8');
          console.log('  Updated successfully.');
        } else {
          console.log('\n  Run with --apply to apply updates.');
        }
      }
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
