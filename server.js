#!/usr/bin/env node
/*
 * server.js -- tiny static server for the USB endoscope viewer.
 *
 *   npm start                 -> http://localhost:8642
 *   PORT=9000 npm start       -> pick another port
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

// Default port lives in package.json ("config": { "port": ... }); npm exposes
// it as npm_package_config_port. PORT overrides it.
const PORT = parseInt(process.env.PORT || process.env.npm_package_config_port || '8642', 10);
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
  // Same path bwcli serve uses for the library, so the page works under both.
  if (p.startsWith('/bw/lib/')) {
    const f = inside(BW_DIST, p.slice('/bw/lib/'.length));
    return f ? serveFile(res, f) : send(res, 403, 'forbidden');
  }
  const f = inside(PUBLIC, p === '/' ? 'index.html' : p.slice(1));
  return f ? serveFile(res, f) : send(res, 403, 'forbidden');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('\n  Port ' + PORT + ' is already in use by another program.');
    console.error('  Pick another one, e.g.:  PORT=' + (PORT + 10) + ' npm start\n');
  } else {
    console.error(e);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  USB Endoscope viewer');
  console.log('  Running on port ' + PORT + ':  http://localhost:' + PORT);
  console.log('  Captures saved to:  ' + path.relative(process.cwd(), CAPTURES) + '/');
  console.log('  Open the URL in Chrome or Edge. Press Ctrl+C to stop.');
  console.log('');
});
