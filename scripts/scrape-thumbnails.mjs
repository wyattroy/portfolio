/**
 * scrape-thumbnails.mjs
 * Downloads card images from wyattroy.com/home and maps them to local projects
 * by spatially matching each image to the caption text below it, then fuzzy-
 * matching that title to a local project ID.
 *
 * Usage: node scripts/scrape-thumbnails.mjs
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream } from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const ROOT = new URL('..', import.meta.url).pathname;
const ASSETS_DIR = path.join(ROOT, 'assets', 'projects');
const PROJECTS_JSON = path.join(ROOT, 'data', 'projects.json');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const out = createWriteStream(dest);
      res.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
    }).on('error', reject);
  });
}

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function matchScore(a, b) {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const aW = new Set(a.split(' ').filter(w => w.length > 2));
  const bW = new Set(b.split(' ').filter(w => w.length > 2));
  const shared = [...aW].filter(w => bW.has(w)).length;
  return shared / Math.max(aW.size, bW.size, 1);
}

// ── main ─────────────────────────────────────────────────────────────────────
const projects = JSON.parse(readFileSync(PROJECTS_JSON, 'utf8'));
const projectsById = Object.fromEntries(projects.map(p => [p.id, p]));

console.log('Launching browser…');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

console.log('Loading https://www.wyattroy.com/home …');
await page.goto('https://www.wyattroy.com/home', { waitUntil: 'networkidle', timeout: 60_000 });

// Scroll to trigger all lazy-loaded content
for (let i = 0; i < 20; i++) {
  await page.evaluate(i => window.scrollTo(0, i * 600), i);
  await page.waitForTimeout(250);
}
await page.waitForTimeout(2000);

// Collect images (with page-absolute Y position) and caption spans
const { images, captions } = await page.evaluate(() => {
  const scrollY = window.scrollY;

  const imgs = Array.from(document.querySelectorAll('a[href] img'))
    .map(img => {
      const a = img.closest('a');
      const rect = img.getBoundingClientRect();
      return {
        href: a?.href || '',
        src: img.src,
        x: rect.left,
        y: rect.top + scrollY,
        w: rect.width,
        h: rect.height,
        imgW: img.naturalWidth,
      };
    })
    .filter(i => i.imgW > 100 && i.src && !i.src.startsWith('data:'));

  // All short text nodes that look like captions
  const spans = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const t = node.textContent.trim();
    if (t.length < 3 || t.length > 120) continue;
    const el = node.parentElement;
    const rect = el?.getBoundingClientRect();
    if (!rect || rect.width < 50) continue;
    spans.push({ text: t, x: rect.left, y: rect.top + scrollY, tag: el.tagName });
  }

  return { images: imgs, captions: spans };
});

await browser.close();
console.log(`Found ${images.length} images, ${captions.length} caption candidates.\n`);

// ── Spatial match: for each image, find the closest caption below it ──────────
function findCaption(img) {
  // Look for spans within ~300px below the image and within horizontal range
  const candidates = captions.filter(c =>
    c.y > img.y + img.h - 20 &&       // below the image
    c.y < img.y + img.h + 300 &&      // not too far below
    c.x >= img.x - 50 &&              // roughly same horizontal column
    c.x < img.x + img.w + 50
  );
  if (!candidates.length) return null;
  // Closest by Y
  candidates.sort((a, b) => a.y - b.y);
  return candidates[0].text;
}

// ── Match caption text to local project ──────────────────────────────────────
// Caption text → local project ID (for captions that are taglines, not titles)
const CAPTION_MAP = {
  'natural locomotion ux': 'handmove',
  'step inside art': 'painting-life',
  'origami sudoku': 'skybinder',
  'shrinking for soil microbes': 'sound-ag',
  'dream-based architecture': 'piece-of-string',
  'holograms of grandpa': 'rehoboth',
  'video game irl': 'playme',
  'apology training tool': 'sorry',
  'music therapy app': 'tonos',
  '3d printed moments': '3d-printing',
  'havard x berlin holocaust memorial': 'harvard-memorial',
  'narrative taxonomy': 'taxonomy',
  'calm.com': 'calm',
  'nepali buffer zone': 'phildev',
  'ai e-bikes': 'peloton',
  'canadian paralympics': 'canada',
  'dream-based architecture': 'piece-of-string',
  'video game irl': 'playme',
};

function findProject(title) {
  if (!title) return null;
  const norm = normalize(title);

  // Check explicit caption map first
  if (CAPTION_MAP[norm] && projectsById[CAPTION_MAP[norm]]) {
    return { project: projectsById[CAPTION_MAP[norm]], score: 1.0 };
  }

  let best = null, bestScore = 0;
  for (const p of projects) {
    const score = Math.max(
      matchScore(norm, normalize(p.title || '')),
      matchScore(norm, normalize(p.tagline || '')),
      matchScore(norm, p.id.replace(/-/g, ' '))
    );
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return bestScore >= 0.4 ? { project: best, score: bestScore } : null;
}

// ── Download ──────────────────────────────────────────────────────────────────
let downloaded = 0, failed = 0;
const usedIds = new Set();
const unmatched = [];

for (const img of images) {
  const caption = findCaption(img);
  let match = findProject(caption);

  // Fallback: derive ID from href slug when caption match is already used or missing
  if (!match || usedIds.has(match.project.id)) {
    const hrefSlug = img.href.split('/').pop();
    // Try exact ID match from href
    const hrefProject = projects.find(p => p.id === hrefSlug ||
      p.id === hrefSlug.replace(/-/g, '') ||
      hrefSlug === 'athletics-canada' && p.id === 'canada');
    if (hrefProject && !usedIds.has(hrefProject.id)) {
      match = { project: hrefProject, score: 0.7 };
    } else {
      unmatched.push({ caption, href: img.href });
      continue;
    }
  }

  const { project, score } = match;
  usedIds.add(project.id);

  const dir = path.join(ASSETS_DIR, project.id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const dest = path.join(dir, 'thumb.jpg');
  const localPath = `assets/projects/${project.id}/thumb.jpg`;

  process.stdout.write(`  [${score.toFixed(2)}] "${project.title}" ← "${caption}" … `);
  try {
    await download(img.src, dest);
    projectsById[project.id].thumbnail = localPath;
    downloaded++;
    console.log('✓');
  } catch (e) {
    console.log(`✗ (${e.message})`);
    failed++;
  }
}

writeFileSync(PROJECTS_JSON, JSON.stringify(projects, null, 2));
console.log(`\nDone. ${downloaded} downloaded, ${failed} failed.`);

if (unmatched.length) {
  console.log('\nUnmatched images (caption → href):');
  unmatched.forEach(u => console.log(`  • "${u.caption}"  ${u.href}`));
}

const noThumb = projects.filter(p => !p.thumbnail);
if (noThumb.length) {
  console.log('\nProjects still without a thumbnail:');
  noThumb.forEach(p => console.log(`  • ${p.id}: "${p.title}"`));
}
