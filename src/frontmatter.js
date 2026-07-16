const { getCurrentDate, formatAlias } = require('./utils');
const { buildTag, buildWikipediaUrl, buildAliases } = require('./taxonomy');

function generateFrontMatter(entity, ancestors, labelMap) {
  const tag = buildTag(ancestors, entity.id, labelMap);
  const aliases = buildAliases(entity);
  const wikipediaUrl = buildWikipediaUrl(entity);
  const currentDate = getCurrentDate();

  let fm = '---\n';
  fm += `tags:\n  - ${tag}\n`;

  if (aliases && aliases.length > 0) {
    fm += 'aliases:\n';
    for (const alias of aliases) {
      fm += `  - ${formatAlias(alias)}\n`;
    }
  }

  fm += `created: ${currentDate}\n`;
  fm += `modified: ${currentDate}\n`;

  if (entity.rankLabel) {
    fm += `rank: ${entity.rankLabel}\n`;
  }

  if (wikipediaUrl) {
    fm += `wikipedia: ${wikipediaUrl}\n`;
  }

  fm += '---\n\n';
  return fm;
}

function parseFrontMatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const text = match[1];
  const fm = {};
  const lines = text.split('\n');
  let currentKey = null;

  for (const line of lines) {
    const arrMatch = line.match(/^\s+- (.+)$/);
    if (arrMatch) {
      if (currentKey) {
        if (!Array.isArray(fm[currentKey])) fm[currentKey] = [];
        fm[currentKey].push(arrMatch[1]);
      }
      continue;
    }

    const kvMatch = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val === '' || val === '[]') {
        fm[currentKey] = null;
      } else if (val === 'true') {
        fm[currentKey] = true;
      } else if (val === 'false') {
        fm[currentKey] = false;
      } else {
        fm[currentKey] = val;
      }
    }
  }

  return fm;
}

function hasPlantTag(frontMatter) {
  if (!frontMatter.tags || !Array.isArray(frontMatter.tags)) {
    return false;
  }
  return frontMatter.tags.some(t => t.startsWith('life/eukaryota/plantae'));
}

function analyzeMissingProperties(frontMatter, entity = null, ancestors = null, labelMap = {}) {
  const updates = {};
  const missing = [];

  const checks = [
    {
      key: 'tags',
      isEmpty: (v) => !Array.isArray(v) || v.length === 0 || !v.some(t => t.startsWith('life/eukaryota/plantae')),
      hasNew: true,
      newValue: () => [buildTag(ancestors || [], entity?.id, labelMap)]
    },
    {
      key: 'aliases',
      isEmpty: (v) => !Array.isArray(v) || v.length === 0,
      hasNew: entity && buildAliases(entity),
      newValue: () => buildAliases(entity)
    },
    {
      key: 'rank',
      isEmpty: (v) => !v,
      hasNew: entity?.rankLabel,
      newValue: () => entity.rankLabel
    },
    {
      key: 'wikipedia',
      isEmpty: (v) => !v,
      hasNew: entity?.wikipediaUrl,
      newValue: () => entity.wikipediaUrl
    }
  ];

  for (const check of checks) {
    const value = frontMatter[check.key];
    if (check.isEmpty(value)) {
      missing.push(check.key);
      if (check.hasNew) {
        updates[check.key] = check.newValue();
      }
    }
  }

  return { missing, updates };
}

function updateFrontMatter(content, updates) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return content;

  let frontMatterText = match[1];
  const currentDate = getCurrentDate();
  const lines = frontMatterText.split('\n');
  const updatedLines = [];
  const processedKeys = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kvMatch = line.match(/^([a-zA-Z_]+):/);

    if (kvMatch) {
      const key = kvMatch[1];

      if (key === 'modified') {
        updatedLines.push(`modified: ${currentDate}`);
        processedKeys.add('modified');
      } else if (updates[key] !== undefined) {
        if (key === 'tags' && Array.isArray(updates[key])) {
          updatedLines.push('tags:');
          for (const t of updates[key]) {
            updatedLines.push(`  - ${t}`);
          }
        } else if ((key === 'aliases') && Array.isArray(updates[key])) {
          updatedLines.push('aliases:');
          for (const a of updates[key]) {
            updatedLines.push(`  - ${formatAlias(a)}`);
          }
        } else {
          updatedLines.push(`${key}: ${updates[key]}`);
        }
        processedKeys.add(key);
      } else {
        updatedLines.push(line);
        if (line.endsWith(':') || line.match(/:\s*$/)) {
          while (i + 1 < lines.length && lines[i + 1].match(/^\s+- /)) {
            i++;
            updatedLines.push(lines[i]);
          }
        }
      }
    } else {
      updatedLines.push(line);
    }
  }

  const insertIndex = updatedLines.findIndex(line => line.match(/^(created|modified):/));
  const newProperties = [];

  for (const [key, value] of Object.entries(updates)) {
    if (!processedKeys.has(key)) {
      if (key === 'tags' && Array.isArray(value)) {
        newProperties.push('tags:');
        for (const t of value) {
          newProperties.push(`  - ${t}`);
        }
      } else if (key === 'aliases' && Array.isArray(value)) {
        newProperties.push('aliases:');
        for (const a of value) {
          newProperties.push(`  - ${formatAlias(a)}`);
        }
      } else {
        newProperties.push(`${key}: ${value}`);
      }
    }
  }

  if (newProperties.length > 0 && insertIndex !== -1) {
    updatedLines.splice(insertIndex, 0, ...newProperties);
  } else if (newProperties.length > 0) {
    updatedLines.push(...newProperties);
  }

  frontMatterText = updatedLines.join('\n');
  return content.replace(/^---\n[\s\S]*?\n---/, `---\n${frontMatterText}---`);
}

module.exports = {
  generateFrontMatter,
  parseFrontMatter,
  hasPlantTag,
  analyzeMissingProperties,
  updateFrontMatter
};
