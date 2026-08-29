const fs = require('fs');
const path = require('path');

function getCurrentDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function sanitizeFilename(scientificName) {
  return scientificName.replace(/[/\\*?"<>|]/g, '') + '.md';
}

function isEmptyValue(value) {
  return !value ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0);
}

function logUpdates(updates, indent = '  ') {
  for (const [key, value] of Object.entries(updates)) {
    const display = Array.isArray(value) ? value.join(', ') : value;
    console.log(`${indent}${key}: ${display}`);
  }
}

function loadLabelMap(labelMapPath) {
  if (!fs.existsSync(labelMapPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(labelMapPath, 'utf-8'));
  } catch {
    return {};
  }
}

function stripArticle(name) {
  return name.replace(/^(the|a|an|and|or|just|simply)\s+/i, '').trim();
}

function formatAlias(alias) {
  return alias.includes(':') ? `"${alias}"` : alias;
}

const ABBREVIATED_BINOMIAL = /^[A-Z]\.\s+[a-z]+/;

function isAbbreviatedBinomial(name) {
  return ABBREVIATED_BINOMIAL.test(name);
}

const TAXON_Q_IDS = ['Q16521', 'Q7136226'];
const PLANT_TAG_BASE = ['life', 'eukaryota', 'plantae'];
const PLANT_TAG_PREFIX = PLANT_TAG_BASE.join('/');

function cleanName(name) {
  return stripArticle(name).replace(/\.+$/, '').trim();
}

function normalizeNameKey(name) {
  return stripArticle(name).toLowerCase().replace(/'s\b/g, '');
}

// ——— Plant noun / Latin epithet helpers (externalized) ———
let _plantNouns = null;
let _latinEpithets = null;

function loadPlantNouns() {
  if (_plantNouns) return _plantNouns;
  try {
    const p = path.join(__dirname, '..', 'data', 'plant-nouns.json');
    const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
    _plantNouns = new Set(arr.map(s => s.toLowerCase()));
  } catch { _plantNouns = new Set(); }
  return _plantNouns;
}

function loadLatinEpithets() {
  if (_latinEpithets) return _latinEpithets;
  try {
    const p = path.join(__dirname, '..', 'data', 'latin-epithets.json');
    const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
    _latinEpithets = new Set(arr.map(s => s.toLowerCase()));
  } catch { _latinEpithets = new Set(); }
  return _latinEpithets;
}

function isPlantNoun(word) {
  if (!word) return false;
  const lower = word.toLowerCase();
  // strip plural s for check (e.g., "oaks" -> "oak")
  const singular = lower.endsWith('s') ? lower.slice(0, -1) : lower;
  const set = loadPlantNouns();
  return set.has(lower) || set.has(singular);
}

// Suffix heuristics for Latin epithets that are uncommon in English common names.
// Conservative: only distinctive Latin suffixes; short -us/-a excluded to avoid false positives.
// Includes -osa (rubiginosa), -ens/-faciens (tumefaciens) for bacterial/binomial leaks.
const LATIN_SUFFIX_RE = /(ensis|ense|anus|iana|ianum|ensis|oides|ifolia|iflora|icola|ifera|flora|issima|ismus|ellus|atus|ata|atum|icus|ica|icum|alis|aris|ensis|oides|osa|ens|faciens|ii|iae)$/i;

function isLatinEpithet(word) {
  if (!word) return false;
  const lower = word.toLowerCase();
  if (isPlantNoun(lower)) return false;
  const latinSet = loadLatinEpithets();
  if (latinSet.has(lower)) return true;
  if (LATIN_SUFFIX_RE.test(lower) && lower.length >= 6) return true;
  // Patronymic -ii/-iae with length >=5 (e.g., douglasii, hallii, brownii)
  if ((/ii$/i.test(lower) || /iae$/i.test(lower)) && lower.length >= 6) return true;
  return false;
}

module.exports = {
  getCurrentDate,
  sanitizeFilename,
  isEmptyValue,
  logUpdates,
  loadLabelMap,
  formatAlias,
  stripArticle,
  isAbbreviatedBinomial,
  TAXON_Q_IDS,
  PLANT_TAG_PREFIX,
  PLANT_TAG_BASE,
  cleanName,
  normalizeNameKey,
  loadPlantNouns,
  loadLatinEpithets,
  isPlantNoun,
  isLatinEpithet
};
