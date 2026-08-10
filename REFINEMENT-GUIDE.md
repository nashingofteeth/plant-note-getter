# Common Name Extraction: Per-Note Processing & Refinement Guide

## Goal

The user provides a taxon name (or a list of taxon names). Process that single note through the Wikipedia common name extraction pipeline, verify the output against the note's on-disk frontmatter, and fix any gaps or false positives. Each fix is driven by a regression test written first (red), then the fix makes it pass (green).

### Primary objective: extract ALL common names from the Wikipedia article

The Wikipedia article is a first-class name source (merged last in `collectCommonNames`, so its casing wins). The goal is **complete extraction** — capture every common name the article states for the taxon, even when those names are already present in the note via Wikidata/GBIF, and especially when they are **not** in the note yet. Treat the article text as the ground truth for what the pipeline *should* return, not the note's `aliases`.

This means `aliases` is **not** the target to match. Workflows that only diff the pipeline output against the existing note are incomplete — they miss legitimate common names the note never had:

- Read the Wikipedia extract in full (intro and `== Common names ==` sections) and enumerate the common names stated in it by hand.
- Compare that hand-built list against `fetchWikipediaCommonNames(title)` output. Every name you can find in the article that the pipeline misses is a gap to fix — regardless of whether it appears in the note's `aliases`.
- Names already in `aliases` are a useful cross-check for false positives and regressions, but a low extraction count (e.g., 1 name from an article that lists 9) is a strong signal the extraction is incomplete, not that the note is already fine.
- If the extracted count is suspiciously small relative to the article's named names, re-read the article text and hunt for unhandled constructions before concluding "nothing to fix."

## Data Flow

```
app.js → wikidata.js (search, entity data, synonyms, parent chain)
       → names.js (collectCommonNames: merges Wikidata P1843 + aliases, GBIF, Wikipedia; buildAliases)
       → common-names-fetch.js (GBIF API fetch, Wikipedia API fetch)
       → wiki-extract.js (common-name extraction from Wikipedia text — implementation pending reconstruction)
       → taxonomy.js (buildTagSegments: remaps + injections + rank-skipping via label-map.json)
       → tagcheck.js (hierarchy consistency against existing notes)
       → frontmatter.js (generateFrontMatter: YAML front matter string)
       → notes.js (createNoteFile: write .md to NOTE_ROOT)
```

The extraction pipeline:
1. Fetch Wikipedia extract (full article — no `exintro`, so extraction can reach `== Common names ==` sections)
2. Extract common names from the plain-text extract
3. Return deduplicated list of common names

The Wikipedia extraction implementation in `src/wiki-extract.js` was removed and is
being reconstructed from the ground up. Its intended behaviour is defined by the
regression tests in `test/common-names.test.js` and `test/wikidata.test.js`.
Refinement work should drive that reconstruction through new regression tests, not
by re-introducing prior implementation details.

To verify what the pipeline currently extracts for a species, call `fetchWikipediaCommonNames(title)` directly.

## Process

**Taxon selection**: Taxa must be chosen exclusively from notes already in `NOTE_ROOT` (the Obsidian vault). Pick existing plant notes — their filenames are scientific names with `.md` extension. This ensures refinement addresses actual on-disk notes rather than arbitrary names.

### 1. Resolve the taxon name

The user provides a scientific name like `Quercus rubra`. Determine the Wikipedia page title:
- Via Wikidata: `searchTaxon(name)` → Q-item → `entity.wikipediaUrl` → extract title from URL
- Or directly by treating the scientific name as a Wikipedia title (works for most species)

### 2a. Fetch the Wikipedia extract

```js
const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=&titles=${title}&format=json&redirects=1`;
```

The production pipeline fetches the full article (no `exintro`) so section-level name lists are reachable. Use `redirects=1` to follow page redirects.

Use a descriptive `User-Agent` header per [Wikimedia API etiquette](https://www.mediawiki.org/wiki/API:Etiquette).

**Rate-limit errors**: If the API returns `"You are making too many requests"` (non-JSON), implement exponential backoff (start 2s, double each retry, max 3 retries).

### 2b. Read the existing note from NOTE_ROOT

Plant notes live directly in `NOTE_ROOT` (set in `.env`) as `.md` files. There are no subdirectories for plant species.

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
const { fetchWikipediaCommonNames } = require('./src/common-names-fetch');
const extracted = await fetchWikipediaCommonNames(wikipediaTitle);
```

The pipeline extracts from the full article, including `== Common names ==` sections. Cross-reference against the note's `aliases`:

| Situation | Meaning |
|-----------|---------|
| Name in `aliases` but not in `extracted` | Pipeline missed it — likely a coverage gap |
| Name in `extracted` but not in `aliases` | Expected and desirable — a newly discovered name from the article. Verify it's a legitimate name (not junk), then let it flow into the note on update. |
| Extracted names contain junk (geographic terms, prefixes, scientific names leaking) | Filter gap |

Note: since the goal is complete extraction, "name in `extracted` but not in `aliases`" is the **normal, expected outcome** after a successful fix — it means you found names the note was missing. Don't treat new names as suspicious just because they aren't in the note yet.

Flag suspicious extracted results containing:
- Geographic terms used as names: `found in`, `native to`, `subcontinent`, `asia`, `europe`, `boreal`, `temperate`, `tropical`, `regions`, `northern`, `southern`
- Unstripped prefixes: `also called`, `also known as`, `sometimes called`
- Procedural text: `consists`, `grows`, `ranging`, `occurs`, `includes`, `especially`, `within`
- Scientific names leaking through: `C. herbeohybrida`, `R. eglanteria`
- Generic plant terms: `lianas`, `herbs`, `shrubs`, `flowers`, `orange flowers`

### 4. For each issue found

**a. Reproduce in isolation**

```js
const { extractWikipediaCommonNames } = require('./src/wiki-extract');
const text = '...actual Wikipedia extract...';
console.log(extractWikipediaCommonNames(text));
```

**b. Add the regression test first (red)**

Write the test *before* fixing, so it drives the fix — but only after you've hand-enumerated the expected names from the full article (step 2a/2b of the process), so the assertion is ground truth, not a guess. Add to `TESTS` array in `test/common-names.test.js`:

```js
{
  name: 'Species name (brief description of the construction)',
  extract: '...exact Wikipedia extract...',
  expected: ['name1', 'name2'],
},
```

Use the **actual** Wikipedia extract, not a paraphrase. This makes the test a regression anchor. Run the suite; the new test should fail against the current pipeline. The failure shows you the current (wrong) behavior, and the diff between `expected` and the actual output is what you're fixing.

**c. Fix the implementation**

The extraction logic in `src/wiki-extract.js` is being rebuilt from the ground up, so prefer structural solutions that generalise across many constructions instead of one-off special cases. Re-run the suite; the new test should now pass (green) and all existing tests must remain green.

**d. Verify the fix on the original species**

After the test is green, re-run `fetchWikipediaCommonNames` on the actual Wikipedia title that triggered the issue. Confirm the bad names are gone and any legitimately expected names are still present — the live fetch can surface names from article passages the hardcoded extract doesn't cover. Then re-check against the note's `aliases` from step 2b to make sure names that were in the note are still extracted.

**e. Run full test suite**

```bash
npm test
```

All existing tests must still pass. If a fix breaks another case, the fix is wrong. If the live verification in step d reveals additional gaps, extend the test's `extract`/`expected` and re-run the fix loop instead of making the fix pass silently.

### 5. What NOT to fix

- **Legitimate geographic common names**: "European holly", "American basswood", "Chinese juniper" are real common names. Don't filter these.
- **Regional variants**: "Spanish bluebell" vs "wood hyacinth" — both are valid.
- **Coverage gaps elsewhere**: If the correct names come from Wikidata P1843 or GBIF, that's fine — Wikipedia extraction is supplementary.

### 6. Key files

| File | Role |
|------|------|
| `src/wiki-extract.js` | Wikipedia text extraction — implementation to be reconstructed (stubbed) |
| `src/common-names-fetch.js` | `fetchWikipediaCommonNames()` — fetches extract, delegates extraction |
| `src/names.js` | `collectCommonNames()` — merges all name sources, returns `{ names, bySource }` |
| `src/names.js` | `buildAliases()` — final alias list for frontmatter |
| `test/common-names.test.js` | Test cases (hardcoded extracts, no API calls) |
| `test/wikidata.test.js` | `extractNamesFromCapture` unit cases (parenthetical/semicolon/language cleaning) |
| `test/names.test.js` | `collectCommonNames` merge order/dedup/provenance (stubbed fetches) |
| `src/frontmatter.js` | `parseFrontMatter()` — read existing note's YAML |
| `src/utils.js` | `sanitizeFilename()` — compute note path from name |
| `src/config.js` | `NOTE_ROOT` — directory containing plant notes |

### 6.5. Ask before adding exports

If during refinement you need to import an internal variable or utility that isn't exported, ask the user for permission before adding it to `module.exports`. Do not add exports unilaterally.

### 7. Verification checklist

After fixing, verify:

1. `npm test` passes (all regression tests)
2. The original species' Wikipedia extract returns the correct expected names (via `fetchWikipediaCommonNames`)
3. The extracted names match (or improve upon) the note's existing `aliases`
4. No junk terms leak through (verify with the flag list from step 3)

For bulk processing across multiple notes, see `--populate` mode in `app.js` (via `populateMissingProperties` in `src/notes.js`).