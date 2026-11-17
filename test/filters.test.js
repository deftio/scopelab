// Run: node --test test/
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const F = require('../public/filters.js');

function solid(w, h, v) {
  const img = F.makeImage(w, h);
  for (let j = 0; j < img.data.length; j += 4) { img.data[j] = v; img.data[j + 1] = v; img.data[j + 2] = v; img.data[j + 3] = 255; }
  return img;
}
// Left half black, right half white: a vertical edge at x = w/2.
function step(w, h) {
  const img = F.makeImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = (y * w + x) * 4, v = x < w / 2 ? 0 : 255;
    img.data[j] = img.data[j + 1] = img.data[j + 2] = v; img.data[j + 3] = 255;
  }
  return img;
}
const px = (img, x, y) => img.data[(y * img.w + x) * 4];

test('every filter runs with default params, keeps size, and does not mutate input', () => {
  const src = step(40, 30), copy = new Uint8ClampedArray(src.data);
  for (const f of F.FILTERS) {
    const out = f.apply(src, F.defaultParams(f.id));
    assert.strictEqual(out.w, 40, f.id); assert.strictEqual(out.h, 30, f.id);
    assert.strictEqual(out.data.length, 40 * 30 * 4, f.id);
    assert.notStrictEqual(out.data, src.data, f.id + ' returned its input buffer');
    assert.deepStrictEqual(src.data, copy, f.id + ' mutated its input');
    for (let j = 3; j < out.data.length; j += 4) assert.strictEqual(out.data[j], 255, f.id + ' alpha');
  }
});

test('gaussian kernel is normalised and blur preserves a flat field', () => {
  const k = F.gaussKernel(2);
  assert.ok(Math.abs(k.reduce((a, b) => a + b, 0) - 1) < 1e-6);
  const out = F.byId('gaussian').apply(solid(20, 20, 100), { sigma: 3 });
  for (let j = 0; j < out.data.length; j += 4) assert.ok(Math.abs(out.data[j] - 100) <= 1);
});

test('edge filters: zero on flat field, strong response on the step', () => {
  for (const id of ['sobel', 'scharr', 'prewitt']) {
    const f = F.byId(id), p = F.defaultParams(id);
    const flat = f.apply(solid(20, 20, 128), p);
    assert.strictEqual(px(flat, 10, 10), 0, id + ' flat');
    const e = f.apply(step(20, 20), p);
    assert.ok(px(e, 10, 10) > 200, id + ' at edge: ' + px(e, 10, 10));
    assert.strictEqual(px(e, 3, 10), 0, id + ' away from edge');
  }
  const lap = F.byId('laplacian').apply(step(20, 20), F.defaultParams('laplacian'));
  assert.ok(px(lap, 9, 10) > 0 || px(lap, 10, 10) > 0, 'laplacian responds at edge');
  assert.strictEqual(px(lap, 3, 10), 0, 'laplacian flat');
});

test('canny gives a thin vertical line on a step edge', () => {
  const out = F.byId('canny').apply(step(40, 20), F.defaultParams('canny'));
  for (let y = 4; y < 16; y++) {
    let n = 0;
    for (let x = 0; x < 40; x++) if (px(out, x, y) === 255) { n++; assert.ok(Math.abs(x - 20) <= 2, 'edge near centre, got x=' + x); }
    assert.ok(n >= 1 && n <= 2, 'row ' + y + ' has ' + n + ' edge pixels');
  }
});

test('otsu splits a bimodal histogram between the modes', () => {
  const h = new Uint32Array(256); h[40] = 500; h[200] = 500;
  const t = F.otsuThreshold(h, 1000);
  assert.ok(t >= 40 && t < 200, 'threshold ' + t);
  const out = F.byId('threshold').apply(step(10, 10), { value: 128, otsu: true, invert: false });
  assert.strictEqual(px(out, 1, 1), 0); assert.strictEqual(px(out, 8, 1), 255);
});

test('histogram counts and stats', () => {
  const H = F.histogram(step(10, 10), 1);
  assert.strictEqual(H.count, 100);
  assert.strictEqual(H.l[0], 50); assert.strictEqual(H.l[255], 50);
  const s = F.histStats(H.l, H.count);
  assert.strictEqual(s.min, 0); assert.strictEqual(s.max, 255);
  assert.ok(Math.abs(s.mean - 127.5) < 1e-9);
  assert.strictEqual(s.clipLow, 50); assert.strictEqual(s.clipHigh, 50);
});

test('median removes an isolated hot pixel', () => {
  const img = solid(9, 9, 50); const j = (4 * 9 + 4) * 4;
  img.data[j] = img.data[j + 1] = img.data[j + 2] = 255;
  assert.strictEqual(px(F.byId('median').apply(img, { radius: 1 }), 4, 4), 50);
});

test('runChain applies enabled stages in order and skips disabled ones', () => {
  const out = F.runChain(solid(4, 4, 10), [
    { id: 'invert', enabled: true, params: {} },
    { id: 'invert', enabled: false, params: {} }
  ]);
  assert.strictEqual(px(out, 0, 0), 245);
});

test('LoG zero crossings still find a step edge after heavy blur (regression)', () => {
  for (const sigma of [0, 2, 4]) {
    const out = F.byId('laplacian').apply(step(60, 20), Object.assign(F.defaultParams('laplacian'), { sigma, mode: 'zero-crossings' }));
    let hits = 0;
    for (let x = 0; x < 60; x++) if (px(out, x, 10) === 255) { hits++; assert.ok(Math.abs(x - 30) <= 2, 'sigma ' + sigma + ' edge at x=' + x); }
    assert.ok(hits >= 1, 'sigma ' + sigma + ' found no zero crossing');
  }
});
