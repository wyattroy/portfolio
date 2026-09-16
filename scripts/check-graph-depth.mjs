#!/usr/bin/env node
/**
 * Fails when any two project tiles in the 3D graph could z-fight.
 *
 * Checks the positions graph-depth.js actually produces, for the projects the
 * homepage shows (label "green") and for every project (so publishing a draft
 * can't break it later):
 *   - every pair of tiles is at least MIN_Z_SEPARATION apart in depth
 *   - that separation is larger than a tile's own thickness
 *   - no tile was pushed further than MAX_Z_DISPLACEMENT from its real date
 *
 * Runs in CI (.github/workflows/check-graph.yml) and in .githooks/pre-commit.
 * Usage: npm run check:graph
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  projectDepths, timeZ, yearFraction,
  TILE_DEPTH, MIN_Z_SEPARATION, MAX_Z_DISPLACEMENT,
} from '../graph-depth.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const all = JSON.parse(await readFile(join(ROOT, 'data', 'projects.json'), 'utf8'));
const failures = [];

if (MIN_Z_SEPARATION <= TILE_DEPTH) {
  failures.push(`MIN_Z_SEPARATION (${MIN_Z_SEPARATION}) must be larger than TILE_DEPTH (${TILE_DEPTH})`);
}

function check(label, projects) {
  const ids = projects.map(p => p.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) failures.push(`${label}: duplicate project ids: ${[...new Set(dupes)].join(', ')}`);

  const depths = projectDepths(projects);
  const byDepth = projects
    .map(p => ({ p, z: depths.get(p.id) }))
    .sort((a, b) => a.z - b.z);

  let tightest = Infinity;
  let furthest = { d: 0, id: null };
  for (let i = 0; i < byDepth.length; i++) {
    const { p, z } = byDepth[i];
    if (!Number.isFinite(z)) failures.push(`${label}: ${p.id} has no valid depth`);
    const moved = Math.abs(z - timeZ(yearFraction(p)));
    if (moved > furthest.d) furthest = { d: moved, id: p.id };
    if (i === 0) continue;
    const gap = z - byDepth[i - 1].z;
    tightest = Math.min(tightest, gap);
    if (gap < MIN_Z_SEPARATION - 1e-9) {
      failures.push(`${label}: ${byDepth[i - 1].p.id} and ${p.id} are only ${gap.toFixed(4)} apart (need ${MIN_Z_SEPARATION})`);
    }
  }
  if (furthest.d > MAX_Z_DISPLACEMENT + 1e-9) {
    failures.push(`${label}: ${furthest.id} was pushed ${furthest.d.toFixed(3)} from its date (limit ${MAX_Z_DISPLACEMENT.toFixed(3)})`);
  }
  console.log(`${label}: ${projects.length} tiles, tightest gap ${tightest.toFixed(3)}, largest nudge ${furthest.d.toFixed(3)} (${furthest.id ?? 'none'})`);
}

check('homepage', all.filter(p => p.label === 'green'));
check('all projects', all);

if (failures.length) {
  console.error('\nGraph depth check failed — tiles could z-fight:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('Graph depth check passed.');
