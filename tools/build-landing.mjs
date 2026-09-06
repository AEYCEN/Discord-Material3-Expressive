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

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';

const START = new URL('../src/start/_index.scss', import.meta.url);
const COMPILED = new URL('../build/main.css', import.meta.url);
const OUT = new URL('../public/index.html', import.meta.url);
const LOGO = 'aeycen.png'; // author mark, shown next to the byline
const FAVICON = 'm3-favicon.svg'; // the Material Design mark
const ASSETS = [LOGO, FAVICON]; // copied from assets/ into public/ next to index.html

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

// --- preview furniture -------------------------------------------------------
// The two icons Discord uses in the channel list, drawn here so the page keeps
// its single-request footprint.
const ICON_HASH =
  '<svg class="i" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.5 3 9.6 8H5.2l-.35 2H9.25l-.7 4H4.1l-.35 2h4.45l-.9 5h2l.9-5h4l-.9 5h2l.9-5h4.4l.35-2h-4.4l.7-4h4.45l.35-2h-4.45l.9-5h-2l-.9 5h-4l.9-5h-2Zm.55 7h4l-.7 4h-4l.7-4Z"/></svg>';
const ICON_VOICE =
  '<svg class="i" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.5 4.2 6.8 8.3H3.4a1 1 0 0 0-1 1v5.4a1 1 0 0 0 1 1h3.4l4.7 4.1a.8.8 0 0 0 1.3-.6V4.8a.8.8 0 0 0-1.3-.6Zm4.6 3.1a1 1 0 0 0-1 1.7 4 4 0 0 1 0 6 1 1 0 0 0 1 1.7 6 6 0 0 0 0-9.4Z"/></svg>';

const channel = (name, state) => `<li class="ch ${state}">${ICON_HASH}<span>${name}</span></li>`;

const member = (initials, name, tint, state = '') =>
  `<li class="mem ${state}"><span class="av" style="--av:${tint}">${initials}</span><span>${name}</span></li>`;

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
   Not a screenshot: the same tokens the theme assigns onto Discord's variables,
   assigned onto a stand-in DOM. Every rule below mirrors one in src/main.scss
   section 3, so the two cannot show different things. */
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

.app {
  display: flex;
  height: clamp(400px, 58vh, 540px);
  overflow: hidden;
  border-radius: var(--t-radius-container);
  font-size: 14px;
}
.app .i { width: 18px; height: 18px; flex: 0 0 auto; }

/* server rail (tier 1) */
.guilds {
  flex: 0 0 68px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px 0;
  background: var(--t-surface-1);
}
.guilds .g {
  position: relative;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: var(--t-radius-card);
  background: var(--t-surface-3);
  color: var(--t-text-mid);
  font-size: 15px;
  font-variation-settings: "wght" 700;
}
.guilds .g.on { background: var(--t-primary); color: var(--t-on-primary); }
/* selection pill, left of the icon */
.guilds .g.on::before {
  content: "";
  position: absolute;
  left: -12px;
  width: 4px;
  height: 28px;
  border-radius: var(--t-radius-pill);
  background: var(--t-primary);
}
.guilds .g .badge {
  position: absolute;
  right: -3px;
  bottom: -3px;
  min-width: 18px;
  padding: 0 5px;
  border-radius: var(--t-radius-pill);
  background: var(--t-tertiary);
  color: var(--t-on-tertiary);
  font-size: 11px;
  line-height: 18px;
  font-variation-settings: "wght" 700;
}
.guilds .sep { width: 22px; height: 2px; border-radius: 2px; background: var(--rule); }

/* channel sidebar (tier 2) */
.side {
  flex: 0 0 232px;
  display: flex;
  flex-direction: column;
  background: var(--t-surface-2);
  border-radius: var(--t-radius-container) 0 0 var(--t-radius-container);
}
.side .head {
  padding: 0 16px;
  height: 48px;
  display: flex;
  align-items: center;
  font-variation-settings: "wght" 650;
  color: var(--t-text-high);
}
.side ul { margin: 0; padding: 0 0 8px; list-style: none; flex: 1; min-height: 0; }

/* categories: secondary tone, no uppercase shouting */
.cat { padding: 14px 12px 4px; font-size: 12px; font-variation-settings: "wght" 600; color: var(--t-secondary); }

/* channel rows are pills; the selected one is the theme's signature element */
.ch {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 1px 8px 1px 6px;
  padding: 6px 10px;
  border-radius: var(--t-radius-pill);
  color: var(--t-text-mid);
}
.ch .i { color: var(--t-text-low); }
.ch.on { background: var(--t-primary-container); }
.ch.on, .ch.on .i { color: var(--t-on-primary-container); }
.ch.unread { color: var(--t-text-high); font-variation-settings: "wght" 650; }
.ch.unread .i { color: var(--t-text-high); }
.ch.unread::before {
  content: "";
  position: absolute;
  left: -6px;
  top: 50%;
  translate: 0 -50%;
  width: 4px;
  height: 8px;
  border-radius: var(--t-radius-pill);
  background: var(--t-tertiary);
}
.ch.muted { color: var(--t-text-low); opacity: 0.7; }

/* account panel */
.panel {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 0 8px 8px;
  padding: 8px 10px;
  border-radius: var(--t-radius-card);
  background: var(--t-surface-3);
}
.panel .who { min-width: 0; line-height: 1.25; }
.panel .n { display: block; font-size: 13px; font-variation-settings: "wght" 650; color: var(--t-text-high); }
.panel .s { display: block; font-size: 11px; color: var(--t-text-low); }

/* chat (tier 1) */
.chat { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--t-surface-1); }
.chat .head {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid var(--rule);
  color: var(--t-text-high);
  font-variation-settings: "wght" 650;
}
.chat .head .i { color: var(--t-text-low); }

/* monogram sits under the messages, as it does in the theme */
.log {
  position: relative;
  isolation: isolate;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 14px;
  padding: 20px 16px 8px;
  container-type: inline-size;
  container-name: t-chat;
}
.log::before {
  content: var(--t-monogram);
  position: absolute;
  inset: 0;
  padding: 0 24px 20px;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  font-family: var(--t-monogram-font);
  font-size: 64px;
  letter-spacing: var(--t-monogram-spacing);
  text-transform: uppercase;
  line-height: 1;
  color: hsl(var(--t-hue) 100% 86% / var(--t-monogram-opacity));
  white-space: nowrap;
  z-index: -1;
}
/* same 420px floor the theme uses: below it the monogram is wider than the
   chat pane and reads as a smudge behind the messages rather than a mark */
@container t-chat (max-width: 419px) {
  .log::before { display: none; }
}

.msg { display: flex; gap: 12px; }
.av {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: var(--t-radius-pill);
  /* avatars are offsets from the seed hue, so they retune with everything else */
  background: hsl(calc(var(--t-hue) + var(--av, 0)) 32% 40%);
  color: var(--t-text-high);
  font-size: 13px;
  font-variation-settings: "wght" 700;
}
.msg .body { min-width: 0; }
.msg .line { display: flex; align-items: baseline; gap: 8px; }
.msg .who { font-variation-settings: "wght" 650; color: var(--t-text-high); }
.msg time { font-size: 11px; color: var(--t-text-low); }
.msg p { margin: 2px 0 0; line-height: 1.45; }
.tag {
  padding: 1px 5px;
  border-radius: var(--t-radius-code);
  background: var(--t-surface-4);
  color: var(--t-text-mid);
  font-size: 10px;
  font-variation-settings: "wght" 650;
  letter-spacing: 0.02em;
}
.at {
  padding: 0 6px;
  border-radius: var(--t-radius-pill);
  background: var(--t-tertiary-container);
  color: var(--t-on-tertiary-container);
  font-variation-settings: "wght" 600;
}
.msg code {
  padding: 2px 6px;
  border-radius: var(--t-radius-code);
  background: hsl(var(--t-hue) 60% 90% / 0.08);
  color: var(--t-primary);
  font-size: 13px;
}
.reacts { display: flex; gap: 6px; margin-top: 8px; }
.reacts span {
  display: inline-flex;
  gap: 5px;
  padding: 2px 9px;
  border-radius: var(--t-radius-pill);
  background: var(--t-surface-3);
  color: var(--t-text-mid);
  font-size: 12px;
}
/* your own reaction reads as primary-container, same as in the theme */
.reacts .me { background: var(--t-primary-container); color: var(--t-on-primary-container); }

.composer {
  margin: 4px 16px 16px;
  padding: 12px 16px;
  border-radius: var(--t-radius-container);
  background: var(--t-surface-3);
  color: var(--t-text-low);
}

/* member list (tier 2) */
.members {
  flex: 0 0 200px;
  padding-top: 12px;
  background: var(--t-surface-2);
  border-radius: 0 var(--t-radius-container) var(--t-radius-container) 0;
}
.members ul { margin: 0; padding: 0; list-style: none; }
.members .cat { padding-left: 20px; }
.mem {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 2px 8px;
  padding: 5px 8px;
  border-radius: var(--t-radius-pill);
  color: var(--t-text-mid);
  font-size: 13px;
}
.mem .av { width: 28px; height: 28px; font-size: 11px; }
.mem.on { background: var(--t-surface-3); color: var(--t-text-high); }
.mem.off { opacity: 0.45; }

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

.caption { margin: 12px 0 0; max-width: 62ch; font-size: 14px; color: var(--t-text-low); }

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

.btn.secondary, button.secondary { background: var(--t-surface-4); color: var(--t-text-high); }
.actions { display: flex; gap: 10px; flex-wrap: wrap; }

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

/* ---------- narrower viewports ----------
   The preview drops panes the way Discord itself does, so whatever stays keeps
   its real proportions instead of being scaled down into a blur. */
@media (max-width: 1000px) {
  .members { display: none; }
  .chat { border-radius: 0 var(--t-radius-container) var(--t-radius-container) 0; }
}
@media (max-width: 760px) {
  .guilds { display: none; }
}
/* Below this the two remaining panes leave the chat too narrow to read a
   sentence in, so they stack instead: the sidebar keeps the selected-channel
   pill, the chat keeps the messages, and both get the full width. */
@media (max-width: 620px) {
  .app { flex-direction: column; height: auto; }
  .side {
    flex: 0 0 auto;
    border-radius: var(--t-radius-container) var(--t-radius-container) 0 0;
  }
  .side ul { flex: 0 0 auto; }
  /* the account panel repeats what the member list already showed */
  .side .panel { display: none; }
  .chat {
    height: 340px;
    border-radius: 0 0 var(--t-radius-container) var(--t-radius-container);
  }
}
@media (max-width: 420px) {
  .app { font-size: 13px; }
  .chat { height: 300px; }
}
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
      <div class="app" role="img" aria-label="A Discord window in the ${esc(v.themeName)} theme: surfaces tinted in the seed hue, the selected channel as a pill in the primary container colour, categories in secondary, and mentions and unread markers in tertiary.">
        <div class="guilds" aria-hidden="true">
          <span class="g on">M3</span>
          <span class="sep"></span>
          <span class="g">DV<span class="badge">3</span></span>
          <span class="g">VC</span>
          <span class="g">AE</span>
        </div>

        <div class="side" aria-hidden="true">
          <div class="head">Material You</div>
          <ul>
            <li class="cat">Text</li>
            ${channel('welcome', 'muted')}
            ${channel('design-system', 'on')}
            ${channel('releases', 'unread')}
            ${channel('help', '')}
            <li class="cat">Voice</li>
            <li class="ch">${ICON_VOICE}<span>Lounge</span></li>
          </ul>
          <div class="panel">
            <span class="av" style="--av:0">AE</span>
            <span class="who"><span class="n">aeycen</span><span class="s">Online</span></span>
          </div>
        </div>

        <div class="chat" aria-hidden="true">
          <div class="head">${ICON_HASH}<span>design-system</span></div>
          <div class="log">
            <div class="msg">
              <span class="av" style="--av:96">KJ</span>
              <div class="body">
                <div class="line"><span class="who">kaj</span><time>10:58</time></div>
                <p>Which part of this is doing the heavy lifting? It cannot all be selectors.</p>
              </div>
            </div>
            <div class="msg">
              <span class="av" style="--av:52">RB</span>
              <div class="body">
                <div class="line"><span class="who">robin</span><time>11:01</time></div>
                <p>Most of it is Discord&rsquo;s own variables, reassigned. Only geometry and motion need class names.</p>
              </div>
            </div>
            <div class="msg">
              <span class="av" style="--av:52">RB</span>
              <div class="body">
                <div class="line"><span class="who">robin</span><time>11:04</time></div>
                <p>Surfaces go six tiers deep, every one of them tinted with the seed hue. Nothing is flat grey.</p>
              </div>
            </div>
            <div class="msg">
              <span class="av" style="--av:-46">TH</span>
              <div class="body">
                <div class="line"><span class="who">theo</span><span class="tag">BOT</span><time>11:06</time></div>
                <p>Built <code>main.css</code> in 1.4s and published it to Pages.</p>
                <div class="reacts"><span class="me">&#128077; 4</span><span>&#127881; 2</span></div>
              </div>
            </div>
            <div class="msg">
              <span class="av" style="--av:0">AE</span>
              <div class="body">
                <div class="line"><span class="who">aeycen</span><time>11:09</time></div>
                <p><span class="at">@robin</span> mentions and unread markers are the only things using tertiary.</p>
              </div>
            </div>
          </div>
          <div class="composer">Message #design-system</div>
        </div>

        <div class="members" aria-hidden="true">
          <ul>
            <li class="cat">Online &mdash; 3</li>
            ${member('AE', 'aeycen', '0', 'on')}
            ${member('RB', 'robin', '52')}
            ${member('TH', 'theo', '-46')}
            <li class="cat">Offline &mdash; 1</li>
            ${member('KJ', 'kaj', '96', 'off')}
          </ul>
        </div>
      </div>
    </div>

    <div class="hue">
      <label for="hue">--t-hue</label>
      <div class="track" id="track">
        <input id="hue" type="range" min="0" max="360" step="1" value="${HUE_DEFAULT}">
      </div>
      <span class="val" id="hueval" aria-hidden="true">${HUE_DEFAULT}</span>
      <button id="copyhue" type="button" class="secondary" data-label="Copy hue">Copy hue</button>
    </div>
    <p class="caption">
      Drag to retune the preview and this page together, the way the theme retunes Discord.
      Copy the hue to paste it into your QuickCSS.
    </p>
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
      <button id="copyurl" type="button" data-label="Copy URL" data-url="${esc(importUrl)}">Copy URL</button>
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

</div>
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

  function onCopy(id, read, done, selectId) {
    var b = document.getElementById(id);
    b.addEventListener('click', function () {
      var text = read();
      var reset = function () { setTimeout(function () { b.textContent = b.dataset.label; }, 2000); };
      var ok = function () { b.textContent = done; reset(); };
      // last resort: put the text under a selection so it can be copied by hand
      var select = function () {
        var r = document.createRange();
        r.selectNodeContents(document.getElementById(selectId));
        var s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        b.textContent = 'Select and copy';
        reset();
      };
      if (writeClipboard(text)) return ok();
      if (navigator.clipboard) return navigator.clipboard.writeText(text).then(ok, select);
      select();
    });
  }
  onCopy('copyhue', function () { return '--t-hue: ' + hue.value + ';'; }, 'Hue copied', 'hueval');
  onCopy('copyurl', function () { return document.getElementById('copyurl').dataset.url; }, 'URL copied', 'url');
})();
</script>
</body>
</html>
`;

await mkdir(new URL('../public/', import.meta.url), { recursive: true });
await writeFile(OUT, html);
for (const asset of ASSETS) {
  await copyFile(new URL(`../assets/${asset}`, import.meta.url), new URL(`../public/${asset}`, import.meta.url));
}

console.log(`public/index.html written (${html.length} bytes) for ${v.themeName} v${v.version}`);
console.log(`  install URL: ${importUrl}`);
console.log(`  copied ${ASSETS.map((a) => `assets/${a}`).join(', ')} -> public/`);
