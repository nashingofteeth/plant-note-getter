const fs = require('fs');
const path = require('path');
const { NOTE_ROOT, UPDATES_FILE_PATH } = require('./config');
const { sanitizeFilename, logUpdates, loadLabelMap } = require('./utils');
const { parseFrontMatter, generateFrontMatter, hasPlantTag, analyzeMissingProperties, updateFrontMatter } = require('./frontmatter');
const { searchTaxon, getEntityData, getParentChain } = require('./wikidata');
const { buildTag } = require('./taxonomy');

function getPlantNotes(noteRoot) {
  const files = fs.readdirSync(noteRoot);
  return files.filter(f => f.endsWith('.md')).map(f => {
    const fp = path.join(noteRoot, f);
    try {
      const content = fs.readFileSync(fp, 'utf-8');
      const fm = parseFrontMatter(content);
      if (fm && hasPlantTag(fm)) {
        return { filename: f, filepath: fp, content, frontMatter: fm };
      }
    } catch {}
    return null;
  }).filter(Boolean);
}

function createNoteFile(filename, content) {
  const filepath = path.join(NOTE_ROOT, filename);
  if (fs.existsSync(filepath)) {
    const existing = fs.readFileSync(filepath, 'utf-8');
    const fm = parseFrontMatter(existing);
    if (fm) {
      return { created: false, updated: false, exists: true, filepath, frontMatter: fm, content: existing };
    }
    throw new Error(`File '${filename}' exists but has no front matter`);
  }
  fs.writeFileSync(filepath, content, 'utf-8');
  return { created: true, updated: false, exists: false, filepath };
}

async function populateMissingProperties(applyChanges = false) {
  if (applyChanges) {
    const planned = loadPlannedUpdates();
    if (planned) {
      console.log('Applying changes from previous dry-run...\n');
      let updated = 0, errors = 0;
      for (let i = 0; i < planned.length; i++) {
        const item = planned[i];
        console.log(`${i + 1}. ${item.filename}`);
        if (item.error) {
          console.log(`   Skipped: ${item.error}\n`);
          errors++;
          continue;
        }
        if (!item.updates || Object.keys(item.updates).length === 0) {
          console.log(`   No updates available\n`);
          continue;
        }
        try {
          const content = fs.readFileSync(item.filepath, 'utf-8');
          const updatedContent = updateFrontMatter(content, item.updates);
          fs.writeFileSync(item.filepath, updatedContent, 'utf-8');
          console.log(`   Updates applied:`);
          logUpdates(item.updates, '     ');
          console.log(`   Updated\n`);
          updated++;
        } catch (e) {
          console.log(`   Error: ${e.message}\n`);
          errors++;
        }
      }
      console.log(`Done! Updated ${updated} of ${planned.length} notes.`);
      if (errors > 0) console.log(`Errors: ${errors}`);
      deletePlannedUpdates();
      console.log('Cleared temporary updates file.');
      return;
    }
    console.log('No planned updates found. Run without --apply first.\n');
    return;
  }

  console.log('Scanning for plant notes with missing properties...\n');
  const notes = getPlantNotes(NOTE_ROOT);
  console.log(`Found ${notes.length} plant notes.\n`);

  const labelMap = loadLabelMap(require('./config').LABEL_MAP_PATH);
  const plannedUpdates = [];

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const { missing } = analyzeMissingProperties(note.frontMatter);
    const existingAliases = note.frontMatter.aliases;
    const anyMissing = missing.length > 0 || !existingAliases || existingAliases.length > 0;
    if (!anyMissing) continue;

    const scientificName = note.filename.replace(/\.md$/, '');
    const reasons = missing.length > 0 ? missing : ['aliases'];
    console.log(`${i + 1}. ${note.filename}`);
    console.log(`   Checking: ${reasons.join(', ')}`);

    try {
      const results = await searchTaxon(scientificName);
      if (results.length === 0) {
        console.log(`   Not found on Wikidata\n`);
        plannedUpdates.push({ filename: note.filename, filepath: note.filepath, error: 'Not found on Wikidata' });
        continue;
      }

      const entity = await getEntityData(results[0].id);
      if (!entity || !entity.instanceOf.some(id => ['Q16521', 'Q7136226'].includes(id))) {
        console.log(`   Not a taxon or clade\n`);
        plannedUpdates.push({ filename: note.filename, filepath: note.filepath, error: 'Not a taxon or clade' });
        continue;
      }

      const ancestors = await getParentChain(entity.id);
      const { updates } = analyzeMissingProperties(note.frontMatter, entity, ancestors, labelMap);
      const neededProps = new Set(missing);
      if (existingAliases && existingAliases.length > 0) neededProps.add('aliases');
      const filtered = {};
      for (const prop of neededProps) {
        if (updates[prop] !== undefined) filtered[prop] = updates[prop];
      }

      if (Object.keys(filtered).length > 0) {
        console.log(`   Would update:`);
        logUpdates(filtered, '     ');
        plannedUpdates.push({ filename: note.filename, filepath: note.filepath, updates: filtered });
      } else {
        console.log(`   No data available\n`);
        plannedUpdates.push({ filename: note.filename, filepath: note.filepath, error: 'No data available' });
      }
    } catch (e) {
      console.log(`   Error: ${e.message}\n`);
      plannedUpdates.push({ filename: note.filename, filepath: note.filepath, error: e.message });
    }
    console.log('');
  }

  savePlannedUpdates(plannedUpdates.filter(item => !item.error));
  console.log(`Planned updates saved. Run with --apply to apply changes.`);
}

function savePlannedUpdates(updates) {
  fs.writeFileSync(UPDATES_FILE_PATH, JSON.stringify(updates, null, 2), 'utf-8');
}

function loadPlannedUpdates() {
  if (!fs.existsSync(UPDATES_FILE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(UPDATES_FILE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function deletePlannedUpdates() {
  if (fs.existsSync(UPDATES_FILE_PATH)) fs.unlinkSync(UPDATES_FILE_PATH);
}

module.exports = {
  createNoteFile,
  getPlantNotes,
  populateMissingProperties,
  savePlannedUpdates,
  loadPlannedUpdates,
  deletePlannedUpdates
};
