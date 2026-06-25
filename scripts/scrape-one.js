#!/usr/bin/env node
/**
 * scrape-one.js — targeted single-project image scraper using Playwright
 * Uses the saved .playwright-session so Google auth is usually pre-loaded.
 *
 * Usage:
 *   node scripts/scrape-one.js <project-id> <url>
 *   node scripts/scrape-one.js sorry https://www.wyattroy.com/interactive/sorry
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const [,, projectId, pageUrl] = process.argv;

if (!projectId || !pageUrl) {
  console.error('Usage: node scripts/scrape-one.js <project-id> <url>');
  process.exit(1);
}

function ext(url) {
  const u = url.split('?')[0];
  const m = u.match(/\.(webp|gif|png|jpe?g|svg)$/i);
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  if (url.includes('googleusercontent.com')) return 'jpg';
  return 'jpg';
}

function isUsableImage(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  if (u.includes('favicon') || u.includes('logo') || u.includes('.ico')) return false;
  if (u.startsWith('data:')) return false;
  return /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/.test(u) ||
         u.includes('googleusercontent.com') ||
         u.includes('lh3.google');
}

async function downloadWithCookies(url, dest, cookies) {
  const cookieHeader = cookies
    .filter(c => url.includes(c.domain.replace(/^\./, '')))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36',
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
      // Check content-type — reject HTML responses
      const ct = res.headers['content-type'] || '';
      if (ct.includes('text/html')) {
        res.resume();
        return reject(new Error('Got HTML instead of image (auth redirect)'));
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

async function run() {
  const userDataDir = path.join(ROOT, '.playwright-session');
  fs.mkdirSync(userDataDir, { recursive: true });

  const projDir = path.join(ROOT, 'assets/projects', projectId);
  fs.mkdirSync(projDir, { recursive: true });

  // Try headless first (reuses saved session); fall back to headed for login
  let context;
  let needsLogin = false;

  context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: ['--no-sandbox'],
  });

  const page = await context.newPage();
  await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30000 });

  if (page.url().includes('accounts.google.com')) {
    needsLogin = true;
    await context.close();
  }

  if (needsLogin) {
    console.log('Session expired — opening browser for Google login...');
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: ['--no-sandbox'],
    });
    const p2 = await context.newPage();
    await p2.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30000 });
    console.log('Please log in, then press Enter here...');
    await new Promise(r => process.stdin.once('data', r));
    await p2.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30000 });
    page = p2;
  }

  // Scroll to trigger lazy-load
  await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) {
      window.scrollBy(0, window.innerHeight);
      await new Promise(r => setTimeout(r, 400));
    }
    window.scrollTo(0, 0);
  });

  // Gather image URLs
  const imgSrcs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('img'))
      .map(img => img.src || img.currentSrc || img.getAttribute('data-src'))
      .filter(Boolean)
  );

  // Gather all text content section by section
  const textContent = await page.evaluate(() => {
    const sections = [];
    document.querySelectorAll('p, h1, h2, h3, h4').forEach(el => {
      const t = el.innerText.trim();
      if (t) sections.push(t);
    });
    return sections;
  });

  console.log('\nText content:');
  textContent.forEach(t => console.log(' ', JSON.stringify(t)));

  const usable = imgSrcs.filter(isUsableImage);
  console.log(`\nFound ${usable.length} image(s):`);
  usable.forEach(u => console.log(' ', u));

  const cookies = await context.cookies();

  // Download each image, naming sequentially
  const existingFiles = fs.readdirSync(projDir);
  const existingCount = existingFiles.filter(f => /^img\d+\.(jpg|jpeg|png|gif|webp)$/i.test(f)).length;

  let downloaded = 0;
  for (let i = 0; i < usable.length; i++) {
    const imgUrl = usable[i];
    const e = ext(imgUrl);
    // Name: img1, img2, ... continuing from where existing files leave off
    const filename = `img${existingCount + i + 1}.${e}`;
    const dest = path.join(projDir, filename);

    if (fs.existsSync(dest)) {
      console.log(`  skip ${filename} (exists)`);
      continue;
    }

    try {
      await downloadWithCookies(imgUrl, dest, cookies);
      // Verify not HTML
      const buf = fs.readFileSync(dest, { encoding: null });
      if (buf.slice(0, 15).toString().includes('<!')) {
        fs.unlinkSync(dest);
        console.warn(`  ✗ ${filename}: got HTML (auth issue)`);
      } else {
        console.log(`  ✓ ${filename} (${Math.round(buf.length / 1024)}KB)`);
        downloaded++;
      }
    } catch (err) {
      console.warn(`  ✗ ${filename}: ${err.message}`);
    }
  }

  await context.close();
  console.log(`\nDone. ${downloaded} new image(s) downloaded to assets/projects/${projectId}/`);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
