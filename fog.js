/**
 * fog.js — tiles fade toward the background as they recede into the past.
 *
 * Uses three.js's built-in linear fog, re-aimed every frame relative to the
 * graph rather than to the camera, so the look holds at any zoom: fog begins
 * `startYears` behind the newest project and reaches `strength` at the oldest.
 * The "Bounce & Fog Tuner" artifact runs this same code and exports FOG.
 */

export const FOG = {
  startYears: 1.5,     // how far behind the newest project the fog begins, in years
  strength: 0.6,       // how faded the oldest project is (0 = no fog, 1 = gone into the background)
  color: '#FFFFFF',    // what tiles fade toward; keep it the page background unless you want a tint
};

// depthNewest / depthOldest: camera-forward distance to the newest and oldest
// tiles. unitsPerYear: time-axis world units per year.
export function updateFog(fog, cfg, depthNewest, depthOldest, unitsPerYear) {
  const near = Math.max(0.1, depthNewest + cfg.startYears * unitsPerYear);
  const span = Math.max(0.001, depthOldest - near);
  fog.near = near;
  fog.far = cfg.strength > 0.001 ? near + span / Math.min(1, cfg.strength) : 1e9;
  fog.color.set(cfg.color);
}
