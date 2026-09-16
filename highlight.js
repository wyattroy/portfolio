/**
 * highlight.js — which projects deserve extra attention in the 3D graph.
 *
 * Every project gets an automatic score from how new it is and how in-depth
 * its page is. "New" means new on the site — counted from `published`, the date
 * the project page went live — not from when the project itself was made, so an
 * old project published today still gets its moment. The newness part decays
 * over time, so the ranking shifts on its own, with no rebuild needed. A manual override in the project
 * data beats the score either way:
 *
 *   featured: true   → always a hero, ranked first
 *   featured: false  → never highlighted
 *   (absent)         → the score decides
 *
 * This module only ranks. three-scene.js pulses the top few (topProjectIds).
 */

// ─── Tuning ───────────────────────────────────────────────────────────────────
const NEWNESS_HALF_LIFE_YEARS = 0.5; // newness halves every six months after publishing

// Depth signals are log-scaled and capped, so one very long page can't flatten
// everyone else. Caps sit near the 90th percentile of the real data (2026-09).
const WORDS_CAP  = 900;
const IMAGES_CAP = 15;
const VIDEOS_CAP = 2;

const WEIGHTS = {
  newness: 0.45,
  depth:   0.45,
  awards:  0.10,
  liveUrl: 0.05,
};
const DEPTH_WEIGHTS = { words: 0.50, images: 0.35, videos: 0.15 };

const HERO_MAX       = 5;    // featured projects count toward this
const ACCENT_MAX     = 8;
const ACCENT_MIN     = 0.55; // score floor for the accent tier
const HERO_MAX_RECENT = 3;   // at most this many auto-picked heroes published in the recent window
const RECENT_YEARS    = 2 / 12; // "recent" for that rule — published in the last two months

// ─── Word count ───────────────────────────────────────────────────────────────
// Sections (what / why / how) are either a plain string or a list of blocks;
// text blocks carry their words in `content`.
export function countWords(detail) {
  let words = 0;
  const count = str => (String(str).match(/\S+/g) || []).length;
  for (const key of ['what', 'why', 'how']) {
    const section = detail?.[key];
    if (typeof section === 'string') words += count(section);
    else if (Array.isArray(section)) {
      section.forEach(block => {
        if (typeof block === 'string') words += count(block);
        else if (block?.type === 'text' && block.content) words += count(block.content);
      });
    }
  }
  return words;
}

// ─── Score ────────────────────────────────────────────────────────────────────
function logCap(value, cap) {
  return Math.min(1, Math.log1p(Math.max(0, value)) / Math.log1p(cap));
}

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

// Years since the project page went live. Falls back to the project's own
// year/month for an entry that has no `published` date yet.
function publishedAgeYears(p, now) {
  if (p.published) {
    return Math.max(0, (now - new Date(p.published)) / MS_PER_YEAR);
  }
  const made = (p.year ?? now.getFullYear()) + ((p.month ?? 6) - 1) / 12;
  const current = now.getFullYear() + now.getMonth() / 12;
  return Math.max(0, current - made);
}

export function scoreProject(p, now = new Date()) {
  const newness = Math.pow(0.5, publishedAgeYears(p, now) / NEWNESS_HALF_LIFE_YEARS);
  const depth =
    DEPTH_WEIGHTS.words  * logCap(p.words ?? 0, WORDS_CAP) +
    DEPTH_WEIGHTS.images * logCap(p.images?.length ?? 0, IMAGES_CAP) +
    DEPTH_WEIGHTS.videos * Math.min(1, (p.videos?.length ?? 0) / VIDEOS_CAP);
  return (
    WEIGHTS.newness * newness +
    WEIGHTS.depth * depth +
    WEIGHTS.awards * (p.awards?.length ? 1 : 0) +
    WEIGHTS.liveUrl * (p.liveUrl ? 1 : 0)
  );
}

// Returns Map<id, { score, tier: 'hero' | 'accent' | null }>
export function rankProjects(projects, now = new Date()) {
  const scored = projects
    .map(p => ({ p, score: scoreProject(p, now) }))
    .sort((a, b) => b.score - a.score);
  const result = new Map(scored.map(({ p, score }) => [p.id, { score, tier: null }]));

  const heroes = scored.filter(s => s.p.featured === true).slice(0, HERO_MAX);
  let recent = 0;
  for (const s of scored) {
    if (heroes.length >= HERO_MAX) break;
    if (s.p.featured != null || heroes.includes(s)) continue;
    const isRecent = publishedAgeYears(s.p, now) < RECENT_YEARS;
    if (isRecent && recent >= HERO_MAX_RECENT) continue;
    if (isRecent) recent++;
    heroes.push(s);
  }
  heroes.forEach(s => { result.get(s.p.id).tier = 'hero'; });

  scored
    .filter(s => !heroes.includes(s) && s.p.featured !== false && s.score >= ACCENT_MIN)
    .slice(0, ACCENT_MAX)
    .forEach(s => { result.get(s.p.id).tier = 'accent'; });

  return result;
}

// The first `count` projects in rank order: featured ones first, then heroes by score
export function topProjectIds(projects, count, now = new Date()) {
  const ranked = [...rankProjects(projects, now)]
    .filter(([, v]) => v.tier === 'hero')
    .map(([id, v]) => ({ id, v, featured: projects.find(p => p.id === id)?.featured === true }))
    .sort((a, b) => (b.featured - a.featured) || (b.v.score - a.v.score));
  return new Set(ranked.slice(0, count).map(r => r.id));
}
