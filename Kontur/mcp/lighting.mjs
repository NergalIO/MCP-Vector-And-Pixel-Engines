// Отложенное освещение 2.5D-сцен Kontur (перенос Tools/scene_sketch/render.py на JS, typed arrays).
// Проходы renderSVG (color, normal, plane, planeD, emissive, ink, mask:<метка>, cover) → позиции пикселей по
// плоскостям и лучу камеры → солнце с тенями (лучи по коробкам и треугольникам), полусфера, SSAO, лампы (+тени),
// блики, свечение, туман, небо, bloom, ACES → стиль (cel, штриховка, Кувахара, пиксели+Байер, контур, виньетка).
import { renderSVG, collectLights, parseColor } from '../engine/kontur.js';
import { svgToPng, upscaleNearest, mapLimit } from './render.mjs';
import { decodePNG, encodePNG, sideBySide, scaleDown } from './normals.mjs';

/* ============================== параметры ============================== */
const nz = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
/** Пресеты света и стиля (значения — как в эскизах сцены C). Цвета света — доли 0..1 (hex = доля·255, без гаммы). */
export const LIGHT_PRESETS = {
  day: {
    title: 'Рисованный день',
    lighting: { sun: { dir: nz([-0.62, 0.6, -0.3]), color: [1, 0.92, 0.78], energy: 1.55, wrap: 0.25, shadows: true }, sky: { color: [0.48, 0.58, 0.85], energy: 0.6 }, ground: { color: [0.55, 0.42, 0.3], energy: 0.3 },
      ao: { strength: 0.9, radius: 0.9 }, groups: { lamp: 0, window: 0, candle: 0 }, emissive: 0.25, specular: 0.35, bloom: { strength: 0.15, threshold: 0.9 },
      fog: { color: [0.85, 0.82, 0.9], density: 0.012, start: 6, amount: 0.6 }, exposure: 1, saturation: 1.08, tonemap: 'aces', lightShadows: false, backdrop: { mode: 'albedo' } },
    style: [{ type: 'kuwahara', radius: 3 }, { type: 'ink', strength: 0.32, color: [0.25, 0.15, 0.12] }, { type: 'vignette', strength: 0.22 }],
  },
  comic: {
    title: 'Комикс на закате',
    lighting: { sun: { dir: nz([-0.86, 0.3, -0.42]), color: [1, 0.6, 0.36], energy: 3.2, wrap: 0, shadows: true }, sky: { color: [0.42, 0.38, 0.78], energy: 0.6 }, ground: { color: [0.6, 0.32, 0.22], energy: 0.3 },
      ao: { strength: 0.8, radius: 0.9 }, groups: { lamp: 0.6, window: 0.5, candle: 0.6 }, emissive: 0.8, specular: 0.4, bloom: { strength: 0.3, threshold: 0.9 },
      fog: { color: [0.95, 0.6, 0.5], density: 0.01, start: 6, amount: 0.6 }, exposure: 0.9, saturation: 1.3, tonemap: 'aces', lightShadows: false,
      backdrop: { mode: 'gradient', colors: [[0.18, 0.12, 0.38], [0.95, 0.42, 0.3], [1, 0.78, 0.45]], clouds: 1.2 } },
    style: [{ type: 'cel', steps: [0.12, 0.5], detail: 0.5 }, { type: 'hatch', below: 0.42, period: 9, color: [0.08, 0.04, 0.06] }, { type: 'ink', strength: 1, color: [0.08, 0.04, 0.06] }, { type: 'vignette', strength: 0.22 }],
  },
  night: {
    title: 'Ночь с фонарями',
    lighting: { sun: { dir: nz([0.35, 0.85, -0.4]), color: [0.45, 0.55, 0.95], energy: 0.3, wrap: 0, shadows: true }, sky: { color: [0.1, 0.13, 0.3], energy: 0.32 }, ground: { color: [0.08, 0.06, 0.08], energy: 0.2 },
      ao: { strength: 1, radius: 0.9 }, groups: { lamp: 1, window: 0.35, candle: 1 }, emissive: 1.1, specular: 1.6, bloom: { strength: 0.7, threshold: 0.9 },
      fog: { color: [0.1, 0.12, 0.25], density: 0.02, start: 6, amount: 0.15 }, exposure: 0.8, saturation: 1.1, tonemap: 'aces', lightShadows: true,
      backdrop: { mode: 'gradient', colors: [[0.01, 0.015, 0.05], [0.04, 0.05, 0.14], [0.16, 0.1, 0.22]], clouds: 0.25, stars: true, moon: { x: 0.78, y: 120, r: 38 } } },
    style: [{ type: 'ink', strength: 0.55, color: [0.02, 0.02, 0.05] }, { type: 'vignette', strength: 0.22 }],
  },
  pixel: {
    title: 'Пиксель-арт со светом',
    lighting: { sun: { dir: nz([-0.62, 0.5, -0.6]), color: [1, 0.78, 0.5], energy: 2.7, wrap: 0.1, shadows: true }, sky: { color: [0.35, 0.55, 0.75], energy: 0.6 }, ground: { color: [0.55, 0.4, 0.3], energy: 0.3 },
      ao: { strength: 1, radius: 0.9 }, groups: { lamp: 0.35, window: 0.35, candle: 0.35 }, emissive: 0.6, specular: 0.5, bloom: { strength: 0.2, threshold: 0.9 },
      fog: { color: [0.95, 0.75, 0.6], density: 0.006, start: 6, amount: 0.6 }, exposure: 0.82, saturation: 1.4, tonemap: 'aces', lightShadows: false,
      backdrop: { mode: 'gradient', colors: [[0.22, 0.4, 0.65], [0.85, 0.7, 0.55], [1, 0.82, 0.55]], clouds: 1.2 } },
    style: [{ type: 'pixelate', size: 4, colors: 56, bayer: 0.07 }, { type: 'vignette', strength: 0.22 }],
  },
};
export const STYLE_TYPES = ['cel', 'hatch', 'kuwahara', 'pixelate', 'ink', 'vignette'];

/** Цвет света: [r,g,b] 0..1 или CSS-цвет (доли без гаммы). */
const rgb = (c, def = [1, 1, 1]) => {
  if (Array.isArray(c)) return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
  const p = c != null ? parseColor(String(c)) : null;
  return p ? [p[0], p[1], p[2]] : def;
};
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const deep = (a, b) => { const o = { ...a }; for (const k in b) o[k] = isObj(a?.[k]) && isObj(b[k]) ? deep(a[k], b[k]) : b[k]; return o; };

/** Итоговые параметры света сцены: пресет + ручные поля scene.lighting. */
export function resolveLighting(scene, override) {
  const L = { ...(scene.lighting || {}), ...(override || {}) };
  const pre = LIGHT_PRESETS[L.preset] || LIGHT_PRESETS.day;
  const st = deep(pre.lighting, L);
  st.sun = { ...st.sun, dir: nz(st.sun.dir || [-0.6, 0.6, -0.3]), color: rgb(st.sun.color) };
  st.sky = { ...st.sky, color: rgb(st.sky.color) };
  st.ground = { ...st.ground, color: rgb(st.ground.color) };
  st.fog = { ...st.fog, color: rgb(st.fog.color) };
  if (st.backdrop?.colors) st.backdrop = { ...st.backdrop, colors: st.backdrop.colors.map((c) => rgb(c)) };
  st.characters = { tag: 'chr', amount: 0.45, ...(st.characters || {}) };
  st.preset = L.preset || 'day';
  return st;
}
/** Цепочка стилей: scene.style (массив или имя пресета) или стиль пресета света. */
export function resolveStyle(scene, override) {
  let s = override ?? scene.style;
  if (typeof s === 'string') s = LIGHT_PRESETS[s]?.style;
  if (!Array.isArray(s)) s = LIGHT_PRESETS[scene.lighting?.preset]?.style || LIGHT_PRESETS.day.style;
  return s.filter((x) => x && x.enabled !== false).map((x) => ({ ...x, ...(x.color != null ? { color: rgb(x.color) } : {}) }));
}

/* ============================== проходы ============================== */
export const PASS_LIST = ['color', 'normal', 'plane', 'planeD', 'emissive', 'ink', 'cover'];
/** Отрендерить проходы в PNG: { color, normal, plane, planeD, emissive, ink, cover, 'mask:chr' }. */
export async function renderPasses(scene, t = 0, { width = scene.width, states, masks = ['chr'], passes = PASS_LIST } = {}) {
  const list = [...passes, ...masks.map((m) => `mask:${m}`)];
  const out = {};
  // проходы большие: не больше двух одновременно (память)
  await mapLimit(list, 2, async (mode) => {
    const svg = renderSVG(scene, t, { width, states, mode: mode === 'color' ? undefined : mode });
    out[mode] = await svgToPng(svg, width);
  });
  return out;
}

/* ============================== поля ============================== */
const gaussKernel = (s) => {
  const r = Math.max(1, Math.round(4 * s)), k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * s * s)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return { k, r };
};
const refl = (i, n) => { while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - i - 1; return i; };
/** Гаусс одного канала (reflect, как scipy). Для больших σ — через уменьшенную копию. */
export function gauss(src, w, h, s) {
  if (!(s > 0)) return src;
  if (s > 6) {
    const f = Math.max(2, Math.floor(s / 3));
    const sw = Math.ceil(w / f), sh = Math.ceil(h / f), small = new Float32Array(sw * sh), cnt = new Float32Array(sw * sh);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const j = Math.floor(y / f) * sw + Math.floor(x / f); small[j] += src[y * w + x]; cnt[j]++; }
    for (let j = 0; j < small.length; j++) small[j] /= cnt[j] || 1;
    const b = gauss(small, sw, sh, s / f), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
        out[y * w + x] = (b[y0 * sw + x0] * (1 - tx) + b[y0 * sw + x1] * tx) * (1 - ty) + (b[y1 * sw + x0] * (1 - tx) + b[y1 * sw + x1] * tx) * ty;
      }
    }
    return out;
  }
  const { k, r } = gaussKernel(s), tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let a = 0;
      if (x >= r && x < w - r) for (let i = -r; i <= r; i++) a += src[row + x + i] * k[i + r];
      else for (let i = -r; i <= r; i++) a += src[row + refl(x + i, w)] * k[i + r];
      tmp[row + x] = a;
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    if (y >= r && y < h - r) for (let i = -r; i <= r; i++) a += tmp[(y + i) * w + x] * k[i + r];
    else for (let i = -r; i <= r; i++) a += tmp[refl(y + i, h) * w + x] * k[i + r];
    out[y * w + x] = a;
  }
  return out;
}
/** Среднее в окне size (как scipy.ndimage.uniform_filter, reflect). */
function uniform(src, w, h, size) {
  const lo = Math.floor(size / 2), hi = size - lo - 1, tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -lo; i <= hi; i++) a += src[y * w + refl(x + i, w)]; tmp[y * w + x] = a / size; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -lo; i <= hi; i++) a += tmp[refl(y + i, h) * w + x]; out[y * w + x] = a / size; }
  return out;
}
/** Половинное разрешение a[::2, ::2]. */
const half = (a, w, h) => { const hw = Math.ceil(w / 2), hh = Math.ceil(h / 2), o = new Float32Array(hw * hh); for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) o[y * hw + x] = a[2 * y * w + 2 * x]; return o; };
/** Увеличение вдвое (линейно, как scipy zoom order=1) с обрезкой до w×h. */
function zoom2(a, hw, hh, w, h) {
  const o = new Float32Array(w * h), W2 = hw * 2, H2 = hh * 2;
  const kx = (hw - 1) / Math.max(1, W2 - 1), ky = (hh - 1) / Math.max(1, H2 - 1);
  for (let y = 0; y < h; y++) {
    const fy = y * ky, y0 = Math.floor(fy), y1 = Math.min(hh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = x * kx, x0 = Math.floor(fx), x1 = Math.min(hw - 1, x0 + 1), tx = fx - x0;
      o[y * w + x] = (a[y0 * hw + x0] * (1 - tx) + a[y0 * hw + x1] * tx) * (1 - ty) + (a[y1 * hw + x0] * (1 - tx) + a[y1 * hw + x1] * tx) * ty;
    }
  }
  return o;
}
const pyRound = (v) => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 ? r - 1 : r; };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ============================== геометрия: окклюдеры ============================== */
/** Окклюдеры сцены: props.occluder {box, boxes, tris} у видимых узлов. */
export function occluders(scene) {
  const by = new Map(scene.nodes.map((n) => [n.id, n]));
  const hidden = (n) => { for (let p = n; p; p = p.parent ? by.get(p.parent) : null) if (p.props?.visible === false) return true; return false; };
  const boxes = [], tris = [];
  for (const n of scene.nodes) {
    const o = n.props?.occluder;
    if (!o || hidden(n)) continue;
    if (Array.isArray(o.box)) boxes.push(o.box);
    for (const b of o.boxes || []) boxes.push(b);
    for (const t of o.tris || []) tris.push(t);
  }
  return { boxes, tris };
}
/** Тест луча O + t·D, 0 < t < tmax, с коробками и треугольниками. */
function makeTracer({ boxes, tris }) {
  const B = new Float32Array(boxes.length * 6);
  boxes.forEach((b, i) => B.set([Math.min(b[0], b[1]), Math.max(b[0], b[1]), Math.min(b[2], b[3]), Math.max(b[2], b[3]), Math.min(b[4], b[5]), Math.max(b[4], b[5])], i * 6));
  const T = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => { T.set([t[0][0], t[0][1], t[0][2], t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2], t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]], i * 9); });
  const nb = boxes.length, nt = tris.length;
  return (ox, oy, oz, dx, dy, dz, tmax = 1e9) => {
    const ix = 1 / (Math.abs(dx) < 1e-6 ? 1e-6 : dx), iy = 1 / (Math.abs(dy) < 1e-6 ? 1e-6 : dy), iz = 1 / (Math.abs(dz) < 1e-6 ? 1e-6 : dz);
    for (let i = 0; i < nb; i++) {
      const o = i * 6;
      let t1 = (B[o] - ox) * ix, t2 = (B[o + 1] - ox) * ix;
      let tn = t1 < t2 ? t1 : t2, tf = t1 < t2 ? t2 : t1;
      t1 = (B[o + 2] - oy) * iy; t2 = (B[o + 3] - oy) * iy;
      tn = Math.max(tn, Math.min(t1, t2)); tf = Math.min(tf, Math.max(t1, t2));
      if (tf < tn) continue;
      t1 = (B[o + 4] - oz) * iz; t2 = (B[o + 5] - oz) * iz;
      tn = Math.max(tn, Math.min(t1, t2)); tf = Math.min(tf, Math.max(t1, t2));
      if (tf >= Math.max(tn, 1e-3) && tn < tmax) return true;
    }
    for (let i = 0; i < nt; i++) {
      const o = i * 9, e1x = T[o + 3], e1y = T[o + 4], e1z = T[o + 5], e2x = T[o + 6], e2y = T[o + 7], e2z = T[o + 8];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = px * e1x + py * e1y + pz * e1z;
      if (Math.abs(det) <= 1e-7) continue;
      const id = 1 / det, sx = ox - T[o], sy = oy - T[o + 1], sz = oz - T[o + 2];
      const u = (sx * px + sy * py + sz * pz) * id;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * id;
      if (v < 0 || u + v > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * id;
      if (tt > 1e-3 && tt < tmax) return true;
    }
    return false;
  };
}

/* ============================== медианное сечение ============================== */
function medianCut(data, n, colors) {
  const hist = new Map();
  for (let i = 0; i < n; i++) { const k = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]; hist.set(k, (hist.get(k) || 0) + 1); }
  let boxes = [[...hist.entries()].map(([k, c]) => [k >> 16, (k >> 8) & 255, k & 255, c])];
  const range = (b) => { const lo = [255, 255, 255], hi = [0, 0, 0]; for (const p of b) for (let c = 0; c < 3; c++) { if (p[c] < lo[c]) lo[c] = p[c]; if (p[c] > hi[c]) hi[c] = p[c]; } return hi.map((v, c) => v - lo[c]); };
  while (boxes.length < colors) {
    let bi = -1, best = 0;
    boxes.forEach((b, i) => { if (b.length < 2) return; const r = Math.max(...range(b)) * Math.sqrt(b.reduce((a, p) => a + p[3], 0)); if (r > best) { best = r; bi = i; } });
    if (bi < 0) break;
    const b = boxes[bi], r = range(b), ch = r.indexOf(Math.max(...r));
    b.sort((p, q) => p[ch] - q[ch]);
    const total = b.reduce((a, p) => a + p[3], 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < b.length - 1; i++) { acc += b[i][3]; if (acc >= total / 2) { cut = i + 1; break; } }
    boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
  }
  return boxes.map((b) => { const s = [0, 0, 0]; let c = 0; for (const p of b) { for (let k = 0; k < 3; k++) s[k] += p[k] * p[3]; c += p[3]; } return s.map((v) => Math.round(v / c)); });
}

/* ============================== главное ============================== */
const lin22 = (v) => Math.pow(Math.max(0, v), 2.2);
/**
 * Кадр с отложенным светом. Возвращает { png, image, debug? (PNG листа «цвет / нормали / тени+AO / итог»), stats }.
 * opts: width, states, lighting (поверх scene.lighting), style (поверх scene.style), debug, passes (готовые PNG проходов).
 */
export async function renderLit(scene, t = 0, opts = {}) {
  const t0 = Date.now();
  if (!scene.camera3d) throw new Error('Отложенный свет требует scene.camera3d (camera3d_set): без камеры позиции пикселей не восстановить.');
  const W0 = scene.width, H0 = scene.height;
  const W = Math.max(16, Math.round(opts.width ?? W0)), H = Math.max(9, Math.round((W * H0) / W0)), k = W / W0, n = W * H;
  const st = resolveLighting(scene, opts.lighting);
  const style = resolveStyle(scene, opts.style);
  const chrTag = st.characters.tag;
  const pngs = opts.passes || await renderPasses(scene, t, { width: W, states: opts.states, masks: [chrTag] });
  const dec = (m) => { const im = decodePNG(pngs[m]); if (im.width !== W || im.height !== H) throw new Error(`проход ${m}: ${im.width}×${im.height} вместо ${W}×${H}`); return im.data; };
  const alb = dec('color'), nrm = dec('normal'), pn = dec('plane'), pdm = dec('planeD'), em = dec('emissive'), ink = dec('ink'), cov = dec('cover'), chrD = dec(`mask:${chrTag}`);
  const tPass = Date.now();

  // ---------- камера и позиции ----------
  const c3 = scene.camera3d;
  const f = (c3.f ?? 1500) * k, hor = (c3.hor ?? 280) * k, cx = (c3.cx ?? W0 / 2) * k, camH = c3.camH ?? 4.2, dz = c3.dz ?? 0;
  const camX = 0, camY = camH, camZ = -dz;
  const mask = new Uint8Array(n), cover = new Uint8Array(n), chm = new Float32Array(n), inkL = new Float32Array(n);
  const Nx = new Float32Array(n), Ny = new Float32Array(n), Nz = new Float32Array(n);
  const PNx = new Float32Array(n), PNy = new Float32Array(n), PNz = new Float32Array(n);
  const Px = new Float32Array(n), Py = new Float32Array(n), Pz = new Float32Array(n), spec = new Float32Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = i * 4;
    mask[i] = pn[o + 3] > 127.5 ? 1 : 0;
    cover[i] = cov[o] > 127 ? 1 : 0;
    chm[i] = (0.299 * chrD[o] + 0.587 * chrD[o + 1] + 0.114 * chrD[o + 2]) / 255;
    inkL[i] = (0.299 * ink[o] + 0.587 * ink[o + 1] + 0.114 * ink[o + 2]) / 255;
    let ax = pn[o] / 127.5 - 1, ay = pn[o + 1] / 127.5 - 1, az = pn[o + 2] / 127.5 - 1, l = Math.hypot(ax, ay, az) + 1e-6;
    ax /= l; ay /= l; az /= l;
    PNx[i] = ax; PNy[i] = ay; PNz[i] = az;
    if (nrm[o + 3] > 127.5) { let bx = nrm[o] / 127.5 - 1, by = nrm[o + 1] / 127.5 - 1, bz = nrm[o + 2] / 127.5 - 1; const m = Math.hypot(bx, by, bz) + 1e-6; Nx[i] = bx / m; Ny[i] = by / m; Nz[i] = bz / m; }
    else { Nx[i] = ax; Ny[i] = ay; Nz[i] = az; }
    const d = ((pdm[o] << 8) + pdm[o + 1]) / 100 - 200;
    spec[i] = pdm[o + 2] / 255;
    const dx = (x + 0.5 - cx) / f, dy = -(y + 0.5 - hor) / f, dzz = 1;
    let den = ax * dx + ay * dy + az * dzz;
    if (Math.abs(den) < 1e-4) den = den < 0 ? -1e-4 : 1e-4;
    let tt = (d - (ax * camX + ay * camY + az * camZ)) / den;
    if (!(mask[i] && tt > 0)) tt = 1e4;
    Px[i] = camX + dx * tt; Py[i] = camY + dy * tt; Pz[i] = camZ + dzz * tt;
  }

  // ---------- солнце: тени лучами (половинное разрешение) ----------
  const occ = occluders(scene);
  const trace = makeTracer(occ);
  const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2), hn = hw * hh;
  const L = st.sun.dir;
  const shH = new Float32Array(hn).fill(1);
  let rays = 0;
  if (st.sun.shadows !== false && (occ.boxes.length || occ.tris.length)) {
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
      const i = 2 * y * W + 2 * x;
      if (!mask[i] || PNx[i] * L[0] + PNy[i] * L[1] + PNz[i] * L[2] <= -0.05) continue;
      rays++;
      if (trace(Px[i] + PNx[i] * 0.04, Py[i] + PNy[i] * 0.04, Pz[i] + PNz[i] * 0.04, L[0], L[1], L[2])) shH[y * hw + x] = 0;
    }
  }
  const shadow = zoom2(gauss(shH, hw, hh, 0.9), hw, hh, W, H);

  // ---------- SSAO (половинное разрешение) ----------
  let ao;
  if ((st.ao?.strength ?? 1) > 0) {
    const hx = new Float32Array(hn), hy = new Float32Array(hn), hz = new Float32Array(hn), hnx = new Float32Array(hn), hny = new Float32Array(hn), hnz = new Float32Array(hn);
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
      const i = 2 * y * W + 2 * x, j = y * hw + x;
      if (mask[i]) { hx[j] = Px[i]; hy[j] = Py[i]; hz[j] = Pz[i]; } else { hx[j] = 0; hy[j] = 0; hz[j] = 1e4; }
      hnx[j] = PNx[i]; hny[j] = PNy[i]; hnz[j] = PNz[i];
    }
    const occA = new Float32Array(hn), rad = st.ao?.radius ?? 0.9;
    let cnt = 0;
    for (const r0 of [3, 8, 18, 34]) {
      const r = r0 * (W / 2560);  // радиусы — пиксели половинного кадра шириной 2560 (эталон), масштабируются с шириной
      for (let q = 0; q < 8; q++) {
        const a = (q * Math.PI) / 4 + r0 * 0.37;
        const oy = pyRound(Math.sin(a) * r), ox = pyRound(Math.cos(a) * r);
        for (let y = 0; y < hh; y++) {
          const sy = Math.min(hh - 1, Math.max(0, y + oy));
          for (let x = 0; x < hw; x++) {
            const sx = Math.min(hw - 1, Math.max(0, x + ox)), j = y * hw + x, s = sy * hw + sx;
            const vx = hx[s] - hx[j], vy = hy[s] - hy[j], vz = hz[s] - hz[j];
            const dist = Math.hypot(vx, vy, vz) + 1e-4;
            const c = clamp01((vx * hnx[j] + vy * hny[j] + vz * hnz[j]) / dist - 0.12) / (1 + (dist / rad) ** 2);
            occA[j] += c;
          }
        }
        cnt++;
      }
    }
    const aoH = new Float32Array(hn);
    for (let j = 0; j < hn; j++) aoH[j] = 1 - clamp01((occA[j] / cnt) * 2.6);
    ao = zoom2(gauss(aoH, hw, hh, 1.2), hw, hh, W, H);
    const s = st.ao.strength ?? 1;
    for (let i = 0; i < n; i++) ao[i] = 1 - (1 - ao[i]) * s;
  } else ao = new Float32Array(n).fill(1);

  // ---------- освещение ----------
  const sunC = st.sun.color.map((v) => v * st.sun.energy), skyC = st.sky.color.map((v) => v * st.sky.energy), gC = st.ground.color.map((v) => v * st.ground.energy);
  const lin = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) lin[i * 3 + c] = Math.pow(alb[i * 4 + c] / 255, 2.2);
  const direct = new Float32Array(n);
  const cel = style.find((s) => s.type === 'cel');
  const wrap = st.sun.wrap || 0;
  for (let i = 0; i < n; i++) {
    let ndl = Nx[i] * L[0] + Ny[i] * L[1] + Nz[i] * L[2];
    if (wrap) ndl = (ndl + wrap) / (1 + wrap);
    direct[i] = clamp01(ndl) * shadow[i];
  }
  if (cel) {
    // cel квантуется по нормали ПЛОСКОСТИ (иначе каждая фаска — своя ступень), рельеф добавляется мягко
    const [t0c, t1c] = cel.steps || [0.12, 0.5], det = cel.detail ?? 0.5;
    const q = new Float32Array(n), dd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const pl = clamp01(PNx[i] * L[0] + PNy[i] * L[1] + PNz[i] * L[2]), base = pl * shadow[i];
      q[i] = base < t0c ? 0 : base < t1c ? 0.5 : 1;
      dd[i] = clamp01(Nx[i] * L[0] + Ny[i] * L[1] + Nz[i] * L[2]) - pl;
    }
    const qb = gauss(q, W, H, Math.max(0.3, 0.6 * (W / 2560)));
    for (let i = 0; i < n; i++) direct[i] = Math.min(1.2, Math.max(0, qb[i] * (1 + det * dd[i])));
  }
  const light = new Float32Array(n * 3), specT = new Float32Array(n * 3);
  const specI = st.specular ?? 0.35;
  for (let i = 0; i < n; i++) {
    const up = Ny[i];
    let vx = camX - Px[i], vy = camY - Py[i], vz = camZ - Pz[i];
    const vl = Math.hypot(vx, vy, vz) + 1e-6; vx /= vl; vy /= vl; vz /= vl;
    let hx = L[0] + vx, hy = L[1] + vy, hz = L[2] + vz;
    const hl = Math.hypot(hx, hy, hz) + 1e-6;
    const sp = Math.pow(clamp01((Nx[i] * hx + Ny[i] * hy + Nz[i] * hz) / hl), 40) * spec[i] * direct[i] * specI;
    for (let c = 0; c < 3; c++) {
      light[i * 3 + c] = (skyC[c] * (0.5 + 0.5 * up) + gC[c] * (0.5 - 0.5 * up)) * ao[i] + sunC[c] * direct[i];
      specT[i * 3 + c] = sp * sunC[c];
    }
  }
  // точечные источники
  const lights = deferredLights(scene, t, opts.states);
  let litCount = 0;
  for (const lt of lights) {
    const g = st.groups?.[lt.group] ?? (lt.group === 'candle' ? st.groups?.lamp : undefined) ?? 1;
    const kk = g * (lt.enabled === false ? 0 : 1);
    if (kk <= 0 || !(lt.radius > 0)) continue;
    const lc = rgb(lt.color).map((v) => lin22(v) * lt.energy * kk * 2.2);
    const [lx, ly, lz] = lt.p3, r = lt.radius;
    // экранная рамка влияния: проекция сферы радиуса r (с запасом) — остальные пиксели не трогаем
    const zc = Math.max(0.3, lz - r + dz);
    const sx = cx + (f * lx) / (lz + dz), sy = hor + (f * (camH - ly)) / (lz + dz), sr = (f * r) / zc + 4;
    const xa = Math.max(0, Math.floor(sx - sr)), xb = Math.min(W - 1, Math.ceil(sx + sr)), ya = Math.max(0, Math.floor(sy - sr)), yb = Math.min(H - 1, Math.ceil(sy + sr));
    if (xa > xb || ya > yb) continue;
    litCount++;
    const shadowed = (lt.shadows ?? lt.group === 'lamp') && st.lightShadows && (occ.boxes.length || occ.tris.length);
    let vis = null, vw = 0, vx0 = 0, vy0 = 0;
    if (shadowed) {
      vx0 = xa - (xa & 1); vy0 = ya - (ya & 1);
      vw = Math.ceil((xb - vx0 + 1) / 2); const vh = Math.ceil((yb - vy0 + 1) / 2);
      const tmp = new Float32Array(vw * vh).fill(1);
      for (let y = 0; y < vh; y++) for (let x = 0; x < vw; x++) {
        const px = vx0 + 2 * x, py = vy0 + 2 * y; if (px >= W || py >= H) continue;
        const i = py * W + px;
        if (!mask[i]) continue;
        const ddx = lx - Px[i], ddy = ly - Py[i], ddz = lz - Pz[i], dist = Math.hypot(ddx, ddy, ddz) + 1e-4;
        if (dist >= r) continue;
        rays++;
        if (trace(Px[i] + PNx[i] * 0.04, Py[i] + PNy[i] * 0.04, Pz[i] + PNz[i] * 0.04, ddx / dist, ddy / dist, ddz / dist, dist - 0.35)) tmp[y * vw + x] = 0;
      }
      const gb = gauss(tmp, vw, vh, 0.8);
      vis = { data: zoom2(gb, vw, vh, vw * 2, vh * 2), w: vw * 2 };
    }
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const i = y * W + x;
      const ddx = lx - Px[i], ddy = ly - Py[i], ddz = lz - Pz[i], dist = Math.hypot(ddx, ddy, ddz) + 1e-4;
      if (dist >= r) continue;
      const ldx = ddx / dist, ldy = ddy / dist, ldz = ddz / dist;
      const att = (1 - (dist / r) ** 2) ** 2;
      const nd = clamp01(Nx[i] * ldx + Ny[i] * ldy + Nz[i] * ldz);
      const vv = vis ? vis.data[(y - vy0) * vis.w + (x - vx0)] : 1;
      let vx = camX - Px[i], vy = camY - Py[i], vz = camZ - Pz[i];
      const vl = Math.hypot(vx, vy, vz) + 1e-6; vx /= vl; vy /= vl; vz /= vl;
      let hx = ldx + vx, hy = ldy + vy, hz = ldz + vz;
      const hl = Math.hypot(hx, hy, hz) + 1e-6;
      const sp = Math.pow(clamp01((Nx[i] * hx + Ny[i] * hy + Nz[i] * hz) / hl), 30) * spec[i] * att * vv * specI;
      for (let c = 0; c < 3; c++) { light[i * 3 + c] += nd * att * vv * lc[c]; specT[i * 3 + c] += sp * lc[c]; }
    }
  }
  // персонажи: спрайты уже нарисованы со светотенью — свет нормируется и смешивается с единицей
  const ca = st.characters.amount ?? 0.45, ref = [0, 1, 2].map((c) => skyC[c] * 0.8 + sunC[c] * 0.75);
  const col = new Float32Array(n * 3), emL = new Float32Array(n * 3);
  const emI = st.emissive ?? 0.25;
  const fogK = st.fog?.density ?? 0, fogS = st.fog?.start ?? 6, fogAmt = st.fog?.amount ?? 0.6, fogC = (st.fog?.color || [0, 0, 0]).map(lin22);
  // «плоские» пиксели: покрыты узлами без поверхности поверх неба — фон + солнце для нормали к камере, без теней
  const flatSun = clamp01(-L[2]);
  for (let i = 0; i < n; i++) {
    const ch = chm[i];
    for (let c = 0; c < 3; c++) {
      const j = i * 3 + c;
      let li = light[j];
      if (ch > 0) li = li * (1 - ch) + ((1 - ca) + ca * (li / ref[c]) * 0.85) * ch;
      if (!mask[i] && cover[i]) li = skyC[c] * 0.5 + gC[c] * 0.5 + sunC[c] * flatSun;
      emL[j] = lin22(em[i * 4 + c] / 255) * emI;
      let v = lin[j] * li + (mask[i] ? specT[j] : 0) + emL[j];
      if (mask[i] && fogK > 0) { const fa = 1 - Math.exp(-Math.min(200, Math.max(0, Pz[i] - fogS)) * fogK); v = v * (1 - fa) + fogC[c] * fa * fogAmt; }
      col[j] = v;
    }
  }

  // ---------- небо ----------
  const bd = st.backdrop || { mode: 'albedo' };
  if (bd.mode === 'gradient' && bd.colors?.length === 3) {
    const [ga, gb, gc] = bd.colors.map((c) => c.map(lin22));
    const rm = new Float32Array(H * 3), buf = [];
    for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) {
      buf.length = 0;
      for (let x = 0; x < W; x++) { const i = y * W + x; if (!mask[i]) buf.push(lin[i * 3 + c]); }
      if (buf.length) { buf.sort((p, q) => p - q); const m = buf.length >> 1; rm[y * 3 + c] = buf.length % 2 ? buf[m] : (buf[m - 1] + buf[m]) / 2; }
    }
    const cloudK = bd.clouds ?? 1.2;
    const moon = bd.moon ? { x: (bd.moon.x <= 1 ? bd.moon.x * W0 : bd.moon.x) * k, y: (bd.moon.y ?? 120) * k, r: (bd.moon.r ?? 38) * k } : null;
    let sd = 3;
    const srnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    const tH = Math.max(0.01, (c3.hor + 120) / H0);
    for (let y = 0; y < H; y++) {
      const tY = clamp01(y / H / tH);
      const gcol = [0, 1, 2].map((c) => (tY < 0.6 ? ga[c] + (gb[c] - ga[c]) * (tY / 0.6) : gb[c] + (gc[c] - gb[c]) * ((tY - 0.6) / 0.4)));
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const star = bd.stars ? srnd() > 0.9993 : false;
        if (mask[i] || cover[i]) continue;
        let cl = 0;
        for (let c = 0; c < 3; c++) cl += lin[i * 3 + c] - rm[y * 3 + c];
        cl = clamp01(cl / 3);
        for (let c = 0; c < 3; c++) {
          let v = gcol[c] + cl * cloudK * (gb[c] * 0.6 + 0.4);
          if (star) v += 0.9 * (1 - tY) ** 2;
          if (moon) { const d2 = (x - moon.x) ** 2 + (y - moon.y) ** 2; if (d2 < moon.r * moon.r) v += [0.9, 0.9, 0.8][c]; v += Math.exp(-d2 / (9000 * k * k)) * 0.2 * [0.5, 0.6, 1][c]; }
          col[i * 3 + c] = v;
        }
      }
    }
  } else {
    for (let i = 0; i < n; i++) if (!mask[i] && !cover[i]) for (let c = 0; c < 3; c++) col[i * 3 + c] = lin[i * 3 + c];
  }

  // ---------- bloom ----------
  const bs = st.bloom?.strength ?? 0, thr = st.bloom?.threshold ?? 0.9;
  if (bs > 0) {
    const br = [0, 1, 2].map(() => new Float32Array(n));
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) br[c][i] = Math.max(0, col[i * 3 + c] - thr) + emL[i * 3 + c] * 0.6;
    for (const [s, wgt] of [[4, 0.5], [14, 0.35], [40, 0.25]]) for (let c = 0; c < 3; c++) {
      const b = gauss(br[c], W, H, s * (W / 2560));
      for (let i = 0; i < n; i++) col[i * 3 + c] += b[i] * wgt * bs;
    }
  }
  // ---------- тонмаппинг ----------
  const exp = st.exposure ?? 1, sat = st.saturation ?? 1;
  const img = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < 3; c++) {
      let x = col[i * 3 + c] * exp;
      if (st.tonemap !== 'none') x = clamp01((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)); else x = clamp01(x);
      img[i * 3 + c] = Math.pow(x, 1 / 2.2); s += img[i * 3 + c];
    }
    const lum = s / 3;
    for (let c = 0; c < 3; c++) img[i * 3 + c] = clamp01(lum + (img[i * 3 + c] - lum) * sat);
  }

  // ---------- стиль ----------
  let out = img;
  for (const s of style) out = applyStyle(s, out, { W, H, W0, k, mask, chm, inkL });

  const rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(clamp01(out[i * 3 + c]) * 255); rgba[i * 4 + 3] = 255; }
  const image = { width: W, height: H, data: rgba };
  const res = { image, png: encodePNG(image), stats: { width: W, height: H, preset: st.preset, style: style.map((s) => s.type), lights: lights.length, litLights: litCount, boxes: occ.boxes.length, tris: occ.tris.length, rays, passMs: tPass - t0, ms: Date.now() - t0 } };
  if (opts.debug) {
    const so = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { const v = Math.round(clamp01(shadow[i] * ao[i]) * 255); so[i * 4] = so[i * 4 + 1] = so[i * 4 + 2] = v; so[i * 4 + 3] = 255; }
    const cell = Math.min(W, opts.debugWidth || 960);
    const im = (d) => scaleDown(d, cell);
    const top = sideBySide([im(decodePNG(pngs.color)), im(decodePNG(pngs.normal))]), bot = sideBySide([im({ width: W, height: H, data: so }), im(image)]);
    res.shadowAO = { width: W, height: H, data: so };
    res.debug = encodePNG(stackV([top, bot]));
  }
  return res;
}
function stackV(imgs, gap = 8) {
  const w = Math.max(...imgs.map((i) => i.width)), h = imgs.reduce((a, i) => a + i.height, 0) + gap * (imgs.length - 1), data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([34, 34, 34, 255], i * 4);
  let oy = 0;
  for (const im of imgs) { for (let y = 0; y < im.height; y++) data.set(im.data.subarray(y * im.width * 4, (y + 1) * im.width * 4), ((oy + y) * w) * 4); oy += im.height + gap; }
  return { width: w, height: h, data };
}

/** Источники для отложенного света: узлы light с p3 (мировые координаты). */
export function deferredLights(scene, t = 0, states) {
  return collectLights(scene, t, { states }).filter((l) => Array.isArray(l.p3)).map((l) => ({ ...l, radius: l.radius3 ?? l.radius }));
}

/** Пост-эффект стиля над изображением img (Float32 RGB 0..1, n·3). */
function applyStyle(s, img, { W, H, W0, k, mask, chm, inkL }) {
  const n = W * H;
  const sk = W / 2560; // размеры эффектов заданы для кадра шириной 2560 (как эталон)
  switch (s.type) {
    case 'cel': return img; // учтён в освещении
    case 'kuwahara': {
      const r = Math.max(1, Math.round((s.radius ?? 3) * Math.max(0.35, sk))), size = r + 1;
      const ch = [0, 1, 2].map((c) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = img[i * 3 + c]; return a; });
      const m = ch.map((a) => uniform(a, W, H, size)), m2 = ch.map((a) => { const q = new Float32Array(n); for (let i = 0; i < n; i++) q[i] = a[i] * a[i]; return uniform(q, W, H, size); });
      const out = new Float32Array(n * 3), best = new Float32Array(n).fill(1e9);
      const fl = (a, b) => Math.floor(a / b);
      for (const [oy, ox] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const sy = fl(oy * r, 2), sx = fl(ox * r, 2);
        for (let y = 0; y < H; y++) {
          const yy = (((y - sy) % H) + H) % H;
          for (let x = 0; x < W; x++) {
            const xx = (((x - sx) % W) + W) % W, j = yy * W + xx, i = y * W + x;
            let v = 0;
            for (let c = 0; c < 3; c++) v += m2[c][j] - m[c][j] * m[c][j];
            if (v < best[i]) { best[i] = v; for (let c = 0; c < 3; c++) out[i * 3 + c] = m[c][j]; }
          }
        }
      }
      return out;
    }
    case 'hatch': {
      const below = s.below ?? 0.42, per = Math.max(3, (s.period ?? 9) * Math.max(0.35, sk)), hc = s.color || [0.08, 0.04, 0.06];
      const out = new Float32Array(img);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!mask[i]) continue;
        const lv = (img[i * 3] + img[i * 3 + 1] + img[i * 3 + 2]) / 3;
        const dk = clamp01((below - lv) / below) * (1 - chm[i]);
        if (dk <= 0) continue;
        const p1 = (x + y) % per < per * (2.2 / 9) ? 1 : 0, p2 = ((((x - y) % per) + per) % per) < per * (2 / 9) ? 1 : 0;
        const a = p1 * clamp01(dk * 1.6) * 0.55 + p2 * clamp01(dk * 2 - 1) * 0.5;
        for (let c = 0; c < 3; c++) out[i * 3 + c] = img[i * 3 + c] * (1 - a) + hc[c] * a;
      }
      return out;
    }
    case 'ink': {
      const a0 = s.strength ?? 1, hc = s.color || [0, 0, 0], out = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const a = (1 - inkL[i]) * a0; for (let c = 0; c < 3; c++) out[i * 3 + c] = img[i * 3 + c] * (1 - a) + hc[c] * a; }
      return out;
    }
    case 'vignette': {
      const v0 = s.strength ?? 0.22, out = new Float32Array(n * 3);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const v = 1 - v0 * (((x - W / 2) / (W / 2)) ** 2 + ((y - H / 2) / (H / 1.2)) ** 2), i = y * W + x;
        for (let c = 0; c < 3; c++) out[i * 3 + c] = clamp01(img[i * 3 + c] * v);
      }
      return out;
    }
    case 'pixelate': {
      // сетка пикселей задана в единицах сцены: size 4 при ширине 2560 → 640 «пикселей» при любой ширине вывода
      const ps = s.size ?? 4, lw = Math.max(1, Math.floor(W0 / ps)), lh = Math.max(1, Math.floor((H * W0) / W / ps));
      const small = new Float32Array(lw * lh * 3), cnt = new Float32Array(lw * lh);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const sx = Math.floor((x * lw) / W), sy = Math.floor((y * lh) / H), j = sy * lw + sx, i = y * W + x;
        for (let c = 0; c < 3; c++) small[j * 3 + c] += Math.round(img[i * 3 + c] * 255) / 255;
        cnt[j]++;
      }
      const bay = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], amp = s.bayer ?? 0.07;
      const q = new Uint8Array(lw * lh * 4);
      for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
        const j = y * lw + x, th = (bay[y % 4][x % 4] / 16 - 0.47) * amp;
        for (let c = 0; c < 3; c++) q[j * 4 + c] = Math.round(clamp01(small[j * 3 + c] / (cnt[j] || 1) + th) * 255);
        q[j * 4 + 3] = 255;
      }
      const pal = medianCut(q, lw * lh, s.colors ?? 56);
      const memo = new Map();
      for (let j = 0; j < lw * lh; j++) {
        const key = (q[j * 4] << 16) | (q[j * 4 + 1] << 8) | q[j * 4 + 2];
        let b = memo.get(key);
        if (b === undefined) { let bd = Infinity; pal.forEach((p, pi) => { const d = (p[0] - q[j * 4]) ** 2 + (p[1] - q[j * 4 + 1]) ** 2 + (p[2] - q[j * 4 + 2]) ** 2; if (d < bd) { bd = d; b = pi; } }); memo.set(key, b); }
        q[j * 4] = pal[b][0]; q[j * 4 + 1] = pal[b][1]; q[j * 4 + 2] = pal[b][2];
      }
      const up = upscaleNearest({ width: lw, height: lh, data: q }, W, H), out = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = up.data[i * 4 + c] / 255;
      return out;
    }
    default: return img;
  }
}

export { normalMapFromPass } from './normals.mjs';
