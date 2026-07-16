const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const NOTE_ROOT = process.env.NOTE_ROOT;

if (!NOTE_ROOT) {
  console.error('Error: NOTE_ROOT not found. Please set it in .env file');
  console.error('See .env.example for instructions');
  process.exit(1);
}

if (!fs.existsSync(NOTE_ROOT)) {
  console.error(`Error: NOTE_ROOT directory does not exist: ${NOTE_ROOT}`);
  process.exit(1);
}

const UPDATES_FILE_PATH = path.join(__dirname, '..', '.plant-note-updates.json');
const LABEL_MAP_PATH = path.join(__dirname, '..', 'label-map.json');

module.exports = {
  NOTE_ROOT,
  UPDATES_FILE_PATH,
  LABEL_MAP_PATH
};
