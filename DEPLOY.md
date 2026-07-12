# Deployment Guide

## Where it lives

- **Live site:** https://investingbuffalo.com (custom domain, registered and DNS-managed through Netlify)
- **Netlify default subdomain:** https://compound-interest-calculator-611.netlify.app (still works, redirects aren't needed since both point at the same site)
- **Netlify admin:** https://app.netlify.com/projects/compound-interest-calculator-611
- **Source code:** https://github.com/alanmillbrow/compound-interest-calculator

## Site structure

This is a multi-page static site — plain HTML/CSS/JS, no framework, no build step:

- `index.html` — homepage, lists available tools
- `investment-return-calculator/index.html` + `investment-return-calculator/script.js` — the
  calculator, served at `/investment-return-calculator/`
- `style.css` — shared design system (paper/ink theme) used by every page. Referenced via the
  root-relative path `/style.css` so it resolves correctly no matter how deep a page's URL is.
- `theme.js` — shared dark/light toggle logic (a small subset of what the calculator's own
  `script.js` does), used by pages that don't need the calculator's logic. Both pages read/write
  the same `localStorage` key so the theme choice persists across the whole site.
- `TableV2Background.jpg` — shared background texture, referenced from `style.css`.

To add a new page/tool: create a new folder (e.g. `retirement-calculator/index.html`), link
`/style.css` and either `/theme.js` (if it's a simple page) or its own script, and add a row to
the "Tools" table on the homepage (`index.html`) linking to it.

## Why this setup

The app is a static site (plain HTML/CSS/JS, no build step, no backend), so it only needs a
static file host. Netlify was chosen over Vercel/Cloudflare Pages/GitHub Pages because:

- Zero-config for plain static sites (no framework detection needed).
- CLI deploy works straight from a local folder — no git repo required to get a URL.
- Free tier (100GB bandwidth/mo) is far more than a personal tool like this needs.
- Free HTTPS and easy custom domain support later, if wanted.

GitHub was also set up (separately from hosting) for version history and so future edits can
be pushed and redeployed easily.

## Redeploying after changes

Two ways to ship an update, pick whichever you prefer:

### Option A — push to GitHub, Netlify deploys automatically (default going forward)
Netlify is linked to the GitHub repo (`alanmillbrow/compound-interest-calculator`, branch `main`)
via a read-only SSH deploy key on the repo, plus a webhook that triggers a build on every push.
Just:
```bash
git push
```
and the live site updates automatically within a minute or so. Check build status at
https://app.netlify.com/projects/compound-interest-calculator-611/deploys

### Option B — manual CLI deploy
```bash
cd "/Users/alanmillbrow/Internal/Claude Projects/Project 01"
netlify deploy --prod --dir=.
```
(Requires the Netlify CLI on your PATH and to be logged in via `netlify login`.)

## Pushing code changes to GitHub
```bash
cd "/Users/alanmillbrow/Internal/Claude Projects/Project 01"
git add -A
git commit -m "describe the change"
git push
```

## Tooling notes

This machine didn't have Node.js, npm, Homebrew, or the GitHub CLI installed. To do the deploy
without modifying the system, a self-contained Node.js binary and the `gh` binary were downloaded
into a scratch/temp directory (not part of the project) and used only for the deploy commands —
nothing was installed system-wide. If you want `netlify`/`gh` available permanently in your own
terminal, install them normally, e.g. via Homebrew:
```bash
brew install node gh
npm install -g netlify-cli
```
