#!/usr/bin/env bash
# optimize-thumbs.sh
# Creates thumb-sm.jpg (400×225, quality 75) from each project's thumb.jpg.
# Uses macOS `sips` — no dependencies required.
# Run from the project root: bash scripts/optimize-thumbs.sh

set -euo pipefail
ASSETS="$(dirname "$0")/../assets/projects"

count=0
skip=0

for dir in "$ASSETS"/*/; do
  src="$dir/thumb.jpg"
  dst="$dir/thumb-sm.jpg"
  [ -f "$src" ] || continue

  # Skip if already up to date
  if [ -f "$dst" ] && [ "$dst" -nt "$src" ]; then
    ((skip++)) || true
    continue
  fi

  # sips: resize to fit within 400×225, keeping aspect ratio, then recompress
  sips -Z 400 --setProperty formatOptions 75 --setProperty format jpeg \
    "$src" --out "$dst" > /dev/null 2>&1

  echo "  ✓ $(basename "$dir")/thumb-sm.jpg"
  ((count++)) || true
done

echo ""
echo "Done: $count created, $skip already up-to-date."
