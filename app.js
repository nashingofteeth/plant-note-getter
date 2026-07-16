#!/usr/bin/env node

const fs = require('fs');
const { NOTE_ROOT, LABEL_MAP_PATH } = require('./src/config');
const { sanitizeFilename, loadLabelMap } = require('./src/utils');
const { searchTaxon, getEntityData, getParentChain } = require('./src/wikidata');
const { buildTag, buildAliases } = require('./src/taxonomy');
const { generateFrontMatter, parseFrontMatter, analyzeMissingProperties, updateFrontMatter } = require('./src/frontmatter');
const { createNoteFile, populateMissingProperties } = require('./src/notes');

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: plant-note "Scientific Name" [--apply]');
    console.error('       plant-note --populate [--apply]');
    console.error('');
    console.error('Options:');
    console.error('  --apply    Auto-apply updates to existing files without prompting');
    console.error('');
    console.error('Examples:');
    console.error('  plant-note "Populus"');
    console.error('  plant-note "Populus" --apply');
    console.error('  plant-note "Eschscholzia californica"');
    console.error('  plant-note --populate');
    console.error('  plant-note --populate --apply');
    process.exit(1);
  }

  if (args.includes('--populate')) {
    const applyChanges = args.includes('--apply');
    await populateMissingProperties(applyChanges);
    return;
  }

  const autoApply = args.includes('--apply');
  const input = args.filter(a => a !== '--apply').join(' ');

  console.log(`Searching Wikidata for: ${input}...\n`);

  try {
    const results = await searchTaxon(input);

    if (results.length === 0) {
      console.error(`Error: '${input}' not found on Wikidata`);
      process.exit(1);
    }

    let selected = results[0];

    if (results.length > 1) {
      const taxonResults = [];
      for (const r of results) {
        const entity = await getEntityData(r.id);
        if (entity && entity.instanceOf.some(id => ['Q16521', 'Q7136226'].includes(id))) {
          taxonResults.push({ ...r, rankLabel: entity.rankLabel });
        }
      }

      if (taxonResults.length === 0) {
        console.error(`Error: '${input}' found but no taxon results`);
        process.exit(1);
      }

      if (taxonResults.length === 1) {
        selected = taxonResults[0];
      } else {
        console.log('Multiple taxa found:\n');
        taxonResults.forEach((r, i) => {
          console.log(`  ${i + 1}. ${r.label} (${r.rankLabel || 'taxon'}) - ${r.description || ''}`);
        });
        console.log('');
        console.log(`Using first result: ${taxonResults[0].label}`);
        selected = taxonResults[0];
      }
    }

    const entity = await getEntityData(selected.id);
    if (!entity) {
      console.error(`Error: Could not fetch data for ${selected.id}`);
      process.exit(1);
    }

    const isValidTaxon = entity.instanceOf.some(id => ['Q16521', 'Q7136226'].includes(id));
    if (!isValidTaxon) {
      console.error(`Error: '${input}' is not a taxon or clade on Wikidata`);
      process.exit(1);
    }

    console.log(`Entity: ${entity.label} (${entity.id})`);
    console.log(`Rank: ${entity.rankLabel || 'unknown'}`);
    console.log(`Scientific name: ${entity.scientificName}`);
    if (entity.commonNames.length > 0) console.log(`Common names: ${entity.commonNames.join(', ')}`);
    if (entity.wikipediaUrl) console.log(`Wikipedia: ${entity.wikipediaUrl}`);
    console.log('');

    console.log('Fetching taxonomic hierarchy...');
    const ancestors = await getParentChain(entity.id);
    console.log(`Found ${ancestors.length} ancestors in the chain.\n`);

    const labelMap = loadLabelMap(LABEL_MAP_PATH);
    const tag = buildTag(ancestors, entity.id, labelMap);
    const aliases = buildAliases(entity);

    console.log(`Tag: ${tag}`);
    if (aliases) console.log(`Aliases: ${aliases.join(', ')}`);
    console.log(`Rank: ${entity.rankLabel}`);
    if (entity.wikipediaUrl) console.log(`Wikipedia: ${entity.wikipediaUrl}`);
    console.log('');

    const content = generateFrontMatter(entity, ancestors, labelMap);
    const filename = sanitizeFilename(entity.scientificName);

    console.log(`Filename: ${filename}`);
    console.log('');

    console.log('--- Generated Note ---');
    process.stdout.write(content);
    console.log('---');

    const result = createNoteFile(filename, content);

    if (result.created) {
      console.log(`\nCreated: ${filename}`);
    } else if (result.exists) {
      const { missing, updates } = analyzeMissingProperties(
        result.frontMatter,
        entity,
        ancestors,
        labelMap
      );

      if (missing.length === 0) {
        console.log(`\nFile '${filename}' already exists and has all properties filled.`);
        return;
      }

      console.log(`\nFile '${filename}' already exists. Missing: ${missing.join(', ')}`);
      if (Object.keys(updates).length > 0) {
        console.log('Available updates:');
        for (const [k, v] of Object.entries(updates)) {
          const display = Array.isArray(v) ? v.join(', ') : v;
          console.log(`  ${k}: ${display}`);
        }
        if (autoApply) {
          console.log('\n--apply flag detected, updating...');
          const updatedContent = updateFrontMatter(result.content, updates);
          fs.writeFileSync(result.filepath, updatedContent, 'utf-8');
          console.log('Updated successfully.');
        } else {
          console.log('\nRun with --apply to apply updates.');
        }
      }
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
