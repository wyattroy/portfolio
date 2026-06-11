#!/usr/bin/env node
/**
 * fix-descriptions.js
 * Re-processes scraped_raw_text in every data/projects/*.json to produce
 * better description / what / why fields, without re-scraping.
 *
 * Key fix: the first "paragraph" is usually the page h1 (project title) or a
 * short section heading. We skip leading short entries (<30 chars) when
 * choosing the description, and strip them from the `what` text too.
 *
 * Usage:
 *   node scripts/fix-descriptions.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const dataDir = path.join(ROOT, 'data/projects');

// ── Helpers ────────────────────────────────────────────────────────────────────

// Returns true for paragraphs that are clearly headings / labels, not prose.
// We keep them in `what` (as structure) but skip them for the short description.
function isHeadingLike(text, projectTitle) {
  const t = text.trim();
  if (t.length < 30) return true;                  // too short to be a sentence
  if (projectTitle && t.toLowerCase() === projectTitle.toLowerCase()) return true;
  return false;
}

// Find the first substantive paragraph (>= 30 chars, looks like prose).
function firstSubstantiveParagraph(paragraphs, projectTitle) {
  return paragraphs.find(p => !isHeadingLike(p, projectTitle)) || paragraphs[0] || '';
}

function buildDescription(paragraphs, projectTitle) {
  const prose = firstSubstantiveParagraph(paragraphs, projectTitle);
  const sentences = prose.match(/[^.!?]+[.!?]+/g) || [prose];
  return sentences.slice(0, 3).join(' ').trim().slice(0, 300);
}

// Strip pure-title lines from the top of the raw text before joining into `what`.
function filterForBody(paragraphs, projectTitle) {
  // Drop leading short/heading-like entries, keep everything once we hit real prose
  let startIdx = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    if (!isHeadingLike(paragraphs[i], projectTitle)) { startIdx = i; break; }
  }
  return paragraphs.slice(startIdx);
}

function buildWhatWhy(paragraphs, projectTitle) {
  const body = filterForBody(paragraphs, projectTitle);
  if (body.length === 0) return { what: paragraphs.join('\n\n'), why: '' };

  if (body.length >= 4) {
    const mid = Math.ceil(body.length / 2);
    return {
      what: body.slice(0, mid).join('\n\n'),
      why:  body.slice(mid).join('\n\n'),
    };
  }
  return { what: body.join('\n\n'), why: '' };
}

// ── Process all project JSONs ──────────────────────────────────────────────────
const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
let fixed = 0, skipped = 0;

files.forEach(file => {
  const filePath = path.join(dataDir, file);
  let data;
  try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return; }

  const raw = data.scraped_raw_text;
  if (!raw || raw.length === 0) { skipped++; return; }

  const title = data.title || '';
  const description      = buildDescription(raw, title);
  const { what, why }    = buildWhatWhy(raw, title);

  data.description = description;
  data.what        = what;
  if (why) {
    data.why = why;
  } else {
    delete data.why; // clean up empty why
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`  ✓ ${file.padEnd(30)} desc: "${description.slice(0, 60)}…"`);
  fixed++;
});

console.log(`\nDone: ${fixed} fixed, ${skipped} skipped (no scraped_raw_text).`);
