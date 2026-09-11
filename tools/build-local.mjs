#!/usr/bin/env node
// Generate test/local.css - the whole theme as one pasteable file.
//
// What users paste is a six-kilobyte wrapper: an @import pulling the published
// stylesheet off GitHub Pages, plus their own :root overrides. That is right for
// them and useless for testing a local change - the @import fetches what is
// already live, never what is sitting in build/.
//
// So this splices together the two halves the wrapper keeps apart: the freshly
// compiled core in place of the @import, with the wrapper's settings block still
// after it. That is the same order the real chain loads them in, so a token the
// settings block overrides still wins here, exactly as it would for a user.
//
// Output is gitignored. Run after build:css and build:dist.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';

const COMPILED = new URL('../build/main.css', import.meta.url);
const DIST_SRC = new URL('../dist/', import.meta.url);
const ROOT = new URL('../', import.meta.url);
const TEST_DIR = new URL('../test/', import.meta.url);
const OUT = new URL('../test/local.css', import.meta.url);

// Same lookup as build-landing: the distributable is named after the file in
// dist/, not after $themeName - those two differ, and guessing pointed at a 404.
const distName = (await readdir(DIST_SRC))
  .filter((f) => f.endsWith('.scss') && !f.startsWith('_'))
  .map((f) => f.replace(/\.scss$/, '.css'))[0];
if (!distName) throw new Error('no distributable source in dist/');

const core = await readFile(COMPILED, 'utf8').catch(() => {
  throw new Error('build/main.css missing - run build:css first');
});
const wrapper = await readFile(new URL(distName, ROOT), 'utf8').catch(() => {
  throw new Error(`${distName} missing - run build:dist first`);
});

// The wrapper reads: meta header, then "/* IMPORT CSS */" with the @import, then
// "/* SETTINGS" and the :root block. Keep the first and the last, drop the middle.
const importAt = wrapper.indexOf('/* IMPORT CSS */');
const settingsAt = wrapper.indexOf('/* SETTINGS');
if (importAt < 0 || settingsAt < 0) {
  throw new Error(`cannot locate the @import block in ${distName} - has dist/ changed shape?`);
}
const meta = wrapper.slice(0, importAt).trimEnd();
const settings = wrapper.slice(settingsAt).trimEnd();

// Order matters and is load-bearing: the core opens with its own @import of the
// Google fallback fonts, and CSS drops an @import that any rule precedes. The
// meta header is a comment, so it may sit in front; nothing else may.
const out = `${meta}\n${core.trimEnd()}\n\n${settings}\n`;

// The whole point of the file is that it pulls nothing. The font import is the
// one exception; anything else means the splice above missed the @import and the
// paste would silently test the published theme instead of the working tree.
const stray = [...out.matchAll(/@import\s+url\(\s*["']?([^"')]+)/g)]
  .map((m) => m[1])
  .filter((u) => !u.includes('fonts.googleapis.com'));
if (stray.length) {
  throw new Error(`a remote @import survived (${stray.join(', ')}) - would still load the published theme`);
}

await mkdir(TEST_DIR, { recursive: true });
await writeFile(OUT, out);
console.log(
  `test/local.css written (${Math.round(out.length / 1024)} KB) - paste into QuickCSS to test the working tree`,
);
