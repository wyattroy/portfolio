/**
 * search-suggestions.js — Text-only project autocomplete dropdown under the
 * nav search input. Shared by index.html (main.js) and project.html.
 */

const MAX_RESULTS = 8;

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function matchProjects(projects, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return projects
    .filter(p => p.label === 'green')
    .filter(p => {
      const haystack = [p.title, p.tagline, p.description, ...(p.categories || []), String(p.year || '')]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    })
    .slice(0, MAX_RESULTS);
}

export function initSearchSuggestions(projects, { onSelect, onSubmit } = {}) {
  const input = document.getElementById('search-input');
  const list = document.getElementById('search-suggestions');
  if (!input || !list) return;

  let matches = [];
  let activeIndex = -1;

  function renderMatches() {
    list.innerHTML = matches.map((p, i) => `
      <li class="search-suggestion" role="option" id="search-suggestion-${i}">
        ${escHtml(p.title)}${p.year ? `<span class="suggestion-year">${escHtml(String(p.year))}</span>` : ''}
      </li>`).join('');
  }

  function open(query) {
    matches = matchProjects(projects, query);
    activeIndex = -1;
    if (!matches.length) { close(); return; }
    renderMatches();
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.removeAttribute('aria-activedescendant');
  }

  function close() {
    list.hidden = true;
    list.innerHTML = '';
    matches = [];
    activeIndex = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function setActive(idx) {
    const items = list.children;
    if (activeIndex >= 0 && items[activeIndex]) items[activeIndex].classList.remove('active');
    activeIndex = idx;
    if (idx >= 0 && items[idx]) {
      items[idx].classList.add('active');
      items[idx].scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', items[idx].id);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function select(idx) {
    const project = matches[idx];
    if (!project) return;
    close();
    if (onSelect) onSelect(project);
  }

  input.addEventListener('input', () => open(input.value));
  input.addEventListener('focus', () => { if (input.value.trim()) open(input.value); });

  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      if (!matches.length) return;
      e.preventDefault();
      setActive((activeIndex + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      if (!matches.length) return;
      e.preventDefault();
      setActive((activeIndex - 1 + matches.length) % matches.length);
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0) {
        e.preventDefault();
        select(activeIndex);
      } else if (onSubmit) {
        onSubmit(input.value.trim());
      }
    } else if (e.key === 'Escape') {
      if (!list.hidden) {
        e.preventDefault();
        close();
      }
    }
  });

  // mousedown (not click) fires before the input's blur handler, so a
  // suggestion click registers before the list gets torn down.
  list.addEventListener('mousedown', e => {
    const li = e.target.closest('.search-suggestion');
    if (!li) return;
    e.preventDefault();
    select(Array.from(list.children).indexOf(li));
  });

  input.addEventListener('blur', () => {
    setTimeout(close, 100);
  });
}
