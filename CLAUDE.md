# wyattroy-portfolio

Static site on GitHub Pages. No framework: HTML, CSS, vanilla JS, Three.js.

## Generated files are owned by CI — never commit them

`scripts/prerender.mjs` builds these, and the GitHub Action in
`.github/workflows/prerender.yml` is the only thing that commits them:

- `p/**` — the 52 static project pages
- `sitemap.xml`, `robots.txt`
- the block between the `PRERENDER:LINKS` markers in `index.html`

Edit the sources (`data/projects/*.json`, `data/projects.json`, `project.html`,
`style.css`), push those, and the Action rebuilds the output a minute or two later.

**Why.** If a local render also commits its output, two things write the same
generated files, and whichever one rendered from an out-of-date copy silently
reverts the other's work — this cost a full rebuild on 2026-09-15. A local render
is also wrong by construction: sitemap `<lastmod>` reads each data file's *commit
date*, and that commit does not exist yet at the moment you render.

`npm run prerender` locally to check your work is fine and encouraged. Just don't
commit what it produces. `.githooks/pre-commit` drops those paths automatically,
so a stray `git add -A` is safe. It stands aside during a merge, cherry-pick,
revert or rebase, where those paths carry the other side's committed output
rather than your render. `npm run test:hook` covers both behaviours.

One-time setup in a fresh clone (the hook lives in the repo, but git has to be
pointed at it):

```bash
git config core.hooksPath .githooks
```

## Before you push

`git fetch` first. The Action pushes its own commits, so `main` moves without you.

## Other notes

- `editor.html` is a browser-based CMS for the project JSON — Wyatt writes copy
  there against a local server, not by hand-editing JSON.
- `admin.html` + `supabase-setup.sql` back the old comment wall. The Reactions
  section was switched off on 2026-09-15 (commented out in `project.html`, near
  `renderCommentSection`) and the Supabase table is frozen. Left in place so it
  can be turned back on.
- Email addresses are assembled in JS at runtime, never written into HTML.
