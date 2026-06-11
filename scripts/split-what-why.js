#!/usr/bin/env node
/**
 * split-what-why.js
 * Post-processor for scrape-text.js output.
 *
 * Google Sites project pages often have implicit sections:
 *   - Opening paragraphs → "what" (what the project is)
 *   - Later paragraphs (motivation, context, reflection) → "why"
 *
 * This script uses a simple heuristic: if the scraped_raw_text has 4+ paragraphs,
 * split roughly at the midpoint. The first half becomes `what`, the second `why`.
 * Single-paragraph pages keep everything in `what`.
 *
 * You should review the output and hand-edit `what` / `why` for accuracy.
 *
 * Usage (run from project root):
 *   node scripts/split-what-why.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const dataDir = path.join(ROOT, 'data/projects');

const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));

let count = 0;
files.forEach(file => {
  const filePath = path.join(dataDir, file);
  let data;
  try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return; }

  const paras = data.scraped_raw_text;
  if (!paras || paras.length === 0) return; // not scraped yet

  if (paras.length >= 4) {
    const mid = Math.ceil(paras.length / 2);
    data.what = paras.slice(0, mid).join('\n\n');
    data.why  = paras.slice(mid).join('\n\n');
  } else {
    data.what = paras.join('\n\n');
    delete data.why; // let the template fall back gracefully
  }

  // Regenerate short description from new what
  const firstPara = paras[0] || '';
  const sentences = firstPara.match(/[^.!?]+[.!?]+/g) || [firstPara];
  data.description = sentences.slice(0, 3).join(' ').trim().slice(0, 300);

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`  ${file}: what=${data.what?.length || 0}c, why=${data.why?.length || 0}c`);
  count++;
});

console.log(`\nDone: ${count} files updated.`);
console.log('Review data/projects/*.json and hand-edit what/why as needed.');
