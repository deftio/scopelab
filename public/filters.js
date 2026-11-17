/*
 * filters.js -- classical image-processing filters for the endoscope viewer.
 *
 * Pure functions over images of the shape { w, h, data: Uint8ClampedArray (RGBA) }.
 * No DOM, so the same file runs in the browser (window.EndoFilters) and in
 * Node for tests (require('./filters.js')).
 *
 * Every filter returns a NEW image and never mutates its input, so the raw
 * frame stays available for split view, histograms and raw captures.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EndoFilters = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- helpers

  function makeImage(w, h) {
    return { w: w, h: h, data: new Uint8ClampedArray(w * h * 4) };
  }

  function cloneImage(img) {
    return { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
  }

  function clampi(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /** Rec.601 luma as a Float32 plane. */
  function toGray(img) {
    var n = img.w * img.h, g = new Float32Array(n), d = img.data;
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    }
    return g;
  }

  /** Float plane -> grey RGBA image (values are clamped by the typed array). */
  function grayToImage(g, w, h) {
    var out = makeImage(w, h), d = out.data, n = w * h;
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      var v = g[i];
      d[j] = v; d[j + 1] = v; d[j + 2] = v; d[j + 3] = 255;
    }
    return out;
  }

  function gaussKernel(sigma) {
    var r = Math.max(1, Math.ceil(sigma * 3));
    var k = new Float32Array(2 * r + 1), sum = 0;
    for (var i = -r; i <= r; i++) {
      var v = Math.exp(-(i * i) / (2 * sigma * sigma));
      k[i + r] = v; sum += v;
    }
    for (var m = 0; m < k.length; m++) k[m] /= sum;
    return k;
  }

  function boxKernel(radius) {
    var n = 2 * radius + 1, k = new Float32Array(n);
    for (var i = 0; i < n; i++) k[i] = 1 / n;
    return k;
  }

  /**
   * Separable convolution of an interleaved float buffer with `ch` channels
   * per pixel, clamp-to-edge borders. Taps are the outer loop and pixels the
   * inner one, so the hot loop is a straight multiply-add over a row with no
   * bounds checks (each row is padded once instead).
   */
  function convolveSep(src, w, h, ch, k) {
    var r = (k.length - 1) >> 1, rowLen = w * ch, n = rowLen * h;
    var tmp = new Float32Array(n), out = new Float32Array(n);
    var pad = new Float32Array((w + 2 * r) * ch), x, y, i, c, kv, base;
    // horizontal
    for (y = 0; y < h; y++) {
      base = y * rowLen;
      for (x = -r; x < w + r; x++) {
        var sx = (x < 0 ? 0 : (x >= w ? w - 1 : x)) * ch, px = (x + r) * ch;
        for (c = 0; c < ch; c++) pad[px + c] = src[base + sx + c];
      }
      for (i = 0; i < k.length; i++) {
        kv = k[i];
        var off = i * ch;
        for (x = 0; x < rowLen; x++) tmp[base + x] += kv * pad[off + x];
      }
    }
    // vertical
    for (y = 0; y < h; y++) {
      base = y * rowLen;
      for (i = -r; i <= r; i++) {
        kv = k[i + r];
        var srow = clampi(y + i, 0, h - 1) * rowLen;
        for (x = 0; x < rowLen; x++) out[base + x] += kv * tmp[srow + x];
      }
    }
    return out;
  }

  function convolvePlane(src, w, h, k) { return convolveSep(src, w, h, 1, k); }

  /** Separable convolution of the RGB channels of an RGBA image. */
  function convolveRGB(img, k) {
    var w = img.w, h = img.h, d = img.data, n = w * h, rgb = new Float32Array(n * 3), i, j, q;
    for (i = 0, j = 0, q = 0; i < n; i++, j += 4, q += 3) { rgb[q] = d[j]; rgb[q + 1] = d[j + 1]; rgb[q + 2] = d[j + 2]; }
    var res = convolveSep(rgb, w, h, 3, k), out = makeImage(w, h), o = out.data;
    for (i = 0, j = 0, q = 0; i < n; i++, j += 4, q += 3) { o[j] = res[q]; o[j + 1] = res[q + 1]; o[j + 2] = res[q + 2]; o[j + 3] = 255; }
    return out;
  }

  function gaussianRGB(img, sigma) {
    return sigma > 0 ? convolveRGB(img, gaussKernel(sigma)) : cloneImage(img);
  }

  /** Apply a 256-entry lookup table per channel (lut may be one table or [r,g,b]). */
  function applyLUT(img, lut) {
    var lr = lut.length === 3 ? lut[0] : lut, lg = lut.length === 3 ? lut[1] : lut, lb = lut.length === 3 ? lut[2] : lut;
    var out = makeImage(img.w, img.h), s = img.data, d = out.data;
    for (var j = 0; j < s.length; j += 4) {
      d[j] = lr[s[j]]; d[j + 1] = lg[s[j + 1]]; d[j + 2] = lb[s[j + 2]]; d[j + 3] = 255;
    }
    return out;
  }

  /**
   * 3x3 gradient of a float plane with the smoothing kernel [a, b, a]
   * (Sobel: 1,2 -- Scharr: 3,10 -- Prewitt: 1,1). Normalised so that a
   * 0->255 step gives a magnitude of about 255.
   */
  function gradient(g, w, h, a, b) {
    var gx = new Float32Array(w * h), gy = new Float32Array(w * h), norm = 2 * (2 * a + b);
    for (var y = 0; y < h; y++) {
      var ym = (y > 0 ? y - 1 : 0) * w, y0 = y * w, yp = (y < h - 1 ? y + 1 : h - 1) * w;
      for (var x = 0; x < w; x++) {
        var xm = x > 0 ? x - 1 : 0, xp = x < w - 1 ? x + 1 : w - 1;
        var tl = g[ym + xm], tc = g[ym + x], tr = g[ym + xp];
        var ml = g[y0 + xm], mr = g[y0 + xp];
        var bl = g[yp + xm], bc = g[yp + x], br = g[yp + xp];
        gx[y0 + x] = (a * (tr - tl) + b * (mr - ml) + a * (br - bl)) * 2 / norm;
        gy[y0 + x] = (a * (bl - tl) + b * (bc - tc) + a * (br - tr)) * 2 / norm;
      }
    }
    return { gx: gx, gy: gy };
  }

  function hsvToRgb(h, s, v) {
    var i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    switch (((i % 6) + 6) % 6) {
      case 0: return [v, t, p];
      case 1: return [q, v, p];
      case 2: return [p, v, t];
      case 3: return [p, q, v];
      case 4: return [t, p, v];
      default: return [v, p, q];
    }
  }

  function renderGradient(img, p, a, b) {
    var w = img.w, h = img.h, g = toGray(img);
    if (p.sigma > 0) g = convolvePlane(g, w, h, gaussKernel(p.sigma));
    var G = gradient(g, w, h, a, b), gain = p.gain, n = w * h, out, i;
    if (p.mode === 'direction') {
      out = makeImage(w, h);
      var d = out.data;
      for (i = 0; i < n; i++) {
        var mag = Math.min(1, Math.sqrt(G.gx[i] * G.gx[i] + G.gy[i] * G.gy[i]) * gain / 255);
        var ang = (Math.atan2(G.gy[i], G.gx[i]) + Math.PI) / (2 * Math.PI);
        var c = hsvToRgb(ang, 1, mag), j = i * 4;
        d[j] = c[0] * 255; d[j + 1] = c[1] * 255; d[j + 2] = c[2] * 255; d[j + 3] = 255;
      }
      return out;
    }
    var m = new Float32Array(n);
    for (i = 0; i < n; i++) {
      if (p.mode === 'x') m[i] = 128 + G.gx[i] * gain / 2;
      else if (p.mode === 'y') m[i] = 128 + G.gy[i] * gain / 2;
      else m[i] = Math.sqrt(G.gx[i] * G.gx[i] + G.gy[i] * G.gy[i]) * gain;
    }
    return grayToImage(m, w, h);
  }

  function otsuThreshold(hist, total) {
    var sum = 0, i;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, best = 0, thr = 127;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = i; }
    }
    return thr;
  }

  function grayHist(g) {
    var hist = new Uint32Array(256);
    for (var i = 0; i < g.length; i++) hist[clampi(Math.round(g[i]), 0, 255)]++;
    return hist;
  }

  /** Separable min or max filter over the RGB channels (square window). */
  function rankRGB(img, radius, useMax) {
    var w = img.w, h = img.h, s = img.data, tmp = new Uint8ClampedArray(s.length), out = makeImage(w, h), o = out.data;
    var x, y, i, c, p, v, best;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        p = (y * w + x) * 4;
        for (c = 0; c < 3; c++) {
          best = useMax ? 0 : 255;
          for (i = -radius; i <= radius; i++) {
            v = s[(y * w + clampi(x + i, 0, w - 1)) * 4 + c];
            if (useMax ? v > best : v < best) best = v;
          }
          tmp[p + c] = best;
        }
      }
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        p = (y * w + x) * 4;
        for (c = 0; c < 3; c++) {
          best = useMax ? 0 : 255;
          for (i = -radius; i <= radius; i++) {
            v = tmp[(clampi(y + i, 0, h - 1) * w + x) * 4 + c];
            if (useMax ? v > best : v < best) best = v;
          }
          o[p + c] = best;
        }
        o[p + 3] = 255;
      }
    }
    return out;
  }

  // Colormap stops (approximations of the matplotlib / Google maps).
  var COLORMAPS = {
    inferno: [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]],
    viridis: [[68, 1, 84], [70, 50, 127], [54, 92, 141], [39, 127, 142], [31, 161, 135], [74, 194, 109], [159, 218, 58], [253, 231, 37]],
    turbo: [[48, 18, 59], [70, 107, 227], [41, 187, 236], [49, 242, 153], [163, 253, 61], [237, 208, 58], [251, 128, 34], [208, 47, 5], [122, 4, 3]],
    jet: [[0, 0, 131], [0, 60, 170], [5, 255, 255], [255, 255, 0], [250, 0, 0], [128, 0, 0]],
    bone: [[0, 0, 0], [84, 84, 116], [167, 199, 199], [255, 255, 255]]
  };

  var _cmapCache = {};
  function colormapLUT(name) {
    if (_cmapCache[name]) return _cmapCache[name];
    var stops = COLORMAPS[name] || COLORMAPS.inferno, lut = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
    for (var i = 0; i < 256; i++) {
      var t = i / 255 * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
      for (var c = 0; c < 3; c++) lut[c][i] = Math.round(stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f);
    }
    _cmapCache[name] = lut;
    return lut;
  }

  function cannyEdges(img, sigma, low, high) {
    var w = img.w, h = img.h, n = w * h, g = toGray(img);
    if (sigma > 0) g = convolvePlane(g, w, h, gaussKernel(sigma));
    var G = gradient(g, w, h, 1, 2), mag = new Float32Array(n), i, x, y;
    for (i = 0; i < n; i++) mag[i] = Math.sqrt(G.gx[i] * G.gx[i] + G.gy[i] * G.gy[i]);
    // Non-maximum suppression along the quantised gradient direction.
    var nms = new Float32Array(n);
    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        i = y * w + x;
        var m = mag[i];
        if (m < low) continue;
        // Quantise the gradient direction to 0/45/90/135 degrees without atan2:
        // tan(22.5) = 0.4142, tan(67.5) = 2.4142.
        var gxv = G.gx[i], gyv = G.gy[i], ax = gxv < 0 ? -gxv : gxv, ay = gyv < 0 ? -gyv : gyv, a, b;
        if (ay <= ax * 0.41421356) { a = mag[i - 1]; b = mag[i + 1]; }
        else if (ay >= ax * 2.41421356) { a = mag[i - w]; b = mag[i + w]; }
        else if (gxv * gyv > 0) { a = mag[i - w - 1]; b = mag[i + w + 1]; }
        else { a = mag[i - w + 1]; b = mag[i + w - 1]; }
        if (m >= a && m >= b) nms[i] = m;
      }
    }
    // Double threshold + hysteresis (iterative flood from strong edges).
    var edges = new Uint8Array(n), stack = [];
    for (i = 0; i < n; i++) if (nms[i] >= high) { edges[i] = 1; stack.push(i); }
    while (stack.length) {
      var q = stack.pop(), qx = q % w, qy = (q - qx) / w;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var nx = qx + dx, ny = qy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          var k = ny * w + nx;
          if (!edges[k] && nms[k] >= low) { edges[k] = 1; stack.push(k); }
        }
      }
    }
    return edges;
  }

  function hexToRgb(hex) {
    var v = parseInt(String(hex).replace('#', ''), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  // ---------------------------------------------------------------- filters
  //
  // Param types: range {min,max,step,value}, select {options,value}, bool {value}.

  var FILTERS = [
    {
      id: 'adjust', name: 'Brightness / contrast / gamma', group: 'Tone',
      params: [
        { key: 'brightness', label: 'Brightness', type: 'range', min: -100, max: 100, step: 1, value: 0 },
        { key: 'contrast', label: 'Contrast', type: 'range', min: -100, max: 100, step: 1, value: 0 },
        { key: 'gamma', label: 'Gamma', type: 'range', min: 0.2, max: 3, step: 0.05, value: 1 },
        { key: 'saturation', label: 'Saturation %', type: 'range', min: 0, max: 300, step: 5, value: 100 }
      ],
      apply: function (img, p) {
        var lut = new Uint8ClampedArray(256), c = (100 + p.contrast) / 100;
        c = c * c;
        for (var i = 0; i < 256; i++) {
          var v = Math.pow(i / 255, 1 / p.gamma) * 255;
          v = (v - 128) * c + 128 + p.brightness * 1.28;
          lut[i] = v;
        }
        var out = applyLUT(img, lut);
        if (p.saturation !== 100) {
          var s = p.saturation / 100, d = out.data;
          for (var j = 0; j < d.length; j += 4) {
            var y = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
            d[j] = y + (d[j] - y) * s; d[j + 1] = y + (d[j + 1] - y) * s; d[j + 2] = y + (d[j + 2] - y) * s;
          }
        }
        return out;
      }
    },
    {
      id: 'grayscale', name: 'Grayscale', group: 'Tone', params: [],
      apply: function (img) { return grayToImage(toGray(img), img.w, img.h); }
    },
    {
      id: 'invert', name: 'Invert', group: 'Tone', params: [],
      apply: function (img) {
        var lut = new Uint8ClampedArray(256);
        for (var i = 0; i < 256; i++) lut[i] = 255 - i;
        return applyLUT(img, lut);
      }
    },
    {
      id: 'autolevels', name: 'Auto levels (contrast stretch)', group: 'Tone',
      params: [
        { key: 'clip', label: 'Clip %', type: 'range', min: 0, max: 5, step: 0.1, value: 0.5 },
        { key: 'perChannel', label: 'Per channel (fixes colour cast)', type: 'bool', value: false }
      ],
      apply: function (img, p) {
        var H = histogram(img, 1), total = img.w * img.h, clip = total * p.clip / 100;
        function range(hist) {
          var lo = 0, hi = 255, acc = 0;
          for (lo = 0; lo < 255; lo++) { acc += hist[lo]; if (acc > clip) break; }
          acc = 0;
          for (hi = 255; hi > 0; hi--) { acc += hist[hi]; if (acc > clip) break; }
          return hi > lo ? [lo, hi] : [0, 255];
        }
        function lutFor(r) {
          var lut = new Uint8ClampedArray(256);
          for (var i = 0; i < 256; i++) lut[i] = (i - r[0]) * 255 / (r[1] - r[0]);
          return lut;
        }
        if (p.perChannel) return applyLUT(img, [lutFor(range(H.r)), lutFor(range(H.g)), lutFor(range(H.b))]);
        return applyLUT(img, lutFor(range(H.l)));
      }
    },
    {
      id: 'equalize', name: 'Histogram equalisation', group: 'Tone',
      params: [{ key: 'mode', label: 'Mode', type: 'select', options: ['luma', 'rgb'], value: 'luma' }],
      apply: function (img, p) {
        var total = img.w * img.h;
        function eqLUT(hist) {
          var lut = new Uint8ClampedArray(256), acc = 0, cdfMin = 0, i;
          for (i = 0; i < 256; i++) if (hist[i]) { cdfMin = hist[i]; break; }
          for (i = 0; i < 256; i++) {
            acc += hist[i];
            lut[i] = total > cdfMin ? (acc - cdfMin) * 255 / (total - cdfMin) : i;
          }
          return lut;
        }
        var H = histogram(img, 1);
        if (p.mode === 'rgb') return applyLUT(img, [eqLUT(H.r), eqLUT(H.g), eqLUT(H.b)]);
        return scaleByLuma(img, eqLUT(H.l));
      }
    },
    {
      id: 'clahe', name: 'CLAHE (local contrast)', group: 'Tone',
      params: [
        { key: 'tiles', label: 'Tiles per side', type: 'range', min: 2, max: 16, step: 1, value: 8 },
        { key: 'clip', label: 'Clip limit', type: 'range', min: 1, max: 10, step: 0.5, value: 2.5 }
      ],
      apply: function (img, p) { return clahe(img, p.tiles, p.clip); }
    },
    {
      id: 'gaussian', name: 'Gaussian blur', group: 'Smooth',
      params: [{ key: 'sigma', label: 'Sigma (px)', type: 'range', min: 0.3, max: 10, step: 0.1, value: 2 }],
      apply: function (img, p) { return gaussianRGB(img, p.sigma); }
    },
    {
      id: 'box', name: 'Box blur (mean)', group: 'Smooth',
      params: [{ key: 'radius', label: 'Radius (px)', type: 'range', min: 1, max: 15, step: 1, value: 2 }],
      apply: function (img, p) { return convolveRGB(img, boxKernel(p.radius)); }
    },
    {
      id: 'median', name: 'Median (salt & pepper)', group: 'Smooth',
      params: [{ key: 'radius', label: 'Radius (1 = 3x3, 2 = 5x5)', type: 'range', min: 1, max: 2, step: 1, value: 1 }],
      apply: function (img, p) {
        var w = img.w, h = img.h, s = img.data, out = makeImage(w, h), o = out.data, r = p.radius;
        var win = new Uint8Array((2 * r + 1) * (2 * r + 1)), mid = win.length >> 1;
        for (var y = 0; y < h; y++) {
          for (var x = 0; x < w; x++) {
            var q = (y * w + x) * 4;
            for (var c = 0; c < 3; c++) {
              var n = 0;
              for (var dy = -r; dy <= r; dy++) {
                var row = clampi(y + dy, 0, h - 1) * w;
                for (var dx = -r; dx <= r; dx++) {
                  // insertion sort as we fill the window
                  var v = s[(row + clampi(x + dx, 0, w - 1)) * 4 + c], k = n++;
                  while (k > 0 && win[k - 1] > v) { win[k] = win[k - 1]; k--; }
                  win[k] = v;
                }
              }
              o[q + c] = win[mid];
            }
            o[q + 3] = 255;
          }
        }
        return out;
      }
    },
    {
      id: 'bilateral', name: 'Bilateral (edge-preserving)', group: 'Smooth',
      params: [
        { key: 'radius', label: 'Radius (px)', type: 'range', min: 1, max: 4, step: 1, value: 2 },
        { key: 'sigmaR', label: 'Range sigma', type: 'range', min: 5, max: 100, step: 1, value: 25 }
      ],
      apply: function (img, p) {
        var w = img.w, h = img.h, s = img.data, out = makeImage(w, h), o = out.data, r = p.radius;
        var sigS = Math.max(1, r / 1.5), spatial = [], rangeLUT = new Float32Array(256 * 3), i;
        for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
          spatial.push(dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * sigS * sigS)));
        }
        for (i = 0; i < rangeLUT.length; i++) rangeLUT[i] = Math.exp(-(i * i) / (2 * p.sigmaR * p.sigmaR * 3));
        for (var y = 0; y < h; y++) {
          for (var x = 0; x < w; x++) {
            var q = (y * w + x) * 4, r0 = s[q], g0 = s[q + 1], b0 = s[q + 2], ar = 0, ag = 0, ab = 0, aw = 0;
            for (i = 0; i < spatial.length; i += 3) {
              var k = (clampi(y + spatial[i + 1], 0, h - 1) * w + clampi(x + spatial[i], 0, w - 1)) * 4;
              var dist = Math.abs(s[k] - r0) + Math.abs(s[k + 1] - g0) + Math.abs(s[k + 2] - b0);
              var wt = spatial[i + 2] * rangeLUT[dist];
              ar += s[k] * wt; ag += s[k + 1] * wt; ab += s[k + 2] * wt; aw += wt;
            }
            o[q] = ar / aw; o[q + 1] = ag / aw; o[q + 2] = ab / aw; o[q + 3] = 255;
          }
        }
        return out;
      }
    },
    {
      id: 'unsharp', name: 'Sharpen (unsharp mask)', group: 'Smooth',
      params: [
        { key: 'sigma', label: 'Radius sigma', type: 'range', min: 0.5, max: 6, step: 0.1, value: 1.5 },
        { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 5, step: 0.1, value: 1 }
      ],
      apply: function (img, p) {
        var blur = gaussianRGB(img, p.sigma), out = makeImage(img.w, img.h), s = img.data, b = blur.data, o = out.data;
        for (var j = 0; j < s.length; j += 4) {
          o[j] = s[j] + p.amount * (s[j] - b[j]);
          o[j + 1] = s[j + 1] + p.amount * (s[j + 1] - b[j + 1]);
          o[j + 2] = s[j + 2] + p.amount * (s[j + 2] - b[j + 2]);
          o[j + 3] = 255;
        }
        return out;
      }
    },
    {
      id: 'sobel', name: 'Sobel', group: 'Edges',
      params: gradParams(),
      apply: function (img, p) { return renderGradient(img, p, 1, 2); }
    },
    {
      id: 'scharr', name: 'Scharr', group: 'Edges',
      params: gradParams(),
      apply: function (img, p) { return renderGradient(img, p, 3, 10); }
    },
    {
      id: 'prewitt', name: 'Prewitt', group: 'Edges',
      params: gradParams(),
      apply: function (img, p) { return renderGradient(img, p, 1, 1); }
    },
    {
      id: 'laplacian', name: 'Laplacian / LoG', group: 'Edges',
      params: [
        { key: 'sigma', label: 'Pre-blur sigma (0 = plain Laplacian)', type: 'range', min: 0, max: 6, step: 0.1, value: 0 },
        { key: 'kernel', label: 'Kernel', type: 'select', options: ['4-neighbour', '8-neighbour'], value: '4-neighbour' },
        { key: 'mode', label: 'Display', type: 'select', options: ['absolute', 'signed', 'zero-crossings'], value: 'absolute' },
        { key: 'gain', label: 'Gain', type: 'range', min: 0.5, max: 20, step: 0.5, value: 4 }
      ],
      apply: function (img, p) {
        var w = img.w, h = img.h, n = w * h, g = toGray(img), L = new Float32Array(n), eight = p.kernel === '8-neighbour';
        if (p.sigma > 0) g = convolvePlane(g, w, h, gaussKernel(p.sigma));
        for (var y = 0; y < h; y++) {
          var ym = (y > 0 ? y - 1 : 0) * w, y0 = y * w, yp = (y < h - 1 ? y + 1 : h - 1) * w;
          for (var x = 0; x < w; x++) {
            var xm = x > 0 ? x - 1 : 0, xp = x < w - 1 ? x + 1 : w - 1, c = g[y0 + x];
            var v = g[ym + x] + g[yp + x] + g[y0 + xm] + g[y0 + xp] - 4 * c;
            if (eight) v += g[ym + xm] + g[ym + xp] + g[yp + xm] + g[yp + xp] - 4 * c;
            L[y0 + x] = v;
          }
        }
        var m = new Float32Array(n), i;
        if (p.mode === 'zero-crossings') {
          var thr = 40 / p.gain;
          for (i = 0; i < n; i++) {
            var xx = i % w, a = L[i];
            var r = xx < w - 1 ? L[i + 1] : a, d = i + w < n ? L[i + w] : a;
            m[i] = ((a * r < 0 && Math.abs(a - r) > thr) || (a * d < 0 && Math.abs(a - d) > thr)) ? 255 : 0;
          }
        } else if (p.mode === 'signed') {
          for (i = 0; i < n; i++) m[i] = 128 + L[i] * p.gain;
        } else {
          for (i = 0; i < n; i++) m[i] = Math.abs(L[i]) * p.gain;
        }
        return grayToImage(m, w, h);
      }
    },
    {
      id: 'canny', name: 'Canny edge detector', group: 'Edges',
      params: [
        { key: 'sigma', label: 'Blur sigma', type: 'range', min: 0, max: 5, step: 0.1, value: 1.4 },
        { key: 'low', label: 'Low threshold', type: 'range', min: 1, max: 150, step: 1, value: 20 },
        { key: 'high', label: 'High threshold', type: 'range', min: 1, max: 255, step: 1, value: 50 },
        { key: 'overlay', label: 'Overlay on image', type: 'bool', value: false },
        { key: 'color', label: 'Overlay colour', type: 'select', options: ['#00ff66', '#ff2d55', '#ffd60a', '#0af', '#ffffff'], value: '#00ff66' }
      ],
      apply: function (img, p) {
        var e = cannyEdges(img, p.sigma, Math.min(p.low, p.high), p.high), n = img.w * img.h;
        var out = p.overlay ? cloneImage(img) : makeImage(img.w, img.h), d = out.data, col = hexToRgb(p.color);
        for (var i = 0, j = 0; i < n; i++, j += 4) {
          if (e[i]) {
            if (p.overlay) { d[j] = col[0]; d[j + 1] = col[1]; d[j + 2] = col[2]; }
            else { d[j] = d[j + 1] = d[j + 2] = 255; }
          }
          d[j + 3] = 255;
        }
        return out;
      }
    },
    {
      id: 'emboss', name: 'Emboss', group: 'Edges',
      params: [{ key: 'gain', label: 'Gain', type: 'range', min: 0.5, max: 5, step: 0.1, value: 1 }],
      apply: function (img, p) {
        var w = img.w, h = img.h, g = toGray(img), m = new Float32Array(w * h);
        for (var y = 0; y < h; y++) {
          var ym = (y > 0 ? y - 1 : 0) * w, yp = (y < h - 1 ? y + 1 : h - 1) * w;
          for (var x = 0; x < w; x++) {
            var xm = x > 0 ? x - 1 : 0, xp = x < w - 1 ? x + 1 : w - 1;
            m[y * w + x] = 128 + p.gain * (-2 * g[ym + xm] - g[ym + x] - g[y * w + xm] + g[y * w + xp] + g[yp + x] + 2 * g[yp + xp]);
          }
        }
        return grayToImage(m, w, h);
      }
    },
    {
      id: 'threshold', name: 'Threshold (binary / Otsu)', group: 'Segment',
      params: [
        { key: 'value', label: 'Threshold', type: 'range', min: 0, max: 255, step: 1, value: 128 },
        { key: 'otsu', label: 'Automatic (Otsu)', type: 'bool', value: true },
        { key: 'invert', label: 'Invert', type: 'bool', value: false }
      ],
      apply: function (img, p) {
        var g = toGray(img), t = p.otsu ? otsuThreshold(grayHist(g), g.length) : p.value, m = new Float32Array(g.length);
        for (var i = 0; i < g.length; i++) m[i] = ((g[i] > t) !== p.invert) ? 255 : 0;
        return grayToImage(m, img.w, img.h);
      }
    },
    {
      id: 'morph', name: 'Morphology', group: 'Segment',
      params: [
        { key: 'op', label: 'Operation', type: 'select', options: ['dilate', 'erode', 'open', 'close', 'gradient', 'top-hat'], value: 'open' },
        { key: 'radius', label: 'Radius (px)', type: 'range', min: 1, max: 6, step: 1, value: 1 }
      ],
      apply: function (img, p) {
        var r = p.radius;
        switch (p.op) {
          case 'dilate': return rankRGB(img, r, true);
          case 'erode': return rankRGB(img, r, false);
          case 'open': return rankRGB(rankRGB(img, r, false), r, true);
          case 'close': return rankRGB(rankRGB(img, r, true), r, false);
          default: {
            var a = p.op === 'gradient' ? rankRGB(img, r, true) : img;
            var b = p.op === 'gradient' ? rankRGB(img, r, false) : rankRGB(rankRGB(img, r, false), r, true);
            var out = makeImage(img.w, img.h), o = out.data;
            for (var j = 0; j < o.length; j += 4) {
              o[j] = a.data[j] - b.data[j]; o[j + 1] = a.data[j + 1] - b.data[j + 1]; o[j + 2] = a.data[j + 2] - b.data[j + 2]; o[j + 3] = 255;
            }
            return out;
          }
        }
      }
    },
    {
      id: 'colormap', name: 'False colour (colormap)', group: 'Segment',
      params: [{ key: 'map', label: 'Map', type: 'select', options: Object.keys(COLORMAPS), value: 'inferno' }],
      apply: function (img, p) {
        var g = toGray(img), lut = colormapLUT(p.map), out = makeImage(img.w, img.h), d = out.data;
        for (var i = 0, j = 0; i < g.length; i++, j += 4) {
          var v = g[i] | 0;
          d[j] = lut[0][v]; d[j + 1] = lut[1][v]; d[j + 2] = lut[2][v]; d[j + 3] = 255;
        }
        return out;
      }
    }
  ];

  function gradParams() {
    return [
      { key: 'mode', label: 'Output', type: 'select', options: ['magnitude', 'x', 'y', 'direction'], value: 'magnitude' },
      { key: 'sigma', label: 'Pre-blur sigma', type: 'range', min: 0, max: 5, step: 0.1, value: 0 },
      { key: 'gain', label: 'Gain', type: 'range', min: 0.25, max: 10, step: 0.25, value: 1 }
    ];
  }

  /** Map luma through a LUT and scale RGB by new/old luma, keeping hue. */
  function scaleByLuma(img, lut) {
    var out = makeImage(img.w, img.h), s = img.data, d = out.data;
    for (var j = 0; j < s.length; j += 4) {
      var y = 0.299 * s[j] + 0.587 * s[j + 1] + 0.114 * s[j + 2], yi = y | 0;
      if (y < 0.5) { d[j] = d[j + 1] = d[j + 2] = lut[0]; }
      else {
        var k = lut[yi] / y;
        d[j] = s[j] * k; d[j + 1] = s[j + 1] * k; d[j + 2] = s[j + 2] * k;
      }
      d[j + 3] = 255;
    }
    return out;
  }

  /** Contrast-limited adaptive histogram equalisation on luma (bilinear tile blend). */
  function clahe(img, tiles, clipLimit) {
    var w = img.w, h = img.h, g = toGray(img), tx = Math.max(1, Math.round(tiles)), ty = tx;
    var tw = w / tx, th = h / ty, luts = [], i, x, y;
    for (var j = 0; j < ty; j++) {
      for (var k = 0; k < tx; k++) {
        var x0 = Math.floor(k * tw), x1 = Math.floor((k + 1) * tw), y0 = Math.floor(j * th), y1 = Math.floor((j + 1) * th);
        var hist = new Float32Array(256), count = Math.max(1, (x1 - x0) * (y1 - y0));
        for (y = y0; y < y1; y++) for (x = x0; x < x1; x++) hist[g[y * w + x] | 0]++;
        var limit = Math.max(1, clipLimit * count / 256), excess = 0;
        for (i = 0; i < 256; i++) if (hist[i] > limit) { excess += hist[i] - limit; hist[i] = limit; }
        var add = excess / 256, lut = new Float32Array(256), acc = 0;
        for (i = 0; i < 256; i++) { acc += hist[i] + add; lut[i] = acc * 255 / count; }
        luts.push(lut);
      }
    }
    var out = makeImage(w, h), s = img.data, d = out.data;
    for (y = 0; y < h; y++) {
      var fy = (y + 0.5) / th - 0.5, jy = Math.floor(fy), ay = fy - jy;
      var j0 = clampi(jy, 0, ty - 1), j1 = clampi(jy + 1, 0, ty - 1);
      for (x = 0; x < w; x++) {
        var fx = (x + 0.5) / tw - 0.5, kx = Math.floor(fx), ax = fx - kx;
        var k0 = clampi(kx, 0, tx - 1), k1 = clampi(kx + 1, 0, tx - 1), p = y * w + x, v = g[p] | 0;
        var top = luts[j0 * tx + k0][v] * (1 - ax) + luts[j0 * tx + k1][v] * ax;
        var bot = luts[j1 * tx + k0][v] * (1 - ax) + luts[j1 * tx + k1][v] * ax;
        var ny = top * (1 - ay) + bot * ay, q = p * 4;
        if (g[p] < 0.5) { d[q] = d[q + 1] = d[q + 2] = ny; }
        else {
          var sc = ny / g[p];
          d[q] = s[q] * sc; d[q + 1] = s[q + 1] * sc; d[q + 2] = s[q + 2] * sc;
        }
        d[q + 3] = 255;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- analysis

  /**
   * Per-channel 256-bin histograms (r, g, b, luma) plus summary stats.
   * `step` samples every Nth pixel to save time on big frames.
   */
  function histogram(img, step) {
    step = Math.max(1, step | 0);
    var r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
    var d = img.data, stride = step * 4, count = 0;
    for (var j = 0; j < d.length; j += stride) {
      r[d[j]]++; g[d[j + 1]]++; b[d[j + 2]]++;
      l[(0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2] + 0.5) | 0]++;
      count++;
    }
    return { r: r, g: g, b: b, l: l, count: count };
  }

  function histStats(hist, count) {
    var sum = 0, sq = 0, min = -1, max = 0, med = 0, acc = 0, half = count / 2, i;
    for (i = 0; i < 256; i++) {
      var c = hist[i];
      if (!c) continue;
      if (min < 0) min = i;
      max = i;
      sum += i * c; sq += i * i * c;
    }
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= half) { med = i; break; } }
    var mean = count ? sum / count : 0;
    return {
      mean: mean,
      std: count ? Math.sqrt(Math.max(0, sq / count - mean * mean)) : 0,
      min: Math.max(0, min), max: max, median: med,
      clipLow: count ? hist[0] / count * 100 : 0,
      clipHigh: count ? hist[255] / count * 100 : 0
    };
  }

  /** Run a filter chain [{id, enabled, params}] over an image. */
  function runChain(img, chain) {
    var cur = img;
    for (var i = 0; i < chain.length; i++) {
      var st = chain[i];
      if (!st.enabled) continue;
      var f = byId(st.id);
      if (f) cur = f.apply(cur, st.params);
    }
    return cur;
  }

  function byId(id) {
    for (var i = 0; i < FILTERS.length; i++) if (FILTERS[i].id === id) return FILTERS[i];
    return null;
  }

  function defaultParams(id) {
    var f = byId(id), p = {};
    if (f) f.params.forEach(function (d) { p[d.key] = d.value; });
    return p;
  }

  return {
    FILTERS: FILTERS,
    byId: byId,
    defaultParams: defaultParams,
    runChain: runChain,
    histogram: histogram,
    histStats: histStats,
    makeImage: makeImage,
    cloneImage: cloneImage,
    toGray: toGray,
    gaussKernel: gaussKernel,
    otsuThreshold: otsuThreshold,
    cannyEdges: cannyEdges,
    colormapLUT: colormapLUT
  };
});
