// Тени: солнце лучами по BVH окклюдеров (половинное разрешение, резкая или мягкая полутень по угловому размеру),
// контактные тени (короткий луч по буферу глубины) и видимость ламп.
import { gauss, bilateral, zoom2 } from './filters.mjs';
import { nz, hash01, clamp01 } from './util.mjs';
import { vec3 } from '../../engine/kontur.js';
import { f32 } from './pool.mjs';
import { halves } from './gbuffer.mjs';
import { bvhFromData } from '../bvh.mjs';
import { viaRows } from './gpu.mjs';
import { gpuSun } from './gpu-kernels.mjs';

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

/**
 * Тень солнца (1 — свет, 0 — тень) в полном разрешении. bvh — null без окклюдеров. Возвращает { shadow, rays }.
 * sun.angle > 0: луч к случайной точке диска солнца, расстояние до заслонки → ширина полутени, размытие уровнями
 * совместного билатерального фильтра (полутень растёт от точки контакта).
 */
export function sunShadows(G, sun, bvh) {
  const { W, H, hw, hh, hn, mask, PNx, PNy, PNz, Px, Py, Pz, Dp } = G;
  const L = sun.dir, f = G.cam.f;
  const shH = f32(hn).fill(1);
  let rays = 0;
  const sunAngle = Math.max(0, sun.angle || 0);
  const base = { W, hw, mask, PNx, PNy, PNz, Px, Py, Pz, L, shH, bvh: bvh?.data };
  if (!(sunAngle > 0)) {
    if (sun.shadows !== false && bvh) rays = viaRows('sun', hn, () => { gpuSun({ ...base, soft: false }); return litCount(base, hh); }, import.meta.url, kSunHard, base, hh);
    return { shadow: zoom2(gauss(shH, hw, hh, 0.9), hw, hh, W, H), rays };
  }
  const half = ((sunAngle * Math.PI) / 180) / 2, tanH = Math.tan(half);
  const T1 = nz(Math.abs(L[1]) < 0.9 ? [L[2], 0, -L[0]] : [1, 0, 0]), T2 = vec3.cross(L, T1);
  const pen = f32(hn), [hm, hD, hx, hy, hz] = halves(G, 'mask', 'Dp', 'PNx', 'PNy', 'PNz');
  if (sun.shadows !== false && bvh) {
    const sargs = { ...base, Dp, T1, T2, tanH, f, pen };
    rays = viaRows('sun', hn, () => { gpuSun({ ...sargs, soft: true }); return litCount(base, hh); }, import.meta.url, kSunSoft, sargs, hh);
  }
  // ширина полутени — и на освещённые соседние пиксели (нормированное размытие по затенённым)
  const occF = f32(hn);
  for (let j = 0; j < hn; j++) if (!shH[j]) occF[j] = 1;
  const sc = Math.max(1, hw / 960), num = gauss(pen, hw, hh, 5 * sc), den = gauss(occF, hw, hh, 5 * sc);
  const levels = [0.9, 2.2 * sc, 5 * sc], blur = levels.map((s) => bilateral(shH, hw, hh, s, hD, hx, hy, hz, hm));
  const sh2 = f32(hn);
  for (let j = 0; j < hn; j++) {
    const p = den[j] > 1e-3 ? Math.max(pen[j], num[j] / den[j]) : 0, s = Math.max(levels[0], Math.min(levels[2], p * 0.5));
    if (s <= levels[1]) { const q = (s - levels[0]) / (levels[1] - levels[0]); sh2[j] = blur[0][j] * (1 - q) + blur[1][j] * q; }
    else { const q = (s - levels[1]) / (levels[2] - levels[1]); sh2[j] = blur[1][j] * (1 - q) + blur[2][j] * q; }
  }
  return { shadow: zoom2(sh2, hw, hh, W, H), rays };
}

const bvhCache = new WeakMap();
/** Обход BVH по массивам data (в воркере собирается один раз на задание). */
const bvhOf = (data) => { let b = bvhCache.get(data); if (!b) { b = bvhFromData(data); bvhCache.set(data, b); } return b; };
const litPx = (i, mask, PNx, PNy, PNz, L) => mask[i] && PNx[i] * L[0] + PNy[i] * L[1] + PNz[i] * L[2] > -0.05;
/** Число лучей солнца (освещённые точки половинной сетки) — для статистики, когда лучи считает GPU. */
const litCount = ({ W, hw, mask, PNx, PNy, PNz, L }, hh) => { let c = 0; for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) if (litPx(2 * y * W + 2 * x, mask, PNx, PNy, PNz, L)) c++; return c; };

/** Полоса строк y0…y1 половинной сетки: резкая тень солнца (луч к солнцу). Возвращает число лучей. */
export function kSunHard({ W, hw, mask, PNx, PNy, PNz, Px, Py, Pz, L, shH, bvh: data }, y0, y1) {
  const bvh = bvhOf(data);
  let rays = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < hw; x++) {
    const i = 2 * y * W + 2 * x;
    if (!litPx(i, mask, PNx, PNy, PNz, L)) continue;
    rays++;
    if (bvh.occluded(Px[i] + PNx[i] * 0.04, Py[i] + PNy[i] * 0.04, Pz[i] + PNz[i] * 0.04, L[0], L[1], L[2], 1e9, i)) shH[y * hw + x] = 0;
  }
  return rays;
}

/** Полоса строк y0…y1 половинной сетки: мягкая тень (луч к точке диска солнца) и ширина полутени pen. */
export function kSunSoft({ W, hw, mask, PNx, PNy, PNz, Px, Py, Pz, Dp, L, T1, T2, tanH, f, shH, pen, bvh: data }, y0, y1) {
  const bvh = bvhOf(data);
  let rays = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < hw; x++) {
    const i = 2 * y * W + 2 * x, j = y * hw + x;
    if (!litPx(i, mask, PNx, PNy, PNz, L)) continue;
    rays++;
    const r = tanH * Math.sqrt(hash01(j, 1)), ph = 6.2831853 * hash01(j, 2), a = r * Math.cos(ph), b = r * Math.sin(ph);
    let dx = L[0] + T1[0] * a + T2[0] * b, dy = L[1] + T1[1] * a + T2[1] * b, dzz = L[2] + T1[2] * a + T2[2] * b;
    const dl = Math.hypot(dx, dy, dzz); dx /= dl; dy /= dl; dzz /= dl;
    const th = bvh.closest(Px[i] + PNx[i] * 0.04, Py[i] + PNy[i] * 0.04, Pz[i] + PNz[i] * 0.04, dx, dy, dzz, 1e9, j);
    if (th < Infinity) { shH[j] = 0; pen[j] = (th * tanH * 2 * f) / 2 / Math.max(0.3, Dp[i]); }
  }
  return rays;
}

/**
 * Контактные тени: от точки поверхности к свету (dir — направление НА свет, или точка lp для лампы) шагами по
 * length метров; шаг проецируется в кадр и сравнивается с глубиной буфера. Луч «за» поверхностью не дальше
 * thickness — заслонён. Ловит то, чего нет среди окклюдеров: детали, ступени, рельеф плоскостей, персонажей-спрайты.
 * Половинное разрешение, затем совместное размытие. Возвращает Float32 n (1 — свет, 0 — тень) или null.
 */
export function contactShadows(G, dir, o) {
  const { W, H, hw, hh, hn, mask, Px, Py, Pz, PNx, PNy, PNz, Nx, Ny, Nz, Dp } = G;
  const proj = G.cam.proj, pr = [0, 0, 0];
  const len = o.length ?? 0.4, steps = Math.max(4, o.steps | 0 || 14), thick = o.thickness ?? 0.12, str = o.strength ?? 1;
  const vis = f32(hn).fill(1), [hm, hD, hx, hy, hz] = halves(G, 'mask', 'Dp', 'PNx', 'PNy', 'PNz');
  let marched = 0;
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    const i = 2 * y * W + 2 * x, j = y * hw + x;
    if (!mask[i]) continue;
    if (Nx[i] * dir[0] + Ny[i] * dir[1] + Nz[i] * dir[2] <= 0.02) continue; // к свету спиной — тень и так от N·L
    marched++;
    const jit = hash01(j, 21);
    // старт чуть над поверхностью: плоскость пикселя сама себя не заслоняет
    const ox = Px[i] + PNx[i] * 0.01, oy = Py[i] + PNy[i] * 0.01, oz = Pz[i] + PNz[i] * 0.01;
    let occ = 0;
    for (let s = 0; s < steps; s++) {
      const t = (len * (s + jit)) / steps;
      proj(ox + dir[0] * t, oy + dir[1] * t, oz + dir[2] * t, pr);
      const qx = pr[0] | 0, qy = pr[1] | 0;
      if (pr[2] <= 0.05 || qx < 0 || qy < 0 || qx >= W || qy >= H) break;
      const qi = qy * W + qx;
      if (!mask[qi] || qi === i) continue;
      const dd = pr[2] - Dp[qi];
      // заслон: луч за поверхностью буфера, но не глубже толщины (иначе это задний план, а не преграда)
      if (dd > 0.015 && dd < thick + t * 0.15) { occ = 1 - (s / steps) * 0.35; break; }
    }
    vis[j] = 1 - occ * str;
  }
  if (!marched) return null;
  const sc = Math.max(1, hw / 960);
  return zoom2(bilateral(vis, hw, hh, 1.1 * sc, hD, hx, hy, hz, hm), hw, hh, W, H).map(clamp01);
}

/**
 * Видимость лампы (lx, ly, lz) радиуса r в экранной рамке [xa, xb, ya, yb]: лучи по BVH на половинной сетке рамки,
 * размытие и увеличение. Возвращает { data, w, x0, y0, rays } для выборки data[(y − y0)·w + (x − x0)].
 */
export function lampVisibility(G, bvh, lx, ly, lz, r, [xa, xb, ya, yb]) {
  const { W, H, mask, Px, Py, Pz, PNx, PNy, PNz } = G;
  const vx0 = xa - (xa & 1), vy0 = ya - (ya & 1);
  const vw = Math.ceil((xb - vx0 + 1) / 2), vh = Math.ceil((yb - vy0 + 1) / 2);
  const tmp = new Float32Array(vw * vh).fill(1);
  let rays = 0;
  for (let y = 0; y < vh; y++) for (let x = 0; x < vw; x++) {
    const px = vx0 + 2 * x, py = vy0 + 2 * y; if (px >= W || py >= H) continue;
    const i = py * W + px;
    if (!mask[i]) continue;
    const ddx = lx - Px[i], ddy = ly - Py[i], ddz = lz - Pz[i], dist = Math.hypot(ddx, ddy, ddz) + 1e-4;
    if (dist >= r) continue;
    rays++;
    if (bvh.occluded(Px[i] + PNx[i] * 0.04, Py[i] + PNy[i] * 0.04, Pz[i] + PNz[i] * 0.04, ddx / dist, ddy / dist, ddz / dist, dist - 0.35, i)) tmp[y * vw + x] = 0;
  }
  const gb = gauss(tmp, vw, vh, 0.8);
  return { data: zoom2(gb, vw, vh, vw * 2, vh * 2), w: vw * 2, x0: vx0, y0: vy0, rays };
}
