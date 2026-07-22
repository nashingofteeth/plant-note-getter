# Common Name Extraction: Regex Refinement Guide

## Goal

Use existing plant notes as ground truth to find and fix gaps in the Wikipedia common name extraction pipeline. Each round fixes one issue, adds a test, and verifies no regressions.

## Data Flow

```
app.js → wikidata.js (fetchWikipediaCommonNames → WIKI_PATTERNS → extractNamesFromCapture)
       → tagcheck.js → frontmatter.js → notes.js
```

The extraction pipeline:
1. Fetch Wikipedia extract via `action=query&prop=extracts&exintro&explaintext`
2. Try each pattern in `WIKI_PATTERNS` (A through I) against the extract
3. Pass captured text to `extractNamesFromCapture()` for cleanup
4. Return deduplicated list of common names

## Process

### 1. Build a list of species from existing notes

```bash
ls /path/to/NOTE_ROOT/ | grep -E '^[A-Z][a-z]+ [a-z]+\.md$' | sed 's/\.md$//' > /tmp/plant_list.txt
```

Filter out non-species files (movies, albums, organizations, etc).

Randomly select 20 species that do **not** already have a test case in `test/common-names.test.js`. This ensures each round discovers new patterns rather than re-testing already-covered species. Use the `expected` field from the TESTS array to check coverage — any species name not appearing in any test's name is a fresh target.

### 2. Batch-fetch Wikipedia extracts

Use the Wikipedia API in batches of 20 titles (larger batches truncate extracts):

```js
const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=&explaintext=&titles=${titlesParam}&format=json&redirects=1`;
```

Rate limit: 1200ms between requests, or batch 20 titles per request (but individual requests are more reliable for extract fetching). Use a descriptive `User-Agent` header with contact info per [Wikimedia API etiquette](https://www.mediawiki.org/wiki/API:Etiquette).

**Rate-limit errors**: The API returns `"You are making too many requests"` (non-JSON) when throttled. If your batch script gets non-JSON responses, implement exponential backoff (start 2s, double each retry, max 3 retries). Log which species got rate-limited so you can re-run them.

### 3. Run extraction and flag suspicious results

For each note, run `extractWikipediaCommonNames(extract)` and flag results containing:

- Geographic terms used as names: `found in`, `native to`, `subcontinent`, `asia`, `europe`, `boreal`, `temperate`, `tropical`, `regions`, `northern`, `southern`
- Unstripped prefixes: `also called`, `also known as`, `sometimes called`
- Procedural text: `consists`, `grows`, `ranging`, `occurs`, `includes`, `especially`, `within`
- Scientific names leaking through: `C. herbeohybrida`, `R. eglanteria`
- Generic plant terms: `lianas`, `herbs`, `shrubs`, `flowers`, `orange flowers`

### 4. For each issue found

**a. Reproduce in isolation**

```js
const { extractWikipediaCommonNames } = require('./src/wikidata');
const text = '...actual Wikipedia extract...';
console.log(extractWikipediaCommonNames(text));
```

**b. Trace which pattern fires**

Test each pattern manually:

```js
const WIKI_PATTERNS = [ /* paste from src/wikidata.js */ ];
const text = '...';
for (let i = 0; i < WIKI_PATTERNS.length; i++) {
  const m = WIKI_PATTERNS[i](text);
  if (m) console.log(`Pattern ${String.fromCharCode(65+i)}: ${m[1].slice(0, 80)}`);
}
```

**c. Identify the root cause**

Common root causes:
- Pattern matches across sentence boundaries (e.g., Pattern I before the `[^.;]` fix)
- Prefix strip doesn't apply to middle segments (e.g., "also called" after a comma)
- `\b` word boundary missing, matching inside words (e.g., "or" matching in "oregano")
- Lazy `.+?` matching too far before hitting the terminator
- Filter in `extractNamesFromCapture` missing a category (e.g., geographic terms)

**d. Fix the regex or filter**

- Prefer minimal regex changes that fix the specific case
- Use `[^.;]` or `[^.;]+?` to prevent crossing sentence boundaries
- Use `\b` word boundaries on connectors like `and`, `or`
- Add filters in `extractNamesFromCapture` for new categories of junk

**e. Verify the fix on the original species**

Before adding the test, re-run `extractWikipediaCommonNames` on the actual Wikipedia extract that triggered the issue. Confirm the bad names are gone and any legitimately expected names are still present. This catches cases where the fix is too aggressive.

**f. Add a test case**

Add to `TESTS` array in `test/common-names.test.js`:

```js
{
  name: 'Species name (brief description of the pattern)',
  extract: '...exact Wikipedia extract...',
  expected: ['name1', 'name2'],
},
```

Use the **actual** Wikipedia extract, not a paraphrase. This makes the test a regression anchor.

**g. Run full test suite**

```bash
npm test
```

All existing tests must still pass. If a fix breaks another case, the fix is wrong.

### 5. Common pitfalls

| Pitfall | Example | Fix |
|---------|---------|-----|
| Missing `\b` on connectors | `or` matching in `oregano` | Use `\b(?:and\|or)\b` |
| Lazy match crossing sentences | Pattern I matching entire extract | Use `[^.;]+?` to stop at period/semicolon |
| Prefix strip only on first segment | "also called" in middle segment | Apply strip per segment inside the comma-split loop |
| `\n` in extract breaking regex | Multi-paragraph extracts | Use `.replace(/\n+/g, ' ')` before matching |
| Redirect titles changing page content | `Pinus attenuata` → `Knobcone pine` | Always use `redirects=1` in API, handle in mapping |
| Unbounded `^[^,]+` in patterns B and C | Consumes 129 chars past no-comma-after-sci-name, matches "Balkan Peninsula, ... Ukraine. It" | Limit initial segment length: `^[^,]{1,100}` |

### 6. What NOT to fix

- **Legitimate geographic common names**: "European holly", "American basswood", "Chinese juniper" are real common names. Don't filter these.
- **Regional variants**: "Spanish bluebell" vs "wood hyacinth" — both are valid.
- **Pattern coverage gaps**: Some Wikipedia intros are too complex for any pattern. If the correct names come from Wikidata P1843 or GBIF, that's fine — Wikipedia extraction is supplementary.

### 7. Key files

| File | Role |
|------|------|
| `src/wikidata.js:316-351` | `WIKI_PATTERNS` array (regex patterns A-I) |
| `src/wikidata.js:358-430` | `extractNamesFromCapture()` (cleanup, filtering) |
| `src/wikidata.js:437-469` | `fetchWikipediaCommonNames()` (orchestrator) |
| `test/common-names.test.js` | Test cases (hardcoded extracts, no API calls) |

### 8. Batch check script

Use `/tmp/batch.js` pattern (or equivalent) to scan notes:

```js
// Batch 20 titles per request
// Run extractWikipediaCommonNames on each
// Flag suspicious results
// Report summary
```

Process notes in random order to avoid bias toward recently-added species.

## Example fix commit

```
fix: strip "also called" prefix from middle segments in extractNamesFromCapture

The prefix strip regex only applied to the start of the full captured string.
When "also called" appeared after a comma (e.g., "raspberry, also called red
raspberry"), it wasn't stripped and leaked through as a common name.

Added per-segment prefix stripping inside the comma-split loop.

Test: Rubus idaeus (Pattern A — "also called" prefix in middle segment)
```
