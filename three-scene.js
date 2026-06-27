/**
 * three-scene.js — 3D project visualization using Three.js r160
 *
 * To use locally: download three.module.js to vendor/ and update the import below.
 * Falls back gracefully if load fails (handled in main.js).
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const YEAR_MIN = 2015;
const YEAR_MAX = 2027;
const AXIS_RANGE = 5; // ±5 units

// Z depth range: oldest at z=0 (target), newest closer to camera — all positive Z
const Z_NEAR = 20;   // newest projects (2026) — must be < CAM_ZOOM_IN.z
const Z_FAR  =  0;   // oldest projects (2016) — sits at the camera target

// Scale: half the old values — hover enlarges back to full size
const SCALE_OLD = 0.3;
const SCALE_NEW = 1;

// Camera zoom range: scroll up past load state → CAM_ZOOM_IN; scroll down → CAM_END
const CAM_ZOOM_IN = new THREE.Vector3(0, 0.5, 10);   // maximum zoom-in — must be > Z_NEAR
const CAM_END     = new THREE.Vector3(0, 0.5, 30);   // maximum zoom-out (scroll down limit)
const CAM_TARGET  = new THREE.Vector3(0, 0,  0);   // world origin (oldest projects end)

// Fraction (0 = max zoom in, 1 = max zoom out) where the page loads.
// 0.35 ≈ the old CAM_START face-on position; raise to load more zoomed-out.
const ZOOM_LOAD_FRAC = 0.26;

// Z position of the "time" axis label (0 = oldest/far end, Z_NEAR = newest/close end)
const TIME_LABEL_Z = 2;

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

// Scroll/zoom spring feel
const SCROLL_STIFFNESS = 0.8;
const SCROLL_DAMPING   = 0.8;

// ─── Entry animation ──────────────────────────────────────────────────────────
const ENTRY_FADE_MS      = 500;  // how long each fade-in lasts (ms)
const ENTRY_SLIDE_PX     = 30;   // how far labels slide along their axis while fading in
const TIME_LABEL_LERP    = 0.08; // how fast the time label fades in/out (0=instant, 1=slow)

// Delay (ms) before each label fades in — adjust to re-sequence the reveal
const LABEL_REVEAL_MS = {
  'label-design-intent':  1000,
  'label-pragmatic':      2000,
  'label-poetic':         2000,
  'label-system-scale':   3000,
  'label-institutional':  4000,
  'label-individual':     4000,
};

const CARD_REVEAL_START_MS = 4500; // when the first card starts fading in
const CARD_REVEAL_STEP_MS  = 100;  // stagger between each subsequent card

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
export function initThreeScene(projects, { onProjectClick } = {}) {
  const canvas = document.getElementById('three-canvas');
  const hoverLabel = document.getElementById('project-hover-label');
  const isMobile = window.innerWidth < 768;
  const effectiveLabelMargin = isMobile ? 44 : LABEL_MARGIN;

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#F5F1E6');
  scene.fog = new THREE.Fog('#F5F1E6', 25, 50);

  // Renderer
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'default'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.offsetWidth, canvas.offsetHeight, false); // false = don't override CSS size

  // Camera
  const camera = new THREE.PerspectiveCamera(
    50,
    canvas.offsetWidth / canvas.offsetHeight,
    0.1,
    100
  );
  camera.position.copy(CAM_ZOOM_IN.clone().lerp(CAM_END, ZOOM_LOAD_FRAC));
  camera.lookAt(CAM_TARGET);

  // ─── Lighting ───────────────────────────────────────────────────────────────
  const ambientLight = new THREE.AmbientLight('#F5EDE0', 1.2);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight('#FFF8F0', 2.0);
  dirLight.position.set(8, 14, 10);
  scene.add(dirLight);

  const fillLight = new THREE.DirectionalLight('#E0E8F0', 0.6);
  fillLight.position.set(-6, 4, -8);
  scene.add(fillLight);

  // ─── Grid lines ─────────────────────────────────────────────────────────────
  addGridLines(scene);

  // ─── Project prisms ─────────────────────────────────────────────────────────
  const prismMeshes = [];
  const meshToProject = new Map();
  const textureLoader = new THREE.TextureLoader();

  // One shared material for all non-front faces across every prism
  const sharedSideMat = new THREE.MeshLambertMaterial({ color: '#CEC6B4' });

  // Fade-in timing — skip on repeat visits
  const VISITED_KEY = 'wyattroy-visited';
  const skipEntry = !!localStorage.getItem(VISITED_KEY);
  localStorage.setItem(VISITED_KEY, '1');
  const sceneInitTime = performance.now();

  function entryOpacity(revealMs) {
    if (skipEntry) return 1;
    const elapsed = performance.now() - sceneInitTime - revealMs;
    if (elapsed <= 0) return 0;
    return Math.min(1, elapsed / ENTRY_FADE_MS);
  }

  projects.forEach(p => {
    const pragmatic = p.axes?.pragmatic ?? 0.5;
    const institutional = p.axes?.institutional ?? 0.5;
    const year = p.year ?? 2022;

    // Position
    const x = (pragmatic - 0.5) * 2 * AXIS_RANGE;
    const y = (institutional - 0.5) * 2 * AXIS_RANGE;
    const monthFrac = ((p.month ?? 6) - 1) / 12; // Jan=0, Dec≈1
    const t = Math.max(0, Math.min(1, (year + monthFrac - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)));
    const z = Z_FAR + t * (Z_NEAR - Z_FAR); // oldest: Z_FAR, newest: Z_NEAR

    // Scale: oldest is 50% the size of newest
    const scale = SCALE_OLD + t * (SCALE_NEW - SCALE_OLD);

    // Geometry
    const geo = new THREE.BoxGeometry(1.6, 1.0, 0.05);

    // Only the front face (index 4) is per-mesh — it carries the thumbnail and fades in.
    // All other faces share one material; back face is back-culled and never rendered.
    const frontMat = new THREE.MeshLambertMaterial({ color: '#EAE6DA', transparent: true, opacity: 0 });
    const materials = [sharedSideMat, sharedSideMat, sharedSideMat, sharedSideMat, frontMat, sharedSideMat];

    const mesh = new THREE.Mesh(geo, materials);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(scale);
    // Store original scale for spring animation
    mesh.userData.baseScale = scale;
    mesh.userData.scaleSpring = makeSpring(scale);
    mesh.userData.project = p;
    mesh.userData.cardOpacity = 0;
    // revealMs assigned after loop once prismMeshes index is known

    // Load thumbnail for all projects that have one; stagger by index to avoid request pile-up
    if (p.thumbnail) {
      const delay = prismMeshes.length * 60; // stagger: 60ms per project
      setTimeout(() => {
        textureLoader.load(
          p.thumbnail,
          texture => {
            texture.colorSpace = THREE.SRGBColorSpace;

            // Cover-crop to face AR (1.6 : 1.0) without distortion
            const faceAR = 1.6;
            const img = texture.image;
            if (img && img.width && img.height) {
              const texAR = img.width / img.height;
              if (texAR > faceAR) {
                // Image wider than face — keep full height, crop width
                const rx = faceAR / texAR;
                texture.repeat.set(rx, 1);
                texture.offset.set((1 - rx) / 2, 0);
              } else {
                // Image taller than face — keep full width, crop height
                const ry = texAR / faceAR;
                texture.repeat.set(1, ry);
                texture.offset.set(0, (1 - ry) / 2);
              }
            }

            const newMats = Array.from(mesh.material);
            const op = mesh.userData.cardOpacity;
            newMats[4] = new THREE.MeshLambertMaterial({ map: texture, transparent: true, opacity: op });
            mesh.material = newMats;
          },
          undefined,
          () => {} // silently ignore missing thumbnails
        );
      }, delay);
    }

    scene.add(mesh);
    prismMeshes.push(mesh);
    meshToProject.set(mesh, p);
  });

  // Assign staggered card reveal times now that we know the indices
  prismMeshes.forEach((mesh, i) => {
    mesh.userData.revealMs = CARD_REVEAL_START_MS + i * CARD_REVEAL_STEP_MS;
  });

  // ─── Axis label projection helpers ──────────────────────────────────────────
  // Project a world-space Vector3 to canvas-relative {x, y, behind} coords
  function project3D(vec, cam) {
    const v = vec.clone().project(cam);
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
      behind: v.z > 1,
    };
  }

  // Clamp a projected point to stay within screen bounds with a margin
  function clampToScreen(x, y, margin = LABEL_MARGIN) {
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    return {
      x: Math.max(margin, Math.min(w - margin, x)),
      y: Math.max(margin, Math.min(h - margin, y)),
    };
  }

  // Cast a ray from (ox,oy) toward (tx,ty) and return the point where it exits the viewport.
  // Used to pin axis labels to the viewport edge regardless of zoom level.
  function pinToEdge(ox, oy, tx, ty, margin = LABEL_MARGIN) {
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const dx = tx - ox;
    const dy = ty - oy;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return clampToScreen(tx, ty, margin);
    let tMin = Infinity;
    if (dx > 0) tMin = Math.min(tMin, (w - margin - ox) / dx);
    if (dx < 0) tMin = Math.min(tMin, (    margin - ox) / dx);
    if (dy > 0) tMin = Math.min(tMin, (h - margin - oy) / dy);
    if (dy < 0) tMin = Math.min(tMin, (    margin - oy) / dy);
    if (!isFinite(tMin) || tMin < 0) return clampToScreen(tx, ty, margin);
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
      virtualScrollY = Math.max(0, Math.min(SCROLL_DRIVE_PX, virtualScrollY + delta * 2));
      return;
    }

    if (e.touches.length !== 1 || !isDragging) return;
    const dx = e.touches[0].clientX - lastPointer.x;
    const dy = e.touches[0].clientY - lastPointer.y;
    lastPointer = { x: e.touches[0].clientX, y: e.touches[0].clientY };

    // Vertical drag drives zoom: swipe down = zoom out (higher frac), swipe up = zoom in
    const newVirtual = virtualScrollY - dy * 1.5;
    if (scrollFracSpring.current < SCROLL_UNLOCK_FRAC || dy > 0) {
      e.preventDefault();
      virtualScrollY = Math.max(0, Math.min(SCROLL_DRIVE_PX, newVirtual));
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
  const SCROLL_DRIVE_PX = window.innerHeight * 0.6;

  // Start virtualScrollY at the load fraction so the user can scroll both in and out
  let virtualScrollY = ZOOM_LOAD_FRAC * SCROLL_DRIVE_PX;

  // If the page scroll is restored (returning from a project page), the page will already
  // be scrolled down — meaning the user had previously passed the 3D animation. In that
  // case, immediately jump the spring to its unlocked end state so the card list scrolls
  // freely. We check now AND on the first scroll event (which covers the rAF delay in
  // maybeRestoreScroll).
  function releaseIfScrolled() {
    if (window.scrollY > 0) {
      virtualScrollY = SCROLL_DRIVE_PX;
      scrollFracSpring.current = 1;
      scrollFracSpring.target  = 1;
      scrollFracSpring.velocity = 0;
    }
  }
  releaseIfScrolled();
  window.addEventListener('scroll', releaseIfScrolled, { passive: true, once: true });

  window.addEventListener('wheel', e => {
    const zoomingIn = e.deltaY < 0 && window.scrollY === 0;
    if (scrollFracSpring.current < SCROLL_UNLOCK_FRAC || zoomingIn) {
      e.preventDefault();
      virtualScrollY = Math.max(0, Math.min(SCROLL_DRIVE_PX, virtualScrollY + e.deltaY));
    }
  }, { passive: false });

  // ─── Raycasting (hover + click) ───────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hoveredMesh = null;
  let lastRaycastTime = 0;

  function getNDC(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: -((clientY - rect.top) / rect.height) * 2 + 1,
    };
  }

  canvas.addEventListener('mousemove', e => {
    const now = performance.now();
    if (now - lastRaycastTime < 33) return; // ~30fps
    lastRaycastTime = now;

    const ndc = getNDC(e.clientX, e.clientY);
    pointer.set(ndc.x, ndc.y);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(prismMeshes, false);

    if (hits.length > 0) {
      const mesh = hits[0].object;
      if (hoveredMesh !== mesh) {
        if (hoveredMesh) {
          hoveredMesh.userData.scaleSpring.target = hoveredMesh.userData.baseScale;
        }
        hoveredMesh = mesh;
        const p = meshToProject.get(mesh);
        mesh.userData.scaleSpring.target = mesh.userData.baseScale * 2.0;
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
    const hits = raycaster.intersectObjects(prismMeshes, false);
    if (hits.length > 0) {
      const p = meshToProject.get(hits[0].object);
      if (p && onProjectClick) onProjectClick(p.id);
    }
  });

  // ─── Resize ──────────────────────────────────────────────────────────────────
  function onResize() {
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  // Debounced resize — redraws immediately then waits for user to stop dragging
  let _resizeRaf = null;
  window.addEventListener('resize', () => {
    onResize(); // immediate redraw (no jank during resize)
    if (_resizeRaf) cancelAnimationFrame(_resizeRaf);
    _resizeRaf = requestAnimationFrame(onResize); // one more after paint settles
  });

  // ─── Render loop ──────────────────────────────────────────────────────────────

  const sceneStartTime = performance.now();
  let timeLabelOpacity = 0; // smoothly lerped 0→1 when angle threshold is met
  let animFrameId;
  function animate() {
    animFrameId = requestAnimationFrame(animate);

    // Scroll-driven camera: lerp from face-on to angled as virtualScrollY accumulates
    const rawFrac = Math.max(0, Math.min(1, virtualScrollY / SCROLL_DRIVE_PX));
    scrollFracSpring.target = rawFrac;
    tickSpring(scrollFracSpring, SCROLL_STIFFNESS, SCROLL_DAMPING);
    tickSpring(dragTheta, DRAG_STIFFNESS, DRAG_DAMPING);
    tickSpring(dragPhi,   DRAG_STIFFNESS, DRAG_DAMPING);

    // Cubic ease-in-out on fraction
    const f = scrollFracSpring.current;
    const ef = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;

    const basePos = new THREE.Vector3().lerpVectors(CAM_ZOOM_IN, CAM_END, ef);

    // Apply drag as small rotation of the base position around world origin
    if (Math.abs(dragTheta.current) > 0.0001 || Math.abs(dragPhi.current) > 0.0001) {
      const quat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(dragPhi.current, dragTheta.current, 0, 'YXZ')
      );
      basePos.applyQuaternion(quat);
    }

    camera.position.copy(basePos);
    camera.lookAt(CAM_TARGET);

    // ── Per-frame axis label projection ────────────────────────────────────────
    // Must run after camera matrices are updated (post-lookAt, pre-render)
    camera.updateMatrixWorld();

    const R = AXIS_RANGE * 1.4;

    // Endpoint labels: project the 3D tip of each axis, pin to screen edge
    // entry: direction of the 20px slide-in (shrinks to 0 as opacity reaches 1)
    const axisEndpoints = [
      { id: 'label-poetic',        pos: new THREE.Vector3(-R, 0, 0), entry: { x:  1, y: 0 } },
      { id: 'label-pragmatic',     pos: new THREE.Vector3( R, 0, 0), entry: { x: -1, y: 0 } },
      { id: 'label-institutional', pos: new THREE.Vector3(0,  R, 0), entry: { x: 0, y:  1 } },
      { id: 'label-individual',    pos: new THREE.Vector3(0, -R, 0), entry: { x: 0, y: -1 } },
    ];
    const pOrigin = project3D(new THREE.Vector3(0, 0, 0), camera);
    axisEndpoints.forEach(({ id, pos, entry }) => {
      const el = document.getElementById(id);
      if (!el) return;
      const p = project3D(pos, camera);
      if (p.behind) { el.style.display = 'none'; return; }
      el.style.display = '';
      const op = entryOpacity(LABEL_REVEAL_MS[id] ?? 0);
      el.style.opacity = op;
      const fade = 1 - op;
      const edgePos = pinToEdge(pOrigin.x, pOrigin.y, p.x, p.y, effectiveLabelMargin);
      placeLabel(el, edgePos.x, edgePos.y, '', entry.x * ENTRY_SLIDE_PX * fade, entry.y * ENTRY_SLIDE_PX * fade);
    });

    // Helper text: anchored in screen space relative to the endpoint labels they describe.
    // DI = "design intent" (left of Pragmatic), SS = "system scale" (below Institutional)
    const DI_OFFSET_X = -150; // px left of Pragmatic label
    const DI_OFFSET_Y = 0;    // px vertical shift from Pragmatic label
    const SS_OFFSET_X = 0;    // px horizontal shift from Institutional label
    const SS_OFFSET_Y = 80;   // px below Institutional label

    const xNeg = project3D(new THREE.Vector3(-R, 0, 0), camera);
    const xPos = project3D(new THREE.Vector3( R, 0, 0), camera);
    const yNeg = project3D(new THREE.Vector3(0, -R, 0), camera);
    const yPos = project3D(new THREE.Vector3(0,  R, 0), camera);
    const zNeg = project3D(new THREE.Vector3(0, 0, Z_FAR),  camera);
    const zPos = project3D(new THREE.Vector3(0, 0, Z_NEAR), camera);

    const elDI = document.getElementById('label-design-intent');
    const elSS = document.getElementById('label-system-scale');
    const elT  = document.getElementById('label-time');

    // "design intent" hovers just left of the Pragmatic (xPos) endpoint label
    if (elDI && !xPos.behind) {
      const pinned = pinToEdge(pOrigin.x, pOrigin.y, xPos.x, xPos.y, effectiveLabelMargin);
      const deg = axisAngleDeg(xNeg, xPos);
      const opDI = entryOpacity(LABEL_REVEAL_MS['label-design-intent']);
      placeLabel(elDI, pinned.x + DI_OFFSET_X, pinned.y + DI_OFFSET_Y, `rotate(${deg}deg)`, -ENTRY_SLIDE_PX * (1 - opDI), 0);
      elDI.style.display = '';
      elDI.style.opacity = opDI;
    } else if (elDI) { elDI.style.display = 'none'; }

    // "system scale" hovers just below the Institutional (yPos) endpoint label
    if (elSS && !yPos.behind) {
      const pinned = pinToEdge(pOrigin.x, pOrigin.y, yPos.x, yPos.y, effectiveLabelMargin);
      const deg = axisAngleDeg(yNeg, yPos);
      const opSS = entryOpacity(LABEL_REVEAL_MS['label-system-scale']);
      placeLabel(elSS, pinned.x + SS_OFFSET_X, pinned.y + SS_OFFSET_Y, `rotate(${deg}deg)`, 0, ENTRY_SLIDE_PX * (1 - opSS));
      elSS.style.display = '';
      elSS.style.opacity = opSS;
    } else if (elSS) { elSS.style.display = 'none'; }

    const tA = project3D(new THREE.Vector3(0, 0, TIME_LABEL_Z), camera);
    const tB = project3D(new THREE.Vector3(0, 0, TIME_LABEL_Z + 1), camera);
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

    // Update prism scale springs + entry fade
    prismMeshes.forEach(mesh => {
      const s = tickSpring(mesh.userData.scaleSpring);
      mesh.scale.setScalar(s);

      const op = entryOpacity(mesh.userData.revealMs);
      if (op !== mesh.userData.cardOpacity) {
        mesh.userData.cardOpacity = op;
        const frontMat = mesh.material[4];
        if (frontMat) frontMat.opacity = op;
      }
    });

    // Subtle gentle rotation of scene (very slow drift)
    scene.rotation.y = Math.sin((performance.now() - sceneStartTime) * 0.0005) * 0.02;

    renderer.render(scene, camera);

  }

  animate();

  // ── Pause rendering when work section scrolls over the hero ─────────────────
  // #hero is position:fixed so IntersectionObserver always reports it as visible.
  // #work-bg has margin-top:100vh, so when scrollY >= innerHeight it fully covers
  // the hero and the 3D scene can stop drawing.
  let renderingPaused = false;
  function updateRenderPause() {
    const covered = window.scrollY >= window.innerHeight * (isMobile ? 0.7 : 1);
    if (covered && !renderingPaused) {
      renderingPaused = true;
      cancelAnimationFrame(animFrameId);
    } else if (!covered && renderingPaused) {
      renderingPaused = false;
      animate();
    }
  }
  window.addEventListener('scroll', updateRenderPause, { passive: true });
  updateRenderPause();

  // ── Reset view button ────────────────────────────────────────────────────────
  const resetBtn = document.createElement('button');
  resetBtn.id = 'viz-reset-btn';
  resetBtn.textContent = '⟳ Reset view';
  resetBtn.setAttribute('aria-label', 'Reset visualization to default camera position');
  resetBtn.addEventListener('click', () => {
    virtualScrollY = ZOOM_LOAD_FRAC * SCROLL_DRIVE_PX;
    dragTheta.target = 0;
    dragTheta.current = 0;
    dragTheta.velocity = 0;
    dragPhi.target = 0;
    dragPhi.current = 0;
    dragPhi.velocity = 0;
  });
  document.getElementById('hero')?.appendChild(resetBtn);

  // Cleanup on page unload
  window.addEventListener('unload', () => {
    cancelAnimationFrame(animFrameId);
    renderer.dispose();
  });
}

// ─── Grid lines ───────────────────────────────────────────────────────────────
function addGridLines(scene) {
  // The 2×2 grid lines (X and Y axes) are the primary visual — make them clear
  const gridMat = new THREE.LineBasicMaterial({ color: '#B8B0A6', transparent: true, opacity: 0.48 });
  const vertMat = new THREE.LineBasicMaterial({ color: '#B8B0A6', transparent: true, opacity: 0.38 });

  const step = 1;
  const count = 12;
  // Tiny nudge keeps background grid off the exact plane of the axis lines, preventing z-fighting
  const E = 0.005;

  // Horizontal plane (Y = E, not 0, to avoid z-fighting with X-axis divider at y=0)
  const hPoints = [];
  for (let i = -count; i <= count; i++) {
    hPoints.push(new THREE.Vector3(-count, E, i * step));
    hPoints.push(new THREE.Vector3(count, E, i * step));
    hPoints.push(new THREE.Vector3(i * step, E, -count));
    hPoints.push(new THREE.Vector3(i * step, E, count));
  }
  const hGeo = new THREE.BufferGeometry().setFromPoints(hPoints);
  scene.add(new THREE.LineSegments(hGeo, gridMat));

  // Vertical planes (X = E, not 0, to avoid z-fighting with Y-axis divider at x=0)
  const vPoints = [];
  for (let i = -count; i <= count; i++) {
    vPoints.push(new THREE.Vector3(E, i * step, -count));
    vPoints.push(new THREE.Vector3(E, i * step, count));
    vPoints.push(new THREE.Vector3(E, -count, i * step));
    vPoints.push(new THREE.Vector3(E, count, i * step));
  }
  const vGeo = new THREE.BufferGeometry().setFromPoints(vPoints);
  scene.add(new THREE.LineSegments(vGeo, vertMat));

  // Main 2×2 dividing axes — the primary visual structure, clearly visible
  const axisMat = new THREE.LineBasicMaterial({ color: '#8A8078', transparent: true, opacity: 0.55 });
  const axisPoints = [
    // Horizontal divider (Poetic ↔ Pragmatic)
    new THREE.Vector3(-AXIS_RANGE * 1.4, 0, 0), new THREE.Vector3(AXIS_RANGE * 1.4, 0, 0),
    // Vertical divider (Individual ↔ Institutional)
    new THREE.Vector3(0, -AXIS_RANGE * 1.4, 0), new THREE.Vector3(0, AXIS_RANGE * 1.4, 0),
  ];
  const axisGeo = new THREE.BufferGeometry().setFromPoints(axisPoints);
  scene.add(new THREE.LineSegments(axisGeo, axisMat));
}

// end of three-scene.js
