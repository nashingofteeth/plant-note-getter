#!/usr/bin/env node
/**
 * Vault batch audit — 200-sample diagnosis for systemic hardening.
 * Read-only: no vault writes. Uses cached Wikipedia extracts via fetchWikipediaCommonNames?
 * Instead, reads NOTE_ROOT notes, extracts wikipedia frontmatter, fetches live extracts
 * and runs traceExtraction to tally skipped/binomial-lookalike gaps.
 *
 * Usage: node scripts/audit-vault-batch.js [--limit 200] [--sample stratify]
 */
const fs = require('fs');
const path = require('path');
const { parseFrontMatter, hasPlantTag } = require('../src/frontmatter');
const { traceExtraction, extractWikipediaCommonNames } = require('../src/wiki-extract');
const { fetchJSON } = require('../src/api-client');

const NOTE_ROOT = process.env.NOTE_ROOT || (() => { try { require('dotenv').config(); } catch {} return process.env.NOTE_ROOT; })() || '/home/nash/wikihew';
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || process.argv[process.argv.indexOf('--limit')+1] || '200', 10);

async function fetchExtract(title) {
  if (!title) return '';
  const { rateLimit } = require('../src/api-client');
  await rateLimit();
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=&redirects=1&titles=${encodeURIComponent(title)}&format=json`;
  try {
    const data = await fetchJSON(url);
    const pages = data?.query?.pages;
    if (!pages) return '';
    return Object.values(pages)[0]?.extract || '';
  } catch (e) { console.error(`fetchExtract ${title}: ${e.message}`); return ''; }
}

async function main() {
  const files = fs.readdirSync(NOTE_ROOT).filter(f => f.endsWith('.md'));
  function titleFromWikipedia(w) {
    if (!w) return '';
    if (w.includes('wikipedia.org/wiki/')) {
      const part = w.split('/wiki/')[1].split('#')[0].split('?')[0];
      return decodeURIComponent(part.replace(/_/g, ' '));
    }
    return w;
  }
  const notes = [];
  for (const f of files) {
    const full = path.join(NOTE_ROOT, f);
    const content = fs.readFileSync(full, 'utf-8');
    const fm = parseFrontMatter(content);
    if (!fm || !hasPlantTag(fm)) continue;
    const rawWiki = fm.wikipedia || f.replace(/\.md$/, '');
    const title = titleFromWikipedia(rawWiki);
    notes.push({ file: f, fm, wikipedia: title, rawWikipedia: rawWiki });
  }
  console.log(`Found ${notes.length} plant notes in ${NOTE_ROOT}, sampling ${Math.min(LIMIT, notes.length)}`);

  // Stratified: recent refinements (by modified date?) + random
  // For simplicity: take first 30 alphabetically that have wikipedia, plus random 170
  notes.sort((a,b) => a.file.localeCompare(b.file));
  const sample = [];
  const recentSet = new Set(['Lavandula latifolia', 'Valeriana officinalis', 'Spiraea', 'Yucca', 'Halesia', 'Anemopsis', 'Koeleria', 'Betonica', 'Caryopteris', 'Zizania', 'Brassica', 'Catharanthus roseus', 'Erica vagans']);
  for (const n of notes) if (recentSet.has(n.file.replace(/\.md$/,'')) && sample.length < 30) sample.push(n);
  // Random rest
  const remaining = notes.filter(n => !sample.includes(n));
  for (let i = remaining.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i+1)); [remaining[i], remaining[j]] = [remaining[j], remaining[i]]; }
  sample.push(...remaining.slice(0, Math.min(LIMIT - sample.length, remaining.length)));

  const tallies = { total: sample.length, withExtract: 0, binomialLookalike: {}, skippedPredicates: {}, descriptiveOf: 0, familyRestatement: 0, tooLong: 0, commonNameHeader: 0 };
  const binomialExamples = [];
  const skippedExamples = [];

  console.log('Sample titles:', sample.slice(0,5).map(s=>s.wikipedia));
  for (const note of sample) {
    const title = note.wikipedia;
    console.log(`Fetching ${title}...`);
    const extract = await fetchExtract(title);
    if (!extract) continue;
    tallies.withExtract++;
    const trace = traceExtraction(extract);
    // Count rejections
    for (const r of trace.rejected) {
      if (r.by === 'binomial-lookalike') {
        const key = r.name.split(/\s+/)[0];
        tallies.binomialLookalike[key] = (tallies.binomialLookalike[key]||0)+1;
        if (binomialExamples.length < 15) binomialExamples.push({ file: note.file, name: r.name, rule: r.rule });
      }
      if (r.by === 'descriptive-of') tallies.descriptiveOf++;
      if (r.by === 'family-restatement') tallies.familyRestatement++;
      if (r.by === 'too-long') tallies.tooLong++;
      if (r.by === 'common-name-header') tallies.commonNameHeader++;
    }
    if (trace.skippedSentences.length > 0) {
      // heuristic: if skipped sentence contained "known as" / "called" / "common name" but was gated
      for (const s of trace.skippedSentences) {
        const lower = s.sentence.toLowerCase();
        if (/(known as|called|common name|vernacular)/i.test(s.sentence)) {
          const key = lower.match(/known as|called|common name|vernacular/)?.[0] || 'other';
          tallies.skippedPredicates[key] = (tallies.skippedPredicates[key]||0)+1;
          if (skippedExamples.length < 10) skippedExamples.push({ file: note.file, sentence: s.sentence.slice(0,120) });
        }
      }
    }
    // Rate limit
    await new Promise(r => setTimeout(r, 120));
  }

  console.log('\n=== Tally ===');
  console.log(JSON.stringify(tallies, null, 2));
  console.log('\n=== Top binomial-lookalike first words ===');
  const sorted = Object.entries(tallies.binomialLookalike).sort((a,b)=>b[1]-a[1]).slice(0,20);
  for (const [k,v] of sorted) console.log(`${k}: ${v}`);
  console.log('\n=== Binomial examples (first 15) ===');
  console.log(binomialExamples);
  console.log('\n=== Skipped sentences containing naming cues (first 10) ===');
  console.log(skippedExamples);
  console.log('\nDone');
  // Save
  fs.writeFileSync('/tmp/opencode/audit-vault-batch.json', JSON.stringify({ tallies, binomialExamples, skippedExamples }, null, 2));
  console.log('Saved to /tmp/opencode/audit-vault-batch.json');
}

main().catch(e => { console.error(e); process.exit(1); });
