const fs = require('fs');
const path = require('path');
const { NOTE_ROOT } = require('./config');
const { parseFrontMatter } = require('./frontmatter');
const { getFileCreatedDate } = require('./utils');

function createNoteFile(filename, content) {
  const filepath = path.join(NOTE_ROOT, filename);
  if (fs.existsSync(filepath)) {
    const existing = fs.readFileSync(filepath, 'utf-8');
    const fileCreated = getFileCreatedDate(filepath);
    const fm = parseFrontMatter(existing);
    if (fm) {
      return { created: false, updated: false, exists: true, filepath, frontMatter: fm, content: existing, fileCreated };
    }
    // No front matter — treat as an existing note missing all properties so
    // the caller can prepend a fresh block (created from file metadata,
    // modified = today) via analyzeMissingProperties + updateFrontMatter
    // instead of erroring.
    return { created: false, updated: false, exists: true, filepath, frontMatter: {}, content: existing, fileCreated };
  }
  fs.writeFileSync(filepath, content, 'utf-8');
  return { created: true, updated: false, exists: false, filepath };
}

module.exports = {
  createNoteFile
};
