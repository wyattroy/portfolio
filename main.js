/**
 * main.js — Entry point for the Wyatt Roy portfolio
 * Vanilla ES modules, no build step
 */

import { initProjectList, expandProject, buildDetailContent } from './project-list.js';
import { initLightbox } from './project-detail.js';

// ─── Email construction (never in HTML) ──────────────────────────────────────
const emailParts = ['wyatty', 'gmail.com'];
const email = emailParts.join('@');

// ─── Scroll position save/restore ────────────────────────────────────────────
const SCROLL_KEY = 'wyattroy-index-scrollY';

window.addEventListener('pagehide', () => {
  sessionStorage.setItem(SCROLL_KEY, String(Math.round(window.scrollY)));
});

function maybeRestoreScroll() {
  const saved = parseInt(sessionStorage.getItem(SCROLL_KEY) || '0', 10);
  if (!saved) return;
  sessionStorage.removeItem(SCROLL_KEY);
  // Give the grid one paint cycle to render, then jump
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.scrollTo({ top: saved, behavior: 'instant' });
    });
  });
}

// ─── Boot ────────────────────────────────────────────────────────────────────
async function boot() {
  // Set up nav behaviors first (no data needed)
  setupNav();
  setupFooter();

  // Load project data
  let projects = [];
  try {
    const res = await fetch('data/projects.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    projects = await res.json();
  } catch (err) {
    console.error('Failed to load projects.json:', err);
    document.getElementById('project-grid').innerHTML =
      '<p style="padding:2rem;color:var(--color-text-muted)">Could not load projects. Please try refreshing.</p>';
    return;
  }

  _allProjects = projects;

  const visibleProjects = projects.filter(p => p.label === 'green');

  // Initialize project list
  initProjectList(visibleProjects, { onExpand: handleProjectExpand });

  // Restore scroll position if returning from a project page
  maybeRestoreScroll();

  // Initialize lightbox
  initLightbox();

  // Initialize 3D/2D visualization
  initVisualization(visibleProjects);
}

// ─── Hero visualization ───────────────────────────────────────────────────────
async function initVisualization(projects) {
  const canvasEl = document.getElementById('three-canvas');
  const scatter2d = document.getElementById('scatter-2d');

  const hasWebGL = (function () {
    try {
      const canvas = document.createElement('canvas');
      return !!(
        window.WebGLRenderingContext &&
        (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
      );
    } catch {
      return false;
    }
  })();

  const isDesktop = window.innerWidth >= 768;
  const hasPower = navigator.hardwareConcurrency > 2;

  if (hasWebGL) {
    try {
      const { initThreeScene } = await import('./three-scene.js');
      initThreeScene(projects, { onProjectClick: handleProjectClick });
    } catch (err) {
      console.warn('Three.js init failed, falling back to 2D:', err);
      initMobileThumbnailGrid(projects, scatter2d);
    }
  } else {
    canvasEl.style.display = 'none';
    scatter2d.style.display = 'block';
    initMobileThumbnailGrid(projects, scatter2d);
  }
}

// ─── 2D SVG scatter with thumbnail rectangles (mobile / no-WebGL fallback) ────
function initMobileThumbnailGrid(projects, container) {
  const W = container.offsetWidth  || 400;
  const H = container.offsetHeight || 500;
  const PAD = 48;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('aria-hidden', 'true');

  const bg = document.createElementNS(svgNS, 'rect');
  bg.setAttribute('width', W); bg.setAttribute('height', H);
  bg.setAttribute('fill', '#F5F1E6');
  svg.appendChild(bg);

  // <defs> for clip paths
  const defs = document.createElementNS(svgNS, 'defs');
  svg.appendChild(defs);

  // Grid axis lines
  function line(x1, y1, x2, y2) {
    const l = document.createElementNS(svgNS, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('stroke', '#CEC6B4'); l.setAttribute('stroke-width', '0.8');
    return l;
  }
  svg.appendChild(line(PAD, H / 2, W - PAD, H / 2));
  svg.appendChild(line(W / 2, PAD, W / 2, H - PAD));

  // Axis labels
  function axisLabel(x, y, text, anchor = 'middle') {
    const t = document.createElementNS(svgNS, 'text');
    t.setAttribute('x', x); t.setAttribute('y', y);
    t.setAttribute('text-anchor', anchor);
    t.setAttribute('font-family', 'DM Mono, monospace');
    t.setAttribute('font-size', '9'); t.setAttribute('fill', '#8A8078');
    t.setAttribute('letter-spacing', '1');
    t.textContent = text.toUpperCase();
    return t;
  }
  svg.appendChild(axisLabel(W / 2, PAD - 10, 'Institutional'));
  svg.appendChild(axisLabel(W / 2, H - PAD + 16, 'Individual'));
  svg.appendChild(axisLabel(PAD - 4, H / 2 - 4, 'Poetic', 'end'));
  svg.appendChild(axisLabel(W - PAD + 4, H / 2 - 4, 'Pragmatic', 'start'));

  // Thumbnail rectangles — size scales with year (newer = bigger)
  const minYear = 2016, maxYear = 2026;
  const TW_MIN = 32, TW_MAX = 56; // px width range
  const RATIO = 16 / 10;

  // Render oldest first so newer (larger) appear on top
  const sorted = [...projects].sort((a, b) => (a.year || 2020) - (b.year || 2020));

  sorted.forEach(p => {
    const cx = PAD + (p.axes?.pragmatic ?? 0.5) * (W - PAD * 2);
    const cy = (H - PAD) - (p.axes?.institutional ?? 0.5) * (H - PAD * 2);
    const t = Math.max(0, Math.min(1, ((p.year || 2022) - minYear) / (maxYear - minYear)));
    const tw = TW_MIN + t * (TW_MAX - TW_MIN);
    const th = tw / RATIO;

    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('cursor', 'pointer');
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', '0');
    g.setAttribute('aria-label', `${p.title} (${p.year})`);

    const rx = cx - tw / 2, ry = cy - th / 2;

    if (p.thumbnail) {
      const clipId = `cp-${p.id}`;
      const cp = document.createElementNS(svgNS, 'clipPath');
      cp.setAttribute('id', clipId);
      const cr = document.createElementNS(svgNS, 'rect');
      cr.setAttribute('x', rx); cr.setAttribute('y', ry);
      cr.setAttribute('width', tw); cr.setAttribute('height', th);
      cr.setAttribute('rx', '2');
      cp.appendChild(cr);
      defs.appendChild(cp);

      const img = document.createElementNS(svgNS, 'image');
      img.setAttribute('href', p.thumbnail);
      img.setAttribute('x', rx); img.setAttribute('y', ry);
      img.setAttribute('width', tw); img.setAttribute('height', th);
      img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      img.setAttribute('clip-path', `url(#${clipId})`);
      g.appendChild(img);
    }

    // Border / fallback fill
    const border = document.createElementNS(svgNS, 'rect');
    border.setAttribute('x', rx); border.setAttribute('y', ry);
    border.setAttribute('width', tw); border.setAttribute('height', th);
    border.setAttribute('rx', '2');
    border.setAttribute('fill', p.thumbnail ? 'none' : (p.featured ? '#5578A0' : '#CEC6B4'));
    border.setAttribute('stroke', p.featured ? '#5578A0' : '#CEC6B4');
    border.setAttribute('stroke-width', p.featured ? '1.5' : '0.8');
    g.appendChild(border);

    const title = document.createElementNS(svgNS, 'title');
    title.textContent = `${p.title} (${p.year})`;
    g.appendChild(title);

    g.addEventListener('click', () => handleProjectClick(p.id));
    g.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') handleProjectClick(p.id);
    });
    g.addEventListener('mouseenter', () => border.setAttribute('stroke', '#5578A0'));
    g.addEventListener('mouseleave', () => border.setAttribute('stroke', p.featured ? '#5578A0' : '#CEC6B4'));

    svg.appendChild(g);
  });

  container.appendChild(svg);
}

// ─── Project preview modal ────────────────────────────────────────────────────
let _modalCache = {};

function handleProjectClick(id) {
  openProjectModal(id);
}

async function openProjectModal(id) {
  const modal    = document.getElementById('project-modal');
  const inner    = document.getElementById('project-modal-inner');
  const content  = document.getElementById('project-modal-content');
  const closeBtn = document.getElementById('project-modal-close');
  if (!modal || !content) return;

  // Inject thumbnail immediately from master list (no fetch needed)
  const masterProject = _allProjects.find(p => p.id === id);
  setModalThumb(inner, masterProject?.thumbnail || null);

  // Show skeleton for text content
  content.innerHTML = `
    <div class="detail-inner">
      <div class="skeleton skeleton-line w-1/2" style="height:22px;margin-bottom:8px;"></div>
      <div class="skeleton skeleton-line w-full"></div>
      <div class="skeleton skeleton-line w-3/4"></div>
    </div>`;
  modal.setAttribute('aria-hidden', 'false');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Fetch detail data
  let detail = _modalCache[id];
  if (!detail) {
    try {
      const res = await fetch(`data/projects/${id}.json`);
      detail = res.ok ? await res.json() : masterProject || { id };
    } catch {
      detail = masterProject || { id };
    }
    _modalCache[id] = detail;
  }

  const merged = Object.assign({}, detail, {
    title: masterProject?.title || detail.title,
    tagline: masterProject?.tagline || detail.tagline,
    thumbnail: masterProject?.thumbnail || detail.thumbnail,
  });
  content.innerHTML = buildDetailContent(merged, { showHeader: true });

  // Close handlers
  closeBtn.onclick = closeProjectModal;
  modal.onclick = e => { if (e.target === modal) closeProjectModal(); };
}

function setModalThumb(inner, src) {
  const existing = inner.querySelector('.modal-thumb');
  if (src) {
    if (existing) {
      existing.src = src;
    } else {
      const img = document.createElement('img');
      img.className = 'modal-thumb';
      img.alt = '';
      img.src = src;
      inner.insertBefore(img, inner.querySelector('#project-modal-content'));
    }
  } else {
    existing?.remove();
  }
}

function closeProjectModal() {
  const modal = document.getElementById('project-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeProjectModal();
});

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let _allProjects = [];

function handleProjectExpand(id) {
  console.debug('Project expanded:', id);
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function setupNav() {
  const nav = document.getElementById('main-nav');
  const hamburger = document.getElementById('nav-hamburger');
  const drawer = document.getElementById('nav-drawer');

  // Email button
  const emailBtn = document.getElementById('nav-email-btn');
  if (emailBtn) {
    emailBtn.addEventListener('click', () => {
      window.location.href = 'mailto:' + email;
    });
  }

  // Drawer email button
  const drawerEmailBtn = document.getElementById('drawer-email-btn');
  if (drawerEmailBtn) {
    drawerEmailBtn.addEventListener('click', () => {
      window.location.href = 'mailto:' + email;
    });
  }

  // Hamburger toggle
  if (hamburger && drawer) {
    hamburger.addEventListener('click', () => {
      const isOpen = drawer.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      hamburger.textContent = isOpen ? '✕' : '☰';
    });

    // Close drawer on link click
    drawer.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        drawer.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
        hamburger.textContent = '☰';
      });
    });

    // Close drawer on outside click
    document.addEventListener('click', e => {
      if (!drawer.contains(e.target) && !hamburger.contains(e.target)) {
        drawer.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
        hamburger.textContent = '☰';
      }
    });
  }

  // Scroll behavior
  function onScroll() {
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 40);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Drawer work link: close and scroll
  const drawerWork = document.getElementById('drawer-work');
  if (drawerWork) {
    drawerWork.addEventListener('click', e => {
      e.preventDefault();
      if (drawer) drawer.classList.remove('open');
      if (hamburger) hamburger.textContent = '☰';
      document.getElementById('work')?.scrollIntoView({ behavior: 'smooth' });
    });
  }
}

function setupFooter() {
  const hint = document.getElementById('footer-email-hint');
  if (hint) {
    hint.textContent = emailParts[0] + ' [at] ' + emailParts[1];
  }
}

// ─── Start ───────────────────────────────────────────────────────────────────
boot();
