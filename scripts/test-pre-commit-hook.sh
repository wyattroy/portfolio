#!/bin/sh
#
# Regression test for .githooks/pre-commit.
#
#   npm run test:hook                      # tests the hook in this repo
#   sh scripts/test-pre-commit-hook.sh <path>   # tests any other copy
#
# The hook rewrites commits, so it has two jobs that pull in opposite
# directions: drop generated files from an ordinary commit, and keep its hands
# off a commit git is composing from another commit. Case 1 covers the first,
# cases 2 and 3 the second. Case 2 is the bug that reverted two sitemap lastmod
# dates on 2026-09-17.
#
# Everything happens in a throwaway repo under $TMPDIR. Nothing touches this one.
set -e

HOOK=$(cd "$(dirname "${1:-.githooks/pre-commit}")" && pwd)/$(basename "${1:-.githooks/pre-commit}")
[ -f "$HOOK" ] || { echo "no hook at $HOOK"; exit 2; }

T=$(mktemp -d)
trap 'cd /; rm -rf "$T"' EXIT
mkdir -p "$T/hooks"
cp "$HOOK" "$T/hooks/pre-commit"
chmod +x "$T/hooks/pre-commit"
cd "$T"

git init -q .
git config core.hooksPath hooks
git config user.email test@example.com
git config user.name test
git config commit.gpgsign false

# All three generated paths must exist: the hook restores them as one pathspec,
# and git fails the whole command if any one of them is missing.
printf 'base\n' > app.js
printf '<url>base</url>\n' > sitemap.xml
printf 'Allow: /\n' > robots.txt
mkdir -p p/one && printf 'base\n' > p/one/index.html
git add -A >/dev/null
ALLOW_GENERATED=1 git commit -qm base
BASE=$(git rev-parse HEAD)

fail=0
check() { # check <case> <expected sitemap> <expected page> <description>
  if [ "$(git show HEAD:sitemap.xml)" = "$2" ] && [ "$(git show HEAD:p/one/index.html)" = "$3" ]; then
    echo "PASS  case $1  $4"
  else
    echo "FAIL  case $1  $4"
    echo "               sitemap.xml: $(git show HEAD:sitemap.xml)"
    fail=1
  fi
}

# ── 1. an ordinary commit drops a local render, keeps the hand edit ──────────
printf 'edited by hand\n' > app.js
printf '<url>LOCAL RENDER</url>\n' > sitemap.xml
printf 'local render\n' > p/one/index.html
git add -A >/dev/null
git commit -qm "ordinary commit" >/dev/null 2>&1
check 1 '<url>base</url>' 'base' "ordinary commit: generated dropped, hand edit kept"
[ "$(git show HEAD:app.js)" = "edited by hand" ] || { echo "FAIL  case 1  hand edit was lost"; fail=1; }

# ── 2. a conflicted merge keeps what the Action committed on the other side ──
git checkout -q -b action "$BASE"
printf '<url>FROM THE ACTION</url>\n' > sitemap.xml
printf 'action render\n' > p/one/index.html
printf 'action change\n' > app.js          # conflicts with case 1's app.js
git add -A >/dev/null
ALLOW_GENERATED=1 git commit -qm "Action: re-render"
ACTION=$(git rev-parse HEAD)

git checkout -q -
git merge action >/dev/null 2>&1 || true   # conflicts in app.js
printf 'resolved\n' > app.js
git add app.js >/dev/null
git commit -q --no-edit >/dev/null 2>&1
check 2 '<url>FROM THE ACTION</url>' 'action render' "merge commit: the Action's files survived"

# ── 3. same for a conflicted cherry-pick ────────────────────────────────────
git checkout -q -b cherry "$BASE"
printf 'diverged\n' > app.js
git add -A >/dev/null
git commit -qm "diverge" >/dev/null 2>&1
git cherry-pick "$ACTION" >/dev/null 2>&1 || true
printf 'resolved\n' > app.js
git add app.js >/dev/null
git commit -q --no-edit >/dev/null 2>&1
check 3 '<url>FROM THE ACTION</url>' 'action render' "cherry-pick: the Action's files survived"

echo ""
[ $fail -eq 0 ] && echo "  All cases passed." || echo "  Some cases failed."
exit $fail
