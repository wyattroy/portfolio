/**
 * project-list.js — Project grid rendering, filtering, sorting, and card expansion
 */

// ─── State ────────────────────────────────────────────────────────────────────
let allProjects = [];
let filteredProjects = [];
let activeTag = 'all';
let searchQuery = '';
let sortMode = 'year-desc';
let detailCache = {}; // id → fetched detail data
const PAGE_SIZE = 10;
let renderedCount = 0;
let _scrollObserver = null; // kept for API compat, unused
let _columns = [];          // masonry column elements
let _scrollHandler = null;  // scroll listener for lazy loading
let _lastNumCols = 0;

function getNumCols() {
  if (window.innerWidth >= 1024) return 3;
  if (window.innerWidth >= 640) return 2;
  return 1;
}

// Re-render grid when breakpoint changes
let _resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    const n = getNumCols();
    if (n !== _lastNumCols) renderGrid();
  }, 200);
});

// ─── Init ─────────────────────────────────────────────────────────────────────
export function initProjectList(projects, { onExpand } = {}) {
  allProjects = projects;

  buildTagChips();
  applyFilters();

  // Search
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      searchQuery = e.target.value.trim().toLowerCase();
      applyFilters();
    });
  }

  // Sort
  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', e => {
      sortMode = e.target.value;
      applyFilters();
    });
  }
}

// ─── Tag Chips ────────────────────────────────────────────────────────────────
function buildTagChips() {
  const container = document.getElementById('tag-filters');
  if (!container) return;

  const categorySet = new Set();
  allProjects.forEach(p => {
    (p.categories || []).forEach(c => categorySet.add(c));
  });

  // Use categories as primary filter chips (cleaner UX)
  const filterGroups = ['All', ...Array.from(categorySet).sort()];

  container.innerHTML = '';
  filterGroups.forEach(tag => {
    const btn = document.createElement('button');
    btn.className = 'tag-chip' + (tag === 'All' ? ' active' : '');
    btn.dataset.tag = tag === 'All' ? 'all' : tag;
    btn.textContent = tag;
    btn.addEventListener('click', () => {
      activeTag = btn.dataset.tag;
      container.querySelectorAll('.tag-chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      applyFilters();
    });
    container.appendChild(btn);
  });
}

// ─── Filter + Sort + Render ───────────────────────────────────────────────────
function applyFilters() {
  let result = allProjects.slice();

  // Tag / category filter
  if (activeTag !== 'all') {
    result = result.filter(p =>
      (p.categories || []).some(c => c === activeTag)
    );
  }

  // Fuzzy search
  if (searchQuery) {
    result = result.filter(p => fuzzyMatch(p, searchQuery));
  }

  // Sort
  result = sortProjects(result, sortMode);

  filteredProjects = result;
  renderGrid();
}

function fuzzyMatch(project, query) {
  const haystack = [
    project.title,
    project.tagline,
    project.description,
    ...(project.categories || []),
    String(project.year),
  ].join(' ').toLowerCase();
  return haystack.includes(query);
}

function hasContent(p) {
  return !!(p.thumbnail || p.description || p.tagline || p.what);
}

function sortProjects(projects, mode) {
  return [...projects].sort((a, b) => {
    // Projects with no content sink to the bottom regardless of sort mode
    const aHas = hasContent(a) ? 0 : 1;
    const bHas = hasContent(b) ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;

    if (mode === 'year-desc') {
      if (b.year !== a.year) return b.year - a.year;
      return (b.month || 0) - (a.month || 0);
    }
    if (mode === 'year-asc') {
      if (a.year !== b.year) return a.year - b.year;
      return (a.month || 0) - (b.month || 0);
    }
    if (mode === 'alpha') {
      return a.title.localeCompare(b.title);
    }
    return 0;
  });
}

// ─── Grid rendering ───────────────────────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('project-grid');
  if (!grid) return;

  // Tear down previous lazy-load listener
  if (_scrollHandler) {
    window.removeEventListener('scroll', _scrollHandler, { passive: true });
    _scrollHandler = null;
  }

  const numCols = getNumCols();
  _lastNumCols = numCols;

  if (filteredProjects.length === 0) {
    grid.innerHTML = `<div class="no-results"><h3>No projects found</h3><p>Try adjusting your search or filter.</p></div>`;
    _columns = [];
    return;
  }

  // Build column containers
  grid.innerHTML = '';
  _columns = Array.from({ length: numCols }, () => {
    const col = document.createElement('div');
    col.className = 'project-grid-col';
    grid.appendChild(col);
    return col;
  });

  renderedCount = 0;
  renderNextPage();
}

function shortestCol() {
  // Pick the column with the smallest rendered height
  return _columns.reduce(
    (min, col) => col.offsetHeight <= min.offsetHeight ? col : min,
    _columns[0]
  );
}

function renderNextPage() {
  if (!_columns.length) return;
  const batch = filteredProjects.slice(renderedCount, renderedCount + PAGE_SIZE);
  batch.forEach(project => {
    shortestCol().appendChild(buildCard(project));
  });
  renderedCount += batch.length;

  // Wire up scroll listener for next batch
  if (renderedCount < filteredProjects.length) {
    _scrollHandler = () => {
      const grid = document.getElementById('project-grid');
      if (!grid) return;
      const bottom = grid.getBoundingClientRect().bottom;
      if (bottom < window.innerHeight + 600) {
        window.removeEventListener('scroll', _scrollHandler, { passive: true });
        _scrollHandler = null;
        renderNextPage();
      }
    };
    window.addEventListener('scroll', _scrollHandler, { passive: true });
  }
}

// ─── Card builder ─────────────────────────────────────────────────────────────
function buildCard(project) {
  const card = document.createElement('article');
  // Cards start in expanded state — no toggle needed
  card.className = 'project-card expanded' +
    (project.featured ? ' featured' : '') +
    (project.status === 'book' ? ' status-book' : '');
  card.dataset.id = project.id;
  card.setAttribute('role', 'listitem');

  // Thumbnail
  const icon = categoryIcon(project.categories);
  let thumbHtml;
  const projectUrl = `project.html#${escHtml(project.id)}`;
  if (project.thumbnail) {
    thumbHtml = `<a href="${projectUrl}" class="card-thumb-link card-thumb-wrap">
      <img
        class="card-thumb"
        src="${project.thumbnail}"
        alt="${escHtml(project.title)} project thumbnail"
        loading="${project.featured ? 'eager' : 'lazy'}"
        onerror="this.parentElement.innerHTML='<div class=\\'card-thumb-placeholder\\'>${icon}</div>'"
      >
    </a>`;
  } else {
    thumbHtml = `<a href="${projectUrl}" class="card-thumb-link card-thumb-wrap"><div class="card-thumb-placeholder" aria-hidden="true">${icon}</div></a>`;
  }

  const quadrantSvg = buildQuadrantSvg(project.axes);

  const MEDIUM_COLORS = {
    'VR':           '#6B3FA6',
    'Film':         '#A03030',
    'Pedagogy':     '#B07030',
    'Web':          '#2B6BAE',
    'Fabrication':  '#8C5523',
    'Narrative':    '#2A7A8A',
    'Research':     '#5A7080',
    'App':          '#2A7A5A',
    'Performance':  '#9A3070',
    'Installation': '#7A6030',
    'Design':       '#4A3A7A',
  };
  let badges = '';
  if (project.medium && MEDIUM_COLORS[project.medium]) {
    badges += `<span class="medium-badge" style="background:${MEDIUM_COLORS[project.medium]}">${escHtml(project.medium)}</span>`;
  }
  if (project.status === 'book') badges += `<span class="status-badge">Book</span>`;

  // Render detail content inline using base project data (no fetch needed for preview)
  const inlineDetail = buildDetailContent(project);

  card.innerHTML = `
    ${thumbHtml}
    <div class="card-body">
      <div class="card-meta">
        <span class="card-year">${project.year || ''}</span>
        ${quadrantSvg}
      </div>
      ${badges}
      <h3 class="card-title">${escHtml(project.title)}</h3>
      <p class="card-tagline">${escHtml(project.tagline || '')}</p>

      <div class="card-expanded-content" id="expanded-${project.id}" data-rendered="true">
        ${inlineDetail}
      </div>
    </div>`;

  // Fetch full detail data in background and upgrade if richer data exists
  if (!(project.id in detailCache)) {
    fetch(`data/projects/${project.id}.json`)
      .then(r => r.ok ? r.json() : null)
      .then(detail => {
        if (!detail) return;
        detailCache[project.id] = detail;
        const contentEl = card.querySelector(`#expanded-${project.id}`);
        if (contentEl) {
          contentEl.innerHTML = buildDetailContent(detail);
          wireCardContent(contentEl);
        }
      })
      .catch(() => {});
  }

  wireCardContent(card.querySelector(`#expanded-${project.id}`));
  return card;
}

function wireCardContent(contentEl) {
  if (!contentEl) return;
  contentEl.querySelectorAll('.video-placeholder').forEach(placeholder => {
    placeholder.addEventListener('click', () => {
      const src = placeholder.dataset.src;
      if (!src) return;
      const iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.allow = 'autoplay; fullscreen; picture-in-picture';
      iframe.allowFullscreen = true;
      iframe.style.cssText = 'width:100%;height:100%;border:none;';
      placeholder.replaceWith(iframe);
    });
  });
  const images = Array.from(contentEl.querySelectorAll('.detail-image img'));
  images.forEach((img, idx) => {
    img.parentElement.addEventListener('click', () => {
      openLightbox(images.map(i => ({ src: i.src, alt: i.alt })), idx);
    });
  });
}


// ─── Detail content HTML (preview: 100-word description + 2 images + More) ────
export function buildDetailContent(project, { showHeader = false } = {}) {
  const images = project.images || [];
  const videos = project.videos || [];

  // Build 100-word preview text from what → description → tagline
  // `what` may be an array of rich content blocks — extract text items
  let fullText;
  if (Array.isArray(project.what)) {
    fullText = project.what
      .filter(item => item.type === 'text')
      .map(item => item.content || '')
      .join(' ');
  } else {
    fullText = project.what || project.description || project.tagline || '';
  }
  const words = fullText.trim().split(/\s+/);
  const preview = words.slice(0, 100).join(' ') + (words.length > 100 ? '…' : '');

  const videoIndicator = videos.length > 0
    ? `<span class="preview-has-video">▶ Video available</span>`
    : '';

  const awardsCount = (project.awards || []).length;
  const awardsBadge = awardsCount > 0
    ? `<span class="preview-awards">${awardsCount} award${awardsCount > 1 ? 's' : ''}</span>`
    : '';

  return `
    <div class="detail-inner preview-mode">
      ${showHeader ? `<h3 class="card-title">${escHtml(project.title || '')}</h3>` : ''}
      ${showHeader && project.tagline ? `<p class="card-tagline">${escHtml(project.tagline)}</p>` : ''}
      ${preview ? `<p class="preview-description">${escHtml(preview)}</p>` : ''}
      <div class="preview-footer">
        <div class="preview-badges">${videoIndicator}${awardsBadge}</div>
        <a href="project.html#${escHtml(project.id)}" class="cta-btn primary more-btn">
          More →
        </a>
      </div>
    </div>`;
}

function buildSkeleton() {
  return `
    <div class="detail-inner">
      <div class="skeleton skeleton-block"></div>
      <div class="skeleton skeleton-line w-3/4" style="height:20px;margin:16px 0 8px;"></div>
      <div class="skeleton skeleton-line w-full"></div>
      <div class="skeleton skeleton-line w-full"></div>
      <div class="skeleton skeleton-line w-1/2"></div>
    </div>`;
}

// ─── External entry point (kept for API compatibility) ────────────────────────
export function expandProject(id) {
  // Cards are always expanded; highlight to draw attention
  const card = document.querySelector(`[data-id="${id}"]`);
  if (!card) return;
  card.classList.remove('card-highlight');
  void card.offsetWidth;
  card.classList.add('card-highlight');
  setTimeout(() => card.classList.remove('card-highlight'), 2200);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatText(text) {
  if (!text) return '';
  text = text.replace(/\r\n/g, '\n');
  const re = /\*\*([\s\S]+?)\*\*|\*([\s\S]+?)\*|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/\S+)/g;
  const tokens = [];
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: 'plain', text: text.slice(last, m.index) });
    if (m[1] !== undefined)      tokens.push({ type: 'strong', text: m[1] });
    else if (m[2] !== undefined) tokens.push({ type: 'em',     text: m[2] });
    else if (m[3] !== undefined) tokens.push({ type: 'link',   text: m[3], href: m[4] });
    else                         tokens.push({ type: 'link',   text: m[5], href: m[5] });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ type: 'plain', text: text.slice(last) });

  const paras = [''];
  for (const tok of tokens) {
    if (tok.type === 'plain') {
      const segs = tok.text.split(/\n\n+/);
      paras[paras.length - 1] += escHtml(segs[0]);
      for (let i = 1; i < segs.length; i++) paras.push(escHtml(segs[i]));
    } else if (tok.type === 'strong') {
      paras[paras.length - 1] += `<strong>${escHtml(tok.text.replace(/\n+/g, ' ').trim())}</strong>`;
    } else if (tok.type === 'em') {
      paras[paras.length - 1] += `<em>${escHtml(tok.text.replace(/\n+/g, ' ').trim())}</em>`;
    } else {
      paras[paras.length - 1] += `<a href="${escHtml(tok.href)}" target="_blank" rel="noopener noreferrer">${escHtml(tok.text)}</a>`;
    }
  }
  return paras.map(p => p.trim()).filter(Boolean).map(p => `<p>${p}</p>`).join('');
}

function vimeoEmbed(url) {
  // Convert vimeo.com/12345 → player.vimeo.com/video/12345?autoplay=1
  const match = url.match(/vimeo\.com\/(\d+)/);
  if (match) return `https://player.vimeo.com/video/${match[1]}?autoplay=1&color=5578A0`;
  // YouTube
  const ytMatch = url.match(/youtube\.com\/watch\?v=([^&]+)|youtu\.be\/([^?]+)/);
  if (ytMatch) {
    const id = ytMatch[1] || ytMatch[2];
    return `https://www.youtube.com/embed/${id}?autoplay=1`;
  }
  return url;
}

function categoryIcon(categories = []) {
  const icons = {
    'XR': '🥽',
    'Games': '🎮',
    'Art': '🎨',
    'Craft': '🏺',
    'Research': '🔍',
    'Education': '📚',
    'Tools': '🔧',
    'Web': '🌐',
    'Data Visualization': '📊',
    'Installation': '🏛',
    'Sound': '🎵',
    'Video': '📽',
    'Wearables': '⌚',
    'HCI': '🤝',
    'AI/ML': '🤖',
    'Fabrication': '⚙️',
    'Photography': '📷',
    'Writing': '✍️',
    'Design': '✏️',
    'Speculative Design': '🔮',
    'Creative Technology': '💡',
    'Accessibility': '♿',
    'Print': '🖨',
  };
  for (const cat of categories) {
    if (icons[cat]) return icons[cat];
  }
  return '◻';
}

function buildQuadrantSvg(axes) {
  if (!axes) {
    return `<svg class="quadrant-indicator" viewBox="0 0 20 20" aria-hidden="true">
      <rect width="20" height="20" rx="3" fill="#DDD5C4"/>
    </svg>`;
  }

  const { pragmatic = 0.5, institutional = 0.5 } = axes;

  // Determine quadrant
  const right = pragmatic >= 0.5;
  const top = institutional >= 0.5;

  // q-ip: poetic+individual (left+bottom) → pragmatic<0.5, institutional<0.5
  // q-ii: pragmatic+individual (right+bottom)
  // q-sp: poetic+institutional (left+top)
  // q-si: pragmatic+institutional (right+top)
  const quadColors = {
    tl: top && !right ? 'var(--color-q-sp)' : '#DDD5C4',
    tr: top && right ? 'var(--color-q-si)' : '#DDD5C4',
    bl: !top && !right ? 'var(--color-q-ip)' : '#DDD5C4',
    br: !top && right ? 'var(--color-q-ii)' : '#DDD5C4',
  };

  return `<svg class="quadrant-indicator" viewBox="0 0 20 20" aria-hidden="true" title="Quadrant: ${getQuadrantName(pragmatic, institutional)}">
    <rect x="1" y="1" width="8" height="8" rx="1.5" fill="${quadColors.tl}"/>
    <rect x="11" y="1" width="8" height="8" rx="1.5" fill="${quadColors.tr}"/>
    <rect x="1" y="11" width="8" height="8" rx="1.5" fill="${quadColors.bl}"/>
    <rect x="11" y="11" width="8" height="8" rx="1.5" fill="${quadColors.br}"/>
  </svg>`;
}

function getQuadrantName(pragmatic, institutional) {
  const p = pragmatic >= 0.5;
  const i = institutional >= 0.5;
  if (p && i) return 'Pragmatic + Institutional';
  if (!p && i) return 'Poetic + Institutional';
  if (p && !i) return 'Pragmatic + Individual';
  return 'Poetic + Individual';
}

// ─── Lightbox bridge ──────────────────────────────────────────────────────────
function openLightbox(images, startIndex) {
  // Imported from project-detail.js via event
  window.dispatchEvent(new CustomEvent('openLightbox', {
    detail: { images, index: startIndex }
  }));
}
