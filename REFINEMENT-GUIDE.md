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
       → wiki-extract.js (pure text extraction — functions implemented, locked by regression tests, incl. traceExtraction debug helper)
       → taxonomy.js (buildTagSegments: remaps + injections + rank-skipping via label-map.json)
       → tagcheck.js (hierarchy consistency against existing notes)
       → frontmatter.js (generateFrontMatter: YAML front matter string)
       → notes.js (createNoteFile: write .md to NOTE_ROOT)
```

The extraction pipeline:
1. Fetch Wikipedia extract (full article — no `exintro`, so extraction can reach `== Common names ==` sections)
2. Extract common names from the plain-text extract
3. Return deduplicated list of common names

The Wikipedia extraction implementation in `src/wiki-extract.js` is implemented
(architecture documented in AGENTS.md). Its behaviour is locked down by the
regression tests in `test/common-names.test.js`, `test/wikidata.test.js`, and
`test/trace.test.js`.
Refinement work drives improvements through new regression tests against the
existing implementation, not by rewriting it wholesale.

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
const { traceExtraction } = require('./src/wiki-extract');
const text = '...actual Wikipedia extract...';
console.log(traceExtraction(text));
```

`traceExtraction` returns the same `names` as `extractWikipediaCommonNames`,
plus `captures` (`{ name, rule }` — every accepted capture and the rule that
got it), `rejected` (`{ name, rule, by }` — every rejection and its
classifier reason), and `skippedSentences` (sentences gated out by
`isTaxonomicSentence`). Use it to pinpoint which rule captured (or rejected)
a name before writing the regression test — see 4.5 below.

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

The extraction logic lives in `src/wiki-extract.js` — prefer structural solutions that generalise across many constructions instead of one-off special cases. Its architecture (sentence segmentation → `isTaxonomicSentence` gating → per-sentence capture rules → `addNames` capture-level classifiers (`family-restatement` at `src/wiki-extract.js:445`) → per-segment `extractNamesFromCapture` classifiers → post-process `Post-process: family` at `src/wiki-extract.js:1594`) is documented in AGENTS.md.

Before editing any threshold/terminator/shared-head (`too-long` at `src/wiki-extract.js:318`, `descriptive-of` at `src/wiki-extract.js:200`, `sharedHead` at `src/wiki-extract.js:152`, or any `R#` terminator like `R8`/`R14`), run an impact grep: `rg -n "or citrus family|legume or bean|known as snake|with the common names|or citrus family|rue or citrus" test/common-names.test.js` and note which expects you touch. Prefer a capture-level classifier in `addNames` when a surface form (`X or Y family`) is ambiguous without sentence context — see §8 for when a targeted helper like `isFamilyRestatement` is appropriate (cite both failing `TESTS` entries in the comment). Re-run the full suite with `npm test 2>&1 | grep -E "✖|tests |pass|fail"`; the new test should now pass (green) and all existing tests must remain green.

**d. Verify the fix on the original species**

After the test is green, re-run `fetchWikipediaCommonNames` on the actual Wikipedia title that triggered the issue. Confirm the bad names are gone and any legitimately expected names are still present — the live fetch can surface names from article passages the hardcoded extract doesn't cover. Then re-check against the note's `aliases` from step 2b to make sure names that were in the note are still extracted.

**e. Run full test suite**

```bash
npm test
```

All existing tests must still pass. If a fix breaks another case, the fix is wrong. If the live verification in step d reveals additional gaps, extend the test's `extract`/`expected` and re-run the fix loop instead of making the fix pass silently.

### 4.5 Debug which rule captures or rejects a name

```js
const { traceExtraction } = require('./src/wiki-extract');
const t = traceExtraction('...actual Wikipedia extract...');
console.log(t.names);             // final names (identical to extractWikipediaCommonNames)
console.log(t.captures);          // [{ name, rule }] — accepted captures + originating rule
console.log(t.rejected);          // [{ name, rule, by }] — rejections + classifier reason
console.log(t.skippedSentences);  // non-taxonomic sentences gated out entirely
```

Debugging decision tree:

1. **A name is missing from `t.names`.**
   - First check `t.skippedSentences`: if the sentence containing the name was
     gated out, no rule will ever fire on it — widen `isTaxonomicSentence` and
     add a regression test.
   - Then check `t.captures`. Is the name captured at all?
     - **Not in `captures` and not in `rejected`**: no rule matched the
       construction. Consult the RULE INDEX + category banners at the top of
       the rule loop, then write a new capture rule (or widen an existing one)
       and a regression test.
     - **Not in `captures`, but in `rejected`**: a rule captured it but a
       classifier rejected it. The `by` reason names the classifier: fix the
       classifier (wrongly rejected) or the capture regex (grabbed the wrong
       passage). Also check capture-level classifiers in `addNames` (`family-restatement`, `common-name-header`) — they reject before `extractNamesFromCapture` and before the `sharedHead`/`Post-process: family` expansion.
     - **In `captures` with a different `rule` than expected**: an earlier rule
       won and stole the passage (rules fire in order; later rules guard
       against earlier ones with `!r#` checks). Adjust the guard or the winning
       rule's regex.
   - Check post-process expansion: `X or Y family` is expanded at `Post-process: family` (`src/wiki-extract.js:1594`) and at `sharedHead` inside `extractNamesFromCapture`. Both happen before `isTaxonRankRef` per-name checks, so a `family-restatement` rejection must happen at capture level in `addNames` (not per-name) to avoid the Vicia/Rutaceae clash.
2. **A junk name IS in `t.names`.** Its `captures` entry shows which rule
   produced it. Add it as a regression case, then fix that rule or route the
   passage through the correct classifier. If the junk came from a threshold change (e.g. `too-long >6` at `src/wiki-extract.js:318`) or a terminator change (`R8` `,?\s+`), audit siblings that share the terminator and run `grep -n "known as.*are a" test/common-names.test.js` to list impacted expects.
3. **A name sits in `t.rejected` with `by: 'duplicate'`.** Expected — it was
   already accepted by an earlier rule. Confirm the `rule` shown is a
   duplicate-prone sibling (e.g. R8 vs R1, R13/R35 vs R12) and move on.
4. **Length-gate or terminator thrash.** Before editing `too-long`, `descriptive-of` (`src/wiki-extract.js:200`), `sharedHead` (`src/wiki-extract.js:152`), or any `R#` terminator, grep the suite for the phrase you touch: `rg -n "or citrus family|legume or bean|known as snake|with the common names" test/common-names.test.js`. Full-suite `npm test` is required — `reeval` is deprecated (see §7).

### 5. What NOT to fix

- **Legitimate geographic common names**: "European holly", "American basswood", "Chinese juniper" are real common names. Don't filter these.
- **Regional variants**: "Spanish bluebell" vs "wood hyacinth" — both are valid.
- **Coverage gaps elsewhere**: If the correct names come from Wikidata P1843 or GBIF, that's fine — Wikipedia extraction is supplementary.

### 6. Key files

| File | Role |
|------|------|
| `src/wiki-extract.js` | Wikipedia text extraction — pure `extractWikipediaCommonNames` / `extractNamesFromCapture` / `traceExtraction`, locked by regression tests |
| `src/common-names-fetch.js` | `fetchWikipediaCommonNames()` — fetches extract, delegates extraction |
| `src/names.js` | `collectCommonNames()` — merges all name sources, returns `{ names, bySource }` |
| `src/names.js` | `buildAliases()` — final alias list for frontmatter |
| `test/common-names.test.js` | Test cases (hardcoded extracts, no API calls) |
| `test/trace.test.js` | `traceExtraction` parity/rule-label/rejection tests (no API calls) |
| `test/wikidata.test.js` | `extractNamesFromCapture` unit cases (parenthetical/semicolon/language cleaning) |
| `test/names.test.js` | `collectCommonNames` merge order/dedup/provenance (stubbed fetches) |
| `src/frontmatter.js` | `parseFrontMatter()` — read existing note's YAML |
| `src/utils.js` | `sanitizeFilename()` — compute note path from name |
| `src/config.js` | `NOTE_ROOT` — directory containing plant notes |

### 6.5. Ask before adding exports

If during refinement you need to import an internal variable or utility that isn't exported, ask the user for permission before adding it to `module.exports`. Do not add exports unilaterally.

### 7. Verification checklist

After fixing, verify:

1. Full suite green — run `npm test 2>&1 | grep -E "✖|tests |pass|fail"` and confirm `fail 0`. Do **not** use `tail -50` (hides early failures behind truncation) or custom `reeval` scripts — the repo's `/tmp/opencode/reeval.js` only parsed single-quoted `extract:` fields and missed double-quoted cases like *Photinia* (`test/common-names.test.js:725`), reporting 18/18 while `npm test` failed. Per the adopted option B, `reeval` is deprecated; `npm test` is the single source of truth (fast, ~225 ms).
2. The original species' Wikipedia extract returns the correct expected names (via `fetchWikipediaCommonNames`)
3. The extracted names match (or improve upon) the note's existing `aliases`
4. No junk terms leak through (verify with the flag list from step 3)

### 8. Known Tricky Pairs — reuse these patterns

These pairs share a surface form but require opposite handling; they drove the refinements in this session. Prefer the listed classifier/location over a new regex.

| Pair | Surface | Expected | Pattern to reuse |
|------|---------|----------|------------------|
| **Rutaceae vs Vicia** | `X or Y family` | `Rutaceae:457` `rue or citrus family` → `rue family, citrus family` (expand, via `sharedHead:152` + `Post-process: family:1594`); `Vicia:759` `legume or bean family` → `[]` (family-restatement). | `isFamilyRestatement:445` (`family Fabaceae or commonly known as`) checked centrally in `addNames:597` before `extractNamesFromCapture`. Do not add per-rule `R8`/`R14` guards. |
| **Cecropia vs Photinia vs Kiwifruit** | `, known as Y` / `, also known as Y` | `Cecropia:507` `fruit, known as snake fingers, are...` → `[]`; `Photinia:724` `Photinia × fraseri, known as red tip photinia and Christmas berry, is...` → `[red tip photinia, Christmas berry]`; `Kiwifruit:663` `...cultivar, also known as Oriental Red` → `[Oriental Red]`. | `R10:1086` part-word tail check (`lastIndexOf(',')` + `fruit/leaf/flower…` at `src/wiki-extract.js:1095`) and narrow cultivar subject guard (`src/wiki-extract.js:793`). Broadening `R10` without the tail check leaks `snake fingers`. |
| **Picea R1 vs R14** | `with the common names X, Y, and Z, is...` | `Picea:257` `with the common names Engelmann spruce...` → `[Engelmann spruce, mountain spruce, silver spruce]`. `R1:802` greedily captures `with the common names...` as appositive. | Segment-level `common-name-header` reject at `src/wiki-extract.js:207` (`/\bcommon\s+names?\b/i`). `R14:1168` must terminate at `applied/used/given` for `Alchemilla:749` `lady's mantle applied...` but not at `,` alone (would truncate Picea list). |
| **Alchemilla vs others** | `with the common name X applied...` | `Alchemilla:749` `lady's mantle applied generically...` → `[lady's mantle]`. | `R14:1168` terminator `|\s+(?:applied|used|given)\b` — add only this, not unscoped `,`. |
| **Length gate** | `too-long` | `Maianthemum` `feathery false lily of the valley` (6 words) must pass; `who made numerous botanical collections in the region` (7 words, `Abies:678` `Section:Names`) and `member of the white pine group` (6 words, `Pinus:693` `R1`) must fail. | Keep `>6` at `src/wiki-extract.js:318` and pair with semantic `descriptive-of:200` (`^member/part/kind... of\b`) rather than lowering/raising the number. |

When a surface form is ambiguous without sentence context (`X or Y family` without knowing if the sentence is `family Fabaceae or known as` vs `is a family, known as`), a targeted sentence-level helper like `isFamilyRestatement` is appropriate — cite both failing `TESTS` entries in its comment (per §4c).