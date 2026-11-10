// Попиксельные детали материалов (этап 2): компоновщик знает для каждого пикселя мировую позицию P, нормаль и
// номер материала (проход matId) и считает вариацию цвета, грязь, износ рёбер, плиточные текстуры в перспективе
// и микрорельеф — без тысяч узлов-деталей. scene.materials[name] = { noise, grime, wear, tex, bump }.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { noise3, parseColor, surfaceAxes } from '../engine/kontur.js';
import { decodePNG } from './normals.mjs';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lin22 = (v) => Math.pow(Math.max(0, v), 2.2);
/** Цвет → линейный RGB 0..1. */
const linRGB = (c, def) => {
  if (Array.isArray(c)) return c.map((v) => lin22(v));
  const p = c != null ? parseColor(String(c)) : null;
  return p ? [lin22(p[0]), lin22(p[1]), lin22(p[2])] : def;
};
const fbm3 = (x, y, z, oct = 3, seed = 0) => { let s = 0, a = 1, f = 1, n = 0; for (let o = 0; o < oct; o++) { s += a * noise3(x * f, y * f, z * f, seed + o * 17); n += a; a *= 0.5; f *= 2; } return s / n; };
/** Хеш целых → [0, 1). */
const h2 = (a, b, s = 0) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

const texCache = new Map();
/** Картинка текстуры: data: URI PNG или путь (относительно baseDir). */
function loadTex(src, baseDir) {
  if (texCache.has(src)) return texCache.get(src);
  let img = null;
  try {
    if (src.startsWith('data:')) img = decodePNG(Buffer.from(src.slice(src.indexOf(',') + 1), 'base64'));
    else img = decodePNG(readFileSync(resolve(baseDir || '.', src)));
  } catch { img = null; }
  texCache.set(src, img);
  return img;
}

/**
 * Процедурная или картиночная текстура в точке (u, v) грани (метры). Возвращает [r,g,b] линейные и сдвиг нормали [du, dv].
 * kind: planks (доски: w, len, gap), stripes (обои: w, colors), tiles (плитка: s, grout), checker (s), image (src, scale).
 */
function texSample(t, u, v, out, baseDir) {
  const k = t.kind || (t.src ? 'image' : 'planks');
  const c1 = t._c1, c2 = t._c2;
  out[3] = 0; out[4] = 0;
  if (k === 'planks') {
    const bw = t.w ?? 0.18, bl = t.len ?? 1.6, gap = t.gap ?? 0.006;
    const row = Math.floor(v / bw), off = h2(row, 7) * bl, uu = u + off, col = Math.floor(uu / bl);
    const fv = v - row * bw, fu = uu - col * bl, r = h2(row, col, 3);
    const grain = 0.5 + 0.5 * noise3(uu * 2.2, v * 40, row * 1.7, 5) * 0.6 + 0.2 * noise3(uu * 9, v * 90, row, 9);
    const tone = 0.82 + r * 0.32;
    const edge = fv < gap || bw - fv < gap || fu < gap * 1.2 || bl - fu < gap * 1.2;
    for (let c = 0; c < 3; c++) out[c] = edge ? c1[c] * 0.35 : (c1[c] * (1 - grain * 0.35) + c2[c] * grain * 0.35) * tone;
    out[3] = (h2(row, col, 9) - 0.5) * 0.06; out[4] = (fv < gap * 3 ? 0.25 : bw - fv < gap * 3 ? -0.25 : 0);
    return;
  }
  if (k === 'stripes') {
    const w = t.w ?? 0.2, i = Math.floor(u / w), f = u / w - i;
    const cs = t._cs;
    const base = cs[((i % cs.length) + cs.length) % cs.length];
    const thin = t.thin !== false && Math.abs(f - 0.5) < 0.03;
    for (let c = 0; c < 3; c++) out[c] = thin ? base[c] * 0.82 : base[c];
    return;
  }
  if (k === 'tiles' || k === 'checker') {
    // su × sv — размер плитки (s — квадрат), offset — сдвиг чётных рядов (перевязка, 0.5 — кирпичная/брусчатка),
    // jitter — разброс тона, pillow — «подушка» камня (наклон нормали к краям)
    const su = t.su ?? t.s ?? 0.3, sv = t.sv ?? t.s ?? 0.3, gr = t.grout ?? 0.012;
    const iv = Math.floor(v / sv), uu = u + (iv & 1 ? (t.offset ?? 0) * su : 0), iu = Math.floor(uu / su), fu = uu - iu * su, fv = v - iv * sv;
    if (k === 'checker') { const cc = (iu + iv) & 1 ? c2 : c1; for (let c = 0; c < 3; c++) out[c] = cc[c]; return; }
    const g = fu < gr || fv < gr || su - fu < gr * 0.3 || sv - fv < gr * 0.3, jt = t.jitter ?? 0.2, r = 1 - jt / 2 + h2(iu, iv, 2) * jt;
    for (let c = 0; c < 3; c++) out[c] = g ? c2[c] : c1[c] * r;
    if (!g) {
      if (t.pillow) { out[3] = (fu / su - 0.5) * t.pillow; out[4] = (fv / sv - 0.5) * t.pillow; }
      else { out[3] = (h2(iu, iv, 5) - 0.5) * 0.05; out[4] = (h2(iu, iv, 6) - 0.5) * 0.05; }
    }
    return;
  }
  // картинка
  const img = loadTex(t.src, baseDir);
  if (!img) { for (let c = 0; c < 3; c++) out[c] = c1[c]; return; }
  const sc = t.scale ?? 1, x = ((u / sc) % 1 + 1) % 1, y = ((-v / (sc * (t.aspect ?? img.height / img.width))) % 1 + 1) % 1;
  const px = Math.min(img.width - 1, Math.floor(x * img.width)), py = Math.min(img.height - 1, Math.floor(y * img.height)), o = (py * img.width + px) * 4;
  for (let c = 0; c < 3; c++) out[c] = lin22(img.data[o + c] / 255);
}

/** Подготовка таблицы материалов сцены: массив по номерам matId (1…). */
export function prepareMaterials(scene) {
  const names = Object.keys(scene.materials || {});
  return names.map((name) => {
    const m = { ...scene.materials[name] };
    if (m.tex) {
      const t = { ...m.tex };
      t._c1 = linRGB(t.color || t.colors?.[0], [0.45, 0.28, 0.16]);
      t._c2 = linRGB(t.color2 || t.colors?.[1] || t.grout, t.kind === 'tiles' ? [0.3, 0.28, 0.25] : t._c1.map((v) => v * 0.6));
      t._cs = (t.colors || [t.color || '#d8a0a0', t.color2 || '#e8b8b0']).map((c) => linRGB(c, [0.6, 0.4, 0.4]));
      t._tint = t.tint ? linRGB(t.tint, null) : null;
      m.tex = t;
    }
    if (m.grime) m.grime = { height: 0.8, amount: 0.35, floor: 0, ao: 0.4, ...m.grime, _c: linRGB(m.grime.color, [0.12, 0.09, 0.07]) };
    if (m.noise) m.noise = { scale: 0.6, amount: 0.12, octaves: 3, ...m.noise, _c: m.noise.color ? linRGB(m.noise.color, null) : null };
    if (m.wear) m.wear = { amount: 0.3, ...m.wear, _c: m.wear.color ? linRGB(m.wear.color, null) : null };
    if (m.bump) m.bump = { scale: 0.08, amount: 0.25, ...m.bump };
    return m;
  });
}

/**
 * Применить материалы к буферам кадра (на месте): lin (альбедо, линейное, n·3), Nx/Ny/Nz (нормали),
 * по номерам mid (Uint16Array, 0 — нет материала), позициям P и нормалям плоскостей PN, AO ao.
 */
export function applyMaterials(mats, { W, H, mid, lin, Nx, Ny, Nz, PNx, PNy, PNz, Px, Py, Pz, ao, baseDir }) {
  if (!mats.length) return 0;
  const n = W * H, tmp = [0, 0, 0, 0, 0];
  let touched = 0;
  // кривизна по проходу нормалей (для износа рёбер)
  const needWear = mats.some((m) => m.wear);
  let curv = null;
  if (needWear) {
    curv = new Float32Array(n);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const dx = Math.abs(Nx[i + 1] - Nx[i - 1]) + Math.abs(Ny[i + 1] - Ny[i - 1]) + Math.abs(Nz[i + 1] - Nz[i - 1]);
      const dy = Math.abs(Nx[i + W] - Nx[i - W]) + Math.abs(Ny[i + W] - Ny[i - W]) + Math.abs(Nz[i + W] - Nz[i - W]);
      curv[i] = dx + dy;
    }
  }
  let axKey = '', ax = null;
  for (let i = 0; i < n; i++) {
    const id = mid[i];
    if (!id || id > mats.length) continue;
    const m = mats[id - 1];
    touched++;
    const px = Px[i], py = Py[i], pz = Pz[i], j = i * 3;
    let r = lin[j], g = lin[j + 1], b = lin[j + 2];
    // оси грани (u — по горизонтали грани, v — вверх / вглубь для пола): как surface.u/v
    let u = 0, v = 0;
    if (m.tex || m.bump) {
      const key = `${PNx[i].toFixed(2)},${PNy[i].toFixed(2)},${PNz[i].toFixed(2)}`;
      if (key !== axKey) { ax = surfaceAxes([PNx[i], PNy[i], PNz[i]]); axKey = key; }
      u = px * ax.u[0] + py * ax.u[1] + pz * ax.u[2]; v = px * ax.v[0] + py * ax.v[1] + pz * ax.v[2];
    }
    if (m.tex) {
      texSample(m.tex, u, v, tmp, baseDir);
      const t = m.tex, k = t.amount ?? 1;
      let tr = tmp[0], tg = tmp[1], tb = tmp[2];
      if (t._tint) { tr *= t._tint[0]; tg *= t._tint[1]; tb *= t._tint[2]; }
      if (t.mode === 'multiply') { tr *= r / 0.5; tg *= g / 0.5; tb *= b / 0.5; }
      r += (tr - r) * k; g += (tg - g) * k; b += (tb - b) * k;
      if (tmp[3] || tmp[4]) { Nx[i] += ax.u[0] * tmp[3] + ax.v[0] * tmp[4]; Ny[i] += ax.u[1] * tmp[3] + ax.v[1] * tmp[4]; Nz[i] += ax.u[2] * tmp[3] + ax.v[2] * tmp[4]; }
    }
    if (m.noise) {
      const s = 1 / m.noise.scale, nv = fbm3(px * s, py * s, pz * s, m.noise.octaves, 11);
      const f = 1 + m.noise.amount * nv * 1.6;
      if (m.noise._c) { const t = clamp01(nv * m.noise.amount * 2); r = r * f + (m.noise._c[0] - r) * t; g = g * f + (m.noise._c[1] - g) * t; b = b * f + (m.noise._c[2] - b) * t; }
      else { r *= f; g *= f; b *= f; }
    }
    if (m.grime) {
      const G = m.grime, hgt = clamp01(1 - (py - G.floor) / G.height);
      const nv = 0.75 + 0.5 * fbm3(px * 3.1, py * 1.3, pz * 3.1, 2, 23);
      const t = clamp01((hgt * hgt * G.amount + (1 - ao[i]) * G.ao * G.amount) * nv);
      r += (G._c[0] - r) * t; g += (G._c[1] - g) * t; b += (G._c[2] - b) * t;
    }
    if (m.wear && curv) {
      const c = clamp01((curv[i] - 0.15) * 2.2) * m.wear.amount * (0.6 + 0.8 * Math.max(0, fbm3(px * 6, py * 6, pz * 6, 2, 31)));
      const wc = m.wear._c;
      if (wc) { r += (wc[0] - r) * c; g += (wc[1] - g) * c; b += (wc[2] - b) * c; }
      else { r = r * (1 + c * 0.8) + 0.04 * c; g = g * (1 + c * 0.8) + 0.04 * c; b = b * (1 + c * 0.8) + 0.035 * c; }
    }
    if (m.bump) {
      const s = 1 / m.bump.scale, e = 0.35;
      const n0 = fbm3(u * s, v * s, 0.5, 2, 41), nu = fbm3((u * s) + e, v * s, 0.5, 2, 41), nvv = fbm3(u * s, (v * s) + e, 0.5, 2, 41);
      const du = (nu - n0) * m.bump.amount * 3, dv = (nvv - n0) * m.bump.amount * 3;
      Nx[i] -= ax.u[0] * du + ax.v[0] * dv; Ny[i] -= ax.u[1] * du + ax.v[1] * dv; Nz[i] -= ax.u[2] * du + ax.v[2] * dv;
    }
    if (m.tex || m.bump) { const l = Math.hypot(Nx[i], Ny[i], Nz[i]) || 1; Nx[i] /= l; Ny[i] /= l; Nz[i] /= l; }
    lin[j] = Math.max(0, r); lin[j + 1] = Math.max(0, g); lin[j + 2] = Math.max(0, b);
  }
  return touched;
}

/** Готовые материалы для scene.materials (можно расширять полями). */
export const MATERIAL_PRESETS = {
  plaster: { noise: { scale: 0.7, amount: 0.14, octaves: 4 }, grime: { height: 0.9, amount: 0.4 }, wear: { amount: 0.25 }, bump: { scale: 0.05, amount: 0.12 } },
  stone: { noise: { scale: 0.35, amount: 0.18, octaves: 4 }, grime: { height: 0.6, amount: 0.35, color: '#3a3428' }, wear: { amount: 0.35 } },
  wood: { noise: { scale: 0.25, amount: 0.12 }, wear: { amount: 0.3 } },
  parquet: { tex: { kind: 'planks', color: '#7a4a2a', color2: '#a0683a', w: 0.16, len: 1.4 }, noise: { scale: 1.5, amount: 0.08 } },
  wallpaperRose: { tex: { kind: 'stripes', colors: ['#d89a9a', '#e8b8b0'], w: 0.16 }, noise: { scale: 1.2, amount: 0.06 }, grime: { height: 0.5, amount: 0.15 } },
  wallpaperBlue: { tex: { kind: 'stripes', colors: ['#6a84b0', '#7d97c0'], w: 0.14 }, noise: { scale: 1.2, amount: 0.06 }, grime: { height: 0.5, amount: 0.15 } },
  cobble: { noise: { scale: 0.25, amount: 0.15 }, grime: { height: 0.05, amount: 0.2, ao: 0.6 } },
};
