// Фильтры полей (Float32, один канал w×h): гаусс, совместный билатеральный, окно, расширение, масштабирование.
// Граница — reflect, как у scipy.ndimage (перенос эскизов render.py без смены кадра).
// Гаусс и билатеральный считаются полосами строк на всех ядрах (pool.mjs) или на видеокарте (KONTUR_GPU, gpu.mjs).
import { rows, f32 } from './pool.mjs';
import { bilin } from './util.mjs';
import { viaGPU } from './gpu.mjs';
import { gpuGauss, gpuBilateral } from './gpu-kernels.mjs';

export const gaussKernel = (s) => {
  const r = Math.max(1, Math.round(4 * s)), k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * s * s)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return { k, r };
};
export const refl = (i, n) => { while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - i - 1; return i; };

/** Гаусс одного канала (reflect, как scipy). Для больших σ — через уменьшенную копию. */
export function gauss(src, w, h, s) {
  if (!(s > 0)) return src;
  if (s > 6) {
    const f = Math.max(2, Math.floor(s / 3));
    const sw = Math.ceil(w / f), sh = Math.ceil(h / f), small = new Float32Array(sw * sh), cnt = new Float32Array(sw * sh);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const j = Math.floor(y / f) * sw + Math.floor(x / f); small[j] += src[y * w + x]; cnt[j]++; }
    for (let j = 0; j < small.length; j++) small[j] /= cnt[j] || 1;
    return upF(gauss(small, sw, sh, s / f), sw, sh, f, w, h);
  }
  const { k, r } = gaussKernel(s);
  return viaGPU('filters', w * h, () => gpuGauss(src, w, h, k, r), () => {
    const tmp = f32(w * h), out = f32(w * h);
    rows(import.meta.url, kGaussH, { src, tmp, w, k, r }, h);
    rows(import.meta.url, kGaussV, { tmp, out, w, h, k, r }, h);
    return out;
  });
}
/** Полоса строк y0…y1 горизонтального прохода гаусса. */
export function kGaussH({ src, tmp, w, k, r }, y0, y1) {
  for (let y = y0; y < y1; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let a = 0;
      if (x >= r && x < w - r) for (let i = -r; i <= r; i++) a += src[row + x + i] * k[i + r];
      else for (let i = -r; i <= r; i++) a += src[row + refl(x + i, w)] * k[i + r];
      tmp[row + x] = a;
    }
  }
}
/** Полоса строк y0…y1 вертикального прохода гаусса. */
export function kGaussV({ tmp, out, w, h, k, r }, y0, y1) {
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    if (y >= r && y < h - r) for (let i = -r; i <= r; i++) a += tmp[(y + i) * w + x] * k[i + r];
    else for (let i = -r; i <= r; i++) a += tmp[refl(y + i, h) * w + x] * k[i + r];
    out[y * w + x] = a;
  }
}

/**
 * Совместный билатеральный гаусс: веса по глубине D и нормали плоскости (nx, ny, nz); m — маска (0 — не смешивать).
 * Края предметов не размываются друг в друга: тени, AO и отражённый свет остаются на своей поверхности.
 */
export function bilateral(src, w, h, s, D, nx, ny, nz, m) {
  if (!(s > 0)) return src;
  const { k, r } = gaussKernel(s);
  return viaGPU('filters', w * h, () => gpuBilateral(src, w, h, k, r, D, nx, ny, nz, m), () => {
    const tmp = f32(w * h), out = f32(w * h);
    rows(import.meta.url, kBilateral, { a: src, out: tmp, w, h, k, r, D, nx, ny, nz, m, dx: 1 }, h);
    rows(import.meta.url, kBilateral, { a: tmp, out, w, h, k, r, D, nx, ny, nz, m, dx: 0 }, h);
    return out;
  });
}
/** Полоса строк y0…y1 прохода билатерального фильтра (dx: 1 — по x, 0 — по y). */
export function kBilateral({ a, out, w, h, k, r, D, nx, ny, nz, m, dx }, y0, y1) {
  const lim = dx ? w : h;
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
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
}

/** Среднее в окне size (как scipy.ndimage.uniform_filter, reflect). */
export function uniform(src, w, h, size) {
  const lo = Math.floor(size / 2), hi = size - lo - 1, tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -lo; i <= hi; i++) a += src[y * w + refl(x + i, w)]; tmp[y * w + x] = a / size; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -lo; i <= hi; i++) a += tmp[refl(y + i, h) * w + x]; out[y * w + x] = a / size; }
  return out;
}

/** Увеличение вдвое (линейно, как scipy zoom order=1) с обрезкой до w×h. */
export function zoom2(a, hw, hh, w, h) {
  const o = f32(w * h), W2 = hw * 2, H2 = hh * 2;
  const kx = (hw - 1) / Math.max(1, W2 - 1), ky = (hh - 1) / Math.max(1, H2 - 1);
  rows(import.meta.url, kZoom2, { a, o, hw, hh, w, kx, ky }, h);
  return o;
}
/** Билинейная выборка поля a (ширина sw) между четырьмя соседями — общая для увеличений. */
const bilerp = (a, sw, x0, x1, y0, y1, tx, ty) => bilin(a[y0 * sw + x0], a[y0 * sw + x1], a[y1 * sw + x0], a[y1 * sw + x1], tx, ty);
/** Полоса строк y0…y1 увеличения вдвое (выравнивание по углам, как scipy zoom). */
export function kZoom2({ a, o, hw, hh, w, kx, ky }, ya, yb) {
  for (let y = ya; y < yb; y++) {
    const fy = y * ky, y0 = Math.floor(fy), y1 = Math.min(hh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = x * kx, x0 = Math.floor(fx), x1 = Math.min(hw - 1, x0 + 1);
      o[y * w + x] = bilerp(a, hw, x0, x1, y0, y1, fx - x0, ty);
    }
  }
}

/** Билинейное увеличение из sw×sh (шаг f пикселей) в w×h. */
export function upF(a, sw, sh, f, w, h) {
  const o = f32(w * h);
  rows(import.meta.url, kUpF, { a, o, sw, sh, f, w }, h);
  return o;
}
/** Полоса строк увеличения upF (по центрам пикселей, с обрезкой у края). */
export function kUpF({ a, o, sw, sh, f, w }, ya, yb) {
  for (let y = ya; y < yb; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1);
      o[y * w + x] = bilerp(a, sw, x0, x1, y0, y1, fx - x0, ty);
    }
  }
}

/** Расширение маски линий (max в окне 3×3). */
export function dilate3(a, w, h) {
  const o = f32(w * h);
  rows(import.meta.url, kDilate3, { a, o, w, h }, h);
  return o;
}
/** Полоса строк расширения 3×3. */
export function kDilate3({ a, o, w, h }, ya, yb) {
  for (let y = ya; y < yb; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const v = a[yy * w + xx]; if (v > m) m = v; } }
    o[y * w + x] = m;
  }
}

/** Каналы RGB (interleaved n·3) → три плоскости и обратно. */
export const splitRGB = (img, n) => [0, 1, 2].map((c) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = img[i * 3 + c]; return a; });
