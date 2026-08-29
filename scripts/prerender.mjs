#!/usr/bin/env node
/**
 * Pre-renders every project page to a static HTML file so crawlers and social
 * card scrapers see real content instead of an empty shell.
 *
 * For each project it serves the repo locally, loads project.html#<id> in
 * headless Chromium, waits for the client-side render, injects per-project
 * <title>/description/OpenGraph/JSON-LD, and writes the resulting DOM to
 * p/<id>/index.html. A <base href="/"> keeps every relative path in the dump
 * resolving correctly from the nested directory.
 *
 * The dumped pages keep their <script> tags, so on load the same JS re-renders
 * over the static markup — crawlers get HTML, humans get the interactive page.
 *
 * Also writes sitemap.xml + robots.txt and refreshes the crawlable link list
 * inside index.html's PRERENDER:LINKS markers.
 *
 * Usage: npm run prerender
 */

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://wyattroy.com';
const PROD_HOST = new URL(ORIGIN).host;
const OUT_DIR = join(ROOT, 'p');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

// ─── Local static server ──────────────────────────────────────────────────────
function serve() {
  const server = createServer(async (req, res) => {
    try {
      let rel = normalize(decodeURIComponent(req.url.split('?')[0].split('#')[0]));
      if (rel.includes('..')) return res.writeHead(403).end();
      if (rel.endsWith('/')) rel += 'index.html';
      const file = join(ROOT, rel);
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      // A client abort can throw after the response has already started.
      if (res.headersSent) return res.destroy();
      res.writeHead(404).end('not found');
    }
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ─── Per-project metadata ─────────────────────────────────────────────────────
function absolute(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${ORIGIN}/${String(path).replace(/^\/+/, '')}`;
}

function describe(project) {
  const text = project.tagline || project.description || project.what || '';
  const flat = String(text).replace(/\s+/g, ' ').replace(/[*_`]/g, '').trim();
  if (flat) return flat.length > 300 ? `${flat.slice(0, 297)}…` : flat;
  return `${project.title} — a project by Wyatt Roy.`;
}

/** Runs inside the page: rewrite <head> for this project, then clean up. */
function injectMeta({ id, title, description, image, url, keywords, year, medium, origin }) {
  const head = document.head;

  // <base> must precede the first relative URL in <head>.
  const base = document.createElement('base');
  base.setAttribute('href', '/');
  const charset = head.querySelector('meta[charset]');
  charset ? charset.insertAdjacentElement('afterend', base) : head.prepend(base);

  const meta = (attr, key, content) => {
    if (!content) return;
    let el = head.querySelector(`meta[${attr}="${key}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, key);
      head.appendChild(el);
    }
    el.setAttribute('content', content);
  };

  // project.html is noindex (see its <head>) so the un-prerendered shell and any
  // unlisted project reached via #hash stay out of the index. These generated
  // pages are the canonical, indexable copies, so lift it here.
  head.querySelectorAll('meta[name="robots"]').forEach(el => el.remove());

  document.title = title;
  meta('name', 'description', description);
  meta('name', 'keywords', keywords);
  meta('name', 'author', 'Wyatt Roy');

  let canonical = head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    head.appendChild(canonical);
  }
  canonical.setAttribute('href', url);

  meta('property', 'og:type', 'article');
  meta('property', 'og:site_name', 'Wyatt Roy');
  meta('property', 'og:title', title);
  meta('property', 'og:description', description);
  meta('property', 'og:url', url);
  meta('property', 'og:image', image);
  meta('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
  meta('name', 'twitter:title', title);
  meta('name', 'twitter:description', description);
  meta('name', 'twitter:image', image);

  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    '@id': url,
    name: title,
    headline: title,
    description,
    url,
    ...(image ? { image } : {}),
    ...(year ? { dateCreated: String(year) } : {}),
    ...(medium ? { genre: medium } : {}),
    ...(keywords ? { keywords } : {}),
    author: { '@type': 'Person', name: 'Wyatt Roy', url: origin },
  }, null, 2);
  head.appendChild(ld);

  // Comments load from Supabase at runtime — never bake a stale snapshot in.
  const comments = document.getElementById('pp-comment-section');
  if (comments) {
    comments.className = '';
    comments.innerHTML = '';
  }
}

// ─── Generated files ──────────────────────────────────────────────────────────
async function writeSitemap(projects) {
  // NOT file mtime: a fresh clone stamps every file with the checkout time, so
  // mtime-based dates would churn on every CI run. Commit dates are stable.
  const gitDate = file => {
    try {
      const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', file],
        { cwd: ROOT, encoding: 'utf8' }).trim();
      return out || null;
    } catch { return null; }
  };
  const lastmod = async id => gitDate(join('data', 'projects', `${id}.json`));
  const entries = [
    { loc: `${ORIGIN}/`, priority: '1.0', mod: gitDate('data/projects.json') },
    { loc: `${ORIGIN}/about.html`, priority: '0.6', mod: null },
  ];
  for (const p of projects) {
    entries.push({ loc: `${ORIGIN}/p/${p.id}/`, priority: p.featured ? '0.9' : '0.8', mod: await lastmod(p.id) });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">
${entries.map(e => `  <url>
    <loc>${e.loc}</loc>${e.mod ? `\n    <lastmod>${e.mod}</lastmod>` : ''}
    <priority>${e.priority}</priority>
  </url>`).join('\n')}
</urlset>
`.replace('www.sitemap.org', 'www.sitemaps.org');

  await writeFile(join(ROOT, 'sitemap.xml'), xml);
  await writeFile(join(ROOT, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  console.log(`  sitemap.xml (${entries.length} urls) + robots.txt`);
}

const escape = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Fills the marker block in index.html with a plain list of project links.
 * project-list.js clears #project-grid on boot, so this is what crawlers and
 * no-JS visitors see and nothing more.
 */
async function writeHomepageLinks(projects) {
  const file = join(ROOT, 'index.html');
  const html = await readFile(file, 'utf8');
  const START = '<!-- PRERENDER:LINKS:START -->';
  const END = '<!-- PRERENDER:LINKS:END -->';
  const from = html.indexOf(START);
  const to = html.indexOf(END);
  if (from === -1 || to === -1) throw new Error('index.html is missing the PRERENDER:LINKS markers');

  const items = projects.map(p => `        <li><a href="/p/${escape(p.id)}/">${escape(p.title)}</a>${
    p.tagline ? ` — ${escape(p.tagline)}` : ''}${p.year ? ` <span>(${escape(p.year)})</span>` : ''}</li>`).join('\n');

  const block = `${START}
      <ul class="prerender-index">
${items}
      </ul>
      `;
  await writeFile(file, html.slice(0, from) + block + html.slice(to));
  console.log(`  index.html link block (${projects.length} links)`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const only = process.argv.slice(2).filter(a => !a.startsWith('-'));

const allProjects = JSON.parse(await readFile(join(ROOT, 'data/projects.json'), 'utf8'));

// Same publish gate the site itself uses (main.js, search-suggestions.js,
// renderProjectNav): only label === 'green' projects are listed. Unpublished
// projects stay reachable at project.html#<id> but must never be pre-rendered,
// or an unlisted page becomes an indexed one.
const projects = allProjects.filter(p => p.label === 'green');
const gated = allProjects.length - projects.length;
if (gated) console.log(`Skipping ${gated} unpublished project(s) (label !== 'green').`);

const ordered = [...projects].sort((a, b) =>
  (b.year || 0) - (a.year || 0) || (b.month || 0) - (a.month || 0) ||
  String(a.title).localeCompare(String(b.title)));
const targets = only.length ? ordered.filter(p => only.includes(p.id)) : ordered;
if (only.length) {
  const refused = only.filter(id => !projects.some(p => p.id === id)
    && allProjects.some(p => p.id === id));
  if (refused.length) {
    console.error(`Refusing to pre-render unpublished project(s): ${refused.join(', ')}`);
    console.error("Set label: 'green' in data/projects.json to publish.");
    process.exit(1);
  }
}
if (!targets.length) {
  console.error(only.length ? `No project matched: ${only.join(', ')}` : 'No published projects found');
  process.exit(1);
}

const { server, port } = await serve();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1800 } });

// Supabase would inject live comments into the dump; keep it out of the render.
await page.route('**/cdn.jsdelivr.net/**', route => route.abort());

console.log(`Pre-rendering ${targets.length} project page(s)…`);
const failures = [];

for (const summary of targets) {
  const { id } = summary;
  let detail = {};
  try {
    detail = JSON.parse(await readFile(join(ROOT, 'data/projects', `${id}.json`), 'utf8'));
  } catch { /* master-list-only project; summary fields are enough */ }
  const project = { ...summary, ...detail };

  try {
    // Must be ?id= and not #id: a fragment change is a same-document navigation,
    // so the page would never reload and every <head> tag injected for the
    // previous project would still be attached to this one.
    await page.goto(`http://127.0.0.1:${port}/project.html?id=${encodeURIComponent(id)}`,
      { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#project-page-root .pp-title', { timeout: 20000 });
    await page.waitForFunction(
      expected => document.querySelector('#project-page-root .pp-title')?.textContent === expected,
      project.title, { timeout: 20000 });

    const url = `${ORIGIN}/p/${id}/`;
    await page.evaluate(injectMeta, {
      id,
      title: `${project.title} — Wyatt Roy`,
      description: describe(project),
      image: absolute(project.thumbnail || project.hero || (project.images || [])[0]),
      url,
      keywords: (project.tags || []).join(', ') || null,
      origin: `${ORIGIN}/`,
      year: project.year || null,
      medium: project.medium || null,
    });

    const shape = await page.evaluate(() => ({
      ld: document.querySelectorAll('script[type="application/ld+json"]').length,
      base: document.querySelectorAll('base').length,
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
      title: document.title,
    }));
    if (shape.ld !== 1 || shape.base !== 1 || shape.canonical !== url) {
      throw new Error(`contaminated dump: ${JSON.stringify(shape)}`);
    }

    // Anything the page derived from its own address (a Twitch embed's parent=
    // param, for instance) points at the throwaway dev server. Rewrite those to
    // the production origin, then assert nothing slipped through.
    const html = (await page.content())
      .replace(/^<!DOCTYPE html>\s*/i, '')
      .replaceAll(`http://127.0.0.1:${port}`, ORIGIN)
      .replaceAll('127.0.0.1', PROD_HOST);
    if (html.includes('127.0.0.1')) {
      throw new Error(`dev-server address leaked into p/${id}/`);
    }

    const dir = join(OUT_DIR, id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), `<!DOCTYPE html>\n${html}`);
    console.log(`  p/${id}/`);
  } catch (err) {
    failures.push({ id, message: err.message.split('\n')[0] });
    console.error(`  FAILED p/${id}/ — ${err.message.split('\n')[0]}`);
  }
}

await browser.close();
server.close();

// Sitemap and homepage links describe the whole site, so only rewrite them on a
// full run — a single-project run would otherwise drop the other 56.
if (!only.length) {
  const rendered = targets.filter(p => !failures.some(f => f.id === p.id));
  await writeSitemap(rendered);
  await writeHomepageLinks(rendered);
  // Drop directories for projects that no longer exist.
  if (existsSync(OUT_DIR)) {
    const { readdir } = await import('node:fs/promises');
    const live = new Set(rendered.map(p => p.id));
    for (const entry of await readdir(OUT_DIR)) {
      if (!live.has(entry)) {
        await rm(join(OUT_DIR, entry), { recursive: true, force: true });
        console.log(`  removed stale p/${entry}/`);
      }
    }
  }
}

if (failures.length) {
  console.error(`\n${failures.length} page(s) failed to pre-render.`);
  process.exit(1);
}
console.log(`\nDone — ${targets.length} page(s).`);
