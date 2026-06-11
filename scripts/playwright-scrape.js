#!/usr/bin/env node
/**
 * playwright-scrape.js
 * Uses Playwright to scrape wyattroy.com (Google Sites) with your real Google
 * session — handles auth-gated CDN images. Downloads all project images locally.
 *
 * Usage:
 *   node scripts/playwright-scrape.js
 *
 * On first run, a browser window will open. Log in to Google if prompted,
 * then the script takes over automatically.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..');

// ── All project source URLs to scrape ─────────────────────────────────────────
// Mapped to project IDs so we know where to save the assets
const PROJECT_PAGES = [
  // wyattroy.com
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
  // codeart (public, but included for completeness)
  { id: 'splatcubes',              url: 'https://wyattroy.github.io/codeart/pages/splatcubes/index.html' },
  { id: 'ripplestar',              url: 'https://wyattroy.github.io/codeart/pages/ripplestar/index.html' },
  { id: 'matchstick',              url: 'https://wyattroy.github.io/codeart/pages/matchstick/index.html' },
  { id: 'storymaker',              url: 'https://wyattroy.github.io/codeart/pages/storymaker/index.html' },
  { id: 'snow',                    url: 'https://wyattroy.github.io/codeart/pages/snow/index.html' },
  { id: 'all-rgb',                 url: 'https://wyattroy.github.io/codeart/pages/allrgb/index.html' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function isUsableImage(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  if (u.includes('favicon') || u.includes('logo') || u.includes('.ico')) return false;
  if (u.includes('data:')) return false;
  // Must look like an image
  return /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/.test(u) ||
         u.includes('googleusercontent.com') ||
         u.includes('lh3.google') ||
         u.includes('github.io');
}

function cleanVideoUrl(v) {
  const ytMatch = v.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/);
  if (ytMatch) return `https://www.youtube.com/watch?v=${ytMatch[1]}`;
  const ytWatch = v.match(/youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/);
  if (ytWatch) return `https://www.youtube.com/watch?v=${ytWatch[1]}`;
  const vimeo = v.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://vimeo.com/${vimeo[1]}`;
  return null;
}

function ext(url) {
  const u = url.split('?')[0];
  const m = u.match(/\.(webp|gif|png|jpe?g|svg)$/i);
  if (m) return m[1].toLowerCase().replace('jpeg','jpg');
  if (url.includes('googleusercontent.com')) return 'jpg';
  return 'jpg';
}

async function downloadWithCookies(url, dest, cookies) {
  // Convert Playwright cookies to Cookie header string
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
      timeout: 20000,
    }, (res) => {
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

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log('Launching browser… (log in to Google if prompted)');

  // Use persistent context so Google login sticks across runs
  const userDataDir = path.join(ROOT, '.playwright-session');
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,          // visible so you can log in on first run
    viewport: { width: 1280, height: 800 },
    args: ['--no-sandbox'],
  });

  const page = await context.newPage();

  // Warm up — visit Google Sites to trigger login if needed
  await page.goto('https://www.wyattroy.com', { waitUntil: 'networkidle', timeout: 30000 });

  // If not logged in, Google Sites will redirect to accounts.google.com
  if (page.url().includes('accounts.google.com')) {
    console.log('\n⚠️  Please log in to Google in the browser window that just opened.');
    console.log('   After logging in and seeing wyattroy.com, press Enter here to continue...');
    await new Promise(r => process.stdin.once('data', r));
    // Navigate back
    await page.goto('https://www.wyattroy.com', { waitUntil: 'networkidle', timeout: 30000 });
  }

  console.log('\n✓ Session ready. Starting scrape...\n');

  // Grab cookies for authenticated downloads
  let cookies = await context.cookies();

  const results = {}; // id → { images, videos, description }

  for (const { id, url } of PROJECT_PAGES) {
    console.log(`Scraping [${id}]...`);
    const projDir = path.join(ROOT, 'assets/projects', id);
    fs.mkdirSync(projDir, { recursive: true });

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(1000); // let lazy images settle

      // Scroll to load lazy images
      await page.evaluate(async () => {
        for (let i = 0; i < 5; i++) {
          window.scrollBy(0, window.innerHeight);
          await new Promise(r => setTimeout(r, 400));
        }
        window.scrollTo(0, 0);
      });

      // Extract all image srcs
      const imgSrcs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('img'))
          .map(img => img.src || img.currentSrc || img.getAttribute('data-src'))
          .filter(Boolean)
      );

      // Extract video embed URLs
      const videoSrcs = await page.evaluate(() => {
        const srcs = [];
        document.querySelectorAll('iframe').forEach(f => {
          const s = f.src || f.getAttribute('data-src') || '';
          if (s.includes('youtube') || s.includes('vimeo')) srcs.push(s);
        });
        document.querySelectorAll('video source').forEach(v => srcs.push(v.src));
        return srcs;
      });

      // Extract description
      const description = await page.evaluate(() => {
        const p = document.querySelector('article p, .content p, main p, p');
        return p ? p.innerText.trim().slice(0, 500) : '';
      });

      const usableImages = imgSrcs.filter(isUsableImage);
      const cleanVideos = videoSrcs.map(cleanVideoUrl).filter(Boolean);

      results[id] = { images: usableImages, videos: cleanVideos, description, url };

      // Refresh cookies (may have been updated)
      cookies = await context.cookies();

      // Download images
      let downloaded = 0;
      for (let i = 0; i < Math.min(usableImages.length, 8); i++) {
        const imgUrl = usableImages[i];
        const filename = i === 0 ? 'thumb.jpg' : `img${i}.${ext(imgUrl)}`;
        const dest = path.join(projDir, filename);

        if (fs.existsSync(dest)) { downloaded++; continue; }

        try {
          await downloadWithCookies(imgUrl, dest, cookies);
          console.log(`  ✓ ${filename}`);
          downloaded++;
        } catch (err) {
          console.warn(`  ✗ ${filename}: ${err.message}`);
        }
      }

      console.log(`  → ${downloaded} images, ${cleanVideos.length} videos\n`);
    } catch (err) {
      console.warn(`  ✗ [${id}] ${err.message}\n`);
    }
  }

  await context.close();

  // ── Update data/projects/[id].json with local paths ───────────────────────
  console.log('Updating project detail JSONs with local asset paths...');
  const projects = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/projects.json'), 'utf8'));

  for (const { id } of PROJECT_PAGES) {
    const projDir = path.join(ROOT, 'assets/projects', id);
    const detailPath = path.join(ROOT, 'data/projects', `${id}.json`);
    const project = projects.find(p => p.id === id);
    if (!project) continue;

    // Collect local images that actually exist
    const localImages = [];
    for (let i = 0; i <= 7; i++) {
      const name = i === 0 ? 'thumb.jpg' : `img${i}.jpg`;
      const also = i === 0 ? [] : [`img${i}.webp`, `img${i}.gif`, `img${i}.png`];
      const candidates = [path.join(projDir, name), ...also.map(n => path.join(projDir, n))];
      const found = candidates.find(c => fs.existsSync(c));
      if (found) {
        const relPath = found.replace(ROOT + '/', '').replace(ROOT + path.sep, '');
        localImages.push(relPath.replace(/\\/g, '/'));
      }
    }

    let existing = {};
    if (fs.existsSync(detailPath)) {
      try { existing = JSON.parse(fs.readFileSync(detailPath, 'utf8')); } catch {}
    }

    const scraped = results[id] || {};
    const cleanVideos = scraped.videos || [];

    const merged = {
      ...project,
      ...existing,
      thumbnail: localImages[0] || existing.thumbnail || project.thumbnail || '',
      images: localImages.length > 0 ? localImages : (existing.images || project.images || []),
      videos: (project.videos && project.videos.length > 0)
        ? project.videos
        : cleanVideos.length > 0 ? cleanVideos : (existing.videos || []),
      description: existing.description || project.description || scraped.description || '',
    };

    fs.writeFileSync(detailPath, JSON.stringify(merged, null, 2));
  }

  // Update thumbnail paths in projects.json
  const updatedProjects = projects.map(p => {
    const thumbPath = path.join(ROOT, 'assets/projects', p.id, 'thumb.jpg');
    if (fs.existsSync(thumbPath)) {
      return { ...p, thumbnail: `assets/projects/${p.id}/thumb.jpg` };
    }
    return p;
  });
  fs.writeFileSync(path.join(ROOT, 'data/projects.json'), JSON.stringify(updatedProjects, null, 2));

  console.log('\n✅ Done. All local images and JSONs updated.');
  console.log('   Restart your local server to see the changes.');
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
