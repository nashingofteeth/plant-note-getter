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

module.exports = {
  getCurrentDate,
  sanitizeFilename,
  isEmptyValue,
  logUpdates,
  loadLabelMap,
  formatAlias,
  stripArticle
};
