#!/usr/bin/env node
// Merges scraped remote image URLs into each data/projects/[id].json
// Uses remote URLs directly (since Google Sites blocks server-side download).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const scraped = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/scraped_raw.json'), 'utf8'));
const projects = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/projects.json'), 'utf8'));

// URL patterns that browsers CAN load (Google Sites CDN works in browser context)
function isUsableImage(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  if (u.includes('favicon') || u.includes('logo') || u.includes('.ico')) return false;
  return true;
}

function cleanVideoUrl(v) {
  const ytMatch = v.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/);
  if (ytMatch) return `https://www.youtube.com/watch?v=${ytMatch[1]}`;
  const vimeoMatch = v.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://vimeo.com/${vimeoMatch[1]}`;
  return null;
}

function matchProject(page) {
  const url = page.url.toLowerCase();
  for (const p of projects) {
    if (p.sourceUrl && p.sourceUrl.toLowerCase() === page.url.toLowerCase()) return p;
    if (p.liveUrl && p.liveUrl.toLowerCase() === page.url.toLowerCase()) return p;
  }
  const slug = url.split('/').filter(Boolean).pop().replace(/\.html$/, '');
  for (const p of projects) {
    if (p.id === slug || p.id.replace(/-/g,'') === slug.replace(/-/g,'')) return p;
    if (url.includes('/' + p.id) || url.includes('/' + p.id.replace(/-/g,''))) return p;
  }
  const title = (page.title || '').toLowerCase().trim();
  for (const p of projects) {
    const pt = p.title.toLowerCase();
    if (pt === title) return p;
  }
  return null;
}

let updated = 0;

for (const page of scraped) {
  const project = matchProject(page);
  if (!project) continue;

  const detailPath = path.join(ROOT, 'data/projects', `${project.id}.json`);
  let detail = {};
  if (fs.existsSync(detailPath)) {
    try { detail = JSON.parse(fs.readFileSync(detailPath, 'utf8')); } catch {}
  }

  const usableImages = (page.images || []).filter(isUsableImage);
  const cleanVideos = (page.videos || []).map(cleanVideoUrl).filter(Boolean);

  // Only fill gaps — don't overwrite curated data
  let changed = false;

  if ((!detail.images || detail.images.length === 0) && usableImages.length > 0) {
    detail.images = usableImages.slice(0, 8);
    changed = true;
  }

  if ((!detail.videos || detail.videos.length === 0) && cleanVideos.length > 0) {
    detail.videos = cleanVideos;
    changed = true;
  }

  if (!detail.description && page.description && page.description.length > 30) {
    detail.description = page.description;
    changed = true;
  }

  if (!detail.sourceUrl && page.url) {
    detail.sourceUrl = page.url;
    changed = true;
  }

  // Always write merged data (includes base project fields)
  const merged = { ...project, ...detail };
  fs.writeFileSync(detailPath, JSON.stringify(merged, null, 2));
  if (changed) { console.log(`  updated: ${project.id}`); updated++; }
}

console.log(`\nUpdated ${updated} detail files.`);
