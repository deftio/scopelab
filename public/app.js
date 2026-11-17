/*
 * app.js -- USB endoscope viewer. UI is built entirely with bitwrench (TACO
 * objects + BCCL components); image processing lives in filters.js.
 *
 * Data path:
 *   USB endoscope (UVC) -> getUserMedia -> <video> -> work canvas
 *   (flip / rotate / zoom) -> RGBA frame -> filter chain -> view canvas
 *   -> histogram / line profile / captures / MediaRecorder.
 *
 * WebUSB is used to identify and inspect the endoscope (descriptors,
 * interfaces) and to pick the matching camera. It cannot carry the video
 * itself: Chrome blocks WebUSB from claiming USB Video Class interfaces, and
 * macOS's UVC driver owns them -- see the USB tab text.
 */
(function () {
  'use strict';

  var F = window.EndoFilters;

  // ------------------------------------------------------------------ theme

  var styles = bw.loadStyles({ primary: '#0d9488', secondary: '#64748b' });

  function themeCSS(p) {
    return {
      '.endo_header': { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '10px 16px', background: p.surface, borderBottom: '1px solid ' + p.light.border },
      '.endo_brand': { fontWeight: '700', fontSize: '1.1rem', color: p.dark.base, marginRight: 'auto', display: 'flex', alignItems: 'center', gap: '8px' },
      '.endo_logo': { color: p.primary.base, fontSize: '1.3rem' },
      '.endo_status': { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' },
      '.endo_muted': { color: p.secondary.base, fontSize: '0.85rem' },
      '.endo_stage_card': { border: '1px solid ' + p.light.border, borderRadius: '8px', padding: '8px 10px', marginBottom: '8px', background: p.surface },
      '.endo_stage_card.endo_off': { opacity: '0.55' },
      '.endo_cap': { border: '1px solid ' + p.light.border, borderRadius: '8px', overflow: 'hidden', background: p.surface },
      '.endo_cap_meta': { padding: '6px 8px', fontSize: '0.8rem', color: p.dark.base, display: 'flex', flexDirection: 'column', gap: '2px', wordBreak: 'break-all' },
      '.endo_section_title': { fontSize: '0.75rem', fontWeight: '700', letterSpacing: '0.06em', textTransform: 'uppercase', color: p.secondary.base, margin: '14px 0 6px' },
      '.endo_grid_line': { stroke: p.light.border, strokeWidth: '0.4' },
      '.endo_h_l': { fill: 'none', stroke: p.dark.base, strokeWidth: '0.9' },
      '.endo_kv dt': { color: p.secondary.base }
    };
  }

  bw.injectCSS(bw.css([
    {
      'body': { margin: '0' },
      '.endo_hidden': { display: 'none !important' },
      '.endo_layout': { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 390px', gap: '16px', padding: '16px', alignItems: 'start' },
      '@media (max-width: 1100px)': { '.endo_layout': { gridTemplateColumns: 'minmax(0, 1fr)' } },
      '.endo_main': { display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '0' },
      '.endo_side': { minWidth: '0', position: 'sticky', top: '12px' },
      '.endo_viewer': { position: 'relative', background: '#000', borderRadius: '10px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' },
      '.endo_view': { display: 'block', width: '100%', height: 'auto', cursor: 'crosshair', imageRendering: 'auto' },
      '.endo_viewer:fullscreen': { borderRadius: '0' },
      '.endo_viewer:fullscreen .endo_view': { width: 'auto', height: 'auto', maxWidth: '100vw', maxHeight: '100vh' },
      '.endo_placeholder': { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', justifyContent: 'center', color: '#9aa4b2', textAlign: 'center', padding: '16px' },
      '.endo_tags': { position: 'absolute', top: '10px', right: '10px', display: 'flex', gap: '6px' },
      '.endo_probe': { position: 'absolute', left: '10px', bottom: '10px', font: '12px ui-monospace, Menlo, monospace', color: '#e6edf3', background: 'rgba(0,0,0,0.55)', padding: '3px 7px', borderRadius: '4px', pointerEvents: 'none' },
      '.endo_flash': { animation: 'endo_flash 0.25s ease-out' },
      '@keyframes endo_flash': { '0%': { filter: 'brightness(2.2)' }, '100%': { filter: 'brightness(1)' } },
      '.endo_toolbar': { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '10px' },
      '.endo_toolbar .bw_bccl_form_control': { width: 'auto' },
      '.endo_spacer': { flex: '1' },
      '.endo_charts': { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' },
      '.endo_chart': { width: '100%', height: '170px', display: 'block', background: 'rgba(127,127,127,0.06)', borderRadius: '6px' },
      '.endo_h_r': { fill: 'rgba(239,68,68,0.35)', stroke: 'rgb(239,68,68)', strokeWidth: '0.6' },
      '.endo_h_g': { fill: 'rgba(34,197,94,0.30)', stroke: 'rgb(34,197,94)', strokeWidth: '0.6' },
      '.endo_h_b': { fill: 'rgba(59,130,246,0.30)', stroke: 'rgb(59,130,246)', strokeWidth: '0.6' },
      '.endo_p_r': { fill: 'none', stroke: 'rgb(239,68,68)', strokeWidth: '0.8' },
      '.endo_p_g': { fill: 'none', stroke: 'rgb(34,197,94)', strokeWidth: '0.8' },
      '.endo_p_b': { fill: 'none', stroke: 'rgb(59,130,246)', strokeWidth: '0.8' },
      '.endo_opts': { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '8px' },
      '.endo_opts .bw_bccl_form_check': { margin: '0' },
      '.endo_opts .bw_bccl_form_control': { width: 'auto' },
      '.endo_stage_head': { display: 'flex', alignItems: 'center', gap: '6px' },
      '.endo_stage_head .bw_bccl_form_check': { flex: '1', margin: '0', fontWeight: '600' },
      '.endo_stage_body': { marginTop: '6px' },
      '.endo_stage_ms': { fontSize: '0.75rem', fontFamily: 'ui-monospace, Menlo, monospace', opacity: '0.7', minWidth: '52px', textAlign: 'right' },
      '.endo_field': { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', margin: '6px 0', fontSize: '0.9rem' },
      '.endo_field .bw_bccl_form_control': { width: 'auto', minWidth: '140px' },
      '.endo_row': { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', margin: '6px 0' },
      '.endo_row > .bw_bccl_form_control': { flex: '1', width: 'auto', minWidth: '0' },
      '.endo_gallery': { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' },
      '.endo_cap img, .endo_cap video': { display: 'block', width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', background: '#000', cursor: 'zoom-in' },
      '.endo_cap_btns': { display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '0 8px 8px' },
      '.bw_bccl_table.endo_compact > thead > tr > *, .bw_bccl_table.endo_compact > tbody > tr > *': { padding: '4px 8px', fontSize: '0.8rem', whiteSpace: 'nowrap' },
      '.endo_viewer.endo_idle': { minHeight: '320px' },
      '.endo_preview': { maxWidth: '100%', maxHeight: '75vh', display: 'block', margin: '0 auto' },
      '.endo_toasts': { position: 'fixed', right: '16px', bottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px', zIndex: '2000', maxWidth: '360px' },
      '.endo_toasts .bw_bccl_toast': { position: 'static', margin: '0' },
      '.endo_kv': { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '2px 12px', fontSize: '0.85rem', margin: '0' },
      '.endo_kv dd': { margin: '0', fontFamily: 'ui-monospace, Menlo, monospace', wordBreak: 'break-all' },
      '.endo_side .bw_bccl_tab_content, .endo_side .bw_bccl_tabs_content': { maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' },
      '.endo_keys': { fontSize: '0.8rem' },
      '.endo_keys kbd': { fontFamily: 'ui-monospace, Menlo, monospace', border: '1px solid rgba(127,127,127,0.5)', borderRadius: '3px', padding: '0 4px' }
    },
    themeCSS(styles.palette),
    prefixRules('.bw_theme_alt', themeCSS(styles.alternatePalette))
  ]), { id: 'endo_css' });

  function prefixRules(prefix, rules) {
    var out = {};
    Object.keys(rules).forEach(function (sel) {
      out[sel.split(',').map(function (s) { return prefix + ' ' + s.trim(); }).join(', ')] = rules[sel];
    });
    return out;
  }

  // Endoscopes are mostly used in dim conditions: start in the dark palette.
  bw.setThemeMode('alternate');

  // ------------------------------------------------------------------ state

  var RESOLUTIONS = ['320x240', '640x480', '800x600', '1280x720', '1280x960', '1600x1200', '1920x1080', 'max'];

  var S = {
    stream: null, track: null, devices: [], deviceId: '', res: '1280x720', fps: 30,
    permission: false, running: false, gen: 0,
    frozen: false, frozenSrc: null,
    flipH: false, flipV: false, rotate: 0, zoom: 1, panX: 0, panY: 0, scale: 1,
    split: 'off', wipe: 50,
    ov: { crosshair: false, grid: false, circle: false, timestamp: false, profile: true, color: '#00e5ff' },
    chain: [],
    hist: { source: 'output', log: false, r: true, g: true, b: true, l: true },
    profile: { dir: 'horizontal', x: 0.5, y: 0.5 },
    snapSource: 'output', snapFormat: 'png',
    recorder: null, recStart: 0,
    captures: [], serverOk: false, serverSave: false, serverDir: '',
    lastRaw: null, lastOut: null,
    stats: { frames: 0, t0: 0, fps: 0, procMs: 0, lastHist: 0, lastStats: 0, lastStatus: 0 },
    usbDevices: []
  };

  var work = bw.create({ t: 'canvas' });          // off-screen grab canvas
  var workCtx = work.getContext('2d', { willReadFrequently: true });
  var uidN = 0;
  function uid(prefix) { return prefix + '_' + (++uidN); }

  // ------------------------------------------------------------------ helpers

  function toast(msg, variant, title) {
    bw.append('#endo_toasts', bw.makeToast({ title: title, content: msg, variant: variant || 'info', delay: 4000 }));
  }

  function setVariant(ref, variant) {
    ['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark'].forEach(function (v) {
      bw.removeClass(ref, bw.variantClass(v));
    });
    bw.addClass(ref, bw.variantClass(variant));
  }

  function hex4(n) { return ('0000' + n.toString(16)).slice(-4); }
  function fmtBytes(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB'; }
  function stamp() {
    var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'endo_' + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '_' + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds()) + '_' + ('00' + d.getMilliseconds()).slice(-3);
  }
  function mmss(ms) { var s = Math.floor(ms / 1000); return ('0' + Math.floor(s / 60)).slice(-2) + ':' + ('0' + s % 60).slice(-2); }
  function isBuiltin(label) { return /facetime|macbook|built-?in|iphone|continuity|desk view|virtual|obs/i.test(label || ''); }
  function vidPid(label) { var m = /\(([0-9a-f]{4}):([0-9a-f]{4})\)/i.exec(label || ''); return m ? (m[1] + ':' + m[2]).toLowerCase() : ''; }

  function field(label, control) {
    return { t: 'label', a: { class: 'endo_field' }, c: [{ t: 'span', c: label }, control] };
  }

  function select(opts, value, onchange, id) {
    return bw.makeSelect({
      id: id,
      options: opts.map(function (o) { return typeof o === 'object' ? o : { value: String(o), text: String(o) }; }),
      value: String(value),
      onchange: function (e) { onchange(e.target.value); }
    });
  }

  function sw(label, checked, onchange) {
    return bw.makeSwitch({ id: uid('sw'), label: label, checked: checked, onchange: function (e) { onchange(e.target.checked); } });
  }

  function range(label, min, max, step, value, oninput) {
    return bw.makeRange({ label: label, min: min, max: max, step: step, value: value, showValue: true, oninput: function (e) { oninput(parseFloat(e.target.value)); } });
  }

  function smallBtn(text, onclick, variant, title) {
    var b = bw.makeButton({ text: text, size: 'sm', variant: variant || 'outline_secondary', onclick: onclick });
    if (title) b.a.title = title;
    return b;
  }

  function sectionTitle(text) { return { t: 'div', a: { class: 'endo_section_title' }, c: text }; }

  // ------------------------------------------------------------------ layout

  function header() {
    return {
      t: 'header', a: { class: 'endo_header' }, c: [
        { t: 'div', a: { class: 'endo_brand' }, c: [{ t: 'span', a: { class: 'endo_logo' }, c: '◉' }, 'USB Endoscope'] },
        { t: 'div', a: { class: 'endo_status' }, c: [
          bw.makeBadge({ id: 'st_state', text: 'Stopped', variant: 'secondary' }),
          bw.makeBadge({ id: 'st_res', text: '—', variant: 'secondary' }),
          bw.makeBadge({ id: 'st_fps', text: '0.0 fps', variant: 'secondary' }),
          bw.makeBadge({ id: 'st_proc', text: '0.0 ms', variant: 'secondary' }),
          bw.makeBadge({ id: 'st_cam', text: 'no camera', variant: 'secondary' })
        ] },
        smallBtn('Light / dark', function () { bw.toggleThemeMode(); }, 'outline_secondary')
      ]
    };
  }

  function viewerCard() {
    return bw.makeCard({
      content: [
        { t: 'div', a: { id: 'endo_viewer', class: 'endo_viewer endo_idle' }, c: [
          { t: 'canvas', a: { id: 'endo_view', class: 'endo_view endo_hidden', width: 640, height: 480, onmousemove: onProbe, onmouseleave: function () { bw.addClass('endo_probe', 'endo_hidden'); }, onclick: onViewClick, ondblclick: toggleFullscreen } },
          { t: 'div', a: { id: 'endo_placeholder', class: 'endo_placeholder' }, c: [
            { t: 'div', a: { style: 'font-size:3rem' }, c: '◉' },
            { t: 'div', a: { id: 'endo_ph_text' }, c: 'Plug in the USB endoscope, then start the camera.' },
            bw.makeButton({ text: 'Start camera', variant: 'primary', onclick: function () { start(); } })
          ] },
          { t: 'div', a: { class: 'endo_tags' }, c: [
            bw.makeBadge({ id: 'tag_frozen', text: 'FROZEN', variant: 'info', class: 'endo_hidden' }),
            bw.makeBadge({ id: 'tag_rec', text: '● REC 00:00', variant: 'danger', class: 'endo_hidden' })
          ] },
          { t: 'div', a: { id: 'endo_probe', class: 'endo_probe endo_hidden' }, c: '' },
          { t: 'video', a: { id: 'endo_video', class: 'endo_hidden', autoplay: true, muted: true, playsinline: true } }
        ] },
        { t: 'div', a: { class: 'endo_toolbar' }, c: [
          bw.makeButton({ id: 'btn_start', text: '▶ Start', variant: 'success', onclick: function () { S.running ? stop() : start(); } }),
          bw.makeButton({ id: 'btn_snap', text: '📷 Snapshot', variant: 'primary', onclick: snapshot }),
          bw.makeButton({ id: 'btn_rec', text: '⏺ Record', variant: 'danger', onclick: toggleRecord }),
          bw.makeButton({ id: 'btn_freeze', text: '❄ Freeze', variant: 'outline_secondary', onclick: toggleFreeze }),
          bw.makeButton({ text: '⛶ Fullscreen', variant: 'outline_secondary', onclick: toggleFullscreen }),
          { t: 'span', a: { class: 'endo_spacer' } },
          { t: 'span', a: { class: 'endo_muted' }, c: 'Capture' },
          select([{ value: 'output', text: 'processed' }, { value: 'raw', text: 'raw' }, { value: 'view', text: 'as shown' }], S.snapSource, function (v) { S.snapSource = v; }),
          select([{ value: 'png', text: 'PNG' }, { value: 'jpeg', text: 'JPEG' }], S.snapFormat, function (v) { S.snapFormat = v; })
        ] },
        { t: 'div', a: { class: 'endo_muted endo_keys', style: 'margin-top:8px' }, c: [
          'Keys: ', { t: 'kbd', c: 'Space' }, ' snapshot · ', { t: 'kbd', c: 'R' }, ' record · ', { t: 'kbd', c: 'F' }, ' freeze · ',
          { t: 'kbd', c: 'Enter' }, ' fullscreen · click image to move the profile line · double-click for fullscreen'
        ] }
      ]
    });
  }

  function histCard() {
    var grid = [64, 128, 192].map(function (x) { return { t: 'line', a: { class: 'endo_grid_line', x1: x, y1: 0, x2: x, y2: 100 } }; })
      .concat([25, 50, 75].map(function (y) { return { t: 'line', a: { class: 'endo_grid_line', x1: 0, y1: y, x2: 255, y2: y } }; }));
    return bw.makeCard({
      title: 'Histogram',
      content: [
        { t: 'div', a: { class: 'endo_opts' }, c: [
          select([{ value: 'output', text: 'processed' }, { value: 'raw', text: 'raw' }], S.hist.source, function (v) { S.hist.source = v; }),
          sw('R', S.hist.r, function (v) { S.hist.r = v; bw.toggleClass('h_r', 'endo_hidden', !v); }),
          sw('G', S.hist.g, function (v) { S.hist.g = v; bw.toggleClass('h_g', 'endo_hidden', !v); }),
          sw('B', S.hist.b, function (v) { S.hist.b = v; bw.toggleClass('h_b', 'endo_hidden', !v); }),
          sw('Luma', S.hist.l, function (v) { S.hist.l = v; bw.toggleClass('h_l', 'endo_hidden', !v); }),
          sw('Log', S.hist.log, function (v) { S.hist.log = v; })
        ] },
        { t: 'svg', a: { class: 'endo_chart', viewBox: '0 0 255 100', preserveAspectRatio: 'none' }, c: grid.concat([
          { t: 'polygon', a: { id: 'h_r', class: 'endo_h_r', points: '0,100 255,100' } },
          { t: 'polygon', a: { id: 'h_g', class: 'endo_h_g', points: '0,100 255,100' } },
          { t: 'polygon', a: { id: 'h_b', class: 'endo_h_b', points: '0,100 255,100' } },
          { t: 'polyline', a: { id: 'h_l', class: 'endo_h_l', points: '0,100 255,100' } }
        ]) },
        { t: 'div', a: { id: 'hist_stats', style: 'margin-top:8px; overflow-x:auto' } }
      ]
    });
  }

  function profileCard() {
    var grid = [25, 50, 75].map(function (y) { return { t: 'line', a: { class: 'endo_grid_line', x1: 0, y1: y, x2: 255, y2: y } }; });
    return bw.makeCard({
      title: 'Line profile',
      content: [
        { t: 'div', a: { class: 'endo_opts' }, c: [
          select([{ value: 'horizontal', text: 'horizontal (row)' }, { value: 'vertical', text: 'vertical (column)' }], S.profile.dir, function (v) { S.profile.dir = v; }),
          sw('Show line on image', S.ov.profile, function (v) { S.ov.profile = v; }),
          { t: 'span', a: { id: 'prof_pos', class: 'endo_muted' }, c: '' }
        ] },
        { t: 'svg', a: { class: 'endo_chart', viewBox: '0 0 255 100', preserveAspectRatio: 'none' }, c: grid.concat([
          { t: 'polyline', a: { id: 'p_r', class: 'endo_p_r', points: '' } },
          { t: 'polyline', a: { id: 'p_g', class: 'endo_p_g', points: '' } },
          { t: 'polyline', a: { id: 'p_b', class: 'endo_p_b', points: '' } },
          { t: 'polyline', a: { id: 'p_l', class: 'endo_h_l', points: '' } }
        ]) },
        { t: 'div', a: { class: 'endo_muted', style: 'margin-top:8px' }, c: 'Intensity (0–255) along the dashed line. Click the image to move it.' }
      ]
    });
  }

  function galleryCard() {
    return bw.makeCard({
      title: 'Captures',
      content: [
        { t: 'div', a: { class: 'endo_opts' }, c: [
          { t: 'span', a: { id: 'save_box' }, c: '' },
          { t: 'span', a: { class: 'endo_spacer' } },
          smallBtn('Download all', downloadAll),
          smallBtn('Clear all', clearCaptures, 'outline_danger')
        ] },
        { t: 'div', a: { id: 'gallery_empty', class: 'endo_muted' }, c: 'No captures yet. Snapshots and recordings appear here.' },
        { t: 'div', a: { id: 'gallery', class: 'endo_gallery' } }
      ]
    });
  }

  // --- side panel: filters

  function filtersPanel() {
    var groups = {}, opts = [];
    F.FILTERS.forEach(function (f) { (groups[f.group] = groups[f.group] || []).push(f); });
    Object.keys(groups).forEach(function (g) {
      groups[g].forEach(function (f) { opts.push({ value: f.id, text: g + ' · ' + f.name }); });
    });
    var pick = { id: F.FILTERS[0].id };
    return { t: 'div', c: [
      sectionTitle('Add filter'),
      { t: 'div', a: { class: 'endo_row' }, c: [
        select(opts, pick.id, function (v) { pick.id = v; }),
        bw.makeButton({ text: '+ Add', variant: 'primary', size: 'sm', onclick: function () { addStage(pick.id); } })
      ] },
      sectionTitle('Presets'),
      { t: 'div', a: { class: 'endo_row' }, c: [
        smallBtn('Enhance', function () { preset([['clahe'], ['unsharp']]); }, 'outline_primary', 'CLAHE + unsharp mask: brings out tissue / surface detail'),
        smallBtn('Denoise', function () { preset([['median'], ['bilateral']]); }, 'outline_primary'),
        smallBtn('Canny overlay', function () { preset([['canny', { overlay: true }]]); }, 'outline_primary'),
        smallBtn('Sobel', function () { preset([['sobel']]); }, 'outline_primary'),
        smallBtn('LoG', function () { preset([['laplacian', { sigma: 2, mode: 'zero-crossings' }]]); }, 'outline_primary'),
        smallBtn('Heat map', function () { preset([['gaussian', { sigma: 1 }], ['colormap']]); }, 'outline_primary'),
        smallBtn('Clear', function () { preset([]); }, 'outline_danger')
      ] },
      sectionTitle('Chain (runs top to bottom on every frame)'),
      { t: 'div', a: { id: 'chain_empty', class: 'endo_muted' }, c: 'No filters — showing the camera image as is.' },
      { t: 'div', a: { id: 'chain_hint', class: 'endo_hidden' }, c: '' },
      { t: 'div', a: { id: 'chain' } }
    ] };
  }

  function stageCard(s) {
    var f = F.byId(s.id);
    return {
      t: 'div', a: { id: s.uid, class: 'endo_stage_card' + (s.enabled ? '' : ' endo_off') }, c: [
        { t: 'div', a: { class: 'endo_stage_head' }, c: [
          bw.makeSwitch({ id: s.uid + '_on', label: f.name, checked: s.enabled, onchange: function (e) {
            s.enabled = e.target.checked;
            bw.toggleClass(s.uid, 'endo_off', !s.enabled);
          } }),
          { t: 'span', a: { id: s.uid + '_ms', class: 'endo_stage_ms' }, c: '' },
          smallBtn('↑', function () { moveStage(s, -1); }, null, 'Move up'),
          smallBtn('↓', function () { moveStage(s, 1); }, null, 'Move down'),
          smallBtn('↺', function () { resetStage(s); }, null, 'Reset parameters'),
          smallBtn('✕', function () { removeStage(s); }, 'outline_danger', 'Remove')
        ] },
        { t: 'div', a: { id: s.uid + '_body', class: 'endo_stage_body' }, c: stageParams(s, f) }
      ]
    };
  }

  function stageParams(s, f) {
    return f.params.map(function (d) {
      var set = function (v) { s.params[d.key] = v; };
      if (d.type === 'range') return range(d.label, d.min, d.max, d.step, s.params[d.key], set);
      if (d.type === 'select') return field(d.label, select(d.options, s.params[d.key], set));
      return sw(d.label, !!s.params[d.key], set);
    });
  }

  function addStage(id, params) {
    var p = F.defaultParams(id);
    if (params) Object.keys(params).forEach(function (k) { p[k] = params[k]; });
    S.chain.push({ uid: uid('stage'), id: id, enabled: true, params: p, ms: 0 });
    syncChain();
  }

  function preset(list) {
    S.chain = [];
    list.forEach(function (it) { addStage(it[0], it[1]); });
    syncChain();
  }

  function moveStage(s, dir) {
    var i = S.chain.indexOf(s), j = i + dir;
    if (i < 0 || j < 0 || j >= S.chain.length) return;
    S.chain[i] = S.chain[j]; S.chain[j] = s;
    syncChain();
  }

  function removeStage(s) {
    S.chain = S.chain.filter(function (x) { return x !== s; });
    syncChain();
  }

  function resetStage(s) {
    s.params = F.defaultParams(s.id);
    bw.mount('#' + s.uid + '_body', stageParams(s, F.byId(s.id)));
  }

  function syncChain() {
    bw.syncChildren('#chain', S.chain, {
      key: function (s) { return s.uid; },
      create: stageCard,
      update: function () { /* stage cards own their controls; order is all that changes */ }
    });
    bw.toggleClass('chain_empty', 'endo_hidden', S.chain.length > 0);
  }

  // --- side panel: view (geometry, compare, overlays)

  function viewPanel() {
    return { t: 'div', c: [
      sectionTitle('Geometry'),
      sw('Mirror horizontally', S.flipH, function (v) { S.flipH = v; }),
      sw('Flip vertically', S.flipV, function (v) { S.flipV = v; }),
      field('Rotate', select([0, 90, 180, 270].map(function (r) { return { value: String(r), text: r + '°' }; }), S.rotate, function (v) { S.rotate = +v; })),
      range('Digital zoom ×', 1, 8, 0.1, S.zoom, function (v) { S.zoom = v; }),
      range('Pan X', -1, 1, 0.01, S.panX, function (v) { S.panX = v; }),
      range('Pan Y', -1, 1, 0.01, S.panY, function (v) { S.panY = v; }),
      field('Processing resolution', select([{ value: '1', text: '100%' }, { value: '0.75', text: '75%' }, { value: '0.5', text: '50%' }, { value: '0.25', text: '25%' }], S.scale, function (v) { S.scale = +v; })),
      { t: 'div', a: { class: 'endo_muted' }, c: 'Lower the processing resolution if heavy filters (bilateral, median 5×5) drop the frame rate.' },
      sectionTitle('Compare'),
      field('Split view', select([{ value: 'off', text: 'off' }, { value: 'side', text: 'side by side' }, { value: 'wipe', text: 'wipe' }], S.split, function (v) { S.split = v; })),
      range('Wipe position %', 0, 100, 1, S.wipe, function (v) { S.wipe = v; }),
      sectionTitle('Overlays'),
      sw('Crosshair', S.ov.crosshair, function (v) { S.ov.crosshair = v; }),
      sw('Grid', S.ov.grid, function (v) { S.ov.grid = v; }),
      sw('Scope circle', S.ov.circle, function (v) { S.ov.circle = v; }),
      sw('Timestamp', S.ov.timestamp, function (v) { S.ov.timestamp = v; }),
      field('Overlay colour', select([{ value: '#00e5ff', text: 'cyan' }, { value: '#00ff66', text: 'green' }, { value: '#ffd60a', text: 'yellow' }, { value: '#ff2d55', text: 'red' }, { value: '#ffffff', text: 'white' }], S.ov.color, function (v) { S.ov.color = v; })),
      { t: 'div', a: { class: 'endo_muted' }, c: 'Overlays are drawn on the view, so they appear in recordings and "as shown" snapshots, not in processed/raw snapshots.' },
      { t: 'div', a: { class: 'endo_row', style: 'margin-top:12px' }, c: [
        smallBtn('Reset view', function () {
          S.flipH = S.flipV = false; S.rotate = 0; S.zoom = 1; S.panX = S.panY = 0; S.scale = 1; S.split = 'off'; S.wipe = 50;
          S.ov.crosshair = S.ov.grid = S.ov.circle = S.ov.timestamp = false;
          bw.mount('#view_panel', viewPanel());
        })
      ] }
    ] };
  }

  // --- side panel: camera

  function cameraPanel() {
    return { t: 'div', c: [
      sectionTitle('Device'),
      { t: 'div', a: { class: 'endo_row' }, c: [
        { t: 'div', a: { id: 'cam_dev_box', style: 'flex:1; min-width:0' }, c: deviceSelect() },
        smallBtn('↻', function () { refreshDevices(true); }, null, 'Rescan cameras')
      ] },
      field('Resolution', select(RESOLUTIONS, S.res, function (v) { S.res = v; if (S.running) start(); })),
      field('Frame rate', select([15, 24, 30, 60], S.fps, function (v) { S.fps = +v; if (S.running) start(); })),
      { t: 'div', a: { class: 'endo_muted' }, c: 'The camera delivers the closest mode it supports. Changing these restarts the stream.' },
      sectionTitle('Active stream'),
      { t: 'div', a: { id: 'cam_info' }, c: { t: 'div', a: { class: 'endo_muted' }, c: 'Not streaming.' } },
      sectionTitle('Hardware controls (UVC)'),
      { t: 'div', a: { id: 'cam_hw' }, c: { t: 'div', a: { class: 'endo_muted' }, c: 'Start the camera to see what it exposes.' } }
    ] };
  }

  function deviceSelect() {
    if (!S.devices.length) return { t: 'div', a: { class: 'endo_muted' }, c: S.permission ? 'No cameras found.' : 'Start the camera once to list devices.' };
    return select(S.devices.map(function (d, i) {
      var label = d.label || ('Camera ' + (i + 1));
      return { value: d.deviceId, text: label + (isBuiltin(label) ? '' : '  ★') };
    }), S.deviceId, function (v) { S.deviceId = v; if (S.running) start(); });
  }

  function kv(pairs) {
    var c = [];
    pairs.forEach(function (p) { c.push({ t: 'dt', c: p[0] }, { t: 'dd', c: String(p[1]) }); });
    return { t: 'dl', a: { class: 'endo_kv' }, c: c };
  }

  function renderCamInfo() {
    if (!S.track) { bw.mount('#cam_info', { t: 'div', a: { class: 'endo_muted' }, c: 'Not streaming.' }); return; }
    var st = S.track.getSettings ? S.track.getSettings() : {};
    bw.mount('#cam_info', kv([
      ['Device', S.track.label || '?'],
      ['USB id', vidPid(S.track.label) || 'n/a'],
      ['Resolution', (st.width || '?') + ' × ' + (st.height || '?')],
      ['Frame rate', st.frameRate ? st.frameRate.toFixed(1) + ' fps' : '?'],
      ['Aspect', st.aspectRatio ? st.aspectRatio.toFixed(3) : '?'],
      ['Resize mode', st.resizeMode || 'n/a']
    ]));
  }

  var HW_KEYS = ['brightness', 'contrast', 'saturation', 'sharpness', 'hue', 'exposureMode', 'exposureTime', 'exposureCompensation', 'whiteBalanceMode', 'colorTemperature', 'focusMode', 'focusDistance', 'zoom', 'pan', 'tilt', 'torch', 'backgroundBlur'];

  function renderHwControls() {
    var t = S.track;
    if (!t || !t.getCapabilities) { bw.mount('#cam_hw', { t: 'div', a: { class: 'endo_muted' }, c: 'This browser does not report camera capabilities.' }); return; }
    var caps = t.getCapabilities(), st = t.getSettings(), items = [];
    function apply(key, val) {
      var c = {}; c[key] = val;
      t.applyConstraints({ advanced: [c] }).catch(function (e) { toast(key + ': ' + e.message, 'warning'); });
    }
    HW_KEYS.forEach(function (key) {
      var cap = caps[key];
      if (cap == null) return;
      if (Array.isArray(cap)) {
        if (!cap.length) return;
        if (typeof cap[0] === 'boolean') {
          if (cap.indexOf(true) >= 0) items.push(sw(key, !!st[key], function (v) { apply(key, v); }));
        } else {
          items.push(field(key, select(cap, st[key] || cap[0], function (v) { apply(key, v); })));
        }
      } else if (typeof cap === 'object' && cap.max > cap.min) {
        var step = cap.step || (cap.max - cap.min) / 100;
        items.push(range(key, cap.min, cap.max, step, st[key] != null ? st[key] : cap.min, function (v) { apply(key, v); }));
      }
    });
    bw.mount('#cam_hw', items.length ? items : { t: 'div', a: { class: 'endo_muted' }, c:
      'This camera exposes no adjustable controls to the browser (common for endoscopes on macOS — the LED dimmer is usually a wheel on the cable). Use the Tone filters for software brightness/contrast.' });
  }

  // --- side panel: USB (WebUSB)

  var USB_CLASSES = { 0: 'per-interface', 1: 'Audio', 2: 'CDC', 3: 'HID', 6: 'Image', 7: 'Printer', 8: 'Mass storage', 9: 'Hub', 10: 'CDC data', 14: 'Video (UVC)', 15: 'Health', 16: 'Audio/Video', 239: 'Misc (IAD)', 254: 'App specific', 255: 'Vendor specific' };

  function usbPanel() {
    if (!navigator.usb) {
      return { t: 'div', c: [
        bw.makeAlert({ variant: 'warning', content: 'WebUSB is not available in this browser. Open this page in Chrome or Edge to inspect the USB device. Streaming, filters and captures work without it.' })
      ] };
    }
    return { t: 'div', c: [
      { t: 'p', a: { class: 'endo_muted' }, c: [
        'WebUSB lets this page read the endoscope\'s USB descriptors directly. ',
        'The video itself comes through the UVC camera path: Chrome blocks WebUSB from claiming USB Video Class interfaces and macOS\'s UVC driver owns them, so reading frames over raw WebUSB is not possible for a standard endoscope.'
      ] },
      { t: 'div', a: { class: 'endo_row' }, c: [
        bw.makeButton({ text: 'Pair / inspect USB device…', variant: 'primary', size: 'sm', onclick: pairUsb }),
        smallBtn('↻', renderUsb, null, 'Refresh')
      ] },
      { t: 'div', a: { id: 'usb_list' } }
    ] };
  }

  function usbCard(d) {
    var ifaces = [];
    (d.configurations || []).forEach(function (cfg) {
      cfg.interfaces.forEach(function (itf) {
        itf.alternates.forEach(function (alt) {
          ifaces.push({
            cfg: cfg.configurationValue, iface: itf.interfaceNumber, alt: alt.alternateSetting,
            cls: (USB_CLASSES[alt.interfaceClass] || ('0x' + alt.interfaceClass.toString(16))) + (alt.interfaceClass === 14 ? (alt.interfaceSubclass === 1 ? ' control' : alt.interfaceSubclass === 2 ? ' stream' : '') : ''),
            ep: alt.endpoints.length,
            maxPkt: alt.endpoints.reduce(function (m, e) { return Math.max(m, e.packetSize); }, 0)
          });
        });
      });
    });
    var isVideo = ifaces.some(function (i) { return /Video/.test(i.cls); }) || d.deviceClass === 14;
    var id = hex4(d.vendorId) + ':' + hex4(d.productId);
    return bw.makeCard({
      title: (d.productName || 'USB device') + '  (' + id + ')',
      content: [
        kv([
          ['Manufacturer', d.manufacturerName || '—'],
          ['Product', d.productName || '—'],
          ['Serial', d.serialNumber || '—'],
          ['Vendor / product', '0x' + hex4(d.vendorId) + ' / 0x' + hex4(d.productId)],
          ['USB version', d.usbVersionMajor + '.' + d.usbVersionMinor + '.' + d.usbVersionSubminor],
          ['Device version', d.deviceVersionMajor + '.' + d.deviceVersionMinor + '.' + d.deviceVersionSubminor],
          ['Device class', (USB_CLASSES[d.deviceClass] || d.deviceClass) + ' / sub ' + d.deviceSubclass + ' / proto ' + d.deviceProtocol],
          ['Configurations', (d.configurations || []).length]
        ]),
        ifaces.length ? { t: 'div', a: { style: 'margin-top:8px; overflow-x:auto' }, c: bw.makeTable({
          data: ifaces, sortable: false, striped: true, class: 'endo_compact',
          columns: [{ key: 'cfg', label: 'Cfg' }, { key: 'iface', label: 'If' }, { key: 'alt', label: 'Alt' }, { key: 'cls', label: 'Class' }, { key: 'ep', label: 'EPs' }, { key: 'maxPkt', label: 'Max pkt' }]
        }) } : null,
        isVideo ? null : bw.makeAlert({ variant: 'info', content: 'No USB Video Class interface on this device — it is probably not the endoscope.' })
      ],
      footer: { t: 'div', a: { class: 'endo_row' }, c: [
        isVideo ? bw.makeButton({ text: 'Use as camera', size: 'sm', variant: 'success', onclick: function () { useUsbAsCamera(d); } }) : null,
        d.forget ? smallBtn('Forget', function () { d.forget().then(renderUsb); }, 'outline_danger') : null
      ] }
    });
  }

  function pairUsb() {
    navigator.usb.requestDevice({ filters: [] }).then(function () { renderUsb(); }).catch(function (e) {
      if (e.name !== 'NotFoundError') toast(e.message, 'warning', 'WebUSB');
    });
  }

  function renderUsb() {
    if (!navigator.usb) return;
    navigator.usb.getDevices().then(function (devs) {
      S.usbDevices = devs;
      bw.mount('#usb_list', devs.length ? devs.map(usbCard) : { t: 'div', a: { class: 'endo_muted' }, c: 'No devices paired yet. Pair the endoscope to see its descriptors.' });
    });
  }

  function useUsbAsCamera(d) {
    var want = hex4(d.vendorId) + ':' + hex4(d.productId);
    var hit = S.devices.filter(function (c) { return vidPid(c.label) === want; })[0];
    if (!hit && d.productName) hit = S.devices.filter(function (c) { return c.label.indexOf(d.productName) >= 0; })[0];
    if (!hit) {
      if (!S.permission) { toast('Start the camera once so the browser can list cameras, then try again.', 'info'); return; }
      toast('No camera matched ' + want + '. Pick it in the Camera tab.', 'warning');
      return;
    }
    S.deviceId = hit.deviceId;
    bw.mount('#cam_dev_box', deviceSelect());
    start();
  }

  function sidePanel() {
    return bw.makeTabs({
      tabs: [
        { label: 'Filters', content: filtersPanel() },
        { label: 'View', content: { t: 'div', a: { id: 'view_panel' }, c: viewPanel() } },
        { label: 'Camera', content: cameraPanel() },
        { label: 'USB', content: usbPanel() }
      ]
    });
  }

  bw.mount('#app', { t: 'div', c: [
    header(),
    { t: 'div', a: { class: 'endo_layout' }, c: [
      { t: 'div', a: { class: 'endo_main' }, c: [
        viewerCard(),
        { t: 'div', a: { class: 'endo_charts' }, c: [histCard(), profileCard()] },
        galleryCard()
      ] },
      { t: 'aside', a: { class: 'endo_side' }, c: sidePanel() }
    ] },
    { t: 'div', a: { id: 'endo_toasts', class: 'endo_toasts' } },
    { t: 'div', a: { id: 'endo_modal_host' } }
  ] });

  var dom = { video: bw.el('#endo_video'), view: bw.el('#endo_view'), viewer: bw.el('#endo_viewer') };
  var viewCtx = dom.view.getContext('2d');
  var statsTable = bw.mount('#hist_stats', bw.makeTable({ data: [], sortable: false, class: 'endo_compact', columns: statColumns() }));

  function statColumns() {
    return [
      { key: 'ch', label: 'Ch' }, { key: 'mean', label: 'Mean' }, { key: 'std', label: 'Std' }, { key: 'median', label: 'Med' },
      { key: 'min', label: 'Min' }, { key: 'max', label: 'Max' }, { key: 'lo', label: '@0 %' }, { key: 'hi', label: '@255 %' }
    ];
  }

  // ------------------------------------------------------------------ camera

  function refreshDevices(announce) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve();
    return navigator.mediaDevices.enumerateDevices().then(function (list) {
      var before = S.devices.map(function (d) { return d.deviceId; });
      S.devices = list.filter(function (d) { return d.kind === 'videoinput'; });
      if (S.devices.some(function (d) { return d.label; })) S.permission = true;
      var added = S.devices.filter(function (d) { return before.length && before.indexOf(d.deviceId) < 0; });
      // Prefer an external (non built-in) camera -- that is the endoscope.
      var current = S.devices.filter(function (d) { return d.deviceId === S.deviceId; })[0];
      if (!current) {
        var ext = S.devices.filter(function (d) { return d.label && !isBuiltin(d.label); })[0];
        S.deviceId = (ext || S.devices[0] || {}).deviceId || '';
      }
      bw.mount('#cam_dev_box', deviceSelect());
      if (announce) toast(S.devices.length + ' camera' + (S.devices.length === 1 ? '' : 's') + ' found.', 'info');
      return added;
    });
  }

  function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Camera access needs a secure context. Open http://localhost:8090 (run: node server.js).', 'danger', 'No camera API');
      return Promise.resolve();
    }
    stopStream();
    var first = S.permission ? Promise.resolve() :
      navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then(function (s) {
        s.getTracks().forEach(function (t) { t.stop(); });
        S.permission = true;
        return refreshDevices();
      });
    return first.then(function () {
      var wh = S.res === 'max' ? [4096, 2160] : S.res.split('x').map(Number);
      var v = { width: { ideal: wh[0] }, height: { ideal: wh[1] }, frameRate: { ideal: S.fps } };
      if (S.deviceId) v.deviceId = { exact: S.deviceId };
      return navigator.mediaDevices.getUserMedia({ video: v, audio: false });
    }).then(function (stream) {
      S.stream = stream;
      S.track = stream.getVideoTracks()[0];
      S.track.onended = function () { toast('Camera disconnected.', 'warning'); stop(); };
      dom.video.srcObject = stream;
      return dom.video.play();
    }).then(function () {
      S.running = true;
      S.frozen = false; S.frozenSrc = null;
      S.stats.t0 = performance.now(); S.stats.frames = 0;
      bw.toggleClass('endo_placeholder', 'endo_hidden', true);
      bw.toggleClass('endo_viewer', 'endo_idle', false);
      bw.toggleClass('endo_view', 'endo_hidden', false);
      bw.patch('btn_start', '■ Stop'); setVariant('btn_start', 'secondary');
      bw.patch('st_state', 'Live'); setVariant('st_state', 'success');
      bw.patch('st_cam', S.track.label || 'camera'); setVariant('st_cam', isBuiltin(S.track.label) ? 'warning' : 'primary');
      updateFreezeUI();
      renderCamInfo();
      renderHwControls();
      refreshDevices();
      if (isBuiltin(S.track.label)) toast('Using the built-in camera. Plug in the endoscope and pick it in the Camera tab.', 'warning');
      startLoop();
    }).catch(function (e) {
      S.running = false;
      var msg = e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in the address bar and retry.'
        : e.name === 'NotFoundError' ? 'No camera found. Is the endoscope plugged in?'
        : e.name === 'NotReadableError' ? 'The camera is busy (another app may be using it).'
        : e.name === 'OverconstrainedError' ? 'The camera does not support that mode; try another resolution.'
        : (e.message || String(e));
      toast(msg, 'danger', 'Camera');
      bw.patch('endo_ph_text', msg);
    });
  }

  function stopStream() {
    if (S.stream) S.stream.getTracks().forEach(function (t) { t.onended = null; t.stop(); });
    S.stream = null; S.track = null;
  }

  function stop() {
    if (S.recorder) S.recorder.stop();
    stopStream();
    S.running = false; S.gen++;
    S.frozen = false;
    dom.video.srcObject = null;
    bw.toggleClass('endo_placeholder', 'endo_hidden', false);
    bw.toggleClass('endo_viewer', 'endo_idle', true);
    bw.toggleClass('endo_view', 'endo_hidden', true);
    bw.patch('endo_ph_text', 'Camera stopped.');
    bw.patch('btn_start', '▶ Start'); setVariant('btn_start', 'success');
    bw.patch('st_state', 'Stopped'); setVariant('st_state', 'secondary');
    bw.patch('st_fps', '0.0 fps');
    updateFreezeUI();
    renderCamInfo();
  }

  // ------------------------------------------------------------------ frame loop

  function startLoop() {
    var gen = ++S.gen;
    function tick() {
      if (gen !== S.gen || !S.running) return;
      var v = dom.video;
      if (!S.frozen && v.requestVideoFrameCallback) v.requestVideoFrameCallback(tick);
      else requestAnimationFrame(tick);
      try { frame(); } catch (e) { console.error(e); }
    }
    tick();
  }

  function grab(src, sw0, sh0) {
    var sc = S.scale, dw = Math.max(1, Math.round(sw0 * sc)), dh = Math.max(1, Math.round(sh0 * sc));
    var rot = S.rotate % 180 !== 0, cw = rot ? dh : dw, ch = rot ? dw : dh;
    if (work.width !== cw || work.height !== ch) { work.width = cw; work.height = ch; }
    var z = S.zoom, cropW = sw0 / z, cropH = sh0 / z;
    var sx = (sw0 - cropW) / 2 * (1 + S.panX), sy = (sh0 - cropH) / 2 * (1 + S.panY);
    workCtx.setTransform(1, 0, 0, 1, 0, 0);
    workCtx.translate(cw / 2, ch / 2);
    workCtx.rotate(S.rotate * Math.PI / 180);
    workCtx.scale(S.flipH ? -1 : 1, S.flipV ? -1 : 1);
    workCtx.drawImage(src, sx, sy, cropW, cropH, -dw / 2, -dh / 2, dw, dh);
    workCtx.setTransform(1, 0, 0, 1, 0, 0);
    var id = workCtx.getImageData(0, 0, cw, ch);
    return { w: cw, h: ch, data: id.data };
  }

  function frame() {
    var v = dom.video, now = performance.now();
    var src = S.frozen && S.frozenSrc ? S.frozenSrc : v;
    var sw0 = src === v ? v.videoWidth : src.width, sh0 = src === v ? v.videoHeight : src.height;
    if (!sw0 || !sh0) return;
    var t0 = performance.now();
    var raw = grab(src, sw0, sh0), out = raw;
    for (var i = 0; i < S.chain.length; i++) {
      var st = S.chain[i];
      if (!st.enabled) continue;
      var ts = performance.now();
      out = F.byId(st.id).apply(out, st.params);
      st.ms = st.ms * 0.85 + (performance.now() - ts) * 0.15;
    }
    S.lastRaw = raw; S.lastOut = out;
    draw(raw, out);
    S.stats.procMs = S.stats.procMs * 0.85 + (performance.now() - t0) * 0.15;
    S.stats.frames++;

    if (now - S.stats.lastHist > 90) { S.stats.lastHist = now; updateHistogram(); updateProfile(); }
    if (now - S.stats.lastStatus > 500) {
      var dt = (now - S.stats.t0) / 1000;
      S.stats.fps = dt > 0 ? S.stats.frames / dt : 0;
      S.stats.frames = 0; S.stats.t0 = now; S.stats.lastStatus = now;
      bw.patch('st_fps', S.stats.fps.toFixed(1) + ' fps');
      bw.patch('st_proc', S.stats.procMs.toFixed(1) + ' ms');
      bw.patch('st_res', raw.w + '×' + raw.h + (S.scale !== 1 ? ' (' + Math.round(S.scale * 100) + '%)' : ''));
      S.chain.forEach(function (s) { bw.patch(s.uid + '_ms', s.enabled ? s.ms.toFixed(1) + ' ms' : ''); });
      var slow = S.stats.procMs > 70 && !S.frozen;
      bw.toggleClass('chain_hint', 'endo_hidden', !slow);
      if (slow) bw.patch('chain_hint', bw.makeAlert({ variant: 'warning', content: 'This chain takes ' + Math.round(S.stats.procMs) + ' ms per frame. For smoother video set View → Processing resolution to 50%, or use a lower camera resolution.' }));
    }
    if (S.recorder) bw.patch('tag_rec', '● REC ' + mmss(now - S.recStart));
  }

  function draw(raw, out) {
    var side = S.split === 'side', W = side ? raw.w * 2 : raw.w, H = raw.h;
    if (dom.view.width !== W || dom.view.height !== H) bw.patch(dom.view, { width: W, height: H });
    var ctx = viewCtx;
    ctx.putImageData(new ImageData(out.data, out.w, out.h), side ? raw.w : 0, 0);
    if (side) {
      ctx.putImageData(new ImageData(raw.data, raw.w, raw.h), 0, 0);
      label(ctx, 'RAW', 8, 8, H); label(ctx, 'PROCESSED', raw.w + 8, 8, H);
    } else if (S.split === 'wipe') {
      var x = Math.round(raw.w * S.wipe / 100);
      if (x > 0) ctx.putImageData(new ImageData(raw.data, raw.w, raw.h), 0, 0, 0, 0, x, H);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      if (x > H / 8) label(ctx, 'RAW', 8, 8, H);
      if (raw.w - x > H / 4) label(ctx, 'PROCESSED', x + 8, 8, H);
    }
    overlays(ctx, 0, raw.w, H);
    if (side) overlays(ctx, raw.w, raw.w, H);
  }

  function label(ctx, text, x, y, frameH) {
    var fs = Math.max(11, Math.round(frameH / 30)), pad = Math.round(fs / 2);
    ctx.font = '600 ' + fs + 'px ui-sans-serif, system-ui, sans-serif';
    var w = ctx.measureText(text).width + 2 * pad;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x, y, w, fs + pad);
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + pad, y + (fs + pad) / 2);
  }

  function overlays(ctx, ox, w, h) {
    var o = S.ov, lw = Math.max(1, Math.round(Math.min(w, h) / 400));
    ctx.save();
    ctx.strokeStyle = o.color; ctx.lineWidth = lw;
    if (o.grid) {
      ctx.globalAlpha = 0.45; ctx.beginPath();
      for (var g = 1; g < 10; g++) {
        ctx.moveTo(ox + w * g / 10, 0); ctx.lineTo(ox + w * g / 10, h);
        ctx.moveTo(ox, h * g / 10); ctx.lineTo(ox + w, h * g / 10);
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (o.crosshair) {
      var cx = ox + w / 2, cy = h / 2, r = Math.min(w, h) / 12;
      ctx.beginPath();
      ctx.moveTo(cx - 3 * r, cy); ctx.lineTo(cx - r / 3, cy); ctx.moveTo(cx + r / 3, cy); ctx.lineTo(cx + 3 * r, cy);
      ctx.moveTo(cx, cy - 3 * r); ctx.lineTo(cx, cy - r / 3); ctx.moveTo(cx, cy + r / 3); ctx.lineTo(cx, cy + 3 * r);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    if (o.circle) {
      ctx.beginPath(); ctx.arc(ox + w / 2, h / 2, Math.min(w, h) * 0.48, 0, Math.PI * 2); ctx.stroke();
    }
    if (o.profile) {
      ctx.setLineDash([6 * lw, 4 * lw]); ctx.globalAlpha = 0.85; ctx.beginPath();
      if (S.profile.dir === 'horizontal') { var py = Math.round(S.profile.y * (h - 1)) + 0.5; ctx.moveTo(ox, py); ctx.lineTo(ox + w, py); }
      else { var px = ox + Math.round(S.profile.x * (w - 1)) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, h); }
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    if (o.timestamp) {
      var text = new Date().toLocaleString(), fs = Math.max(12, Math.round(h / 32));
      ctx.font = '600 ' + fs + 'px ui-monospace, Menlo, monospace';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(ox + 6, h - fs - 12, ctx.measureText(text).width + 12, fs + 8);
      ctx.fillStyle = o.color; ctx.fillText(text, ox + 12, h - 8);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ charts

  function updateHistogram() {
    var img = S.hist.source === 'raw' ? S.lastRaw : S.lastOut;
    if (!img) return;
    var H = F.histogram(img, img.w * img.h > 500000 ? 2 : 1), max = 1, log = S.hist.log;
    ['r', 'g', 'b', 'l'].forEach(function (k) {
      if (!S.hist[k]) return;
      for (var i = 1; i < 255; i++) if (H[k][i] > max) max = H[k][i];
    });
    var norm = log ? Math.log(1 + max) : max;
    function pts(arr, closed) {
      var s = closed ? '0,100' : '';
      for (var i = 0; i < 256; i++) {
        var v = log ? Math.log(1 + arr[i]) : arr[i];
        s += ' ' + i + ',' + (100 - Math.min(1, v / norm) * 98).toFixed(1);
      }
      return closed ? s + ' 255,100' : s;
    }
    if (S.hist.r) bw.patch('h_r', { points: pts(H.r, true) });
    if (S.hist.g) bw.patch('h_g', { points: pts(H.g, true) });
    if (S.hist.b) bw.patch('h_b', { points: pts(H.b, true) });
    if (S.hist.l) bw.patch('h_l', { points: pts(H.l, false) });

    var now = performance.now();
    if (now - S.stats.lastStats > 400) {
      S.stats.lastStats = now;
      statsTable.bw.setData([['R', H.r], ['G', H.g], ['B', H.b], ['Luma', H.l]].map(function (row) {
        var s = F.histStats(row[1], H.count);
        return { ch: row[0], mean: s.mean.toFixed(1), std: s.std.toFixed(1), median: s.median, min: s.min, max: s.max, lo: s.clipLow.toFixed(2), hi: s.clipHigh.toFixed(2) };
      }));
    }
  }

  function updateProfile() {
    var img = S.hist.source === 'raw' ? S.lastRaw : S.lastOut;
    if (!img) return;
    var horiz = S.profile.dir === 'horizontal', n = horiz ? img.w : img.h;
    var fixed = horiz ? Math.round(S.profile.y * (img.h - 1)) : Math.round(S.profile.x * (img.w - 1));
    var r = '', g = '', b = '', l = '', d = img.data;
    for (var i = 0; i < 256; i++) {
      var t = Math.round(i / 255 * (n - 1)), p = (horiz ? fixed * img.w + t : t * img.w + fixed) * 4;
      var y = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
      r += ' ' + i + ',' + (100 - d[p] / 255 * 98).toFixed(1);
      g += ' ' + i + ',' + (100 - d[p + 1] / 255 * 98).toFixed(1);
      b += ' ' + i + ',' + (100 - d[p + 2] / 255 * 98).toFixed(1);
      l += ' ' + i + ',' + (100 - y / 255 * 98).toFixed(1);
    }
    bw.patch('p_r', { points: r }); bw.patch('p_g', { points: g }); bw.patch('p_b', { points: b }); bw.patch('p_l', { points: l });
    bw.patch('prof_pos', (horiz ? 'row ' : 'column ') + fixed);
  }

  // ------------------------------------------------------------------ pointer tools

  function canvasPoint(e) {
    var r = dom.view.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * dom.view.width, y: (e.clientY - r.top) / r.height * dom.view.height };
  }

  /** Map a canvas point to (image, x, y); in side-by-side, the right half is the processed image. */
  function pick(e) {
    if (!S.lastRaw) return null;
    var p = canvasPoint(e), w = S.lastRaw.w, img = S.lastOut, x = p.x;
    if (S.split === 'side') { if (x < w) img = S.lastRaw; else x -= w; }
    else if (S.split === 'wipe' && x < w * S.wipe / 100) img = S.lastRaw;
    x = Math.max(0, Math.min(w - 1, Math.floor(x)));
    var y = Math.max(0, Math.min(S.lastRaw.h - 1, Math.floor(p.y)));
    return { img: img, x: x, y: y, raw: img === S.lastRaw };
  }

  function onProbe(e) {
    var q = pick(e);
    if (!q) return;
    var d = q.img.data, i = (q.y * q.img.w + q.x) * 4;
    var l = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    bw.removeClass('endo_probe', 'endo_hidden');
    bw.patch('endo_probe', 'x ' + q.x + '  y ' + q.y + '   R ' + d[i] + '  G ' + d[i + 1] + '  B ' + d[i + 2] + '  L ' + l + (S.split !== 'off' ? (q.raw ? '  (raw)' : '  (processed)') : ''));
  }

  function onViewClick(e) {
    var q = pick(e);
    if (!q) return;
    S.profile.x = q.x / Math.max(1, S.lastRaw.w - 1);
    S.profile.y = q.y / Math.max(1, S.lastRaw.h - 1);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (dom.viewer.requestFullscreen) dom.viewer.requestFullscreen();
  }

  // ------------------------------------------------------------------ freeze, snapshot, record

  function toggleFreeze() {
    if (!S.running) return;
    S.frozen = !S.frozen;
    if (S.frozen) {
      // Keep a full-resolution copy of the frame so zoom/flip/filters still apply.
      var v = dom.video, c = bw.create({ t: 'canvas', a: { width: v.videoWidth, height: v.videoHeight } });
      c.getContext('2d').drawImage(v, 0, 0);
      S.frozenSrc = c;
    } else {
      S.frozenSrc = null;
    }
    updateFreezeUI();
  }

  function updateFreezeUI() {
    bw.toggleClass('tag_frozen', 'endo_hidden', !S.frozen);
    bw.patch('btn_freeze', S.frozen ? '▶ Resume' : '❄ Freeze');
    if (S.running) { bw.patch('st_state', S.frozen ? 'Frozen' : 'Live'); setVariant('st_state', S.frozen ? 'info' : 'success'); }
  }

  function imageCanvas(img) {
    var c = bw.create({ t: 'canvas', a: { width: img.w, height: img.h } });
    c.getContext('2d').putImageData(new ImageData(img.data, img.w, img.h), 0, 0);
    return c;
  }

  function snapshot() {
    if (!S.running || !S.lastRaw) { toast('Start the camera first.', 'warning'); return; }
    var c = S.snapSource === 'view' ? dom.view : imageCanvas(S.snapSource === 'raw' ? S.lastRaw : S.lastOut);
    var type = S.snapFormat === 'jpeg' ? 'image/jpeg' : 'image/png', ext = S.snapFormat === 'jpeg' ? 'jpg' : 'png';
    var w = c.width, h = c.height;
    c.toBlob(function (blob) {
      if (!blob) { toast('Snapshot failed.', 'danger'); return; }
      addCapture({ kind: 'image', blob: blob, name: stamp() + '_' + S.snapSource + '.' + ext, dims: w + '×' + h });
    }, type, 0.92);
    bw.removeClass(dom.viewer, 'endo_flash');
    void dom.viewer.offsetWidth; // restart the CSS animation
    bw.addClass(dom.viewer, 'endo_flash');
  }

  function pickMime() {
    var list = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (var i = 0; i < list.length; i++) if (window.MediaRecorder && MediaRecorder.isTypeSupported(list[i])) return list[i];
    return '';
  }

  function toggleRecord() {
    if (S.recorder) { S.recorder.stop(); return; }
    if (!S.running) { toast('Start the camera first.', 'warning'); return; }
    if (!window.MediaRecorder || !dom.view.captureStream) { toast('Recording is not supported in this browser.', 'danger'); return; }
    var mime = pickMime(), stream = dom.view.captureStream(S.fps), chunks = [];
    var rec;
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8000000 } : {}); }
    catch (e) { toast(e.message, 'danger', 'Recorder'); return; }
    var dims = dom.view.width + '×' + dom.view.height;
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      stream.getTracks().forEach(function (t) { t.stop(); });
      var type = (rec.mimeType || mime || 'video/webm').split(';')[0];
      var blob = new Blob(chunks, { type: type });
      var secs = ((performance.now() - S.recStart) / 1000).toFixed(1);
      S.recorder = null;
      bw.toggleClass('tag_rec', 'endo_hidden', true);
      bw.patch('btn_rec', '⏺ Record'); setVariant('btn_rec', 'danger');
      if (blob.size) addCapture({ kind: 'video', blob: blob, name: stamp() + '.' + (type.indexOf('mp4') >= 0 ? 'mp4' : 'webm'), dims: dims + ' · ' + secs + ' s' });
    };
    rec.start(1000);
    S.recorder = rec; S.recStart = performance.now();
    bw.toggleClass('tag_rec', 'endo_hidden', false);
    bw.patch('btn_rec', '⏹ Stop recording'); setVariant('btn_rec', 'warning');
  }

  // ------------------------------------------------------------------ captures

  function addCapture(c) {
    c.id = uid('cap');
    c.url = URL.createObjectURL(c.blob);
    c.saved = '';
    S.captures.unshift(c);
    syncGallery();
    toast((c.kind === 'image' ? 'Snapshot ' : 'Recording ') + c.name + ' (' + fmtBytes(c.blob.size) + ')', 'success');
    if (S.serverSave) saveToServer(c);
  }

  function saveToServer(c) {
    bw.patch(c.id + '_saved', 'saving…');
    fetch('/api/save?name=' + encodeURIComponent(c.name), { method: 'POST', body: c.blob })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || 'save failed');
        c.saved = j.file;
        bw.patch(c.id + '_saved', '✔ ' + j.file);
      })
      .catch(function (e) { bw.patch(c.id + '_saved', 'not saved: ' + e.message); });
  }

  function captureItem(c) {
    var media = c.kind === 'image'
      ? { t: 'img', a: { src: c.url, alt: c.name, onclick: function () { preview(c); } } }
      : { t: 'video', a: { src: c.url, controls: true, muted: true, preload: 'metadata' } };
    return { t: 'div', a: { class: 'endo_cap' }, c: [
      media,
      { t: 'div', a: { class: 'endo_cap_meta' }, c: [
        { t: 'span', c: c.name },
        { t: 'span', a: { class: 'endo_muted' }, c: (c.kind === 'image' ? 'image' : 'video') + ' · ' + c.dims + ' · ' + fmtBytes(c.blob.size) },
        { t: 'span', a: { id: c.id + '_saved', class: 'endo_muted' }, c: c.saved ? '✔ ' + c.saved : '' }
      ] },
      { t: 'div', a: { class: 'endo_cap_btns' }, c: [
        smallBtn('⬇', function () { bw.saveClientFile(c.name, c.blob); }, 'outline_primary', 'Download'),
        S.serverOk ? smallBtn('Save', function () { saveToServer(c); }, null, 'Save to ./captures') : null,
        smallBtn('✕', function () { removeCapture(c); }, 'outline_danger', 'Delete')
      ] }
    ] };
  }

  function syncGallery() {
    bw.syncChildren('#gallery', S.captures, {
      key: function (c) { return c.id; },
      create: captureItem,
      update: function () {}
    });
    bw.toggleClass('gallery_empty', 'endo_hidden', S.captures.length > 0);
  }

  function removeCapture(c) {
    URL.revokeObjectURL(c.url);
    S.captures = S.captures.filter(function (x) { return x !== c; });
    syncGallery();
  }

  function clearCaptures() {
    S.captures.forEach(function (c) { URL.revokeObjectURL(c.url); });
    S.captures = [];
    syncGallery();
  }

  function downloadAll() {
    S.captures.forEach(function (c, i) { setTimeout(function () { bw.saveClientFile(c.name, c.blob); }, i * 250); });
  }

  function preview(c) {
    var m = bw.mount('#endo_modal_host', bw.makeModal({
      title: c.name, size: 'xl',
      content: { t: 'img', a: { class: 'endo_preview', src: c.url, alt: c.name } },
      footer: { t: 'div', a: { class: 'endo_row' }, c: [
        bw.makeButton({ text: '⬇ Download', variant: 'primary', onclick: function () { bw.saveClientFile(c.name, c.blob); } })
      ] }
    }));
    m.bw.open();
  }

  function renderSaveBox() {
    bw.mount('#save_box', S.serverOk
      ? sw('Also save to ' + S.serverDir, S.serverSave, function (v) { S.serverSave = v; })
      : { t: 'span', a: { class: 'endo_muted' }, c: 'Captures stay in the browser (run node server.js to also save them to disk).' });
  }

  // ------------------------------------------------------------------ wiring

  window.addEventListener('keydown', function (e) {
    var t = e.target || {}, tag = t.tagName || '';
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Typing into a text field or a dropdown owns the keyboard.
    if (tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !/^(range|checkbox|radio|button)$/.test(t.type))) return;
    // Space / Enter on a focused button or switch keep their native meaning.
    if ((e.key === ' ' || e.key === 'Enter') && (tag === 'BUTTON' || tag === 'INPUT')) return;
    if (e.key === ' ') { e.preventDefault(); snapshot(); }
    else if (e.key === 'r' || e.key === 'R') toggleRecord();
    else if (e.key === 'f' || e.key === 'F') toggleFreeze();
    else if (e.key === 'Enter') toggleFullscreen();
  });

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', function () {
      refreshDevices().then(function (added) {
        (added || []).forEach(function (d) {
          toast('Camera connected: ' + (d.label || 'new device'), 'success');
          if (!isBuiltin(d.label) && (!S.running || isBuiltin(S.track && S.track.label))) { S.deviceId = d.deviceId; bw.mount('#cam_dev_box', deviceSelect()); start(); }
        });
      });
    });
  }

  if (navigator.usb) {
    navigator.usb.addEventListener('connect', function (e) { toast('USB connected: ' + (e.device.productName || 'device'), 'info'); renderUsb(); });
    navigator.usb.addEventListener('disconnect', function (e) { toast('USB disconnected: ' + (e.device.productName || 'device'), 'warning'); renderUsb(); });
    renderUsb();
  }

  fetch('/api/ping').then(function (r) { return r.json(); }).then(function (j) {
    S.serverOk = !!j.ok; S.serverSave = S.serverOk; S.serverDir = './captures';
  }).catch(function () { S.serverOk = false; }).then(renderSaveBox);

  syncChain();
  syncGallery();

  // If permission was granted before, list cameras and start straight away.
  refreshDevices().then(function () {
    if (S.permission && S.devices.length) start();
  });

  // Exposed for debugging from the console / bwcli attach.
  window.endo = { state: S, start: start, stop: stop, snapshot: snapshot, toggleRecord: toggleRecord, toggleFreeze: toggleFreeze, addStage: addStage, preset: preset };
})();
