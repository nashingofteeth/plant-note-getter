# Agent guidance for plant-note-getter

CLI tool: takes a scientific plant name, queries Wikidata/GBIF/Wikipedia, and writes an Obsidian note with a hierarchical tag, aliases, rank, and Wikipedia link.

## Prompt convention

If the user provides only a scientific plant name (e.g., "Quercus robur", "Pinus sylvestris") with no other instructions, treat it as the selection for the refinement guide ([`REFINEMENT-GUIDE.md`](./REFINEMENT-GUIDE.md)) and proceed with the full pipeline: search Wikidata → get entity data → synonyms → GBIF/Wikipedia common names → build tag chain → create note file.

## Data flow

```
app.js → wikidata.js (search, entity data, synonyms, parent chain)
       → names.js (collectCommonNames: merges Wikidata P1843 + aliases, GBIF, Wikipedia; buildAliases)
       → common-names-fetch.js (GBIF API fetch, Wikipedia API fetch)
       → wiki-extract.js (pure text extraction, no API)
       → taxonomy.js (buildTagSegments: remaps + injections + rank-skipping via label-map.json)
       → tagcheck.js (hierarchy consistency against existing notes)
       → frontmatter.js (generateFrontMatter: YAML front matter string)
       → notes.js (createNoteFile: write .md to NOTE_ROOT)
```

## Key files

| File | Role |
|------|------|
| `app.js` | CLI entry, orchestrates pipeline, supports `--populate` and `--check` modes |
| `src/wikidata.js` | Wikidata search, entity data, SPARQL parent chain, synonym data |
| `src/api-client.js` | HTTP transport, rate limiting, API URL constants |
| `src/names.js` | Common-name orchestration: `collectCommonNames` merges all sources, `buildAliases` produces final list |
| `src/common-names-fetch.js` | Async API wrappers: `fetchGbifCommonNames`, `fetchWikipediaCommonNames` |
| `src/wiki-extract.js` | Common-name extraction from Wikipedia text (pure, no API). `extractWikipediaCommonNames` / `extractNamesFromCapture` + `traceExtraction` debug helper, locked by regression tests. |
| `src/taxonomy.js` | Builds tag segments from Wikidata ancestor chain (re-exports `buildAliases` from names.js) |
| `src/tagcheck.js` | Validates hierarchy consistency, prunes unknown clades |
| `src/frontmatter.js` | Generates/parses/updates YAML front matter |
| `src/notes.js` | Filesystem operations: read/write notes, bulk populate |
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
3. `buildTagSegments` (src/taxonomy.js): starts with `['life', 'eukaryota', 'plantae']`, then for each ancestor (highest to lowest rank): skip if `null` mapping/excluded rank/Q-code, map via `labelMap`, inject any `_inject` entries, append segment (deduped with `.includes()` against all segments, not just last).

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
- `test/names.test.js` — `collectCommonNames` merge order/dedup/provenance (stubbed fetches, no API calls).
- `test/trace.test.js` — `traceExtraction` parity/rule-label/rejection tests (no API calls).
- When modifying `label-map.json`, run hierarchy tests first. When modifying patterns or `extractNamesFromCapture`, run common-names tests first. When modifying `collectCommonNames` in `src/names.js`, run names tests first.

