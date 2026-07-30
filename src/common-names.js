const { fetchJSON, rateLimit, GBIF_API, WIKIPEDIA_MEDIAWIKI_API } = require('./api-client');
const { stripArticle, isAbbreviatedBinomial } = require('./utils');

const CJK_RE = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;
const STOPWORDS_RE = /^(or|and|the|in|of|for|a|an|is|are|was|were|with|by|on|at|its|their|this|that|these|those)$/i;
const COUNTRY_NAMES_RE = /^(Mozambique|Myanmar|Zimbabwe|Botswana|Namibia|Ethiopia|Tanzania|Australia|Eurasia|Americas|Spain|Italy|Morocco|Greece|Korea|Japan|China|India|Turkey|Mexico|Canada|France|Germany|Poland|Sweden|Norway|Brazil|Chile|Peru|Egypt|Kenya|Nigeria|Thailand|Vietnam|Indonesia|Philippines|Malaysia|Russia)$/i;
const FILLER_STARTERS_RE = /^(primarily|especially|particularly|usually|typically|including|such\s+as|e\.g\.|i\.e\.|sometimes|called|known|commonly|among|which|where|when|less|deeply|richly|highly|later|most)\b/i;
const RANK_TERMS_RE = /^(species|subgenus|genus|subfamily|family|order|class|phylum|kingdom|variety|subspecies|hybrid|cultivar|form|type)(\s|$)/i;

async function fetchGbifCommonNames(gbifId) {
  if (!gbifId) return [];

  await rateLimit();
  const url = `${GBIF_API}/${encodeURIComponent(gbifId)}/vernacularNames?limit=100`;
  const data = await fetchJSON(url);

  const nonEnglishNames = new Set();
  for (const r of data.results || []) {
    if (r.language === 'eng' || !r.vernacularName) continue;
    nonEnglishNames.add(stripArticle(r.vernacularName).toLowerCase());
  }

  const names = [];
  const seen = new Set();
  for (const r of data.results || []) {
    if (r.language !== 'eng') continue;
    if (!r.vernacularName) continue;
    const clean = r.vernacularName.replace(/\s*\[.*?\]\s*/g, ' ').replace(/,?\s+(?:or|and)\s+/gi, ', ').trim();
    const parts = clean.split(/\s*,\s*/).filter(Boolean);
    for (const name of parts) {
      const normalized = stripArticle(name);
      if (!normalized) continue;
    const lower = normalized.toLowerCase();
    const dedupKey = lower.replace(/'s\b/g, '');

    if (!seen.has(dedupKey)) {
      seen.add(dedupKey);
      names.push(normalized);
    }
    }
  }

  return names;
}

const WIKI_PATTERNS = [
  // A: Parenthetical: "ScientificName (name1, name2, or name3) is/are/was/were..."
  // Only match within first 100 chars to avoid mid-text parentheticals like "(nuts)"
  // Capture the common name BEFORE the parenthetical, not inside it
  (text) => {
    // Primary: "Genus species (Genus species) is" — two-word scientific name in parenthetical
    const m = text.match(/^([A-Z][a-z]+ [a-z]+),?\s+\((?:[A-Z][a-z]+ [a-z]+)\)\s+(?:is|are|was|were|has|have|refers)\b/);
    if (m) return [m[0], m[1]];
    // Fallback: "CommonName (description) is" or "ScientificName (names) is"
    // Also handles taxonomic annotations between ) and verb: "Name (X), syn. Y, is"
    const m2 = text.match(/^[^(]{1,200}\(([^)]+)\)(?:\s*,\s*(?:syn|cf|sensu|subsp|var)\b[^,]*,?\s*)?\s*(?:is|are|was|were|has|have|refers)\b/i);
    if (m2) {
      const firstSegment = m2[1].split(';')[0].trim();
      if (firstSegment.includes(':')) return null; // Skip pronunciation guides
      // Skip pronunciation notation (e.g., "PLAT-ən-əss")
      if (/^[A-Z-]{2,}[-–]/.test(firstSegment)) return null;
      // Skip "syn." notation (taxonomic synonym, not a common name)
      if (/^syn\.\s+/i.test(firstSegment)) return null;
      // Skip etymology parentheticals (e.g., "(from Ancient Greek ...)")
      if (/^from\s+(?:Ancient|Modern)?\s*(?:Greek|Latin)\b/i.test(firstSegment)) return null;
      // Try extracting names from inside the parenthetical first
      const fromInside = extractNamesFromCapture(m2[1]);
      // Also try to extract the name BEFORE the parenthetical
      const beforeParen = m2[0].replace(/\([^)]+\)(?:\s*,\s*(?:syn|cf|sensu|subsp|var)\b[^,]*,?\s*)?\s*(?:is|are|was|were|has|have|refers)\b.*$/, '').trim();
      const nameMatch = beforeParen.match(/([a-zA-Z][\w-]*(?:\s+[a-z][\w-]*)*)$/);
      // If the parenthetical itself is a single scientific name (Genus species), skip it
      // and extract the name BEFORE the parenthetical instead (e.g., "longleaf pine" from "(Pinus palustris)")
      if (m2[1].trim().match(/^[A-Z][a-z]+\s+[a-z]+$/) && fromInside.length > 0) {
        if (nameMatch && !/^[A-Z][a-z]+\s+[a-z]+$/.test(nameMatch[1])) return [m2[0], nameMatch[1]];
        return null;
      }
      if (fromInside.length > 0 && nameMatch) {
        // Include single-word before-paren name (e.g., "Marimo") alongside inside-paren names.
        // Skip multi-word names to avoid leaking scientific names like "Quercus robur".
        if (!nameMatch[1].includes(' ')) {
          return [m2[0], nameMatch[1] + ', ' + m2[1]];
        }
        return m2;
      }
      if (fromInside.length > 0) return m2;
      // If nothing extracted from inside, extract the name BEFORE the parenthetical
      // Skip if it looks like a scientific name (Genus species) — not a common name
      // Also skip single-word capitalized names preceded by syn./cf. notation in parens
      if (nameMatch && !/^[A-Z][a-z]+\s+[a-z]+$/.test(nameMatch[1])) {
        // Skip if before-paren is single capitalized word and paren content is taxonomic
        if (/^[A-Z][a-z]+$/.test(nameMatch[1]) && /[\s,]*syn\./i.test(m2[1])) return null;
        return [m2[0], nameMatch[1]];
      }
    }
    return m2 || null;
  },

  // A2: "The common name (ScientificName), also called..." — capture name before parenthetical
  (text) => {
    const m = text.match(/^The\s+(.+?)\s+\([A-Z][a-z]+ [a-z]+\)/i);
    return m || null;
  },

  // J: "ScientificName or commonName is/are..." (no commas, e.g., "Abies balsamea or balsam fir is...")
  (text) => text.match(/^[A-Z][a-z]+\s+[a-z]+\s+or\s+(.+?)\s+(?:is|are|was|were|has|have)\b/i),

  // B: Appositive with article: "ScientificName, the/a/an names list, is/are..."
  // Handle both "names, is" and "names is" (no comma before verb)
  // Use negative lookbehind to reject relative clause fragments ending in
  // "which" or "that" (e.g., "the fruit of which is")
  // Use [^.;!?] to prevent crossing sentence boundaries
  (text) => text.match(/^[^,]{1,100},\s+(?:the|a|an)\s+([^.;!?]+?)(?<!\b(?:which|that))\s*,?\s+(?:is|are|was|were|has|have)\b/i),

  // C: Appositive without article: "ScientificName, commonName, is/are..."
  // NOT preceded by "the", "a", or "an"
  // Lazy non-period capture to support comma-separated name lists
  // Use (?![A-Z][a-z]+\s+[a-z]+\s*\() to reject scientific names in apposition (e.g., "ScientificName, Pinus attenuata (syn...), is")
  (text) => text.match(/^[^,]+,\s+(?!(?:the|a|an)\s)(?![A-Z][a-z]+\s+[a-z]+\s*\()([^.]{1,100}?),\s+(?:is|are|was|were|has|have)\b/i),

  // D: "known as" / "commonly known as" / "also known as"
  // Lazy capture, non-period chars to prevent crossing sentence boundaries
  // Negative lookbehind blocks "previously/formerly/originally known as" (taxonomic history, not common names)
  (text) => text.match(/(?<!(?:previously|formerly|originally)\s+)(?:commonly\s+|also\s+)?known\s+(?:commonly\s+)?as\s+([^.]+?),\s+(?:is|are|was|were|has|have|refers)\b/i),

  // K: "known as X. It/They is/are" — verb in next sentence (e.g., "known as X, or Y. It is")
  // Lazy capture so abbreviation periods (e.g. "subsp.") don't break the match
  // Use ((?:(?!,\s+(?:is|are|was|were)\b).)+?) to stop at comma+verb boundary within X
  // Reject match if preceded by an unmatched open paren (inside a parenthetical about another subject)
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

  // L: "where it is called X" at end of sentence (e.g., "where it is called tsuwabuki (石蕗).")
  (text) => text.match(/where\s+it\s+is\s+called\s+(.+?)\.(?:\s+[A-Z]|\s*$)/i),

  // E: "also/often/sometimes/commonly called" / "more commonly X"
  // Match "called X, is/are..." or "called X. It is..." (period before next sentence)
  (text) => {
    // Try comma-verb first (primary case)
    const m1 = text.match(/(?:also|often|sometimes|commonly)\s+called\s+(.+?),\s+(?:is|are|was|were|has|have)\b/i);
    if (m1 && !/\)\s*$/.test(m1[1])) return m1;
    // Fallback: period followed by "It/They" (e.g., "commonly called X. It includes...")
    const m2 = text.match(/(?:also|often|sometimes|commonly)\s+called\s+([^.]+)\.\s+(?:It|They)\s+(?:is|are|was|were|has|have|includes)\b/i);
    if (m2) return m2;
    // Fallback: "more commonly X, is/are..." (e.g., "more commonly Cape thatching reed, or dakriet, is...")
    const m3 = text.match(/more\s+commonly\s+(.+?),\s+(?:is|are|was|were|has|have)\b/i);
    if (m3) return m3;
    // Fallback: "commonly called X." followed by capitalized word (e.g., "...commonly called foxgloves.\nDigitalis is...")
    // Only "commonly" to avoid matching "also called X by..." indigenous names
    const m4 = text.match(/commonly\s+called\s+([^.]{1,60}?)\.(?:\s+[A-Z]|$)/i);
    return m4 || null;
  },

  // F: "Common names include/are" / "Other common names include/are" / "Common names exist...such as"
  // Match to the first sentence-ending period outside parentheses
  // Also handles "Numerous common names exist, depending on region, such as X, Y, and Z."
  // Also handles "common names, including" (comma before include)
  (text) => text.match(/(?:(?:other\s+)?common\s+names|other\s+names)[\s,]+(?:for\s+[^,.;]+?\s+)?(?:\binclud(?:e|es|ed|ing)\b|are\b|exist\b),?\s*(?:depending\s+on\s+\w+,?\s*)?(?:such\s+as\s+)?([^.]*(?:\([^)]*\)[^.]*)*)\.(?:\s+(?:[A-Z]|=)|$)/i),

  // F2: "with the common names X, Y, and Z, is..." (names listed directly, no keyword)
  (text) => text.match(/with\s+the\s+common\s+names\s+([^.]*(?:\([^)]*\)[^.]*)*)\.(?:\s+(?:[A-Z]|=)|$)/i),

  // G: "English/vernacular names variously applied/include"
  (text) => text.match(/(?:english|vernacular)\s+names\b[^.;]*?include\s+(.+?)\.(?:\s+[A-Z]|$)/i),

  // H: "known by the/common name(s) X, Y, and Z" (singular or plural)
  // Also handles "known by various common names" where "the" is replaced
  // Capture limited to 120 chars to avoid consuming entire sentence
  (text) => text.match(/known\s+by\s+(?:\w+\s+)?common\s+names?\s+([^.]{1,120}?)\.(?:\s+[A-Z]|$)/i),

  // I: "also/commonly known as/called X, Y, and Z, and is/are..." (second+ paragraph constructions)
  // Constrain to current sentence — don't cross period or section header boundaries
  (text) => {
    const clean = text.replace(/\n+/g, ' ');
    const m = clean.match(/(?:also|commonly)\s+(?:known\s+as|called)\s+([^.;=]+?),\s+and\s+(?:is|are|was|were|has|have)\b/i);
    return m || null;
  },

  // M: "The name X is (often|sometimes|generally|widely) applied to..." — e.g., "The name Peruvian lily is often applied to..."
  (text) => text.match(/\bThe\s+name\s+([^.;]{2,40}?)\s+(?:is|are|was|were)\s+(?:(?:often|sometimes|generally|widely|also)\s+)?applied\s+to\b/i),

  // N: "also/commonly/often referred to as X, Y, and Z." — period-terminated (e.g., "which is also referred to as Indian turnip, bog onion, and brown dragon.")
  // Also handles "often simply referred to as" (e.g., Vanilla planifolia)
  (text) => text.match(/(?:also|commonly|often)\s+(?:simply\s+)?referred\s+to\s+as\s+([^.]+)\./i),

  // O: ") AuthorName (common name) is/are/was/were"
  // Catches "(short-stalked false bindweed) is" after taxonomic authority
  // Does not duplicate Pattern A (which handles the first parenthetical at start of text)
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
  // e.g., "Alternative names in parts of the United States are Confederate rose and Dixie rosemallow."
  (text) => {
    const m = text.match(/alternative\s+names\s+.*?\bare\s+([^.]+)\.(?:\s+(?:[A-Z]|=)|$)/i);
    if (!m) return null;
    if (!/[,]|\band\b|\bor\b/i.test(m[1])) return null;
    return m;
  },
];

function extractNamesFromCapture(captured) {
  const names = [];
  const seen = new Set();

  let segment = captured;

  // Strip "with common name(s) including/of/are" prefix (Catches pattern C captures)
  segment = segment.replace(/^with\s+(?:the\s+)?common\s+names?\s+(?:including|of|are)\s+/i, '');
  // Strip "with the common name" directly (e.g., "with common name Sasanqua camellia")
  segment = segment.replace(/^with\s+(?:the\s+)?common\s+name\s+/i, '');
  // Also strip the same without "with"
  segment = segment.replace(/^(?:common|vernacular|local)\s+names?\s+(?:including|of|are)\s+/i, '');
  // Strip "common name" directly (e.g., "common name ice poppy" from pattern C without article)
  segment = segment.replace(/^(?:common|vernacular|local)\s+name\s+/i, '');

  // Handle segments from "formerly/previously" context: remove the former names
  // entirely up to transition phrases ("more commonly", "commonly/also called", article)
  // so that former scientific name binomials don't leak into results as common names
  const hadFormerlyPrefix = /^(?:formerly|previously)\s+/i.test(segment);
  if (hadFormerlyPrefix) {
    // Primary: strip up to a transition keyword separating former names from common names
    segment = segment.replace(
      /^(?:formerly|previously)\s+(?:(?:[^,]+)\s*,\s*)?(?:more\s+(?:commonly|often)|commonly\s+called|also\s+called|the|a|an)\s*/i, ''
    );
    // Fallback: if "formerly/previously" still present, there was no transition —
    // remove everything (the entire capture is former names, no common names)
    segment = segment.replace(/^(?:formerly|previously)\s+.*$/i, '');
  } else {
    // Strip other introductory prefixes like "commonly known as", "also known as", etc.
    segment = segment.replace(/^(?:commonly\s+)?(?:also\s+)?(?:(?:known\s+(?:commonly\s+)?as)|(?:also\s+)?called|named)\s+/i, '');
    // Strip "formerly" / "previously" prefixes (taxonomic history, not common names)
    segment = segment.replace(/^(?:formerly|previously)\s+/i, '');
  }

  // Extract names from parentheticals with comma-separated lists before stripping them
  // e.g., "(e.g. ox-eye daisy, Shasta daisy)" -> extract "ox-eye daisy", "Shasta daisy"
  const parentheticalMatches = segment.match(/\([^)]+\)/g) || [];
  for (const paren of parentheticalMatches) {
    const inner = paren.slice(1, -1); // Remove parentheses
        if (/^(?:syn\.|simplified|traditional|pinyin|[Α-Ωα-ω]|\d)/i.test(inner)) continue;
        if (CJK_RE.test(inner)) continue;
    // Skip parentheticals that are clarifications (e.g., "not to be confused with")
    if (/not\s+to\s+be\s+confused/i.test(inner)) continue;
    // Skip parentheticals containing quotation marks (glosses/translations like '"milk"', not name lists)
    if (/["\u201C\u201D\u2018\u2019]/.test(inner)) continue;
    // Skip parentheticals that are geographic/language qualifiers (e.g., "US, via Kikongo")
    if (/\b(?:US|UK|via|from|in)\b/i.test(inner)) continue;
    // Skip parentheticals that start with a language name (e.g., "Spanish, desert dagger")
    if (/^(?:spanish|french|german|italian|portuguese|dutch|russian|chinese|japanese|korean|arabic|hindi|turkish|greek|latin|english|local|native)\b/i.test(inner)) continue;
    // Skip parentheticals that contain colons (pronunciation guides like "US: , UK: ")
    if (inner.includes(':')) continue;
    // Check if it contains comma-separated items (likely a list of names)
    if (inner.includes(',')) {
      // Strip "e.g." or "i.e." prefixes
      const cleaned = inner.replace(/^(?:e\.g\.|i\.e\.)\s*/i, '');
      // Extract comma-separated items
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
        // Filter numeric
        if (/\d/.test(lower)) continue;
        seen.add(lower);
        names.push(name);
      }
    }
  }

  // Remove bracketed content: (pronunciation), [...], etc.
  segment = segment.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '');
  // Remove content from unmatched opening paren to end (e.g. truncated parenthetical)
  segment = segment.replace(/\([^)]*$/, '');
  // Strip leading/trailing non-word chars
  segment = segment.trim().replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, '');

  // Split on semicolons and take the part before any synonym mention
  const semiParts = segment.split(';');
  segment = semiParts[0];
  for (let i = 1; i < semiParts.length; i++) {
    if (/^\s*syn/i.test(semiParts[i])) break;
    segment += ';' + semiParts[i];
  }

  // Replace "and", "or" (with or without adjacent commas) with commas
  // Use word boundaries to avoid matching inside words like "oregano" or "andromeda"
  segment = segment.replace(/,?\s+\b(?:and|or)\b\s*,?\s*/gi, ',');
  // Split on taxonomic transition phrases to separate scientific names from common names
  segment = segment.replace(/\s+(?:also|previously|formerly)\s+(?:called|known\s+as)\s+/gi, ',');
  // Clean up double commas and comma-whitespace
  segment = segment.replace(/\s*,\s*,/g, ',').replace(/,\s*,/g, ',').trim();

  for (const raw of segment.split(/\s*[,;]\s*/)) {
    let name = raw.replace(/^["'\u201C\u201D\s()]+|["'\u201C\u201D\s.,;:()]+$/g, '').trim();
    if (!name) continue;

    // Strip leading "common name", "common names", "vernacular name", "the name" etc.
    name = name.replace(/^(?:common|vernacular|local|the)\s+names?\s*/i, '').trim();
    if (!name) continue;

    // Strip "also called", "also known as", "formerly", "previously" from individual segments
    name = name.replace(/^(?:also|commonly|often|sometimes|formerly|previously)\s+(?:(?:called|known\s+as)\s+)?/i, '').trim();
    if (!name) continue;

    // Strip standalone "also" prefix from middle segments (e.g., "also Himalayan clematis")
    name = name.replace(/^also\s+/i, '').trim();
    if (!name) continue;

    // Strip "it also is called", "it is called", "it is known as" from middle segments
    name = name.replace(/^it\s+(?:also\s+)?(?:is\s+)?(?:called|known\s+as)\s+/i, '').trim();
    if (!name) continue;

    // Strip "in Italy", "in this", "in that" geographic/locator fragments
    name = name.replace(/^in\s+(?:[A-Z][a-z]+\s+)?(?:this|that|the|its|some)\s+/i, '').trim();
    if (!name) continue;

    // Strip "from Latin cepa", "from Ancient Greek gála" etymology prefixes (full phrase)
    if (/^from\s+(?:(?:Ancient|Modern)\s+)?(?:Latin|Greek)\s+/i.test(name)) {
      name = name.replace(/^from\s+(?:(?:Ancient|Modern)\s+)?(?:Latin|Greek)\s+\S+/i, '').trim();
    }
    if (!name) continue;

    // Strip "where it is called" / "where it is known as" fragments
    name = name.replace(/^where\s+it\s+(?:is\s+)?(?:known\s+as|called)\s+/i, '').trim();
    if (!name) continue;

    // Strip any remaining leading/trailing quotes after prefix removal
    name = name.replace(/^["'\u201C\u201D]+|["'\u201C\u201D]+$/g, '').trim();
    if (!name) continue;

    // Skip "syn. " prefixed names (taxonomic synonym notation, not common names)
    if (/^syn\.\s+/i.test(name)) continue;

    // Skip "synonym " prefixed names (taxonomic synonym notation)
    if (/^synonym\s+/i.test(name)) continue;

    // Skip "botanical name", "scientific name" labels (these introduce the scientific name, not a common name)
    if (/^(?:botanical|scientific)\s+name\s+/i.test(name)) continue;

    // Skip if over 5 words (likely not a common name)
    if (name.split(/\s+/).length > 5) continue;

    // Strip leading "as" (from "known as" constructions)  
    let normalized = name.replace(/^as\s+/i, '').trim();
    normalized = stripArticle(normalized);

    // Strip trailing language qualifiers like "in Greek", "in Latin"
    normalized = normalized.replace(/\s+in\s+(?:greek|latin|french|spanish|italian|german|portuguese|dutch|turkish|russian|polish|czech|swedish|danish|norwegian|finnish|hungarian|romanian|ukrainian|bulgarian|croatian|serbian|slovak|slovenian|lithuanian|latvian|estonian|icelandic|irish|welsh|gaelic|basque|catalan|arabic|hebrew|persian|hindi|urdu|bengali|tamil|telugu|kannada|malayalam|chinese|japanese|korean|vietnamese|thai|burmese|khmer|indonesian|malay|tagalog|swahili|zulu|hausa|yoruba|amharic|georgian|armenian|azerbaijani|kazakh|nepali|sinhala|tibetan|mongolian|english|native)\s*$/i, '').trim();

    if (!normalized) continue;

    // Skip geographic qualifiers like "in New Zealand", "in Europe", "in southwestern China"
    if (/^in\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/i.test(normalized)) continue;

    // Skip label-value pairs (e.g. "simplified Chinese: 三角枫", "pinyin: sānjiǎofēng")
    if (/^[\w\s]+:/.test(normalized)) continue;

    if (RANK_TERMS_RE.test(normalized)) continue;

    const lower = normalized.toLowerCase();

    if (STOPWORDS_RE.test(lower)) continue;

    if (FILLER_STARTERS_RE.test(lower)) continue;
    if (/^(among\s+(?:many|other)|more\s+commonly)/i.test(lower)) continue;
    // Skip phrases starting with connectors (leak from split lists)
    if (/^(and|or)\s+\w+\s+\w+/i.test(lower)) continue;

    // Skip if it looks like a scientific name (e.g. "R. eglanteria")
    if (isAbbreviatedBinomial(normalized)) continue;
    // Skip single-letter names (artifacts from abbreviated binomials like "V.")
    if (/^[A-Za-z]$/.test(normalized)) continue;
    if (/^[A-Z][a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+/.test(normalized) && !normalized.includes('-')) continue;
    if (normalized.split(/\s+/).length >= 3 && /^[A-Z][a-z]*\./.test(normalized)) continue;


    // Skip names with numeric digits or standalone abbreviations
    if (/\d/.test(lower)) continue;

    if (CJK_RE.test(normalized)) continue;

    // Skip names containing "+" symbol (fragment from "X + Y" constructions)
    if (/\+\s*/.test(normalized)) continue;

    // Skip names containing forward slashes (IPA pronunciation artifacts like "/pɪˈkæn/")
    if (/\//.test(normalized)) continue;

    // Skip names containing hybrid multiplication sign (scientific hybrid notation like "Populus × canescens")
    if (/\u00d7/.test(normalized)) continue;

    // Skip names containing " disease" or "disease" (disease names, not plant common names)
    if (/\bdisease\b/i.test(normalized)) continue;

    // Skip pronunciation notation (e.g., "PLAT-ən-əss") — case-sensitive, must start with ALL-CAPS
    if (/^[A-Z-]{2,}[-–]/.test(normalized)) continue;

    // Skip generic food/plant terms that aren't meaningful common names
    if (/^(nuts?|seeds?|fruit|leaves|flowers?|bark|wood|roots?|oil|tree|shrub|herb|plant|weeds?|berries?|apples?|alpine|alpines|bud|artichoke|terminal|ferns?)$/i.test(normalized)) continue;

    // Skip "native to X" geographic descriptions
    if (/^native\s+to\s+/i.test(normalized)) continue;

    // Skip "species of X" generic descriptors
    if (/^species\s+of\s+/i.test(normalized)) continue;

    // Skip descriptive botanical phrases (e.g., "terminal bud", "apical meristem")
    if (/^(terminal|apical|axillary|primary)\s+(bud|meristem|shoot|root)$/i.test(normalized)) continue;

    // Skip segments starting with verb forms (sentence fragments leaking past comma+verb boundary)
    if (/^(?:is|are|was|were)\s+/i.test(normalized)) continue;

    // Skip "cross between" cultivar parentage descriptions
    if (/^cross\s+between\b/i.test(normalized)) continue;

    // Skip sentence fragments starting with demonstratives (e.g., "this variety ripens in December")
    if (/^(?:this|that|these|those)\s+\w+\s+\w+/i.test(normalized)) continue;

    // Skip descriptive geographic/distribution terms
    if (/^(?:native|abundant|widespread|growing|ranging|found|occurs?|occurring|distributed|facing|collector)\b/i.test(normalized)) continue;
    if (/^throughout\s+/i.test(normalized)) continue;

    // Skip "to [direction]" geographic fragments
    if (/^to\s+(?:western|southern|northern|eastern|central)\b/i.test(normalized)) continue;

    // Skip "leading to", "with no" descriptive fragments
    if (/^(?:leading\s+to|with\s+no)\b/i.test(normalized)) continue;

    // Skip names containing a period followed by space + capital (cross-sentence artifact)
    if (/\.\s+[A-Z]/.test(normalized)) continue;

    // Skip single capitalized words ending in taxonomic rank suffixes
    if (/^[A-Z][a-z]+(?:aceae|idae|inae|oideae|ales|ophyta|opsida|eae)$/.test(normalized)) continue;

    // Skip etymology descriptions (e.g., "Latin ampulla meaning flask")
    if (/\bmeaning\s+/i.test(normalized)) continue;

    if (COUNTRY_NAMES_RE.test(normalized)) continue;

    // Skip descriptive appositives ending in "name" (e.g., "rare English regional name")
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

async function fetchWikipediaCommonNames(wikipediaTitle) {
  if (!wikipediaTitle) return [];

  await rateLimit();
  const url = `${WIKIPEDIA_MEDIAWIKI_API}?action=query&prop=extracts&explaintext=&redirects=&titles=${encodeURIComponent(wikipediaTitle)}&format=json`;
  const data = await fetchJSON(url);
  const pages = data?.query?.pages;
  if (!pages) return [];
  const extract = Object.values(pages)[0]?.extract;
  if (!extract) return [];

  return collectNamesFromText(extract);
}

function extractWikipediaCommonNames(text) {
  return collectNamesFromText(text);
}

function collectNamesFromText(text) {
  const names = [];
  const seen = new Set();
  for (let pi = 0; pi < WIKI_PATTERNS.length; pi++) {
    const captures = findAllPatternMatches(text, WIKI_PATTERNS[pi]);
    for (const captured of captures) {
      const extracted = extractNamesFromCapture(captured);
      for (const name of extracted) {
        const lower = name.toLowerCase();
        const dedupKey = lower.replace(/'s\b/g, '');
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          names.push(name);
        }
      }
    }
  }
  return names;
}

module.exports = {
  fetchGbifCommonNames,
  fetchWikipediaCommonNames,
  extractNamesFromCapture,
  extractWikipediaCommonNames,
  WIKI_PATTERNS
};
