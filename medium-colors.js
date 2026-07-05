/**
 * medium-colors.js — Shared color map for project medium/category badges.
 * Used by both the Work grid (project-list.js) and individual project pages (project.html).
 */

export const MEDIUM_COLORS = {
  'VR':           '#7847B2',
  'Pedagogy':     '#C85C1A',
  'Web':          '#1D7373',
  'Fabrication':  '#C49A10',
  'Narrative':    '#9A3070',
  'App':          '#2E7856',
};

export function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function mediumBadgeStyle(hex) {
  return `color:${hex};background:${hexToRgba(hex, 0.08)};border:1px solid ${hex}`;
}
