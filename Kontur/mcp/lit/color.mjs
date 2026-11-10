// Цвет кадра: тонмаппинг (ACES, AgX, по максимуму канала), перенос палитры с референса (Lab), LUT .cube,
// цветокоррекция (lift/gamma/gain, контраст, split toning), медианное сечение палитры (pixelate).
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { toLin, toGam } from '../../engine/kontur.js';
import { decodeImage } from '../render.mjs';
import { fileStamp } from '../files.mjs';
import { clamp01 } from './util.mjs';
import { tryGPU } from './gpu.mjs';
import { gpuTonemap, gpuMatch, gpuGrade } from './gpu-post.mjs';

/* ============================== тонмаппинг ============================== */
export const acesC = (x) => clamp01((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
/** Линейное → экранное (гамма 2.2). */
const gam22 = (x) => Math.pow(x, 1 / 2.2);
/**
 * AgX (минимальная аппроксимация, sRGB-база): мягкое плечо, насыщенные цвета в светах идут к белому, не меняя тона
 * (ACES уводит насыщенный оранжевый в жёлтый). out — уже экранные значения 0..1.
 */
export function agx(r, g, b, out) {
  const MIN = -12.47393, MAX = 4.026069, R = MAX - MIN;
  const ir = 0.842479062253094 * r + 0.0784335999999992 * g + 0.0792237451477643 * b;
  const ig = 0.0423282422610123 * r + 0.878468636469772 * g + 0.0791661274605434 * b;
  const ib = 0.0423756549057051 * r + 0.0784336 * g + 0.879142973793104 * b;
  const enc = (v) => {
    const x = (Math.min(MAX, Math.max(MIN, Math.log2(Math.max(1e-10, v)))) - MIN) / R, x2 = x * x, x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  };
  const er = enc(ir), eg = enc(ig), eb = enc(ib);
  out[0] = clamp01(1.19687900512017 * er - 0.0980208811401368 * eg - 0.0990297440797205 * eb);
  out[1] = clamp01(-0.0528968517574562 * er + 1.15190312990417 * eg - 0.0989611768448433 * eb);
  out[2] = clamp01(-0.0529716355144438 * er - 0.0980434501171241 * eg + 1.15107367264116 * eb);
}
/** ACES по максимуму канала: отношения каналов (тон и насыщенность) сохраняются, очень яркое плавно уходит в белый. */
export function hueTonemap(r, g, b, out) {
  const m = Math.max(r, g, b);
  if (!(m > 1e-8)) { out[0] = out[1] = out[2] = 0; return; }
  const t = acesC(m), k = t / m, q = clamp01((m - 0.8) / 5.2);
  const w = q * q * (3 - 2 * q) * 0.6;
  out[0] = gam22(clamp01(r * k + (t - r * k) * w));
  out[1] = gam22(clamp01(g * k + (t - g * k) * w));
  out[2] = gam22(clamp01(b * k + (t - b * k) * w));
}
/**
 * Линейный HDR col (n·3) → экранный img 0..1 (n·3): экспозиция, тонмаппинг (aces | agx | hue | none), насыщенность.
 */
export function tonemapFrame(col, n, { exposure = 1, tonemap = 'aces', saturation = 1 } = {}) {
  const img = new Float32Array(n * 3);
  const tmo = tonemap === 'agx' || tonemap === 'hue' ? tonemap : null, px3 = [0, 0, 0], exp = exposure, sat = saturation;
  if (tryGPU('post', n, () => gpuTonemap(col, img, n, { exposure, tonemap, saturation }))) return { img, tonemap: tmo };
  for (let i = 0; i < n; i++) {
    let s = 0;
    if (tmo) {
      const j = i * 3;
      if (tmo === 'agx') agx(col[j] * exp, col[j + 1] * exp, col[j + 2] * exp, px3);
      else hueTonemap(col[j] * exp, col[j + 1] * exp, col[j + 2] * exp, px3);
      for (let c = 0; c < 3; c++) { img[j + c] = px3[c]; s += px3[c]; }
    } else for (let c = 0; c < 3; c++) {
      let x = col[i * 3 + c] * exp;
      x = tonemap !== 'none' ? acesC(x) : clamp01(x);
      img[i * 3 + c] = gam22(x); s += img[i * 3 + c];
    }
    const lum = s / 3;
    for (let c = 0; c < 3; c++) img[i * 3 + c] = clamp01(lum + (img[i * 3 + c] - lum) * sat);
  }
  return { img, tonemap: tmo };
}

/* ============================== палитра с референса (grade.matchRef) ============================== */
const labF = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
const labFi = (f) => { const f3 = f * f * f; return f3 > 0.008856 ? f3 : (f - 16 / 116) / 7.787; };
/** sRGB 0..1 (экранные) → CIELAB D65. */
export function toLab(r, g, b, out) {
  r = toLin(r); g = toLin(g); b = toLin(b);
  const fx = labF((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), fy = labF(0.2126 * r + 0.7152 * g + 0.0722 * b), fz = labF((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz);
}
export function fromLab(L, a, b, out) {
  const fy = (L + 16) / 116, X = 0.95047 * labFi(fy + a / 500), Y = labFi(fy), Z = 1.08883 * labFi(fy - b / 200);
  out[0] = clamp01(toGam(3.2406 * X - 1.5372 * Y - 0.4986 * Z));
  out[1] = clamp01(toGam(-0.9689 * X + 1.8758 * Y + 0.0415 * Z));
  out[2] = clamp01(toGam(0.0557 * X - 0.204 * Y + 1.057 * Z));
}
/** Веса тональных зон (тени, середина, света) по L. */
const zoneW = (L, w) => { w[0] = clamp01(1 - L / 50); w[2] = clamp01((L - 50) / 50); w[1] = 1 - w[0] - w[2]; };
/**
 * Статистика кадра в Lab: среднее и разброс L; средние a, b по зонам (тени холоднее, света теплее — то, что видно
 * на референсе); разброс хромы вокруг зонных средних. get(i) пишет экранный sRGB пикселя i в out.
 */
function labStats(count, get, step = 1) {
  const p = [0, 0, 0], q = [0, 0, 0], w = [0, 0, 0];
  let sL = 0, sLL = 0, m = 0;
  const za = [0, 0, 0], zb = [0, 0, 0], zw = [0, 0, 0];
  for (let i = 0; i < count; i += step) {
    get(i, p); toLab(p[0], p[1], p[2], q); zoneW(q[0], w);
    sL += q[0]; sLL += q[0] * q[0]; m++;
    for (let z = 0; z < 3; z++) { za[z] += w[z] * q[1]; zb[z] += w[z] * q[2]; zw[z] += w[z]; }
  }
  const meanL = sL / m, stdL = Math.sqrt(Math.max(1e-6, sLL / m - meanL * meanL));
  const ma = za.map((v, z) => (zw[z] > 1e-6 ? v / zw[z] : 0)), mb = zb.map((v, z) => (zw[z] > 1e-6 ? v / zw[z] : 0));
  let sc = 0;
  for (let i = 0; i < count; i += step) {
    get(i, p); toLab(p[0], p[1], p[2], q); zoneW(q[0], w);
    const da = q[1] - (w[0] * ma[0] + w[1] * ma[1] + w[2] * ma[2]), db = q[2] - (w[0] * mb[0] + w[1] * mb[1] + w[2] * mb[2]);
    sc += da * da + db * db;
  }
  const gw = zw[0] + zw[1] + zw[2] || 1;
  return { meanL, stdL, ma, mb, stdC: Math.sqrt(Math.max(1e-6, sc / m)), ga: (za[0] + za[1] + za[2]) / gw, gb: (zb[0] + zb[1] + zb[2]) / gw, zw: zw.map((v) => v / gw) };
}
/** Кеш файлов по пути и времени изменения: правка файла на диске видна без перезапуска сервера. */
const refCache = new Map();
/** Статистика референса (PNG, JPEG, WebP… — путь относительно baseDir), с кешем по времени изменения. */
export async function loadRefStats(src, baseDir) {
  const p = resolvePath(baseDir || '.', src), key = fileStamp(p, { missing: 'null' });
  if (!key) throw new Error(`grade.matchRef: нет файла ${p}`);
  if (refCache.has(key)) return refCache.get(key);
  const im = await decodeImage(readFileSync(p), 400);
  const d = im.data;
  const st = labStats(im.width * im.height, (i, o) => { o[0] = d[i * 4] / 255; o[1] = d[i * 4 + 1] / 255; o[2] = d[i * 4 + 2] / 255; });
  refCache.set(key, st);
  return st;
}
/**
 * Перенос палитры (на месте, sRGB 0..1): L — среднее и контраст к референсу с весом lum; хрома — разброс с весом
 * chroma; оттенок — по зонам (zones: тени, середина, света отдельно) или общий. amount — общая сила.
 */
export function matchPalette(img, n, ref, o = {}) {
  const amt = o.amount ?? 0.6, wl = o.lum ?? 0.35, wc = o.chroma ?? 0.6, zones = o.zones !== false;
  const step = Math.max(1, Math.floor(n / 150000));
  const src = labStats(n, (i, out) => { out[0] = img[i * 3]; out[1] = img[i * 3 + 1]; out[2] = img[i * 3 + 2]; }, step);
  const kL = Math.min(1.6, Math.max(0.6, ref.stdL / src.stdL)), kC = 1 + (Math.min(1.6, Math.max(0.6, ref.stdC / src.stdC)) - 1) * wc;
  if (tryGPU('post', n, () => gpuMatch(img, n, { src, ref, amt, wl, kL, kC, zones }))) return { src, ref };
  const q = [0, 0, 0], w = [0, 0, 0], w2 = [0, 0, 0], out = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    toLab(img[j], img[j + 1], img[j + 2], q); zoneW(q[0], w);
    const L2 = q[0] + ((q[0] - src.meanL) * kL + ref.meanL - q[0]) * wl * amt;
    zoneW(L2, w2); // тон референса — по зоне, в которую пиксель попадёт после правки яркости
    const sa = zones ? w[0] * src.ma[0] + w[1] * src.ma[1] + w[2] * src.ma[2] : src.ga, sb = zones ? w[0] * src.mb[0] + w[1] * src.mb[1] + w[2] * src.mb[2] : src.gb;
    const ra = zones ? w2[0] * ref.ma[0] + w2[1] * ref.ma[1] + w2[2] * ref.ma[2] : ref.ga, rb = zones ? w2[0] * ref.mb[0] + w2[1] * ref.mb[1] + w2[2] * ref.mb[2] : ref.gb;
    const a2 = (q[1] - sa) * kC + ra, b2 = (q[2] - sb) * kC + rb;
    fromLab(L2, q[1] + (a2 - q[1]) * amt, q[2] + (b2 - q[2]) * amt, out);
    img[j] = out[0]; img[j + 1] = out[1]; img[j + 2] = out[2];
  }
  return { src, ref };
}

/* ============================== LUT .cube ============================== */
const lutCache = new Map();
/** 3D LUT формата .cube (Resolve/Adobe): { size, data Float32 (r быстрее всех), min, max }; текст или путь. */
export function loadCube(src, baseDir) {
  const inline = src.includes('\n');
  const f = inline ? null : resolvePath(baseDir || '.', src);
  const key = inline ? `inline|${src}` : fileStamp(f);
  if (lutCache.has(key)) return lutCache.get(key);
  let lut = null;
  try {
    const text = inline ? src : readFileSync(f, 'utf8');
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

/* ============================== цветокоррекция ============================== */
/** Цветокоррекция кадра (sRGB 0..1, на месте): lift/gamma/gain, contrast, split toning, LUT. */
export function applyGrade(g, img, n, baseDir) {
  const { lift, gamma, gain } = g, sp = g.split, con = g.contrast ?? 1;
  const lut = g.lut ? loadCube(g.lut, baseDir) : null, la = g.lutAmount ?? 1, tmp = [0, 0, 0];
  if (!lut && tryGPU('post', n, () => gpuGrade(img, n, g))) return; // с LUT — здесь
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

/* ============================== медианное сечение ============================== */
/** Палитра из colors цветов (RGBA-байты data, n пикселей) медианным сечением. */
export function medianCut(data, n, colors) {
  const hist = new Map();
  for (let i = 0; i < n; i++) { const k = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]; hist.set(k, (hist.get(k) || 0) + 1); }
  const boxes = [[...hist.entries()].map(([k, c]) => [k >> 16, (k >> 8) & 255, k & 255, c])];
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
