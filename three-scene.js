/**
 * three-scene.js — 3D project visualization using Three.js r160
 *
 * To use locally: download three.module.js to vendor/ and update the import below.
 * Falls back gracefully if load fails (handled in main.js).
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { topProjectIds } from './highlight.js';
import { PULSE, buildPulseTextures, attachPulse, updatePulse } from './pulse.js';
// Time-axis depth lives in its own module so CI can check that no two tiles
// share a depth (z-fighting) — see graph-depth.js and scripts/check-graph-depth.mjs
import { projectDepths, timeZ, yearFraction, TILE_DEPTH } from './graph-depth.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const AXIS_RANGE = 5; // ±5 units — axis-line length and label anchors only; tile spread comes from the fill layout below

// ─── Fill layout ─────────────────────────────────────────────────────────────
// Tile X/Y positions stretch to the canvas's aspect ratio so the fully
// zoomed-out view fills the window, and re-flow whenever the window resizes.
// FILL_FRAC: how far toward the edges the outermost tiles sit (1 = at the edge).
// FILL_PERSPECTIVE: 1 = pure 3D perspective (older, farther years cluster in the
// middle); 0 = every year spreads edge to edge on screen. In between keeps depth
// legible while old projects still use the space.
const FILL_FRAC        = 0.86;
const FILL_PERSPECTIVE = 0.45;

// ─── Tile size & hover ──────────────────────────────────────────────────────
// Tiles are sized to the window: together they cover TILE_COVERAGE of the
// canvas area in the fully zoomed-out view, so a bigger window means bigger
// tiles and the gaps between them stay small. A tile shrinks with depth in step
// with its year's spread (see FILL_PERSPECTIVE), so older years still read as
// farther away. Re-computed on every resize.
const TILE_COVERAGE     = 0.45; // share of the canvas covered by tiles (overlaps count twice)
const TILE_MAX_WIDTH_FR = 0.22; // no tile wider than this share of the canvas width

// Hover: tile grows to baseScale * TILE_HOVER_SCALE. Speed is a spring —
// higher stiffness = faster grow/shrink, higher damping = less bounce/overshoot.
const TILE_HOVER_SCALE      = 1.2;
const TILE_HOVER_STIFFNESS  = 1.0;
const TILE_HOVER_DAMPING    = 0.6;

// ─── Zoom tuning (camera distance driven by scroll / wheel / touch) ───────────
// Everything about how the 3D graph zooms is controlled from these consts —
// change these to adjust zoom range, speed, or springiness.
const ZOOM_MIN_DIST  = 10;   // closest the camera can get (max zoom-in) — newer tiles sit behind the camera here
const ZOOM_MAX_DIST  = 54;   // farthest the camera can get (max zoom-out) — must be > Z_NEAR
const ZOOM_LOAD_FRAC = 0.26; // 0 (max zoom-in) to 1 (max zoom-out) — where the page loads

// How much input is needed to go from min to max zoom. Lower = faster zoom.
const ZOOM_SPEED_PX          = window.innerHeight * 0.6; // scroll px for a full min→max zoom
const ZOOM_WHEEL_SPEED       = 1;   // multiplier on mouse wheel deltaY
const ZOOM_TOUCH_DRAG_SPEED  = 1.5; // multiplier on single-finger vertical swipe
const ZOOM_TOUCH_PINCH_SPEED = 2;   // multiplier on two-finger pinch distance change

// Zoom spring feel — higher stiffness = snappier response, higher damping = less bounce/overshoot
const ZOOM_STIFFNESS = 0.8;
const ZOOM_DAMPING   = 0.8;

const CAM_ZOOM_IN = new THREE.Vector3(0, 0.5, ZOOM_MIN_DIST);
const CAM_END     = new THREE.Vector3(0, 0.5, ZOOM_MAX_DIST);
const CAM_TARGET  = new THREE.Vector3(0, 0,  0); // world origin (oldest projects end)

// Z position of the "time" axis label (0 = oldest/far end, Z_NEAR = newest/close end)
const TIME_LABEL_Z = 4;

// Minimum combined rotation (radians) off the Z axis before the "time" label appears
const TIME_LABEL_ANGLE_THRESHOLD = (8 * Math.PI) / 180; // 8°

// Drag rotation limits (degrees converted to radians)
const DRAG_MAX_H = (45 * Math.PI) / 180; // horizontal
const DRAG_MAX_V = (45 * Math.PI) / 180; // vertical

// Minimum px from the canvas edge for clamped axis endpoint labels
const LABEL_MARGIN = 80;

// Drag spring feel — higher stiffness = snappier, higher damping = less bounce
const DRAG_STIFFNESS   = 0.8;
const DRAG_DAMPING     = 0.8;

// ─── Entry animation ──────────────────────────────────────────────────────────
const ENTRY_FADE_MS      = 500;  // how long each fade-in lasts (ms)
const ENTRY_SLIDE_PX     = 30;   // how far labels slide along their axis while fading in
const TIME_LABEL_LERP    = 0.08; // how fast the time label fades in/out (0=instant, 1=slow)

// Delay (ms) before each label fades in — adjust to re-sequence the reveal
const LABEL_REVEAL_MS = {
  'label-pragmatic':      1000,
  'label-poetic':         1000,
  'label-institutional':  2000,
  'label-individual':     2000,
};

const CARD_REVEAL_START_MS = 2500; // earliest the cards fade in (the zoom-out starts with them)
const TEXTURE_FADE_MS      = 220;  // crossfade for a thumbnail that arrives after the preload gave up

// ─── Preload ──────────────────────────────────────────────────────────────────
// Every thumbnail is fetched, decoded, cropped and uploaded to the GPU *before*
// the cards appear and the zoom-out starts, so the animation itself only moves
// a camera. On a slow connection the intro stops waiting after PRELOAD_MAX_MS;
// any thumbnail still missing crossfades in when it arrives.
const PRELOAD_MAX_MS        = 8000;
const GPU_UPLOADS_PER_FRAME = 4;   // spreads texture uploads so no single frame stalls

// ─── Intro zoom-out ───────────────────────────────────────────────────────────
// The page loads zoomed in, then pulls back to the full graph so visitors see
// how many projects there are. Plays every visit; the card reveal is squeezed
// to finish inside the same window.
const INTRO_ZOOM_MS         = 3000;
const INTRO_REPEAT_DELAY_MS = 400;  // repeat visits (no fade-in): short beat before the zoom
const SETTLE_DELAY_MS       = 300;  // pause after the zoom before announcing the graph has settled

// ─── Year filter ──────────────────────────────────────────────────────────────
const GHOST_OPACITY = 0.1;  // projects newer than the slider's year
const GHOST_LERP    = 0.12; // per-frame approach speed for the ghost fade

// ─── Spring state ─────────────────────────────────────────────────────────────
function makeSpring(initial = 0) {
  return { current: initial, target: initial, velocity: 0 };
}

function tickSpring(s, stiffness = 0.8, damping = 0.8) {
  s.velocity += (s.target - s.current) * stiffness;
  s.velocity *= 1 - damping;
  s.current += s.velocity;
  return s.current;
}

// ─── Main init ────────────────────────────────────────────────────────────────
export function initThreeScene(projects, { onProjectClick, onYearCutoffChange, onSettled } = {}) {
  const canvas = document.getElementById('three-canvas');
  const hoverLabel = document.getElementById('project-hover-label');
  const isMobile = window.innerWidth < 768;
  const effectiveLabelMargin = isMobile ? 44 : LABEL_MARGIN;
  // Top margin must clear the fixed nav bar (and its search input) so the
  // "Institutional" endpoint label never renders underneath it on mobile.
  const effectiveLabelMarginTop = isMobile ? 84 : LABEL_MARGIN;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Canvas size, cached. Reading offsetWidth/offsetHeight right after the render
  // loop writes label styles forces the browser to recompute layout, and the
  // loop does that dozens of times a frame — so read once here and on resize.
  let canvasW = canvas.offsetWidth;
  let canvasH = canvas.offsetHeight;

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#FFFFFF');

  // Renderer
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'default'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvasW, canvasH, false); // false = don't override CSS size

  // Camera
  const camera = new THREE.PerspectiveCamera(
    50,
    canvasW / canvasH,
    0.1,
    200
  );
  camera.position.copy(CAM_ZOOM_IN.clone().lerp(CAM_END, ZOOM_LOAD_FRAC));
  camera.lookAt(CAM_TARGET);

  // ─── Lighting ───────────────────────────────────────────────────────────────
  const ambientLight = new THREE.AmbientLight('#F5F5F3', 3.0);
  scene.add(ambientLight);

  // ─── Fill layout ────────────────────────────────────────────────────────────
  // Size the time (Z) axis to the actual project range, not the fixed
  // Z_FAR..Z_NEAR bounds — those are wider than the real data on both ends.
  const depths = projectDepths(projects); // unique per tile — no two share a depth
  const projectZs = projects.map(p => depths.get(p.id));
  const zDataMin = Math.min(...projectZs);
  const zDataMax = Math.max(...projectZs);
  const zPad = (zDataMax - zDataMin) * 0.1;

  // Half-width/half-height of the tile spread at depth z. Anchored so the newest
  // projects reach FILL_FRAC of the window from the fully zoomed-out camera;
  // FILL_PERSPECTIVE decides how much older, farther years also spread out.
  const FOV_TAN = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  function spreadAt(z) {
    const nearH = (ZOOM_MAX_DIST - zDataMax) * FOV_TAN;
    const hereH = (ZOOM_MAX_DIST - z) * FOV_TAN;
    const h = FILL_FRAC * nearH * Math.pow(hereH / nearH, 1 - FILL_PERSPECTIVE);
    // A canvas with no size yet (hidden tab or pane) reports a non-finite aspect;
    // fall back until the next resize re-runs the layout
    const aspect = Number.isFinite(camera.aspect) && camera.aspect > 0 ? camera.aspect : 16 / 9;
    return { w: h * aspect, h };
  }

  const gridGroup = new THREE.Group();
  scene.add(gridGroup);

  // ─── Year frames ────────────────────────────────────────────────────────────
  // A faint rectangle at each year's depth, labelled in its top-left corner.
  // Straight on they nest like a tunnel of picture frames; rotated, they read
  // as tick marks along the time axis.
  const axisLabelsEl = document.getElementById('axis-labels');
  const labelEls = Object.fromEntries(
    ['label-poetic', 'label-pragmatic', 'label-institutional', 'label-individual', 'label-time']
      .map(id => [id, document.getElementById(id)])
  );
  const yearFrames = [];
  const firstYear = Math.min(...projects.map(p => p.year ?? 2022));
  const lastYear  = Math.max(...projects.map(p => p.year ?? 2022));
  for (let year = firstYear; year <= lastYear; year++) {
    const mat = new THREE.LineBasicMaterial({ color: '#84827C', transparent: true, opacity: 0 });
    const line = new THREE.LineLoop(new THREE.BufferGeometry(), mat);
    line.position.z = timeZ(year + 0.5); // mid-year, so each year's tiles straddle their frame
    scene.add(line);
    const label = document.createElement('span');
    label.className = 'axis-year';
    label.textContent = String(year);
    axisLabelsEl?.appendChild(label);
    yearFrames.push({ year, line, mat, label, ghost: 1 });
  }
  const YEAR_FRAME_OPACITY = 0.28;

  // ─── Project prisms ─────────────────────────────────────────────────────────
  const prismMeshes = [];
  const meshToProject = new Map();

  // Each thumbnail becomes a small, pre-cropped canvas before it is a texture:
  // uploading a full-size image (plus its mipmaps) to the GPU is a multi-frame
  // stall, and the face only ever needs TEX_TARGET_W pixels.
  //
  // Decoding happens off the main thread: createImageBitmap on the fetched blob
  // where the browser supports it, img.decode() otherwise. Safari's decode() can
  // reject on some large/ICC-profiled JPEGs that render fine, so the last resort
  // is the plain load event.
  const TILE_FACE_AR = 1.6; // matches the tile face (1.6 : 1.0)
  // Sized for the closest a tile can appear on screen (hover + max zoom-in).
  // Phones get half: 52 tiles at 1024 px is ~180 MB of GPU memory with mipmaps.
  const TEX_TARGET_W = isMobile ? 512 : 1024;
  const TEX_TARGET_H = Math.round(TEX_TARGET_W / TILE_FACE_AR);

  function drawCropped(source, width, height) {
    const c = document.createElement('canvas');
    c.width = TEX_TARGET_W;
    c.height = TEX_TARGET_H;
    let sx, sy, sw, sh;
    if (width / height > TILE_FACE_AR) {
      // Source wider than face — keep full height, crop width
      sh = height; sw = sh * TILE_FACE_AR; sx = (width - sw) / 2; sy = 0;
    } else {
      // Source taller than face — keep full width, crop height
      sw = width; sh = sw / TILE_FACE_AR; sx = 0; sy = (height - sh) / 2;
    }
    c.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  async function buildTileCanvas(url) {
    if (typeof createImageBitmap === 'function') {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bitmap = await createImageBitmap(await res.blob());
        const c = drawCropped(bitmap, bitmap.width, bitmap.height);
        bitmap.close();
        return c;
      } catch { /* fall through to the <img> path */ }
    }
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      if (!(img.complete && img.naturalWidth)) {
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
      }
    }
    return drawCropped(img, img.naturalWidth, img.naturalHeight);
  }

  // Fade-in timing — skip on repeat visits
  const VISITED_KEY = 'wyattroy-visited';
  const skipEntry = !!localStorage.getItem(VISITED_KEY);
  localStorage.setItem(VISITED_KEY, '1');
  const sceneInitTime = performance.now();

  // Axis labels fade in on their own clock, from page load
  function labelOpacity(revealMs) {
    if (skipEntry) return 1;
    const elapsed = performance.now() - sceneInitTime - revealMs;
    if (elapsed <= 0) return 0;
    return Math.min(1, elapsed / ENTRY_FADE_MS);
  }

  // Cards fade in on the intro's clock, which only starts once the preload is done
  function cardOpacity(offsetMs) {
    if (skipEntry) return intro.startAt === Infinity ? 0 : 1;
    const elapsed = performance.now() - intro.startAt - offsetMs;
    if (!(elapsed > 0)) return 0;
    return Math.min(1, elapsed / ENTRY_FADE_MS);
  }

  // ─── Top-project pulse ──────────────────────────────────────────────────────
  // The top PULSE.count projects in highlight.js's ranking breathe a soft glow
  // behind their tiles. All tuning lives in pulse.js.
  const pulseIds = topProjectIds(projects, PULSE.count);
  const pulseRank = new Map([...pulseIds].map((id, i) => [id, i]));
  const pulseTextures = pulseIds.size ? buildPulseTextures(THREE, PULSE) : null;

  const projectsByAge = [...projects].sort((a, b) => depths.get(a.id) - depths.get(b.id));

  // One geometry for every tile. Its depth never scales (see layoutScene), which
  // is what lets graph-depth.js guarantee faces can't interleave.
  const tileGeometry = new THREE.BoxGeometry(1.6, 1.0, TILE_DEPTH);

  projectsByAge.forEach(p => {
    const z = depths.get(p.id); // oldest near the far end, newest near the camera
    const scale = 1; // real size comes from layoutScene()

    // All faces fade in together — per-mesh materials so opacity can animate per-tile.
    // Always `transparent`, even at full opacity: toggling it forces a shader
    // rebuild per material, which used to land as a hitch mid-animation.
    const initOp = 0; // hidden until the preload is done, on every visit
    const sideMat  = new THREE.MeshLambertMaterial({ color: '#D8D8D5', transparent: true, opacity: initOp });
    const frontMat = new THREE.MeshLambertMaterial({ color: '#EDEDEA', transparent: true, opacity: initOp });
    const materials = [sideMat, sideMat, sideMat, sideMat, frontMat, sideMat];

    const mesh = new THREE.Mesh(tileGeometry, materials);
    mesh.position.z = z; // X/Y come from layoutScene()
    mesh.scale.set(scale, scale, 1);
    // Force texture upload + shader compile at load time instead of deferring
    // until the tile first enters the camera frustum (which caused a jank
    // burst the first time a user zoomed out far enough to reveal ~30 tiles).
    mesh.frustumCulled = false;
    // Store original scale for spring animation
    mesh.userData.baseScale = scale;
    mesh.userData.scaleSpring = makeSpring(scale);
    mesh.userData.sideMat  = sideMat;
    mesh.userData.project = p;

    if (pulseIds.has(p.id)) {
      attachPulse(THREE, mesh, pulseTextures, PULSE, TILE_DEPTH, pulseRank.get(p.id) * PULSE.staggerMs);
    }
    mesh.userData.appliedOpacity = initOp;
    mesh.userData.textureFade = 1;   // 0→1 while a freshly loaded thumbnail crossfades in
    mesh.userData.ghost = 1;         // 1 = normal, GHOST_OPACITY = newer than the year slider
    mesh.userData.ghostTarget = 1;
    mesh.userData.yearFrac = yearFraction(p);
    // revealMs assigned after loop once prismMeshes index is known

    scene.add(mesh);
    prismMeshes.push(mesh);
    meshToProject.set(mesh, p);
  });

  // Assign staggered card reveal times now that we know the indices — oldest
  // first, spread so the newest finishes fading in as the intro zoom ends.
  const cardRevealStepMs = prismMeshes.length > 1
    ? Math.max(0, INTRO_ZOOM_MS - ENTRY_FADE_MS) / (prismMeshes.length - 1)
    : 0;
  prismMeshes.forEach((mesh, i) => {
    mesh.userData.revealMs = i * cardRevealStepMs; // offset from the intro's start
  });

  // Place tiles, year frames and grid for the current canvas aspect ratio.
  // Runs at init and on every resize, so the graph re-flows to fill the window.
  let hoveredMesh = null; // declared here: layoutScene() reads it at init
  let firstLayout = true;
  function layoutScene() {
    // Tile sizes. Each tile's on-screen width is k · r, where r is how much of
    // the screen its year's spread fills relative to the newest year, and k is
    // chosen so the tiles' total screen area hits TILE_COVERAGE.
    const layoutW = canvasW || window.innerWidth;
    const layoutH = canvasH || window.innerHeight;
    const nearSpreadFrac = spreadAt(zDataMax).h / ((ZOOM_MAX_DIST - zDataMax) * FOV_TAN);
    const ratios = prismMeshes.map(mesh => {
      const z = mesh.position.z;
      return (spreadAt(z).h / ((ZOOM_MAX_DIST - z) * FOV_TAN)) / nearSpreadFrac;
    });
    const sumSq = ratios.reduce((a, r) => a + r * r, 0) || 1;
    const k = Math.sqrt((TILE_COVERAGE * layoutW * layoutH * 1.6) / sumSq);

    prismMeshes.forEach((mesh, i) => {
      const p = mesh.userData.project;
      const z = mesh.position.z;
      const tilePx = Math.min(k * ratios[i], layoutW * TILE_MAX_WIDTH_FR);
      // px → world units at this depth, as seen from the zoomed-out camera
      const worldPerPx = (2 * (ZOOM_MAX_DIST - z) * FOV_TAN) / layoutH;
      const scale = (tilePx * worldPerPx) / 1.6;
      const ud = mesh.userData;
      ud.baseScale = scale;
      ud.scaleSpring.target = scale * (mesh === hoveredMesh ? TILE_HOVER_SCALE : 1);
      if (firstLayout) {
        ud.scaleSpring.current = ud.scaleSpring.target;
        mesh.scale.set(scale, scale, 1);
      }

      // Inset by half a tile so the outermost tiles' edges, not centers, reach the spread
      const { w, h } = spreadAt(z);
      const pragmatic = p.axes?.pragmatic ?? 0.5;
      const institutional = p.axes?.institutional ?? 0.5;
      mesh.position.x = (pragmatic - 0.5) * 2 * Math.max(0, w - 0.8 * scale);
      mesh.position.y = (institutional - 0.5) * 2 * Math.max(0, h - 0.5 * scale);
    });
    firstLayout = false;

    yearFrames.forEach(f => {
      const { w, h } = spreadAt(f.line.position.z);
      f.line.geometry.dispose();
      f.line.geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-w, -h, 0), new THREE.Vector3(w, -h, 0),
        new THREE.Vector3(w, h, 0), new THREE.Vector3(-w, h, 0),
      ]);
      f.w = w;
      f.h = h;
    });

    gridGroup.children.forEach(c => c.geometry.dispose());
    gridGroup.clear();
    addGridLines(gridGroup, zDataMin - zPad, zDataMax + zPad, spreadAt(zDataMin - zPad));
  }
  layoutScene();

  // ─── Axis label projection helpers ──────────────────────────────────────────
  // Project a world-space Vector3 to canvas-relative {x, y, behind} coords
  const _projected = new THREE.Vector3();
  function project3D(vec, cam) {
    const v = _projected.copy(vec).project(cam);
    const w = canvasW;
    const h = canvasH;
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
      behind: v.z > 1,
    };
  }

  // Clamp a projected point to stay within screen bounds with a margin.
  // marginTop lets the top edge use a larger margin than the other three
  // (e.g. to clear the fixed nav bar on mobile).
  function clampToScreen(x, y, margin = LABEL_MARGIN, marginTop = margin) {
    const w = canvasW;
    const h = canvasH;
    return {
      x: Math.max(margin, Math.min(w - margin, x)),
      y: Math.max(marginTop, Math.min(h - margin, y)),
    };
  }

  // Cast a ray from (ox,oy) toward (tx,ty) and return the point where it exits the viewport.
  // Used to pin axis labels to the viewport edge regardless of zoom level.
  function pinToEdge(ox, oy, tx, ty, margin = LABEL_MARGIN, marginTop = margin) {
    const w = canvasW;
    const h = canvasH;
    const dx = tx - ox;
    const dy = ty - oy;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return clampToScreen(tx, ty, margin, marginTop);
    let tMin = Infinity;
    if (dx > 0) tMin = Math.min(tMin, (w - margin - ox) / dx);
    if (dx < 0) tMin = Math.min(tMin, (    margin - ox) / dx);
    if (dy > 0) tMin = Math.min(tMin, (h - margin - oy) / dy);
    if (dy < 0) tMin = Math.min(tMin, (    marginTop - oy) / dy);
    if (!isFinite(tMin) || tMin < 0) return clampToScreen(tx, ty, margin, marginTop);
    return { x: ox + dx * tMin, y: oy + dy * tMin };
  }

  // Place a label element at canvas-relative position with optional CSS rotation and entry offset
  function placeLabel(el, x, y, extraTransform = '', ox = 0, oy = 0) {
    el.style.position = 'absolute';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    const tx = ox !== 0 ? `calc(-50% + ${ox.toFixed(1)}px)` : '-50%';
    const ty = oy !== 0 ? `calc(-50% + ${oy.toFixed(1)}px)` : '-50%';
    el.style.transform = `translate(${tx}, ${ty})${extraTransform ? ' ' + extraTransform : ''}`;
  }

  // Compute the 2D angle (degrees) of a projected axis so helper text can be rotated to match
  function axisAngleDeg(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    let deg = Math.atan2(dy, dx) * (180 / Math.PI);
    // Keep text readable — flip if it would be upside-down
    if (deg > 90) deg -= 180;
    if (deg < -90) deg += 180;
    return deg;
  }

  // ─── Scroll-driven camera + drag offset ─────────────────────────────────────
  // Camera lerps from CAM_START (face-on, close) to CAM_END (angled, back)
  // driven purely by window.scrollY — no overflow locking needed.
  const scrollFracSpring = makeSpring(0);
  const dragTheta = makeSpring(0); // horizontal drag offset (radians)
  const dragPhi   = makeSpring(0); // vertical drag offset (radians)
  function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

  let isDragging = false;
  let lastPointer = { x: 0, y: 0 };
  let pointerDownAt = { x: 0, y: 0 }; // track mousedown position to distinguish drag from click
  const CLICK_DRAG_THRESHOLD = 5; // px — movement beyond this counts as a drag, not a click

  canvas.addEventListener('mousedown', e => {
    isDragging = true;
    lastPointer = { x: e.clientX, y: e.clientY };
    pointerDownAt = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.clientX - lastPointer.x;
    const dy = e.clientY - lastPointer.y;
    lastPointer = { x: e.clientX, y: e.clientY };
    dragTheta.target = clamp(dragTheta.target - dx * 0.005, -DRAG_MAX_H, DRAG_MAX_H);
    dragPhi.target   = clamp(dragPhi.target   - dy * 0.005, -DRAG_MAX_V, DRAG_MAX_V);
  });

  window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    canvas.style.cursor = 'grab';
    // intentionally not resetting dragTheta/dragPhi — rotation stays where user left it
  });

  canvas.style.cursor = 'grab';

  // Touch — single finger: horizontal = rotate, vertical = zoom
  //         two fingers:  pinch = zoom in/out
  let lastPinchDist = 0;

  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      isDragging = true;
      lastPointer = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      pointerDownAt = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      e.preventDefault();
      isDragging = false;
      const t0 = e.touches[0], t1 = e.touches[1];
      lastPinchDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      // Pinch zoom
      e.preventDefault();
      isDragging = false;
      const t0 = e.touches[0], t1 = e.touches[1];
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      const delta = lastPinchDist - dist; // pinch in (+) = zoom out, spread (-) = zoom in
      lastPinchDist = dist;
      cancelIntro();
      virtualScrollY = Math.max(0, Math.min(ZOOM_SPEED_PX, virtualScrollY + delta * ZOOM_TOUCH_PINCH_SPEED));
      return;
    }

    if (e.touches.length !== 1 || !isDragging) return;
    const dx = e.touches[0].clientX - lastPointer.x;
    const dy = e.touches[0].clientY - lastPointer.y;
    lastPointer = { x: e.touches[0].clientX, y: e.touches[0].clientY };

    // Vertical drag drives zoom: swipe down = zoom out (higher frac), swipe up = zoom in.
    // Only capture while still at the very top — once the page has scrolled past the
    // hero, native touch scroll must always win (see the wheel handler below for why).
    const atTop = window.scrollY === 0;
    const newVirtual = virtualScrollY - dy * ZOOM_TOUCH_DRAG_SPEED;
    if (atTop && (scrollFracSpring.current < SCROLL_UNLOCK_FRAC || dy > 0)) {
      e.preventDefault();
      if (dy !== 0) cancelIntro();
      virtualScrollY = Math.max(0, Math.min(ZOOM_SPEED_PX, newVirtual));
    }

    // Horizontal drag rotates the scene
    dragTheta.target = clamp(dragTheta.target - dx * 0.006, -DRAG_MAX_H, DRAG_MAX_H);
  }, { passive: false });

  canvas.addEventListener('touchend', () => {
    isDragging = false;
    // intentionally not resetting dragTheta — rotation stays where user left it
  }, { passive: true });

  // ─── Scroll drives camera animation ─────────────────────────────────────────
  // virtualScrollY accumulates wheel delta independently of window.scrollY.
  // Native page scroll is blocked until the zoom animation reaches SCROLL_UNLOCK_FRAC.
  // On first visit the user scrolls a short way through the 3D animation before content scrolls.
  // On repeat visits the animation is skipped so scroll is unlocked immediately.
  const SCROLL_UNLOCK_FRAC = 0.95; // zoom fraction at which native page scroll is allowed

  // Start virtualScrollY at the load fraction so the user can scroll both in and out
  let virtualScrollY = ZOOM_LOAD_FRAC * ZOOM_SPEED_PX;

  // ─── Intro zoom-out state ───────────────────────────────────────────────────
  // Drives the zoom fraction linearly from ZOOM_LOAD_FRAC to 1 over INTRO_ZOOM_MS;
  // the render loop's cubic ease turns that into an ease-in-out camera move.
  // Any zoom input from the visitor hands control straight back to them.
  const intro = {
    active: true,
    startAt: Infinity, // set once every thumbnail is ready (see the preload below)
    settleAt: null,  // when to fire onSettled (null = not yet scheduled)
    settled: false,
  };
  let cutoffYear = null; // year slider: null = all years (see setYearCutoff below)

  function cancelIntro() {
    if (!intro.active) return;
    intro.active = false;
    if (intro.settleAt === null) intro.settleAt = performance.now() + 1500;
  }

  // If the page scroll is restored (returning from a project page), the page will already
  // be scrolled down — meaning the user had previously passed the 3D animation. In that
  // case, immediately jump the spring to its unlocked end state so the card list scrolls
  // freely. We check now AND on every scroll event until it succeeds — a single check on
  // the next 'scroll' event isn't reliable (a programmatic scroll, like the smooth
  // scrollIntoView the nav search input triggers on focus, doesn't reliably dispatch a
  // 'scroll' event on window in every browser), so a one-shot listener could consume
  // itself without ever syncing, leaving native scroll wheel-locked even though the page
  // has since moved.
  function releaseIfScrolled() {
    if (window.scrollY > 0) {
      // Already down in the card stack (restored scroll, ?q= search) — no intro, no bounce
      intro.active = false;
      intro.settleAt = Infinity;
      virtualScrollY = ZOOM_SPEED_PX;
      scrollFracSpring.current = 1;
      scrollFracSpring.target  = 1;
      scrollFracSpring.velocity = 0;
      window.removeEventListener('scroll', releaseIfScrolled);
    }
  }
  releaseIfScrolled();
  window.addEventListener('scroll', releaseIfScrolled, { passive: true });

  window.addEventListener('wheel', e => {
    // Once the page has scrolled away from the very top, never recapture the wheel for
    // zoom — otherwise a stale/out-of-sync scrollFracSpring can leave scroll permanently
    // blocked below the hero (see releaseIfScrolled above for how it can go stale).
    const atTop = window.scrollY === 0;
    const zoomingIn = e.deltaY < 0 && atTop;
    const zoomLocked = atTop && scrollFracSpring.current < SCROLL_UNLOCK_FRAC;
    if (zoomLocked || zoomingIn) {
      e.preventDefault();
      cancelIntro();
      virtualScrollY = Math.max(0, Math.min(ZOOM_SPEED_PX, virtualScrollY + e.deltaY * ZOOM_WHEEL_SPEED));
    }
  }, { passive: false });

  // ─── Raycasting (hover + click) ───────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let lastRaycastTime = 0;

  // Tiles ghosted by the year slider can't be hovered or clicked
  function pickableMeshes() {
    return prismMeshes.filter(m => m.userData.ghostTarget === 1);
  }

  function getNDC(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: -((clientY - rect.top) / rect.height) * 2 + 1,
    };
  }

  canvas.addEventListener('mousemove', e => {
    if (isMobile) return;
    const now = performance.now();
    if (now - lastRaycastTime < 33) return; // ~30fps
    lastRaycastTime = now;

    const ndc = getNDC(e.clientX, e.clientY);
    pointer.set(ndc.x, ndc.y);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickableMeshes(), false);

    if (hits.length > 0) {
      const mesh = hits[0].object;
      if (hoveredMesh !== mesh) {
        if (hoveredMesh) {
          hoveredMesh.userData.scaleSpring.target = hoveredMesh.userData.baseScale;
        }
        hoveredMesh = mesh;
        const p = meshToProject.get(mesh);
        mesh.userData.scaleSpring.target = mesh.userData.baseScale * TILE_HOVER_SCALE;
        canvas.style.cursor = 'pointer';

        if (hoverLabel) {
          hoverLabel.style.display = 'block';
          hoverLabel.textContent = `${p.title} · ${p.year}`;
        }
      }
      if (hoverLabel) {
        hoverLabel.style.left = e.clientX - canvas.getBoundingClientRect().left + 'px';
        hoverLabel.style.top = e.clientY - canvas.getBoundingClientRect().top + 'px';
      }
    } else {
      if (hoveredMesh) {
        hoveredMesh.userData.scaleSpring.target = hoveredMesh.userData.baseScale;
        hoveredMesh = null;
        canvas.style.cursor = isDragging ? 'grabbing' : 'grab';
        if (hoverLabel) hoverLabel.style.display = 'none';
      }
    }
  });

  canvas.addEventListener('click', e => {
    // Ignore click if the pointer travelled more than the threshold — it was a drag
    const dx = e.clientX - pointerDownAt.x;
    const dy = e.clientY - pointerDownAt.y;
    if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD) return;

    const ndc = getNDC(e.clientX, e.clientY);
    raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
    const hits = raycaster.intersectObjects(pickableMeshes(), false);
    if (hits.length > 0) {
      const p = meshToProject.get(hits[0].object);
      if (p) onProjectClick?.(p.id);
    }
  });

  // ─── Resize ──────────────────────────────────────────────────────────────────
  function onResize() {
    const w = canvas.offsetWidth, h = canvas.offsetHeight; // the one place the size is read
    if (w === 0 || h === 0) return;
    canvasW = w;
    canvasH = h;
    const aspectChanged = Math.abs(camera.aspect - w / h) > 1e-4;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    if (aspectChanged) layoutScene(); // re-flow tiles to fill the new shape
    wakeRender();
  }

  // Debounced resize — redraws immediately then waits for user to stop dragging
  let _resizeRaf = null;
  window.addEventListener('resize', () => {
    onResize(); // immediate redraw (no jank during resize)
    if (_resizeRaf) cancelAnimationFrame(_resizeRaf);
    _resizeRaf = requestAnimationFrame(onResize); // one more after paint settles
  });

  // ─── Render loop ──────────────────────────────────────────────────────────────

  let driftTime = 0;         // accumulated only while loop runs — no jumps on pause
  let driftSpeedMul = 1;     // lerps 0→1 when resuming so motion eases in
  let lastFrameTs = performance.now();
  let timeLabelOpacity = 0; // smoothly lerped 0→1 when angle threshold is met
  let animFrameId;
  const _basePos = new THREE.Vector3();
  const _dragEuler = new THREE.Euler();
  const _dragQuat = new THREE.Quaternion();
  const _frameCorner = new THREE.Vector3();
  const ORIGIN = new THREE.Vector3(0, 0, 0);
  const TIME_A = new THREE.Vector3(0, 0, TIME_LABEL_Z);
  const TIME_B = new THREE.Vector3(0, 0, TIME_LABEL_Z + 1);
  const R = AXIS_RANGE * 1.4;
  // entry: direction of the slide-in (shrinks to 0 as opacity reaches 1)
  const axisEndpoints = [
    { id: 'label-poetic',        pos: new THREE.Vector3(-R, 0, 0), entry: { x:  1, y: 0 } },
    { id: 'label-pragmatic',     pos: new THREE.Vector3( R, 0, 0), entry: { x: -1, y: 0 } },
    { id: 'label-institutional', pos: new THREE.Vector3(0,  R, 0), entry: { x: 0, y:  1 } },
    { id: 'label-individual',    pos: new THREE.Vector3(0, -R, 0), entry: { x: 0, y: -1 } },
  ];
  function animate() {
    animFrameId = requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min(now - lastFrameTs, 100); // cap at 100 ms to survive tab-hidden wakes
    lastFrameTs = now;
    driftSpeedMul += (1 - driftSpeedMul) * (1 - Math.pow(0.92, dt / 16.67));
    driftTime += dt * driftSpeedMul;

    // Intro zoom-out overrides the zoom spring until it finishes or is cancelled
    if (intro.active && now >= intro.startAt) {
      const t = Math.min(1, (now - intro.startAt) / INTRO_ZOOM_MS);
      const frac = ZOOM_LOAD_FRAC + (1 - ZOOM_LOAD_FRAC) * t;
      virtualScrollY = frac * ZOOM_SPEED_PX;
      scrollFracSpring.current = scrollFracSpring.target = frac;
      scrollFracSpring.velocity = 0;
      lastInteractionTime = now; // keep the loop awake through the intro
      if (t >= 1) {
        intro.active = false;
        intro.settleAt = now + SETTLE_DELAY_MS;
      }
    }

    // Scroll-driven camera: lerp from face-on to angled as virtualScrollY accumulates
    const rawFrac = Math.max(0, Math.min(1, virtualScrollY / ZOOM_SPEED_PX));
    scrollFracSpring.target = rawFrac;
    tickSpring(scrollFracSpring, ZOOM_STIFFNESS, ZOOM_DAMPING);
    tickSpring(dragTheta, DRAG_STIFFNESS, DRAG_DAMPING);
    tickSpring(dragPhi,   DRAG_STIFFNESS, DRAG_DAMPING);

    // Cubic ease-in-out on fraction
    const f = scrollFracSpring.current;
    const ef = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;

    // Reused objects below: allocating fresh vectors every frame feeds the
    // garbage collector, whose pauses show up as hitches mid-animation
    const basePos = _basePos.lerpVectors(CAM_ZOOM_IN, CAM_END, ef);

    // Apply drag as small rotation of the base position around world origin
    if (Math.abs(dragTheta.current) > 0.0001 || Math.abs(dragPhi.current) > 0.0001) {
      _dragEuler.set(dragPhi.current, dragTheta.current, 0, 'YXZ');
      basePos.applyQuaternion(_dragQuat.setFromEuler(_dragEuler));
    }

    camera.position.copy(basePos);
    camera.lookAt(CAM_TARGET);

    // ── Per-frame axis label projection ────────────────────────────────────────
    // Must run after camera matrices are updated (post-lookAt, pre-render)
    camera.updateMatrixWorld();

    // Endpoint labels: project the 3D tip of each axis, pin to screen edge
    const pOrigin = project3D(ORIGIN, camera);
    axisEndpoints.forEach(({ id, pos, entry }) => {
      const el = labelEls[id];
      if (!el) return;
      const p = project3D(pos, camera);
      if (p.behind) { el.style.display = 'none'; return; }
      el.style.display = '';
      const op = labelOpacity(LABEL_REVEAL_MS[id] ?? 0);
      el.style.opacity = op;
      const fade = 1 - op;
      const edgePos = pinToEdge(pOrigin.x, pOrigin.y, p.x, p.y, effectiveLabelMargin, effectiveLabelMarginTop);
      placeLabel(el, edgePos.x, edgePos.y, '', entry.x * ENTRY_SLIDE_PX * fade, entry.y * ENTRY_SLIDE_PX * fade);
    });

    const elT = labelEls['label-time'];

    const tA = project3D(TIME_A, camera);
    const tB = project3D(TIME_B, camera);
    const offZAxis = Math.abs(dragTheta.current);
    const timeShouldShow = !tA.behind && offZAxis > TIME_LABEL_ANGLE_THRESHOLD;
    timeLabelOpacity += ((timeShouldShow ? 1 : 0) - timeLabelOpacity) * 0.08;
    if (elT) {
      if (timeLabelOpacity < 0.01) {
        elT.style.display = 'none';
      } else {
        const deg = axisAngleDeg(tA, tB);
        placeLabel(elT, tA.x, tA.y, `rotate(${deg}deg)`);
        elT.style.display = '';
        elT.style.opacity = timeLabelOpacity;
      }
    }

    // Year frame labels: pin each to its frame's top-left corner. Old years pack
    // tightly in the distance, so skip any label that would overlap the one
    // drawn just before it (newest first, so recent years always win).
    const framesOp = cardOpacity(0);
    let lastLabelPt = null;
    for (let i = yearFrames.length - 1; i >= 0; i--) {
      const f = yearFrames[i];
      f.ghost += ((cutoffYear == null || f.year <= cutoffYear ? 1 : GHOST_OPACITY) - f.ghost) * GHOST_LERP;
      f.mat.opacity = YEAR_FRAME_OPACITY * framesOp * f.ghost;
      const pt = project3D(_frameCorner.set(-f.w, f.h, f.line.position.z), camera);
      const w = canvasW, h = canvasH;
      const onScreen = !pt.behind && pt.x > 8 && pt.y > effectiveLabelMarginTop - 30 && pt.x < w - 40 && pt.y < h - 8;
      const crowded = lastLabelPt && Math.hypot(pt.x - lastLabelPt.x, pt.y - lastLabelPt.y) < 26;
      if (!onScreen || crowded) {
        f.label.classList.remove('visible');
        continue;
      }
      f.label.style.left = `${pt.x}px`;
      f.label.style.top = `${pt.y}px`;
      f.label.style.setProperty('--year-ghost', (framesOp * f.ghost).toFixed(3));
      f.label.classList.add('visible');
      lastLabelPt = pt;
    }

    // Update prism scale springs + opacity. Opacity is the product of the entry
    // fade, the thumbnail crossfade and the year-filter ghost, applied in one place.
    prismMeshes.forEach(mesh => {
      const ud = mesh.userData;
      const s = tickSpring(ud.scaleSpring, TILE_HOVER_STIFFNESS, TILE_HOVER_DAMPING);
      mesh.scale.set(s, s, 1);

      const entryOp = intro.startAt === Infinity ? 0 : entryDone ? 1 : cardOpacity(ud.revealMs);
      if (ud.textureFadeStart != null) {
        ud.textureFade = Math.min(1, (now - ud.textureFadeStart) / TEXTURE_FADE_MS);
        if (ud.textureFade >= 1) ud.textureFadeStart = null;
      }
      ud.ghost += (ud.ghostTarget - ud.ghost) * GHOST_LERP;
      if (Math.abs(ud.ghostTarget - ud.ghost) < 0.002) ud.ghost = ud.ghostTarget;

      const op = entryOp * ud.ghost;
      const frontOp = op * ud.textureFade;
      const key = op * 10 + frontOp; // cheap change check for both values
      if (key !== ud.appliedOpacity) {
        ud.appliedOpacity = key;
        setMatOpacity(ud.sideMat, op);
        setMatOpacity(mesh.material[4], frontOp);
      }

      if (ud.pulse) updatePulse(ud.pulse, PULSE, now, op, mesh === hoveredMesh, reducedMotion);
    });

    if (intro.settleAt !== null && !intro.settled && now >= intro.settleAt && window.scrollY === 0) {
      intro.settled = true;
      onSettled?.();
    }

    // Subtle gentle rotation of scene (very slow drift)
    scene.rotation.y = Math.sin(driftTime * 0.0005) * 0.02;

    renderer.render(scene, camera);

    // Pause the rAF loop after 30s of inactivity once entry is done — unless the
    // top-project pulse is animating, which needs frames to move
    const pulsing = pulseIds.size > 0 && !reducedMotion;
    if (!pulsing && entryDone && springsSettled() && performance.now() - lastInteractionTime > 30000) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  // True once the entry reveal animation has fully completed
  let entryDone = skipEntry;

  // A fully visible tile renders opaque: 52 overlapping see-through tiles are
  // drawn back to front over each other, which is a lot of GPU overdraw. Both
  // shader variants are built by warmUpGpu() before the intro, so flipping
  // `transparent` here is a cache lookup, not a compile.
  function setMatOpacity(mat, op) {
    mat.opacity = op;
    const transparent = op < 1;
    if (mat.transparent !== transparent) {
      mat.transparent = transparent;
      mat.needsUpdate = true;
    }
  }

  function springsSettled() {
    const EPS = 0.0002;
    for (const mesh of prismMeshes) {
      if (mesh.userData.ghost !== mesh.userData.ghostTarget) return false;
      if (mesh.userData.textureFadeStart != null) return false;
    }
    if (Math.abs(scrollFracSpring.velocity) > EPS) return false;
    if (Math.abs(dragTheta.velocity) > EPS) return false;
    if (Math.abs(dragPhi.velocity) > EPS) return false;
    for (const mesh of prismMeshes) {
      if (Math.abs(mesh.userData.scaleSpring.velocity) > EPS) return false;
    }
    return true;
  }

  let lastInteractionTime = performance.now();

  // Wake the render loop when user interacts
  function wakeRender() {
    lastInteractionTime = performance.now();
    if (!animFrameId && !renderingPaused) {
      driftSpeedMul = 0;
      lastFrameTs = performance.now();
      animate();
    }
  }
  canvas.addEventListener('mousemove', wakeRender, { passive: true });
  canvas.addEventListener('touchstart', wakeRender, { passive: true });
  window.addEventListener('scroll', wakeRender, { passive: true });
  window.addEventListener('wheel', wakeRender, { passive: true });

  // ─── Preload, then start the intro ──────────────────────────────────────────
  // 1. Fetch + decode + crop every thumbnail in parallel (off the main thread).
  // 2. Upload them to the GPU a few per frame, while the axis labels fade in.
  // 3. Attach them to the tiles and compile the shaders once, all before a
  //    single card is visible.
  // 4. Start the cards' fade-in and the zoom-out together.
  // A thumbnail that misses the PRELOAD_MAX_MS deadline attaches itself later
  // with a short crossfade instead of holding the intro hostage.
  // Frosted loading screen over the graph. Only appears if the preload is slow
  // (a first visit on a slow connection); cached repeat visits never see it.
  //
  // It is only ever created if loading is actually slow, and it is gone before
  // the zoom starts. Adding or removing a full-size backdrop-filter layer makes
  // Safari rebuild its compositing layers, WebGL canvas included: when this was
  // removed on a timer after the intro began, it froze the zoom for ~250 ms,
  // 0.8 s in, on every load.
  let loadingEl = null;
  let loadingProgress = 0;
  function showLoading(total) {
    if (loadingEl) return;
    loadingEl = document.createElement('div');
    loadingEl.className = 'graph-loading';
    loadingEl.setAttribute('role', 'status');
    loadingEl.innerHTML = '<div class="graph-loading-inner"><span class="graph-loading-text"></span><span class="graph-loading-bar"><i></i></span></div>';
    loadingEl.querySelector('.graph-loading-text').textContent = `Loading ${total} projects`;
    document.getElementById('hero')?.appendChild(loadingEl);
    updateLoadingBar();
    requestAnimationFrame(() => loadingEl?.classList.add('visible'));
  }
  function updateLoadingBar() {
    const bar = loadingEl?.querySelector('.graph-loading-bar i');
    if (bar) bar.style.transform = `scaleX(${loadingProgress})`;
  }
  // Resolves once the loading screen has faded out and left the page
  async function hideLoading() {
    if (!loadingEl) return;
    const el = loadingEl;
    el.classList.remove('visible');
    await new Promise(resolve => setTimeout(resolve, 550)); // matches the CSS fade
    el.remove();
    loadingEl = null;
    await nextFrame(); // let the browser settle its layers before anything animates
    await nextFrame();
  }

  function attachTexture(mesh, texture, crossfade) {
    const mats = Array.from(mesh.material);
    const old = mats[4];
    mats[4] = new THREE.MeshLambertMaterial({ map: texture, transparent: true, opacity: old.opacity });
    old.dispose();
    mesh.material = mats;
    if (crossfade) {
      mesh.userData.textureFadeStart = performance.now();
      mesh.userData.textureFade = 0;
    }
    mesh.userData.appliedOpacity = -1; // force the loop to write opacity to the new material
  }

  // A frame, or 50 ms if frames are paused (a background tab), so the preload
  // can never stall waiting on a frame that isn't coming
  function nextFrame() {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, 50);
      requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
    });
  }

  let introScheduled = false;
  function scheduleIntro() {
    if (introScheduled) return;
    introScheduled = true;
    // Cards wait for the axis labels' own reveal on a first visit
    const earliest = sceneInitTime + (skipEntry ? INTRO_REPEAT_DELAY_MS : CARD_REVEAL_START_MS);
    intro.startAt = Math.max(performance.now(), earliest);
    performance.mark?.('graph-intro-start', { startTime: intro.startAt }); // for profiling the zoom
    if (!skipEntry) {
      setTimeout(() => {
        entryDone = true;
        wakeRender();
      }, intro.startAt - performance.now() + INTRO_ZOOM_MS + ENTRY_FADE_MS);
    }
    wakeRender();
  }

  async function preloadTiles() {
    const withThumbs = prismMeshes.filter(m => m.userData.project.thumbnail);
    let decoded = 0;
    const updateLoading = () => {
      loadingProgress = withThumbs.length ? decoded / withThumbs.length : 1;
      updateLoadingBar();
    };
    // Only cover the graph if loading is actually slow
    const loadingTimer = setTimeout(() => showLoading(withThumbs.length), 700);
    updateLoading();

    let preloadOver = false;
    const ready = [];
    const jobs = withThumbs.map(mesh =>
      buildTileCanvas(mesh.userData.project.thumbnail)
        .then(tileCanvas => {
          const texture = new THREE.CanvasTexture(tileCanvas);
          texture.colorSpace = THREE.SRGBColorSpace;
          decoded++;
          updateLoading();
          if (preloadOver) {
            // Missed the deadline: upload and crossfade it in on its own
            renderer.initTexture?.(texture);
            attachTexture(mesh, texture, true);
            wakeRender();
          } else {
            ready.push({ mesh, texture });
          }
        })
        .catch(() => { decoded++; updateLoading(); }) // missing/undecodable — tile stays blank
    );

    await Promise.race([
      Promise.all(jobs),
      new Promise(resolve => setTimeout(resolve, PRELOAD_MAX_MS)),
    ]);
    preloadOver = true;
    clearTimeout(loadingTimer);

    if (renderer.initTexture) {
      for (let i = 0; i < ready.length; i += GPU_UPLOADS_PER_FRAME) {
        ready.slice(i, i + GPU_UPLOADS_PER_FRAME).forEach(({ texture }) => renderer.initTexture(texture));
        await nextFrame();
      }
    }
    ready.forEach(({ mesh, texture }) => attachTexture(mesh, texture, false));
    warmUpGpu();
    await hideLoading();
    await nextFrame();
    scheduleIntro();
  }

  // Browsers finish GPU setup lazily: a texture's upload and each shader's
  // pipeline state only happen the first time something is actually drawn with
  // them. renderer.compile() isn't enough on its own. Left alone, that work lands
  // mid-zoom (about 40% in, when the camera pulls back past the newest tiles and
  // their glow planes first enter view) as a visible freeze.
  //
  // So draw everything now, from both ends of the zoom, with every glow and ripple
  // plane shown, in both the see-through and solid tile variants. It all happens
  // inside one task that ends with a normal render of the real view, so none of
  // these frames is ever shown — and cards are still at opacity 0 regardless.
  function warmUpGpu() {
    const savedPos = camera.position.clone();
    const rings = [];
    prismMeshes.forEach(m => {
      if (!m.userData.pulse) return;
      rings.push([m.userData.pulse.ring, m.userData.pulse.ring.visible]);
      m.userData.pulse.ring.visible = true;
      m.userData.pulse.glow.frustumCulled = false;
      m.userData.pulse.ring.frustumCulled = false;
    });
    if (pulseTextures && renderer.initTexture) {
      renderer.initTexture(pulseTextures.glow);
      renderer.initTexture(pulseTextures.ring);
    }

    const tileMats = prismMeshes.flatMap(m => [m.userData.sideMat, m.material[4]]);
    const drawBothEnds = () => {
      for (const pos of [CAM_ZOOM_IN.clone().lerp(CAM_END, ZOOM_LOAD_FRAC), CAM_END]) {
        camera.position.copy(pos);
        camera.lookAt(CAM_TARGET);
        renderer.render(scene, camera);
      }
    };
    renderer.compile(scene, camera);
    drawBothEnds();                                   // see-through variant (entry fade, ghosting)
    tileMats.forEach(mat => { mat.transparent = false; mat.needsUpdate = true; });
    renderer.compile(scene, camera);
    drawBothEnds();                                   // solid variant (fully visible tiles)
    tileMats.forEach(mat => { mat.transparent = true; mat.needsUpdate = true; });
    renderer.compile(scene, camera);

    rings.forEach(([ring, visible]) => { ring.visible = visible; });
    camera.position.copy(savedPos);
    camera.lookAt(CAM_TARGET);
    renderer.render(scene, camera);                   // the frame that actually gets shown
    prismMeshes.forEach(m => { m.userData.appliedOpacity = -1; });
  }

  // Pre-compile the untextured shaders before the first visible frame — otherwise
  // the GPU-driver compile lands on the first render() call.
  renderer.compile(scene, camera);

  animate();
  preloadTiles();

  // ── Pause rendering when work section scrolls over the hero ─────────────────
  // #hero is position:fixed so IntersectionObserver always reports it as visible.
  // #work-bg has margin-top:100vh, so when scrollY >= innerHeight it fully covers
  // the hero and the 3D scene can stop drawing.
  let renderingPaused = false;
  const workBg = document.getElementById('work-bg');
  function updateRenderPause() {
    // The card stack peeks up from below, so the graph is fully covered once
    // its top edge reaches the top of the window.
    const covered = workBg
      ? workBg.getBoundingClientRect().top <= 0
      : window.scrollY >= window.innerHeight;
    if (covered && !renderingPaused) {
      renderingPaused = true;
      if (animFrameId) cancelAnimationFrame(animFrameId);
      animFrameId = null;
    } else if (!covered && renderingPaused) {
      renderingPaused = false;
      driftSpeedMul = 0;
      lastFrameTs = performance.now();
      animate();
    }
  }
  window.addEventListener('scroll', updateRenderPause, { passive: true });
  updateRenderPause();

  // ── Controls: year slider + reset view ─────────────────────────────────────
  const controls = document.createElement('div');
  controls.id = 'viz-controls';

  // Year slider — sliding back in time ghosts every project newer than the
  // chosen year, here and (through onYearCutoffChange) in the card stack.
  const sliderWrap = document.createElement('div');
  sliderWrap.className = 'viz-year-filter';
  sliderWrap.innerHTML = `
    <label class="viz-year-label" for="viz-year-slider">Through <output id="viz-year-value">${lastYear}</output></label>
    <input type="range" id="viz-year-slider" min="${firstYear}" max="${lastYear}" step="1" value="${lastYear}"
      aria-label="Show projects up to year">
    <div class="viz-year-ends" aria-hidden="true"><span>${firstYear}</span><span>${lastYear}</span></div>`;
  const slider = sliderWrap.querySelector('input');
  const sliderValue = sliderWrap.querySelector('output');

  function setYearCutoff(year, { notify = true } = {}) {
    const next = year == null || year >= lastYear ? null : year;
    slider.value = String(next ?? lastYear);
    sliderValue.textContent = next == null ? 'All years' : String(next);
    sliderWrap.classList.toggle('active', next != null);
    if (next === cutoffYear) return;
    cutoffYear = next;
    prismMeshes.forEach(mesh => {
      const newer = cutoffYear != null && Math.floor(mesh.userData.yearFrac) > cutoffYear;
      mesh.userData.ghostTarget = newer ? GHOST_OPACITY : 1;
    });
    // Drop hover from a tile that just became ghosted
    if (hoveredMesh && hoveredMesh.userData.ghostTarget !== 1) {
      hoveredMesh.userData.scaleSpring.target = hoveredMesh.userData.baseScale;
      hoveredMesh = null;
      if (hoverLabel) hoverLabel.style.display = 'none';
    }
    wakeRender();
    if (notify) onYearCutoffChange?.(cutoffYear);
  }
  sliderValue.textContent = 'All years';
  slider.addEventListener('input', () => setYearCutoff(Number(slider.value)));

  const resetBtn = document.createElement('button');
  resetBtn.id = 'viz-reset-btn';
  resetBtn.textContent = '⟳ Reset view';
  resetBtn.setAttribute('aria-label', 'Reset visualization to the full zoomed-out view');
  resetBtn.addEventListener('click', () => {
    cancelIntro();
    virtualScrollY = ZOOM_SPEED_PX; // the full graph is home now that the intro ends there
    dragTheta.target = 0;
    dragTheta.current = 0;
    dragTheta.velocity = 0;
    dragPhi.target = 0;
    dragPhi.current = 0;
    dragPhi.velocity = 0;
  });
  controls.append(resetBtn, sliderWrap);
  document.getElementById('hero')?.appendChild(controls);

  // Cleanup on page unload
  window.addEventListener('unload', () => {
    cancelAnimationFrame(animFrameId);
    renderer.dispose();
  });

  return { setYearCutoff };
}

// ─── Grid lines ───────────────────────────────────────────────────────────────
// zMin/zMax bound the time axis to the actual project range (+ padding), so the
// grid doesn't extend behind the earliest project or stop short of the newest.
// extent: the tile spread { w, h } at the far end, so the grid covers the stretched layout.
function addGridLines(scene, zMin, zMax, extent) {
  // The 2×2 grid lines (X and Y axes) are the primary visual — make them clear
  const gridMat = new THREE.LineBasicMaterial({ color: '#B4B3AE', transparent: true, opacity: 0.48 });
  const vertMat = new THREE.LineBasicMaterial({ color: '#B4B3AE', transparent: true, opacity: 0.38 });

  const step = 2;
  const countX = Math.ceil(extent.w / step);
  const countY = Math.ceil(extent.h / step);
  // Tiny nudge keeps background grid off the exact plane of the axis lines, preventing z-fighting
  const E = 0.005;

  // Snap the time-axis bounds to whole grid steps so lines land cleanly
  const zStart = Math.floor(zMin / step) * step;
  const zEnd = Math.ceil(zMax / step) * step;
  const zLines = [];
  for (let z = zStart; z <= zEnd; z += step) zLines.push(z);

  // Horizontal plane (Y = E, not 0, to avoid z-fighting with X-axis divider at y=0)
  const hPoints = [];
  for (const z of zLines) {
    hPoints.push(new THREE.Vector3(-countX * step, E, z));
    hPoints.push(new THREE.Vector3(countX * step, E, z));
  }
  for (let i = -countX; i <= countX; i++) {
    hPoints.push(new THREE.Vector3(i * step, E, zStart));
    hPoints.push(new THREE.Vector3(i * step, E, zEnd));
  }
  const hGeo = new THREE.BufferGeometry().setFromPoints(hPoints);
  scene.add(new THREE.LineSegments(hGeo, gridMat));

  // Vertical planes (X = E, not 0, to avoid z-fighting with Y-axis divider at x=0)
  const vPoints = [];
  for (let i = -countY; i <= countY; i++) {
    vPoints.push(new THREE.Vector3(E, i * step, zStart));
    vPoints.push(new THREE.Vector3(E, i * step, zEnd));
  }
  for (const z of zLines) {
    vPoints.push(new THREE.Vector3(E, -countY * step, z));
    vPoints.push(new THREE.Vector3(E, countY * step, z));
  }
  const vGeo = new THREE.BufferGeometry().setFromPoints(vPoints);
  scene.add(new THREE.LineSegments(vGeo, vertMat));

  // Main 2×2 dividing axes — the primary visual structure, clearly visible
  const axisMat = new THREE.LineBasicMaterial({ color: '#84827C', transparent: true, opacity: 0.55 });
  const axisPoints = [
    // Horizontal divider (Poetic ↔ Pragmatic)
    new THREE.Vector3(-extent.w, 0, 0), new THREE.Vector3(extent.w, 0, 0),
    // Vertical divider (Individual ↔ Institutional)
    new THREE.Vector3(0, -extent.h, 0), new THREE.Vector3(0, extent.h, 0),
  ];
  const axisGeo = new THREE.BufferGeometry().setFromPoints(axisPoints);
  scene.add(new THREE.LineSegments(axisGeo, axisMat));
}

// end of three-scene.js
