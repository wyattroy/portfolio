#!/usr/bin/env node
/**
 * download-thumbnails.js
 * Reads scraped_raw.json, matches pages to projects.json entries by URL/title,
 * downloads first usable image as assets/projects/[id]/thumb.jpg,
 * and writes/merges data/projects/[id].json with scraped images + description.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const scraped = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/scraped_raw.json'), 'utf8'));
const projects = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/projects.json'), 'utf8'));

// URL → project ID mapping (source URLs from projects.json + common patterns)
function matchScrapedToProject(page) {
  const url = page.url.toLowerCase();
  const title = (page.title || '').toLowerCase().trim();

  // Try direct sourceUrl match
  for (const p of projects) {
    if (p.sourceUrl && p.sourceUrl.toLowerCase() === page.url.toLowerCase()) return p;
    if (p.liveUrl && p.liveUrl.toLowerCase() === page.url.toLowerCase()) return p;
  }

  // Try URL slug match
  const slug = url.split('/').filter(Boolean).pop();
  for (const p of projects) {
    if (slug && (p.id === slug || p.id.replace(/-/g, '') === slug.replace(/-/g, ''))) return p;
  }

  // URL contains project id
  for (const p of projects) {
    if (url.includes('/' + p.id) || url.includes('/' + p.id.replace(/-/g, ''))) return p;
  }

  // Title fuzzy match
  for (const p of projects) {
    const pt = p.title.toLowerCase();
    if (pt === title) return p;
    if (title.includes(pt) || pt.includes(title.slice(0, 12))) return p;
  }

  return null;
}

function downloadFile(url, dest, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;

    const req = client.get(url, {
      headers: { 'User-Agent': 'WyattRoy-Portfolio/1.0' },
      timeout,
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Follow redirect
        return downloadFile(res.headers.location, dest, timeout).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
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

function isUsableImage(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  // Skip tiny icons, logos, etc.
  if (u.includes('favicon') || u.includes('logo') || u.includes('.ico')) return false;
  // Accept common image extensions and Google Sites CDN
  return u.match(/\.(jpg|jpeg|png|gif|webp|svg)/) ||
         u.includes('googleusercontent.com') ||
         u.includes('lh3.google') ||
         u.includes('lh4.google') ||
         u.includes('github.io');
}

async function run() {
  let thumbsDownloaded = 0;
  let detailsWritten = 0;

  for (const page of scraped) {
    const project = matchScrapedToProject(page);
    if (!project) continue;

    const projDir = path.join(ROOT, 'assets/projects', project.id);
    fs.mkdirSync(projDir, { recursive: true });

    // Download thumbnail if missing
    const thumbPath = path.join(projDir, 'thumb.jpg');
    if (!fs.existsSync(thumbPath)) {
      const usableImages = (page.images || []).filter(isUsableImage);
      if (usableImages.length > 0) {
        try {
          await downloadFile(usableImages[0], thumbPath);
          console.log(`✓ thumb  [${project.id}]`);
          thumbsDownloaded++;
        } catch (err) {
          console.warn(`✗ thumb  [${project.id}] ${err.message}`);
          // Try second image
          if (usableImages.length > 1) {
            try {
              await downloadFile(usableImages[1], thumbPath);
              console.log(`✓ thumb2 [${project.id}]`);
              thumbsDownloaded++;
            } catch {}
          }
        }
      }
    }

    // Download additional images (up to 6)
    const usableImages = (page.images || []).filter(isUsableImage);
    for (let i = 1; i < Math.min(usableImages.length, 7); i++) {
      const imgPath = path.join(projDir, `img${i}.jpg`);
      if (!fs.existsSync(imgPath)) {
        try {
          await downloadFile(usableImages[i], imgPath);
          console.log(`  img${i}  [${project.id}]`);
        } catch {}
      }
    }

    // Write/merge data/projects/[id].json
    const detailPath = path.join(ROOT, 'data/projects', `${project.id}.json`);
    let existing = {};
    if (fs.existsSync(detailPath)) {
      try { existing = JSON.parse(fs.readFileSync(detailPath, 'utf8')); } catch {}
    }

    // Build local image paths
    const localImages = [];
    for (let i = 1; i <= 6; i++) {
      const p = path.join(projDir, `img${i}.jpg`);
      if (fs.existsSync(p)) localImages.push(`assets/projects/${project.id}/img${i}.jpg`);
    }

    // Extract video URLs (clean up Google Sites embeds, prefer clean YouTube/Vimeo)
    const cleanVideos = (page.videos || []).map(v => {
      // Extract YouTube ID from messy embed URL
      const ytMatch = v.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/);
      if (ytMatch) return `https://www.youtube.com/watch?v=${ytMatch[1]}`;
      const vimeoMatch = v.match(/vimeo\.com\/(\d+)/);
      if (vimeoMatch) return `https://vimeo.com/${vimeoMatch[1]}`;
      return v;
    }).filter(v => v.includes('youtube.com') || v.includes('vimeo.com'));

    // Merge: curated data takes precedence, scraped fills gaps
    const merged = {
      ...project,         // base from projects.json (has curated what/why/awards)
      ...existing,        // existing detail JSON takes precedence
      // Fill gaps from scrape
      description: existing.description || project.description || page.description || '',
      images: (existing.images && existing.images.length > 0)
        ? existing.images
        : localImages.length > 0 ? localImages : (project.images || []),
      videos: (project.videos && project.videos.length > 0)
        ? project.videos
        : cleanVideos.length > 0 ? cleanVideos : (existing.videos || []),
      thumbnail: fs.existsSync(thumbPath)
        ? `assets/projects/${project.id}/thumb.jpg`
        : (project.thumbnail || existing.thumbnail || ''),
      sourceUrl: project.sourceUrl || page.url,
    };

    fs.writeFileSync(detailPath, JSON.stringify(merged, null, 2));
    detailsWritten++;
  }

  // Also update the thumbnail paths in projects.json
  const updatedProjects = projects.map(p => {
    const thumbPath = path.join(ROOT, 'assets/projects', p.id, 'thumb.jpg');
    if (fs.existsSync(thumbPath)) {
      return { ...p, thumbnail: `assets/projects/${p.id}/thumb.jpg` };
    }
    return p;
  });
  fs.writeFileSync(path.join(ROOT, 'data/projects.json'), JSON.stringify(updatedProjects, null, 2));

  console.log(`\nDone. Thumbnails: ${thumbsDownloaded}, detail files: ${detailsWritten}`);
  console.log('Updated projects.json thumbnail paths.');
}

run().catch(err => { console.error(err); process.exit(1); });
