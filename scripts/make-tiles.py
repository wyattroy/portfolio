#!/usr/bin/env python3
"""
make-tiles.py — build small tile images for the index page.

The index is the only page that loads every project's image at once:
three-scene.js requests a texture for all 52 projects during the hero, before
the card wall is even reached. Those same files are also each project's `hero`
and lightbox image, where full resolution genuinely matters — so they can't
simply be shrunk in place. This builds a separate downscaled copy for the
index and repoints `thumbnail` at it, leaving `hero` and `images[]` on the
originals so project pages and the lightbox are untouched.

Sizing follows what three-scene.js can actually display. It centre-crops each
texture to TILE_FACE_AR and draws it into a TEX_TARGET_W-wide canvas, so any
pixel beyond that is decoded and thrown away. Tiles are sized so that crop
still lands exactly on the cap — no more, no less. Cards render ~400 CSS px
wide, so the resulting >=1024px width also covers them at 2x DPR.

Animated GIFs are skipped: the graph only ever shows their first frame, but the
card wall does animate them, so converting is a design decision rather than a
mechanical one.

Usage:  python3 scripts/make-tiles.py [--dry-run]
Requires Pillow  (pip install Pillow)
"""

import json
import os
import sys

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "projects.json")

# Mirrors three-scene.js: TEX_TARGET_W / TILE_FACE_AR.
TEX_TARGET_W = 1024
TILE_FACE_AR = 1.6
TEX_TARGET_H = round(TEX_TARGET_W / TILE_FACE_AR)

JPEG_QUALITY = 88
# Not worth a second file (and a second cache entry) for a trivial saving.
MIN_SAVING_BYTES = 20 * 1024
MIN_SAVING_RATIO = 0.15

SUFFIX = "-tile"


def target_size(w, h):
    """Smallest size that still fills the graph's cropped texture exactly.

    three-scene.js keeps full height and crops width when the source is wider
    than the tile face, and keeps full width and crops height otherwise — so
    the dimension that survives the crop is the one that has to reach the cap.
    """
    ar = w / h
    if ar > TILE_FACE_AR:
        out_h = TEX_TARGET_H
        out_w = round(out_h * ar)
    else:
        out_w = TEX_TARGET_W
        out_h = round(out_w / ar)
    # Never upscale.
    if out_w >= w or out_h >= h:
        return None
    return out_w, out_h


def has_alpha(im):
    if im.mode not in ("RGBA", "LA", "P"):
        return False
    return im.convert("RGBA").getchannel("A").getextrema()[0] < 255


def main():
    dry = "--dry-run" in sys.argv
    raw = open(DATA, encoding="utf-8").read()
    projects = json.loads(raw)

    made = skipped = 0
    before_total = after_total = 0

    for p in projects:
        thumb = p.get("thumbnail")
        if not thumb:
            continue

        stem, ext = os.path.splitext(thumb)
        if stem.endswith(SUFFIX):
            continue  # already repointed at a tile
        if ext.lower() == ".gif":
            skipped += 1
            continue  # animation is a design call, not a mechanical one

        src = os.path.join(ROOT, thumb.lstrip("/"))
        if not os.path.exists(src):
            continue

        try:
            im = Image.open(src)
            im.load()
        except Exception as err:
            print(f"  ! could not read {thumb}: {err}")
            continue

        size = target_size(*im.size)
        if size is None:
            skipped += 1
            continue

        alpha = has_alpha(im)
        out_ext = ".png" if alpha else ".jpg"
        out_rel = f"{stem}{SUFFIX}{out_ext}"
        out_abs = os.path.join(ROOT, out_rel.lstrip("/"))

        resized = im.convert("RGBA" if alpha else "RGB").resize(size, Image.LANCZOS)
        if alpha:
            params = dict(format="PNG", optimize=True)
        else:
            params = dict(
                format="JPEG", quality=JPEG_QUALITY, subsampling=0,
                optimize=True, progressive=True,
            )

        import io
        buf = io.BytesIO()
        resized.save(buf, **params)
        data = buf.getvalue()

        before = os.path.getsize(src)
        saving = before - len(data)
        if saving < MIN_SAVING_BYTES or saving / before < MIN_SAVING_RATIO:
            skipped += 1
            continue

        if not dry:
            open(out_abs, "wb").write(data)
        p["thumbnail"] = out_rel
        made += 1
        before_total += before
        after_total += len(data)
        print(
            f"  {p['id'][:28]:30} {im.size[0]}x{im.size[1]} -> {size[0]}x{size[1]}"
            f"   {before/1024:6.0f}K -> {len(data)/1024:5.0f}K"
        )

    if not dry:
        out = json.dumps(projects, indent=2, ensure_ascii=False) + "\n"
        open(DATA, "w", encoding="utf-8").write(out)

    print(f"\n{made} tiles built, {skipped} left on their original file")
    if made:
        print(
            f"index thumbnail payload: {before_total/1024/1024:.1f} MB"
            f" -> {after_total/1024/1024:.1f} MB"
            f"  ({100*(before_total-after_total)/before_total:.0f}% smaller)"
        )
    if dry:
        print("(dry run — nothing written)")


if __name__ == "__main__":
    main()
