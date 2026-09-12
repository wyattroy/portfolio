# Handoff — mobile search fix + index image weight

Written at the end of a Claude Code **cloud** session, for a **local** session to
pick up. Everything below is merged to `main` and live unless marked OPEN.

## Open items (start here)

1. **Wyatt's cropped `assets/projects/gingerbread-amphora/portrait.jpg` is not on
   `main` yet.** He edited it locally and it was still stuck on his laptop when the
   cloud session ended. If he ran `git push origin HEAD` it is on
   `claude/mobile-search-visibility-gft27z`; otherwise it is only in his working tree.
   Check with:
   ```bash
   git fetch origin
   git rev-parse origin/main:assets/projects/gingerbread-amphora/portrait.jpg
   git rev-parse origin/claude/mobile-search-visibility-gft27z:assets/projects/gingerbread-amphora/portrait.jpg
   ```
   If those two SHAs differ, the crop is on the branch and just needs merging to `main`.
   If they match and are `0817d07b02aa15adcbe8c0d2116423e0d8e90550`, the crop has not
   been committed at all — it is still only in his working tree.

2. **Branch cleanup.** `claude/mobile-search-visibility-gft27z` is fully merged into
   `main` as of `564011d`. Once the crop is resolved it can be deleted.

3. **Delete this file** once read — it is served publicly at `wyattroy.com/HANDOFF.md`.

## Why the cloud session got painful

The cloud container held its **own clone**, separate from the laptop. Nothing crossed
between them except through GitHub, which meant every locally-edited image needed a
commit and push before the agent could see it. A local session removes this entirely.

Related trap that cost several rounds: the **prerender workflow commits back to `main`
on every push** (`.github/workflows/prerender.yml`). Pull immediately before pushing, or
the push is rejected as non-fast-forward. Also confirm the branch you are on before
`git push origin main` — `git pull --rebase origin main` rebases the *current* branch,
so on a feature branch your local `main` silently stays stale.

## What shipped

Eight commits, `1dd829f`..`564011d`, all on `main`.

### 1. Mobile search was unusable (the original task)

Typing in the nav search filtered the grid, but **no result was ever on screen**. Two
independent causes, measured at 390x664:

- **413px of chrome** sat between the top of `#work` and the first card (heading,
  newsletter signup, tag chips, sort control). Focus scrolled `#work` to the top of the
  *layout* viewport, leaving the grid at y=413. The on-screen keyboard covers the bottom
  ~300px, so the visible band ends at y=364. Every result was behind the keyboard.
- **A narrow query shortened the page below the scroll distance needed.** With a
  no-match query the grid needed scrollY=814 but the page only scrolled to 707 —
  physically unreachable.

Fixes, all scoped inside the existing `@media (max-width: 768px)`:
- `body.search-active` (set in `main.js`) collapses the chrome from 413px to 156px.
- The reveal scroll targets `#project-grid` under the fixed nav, not the top of `#work`.
- `min-height` on the grid guarantees scroll runway.

**Desktop is deliberately untouched** — verified by tests that stay green on both sides
of the change.

### 2. Lag and nav flicker that the fix exposed

Bringing the grid on screen surfaced two costs that were hidden below the fold:

- `renderGrid()` cleared and rebuilt every card on each keystroke, creating fresh
  `<img>` elements. Below the fold those were `loading="lazy"` and never fetched; on
  screen they were ~5.2MB per render. **Fix:** cards are built once and cached by
  project id in `project-list.js` (`_cardCache` / `getCard`), then re-appended. Safe
  because cards render always-expanded — there is no per-render state to reset.
- The search bar visibly detached and snapped back. `#main-nav` is re-pinned to
  `visualViewport.offsetTop`, which churns for the whole duration of a smooth scroll
  while the keyboard is open. **Fix:** the reveal scroll is an instant jump, and the pin
  handler coalesces to one write per frame.

### 3. Index image weight: 30.4MB -> 6.3MB

**The key architectural fact:** `three-scene.js:263` loads a texture for *every*
project during the hero, before the card wall is reached. So the index pays for all 52
thumbnails on first visit. The card wall then hits browser cache and costs nothing extra
— verified with CDP, 52 URLs, zero duplicate requests.

**The second key fact:** `three-scene.js:167` caps every texture at `TEX_TARGET_W = 1024`
(centre-cropped to 1.6:1, drawn into a 1024x640 canvas). Anything larger is downloaded,
decoded and discarded. There is no benefit to source images above that, even at max zoom.

Three passes:
- **PNG re-encode.** 15 files were named `.jpg` but contained PNG data. 12 re-encoded to
  real JPEG at *identical dimensions* (q90, 4:4:4): 8.4MB -> 1.8MB at PSNR 39.7-50.9dB.
  Three skipped — `unfolding`, `tonos`, `typewriter` have genuine transparency, and the
  3D tile crossfades over its flat colour, so a JPEG matte would change them.
- **Index tiles.** `scripts/make-tiles.py` builds a downscaled `*-tile.jpg` sized so the
  graph's crop lands exactly on the cap, and repoints `thumbnail` at it. **`hero` and
  `images[]` keep the originals** — for ~30 projects the thumbnail is also the hero and a
  lightbox image, where full resolution is the whole point. Never upscales, so only 13 of
  54 qualified.
- **GIF stills.** Three animated GIFs were 12.6MB — two thirds of the index. The graph
  only ever showed one frozen frame anyway. Frames chosen for how they read as stills
  live in `GIF_STILL_FRAME` in `make-tiles.py`. The GIFs stay on `hero`/`images[]`, so
  detail pages and the lightbox still animate.

`scripts/prerender.mjs` now prefers `hero` for `og:image`, since `thumbnail` is a
prism-face-shaped tile.

### 4. Gingerbread Amphora images

`gingerbread-amphora-hero-wide.jpg` (2336x1423) is now the page hero **and**, via a
1051x640 tile, the card and 3D graph tile. Its 1.64 aspect ratio nearly matches the 1.6
tile face. `hero-black.jpg` and the old portrait `thumb.jpg` were removed and deleted.

## Working on this code

```bash
python3 -m http.server 8000     # the site is static, no build step
python3 scripts/make-tiles.py   # after adding a project; needs `pip install Pillow`
```

`make-tiles.py` is idempotent — it skips anything already at or below the graph's cap,
and skips any animated GIF without a `GIF_STILL_FRAME` entry rather than freezing it on
an arbitrary frame.

### Gotchas found the hard way

- `data/projects.json` round-trips byte-identically at `json.dumps(indent=2,
  ensure_ascii=False) + "\n"`. Safe to rewrite programmatically.
- Project data is in **two** places: `data/projects.json` and
  `data/projects/<id>.json`. Both carry `hero`/`thumbnail`/`images`. Update both.
- `p/<id>/index.html` is prerendered and committed; CI regenerates it on push to `main`.
- `assets/projects/sound-ag/img6.jpg` and `assets/projects/polycam/thumb.jpg` are
  referenced but missing. Pre-existing, not introduced here. Card thumbs have an
  `onerror` placeholder fallback.

### Verifying

Desktop DevTools device emulation **does not reproduce the original bug** — it resizes
the viewport but does not shrink the visual viewport the way an on-screen keyboard does.
Mobile search behaviour needs a real phone. Everything else is checkable in Playwright
(`node_modules/playwright`, Chromium at `/opt/pw-browsers/chromium` in the cloud
container; locally just use the normal install).

The final state passed 26 checks across three suites — mobile search visibility, card
reuse / instant scroll, and tile payload. Those suites were scratch files in the cloud
container and were **not committed**; rewrite them if you want them.
