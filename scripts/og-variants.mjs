/**
 * og-variants.mjs — layouts for the social preview image. See og-image.mjs.
 *
 * Every variant is a function of { FONTS, BASE, P } returning a full HTML page
 * sized exactly 1200x630. Colours and type come from style.css's design tokens,
 * so these stay in step with the site.
 */

const MU_MIRROR = 'assets/projects/mu-mirror/thumb.jpg';

const shell = (FONTS, body) => `<!doctype html><html><head><meta charset="utf-8"><style>
${FONTS}
:root{
  --ink:#1A1A18; --muted:#6B6862; --surface:#FAFAF9; --border:#E2E1DC; --grid:#D8D8D5;
  --accent:#5578A0; --q:#7FA3C0;
  --serif:'Source Serif 4',Georgia,serif; --sans:'DM Sans',system-ui,sans-serif; --mono:'DM Mono',monospace;
}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:630px;overflow:hidden}
body{font-family:var(--sans);-webkit-font-smoothing:antialiased}
.frame{position:relative;width:1200px;height:630px;overflow:hidden}
.bg{position:absolute;inset:0;background-size:cover;background-position:center}
.mono{font-family:var(--mono);text-transform:uppercase;letter-spacing:.26em}
</style></head><body>${body}</body></html>`;

/* ── A1 — Mu Mirror, dark radial bloom, name centred ───────────────────────
   Highest contrast of the three. The bloom does the legibility work so the
   dot grid can stay at full saturation everywhere else. */
const A1 = ({ FONTS, BASE }) => shell(FONTS, `
<div class="frame">
  <div class="bg" style="background-image:url('${BASE + MU_MIRROR}')"></div>
  <div style="position:absolute;inset:0;background:
     radial-gradient(ellipse 52% 70% at 50% 46%, rgba(12,9,7,.92) 0%, rgba(12,9,7,.82) 30%, rgba(12,9,7,.46) 60%, rgba(12,9,7,.07) 87%, rgba(12,9,7,0) 100%),
     radial-gradient(ellipse 118% 118% at 50% 50%, rgba(12,9,7,0) 38%, rgba(12,9,7,.46) 100%)"></div>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
    <div style="font-family:var(--serif);font-weight:700;font-size:206px;line-height:1;color:#fff;letter-spacing:-.025em;text-shadow:0 2px 44px rgba(0,0,0,.5)">Wyatt</div>
    <div class="mono" style="margin-top:34px;font-size:21px;color:rgba(255,255,255,.94);text-shadow:0 1px 18px rgba(0,0,0,.6)">wyattroy.com</div>
  </div>
</div>`);

/* ── A2 — Mu Mirror, cream bloom, ink type ─────────────────────────────────
   Same idea in the site's light palette: the bloom is --color-surface, so the
   card reads as a lit page rather than a darkened photo. */
const A2 = ({ FONTS, BASE }) => shell(FONTS, `
<div class="frame">
  <div class="bg" style="background-image:url('${BASE + MU_MIRROR}')"></div>
  <div style="position:absolute;inset:0;background:
     radial-gradient(ellipse 48% 66% at 50% 47%, rgba(250,250,249,.97) 0%, rgba(250,250,249,.92) 30%, rgba(250,250,249,.58) 60%, rgba(250,250,249,.10) 88%, rgba(250,250,249,0) 100%)"></div>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
    <div style="font-family:var(--serif);font-weight:700;font-size:206px;line-height:1;color:var(--ink);letter-spacing:-.025em">Wyatt</div>
    <div style="margin-top:30px;font-family:var(--sans);font-weight:300;font-size:28px;color:#403D36">Systems designer, educator, creative director</div>
  </div>
</div>`);

/* ── A3 — Mu Mirror at full strength, tight halo, name off-centre ──────────
   The smallest gradient of the three: a halo just big enough to hold the word,
   plus a bottom scrim for the caption. Most of the artwork survives untouched. */
const A3 = ({ FONTS, BASE }) => shell(FONTS, `
<div class="frame">
  <div class="bg" style="background-image:url('${BASE + MU_MIRROR}')"></div>
  <div style="position:absolute;inset:0;background:
     radial-gradient(ellipse 33% 40% at 38% 42%, rgba(14,10,8,.90) 0%, rgba(14,10,8,.70) 42%, rgba(14,10,8,.20) 74%, rgba(14,10,8,0) 100%)"></div>
  <div style="position:absolute;inset:0;background:linear-gradient(to top, rgba(14,10,8,.70) 0%, rgba(14,10,8,.14) 20%, rgba(14,10,8,0) 38%)"></div>
  <div style="position:absolute;left:76px;top:42%;transform:translateY(-52%)">
    <div style="font-family:var(--serif);font-weight:700;font-size:212px;line-height:.86;color:#fff;letter-spacing:-.03em;text-shadow:0 2px 40px rgba(0,0,0,.55)">Wyatt</div>
  </div>
  <div style="position:absolute;left:80px;right:80px;bottom:44px;display:flex;justify-content:space-between;align-items:baseline">
    <div class="mono" style="font-size:17px;color:rgba(255,255,255,.95)">Mu Mirror &nbsp;·&nbsp; 2024</div>
    <div class="mono" style="font-size:17px;color:rgba(255,255,255,.88)">wyattroy.com</div>
  </div>
</div>`);

/* ── B1 — the homepage graph, flattened into a card ────────────────────────
   Every published project placed by its real axes, sized and faded by year,
   exactly as the Three.js hero arranges them. */
const B1 = ({ FONTS, BASE, P }) => {
  const CX = 590, CY = 52, CW = 562, CH = 526;   // graph container
  const PL = 62, PT = 36;                        // plot inset, room for labels
  const PW = CW - PL * 2, PH = CH - PT * 2;
  const tiles = [...P].filter(p => p.axes).sort((a, b) => (a.year || 0) - (b.year || 0)).map(p => {
    const age = Math.max(0, Math.min(1, ((p.year || 2015) - 2015) / 11));
    const s = Math.round(26 + age * 30);
    const x = PL + p.axes.pragmatic * PW - s / 2;
    const y = PT + (1 - p.axes.institutional) * PH - s / 2;
    return `<img src="${BASE + encodeURI(p.thumb)}" style="position:absolute;left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${s}px;height:${s}px;object-fit:cover;border-radius:3px;opacity:${(0.5 + age * 0.5).toFixed(2)};outline:1.5px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.18)">`;
  }).join('');
  return shell(FONTS, `
<div class="frame" style="background:#fff">
  <div style="position:absolute;left:84px;top:0;bottom:0;width:470px;display:flex;flex-direction:column;justify-content:center">
    <div style="font-family:var(--serif);font-weight:700;font-size:94px;line-height:1;color:var(--ink);letter-spacing:-.022em">Wyatt Roy</div>
    <div style="font-family:var(--sans);font-weight:300;font-size:29px;line-height:1.35;color:#403D36;margin-top:22px">Systems designer, educator,<br>creative director.</div>
    <div style="height:1px;background:var(--border);width:280px;margin:32px 0 22px"></div>
    <div class="mono" style="font-size:15px;color:var(--muted);line-height:2">${P.length} projects, 2015&ndash;2026<br><span style="color:var(--accent)">wyattroy.com</span></div>
  </div>
  <div style="position:absolute;left:${CX}px;top:${CY}px;width:${CW}px;height:${CH}px">
    <div style="position:absolute;left:${PL + PW / 2}px;top:${PT - 14}px;height:${PH + 28}px;width:1px;background:var(--grid)"></div>
    <div style="position:absolute;top:${PT + PH / 2}px;left:${PL - 14}px;width:${PW + 28}px;height:1px;background:var(--grid)"></div>
    ${tiles}
    <div class="mono" style="position:absolute;left:0;right:0;top:0;text-align:center;font-size:12px;color:var(--muted)">Institutional</div>
    <div class="mono" style="position:absolute;left:0;right:0;bottom:0;text-align:center;font-size:12px;color:var(--muted)">Individual</div>
    <div class="mono" style="position:absolute;left:16px;top:50%;font-size:12px;color:var(--muted);transform:translateY(-50%) rotate(180deg);writing-mode:vertical-rl">Poetic</div>
    <div class="mono" style="position:absolute;right:16px;top:50%;font-size:12px;color:var(--muted);transform:translateY(-50%);writing-mode:vertical-rl">Pragmatic</div>
  </div>
</div>`);
};

/* ── B2 — the work, behind a plate ─────────────────────────────────────────
   A mosaic of every project thumbnail with the name on a surface-coloured
   card. Says "there is a lot here" before anyone reads a word. */
const B2 = ({ FONTS, BASE, P }) => {
  const cols = 9, rows = 6, cw = 1200 / 9, ch = 105;
  const list = [...P];
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  let cells = '';
  for (let i = 0; i < cols * rows; i++) {
    cells += `<img src="${BASE + encodeURI(list[i % list.length].thumb)}" style="width:${cw}px;height:${ch}px;object-fit:cover;display:block">`;
  }
  return shell(FONTS, `
<div class="frame" style="background:#151311">
  <div style="position:absolute;inset:0;display:grid;grid-template-columns:repeat(${cols},${cw}px);grid-auto-rows:${ch}px;filter:saturate(.98)">${cells}</div>
  <div style="position:absolute;inset:0;background:radial-gradient(ellipse 70% 80% at 50% 50%, rgba(20,17,15,.22) 0%, rgba(20,17,15,.12) 60%, rgba(20,17,15,.08) 100%)"></div>
  <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:716px;background:var(--surface);border-radius:12px;box-shadow:0 30px 84px rgba(0,0,0,.46), 0 2px 8px rgba(0,0,0,.18);padding:48px 56px 44px;text-align:center">
    <div style="font-family:var(--serif);font-weight:700;font-size:88px;line-height:1;color:var(--ink);letter-spacing:-.022em">Wyatt Roy</div>
    <div style="font-family:var(--sans);font-weight:300;font-size:26px;color:#403D36;margin-top:16px">Systems designer, educator, creative director</div>
    <div style="height:1px;background:var(--border);margin:24px auto 18px;width:160px"></div>
    <div class="mono" style="font-size:14px;color:var(--muted)">${P.length} projects &nbsp;·&nbsp; 2015&ndash;2026</div>
  </div>
</div>`);
};

/* ── B3 — the site's own type, nothing else ───────────────────────────────
   Legible at any size a platform decides to crop it to, and the only variant
   that never goes stale. Corner mark is the card quadrant indicator. */
const B3 = ({ FONTS }) => {
  const G = '#E2E1DC', Q = '#7FA3C0';
  const mark = (tl, tr, bl, br) => `<svg width="28" height="28" viewBox="0 0 20 20">
    <rect x="1" y="1" width="8" height="8" rx="1.5" fill="${tl}"/><rect x="11" y="1" width="8" height="8" rx="1.5" fill="${tr}"/>
    <rect x="1" y="11" width="8" height="8" rx="1.5" fill="${bl}"/><rect x="11" y="11" width="8" height="8" rx="1.5" fill="${br}"/></svg>`;
  return shell(FONTS, `
<div class="frame" style="background:var(--surface)">
  <div style="position:absolute;inset:34px;border:1px solid var(--border);border-radius:6px"></div>
  <div class="mono" style="position:absolute;left:88px;top:84px;font-size:14px;color:var(--muted)">wyattroy.com</div>
  <div style="position:absolute;left:88px;right:88px;top:50%;transform:translateY(-46%)">
    <div style="font-family:var(--serif);font-weight:700;font-size:140px;line-height:1;color:var(--ink);letter-spacing:-.026em">Wyatt Roy</div>
    <div style="font-family:var(--sans);font-weight:300;font-size:35px;color:#403D36;margin-top:24px">Systems designer, educator, creative director.</div>
  </div>
  <div style="position:absolute;left:88px;right:88px;bottom:124px;height:1px;background:var(--border)"></div>
  <div class="mono" style="position:absolute;left:88px;bottom:80px;font-size:14px;color:var(--muted)">XR &nbsp;·&nbsp; Creative technology &nbsp;·&nbsp; Institutional change &nbsp;·&nbsp; Making</div>
  <div style="position:absolute;right:88px;bottom:74px;display:flex;gap:10px">${mark(G,Q,G,G)}${mark(G,G,Q,G)}${mark(Q,G,G,G)}${mark(G,G,G,Q)}</div>
</div>`);
};

/* ── B2 without the plate: "Wyatt Roy" set straight onto the mosaic ────────
   White type on 52 thumbnails of wildly different brightness needs something
   under it. These three differ only in what that something is. Shared parts
   live in mosaic() and lockup() so the comparison is honest. */

const mosaic = (BASE, P, cols = 9, rows = 6) => {
  const cw = 1200 / cols, ch = 105;
  const list = [...P];
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  let cells = '';
  for (let i = 0; i < cols * rows; i++) {
    cells += `<img src="${BASE + encodeURI(list[i % list.length].thumb)}" style="width:${cw}px;height:${ch}px;object-fit:cover;display:block">`;
  }
  return `<div style="position:absolute;inset:0;display:grid;grid-template-columns:repeat(${cols},${cw}px);grid-auto-rows:${ch}px;filter:saturate(.98)">${cells}</div>`;
};

const lockup = (P, shadow) => `
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
    <div style="font-family:var(--serif);font-weight:700;font-size:132px;line-height:1;color:#fff;letter-spacing:-.024em;text-shadow:${shadow}">Wyatt Roy</div>
    <div style="margin-top:24px;font-family:var(--sans);font-weight:300;font-size:30px;color:rgba(255,255,255,.96);text-shadow:${shadow}">Systems designer, educator, creative director</div>
    <div class="mono" style="margin-top:26px;font-size:14px;color:rgba(255,255,255,.88);text-shadow:${shadow}">${P.length} projects &nbsp;·&nbsp; 2015&ndash;2026</div>
  </div>`;

/* B2-bloom — a soft dark oval behind the lockup, mosaic bright everywhere else */
const B2bloom = ({ FONTS, BASE, P }) => shell(FONTS, `
<div class="frame" style="background:#151311">
  ${mosaic(BASE, P)}
  <div style="position:absolute;inset:0;background:radial-gradient(ellipse 55% 52% at 50% 50%, rgba(16,13,11,.86) 0%, rgba(16,13,11,.76) 34%, rgba(16,13,11,.42) 64%, rgba(16,13,11,.06) 90%, rgba(16,13,11,0) 100%)"></div>
  ${lockup(P, '0 2px 30px rgba(0,0,0,.5)')}
</div>`);

/* B2-band — a horizontal scrim across the middle third, top and bottom rows clear */
const B2band = ({ FONTS, BASE, P }) => shell(FONTS, `
<div class="frame" style="background:#151311">
  ${mosaic(BASE, P)}
  <div style="position:absolute;inset:0;background:linear-gradient(to bottom, rgba(16,13,11,0) 14%, rgba(16,13,11,.66) 34%, rgba(16,13,11,.72) 50%, rgba(16,13,11,.66) 66%, rgba(16,13,11,0) 86%)"></div>
  ${lockup(P, '0 2px 24px rgba(0,0,0,.45)')}
</div>`);

/* B2-bare — no scrim at all, just a heavy shadow. Brightest mosaic, and the
   type has to survive whatever thumbnail happens to land under it. */
const B2bare = ({ FONTS, BASE, P }) => shell(FONTS, `
<div class="frame" style="background:#151311">
  ${mosaic(BASE, P)}
  <div style="position:absolute;inset:0;background:rgba(16,13,11,.20)"></div>
  ${lockup(P, '0 2px 10px rgba(0,0,0,.85), 0 0 46px rgba(0,0,0,.75), 0 1px 3px rgba(0,0,0,.6)')}
</div>`);

export const VARIANTS = { A1, A2, A3, B1, B2, B3, B2bloom, B2band, B2bare };
