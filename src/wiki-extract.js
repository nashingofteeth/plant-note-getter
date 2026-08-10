const { stripArticle, isAbbreviatedBinomial, normalizeNameKey } = require('./utils');

const CJK_RE = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;
const STOPWORDS_RE = /^(or|and|the|in|of|for|a|an|is|are|was|were|with|by|on|at|its|their|this|that|these|those)$/i;
const COUNTRY_NAMES_RE = /^(Mozambique|Myanmar|Zimbabwe|Botswana|Namibia|Ethiopia|Tanzania|Australia|Eurasia|Americas|Spain|Italy|Morocco|Greece|Korea|Japan|China|India|Turkey|Mexico|Canada|France|Germany|Poland|Sweden|Norway|Brazil|Chile|Peru|Egypt|Kenya|Nigeria|Thailand|Vietnam|Indonesia|Philippines|Malaysia|Russia)$/i;
const FILLER_STARTERS_RE = /^(primarily|especially|particularly|specifically|usually|typically|including|such\s+as|e\.g\.|i\.e\.|sometimes|called|known|commonly|among|which|where|when|around|less|deeply|richly|highly|later|most)\b/i;
const RANK_TERMS_RE = /^(species|subgenus|genus|subfamily|family|order|class|phylum|kingdom|variety|subspecies|hybrid|cultivar|form|type)(\s|$)/i;

function parseGbifVernacularName(raw) {
  if (!raw) return [];
  const clean = raw.replace(/\s*\[.*?\]\s*/g, ' ').trim();
  return clean
    .split(/\s*,\s*/)
    .filter(Boolean)
    .map(stripArticle)
    .filter(Boolean);
}

const WIKI_PATTERNS = [
  // A: Parenthetical: "ScientificName (name1, name2, or name3) is/are/was/were..."
  (text) => {
    const m = text.match(/^([A-Z][a-z]+ [a-z]+),?\s+\((?:[A-Z][a-z]+ [a-z]+)\)\s+(?:is|are|was|were|has|have|refers)\b/);
    if (m) return [m[0], m[1]];
    const m2 = text.match(/^[^(]{1,200}\(([^)]+)\)(?:\s*,\s*(?:syn|cf|sensu|subsp|var)\b[^,]*,?\s*)?\s*(?:is|are|was|were|has|have|refers)\b/i);
    if (m2) {
      const firstSegment = m2[1].split(';')[0].trim();
      if (firstSegment.includes(':')) return null;
      if (/^[A-Z-]{2,}[-–]/.test(firstSegment)) return null;
      if (/^syn\.\s+/i.test(firstSegment)) return null;
      if (/^from\s+(?:Ancient|Modern)?\s*(?:Greek|Latin)\b/i.test(firstSegment)) return null;
      const fromInside = extractNamesFromCapture(m2[1]);
      const beforeParen = m2[0].replace(/\([^)]+\)(?:\s*,\s*(?:syn|cf|sensu|subsp|var)\b[^,]*,?\s*)?\s*(?:is|are|was|were|has|have|refers)\b.*$/, '').trim();
      const nameMatch = beforeParen.match(/([a-zA-Z][\w-]*(?:\s+[a-z][\w-]*)*)$/);
      if (m2[1].trim().match(/^[A-Z][a-z]+\s+[a-z]+$/) && fromInside.length > 0) {
        if (nameMatch && !/^[A-Z][a-z]+\s+[a-z]+$/.test(nameMatch[1])) return [m2[0], nameMatch[1]];
        return null;
      }
      if (fromInside.length > 0 && nameMatch) {
        if (!nameMatch[1].includes(' ')) {
          return [m2[0], nameMatch[1] + ', ' + m2[1]];
        }
        return m2;
      }
      if (fromInside.length > 0) return m2;
      if (nameMatch && !/^[A-Z][a-z]+\s+[a-z]+$/.test(nameMatch[1])) {
        if (/^[A-Z][a-z]+$/.test(nameMatch[1]) && /[\s,]*syn\./i.test(m2[1])) return null;
        return [m2[0], nameMatch[1]];
      }
    }
    return m2 || null;
  },

  // A2: "The common name (ScientificName), also called..."
  (text) => {
    const m = text.match(/^The\s+(.+?)\s+\([A-Z][a-z]+ [a-z]+\)/i);
    return m || null;
  },

  // J: "ScientificName or commonName is/are..."
  (text) => text.match(/^[A-Z][a-z]+\s+[a-z]+\s+or\s+(.+?)\s+(?:is|are|was|were|has|have)\b/i),

  // B: Appositive with article
  (text) => text.match(/^[^,]{1,100},\s+(?:the|a|an)\s+([^.;!?]+?)(?<!\b(?:which|that))\s*,?\s+(?:is|are|was|were|has|have)\b/i),

  // C: Appositive without article
  (text) => {
    const m = text.match(/^[^,]+,\s+(?!(?:the|a|an)\s)(?![A-Z][a-z]+\s+[a-z]+\s*\()([^.]{1,100}?),\s+(?:is|are|was|were|has|have)\b/i);
    if (!m) return null;
    const subject = m[0].split(',')[0].trim();
    if (/(?:fruits?|seeds?|flowers?|berries?|leaves?|cladodes?|shoots?|stems?|roots?|buds?|bark|pollen|sap|spores?)$/i.test(subject)) return null;
    return m;
  },

  // D: "known as" / "commonly known as" / "also known as"
  (text) => {
    const m = text.match(/(?<!(?:previously|formerly|originally)\s+)(?:commonly\s+|also\s+)?known\s+(?:commonly\s+)?as\s+([^.]+?),\s+(?:is|are|was|were|has|have|refers)\b/i);
    if (!m) return null;
    const before = text.slice(Math.max(0, m.index - 60), m.index);
    if (/(?:fruits?|seeds?|flowers?|berries?|leaves?|cladodes?|shoots?|stems?|roots?|buds?|bark|pollen|sap|spores?)\s*[,;]\s*$/i.test(before)) return null;
    return m;
  },

  // K: "known as X. It/They is/are"
  (text) => {
    const m = text.match(/(?:commonly\s+|also\s+)?known\s+(?:commonly\s+)?as\s+((?:(?!,\s+(?:is|are|was|were)\b).)+?)\.\s+(?:It|They)\s+(?:is|are|was|were)\b/i);
    if (!m) return null;
    const matchStart = m.index;
    const before = text.slice(0, matchStart);
    const lastOpen = before.lastIndexOf('(');
    const lastClose = before.lastIndexOf(')');
    if (lastOpen > lastClose) return null;
    return m;
  },

  // L: "where it is called X"
  (text) => text.match(/where\s+it\s+is\s+called\s+(.+?)\.(?:\s+[A-Z]|\s*$)/i),

  // E: "also/often/sometimes/commonly called"
  (text) => {
    const m1 = text.match(/(?:also|often|sometimes|commonly)\s+called\s+(.+?),\s+(?:is|are|was|were|has|have)\b/i);
    if (m1 && !/\)\s*$/.test(m1[1])) return m1;
    const m2 = text.match(/(?:also|often|sometimes|commonly)\s+called\s+([^.]+)\.\s+(?:It|They)\s+(?:is|are|was|were|has|have|includes)\b/i);
    if (m2) return m2;
    const m3 = text.match(/more\s+commonly\s+(.+?),\s+(?:is|are|was|were|has|have)\b/i);
    if (m3) return m3;
    const m4 = text.match(/commonly\s+called\s+([^.]{1,60}?)\.(?:\s+[A-Z]|$)/i);
    return m4 || null;
  },

  // F: "Common names include/are"
  (text) => text.match(/(?:(?:other\s+)?common\s+names|other\s+names)[\s,]+(?:for\s+[^,.;]+?\s+)?(?:\binclud(?:e|es|ed|ing)\b|are\b|exist\b|such\s+as\b),?\s*(?:depending\s+on\s+\w+,?\s*)?(?:such\s+as\s+)?([^.]*(?:\([^)]*\)[^.]*)*)\.(?:\s+(?:[A-Z]|=)|$)/i),

  // F2: "with the common names X, Y, and Z, is..."
  (text) => text.match(/with\s+the\s+common\s+names\s+([^.]*(?:\([^)]*\)[^.]*)*)\.(?:\s+(?:[A-Z]|=)|$)/i),

  // G: "English/vernacular names variously applied/include"
  (text) => text.match(/(?:english|vernacular)\s+names\b[^.;]*?include\s+(.+?)\.(?:\s+[A-Z]|$)/i),

  // H: "known by the/common name(s) X, Y, and Z"
  (text) => text.match(/known\s+by\s+(?:\w+\s+)?common\s+names?\s+([^.]{1,120}?)\.(?=\s*(?:[A-Z]|==)|\s*$)/i),

  // I: "also/commonly known as/called X, Y, and Z, and is/are..."
  (text) => {
    const clean = text.replace(/\n+/g, ' ');
    const m = clean.match(/(?:also|commonly)\s+(?:known\s+as|called)\s+([^.;=]+?),\s+and\s+(?:is|are|was|were|has|have)\b/i);
    return m || null;
  },

  // M: "The name X is (often|sometimes) applied to..."
  (text) => text.match(/\bThe\s+name\s+([^.;]{2,40}?)\s+(?:is|are|was|were)\s+(?:(?:often|sometimes|generally|widely|also)\s+)?applied\s+to\b/i),

  // N: "also/commonly/often referred to as X."
  (text) => {
    const m1 = text.match(/(?:also|commonly|often)\s+(?:simply\s+)?referred\s+to\s+as\s+((?!["\u201C\u201D\u2018\u2019])[^.]+)\./i);
    if (m1) return m1;
    const m2 = text.match(/(?:is|are|was|were)\s+referred\s+to\s+as\s+((?!["\u201C\u201D\u2018\u2019])[^.]{2,60}?)\.(?:\s+[A-Z]|$)/i);
    if (m2 && !/(?:the|a|an|its|their|which|that)\s+$/.test(m2[1]) && !/^[a-z]+$/.test(m2[1].trim())) return m2;
    return null;
  },

  // O: ") AuthorName (common name) is/are/was/were"
  (text) => {
    const m = text.match(/\)\s+[A-Z][a-z]+\s+\(([a-z][a-z\s-]+)\)\s+(?:is|are|was|were)\b/);
    if (m) {
      const name = m[1].trim();
      if (!name.includes(' ')) return null;
      if (/[.&0-9]/.test(name)) return null;
      return m;
    }
    return null;
  },

  // P: "Alternative names ... are X, Y, and Z"
  (text) => {
    const m = text.match(/alternative\s+names\s+.*?\bare\s+([^.]+)\.(?:\s+(?:[A-Z]|=)|$)/i);
    if (!m) return null;
    if (!/[,]|\band\b|\bor\b/i.test(m[1])) return null;
    return m;
  },

  // Q: Leading common name before parenthetical aside
  (text) => {
    const m = text.match(/^(?!(?:The|A|An)\s)([A-Z][a-zA-Z]+(?:\s+[a-zA-Z]+)*)\s*\([^)]*\)\s*,\s+(?:also|commonly|generally)\s+(?:known\s+as|called)\b/i);
    if (!m) return null;
    if (/^[A-Z][a-z]+\s+[a-z]+(?:\s+[a-z]+)*$/i.test(m[1])) return null;
    return m;
  },

  // R: "Members are commonly known as X, Y, or Z."
  (text) => {
    const m = text.match(/(?:commonly\s+|generally\s+)(?:well\s+)?known\s+(?:commonly\s+)?as\s+((?:(?!,\s+(?:is|are|was|were|has|have)\b)(?!,\s+of\b)(?!\.\s+[A-Z])[^.;])+?)\.(?=\s*(?:[A-Z]|==)|\s*$)/i);
    if (!m) return null;
    const before = text.slice(0, m.index);
    const lastOpen = before.lastIndexOf('(');
    const lastClose = before.lastIndexOf(')');
    if (lastOpen > lastClose) return null;
    return m;
  },

  // S: "X has the common name(s) A and B"
  (text) => text.match(/has\s+the\s+common\s+names?\s+([^.;]{1,80})\.(?=\s*(?:[A-Z]|==)|\s*$)/i),

  // T: "X, with the common English name Y,"
  (text) => text.match(/with\s+the\s+common\s+(?:English\s+)?name\s+([a-z][a-z'-]+)(?=,|\sis|\.)/i),

  // U: "CommonName, scientific name Genus species, is/are..."
  (text) => text.match(/^([A-Z][a-zA-Z]+(?:\s+[a-zA-Z]+)*),\s+scientific\s+name\s+[A-Z][a-z]+\s+[a-z]+,\s+(?:is|are|was|were)\b/i),

  // V: "ScientificName () (common name) is/are..."
  (text) => {
    const m = text.match(/^[^(]{1,80}\(\s*\)\s*\(([a-z][a-z\s'-]+)\)\s+(?:is|are|was|were|has|have|refers)\b/);
    return m ? [m[0], m[1]] : null;
  },

  // W: "known as the X or Y family"
  (text) => {
    const m = text.match(/(?:commonly|also|generally|sometimes)\s+known\s+as\s+(?:the\s+)?([a-z][a-z\s'-]*?)\s+or\s+([a-z][a-z\s'-]*?)\s+family\b/i);
    if (!m) return null;
    return [m[0], m[1] + ' family, ' + m[2] + ' family'];
  },

  // X: "is/are a family of ... plants known as X."
  (text) => text.match(/\b(?:is|are)\s+(?:(?:a|an|the)\s+)?family\s+of\b[^.;]{0,90}?\bplants?\s+known\s+as\s+([a-z][a-z\s'-]+?)[.;]/i),
];

function extractNamesFromCapture(captured) {
  const names = [];
  const seen = new Set();

  let segment = captured;

  segment = segment.replace(/^with\s+(?:the\s+)?common\s+names?\s+(?:including|of|are)\s+/i, '');
  segment = segment.replace(/^with\s+(?:the\s+)?common\s+name\s+/i, '');
  segment = segment.replace(/^(?:common|vernacular|local)\s+names?\s+(?:including|of|are)\s+/i, '');
  segment = segment.replace(/^(?:common|vernacular|local)\s+name\s+/i, '');

  const hadFormerlyPrefix = /^(?:formerly|previously)\s+/i.test(segment);
  if (hadFormerlyPrefix) {
    segment = segment.replace(
      /^(?:formerly|previously)\s+(?:(?:[^,]+)\s*,\s*)?(?:more\s+(?:commonly|often)|commonly\s+called|also\s+called|the|a|an)\s*/i, ''
    );
    segment = segment.replace(/^(?:formerly|previously)\s+.*$/i, '');
  } else {
    segment = segment.replace(/^(?:commonly\s+)?(?:also\s+)?(?:(?:known\s+(?:commonly\s+)?as)|(?:also\s+)?called|named)\s+/i, '');
    segment = segment.replace(/^(?:formerly|previously)\s+/i, '');
  }

  const parentheticalMatches = segment.match(/\([^)]+\)/g) || [];
  for (const paren of parentheticalMatches) {
    const inner = paren.slice(1, -1);
    if (/^(?:syn\.|simplified|traditional|pinyin|[Α-Ωα-ω]|\d)/i.test(inner)) continue;
    if (CJK_RE.test(inner)) continue;
    if (/not\s+to\s+be\s+confused/i.test(inner)) continue;
    if (/["\u201C\u201D\u2018\u2019]/.test(inner)) continue;
    if (/\b(?:US|UK|via|from|in)\b/i.test(inner)) continue;
    if (/^(?:spanish|french|german|italian|portuguese|dutch|russian|chinese|japanese|korean|arabic|hindi|turkish|greek|latin|english|local|native)\b/i.test(inner)) continue;
    if (inner.includes(':')) continue;
    const alsoSpelled = inner.match(/^also\s+spell(?:ed|t)\s+(.+)$/i);
    if (alsoSpelled) {
      const spelling = alsoSpelled[1].trim().replace(/\.+$/, '');
      if (spelling && !seen.has(spelling.toLowerCase()) && !CJK_RE.test(spelling) && !/\d/.test(spelling)) {
        seen.add(spelling.toLowerCase());
        names.push(spelling);
      }
      continue;
    }
    if (inner.includes(',')) {
      const cleaned = inner.replace(/^(?:e\.g\.|i\.e\.)\s*/i, '');
      const items = cleaned.split(/\s*,\s*/);
      for (const item of items) {
        const name = item.trim().replace(/^["'\u201C\u201D\s]+|["'\u201C\u201D\s.,;:]+$/g, '').trim();
        if (!name) continue;
        const lower = name.toLowerCase();
        if (seen.has(lower)) continue;
        if (COUNTRY_NAMES_RE.test(name)) continue;
        if (/^(and|or)\s+\w+\s+\w+/i.test(lower)) continue;
        if (STOPWORDS_RE.test(lower)) continue;
        if (FILLER_STARTERS_RE.test(lower)) continue;
        if (RANK_TERMS_RE.test(name)) continue;
        if (CJK_RE.test(name)) continue;
        if (/\d/.test(lower)) continue;
        seen.add(lower);
        names.push(name);
      }
    }
  }

  segment = segment.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '');
  segment = segment.replace(/\([^)]*$/, '');
  segment = segment.trim().replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, '');

  const semiParts = segment.split(';');
  segment = semiParts[0];
  for (let i = 1; i < semiParts.length; i++) {
    if (/^\s*syn/i.test(semiParts[i])) break;
    segment += ';' + semiParts[i];
  }

  segment = segment.replace(/,?\s+\b(?:and|or)\b\s*,?\s*/gi, ',');
  segment = segment.replace(/\s+(?:also|previously|formerly)\s+(?:called|known\s+as)\s+/gi, ',');
  segment = segment.replace(/\s*,\s*,/g, ',').replace(/,\s*,/g, ',').trim();

  for (const raw of segment.split(/\s*[,;]\s*/)) {
    let name = raw.replace(/^["'\u201C\u201D\s()]+|["'\u201C\u201D\s.,;:()]+$/g, '').trim();
    if (!name) continue;

    name = name.replace(/^(?:common|vernacular|local|the)\s+names?\s*/i, '').trim();
    if (!name) continue;

    name = name.replace(/^(?:also|commonly|often|sometimes|formerly|previously)\s+(?:(?:called|known\s+as)\s+)?/i, '').trim();
    if (!name) continue;

    name = name.replace(/^also\s+/i, '').trim();
    if (!name) continue;

    name = name.replace(/^it\s+(?:also\s+)?(?:is\s+)?(?:called|known\s+as)\s+/i, '').trim();
    if (!name) continue;

    name = name.replace(/^in\s+(?:[A-Z][a-z]+\s+)?(?:this|that|the|its|some)\s+/i, '').trim();
    if (!name) continue;

    if (/^from\s+(?:(?:Ancient|Modern)\s+)?(?:Latin|Greek)\s+/i.test(name)) {
      name = name.replace(/^from\s+(?:(?:Ancient|Modern)\s+)?(?:Latin|Greek)\s+\S+/i, '').trim();
    }
    if (!name) continue;

    name = name.replace(/^where\s+it\s+(?:is\s+)?(?:known\s+as|called)\s+/i, '').trim();
    if (!name) continue;

    name = name.replace(/^["'\u201C\u201D]+|["'\u201C\u201D]+$/g, '').trim();
    if (!name) continue;

    if (/^syn\.\s+/i.test(name)) continue;
    if (/^synonym\s+/i.test(name)) continue;
    if (/^(?:botanical|scientific)\s+name\s+/i.test(name)) continue;
    if (name.split(/\s+/).length > 5) continue;

    let normalized = name.replace(/^as\s+/i, '').trim();
    let prev;
    do {
      prev = normalized;
      normalized = stripArticle(prev);
    } while (normalized !== prev);
    normalized = normalized.replace(/["\u201C\u201D]/g, '').trim();

    normalized = normalized.replace(/\s+in\s+(?:greek|latin|french|spanish|italian|german|portuguese|dutch|turkish|russian|polish|czech|swedish|danish|norwegian|finnish|hungarian|romanian|ukrainian|bulgarian|croatian|serbian|slovak|slovenian|lithuanian|latvian|estonian|icelandic|irish|welsh|gaelic|basque|catalan|arabic|hebrew|persian|hindi|urdu|bengali|tamil|telugu|kannada|malayalam|chinese|japanese|korean|vietnamese|thai|burmese|khmer|indonesian|malay|tagalog|swahili|zulu|hausa|yoruba|amharic|georgian|armenian|azerbaijani|kazakh|nepali|sinhala|tibetan|mongolian|english|native)\s*$/i, '').trim();

    if (!normalized) continue;

    if (/^in\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/i.test(normalized)) continue;
    if (/^[\w\s]+:/.test(normalized)) continue;
    if (RANK_TERMS_RE.test(normalized)) continue;
    if (/\s+(?:species|subspecies)\s*$/i.test(normalized)) continue;
    if (/\s+(?:is|are|was|were|am)\s+/i.test(normalized)) continue;

    const lower = normalized.toLowerCase();

    if (STOPWORDS_RE.test(lower)) continue;
    if (FILLER_STARTERS_RE.test(lower)) continue;
    if (/^(among\s+(?:many|other)|more\s+commonly)/i.test(lower)) continue;
    if (/^(and|or)\s+\w+\s+\w+/i.test(lower)) continue;
    if (isAbbreviatedBinomial(normalized)) continue;
    if (/^[A-Za-z]$/.test(normalized)) continue;
    if (/^[A-Z][a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+/.test(normalized) && !normalized.includes('-')) continue;
    if (normalized.split(/\s+/).length >= 3 && /^[A-Z][a-z]*\./.test(normalized)) continue;

    if (/\d/.test(lower)) continue;
    if (CJK_RE.test(normalized)) continue;
    if (/\+\s*/.test(normalized)) continue;
    if (/\//.test(normalized)) continue;
    if (/\u00d7/.test(normalized)) continue;
    if (/\bdisease\b/i.test(normalized)) continue;
    if (/^[A-Z-]{2,}[-–]/.test(normalized)) continue;
    if (/^(nuts?|seeds?|fruit|leaves|flowers?|bark|wood|roots?|oil|tree|shrub|herb|plant|weeds?|berries?|apples?|alpine|alpines|bud|artichoke|terminal|ferns?|pickles?|jam|preserves?|snacks?|tea|wine|syrup|juice|vinegar)$/i.test(normalized)) continue;
    if (/^native\s+to\s+/i.test(normalized)) continue;
    if (/^from\s+(?:the\s+)?[A-Z]/i.test(normalized)) continue;
    if (/^it\s+(?:occurs?|is|grows?|are|found|distributed)\b/i.test(normalized)) continue;
    if (/^species\s+of\s+/i.test(normalized)) continue;
    if (/^(terminal|apical|axillary|primary)\s+(bud|meristem|shoot|root)$/i.test(normalized)) continue;
    if (/^(?:is|are|was|were)\s+/i.test(normalized)) continue;
    if (/^cross\s+between\b/i.test(normalized)) continue;
    if (/^(?:this|that|these|those)\s+\w+\s+\w+/i.test(normalized)) continue;
    if (/^(?:native|abundant|widespread|growing|ranging|found|occurs?|occurring|distributed|facing|collector)\b/i.test(normalized)) continue;
    if (/^throughout\s+/i.test(normalized)) continue;
    if (/^to\s+(?:western|southern|northern|eastern|central)\b/i.test(normalized)) continue;
    if (/^(?:leading\s+to|with\s+no)\b/i.test(normalized)) continue;
    if (/\.\s+[A-Z]/.test(normalized)) continue;
    if (/^[A-Z][a-z]+(?:aceae|idae|inae|oideae|ales|ophyta|opsida|eae)$/.test(normalized)) continue;
    if (/\bmeaning\s+/i.test(normalized)) continue;
    if (COUNTRY_NAMES_RE.test(normalized)) continue;
    if (/\bname\s*$/i.test(normalized)) continue;

    if (!seen.has(lower)) {
      seen.add(lower);
      names.push(normalized);
    }
  }
  return names;
}

function findAllPatternMatches(text, patternFn) {
  const matches = [];
  let searchPos = 0;
  let iterations = 0;
  const MAX_ITERATIONS = 5;
  while (searchPos < text.length && iterations < MAX_ITERATIONS) {
    const subtext = text.slice(searchPos);
    const m = patternFn(subtext);
    if (!m) break;
    const matchLen = m[0].length;
    if (matchLen === 0) break;
    matches.push(m[1]);
    searchPos += m.index + matchLen;
    iterations++;
  }
  return matches;
}

function collectNamesFromText(text) {
  const names = [];
  const seen = new Set();
  for (let pi = 0; pi < WIKI_PATTERNS.length; pi++) {
    const captures = findAllPatternMatches(text, WIKI_PATTERNS[pi]);
    for (const captured of captures) {
      const extracted = extractNamesFromCapture(captured);
      for (const name of extracted) {
        const dedupKey = normalizeNameKey(name);
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          names.push(name);
        }
      }
    }
  }
  return names;
}

function extractWikipediaCommonNames(text) {
  return collectNamesFromText(text);
}

module.exports = {
  parseGbifVernacularName,
  extractNamesFromCapture,
  extractWikipediaCommonNames,
  WIKI_PATTERNS
};
