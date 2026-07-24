# Common Name Extraction: Per-Note Processing & Refinement Guide

## Goal

The user provides a taxon name (or a list of taxon names). Process that single note through the Wikipedia common name extraction pipeline, verify the output against the note's on-disk frontmatter, and fix any gaps or false positives. Each fix adds a regression test.

## Data Flow

```
app.js → wikidata.js (fetchWikipediaCommonNames → WIKI_PATTERNS → extractNamesFromCapture)
       → tagcheck.js → frontmatter.js → notes.js
```

The extraction pipeline:
1. Fetch Wikipedia extract (full article — `exintro` removed so patterns can reach `== Common names ==` sections)
2. Try each pattern in `WIKI_PATTERNS` against the extract
3. Pass captured text to `extractNamesFromCapture()` for cleanup
4. Return deduplicated list of common names

### Intro-only vs full-article extraction

`fetchWikipediaCommonNames()` fetches the full article (no `exintro`). This allows patterns to match content in `== Common names ==` sections and other non-intro locations. Patterns that fire on section-level content:
- **Pattern F** — `"Common names include X, Y, and Z"` (section heading content)
- **Pattern M** — `"The name X is (often|sometimes) applied to"` (section content)

To verify what the pipeline currently extracts for a species, call `fetchWikipediaCommonNames(title)` directly.

## Process

### 1. Resolve the taxon name

The user provides a scientific name like `Quercus rubra`. Determine the Wikipedia page title:
- Via Wikidata: `searchTaxon(name)` → Q-item → `entity.wikipediaUrl` → extract title from URL
- Or directly by treating the scientific name as a Wikipedia title (works for most species)

### 2a. Fetch the Wikipedia extract

```js
const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=&titles=${title}&format=json&redirects=1`;
```

The production pipeline fetches the full article (no `exintro`) so patterns can match `== Common names ==` sections. Use `redirects=1` to follow page redirects.

Use a descriptive `User-Agent` header per [Wikimedia API etiquette](https://www.mediawiki.org/wiki/API:Etiquette).

**Rate-limit errors**: If the API returns `"You are making too many requests"` (non-JSON), implement exponential backoff (start 2s, double each retry, max 3 retries).

### 2b. Read the existing note from NOTE_ROOT

Plant notes live directly in `NOTE_ROOT` (set in `.env`, typically `~/wikihew/`) as `.md` files. There are no subdirectories for plant species.

**Finding plant notes**: Filter by tag. Plant notes have a tag starting with `life/eukaryota/plantae`. Use `hasPlantTag()` from `src/frontmatter.js` or check manually:

```js
const { hasPlantTag } = require('./src/frontmatter');
const fm = parseFrontMatter(content);
if (hasPlantTag(fm)) { /* this is a plant note */ }
```

The note file path is `<NOTE_ROOT>/<sanitized-name>.md` where `sanitizeFilename()` (in `src/utils.js`) replaces `/\/*?"<>|/` with `''` and appends `.md`.

Parse the frontmatter (using `parseFrontMatter` from `src/frontmatter.js` or the regex `/^---\n([\s\S]*?)\n---/`). Collect:

- **`aliases`** — the common names already stored for this note
- **`tags`** — the hierarchy tag (useful to confirm the note is a plant)
- **`wikipedia`** — the Wikipedia page title used when the note was created

These are the ground truth for what the pipeline **did** extract. Any name in `aliases` that the current pipeline misses is a candidate bug. Any junk the pipeline now produces that isn't in `aliases` is a candidate false positive.

### 3. Run extraction and compare

```js
const { fetchWikipediaCommonNames } = require('./src/wikidata');
const extracted = await fetchWikipediaCommonNames(wikipediaTitle);
```

The pipeline extracts from the full article, including `== Common names ==` sections. Cross-reference against the note's `aliases`:

| Situation | Meaning |
|-----------|---------|
| Name in `aliases` but not in `extracted` | Pipeline missed it — likely a pattern gap |
| Name in `extracted` but not in `aliases` | May be newly discovered, or a false positive |
| Extracted names contain junk (geographic terms, prefixes, scientific names leaking) | Filter gap |

Flag suspicious extracted results containing:
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
  if (m) console.log(`Pattern [${i}]: ${m[1].slice(0, 80)}`);
}
```

**c. Identify the root cause**

Common root causes:
- Pattern matches across sentence boundaries (e.g., a pattern matching after a period that should have been constrained)
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

Before adding the test, re-run `fetchWikipediaCommonNames` on the actual Wikipedia title that triggered the issue. Confirm the bad names are gone and any legitimately expected names are still present. Then re-check against the note's `aliases` from step 2b to make sure names that were in the note are still extracted.

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
| Lazy match crossing sentences | A pattern matching across the entire extract instead of the first sentence | Use `[^.;]+?` to stop at period/semicolon |
| Prefix strip only on first segment | "also called" in middle segment | Apply strip per segment inside the comma-split loop |
| `\n` in extract breaking regex | Multi-paragraph extracts | Use `.replace(/\n+/g, ' ')` before matching |
| Redirect titles changing page content | `Pinus attenuata` → `Knobcone pine` | Always use `redirects=1` in API, handle in mapping |
| Unbounded `^[^,]+` in appositive patterns | Consumes 129 chars past no-comma-after-sci-name, matches "Balkan Peninsula, ... Ukraine. It" | Limit initial segment length: `^[^,]{1,100}` |

### 6. What NOT to fix

- **Legitimate geographic common names**: "European holly", "American basswood", "Chinese juniper" are real common names. Don't filter these.
- **Regional variants**: "Spanish bluebell" vs "wood hyacinth" — both are valid.
- **Pattern coverage gaps**: Some Wikipedia articles are too complex for any pattern. If the correct names come from Wikidata P1843 or GBIF, that's fine — Wikipedia extraction is supplementary.

### 7. Key files

| File | Role |
|------|------|
| `src/wikidata.js` | `WIKI_PATTERNS` array — search for `const WIKI_PATTERNS` |
| `src/wikidata.js` | `extractNamesFromCapture()` — cleanup and filtering |
| `src/wikidata.js` | `fetchWikipediaCommonNames()` — orchestrator |
| `test/common-names.test.js` | Test cases (hardcoded extracts, no API calls) |
| `src/frontmatter.js` | `parseFrontMatter()` — read existing note's YAML |
| `src/utils.js` | `sanitizeFilename()` — compute note path from name |
| `src/config.js` | `NOTE_ROOT` — directory containing plant notes |

### 8. Verification checklist

After fixing, verify:

1. `npm test` passes (all regression tests)
2. The original species' Wikipedia extract returns the correct expected names (via `fetchWikipediaCommonNames`)
3. The extracted names match (or improve upon) the note's existing `aliases`
4. No junk terms leak through (verify with the flag list from step 3)

For bulk processing across multiple notes, see `--populate` mode in `app.js` (via `populateMissingProperties` in `src/notes.js`).

## Example fix commit

```
fix: strip "also called" prefix from middle segments in extractNamesFromCapture

The prefix strip regex only applied to the start of the full captured string.
When "also called" appeared after a comma (e.g., "raspberry, also called red
raspberry"), it wasn't stripped and leaked through as a common name.

Added per-segment prefix stripping inside the comma-split loop.

Test: Rubus idaeus ("also called" prefix in middle segment)
```
