# Agent guidance for plant-note-getter

## Tag hierarchy via label-map.json

`label-map.json` is the single source of truth for controlling tag output. No hardcoded species-specific logic exists elsewhere. It does two things:

1. **Maps Wikidata labels to canonical tag segments** (e.g., `"coniferae": "pinophyta"` changes the segment from `coniferae` to `pinophyta`)
2. **Injects missing hierarchy nodes** via the `_inject` key (e.g., `"gymnospermae": ["tracheophytes", "spermatophytes"]` adds those segments before `gymnospermae`)

### Injection ordering

`_inject` appends segments **before** the current node's mapped segment. To place injected items correctly, pick the anchor node that comes **after** where they should appear.

Example: for junipers, Wikidata chain is `Gymnospermae → Coniferae → Cupressaceae → Juniperus`. To produce `gymnospermae/pinophyta/pinopsida/cupressales/cupressaceae`:
- `gymnospermae` injects `tracheophytes/spermatophytes` before itself
- `cupressaceae` injects `pinopsida/cupressales` before itself

### Wikidata chains vary between species

Different species expose different levels of detail in their Wikidata ancestor chain. For example, pines include `tracheophyte`, `Spermatophyta`, and `Pinopsida` as real nodes, while junipers skip straight from `plant` to `Gymnospermae`. The `_inject` dedup must use `.includes()` (checking all segments) rather than checking only the last segment, otherwise species whose chain already contains an injected segment get duplicates.

## Processing flow

`buildTagSegments` (src/taxonomy.js):
1. Start with base segments `['life', 'eukaryota', 'plantae']`
2. For each ancestor (highest to lowest rank):
   a. Skip if `null` mapping, excluded rank (SKIP_RANKS), or label is a Q-code
   b. Map label via `labelMap`
   c. Inject any `_inject` entries keyed on the mapped label
   d. Append the mapped label as a segment (deduped against last segment)

## Tests

- `test/common-names.test.js` — common name extraction from Wikipedia text snippets
- `test/hierarchy.test.js` — tag hierarchy generation using mocked ancestor chains (no live Wikidata calls)
- Run all tests: `npm test`
- Run hierarchy tests only: `node test/hierarchy.test.js`

When modifying `label-map.json`, always run the hierarchy tests to check for regressions before testing with live Wikidata.
