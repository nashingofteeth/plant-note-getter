#!/usr/bin/env node
// Tally the review-gap log (.review-data/review-gaps.jsonl) to surface common
// names the deterministic regex pipeline missed (catches) and names the LLM
// removed as noise (llmRemoved). Recurring catches become red regression tests
// via `--regressions=N`, which prints ready-to-paste { name, extract, expected }
// objects for test/common-names.test.js. Broken-capture removals get expected
// lists that exclude the malformed capture (drives a regex-rule fix); recurring
// non-broken removals get must-keep guards plus a "possible false veto" list.
//
// Usage:
//   npm run tally
//   npm run tally -- --regressions=3
//   npm run tally -- --min-taxa=2 --path=.review-data/review-gaps.jsonl

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function argVal(flag) {
  const i = args.findIndex((a) => a.startsWith(flag));
  if (i === -1) return undefined;
  const v = args[i].split('=')[1];
  if (v !== undefined) return v;
  return args[i + 1];
}

const DEFAULT_PATH = path.join(__dirname, '..', '.review-data', 'review-gaps.jsonl');
const logPath = argVal('--path') || process.env.REVIEW_LOG_PATH || DEFAULT_PATH;
const regressions = parseInt(argVal('--regressions') || '0', 10);
const minTaxa = parseInt(argVal('--min-taxa') || '2', 10);

if (!fs.existsSync(logPath)) {
  console.error(`No review log at ${logPath}`);
  process.exit(0);
}

const records = fs
  .readFileSync(logPath, 'utf-8')
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const withCatches = records.filter((r) => (r.catches || []).length);
console.log(`Records: ${records.length}, with catches: ${withCatches.length}`);

const gateCounts = {};
for (const r of withCatches) {
  for (const c of r.catches) gateCounts[c.gate] = (gateCounts[c.gate] || 0) + 1;
}
console.log('Gates:', Object.entries(gateCounts).map(([k, v]) => `${k}=${v}`).join(', '));

const byName = new Map();
for (const r of withCatches) {
  for (const c of r.catches) {
    const key = c.name.toLowerCase();
    if (!byName.has(key)) {
      byName.set(key, { name: c.name, taxa: new Set(), gates: {} });
    }
    const entry = byName.get(key);
    entry.taxa.add(r.taxon);
    entry.gates[c.gate] = (entry.gates[c.gate] || 0) + 1;
    entry.extract = r.extract || c.sentence;
    entry.sentence = c.sentence;
  }
}

const recurring = [...byName.values()]
  .filter((e) => e.taxa.size >= minTaxa)
  .sort(
    (a, b) =>
      b.taxa.size - a.taxa.size ||
      (b.gates['parsed-no-capture'] || 0) - (a.gates['parsed-no-capture'] || 0)
  );

console.log(`\nRecurring caught names (>= ${minTaxa} taxa):`);
for (const e of recurring) {
  console.log(
    `  ${e.name}  (${e.taxa.size} taxa, skipped=${e.gates.skipped || 0}, parsed-no-capture=${e.gates['parsed-no-capture'] || 0})`
  );
}

if (regressions > 0) {
  console.log(`\nRegression snippets for test/common-names.test.js (${Math.min(regressions, recurring.length)} most recurring):`);
  for (const e of recurring.slice(0, regressions)) {
    console.log(
      JSON.stringify({ name: `${e.name} (LLM gap)`, extract: e.extract, expected: [e.name] }, null, 2)
    );
  }
}

if (!recurring.length) {
  console.log('\nNo recurring catches above the min-taxa threshold yet.');
}

// --- LLM removals (noise-rejection pass) ---
const withRemovals = records.filter((r) => (r.llmRemoved || []).length);
console.log(`\nRecords with LLM removals: ${withRemovals.length}`);

const removalCatCounts = {};
const removalGateCounts = {};
for (const r of withRemovals) {
  for (const rm of r.llmRemoved) {
    removalCatCounts[rm.category] = (removalCatCounts[rm.category] || 0) + 1;
    removalGateCounts[rm.gate] = (removalGateCounts[rm.gate] || 0) + 1;
  }
}
console.log(
  'Removal categories:',
  Object.entries(removalCatCounts).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'
);
console.log(
  'Removal gates:',
  Object.entries(removalGateCounts).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'
);

const byRemoved = new Map();
for (const r of withRemovals) {
  for (const rm of r.llmRemoved) {
    const key = rm.name.toLowerCase();
    if (!byRemoved.has(key)) {
      byRemoved.set(key, { name: rm.name, taxa: new Set(), categories: {}, gates: {}, record: r });
    }
    const e = byRemoved.get(key);
    e.taxa.add(r.taxon);
    e.categories[rm.category] = (e.categories[rm.category] || 0) + 1;
    e.gates[rm.gate] = (e.gates[rm.gate] || 0) + 1;
    e.record = r;
  }
}

const recurringRemovals = [...byRemoved.values()]
  .filter((e) => e.taxa.size >= minTaxa)
  .sort((a, b) => b.taxa.size - a.taxa.size);

console.log(`\nRecurring LLM removals (>= ${minTaxa} taxa):`);
for (const e of recurringRemovals) {
  console.log(
    `  ${e.name}  (${e.taxa.size} taxa, cats=${Object.entries(e.categories)
      .map(([k, v]) => `${k}:${v}`)
      .join(',')})`
  );
}

const falseVetoes = recurringRemovals.filter((e) => !e.categories['broken-capture']);
if (falseVetoes.length) {
  console.log('\nPossible false vetoes (non-broken-capture, recurring): review these —');
  console.log('  they may be legitimate names the LLM is wrongly removing.');
  for (const e of falseVetoes) {
    console.log(`  ${e.name}  (${e.taxa.size} taxa)`);
  }
}

if (regressions > 0) {
  const bc = recurringRemovals.filter((e) => e.categories['broken-capture']);
  if (bc.length) {
    console.log(
      `\nBroken-capture regression snippets (expected excludes the malformed capture; fix the regex rule):`
    );
    for (const e of bc.slice(0, regressions)) {
      const r = e.record;
      const removedKeys = new Set((r.llmRemoved || []).map((x) => x.name.toLowerCase()));
      const expected = (r.baseNames || []).filter((n) => !removedKeys.has(n.toLowerCase()));
      console.log(
        JSON.stringify({ name: `${e.name} (broken capture)`, extract: r.extract, expected }, null, 2)
      );
    }
  }
  if (falseVetoes.length) {
    console.log('\nMust-keep guards (the name must stay extracted; protects against false vetoes):');
    for (const e of falseVetoes.slice(0, regressions)) {
      const r = e.record;
      console.log(
        JSON.stringify(
          { name: `${e.name} (must keep)`, extract: r.extract, expected: r.baseNames || [] },
          null,
          2
        )
      );
    }
  }
}