# Common Name Refinement Guide

Per-taxon pipeline for improving Wikipedia common-name extraction. Each fix is driven by a regression test written first (red), then the fix makes it pass (green). Architecture, file roles, and reviewer mechanics live in `AGENTS.md` — this guide describes only the procedure.

## 1. Entry points

- **Taxon name(s) in prompt, no other context** — refine those taxa (per the `AGENTS.md` bare-name convention). Taxa must come from notes already in `NOTE_ROOT`.
- **Random pick from the plant-note library** — filter `NOTE_ROOT` for notes tagged `life/eukaryota/plantae` and refine for coverage.
- **Review-data triage** — `npm run tally` surfaces recurring LLM additions (names the deterministic pipeline keeps missing) and removals by category; `npm run tally -- --regressions=N` prints ready-to-paste red tests. Work the top cases, then clear the absorbed records from `.review-data/review-gaps.jsonl`.

## 2. The loop

1. **Hand-enumerate.** Read the taxon's full Wikipedia extract (intro plus any `== Common names ==` / `== Names ==` sections) and list every common name the article states for the taxon, by hand. The article is ground truth; the note's `aliases` is not the target — names the note never had are the most valuable finds, and a suspiciously small extraction count means incomplete extraction, not a clean note.
2. **Diff.** Compare the hand-built list against the pipeline's output for the title. Every stated-but-missed name is a coverage gap; every junk output (geography, prefixes, procedural text, leaked Latin, generic plant terms) is a filter gap.
3. **Red test.** Add the case to `test/common-names.test.js` using the actual extract (never a paraphrase) and the hand-built expected list. Run the suite; the new test must fail, showing current wrong behavior.
4. **Fix (reviewer first — see §3).** Refine the reviewer prompt and/or patch the deterministic extractor, preferring structural fixes that generalise over one-off special cases.
5. **Green.** `npm test` until the new test passes and all existing cases stay green — `npm test` is the single source of truth. If a fix breaks another case, the fix is wrong.
6. **Live re-verify.** Re-run the triggering taxon end to end: bad names gone, expected names present (live fetches can surface passages the hardcoded extract doesn't cover), and names from the note's `aliases` still extracted.

## 3. Fix fork: reviewer first, deterministic always

Run the LLM reviewer against the *unfixed* extractor first. This serves day-to-day use (one-shot correct notes without getting hung up refining every taxon) and doubles as diagnosis: the reviewer's output reveals both the deterministic gap and the reviewer's own blind spots.

- **Reviewer missed or misjudged?** Refine its prompt. Prefer placement over intensity (a buried rule gets overridden by assertive article prose — lead with critical exclusions and repeat them in the task line). After any prompt change, check recall with short probes: a genuine quoted miss, a cultivar trap, and a known-good control must all still behave.
- **Always still land the deterministic fix.** The reviewer is the safety net, never the permanent fix — its logged gaps are feedstock for later refinement runs. Recurring additions become red tests; `broken-capture` removals point at malformed captures; recurring non-`broken-capture` removals are possible false vetoes worth a prompt tweak or must-keep guard.
- Before touching shared thresholds or terminators, impact-grep the suite for the phrases you affect and note which expectations you touch.

## 4. Guardrails

- Legitimate geographic names (`European holly`), regional variants, and non-English vernaculars (`chêne pédonculé`) are genuine — don't filter them. If the correct names already come from Wikidata or GBIF, that's fine; Wikipedia extraction is supplementary.
- Debug with `traceExtraction`: gated-out sentences mean the sentence filter is too narrow; captured-but-rejected means a classifier or capture regex is wrong; a wrong rule label means an earlier rule stole the passage.
- Constructions that need sentence context (not just surface form) belong in a capture-level check with both motivating cases cited in the comment — never per-rule guards scattered across rules.
- Ask before adding exports. Declined reviewer proposals are never logged — but if you keep declining the same kind, that's prompt-tuning feedback.

## 5. Tricky constructions (patterns, not rules)

- `X or Y family` splits two ways: genuine expansion (`rue or citrus family` → both) vs restatement of the taxon's own family (`legume or bean family` → nothing). Disambiguate with sentence context before segmenting.
- Enumerations after a naming verb are all genuine (`known as A, B, and C` keeps every member); cultivar-subject sentences (`cultivar, also known as X`) keep X but never yield cultivar-list entries.
- Length gates pair with meaning checks: a 6-word genuine name (`feathery false lily of the valley`) passes while 6–7-word descriptive fragments fail — tune semantics, not the number.
