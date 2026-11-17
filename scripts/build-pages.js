#!/usr/bin/env node
/*
 * npm run build:pages -- assemble the static site for GitHub Pages in _site/.
 *
 * The app is already static; the only thing GitHub Pages lacks is bitwrench,
 * which the local servers serve from node_modules. This copies public/ and
 * the installed bitwrench build (pinned by package-lock.json) side by side:
 *
 *   _site/index.html, app.js, filters.js
 *   _site/bw/lib/bitwrench.umd.min.js
 *
 * All page paths are relative, so the site works at
 * https://<user>.github.io/<repo>/ as well as at a domain root.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_site');
const BW = path.join(ROOT, 'node_modules', 'bitwrench', 'dist', 'bitwrench.umd.min.js');

if (!fs.existsSync(BW)) {
  console.error('bitwrench is not installed -- run npm install (or npm ci) first.');
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'bw', 'lib'), { recursive: true });
fs.copyFileSync(BW, path.join(OUT, 'bw', 'lib', 'bitwrench.umd.min.js'));

const version = require(path.join(ROOT, 'node_modules', 'bitwrench', 'package.json')).version;
console.log('Built _site/ (bitwrench ' + version + '):');
for (const f of fs.readdirSync(OUT, { recursive: true })) {
  const full = path.join(OUT, f);
  if (fs.statSync(full).isFile()) console.log('  ' + f + '  ' + (fs.statSync(full).size / 1024).toFixed(1) + ' KB');
}
