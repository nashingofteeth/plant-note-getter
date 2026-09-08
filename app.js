#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { NOTE_ROOT, LABEL_MAP_PATH, LLM_MODEL } = require('./src/config');
const { sanitizeFilename, loadLabelMap, normalizeNameKey } = require('./src/utils');
const { resolveTaxon, getParentChain } = require('./src/wikidata');
const { collectCommonNames } = require('./src/names');
const { buildTagSegmentsWithOriginals } = require('./src/taxonomy');
const { generateFrontMatter, parseFrontMatter, analyzeMissingProperties, updateFrontMatter } = require('./src/frontmatter');
const { createNoteFile } = require('./src/notes');
const { checkAndPruneTag, printHierarchy, resolveTagForNote } = require('./src/tagcheck');
const { askYesNo } = require('./src/prompt');

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
    console.error('Usage: plant-note "Scientific Name" [--apply] [--select=N]');
    console.error('       plant-note --check "Note Name"');
    console.error('');
    console.error('Options:');
    console.error('  --apply    Auto-apply updates to existing files without prompting');
    console.error('  --select=N Select result N from search (bypasses prompt)');
    console.error('  --check    Show tag hierarchy child counts for a note');
    console.error('');
    console.error('Examples:');
    console.error('  plant-note "Populus"');
    console.error('  plant-note "Populus" --apply');
    console.error('  plant-note "Eschscholzia californica" --select=2');
    console.error('  plant-note --check "Lysimachia borealis"');
    process.exit(1);
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
  const selectArg = args.find(a => a.startsWith('--select='));
  const selectIndex = selectArg ? parseInt(selectArg.split('=')[1], 10) - 1 : undefined;
  const input = args.filter(a => a !== '--apply' && !a.startsWith('--select=')).join(' ');

  printSection('Wikidata Search');

  console.log(`  Searching for: ${input}`);

  try {
    const { entity, candidateEntities } = await resolveTaxon(input, selectIndex);

    if (!entity.wikipediaUrl && candidateEntities && candidateEntities.length > 0) {
      const wikiCandidates = candidateEntities.filter(c => c && c.id !== entity.id && c.wikipediaUrl);
      if (wikiCandidates.length > 0) {
        let chosen = wikiCandidates[0];
        if (wikiCandidates.length > 1) {
          const idx = await askChoice(
            wikiCandidates.map(c => ({ label: c.scientificName || c.label, description: c.wikipediaUrl })),
            'No Wikipedia article — which accepted synonym to adopt?'
          );
          chosen = wikiCandidates[idx];
        }
        if (await askYesNo(`Adopt ${chosen.scientificName || chosen.label} as the accepted synonym for ${entity.scientificName || entity.label} (merging its names and Wikipedia link)? [y/N] `)) {
          if (!Array.isArray(entity.taxonSynonymIds)) entity.taxonSynonymIds = [];
          entity.taxonSynonymIds.push(chosen.id);
          console.log(`  Treating ${chosen.scientificName || chosen.label} as a synonym — merging its data...`);
        }
      }
    }

    const { names: aliases, bySource, finalizeReview } = await collectCommonNames(entity, candidateEntities, {
      onReviewStart: () => {
        console.log(`\n  Reviewing Wikipedia names with ${LLM_MODEL} — this can take up to a minute...`);
      }
    });
    const llmProposal = bySource.llmProposal || null;

    printSection('Entity');

    console.log(`  Scientific name: ${entity.scientificName} (${entity.id})`);
    console.log(`  Rank: ${entity.rankLabel || 'unknown'}`);
    console.log('  Aliases:');
    if (bySource.wikidata.length > 0) console.log(`    (Wikidata common names): ${bySource.wikidata.join(', ')}`);
    if (bySource.wikidataAliases.length > 0) console.log(`    (Wikidata aliases): ${bySource.wikidataAliases.join(', ')}`);
    if (bySource.gbif && bySource.gbif.length > 0) console.log(`    (GBIF): ${bySource.gbif.join(', ')}`);
    const wikiList = bySource.wikipediaBase || bySource.wikipedia || [];
    if (wikiList.length > 0) console.log(`    (Wikipedia): ${wikiList.join(', ')}`);
    const llmAdded = bySource.llmAdded || [];
    const llmRemoved = bySource.llmRemoved || [];
    if (llmProposal) {
      const parts = [];
      if (llmProposal.added.length > 0) parts.push(`+ ${llmProposal.added.join(', ')}`);
      if (llmProposal.removed.length > 0) parts.push(`- ${llmProposal.removed.map(r => r.name).join(', ')}`);
      console.log(`      (LLM review — pending): ${parts.join('; ')}`);
    } else if (llmAdded.length > 0 || llmRemoved.length > 0) {
      const parts = [];
      if (llmAdded.length > 0) parts.push(`+ ${llmAdded.join(', ')}`);
      if (llmRemoved.length > 0) parts.push(`- ${llmRemoved.join(', ')}`);
      console.log(`      (LLM review): ${parts.join('; ')}`);
    }
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
    let finalAliases = aliases;

    // New note: creation itself stays silent — the only gate is the LLM
    // review delta, asked before the frontmatter is generated so the note
    // bakes in the decided aliases.
    if (isNew && llmProposal) {
      printSection('LLM Review');
      console.log(`  Deterministic extraction (${llmProposal.baseNames.length}): ${formatList(llmProposal.baseNames) || '(none)'}`);
      for (const name of llmProposal.added) console.log(`  + ${name}`);
      for (const r of llmProposal.removed) console.log(`  - ${r.name} [${r.category}]`);
      if (autoApply) {
        console.log('\n  --apply flag detected, accepting LLM review.');
        finalAliases = finalizeReview(true);
      } else if (await askYesNo('\n  Apply LLM review to the new note? [y/N] ')) {
        finalAliases = finalizeReview(true);
      } else {
        finalizeReview(false);
        console.log('\n  Declined — nothing applied, note not created. Run with --apply to accept the review.');
        return;
      }
    }

    const content = generateFrontMatter(entity, ancestors, finalLabelMap);

    printSection('Note');

    console.log(`  Filename: ${filename}`);
    console.log(`  Tag: ${tag}`);
    if (finalAliases) console.log(`  Aliases: ${finalAliases.join(', ')}`);
    console.log(`  Rank: ${entity.rankLabel}`);
    if (entity.wikipediaUrl) console.log(`  Wikipedia: ${entity.wikipediaUrl}`);

    const result = createNoteFile(filename, content);

    printSection('Status');

    if (result.created) {
      console.log('  File created.');
    } else if (result.exists) {
      const { missing } = analyzeMissingProperties(
        result.frontMatter,
        entity,
        ancestors,
        finalLabelMap
      );

      if (missing.length === 0 && !llmProposal) {
        console.log('  Already exists — all properties filled.');
        return;
      }

      if (missing.length > 0) {
        console.log(`  Already exists — missing: ${missing.join(', ')}`);
      } else {
        console.log('  Already exists — all properties filled.');
      }
      if (llmProposal) {
        const parts = [];
        if (llmProposal.added.length > 0) parts.push(`+ ${llmProposal.added.join(', ')}`);
        if (llmProposal.removed.length > 0) parts.push(`- ${llmProposal.removed.map(r => r.name).join(', ')}`);
        console.log(`  LLM review proposes: ${parts.join('; ')}`);
      }

      let accepted = false;
      if (autoApply) {
        console.log('\n  --apply flag detected, applying.');
        accepted = true;
      } else if (missing.length > 0 && llmProposal) {
        accepted = await askYesNo(`\n  Apply updates + LLM review (+${llmProposal.added.length}/-${llmProposal.removed.length})? [y/N] `);
      } else if (llmProposal) {
        accepted = await askYesNo(`\n  Apply LLM review (+${llmProposal.added.length}/-${llmProposal.removed.length})? [y/N] `);
      } else {
        accepted = await askYesNo('\n  Apply available updates? [y/N] ');
      }

      if (!accepted) {
        if (llmProposal) finalizeReview(false);
        console.log('\n  Declined — nothing applied, nothing recorded. Run with --apply to apply updates.');
        return;
      }

      if (llmProposal) finalAliases = finalizeReview(true);

      // Recompute after finalize so the alias update reflects the review.
      const { updates } = analyzeMissingProperties(
        result.frontMatter,
        entity,
        ancestors,
        finalLabelMap
      );
      if (Object.keys(updates).length > 0) {
        console.log('  Applying updates:');
        for (const [k, v] of Object.entries(updates)) {
          let display = Array.isArray(v) ? v.join(', ') : v;
          if (k === 'aliases' && Array.isArray(v) && result.frontMatter?.aliases) {
            const existingKeys = new Set(result.frontMatter.aliases.map(a => normalizeNameKey(a)));
            const newAliases = v.filter(a => !existingKeys.has(normalizeNameKey(a)));
            display = newAliases.join(', ');
          }
          console.log(`    ${k}: ${display}`);
        }
        const updatedContent = updateFrontMatter(result.content, updates);
        fs.writeFileSync(result.filepath, updatedContent, 'utf-8');
        console.log('  Updated successfully.');
      } else if (llmProposal) {
        console.log('  No frontmatter changes needed — review diff did not alter the note aliases.');
      } else {
        console.log('  No changes to apply.');
      }
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
