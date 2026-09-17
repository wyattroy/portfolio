/**
 * og-image.mjs — renders the social link-preview image (Open Graph / Twitter card).
 *
 * Run by hand, NOT by CI. Unlike `prerender.mjs`, the output of this script is a
 * source asset: render it, eyeball it, commit the JPG. Nothing regenerates it.
 *
 *   npm run og            # renders the live image to assets/og/preview.jpg
 *   npm run og -- A2 B1   # renders those layouts to assets/og/candidates/ to compare
 *
 * It needs Playwright and a network path to fonts.googleapis.com (the site's real
 * Source Serif 4 / DM Sans / DM Mono are inlined so the render matches the site).
 * Output is a 2x screenshot downsampled to exactly 1200x630 — the size Facebook,
 * LinkedIn, Slack and X all want for a large summary card.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 1200, H = 630;

// The layout the site actually ships. og-variants.mjs keeps the alternates
// that lost, so swapping the preview is a one-word change here.
const CHOSEN = 'B2';
const LIVE = path.join(ROOT, 'assets/og/preview.jpg');
const CANDIDATES = path.join(ROOT, 'assets/og/candidates');

const GOOGLE_FONTS = 'https://fonts.googleapis.com/css2'
  + '?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700'
  + '&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500'
  + '&family=DM+Mono:wght@300;400;500&display=block';

// ─── tiny static server so the renderer can load repo images over http ───────
const MIME = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.gif':'image/gif', '.webp':'image/webp' };
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end(); return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve([srv, `http://127.0.0.1:${srv.address().port}/`]));
  });
}

// ─── inline the latin subsets of the site's webfonts as data: URIs ──────────
async function fontCss() {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  const css = await (await fetch(GOOGLE_FONTS, { headers: { 'user-agent': ua } })).text();
  const parts = css.split(/\/\*\s*([a-z-]+)\s*\*\//i);
  let out = '';
  for (let i = 1; i < parts.length; i += 2) {
    if (!/^latin(-ext)?$/.test(parts[i])) continue;
    const m = parts[i + 1].match(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/);
    if (!m) continue;
    const buf = Buffer.from(await (await fetch(m[1])).arrayBuffer());
    out += parts[i + 1].replace(m[1], 'data:font/woff2;base64,' + buf.toString('base64')) + '\n';
  }
  return out;
}

// ─── the projects that appear on the site, as the site filters them ─────────
function projects() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/projects.json'), 'utf8'));
  return (Array.isArray(raw) ? raw : raw.projects || [])
    .filter(p => p.label === 'green' && p.thumbnail && fs.existsSync(path.join(ROOT, p.thumbnail)))
    .map(p => ({ id: p.id, year: p.year, axes: p.axes, thumb: p.thumbnail }));
}

const run = async () => {
  const [srv, BASE] = await serve();
  const FONTS = await fontCss();
  const P = projects();
  const { VARIANTS } = await import('./og-variants.mjs');
  const wanted = process.argv.slice(2).filter(a => VARIANTS[a]);
  const names = wanted.length ? wanted : [CHOSEN];
  const dest = name => wanted.length ? path.join(CANDIDATES, name + '.jpg') : LIVE;

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const scaler = await ctx.newPage();
  await scaler.setContent('<body></body>');

  for (const name of names) {
    await page.setContent(VARIANTS[name]({ FONTS, BASE, P }), { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })));
    });
    await page.waitForTimeout(400);
    const shot = (await page.screenshot({ type: 'png' })).toString('base64');

    // downsample the 2x render to exactly 1200x630 — sharper than rendering at 1x
    const jpg = await scaler.evaluate(async src => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 1200; c.height = 630;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, 1200, 630);
      return c.toDataURL('image/jpeg', 0.92).split(',')[1];
    }, shot);

    const file = dest(name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(jpg, 'base64'));
    console.log(`${name}  ${(fs.statSync(file).size / 1024) | 0} KB  →  ${path.relative(ROOT, file)}`);
  }

  await browser.close();
  srv.close();
};

run();
