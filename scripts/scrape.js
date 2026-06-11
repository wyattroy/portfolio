#!/usr/bin/env node
/**
 * scrape.js — Web scraper for wyattroy.com portfolio content
 *
 * Usage:
 *   npm install node-fetch cheerio
 *   node scripts/scrape.js
 *
 * Output:
 *   data/scraped_raw.json  — raw scraped content
 *   Console log of merge suggestions (does not overwrite curated data)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Dynamic imports for ESM-only packages
async function run() {
  let fetch, cheerio;
  try {
    fetch = (await import('node-fetch')).default;
  } catch {
    // Try CommonJS version
    fetch = require('node-fetch');
  }
  try {
    cheerio = await import('cheerio');
  } catch {
    cheerio = require('cheerio');
  }

  const { load } = cheerio;

  // ─── Sites to crawl ─────────────────────────────────────────────────────────
  const SITES = [
    { base: 'https://www.wyattroy.com', name: 'wyattroy' },
    { base: 'https://wyattroy.github.io/ps70', name: 'ps70' },
    { base: 'https://wyattroy.github.io/codeart/', name: 'codeart' },
  ];

  const TIMEOUT = 10000;
  const scraped = [];

  // ─── Fetch with timeout ──────────────────────────────────────────────────────
  async function fetchPage(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'WyattRoy-Portfolio-Scraper/1.0 (research)' },
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.text();
    } catch (err) {
      clearTimeout(timer);
      console.warn(`  ✗ ${url}: ${err.message}`);
      return null;
    }
  }

  // ─── Extract internal links ──────────────────────────────────────────────────
  function extractLinks(html, base) {
    const $ = load(html);
    const links = new Set();
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      try {
        const url = new URL(href, base);
        if (url.origin === new URL(base).origin) {
          // Remove fragments and trailing slashes
          url.hash = '';
          const normalized = url.href.replace(/\/$/, '');
          links.add(normalized);
        }
      } catch {
        // Ignore invalid URLs
      }
    });
    return Array.from(links);
  }

  // ─── Extract page content ────────────────────────────────────────────────────
  function extractContent(html, url, siteName) {
    const $ = load(html);

    // Remove nav, footer, scripts, styles
    $('nav, footer, script, style, noscript, .nav, .footer, .sidebar').remove();

    const title = $('h1').first().text().trim() ||
      $('title').text().trim() ||
      $('h2').first().text().trim() ||
      '';

    const description = $('meta[name="description"]').attr('content') ||
      $('p').first().text().trim().slice(0, 300) ||
      '';

    // Extract images
    const images = [];
    $('img[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (!src) return;
      try {
        const absoluteSrc = new URL(src, url).href;
        if (!absoluteSrc.includes('logo') && !absoluteSrc.includes('icon')) {
          images.push(absoluteSrc);
        }
      } catch {}
    });

    // Extract videos (iframe src, video src)
    const videos = [];
    $('iframe[src], video source[src], [data-src]').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src && (src.includes('vimeo') || src.includes('youtube'))) {
        videos.push(src);
      }
    });

    // Extract links
    const links = [];
    $('a[href^="http"]').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href && text) links.push({ href, text });
    });

    // Try to find source URL (GitHub link)
    let sourceUrl = null;
    $('a[href*="github.com"]').each((_, el) => {
      if (!sourceUrl) sourceUrl = $(el).attr('href');
    });

    return {
      url,
      sourceSite: siteName,
      title: title.slice(0, 200),
      description: description.slice(0, 500),
      images: [...new Set(images)].slice(0, 20),
      videos: [...new Set(videos)].slice(0, 10),
      links: links.slice(0, 30),
      sourceUrl,
      scrapedAt: new Date().toISOString(),
    };
  }

  // ─── Crawl a site ────────────────────────────────────────────────────────────
  async function crawlSite(site) {
    console.log(`\n🌐 Crawling ${site.base} (${site.name})...`);
    const visited = new Set();

    // Fetch root
    const rootHtml = await fetchPage(site.base);
    if (!rootHtml) {
      console.warn(`  Could not fetch root: ${site.base}`);
      return;
    }

    const rootContent = extractContent(rootHtml, site.base, site.name);
    if (rootContent.title) scraped.push(rootContent);
    visited.add(site.base);
    console.log(`  ✓ ${site.base} — "${rootContent.title}"`);

    // Get internal links (one level deep)
    const links = extractLinks(rootHtml, site.base);
    const toVisit = links.filter(l => !visited.has(l)).slice(0, 40);

    for (const link of toVisit) {
      if (visited.has(link)) continue;
      visited.add(link);

      // Small delay to be polite
      await new Promise(r => setTimeout(r, 300));

      const html = await fetchPage(link);
      if (!html) continue;

      const content = extractContent(html, link, site.name);
      if (content.title || content.description) {
        scraped.push(content);
        console.log(`  ✓ ${link} — "${content.title}"`);
      }
    }
  }

  // ─── Run all sites ────────────────────────────────────────────────────────────
  for (const site of SITES) {
    try {
      await crawlSite(site);
    } catch (err) {
      console.error(`Error crawling ${site.name}:`, err.message);
    }
  }

  // ─── Save raw output ─────────────────────────────────────────────────────────
  const outputPath = path.join(__dirname, '../data/scraped_raw.json');
  fs.writeFileSync(outputPath, JSON.stringify(scraped, null, 2));
  console.log(`\n✅ Saved ${scraped.length} pages to ${outputPath}`);

  // ─── Merge suggestions ────────────────────────────────────────────────────────
  let curated = [];
  try {
    curated = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/projects.json'), 'utf8'));
  } catch {
    console.warn('Could not read projects.json for merge');
    return;
  }

  console.log('\n─── Merge Suggestions ───────────────────────────────────────────');
  console.log('(Manual review needed — curated data takes precedence)\n');

  scraped.forEach(page => {
    const match = curated.find(p =>
      p.title && page.title &&
      p.title.toLowerCase().includes(page.title.toLowerCase().slice(0, 12))
    );

    if (match) {
      const suggestions = [];
      if (page.images.length > 0 && (!match.images || match.images.length === 0)) {
        suggestions.push(`  images: ${page.images.slice(0, 3).join(', ')}`);
      }
      if (page.videos.length > 0 && (!match.videos || match.videos.length === 0)) {
        suggestions.push(`  videos: ${page.videos.join(', ')}`);
      }
      if (page.sourceUrl && !match.sourceUrl) {
        suggestions.push(`  sourceUrl: ${page.sourceUrl}`);
      }
      if (suggestions.length > 0) {
        console.log(`Project "${match.title}" (${match.id}):`);
        suggestions.forEach(s => console.log(s));
        console.log();
      }
    } else if (page.title && page.title.length > 3) {
      console.log(`Unmatched page: "${page.title}" (${page.url})`);
    }
  });

  console.log('\nDone. Review scraped_raw.json and update projects.json manually.');
}

run().catch(err => {
  console.error('Scraper error:', err);
  process.exit(1);
});
