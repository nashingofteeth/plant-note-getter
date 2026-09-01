const { stripArticle, isAbbreviatedBinomial, isPlantNoun, isLatinEpithet } = require('./utils');

// Parse a single GBIF vernacular-name string into zero or more common names.
function parseGbifVernacularName(raw) {
  if (!raw) return [];
  const clean = raw.replace(/\s*\[.*?\]\s*/g, ' ').trim();
  return clean
    .split(/\s*,\s*/)
    .filter(Boolean)
    .map(stripArticle)
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// extractNamesFromCapture
// ─────────────────────────────────────────────────────────────────────────────

const FILLER_SEGMENT_PATTERNS = [
  /^among\s+(?:many|other|several)?\s*(?:regional|common)?\s*names?$/i,
  /^(?:most|more)?\s*commonly\s+(?:known|called|named|referred\s+to)(?:\s+as)?$/i,
  /^most\s+commonly$/i,
  /^less\s+commonly$/i,
  /^such\s+as\s+mealberry$/i,
  /^depending\s+on\s+region$/i,
  /^often\s+used\s+to\b/i,
  /^used\s+to\b/i,
  /^other\s+species\s+of\s+/i,
  /^\w+\s+english\s+(?:regional\s+)?name$/i,
  /^\w+\s+(?:regional|rare\s+regional)\s+name$/i,
];

const LEADING_PREFIX_PATTERNS = [
  /^common\s+names?\s+/i,
  /^other\s+names?\s+include\s+/i,
  /^other\s+names?\s+/i,
  /^as\s+/i,
  /^also\s+/i,
  /^by\s+the\s+names?\s+/i,
  /^simply\s+/i,
  /^the\s+name\s+/i,
  /^called\s+/i,
  /^known\s+as\s+/i,
  /^commonly\s+known\s+as\s+/i,
  /^commonly\s+named\s+/i,
  /^generally\s+known\s+as\s+/i,
  /^widely\s+known\s+as\s+/i,
  /^more\s+commonly\s+known\s+as/i,
  /^more\s+commonly\s+/i,
  /^with\s+common\s+name\s+/i,
  /^with\s+common\s+names\s+/i,
  /^include\s+/i,
  /^including\s+/i,
  /^such\s+as\s+/i,
  /^depending\s+on\s+region\s*,?\s*/i,
  /^pinyin:\s*/i,
  /^simplified\s+Chinese:\s*/i,
  /^traditional\s+Chinese:\s*/i,
  /^lit\b\.?\s*/i,
  /^often\s+known\s+as\s+/i,
  /^commonly\s+called\s+/i,
  /^commonly\s+named\s+/i,
  /^the\s+fruit\s+as\s+/i,
  /^with\s+the\s+flowers\s+as\s+/i,
  /^both\s+/i,
];

const STOPWORD_SEGMENTS = new Set([
  'species', 'genus', 'family', 'or', 'and', 'the', 'in', 'of',
  'primarily', 'especially', 'including', 'such as',
  'tree', 'shrub', 'herb', 'plant', 'trees', 'shrubs', 'herbs', 'plants',
  'possibly', 'perhaps',
  'it', 'its', 'they', 'them', 'he', 'she', 'we', 'you',
  'this', 'that', 'these', 'those', 'which', 'what', 'a', 'an',
  'but'
]);

const QUOTE_CHARS = /^['"\u2018\u2019\u201C\u201D]+/g;
const QUOTE_CHARS_END = /['"\u2018\u2019\u201C\u201D]+$/g;

// IPA phonetic characters that legitimately appear inside common names from
// native-language transliterations (e.g. "psíŋ" in Wild rice), distinguishing
// them from pinyin-style romanization (gāosǔn) which should be rejected.
const PHONETIC_IPA = /[əɛɪɒʊʌæɑɔɵʃʒθðŋɾɻɹɭɺ]/;

function stripOuterParens(text) {
  let prev;
  let result = text;
  do {
    prev = result;
    result = result.replace(/\([^()]*\)/g, ' ');
  } while (result !== prev);
  // Also strip unmatched trailing parens
  result = result.replace(/\)\s*$/, ' ').trim();
  return result;
}

function extractNamesFromCapture(captured, trace, rule, opts = {}) {
  if (!captured || !captured.trim()) return [];

  let text = captured.trim();

  // Extract alternate spellings from parentheticals before stripping parens
  // e.g. "chamomile (also spelled camomile)" -> "chamomile, camomile"
  text = text.replace(/\(\s*(?:also\s+)?spelled?\s+(.+?)\)/gi, (match, spellings) => {
    return ', ' + spellings;
  });

  text = stripOuterParens(text);

  text = text
    .split(';')
    .filter(part => {
      if (/^\s*syn\.?\s/i.test(part)) {
        if (trace) trace.rejected.push({ name: part.trim(), rule, by: 'syn-clause' });
        return false;
      }
      return true;
    })
    .join(',');

  // Clause-level DROP: drop entire comma-separated clauses that start with
  // DROP markers (formerly, previously, synonym)
  const DROP_CLAUSE = /^(?:formerly|previously|synonym)\s+/i;
  const clauses = text.split(',').map(c => c.trim()).filter(Boolean);
  const keptClauses = [];
  for (const clause of clauses) {
    if (DROP_CLAUSE.test(clause)) {
      if (trace) trace.rejected.push({ name: clause, rule, by: 'drop-clause' });
      continue;
    }
    keptClauses.push(clause);
  }
  text = keptClauses.join(', ');

  // Strip hedge interjections: "or, possibly, Y" → "or Y"
  text = text.replace(/,\s*(?:possibly|perhaps),/gi, ',');

  text = text.replace(/\s*,?\s+(?:and|or)\s+/gi, (match, offset, string) => {
    // Don't split "X or Y family/genus/species" patterns, but only when the
    // parts are short (not long descriptive phrases ending with "species")
    const after = string.slice(offset + match.length);
    const before = string.slice(0, offset).trim();
    // Only preserve if after ends with family/genus/species and both parts are short
    const afterMatch = after.match(/^(.+?)\s+(family|genus|species)\s*$/i);
    if (afterMatch) {
      const afterPart = afterMatch[1].trim();
      if (afterPart.split(/\s+/).length <= 3 && before.split(/\s+/).length <= 3) {
        return match; // Keep the "or" intact
      }
    }
    return ', ';
  });

  // Shared-head expansion: "the coffee, madder, or bedstraw family" →
  // "the coffee family, madder family, bedstraw family". Distributes the
  // trailing rank head (family/genus/species) onto every comma-separated
  // list item so the 2-item post-process at the caller can handle 3+ items.
  const sharedHead = text.match(/^(.+?)\s+(?:or|and)\s+([^,]+?)\s+(family|genus|species)\s*$/i);
  if (sharedHead) {
    const head = sharedHead[3];
    const items = [...sharedHead[1].split(','), sharedHead[2]]
      .map(s => s.trim())
      .filter(Boolean);
    if (items.length >= 2 && items.every(it => it.split(/\s+/).length <= 3)) {
      text = items.map(it => `${it} ${head}`).join(', ');
    }
  }

  const results = [];
  const seenKeys = new Set();

  for (let raw of text.split(',')) {
    let segment = raw.trim();
    if (!segment) continue;

    let stripped;
    do {
      stripped = segment;
      for (const pattern of LEADING_PREFIX_PATTERNS) {
        segment = segment.replace(pattern, '');
      }
      segment = segment.trim();
    } while (segment !== stripped && segment);

    if (!segment) continue;

    // "aka X." is a taxonomic author abbreviation, never a common name.
    if (/^aka\s+/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'aka-author' });
      continue;
    }
    // Hypothetical / narrative phrasing ("Elder Mother would be released")
    // is not a plant common name.
    if (/\b(?:would|could|should|might)\s+be\b/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'hypothetical' });
      continue;
    }
    // Descriptive trait clauses ("with white flowers", "bearing pink fruit")
    // are not names.
    if (/^(?:with|having|has|bearing|producing|produces?|grows?|growing)\s+\w[\w\s-]*\s+(?:\w[\w\s-]*)?\s+(?:flowers?|leaves?|fruit|fruits?|seeds?|stems?|bark|roots?|petals?|foliage|branches?)\b/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'descriptive-trait' });
      continue;
    }
    // Descriptive appositives ("a member of the white pine group", "part of the
    // X family") are taxonomic descriptions, not common names.
    if (/^(?:a\s+|an\s+|the\s+)?(?:member|part|kind|type|form|sort|version|example|species|genus|group|variety|subspecies|cultivar|hybrid|section)\s+of\b/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'descriptive-of' });
      continue;
    }
    // Relationship/role clauses ("the primary ancestor of X", "a wild relative
    // of Y") describe genealogy, not a common name.
    if (/\b(?:ancestor|progenitor|descendant|relative|relation|kin)\s+of\b/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'relation-of' });
      continue;
    }
    // Segments that still carry the "common name(s)" label are list headers,
    // not actual names (e.g. R1 capturing "with the common names Engelmann
    // spruce, ...").
    if (/\bcommon\s+names?\b/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'common-name-header' });
      continue;
    }

    // Strip a trailing language qualifier ("in the Igbo language",
    // "in the French language") — the name is the word before it.
    segment = segment.replace(/\s+in\s+(?:the\s+)?[A-Za-z][A-Za-z-]*\s+language\b/i, '').trim();
    segment = segment.replace(/\s+in\s+(?:the\s+)?[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*$/, '');
    // Reject segments that are purely geographic qualifiers
    if (/^in\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*$/.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'geographic-qualifier' });
      continue;
    }

    // Strip trailing orphan connectors ("elm or", "poppy and")
    segment = segment.replace(/\s+(?:or|and)\s*$/, '').trim();

    // Strip trailing "amongst/among other names" phrases
    segment = segment.replace(/\s*,?\s*(?:amongst|among|as\s+well\s+as)\s+other\s+names?\s*$/i, '').trim();

    // Strip trailing parens and their content
    segment = segment.replace(/\s*\([^)]*\)\s*$/, '').trim();
    // Strip trailing em-dash etymology glosses (e.g. "cole crops—derived from...")
    segment = segment.replace(/\s*[—–]\s*.*$/, '').trim();
    // Reject "X of a plant" descriptive fragments (e.g. "stalk of a plant")
    if (/\bof\s+a\s+plant\b/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'of-a-plant' });
      continue;
    }

    // Strip an unmatched trailing ")" left over when a capture's terminator
    // fell inside a binomial's parenthetical gloss (e.g. "kiwiberries)" from
    // "...also known as kiwiberries), A. foo (...)").
    if (/\)\s*$/.test(segment) && !segment.includes('(')) {
      segment = segment.replace(/\)\s*$/, '').trim();
    }

    segment = segment.replace(QUOTE_CHARS, '').trim();
    segment = segment.replace(QUOTE_CHARS_END, '').trim();
    // Strip stray inner double-quotes (capture artifacts, e.g. `"French Green"
    // lentils` → "French Green lentils") — quotes never belong inside a common
    // name. Apostrophes are preserved (possessive names like "Adam's needle").
    segment = segment.replace(/["\u201C\u201D]+/g, '').trim();
    segment = segment.replace(/\.+$/, '').trim();
    segment = segment.replace(/[:;]+$/, '').trim();

    segment = stripArticle(segment).trim();
    // Strip articles iteratively (e.g. "just a nettle" -> "a nettle" -> "nettle"),
    // interleaving quote stripping so a leading quote that sits "under" an article
    // (e.g. `the "curd"`) is still removed on a subsequent pass.
    let prevArticle;
    do {
      prevArticle = segment;
      segment = stripArticle(segment).trim();
      segment = segment.replace(QUOTE_CHARS, '').trim();
      segment = segment.replace(QUOTE_CHARS_END, '').trim();
    } while (segment !== prevArticle && segment);

    if (!segment) continue;
    if (FILLER_SEGMENT_PATTERNS.some(pattern => pattern.test(segment))) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'filler-segment' });
      continue;
    }
    if (STOPWORD_SEGMENTS.has(segment.toLowerCase())) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'stopword' });
      continue;
    }
    if (segment.length <= 1) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'too-short' });
      continue;
    }
    if (isHumanJunk(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'human-junk' });
      continue;
    }
    if (isClimateJunk(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'climate-junk' });
      continue;
    }
    if (isLatinJunk(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'latin-junk' });
      continue;
    }
    if (/\d/.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'numeric' });
      continue;
    }
    if (isAbbreviatedBinomial(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'abbreviated-binomial' });
      continue;
    }
    // Reject segments with CJK characters
    if (hasCJK(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'cjk' });
      continue;
    }
    // Reject segments that are just pinyin/romanization markers
    if (/^(?:pinyin|simplified\s+chinese|traditional\s+chinese):\s*/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'pinyin-marker' });
      continue;
    }
    // Reject pinyin-style romanized words (lowercase with diacritics, no spaces).
    // Allow words with ñ (common in Spanish common names like "cuaresmeñas").
    // Allow words containing IPA characters (e.g. "psíŋ" — Wild rice) that
    // appear in native-language transliterations.
    if (/^[a-z\u00C0-\u024F]+$/i.test(segment) && /[^\x00-\x7F]/.test(segment) && !/\s/.test(segment) && !/[\u00F1\u00D1]/.test(segment) && !PHONETIC_IPA.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'phonetic-only' });
      continue;
    }
    // Reject bare acronym/abbreviation segments (e.g. "RAHB" from a
    // pronunciation gloss "raab; RAHB") — common names are not written in
    // all-caps, so a lone all-uppercase word is jargon rather than a name.
    if (/^[A-Z]{2,}$/.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'all-caps-acronym' });
      continue;
    }
    // Reject full binomials (Capitalized-lowercase) that look like Latin scientific names,
    // but allow common English descriptors (European, American, wild, etc.)
    const segWords = segment.split(/\s+/);
    if (segWords.length === 2 && /^[A-ZÀ-Ÿ]/.test(segWords[0]) && /^[a-z]/.test(segWords[1])) {
      // Allow names with non-ASCII characters (accented letters are common in foreign-language common names)
      if (/[^\x00-\x7F]/.test(segment)) { /* skip binomial check */ }
      // Allow possessive common names like "Adam's needle" and "Douglas' spirea" (with or without s)
      else if (/^[A-ZÀ-Ÿ][\w.''\u2019-]*['\u2019]s?$/i.test(segWords[0])) { /* skip binomial check */ }
      // Allow hyphenated proper-name compounds like "Joe-Pye weeds" (genera never have hyphens)
      else if (/^[A-ZÀ-Ÿ][A-Za-zÀ-ÿ]*-[A-ZÀ-Ÿ][A-Za-zÀ-ÿ]*$/.test(segWords[0])) { /* skip binomial check */ }
      // Allow quoted common-name captures (R7 "known by the common name(s) X")
      // that may be Capitalized-lowercase like a binomial (e.g. "Ginger wort").
      else if (opts.allowBinomialLike) { /* skip binomial check */ }
      // Allow "Proper-name + generic plant noun" compounds like "Fraser fir"
      // (real binomial epithets are never bare English plant nouns).
      else if (isPlantNoun(segWords[1])) { /* skip binomial check */ }
      else {
        // Inverted: reject only if second word looks like a Latin epithet
        // (externalized list + suffix heuristics). Otherwise allow — this
        // replaces the unbounded englishPrefixes allowlist (206 entries) that
        // required per-taxon patches (Portuguese, Cornish, etc.).
        if (isLatinEpithet(segWords[1])) {
          if (trace) trace.rejected.push({ name: segment, rule, by: 'binomial-lookalike' });
          continue;
        }
      }
    }
    // Reject subspecific/varietal scientific notation ("Vicia lens subsp.
    // culinaris") that leaks from taxonomic passages — not common names.
    if (/\b(?:subsp\.|ssp\.|subsp\b|ssp\b|varietas|var\.)\b/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'subspecific-name' });
      continue;
    }
    // A lone colour word (e.g. "red" for cotyledon colour) is a trait, not a
    // common name.
    if (segWords.length === 1 && /^(?:red|yellow|green|blue|black|white|brown|grey|gray|orange|purple|pink|tan|maroon|beige|mauve|violet|cream|gold)$/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'single-colour' });
      continue;
    }
    // "respectively" marks a descriptive trait list (cotyledon colours), not a name.
    if (/\brespectively\b/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'respectively' });
      continue;
    }
    // Market/cultivar classifications ending in "-type(s)" (e.g. "Eston-types",
    // "Laird-types") describe classes, not common names.
    if (/-types?\b/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'market-type' });
      continue;
    }
    if (segment.split(/\s+/).length > 6) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'too-long' });
      continue;
    }
    // Reject hybrid scientific names containing the × character (e.g. "Populus × canescens")
    if (/\s×\s/i.test(segment) || segment.startsWith('× ')) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'hybrid-notation' });
      continue;
    }
    // Reject leftover verb-phrase fragments (e.g. "is widely found", "are grown",
    // "is famous") left after a comma-split — copula-starting segments describe
    // the plant rather than name it.
    if (/^(?:is|are|was|were|being|been)\s+(?:widely|commonly|often|particularly|typically|especially|found|distributed|known|used|native|common|famous|said|reported|considered|regarded|thought|believed|claimed|called|classified|grown|cultivated|harvested|eaten|edible|poisonous|toxic|endangered|widespread|popular|rare|valued|praised|sold|shipped|exported|imported)/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'verb-phrase' });
      continue;
    }
    // Reject pronoun-subject descriptive clauses (e.g. "it contains two seeds",
    // "they produce fruit") left after a comma-split — they describe the plant
    // rather than name it.
    if (/^(?:it|they|these|those|which|that)\s+(?:contains?|contain|produces?|produce|gives?|give|yields?|yield|bears?|bear|grows?|grow|forms?|form|has|have|is|are|was|were)\b/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'descriptive-clause' });
      continue;
    }
    // Reject time-frame lead-ins left over from whole-sentence captures
    // (e.g. "In the past" from "In the past, it was also known as...").
    if (/^in\s+(?:the\s+)?(?:past|ancient|antiquity|early|late|recent|modern|times?)\b/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'time-frame' });
      continue;
    }
    // Reject dangling participial clauses left over from whole-sentence
    // captures (e.g. "inviting confusion with A. balsamea").
    if (/^(?:inviting|causing|leading|meaning|making|leaving|producing|resulting|including|naming|describing|constituting)\s+/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'participle-clause' });
      continue;
    }
    // Reject habitat/terrain descriptive phrases misidentified as quoted
    // names (e.g. "dry swamps" from "...sometimes referred to as 'dry
    // swamps', these areas are better drained...").
    if (/^(?:dry|wet|moist|swampy|boggy|sandy|rocky|stony|gravelly|muddy|peaty|mossy)\s+(?:swamps?|bogs?|marshes?|fens?|meadows?|woodlands?|forests?|heaths?|moors?|habitats?)$/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'habitat-phrase' });
      continue;
    }
    // Reject taxonomic rank-prefixed fragments (e.g. "subspecies L. f. ssp. aspleniifolius")
    if (/^(?:subspecies|ssp\.?|subsp\.?|variety|var\.?|subvariety|subvar\.?|forma|form\.?|subform|section|subsection|cultivar|cv\.?)\s+/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'rank-prefix' });
      continue;
    }
    // Reject "Genus subgenus X", "Genus section X", "Genus subsection X", etc.
    // These are taxonomic classifications, not common names.
    if (/^[A-ZÀ-Ÿ][a-zà-ÿ]+\s+(?:subgenus|section|subsection|series|subseries|superspecies)\s+/i.test(segment)) {
      if (trace) trace.rejected.push({ name: segment, rule, by: 'taxonomic-rank-infix' });
      continue;
    }

    const key = segment.toLowerCase();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    results.push(segment);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// extractWikipediaCommonNames
// ─────────────────────────────────────────────────────────────────────────────

const TAXONOMIC_PREDICATE = /\b(?:is|was|are|were)\s+(?:a|an|the|some|one)\b/i;

const GENERIC_JUNK = new Set([
  'apple', 'apples', 'orange', 'oranges', 'pickle', 'pickles',
  'lianas', 'herbs', 'shrubs', 'flowers', 'orange flowers',
  'seeds', 'fruit', 'fruits', 'leaves', 'bark', 'roots', 'stems',
  'wood', 'lumber', 'timber', 'cross', 'hybrid',
  'terminal bud', 'cabbage', 'alpines',
  'dioecious species', 'monoecious species',
  'smoking mixture', 'dried leaves', 'dried bark',
  'spurs', 'landscape', 'garden plant', 'such', 'curd',
  'taxa', 'taxon',
]);

const GEOGRAPHIC_JUNK = /^(?:found\s+in|native\s+to|subcontinent|asia|europe|boreal|temperate|tropical|regions|northern|southern|eastern|africa|americas|eurasia|oceania|australia|antarctica|atlantic|mediterranean|brazil|japan|china|india|mexico|canada|european|american|african|asian|arctic|alpine|subtropical|south\s+america|north\s+america|central\s+america|south\s+africa|south-east\s+asia|south-eastern\s+asia|southeast\s+asia|southeastern\s+asia)$/i;

const PROCEDURE_WORDS = /^(?:consists|grows|ranging|occurs|includes|especially|within|found|cultivated|grown|harvested|used|produced|distributed|sold|shipped|marketed|selected|applied|obtained|derived|extracted|processed|manufactured|imported|exported|introduced|naturalized|endemic|originating|hailing|coming|native\s+to|referred\s+to\s+as\s+a|of\s+flowering\s+plants|of\s+plants|denoting|often)/i;

function isGenericJunk(name) {
  const lower = name.toLowerCase().trim();
  if (GENERIC_JUNK.has(lower)) return true;
  if (/^[a-z]+s?$/.test(lower) && lower.length <= 4) {
    if (/^(?:tree|shrub|herb|plant|grass|weed|vine|fern|moss|bush|crop|flower|leaf|seed|root|stem|fruit|bark|wood)$/.test(lower)) return true;
  }
  return false;
}

function isGeographicJunk(name) {
  const lower = name.toLowerCase().trim();
  if (GEOGRAPHIC_JUNK.test(lower)) return true;
  if (/^(?:european|american|african|asian|australian|canadian|mexican|chinese|japanese|indian)\s+(holly|basswood|juniper|bluebell|elm|oak|pine|birch|cedar|fir|maple|walnut|poplar|cherry|pear|apple|rose|lily|iris)$/i.test(lower)) return false;
  return false;
}

function isProcedural(name) {
  return PROCEDURE_WORDS.test(name.trim());
}

function isHumanJunk(name) {
  return /\b(?:President|Senator|Governor|Mayor)\b/i.test(name) || /\bU\.S\./.test(name);
}

function isClimateJunk(name) {
  return /^(?:prolonged|severe|extreme|intolerant|wet|dry|intense)\s+(?:cold|heat|warmth|dryness|humidity|drought)\b/i.test(name.trim()) || /^(?:wet|dry|cold|hot|humid|arid)(?:,\s*(?:wet|dry|cold|hot|humid|arid))*\s*$/i.test(name.trim());
}

function isLatinJunk(name) {
  return /\b(?:foliis|calyce|radii|petalis|pistillatis|ovato-acutis|hirsutis|oppositis|imbricatus)\b/i.test(name);
}

// Reject names that denote OTHER organisms (insect pests, diseases) rather than
// the plant itself — e.g. "fruit-tree leafroller", "giant bark aphid".
function isOtherOrganismJunk(name) {
  return /\b(?:leaf[- ]?roller|leafroller|aphid|lecanium|caterpillar|larva|larvae|moth|beetle|weevil|mite|sawfly|whitefly|thrips|borer|leafhopper|webworm|looper|loopers|armyworm|scale\s*(?:insect|bug|mite))\b/i.test(name);
}

// Reject taxonomic-rank references that slipped through (e.g. "legume or bean
// family") — multiword phrases whose head is a rank word, not a plant common name.
function isTaxonRankRef(name) {
  const s = name.trim();
  if (!/\b(?:family|genus|species|subfamily|tribe|order|class|division)\b/i.test(s)) return false;
  const words = s.split(/\s+/);
  // Allow genuine 2-word expanded names (e.g. "coffee family" from a list
  // expansion); reject 3+ word rank references and any containing "or"/"and".
  if (words.length >= 3 || /\b(?:or|and)\b/.test(s)) return true;
  return false;
}

// A "known as" gloss that merely restates a botanical family name — e.g.
// "...the flowering plant family Fabaceae or commonly known as legume or bean
// family" — is a taxonomic synonym of the family, not a species common name,
// and must be dropped. Detected by a rank word followed by a scientific name,
// then "or (commonly) known as".
function isFamilyRestatement(sentence) {
  return /\b(?:family|families|genus|genera|order|subfamily|tribe|division|class)\s+[A-Z][a-z]+(?:\s+[a-z]+)*\s+or\s+(?:commonly\s+)?known\s+as\b/i.test(sentence);
}

// A sentence that defines a biological mechanism/process rather than naming the
// taxon — "<Term> ( <gloss> ) is a characteristic of ...", "is a mechanism of",
// "is a mode of", etc. The parenthetical gloss is a definition of the term (e.g.
// "Anemophily (wind pollination) is a characteristic of some members this genus"
// in Thalictrum), so R5/R6c captures from it (the term and the gloss) are biology
// vocabulary, not plant common names. Detected by a closing paren followed by a
// copula, an article, a mechanism noun, and "of". The mechanism nouns are
// deliberately limited so plant-descriptor predicates ("is a green cruciferous
// vegetable", "is a type of Chinese cabbage", "is a vegetable belonging to") are
// NOT rejected. Drives the Thalictrum regression test.
function isMechanismDefinition(sentence) {
  return /\)\s+(?:is|was|are|were)\s+(?:a|an)\s+(?:characteristic|process|mechanism|mode|means|strategy|adaptation|phenomenon)\s+of\b/i.test(sentence);
}

function isPronunciationNotation(text) {
  return /\b(?:PLAT|THEW)\b/i.test(text) || /[əɛɪɒʊʌæɑɔɵʃʒθðŋɾɻɹɭɭɹɺɹɻ]/.test(text);
}

function isMeaningParen(text) {
  // Only match if the text is a pure etymology/meaning phrase (no comma-separated names)
  if (/,/.test(text)) return false;
  return /\b(?:meaning|from\s+(?:the\s+)?(?:ancient\s+)?greek|latin|derived\s+from)\b/i.test(text);
}

function isEtiologyParen(text) {
  return /\b(?:named\s+(?:after|for)|honour|homage|commemorat|eponym|in\s+reference\s+to|allusion\s+to)\b/i.test(text);
}

function isAbbreviatedBinomialLike(text) {
  return /^[A-Z]\.\s+[a-z]+/.test(text.trim());
}

function hasCJK(text) {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

function isSubjectBinomial(subject) {
  const normalized = subject.replace(/\s*×\s*/g, ' ').trim();
  const words = normalized.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  if (!/^[A-Z]/.test(words[0])) return false;
  for (let i = 1; i < words.length; i++) {
    const w = words[i].replace(/^[\s\(\)\[\]\{\}"']/, '');
    if (!/^[a-z]/.test(w)) return false;
  }
  for (let i = 1; i < words.length; i++) {
    const clean = words[i].replace(/[.,;:)]/g, '');
    if (isPlantNoun(clean)) return false;
  }
  return true;
}

function sentenceEnds(text) {
  const ends = [];
  // Split at newlines (section headers, paragraph breaks)
  const nlRe = /\n/g;
  let m;
  while ((m = nlRe.exec(text)) !== null) {
    ends.push(m.index);
  }
  // Split at sentence-ending punctuation followed by space + uppercase
  const re = /(?<=[.!?])\s+(?=[A-Z])/g;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 40), m.index + 1);
    if (!/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|approx|ca|cf|e\.g|i\.e|viz|al|fig|vol|no|pp|pg|ed|rev|subsp|ssp|var|f|sp|syn|L)\.\s*$/.test(before)
        && !/\b[A-Z]\.[A-Z]\.\s*$/.test(before)) {
      ends.push(m.index);
    }
  }
  // Also split at ".) " followed by uppercase (e.g. "parviflora.) However,")
  const parenRe = /\.\)\s+(?=[A-Z])/g;
  while ((m = parenRe.exec(text)) !== null) {
    ends.push(m.index + 1); // +1 to point after the dot (before the paren)
  }
  ends.sort((a, b) => a - b);
  // Deduplicate
  const unique = [];
  for (const e of ends) {
    if (unique.length === 0 || e > unique[unique.length - 1] + 1) unique.push(e);
  }
  if (unique.length === 0) return [text.length];
  return unique;
}

function getSentences(text) {
  const ends = sentenceEnds(text);
  const sentences = [];
  let start = 0;
  for (const end of ends) {
    const s = text.slice(start, end + 1).trim();
    if (s) sentences.push(s);
    start = end + 1;
    while (start < text.length && text[start] === ' ') start++;
  }
  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

function isInsideParens(text, index) {
  let depth = 0;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
  }
  return depth > 0;
}

function isTaxonomicSentence(sentence, isFirst) {
  if (isFirst) return true;
  if (/^It\s/.test(sentence) || /^It's\s/.test(sentence)) return true;
  if (/^[A-Z]\.\s+[a-z]\.\s/i.test(sentence)) return true;
  if (TAXONOMIC_PREDICATE.test(sentence)) return true;
  if (/common\s+name/i.test(sentence)) return true;
  if (/vernacular\s+names?\s+among\s+(?:which|them)\b/i.test(sentence)) return true;
  if (/names?\s+(?:variously\s+)?(?:applied|used)/i.test(sentence)) return true;
  if (/referred\s+to\s+as/i.test(sentence)) return true;
  if (/(?:alternative|other|local|regional)(?:\s+vernacular)?\s+names?\s/i.test(sentence)) return true;
  if (/name\s+.+\s+is\s+(?:often|also|commonly|frequently|widely)\s+applied\s+to/i.test(sentence)) return true;
  if (/commonly\s+known\s+as/i.test(sentence)) return true;
  if (/known\s+(?:by|as)\s/i.test(sentence)) return true;
  if (/\balso\s+called\b/i.test(sentence)) return true;
  if (/\b(?:is|are)\s+(?:native|endemic|distributed|found|common|widely\s+found)\b/i.test(sentence)) return true;
  if (/\b(?:often|sometimes|frequently)\s+called\b/i.test(sentence)) return true;
  // "Southern or annual wild rice (Z. aquatica), also an annual, grows..." —
  // "X or Y (abbreviated binomial)" alternative-name constructions (R59).
  // Generalized to allow optional article "The" and capitalized second element (e.g., "Northern wild rice (Z. palustris) is ...").
  if (/^(?:The\s+)?[A-ZÀ-Ÿ][a-zà-ÿ''\u2019-]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ][\w''\u2019-]*)*\s+or\s+[A-ZÀ-Ÿa-zà-ÿ][\w''\u2019-]*(?:\s+[A-ZÀ-Ÿa-zà-ÿ][\w''\u2019-]*)*\s*\([A-Z]\.\s+[a-z]+/i.test(sentence)) return true;
  // "... where it is called X" (Gunnera-style subordinate naming clause) — generalized to they/are and known as variant
  if (/\bwhere\s+(?:it|they)\s+(?:is|are)\s+(?:called|known\s+as)\b/i.test(sentence)) return true;
  // "... (hence the name X)" etymological common-name clauses
  if (/\b(?:hence|whence|thus|whereby)\s+the\s+name\b/i.test(sentence)) return true;
  // Multilingual/indigenous naming list: "The plant is called waaʼ in the Navajo
  // language, tumi in the Hopi language, and both aʼpilalu and ado꞉we in the Zuni
  // language." — unquoted "called X in the <Lang> language" (Cleomella serrulata).
  if (/called\s+.+?\s+in\s+(?:the\s+)?[A-Za-z-]+\s+language\b/i.test(sentence)) return true;
  return false;
}

// Truncate a capture at the first comma that introduces a descriptive/explanatory
// clause ("also known as X, gives the tree...", "..., since this...", "..., because...").
// Descriptive continuations introduce non-name content (verbs, "the", articles+descriptors).
// A pronoun+verb continuation (", it includes ...", ", they are ...") also marks a
// new independent clause after a name — e.g. "referred to as sage, it includes two
// widely used herbs, Salvia officinalis ..." — so the name capture stops at the comma.
const DESCRIPTIVE_CONTINUATION = /,\s+(?:gives|since|because|where|tastes|in\s+which|such\s+as|as\s+the|as\s+a|which\s+|that\s+the|(?:and\s+)?(?:it|they|these|those)\s+(?:includes?|include|contains?|contain|produces?|produce|gives?|give|yields?|yield|has|have|is|are|was|were)\b)/i;
function truncateAtDescriptiveClause(capture) {
  const m = capture.match(DESCRIPTIVE_CONTINUATION);
  if (m) return capture.slice(0, m.index).trim();
  return capture;
}

// Strip trailing sentence punctuation from a capture and enforce a length cap.
// Returns the cleaned capture, or null when it exceeds maxLen.
function finalizeCapture(capture, maxLen) {
  const cleaned = capture.replace(/\s*[.,]\s*$/, '');
  return cleaned.length < maxLen ? cleaned : null;
}

// Record an accepted name (or a duplicate skip) into results/seenKeys and the
// optional trace. `rule` is the capture-rule label that produced the name.
function pushResult(results, seenKeys, name, trace, rule) {
  const key = name.toLowerCase();
  if (seenKeys.has(key)) {
    if (trace) trace.rejected.push({ name, rule, by: 'duplicate' });
    return;
  }
  seenKeys.add(key);
  results.push(name);
  if (trace) trace.captures.push({ name, rule });
}

// `captures` is an array of { rule, capture } tuples (one per pushed capture,
// including whole sentences for section-based extraction). Runs each capture
// through the junk classifiers and records every decision on the trace.
// `sentence` is the source sentence for sentence-level caps (null for section
// callers that already pass the sentence as capture); used for capture-level
// classifiers like family-restatement that need sentence context.
function addNames(captures, results, seenKeys, trace, sentence = null) {
  for (const { rule, capture, allowBinomialLike } of captures) {
    if (!capture || !capture.trim()) continue;
    // Capture-level: family-name restatements (e.g. "family Fabaceae or commonly
    // known as legume or bean family") are taxonomic synonyms of the family,
    // not species common names. Centralized here so R8/R14/etc don't each need
    // a guard; covers the Vicia/Rutaceae clash.
    if (sentence && isFamilyRestatement(sentence)) {
      if (trace) trace.rejected.push({ name: capture, rule, by: 'family-restatement' });
      continue;
    }
    // Sentences that explicitly state the names belong to a different taxon
    // (e.g. "Valeriana rubra, red valerian, ... is also sometimes referred to as ... but is a different species.")
    // should not contribute names to the current taxon's alias list.
    if (sentence && /but\s+is\s+a\s+different\s+species/i.test(sentence)) {
      if (trace) trace.rejected.push({ name: capture, rule, by: 'different-species' });
      continue;
    }
    // Sentences that define a biological mechanism ("X (gloss) is a
    // characteristic of ...") yield biology vocabulary, not plant common names.
    if (sentence && isMechanismDefinition(sentence)) {
      if (trace) trace.rejected.push({ name: capture, rule, by: 'mechanism-definition' });
      continue;
    }
    // Whole-capture pronunciation check: reject only when the capture has no
    // commas, so comma-separated native-language name lists like "manoomin,
    // mnomen, psíŋ, Canada rice, Indian rice, or water oats" survive to the
    // per-segment classifiers (where "psíŋ" passes via the IPA allowance).
    if (isPronunciationNotation(capture) && !/,/.test(capture)) {
      if (trace) trace.rejected.push({ name: capture, rule, by: 'isPronunciationNotation' });
      continue;
    }
    if (isMeaningParen(capture)) {
      if (trace) trace.rejected.push({ name: capture, rule, by: 'isMeaningParen' });
      continue;
    }
    // Reject provenance/descriptive captures wholesale (e.g. "from the Amur River region...")
    if (/^(?:from\s+the|where\s+the|it\s+occurs\s+in|in\s+(?:northeastern|southern|northern|western|eastern|central)|native\s+to|prevalent\s+in)/i.test(capture)) {
      if (trace) trace.rejected.push({ name: capture, rule, by: 'provenance' });
      continue;
    }
    const names = extractNamesFromCapture(capture, trace, rule, { allowBinomialLike });
    for (const name of names) {
      if (isGenericJunk(name)) { if (trace) trace.rejected.push({ name, rule, by: 'isGenericJunk' }); continue; }
      if (isGeographicJunk(name)) { if (trace) trace.rejected.push({ name, rule, by: 'isGeographicJunk' }); continue; }
      if (isProcedural(name)) { if (trace) trace.rejected.push({ name, rule, by: 'isProcedural' }); continue; }
      if (isOtherOrganismJunk(name)) { if (trace) trace.rejected.push({ name, rule, by: 'isOtherOrganismJunk' }); continue; }
      if (isTaxonRankRef(name)) { if (trace) trace.rejected.push({ name, rule, by: 'isTaxonRankRef' }); continue; }
      if (isHumanJunk(name)) { if (trace) trace.rejected.push({ name, rule, by: 'isHumanJunk' }); continue; }
      if (isClimateJunk(name)) { if (trace) trace.rejected.push({ name, rule, by: 'isClimateJunk' }); continue; }
      if (isLatinJunk(name)) { if (trace) trace.rejected.push({ name, rule, by: 'isLatinJunk' }); continue; }
      if (hasCJK(name)) { if (trace) trace.rejected.push({ name, rule, by: 'hasCJK' }); continue; }
      pushResult(results, seenKeys, name, trace, rule);
    }
  }
}

function extractSection(text, header) {
  const re = new RegExp(`={2,}\\s*${header}\\s*={2,}`, 'i');
  const match = text.match(re);
  if (!match) return '';
  const start = match.index + match[0].length;
  const after = text.slice(start);
  const nextSection = after.match(/\n={2,}\s/);
  return nextSection ? after.slice(0, nextSection.index) : after;
}

// Extract quoted names that are followed by "in <Language>" or
// "in (<Language>)" — signals indigenous/multilingual common names
// in naming sentences like "called 'X' in the Western Mono language".
function extractQuotedLanguageNames(sentence) {
  const results = [];
  const seenKeys = new Set();
  const re = /['"\u2018\u2019]([^'"\u2018\u2019]+)['"\u2018\u2019]\s+(?:in\b|\([^)]*language[^)]*\))/gi;
  let m;
  while ((m = re.exec(sentence)) !== null) {
    const name = m[1].trim();
    if (!name) continue;
    if (isGenericJunk(name)) continue;
    if (isGeographicJunk(name)) continue;
    if (isProcedural(name)) continue;
    const key = name.toLowerCase();
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      results.push(name);
    }
  }
  return results;
}

// Extract romanized names glossed by a CJK parenthetical in a naming
// sentence — "are called mùguā (木瓜)", "and the fruit mogwa (모과; …)".
// The name is anchored to a naming verb ("called") or a list connector
// ("and the fruit") so the lazy capture can't swallow the whole sentence.
// Mirrors extractQuotedLanguageNames' classifier checks (generic/geographic/
// procedural only — no phonetic-only rejection, since romanized glosses
// like "mùguā" carry diacritics and would otherwise be dropped).
function extractCjkAnnotatedNames(sentence) {
  const results = [];
  const seenKeys = new Set();
  const re = /(?:is|are|was|were)\s+(?:commonly|sometimes|often|frequently|usually|also\s+)?(?:called|named)\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{1,40}?)\s*\(\s*[\u4e00-\u9fff\u3400-\u4dbf\uac00-\ud7af]|(?:and|or)\s+(?:the\s+)?(?:fruit|tree|plant|species|flower|leaf|leaves|seed|bark|root)\s+(?!is|are|was|were)([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{1,40}?)\s*\(\s*[\u4e00-\u9fff\u3400-\u4dbf\uac00-\ud7af]/gi;
  let m;
  while ((m = re.exec(sentence)) !== null) {
    const raw = (m[1] || m[2] || '').trim();
    const name = stripArticle(raw).trim();
    if (!name || name.length > 40) continue;
    if (isGenericJunk(name)) continue;
    if (isGeographicJunk(name)) continue;
    if (isProcedural(name)) continue;
    if (hasCJK(name)) continue;
    const key = name.toLowerCase();
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      results.push(name);
    }
  }
  return results;
}

function _extractWikipediaCommonNames(text, trace) {
  if (!text || !text.trim()) return [];

  const results = [];
  const seenKeys = new Set();
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n+/g, '\n').replace(/[ \t]+/g, ' ').trim();

  // Expand parenthetical example lists: "(e.g. X, Y)" → ", X, Y"
  // This converts example parentheticals into inline name lists that the
  // sentence-level rules can capture naturally.
  const processed = normalized.replace(/\(\s*e\.g\.?\s+([^()]+?)\)/g, ', $1');

  const sentences = getSentences(processed);
  const isFirst = new Set();
  if (sentences.length > 0) isFirst.add(sentences[0]);

  // --- Section-based extraction ---
  const commonSection = extractSection(processed, 'Common names');
  if (commonSection) {
    const commonSentences = getSentences(commonSection);
    for (const s of commonSentences) {
      // Handle "The name X is often applied" directly
      const nameApplied = s.match(/(?:the\s+)?name\s+(.+?)\s+is\s+(?:often|also|commonly|frequently|widely)\s+applied\s+to/i);
      if (nameApplied) {
        pushResult(results, seenKeys, nameApplied[1].trim(), trace, 'Section:Common names');
      }
      // Check for quoted indigenous-language names and CJK-annotated romanized
      // names first; when either is found, skip the whole-sentence comma-split
      // fallback (which would otherwise leak sentence-fragment junk).
      const quotedNames = extractQuotedLanguageNames(s);
      const cjkNames = extractCjkAnnotatedNames(s);
      if (quotedNames.length > 0 || cjkNames.length > 0) {
        for (const name of quotedNames) {
          pushResult(results, seenKeys, name, trace, 'Section:Common names:quoted');
        }
        for (const name of cjkNames) {
          pushResult(results, seenKeys, name, trace, 'Section:Common names:cjk');
        }
      } else {
        addNames([{ rule: 'Section:Common names', capture: s }], results, seenKeys, trace, s);
      }
    }
  }
  const namesSection = extractSection(processed, 'Names');
  if (namesSection) {
    const namesSentences = getSentences(namesSection);
    for (const s of namesSentences) {
      if (/common\s+name/i.test(s) || /(?:called|known|named|referred)/i.test(s) || /names?\s+(?:include|are|for)/i.test(s) || /the\s+name\s+.+\s+is\s+(?:often\s+)?applied/i.test(s)) {
        // Handle "The name X is often applied" directly
        const nameApplied = s.match(/the\s+name\s+(.+?)\s+is\s+(?:often\s+)?applied/i);
        if (nameApplied) {
          pushResult(results, seenKeys, nameApplied[1].trim(), trace, 'Section:Names');
        }
        // Check for quoted indigenous-language names and CJK-annotated romanized
        // names first; when either is found, skip the whole-sentence comma-split
        // fallback (which would otherwise leak sentence-fragment junk).
        const quotedNames = extractQuotedLanguageNames(s);
        const cjkNames = extractCjkAnnotatedNames(s);
        if (quotedNames.length > 0 || cjkNames.length > 0) {
          for (const name of quotedNames) {
            pushResult(results, seenKeys, name, trace, 'Section:Names:quoted');
          }
          for (const name of cjkNames) {
            pushResult(results, seenKeys, name, trace, 'Section:Names:cjk');
          }
        } else {
          addNames([{ rule: 'Section:Names', capture: s }], results, seenKeys, trace, s);
        }
      }
    }
  }

  // "Selected species" lists individual species with their own common names
  // (e.g., "Callicarpa japonica (Japanese beautyberry)"). Those names are
  // species-level, not genus-level, so skip sentences that fall inside that
  // section to avoid polluting genus aliases (e.g., "Murasakishikibu" for
  // C. japonica should not become a Callicarpa genus alias). Do NOT skip
  // generic "Species" sections — e.g., Zizania's "Species" section lists
  // Northern/Southern/Manchurian wild rice which ARE expected as genus-level
  // aliases in the test suite (wild rice types).
  const selectedSpeciesSection = extractSection(processed, 'Selected species');
  const selectedSpeciesSentences = selectedSpeciesSection ? new Set(getSentences(selectedSpeciesSection)) : new Set();

  // --- Sentence-by-sentence pattern matching ---
  // ─── RULE INDEX (construction → rule; category banners below) ─────────────
  // Sentence-open constructions:      R1, R2, R3, R4, R4b, R4c, R4d, R5, R5b, R33, R37, R38, R44, R53, R56, R57, R59, R60
  // "known as / called / referred to": R7, R8, R8b, R9, R10, R11, R11b, R11c, R11d, R11e,
  //                                    R15, R16, R21, R23, R24, R25, R26, R30, R39, R41, R43, R46, R58
  // Parenthetical glosses:            R6, R6b, R6b2, R6c, R6d, R28, R29, R36, R47
  // Common-name list constructions:   R12, R13, R14, R18, R19, R20, R32, R32b, R34, R35, R35b, R54
  // Misc / special-case:              R17, R22, R31, R40, R42, R45
  // No-ops (handled elsewhere):       R27, R40, R42, R45
  // ──────────────────────────────────────────────────────────────────────────
  for (const sentence of sentences) {
    // Skip species-list sections for genus alias extraction
    if (selectedSpeciesSentences.has(sentence)) {
      if (trace) trace.skippedSentences.push({ sentence });
      continue;
    }
    const first = isFirst.has(sentence);
    if (!isTaxonomicSentence(sentence, first)) {
      if (trace) trace.skippedSentences.push({ sentence });
      continue;
    }

    // Skip sentences that attribute common names to a specific species rather
    // than to the taxon the note is about (e.g. "The yucca, specifically
    // Yucca gigantea, ... is known as flor de izote").
    if (/\b(?:[Ss]pecifically|namely)\s+[A-Z][a-zà-ÿ]*\s+[a-zà-ÿ]+/.test(sentence)) {
      if (trace) trace.skippedSentences.push({ sentence });
      continue;
    }

    // A naming sentence whose subject is an abbreviated binomial ("V. condensata
    // is commonly known as X") attributes those names to that specific species,
    // not to the broader taxon (e.g. genus) the note describes. Claytonia's
    // "C. perfoliata is called 'piyada̠'" is unaffected — it is captured by the
    // section-based quoted-language extractor, not this loop.
    if (/(?:^|,\s*)[A-Z]\.\s+[a-z][a-z-]*\s+(?:is|are|was|were)\s+(?:commonly|generally|widely)?\s+known\s+as\b/i.test(sentence)) {
      if (trace) trace.skippedSentences.push({ sentence });
      continue;
    }

    // "Common names for these/those species" uses a deictic reference to species
    // enumerated earlier in the article, so the names are species-scoped, not
    // genus-scoped (e.g. "Common names for these species include bitterleaf...").
    if (/common\s+names?\s+for\s+(?:these|those)\s+species\b/i.test(sentence)) {
      if (trace) trace.skippedSentences.push({ sentence });
      continue;
    }

    // A sentence whose subject is a cultivar generically ("the most common
    // cultivar is known as ...", "a cultivar is known as ...") yields cultivar
    // names, not species common names. Skip those. (Specific "X, a cultivar,
    // also known as Y" sentences are NOT skipped, so Y is still captured.)
    if (/\b(?:the\s+most\s+common\s+cultivar|a\s+cultivar\s+is|the\s+cultivar\s+is)\b/i.test(sentence)) {
      if (trace) trace.skippedSentences.push({ sentence });
      continue;
    }

    const caps = [];

    // ─── Sentence-open constructions ─────────────────────────────────────
    // R1: Leading appositive — "Genus species, <names>, is/was a..."
    const r1 = sentence.match(/^([A-ZÀ-Ÿ][\w.''\u2019×-]+(?:\s+[×\w.''\u2019×-]+){0,3})(?:\s*\([^)]*\))?,\s+(.+?)(?:\s+(?:is|was)\s+(?:a|an|the|some|one)\b)/i);
    if (r1) {
      const subject = r1[1];
      const nameList = r1[2];
      // Reject prepositional/framing subjects ("In the other half", "In particular")
      // so non-appositive commas aren't mistaken for common-name lists.
      const prepositionalSubject = /^(?:in|on|at|of|for|with|as|by|to|from|while|although|though|because|since|when|where|if|despite|unlike|among|between|during|throughout|including|such)\s+/i;
      // Reject disease/pathogen appositives ("Botrytis cinerea, or gray mold,
      // is a common fungal infection of...") — the alias names a disease of
      // the plant, not the plant itself.
      const diseaseRemainder = /\b(?:fungal|bacterial|viral|infection|disease|pathogen)\b/i.test(sentence.slice(r1[0].length));
      if ((isSubjectBinomial(subject) || /^The\s+/i.test(subject)) && !prepositionalSubject.test(subject) && !diseaseRemainder) {
        caps.push({ rule: 'R1', capture: nameList });
      }
    }

    // R2: "X or Y is a..." — alternative name at sentence start
    const r2 = sentence.match(/^([A-ZÀ-Ÿ][\w.''-]+(?:\s+[\w.''-]+){0,3})\s+or\s+(.+?)(?:\s+(?:is|was)\s+(?:a|an|the|some|one)\b)/i);
    if (r2 && isSubjectBinomial(r2[1])) {
      caps.push({ rule: 'R2', capture: r2[2] });
    }

    // R3: "The X (Binomial), also called/known as..." — leading name + parenthetical binomial + alias
    const r3 = sentence.match(/^(The\s+.+?)\s+\(([A-Z][a-z]+\s+[a-z]+[^)]*)\)\s*(?:,\s*)?(also\s+(?:called|known\s+as))\s+(.+?)(?:\s+is\b|$)/i);
    if (r3) {
      const leadName = stripArticle(r3[1]).trim();
      const genericSubjects = /^(?:olive|onion|pine|oak|elm|maple|palm|ivy|rose|lily|poplar|birch|cedar|fir|spruce|willow|ash|beech|cherry|apple|pear|plum|fig|grape|berry|nut|bean|pea|corn|rice|wheat|barley|oat|rye|cane|reed|bamboo|grass|fern|moss|algae|flower|tree|shrub|herb|plant|vine|bush|cactus|orchid|tulip|daisy|iris|lilac|jasmine|magnolia|eucalyptus|acacia|thistle)$/i;
      if (leadName && !isAbbreviatedBinomialLike(leadName) && !genericSubjects.test(leadName)) {
        caps.push({ rule: 'R3', capture: leadName });
      }
      caps.push({ rule: 'R3', capture: r3[4] });
    }

    // R4: "The X (Binomial) is..." — leading common name only
    const r4 = sentence.match(/^(The\s+)(.+?)\s+\(([A-Z][a-z]+\s+[a-z]+[^)]*?)\)\s+(?:is|was|are|were)/i);
    if (r4 && !r3) {
      const leadName = r4[2].trim();
      const parenContent = r4[3].trim();
      // The parenthetical must be a proper binomial (capitalized genus), not a
      // descriptive aside like "(felled in 2015 at approximately 316 years old)"
      // (the /i flag lets the regex match lowercase, so require an uppercase start)
      if (!/^[A-ZÀ-Ÿ]/.test(parenContent)) {
        if (trace) trace.rejected.push({ name: parenContent, rule: 'R4', by: 'non-binomial-paren' });
      } else {
        // If parenthetical contains a quoted common name, extract it
        const quotedName = parenContent.match(/["']([^"']+)["']/);
        if (quotedName) {
          caps.push({ rule: 'R4', capture: quotedName[1].trim() });
        }
        // Reject single-word generic subjects (e.g. "olive" in "The olive (botanical name...)")
        const genericSubjects = /^(?:olive|onion|pine|oak|elm|maple|palm|ivy|rose|lily|poplar|birch|cedar|fir|spruce|willow|ash|beech|cherry|apple|pear|plum|fig|grape|berry|nut|bean|pea|corn|rice|wheat|barley|oat|rye|cane|reed|bamboo|grass|fern|moss|algae|flower|tree|shrub|herb|plant|vine|bush|cactus|orchid|tulip|daisy|iris|lilac|jasmine|magnolia|eucalyptus|acacia|thistle)$/i;
        if (leadName && !isAbbreviatedBinomialLike(leadName) && leadName.length > 1 && !genericSubjects.test(leadName)) {
          caps.push({ rule: 'R4', capture: leadName });
        }
      }
    }

    // R4b: "The X (Binomial L., ...) is..." or "The X (Binomial L., ...), also known as Y, is..."
    // (R4b's broad ", clause," tail is only safe because the paren must carry an author citation "L.")
    const r4b = sentence.match(/^(The\s+)(.+?)\s+\(([A-Z][a-z]+\s+[a-z]+\s+L\.[^)]*)\)(?:\s*,\s*[^,]+)?\s*,?\s+(?:is|was|are|were)/i);
    if (r4b && !r4 && !r3) {
      const leadName = r4b[2].trim();
      const parenContent = r4b[3].trim();
      // Extract quoted common name
      const quotedName = parenContent.match(/["']([^"']+)["']/);
      if (quotedName) {
        caps.push({ rule: 'R4b', capture: quotedName[1].trim() });
      }
      // Reject single-word generic subjects
      const genericSubjects = /^(?:olive|onion|pine|oak|elm|maple|palm|ivy|rose|lily|poplar|birch|cedar|fir|spruce|willow|ash|beech|cherry|apple|pear|plum|fig|grape|berry|nut|bean|pea|corn|rice|wheat|barley|oat|rye|cane|reed|bamboo|grass|fern|moss|algae|flower|tree|shrub|herb|plant|vine|bush|cactus|orchid|tulip|daisy|iris|lilac|jasmine|magnolia|eucalyptus|acacia|thistle)$/i;
      if (leadName && !isAbbreviatedBinomialLike(leadName) && leadName.length > 1 && !genericSubjects.test(leadName)) {
        caps.push({ rule: 'R4b', capture: leadName });
      }
    }

    // R4c: "X (etymology), or Y, is a Z" — leading name with parenthetical etymology + alternative name
    const r4c = sentence.match(/^([A-ZÀ-Ÿ][\w''\u2019-]+)\s+\([^)]*(?:\([^)]*\)[^)]*)*(?:meaning|from|derived|Greek|Latin|ancient)[^)]*(?:\([^)]*\)[^)]*)*\)\s*,?\s*or\s+(.+?)\s*,?\s*(?:is|was|are)/i);
    if (r4c && !r4 && !r3) {
      caps.push({ rule: 'R4c', capture: r4c[2] });
    }

    // R4d: "X is a genus of plants commonly known as Y" — lead name at sentence start
    const r4d = sentence.match(/^([A-ZÀ-Ÿ][\w''\u2019-]+)\s+(?:is|was)\s+(?:a|an)\s+(?:genus|species|family|plant|tree|shrub)\s+of\s+(?:plants?\s+)?(?:commonly|generally|widely)\s+known\s+as/i);
    if (r4d && !r4 && !r3 && !r4c) {
      caps.push({ rule: 'R4d', capture: r4d[1] });
    }

    // R5: "X (Binomial) is..." — no article (common name before parenthetical)
    // Only match when the parenthetical starts with a proper binomial (not "also known as")
    const r5 = sentence.match(/^([A-ZÀ-Ÿ][\w''\u2019-]+(?:\s+[\w''\u2019-]+){0,3})\s+\(([A-Z][a-z]+\s+[a-z]+[^)]*|[A-Z]\.\s+[a-z]+[^)]*)\)\s+(?:is|was|are|were)/i);
    if (r5) {
      const parenContent = r5[2].trim();
      // If parenthetical starts with naming markers, fall through to R5b
      if (/^(?:also|commonly|generally|widely|known|called|named|syn\.?|botanical)\s/i.test(parenContent)) {
        // Fall through to R5b
      } else {
        const lead = r5[1];
        const words = lead.split(/\s+/);
        // Reject article-led subjects (e.g. "The olive")
        if (/^(?:The|A|An)\s+/i.test(lead)) { /* skip, handled by R4 */ }
        else if (words.length >= 2 && !/^[A-Z]\.\s/.test(lead)) {
          // Skip "X or Y (abbrev.)" alternative-name constructions, which R59 handles
          if (/\s+or\s+/i.test(lead)) { /* skip, handled by R59 */ }
          // Accept if it's not a Latin binomial (common names like "Spanish moss" OK)
          else if (!isSubjectBinomial(lead)) {
            caps.push({ rule: 'R5', capture: lead });
          } else {
            // For binomial-like subjects, check epithet blocklist
            const epithetBlock = /^(?:fruit|leaf|tree|bark|root|seed|flower|wood|plant|moss)$/i;
            if (!epithetBlock.test(words[words.length - 1])) {
              caps.push({ rule: 'R5', capture: lead });
            }
          }
        }
        else if (words.length === 1 && !/^[A-Z]\.\s/.test(lead)) {
          // Single-word common names like "Cauliflower" before a binomial parenthetical
          const genericSubjects = /^(?:olive|onion|pine|oak|elm|maple|palm|ivy|rose|lily|poplar|birch|cedar|fir|spruce|willow|ash|beech|cherry|apple|pear|plum|fig|grape|berry|nut|bean|pea|corn|rice|wheat|barley|oat|rye|cane|reed|bamboo|grass|fern|moss|algae|flower|tree|shrub|herb|plant|vine|bush|cactus|orchid|tulip|daisy|iris|lilac|jasmine|magnolia|eucalyptus|acacia|thistle)$/i;
          if (!genericSubjects.test(lead)) {
            caps.push({ rule: 'R5', capture: lead });
          }
        }
      }
    }

    // R5b: "X (also known as/called Y, Z) is..." — single-word name before parenthetical alias list
    const r5b = sentence.match(/^([A-ZÀ-Ÿ][\w''\u2019-]+)\s+\(\s*(?:also\s+)?(?:known\s+as|called)\s+(.+?)\)\s+(?:is|was|are)/i);
    if (r5b) {
      caps.push({ rule: 'R5b', capture: r5b[1] });
      caps.push({ rule: 'R5b', capture: r5b[2] });
    }

    // ─── Parenthetical glosses ───────────────────────────────────────────
    // R6: Parenthetical common names — "ScientificName (known as/called/commonly known as X, Y, Z) is"
    // Only when the gloss directly follows a scientific name (uppercase-initial word, optionally + epithet),
    // so mechanism/other English heads like "Secondary pollen presentation (also known as ...)" are excluded.
    const r6 = sentence.match(/([A-Za-zÀ-ÿ][\w''\u2019-]+(?:\s+[a-z][\w''\u2019-]+)?)\s*\(\s*(?:(?:also|commonly)\s+)?(?:known\s+as|called|named|referred\s+to\s+as)\s+(.+?)\)\s+(?:is|was|are)/i);
    if (r6 && /^[A-ZÀ-Ÿ]/.test(r6[1])) {
      caps.push({ rule: 'R6', capture: r6[2] });
    }

    // R6b: Parenthetical with "common names" prefix — "(common names X, Y, Z) is"
    const r6b = sentence.match(/\(\s*common\s+names?\s+(.+?)\)\s+(?:is|was|are)/i);
    if (r6b) {
      caps.push({ rule: 'R6b', capture: r6b[1] });
    }

    // R6b2: Parenthetical with "botanical name Binomial, "name"" — extract the quoted/common name
    const r6b2 = sentence.match(/\(\s*botanical\s+name\s+[A-Z][a-z]+\s+[a-z]+[^,]*,\s*["']?([^"')]+?)["']?\s*\)\s+(?:is|was|are)/i);
    if (r6b2) {
      caps.push({ rule: 'R6b2', capture: r6b2[1].trim() });
    }

    // R6c: Parenthetical bare name list — "(X, Y, Z or W) is a species" (Rosa, Rubus)
    const r6c = sentence.match(/\(\s*([^)]+?)\)\s+(?:is|was|are)\s+(?:a|an|the|some|native|endemic)/i);
     if (r6c && !r6 && !r6b && !r6b2) {
      const content = r6c[1];
      const isBotanicalSeq = /^(?:[A-Z][a-z]+\.?\s&?\s*)+/.test(content.trim());
      // Filter out synonym-only, botanical-name, author-abbreviation content,
      // and pure botanical-name sequences with no comma (these are binomials,
      // not common-name lists). Comma-containing lists are name lists.
      if (!/^\s*syn\.?\s/i.test(content)
          && !/^\s*botanical\s+name\s/i.test(content)
          && !isAbbreviatedBinomialLike(content)
          && !(isBotanicalSeq && !content.includes(','))) {
        caps.push({ rule: 'R6c', capture: content.split(';')[0].trim() });
      }
    }

    // R6d: "(name), syn. X, is a species" — parenthetical name with syn. annotation
    const r6d = sentence.match(/\(\s*([^)]+?)\)\s*,\s*syn\.?\s+\S+\s+\S+,?\s+(?:is|was|are)\s+(?:a|an|the|some)/i);
    if (r6d && !r6c) {
      const content = r6d[1];
      if (!/^\s*syn\.?\s/i.test(content) && !/^\s*botanical\s+name\s/i.test(content)) {
        caps.push({ rule: 'R6d', capture: content });
      }
    }

    // R61: "The X (also known as Y, Z, ...) is a..." — leading name plus an
    // alias-list parenthetical that is not a binomial (handled separately by
    // R4/R4b), e.g. "The bell pepper (also known as sweet pepper, paprika,
    // pepper, capsicum or ... mango) is the fruit of...".
    const r61 = sentence.match(/^The\s+([A-ZÀ-Ÿa-zà-ÿ][\w''\u2019-]*(?:\s+[\w''\u2019-]+){0,2})\s*\(\s*(?:also\s+)?known\s+as\s+(.+?)\)\s+(?:is|was|are|were)\b/i);
    if (r61) {
      caps.push({ rule: 'R61', capture: r61[1] });
      caps.push({ rule: 'R61', capture: r61[2] });
    }

    // R62: "X (often/sometimes shortened to Y), or Z (...), is a..." —
    // leading name with a shortened-form parenthetical and an alternative
    // name before the copula, e.g. "Kiwifruit (often shortened to kiwi), or
    // Chinese gooseberry (traditional Chinese: ...), is the edible berry...".
    const r62 = sentence.match(/^([A-ZÀ-Ÿ][\w''\u2019-]+(?:\s+[\w''\u2019-]+){0,3})\s*\(\s*(?:often|sometimes)\s+shortened\s+to\s+([A-Za-zà-ÿ][\w''\u2019-]+)\s*\)\s*,\s*or\s+([A-Za-zà-ÿ][\w''\u2019-]+(?:\s+[\w''\u2019-]+){0,2})\s*\([^)]*\)\s*,?\s+(?:is|was|are|were)\b/i);
    if (r62) {
      caps.push({ rule: 'R62', capture: r62[1] });
      caps.push({ rule: 'R62', capture: r62[2] });
      caps.push({ rule: 'R62', capture: r62[3] });
    }

    // R7: "known by the common name[s]" / "known by the name[s]" / "referred to by the common name[s]" — stop at copula or end.
    // Allows an intervening geographic qualifier ("known in the West by the common name X",
    // "known in English by the common name X"). Quoted names (e.g. "Ginger wort",
    // "Malaysian ginger") may be Capitalized-lowercase like a binomial, so R7 marks
    // its captures with allowBinomialLike to bypass that classifier.
    const r7 = sentence.match(/(?:(?:known)(?:\s+in\s+(?:the\s+)?\w+)?|referred\s+to)\s+by\s+the\s+(?:common\s+)?names?\s+(.+?)(?:\s+(?:is|was|are|were)\s+(?:a|an|the|some|one)\b|$)/i);
    if (r7) {
      const capture = finalizeCapture(r7[1], 300);
      if (capture) caps.push({ rule: 'R7', capture: capture, allowBinomialLike: true });
    }

    // ─── "known as / called / referred to as" ────────────────────────────
    // R8: "commonly known as" / "generally known as" — stop at copula, an
    // explanatory "because" clause, or end. The comma-terminator list also
    // stops at a comma followed by a bare copula (is/are/was/were), so a name
    // list like "rosinweeds, are herbaceous perennial plants growing to ..."
    // (Silphium genus) terminates at "rosinweeds," instead of swallowing the
    // whole descriptive tail ("with yellow flowerheads that resemble
    // sunflowers").
    // Note: family-restatement filtering (e.g. "Fabaceae or commonly known as
    // legume or bean family") is centralized in addNames via isFamilyRestatement.
    const r8 = sentence.match(/(?:commonly|generally|widely)\s+known\s+as\s+(?:the\s+)?(.+?)(?:\s+(?:is|was|are|were)\s+(?:a|an|the|some|one)\b|\s*,\s+(?:of|usually|typically|placed|classified|a\s+(?:species|genus|plant|tree|subspecies|variety)|is|are|was|were)\b|\s+because\b|$)/i);
    if (r8) {
      const capture = finalizeCapture(r8[1], 300);
      if (capture) caps.push({ rule: 'R8', capture: capture });
    }

    // R8b: "known as the X" — without commonly/generally, only match in taxonomic context
    const r8b = sentence.match(/,\s+known\s+as\s+(?:the\s+)?(.+?)(?:\s+(?:is|was|are|were)\s+(?:a|an|the)\b|$)/i);
    if (r8b && !r8) {
      // Safety: sentence must have a taxonomic predicate or mention hybrid/genus/species/plant
      const hasTaxonomicPredicate = /is\s+(?:a|an)\s+(?:flowering\s+)?(?:plant|tree|shrub|herb|vine|fern|grass|species|genus|subspecies|variety|cultivar|weed|flower|bush|moss|alga|crop|vegetable|palm)\b/i.test(sentence)
        || /was\s+(?:a|an)\s+(?:flowering\s+)?(?:plant|tree|shrub|herb|vine|fern|species|genus)\b/i.test(sentence)
        || /\b(?:hybrid|genus|species)\b/i.test(sentence);
      if (hasTaxonomicPredicate) {
        const capture = finalizeCapture(r8b[1], 300);
        if (capture) caps.push({ rule: 'R8b', capture: capture });
      }
    }

    // R9: "commonly called" — stop at copula or end
    const r9 = sentence.match(/commonly\s+called\s+(?:the\s+)?(.+?)(?:\s+(?:is|was|are|were)\s+(?:a|an|the|some|one)\b|$)/i);
    if (r9) {
      const capture = finalizeCapture(r9[1], 300);
      if (capture) caps.push({ rule: 'R9', capture: capture });
    }

    // R9b: Parenthetical literal-gloss — "(lit. 'Alishan azalea')" yields the
    // translated common name.
    const r9b = sentence.match(/lit\.?\s*['"“]([^'"]+)['"”]/i);
    if (r9b) {
      const capture = finalizeCapture(r9b[1], 200);
      if (capture && !isGenericJunk(capture)) caps.push({ rule: 'R9b', capture: capture });
    }

    // R9c: "hence the name X" / "whence the name X" — etymological common name
    // inside a parenthetical or clause (e.g. "May (hence the name mayapple)").
    const r9c = sentence.match(/(?:hence|whence|thus|whereby)\s+the\s+name\s+([A-Za-z][\w''\u2019-]+(?:\s+[\w''\u2019-]+)*?)\b/i);
    if (r9c) {
      const capture = finalizeCapture(r9c[1], 200);
      if (capture && !isGenericJunk(capture)) caps.push({ rule: 'R9c', capture: capture });
    }

    // R9d: "Other common names [recorded] include X, Y, and Z" — explicit list.
    // Restricted to forms with "recorded" or an "Other" lead so it does not
    // overlap with R12 ("Common names include ..."), which is already labeled R12.
    const r9d = sentence.match(/(?:(?:other\s+)?common\s+names?\s+recorded|other\s+common\s+names?)\s+(?:include|are)\s+(.+?)(?:\.|$)/i);
    if (r9d) {
      const capture = finalizeCapture(r9d[1], 300);
      if (capture) caps.push({ rule: 'R9d', capture: capture });
    }

    // R9e: Genus common-name from free text — "Xs are plants of the genus Y"
    // (X is the plural vernacular; strip trailing 's' to singular) and
    // "the fruit of the X is the Y" (both X and Y are vernacular names).
    const r9e = sentence.match(/^([A-Za-zÀ-ÿ]+s)\s+are\s+(?:plants?|trees?|shrubs?|species)\s+of\s+the\s+genus\b/i);
    if (r9e) {
      const singular = r9e[1].replace(/s$/i, '');
      if (singular.length > 2 && !isGenericJunk(singular)) caps.push({ rule: 'R9e', capture: singular.toLowerCase() });
    }
    const r9f = sentence.match(/\bthe\s+fruit\s+of\s+the\s+([A-Za-zÀ-ÿ][\w''\u2019-]*)\s+is\s+(?:the\s+)?([A-Za-zÀ-ÿ][\w''\u2019-]*)/i);
    if (r9f) {
      if (!isGenericJunk(r9f[1])) caps.push({ rule: 'R9f', capture: r9f[1] });
      if (!isGenericJunk(r9f[2])) caps.push({ rule: 'R9f', capture: r9f[2] });
    }

    // R10: "known as" / "called" — at sentence start ("It is...") or
    // mid-sentence (after a comma, with or without "also") — stop at copula
    const r10 = sentence.match(/(?:\s*,\s+(?:also\s+)?(?:known\s+as|called)\s+|^It\s+(?:is|was)\s+also\s+(?:known\s+as|called)\s+)(.+?)(?:\s+(?:is|was|are|were)\s+(?:a|an|the|some|one|any)\b|\s+(?:has|have)\b|$)/i);
    if (r10) {
      const r10Prologue = sentence.slice(0, r10.index);
      // Reject attribution sentences naming a people/nation/tribe ("...Anishinaabe
      // people, also known as the Chippewa, Ojibwa and Ojibwe.")
      // Also reject when "known as" modifies a plant PART (fruit/leaf/flower/...)
      // rather than the whole plant — the gloss is about the part, not a species
      // common name (e.g. "Cecropia fruit, known as snake fingers, ...").
      if (/\b(?:people|nation|tribes?|tribal)\b/i.test(r10Prologue)
          || /\b(?:fruit|fruits|leaf|leaves|flower|flowers|seed|seeds|bark|root|roots|stem|stems|wood|branch|branches|foliage|nut|nuts|cone|cones|petal|petals|sap|tuber|bulb|thorn|spine|husk|peel|rind|grain|kernel)\b/i.test(r10Prologue.slice(r10Prologue.lastIndexOf(',') + 1))) { /* skip */ }
      else {
        let capture = truncateAtDescriptiveClause(r10[1].replace(/\s*[.,]\s*$/, ''));
        // Reject attribution context: "by the indigenous people", "by the Cahuilla"
        if (capture.length < 300 && !/\s+by\s+(?:the\s+)?(?:indigenous|native|local|aboriginal|tribe|people)/i.test(capture)) {
          caps.push({ rule: 'R10', capture: capture });
        }
      }
    }

    // R11: "referred to as" mid-sentence — capture to end
    const r11 = sentence.match(/referred\s+to\s+as\s+(?:a\s+)?(.+?)(?:\s+(?:is|was|are|were)\s+(?:a|an|the)\b|$)/i);
    if (r11) {
      const capture = finalizeCapture(truncateAtDescriptiveClause(r11[1]), 300);
      // Reject anatomical structures, lumber-industry jargon, and provenance
      if (capture
          && !/\b(?:structures?|anatomical|spurs|peduncles?|stamens?|pistils?|stigma|ovary|ovules?|anthers?|filaments?|petals?|sepals?|leaves?|roots?|stems?|bark|wood|tissues?|cells?|organs?)\b/i.test(sentence)
          && !/\b(?:logging|industry|lumber|timber|shipped|intergrades?|variety)\b/i.test(sentence)
          && !/\b(?:specific\s+epithet|generic\s+epithet|species\s+epithet|common\s+names?\s+are\s+from|etymology|named\s+(?:after|for))\b/i.test(sentence)
          && !/\btransliterat/i.test(sentence)) {
        caps.push({ rule: 'R11', capture: capture });
      }
    }

    // R11b: "The name X is often applied to" — extract the name before "is often applied"
    const r11b = sentence.match(/^(?:The\s+)?name\s+(.+?)\s+is\s+(?:often|also|commonly|frequently|widely)\s+applied\s+to/i);
    if (r11b) {
      let capture = r11b[1].trim();
      if (capture.length < 200) caps.push({ rule: 'R11b', capture: capture });
    }

    // R11c: "Members are commonly known as X, Y, or Z" and "Some species of
    // this genus are known as ironweeds" — plural subject with naming pattern.
    // "commonly" is optional ("are known as" alone), and an "of this/the genus"
    // qualifier may sit between the subject noun and the copula.
    const r11c = sentence.match(/(?:members|species|plants?|trees?|shrubs?)\s+(?:of\s+(?:this|the)\s+genus\s+)?(?:are|is)\s+(?:commonly\s+)?known\s+as\s+(.+?)(?:\s*\.|$)/i);
    if (r11c) {
      const capture = finalizeCapture(r11c[1], 300);
      if (capture) caps.push({ rule: 'R11c', capture: capture });
    }

    // R11d: "known by various common names including X, Y" — pattern with "various"
    const r11d = sentence.match(/known\s+by\s+various\s+common\s+names?\s+(?:including\s+)?(.+?)(?:\s*[,]?\s*(?:among|amongst|as well as)\s+other\s+names?\b|$)/i);
    if (r11d) {
      const capture = finalizeCapture(r11d[1], 300);
      if (capture) caps.push({ rule: 'R11d', capture: capture });
    }

    // R11e: "plants known as X" — extraction for "known as" after a plant/crop
    // noun subject, allowing an intervening parenthetical (e.g. "split lentils
    // (often with their hulls removed) known as dal are...").
    const r11e = sentence.match(/(?:plants?|trees?|lentils?|legumes?|pulses?|beans?|peas?|grains?|cereals?|herbs?|shrubs?|vines?|grasses?|seeds?|fruits?|berries?|crops?)\s+(?:\([^)]*\)\s*)?known\s+as\s+(?:the\s+)?(.+?)(?:\s*\.|\s*(?:with|in|that|which|is|are|has|have)\b|$)/i);
    if (r11e) {
      // Skip "List of plants known as X" see-also titles — not a naming statement.
      if (/^list\s+of\b/i.test(sentence)) continue;
      const capture = finalizeCapture(r11e[1], 200);
      if (capture && !isGenericJunk(capture)) caps.push({ rule: 'R11e', capture: capture });
    }

    // ─── Common-name list constructions ──────────────────────────────────
    // R12: "common names include" / "Common names for X include" — capture full list, stop at though/despite
    const r12 = sentence.match(/common\s+names?\s+(?:for\s+.+?\s+)?(?:usually\s+)?(?:include|are)\s+(.+?)(?:\s*,\s*(?:though|despite|but)\b|$)/i);
    if (r12) {
      const capture = finalizeCapture(r12[1], 300);
      if (capture) caps.push({ rule: 'R12', capture: capture });
    }

    // R13: "English names include" / "names include" / "Other names include" / "English names variously applied to... include"
    const r13 = sentence.match(/(?:(?:English|Other|additional|alternate|alternative)\s+)?(?:vernacular\s+)?names?\s+.*?include\s+(.+)/i);
    if (r13) {
      const capture = finalizeCapture(r13[1], 300);
      // Reject provenance clauses: "from the Amur River region..."
      if (capture && !/^(?:from\s+the|in\s+(?:northeastern|southern|northern|western|eastern|central))/i.test(capture)) {
        caps.push({ rule: 'R13', capture: capture });
      }
    }

    // R14: "with the common name[s]"
    // Note: family-restatement filtering is centralized in addNames.
    const r14 = sentence.match(/with\s+the\s+common\s+names?\s+(.+?)(?:\s+(?:is|was|are|were)\s+(?:a|an|the)\b|\s+(?:applied|used|given)\b|$)/i);
    if (r14) {
      const capture = finalizeCapture(r14[1], 200);
      if (capture) caps.push({ rule: 'R14', capture: capture });
    }

    // R15: "known commonly as" — capture to copula, "because" clause, or end.
    // The `because` terminator mirrors R8 (line 1185): the Chilopsis intro "known
    // commonly as desert willow or desert-willow because of its willow-like leaves"
    // must stop at "because" so the explanatory tail doesn't leak as a name.
    const r15 = sentence.match(/known\s+commonly\s+as\s+(?:the\s+)?(.+?)(?:\s+(?:is|was|are|were)\s+(?:a|an|the|some|one)\b|\s+because\b|$)/i);
    if (r15) {
      const capture = finalizeCapture(r15[1], 300);
      if (capture) caps.push({ rule: 'R15', capture: capture });
    }

    // R16: "commonly named"
    const r16 = sentence.match(/commonly\s+named\s+(?:the\s+)?(.+?)(?:\s+(?:is|was)\s|$)/i);
    if (r16) {
      const capture = finalizeCapture(r16[1], 200);
      if (capture) caps.push({ rule: 'R16', capture: capture });
    }

    // R17: "The name X is often applied" / "The name X is a common name"
    const r17 = sentence.match(/The\s+name\s+(.+?)\s+is\s+(?:often\s+)?(?:applied|used)/i);
    if (r17) {
      caps.push({ rule: 'R17', capture: r17[1] });
    }

    // R49: "The English common names X and Y are shared by closely related genera"
    const r49 = sentence.match(/(?:The\s+)?(?:English\s+)?common\s+names?\s+(.+?)\s+are\s+shared\s+by/i);
    if (r49) {
      caps.push({ rule: 'R49', capture: r49[1] });
    }

    // R18: "Alternative names ... are X and Y" — capture full list
    const r18 = sentence.match(/Alternative\s+names\s+(?:in\s+.+?\s+)?are\s+(.+)/i);
    if (r18) {
      const capture = finalizeCapture(r18[1], 300);
      if (capture) caps.push({ rule: 'R18', capture: capture });
    }

    // R19: "has/have the common names X and Y" — capture full list; terminate at
    // an explanatory "because" clause (e.g. Arnoglossum "They have the common
    // name Indian plantain because they resemble the unrelated common plantain")
    // so the gloss tail isn't swallowed as part of the name.
    const r19 = sentence.match(/(?:has|have)\s+the\s+common\s+names?\s+(.+?)(?:\s+because\b|$)/i);
    if (r19) {
      const capture = finalizeCapture(r19[1], 300);
      if (capture) caps.push({ rule: 'R19', capture: capture });
    }

    // R20: "with the common English name X"
    const r20 = sentence.match(/with\s+the\s+common\s+(?:English\s+)?name\s+(.+?)(?:\s+(?:is|was|are)\s|,)/i);
    if (r20) {
      const capture = finalizeCapture(r20[1], 200);
      if (capture) caps.push({ rule: 'R20', capture: capture });
    }

    // R21: "simply referred to as"
    const r21 = sentence.match(/simply\s+referred\s+to\s+as\s+(.+?)(?:\s*[.,]|$)/i);
    if (r21) {
      const capture = finalizeCapture(r21[1], 200);
      if (capture) caps.push({ rule: 'R21', capture: capture });
    }

    // R22: "X is a species... also called Y" in same sentence (Rubus parviflorus)
    const r22 = sentence.match(/the\s+fruit\s+of\s+which\s+is\s+commonly\s+called\s+(?:the\s+)?(.+?)(?:\s*,\s+is\b|\s*[.,]\s*$)/i);
    if (r22) {
      const capture = finalizeCapture(r22[1], 200);
      if (capture) caps.push({ rule: 'R22', capture: capture });
    }

    // ─── "known as / called / referred to as" ────────────────────────────
    // R23: "more commonly X" / "more commonly known as X"
    const r23 = sentence.match(/,\s+more\s+commonly\s+(?:known\s+as\s+)?(?:the\s+)?(.+?)(?:\s*,\s+is\b|\s+(?:is|was)\b|\s*[.,]\s*$)/i);
    if (r23) {
      const capture = finalizeCapture(r23[1], 200);
      if (capture) caps.push({ rule: 'R23', capture: capture });
    }

    // R24: "called X, Y, or Z" after comma, before "is" (Lilium regale), and
    // "curd called Romanesco broccoli." (Cauliflower). Negative lookbehind keeps
    // "also called"/"is called"/"was called"/"being called" constructions for
    // other rules.
    const r24 = sentence.match(/(?<!(?:also|is|are|was|were|being)\s)called\s+(?:the\s+)?(.+?)(?:\s+(?:is|was)\s+(?:a|an|the)\b|\s*[.,]\s*$)/i);
    if (r24) {
      const capture = finalizeCapture(r24[1], 200);
      // Reject historical/etymological attribution: "called Salvia by the Romans"
      // is the Latin name used by an ancient people, not a common name. The bare
      // "by the <People>" (no "indigenous"/"people" qualifier) is a Latin-name
      // marker; indigenous-name attributions ("by the indigenous Cahuilla") are
      // preserved by R10/R25 elsewhere.
      if (capture && !/\s+by\s+the?\s+[A-Z][a-z]+\b/.test(capture)) {
        caps.push({ rule: 'R24', capture: capture });
      }
    }

    // R25: "is known as X" — passive form. The tail terminates the capture at
    // a place/language qualifier ("in <Place>"), a subordinate-clause
    // introducer (because/which/where/…), or a clause/sentence end, so that
    // name-list connectors ("and"/"or") and multi-word names ("mañío hembra")
    // are never treated as truncation points.
    const r25 = sentence.match(/is\s+known\s+as\s+(?:the\s+)?(.+?)(?:\s+in\s+[A-Z\u00C0-\u024F][\w.''\u2019-]*(?:\s+[A-Z\u00C0-\u024F][\w.''\u2019-]*)*|\s+(?:because|since|which|who|whose|that|where|when|while|although|though|if|unless|until|but)\b|,\s+(?:which|who|whose|that|because|since|where|when|while|although|though|if|unless|but)\b|[.;]\s*$)/i);
    if (r25) {
      let capture = r25[1].trim();
      // Reject explanatory single-word nicknames: "is known as "stinking" because..."
      const bare = capture.replace(/["']/g, '').trim();
      const isSingleWord = bare.length > 0 && !/\s/.test(bare);
      // The matched phrase may swallow trailing stop words ("because some"), so
      // examine the text that follows the captured name itself.
      const nameEnd = r25.index + r25[0].indexOf(capture) + capture.length;
      const isExplanatory = /\b(?:because|since)\s+/i.test(sentence.slice(nameEnd));
      if (!(isSingleWord && isExplanatory)) {
        capture = capture.replace(/\s*[.,]\s*$/, '');
        if (capture.length < 200) caps.push({ rule: 'R25', capture: capture });
      }
    }

    // R26: "called X in Y" — language qualifier
    const r26 = sentence.match(/called\s+(.+?)\s+in\s+(?:Japanese|Afrikaans|Greek|Welsh|Spanish|French|German|Italian|Portuguese|Dutch|Russian|Chinese|Korean|Hindi|Arabic|Turkish|Persian|Thai|Vietnamese|Indonesian|Malay|Tagalog|Swahili|Zulu|Xhosa|Yoruba|Hausa|Amharic)/i);
    if (r26) {
      const capture = finalizeCapture(r26[1], 200);
      if (capture) caps.push({ rule: 'R26', capture: capture });
    }

    // R-lang: unquoted multilingual/indigenous naming list — "called X in the
    // <Lang> language, Y in the <Lang2> language, and both Z and W in the <Lang3>
    // language" (e.g. Cleomella serrulata: "The plant is called waaʼ in the Navajo
    // language, tumi in the Hopi language, and both aʼpilalu and ado꞉we in the Zuni
    // language."). extractNamesFromCapture strips each "in the <Lang> language"
    // qualifier per clause; the "both" lead-in is dropped via LEADING_PREFIX_PATTERNS.
    if (/(?:is|are|was|were)\s+called\s+.+?\s+in\s+(?:the\s+)?[A-Z][A-Za-z-]+\s+language\b/i.test(sentence)) {
      const rLang = sentence.match(/(?:is|are|was|were)\s+called\s+(.+?)\s*\.\s*$/i);
      if (rLang) {
        const capture = finalizeCapture(rLang[1], 300);
        if (capture) caps.push({ rule: 'R-lang', capture: capture });
      }
    }

    // R46: "where it is called X" / "called X" in subordinate clause (Farfugium "tsuwabuki")
    const r46 = sentence.match(/(?:where|in)\s+(?:it|this|the)(?:\s+(?:plant|species|tree))?\s+is\s+called\s+(.+?)(?:\s*[.,;]|$)/i);
    if (r46) {
      let capture = r46[1].replace(/\s*[(),].*$/, '').trim();
      if (capture && capture.length < 200 && !hasCJK(capture) && !isInsideParens(sentence, r46.index)) {
        caps.push({ rule: 'R46', capture: capture });
      }
    }

    // R47: "the pickle, Bogori aachar (বগৰি আচাৰ), is famous" — proper food-name
    // compound named after a generic food descriptor, before a parenthetical gloss.
    const r47 = sentence.match(/\b(?:pickles?|jam(?:s)?|preserves?|chutneys?|dishes?|drinks?|teas?|sauces?|curries?|stews?|soups?|breads?|cakes?)\s*,\s*([A-Z][A-Za-z-]*(?:\s+[A-Za-z-]+)*)\s*\(\s*[^)]*\s*\)/i);
    if (r47) {
      let capture = r47[1].replace(/\s*[.,]\s*$/, '').trim();
      if (capture && capture.length < 200) {
        caps.push({ rule: 'R47', capture: capture });
      }
    }

    // R27: "X (syn. Y) is..." — skip synonym, check for trailing common names
    // Already handled by extractNamesFromCapture filtering "syn." segments

    // R28: Parenthetical after binomial with "common names" inside
    const r28 = sentence.match(/\([A-Z][a-z]+\s+[a-z]+[^)]*,\s*(?:also\s+)?(?:called|known\s+as|commonly\s+known\s+as)\s+(.+?)\)/i);
    if (r28 && !r3 && !r6) {
      caps.push({ rule: 'R28', capture: r28[1] });
    }

    // R29: "called" after binomial parenthetical, comma before "is"
    const r29 = sentence.match(/\([A-Z][a-z]+\s+[a-z]+[^)]*\)\s*,\s*(?:also\s+)?(?:called|known\s+as)\s+(.+?)(?:\s+(?:is|was)\s+[a]\b|,)/i);
    if (r29) {
      caps.push({ rule: 'R29', capture: r29[1] });
    }

    // R29b: trailing item of a "known as A, …, and C is a …" intro list —
    // the lazy R29 capture stops at the first comma, dropping final items
    // (e.g. "and garden stonecrop is a succulent …")
    const r29b = sentence.match(/(?:called|known\s+as)\s+.+?,\s+and\s+([^()]+?)\s+(?:is|was)\s+(?:a|an|the)\b/i);
    if (r29b && r29b[1]) {
      caps.push({ rule: 'R29b', capture: r29b[1].trim() });
    }

    // R30: "are referred to as X" — passive plural
    const r30 = sentence.match(/are\s+referred\s+to\s+as\s+(?:a\s+)?(.+?)\.\s*$/i);
    if (r30) {
      const capture = finalizeCapture(r30[1], 300);
      if (capture && !/\b(?:dioecious|species|monoecious)\b/i.test(capture)) {
        caps.push({ rule: 'R30', capture: capture });
      }
    }

    // R31: "is a common name" / "is commonly called" 
    const r31 = sentence.match(/(?:is|are)\s+(?:a\s+)?common\s+name(?:\s+in\s+.+?)?(?:\s+for\s+.+?)?\s*$/i);
    if (r31) {
      const subject = sentence.split(/\s+(?:is|are)\s+/i)[0].trim();
      if (subject && !isSubjectBinomial(subject)) {
        caps.push({ rule: 'R31', capture: subject });
      }
    }

    // R32: "Numerous common names exist... such as X, Y, Z"
    const r32 = sentence.match(/common\s+names?\s+exist[^,]*,\s*(?:such\s+as\s+)?(.+?)\.\s*$/i);
    if (r32) {
      caps.push({ rule: 'R32', capture: r32[1] });
    }

    // R32b: "depending on region, such as X, Y, Z"
    const r32b = sentence.match(/depending\s+on\s+region\s*,\s*(?:such\s+as\s+)?(.+?)\.\s*$/i);
    if (r32b) {
      caps.push({ rule: 'R32b', capture: r32b[1] });
    }

    // R33: "The common name (ScientificName), also called..." 
    const r33 = sentence.match(/^(The\s+.+?)\s+\([^)]+\)\s*,\s*also\s+called\s+(?:the\s+)?(.+?)(?:\s+(?:is|was)\s+[a]\b|,)/i);
    if (r33) {
      caps.push({ rule: 'R33', capture: stripArticle(r33[1]).trim() });
      caps.push({ rule: 'R33', capture: r33[2] });
    }

    // ─── Common-name list constructions ──────────────────────────────────
    // R34: "with common names including" / "with common name" / "with various common names, such as" — capture to copula or end
    const r34 = sentence.match(/with\s+(?:various\s+)?common\s+names?\s*(?:,\s*suc+h\s+as\s*|including\s*)?(.+?)(?:\s+(?:is|was|are|were)\s+(?:a|an|the)\b|$)/i);
    if (r34) {
      const capture = finalizeCapture(r34[1], 300);
      if (capture) caps.push({ rule: 'R34', capture: capture });
    }

    // R35: "Common names include X, though..." — truncate at "though"
    const r35 = sentence.match(/common\s+names?\s+(?:for\s+.+?\s+)?(?:usually\s+)?(?:include|are)\s+(.+?)(?:\s*,\s*though\b|\s*[.,]|$)/i);
    if (r35) {
      const capture = finalizeCapture(r35[1], 200);
      if (capture) caps.push({ rule: 'R35', capture: capture });
    }

    // R35b: "Alternative names ... are X and Y" — alternative name list
    const r35b = sentence.match(/(?:alternative|other|local|regional)\s+names?\s+(?:for\s+.+?\s+)?(?:in\s+.+?\s+)?(?:are|include)\s+(.+?)(?:\s*[.,]|$)/i);
    if (r35b) {
      const capture = finalizeCapture(r35b[1], 300);
      if (capture) caps.push({ rule: 'R35b', capture: capture });
    }

    // R36: "(common name) is a genus" — parenthetical before "is a genus/species/plant"
    const r36 = sentence.match(/\)\s+\((.+?)\)\s+is\s+(?:a\s+)?(?:genus|species|plant)/i);
    if (r36) {
      caps.push({ rule: 'R36', capture: r36[1] });
    }

    // R37: "Chives, scientific name X, is" — leading name before "scientific name"
    const r37 = sentence.match(/^([A-ZÀ-Ÿ][\w.''-]+(?:\s+[\w.''-]+){0,3}),\s+scientific\s+name\s+/i);
    if (r37) {
      caps.push({ rule: 'R37', capture: r37[1] });
    }

    // R38: "X, often known as Y, Z, or W, is..." — appositive with "often known as"
    const r38 = sentence.match(/^([A-ZÀ-Ÿ][\w.''-]+(?:\s+[\w.''-]+){0,3})\s*,\s*(?:often\s+)?known\s+as\s+(.+?)(?:\s+(?:is|was)\s+(?:a|an|the)\b)/i);
    if (r38 && isSubjectBinomial(r38[1])) {
      caps.push({ rule: 'R38', capture: r38[2] });
    }

    // R39: "are commonly known as X, Y, or Z" — mid-sentence plural
    const r39 = sentence.match(/are\s+commonly\s+known\s+as\s+(.+?)(?:\s*[.,]|$)/i);
    if (r39) {
      const capture = finalizeCapture(r39[1], 200);
      if (capture) caps.push({ rule: 'R39', capture: capture });
    }

    // R40: "is also widely cultivated as an ornamental" — skip
    // (not a name extraction, no action needed)

    // R41: "In Russia, fireweed is made into a tea known as Ivan-Chai"
    // Match "known as" with or without preceding comma, but NOT when preceded
    // by a copula (is/are/was/were) which would indicate explanatory context
    // like "It is known as X because..." rather than a naming context.
    const r41Match = sentence.match(/((?:,\s*|\s)(\w+)\s+known\s+as\s+)(.+?)(?:\s+\(|\s+because\s+|$)/i);
    if (r41Match && !r8 && !r8b && !r6) {
      const preWord = r41Match[2].toLowerCase();
      if (!/^(?:is|are|was|were|be|been|also)$/.test(preWord) && !isInsideParens(sentence, r41Match.index)) {
        let capture = r41Match[3].replace(/\s*\(.*$/, '').trim();
        // Strip surrounding quotes and a trailing period ("Agave Noah". -> Agave Noah)
        capture = capture.replace(/^["'\u2018\u2019\u201C\u201D]+/, '').replace(/["'\u2018\u2019\u201C\u201D]+\.?\s*$/, '').trim();
        if (capture && capture.length < 200 && capture.length > 2) {
          let trimmed = capture;
          // Trim at "and/or commonly as" even in comma lists (Wisteria: "Agrobacterium and commonly as crown gall, is...")
          if (/\b(?:and|or)\s+commonly\s+as\b/i.test(capture)) {
            trimmed = capture.replace(/\s+(?:and|or)\s+commonly\s+as\b.*/i, '').trim();
          } else if (!/,/.test(capture)) {
            // Only trim at "or/and" when the capture is a single name (no comma list);
            // for comma-separated lists like "cruciferous vegetables, cabbages, ... or simply brassicas"
            // the "or" is a list connector, not a terminator.
            trimmed = capture.replace(/\s+(?:or|and)\s+.*$/i, '').trim();
          }
          if (trimmed && !isGenericJunk(trimmed)) caps.push({ rule: 'R41', capture: trimmed });
        }
      }
    }

    // R48: regional common-name distribution —
    // "called X in <place>, Y, Z, or W in <place>, and V in <place>"
    // e.g. "being called flor de izote in Mexico, ... flores de palma (palm flowers)
    //       in Hidalgo and San Luis Potosí, guayas, cuaresmeñas, or chochos in Veracruz,
    //       and chochas in Tamaulipas"
    const r48 = sentence.match(/(?:being\s+)?(?:also\s+)?called\s+(.+?)\s*[.;]\s*$/i);
    const r48Places = (r48 && r48[1].match(/\sin\s+[A-ZÀ-Ÿ][A-Za-zÀ-ÿ-]*(?:\s+[A-ZÀ-Ÿ][A-Za-zÀ-ÿ-]*)*(?:\s+(?:and|&)\s+[A-ZÀ-Ÿ][A-Za-zÀ-ÿ-]*(?:\s+[A-ZÀ-Ÿ][A-Za-zÀ-ÿ-]*)*)*/g)) || [];
    if (r48 && r48Places.length >= 2) {
      let clause = r48[1];
      // Remove embedded sentence restarts ("yucca flowers are also called")
      clause = clause.replace(/\b[A-Za-z' -]+?\s+(?:flowers?|plants?|trees?|shrubs?)\s+are\s+(?:also\s+)?(?:called|known\s+as)\s+/gi, ' ');
      // Remove " in <Place>( and <Place>)*" qualifiers
      clause = clause.replace(/\s+in\s+[A-ZÀ-Ÿ][A-Za-zÀ-ÿ-]*(?:\s+[A-ZÀ-Ÿ][A-Za-zÀ-ÿ-]*)*(?:\s+(?:and|&)\s+[A-ZÀ-Ÿ][A-Za-zÀ-ÿ-]*(?:\s+[A-ZÀ-Ÿ][A-Za-zÀ-ÿ-]*)*)*/g, ' ');
      caps.push({ rule: 'R48', capture: clause });
    }

    // R50: quoted names after a naming verb — referred to as "winter (or spring) heather"
    const r50 = sentence.match(/(?:referred\s+to\s+as|called|known\s+as)\s+["'\u201C\u2018]([^"'\u201D\u2019]+)["'\u201D\u2019]/i);
    if (r50) {
      const inner = r50[1].trim();
      const bare = inner.replace(/["'\u201C\u201D]/g, '').trim();
      const isSingleWord = bare.length > 0 && !/\s/.test(bare);
      const nameEnd = r50.index + r50[0].length;
      const isExplanatory = /\b(?:because|since)\s+/i.test(sentence.slice(nameEnd));
      const hasJargon = /\b(?:logging|industry|lumber|timber|shipped|intergrades?|variety|anatomical|structures?|peduncles?|spurs|stamens?|pistils?|petals?|sepals?|leaves?|roots?|stems?|bark|wood|tissues?)\b/i.test(sentence);
      // Reject aliases bundled in a parenthetical directly after a scientific
      // binomial — they belong to that other taxon, not the article subject
      // (e.g. "Coffea canephora (known as \"Robusta\")").
      const beforeMatch = sentence.slice(0, r50.index);
      const otherTaxonAlias = /\([^()]*$/.test(beforeMatch)
        && /\b[A-Z][a-z]+\s+[a-z]+\s*\($/.test(beforeMatch);
      // Reject historical/etymological attribution after the quote: 'called
      // "Salvia" by the Romans' — the quoted name is the Latin name used by an
      // ancient people, not a common name. Bare "by the <People>" (no
      // "indigenous"/"people" qualifier) signals Latin-name usage; indigenous
      // attributions ("by the indigenous Cahuilla") use bare/qualified forms.
      const isPeopleAttribution = /\s+by\s+the?\s+[A-Z][a-z]+\b/.test(sentence.slice(nameEnd));
      if (!(isSingleWord && isExplanatory) && !hasJargon && !otherTaxonAlias && !isPeopleAttribution) {
        // Expand "winter (or spring) heather" → "winter heather", "spring heather"
        const alt = inner.match(/^(.+?)\s+\(\s*(?:also\s+)?(?:or|and)\s+(.+?)\s*\)\s+(.+)$/i);
        if (alt) {
          caps.push({ rule: 'R50', capture: `${alt[1]} ${alt[3]}` });
          caps.push({ rule: 'R50', capture: `${alt[2]} ${alt[3]}` });
        } else {
          caps.push({ rule: 'R50', capture: inner });
        }
      }
    }

    // R51: "often/sometimes/frequently (also) called (the) X" — "often called the Cape heaths",
    // "sometimes also called Virgilia" (adverb and "called" may be separated by "also")
    const r51 = sentence.match(/(?:often|sometimes|frequently)\s+(?:also\s+)?called\s+(?:the\s+)?(.+?)(?:\s*[,.;]\s*|$)/i);
    if (r51) {
      const capture = finalizeCapture(r51[1], 200);
      if (capture) caps.push({ rule: 'R51', capture: capture });
    }

    // R51b: "is also called X" — e.g. "Valerian is also called cat's love due to..."
    const r51b = sentence.match(/is\s+also\s+called\s+(?:the\s+)?(.+?)(?:\s+by\s+the\b|\s+due\s+to\b|\s*\.\s*|$)/i);
    if (r51b) {
      const capture = finalizeCapture(r51b[1], 200);
      if (capture) caps.push({ rule: 'R51b', capture: capture });
    }

    // R52: native-script name paired with romanized transliteration in a naming
    // sentence — "the Standard Chinese name 七子花 qī zi huā" (bare) and
    // "common name in Standard Chinese 七子花 (qī zi huā)" (parenthetical).
    const r52 = sentence.match(/([\u4e00-\u9fff\u3400-\u4dbf]+)\s*(?:\(\s*([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{1,40})\s*\)|([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{1,40})(?=[\s.,;)\u2014-]|$))/);
    if (r52 && /\bnames?\b/i.test(sentence)) {
      const roman = (r52[2] || r52[3] || '').trim();
      if (roman && roman.length > 1 && !hasCJK(roman)) {
        caps.push({ rule: 'R52', capture: roman });
      }
    }

    // R42: "and native to Asia" / "previously known as" filtering
    // Handled by extractNamesFromCapture's DROP markers

    // R43: "are consumed... referred to as X" — food context (Ziziphus jujuba)
    // `\b` on the trigger keeps "used" from matching inside "focused" (Wild rice).
    const r43 = sentence.match(/\b(?:consumed|eaten|used)\b\s+.*?(?:referred\s+to\s+as|known\s+as)\s+(?:a\s+)?(.+?)\.\s*$/i);
    if (r43 && !/\b(?:species|dioecious|genus)\b/i.test(sentence)) {
      const capture = finalizeCapture(r43[1], 200);
      if (capture && !isGenericJunk(capture)) {
        caps.push({ rule: 'R43', capture: capture });
      }
    }

    // R44: "Borage (pronunciation; Binomial), also known as starflower" — leading name before complex parenthetical
    const r44 = sentence.match(/^([A-ZÀ-Ÿ][\w.''-]+(?:\s+[\w.''-]+){0,2})\s+\(\s*(?:[;|/]|or)\s*;/i);
    if (r44) {
      caps.push({ rule: 'R44', capture: r44[1] });
    }

    // R45: "and the subspecies" — stop extraction at subspecies mention (Lyonothamnus)
    // Handled by boundary in regex patterns

    // R53: "P. d. monilifera (Aiton) Eckenw., the plains cottonwood (syn. ...) ranges from..." —
    //      subspecies appositive naming a common name in a Variation/Taxonomy section
    const r53 = sentence.match(/^[A-Z]\.\s+[a-z]\.\s+[^,]+,\s+(?:the\s+)?([A-Za-z][a-z]+(?:[ '\u2019-][a-zA-Z]+)*)(?=\s+(?:\(\s*syn\.|(?:is|are|was|were|ranges|grows|occurs|spreads|extends|is\s+found|is\s+native|is\s+endemic)\b))/i);
    if (r53) {
      caps.push({ rule: 'R53', capture: r53[1] });
    }

    // R54: "It has many vernacular names among which are X, Y, Z" — vernacular name list
    const r54 = sentence.match(/(?:has|having|with)\s+(?:many|several|numerous|various)\s+(?:vernacular|common|local|regional|alternative|indigenous|traditional)\s+names?\s+among\s+(?:which|them)\s+(?:are|include)\s+(.+?)(?:\s*[.,]\s*$|$)/i);
    if (r54) {
      const capture = finalizeCapture(r54[1], 300);
      if (capture) caps.push({ rule: 'R54', capture: capture });
    }

    // R55: "known by its genus name, or sometimes as X and Y" — alternative
    // name list following an "or sometimes as" construction (Saxegothaea).
    const r55 = sentence.match(/\bor\s+sometimes\s+as\s+(.+?)(?=[.;]|$)/i);
    if (r55) {
      const capture = finalizeCapture(r55[1], 200);
      if (capture) caps.push({ rule: 'R55', capture: capture });
    }

    // R56: "Zinnia elegans (syn. Zinnia violacea) known as youth-and-age, common
    // zinnia or elegant zinnia, is an annual..." — parenthetical synonym then a
    // "known as" name list (Zinnia elegans).
    const r56 = sentence.match(/^([A-ZÀ-Ÿ][\w''\u2019-]+(?:\s+[\w''\u2019-]+){0,3})\s*\(\s*syn\.?\s+[^)]+\)\s+(?:also\s+)?known\s+as\s+(.+?)(?:\s+(?:is|was)\s+(?:a|an|the|some|one)\b|$)/i);
    if (r56) {
      const capture = finalizeCapture(r56[2], 200);
      if (capture) caps.push({ rule: 'R56', capture: capture });
    }

    // R57: "Bok choy (Am. Eng., ...), pak choi (Br. Eng., ...) or pok choi is a
    // type of..." — leading dialect-annotated name list (Bok choy).
    const r57 = sentence.match(/^([A-ZÀ-Ÿ][\w''\u2019-]+(?:\s+[\w''\u2019-]+){0,2})\s*\([^)]*\)\s*,\s*([A-ZÀ-Ÿa-zà-ÿ][\w''\u2019-]+(?:\s+[\w''\u2019-]+){0,2})\s*\([^)]*\)\s*,?\s+or\s+([a-zà-ÿ][\w''\u2019-]+(?:\s+[\w''\u2019-]+){0,2})\s+(?:is|was)\s+(?:a|an|the)\b/i);
    if (r57) {
      caps.push({ rule: 'R57', capture: r57[1] });
      caps.push({ rule: 'R57', capture: r57[2] });
      caps.push({ rule: 'R57', capture: r57[3] });
    }

    // R58: "It is also sometimes spelled as pak choi, bok choi, and pak choy." or
    // "The common name is also spelled false spirea." — alternate spellings list
    // (Bok choy, Sorbaria sorbifolia). The [^()] guard keeps it from also firing
    // on parenthetical "(also spelled camomile)" glosses, which are expanded
    // separately during capture cleanup.
    const r58 = sentence.match(/spelled\s+(?:as\s+)?([^()]+?)\.\s*$/i);
    if (r58) {
      const capture = finalizeCapture(r58[1], 200);
      if (capture) caps.push({ rule: 'R58', capture: capture });
    }

    // R59: "Southern or annual wild rice (Z. aquatica), also an annual, grows..." —
    // "X or Y (abbreviated binomial)" alternative names (Wild rice).
    const r59 = sentence.match(/^([A-ZÀ-Ÿ][\w''\u2019-]+)\s+or\s+(.+?)\s+\(([A-Z]\.\s+[a-z]+[^)]*)\)/i);
    if (r59) {
      const alt = r59[2].trim();
      const words = alt.split(/\s+/);
      if (words.length > 1) {
        caps.push({ rule: 'R59', capture: `${r59[1]} ${words.slice(1).join(' ')}` });
      }
      caps.push({ rule: 'R59', capture: alt });
    }

    // R60: "Jujube (UK ; US  or ), sometimes jujuba, scientific name Ziziphus
    // jujuba..." — leading name plus a secondary alternative name (Jujube).
    const r60 = sentence.match(/^([A-ZÀ-Ÿ][\w''\u2019-]+)\s*\([^)]*\)\s*,?\s*(?:sometimes|also)\s+([a-zà-ÿ][\w''\u2019-]*)\s*,\s*scientific\s+name\b/i);
    if (r60) {
      caps.push({ rule: 'R60', capture: r60[1] });
      caps.push({ rule: 'R60', capture: r60[2] });
    }

    addNames(caps, results, seenKeys, trace, sentence);
  }

  // --- Post-process: expand "the X or Y family" → "X family, Y family" ---
  const expanded = [];
  for (const name of results) {
    const familyMatch = name.match(/^(.+?)\s+or\s+(.+?)\s+(family|genus|species)\s*$/i);
    if (familyMatch) {
      const shared = familyMatch[3];
      const a = `${familyMatch[1]} ${shared}`.trim();
      const b = `${familyMatch[2]} ${shared}`.trim();
      for (const n of [a, b]) {
        const key = n.toLowerCase();
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          expanded.push(n);
          if (trace) trace.captures.push({ name: n, rule: 'Post-process: family' });
        }
      }
    } else {
      expanded.push(name);
    }
  }

  return expanded;
}

function extractWikipediaCommonNames(text) {
  return _extractWikipediaCommonNames(text, null);
}

// Debug helper: runs the full extraction pipeline while recording every
// decision. Returns { names, captures, rejected, skippedSentences }.
//   - names:            identical to extractWikipediaCommonNames(text)
//   - captures:         accepted names, labeled with the rule that produced them
//   - rejected:         names/captures dropped, labeled with the classifier
//                       (isGenericJunk, isGeographicJunk, isProcedural, hasCJK,
//                       isPronunciationNotation, isMeaningParen, provenance, duplicate)
//   - skippedSentences: sentences gated out by isTaxonomicSentence
function traceExtraction(text) {
  const trace = { captures: [], rejected: [], skippedSentences: [] };
  const names = _extractWikipediaCommonNames(text, trace);
  return Object.assign({ names }, trace);
}

module.exports = {
  parseGbifVernacularName,
  extractNamesFromCapture,
  extractWikipediaCommonNames,
  traceExtraction
};
