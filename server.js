#!/usr/bin/env node
/*
 * server.js -- tiny static server for the USB endoscope viewer.
 *
 *   node server.js            -> http://localhost:8090
 *   PORT=9000 node server.js
 *
 * Why a server at all: camera access (getUserMedia) and WebUSB need a secure
 * context, and http://localhost is one. The server also gives captures a
 * place to land on disk (./captures) besides the browser's download folder.
 * Zero dependencies beyond bitwrench, which it serves from node_modules.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '8090', 10);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const CAPTURES = path.join(ROOT, 'captures');
const BW_DIST = path.join(ROOT, 'node_modules', 'bitwrench', 'dist');
const MAX_UPLOAD = 2 * 1024 * 1024 * 1024; // 2 GB, long recordings

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.map': 'application/json'
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found');
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(file).pipe(res);
  });
}

/** Resolve a URL path inside `base`, refusing anything that escapes it. */
function inside(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

/** Keep capture names to a safe, flat file name. */
function safeName(name) {
  const base = path.basename(String(name || '')).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  return /\.(png|jpg|webm|mp4)$/i.test(base) ? base : null;
}

function saveCapture(req, res, name) {
  const file = safeName(name);
  if (!file) return send(res, 400, JSON.stringify({ ok: false, error: 'bad name' }), 'application/json');
  fs.mkdirSync(CAPTURES, { recursive: true });
  const dest = path.join(CAPTURES, file);
  const out = fs.createWriteStream(dest);
  let size = 0, aborted = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_UPLOAD && !aborted) {
      aborted = true;
      out.destroy();
      fs.unlink(dest, () => {});
      send(res, 413, JSON.stringify({ ok: false, error: 'too large' }), 'application/json');
      req.destroy();
    }
  });
  req.pipe(out);
  out.on('finish', () => {
    if (aborted) return;
    console.log('saved', path.relative(ROOT, dest), (size / 1024).toFixed(0) + ' KB');
    send(res, 200, JSON.stringify({ ok: true, file: path.relative(ROOT, dest), size }), 'application/json');
  });
  out.on('error', (e) => { if (!aborted) send(res, 500, JSON.stringify({ ok: false, error: e.message }), 'application/json'); });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);

  if (p === '/api/ping') {
    return send(res, 200, JSON.stringify({ ok: true, dir: CAPTURES }), 'application/json');
  }
  if (p === '/api/save' && req.method === 'POST') {
    return saveCapture(req, res, url.searchParams.get('name'));
  }
  if (p.startsWith('/vendor/')) {
    const f = inside(BW_DIST, p.slice('/vendor/'.length));
    return f ? serveFile(res, f) : send(res, 403, 'forbidden');
  }
  const f = inside(PUBLIC, p === '/' ? 'index.html' : p.slice(1));
  return f ? serveFile(res, f) : send(res, 403, 'forbidden');
});

server.listen(PORT, HOST, () => {
  console.log('USB endoscope viewer: http://localhost:' + PORT);
  console.log('Captures are saved to ' + CAPTURES);
  console.log('Open it in Chrome or Edge (needed for WebUSB).');
});
