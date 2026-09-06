#!/usr/bin/env node
// Generate public/index.html - the landing page served at the site root.
//
// Nothing here is hand-maintained: the metadata comes from src/start/_index.scss
// (same source as the @import URL users paste) and the colour palette is the
// theme's own :root token block, lifted out of the compiled stylesheet. The page
// therefore cannot drift from the theme it advertises.
//
// The page carries no screenshots. The preview is a Discord window rebuilt from
// those same --t-* tokens, so the hue slider retunes it the way it retunes the
// real theme - a PNG would be wrong at every slider position but one.
//
// Run after build:css, which produces build/main.css.

import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';

const START = new URL('../src/start/_index.scss', import.meta.url);
const COMPILED = new URL('../build/main.css', import.meta.url);
const PREVIEW = new URL('../build/preview.css', import.meta.url);
// the minified build of the same stylesheet, for the copy that goes in the page
const THEME_MIN = new URL('../public/main.css', import.meta.url);
const DIST_SRC = new URL('../dist/', import.meta.url);
const ROOT = new URL('../', import.meta.url);
const OUT = new URL('../public/index.html', import.meta.url);
const LOGO = 'aeycen.png'; // author mark, and the account avatar in the preview
const FAVICON = 'm3-favicon.svg'; // the Material Design mark
// Avatars for the people in the preview conversation. A name with no file here
// falls back to its initials on a hue-derived plate, so adding a picture later
// is one more entry - nothing else has to change.
const AVATARS = ['trayved.png', 'loan.png', '2_L_8.png'];
const GUILD_ICON = 'lyghtning.gif'; // the selected server's picture in the preview
const ASSETS = [LOGO, FAVICON, GUILD_ICON, ...AVATARS]; // copied from assets/ into public/

// The --t-hue default is written as a negative angle. Hue is mod 360, so the
// slider shows the equivalent 0-360 value: -187 and 173 are the same colour.
// It is only the no-JS fallback: on load the slider picks a hue at random.
const HUE_DEFAULT = 173;

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


/** Cut a GIF down to its first frame.
 *
 * The server icon should sit still - a looping animation next to a hue slider
 * is two things moving for no reason. Rather than ask for a second, static
 * file, the animation is dropped here: walk the block structure and stop after
 * the first image descriptor's data, then write the trailer. No decoding, so no
 * image library, and the frame stays byte-identical to what the source held.
 * Format: https://www.w3.org/Graphics/GIF/spec-gif89a.txt
 */
function gifFirstFrame(buf) {
  if (buf.subarray(0, 3).toString('latin1') !== 'GIF') return buf;
  const packed = buf[10]; // logical screen descriptor, packed fields
  let p = 13;
  if (packed & 0x80) p += 3 * (1 << ((packed & 0x07) + 1)); // global colour table
  const skipSubBlocks = () => {
    while (p < buf.length && buf[p] !== 0x00) p += 1 + buf[p];
    p += 1;
  };
  while (p < buf.length) {
    const marker = buf[p];
    if (marker === 0x21) { p += 2; skipSubBlocks(); continue; } // extension
    if (marker === 0x2c) {                                      // image descriptor
      const local = buf[p + 9];
      p += 10;
      if (local & 0x80) p += 3 * (1 << ((local & 0x07) + 1));   // local colour table
      p += 1;                                                    // LZW min code size
      skipSubBlocks();
      break;
    }
    break; // trailer, or something we do not recognise - leave it alone
  }
  return Buffer.concat([buf.subarray(0, Math.min(p, buf.length)), Buffer.from([0x3b])]);
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const v = sassVars(await readFile(START, 'utf8'));
for (const k of ['themeName', 'version', 'desc', 'repo', 'website', 'mainImport']) {
  if (!v[k]) throw new Error(`missing $${k} in src/start/_index.scss`);
}
// The token block comes from the expanded build - its comments are the
// user-facing documentation of every --t-* default, and the page shows them.
const tokens = rootBlock(await readFile(COMPILED, 'utf8'));
// The copy that paints the preview is the minified one: same stylesheet, 15 KB
// less page weight, and it is literally the file the install URL serves.
const themeCss = await readFile(THEME_MIN, 'utf8').catch(() => {
  throw new Error('public/main.css missing - run build:min before build:landing');
});

// --- the preview's stand-in for Discord's stylesheet ---------------------------
// build/preview.css carries two things: a block of hashed class names resolved
// through the same map the theme uses, and the layout the theme does not
// contain. Pull the names out; what is left is injected next to the theme.
const previewSrc = await readFile(PREVIEW, 'utf8').catch(() => {
  throw new Error('build/preview.css missing - run build:preview before build:landing');
});
const nameBlock = previewSrc.match(/#t-preview-classnames\s*\{([\s\S]*?)\n\}/);
if (!nameBlock) throw new Error('no #t-preview-classnames block in build/preview.css');

const CLS = {};
for (const m of nameBlock[1].matchAll(/--([\w-]+):\s*'([^']+)'/g)) {
  // a value may be a single ".foo" or a list compiled to ":is(.a,.b)" - Discord
  // rolling a change out with both builds live. Carry every class, so whichever
  // selector the theme ends up using still matches this markup.
  CLS[m[1]] = [...m[2].matchAll(/\.([A-Za-z0-9_-]+)/g)].map((c) => c[1]).join(' ');
  if (!CLS[m[1]]) throw new Error(`class export --${m[1]} resolved to nothing`);
}
const previewBase = previewSrc.replace(/#t-preview-classnames\s*\{[\s\S]*?\n\}\n?/, '');

/** class attribute from one or more exported names */
const k = (...names) => names.map((n) => {
  if (!(n in CLS)) throw new Error(`unknown preview class "${n}" - add it to src/preview/index.scss`);
  return CLS[n];
}).join(' ');

const importUrl = `${v.website}/${v.mainImport}`;
const authorUrl = `https://github.com/${v.repo.replace(/.*github\.com\//, '').split('/')[0]}`;

// The distributable's name is whatever dist/ is called - "Material3-Expressive",
// not the theme name with its spaces hyphenated ("Material-3-Expressive"). Those
// differ, and deriving it from $themeName pointed both buttons at a 404. Read
// the real name so the two cannot disagree again.
const distName = (await readdir(DIST_SRC))
  .filter((f) => f.endsWith('.scss') && !f.startsWith('_'))
  .map((f) => f.replace(/\.scss$/, '.css'))[0];
if (!distName) throw new Error('no distributable source in dist/');

// build:dist compiles dist/*.scss to the repo root, and runs before this script
// so the text below is the file the buttons point at, not the previous build's.
const quickCss = await readFile(new URL(distName, ROOT), 'utf8').catch(() => {
  throw new Error(`${distName} missing - run build:dist before build:landing`);
});
const quickCssFile = `${v.repo}/blob/main/${distName}`;

// --- preview furniture -------------------------------------------------------
// The two icons Discord uses in the channel list, drawn here so the page keeps
// its single-request footprint.
const ICON_HASH =
  '<svg class="i" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.5 3 9.6 8H5.2l-.35 2H9.25l-.7 4H4.1l-.35 2h4.45l-.9 5h2l.9-5h4l-.9 5h2l.9-5h4.4l.35-2h-4.4l.7-4h4.45l.35-2h-4.45l.9-5h-2l-.9 5h-4l.9-5h-2Zm.55 7h4l-.7 4h-4l.7-4Z"/></svg>';
const ICON_VOICE =
  '<svg class="i" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.5 4.2 6.8 8.3H3.4a1 1 0 0 0-1 1v5.4a1 1 0 0 0 1 1h3.4l4.7 4.1a.8.8 0 0 0 1.3-.6V4.8a.8.8 0 0 0-1.3-.6Zm4.6 3.1a1 1 0 0 0-1 1.7 4 4 0 0 1 0 6 1 1 0 0 0 1 1.7 6 6 0 0 0 0-9.4Z"/></svg>';

// Discord's own mark, for the direct-messages button above the server list.
const ICON_DISCORD =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.63 5.65a16.2 16.2 0 0 0-4.07-1.26.06.06 0 0 0-.07.03c-.17.31-.37.72-.51 1.04a15 15 0 0 0-4.49 0 10.3 10.3 0 0 0-.52-1.04.06.06 0 0 0-.06-.03c-1.42.24-2.79.67-4.07 1.26a.06.06 0 0 0-.03.02C2.9 9.52 2.2 13.28 2.55 17a.07.07 0 0 0 .02.05 16.3 16.3 0 0 0 4.92 2.49.06.06 0 0 0 .07-.02c.38-.52.72-1.06.1-1.63a.06.06 0 0 0-.04-.09 10.7 10.7 0 0 1-1.53-.73.06.06 0 0 1 0-.1l.3-.24a.06.06 0 0 1 .07 0 11.6 11.6 0 0 0 9.86 0 .06.06 0 0 1 .07 0l.3.24a.06.06 0 0 1 0 .1c-.49.29-1 .53-1.53.73a.06.06 0 0 0-.04.09c.3.57.64 1.11 1 1.63a.06.06 0 0 0 .07.02 16.2 16.2 0 0 0 4.93-2.49.06.06 0 0 0 .02-.04c.42-4.3-.69-8.02-2.92-11.34a.05.05 0 0 0-.02-.02ZM8.68 14.735c-.97 0-1.77-.89-1.77-1.98s.78-1.99 1.77-1.99c1 0 1.79.9 1.77 1.99 0 1.09-.78 1.98-1.77 1.98Zm6.53 0c-.97 0-1.77-.89-1.77-1.98s.78-1.99 1.77-1.99c1 0 1.79.9 1.77 1.99 0 1.09-.77 1.98-1.77 1.98Z"/></svg>';

// Panel controls. Stroked rather than filled so the three read as one set.
const ctlIcon = (body) =>
  `<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg></span>`;
const ICON_MIC = ctlIcon('<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>');
const ICON_HEADSET = ctlIcon('<path d="M4 14.5V12a8 8 0 0 1 16 0v2.5"/><rect x="2" y="13.5" width="4.5" height="7" rx="2.25"/><rect x="17.5" y="13.5" width="4.5" height="7" rx="2.25"/>');
const ICON_GEAR = ctlIcon('<circle cx="12" cy="12" r="6.6"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2.6v2.8M12 18.6v2.8M21.4 12h-2.8M5.4 12H2.6M18.65 5.35 16.7 7.3M7.3 16.7l-1.95 1.95M18.65 18.65 16.7 16.7M7.3 7.3 5.35 5.35"/>');

// Discord's channel row: wrapper > link > icon + name. The nesting matters -
// the theme's hover and state rules are written as descendant selectors against
// exactly this shape.
const channel = (name, state) => `
              <li class="${k('ch-wrapper')}${state ? ' ' + k(state) : ''}">
                ${state === 'ch-unread' ? `<div class="${k('ch-unread-pill')}"></div>` : ''}
                <div class="${k('ch-link')}">
                  ${ICON_HASH.replace('class="i"', `class="${k('ch-icon')}"`)}
                  <div class="${k('ch-name')}">${name}</div>
                </div>
              </li>`;

const voiceChannel = (name) => `
              <li class="${k('ch-wrapper')}">
                <div class="${k('ch-link')}">
                  ${ICON_VOICE.replace('class="i"', `class="${k('ch-icon')}"`)}
                  <div class="${k('ch-name')}">${name}</div>
                </div>
              </li>`;

/** inline an SVG from assets/symbols, stripped of its own size and colour so it
    inherits the button's currentColor and the .i sizing */
async function symbol(file, cls) {
  const raw = await readFile(new URL(`../assets/symbols/${file}`, import.meta.url), 'utf8');
  return raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s(?:width|height|fill)="[^"]*"/g, '')
    .replace('<svg', `<svg class="${cls}" fill="currentColor" aria-hidden="true"`);
}
const ICON_GITHUB = await symbol('github-brands-solid-full.svg', 'gh');
const ICON_CHECK = await symbol('check_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg', 'ok');

// The people in the preview. `img` is optional: without one the avatar falls
// back to initials on a plate tinted at `tint` degrees off the seed hue, so it
// still retunes with everything else.
const CAST = {
  aeycen: { name: 'ΛΕYCEN', img: LOGO, tint: 0 },
  trayved: { name: 'TRAYVED', img: 'trayved.png', tint: 52 },
  loan: { name: 'Loan', img: 'loan.png', tint: -46 },
  gianiii: { name: 'Gianiii', initials: 'GI', tint: 96 },
  l8: { name: '2_L_8', img: '2_L_8.png', tint: 140 },
};

// wrapper > childWrapper is Discord's shape, and childWrapper is the tile the
// theme's hover, :active and selected rules all target.
const guild = (label, { selected = false, mention = 0 } = {}) => `
                      <div class="${k('guilds-item')}">
                        ${selected ? `<div class="${k('guilds-pill')}"></div>` : ''}
                        <div class="${k('guilds-icon-wrapper')}${selected ? ' ' + k('guilds-selected') : ''}">
                          <div class="${k('guilds-home')}">${label}</div>
                          ${mention ? `<div class="${k('guilds-mention')}">${mention}</div>` : ''}
                        </div>
                      </div>`;

const avatar = (who) =>
  `<span class="${k('msg-avatar')}" style="--av:${who.tint}">` +
  (who.img ? `<img src="${who.img}" alt="" loading="lazy" decoding="async">` : who.initials) +
  '</span>';

const member = (who, off = false) => `
              <li class="${k('member')}">
                <div class="${k('member-inner')}${off ? ' t-member-off' : ''}">
                  ${avatar(who)}<span class="${k('member-name')}">${who.name}</span>
                </div>
              </li>`;

const message = (who, time, body, extra = '') => `
              <div class="${k('msg', 'msg-cozy')}">
                ${avatar(who)}
                <div class="t-msg-body">
                  <div class="t-msg-head">
                    <span class="${k('msg-username')}">${who.name}</span>
                    <span class="${k('msg-timestamp')}"><time>${time}</time></span>
                  </div>
                  <div class="${k('msg-markup')}">${body}</div>${extra}
                </div>
              </div>`;

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
<link rel="icon" href="${FAVICON}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Roboto+Flex:opsz,wdth,wght@8..144,25..151,100..1000&display=swap">
<style>
${tokens}

/* The page paints itself out of the theme's own tokens above. --t-hue is the
   only thing the slider touches; every surface, role and text tone is derived
   from it, so one property retunes the whole document.

   Roboto Flex is used across its width and weight axes rather than as a set of
   static weights - it is Material's own variable face, and the display setting
   below (wdth 76 / wght 850) is what carries the page's voice. */
:root {
  --page-font: "Roboto Flex", "Segoe UI", system-ui, sans-serif;
  --page-mono: "JetBrains Mono", ui-monospace, Consolas, monospace;
  --rule: hsl(var(--t-hue) 20% 70% / 0.12);
}

*, *::before, *::after { box-sizing: border-box; }

/* Flat tonal ground, no gradient: Material 3 separates surfaces by tint and
   shape, not by washes of colour. Everything that reads as depth on this page
   is a step up the surface ladder. */
body {
  margin: 0;
  padding: clamp(40px, 7vw, 88px) clamp(20px, 5vw, 48px) 0;
  font-family: var(--page-font);
  font-size: 16px;
  line-height: 1.6;
  color: var(--t-text-mid);
  background: var(--t-surface-0);
  -webkit-font-smoothing: antialiased;
}

.page {
  position: relative; /* anchors the GitHub icon button to the top right */
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: clamp(56px, 9vw, 104px);
  padding-bottom: clamp(56px, 9vw, 104px);
}

/* One rhythm for section internals. Nothing here sets an outer margin, so the
   flex gap above is the only thing deciding the space between sections and
   there is no margin to collapse or override. */
.page h2 { margin: 0 0 8px; }
.page p { margin: 0 0 22px; }
.page > * > :last-child { margin-bottom: 0; }

h2 {
  font-size: clamp(22px, 3vw, 27px);
  font-variation-settings: "wght" 700, "wdth" 92;
  line-height: 1.2;
  letter-spacing: -0.015em;
  color: var(--t-text-high);
}

.prose { max-width: 52ch; }
/* a token name broken across a line reads as two different tokens */
.prose code { white-space: nowrap; }

a { color: var(--t-primary); text-underline-offset: 3px; }

code, .mono { font-family: var(--page-mono); }

/* ---------- hero ---------- */
.hero { display: flex; flex-direction: column; gap: 22px; }

h1 {
  margin: 0;
  max-width: 14ch;
  font-size: clamp(46px, 9.5vw, 104px);
  font-variation-settings: "wght" 850, "wdth" 76;
  line-height: 0.94;
  letter-spacing: -0.035em;
  color: var(--t-text-high);
  text-wrap: balance;
}

.meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

.chip {
  padding: 3px 12px;
  border-radius: var(--t-radius-pill);
  background: var(--t-primary-container);
  color: var(--t-on-primary-container);
  font-family: var(--page-mono);
  font-size: 13px;
}

.lede { max-width: 50ch; font-size: clamp(17px, 2vw, 19px); line-height: 1.55; }

/* ---------- preview window ----------
   Everything inside the window is a shadow root holding the compiled theme, so
   the only preview rules left out here are the frame and how big it is. */
/* surface-0 is the window frame in the theme, and it is also this page's
   ground, so the bezel needs an outline to exist at all. A hairline does the
   job a drop shadow was doing before, without the soft wash of colour.
   The outer radius is the inner one plus the padding, so the corners are
   concentric rather than two unrelated curves. */
.window {
  padding: 10px;
  border: 1px solid var(--rule);
  border-radius: calc(var(--t-radius-container) + 11px);
  background: var(--t-surface-0);
}

/* Below the widest layout the height follows the content, because a fixed ratio
   on a narrow box clips the top of the conversation - and the first message is
   the one that sets the joke up. Past 1180px the page is at its 1120px cap, so
   the preview's width stops changing and 16:9 resolves to one constant height
   that the content is known to fit. */
.preview {
  /* a flex column, because the shadow root's children lay out as this element's
     own children - this is what gives them a bounded height without any
     percentage in the chain */
  display: flex;
  flex-direction: column;
  min-height: 400px;
  overflow: hidden;
  border-radius: var(--t-radius-container);
}
@media (min-width: 1180px) {
  .preview { aspect-ratio: 16 / 9; min-height: 0; }
}

/* ---------- hue control ----------
   The Material 3 Expressive slider: a thick two-tone track, a bar handle rather
   than a knob, a gap on both sides of it, and a stop dot at the inactive end.
   Press squeezes the handle narrow and thickens the track - that squeeze is the
   whole component's feedback, so it is worth getting exactly right.

   The track is drawn as one gradient on ::before rather than as two elements,
   with the gap left transparent so the page shows through. --c is the handle's
   centre: the thumb travels within (width - thumb width), so the centre is
   2px + p * (100% - 4px), not p * 100%. */
/* Explicit areas rather than flex-wrap: wrapping put the button on a line of
   its own with the rest of that line empty. The narrow arrangement stacks the
   three parts instead, so the row stays a row and never grows hollow. */
.hue {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  grid-template-areas: "label track val btn";
  align-items: center;
  column-gap: clamp(14px, 2.4vw, 26px);
  margin-top: 16px;
  padding: 18px clamp(16px, 2.4vw, 24px);
  border-radius: var(--t-radius-container);
  background: var(--t-surface-2);
}
.hue label { grid-area: label; font-family: var(--page-mono); font-size: 14px; color: var(--t-text-low); }
.hue .track { grid-area: track; }
.hue button { grid-area: btn; }
.hue .val {
  grid-area: val;
  min-width: 4ch;
  font-family: var(--page-mono);
  font-size: 20px;
  color: var(--t-primary);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.track {
  --p: 0.48;
  --c: calc(2px + var(--p) * (100% - 4px));
  position: relative;
  flex: 1 1 260px;
  min-width: 170px;
  height: 44px;
  display: flex;
  align-items: center;
}
.track::before {
  content: "";
  position: absolute;
  inset-inline: 0;
  height: 16px;
  border-radius: var(--t-radius-pill);
  background: linear-gradient(90deg,
    var(--t-primary) 0 calc(var(--c) - 6px),
    transparent calc(var(--c) - 6px) calc(var(--c) + 6px),
    var(--t-secondary-container) calc(var(--c) + 6px) 100%);
  transition: height var(--t-dur-fast) var(--t-spring-snappy);
}
/* stop indicator at the inactive end */
.track::after {
  content: "";
  position: absolute;
  right: 6px;
  width: 4px;
  height: 4px;
  border-radius: var(--t-radius-pill);
  background: var(--t-on-secondary-container);
  opacity: 0.55;
}
.track:has(input:active)::before { height: 22px; }

.track input {
  appearance: none;
  -webkit-appearance: none;
  position: relative;
  width: 100%;
  height: 44px;
  margin: 0;
  background: none;
  cursor: pointer;
}
.track input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 4px;
  height: 44px;
  border: none;
  border-radius: var(--t-radius-pill);
  background: var(--t-primary);
  transition: width var(--t-dur-fast) var(--t-spring-snappy);
}
.track input::-moz-range-thumb {
  width: 4px;
  height: 44px;
  border: none;
  border-radius: var(--t-radius-pill);
  background: var(--t-primary);
  transition: width var(--t-dur-fast) var(--t-spring-snappy);
}
.track input:active::-webkit-slider-thumb { width: 2px; }
.track input:active::-moz-range-thumb { width: 2px; }
/* the ring belongs on the track, not the transparent input on top of it */
.track input:focus-visible { outline: none; }
.track:has(input:focus-visible) {
  outline: 2px solid var(--t-primary);
  outline-offset: 4px;
  border-radius: var(--t-radius-pill);
}

/* Indented to the slider's own padding so it lines up with the label above it,
   and kept on one line - the sentence is the slider's caption, not a paragraph.
   It shrinks with the viewport instead of wrapping, and only below the width
   where that would get too small does it become two lines. */
/* .page .caption, not .caption: the generic ".page p" rule above is a class
   plus a type selector, so it outranks a lone class and was quietly resetting
   this margin-top to 0. What looked like a gap was only the slider's own
   bottom padding. */
.page .caption {
  margin: 18px 0 0;
  padding-inline: clamp(16px, 2.4vw, 24px);
  font-size: 14px;
  color: var(--t-text-low);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 900px) {
  /* must match the base rule's specificity or it cannot override the nowrap */
  .page .caption { white-space: normal; max-width: 62ch; }
}

/* ---------- install ---------- */
.url { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.url code {
  flex: 1 1 320px;
  min-width: 0;
  padding: 14px 16px;
  border-radius: var(--t-radius-input);
  background: var(--t-surface-2);
  color: var(--t-primary);
  font-size: 14px;
  line-height: 1.5;
  /* wrap rather than scroll: this is the one string the visitor came to copy,
     and a horizontal scrollbar hides half of it */
  overflow-wrap: anywhere;
}
.path { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; color: var(--t-text-high); }
.path b { font-variation-settings: "wght" 650; font-weight: normal; }
.path i { font-style: normal; color: var(--t-text-low); }

/* ---------- token ladder ---------- */
.ladder { display: flex; gap: 6px; flex-wrap: wrap; }
.ladder .s { flex: 1 1 88px; min-width: 68px; }
.ladder .sw { height: 56px; border-radius: var(--t-radius-card); background: var(--sw); border: 1px solid var(--rule); }
.ladder .lb {
  display: block;
  margin-top: 7px;
  font-family: var(--page-mono);
  font-size: 11px;
  color: var(--t-text-low);
  overflow-wrap: anywhere;
}
.ladder .roles { flex: 1 1 100%; display: flex; gap: 6px; margin-top: 14px; }

/* ---------- buttons ---------- */
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
  /* inline-flex so a confirmation icon can sit beside the label. The icon is
     18px and the line box is 18.75px, so the icon never sets the height and
     0.5lh stays half of it. */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--btn-pad-y) 20px;
  border: none;
  border-radius: calc(0.5lh + var(--btn-pad-y));
  background: var(--t-primary);
  color: var(--t-on-primary);
  font-family: inherit;
  font-size: 15px;
  font-variation-settings: "wght" 650;
  line-height: 1.25;
  /* keeps the button one line tall, so 0.5lh stays half of it */
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  transition: border-radius var(--t-dur-base) var(--t-spring-bouncy),
              transform var(--t-dur-base) var(--t-spring-bouncy),
              width var(--t-dur-base) var(--t-spring-bouncy),
              background-color var(--t-dur-fast) ease;
}

/* Confirming a copy changes both the label and the button's width, and swapping
   the two at once is the jump. So they are separated: the label fades out, the
   text is exchanged while it is invisible, and the width springs to its new
   value as the new label fades back in. The width has to be measured and
   written in pixels for that - auto does not animate. */
.lbl {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: opacity 130ms ease;
}
button:hover, .btn:hover {
  border-radius: var(--t-radius-input);
  transform: scale(1.06);
}
/* after :hover, so the press wins while the pointer is still over the button */
button:active, .btn:active { transform: scale(0.96); transition-duration: 80ms; }
button:focus-visible, .btn:focus-visible,
a:focus-visible { outline: 2px solid var(--t-primary); outline-offset: 3px; }

.btn.secondary, button.secondary { background: var(--t-surface-4); color: var(--t-text-high); }
.actions { display: flex; gap: 10px; flex-wrap: wrap; }

/* the tick that replaces nothing - it joins the label, so the button still says
   what happened rather than only showing a mark */
.ok { width: 18px; height: 18px; flex: 0 0 auto; }

/* Icon button, top right. Square and circular at rest, and it takes the same
   hover morph as every other button here: the shared :hover rule pulls the
   radius to --t-radius-input, which on a 48px square is a clear squircle. */
.gh-btn {
  position: absolute;
  top: 0;
  right: 0;
  width: 48px;
  height: 48px;
  padding: 0;
  justify-content: center;
  border-radius: 24px;
  background: var(--t-surface-4);
  color: var(--t-text-high);
}
.gh { width: 22px; height: 22px; }

/* ---------- author + footer ---------- */
.author { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
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
.author .name { display: block; font-size: 17px; font-variation-settings: "wght" 650; color: var(--t-text-high); }
.author .role { display: block; font-size: 14px; color: var(--t-text-low); }

footer { padding-top: 28px; border-top: 1px solid var(--rule); font-size: 14px; color: var(--t-text-low); }
footer a { color: var(--t-text-mid); }

/* ---------- narrower viewports ---------- */
@media (max-width: 720px) {
  .hue {
    grid-template-columns: auto 1fr;
    grid-template-areas:
      "label val"
      "track track"
      "btn   btn";
    row-gap: 6px;
  }
  .hue button { justify-self: start; margin-top: 8px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
</style>
</head>
<body>
<div class="page">

  <a class="btn gh-btn" href="${esc(v.repo)}" aria-label="This theme on GitHub">${ICON_GITHUB}</a>

  <div class="hero">
    <h1>${esc(v.themeName)}</h1>
    <div class="meta">
      <span class="chip">v${esc(v.version)}</span>
      <span>for Vencord</span>
    </div>
    <p class="lede">${esc(v.desc)}</p>
  </div>

  <div>
    <div class="window">
      <!-- The preview is a declarative shadow root carrying the compiled theme
           itself, so what you see below is painted by the same stylesheet the
           install URL serves - hover states and springs included. The shadow
           boundary is what makes that safe: the theme's :root, html and body
           rules simply do not match inside a shadow tree, so they cannot reach
           the page, while --t-hue still inherits in and retunes it. -->
      <div class="preview" role="img" aria-label="A Discord window painted by the ${esc(v.themeName)} theme itself: surfaces tinted in the seed hue, the selected channel as a pill in the primary container colour, categories in secondary, mentions and unread markers in tertiary.">
        <template shadowrootmode="open">
          <style>${previewBase}${themeCss}</style>
          <div class="theme-dark visual-refresh t-root">
            <div class="${k('app-mount')}">
              <div class="${k('app-bg')}"></div>
              <div class="t-app">

                <div class="${k('sidebar')}">
                  <div class="t-side-top">

                    <nav class="${k('guilds-wrapper')}">
                      ${guild(ICON_DISCORD)}
                      <div class="t-guild-sep"></div>
                      ${guild(`<img src="${GUILD_ICON}" alt="" decoding="async">`, { selected: true })}
                      ${guild('DV', { mention: 3 })}
                      ${guild('VC')}
                      ${guild('AE')}
                    </nav>

                    <div class="t-side-main">
                      <div class="${k('sidebar-header')}">LYGHTNING</div>
                      <ul class="${k('sidebar-list')}">
                      <li class="${k('cat-wrapper')}"><div class="${k('cat-name')}">Information</div></li>
                      ${channel('announcements', 'ch-muted')}
                      ${channel('hello-there', 'ch-muted')}
                      <li class="${k('cat-wrapper')}"><div class="${k('cat-name')}">Text</div></li>
                      ${channel('english-chat', 'ch-selected')}
                      ${channel('german-chat', 'ch-unread')}
                      ${channel('tech-support', '')}
                      ${channel('memes', '')}
                      <li class="${k('cat-wrapper')}"><div class="${k('cat-name')}">Voice</div></li>
                      ${voiceChannel('Lounge')}
                      ${voiceChannel('Music')}
                      </ul>
                    </div>
                  </div>

                  <section class="${k('panel')}">
                    ${avatar(CAST.aeycen)}
                    <span class="t-panel-who">
                      <span class="t-panel-name">${CAST.aeycen.name}</span>
                      <span class="t-panel-status">Online</span>
                    </span>
                    <span class="t-panel-ctl">${ICON_MIC}${ICON_HEADSET}${ICON_GEAR}</span>
                  </section>
                </div>

                <div class="${k('chat')}">
                  <div class="${k('chat-header')}">${ICON_HASH}<span>english-chat</span></div>
                  <div class="${k('chat-inner')}">
                    <div class="${k('chat-scroller')}">
                      <div class="${k('divider')}"><span class="${k('divider-content')}">Today</span></div>
                      ${message(CAST.aeycen, '21:02', `vote: is <span class="${k('msg-mention')}">@Loan</span> allowed to pick the music again`)}
                      ${message(
                        CAST.trayved,
                        '21:02',
                        'no',
                        `<div class="${k('reactions')}">
                          <div class="${k('reaction', 'reaction-me')}">&#128077; <span class="${k('reaction-count')}">7</span></div>
                          <div class="${k('reaction')}">&#128175; <span class="${k('reaction-count')}">4</span></div>
                        </div>`
                      )}
                      ${message(CAST.gianiii, '21:02', 'no')}
                      ${message(
                        CAST.loan,
                        '21:03',
                        // the link is what makes the embed below it legitimate - Discord
                        // unfurls a card because a URL was posted, not on its own
                        'you have not even heard the playlist<br><a class="t-link" href="https://open.spotify.com/playlist/5EIjIqnxsxQrlms9XSWhEs" target="_blank">open.spotify.com/playlist/5EIjIqnxsxQrlms9XSWhEs</a>',
                        `<article class="${k('embed')}">
                          <span class="t-embed-author">Playlist</span>
                          <span class="t-embed-title">every song i know</span>
                          <span class="t-embed-desc">1 track &middot; 3 hr 14 min</span>
                        </article>`
                      )}
                      ${message(CAST.trayved, '21:03', 'we heard it. that is the entire problem.')}
                    </div>
                    <form class="${k('form')}">
                      <div class="${k('textarea')}">Message #english-chat</div>
                    </form>
                  </div>
                </div>

                <div class="${k('members')}">
                  <ul>
                    <li class="${k('member-group')}">Online &mdash; 3</li>
                    ${member(CAST.aeycen)}
                    ${member(CAST.trayved)}
                    ${member(CAST.loan)}
                    <li class="${k('member-group')}">Offline &mdash; 2</li>
                    ${member(CAST.gianiii, true)}
                    ${member(CAST.l8, true)}
                  </ul>
                </div>

              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <div class="hue">
      <label for="hue">--t-hue</label>
      <div class="track" id="track">
        <input id="hue" type="range" min="0" max="360" step="1" value="${HUE_DEFAULT}">
      </div>
      <span class="val" id="hueval" aria-hidden="true">${HUE_DEFAULT}</span>
      <button id="copyhue" type="button" class="secondary" data-label="Copy hue"><span class="lbl">Copy hue</span></button>
    </div>
    <p class="caption">Drag to retune the preview and this page together. Copy the hue for your QuickCSS.</p>
  </div>

  <section>
    <h2>Install</h2>
    <p class="prose">
      In Vencord, open
      <span class="path"><b>Settings</b> <i>&rsaquo;</i> <b>Themes</b> <i>&rsaquo;</i> <b>Online Themes</b></span>
      and add this URL. The stylesheet is rebuilt and republished on every push, so a fix
      reaches you on the next restart.
    </p>
    <div class="url">
      <code id="url">${esc(importUrl)}</code>
      <button id="copyurl" type="button" data-label="Copy URL" data-url="${esc(importUrl)}"><span class="lbl">Copy URL</span></button>
    </div>
  </section>

  <section>
    <h2>Six surfaces, three roles</h2>
    <p class="prose">
      Every colour in the preview comes from the seed hue. Surfaces climb one ladder, from the
      window frame up to hover states. The three roles carry meaning: primary for what you
      selected, secondary for categories and voice, tertiary for mentions and unread only.
    </p>
    <div class="ladder">
      <div class="s"><div class="sw" style="--sw:var(--t-surface-0)"></div><span class="lb">surface-0</span></div>
      <div class="s"><div class="sw" style="--sw:var(--t-surface-1)"></div><span class="lb">surface-1</span></div>
      <div class="s"><div class="sw" style="--sw:var(--t-surface-2)"></div><span class="lb">surface-2</span></div>
      <div class="s"><div class="sw" style="--sw:var(--t-surface-3)"></div><span class="lb">surface-3</span></div>
      <div class="s"><div class="sw" style="--sw:var(--t-surface-4)"></div><span class="lb">surface-4</span></div>
      <div class="s"><div class="sw" style="--sw:var(--t-surface-5)"></div><span class="lb">surface-5</span></div>
      <div class="roles">
        <div class="s"><div class="sw" style="--sw:var(--t-primary)"></div><span class="lb">primary</span></div>
        <div class="s"><div class="sw" style="--sw:var(--t-secondary)"></div><span class="lb">secondary</span></div>
        <div class="s"><div class="sw" style="--sw:var(--t-tertiary)"></div><span class="lb">tertiary</span></div>
      </div>
    </div>
  </section>

  <section>
    <h2>Change anything else</h2>
    <p class="prose">
      The QuickCSS file imports the same stylesheet and lists every <code>--t-*</code> token with
      its default: the hue, surface opacity, a background image, the chat monogram, the radii,
      the motion springs. Delete a line to fall back to that default.
    </p>
    <p class="prose">
      Copy it, then paste it into <span class="path"><b>Settings</b> <i>&rsaquo;</i> <b>Themes</b>
      <i>&rsaquo;</i> <b>Edit QuickCSS</b></span>. Nothing to download.
    </p>
    <div class="actions">
      <button id="copyquick" type="button" data-label="Copy QuickCSS"><span class="lbl">Copy QuickCSS</span></button>
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

</div>
<!-- The distributable itself, so "Copy QuickCSS" needs no download and no
     network call. type="text/plain" keeps the parser from running it as script
     while leaving textContent byte-for-byte what build:dist produced. -->
<script type="text/plain" id="quickcss-src">${quickCss.replace(/<\/(script)/gi, '<\\/$1')}</script>
<script>
(function () {
  var root = document.documentElement;
  var hue = document.getElementById('hue');
  var track = document.getElementById('track');
  var val = document.getElementById('hueval');

  function apply() {
    var min = Number(hue.min), max = Number(hue.max), h = Number(hue.value);
    // one property: every token in :root is derived from it, so this retunes
    // the preview and the page around it in the same paint
    root.style.setProperty('--t-hue', h);
    track.style.setProperty('--p', (h - min) / (max - min));
    val.textContent = h;
  }
  hue.addEventListener('input', apply);

  // A different hue on every visit. The theme is built to work at any of them,
  // so the page opens on one at random rather than always on the default -
  // whatever you see is a real setting you can copy, not a chosen showpiece.
  // 0 and 360 are the same colour, so the top of the range is left out.
  hue.value = Math.floor(Math.random() * 360);
  apply();

  // navigator.clipboard is missing on insecure origins and rejects outright on
  // file:// and when permission is denied - which is most of the ways someone
  // opens this page other than the published site. execCommand is deprecated
  // but has none of those conditions, and being synchronous it still counts as
  // running inside the click, so it is tried first and the async API is the
  // fallback rather than the other way round.
  function writeClipboard(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  var CHECK = '${ICON_CHECK}';
  var FADE = 130; // matches the .lbl opacity transition
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Swapping the label and the width together is what made the change snap.
  // Here the label fades out first, the text is exchanged while it cannot be
  // seen, and only then does the width spring to its new value with the new
  // label fading back in. Both directions go through this, so returning to the
  // resting label is as smooth as leaving it.
  function swapLabel(b, html) {
    var lbl = b.querySelector('.lbl');
    if (REDUCED) { lbl.innerHTML = html; return; }
    lbl.style.opacity = '0';
    setTimeout(function () {
      // offsetWidth, not getBoundingClientRect: the pointer is still over the
      // button, so its rect carries the 1.06 hover scale. Measuring that and
      // writing it back as a width made the button 6% wider on every swap, and
      // it compounded. offsetWidth is the layout width and ignores transforms.
      var from = b.offsetWidth;
      lbl.innerHTML = html;
      b.style.width = 'auto';
      var to = b.offsetWidth;
      b.style.width = from + 'px';
      var flush = b.offsetWidth; // commit the start value so the next one animates
      void flush;
      b.style.width = to + 'px';
      lbl.style.opacity = '1';
    }, FADE);
  }

  function onCopy(id, read, done, selectId) {
    var b = document.getElementById(id);
    if (!b) return;
    b.addEventListener('click', function () {
      var text = read();
      var reset = function () { setTimeout(function () { swapLabel(b, b.dataset.label); }, 2000); };
      // the tick joins the label rather than replacing it, so the button still
      // says what happened
      var ok = function () { swapLabel(b, CHECK + '<span>' + done + '</span>'); reset(); };
      // last resort: put the text under a selection so it can be copied by hand
      var select = function () {
        var r = document.createRange();
        r.selectNodeContents(document.getElementById(selectId));
        var s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        swapLabel(b, 'Select and copy');
        reset();
      };
      if (writeClipboard(text)) return ok();
      if (navigator.clipboard) return navigator.clipboard.writeText(text).then(ok, select);
      select();
    });
  }
  onCopy('copyhue', function () { return '--t-hue: ' + hue.value + ';'; }, 'Hue copied', 'hueval');
  onCopy('copyurl', function () { return document.getElementById('copyurl').dataset.url; }, 'URL copied', 'url');
  // the whole distributable, embedded above - no download, no network at click
  onCopy('copyquick', function () { return document.getElementById('quickcss-src').textContent; }, 'QuickCSS copied', 'url');
})();
</script>
</body>
</html>
`;

await mkdir(new URL('../public/', import.meta.url), { recursive: true });
await writeFile(OUT, html);
for (const asset of ASSETS) {
  const from = new URL(`../assets/${asset}`, import.meta.url);
  const to = new URL(`../public/${asset}`, import.meta.url);
  if (asset === GUILD_ICON) {
    await writeFile(to, gifFirstFrame(await readFile(from)));
  } else {
    await copyFile(from, to);
  }
}

console.log(`public/index.html written (${html.length} bytes) for ${v.themeName} v${v.version}`);
console.log(`  install URL: ${importUrl}`);
console.log(`  copied ${ASSETS.map((a) => `assets/${a}`).join(', ')} -> public/`);
