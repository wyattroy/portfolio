#!/usr/bin/env node
/**
 * scrape-text.js
 * Scrapes ALL text AND ALL images from every project page on wyattroy.com,
 * then updates data/projects/[id].json with accurate content.
 *
 * Uses the Playwright persistent session (.playwright-session/) so Google login
 * is preserved. On first run, a browser window opens for you to log in.
 *
 * Usage (run from project root):
 *   node scripts/scrape-text.js
 *
 * What it writes to each project JSON:
 *   description       — first 2–3 sentences (shown on cards)
 *   what              — full body text (shown on project detail page)
 *   scraped_raw_text  — all paragraphs verbatim (array), for reference / re-processing
 *   images            — local paths to downloaded images (assets/projects/[id]/)
 *   thumbnail         — first downloaded image
 *   scraped_url       — source URL
 */

const { chromium } = require('playwright');
const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');

const ROOT = path.join(__dirname, '..');

// ── Project pages ──────────────────────────────────────────────────────────────
const PROJECT_PAGES = [
  { id: 'handmove',                url: 'https://www.wyattroy.com/xr/handmove-xr' },
  { id: 'storytelling-affordances',url: 'https://www.wyattroy.com/xr/storytelling-affordances' },
  { id: 'skybinder',               url: 'https://www.wyattroy.com/xr/skybinder' },
  { id: 'painting-life',           url: 'https://www.wyattroy.com/xr/painting-life' },
  { id: 'sound-ag',                url: 'https://www.wyattroy.com/xr/sound-ag' },
  { id: 'rehoboth',                url: 'https://www.wyattroy.com/xr/rehoboth' },
  { id: 'piece-of-string',         url: 'https://www.wyattroy.com/xr/piece-of-string' },
  { id: 'unfolding',               url: 'https://www.wyattroy.com/xr/unfolding' },
  { id: 'mu-mirror',               url: 'https://www.wyattroy.com/interactive/mu-mirror' },
  { id: 'ceramics-3d',             url: 'https://www.wyattroy.com/interactive/ceramics-3d' },
  { id: 'play-me',                 url: 'https://www.wyattroy.com/interactive/play-me' },
  { id: 'typewriter',              url: 'https://www.wyattroy.com/interactive/digital-typewriter' },
  { id: 'sorry',                   url: 'https://www.wyattroy.com/interactive/sorry' },
  { id: 'tonos',                   url: 'https://www.wyattroy.com/interactive/tonos' },
  { id: 'falling-fall',            url: 'https://www.wyattroy.com/design/falling-fall' },
  { id: 'canyons',                 url: 'https://www.wyattroy.com/design/canyons' },
  { id: 'hug',                     url: 'https://www.wyattroy.com/design/the-hug' },
  { id: 'haaaard',                 url: 'https://www.wyattroy.com/design/haaaard' },
  { id: '3d-printing',             url: 'https://www.wyattroy.com/design/3d-printing' },
  { id: 'harvard-memorial',        url: 'https://www.wyattroy.com/design/harvard-memorial' },
  { id: 'crawl',                   url: 'https://www.wyattroy.com/design/crawl' },
  { id: 'paper-lamps',             url: 'https://www.wyattroy.com/design/paper-lamps' },
  { id: 'taxonomy',                url: 'https://www.wyattroy.com/design/narrative-taxonomy' },
  { id: 'gre-admissions',          url: 'https://www.wyattroy.com/design/gre-survey' },
  { id: 'unstudio',                url: 'https://www.wyattroy.com/design/unstudio' },
  { id: 'galapagos',               url: 'https://www.wyattroy.com/video/galapagos' },
  { id: 'phildev',                 url: 'https://www.wyattroy.com/video/phildev' },
  { id: 'sols',                    url: 'https://www.wyattroy.com/video/sols' },
  { id: 'calm',                    url: 'https://www.wyattroy.com/video/calm' },
  { id: 'offgridbox',              url: 'https://www.wyattroy.com/video/offgridbox' },
  { id: 'bufferzone',              url: 'https://www.wyattroy.com/video/bufferzone' },
  { id: 'streetlogic',             url: 'https://www.wyattroy.com/video/streetlogic' },
  { id: 'canada',                  url: 'https://www.wyattroy.com/video/athletics-canada' },
  { id: 'peloton',                 url: 'https://www.wyattroy.com/video/peloton' },
];

// ── Image helpers ──────────────────────────────────────────────────────────────
function isUsableImage(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  if (u.includes('favicon') || u.includes('logo') || u.includes('.ico')) return false;
  if (u.startsWith('data:')) return false;
  // Must look like an image or a known CDN
  return /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/.test(u)
    || u.includes('googleusercontent.com')
    || u.includes('lh3.google');
}

function imgExt(url) {
  const u = url.split('?')[0];
  const m = u.match(/\.(webp|gif|png|svg|jpe?g)$/i);
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  if (url.includes('googleusercontent.com')) return 'jpg';
  return 'jpg';
}

function downloadWithCookies(url, dest, cookies) {
  const cookieHeader = cookies
    .filter(c => url.includes(c.domain.replace(/^\./, '')))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Cookie': cookieHeader,
        'Referer': 'https://www.wyattroy.com/',
      },
      timeout: 25000,
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        if (loc) return downloadWithCookies(new URL(loc, url).href, dest, cookies).then(resolve).catch(reject);
        return reject(new Error('Redirect with no location'));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── Text extraction ────────────────────────────────────────────────────────────
async function extractPageText(page) {
  return page.evaluate(() => {
    const TEXT_SELECTORS = 'h1, h2, h3, h4, p, li, blockquote';

    // Boilerplate to skip (Google Sites chrome, navigation, etc.)
    const SKIP_PATTERNS = [
      /^wyatt roy$/i,
      /^home$/i, /^about$/i, /^xr$/i, /^interactive$/i,
      /^design$/i, /^video$/i, /^contact$/i, /^search$/i,
      /^skip to/i, /^copyright/i, /^\d{4} wyatt/i,
      /^share$/i, /^print$/i, /^report abuse/i,
      /^page updated/i, /^google sites/i,
    ];

    function isBoilerplate(text) {
      const t = text.trim();
      if (t.length < 4) return true;
      return SKIP_PATTERNS.some(re => re.test(t));
    }

    const seen = new Set();
    const paragraphs = [];

    document.querySelectorAll(TEXT_SELECTORS).forEach(el => {
      // Skip anything inside navigation, header, or footer — those are site chrome
      if (el.closest('nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"]')) return;

      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!text || isBoilerplate(text) || seen.has(text)) return;
      seen.add(text);
      paragraphs.push(text);
    });

    return paragraphs;
  });
}

// ── Scrape index-page thumbnails ──────────────────────────────────────────────
// Visit the wyattroy.com home page and collect images that are paired with
// project links (anchor → image). These are the curated thumbnails shown on
// the index page — use them as the primary thumb for each project.
async function scrapeIndexThumbnails(page, projectPages, cookies) {
  console.log('\nScraping index page thumbnails from wyattroy.com…');
  await page.goto('https://www.wyattroy.com', { waitUntil: 'load', timeout: 40000 });
  await page.waitForTimeout(1200);

  // Scroll through the entire index page to load lazy images
  await page.evaluate(async () => {
    const total = document.body.scrollHeight;
    const step  = window.innerHeight;
    for (let y = 0; y < total; y += step) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 300));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);

  // Find all (link href → nearby image src) pairs
  // Google Sites typically wraps each gallery item in a container that has
  // both an <a href="/..."> and an <img src="...">.
  const linkImagePairs = await page.evaluate(() => {
    const pairs = [];
    // Walk every element that contains both a link and an image
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href || '';
      if (!href.includes('wyattroy.com')) return;

      // Look for an image: inside the anchor, or in the nearest containing block
      let img = a.querySelector('img');
      if (!img) {
        const parent = a.closest('div, li, article, section, td');
        if (parent) img = parent.querySelector('img');
      }
      if (!img) return;

      const src = img.src || img.currentSrc || img.getAttribute('data-src') || '';
      if (!src || src.startsWith('data:')) return;

      pairs.push({ href: href.replace(/^https?:\/\/[^/]+/, ''), src });
    });
    return pairs;
  });

  // Build slug → image URL map (slug = last path segment, e.g. "handmove-xr")
  const slugToImg = {};
  linkImagePairs.forEach(({ href, src }) => {
    const slug = href.split('/').filter(Boolean).pop();
    if (slug && src) slugToImg[slug] = src;
  });

  // Download matched thumbnails
  cookies = await page.context().cookies();
  let downloaded = 0;

  for (const { id, url } of projectPages) {
    const pageSlug = url.split('/').filter(Boolean).pop(); // e.g. "handmove-xr"
    const imgUrl   = slugToImg[pageSlug];
    if (!imgUrl) { continue; }

    const projDir = path.join(ROOT, 'assets/projects', id);
    fs.mkdirSync(projDir, { recursive: true });
    const dest = path.join(projDir, 'thumb.jpg');

    if (fs.existsSync(dest)) { continue; } // already have it — don't overwrite

    try {
      await downloadWithCookies(imgUrl, dest, cookies);
      console.log(`  ✓ ${id}/thumb.jpg (from index)`);
      downloaded++;
    } catch (err) {
      console.log(`  ✗ ${id} index thumb: ${err.message}`);
    }
  }

  console.log(`  → ${downloaded} index thumbnails downloaded.\n`);
  return cookies;
}

// ── Text splitting ─────────────────────────────────────────────────────────────
function splitText(paragraphs) {
  if (!paragraphs || paragraphs.length === 0) return { description: '', what: '' };

  // Short description: first paragraph, up to 3 sentences / 300 chars
  const firstPara = paragraphs[0] || '';
  const sentences = firstPara.match(/[^.!?]+[.!?]+/g) || [firstPara];
  const description = sentences.slice(0, 3).join(' ').trim().slice(0, 300);

  // Full text as what; if 4+ paragraphs, split roughly in half for what/why
  let what, why;
  if (paragraphs.length >= 4) {
    const mid = Math.ceil(paragraphs.length / 2);
    what = paragraphs.slice(0, mid).join('\n\n');
    why  = paragraphs.slice(mid).join('\n\n');
  } else {
    what = paragraphs.join('\n\n');
    why  = '';
  }

  return { description, what, why };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log('Launching browser…');
  const userDataDir = path.join(ROOT, '.playwright-session');
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox'],
  });

  const page = await context.newPage();

  await page.goto('https://www.wyattroy.com', { waitUntil: 'networkidle', timeout: 30000 });

  if (page.url().includes('accounts.google.com')) {
    console.log('\n⚠️  Please log in to Google in the browser window.');
    console.log('   After seeing wyattroy.com, press Enter here to continue…');
    await new Promise(r => process.stdin.once('data', r));
    await page.goto('https://www.wyattroy.com', { waitUntil: 'networkidle', timeout: 30000 });
  }

  console.log('\n✓ Session ready. Starting scrape…');

  let cookies = await context.cookies();

  // Step 1: scrape index page for curated thumbnails first
  cookies = await scrapeIndexThumbnails(page, PROJECT_PAGES, cookies);
  const dataDir = path.join(ROOT, 'data/projects');
  fs.mkdirSync(dataDir, { recursive: true });

  let updated = 0, failed = 0;

  for (const { id, url } of PROJECT_PAGES) {
    process.stdout.write(`[${id}]`);
    const projDir = path.join(ROOT, 'assets/projects', id);
    fs.mkdirSync(projDir, { recursive: true });

    try {
      // 'load' fires once HTML + blocking resources are done, without waiting
      // for every lazy image — avoids timeouts on image-heavy Google Sites pages.
      await page.goto(url, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(1200);

      // Scroll through entire page to trigger lazy-rendered content
      await page.evaluate(async () => {
        const total = document.body.scrollHeight;
        const step  = window.innerHeight;
        for (let y = 0; y < total; y += step) {
          window.scrollTo(0, y);
          await new Promise(r => setTimeout(r, 350));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(500);

      // ── Extract text ──────────────────────────────────────────────────────
      const paragraphs = await extractPageText(page);
      const { description, what, why } = splitText(paragraphs);

      // ── Extract ALL image URLs ─────────────────────────────────────────────
      const imgSrcs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('img'))
          .flatMap(img => [
            img.src,
            img.currentSrc,
            img.getAttribute('data-src'),
            img.getAttribute('data-lazy-src'),
          ])
          .filter(Boolean)
      );

      // ── Extract video embed URLs ───────────────────────────────────────────
      const videoSrcs = await page.evaluate(() => {
        const srcs = [];
        document.querySelectorAll('iframe').forEach(f => {
          const s = f.src || f.getAttribute('data-src') || '';
          if (s.includes('youtube') || s.includes('vimeo')) srcs.push(s);
        });
        document.querySelectorAll('video source, video[src]').forEach(v => {
          srcs.push(v.src || v.getAttribute('src'));
        });
        return srcs.filter(Boolean);
      });

      cookies = await context.cookies();

      const usableImages = imgSrcs.filter(isUsableImage);

      // ── Download ALL images ────────────────────────────────────────────────
      const localImages = [];
      let dlCount = 0;

      for (let i = 0; i < usableImages.length; i++) {
        const imgUrl  = usableImages[i];
        const fname   = i === 0 ? 'thumb.jpg' : `img${i}.${imgExt(imgUrl)}`;
        const dest    = path.join(projDir, fname);
        const relPath = `assets/projects/${id}/${fname}`;

        if (fs.existsSync(dest)) {
          localImages.push(relPath);
          continue;
        }

        try {
          await downloadWithCookies(imgUrl, dest, cookies);
          localImages.push(relPath);
          dlCount++;
        } catch (err) {
          process.stdout.write(` [img${i} ✗]`);
        }
      }

      // Clean video URLs to canonical watch links
      function cleanVideoUrl(v) {
        const ytE  = v.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/);
        if (ytE) return `https://www.youtube.com/watch?v=${ytE[1]}`;
        const ytW  = v.match(/youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/);
        if (ytW) return `https://www.youtube.com/watch?v=${ytW[1]}`;
        const vim  = v.match(/vimeo\.com\/(\d+)/);
        if (vim) return `https://vimeo.com/${vim[1]}`;
        return null;
      }
      const cleanVideos = [...new Set(videoSrcs.map(cleanVideoUrl).filter(Boolean))];

      // ── Load & merge existing JSON ─────────────────────────────────────────
      const detailPath = path.join(dataDir, `${id}.json`);
      let existing = {};
      if (fs.existsSync(detailPath)) {
        try { existing = JSON.parse(fs.readFileSync(detailPath, 'utf8')); } catch {}
      } else {
        const allPath = path.join(ROOT, 'data/projects.json');
        const all = JSON.parse(fs.readFileSync(allPath, 'utf8'));
        existing = all.find(p => p.id === id) || { id };
      }

      const merged = {
        ...existing,
        // Text — always overwrite with freshly scraped content
        description,
        what,
        ...(why ? { why } : {}),
        scraped_raw_text: paragraphs,
        scraped_url: url,
        // Images — use local paths; fall back to existing if none downloaded
        thumbnail: localImages[0] || existing.thumbnail || '',
        images:    localImages.length > 0 ? localImages : (existing.images || []),
        // Videos — prefer project JSON entry, then freshly scraped
        videos: (existing.videos && existing.videos.length > 0)
          ? existing.videos
          : cleanVideos.length > 0 ? cleanVideos : (existing.videos || []),
      };

      fs.writeFileSync(detailPath, JSON.stringify(merged, null, 2));
      console.log(`  ✓  ${paragraphs.length}¶ text | ${localImages.length} imgs (${dlCount} new) | ${cleanVideos.length} videos`);
      updated++;
    } catch (err) {
      console.log(`  ✗  ${err.message}`);
      failed++;
    }
  }

  await context.close();

  // ── Sync thumbnails back to projects.json ─────────────────────────────────
  console.log('\nSyncing thumbnails to data/projects.json…');
  const allPath = path.join(ROOT, 'data/projects.json');
  const allProjects = JSON.parse(fs.readFileSync(allPath, 'utf8'));
  const updatedAll = allProjects.map(p => {
    const detailPath = path.join(dataDir, `${p.id}.json`);
    if (!fs.existsSync(detailPath)) return p;
    try {
      const detail = JSON.parse(fs.readFileSync(detailPath, 'utf8'));
      return {
        ...p,
        thumbnail:   detail.thumbnail   || p.thumbnail,
        description: detail.description || p.description,
        tagline:     p.tagline, // preserve hand-written taglines
      };
    } catch { return p; }
  });
  fs.writeFileSync(allPath, JSON.stringify(updatedAll, null, 2));

  console.log(`\n✅  Done. ${updated} updated, ${failed} failed.`);
  console.log('   Review data/projects/*.json — the "what" and "why" fields are auto-split.');
  console.log('   Hand-edit any that need better splitting or wording.');
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
