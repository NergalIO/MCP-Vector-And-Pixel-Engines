// Отложенное освещение 2.5D-сцен Kontur (перенос Tools/scene_sketch/render.py на JS, typed arrays).
// Проходы renderSVG (color, normal, plane, planeD, emissive, ink, mask:<метка>, cover, matId) → позиции пикселей по
// плоскостям и лучу камеры (cameraModel: та же камера, что у построителя) → попиксельные материалы → солнце с тенями
// (BVH по коробкам и треугольникам, мягкая полутень по угловому размеру солнца), полусфера, SSAO, лампы (+тени),
// отражённый свет (GI), блики, свечение, туман, небо, SSR, объёмный свет и ореолы ламп, bloom, ACES, цветокоррекция →
// стиль (cel, штриховка, Кувахара, «краска», пиксели+Байер, контур, бумага, виньетка).
// Всё новое выключено по умолчанию: старые сцены дают тот же кадр пиксель в пиксель.
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { renderSVG, collectLights, parseColor, cameraModel, noise3 } from '../engine/kontur.js';
import { svgToPng, svgToRGBA, upscaleNearest, mapLimit } from './render.mjs';
import { decodePNG, encodePNG, sideBySide, scaleDown, heightToNormalSrc } from './normals.mjs';
import { buildBVH } from './bvh.mjs';
import { prepareMaterials, applyMaterials } from './materials.mjs';

/* ============================== параметры ============================== */
const nz = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
/** Пресеты света и стиля (значения — как в эскизах сцены C). Цвета света — доли 0..1 (hex = доля·255, без гаммы). */
export const LIGHT_PRESETS = {
  day: {
    title: 'Рисованный день',
    lighting: { sun: { dir: nz([-0.62, 0.6, -0.3]), color: [1, 0.92, 0.78], energy: 1.55, wrap: 0.25, shadows: true }, sky: { color: [0.48, 0.58, 0.85], energy: 0.6 }, ground: { color: [0.55, 0.42, 0.3], energy: 0.3 },
      ao: { strength: 0.9, radius: 0.9 }, groups: { lamp: 0, window: 0, candle: 0, fairy: 0 }, emissive: 0.25, specular: 0.35, bloom: { strength: 0.15, threshold: 0.9 },
      fog: { color: [0.85, 0.82, 0.9], density: 0.012, start: 6, amount: 0.6 }, exposure: 1, saturation: 1.08, tonemap: 'aces', lightShadows: false, backdrop: { mode: 'albedo' } },
    style: [{ type: 'kuwahara', radius: 3 }, { type: 'ink', strength: 0.32, color: [0.25, 0.15, 0.12] }, { type: 'vignette', strength: 0.22 }],
  },
  comic: {
    title: 'Комикс на закате',
    lighting: { sun: { dir: nz([-0.86, 0.3, -0.42]), color: [1, 0.6, 0.36], energy: 3.2, wrap: 0, shadows: true }, sky: { color: [0.42, 0.38, 0.78], energy: 0.6 }, ground: { color: [0.6, 0.32, 0.22], energy: 0.3 },
      ao: { strength: 0.8, radius: 0.9 }, groups: { lamp: 0.6, window: 0.5, candle: 0.6, fairy: 0.6 }, emissive: 0.8, specular: 0.4, bloom: { strength: 0.3, threshold: 0.9 },
      fog: { color: [0.95, 0.6, 0.5], density: 0.01, start: 6, amount: 0.6 }, exposure: 0.9, saturation: 1.3, tonemap: 'aces', lightShadows: false,
      backdrop: { mode: 'gradient', colors: [[0.18, 0.12, 0.38], [0.95, 0.42, 0.3], [1, 0.78, 0.45]], clouds: 1.2 } },
    style: [{ type: 'cel', steps: [0.12, 0.5], detail: 0.5 }, { type: 'hatch', below: 0.42, period: 9, color: [0.08, 0.04, 0.06] }, { type: 'ink', strength: 1, color: [0.08, 0.04, 0.06] }, { type: 'vignette', strength: 0.22 }],
  },
  night: {
    title: 'Ночь с фонарями',
    lighting: { sun: { dir: nz([0.35, 0.85, -0.4]), color: [0.45, 0.55, 0.95], energy: 0.3, wrap: 0, shadows: true }, sky: { color: [0.1, 0.13, 0.3], energy: 0.32 }, ground: { color: [0.08, 0.06, 0.08], energy: 0.2 },
      ao: { strength: 1, radius: 0.9 }, groups: { lamp: 1, window: 0.35, candle: 1, fairy: 1 }, emissive: 1.1, specular: 1.6, bloom: { strength: 0.7, threshold: 0.9 },
      fog: { color: [0.1, 0.12, 0.25], density: 0.02, start: 6, amount: 0.15 }, exposure: 0.8, saturation: 1.1, tonemap: 'aces', lightShadows: true,
      backdrop: { mode: 'gradient', colors: [[0.01, 0.015, 0.05], [0.04, 0.05, 0.14], [0.16, 0.1, 0.22]], clouds: 0.25, stars: true, moon: { x: 0.78, y: 120, r: 38 } } },
    style: [{ type: 'ink', strength: 0.55, color: [0.02, 0.02, 0.05] }, { type: 'vignette', strength: 0.22 }],
  },
  pixel: {
    title: 'Пиксель-арт со светом',
    lighting: { sun: { dir: nz([-0.62, 0.5, -0.6]), color: [1, 0.78, 0.5], energy: 2.7, wrap: 0.1, shadows: true }, sky: { color: [0.35, 0.55, 0.75], energy: 0.6 }, ground: { color: [0.55, 0.4, 0.3], energy: 0.3 },
      ao: { strength: 1, radius: 0.9 }, groups: { lamp: 0.35, window: 0.35, candle: 0.35, fairy: 0.35 }, emissive: 0.6, specular: 0.5, bloom: { strength: 0.2, threshold: 0.9 },
      fog: { color: [0.95, 0.75, 0.6], density: 0.006, start: 6, amount: 0.6 }, exposure: 0.82, saturation: 1.4, tonemap: 'aces', lightShadows: false,
      backdrop: { mode: 'gradient', colors: [[0.22, 0.4, 0.65], [0.85, 0.7, 0.55], [1, 0.82, 0.55]], clouds: 1.2 } },
    style: [{ type: 'pixelate', size: 4, colors: 56, bayer: 0.07 }, { type: 'vignette', strength: 0.22 }],
  },
  golden: {
    title: 'Золотой час (иллюстрация)',
    lighting: { sun: { dir: nz([-0.7, 0.45, -0.4]), color: [1, 0.8, 0.56], energy: 1.85, wrap: 0.18, shadows: true, angle: 2.2 }, sky: { color: [0.56, 0.62, 0.86], energy: 0.55 }, ground: { color: [0.62, 0.46, 0.32], energy: 0.32 },
      ao: { strength: 0.85, radius: 0.9 }, groups: { lamp: 0.55, window: 0.45, candle: 0.55, fairy: 0.7 }, emissive: 0.7, specular: 0.45, bloom: { strength: 0.28, threshold: 0.85 },
      fog: { color: [1, 0.86, 0.7], density: 0.008, start: 8, amount: 0.45 }, exposure: 0.88, saturation: 1.12, tonemap: 'aces', lightShadows: false,
      gi: { strength: 0.55, radius: 2.5 }, volumetric: { density: 0.006, steps: 12, g: 0.55, lamps: 0.6, maxDist: 30 },
      grade: { lift: [0.015, 0.01, 0.03], gain: [1.03, 1, 0.95], contrast: 1.08, split: { shadows: [0.24, 0.3, 0.55], highlights: [1, 0.8, 0.55], amount: 0.14 } },
      backdrop: { mode: 'gradient', colors: [[0.34, 0.54, 0.86], [0.96, 0.82, 0.66], [1, 0.86, 0.62]], clouds: 1 } },
    style: [{ type: 'paint', radius: 4 }, { type: 'ink', strength: 0.42, color: 'albedo', darken: 0.32, depthWidth: 1 }, { type: 'paper', strength: 0.07 }, { type: 'vignette', strength: 0.2 }],
  },
  dusk: {
    title: 'Сумерки с фонарями',
    lighting: { sun: { dir: nz([0.82, 0.2, 0.4]), color: [1, 0.52, 0.32], energy: 1.5, wrap: 0.1, shadows: true, angle: 3 }, sky: { color: [0.32, 0.32, 0.62], energy: 0.5 }, ground: { color: [0.4, 0.26, 0.22], energy: 0.25 },
      ao: { strength: 0.95, radius: 0.9 }, groups: { lamp: 1, window: 0.8, candle: 1, fairy: 1 }, emissive: 1, specular: 0.8, bloom: { strength: 0.45, threshold: 0.85 },
      fog: { color: [0.5, 0.4, 0.62], density: 0.015, start: 6, amount: 0.45 }, exposure: 0.95, saturation: 1.15, tonemap: 'aces', lightShadows: true,
      gi: { strength: 0.4, radius: 2.5 }, volumetric: { density: 0.008, steps: 12, g: 0.5, lamps: 1, maxDist: 30 }, reflections: { strength: 0.5 },
      grade: { split: { shadows: [0.2, 0.32, 0.5], highlights: [1, 0.66, 0.42], amount: 0.16 }, gain: [1.02, 0.99, 0.97] },
      backdrop: { mode: 'gradient', colors: [[0.12, 0.12, 0.36], [0.76, 0.42, 0.46], [1, 0.66, 0.42]], clouds: 1 } },
    style: [{ type: 'paint', radius: 4 }, { type: 'ink', strength: 0.5, color: 'albedo', darken: 0.25, depthWidth: 1 }, { type: 'vignette', strength: 0.24 }],
  },
};
export const STYLE_TYPES = ['cel', 'hatch', 'kuwahara', 'paint', 'pixelate', 'ink', 'paper', 'vignette'];

/** Цвет света: [r,g,b] 0..1 или CSS-цвет (доли без гаммы). */
const rgb = (c, def = [1, 1, 1]) => {
  if (Array.isArray(c)) return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
  const p = c != null ? parseColor(String(c)) : null;
  return p ? [p[0], p[1], p[2]] : def;
};
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const deep = (a, b) => { const o = { ...a }; for (const k in b) o[k] = isObj(a?.[k]) && isObj(b[k]) ? deep(a[k], b[k]) : b[k]; return o; };
/** Включаемый блок: true → значения по умолчанию, объект → поверх них, false/null/enabled:false → выключен. */
const block = (v, def) => (v === true ? { ...def } : isObj(v) && v.enabled !== false ? { ...def, ...v } : null);
/** Скаляр или тройка → тройка. */
const tri = (v, d) => (v == null ? [d, d, d] : typeof v === 'number' ? [v, v, v] : rgb(v, [d, d, d]));

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
  st.gi = block(st.gi, { strength: 0.5, radius: 2.5 });
  st.volumetric = block(st.volumetric, { density: 0.015, steps: 12, g: 0.5, lamps: 0.8, maxDist: 40, sun: true });
  if (st.volumetric) st.volumetric.color = rgb(st.volumetric.color, [1, 1, 1]);
  st.reflections = block(st.reflections, { strength: 0.5, minSpec: 0.5, maxDist: 14, steps: 40, thickness: 0.6, floorOnly: true });
  st.grade = block(st.grade, {});
  if (st.grade) {
    const g = st.grade;
    g.lift = tri(g.lift, 0); g.gamma = tri(g.gamma, 1); g.gain = tri(g.gain, 1);
    if (g.split) g.split = { amount: 0.15, balance: 0, ...g.split, shadows: rgb(g.split.shadows, [0.3, 0.4, 0.6]), highlights: rgb(g.split.highlights, [1, 0.8, 0.6]) };
  }
  st.preset = L.preset || 'day';
  return st;
}
/** Цепочка стилей: scene.style (массив или имя пресета) или стиль пресета света. */
export function resolveStyle(scene, override) {
  let s = override ?? scene.style;
  if (typeof s === 'string') s = LIGHT_PRESETS[s]?.style;
  if (!Array.isArray(s)) s = LIGHT_PRESETS[scene.lighting?.preset]?.style || LIGHT_PRESETS.day.style;
  return s.filter((x) => x && x.enabled !== false).map((x) => ({ ...x, ...(x.color != null && x.color !== 'albedo' ? { color: rgb(x.color) } : {}) }));
}

/* ============================== проходы ============================== */
export const PASS_LIST = ['color', 'normal', 'plane', 'planeD', 'emissive', 'ink', 'cover'];
/** Нужен ли сцене проход matId (есть попиксельные материалы). */
export const needsMatId = (scene) => !!(scene.materials && Object.keys(scene.materials).length);
/**
 * Отрендерить проходы: { color, normal, plane, planeD, emissive, ink, cover, matId?, 'mask:chr' } — PNG,
 * а с raw: true — RGBA-картинки { width, height, data } (без кодирования в PNG и обратно).
 */
export async function renderPasses(scene, t = 0, { width = scene.width, states, masks = ['chr'], passes, raw = false } = {}) {
  passes = passes || (needsMatId(scene) ? [...PASS_LIST, 'matId'] : PASS_LIST);
  const list = [...passes, ...masks.map((m) => `mask:${m}`)];
  const out = {};
  // проходы большие: не больше двух одновременно (память)
  await mapLimit(list, 2, async (mode) => {
    const svg = renderSVG(scene, t, { width, states, mode: mode === 'color' ? undefined : mode });
    out[mode] = raw ? await svgToRGBA(svg, width) : await svgToPng(svg, width);
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
/** Совместный билатеральный гаусс: веса по глубине D и нормали плоскости (nx, ny, nz); m — маска (0 — не смешивать). */
function bilateral(src, w, h, s, D, nx, ny, nz, m) {
  if (!(s > 0)) return src;
  const { k, r } = gaussKernel(s);
  const pass = (a, dx, dy, out) => {
    const lim = dx ? w : h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!m[i]) { out[i] = a[i]; continue; }
      const d0 = D[i], tol = d0 * 0.035 + 0.03, ax = nx[i], ay = ny[i], az = nz[i], p = dx ? x : y;
      let acc = 0, ws = 0;
      for (let q = -r; q <= r; q++) {
        const pp = p + q;
        if (pp < 0 || pp >= lim) continue;
        const j = dx ? i + q : i + q * w;
        if (!m[j]) continue;
        const dd = (D[j] - d0) / tol;
        let wt = k[q + r] * Math.exp(-dd * dd);
        if (ax * nx[j] + ay * ny[j] + az * nz[j] < 0.75) wt *= 0.04;
        acc += a[j] * wt; ws += wt;
      }
      out[i] = ws > 0 ? acc / ws : a[i];
    }
    return out;
  };
  return pass(pass(src, 1, 0, new Float32Array(w * h)), 0, 1, new Float32Array(w * h));
}
/** Среднее в окне size (как scipy.ndimage.uniform_filter, reflect). */
function uniform(src, w, h, size) {
  const lo = Math.floor(size / 2), hi = size - lo - 1, tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -lo; i <= hi; i++) a += src[y * w + refl(x + i, w)]; tmp[y * w + x] = a / size; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -lo; i <= hi; i++) a += tmp[refl(y + i, h) * w + x]; out[y * w + x] = a / size; }
  return out;
}
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
/** Билинейное увеличение из sw×sh (шаг f пикселей) в w×h. */
function upF(a, sw, sh, f, w, h) {
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      o[y * w + x] = (a[y0 * sw + x0] * (1 - tx) + a[y0 * sw + x1] * tx) * (1 - ty) + (a[y1 * sw + x0] * (1 - tx) + a[y1 * sw + x1] * tx) * ty;
    }
  }
  return o;
}
const pyRound = (v) => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 ? r - 1 : r; };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Хеш пикселя → [0, 1). */
const hash01 = (i, s) => { let h = Math.imul(i ^ Math.imul(s, 0x9e3779b1), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

/* ============================== геометрия: окклюдеры ============================== */
/** Окклюдеры сцены: props.occluder {box, boxes, tris, alpha} у видимых узлов. */
export function occluders(scene) {
  const by = new Map(scene.nodes.map((n) => [n.id, n]));
  const hidden = (n) => { for (let p = n; p; p = p.parent ? by.get(p.parent) : null) if (p.props?.visible === false) return true; return false; };
  const boxes = [], tris = [], boxAlpha = [], triAlpha = [];
  for (const n of scene.nodes) {
    const o = n.props?.occluder;
    if (!o || hidden(n)) continue;
    const a = typeof o.alpha === 'number' ? o.alpha : 1;
    if (Array.isArray(o.box)) { boxes.push(o.box); boxAlpha.push(a); }
    for (const b of o.boxes || []) { boxes.push(b); boxAlpha.push(a); }
    for (const t of o.tris || []) { tris.push(t); triAlpha.push(a); }
  }
  return { boxes, tris, boxAlpha, triAlpha };
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

/* ============================== LUT .cube ============================== */
const lutCache = new Map();
/** 3D LUT формата .cube (Resolve/Adobe): { size, data Float32 (r быстрее всех), min, max }. */
export function loadCube(src, baseDir) {
  const key = `${baseDir || ''}|${src}`;
  if (lutCache.has(key)) return lutCache.get(key);
  let lut = null;
  try {
    const text = src.includes('\n') ? src : readFileSync(resolvePath(baseDir || '.', src), 'utf8');
    let size = 0, min = [0, 0, 0], max = [1, 1, 1];
    const vals = [];
    for (const raw of text.split(/\r?\n/)) {
      const ln = raw.trim();
      if (!ln || ln[0] === '#') continue;
      const p = ln.split(/\s+/);
      if (p[0] === 'LUT_3D_SIZE') size = +p[1];
      else if (p[0] === 'DOMAIN_MIN') min = p.slice(1, 4).map(Number);
      else if (p[0] === 'DOMAIN_MAX') max = p.slice(1, 4).map(Number);
      else if (/^[-\d.]/.test(p[0]) && p.length >= 3) vals.push(+p[0], +p[1], +p[2]);
    }
    if (size >= 2 && vals.length >= size ** 3 * 3) lut = { size, data: Float32Array.from(vals.slice(0, size ** 3 * 3)), min, max };
  } catch { lut = null; }
  lutCache.set(key, lut);
  return lut;
}
function lutSample(lut, r, g, b, out) {
  const N = lut.size, d = lut.data, m = N - 1;
  const fx = clamp01((r - lut.min[0]) / (lut.max[0] - lut.min[0])) * m, fy = clamp01((g - lut.min[1]) / (lut.max[1] - lut.min[1])) * m, fz = clamp01((b - lut.min[2]) / (lut.max[2] - lut.min[2])) * m;
  const x0 = Math.min(m - 1, Math.floor(fx)), y0 = Math.min(m - 1, Math.floor(fy)), z0 = Math.min(m - 1, Math.floor(fz)), tx = fx - x0, ty = fy - y0, tz = fz - z0;
  for (let c = 0; c < 3; c++) {
    const at = (x, y, z) => d[((z * N + y) * N + x) * 3 + c];
    const c00 = at(x0, y0, z0) * (1 - tx) + at(x0 + 1, y0, z0) * tx, c10 = at(x0, y0 + 1, z0) * (1 - tx) + at(x0 + 1, y0 + 1, z0) * tx;
    const c01 = at(x0, y0, z0 + 1) * (1 - tx) + at(x0 + 1, y0, z0 + 1) * tx, c11 = at(x0, y0 + 1, z0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1, z0 + 1) * tx;
    out[c] = (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
  }
}
/** Цветокоррекция кадра (sRGB 0..1, на месте): lift/gamma/gain, contrast, split toning, LUT. */
function applyGrade(g, img, n, baseDir) {
  const { lift, gamma, gain } = g, sp = g.split, con = g.contrast ?? 1;
  const lut = g.lut ? loadCube(g.lut, baseDir) : null, la = g.lutAmount ?? 1, tmp = [0, 0, 0];
  const lum3 = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const shL = sp ? lum3(sp.shadows) : 0, hiL = sp ? lum3(sp.highlights) : 0;
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    for (let c = 0; c < 3; c++) {
      let v = img[j + c];
      v = gain[c] * (v + lift[c] * (1 - v));
      v = Math.pow(Math.max(0, v), 1 / (gamma[c] || 1));
      if (con !== 1) v = (v - 0.5) * con + 0.5;
      img[j + c] = v;
    }
    if (sp) {
      const l = clamp01(0.2126 * img[j] + 0.7152 * img[j + 1] + 0.0722 * img[j + 2]), b = sp.balance;
      const ws = clamp01(1 - l - b) ** 2 * sp.amount * 2, wh = clamp01(l - b) ** 2 * sp.amount * 2;
      for (let c = 0; c < 3; c++) img[j + c] += (sp.shadows[c] - shL) * ws + (sp.highlights[c] - hiL) * wh;
    }
    if (lut) {
      lutSample(lut, clamp01(img[j]), clamp01(img[j + 1]), clamp01(img[j + 2]), tmp);
      for (let c = 0; c < 3; c++) img[j + c] += (tmp[c] - img[j + c]) * la;
    }
    for (let c = 0; c < 3; c++) img[j + c] = clamp01(img[j + c]);
  }
}

/* ============================== главное ============================== */
const lin22 = (v) => Math.pow(Math.max(0, v), 2.2);
/**
 * Кадр с отложенным светом. Возвращает { png, image, debug? (PNG листа «цвет / нормали / тени+AO / итог»), stats }.
 * opts: width, states, lighting (поверх scene.lighting), style (поверх scene.style), debug, passes (готовые PNG проходов),
 * baseDir (относительные пути текстур, LUT, карт высот).
 */
export async function renderLit(scene, t = 0, opts = {}) {
  const t0 = Date.now();
  if (!scene.camera3d) throw new Error('Отложенный свет требует scene.camera3d (camera3d_set): без камеры позиции пикселей не восстановить.');
  scene = heightToNormalSrc(scene, opts.baseDir);
  const W0 = scene.width, H0 = scene.height;
  const W = Math.max(16, Math.round(opts.width ?? W0)), H = Math.max(9, Math.round((W * H0) / W0)), k = W / W0, n = W * H;
  const st = resolveLighting(scene, opts.lighting);
  const style = resolveStyle(scene, opts.style);
  const chrTag = st.characters.tag;
  const mats = needsMatId(scene) ? prepareMaterials(scene) : [];
  const pngs = opts.passes || await renderPasses(scene, t, { width: W, states: opts.states, masks: [chrTag], raw: true });
  // проходы — PNG (готовые от вызывающего) или RGBA-картинки
  const imgOf = (m) => (pngs[m]?.data && pngs[m].width ? pngs[m] : decodePNG(pngs[m]));
  const dec = (m) => { const im = imgOf(m); if (im.width !== W || im.height !== H) throw new Error(`проход ${m}: ${im.width}×${im.height} вместо ${W}×${H}`); return im.data; };
  const alb = dec('color'), nrm = dec('normal'), pn = dec('plane'), pdm = dec('planeD'), em = dec('emissive'), ink = dec('ink'), cov = dec('cover'), chrD = dec(`mask:${chrTag}`);
  const midD = mats.length && pngs.matId ? dec('matId') : null;
  const tPass = Date.now();
  const tm = {};
  let tq = Date.now();
  const lap = (name) => { const now = Date.now(); tm[name] = now - tq; tq = now; };

  // ---------- камера и позиции ----------
  const c3 = scene.camera3d;
  const cm = cameraModel({ dz: 0, ...c3 }, W0);
  const f = cm.f * k, hor = cm.horEff * k, cx = cm.cx * k, camH = cm.camH, dz = cm.dz;
  const [camX, camY, camZ] = cm.pos;
  const plain = cm.plain, CR = cm.right, CU = cm.up, CF = cm.fwd;
  /** Проекция мировой точки в пиксели кадра: out = [x, y, глубина вдоль оси камеры] (общая модель камеры движка). */
  const proj = cm.projector(k);
  const mask = new Uint8Array(n), cover = new Uint8Array(n), chm = new Float32Array(n), inkL = new Float32Array(n);
  const Nx = new Float32Array(n), Ny = new Float32Array(n), Nz = new Float32Array(n);
  const PNx = new Float32Array(n), PNy = new Float32Array(n), PNz = new Float32Array(n);
  const Px = new Float32Array(n), Py = new Float32Array(n), Pz = new Float32Array(n), spec = new Float32Array(n), Dp = new Float32Array(n);
  const mid = midD ? new Uint16Array(n) : null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = i * 4;
    mask[i] = pn[o + 3] > 127.5 ? 1 : 0;
    cover[i] = cov[o] > 127 ? 1 : 0;
    chm[i] = (0.299 * chrD[o] + 0.587 * chrD[o + 1] + 0.114 * chrD[o + 2]) / 255;
    inkL[i] = (0.299 * ink[o] + 0.587 * ink[o + 1] + 0.114 * ink[o + 2]) / 255;
    if (mid && midD[o + 3] > 127) mid[i] = (midD[o] << 8) | midD[o + 1];
    let ax = pn[o] / 127.5 - 1, ay = pn[o + 1] / 127.5 - 1, az = pn[o + 2] / 127.5 - 1, l = Math.hypot(ax, ay, az) + 1e-6;
    ax /= l; ay /= l; az /= l;
    PNx[i] = ax; PNy[i] = ay; PNz[i] = az;
    if (nrm[o + 3] > 127.5) { let bx = nrm[o] / 127.5 - 1, by = nrm[o + 1] / 127.5 - 1, bz = nrm[o + 2] / 127.5 - 1; const m = Math.hypot(bx, by, bz) + 1e-6; Nx[i] = bx / m; Ny[i] = by / m; Nz[i] = bz / m; }
    else { Nx[i] = ax; Ny[i] = ay; Nz[i] = az; }
    const d = ((pdm[o] << 8) + pdm[o + 1]) / 100 - 200;
    spec[i] = pdm[o + 2] / 255;
    let dx, dy, dzz;
    if (plain) { dx = (x + 0.5 - cx) / f; dy = -(y + 0.5 - hor) / f; dzz = 1; }
    else { const a = (x + 0.5 - cx) / f, b = -(y + 0.5 - hor) / f; dx = a * CR[0] + b * CU[0] + CF[0]; dy = a * CR[1] + b * CU[1] + CF[1]; dzz = a * CR[2] + b * CU[2] + CF[2]; }
    let den = ax * dx + ay * dy + az * dzz;
    if (Math.abs(den) < 1e-4) den = den < 0 ? -1e-4 : 1e-4;
    let tt = (d - (ax * camX + ay * camY + az * camZ)) / den;
    if (!(mask[i] && tt > 0)) tt = 1e4;
    Px[i] = camX + dx * tt; Py[i] = camY + dy * tt; Pz[i] = camZ + dzz * tt;
    Dp[i] = plain ? Pz[i] + dz : tt;
  }
  lap('positions');

  // ---------- окклюдеры: BVH ----------
  const occ = occluders(scene);
  const hasOcc = occ.boxes.length + occ.tris.length > 0;
  const bvh = hasOcc ? buildBVH(occ) : null;
  const trace = bvh ? bvh.occluded : () => false;
  lap('bvh');

  // ---------- солнце: тени лучами (половинное разрешение) ----------
  const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2), hn = hw * hh;
  const L = st.sun.dir;
  const shH = new Float32Array(hn).fill(1);
  let rays = 0;
  const sunAngle = Math.max(0, st.sun.angle || 0);
  let shadow;
  if (opts.bake) shadow = new Float32Array(n).fill(1); // запекание альбедо: тени не нужны
  else if (!(sunAngle > 0)) {
    if (st.sun.shadows !== false && hasOcc) {
      for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
        const i = 2 * y * W + 2 * x;
        if (!mask[i] || PNx[i] * L[0] + PNy[i] * L[1] + PNz[i] * L[2] <= -0.05) continue;
        rays++;
        if (trace(Px[i] + PNx[i] * 0.04, Py[i] + PNy[i] * 0.04, Pz[i] + PNz[i] * 0.04, L[0], L[1], L[2], 1e9, i)) shH[y * hw + x] = 0;
      }
    }
    shadow = zoom2(gauss(shH, hw, hh, 0.9), hw, hh, W, H);
  } else {
    // мягкая полутень: луч к случайной точке диска солнца (угловой размер sunAngle°), расстояние до заслонки → ширина
    // полутени в пикселях; размытие уровнями совместного билатерального фильтра, уровень — по ширине полутени
    const half = ((sunAngle * Math.PI) / 180) / 2, tanH = Math.tan(half);
    const T1 = nz(Math.abs(L[1]) < 0.9 ? [L[2], 0, -L[0]] : [1, 0, 0]), T2 = [L[1] * T1[2] - L[2] * T1[1], L[2] * T1[0] - L[0] * T1[2], L[0] * T1[1] - L[1] * T1[0]];
    const pen = new Float32Array(hn), hm = new Uint8Array(hn), hD = new Float32Array(hn), hx = new Float32Array(hn), hy = new Float32Array(hn), hz = new Float32Array(hn);
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
      const i = 2 * y * W + 2 * x, j = y * hw + x;
      hm[j] = mask[i]; hD[j] = Dp[i]; hx[j] = PNx[i]; hy[j] = PNy[i]; hz[j] = PNz[i];
    }
    if (st.sun.shadows !== false && bvh) {
      for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
        const i = 2 * y * W + 2 * x, j = y * hw + x;
        if (!mask[i] || PNx[i] * L[0] + PNy[i] * L[1] + PNz[i] * L[2] <= -0.05) continue;
        rays++;
        const r = tanH * Math.sqrt(hash01(j, 1)), ph = 6.2831853 * hash01(j, 2), a = r * Math.cos(ph), b = r * Math.sin(ph);
        let dx = L[0] + T1[0] * a + T2[0] * b, dy = L[1] + T1[1] * a + T2[1] * b, dzz = L[2] + T1[2] * a + T2[2] * b;
        const dl = Math.hypot(dx, dy, dzz); dx /= dl; dy /= dl; dzz /= dl;
        const th = bvh.closest(Px[i] + PNx[i] * 0.04, Py[i] + PNy[i] * 0.04, Pz[i] + PNz[i] * 0.04, dx, dy, dzz, 1e9, j);
        if (th < Infinity) { shH[j] = 0; pen[j] = (th * tanH * 2 * f) / 2 / Math.max(0.3, Dp[i]); }
      }
    }
    // ширина полутени — и на освещённые соседние пиксели (нормированное размытие по затенённым)
    const occF = new Float32Array(hn);
    for (let j = 0; j < hn; j++) if (!shH[j]) occF[j] = 1;
    const sc = Math.max(1, hw / 960), num = gauss(pen, hw, hh, 5 * sc), den = gauss(occF, hw, hh, 5 * sc);
    const levels = [0.9, 2.2 * sc, 5 * sc], blur = levels.map((s) => bilateral(shH, hw, hh, s, hD, hx, hy, hz, hm));
    const sh2 = new Float32Array(hn);
    for (let j = 0; j < hn; j++) {
      const p = den[j] > 1e-3 ? Math.max(pen[j], num[j] / den[j]) : 0, s = Math.max(levels[0], Math.min(levels[2], p * 0.5));
      if (s <= levels[1]) { const q = (s - levels[0]) / (levels[1] - levels[0]); sh2[j] = blur[0][j] * (1 - q) + blur[1][j] * q; }
      else { const q = (s - levels[1]) / (levels[2] - levels[1]); sh2[j] = blur[1][j] * (1 - q) + blur[2][j] * q; }
    }
    shadow = zoom2(sh2, hw, hh, W, H);
  }
  lap('sun');

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
  lap('ao');

  // ---------- альбедо и попиксельные материалы ----------
  const sunC = st.sun.color.map((v) => v * st.sun.energy), skyC = st.sky.color.map((v) => v * st.sky.energy), gC = st.ground.color.map((v) => v * st.ground.energy);
  const lin = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) lin[i * 3 + c] = Math.pow(alb[i * 4 + c] / 255, 2.2);
  let matPixels = 0;
  if (mid) matPixels = applyMaterials(mats, { W, H, mid, lin, Nx, Ny, Nz, PNx, PNy, PNz, Px, Py, Pz, ao, baseDir: opts.baseDir });
  lap('materials');
  if (opts.bake === 'albedo') {
    // альбедо с попиксельными материалами (для экспорта слоёв): цвет прохода color, где материала нет
    const data = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      for (let c = 0; c < 3; c++) data[o + c] = mid && mid[i] ? Math.round(clamp01(Math.pow(lin[i * 3 + c], 1 / 2.2)) * 255) : alb[o + c];
      data[o + 3] = alb[o + 3];
    }
    const image = { width: W, height: H, data };
    return { image, png: encodePNG(image), stats: { width: W, height: H, materials: mats.length, matPixels, ms: Date.now() - t0 } };
  }

  // ---------- освещение ----------
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
  lap('shade');
  // точечные источники
  const lights = deferredLights(scene, t, opts.states);
  const pr = [0, 0, 0];
  /** Экранная рамка влияния лампы (проекция сферы радиуса r с запасом) или null. */
  const lampRect = (lx, ly, lz, r) => {
    let xa, xb, ya, yb;
    if (plain) {
      const zc = Math.max(0.3, lz - r + dz);
      const sx = cx + (f * lx) / (lz + dz), sy = hor + (f * (camH - ly)) / (lz + dz), sr = (f * r) / zc + 4;
      xa = Math.max(0, Math.floor(sx - sr)); xb = Math.min(W - 1, Math.ceil(sx + sr)); ya = Math.max(0, Math.floor(sy - sr)); yb = Math.min(H - 1, Math.ceil(sy + sr));
    } else {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, behind = false;
      for (let q = 0; q < 8; q++) {
        proj(lx + (q & 1 ? r : -r), ly + (q & 2 ? r : -r), lz + (q & 4 ? r : -r), pr);
        if (pr[2] < 0.3) { behind = true; break; }
        x0 = Math.min(x0, pr[0]); x1 = Math.max(x1, pr[0]); y0 = Math.min(y0, pr[1]); y1 = Math.max(y1, pr[1]);
      }
      if (behind) { x0 = 0; x1 = W - 1; y0 = 0; y1 = H - 1; }
      xa = Math.max(0, Math.floor(x0 - 4)); xb = Math.min(W - 1, Math.ceil(x1 + 4)); ya = Math.max(0, Math.floor(y0 - 4)); yb = Math.min(H - 1, Math.ceil(y1 + 4));
    }
    return xa > xb || ya > yb ? null : [xa, xb, ya, yb];
  };
  const lampGain = (lt) => { const g = st.groups?.[lt.group] ?? (lt.group === 'candle' ? st.groups?.lamp : undefined) ?? 1; return g * (lt.enabled === false ? 0 : 1); };
  let litCount = 0;
  for (const lt of lights) {
    const kk = lampGain(lt);
    if (kk <= 0 || !(lt.radius > 0)) continue;
    const lc = rgb(lt.color).map((v) => lin22(v) * lt.energy * kk * 2.2);
    const [lx, ly, lz] = lt.p3, r = lt.radius;
    const rect = lampRect(lx, ly, lz, r);
    if (!rect) continue;
    const [xa, xb, ya, yb] = rect;
    litCount++;
    const shadowed = (lt.shadows ?? lt.group === 'lamp') && st.lightShadows && hasOcc;
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
        if (trace(Px[i] + PNx[i] * 0.04, Py[i] + PNy[i] * 0.04, Pz[i] + PNz[i] * 0.04, ddx / dist, ddy / dist, ddz / dist, dist - 0.35, i)) tmp[y * vw + x] = 0;
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
  lap('lamps');

  // ---------- отражённый свет (GI): один отскок в экранном пространстве, половинное разрешение ----------
  if (st.gi && st.gi.strength > 0) {
    const G = st.gi, rad = G.radius ?? 2.5;
    const hx = new Float32Array(hn), hy = new Float32Array(hn), hz = new Float32Array(hn), hnx = new Float32Array(hn), hny = new Float32Array(hn), hnz = new Float32Array(hn), hm = new Uint8Array(hn), hD = new Float32Array(hn);
    const radc = [new Float32Array(hn), new Float32Array(hn), new Float32Array(hn)];
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
      const i = 2 * y * W + 2 * x, j = y * hw + x;
      hm[j] = mask[i]; hx[j] = Px[i]; hy[j] = Py[i]; hz[j] = Pz[i]; hnx[j] = Nx[i]; hny[j] = Ny[i]; hnz[j] = Nz[i]; hD[j] = Dp[i];
      // излучение отправителя: прямой свет солнца и ламп × альбедо (небо отражённым светом не считаем)
      if (mask[i]) for (let c = 0; c < 3; c++) radc[c][j] = lin[i * 3 + c] * (light[i * 3 + c] - (skyC[c] * (0.5 + 0.5 * Ny[i]) + gC[c] * (0.5 - 0.5 * Ny[i])) * ao[i]);
    }
    const gi = [new Float32Array(hn), new Float32Array(hn), new Float32Array(hn)];
    const radii = [5, 12, 26, 52].map((r) => r * (W / 2560) * (G.scale ?? 1)), dirs = 6, taps = radii.length * dirs;
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
      const j = y * hw + x;
      if (!hm[j]) continue;
      const rot = hash01(j, 7) * 6.2831853;
      let ar = 0, ag = 0, ab = 0;
      for (let ri = 0; ri < radii.length; ri++) for (let q = 0; q < dirs; q++) {
        const a = rot + (q * 6.2831853) / dirs + ri * 0.9, rr = radii[ri] * (0.75 + 0.5 * hash01(j * 31 + ri * dirs + q, 9));
        const sx = Math.round(x + Math.cos(a) * rr), sy = Math.round(y + Math.sin(a) * rr);
        if (sx < 0 || sy < 0 || sx >= hw || sy >= hh) continue;
        const s = sy * hw + sx;
        if (!hm[s]) continue;
        const vx = hx[s] - hx[j], vy = hy[s] - hy[j], vz = hz[s] - hz[j], d = Math.hypot(vx, vy, vz) + 1e-4;
        const cr = (vx * hnx[j] + vy * hny[j] + vz * hnz[j]) / d, cs = -(vx * hnx[s] + vy * hny[s] + vz * hnz[s]) / d;
        if (cr <= 0.05 || cs <= 0.05) continue;
        const w = (cr * cs) / (1 + (d / rad) ** 2);
        ar += radc[0][s] * w; ag += radc[1][s] * w; ab += radc[2][s] * w;
      }
      const kk = (G.strength * 2.4) / taps;
      gi[0][j] = ar * kk; gi[1][j] = ag * kk; gi[2][j] = ab * kk;
    }
    const sgi = Math.max(1, hw / 640);
    for (let c = 0; c < 3; c++) {
      const up = zoom2(bilateral(gi[c], hw, hh, 2.5 * sgi, hD, hnx, hny, hnz, hm), hw, hh, W, H);
      for (let i = 0; i < n; i++) if (mask[i]) light[i * 3 + c] += up[i] * (0.4 + 0.6 * ao[i]);
    }
    lap('gi');
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
    const tH = Math.max(0.01, (cm.horEff + 120) / H0);
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
  lap('compose');

  // ---------- отражения в экранном пространстве (полы с бликом: паркет, мокрый камень) ----------
  let ssrPixels = 0;
  if (st.reflections && st.reflections.strength > 0) {
    const R = st.reflections, steps = Math.max(8, R.steps | 0), maxD = R.maxDist, thick = R.thickness, minS = R.minSpec;
    const src = new Float32Array(col);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i] || spec[i] < minS || chm[i] > 0.5) continue;
      if (R.floorOnly && PNy[i] < 0.85) continue;
      let vx = Px[i] - camX, vy = Py[i] - camY, vz = Pz[i] - camZ;
      const vl = Math.hypot(vx, vy, vz); vx /= vl; vy /= vl; vz /= vl;
      const nx = Nx[i], ny = Ny[i], nzz = Nz[i], dn = vx * nx + vy * ny + vz * nzz;
      const rx = vx - 2 * dn * nx, ry = vy - 2 * dn * ny, rz = vz - 2 * dn * nzz;
      if (ry <= 0.01) continue;
      ssrPixels++;
      const ox = Px[i] + PNx[i] * 0.02, oy = Py[i] + PNy[i] * 0.02, oz = Pz[i] + PNz[i] * 0.02;
      let tPrev = 0, hit = -1, tHit = 0;
      const dt = maxD / steps;
      for (let s = 1; s <= steps; s++) {
        const tt = dt * s * (0.6 + 0.4 * (s / steps)) * (0.92 + 0.08 * hash01(i, 11));
        proj(ox + rx * tt, oy + ry * tt, oz + rz * tt, pr);
        const qx = pr[0] | 0, qy = pr[1] | 0;
        if (pr[2] <= 0.05 || qx < 0 || qy < 0 || qx >= W || qy >= H) break;
        const qi = qy * W + qx, ds = mask[qi] ? Dp[qi] : 1e4;
        if (pr[2] > ds + 0.01 && pr[2] - ds < thick + tt * 0.08) {
          // уточнение бинарным поиском
          let a = tPrev, b = tt;
          for (let r = 0; r < 4; r++) {
            const m = (a + b) / 2;
            proj(ox + rx * m, oy + ry * m, oz + rz * m, pr);
            const mx = Math.min(W - 1, Math.max(0, pr[0] | 0)), my = Math.min(H - 1, Math.max(0, pr[1] | 0)), mi = my * W + mx;
            if (pr[2] > (mask[mi] ? Dp[mi] : 1e4) + 0.01) b = m; else a = m;
          }
          proj(ox + rx * b, oy + ry * b, oz + rz * b, pr);
          const hx = Math.min(W - 1, Math.max(0, pr[0] | 0)), hy = Math.min(H - 1, Math.max(0, pr[1] | 0));
          hit = hy * W + hx; tHit = b;
          break;
        }
        if (!mask[qi] && pr[2] > 30) { hit = qi; tHit = tt; break; } // ушёл в небо
        tPrev = tt;
      }
      if (hit < 0) continue;
      const hx = hit % W, hy = (hit / W) | 0;
      const edge = Math.min(1, hx / (W * 0.06), (W - 1 - hx) / (W * 0.06), hy / (H * 0.06), (H - 1 - hy) / (H * 0.06));
      const cosv = Math.abs(dn), fres = 0.25 + 0.75 * (1 - cosv) ** 3;
      const a = clamp01(R.strength * spec[i] * fres * clamp01(edge) * (1 - tHit / maxD) ** 0.5);
      for (let c = 0; c < 3; c++) col[i * 3 + c] = col[i * 3 + c] * (1 - a * 0.6) + src[hit * 3 + c] * a;
    }
    lap('ssr');
  }

  // ---------- объёмный свет: лучи солнца в дымке и ореолы ламп ----------
  const V = st.volumetric;
  if (V) {
    const vf = 4, vw = Math.ceil(W / vf), vh = Math.ceil(H / vf), vn = vw * vh, steps = Math.max(4, V.steps | 0);
    const g = V.g ?? 0.5, dens = V.density, vc = V.color;
    const hg = (c) => (1 - g * g) / Math.pow(1 + g * g - 2 * g * c, 1.5);
    if (V.sun !== false && dens > 0) {
      const acc = new Float32Array(vn);
      for (let y = 0; y < vh; y++) for (let x = 0; x < vw; x++) {
        const fx = Math.min(W - 1, x * vf + (vf >> 1)), fy = Math.min(H - 1, y * vf + (vf >> 1)), i = fy * W + fx, j = y * vw + x;
        let dx, dy, dzz;
        if (plain) { dx = (fx + 0.5 - cx) / f; dy = -(fy + 0.5 - hor) / f; dzz = 1; }
        else { const a = (fx + 0.5 - cx) / f, b = -(fy + 0.5 - hor) / f; dx = a * CR[0] + b * CU[0] + CF[0]; dy = a * CR[1] + b * CU[1] + CF[1]; dzz = a * CR[2] + b * CU[2] + CF[2]; }
        const dl = Math.hypot(dx, dy, dzz); dx /= dl; dy /= dl; dzz /= dl;
        const tEnd = mask[i] ? Math.min(V.maxDist, Math.hypot(Px[i] - camX, Py[i] - camY, Pz[i] - camZ)) : V.maxDist;
        const dt = tEnd / steps, jit = hash01(j, 13);
        let sum = 0;
        for (let s = 0; s < steps; s++) {
          const tt = (s + jit) * dt;
          const vis = bvh ? (trace(camX + dx * tt, camY + dy * tt, camZ + dzz * tt, L[0], L[1], L[2], 1e9, j * 64 + s) ? 0 : 1) : 1;
          sum += vis * Math.exp(-dens * tt) * dt;
        }
        rays += bvh ? steps : 0;
        acc[j] = sum * dens * hg(dx * L[0] + dy * L[1] + dzz * L[2]);
      }
      const up = upF(gauss(acc, vw, vh, 1.2), vw, vh, vf, W, H);
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) col[i * 3 + c] += up[i] * sunC[c] * vc[c] * 0.6;
    }
    // ореолы ламп: аналитический интеграл рассеяния 1/d² вдоль луча камеры внутри сферы влияния
    if ((V.lamps ?? 0) > 0) {
      const ld = (V.lampDensity ?? 0.025) * V.lamps;
      for (const lt of lights) {
        const kk = lampGain(lt);
        if (kk <= 0 || !(lt.radius > 0) || lt.halo === false) continue;
        const lc = rgb(lt.color).map((v) => lin22(v) * lt.energy * kk * 2.2 * ld * (lt.halo ?? (lt.group === "fairy" ? 0.3 : 1)));
        const [lx, ly, lz] = lt.p3, r = Math.min(lt.radius, (V.haloRadius ?? 0.45) * lt.radius + 0.6), r2 = r * r;
        const rect = lampRect(lx, ly, lz, r);
        if (!rect) continue;
        const [xa, xb, ya, yb] = rect;
        const ex = lx - camX, ey = ly - camY, ez = lz - camZ, e2 = ex * ex + ey * ey + ez * ez;
        for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
          const i = y * W + x;
          let dx, dy, dzz;
          if (plain) { dx = (x + 0.5 - cx) / f; dy = -(y + 0.5 - hor) / f; dzz = 1; }
          else { const a = (x + 0.5 - cx) / f, b = -(y + 0.5 - hor) / f; dx = a * CR[0] + b * CU[0] + CF[0]; dy = a * CR[1] + b * CU[1] + CF[1]; dzz = a * CR[2] + b * CU[2] + CF[2]; }
          const dl = Math.hypot(dx, dy, dzz); dx /= dl; dy /= dl; dzz /= dl;
          const tc = ex * dx + ey * dy + ez * dzz, h2v = Math.max(1e-4, e2 - tc * tc);
          if (h2v >= r2) continue;
          const core = 0.12, hv = Math.sqrt(h2v + core * core), half = Math.sqrt(r2 - h2v);
          const tEnd = mask[i] ? Math.hypot(Px[i] - camX, Py[i] - camY, Pz[i] - camZ) : 1e9;
          const ta = Math.max(0, tc - half), tb = Math.min(tEnd, tc + half);
          if (tb <= ta) continue;
          const I = (Math.atan((tb - tc) / hv) - Math.atan((ta - tc) / hv)) / hv - (tb - ta) / r2;
          if (I <= 0) continue;
          for (let c = 0; c < 3; c++) col[i * 3 + c] += I * lc[c];
        }
      }
    }
    lap('volumetric');
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
  if (st.grade) applyGrade(st.grade, img, n, opts.baseDir);
  lap('post');

  // ---------- стиль ----------
  let out = img;
  for (const s of style) out = applyStyle(s, out, { W, H, W0, k, mask, chm, inkL, alb, Dp });
  lap('style');

  const rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(clamp01(out[i * 3 + c]) * 255); rgba[i * 4 + 3] = 255; }
  const image = { width: W, height: H, data: rgba };
  const res = { image, png: encodePNG(image), stats: { width: W, height: H, preset: st.preset, style: style.map((s) => s.type), lights: lights.length, litLights: litCount, boxes: occ.boxes.length, tris: occ.tris.length, rays,
    ...(sunAngle > 0 ? { sunAngle } : {}), ...(mats.length ? { materials: mats.length, matPixels } : {}), ...(st.gi ? { gi: true } : {}), ...(V ? { volumetric: true } : {}), ...(st.reflections ? { ssrPixels } : {}),
    passMs: tPass - t0, stageMs: tm, ms: Date.now() - t0 } };
  if (opts.debug) {
    const so = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { const v = Math.round(clamp01(shadow[i] * ao[i]) * 255); so[i * 4] = so[i * 4 + 1] = so[i * 4 + 2] = v; so[i * 4 + 3] = 255; }
    const cell = Math.min(W, opts.debugWidth || 960);
    const im = (d) => scaleDown(d, cell);
    const top = sideBySide([im(imgOf('color')), im(imgOf('normal'))]), bot = sideBySide([im({ width: W, height: H, data: so }), im(image)]);
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

/** Расширение маски линий (max в окне 3×3). */
function dilate3(a, w, h) {
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const v = a[yy * w + xx]; if (v > m) m = v; } }
    o[y * w + x] = m;
  }
  return o;
}

/** Пост-эффект стиля над изображением img (Float32 RGB 0..1, n·3). */
function applyStyle(s, img, { W, H, W0, k, mask, chm, inkL, alb, Dp }) {
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
    case 'paint': {
      // анизотропный Кувахара: окно-эллипс вытянуто вдоль штриха (тензор структуры), 8 секторов со взвешиванием
      // по дисперсии (обобщённый Кувахара, q = 8) — мазки идут по форме, края остаются чистыми
      const R = Math.max(1.5, (s.radius ?? 4) * Math.max(0.4, sk * 1.6)), q = s.sharpness ?? 8, alpha = 1;
      const Lm = new Float32Array(n);
      for (let i = 0; i < n; i++) Lm[i] = 0.299 * img[i * 3] + 0.587 * img[i * 3 + 1] + 0.114 * img[i * 3 + 2];
      const E = new Float32Array(n), F = new Float32Array(n), G = new Float32Array(n);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const xm = x > 0 ? x - 1 : 0, xp = x < W - 1 ? x + 1 : x, ym = y > 0 ? y - 1 : 0, yp = y < H - 1 ? y + 1 : y;
        const a = (r, c) => Lm[r * W + c];
        const gx = (a(ym, xp) + 2 * a(y, xp) + a(yp, xp) - a(ym, xm) - 2 * a(y, xm) - a(yp, xm)) / 4;
        const gy = (a(yp, xm) + 2 * a(yp, x) + a(yp, xp) - a(ym, xm) - 2 * a(ym, x) - a(ym, xp)) / 4;
        const i = y * W + x; E[i] = gx * gx; F[i] = gx * gy; G[i] = gy * gy;
      }
      const ss = Math.max(1, 2 * Math.max(0.5, sk * 1.5)), Es = gauss(E, W, H, ss), Fs = gauss(F, W, H, ss), Gs = gauss(G, W, H, ss);
      // выборка в единичном круге: центр + кольца; сектор каждой точки фиксирован (в локальных осях)
      const pts = [];
      for (const [rr, cnt] of [[0.35, 8], [0.68, 12], [1, 16]]) for (let j = 0; j < cnt; j++) { const a = ((j + 0.5) / cnt) * 6.2831853; pts.push([rr * Math.cos(a), rr * Math.sin(a), Math.floor((a / 6.2831853) * 8) & 7]); }
      const np = pts.length, out = new Float32Array(n * 3);
      const sm = new Float64Array(8 * 3), sq = new Float64Array(8), cn = new Float64Array(8);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, e = Es[i], ff = Fs[i], g = Gs[i];
        const dsc = Math.sqrt((e - g) * (e - g) + 4 * ff * ff), l1 = (e + g + dsc) / 2, l2 = (e + g - dsc) / 2;
        let tx = l1 - e, ty = -ff;
        const tl = Math.hypot(tx, ty);
        if (tl > 1e-9) { tx /= tl; ty /= tl; } else { tx = 1; ty = 0; }
        const A = l1 + l2 > 1e-9 ? (l1 - l2) / (l1 + l2) : 0;
        const ea = (R * (alpha + A)) / alpha, eb = (R * alpha) / (alpha + A);
        sm.fill(0); sq.fill(0); cn.fill(0);
        const c0r = img[i * 3], c0g = img[i * 3 + 1], c0b = img[i * 3 + 2];
        for (let sct = 0; sct < 8; sct++) { sm[sct * 3] = c0r; sm[sct * 3 + 1] = c0g; sm[sct * 3 + 2] = c0b; sq[sct] = c0r * c0r + c0g * c0g + c0b * c0b; cn[sct] = 1; }
        for (let p = 0; p < np; p++) {
          const u = pts[p][0] * ea, v = pts[p][1] * eb;
          const sx = Math.round(x + u * tx - v * ty), sy = Math.round(y + u * ty + v * tx);
          const xx = sx < 0 ? 0 : sx >= W ? W - 1 : sx, yy = sy < 0 ? 0 : sy >= H ? H - 1 : sy, j = (yy * W + xx) * 3;
          const sct = pts[p][2], r0 = img[j], g0 = img[j + 1], b0 = img[j + 2];
          sm[sct * 3] += r0; sm[sct * 3 + 1] += g0; sm[sct * 3 + 2] += b0; sq[sct] += r0 * r0 + g0 * g0 + b0 * b0; cn[sct]++;
        }
        let wr = 0, wg = 0, wb = 0, ws = 0;
        for (let sct = 0; sct < 8; sct++) {
          // сектор + соседний (перекрытие 90°) — мягче, без «ступенек»
          const s2 = (sct + 1) & 7, c = cn[sct] + cn[s2];
          const mr = (sm[sct * 3] + sm[s2 * 3]) / c, mg = (sm[sct * 3 + 1] + sm[s2 * 3 + 1]) / c, mb = (sm[sct * 3 + 2] + sm[s2 * 3 + 2]) / c;
          const vr = Math.max(0, (sq[sct] + sq[s2]) / c - (mr * mr + mg * mg + mb * mb));
          const w = 1 / (1 + Math.pow(Math.sqrt(vr) * 255, q / 2) * 1e-6);
          wr += mr * w; wg += mg * w; wb += mb * w; ws += w;
        }
        out[i * 3] = wr / ws; out[i * 3 + 1] = wg / ws; out[i * 3 + 2] = wb / ws;
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
      const a0 = s.strength ?? 1, out = new Float32Array(n * 3);
      const byAlb = s.color === 'albedo', hc = byAlb ? null : s.color || [0, 0, 0], dk = s.darken ?? 0.3;
      let cov = null;
      if (s.depthWidth) {
        // толщина линии по глубине: ближе — толще (до 3 px расширения), дальше — тоньше и бледнее
        const a = new Float32Array(n);
        for (let i = 0; i < n; i++) a[i] = 1 - inkL[i];
        const a1 = dilate3(a, W, H), a2 = dilate3(a1, W, H), ref = s.refDepth ?? 6, gain = s.depthWidth * Math.max(0.5, W / 1920);
        cov = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const d = mask[i] ? Dp[i] : 1e3, rr = Math.min(3, Math.max(0.3, (ref / Math.max(0.5, d)) * gain));
          cov[i] = rr < 1 ? a[i] * Math.pow(rr, 0.7) : rr < 2 ? a[i] + (a1[i] - a[i]) * (rr - 1) * 0.8 : a1[i] * 0.8 + a[i] * 0.2 + (a2[i] - a1[i]) * (rr - 2) * 0.6;
        }
      }
      for (let i = 0; i < n; i++) {
        const a = (cov ? cov[i] : 1 - inkL[i]) * a0;
        if (byAlb) for (let c = 0; c < 3; c++) { const lc = (alb[i * 4 + c] / 255) * dk; out[i * 3 + c] = img[i * 3 + c] * (1 - a) + lc * a; }
        else for (let c = 0; c < 3; c++) out[i * 3 + c] = img[i * 3 + c] * (1 - a) + hc[c] * a;
      }
      return out;
    }
    case 'paper': {
      // фактура бумаги: зерно + волокна (шум в координатах эталонного кадра 2560 — одинаково при любой ширине)
      const a0 = s.strength ?? 0.08, tint = s.color ? s.color : [0.98, 0.95, 0.88], ta = s.tint ?? 0.12, sc = (s.scale ?? 1) * sk, out = new Float32Array(n * 3);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, X = x / sc, Y = y / sc;
        const g = noise3(X * 0.45, Y * 0.45, 0.5, 71) * 0.55 + noise3(X * 0.12, Y * 0.12, 1.5, 73) * 0.3 + noise3(X * 0.02, Y * 0.35, 2.5, 79) * 0.35;
        const m = 1 + g * a0;
        for (let c = 0; c < 3; c++) { const v = img[i * 3 + c] * m; out[i * 3 + c] = clamp01(v * (1 - ta) + v * tint[c] * ta); }
      }
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
