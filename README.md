# plant-note-getter

A CLI tool that generates [Obsidian](https://obsidian.md/) markdown notes for plants using taxonomic data from [Wikidata](https://www.wikidata.org/). Given a scientific (or common) plant name, it resolves the full taxonomic hierarchy and creates a richly tagged note with YAML front matter.

## Features

- **Note generation** — Creates an Obsidian markdown note with tags, aliases, rank, Wikipedia link, and dates from a plant name.
- **Tag hierarchy** — Builds an Obsidian tag path from the full taxonomic lineage (e.g. `#life/eukaryota/plantae/angiosperms/...`).
- **Label normalization** — Uses `label-map.json` to skip generic clades or normalize Wikidata labels to consistent tags.
- **`--populate` mode** — Scans an existing vault for plant-tagged notes and backfills missing front matter properties from Wikidata.
- **`--check` mode** — Analyzes tag hierarchies in existing notes to detect sparse branches or unrecognized clades, with interactive suggestions for `label-map.json` updates.
- **`--apply` flag** — Skips dry-run prompts and writes/updates notes directly.
- **Automatic alias collection** — Gathers scientific synonyms, common names, and vernacular names from Wikidata.

## Requirements

- Node.js 12+

## Install

```bash
git clone <repo-url>
cd plant-note-getter
npm install
```

Optionally link globally to use the `plant-note` binary:

```bash
npm link
plant-note "Eschscholzia californica" --apply
```

## Configuration

Copy `.env.example` to `.env` and set your Obsidian vault path:

```
NOTE_ROOT=/absolute/path/to/your/vault
```

### Label map (`label-map.json`)

Controls how Wikidata taxon labels become tag segments:

- `null` — Skip the clade (not included in the tag path)
- A string — Replace the Wikidata label with a custom tag name
- Missing — Use the Wikidata label as-is (lowercased, spaces → underscores)
- `"_inject"` — An object mapping a label to an array of tag segments that are inserted before it (e.g. `"gymnospermae": ["tracheophytes", "spermatophytes"]`). Useful when Wikidata skips intermediate ranks in the ancestor chain.

## Usage

```
# Create a note (dry-run)
node app.js "Eschscholzia californica"

# Create a note and write it
node app.js "Eschscholzia californica" --apply

# Scan vault and show missing front matter
node app.js --populate

# Scan vault and apply missing front matter
node app.js --populate --apply

# Check tag hierarchy of an existing note
node app.js --check "Lysimachia borealis"
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Run `node app.js` |
| `npm test` | Run test suite (`common-names.test.js` + `hierarchy.test.js`) |

## Project structure

```
src/
├── config.js       — Env loading and path config
├── frontmatter.js  — YAML front matter generation and parsing
├── notes.js        — Note file I/O, vault scanning, populate mode
├── tagcheck.js     — Tag hierarchy analysis and interactive pruning
├── taxonomy.js     — Tag hierarchy builder, rank filtering
├── utils.js        — Helpers (sanitize, date, label map loading)
└── wikidata.js     — Wikidata API client (search, entity data, SPARQL)
app.js              — CLI entry point
label-map.json      — Wikidata label → tag segment mappings
```
