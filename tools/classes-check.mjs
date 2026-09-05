#!/usr/bin/env node
// Compare src/backend/_classes.scss against ClearVision v7's upstream map.
//
// Discord rotates hashed class names. ClearVision maintains a large map of them
// (Apache-2.0); most of our entries mirror theirs. This reports every leaf whose
// upstream value has moved, so a rotation is a one-line patch instead of a hunt.
//
//   node tools/classes-check.mjs            compare against upstream
//   node tools/classes-check.mjs --apply    rewrite changed values in place
//
// UNION and LOCAL entries are reported separately and never rewritten.

import { readFile, writeFile } from 'node:fs/promises';

const UPSTREAM =
  'https://raw.githubusercontent.com/ClearVision/ClearVision-v7/master/src/backend/_classes.scss';
const LOCAL = new URL('../src/backend/_classes.scss', import.meta.url);
const APPLY = process.argv.includes('--apply');

function stripComments(s) {
  let out = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { out += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; out += c; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i); i = e === -1 ? s.length : e + 1; continue; }
    out += c;
  }
  return out;
}

function mapBlock(raw) {
  const start = raw.indexOf('$classes:');
  if (start === -1) throw new Error('no $classes map found');
  const open = raw.indexOf('(', start);
  let depth = 0;
  for (let i = open; i < raw.length; i++) {
    if (raw[i] === '(') depth++;
    else if (raw[i] === ')' && --depth === 0) return raw.slice(open + 1, i);
  }
  throw new Error('unbalanced $classes map');
}

const TOKEN = /'([^']*)'|"([^"]*)"|([(){}\[\],:])|(\S)/g;
function tokenize(s) {
  const t = [];
  for (const m of s.matchAll(TOKEN)) {
    if (m[1] !== undefined) t.push(['STR', m[1]]);
    else if (m[2] !== undefined) t.push(['STR', m[2]]);
    else if (m[3] !== undefined) t.push(['PUNC', m[3]]);
    else t.push(['BARE', m[4]]);
  }
  return t;
}

/** flatten a Sass class map into { "a b c": [values] } */
function flatten(scss) {
  const t = tokenize(mapBlock(stripComments(scss)));
  const leaves = new Map();
  const stack = [];
  for (let i = 0; i < t.length;) {
    const [kind, val] = t[i];
    if (kind === 'PUNC' && (val === ')' || val === ']')) { stack.pop(); i++; continue; }
    if (kind !== 'STR' || !(t[i + 1] && t[i + 1][0] === 'PUNC' && t[i + 1][1] === ':')) { i++; continue; }
    const key = val;
    let j = i + 2;
    if (t[j] && t[j][0] === 'PUNC' && (t[j][1] === '(' || t[j][1] === '[')) {
      let depth = 0, p = j + 1, isMap = false;
      for (; p < t.length; p++) {
        const [tk, tv] = t[p];
        if (tk === 'PUNC' && (tv === '(' || tv === '[')) depth++;
        else if (tk === 'PUNC' && (tv === ')' || tv === ']')) { if (depth === 0) break; depth--; }
        else if (tk === 'PUNC' && tv === ':' && depth === 0) { isMap = true; break; }
      }
      if (isMap) { stack.push(key); i = j + 1; continue; }
      const items = [];
      for (p = j + 1; p < t.length && !(t[p][0] === 'PUNC' && (t[p][1] === ')' || t[p][1] === ']')); p++)
        if (t[p][0] === 'STR') items.push(t[p][1]);
      leaves.set([...stack, key].join(' '), items);
      i = p + 1; continue;
    }
    if (t[j] && t[j][0] === 'STR') {
      const items = [];
      for (; j < t.length && t[j][0] === 'STR'; j++) items.push(t[j][1]);
      leaves.set([...stack, key].join(' '), items);
      i = j; continue;
    }
    i = j;
  }
  return leaves;
}

const clean = (v) => (v.startsWith('!') || v.startsWith('@') ? v.slice(1) : v);

const localSrc = await readFile(LOCAL, 'utf8');
const mine = flatten(localSrc);

const res = await fetch(UPSTREAM);
if (!res.ok) { console.error(`upstream fetch failed: ${res.status} ${res.statusText}`); process.exit(2); }
const theirs = flatten(await res.text());

// Walk the map textually so every leaf is tied to both its full path and the
// line it sits on: the path tells us what to compare, the line number tells
// --apply exactly which line to rewrite (leaf keys like 'footer' repeat).
const marked = new Set();
const lineOf = new Map();
const lines = localSrc.split(/\r?\n/);
{
  const stack = [];
  lines.forEach((line, i) => {
    const openMap = line.match(/^\s*'([^']+)':\s*\($/);
    if (openMap) { stack.push(openMap[1]); return; }
    if (/^\s*\),\s*$/.test(line)) { stack.pop(); return; }
    const leaf = line.match(/^\s*'([^']+)':/);
    if (!leaf) return;
    const path = [...stack, leaf[1]].join(' ');
    lineOf.set(path, i);
    if (/\/\/\s*(UNION|LOCAL)\b/.test(line)) marked.add(path);
  });
}

const moved = [], gone = [], hand = [];
for (const [path, vals] of mine) {
  if (marked.has(path)) { hand.push(path); continue; }
  const up = theirs.get(path);
  if (!up) { gone.push(path); continue; }
  const a = vals.map(clean).join(' '), b = up.map(clean).join(' ');
  if (a !== b) moved.push({ path, from: vals.map(clean), to: up.map(clean) });
}

console.log(`checked ${mine.size} leaves against ClearVision v7`);
console.log(`  in sync:          ${mine.size - moved.length - gone.length - hand.length}`);
console.log(`  moved upstream:   ${moved.length}`);
console.log(`  missing upstream: ${gone.length}`);
console.log(`  hand-maintained:  ${hand.length}  (UNION / LOCAL, never rewritten)`);

if (moved.length) {
  console.log('\nupstream has different values:');
  for (const m of moved) console.log(`  ${m.path}\n    ours: ${m.from.join(', ')}\n    them: ${m.to.join(', ')}`);
}
if (gone.length) {
  console.log('\nno longer in upstream (check by hand, they may have renamed the path):');
  for (const p of gone) console.log(`  ${p} -> ${mine.get(p).join(', ')}`);
}

if (APPLY && moved.length) {
  const VALUE = /^(\s*'[^']+':\s*)(?:'[^']*'|\([^)]*\))(,.*)$/;
  let applied = 0;
  for (const m of moved) {
    const i = lineOf.get(m.path);
    const match = i === undefined ? null : lines[i].match(VALUE);
    if (!match) { console.error(`  could not rewrite ${m.path}`); continue; }
    const value = m.to.length === 1 ? `'${m.to[0]}'` : `(${m.to.map((v) => `'${v}'`).join(' ')})`;
    lines[i] = `${match[1]}${value}${match[2]}`;
    applied++;
  }
  await writeFile(LOCAL, lines.join(localSrc.includes('\r\n') ? '\r\n' : '\n'));
  console.log(`\napplied ${applied} update(s) to src/backend/_classes.scss`);
} else if (moved.length) {
  console.log('\nrun with --apply to write these values into the map.');
  process.exitCode = 1;
}
