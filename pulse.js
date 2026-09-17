/**
 * pulse.js — the glow that breathes behind the top-ranked project tiles.
 *
 * Everything that shapes the pulse is in PULSE below. The "Pulse Tuner" artifact
 * uses this same code and exports a PULSE block you can paste straight over it.
 *
 * The glow is a flat plane parented to its tile, just behind it, so it tilts,
 * scales and gets covered by nearer cards exactly like the tile does. No DOM,
 * no camera-facing sprite. THREE is passed in so this file has no imports and
 * can be copied into the tuner as-is.
 */

// Tuned by Wyatt in the Pulse Tuner, 2026-09-16
export const PULSE = {
  count: 3,             // how many top-ranked projects pulse
  periodMs: 3800,       // one full breath, including any rest
  opacityMin: 0.3,     // glow opacity at the bottom of a breath
  opacityMax: 1,     // …and at the top
  curve: 1,             // breath shape: 1 = smooth sine, >1 = brief peaks, <1 = long highs
  holdAtPeak: 0,        // share of each breath held at full brightness (0–0.8)
  restFrac: 0,          // share of each period held at the minimum before the next breath (0–0.8)
  staggerMs: 950,       // phase offset between the pulsing projects, so they don't breathe in unison
  spreadPx: 14,         // glow blur radius, in texture px (the tile face is 160 px wide)
  size: 2.45,            // glow plane size as a multiple of the tile; raise it if a wide spread gets clipped
  coreAlpha: 0.6,         // strength of the solid gradient behind the tile, which feeds the glow
  edgeWidth: 5,         // a hot outline hugging the tile edge, in texture px (0 = none)
  colorA: '#f5d42e',    // gradient start
  colorB: '#f7eac5',    // gradient end
  glowColor: '#f9e2a4', // colour of the blur and outline
  gradientAngle: 135,   // degrees
  cornerRadius: 0,      // texture px
  scaleAmount: 0.065,       // how much the glow swells at the top of a breath (0.1 = 10%)
  hoverBoost: 2.2,        // opacity multiplier while the tile is hovered
  ringOpacity: 0.49,       // an outline that ripples outward at the start of each breath (0 = none)
};

// Game-feel hop on the same tiles, timed to their pulse. The tile is a little
// larger at rest, then gets a springy kick each breath: it overshoots, wobbles
// back, squashes and stretches with its speed, and rocks slightly. The glow is
// parented to the tile, so it bounces along.
export const BOUNCE = {
  sizeBoost: 1.15,      // resting size of a highlighted tile vs the others
  amount: 0.1,          // strength of each kick (0.1 ≈ a 10% hop before the spring settles)
  at: 0,                // when in the breath the kick lands: 0 = breath starts, 0.5 = brightest
  hops: 1,              // kicks per breath (2 = a double-bounce)
  hopSpacing: 0.12,     // gap between those kicks, as a share of the breath
  hopDecay: 0.5,        // each extra kick's strength relative to the one before
  stiffness: 0.12,      // spring pull back to rest: higher = quicker, snappier
  damping: 0.12,        // spring friction: lower = more overshoot and wobble
  squash: 1.5,          // squash & stretch from the tile's speed (0 = keeps its shape)
  wobbleDeg: 1.5,       // how far the tile rocks on each kick, in degrees
};

const RECT_W = 160;           // tile face in texture px
const RECT_H = 100;
const RING_GROW = 0.3;        // the ripple grows to 1.3× by the time it fades out

// 0 → 1 → 0 over one period, shaped by curve / holdAtPeak / restFrac
export function breath(t, cfg) {
  const active = Math.max(0.05, 1 - cfg.restFrac);
  if (t >= active) return 0;
  const u = t / active;
  const hold = Math.min(0.8, Math.max(0, cfg.holdAtPeak));
  const ramp = (1 - hold) / 2;
  let v;
  if (u < ramp) v = 0.5 - 0.5 * Math.cos(Math.PI * u / ramp);
  else if (u < ramp + hold) v = 1;
  else v = 0.5 + 0.5 * Math.cos(Math.PI * (u - ramp - hold) / ramp);
  return Math.pow(Math.max(0, v), cfg.curve);
}

// Where the outward ripple is: { scale, opacity }, or null between ripples
export function ripple(t, cfg) {
  if (!cfg.ringOpacity) return null;
  const active = Math.max(0.05, 1 - cfg.restFrac);
  const u = t / active;
  if (u >= 0.6) return null;
  const p = u / 0.6;
  return { scale: 1 + RING_GROW * (1 - Math.pow(1 - p, 3)), opacity: cfg.ringOpacity * (1 - p) };
}

function margin(cfg) {
  return Math.max(0, (RECT_W * (cfg.size - 1)) / 2);
}

// World size of the glow plane for a 1.6 × 1.0 tile
export function planeSize(cfg) {
  const m = margin(cfg);
  return { w: 1.6 * (RECT_W + 2 * m) / RECT_W, h: 1.0 * (RECT_H + 2 * m) / RECT_H };
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// { glow, ring } canvas textures for the current settings
export function buildPulseTextures(THREE, cfg) {
  const m = margin(cfg);
  const W = Math.round(RECT_W + 2 * m), H = Math.round(RECT_H + 2 * m);
  const x = (W - RECT_W) / 2, y = (H - RECT_H) / 2;

  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = W;
  glowCanvas.height = H;
  const ctx = glowCanvas.getContext('2d');
  const a = (cfg.gradientAngle * Math.PI) / 180;
  const cx = W / 2, cy = H / 2, len = Math.hypot(RECT_W, RECT_H) / 2;
  const g = ctx.createLinearGradient(cx - Math.cos(a) * len, cy - Math.sin(a) * len, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
  g.addColorStop(0, cfg.colorA);
  g.addColorStop(1, cfg.colorB);
  ctx.globalAlpha = cfg.coreAlpha;
  ctx.shadowColor = cfg.glowColor;
  ctx.shadowBlur = cfg.spreadPx;
  ctx.fillStyle = g;
  roundRect(ctx, x, y, RECT_W, RECT_H, cfg.cornerRadius);
  ctx.fill();
  if (cfg.edgeWidth > 0) {
    ctx.globalAlpha = 1;
    ctx.shadowBlur = cfg.spreadPx / 2;
    ctx.strokeStyle = cfg.glowColor;
    ctx.lineWidth = cfg.edgeWidth;
    roundRect(ctx, x - cfg.edgeWidth / 2, y - cfg.edgeWidth / 2, RECT_W + cfg.edgeWidth, RECT_H + cfg.edgeWidth, cfg.cornerRadius);
    ctx.stroke();
  }

  const ringCanvas = document.createElement('canvas');
  ringCanvas.width = W;
  ringCanvas.height = H;
  const rctx = ringCanvas.getContext('2d');
  rctx.shadowColor = cfg.glowColor;
  rctx.shadowBlur = Math.max(4, cfg.spreadPx / 2);
  rctx.strokeStyle = cfg.glowColor;
  rctx.lineWidth = 3;
  roundRect(rctx, x, y, RECT_W, RECT_H, cfg.cornerRadius);
  rctx.stroke();

  const make = c => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { glow: make(glowCanvas), ring: make(ringCanvas) };
}

// Adds glow (+ ripple) planes behind a tile mesh. `tileDepth` is the tile's thickness.
export function attachPulse(THREE, mesh, textures, cfg, tileDepth, phaseMs) {
  const { w, h } = planeSize(cfg);
  const geo = new THREE.PlaneGeometry(w, h);
  const plane = map => {
    const p = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map, transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide,
    }));
    p.position.z = -(tileDepth / 2 + 0.01);
    mesh.add(p);
    return p;
  };
  mesh.userData.pulse = { glow: plane(textures.glow), ring: plane(textures.ring), phase: phaseMs };
}

// Per frame. `op` is the tile's own opacity (entry fade × year filter).
export function updatePulse(pulse, cfg, now, op, hovered, reducedMotion) {
  const t = pulsePhase(pulse, cfg, now);
  const b = reducedMotion ? 0.5 : breath(t, cfg);
  const boost = hovered ? cfg.hoverBoost : 1;
  pulse.glow.material.opacity = Math.min(1, (cfg.opacityMin + (cfg.opacityMax - cfg.opacityMin) * b) * boost) * op;
  const s = 1 + (reducedMotion ? 0 : cfg.scaleAmount * b);
  pulse.glow.scale.set(s, s, 1);
  const r = reducedMotion ? null : ripple(t, cfg);
  pulse.ring.visible = !!r;
  if (r) {
    pulse.ring.scale.set(r.scale, r.scale, 1);
    pulse.ring.material.opacity = Math.min(1, r.opacity) * op;
  }
}

// Where a pulsing tile is in its breath, 0–1 — the pulse and bounce share this clock
export function pulsePhase(pulse, cfg, now) {
  return ((((now + pulse.phase) % cfg.periodMs) + cfg.periodMs) % cfg.periodMs) / cfg.periodMs;
}

export function createBounce() {
  return { x: 0, v: 0, rot: 0, rotV: 0, lastT: null, side: 1, carry: 0 };
}

// Advances the bounce spring by `dt` ms and returns { sx, sy, rot } for the tile.
// The spring steps at a fixed 60 Hz, so it feels the same at any frame rate.
export function updateBounce(state, cfg, t, dt, reducedMotion) {
  if (reducedMotion) return { sx: cfg.sizeBoost, sy: cfg.sizeBoost, rot: 0 };

  // A kick lands whenever the breath phase crosses one of the hop times
  if (state.lastT !== null) {
    const crossed = at => (state.lastT <= t ? at > state.lastT && at <= t : at > state.lastT || at <= t);
    let strength = cfg.amount;
    for (let k = 0; k < Math.max(1, Math.round(cfg.hops)); k++) {
      if (crossed((cfg.at + k * cfg.hopSpacing) % 1)) {
        state.v += strength;
        state.rotV += (cfg.wobbleDeg * Math.PI / 180) * 0.35 * state.side;
        state.side = -state.side;
      }
      strength *= cfg.hopDecay;
    }
  }
  state.lastT = t;

  state.carry += Math.min(dt, 100);
  while (state.carry >= 1000 / 60) {
    state.carry -= 1000 / 60;
    state.v += -state.x * cfg.stiffness;
    state.v *= 1 - cfg.damping;
    state.x += state.v;
    state.rotV += -state.rot * cfg.stiffness;
    state.rotV *= 1 - cfg.damping;
    state.rot += state.rotV;
  }

  const stretch = cfg.squash * state.v;
  return {
    sx: cfg.sizeBoost * (1 + state.x - stretch),
    sy: cfg.sizeBoost * (1 + state.x + stretch),
    rot: state.rot,
  };
}
