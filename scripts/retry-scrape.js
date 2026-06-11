#!/usr/bin/env node
/**
 * retry-scrape.js
 * Retries the pages that timed out in scrape-text.js.
 * Uses 'domcontentloaded' (faster than 'load') + a longer wait for JS rendering.
 * Also re-runs any project whose scraped_raw_text looks like nav pollution
 * (contains known nav strings like "XRHandmove").
 *
 * Usage (run from project root):
 *   node scripts/retry-scrape.js
 */

const { chromium } = require('playwright');
const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');

const ROOT = path.join(__dirname, '..');

// ── Pages that need a retry ────────────────────────────────────────────────────
const RETRY_PAGES = [
  { id: 'sound-ag',    url: 'https://www.wyattroy.com/xr/sound-ag' },
  { id: 'mu-mirror',   url: 'https://www.wyattroy.com/interactive/mu-mirror' },
  { id: 'ceramics-3d', url: 'https://www.wyattroy.com/interactive/ceramics-3d' },
  { id: 'canyons',     url: 'https://www.wyattroy.com/design/canyons' },
  { id: 'hug',         url: 'https://www.wyattroy.com/design/the-hug' },
  { id: 'crawl',       url: 'https://www.wyattroy.com/design/crawl' },
  { id: 'offgridbox',  url: 'https://www.wyattroy.com/video/offgridbox' },
  { id: 'streetlogic', url: 'https://www.wyattroy.com/video/streetlogic' },
];

// Also retry any project whose scraped_raw_text begins with nav pollution
function hasNavPollution(data) {
  const raw = data.scraped_raw_text;
  if (!raw || raw.length === 0) return false;
  const first = raw[0] || '';
  return first.includes('XRHandmove') || first.includes('InteractiveMu') || first.includes('MoreHome');
}

// ── Helpers (shared with scrape-text.js) ──────────────────────────────────────
function isUsableImage(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  if (u.includes('favicon') || u.includes('logo') || u.includes('.ico')) return false;
  if (u.startsWith('data:')) return false;
  return /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/.test(u)
    || u.includes('googleusercontent.com')
    || u.includes('lh3.google');
}

function imgExt(url) {
  const u = url.split('?')[0];
  const m = u.match(/\.(webp|gif|png|svg|jpe?g)$/i);
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
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
      timeout: 30000,
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

async function extractPageText(page) {
  return page.evaluate(() => {
    const TEXT_SELECTORS = 'h1, h2, h3, h4, p, li, blockquote';
    const SKIP_PATTERNS = [
      /^wyatt roy$/i, /^home$/i, /^about$/i, /^xr$/i, /^interactive$/i,
      /^design$/i, /^video$/i, /^contact$/i, /^search$/i,
      /^skip to/i, /^copyright/i, /^\d{4} wyatt/i,
      /^share$/i, /^print$/i, /^report abuse/i,
      /^page updated/i, /^google sites/i,
    ];

    function isBoilerplate(text) {
      if (text.length < 4) return true;
      return SKIP_PATTERNS.some(re => re.test(text));
    }

    const seen = new Set();
    const paragraphs = [];

    document.querySelectorAll(TEXT_SELECTORS).forEach(el => {
      // Skip navigation, headers, footers
      if (el.closest('nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"]')) return;

      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!text || isBoilerplate(text) || seen.has(text)) return;
      seen.add(text);
      paragraphs.push(text);
    });

    return paragraphs;
  });
}

function splitText(paragraphs) {
  if (!paragraphs || paragraphs.length === 0) return { description: '', what: '', why: '' };
  const firstPara = paragraphs[0] || '';
  const sentences = firstPara.match(/[^.!?]+[.!?]+/g) || [firstPara];
  const description = sentences.slice(0, 3).join(' ').trim().slice(0, 300);
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

function cleanVideoUrl(v) {
  const ytE = v.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/);
  if (ytE) return `https://www.youtube.com/watch?v=${ytE[1]}`;
  const ytW = v.match(/youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/);
  if (ytW) return `https://www.youtube.com/watch?v=${ytW[1]}`;
  const vim = v.match(/vimeo\.com\/(\d+)/);
  if (vim) return `https://vimeo.com/${vim[1]}`;
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  // Collect pages to retry: explicitly listed failures + pollution victims
  const dataDir = path.join(ROOT, 'data/projects');
  const toRetry = [...RETRY_PAGES];

  const allJsons = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
  allJsons.forEach(file => {
    const id = file.replace('.json', '');
    if (toRetry.find(p => p.id === id)) return; // already in retry list
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
      if (hasNavPollution(data) && data.scraped_url) {
        console.log(`  [nav-pollution] adding ${id} to retry`);
        toRetry.push({ id, url: data.scraped_url });
      }
    } catch {}
  });

  console.log(`\nRetrying ${toRetry.length} projects…\n`);

  const userDataDir = path.join(ROOT, '.playwright-session');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox'],
  });
  const page = await context.newPage();

  // Verify session
  await page.goto('https://www.wyattroy.com', { waitUntil: 'load', timeout: 30000 });
  if (page.url().includes('accounts.google.com')) {
    console.log('⚠️  Please log in to Google, then press Enter…');
    await new Promise(r => process.stdin.once('data', r));
    await page.goto('https://www.wyattroy.com', { waitUntil: 'load', timeout: 30000 });
  }

  let cookies = await context.cookies();
  let ok = 0, fail = 0;

  for (const { id, url } of toRetry) {
    process.stdout.write(`[${id}]`);
    const projDir = path.join(ROOT, 'assets/projects', id);
    fs.mkdirSync(projDir, { recursive: true });

    let succeeded = false;

    // Try twice: first with 'load', then with 'domcontentloaded' if that also fails
    for (const [attempt, waitUntil, timeout] of [
      [1, 'load',             55000],
      [2, 'domcontentloaded', 45000],
    ]) {
      try {
        await page.goto(url, { waitUntil, timeout });
        // Give JS-rendered content time to paint (Google Sites is React-ish)
        await page.waitForTimeout(2500);

        // Scroll through the full page
        await page.evaluate(async () => {
          const total = document.body.scrollHeight;
          const step  = window.innerHeight;
          for (let y = 0; y < total; y += step) {
            window.scrollTo(0, y);
            await new Promise(r => setTimeout(r, 350));
          }
          window.scrollTo(0, 0);
        });
        await page.waitForTimeout(600);

        // ── Text ──────────────────────────────────────────────────────────
        const paragraphs = await extractPageText(page);
        const { description, what, why } = splitText(paragraphs);

        if (!description) throw new Error('no text extracted');

        // ── Images ────────────────────────────────────────────────────────
        const imgSrcs = await page.evaluate(() =>
          Array.from(document.querySelectorAll('img'))
            .flatMap(img => [img.src, img.currentSrc, img.getAttribute('data-src')])
            .filter(Boolean)
        );

        // ── Videos ────────────────────────────────────────────────────────
        const videoSrcs = await page.evaluate(() => {
          const s = [];
          document.querySelectorAll('iframe').forEach(f => {
            const src = f.src || f.getAttribute('data-src') || '';
            if (src.includes('youtube') || src.includes('vimeo')) s.push(src);
          });
          return s;
        });

        cookies = await context.cookies();
        const usableImages = imgSrcs.filter(isUsableImage);
        const cleanVideos = [...new Set(videoSrcs.map(cleanVideoUrl).filter(Boolean))];

        // ── Download images ────────────────────────────────────────────────
        const localImages = [];
        let dlCount = 0;
        for (let i = 0; i < usableImages.length; i++) {
          const imgUrl = usableImages[i];
          const fname  = i === 0 ? 'thumb.jpg' : `img${i}.${imgExt(imgUrl)}`;
          const dest   = path.join(projDir, fname);
          const rel    = `assets/projects/${id}/${fname}`;
          if (fs.existsSync(dest)) { localImages.push(rel); continue; }
          try {
            await downloadWithCookies(imgUrl, dest, cookies);
            localImages.push(rel); dlCount++;
          } catch {}
        }

        // ── Merge & save ──────────────────────────────────────────────────
        const detailPath = path.join(dataDir, `${id}.json`);
        let existing = {};
        if (fs.existsSync(detailPath)) {
          try { existing = JSON.parse(fs.readFileSync(detailPath, 'utf8')); } catch {}
        }

        const merged = {
          ...existing,
          description, what,
          ...(why ? { why } : {}),
          scraped_raw_text: paragraphs,
          scraped_url: url,
          thumbnail: localImages[0] || existing.thumbnail || '',
          images:    localImages.length > 0 ? localImages : (existing.images || []),
          videos: (existing.videos && existing.videos.length > 0)
            ? existing.videos
            : cleanVideos.length > 0 ? cleanVideos : [],
        };

        fs.writeFileSync(detailPath, JSON.stringify(merged, null, 2));
        console.log(`  ✓ (attempt ${attempt}) ${paragraphs.length}¶ | ${localImages.length} imgs (${dlCount} new)`);
        ok++;
        succeeded = true;
        break;
      } catch (err) {
        if (attempt === 1) {
          process.stdout.write(`  ↩ retry…`);
        } else {
          console.log(`  ✗ ${err.message}`);
          fail++;
        }
      }
    }
  }

  await context.close();
  console.log(`\n✅  Retry done. ${ok} succeeded, ${fail} still failing.`);
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
