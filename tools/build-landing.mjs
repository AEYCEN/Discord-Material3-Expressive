#!/usr/bin/env node
// Generate public/index.html - the landing page served at the site root.
//
// Nothing here is hand-maintained: the metadata comes from src/start/_index.scss
// (same source as the @import URL users paste) and the colour palette is the
// theme's own :root token block, lifted out of the compiled stylesheet. The page
// therefore cannot drift from the theme it advertises.
//
// Run after build:css, which produces build/main.css.

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';

const START = new URL('../src/start/_index.scss', import.meta.url);
const COMPILED = new URL('../build/main.css', import.meta.url);
const OUT = new URL('../public/index.html', import.meta.url);
const LOGO = 'aeycen.png'; // assets/<LOGO> is copied into public/ next to index.html

/** read `$name: 'value';` out of the Sass metadata file */
function sassVars(src) {
  const out = {};
  for (const m of src.matchAll(/^\$([\w-]+):\s*'([^']*)'\s*;/gm)) out[m[1]] = m[2];
  return out;
}

/** lift the first `:root { … }` block out of the compiled CSS */
function rootBlock(css) {
  const i = css.indexOf(':root {');
  if (i === -1) throw new Error('no :root block in build/main.css - run build:css first');
  const j = css.indexOf('}', i);
  if (j === -1) throw new Error(':root block is not closed');
  return css.slice(i, j + 1);
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const v = sassVars(await readFile(START, 'utf8'));
for (const k of ['themeName', 'version', 'desc', 'repo', 'website', 'mainImport']) {
  if (!v[k]) throw new Error(`missing $${k} in src/start/_index.scss`);
}
const tokens = rootBlock(await readFile(COMPILED, 'utf8'));

const importUrl = `${v.website}/${v.mainImport}`;
const authorUrl = `https://github.com/${v.repo.replace(/.*github\.com\//, '').split('/')[0]}`;
const quickCssFile = `${v.repo}/blob/main/${v.themeName.replace(/\s+/g, '-')}-v1-Vencord.css`;
const rawQuickCss = `${v.repo.replace('github.com', 'raw.githubusercontent.com')}/main/${v.themeName.replace(/\s+/g, '-')}-v1-Vencord.css`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(v.themeName)} for Discord</title>
<meta name="description" content="${esc(v.desc)}">
<meta property="og:title" content="${esc(v.themeName)} for Discord">
<meta property="og:description" content="${esc(v.desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(v.website)}/">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%2300242e'/%3E%3Ccircle cx='16' cy='16' r='7' fill='%23b6ecff'/%3E%3C/svg%3E">
<style>
${tokens}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  padding: clamp(24px, 6vw, 72px) clamp(20px, 5vw, 32px);
  display: flex;
  justify-content: center;
  font-family: var(--t-font-ui);
  font-size: 16px;
  line-height: 1.6;
  color: var(--t-text-mid);
  background:
    radial-gradient(1200px 700px at -10% -10%, hsl(var(--t-hue) 60% 50% / 0.18), transparent 60%),
    radial-gradient(900px 600px at 110% 110%, hsl(var(--t-hue) 50% 45% / 0.06), transparent 60%),
    var(--t-surface-0);
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
}

main { width: 100%; max-width: 640px; }

header { margin-bottom: 40px; }

h1 {
  margin: 0 0 4px;
  font-size: clamp(30px, 7vw, 42px);
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: var(--t-text-high);
}

.version {
  display: inline-block;
  margin-bottom: 18px;
  padding: 2px 10px;
  border-radius: var(--t-radius-pill);
  background: var(--t-primary-container);
  color: var(--t-on-primary-container);
  font-family: var(--t-font-mono);
  font-size: 13px;
}

.lede { margin: 0; max-width: 52ch; }

section {
  margin-bottom: 20px;
  padding: clamp(20px, 4vw, 28px);
  border-radius: var(--t-radius-container);
  background: var(--t-surface-2);
}

h2 {
  margin: 0 0 6px;
  font-size: 18px;
  letter-spacing: -0.01em;
  color: var(--t-text-high);
}

h2 + p { margin: 0 0 18px; font-size: 15px; }

ol { margin: 0 0 18px; padding-left: 1.25em; }
li { margin-bottom: 4px; }
li::marker { color: var(--t-tertiary); }

.url {
  display: flex;
  /* center, not stretch: stretching would grow the button to the height of the
     wrapped URL, and its resting radius is half of a fixed button height */
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.url code {
  flex: 1 1 300px;
  min-width: 0;
  padding: 12px 14px;
  border-radius: var(--t-radius-input);
  background: var(--t-surface-0);
  color: var(--t-primary);
  font-family: var(--t-font-mono);
  font-size: 14px;
  line-height: 1.5;
  /* wrap rather than scroll: this is the one string the visitor came to copy,
     and a horizontal scrollbar hides half of it */
  overflow-wrap: anywhere;
}

/* Pill at rest, rounded rectangle on hover, spring on both - the theme's own
   button gesture.

   The resting radius is written as half the element's own height rather than
   --t-radius-pill. 1lh is the line box and there is no vertical border, so
   0.5lh + padding-y is exactly half the used height - a true pill derived from
   the element, with no hard-coded height to keep in sync with the font size.
   (lh resolves at style resolution, so editing font-size here is picked up;
   it does not re-resolve if something changes font-size at runtime.)

   That precision is what makes the spring work. --t-spring-bouncy overshoots to
   1.20, so from 999px the curve lands at 999 + (12-999)*1.20 = -185px, clamped
   by the browser to 0 - a hard rectangle for a quarter of the transition. And
   every radius at or above half the height draws the same pill, so 999 -> 12
   would spend ~98% of its range on a shape nobody can see anyway.
   From the real half-height the same spring dips just past 12px and settles
   back onto it.

   The radius alone cannot carry the gesture, though: it only has ~9px of travel
   here, of which the overshoot is 1.8px - correct, but below the threshold
   where anyone reads it as a bounce. So hover also scales the button, on the
   same spring. Transform has no such ceiling, and 1.06 overshooting to ~1.072
   is what actually makes the spring visible. Press then sinks to 0.96. */
button, .btn {
  --btn-pad-y: 12px;
  flex: 0 0 auto;
  padding: var(--btn-pad-y) 20px;
  border: none;
  border-radius: calc(0.5lh + var(--btn-pad-y));
  background: var(--t-primary);
  color: var(--t-on-primary);
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.25;
  /* keeps the button one line tall, so 0.5lh stays half of it */
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  transition: border-radius var(--t-dur-base) var(--t-spring-bouncy),
              transform var(--t-dur-base) var(--t-spring-bouncy),
              background-color var(--t-dur-fast) ease;
}
button:hover, .btn:hover {
  border-radius: var(--t-radius-input);
  transform: scale(1.06);
}
/* after :hover, so the press wins while the pointer is still over the button */
button:active, .btn:active { transform: scale(0.96); transition-duration: 80ms; }
button:focus-visible, .btn:focus-visible,
a:focus-visible { outline: 2px solid var(--t-primary); outline-offset: 3px; }

.btn.secondary { background: var(--t-surface-4); color: var(--t-text-high); }

.actions { display: flex; gap: 10px; flex-wrap: wrap; }

a { color: var(--t-primary); }

.author {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.author img {
  flex: 0 0 auto;
  width: 56px;
  height: 56px;
  padding: 3px;
  border-radius: var(--t-radius-pill);
  /* the mark is a transparent PNG whose darkest teal sits close to surface-2;
     a lighter plate keeps that part of it legible */
  background: var(--t-surface-5);
  object-fit: contain;
}

.author .who { flex: 1 1 160px; min-width: 0; }

.author .name {
  display: block;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--t-text-high);
}

.author .role { display: block; font-size: 14px; color: var(--t-text-low); }

footer {
  margin-top: 36px;
  font-size: 14px;
  color: var(--t-text-low);
}
footer a { color: var(--t-text-mid); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
</style>
</head>
<body>
<main>
  <header>
    <h1>${esc(v.themeName)}</h1>
    <span class="version">v${esc(v.version)}</span>
    <p class="lede">${esc(v.desc)}</p>
  </header>

  <section>
    <h2>Install</h2>
    <p>Vencord &rarr; Settings &rarr; Themes &rarr; Online Themes. Paste this URL:</p>
    <div class="url">
      <code id="url">${esc(importUrl)}</code>
      <button id="copy" type="button" data-url="${esc(importUrl)}">Copy</button>
    </div>
  </section>

  <section>
    <h2>Customise</h2>
    <p>
      One seed hue drives every surface and accent. To change it, use the QuickCSS
      variant instead - it imports the same stylesheet and exposes every
      <code>--t-*</code> token with its default. Delete a line to fall back to that default.
    </p>
    <div class="actions">
      <a class="btn secondary" href="${esc(rawQuickCss)}">Get the QuickCSS file</a>
      <a class="btn secondary" href="${esc(quickCssFile)}">View on GitHub</a>
    </div>
  </section>

  <section class="author">
    <img src="${LOGO}" alt="" width="56" height="56" decoding="async">
    <div class="who">
      <span class="name">${esc(v.author)}</span>
      <span class="role">Design and code</span>
    </div>
    <a class="btn secondary" href="${esc(authorUrl)}">GitHub</a>
  </section>

  <footer>
    <a href="${esc(v.repo)}">Source</a> &middot;
    Apache-2.0 &middot;
    Class map derived from <a href="https://github.com/ClearVision/ClearVision-v7">ClearVision v7</a>
  </footer>
</main>
<script>
document.getElementById('copy').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  try {
    await navigator.clipboard.writeText(btn.dataset.url);
    btn.textContent = 'Copied';
  } catch {
    // clipboard blocked (insecure context, permissions): select the text instead
    const r = document.createRange();
    r.selectNodeContents(document.getElementById('url'));
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    btn.textContent = 'Select all + copy';
  }
  setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
});
</script>
</body>
</html>
`;

await mkdir(new URL('../public/', import.meta.url), { recursive: true });
await writeFile(OUT, html);
await copyFile(new URL(`../assets/${LOGO}`, import.meta.url), new URL(`../public/${LOGO}`, import.meta.url));

console.log(`public/index.html written (${html.length} bytes) for ${v.themeName} v${v.version}`);
console.log(`  install URL: ${importUrl}`);
console.log(`  copied assets/${LOGO} -> public/${LOGO}`);
