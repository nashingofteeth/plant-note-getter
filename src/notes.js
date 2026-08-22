const fs = require('fs');
const path = require('path');
const { NOTE_ROOT } = require('./config');
const { parseFrontMatter } = require('./frontmatter');

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

module.exports = {
  createNoteFile
};
