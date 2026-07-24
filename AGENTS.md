# Agent guidance for plant-note-getter

CLI tool: takes a scientific plant name, queries Wikidata/GBIF/Wikipedia, and writes an Obsidian note with a hierarchical tag, aliases, rank, and Wikipedia link.

## Prompt convention

If the user provides only a scientific plant name (e.g., "Quercus robur", "Pinus sylvestris") with no other instructions, treat it as the selection for the refinement guide ([`REFINEMENT-GUIDE.md`](./REFINEMENT-GUIDE.md)) and proceed with the full pipeline: search Wikidata → get entity data → synonyms → GBIF/Wikipedia common names → build tag chain → create note file.

## Data flow

```
app.js → wikidata.js (search, entity data, synonyms, GBIF names, Wikipedia names, parent chain)
       → taxonomy.js (buildTagSegments: remaps + injections + rank-skipping via label-map.json)
       → tagcheck.js (hierarchy consistency against existing notes)
       → frontmatter.js (generateFrontMatter: YAML front matter string)
       → notes.js (createNoteFile: write .md to NOTE_ROOT)
```

## Key files

| File | Role |
|------|------|
| `app.js` | CLI entry, orchestrates pipeline, supports `--populate` and `--check` modes |
| `src/wikidata.js` | All external API calls (Wikidata, GBIF, Wikipedia), common name extraction |
| `src/taxonomy.js` | Builds tag segments from Wikidata ancestor chain |
| `src/tagcheck.js` | Validates hierarchy consistency, prunes unknown clades |
| `src/frontmatter.js` | Generates/parses/updates YAML front matter |
| `src/notes.js` | Filesystem operations: read/write notes, bulk populate |
| `src/config.js` | Paths from `.env`: NOTE_ROOT, LABEL_MAP_PATH |
| `src/utils.js` | Shared helpers (filename sanitize, date, label-map loading) |
| `label-map.json` | Single source of truth for tag remaps and hierarchy injections |
| `test/common-names.test.js` | 14 regression tests, no API calls, runs via `npm test` |
| `test/hierarchy.test.js` | 5 tests for tag generation with mocked ancestor chains |

## Tag hierarchy via label-map.json

`label-map.json` controls tag output — no hardcoded species logic elsewhere.

1. **Maps labels to canonical segments** (e.g., `"coniferae": "pinophyta"`)
2. **Injects missing nodes** via `_inject` (e.g., `"gymnospermae": ["tracheophytes", "spermatophytes"]` adds before the node)
3. `buildTagSegments` (src/taxonomy.js): starts with `['life', 'eukaryota', 'plantae']`, then for each ancestor (highest to lowest rank): skip if `null` mapping/excluded rank/Q-code, map via `labelMap`, inject any `_inject` entries, append segment (deduped with `.includes()` against all segments, not just last).

## Common name extraction (src/wikidata.js)

### Pipeline

```
Wikidata P1843 claims → collectSynonymData → fetchGbifCommonNames → fetchWikipediaCommonNames
(merged in app.js in this order — earlier sources win dedup priority)
```

### WIKI_PATTERNS: 8 regexes for Wikipedia intro constructions

| Pattern | Matches | Example species |
|---------|---------|----------------|
| A | `(name1, name2, or name3)` parenthetical | Rosa rubiginosa |
| B | `, the/a/an name1, name2, and name3, is` | Eschscholzia californica |
| C | `, name1, is` (no article) | Oreomecon crocea |
| D | `known as / commonly known as / generally known as` | Ulmus americana |
| E | `also/often/sometimes called` | Lactuca serriola |
| F | `Common names include/are` | Sambucus nigra |
| G | `English/vernacular names ... include` | Populus |
| H | `known by the common names` | Malephora crocea |

### Known pitfalls in extractNamesFromCapture

1. **Connector splitting** — `\b(?:and|or)\b` needs word boundaries; without them "oregano" matches "or"
2. **Missing `.replace()` second arg** — `.replace(/re/, '')` not `.replace(/re/)` (the latter uses `"undefined"` as replacement text)
3. **Trailing punctuation** — Wikidata P1843 can store `"cliff maids."` with period; strip at all entry points
4. **Language qualifiers** — strip trailing ` in Greek`, ` in Latin` etc.
5. **Label prefixes** — strip leading `common name`, `common names`, `vernacular name`
6. **Filler phrases** — filter out `among many regional names`, `among others` etc.
7. **Real-time verification** — when adding a new test case, fetch the actual Wikipedia API extract and verify the text matches one of the 8 patterns. Some intros are too complex for any pattern (e.g., Ginkgo biloba's multi-clause construction).

## Tests

- `npm test` runs both test files.
- `test/common-names.test.js` — 14 tests using hardcoded Wikipedia extracts (no API calls, instant, deterministic). Calls `extractWikipediaCommonNames(text)` — a pure function exported from `src/wikidata.js`.
- `test/hierarchy.test.js` — 5 tests for tag generation using mocked ancestor chains (no live Wikidata).
- When modifying `label-map.json`, run hierarchy tests first. When modifying patterns or `extractNamesFromCapture`, run common-names tests first.
