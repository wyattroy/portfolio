/**
 * graph-depth.js — where each project tile sits along the 3D graph's time (Z) axis.
 *
 * Two tiles at the same depth z-fight wherever they overlap on screen: the GPU
 * can't tell which face is in front, so the thumbnails flicker through each
 * other. Projects from the same year and month used to land on exactly the same
 * depth, and once tiles grew and stretched to fill the window, those overlaps
 * started showing.
 *
 * So depth is guaranteed here, in code, rather than by keeping the data tidy:
 * every tile is at least MIN_Z_SEPARATION from its neighbours, which is more than
 * a tile's own thickness. Tiles that share a date are fanned out as little as
 * possible around it (a least-squares fit, so the timeline stays honest).
 *
 * Used by three-scene.js to place tiles, and by scripts/check-graph-depth.mjs,
 * which CI and the pre-commit hook run to catch a change that breaks the rule.
 * Plain JS with no dependencies, so it runs in the browser and in Node.
 */

export const YEAR_MIN = 2015;
export const YEAR_MAX = 2027;
export const Z_FAR  = 0;   // YEAR_MIN end — sits at the camera target
export const Z_NEAR = 40;  // YEAR_MAX end; every year gets the same depth

// A tile is a thin box. Its depth is fixed in world units (tiles scale in X/Y
// only), so front and back faces of neighbouring tiles can never interleave.
export const TILE_DEPTH = 0.05;

// Gap between tile centres. Must exceed TILE_DEPTH, plus headroom for depth-
// buffer precision at the far end of the graph (about 0.002 units at 54 units
// from the camera with the scene's 0.1 near plane).
export const MIN_Z_SEPARATION = 0.12;

// Largest distance a tile may be pushed from its true date to make room.
// About two months of timeline; the check fails past it, which means the
// separation is too big for how many projects share a stretch of time.
export const MAX_Z_DISPLACEMENT = 40 / (YEAR_MAX - YEAR_MIN) / 6;

export function yearFraction(p) {
  return (p.year ?? 2022) + ((p.month ?? 6) - 1) / 12; // Jan = .0, Dec ≈ .92
}

// Depth for a fractional year (2024.5 = mid-2024), before any separation.
export function timeZ(yearFrac) {
  const t = Math.max(0, Math.min(1, (yearFrac - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)));
  return Z_FAR + t * (Z_NEAR - Z_FAR);
}

/**
 * Returns Map<id, z> with every pair of tiles at least MIN_Z_SEPARATION apart.
 *
 * Sort by date (ties broken by id, so the order is stable across loads), then
 * find the positions closest to each tile's true depth subject to
 * z[i+1] − z[i] ≥ MIN_Z_SEPARATION. Subtracting i·MIN turns that into a plain
 * "non-decreasing" constraint, which pool-adjacent-violators solves exactly.
 */
export function projectDepths(projects) {
  const sorted = [...projects].sort((a, b) =>
    yearFraction(a) - yearFraction(b) || String(a.id).localeCompare(String(b.id))
  );
  const shifted = sorted.map((p, i) => timeZ(yearFraction(p)) - i * MIN_Z_SEPARATION);

  // Pool adjacent violators: blocks of { sum, count } whose means never decrease
  const blocks = [];
  for (const v of shifted) {
    blocks.push({ sum: v, count: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.sum / a.count <= b.sum / b.count) break;
      blocks.splice(-2, 2, { sum: a.sum + b.sum, count: a.count + b.count });
    }
  }

  const depths = new Map();
  let i = 0;
  for (const { sum, count } of blocks) {
    const mean = sum / count;
    for (let k = 0; k < count; k++, i++) {
      depths.set(sorted[i].id, mean + i * MIN_Z_SEPARATION);
    }
  }
  return depths;
}
