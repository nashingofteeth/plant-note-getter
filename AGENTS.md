# Agent guidance for plant-note-getter

CLI tool: takes a scientific plant name, queries Wikidata/GBIF/Wikipedia, and writes an Obsidian note with a hierarchical tag, aliases, rank, and Wikipedia link.

## Prompt convention

If the user provides only a scientific plant name (e.g., "Quercus robur", "Pinus sylvestris", "Cladrastis kentukea") with no other instructions, treat it as a request to run the **refinement pipeline** as described in [`REFINEMENT-GUIDE.md`](./REFINEMENT-GUIDE.md). This means: pick the taxon's existing note in `NOTE_ROOT`, fetch its Wikipedia extract, run `fetchWikipediaCommonNames`, hand-enumerate the article's stated common names, diff against the extraction, and fix any gaps/false positives — reviewer prompt first, then the deterministic extractor — via a regression test (red first, then green), then `npm test`. Do **not** merely create/regenerate the note — refinement is about improving common-name extraction, not re-running `app.js`. The bare taxon-name trigger is distinct from an explicit request to create a note (e.g. "make a note for X" or running `app.js`).

## Data flow

```
app.js → wikidata.js (search, entity data, synonyms, parent chain)
       → names.js (collectCommonNames: merges Wikidata P1843 + aliases, GBIF, Wikipedia; buildAliases)
       → common-names-fetch.js (GBIF API fetch, Wikipedia API fetch + deterministic extraction)
       → wiki-extract.js (pure text extraction, no API)
       → llm-reviewer.js (end-of-Wikipedia LLM review in names.js: add/remove vs the deterministic list, applied verbatim)
       → llm-backend.js (Ollama daemon completer; null-completer fallback keeps regex-only)
       → review-log.js (JSONL review-gap tally; consumed by scripts/review-tally.js)
       → taxonomy.js (buildTagSegments: remaps + injections + rank-skipping via label-map.json)
       → tagcheck.js (hierarchy consistency against existing notes)
       → frontmatter.js (generateFrontMatter: YAML front matter string)
       → notes.js (createNoteFile: write .md to NOTE_ROOT)
```

## Key files

| File | Role |
|------|------|
| `app.js` | CLI entry, orchestrates pipeline, supports `--check` mode; LLM review is merged into the aliases before the write confirmations — `Create note?` gates new-note creation and the update prompt gates updates (`--apply` overrides both); accepted writes log the review via the `logReview` closure, denied ones record nothing |
| `src/wikidata.js` | Wikidata search, entity data, SPARQL parent chain, synonym data |
| `src/api-client.js` | HTTP transport, rate limiting, API URL constants |
| `src/names.js` | Common-name orchestration: `collectCommonNames` merges all sources, runs the end-of-Wikipedia LLM review when enabled and merges the reviewed list into the working names before returning (returns a `logReview` closure the caller invokes on accepted writes), `buildAliases` produces final list |
| `src/common-names-fetch.js` | Async API wrappers: `fetchGbifCommonNames`, `fetchWikipediaArticle` (deterministic: extract + `extractWikipediaCommonNames`), `fetchWikipediaCommonNames` |
| `src/wiki-extract.js` | Common-name extraction from Wikipedia text (pure, no API). `extractWikipediaCommonNames` / `extractNamesFromCapture` + `traceExtraction` debug helper, locked by regression tests. |
| `src/llm-reviewer.js` | End-of-Wikipedia LLM review, two focused passes: (1) remove pass returns a **keep/remove verdict for every entry** in the deterministic list (key-match enforced, categories informational — keep-bias prompt, keep rules stated before remove rules), (2) add pass finds missed names against the **original** base list so it can't re-propose removals (capped at 10 names; gall/individual exclusions lead the prompt). Receives the extract, the taxon's scientific name + rank, and the base list. Decisions applied verbatim — trim, empty-filter, case-insensitive dedup; **no junk classifiers or other deterministic gates after the LLM**. Only Wikipedia-derived names are in scope. Pure, DI of the completer; missing/broken completer degrades to the deterministic list, truncated completions yield reason `llm-truncated`. No default model — requires explicit `LLM_MODEL` (keep-bias tuned for small instruct models; reviewer ops facts in REFINEMENT-GUIDE §3). Exports `reviewWikipediaNames`, `parseReviewJson`, `parseNamesJson`, `buildAddPrompt`/`buildRemovePrompt`, `ADD_SYSTEM_PROMPT`/`REMOVE_SYSTEM_PROMPT`, `REVIEWER_JSON_SCHEMA`, `REMOVE_JSON_SCHEMA`. |
| `src/llm-backend.js` | Ollama daemon completer (greedy decoding) via `LLM_SERVER_URL`/`LLM_MODEL`: native `/api/chat` with `format: REVIEWER_JSON_SCHEMA`, `temperature: 0`, `num_predict: 2048`, `think: false`. Lazy singleton; any load failure yields a null completer so regex-only extraction keeps working. |
| `src/review-log.js` | `appendReviewRecord` JSONL writer for `.review-data/review-gaps.jsonl` (gitignored). Records include `baseNames`, `llmAdded`, and `llmRemoved` (with informational category). |
| `scripts/review-tally.js` | `npm run tally` — tallies LLM additions and removals across taxa and by removal category; `--regressions=N` prints copy-paste test snippets. |
| `src/taxonomy.js` | Builds tag segments from Wikidata ancestor chain (re-exports `buildAliases` from names.js) |
| `src/tagcheck.js` | Validates hierarchy consistency, prunes unknown clades |
| `src/frontmatter.js` | Generates/parses/updates YAML front matter |
| `src/notes.js` | Filesystem operations: read/write notes |
| `src/config.js` | Paths from `.env`: NOTE_ROOT, LABEL_MAP_PATH |
| `src/utils.js` | Shared helpers (filename sanitize, date, label-map loading, stripArticle, normalizeNameKey) |
| `label-map.json` | Single source of truth for tag remaps and hierarchy injections |
| `test/common-names.test.js` | Regression tests, no API calls, runs via `npm test` |
| `test/hierarchy.test.js` | Tag generation tests with mocked ancestor chains |
| `test/names.test.js` | `collectCommonNames` merge order/dedup/provenance, stubbed fetches, no API calls |
| `test/trace.test.js` | `traceExtraction` parity/rule-label/rejection tests, no API calls |

## Tag hierarchy via label-map.json

`label-map.json` controls tag output — no hardcoded species logic elsewhere.

1. **Maps labels to canonical segments** (e.g., `"coniferae": "pinophyta"`)
2. **Injects missing nodes** via `_inject` (e.g., `"gymnospermae": ["tracheophytes", "spermatophytes"]` adds before the node)
3. **Overrides a corrupted lineage** via `_overrides`: when a taxon's canonical segment matches an `_overrides` key, the whole path accumulated so far is replaced with the explicit value (a full path from the base up to and including that taxon). Used to work around known-bad Wikidata P171 chains (e.g. `"sciadopityaceae"` routed through equisetophyta, `"maianthemum"` through Solanaceae). Processing continues so narrower ancestors (genus/species) still append.
4. `buildTagSegments` (src/taxonomy.js): starts with `['life', 'eukaryota', 'plantae']`, then for each ancestor (highest to lowest rank): skip if `null` mapping/excluded rank/Q-code, map via `labelMap`, apply `_overrides`/`_inject` entries, append segment (deduped with `.includes()` against all segments, not just last). Two guards in src/taxonomy-guard.js run here too: `findExclusiveCladeViolations` drops a later mutually-exclusive major clade (e.g. both monocots and eudicots), and `findRankInversions` drops an ancestor that jumps back up the hierarchy (a broader rank after a specific one).

## Common name extraction (src/wiki-extract.js)

### Pipeline

```
Wikidata P1843 claims → wikidata.js (collectSynonymData) → names.js (collectCommonNames merges Wikidata + GBIF + Wikipedia)
(merged in this order — Wikipedia casing wins for duplicates; dedup via normalizeNameKey)
```

### Implementation

`extractWikipediaCommonNames(text)` and `extractNamesFromCapture(captured)` in
`src/wiki-extract.js` are implemented and pure (no API/fs/process I/O).
`parseGbifVernacularName` remains unchanged. Structure:

- `getSentences`/`sentenceEnds` segment the article into sentences
  (abbreviation-aware); `isTaxonomicSentence` gates which sentences get scanned.
- `== Common names ==` and `== Names ==` sections are extracted explicitly via
  `extractSection`, and every sentence in them is scanned.
- Per-sentence capture rules R1–R47 (in `extractWikipediaCommonNames`) pull
  name-list passages out of naming constructions: appositives, parenthetical
  glosses, "known as / called / referred to as", "common names include",
  "with the common name", etc. Rules are grouped under commented category
  banners, with a RULE INDEX block at the top of the loop.
- `extractNamesFromCapture` cleans a captured passage into individual names:
  prefix stripping via `LEADING_PREFIX_PATTERNS`, parenthetical/semicolon
  handling, `FILLER_SEGMENT_PATTERNS`, and rank/stopword/connector rejection.
- Whole-name classifiers reject junk before adding: `isGenericJunk`,
  `isGeographicJunk`, `isProcedural`, `isPronunciationNotation`,
  `isMeaningParen`, `isEtiologyParen`.
- `traceExtraction(text)` is a debug twin of `extractWikipediaCommonNames`:
  same names output, plus `captures` (`{ name, rule }` for every accepted
  capture with its originating rule label), `rejected`
  (`{ name, rule, by }` for every rejection with its classifier reason), and
  `skippedSentences` (non-taxonomic sentences gated out by
  `isTaxonomicSentence`). Use it to see exactly which rule captured (or
  rejected) a name while refining.

Refinement drives changes through new regression tests in
`test/common-names.test.js` (see
[`REFINEMENT-GUIDE.md`](./REFINEMENT-GUIDE.md)) — keep all existing cases green
and verify with `npm test` after any change.

## Tests

- `npm test` runs all test suite files.
- `test/common-names.test.js` — regression tests using hardcoded Wikipedia extracts (no API calls, instant, deterministic). Calls `extractWikipediaCommonNames(text)` — a pure function exported from `src/wiki-extract.js`.
- `test/hierarchy.test.js` — tag generation tests with mocked ancestor chains (no live Wikidata).
- `test/names.test.js` — `collectCommonNames` merge order/dedup/provenance + end-of-Wikipedia LLM review wiring (stubbed fetches/completer, no API calls).
- `test/trace.test.js` — `traceExtraction` parity/rule-label/rejection tests (no API calls).
- `test/reviewer.test.js` — `reviewWikipediaNames` add/remove application, dedup, fallbacks, `parseReviewJson`/`parseNamesJson`, REVIEWER_JSON_SCHEMA passthrough (stubbed completer, no API calls).
- `test/llm-backend.test.js` — Ollama completer request shape (`/api/chat`, `format` schema, greedy options), env overrides, probe/connection failure → null completer (stubbed fetch, no API calls).
- `test/review-log.test.js` — `appendReviewRecord` JSONL write/append/no-op/null-path/no-throw (no API calls).
- When modifying `label-map.json`, run hierarchy tests first. When modifying patterns or `extractNamesFromCapture`, run common-names tests first. When modifying `collectCommonNames` in `src/names.js`, run names tests first.

