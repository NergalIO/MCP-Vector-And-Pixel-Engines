import { toHex, getPx, setPx, linePoints, rectPoints, ellipsePoints, floodFill, composite } from './shared/raster.js';
import { makeRamp } from './shared/color.js';

const $ = (id) => document.getElementById(id);
const enc = encodeURIComponent;

const PRESETS = {
  pico8: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'],
  db16: ['#140c1c', '#442434', '#30346d', '#4e4a4e', '#854c30', '#346524', '#d04648', '#757161', '#597dce', '#d27d2c', '#8595a1', '#6daa2c', '#d2aa99', '#6dc2ca', '#dad45e', '#deeed6'],
  gb: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  nes: ['#000000', '#fcfcfc', '#bcbcbc', '#7c7c7c', '#a4e4fc', '#3cbcfc', '#0078f8', '#0000fc', '#b8b8f8', '#6888fc', '#0058f8', '#d8b8f8',
    '#9878f8', '#6844fc', '#f8b8f8', '#f878f8', '#d800cc', '#f8a4c0', '#f85898', '#e40058', '#f0d0b0', '#f87858', '#f83800', '#a81000'],
  gray: ['#000000', '#222222', '#444444', '#666666', '#888888', '#aaaaaa', '#cccccc', '#eeeeee', '#ffffff'],
};
const ZOOMS = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64];
const FREEHAND = ['pencil', 'eraser', 'dither', 'shade'];
const SHAPES = ['line', 'rect', 'ellipse'];
const TAG_COLORS = ['#29adff', '#ff77a8', '#ffec27', '#00e436', '#ffa300', '#83769c'];

const st = {
  list: [], sprite: null, frame: 0, layer: 0, tool: 'pencil',
  primary: [0, 0, 0, 255], secondary: [255, 255, 255, 255], brush: 1,
  zoom: 8, panX: 0, panY: 0, grid: true, onion: false, mirror: false, fillShapes: false, follow: true,
  perfect: true, tiling: false,
  playing: false, previewTag: '', previewFrame: 0, stroke: null, pan: null, hover: null, spaceDown: false,
  autoFit: true, // refit on window resize until the user zooms or pans
  queue: [], resyncing: false, build: null,
  sel: null, // {mask: Uint8Array(w*h)} — selected pixels on the canvas
  float: null, // {buf, mask, w, h, x, y, frame, layer} — lifted/pasted pixels not yet dropped
  clip: null, // copied pixels {buf, mask, w, h, x, y}
  refs: new Map(), // sprite id → {img, opacity, above, show}
};

// ---------------------------------------------------------------- utilities

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8ClampedArray(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const rgbaCss = (c) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(3)})`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mod = (v, n) => ((v % n) + n) % n;
const hexToRgba = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), h.length > 7 ? parseInt(h.slice(7, 9), 16) : 255];
const isInt = (v) => v !== undefined && v !== null && Number.isInteger(+v);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

async function api(path, { method, body } = {}) {
  const res = await fetch('/api' + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || res.statusText);
  return j;
}

async function op(name, args = {}) {
  if (!st.sprite) return null;
  try {
    const r = await api(`/sprites/${enc(st.sprite.id)}/op`, { body: { op: name, args } });
    return r.result;
  } catch (e) {
    log(`Ошибка: ${e.message}`, 'err');
    return null;
  }
}

// Sends only the pixels that differ between `orig` and `cel` (or the whole cel if most changed).
function sendDiff(frame, layer, orig, cel) {
  const changes = [];
  for (let p = 0, i = 0; i < cel.length; p++, i += 4) {
    if (cel[i] !== orig[i] || cel[i + 1] !== orig[i + 1] || cel[i + 2] !== orig[i + 2] || cel[i + 3] !== orig[i + 3]) {
      changes.push(p, ((cel[i] << 24) | (cel[i + 1] << 16) | (cel[i + 2] << 8) | cel[i + 3]) >>> 0);
    }
  }
  if (!changes.length) return null;
  if (changes.length / 2 > cel.length / 8) op('set_cel', { frame, layer, data: bytesToB64(cel) });
  else op('patch_cel', { frame, layer, changes });
  return changes;
}

function log(text, cls = '') {
  const li = document.createElement('li');
  li.className = cls;
  li.innerHTML = `<time>${new Date().toTimeString().slice(0, 8)}</time>`;
  li.append(text);
  const ul = $('log');
  ul.prepend(li);
  while (ul.children.length > 80) ul.lastChild.remove();
}

function escapeHtml(t) {
  return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------------------------------------------------------------- dialogs

function formDialog({ title, text = '', fields = [], ok = 'OK', extra = null }) {
  return new Promise((resolve) => {
    const d = $('formDialog'), box = $('fdFields');
    $('fdTitle').textContent = title;
    $('fdText').textContent = text;
    box.innerHTML = '';
    const inputs = {};
    for (const f of fields) {
      const label = document.createElement('label');
      if (f.wide) label.classList.add('wide');
      if (f.type === 'checkbox') label.classList.add('inline', 'wide');
      let input;
      if (f.type === 'select') {
        input = document.createElement('select');
        for (const o of f.options) {
          const opt = document.createElement('option');
          [opt.value, opt.textContent] = Array.isArray(o) ? o : [o, o];
          input.append(opt);
        }
        input.value = f.value ?? '';
      } else {
        input = document.createElement('input');
        input.type = f.type || 'text';
        if (f.type === 'checkbox') input.checked = !!f.value; else input.value = f.value ?? '';
        for (const k of ['min', 'max', 'step']) if (f[k] !== undefined) input[k] = f[k];
        if (f.required) input.required = true;
      }
      input.name = f.name;
      inputs[f.name] = input;
      if (f.type === 'checkbox') label.append(input, f.label); else label.append(f.label, input);
      box.append(label);
    }
    for (const f of fields) if (f.onchange) inputs[f.name].addEventListener('change', () => f.onchange(inputs[f.name], inputs));
    $('fdOk').textContent = ok;
    $('fdExtra').hidden = !extra;
    if (extra) $('fdExtra').textContent = extra;
    d.returnValue = '';
    d.onclose = () => {
      const v = d.returnValue;
      if (v !== 'ok' && v !== 'extra') return resolve(null);
      const out = { _action: v };
      for (const f of fields) {
        const el = inputs[f.name];
        out[f.name] = f.type === 'checkbox' ? el.checked : f.type === 'number' ? Number(el.value) : el.value;
      }
      resolve(out);
    };
    d.showModal();
    box.querySelector('input:not([type=checkbox]), select')?.select?.();
  });
}

const confirmDialog = async (title, text, ok = 'OK') => !!(await formDialog({ title, text, ok }));

// ---------------------------------------------------------------- sprite state & composite cache

const cache = new Map(); // frame → composited RGBA
const invalidate = (f) => (f === undefined ? cache.clear() : cache.delete(f));

function decodeSprite(j) {
  return { ...j, frames: j.frames.map((f) => ({ ...f, cels: f.cels.map(b64ToBytes) })) };
}

function setSprite(json, { keepView = false } = {}) {
  const prev = st.sprite;
  st.sprite = decodeSprite(json);
  invalidate();
  st.frame = clamp(st.frame, 0, st.sprite.frames.length - 1);
  st.layer = clamp(st.layer, 0, st.sprite.layers.length - 1);
  const sameSprite = prev && prev.id === st.sprite.id;
  const dimsChanged = !prev || prev.width !== st.sprite.width || prev.height !== st.sprite.height;
  if (!sameSprite || dimsChanged) { st.sel = null; st.float = null; updateSelPath(); }
  if (!keepView || dimsChanged || !sameSprite) fit();
  if (!sameSprite) loadRef(st.sprite.id);
  renderAll();
}

async function openSprite(id, frame = 0) {
  try {
    const j = await api(`/sprites/${enc(id)}`);
    st.frame = frame;
    if (st.sprite?.id === j.id) {
      // A newer revision may have arrived over SSE while this request was in flight.
      if (j.rev > st.sprite.rev) setSprite(j, { keepView: true }); else renderAll();
      return;
    }
    commitFloat();
    st.layer = 0;
    setSprite(j);
  } catch (e) {
    log(`Не удалось открыть: ${e.message}`, 'err');
  }
}

async function resync() {
  if (!st.sprite || st.resyncing) return;
  st.resyncing = true;
  try {
    setSprite(await api(`/sprites/${enc(st.sprite.id)}`), { keepView: true });
  } catch (e) {
    log(`Синхронизация не удалась: ${e.message}`, 'err');
  }
  st.resyncing = false;
  drainQueue();
}

function blitFloat(cel, fl) {
  const s = st.sprite;
  for (let y = 0; y < fl.h; y++) {
    for (let x = 0; x < fl.w; x++) {
      const i = y * fl.w + x;
      if (!fl.mask[i] || !fl.buf[i * 4 + 3]) continue;
      let tx = fl.x + x, ty = fl.y + y;
      if (st.tiling) { tx = mod(tx, s.width); ty = mod(ty, s.height); }
      setPx(cel, s.width, s.height, tx, ty, [fl.buf[i * 4], fl.buf[i * 4 + 1], fl.buf[i * 4 + 2], fl.buf[i * 4 + 3]]);
    }
  }
}

function compositeFrame(f) {
  const s = st.sprite;
  const fl = st.float && st.float.frame === f ? st.float : null;
  if (!fl) {
    let c = cache.get(f);
    if (!c) { c = composite(s.layers, s.frames[f].cels, s.width, s.height); cache.set(f, c); }
    return c;
  }
  const cels = s.frames[f].cels.slice();
  if (cels[fl.layer]) { cels[fl.layer] = cels[fl.layer].slice(); blitFloat(cels[fl.layer], fl); }
  return composite(s.layers, cels, s.width, s.height);
}

// ---------------------------------------------------------------- selection & clipboard

// Current selection mask in canvas coordinates (a floating selection's mask at its position).
function selMask() {
  const s = st.sprite;
  if (!s) return null;
  if (st.float) {
    const fl = st.float, m = new Uint8Array(s.width * s.height);
    for (let y = 0; y < fl.h; y++) {
      for (let x = 0; x < fl.w; x++) {
        const tx = fl.x + x, ty = fl.y + y;
        if (fl.mask[y * fl.w + x] && tx >= 0 && ty >= 0 && tx < s.width && ty < s.height) m[ty * s.width + tx] = 1;
      }
    }
    return m;
  }
  return st.sel?.mask || null;
}

function maskBounds(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

let selPath = null;
function updateSelPath() {
  const s = st.sprite, m = selMask();
  selPath = null;
  if (s && m) {
    const p = new Path2D(), W = s.width, H = s.height;
    const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      if (!on(x, y - 1)) { p.moveTo(x, y); p.lineTo(x + 1, y); }
      if (!on(x, y + 1)) { p.moveTo(x, y + 1); p.lineTo(x + 1, y + 1); }
      if (!on(x - 1, y)) { p.moveTo(x, y); p.lineTo(x, y + 1); }
      if (!on(x + 1, y)) { p.moveTo(x + 1, y); p.lineTo(x + 1, y + 1); }
    }
    selPath = p;
  }
  renderStatus();
  postEditorState();
  scheduleDraw();
}

const canPaint = (x, y) => !st.sel || st.float || !!st.sel.mask[y * st.sprite.width + x];

function activeCel() { return st.sprite.frames[st.frame].cels[st.layer]; }

// Cut pixels under the selection out of the active cel into a floating selection.
function liftSelection() {
  const s = st.sprite, m = st.sel?.mask;
  if (!m) return false;
  const b = maskBounds(m, s.width, s.height);
  if (!b) { st.sel = null; updateSelPath(); return false; }
  const cel = activeCel(), orig = cel.slice();
  const fl = { buf: new Uint8ClampedArray(b.w * b.h * 4), mask: new Uint8Array(b.w * b.h), w: b.w, h: b.h, x: b.x, y: b.y, frame: st.frame, layer: st.layer };
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const sx = b.x + x, sy = b.y + y, si = sy * s.width + sx;
    if (!m[si]) continue;
    fl.mask[y * b.w + x] = 1;
    fl.buf.set(cel.subarray(si * 4, si * 4 + 4), (y * b.w + x) * 4);
    cel.fill(0, si * 4, si * 4 + 4);
  }
  sendDiff(st.frame, st.layer, orig, cel);
  invalidate(st.frame);
  st.float = fl;
  st.sel = null;
  updateSelPath();
  return true;
}

// Drop the floating selection onto its cel; the selection stays where it was dropped.
function commitFloat() {
  const fl = st.float, s = st.sprite;
  if (!fl || !s) return;
  const mask = selMask();
  st.float = null;
  const cel = s.frames[fl.frame]?.cels[fl.layer];
  if (cel) {
    const orig = cel.slice();
    blitFloat(cel, fl);
    sendDiff(fl.frame, fl.layer, orig, cel);
    invalidate(fl.frame);
  }
  st.sel = mask && mask.some((v) => v) ? { mask } : null;
  updateSelPath();
  scheduleTimeline();
}

function deselect() {
  commitFloat();
  st.sel = null;
  updateSelPath();
}

function selectAll() {
  commitFloat();
  st.sel = { mask: new Uint8Array(st.sprite.width * st.sprite.height).fill(1) };
  updateSelPath();
}

function copySelection() {
  const s = st.sprite;
  if (st.float) {
    const fl = st.float;
    st.clip = { buf: fl.buf.slice(), mask: fl.mask.slice(), w: fl.w, h: fl.h, x: fl.x, y: fl.y };
  } else {
    const m = st.sel?.mask || new Uint8Array(s.width * s.height).fill(1);
    const b = maskBounds(m, s.width, s.height);
    if (!b) return;
    const cel = activeCel();
    const clip = { buf: new Uint8ClampedArray(b.w * b.h * 4), mask: new Uint8Array(b.w * b.h), w: b.w, h: b.h, x: b.x, y: b.y };
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const si = (b.y + y) * s.width + b.x + x;
      if (!m[si]) continue;
      clip.mask[y * b.w + x] = 1;
      clip.buf.set(cel.subarray(si * 4, si * 4 + 4), (y * b.w + x) * 4);
    }
    st.clip = clip;
  }
  log(`Скопировано ${st.clip.w}×${st.clip.h}`);
}

function deleteSelection() {
  if (st.float) { st.float = null; updateSelPath(); scheduleTimeline(); return; }
  const m = st.sel?.mask;
  if (!m) return;
  const cel = activeCel(), orig = cel.slice();
  for (let i = 0; i < m.length; i++) if (m[i]) cel.fill(0, i * 4, i * 4 + 4);
  sendDiff(st.frame, st.layer, orig, cel);
  invalidate(st.frame);
  scheduleDraw();
  scheduleTimeline();
}

function paste() {
  if (!st.clip || !st.sprite) return;
  commitFloat();
  const c = st.clip;
  st.float = { buf: c.buf.slice(), mask: c.mask.slice(), w: c.w, h: c.h, x: c.x, y: c.y, frame: st.frame, layer: st.layer };
  st.sel = null;
  setTool('move');
  updateSelPath();
}

function flipSelection(vertical) {
  if (!st.float && !liftSelection()) return;
  const fl = st.float, buf = fl.buf.slice(), mask = fl.mask.slice();
  for (let y = 0; y < fl.h; y++) for (let x = 0; x < fl.w; x++) {
    const sx = vertical ? x : fl.w - 1 - x, sy = vertical ? fl.h - 1 - y : y;
    const d = y * fl.w + x, sI = sy * fl.w + sx;
    fl.mask[d] = mask[sI];
    fl.buf.set(buf.subarray(sI * 4, sI * 4 + 4), d * 4);
  }
  updateSelPath();
}

function polygonMask(pts) {
  const s = st.sprite, m = new Uint8Array(s.width * s.height);
  for (let y = 0; y < s.height; y++) {
    const cy = y + 0.5;
    for (let x = 0; x < s.width; x++) {
      const cx = x + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > cy) !== (yj > cy) && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) m[y * s.width + x] = 1;
    }
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    for (const [x, y] of linePoints(Math.floor(a[0]), Math.floor(a[1]), Math.floor(b[0]), Math.floor(b[1]))) {
      if (x >= 0 && y >= 0 && x < s.width && y < s.height) m[y * s.width + x] = 1;
    }
  }
  return m;
}

function finishSelection(k, p) {
  const s = st.sprite;
  let m;
  if (k.tool === 'select') {
    if (!k.moved) { if (!k.add) { st.sel = null; updateSelPath(); } return; }
    m = new Uint8Array(s.width * s.height);
    const x0 = clamp(Math.min(k.start.x, p.x), 0, s.width - 1), x1 = clamp(Math.max(k.start.x, p.x), 0, s.width - 1);
    const y0 = clamp(Math.min(k.start.y, p.y), 0, s.height - 1), y1 = clamp(Math.max(k.start.y, p.y), 0, s.height - 1);
    for (let y = y0; y <= y1; y++) m.fill(1, y * s.width + x0, y * s.width + x1 + 1);
  } else {
    if (k.pts.length < 3) { if (!k.add) { st.sel = null; updateSelPath(); } return; }
    m = polygonMask(k.pts.map((q) => [q.x + 0.5, q.y + 0.5]));
  }
  if (k.add && st.sel) for (let i = 0; i < m.length; i++) m[i] |= st.sel.mask[i];
  st.sel = m.some((v) => v) ? { mask: m } : null;
  updateSelPath();
}

// ---------------------------------------------------------------- reference image

function loadRef(id) {
  if (st.refs.has(id)) return;
  const data = store.get(`pf-ref:${id}`);
  if (!data) return;
  const opts = JSON.parse(store.get(`pf-refopts:${id}`) || '{}');
  setRef(id, data, opts, false);
}

function setRef(id, dataUrl, opts = {}, persist = true) {
  const img = new Image();
  img.onload = () => { scheduleDraw(); renderRefControls(); };
  img.src = dataUrl;
  st.refs.set(id, { img, opacity: opts.opacity ?? 0.4, above: !!opts.above, show: opts.show !== false });
  if (persist) { store.set(`pf-ref:${id}`, dataUrl); saveRefOpts(id); }
}

function saveRefOpts(id) {
  const r = st.refs.get(id);
  if (r) store.set(`pf-refopts:${id}`, JSON.stringify({ opacity: r.opacity, above: r.above, show: r.show }));
}

function renderRefControls() {
  const r = st.sprite && st.refs.get(st.sprite.id);
  $('refOpacity').value = Math.round((r?.opacity ?? 0.4) * 100);
  $('refAbove').checked = !!r?.above;
  $('refShow').checked = r ? r.show : true;
  $('btnRefClear').disabled = !r;
}

function drawRef(x0, y0, W, H) {
  const r = st.sprite && st.refs.get(st.sprite.id);
  if (!r || !r.show || !r.img.complete || !r.img.naturalWidth) return;
  const k = Math.min(W / r.img.naturalWidth, H / r.img.naturalHeight);
  const w = r.img.naturalWidth * k, h = r.img.naturalHeight * k;
  ctx.save();
  ctx.globalAlpha = r.opacity;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(r.img, x0 + (W - w) / 2, y0 + (H - h) / 2, w, h);
  ctx.restore();
}

// ---------------------------------------------------------------- canvas

const cv = $('canvas');
const ctx = cv.getContext('2d');
const stage = $('stage');
const tmp = document.createElement('canvas');
const tctx = tmp.getContext('2d');

const checkerTile = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const x = c.getContext('2d');
  x.fillStyle = '#3a3a48'; x.fillRect(0, 0, 16, 16);
  x.fillStyle = '#2e2e3a'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
  return c;
})();
const checker = ctx.createPattern(checkerTile, 'repeat');

function imageToTmp(buf, w, h) {
  tmp.width = w; tmp.height = h;
  tctx.putImageData(new ImageData(buf, w, h), 0, 0);
  return tmp;
}

let rafPending = false, timelinePending = false;
function scheduleDraw() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    draw();
    drawPreview();
    if (timelinePending) { timelinePending = false; renderTimeline(); }
  });
}
function scheduleTimeline() { timelinePending = true; scheduleDraw(); }

function resizeCanvas() {
  const r = stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr);
  cv.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (st.autoFit) fit();
  scheduleDraw();
}

let antsOffset = 0;
setInterval(() => { if (selPath) { antsOffset = (antsOffset + 1) % 8; scheduleDraw(); } }, 120);

function draw() {
  const r = stage.getBoundingClientRect();
  ctx.clearRect(0, 0, r.width, r.height);
  const s = st.sprite;
  $('empty').classList.toggle('show', !s);
  if (!s) return;
  const z = st.zoom, W = s.width * z, H = s.height * z, x0 = Math.round(st.panX), y0 = Math.round(st.panY);
  const tiles = st.tiling ? [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => [dx, dy])) : [[0, 0]];

  ctx.save();
  ctx.fillStyle = checker;
  for (const [dx, dy] of tiles) {
    ctx.save();
    ctx.translate(x0 + dx * W, y0 + dy * H);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  ctx.restore();

  const ref = st.refs.get(s.id);
  if (!ref?.above) drawRef(x0, y0, W, H);

  ctx.imageSmoothingEnabled = false;
  if (st.onion) {
    for (const [f, a] of [[st.frame - 1, 0.3], [st.frame + 1, 0.18]]) {
      if (f < 0 || f >= s.frames.length) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(imageToTmp(compositeFrame(f), s.width, s.height), x0, y0, W, H);
    }
    ctx.globalAlpha = 1;
  }
  const img = imageToTmp(compositeFrame(st.frame), s.width, s.height);
  for (const [dx, dy] of tiles) {
    ctx.globalAlpha = dx || dy ? 0.55 : 1;
    ctx.drawImage(img, x0 + dx * W, y0 + dy * H, W, H);
  }
  ctx.globalAlpha = 1;

  if (ref?.above) drawRef(x0, y0, W, H);

  if (st.grid && z >= 6) {
    ctx.beginPath();
    for (let x = 1; x < s.width; x++) { ctx.moveTo(x0 + x * z + 0.5, y0); ctx.lineTo(x0 + x * z + 0.5, y0 + H); }
    for (let y = 1; y < s.height; y++) { ctx.moveTo(x0, y0 + y * z + 0.5); ctx.lineTo(x0 + W, y0 + y * z + 0.5); }
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (s.width > 16 || s.height > 16) {
      ctx.beginPath();
      for (let x = 8; x < s.width; x += 8) { ctx.moveTo(x0 + x * z + 0.5, y0); ctx.lineTo(x0 + x * z + 0.5, y0 + H); }
      for (let y = 8; y < s.height; y += 8) { ctx.moveTo(x0, y0 + y * z + 0.5); ctx.lineTo(x0 + W, y0 + y * z + 0.5); }
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.stroke();
    }
  }
  if (st.mirror) {
    ctx.strokeStyle = 'rgba(255,119,168,0.7)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(x0 + W / 2, y0 - 8); ctx.lineTo(x0 + W / 2, y0 + H + 8); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = '#000';
  ctx.strokeRect(x0 - 0.5, y0 - 0.5, W + 1, H + 1);

  const k = st.stroke;
  if (k && k.tool === 'select' && k.moved && k.last) {
    const a = k.start, b = k.last;
    ctx.strokeStyle = '#fff';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x0 + Math.min(a.x, b.x) * z + 0.5, y0 + Math.min(a.y, b.y) * z + 0.5, (Math.abs(b.x - a.x) + 1) * z - 1, (Math.abs(b.y - a.y) + 1) * z - 1);
    ctx.setLineDash([]);
  }
  if (k && k.tool === 'lasso' && k.pts.length > 1) {
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    k.pts.forEach((q, i) => ctx[i ? 'lineTo' : 'moveTo'](x0 + (q.x + 0.5) * z, y0 + (q.y + 0.5) * z));
    ctx.stroke();
  }
  if (selPath) {
    ctx.save();
    ctx.translate(x0, y0);
    ctx.scale(z, z);
    ctx.lineWidth = 1.5 / z;
    ctx.strokeStyle = '#000';
    ctx.stroke(selPath);
    ctx.strokeStyle = '#fff';
    ctx.setLineDash([4 / z, 4 / z]);
    ctx.lineDashOffset = -antsOffset / z;
    ctx.stroke(selPath);
    ctx.restore();
  }

  if (st.hover && !st.pan && [...FREEHAND, ...SHAPES, 'fill'].includes(st.tool)) {
    const n = st.tool === 'fill' ? 1 : st.brush, o = Math.floor((n - 1) / 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeRect(x0 + (st.hover.x - o) * z + 0.5, y0 + (st.hover.y - o) * z + 0.5, n * z - 1, n * z - 1);
  }
}

function fit() {
  const s = st.sprite;
  if (!s) return;
  const r = stage.getBoundingClientRect();
  let z = 1;
  for (const l of ZOOMS) if (s.width * l <= r.width * 0.85 && s.height * l <= r.height * 0.85) z = l;
  st.zoom = z;
  st.autoFit = true;
  st.panX = (r.width - s.width * z) / 2;
  st.panY = (r.height - s.height * z) / 2;
  $('zoomLabel').textContent = `${z * 100}%`;
  scheduleDraw();
}

function zoomTo(z, cx, cy) {
  const r = stage.getBoundingClientRect();
  cx ??= r.width / 2; cy ??= r.height / 2;
  const px = (cx - st.panX) / st.zoom, py = (cy - st.panY) / st.zoom;
  st.zoom = z;
  st.autoFit = false;
  st.panX = cx - px * z;
  st.panY = cy - py * z;
  $('zoomLabel').textContent = `${z * 100}%`;
  scheduleDraw();
}

function zoomStep(dir, cx, cy) {
  const i = ZOOMS.findIndex((z) => z >= st.zoom);
  zoomTo(ZOOMS[clamp((i < 0 ? ZOOMS.length - 1 : i) + dir, 0, ZOOMS.length - 1)], cx, cy);
}

// ---------------------------------------------------------------- drawing tools

function toPx(e) {
  const r = cv.getBoundingClientRect();
  return { x: Math.floor((e.clientX - r.left - st.panX) / st.zoom), y: Math.floor((e.clientY - r.top - st.panY) / st.zoom) };
}

function wrapPt(x, y) {
  const s = st.sprite;
  return st.tiling ? [mod(x, s.width), mod(y, s.height)] : [x, y];
}

// Applies `paint(x, y)` over the brush footprint (wrapped in tiling mode, mirrored, clipped to the selection).
function brushAt(x, y, paint, size = st.brush) {
  const s = st.sprite, o = Math.floor((size - 1) / 2);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const pts = [[x - o + dx, y - o + dy]];
      if (st.mirror) pts.push([s.width - 1 - (x - o + dx), y - o + dy]);
      for (const p of pts) {
        const [px, py] = wrapPt(p[0], p[1]);
        if (px < 0 || py < 0 || px >= s.width || py >= s.height || !canPaint(px, py)) continue;
        paint(px, py);
      }
    }
  }
}

function paintAt(x, y) {
  const k = st.stroke, s = st.sprite;
  if (k.tool === 'shade') {
    brushAt(x, y, (px, py) => {
      const i = py * s.width + px;
      if (k.visited.has(i)) return;
      k.visited.add(i);
      const c = getPx(k.cel, s.width, s.height, px, py);
      if (!c[3]) return;
      const idx = s.palette.indexOf(toHex([c[0], c[1], c[2], 255]));
      const ni = idx + k.dir;
      if (idx < 0 || ni < 0 || ni >= s.palette.length) return;
      setPx(k.cel, s.width, s.height, px, py, hexToRgba(s.palette[ni]));
    });
  } else if (k.tool === 'dither') {
    brushAt(x, y, (px, py) => { if (((px + py + k.parity) & 1) === 0) setPx(k.cel, s.width, s.height, px, py, k.color); });
  } else {
    brushAt(x, y, (px, py) => setPx(k.cel, s.width, s.height, px, py, k.color));
  }
}

// Pixel-perfect: when the path makes an L-shaped corner (a, b, c with a and c diagonal), un-paint b.
function perfectStep(x, y) {
  const k = st.stroke, s = st.sprite;
  k.path.push([x, y]);
  if (k.path.length < 3) return;
  const [a, b, c] = k.path.slice(-3);
  if ((a[0] === b[0] || a[1] === b[1]) && (c[0] === b[0] || c[1] === b[1]) && a[0] !== c[0] && a[1] !== c[1]) {
    const restore = (px, py) => {
      const [wx, wy] = wrapPt(px, py);
      const p = getPx(k.orig, s.width, s.height, wx, wy);
      if (p) setPx(k.cel, s.width, s.height, wx, wy, p);
    };
    restore(b[0], b[1]);
    if (st.mirror) restore(s.width - 1 - b[0], b[1]);
    k.path.splice(-2, 1);
  }
}

function freehandTo(p) {
  const k = st.stroke;
  const usePerfect = st.perfect && st.brush === 1 && (k.tool === 'pencil' || k.tool === 'eraser');
  for (const [x, y] of linePoints(k.last.x, k.last.y, p.x, p.y).slice(1)) {
    paintAt(x, y);
    if (usePerfect) perfectStep(x, y);
  }
}

function constrain(a, b, tool) {
  let dx = b.x - a.x, dy = b.y - a.y;
  if (tool === 'line') {
    if (Math.abs(dx) > 2 * Math.abs(dy)) dy = 0;
    else if (Math.abs(dy) > 2 * Math.abs(dx)) dx = 0;
    else { const d = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx) * d; dy = Math.sign(dy) * d; }
  } else {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (Math.sign(dx) || 1) * d; dy = (Math.sign(dy) || 1) * d;
  }
  return { x: a.x + dx, y: a.y + dy };
}

function shapeUpdate(p, shift) {
  const k = st.stroke, a = k.start, s = st.sprite;
  const b = shift ? constrain(a, p, k.tool) : p;
  k.cel.set(k.orig);
  const pts = k.tool === 'line' ? linePoints(a.x, a.y, b.x, b.y)
    : k.tool === 'rect' ? rectPoints(a.x, a.y, b.x, b.y, st.fillShapes)
      : ellipsePoints(a.x, a.y, b.x, b.y, st.fillShapes);
  for (const [x, y] of pts) brushAt(x, y, (px, py) => setPx(k.cel, s.width, s.height, px, py, k.color));
}

function pick(p, button) {
  const s = st.sprite;
  const [x, y] = wrapPt(p.x, p.y);
  const c = getPx(compositeFrame(st.frame), s.width, s.height, x, y);
  if (!c) return;
  if (button === 2) st.secondary = c; else st.primary = c;
  renderColors();
}

function beginStroke(p, e) {
  const s = st.sprite, tool = st.tool;
  if (tool === 'select' || tool === 'lasso') {
    commitFloat();
    st.stroke = { tool, start: p, last: p, add: e.shiftKey, pts: [p], moved: false };
    return;
  }
  if (tool === 'move' && (st.sel || st.float)) {
    if (!st.float) liftSelection();
    if (st.float) st.stroke = { tool: 'movefloat', start: p, fx: st.float.x, fy: st.float.y };
    scheduleDraw();
    return;
  }
  commitFloat();
  if (!s.layers[st.layer].visible) { log('Слой скрыт — включите его, чтобы рисовать', 'err'); return; }
  const cel = activeCel();
  const color = tool === 'eraser' ? [0, 0, 0, 0] : e.button === 2 ? st.secondary : st.primary;
  st.stroke = {
    tool, color, start: p, last: p, cel, orig: cel.slice(), frame: st.frame, layer: st.layer,
    path: [[p.x, p.y]], visited: new Set(), dir: e.button === 2 ? -1 : 1, parity: e.shiftKey ? 1 : 0,
  };
  if (FREEHAND.includes(tool)) paintAt(p.x, p.y);
  else if (tool === 'fill') {
    const [x, y] = wrapPt(p.x, p.y);
    const fillOnce = (fx) => {
      if (!st.sel) { floodFill(cel, s.width, s.height, fx, y, color, !e.shiftKey); return; }
      const t = cel.slice();
      floodFill(t, s.width, s.height, fx, y, color, !e.shiftKey);
      for (let i = 0; i < st.sel.mask.length; i++) if (st.sel.mask[i]) cel.set(t.subarray(i * 4, i * 4 + 4), i * 4);
    };
    fillOnce(x);
    if (st.mirror) fillOnce(s.width - 1 - x);
    invalidate(st.frame);
    endStroke();
    return;
  } else if (SHAPES.includes(tool)) shapeUpdate(p, e.shiftKey);
  invalidate(st.frame);
  scheduleDraw();
}

function continueStroke(p, e) {
  const k = st.stroke, s = st.sprite;
  if (k.tool === 'select') {
    k.moved ||= p.x !== k.start.x || p.y !== k.start.y;
  } else if (k.tool === 'lasso') {
    const last = k.pts[k.pts.length - 1];
    if (last.x !== p.x || last.y !== p.y) k.pts.push(p);
  } else if (k.tool === 'movefloat') {
    st.float.x = k.fx + p.x - k.start.x;
    st.float.y = k.fy + p.y - k.start.y;
    updateSelPath();
  } else if (FREEHAND.includes(k.tool)) {
    freehandTo(p);
  } else if (SHAPES.includes(k.tool)) {
    shapeUpdate(p, e.shiftKey);
  } else if (k.tool === 'move') {
    const dx = p.x - k.start.x, dy = p.y - k.start.y;
    k.cel.fill(0);
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        const c = st.tiling ? getPx(k.orig, s.width, s.height, mod(x - dx, s.width), mod(y - dy, s.height)) : getPx(k.orig, s.width, s.height, x - dx, y - dy);
        if (c) setPx(k.cel, s.width, s.height, x, y, c);
      }
    }
  }
  k.last = p;
  if (k.cel) invalidate(k.frame);
  scheduleDraw();
}

function endStroke() {
  const k = st.stroke;
  st.stroke = null;
  if (!k) return;
  if (k.tool === 'select' || k.tool === 'lasso') { finishSelection(k, k.last); drainQueue(); return; }
  if (k.tool === 'movefloat') { postEditorState(); drainQueue(); return; }
  const changes = sendDiff(k.frame, k.layer, k.orig, k.cel);
  if (changes) scheduleTimeline();
  drainQueue(changes && { frame: k.frame, layer: k.layer, changes });
}

cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('pointerdown', (e) => {
  if (!st.sprite) return;
  cv.setPointerCapture(e.pointerId);
  if (e.button === 1 || st.spaceDown) {
    st.pan = { sx: e.clientX, sy: e.clientY, px: st.panX, py: st.panY };
    cv.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0 && e.button !== 2) return;
  const p = toPx(e);
  if (e.altKey || st.tool === 'picker') { pick(p, e.button); return; }
  beginStroke(p, e);
});
cv.addEventListener('pointermove', (e) => {
  if (!st.sprite) return;
  if (st.pan) {
    st.panX = st.pan.px + e.clientX - st.pan.sx;
    st.panY = st.pan.py + e.clientY - st.pan.sy;
    st.autoFit = false;
    scheduleDraw();
    return;
  }
  const p = toPx(e);
  if (!st.hover || st.hover.x !== p.x || st.hover.y !== p.y) {
    st.hover = p;
    renderStatus();
    scheduleDraw();
    if (st.stroke) continueStroke(p, e);
  }
});
cv.addEventListener('pointerup', () => {
  if (st.pan) { st.pan = null; cv.style.cursor = st.spaceDown ? 'grab' : 'crosshair'; return; }
  endStroke();
});
cv.addEventListener('pointerleave', () => { st.hover = null; renderStatus(); scheduleDraw(); });
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  zoomStep(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

// ---------------------------------------------------------------- panels

function renderSpriteSelect() {
  const sel = $('spriteSelect');
  sel.innerHTML = '';
  for (const s of st.list) {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = `${s.name}  (${s.width}×${s.height}, ${s.frames} кадр.)`;
    sel.append(o);
  }
  if (st.sprite) sel.value = st.sprite.id;
}

function renderColors() {
  const sw = (el, c) => { el.style.boxShadow = `inset 0 0 0 40px ${rgbaCss(c)}`; el.classList.add('checker'); };
  sw($('primary'), st.primary);
  sw($('secondary'), st.secondary);
  $('alpha').value = st.primary[3];
  renderPalette();
  postEditorState();
}

function renderPalette() {
  const box = $('palette');
  box.innerHTML = '';
  if (!st.sprite) return;
  const cur = toHex(st.primary);
  st.sprite.palette.forEach((hex, i) => {
    const b = document.createElement('button');
    b.style.background = hex;
    b.title = `p${i} ${hex}`;
    b.dataset.i = i;
    if (hex === cur) b.classList.add('sel');
    box.append(b);
  });
}

$('palette').addEventListener('click', (e) => {
  const i = e.target.dataset.i;
  if (i === undefined) return;
  const pal = st.sprite.palette;
  if (e.shiftKey) { op('set_palette', { colors: pal.filter((_, k) => k !== +i) }); return; }
  st.primary = hexToRgba(pal[i]);
  renderColors();
});
$('palette').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const i = e.target.dataset.i;
  if (i === undefined) return;
  st.secondary = hexToRgba(st.sprite.palette[i]);
  renderColors();
});

function celHasPixels(cel) {
  for (let i = 3; i < cel.length; i += 4) if (cel[i]) return true;
  return false;
}

function renderTimeline() {
  const s = st.sprite, box = $('timeline');
  if (!s) { box.innerHTML = ''; return; }
  const nf = s.frames.length;
  let html = '<table class="tl-table"><thead>';
  if (s.tags.length) {
    html += '<tr class="tags-row"><th class="lname"></th>';
    for (let f = 0; f < nf;) {
      const t = s.tags.find((x) => x.from === f);
      if (t) {
        const span = t.to - t.from + 1;
        html += `<th colspan="${span}"><div class="tagbar" data-tag="${s.tags.indexOf(t)}" style="background:${t.color}" title="${escapeHtml(t.name)}: ${t.from}–${t.to} (двойной клик — изменить)">${escapeHtml(t.name)}</div></th>`;
        f += span;
      } else { html += '<th></th>'; f++; }
    }
    html += '</tr>';
  }
  html += '<tr><th class="lname">Слой \\ кадр</th>';
  for (let f = 0; f < nf; f++) {
    html += `<th class="fhead${f === st.frame ? ' cur' : ''}" data-frame="${f}" title="Двойной клик — длительность"><canvas width="32" height="32" data-thumb="${f}"></canvas>${f}<small>${s.frames[f].duration}ms</small></th>`;
  }
  html += '</tr></thead><tbody>';
  for (let l = s.layers.length - 1; l >= 0; l--) {
    const L = s.layers[l];
    html += `<tr class="${l === st.layer ? 'curlayer' : ''}"><th class="lname"><div class="lrow">`
      + `<button class="eye${L.visible ? '' : ' off'}" data-eye="${l}" title="Видимость">👁</button>`
      + `<span class="nm" data-layer="${l}" title="Двойной клик — переименовать">${l}: ${escapeHtml(L.name)}</span>`
      + `<span class="op" data-opacity="${l}" title="Непрозрачность (двойной клик)">${Math.round(L.opacity * 100)}%</span></div></th>`;
    for (let f = 0; f < nf; f++) {
      const cls = f === st.frame && l === st.layer ? 'cel cur' : f === st.frame ? 'cel curcol' : 'cel';
      html += `<td class="${cls}" data-cel="${f},${l}"><i class="${celHasPixels(s.frames[f].cels[l]) ? 'full' : ''}"></i></td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  const scroll = box.scrollLeft;
  box.innerHTML = html;
  box.scrollLeft = scroll;
  for (const c of box.querySelectorAll('canvas[data-thumb]')) {
    const f = +c.dataset.thumb, x = c.getContext('2d');
    const k = Math.min(32 / s.width, 32 / s.height);
    x.imageSmoothingEnabled = false;
    x.drawImage(imageToTmp(compositeFrame(f), s.width, s.height), (32 - s.width * k) / 2, (32 - s.height * k) / 2, s.width * k, s.height * k);
  }
}

function selectCel(frame, layer) {
  if (frame !== st.frame || layer !== st.layer) commitFloat();
  st.frame = frame;
  st.layer = layer;
  renderAll();
}

$('timeline').addEventListener('click', (e) => {
  const t = e.target.closest('[data-frame],[data-cel],[data-eye],[data-layer],[data-tag]');
  if (!t || !st.sprite) return;
  if (t.dataset.eye !== undefined) {
    const l = +t.dataset.eye;
    op('update_layer', { layer: l, visible: !st.sprite.layers[l].visible });
    return;
  }
  if (t.dataset.tag !== undefined) {
    st.previewTag = st.sprite.tags[+t.dataset.tag].name;
    renderPreviewTags();
    return;
  }
  let { frame, layer } = st;
  if (t.dataset.frame !== undefined) frame = +t.dataset.frame;
  if (t.dataset.layer !== undefined) layer = +t.dataset.layer;
  if (t.dataset.cel) [frame, layer] = t.dataset.cel.split(',').map(Number);
  selectCel(frame, layer);
});

$('timeline').addEventListener('dblclick', async (e) => {
  const s = st.sprite;
  const t = e.target.closest('[data-frame],[data-layer],[data-opacity],[data-tag]');
  if (!t || !s) return;
  if (t.dataset.frame !== undefined) {
    const f = +t.dataset.frame;
    const r = await formDialog({
      title: `Длительность кадра ${f}`,
      fields: [
        { name: 'duration', label: 'Миллисекунды', type: 'number', min: 10, value: s.frames[f].duration },
        { name: 'all', label: 'Применить ко всем кадрам', type: 'checkbox' },
      ],
    });
    if (r) op('set_frame_duration', { duration: r.duration, ...(r.all ? {} : { frame: f }) });
  } else if (t.dataset.layer !== undefined) {
    const l = +t.dataset.layer;
    const r = await formDialog({ title: 'Слой', fields: [{ name: 'name', label: 'Имя', value: s.layers[l].name, wide: true, required: true }] });
    if (r) op('update_layer', { layer: l, name: r.name });
  } else if (t.dataset.opacity !== undefined) {
    const l = +t.dataset.opacity;
    const r = await formDialog({ title: `Непрозрачность слоя «${s.layers[l].name}»`, fields: [{ name: 'v', label: '%', type: 'number', min: 0, max: 100, value: Math.round(s.layers[l].opacity * 100) }] });
    if (r) op('update_layer', { layer: l, opacity: clamp(r.v, 0, 100) / 100 });
  } else if (t.dataset.tag !== undefined) {
    const i = +t.dataset.tag;
    const r = await tagDialog('Тег анимации', s.tags[i], 'Удалить');
    if (!r) return;
    const tags = s.tags.filter((_, k) => k !== i);
    if (r._action === 'ok') tags.push({ name: r.name, from: r.from, to: r.to, color: r.color });
    op('set_tags', { tags });
  }
});

function tagDialog(title, tag, extra) {
  const n = st.sprite.frames.length - 1;
  return formDialog({
    title, extra,
    fields: [
      { name: 'name', label: 'Имя', value: tag.name, wide: true, required: true },
      { name: 'from', label: 'С кадра', type: 'number', min: 0, max: n, value: tag.from },
      { name: 'to', label: 'По кадр', type: 'number', min: 0, max: n, value: tag.to },
      { name: 'color', label: 'Цвет', type: 'color', value: tag.color },
    ],
  });
}

function renderPreviewTags() {
  const sel = $('previewTag');
  const tags = st.sprite?.tags || [];
  sel.innerHTML = '<option value="">все кадры</option>' + tags.map((t) => `<option>${escapeHtml(t.name)}</option>`).join('');
  if (!tags.some((t) => t.name === st.previewTag)) st.previewTag = '';
  sel.value = st.previewTag;
}

function previewFrames() {
  const s = st.sprite;
  const t = s.tags.find((x) => x.name === st.previewTag);
  const out = [];
  for (let i = t ? t.from : 0; i <= (t ? t.to : s.frames.length - 1); i++) out.push(i);
  return out;
}

function drawPreview() {
  const s = st.sprite, c = $('preview');
  if (!s) { c.width = c.height = 1; return; }
  const box = c.parentElement, bw = box.clientWidth - 4, bh = box.clientHeight - 4;
  const k = Math.max(1, Math.floor(Math.min(bw / s.width, bh / s.height)));
  if (c.width !== s.width * k || c.height !== s.height * k) { c.width = s.width * k; c.height = s.height * k; }
  // Sprites bigger than the box are shown scaled down instead of overflowing the panel.
  const fitK = Math.min(1, bw / c.width, bh / c.height);
  c.style.width = `${c.width * fitK}px`;
  c.style.height = `${c.height * fitK}px`;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.clearRect(0, 0, c.width, c.height);
  x.fillStyle = checker;
  x.fillRect(0, 0, c.width, c.height);
  const f = st.playing ? clamp(st.previewFrame, 0, s.frames.length - 1) : st.frame;
  x.drawImage(imageToTmp(compositeFrame(f), s.width, s.height), 0, 0, c.width, c.height);
}

let playTimer = null;
function togglePlay(force) {
  st.playing = force ?? !st.playing;
  $('btnPlay').textContent = st.playing ? '⏸' : '▶';
  clearTimeout(playTimer);
  if (!st.playing || !st.sprite) { scheduleDraw(); return; }
  let i = 0;
  const tick = () => {
    if (!st.playing || !st.sprite) return;
    const list = previewFrames();
    i %= list.length;
    st.previewFrame = list[i];
    drawPreview();
    playTimer = setTimeout(tick, st.sprite.frames[list[i]]?.duration || 100);
    i++;
  };
  tick();
}

function renderStatus() {
  const s = st.sprite;
  if (!s) { $('status').textContent = ''; return; }
  let txt = `${s.width}×${s.height} · кадр ${st.frame}/${s.frames.length - 1} · слой ${st.layer}: ${s.layers[st.layer].name}`;
  const m = selMask(), b = m && maskBounds(m, s.width, s.height);
  if (b) txt = `выделение ${b.w}×${b.h} @${b.x},${b.y}${st.float ? ' (плавающее)' : ''} · ` + txt;
  if (st.hover) {
    const [x, y] = wrapPt(st.hover.x, st.hover.y);
    if (x >= 0 && y >= 0 && x < s.width && y < s.height) txt = `x ${x}, y ${y} · ${toHex(getPx(compositeFrame(st.frame), s.width, s.height, x, y))} · ` + txt;
  }
  $('status').textContent = txt;
}

function renderButtons() {
  const s = st.sprite;
  $('btnUndo').disabled = !s?.canUndo;
  $('btnRedo').disabled = !s?.canRedo;
  for (const t of document.querySelectorAll('#toolset button')) t.classList.toggle('active', t.dataset.tool === st.tool);
  $('tglGrid').classList.toggle('on', st.grid);
  $('tglOnion').classList.toggle('on', st.onion);
  $('tglMirror').classList.toggle('on', st.mirror);
  $('tglPerfect').classList.toggle('on', st.perfect);
  $('tglTiling').classList.toggle('on', st.tiling);
  $('tglFollow').classList.toggle('on', st.follow);
  $('tglFillShapes').classList.toggle('on', st.fillShapes);
  $('brushSize').value = st.brush;
}

function renderAll() {
  renderSpriteSelect();
  renderTimeline();
  renderPreviewTags();
  renderColors();
  renderButtons();
  renderStatus();
  renderRefControls();
  scheduleDraw();
}

let stateTimer = null;
function postEditorState() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => {
    const s = st.sprite, m = selMask();
    fetch('/api/editor-state', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sprite: s?.id ?? null, frame: st.frame, layer: st.layer, tool: st.tool,
        primary: toHex(st.primary), secondary: toHex(st.secondary), zoom: st.zoom,
        selection: s && m ? maskBounds(m, s.width, s.height) : null, floating: !!st.float,
      }),
    }).catch(() => {});
  }, 50);
}

// ---------------------------------------------------------------- live updates

let badgeTimer = null;
function showClaude() {
  $('claudeBadge').classList.add('show');
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => $('claudeBadge').classList.remove('show'), 1500);
}

function onRemote(kind, ev) {
  const id = kind === 'cels' ? ev.id : ev.sprite.id;
  if (ev.source === 'mcp') {
    showClaude();
    log(`${ev.op} → ${kind === 'sprite' ? ev.sprite.name : id}${isInt(ev.frame) ? ` [кадр ${ev.frame}]` : ''}`, 'mcp');
  }
  if (!st.sprite || st.sprite.id !== id) {
    if (ev.source === 'mcp' && st.follow && !st.stroke) openSprite(id, isInt(ev.frame) ? +ev.frame : 0);
    return;
  }
  if (st.stroke || st.resyncing) { st.queue.push([kind, ev]); return; }
  applyRemote(kind, ev);
}

function applyRemote(kind, ev) {
  const s = st.sprite;
  const rev = kind === 'cels' ? ev.rev : ev.sprite.rev;
  if (rev <= s.rev) return;
  const follow = ev.source === 'mcp' && st.follow;
  if (kind === 'sprite') {
    if (follow && isInt(ev.frame)) st.frame = +ev.frame;
    if (follow && isInt(ev.layer)) st.layer = +ev.layer;
    setSprite(ev.sprite, { keepView: true });
    return;
  }
  if (rev !== s.rev + 1) { resync(); return; }
  for (const c of ev.cels) {
    const cel = s.frames[c.f]?.cels[c.l];
    const data = b64ToBytes(c.data);
    if (!cel || cel.length !== data.length) { resync(); return; }
    cel.set(data);
    invalidate(c.f);
  }
  s.rev = rev;
  s.canUndo = ev.canUndo;
  s.canRedo = ev.canRedo;
  if (follow && isInt(ev.frame) && +ev.frame < s.frames.length) st.frame = +ev.frame;
  if (follow && isInt(ev.layer) && +ev.layer < s.layers.length) st.layer = +ev.layer;
  renderButtons();
  renderStatus();
  scheduleTimeline();
}

// Applies events queued during a stroke; our own just-sent pixels are re-applied on top so they don't flicker.
function drainQueue(own) {
  const q = st.queue;
  st.queue = [];
  for (const [kind, ev] of q) {
    if (st.resyncing) { st.queue.push([kind, ev]); continue; }
    applyRemote(kind, ev);
  }
  if (own && q.length && st.sprite) {
    const cel = st.sprite.frames[own.frame]?.cels[own.layer];
    if (cel) {
      for (let k = 0; k < own.changes.length; k += 2) {
        const i = own.changes[k] * 4, c = own.changes[k + 1];
        cel[i] = c >>> 24; cel[i + 1] = (c >>> 16) & 255; cel[i + 2] = (c >>> 8) & 255; cel[i + 3] = c & 255;
      }
      invalidate(own.frame);
      scheduleDraw();
    }
  }
}

function connect() {
  const es = new EventSource('/api/events');
  es.onopen = () => {
    $('conn').classList.add('on');
    if (st.sprite) resync();
  };
  es.onerror = () => $('conn').classList.remove('on');
  es.addEventListener('hello', (e) => {
    const { build } = JSON.parse(e.data);
    // The server was restarted with new code: reload to get the matching editor.
    if (st.build && st.build !== build && !st.stroke) { commitFloat(); location.reload(); }
    st.build = build;
  });
  es.addEventListener('list', (e) => {
    st.list = JSON.parse(e.data);
    renderSpriteSelect();
    if (!st.sprite && st.list.length) openSprite(st.list[0].id);
    scheduleDraw();
  });
  es.addEventListener('sprite', (e) => onRemote('sprite', JSON.parse(e.data)));
  es.addEventListener('cels', (e) => onRemote('cels', JSON.parse(e.data)));
  es.addEventListener('removed', (e) => {
    const { id } = JSON.parse(e.data);
    if (st.sprite?.id !== id) return;
    st.sprite = null;
    st.sel = st.float = null;
    selPath = null;
    const next = st.list.find((s) => s.id !== id);
    if (next) openSprite(next.id); else renderAll();
  });
  es.addEventListener('focus', (e) => {
    const { id, frame, layer } = JSON.parse(e.data);
    openSprite(id, frame).then(() => { if (isInt(layer)) { st.layer = +layer; renderAll(); } });
  });
}

// ---------------------------------------------------------------- UI wiring

$('spriteSelect').addEventListener('change', (e) => openSprite(e.target.value));

async function newSpriteDialog() {
  const sizes = [16, 24, 32, 48, 64, 96, 128];
  const r = await formDialog({
    title: 'Новый спрайт', ok: 'Создать',
    fields: [
      { name: 'name', label: 'Имя', value: 'sprite', wide: true, required: true },
      {
        name: 'size', label: 'Размер', type: 'select', value: '32', options: [...sizes.map((n) => [String(n), `${n}×${n}`]), ['custom', 'свой']],
        onchange: (el, all) => { if (el.value !== 'custom') { all.width.value = el.value; all.height.value = el.value; } },
      },
      { name: 'width', label: 'Ширина', type: 'number', min: 1, max: 1024, value: 32 },
      { name: 'height', label: 'Высота', type: 'number', min: 1, max: 1024, value: 32 },
      { name: 'frames', label: 'Кадров', type: 'number', min: 1, max: 256, value: 1 },
    ],
  });
  if (!r) return;
  try {
    const s = await api('/sprites', { body: { name: r.name, width: r.width, height: r.height, frames: r.frames } });
    await openSprite(s.id);
  } catch (e) { log(`Ошибка: ${e.message}`, 'err'); }
}
$('btnNew').onclick = newSpriteDialog;
$('btnNewEmpty').onclick = newSpriteDialog;

$('btnDuplicate').onclick = async () => {
  if (!st.sprite) return;
  const s = await api(`/sprites/${enc(st.sprite.id)}/duplicate`, { body: {} });
  openSprite(s.id);
};
$('btnRename').onclick = async () => {
  if (!st.sprite) return;
  const r = await formDialog({ title: 'Переименовать спрайт', fields: [{ name: 'name', label: 'Имя', value: st.sprite.name, wide: true, required: true }] });
  if (r) op('rename', { name: r.name });
};
$('btnResize').onclick = async () => {
  const s = st.sprite;
  if (!s) return;
  const anchors = [['center', 'центр'], ['top-left', 'верх-лево'], ['top', 'верх'], ['top-right', 'верх-право'], ['left', 'лево'], ['right', 'право'], ['bottom-left', 'низ-лево'], ['bottom', 'низ'], ['bottom-right', 'низ-право']];
  const r = await formDialog({
    title: 'Размер', ok: 'Применить',
    fields: [
      { name: 'mode', label: 'Что менять', type: 'select', value: 'canvas', options: [['canvas', 'холст (пиксели не масштабируются)'], ['scale', 'масштаб изображения']], wide: true },
      { name: 'width', label: 'Ширина', type: 'number', min: 1, max: 1024, value: s.width },
      { name: 'height', label: 'Высота', type: 'number', min: 1, max: 1024, value: s.height },
      { name: 'anchor', label: 'Привязка', type: 'select', value: 'center', options: anchors },
    ],
  });
  if (!r) return;
  commitFloat();
  op(r.mode === 'scale' ? 'scale_sprite' : 'resize_canvas', { width: r.width, height: r.height, anchor: r.anchor });
};
$('btnHistory').onclick = async () => {
  if (!st.sprite) return;
  const list = await api(`/sprites/${enc(st.sprite.id)}/backups`);
  if (!list.length) { await formDialog({ title: 'История версий', text: 'Автосохранений пока нет: они делаются не чаще раза в 2 минуты при изменениях.' }); return; }
  const label = (f) => f.replace(/\.json$/, '').replace(/^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d).*$/, '$1 $2:$3:$4 UTC');
  const r = await formDialog({
    title: 'История версий', text: 'Восстановление можно отменить через Ctrl+Z.', ok: 'Восстановить',
    fields: [{ name: 'file', label: 'Версия', type: 'select', value: list[0], options: list.map((f) => [f, label(f)]), wide: true }],
  });
  if (!r) return;
  commitFloat();
  try { await api(`/sprites/${enc(st.sprite.id)}/backups`, { body: { file: r.file } }); } catch (e) { log(`Ошибка: ${e.message}`, 'err'); }
};
$('btnDelete').onclick = async () => {
  if (!st.sprite || !(await confirmDialog('Удалить спрайт?', `«${st.sprite.name}» будет перемещён в data/trash.`, 'Удалить'))) return;
  await api(`/sprites/${enc(st.sprite.id)}`, { method: 'DELETE' });
};
function undo() { commitFloat(); op('undo'); }
function redo() { commitFloat(); op('redo'); }
$('btnUndo').onclick = undo;
$('btnRedo').onclick = redo;
$('btnZoomIn').onclick = () => zoomStep(1);
$('btnZoomOut').onclick = () => zoomStep(-1);
$('btnFit').onclick = fit;
const toggle = (key) => () => { st[key] = !st[key]; renderButtons(); scheduleDraw(); };
$('tglGrid').onclick = toggle('grid');
$('tglOnion').onclick = toggle('onion');
$('tglMirror').onclick = toggle('mirror');
$('tglPerfect').onclick = toggle('perfect');
$('tglTiling').onclick = toggle('tiling');
$('tglFollow').onclick = toggle('follow');
$('tglFillShapes').onclick = toggle('fillShapes');
$('brushSize').onchange = (e) => { st.brush = clamp(+e.target.value || 1, 1, 16); renderButtons(); };
$('toolset').onclick = (e) => { const t = e.target.closest('[data-tool]'); if (t) setTool(t.dataset.tool); };

function setTool(t) {
  if (t !== 'move' && t !== 'select' && t !== 'lasso') commitFloat();
  st.tool = t;
  renderButtons();
  postEditorState();
  scheduleDraw();
}

let colorTarget = 'primary';
$('primary').onclick = () => { colorTarget = 'primary'; $('colorInput').value = toHex([...st.primary.slice(0, 3), 255]); $('colorInput').click(); };
$('secondary').onclick = () => { colorTarget = 'secondary'; $('colorInput').value = toHex([...st.secondary.slice(0, 3), 255]); $('colorInput').click(); };
$('colorInput').addEventListener('input', (e) => {
  const c = hexToRgba(e.target.value);
  const a = st[colorTarget][3] || 255;
  st[colorTarget] = [c[0], c[1], c[2], a];
  renderColors();
});
$('alpha').addEventListener('input', (e) => { st.primary = [...st.primary.slice(0, 3), +e.target.value]; renderColors(); });
$('btnSwap').onclick = () => { [st.primary, st.secondary] = [st.secondary, st.primary]; renderColors(); };
$('btnAddColor').onclick = () => {
  if (!st.sprite) return;
  const hex = toHex(st.primary);
  if (hex === 'transparent' || st.sprite.palette.includes(hex)) return;
  op('set_palette', { colors: [...st.sprite.palette, hex] });
};
$('btnRamp').onclick = async () => {
  if (!st.sprite || !st.primary[3]) return;
  const r = await formDialog({
    title: 'Рампа из основного цвета', text: 'Тени уходят в синий/фиолетовый, блики — в жёлтый.', ok: 'Добавить в палитру',
    fields: [
      { name: 'steps', label: 'Цветов', type: 'number', min: 2, max: 9, value: 5 },
      { name: 'hue', label: 'Сдвиг тона, °', type: 'number', min: 0, max: 90, value: 20 },
      { name: 'contrast', label: 'Контраст', type: 'number', min: 0.2, max: 2, step: 0.1, value: 1 },
    ],
  });
  if (!r) return;
  const ramp = makeRamp(toHex([...st.primary.slice(0, 3), 255]), { steps: r.steps, hueShift: r.hue, contrast: r.contrast });
  op('set_palette', { colors: [...st.sprite.palette, ...ramp.filter((c) => !st.sprite.palette.includes(c))] });
};
$('palettePreset').onchange = (e) => {
  const v = e.target.value;
  e.target.value = '';
  if (!st.sprite || !v) return;
  if (v === 'extract') {
    const set = new Set();
    for (const f of st.sprite.frames) for (const cel of f.cels) {
      for (let i = 0; i < cel.length; i += 4) if (cel[i + 3]) set.add(toHex([cel[i], cel[i + 1], cel[i + 2], cel[i + 3]]));
    }
    op('set_palette', { colors: [...set].slice(0, 128) });
  } else op('set_palette', { colors: PRESETS[v] });
};

$('btnRefLoad').onclick = () => $('refInput').click();
$('refInput').onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !st.sprite) return;
  const id = st.sprite.id;
  const r = new FileReader();
  r.onload = () => setRef(id, r.result, st.refs.get(id) || {});
  r.readAsDataURL(file);
};
$('btnRefClear').onclick = () => {
  if (!st.sprite) return;
  st.refs.delete(st.sprite.id);
  store.del(`pf-ref:${st.sprite.id}`);
  store.del(`pf-refopts:${st.sprite.id}`);
  renderRefControls();
  scheduleDraw();
};
const refOpt = (key, value) => {
  const r = st.sprite && st.refs.get(st.sprite.id);
  if (!r) return;
  r[key] = value;
  saveRefOpts(st.sprite.id);
  scheduleDraw();
};
$('refOpacity').oninput = (e) => refOpt('opacity', +e.target.value / 100);
$('refAbove').onchange = (e) => refOpt('above', e.target.checked);
$('refShow').onchange = (e) => refOpt('show', e.target.checked);

$('previewTag').onchange = (e) => { st.previewTag = e.target.value; if (st.playing) togglePlay(true); };
$('btnPlay').onclick = () => togglePlay();

async function structural(name, args, after) {
  commitFloat();
  const r = await op(name, args);
  if (r && after) { after(r); renderAll(); }
  return r;
}
$('btnLayerAdd').onclick = () => structural('add_layer', { index: st.layer + 1 }, (r) => { st.layer = r.layer; });
$('btnLayerDel').onclick = async () => {
  if (await confirmDialog('Удалить слой?', `Слой «${st.sprite.layers[st.layer].name}» во всех кадрах. Можно отменить Ctrl+Z.`, 'Удалить')) structural('delete_layer', { layer: st.layer });
};
$('btnLayerUp').onclick = () => { if (st.layer < st.sprite.layers.length - 1) structural('move_layer', { layer: st.layer, to: st.layer + 1 }, () => { st.layer++; }); };
$('btnLayerDown').onclick = () => { if (st.layer > 0) structural('move_layer', { layer: st.layer, to: st.layer - 1 }, () => { st.layer--; }); };
$('btnLayerMerge').onclick = () => { if (st.layer > 0) structural('merge_down', { layer: st.layer }, () => { st.layer--; }); };
$('btnFrameAdd').onclick = () => structural('add_frame', { index: st.frame + 1 }, () => { st.frame++; });
$('btnFrameDup').onclick = duplicateFrame;
function duplicateFrame() { return structural('add_frame', { index: st.frame + 1, copy_from: st.frame }, () => { st.frame++; }); }
$('btnFrameDel').onclick = () => structural('delete_frame', { frame: st.frame });
$('btnFrameLeft').onclick = () => { if (st.frame > 0) structural('move_frame', { frame: st.frame, to: st.frame - 1 }, () => { st.frame--; }); };
$('btnFrameRight').onclick = () => { if (st.frame < st.sprite.frames.length - 1) structural('move_frame', { frame: st.frame, to: st.frame + 1 }, () => { st.frame++; }); };
$('btnDuration').onclick = async () => {
  const r = await formDialog({ title: 'Длительность всех кадров', fields: [{ name: 'duration', label: 'Миллисекунды', type: 'number', min: 10, value: st.sprite.frames[st.frame].duration }] });
  if (r) op('set_frame_duration', { duration: r.duration });
};
$('btnTag').onclick = async () => {
  const s = st.sprite;
  const r = await tagDialog('Новый тег анимации', { name: 'anim', from: st.frame, to: s.frames.length - 1, color: TAG_COLORS[s.tags.length % TAG_COLORS.length] });
  if (r) op('set_tags', { tags: [...s.tags, { name: r.name, from: r.from, to: r.to, color: r.color }] });
};

$('btnExport').onclick = (e) => { e.stopPropagation(); $('exportMenu').classList.toggle('open'); };
document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) $('exportMenu').classList.remove('open'); });
$('exportMenu').addEventListener('click', (e) => {
  const kind = e.target.dataset.export;
  if (!kind || !st.sprite) return;
  commitFloat();
  const sc = $('exportScale').value, id = enc(st.sprite.id);
  const tag = st.previewTag ? `&tag=${enc(st.previewTag)}` : '';
  const url = {
    frame: `/api/sprites/${id}/frame.png?frame=${st.frame}&scale=${sc}&download=1`,
    sheet: `/api/sprites/${id}/sheet.png?scale=${sc}&download=1${tag}`,
    json: `/api/sprites/${id}/sheet.json?scale=${sc}${tag}`,
    anim: `/api/sprites/${id}/anim.png?scale=${sc}&download=1${tag}`,
    gif: `/api/sprites/${id}/anim.gif?scale=${sc}&download=1${tag}`,
  }[kind];
  const a = document.createElement('a');
  a.href = url;
  a.download = kind === 'json' ? `${st.sprite.id}_sheet.json` : '';
  a.click();
  $('exportMenu').classList.remove('open');
});

// Import PNG via button or drag & drop.
async function importFile(file) {
  if (!file || file.type !== 'image/png') { log('Импорт: поддерживается только PNG', 'err'); return; }
  const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(file); });
  const r = await formDialog({
    title: 'Импорт PNG', text: 'Чтобы нарезать спрайт-лист на кадры, укажите размер кадра. Оставьте 0, чтобы импортировать картинку целиком.', ok: 'Импортировать',
    fields: [
      { name: 'name', label: 'Имя', value: file.name.replace(/\.png$/i, ''), wide: true },
      { name: 'fw', label: 'Ширина кадра', type: 'number', min: 0, value: 0 },
      { name: 'fh', label: 'Высота кадра', type: 'number', min: 0, value: 0 },
    ],
  });
  if (!r) return;
  try {
    const s = await api('/import', { body: { name: r.name, png_base64: b64, frame_width: r.fw || undefined, frame_height: r.fh || undefined } });
    openSprite(s.id);
  } catch (e) { log(`Импорт: ${e.message}`, 'err'); }
}
$('btnImport').onclick = () => $('fileInput').click();
$('fileInput').onchange = (e) => { importFile(e.target.files[0]); e.target.value = ''; };
window.addEventListener('dragover', (e) => { e.preventDefault(); $('dropHint').classList.add('show'); });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('dropHint').classList.remove('show'); });
window.addEventListener('drop', (e) => { e.preventDefault(); $('dropHint').classList.remove('show'); importFile(e.dataTransfer.files[0]); });

const KEYS = { b: 'pencil', e: 'eraser', g: 'fill', i: 'picker', l: 'line', u: 'rect', o: 'ellipse', v: 'move', s: 'select', q: 'lasso', d: 'dither', h: 'shade' };
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, dialog')) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    const map = {
      z: () => (e.shiftKey ? redo() : undo()), y: redo, c: copySelection, x: () => { copySelection(); deleteSelection(); },
      v: paste, a: selectAll, d: deselect,
    };
    if (map[k] && st.sprite) { e.preventDefault(); map[k](); }
    return;
  }
  if (e.code === 'Space') { st.spaceDown = true; cv.style.cursor = 'grab'; e.preventDefault(); return; }
  if (!st.sprite) return;
  if (e.altKey && k === 'n') { e.preventDefault(); duplicateFrame(); return; }
  if (e.shiftKey && (k === 'h' || k === 'v') && (st.sel || st.float)) { flipSelection(k === 'v'); e.preventDefault(); return; }
  if (KEYS[k] && !e.altKey) setTool(KEYS[k]);
  else if (k === 'x') { [st.primary, st.secondary] = [st.secondary, st.primary]; renderColors(); }
  else if (k === 'm') $('tglMirror').click();
  else if (k === 'k') $('tglOnion').click();
  else if (k === 'p') $('tglPerfect').click();
  else if (k === 't') $('tglTiling').click();
  else if (e.key === '#') $('tglGrid').click();
  else if (e.key === 'Escape') deselect();
  else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
  else if (e.key === '[') { st.brush = Math.max(1, st.brush - 1); renderButtons(); scheduleDraw(); }
  else if (e.key === ']') { st.brush = Math.min(16, st.brush + 1); renderButtons(); scheduleDraw(); }
  else if (e.key === 'ArrowLeft' || e.key === ',') selectCel((st.frame - 1 + st.sprite.frames.length) % st.sprite.frames.length, st.layer);
  else if (e.key === 'ArrowRight' || e.key === '.') selectCel((st.frame + 1) % st.sprite.frames.length, st.layer);
  else if (e.key === 'ArrowUp') selectCel(st.frame, Math.min(st.sprite.layers.length - 1, st.layer + 1));
  else if (e.key === 'ArrowDown') selectCel(st.frame, Math.max(0, st.layer - 1));
  else if (e.key === 'Enter') { if (st.float) commitFloat(); else togglePlay(); }
  else if (e.key === '+' || e.key === '=') zoomStep(1);
  else if (e.key === '-') zoomStep(-1);
  else if (e.key === '0') fit();
  else return;
  e.preventDefault();
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') { st.spaceDown = false; cv.style.cursor = 'crosshair'; } });
window.addEventListener('blur', () => { st.spaceDown = false; });

new ResizeObserver(resizeCanvas).observe(stage);
renderAll();
connect();
