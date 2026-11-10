// Освещение поверхности: солнце (N·L, wrap, тень, cel-ступени), полусфера неба и земли с AO (изогнутые нормали,
// цветной AO, многократный отскок), блики, точечные источники с затуханием и тенями.
import { collectLights } from '../../engine/kontur.js';
import { gauss } from './filters.mjs';
import { lampVisibility } from './shadows.mjs';
import { multiBounce } from './ao.mjs';
import { clamp01, rgb, lin22 } from './util.mjs';
import { rows, f32 } from './pool.mjs';

/** Источники для отложенного света: узлы light с p3 (мировые координаты). */
export function deferredLights(scene, t = 0, states) {
  return collectLights(scene, t, { states }).filter((l) => Array.isArray(l.p3)).map((l) => ({ ...l, radius: l.radius3 ?? l.radius }));
}
/** Множитель группы источника (groups.lamp, window, candle, fairy) × enabled. */
export const lampGain = (st, lt) => { const g = st.groups?.[lt.group] ?? (lt.group === 'candle' ? st.groups?.lamp : undefined) ?? 1; return g * (lt.enabled === false ? 0 : 1); };

/** Экранная рамка влияния сферы радиуса r с центром (lx, ly, lz) (с запасом) или null. */
export function lampRect(G, lx, ly, lz, r) {
  const { W, H } = G, { plain, cx, hor, f, camH, dz, proj } = G.cam;
  let xa, xb, ya, yb;
  if (plain) {
    const zc = Math.max(0.3, lz - r + dz);
    const sx = cx + (f * lx) / (lz + dz), sy = hor + (f * (camH - ly)) / (lz + dz), sr = (f * r) / zc + 4;
    xa = Math.max(0, Math.floor(sx - sr)); xb = Math.min(W - 1, Math.ceil(sx + sr)); ya = Math.max(0, Math.floor(sy - sr)); yb = Math.min(H - 1, Math.ceil(sy + sr));
  } else {
    const pr = [0, 0, 0];
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
}

/** Энергии света: солнце, небо, земля (цвет × energy). */
export const lightColors = (st) => ({
  sunC: st.sun.color.map((v) => v * st.sun.energy), skyC: st.sky.color.map((v) => v * st.sky.energy), gC: st.ground.color.map((v) => v * st.ground.energy),
});

/**
 * Окружающий свет пикселя i канала c (небо сверху, земля снизу) × AO. Общий для освещения и вычета в GI:
 * с изогнутой нормалью «верх» берётся по ней, с multiBounce AO светлеет на светлом альбедо, ao.color — цвет щелей.
 */
export function ambientFn(G, st, AO, lin) {
  const { skyC, gC } = lightColors(st);
  const p = { skyC, gC, Ny: G.Ny, ao: AO.ao, by: AO.bent ? AO.bent[1] : null, aoC: st.ao?.color || null, mb: !!(st.ao?.multiBounce && lin), lin: lin || null };
  const fn = ambientOf(p);
  fn.params = p; // для воркеров пула: функция собирается заново по тем же данным
  return fn;
}
/** Функция окружающего света по данным ambientFn(…).params. */
export function ambientOf({ skyC, gC, Ny, ao, by, aoC, mb, lin }) {
  return (i, c) => {
    const up = by ? by[i] : Ny[i];
    const v = mb ? multiBounce(ao[i], lin[i * 3 + c]) : ao[i];
    const a = aoC ? 1 - (1 - v) * (1 - aoC[c]) : v;
    return (skyC[c] * (0.5 + 0.5 * up) + gC[c] * (0.5 - 0.5 * up)) * a;
  };
}

/**
 * Прямой свет солнца с учётом тени (Float32 n): N·L с wrap; cel — ступени по нормали плоскости + мягкий рельеф.
 */
export function sunDirect(G, st, shadow, cel) {
  const { n, W, H, Nx, Ny, Nz, PNx, PNy, PNz } = G, L = st.sun.dir, wrap = st.sun.wrap || 0;
  const direct = f32(n);
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
  return direct;
}

/**
 * Свет поверхности: light (окружение + солнце, n·3), specT (блики, n·3), lampL (свет ламп; при раздельном учёте —
 * свой буфер, иначе тот же light). Возвращает { light, specT, lampL, lights, litCount, rays }.
 */
export function shadeSurface(G, st, { direct, ambient, bvh, scene, t, states, separateLamps }) {
  const { n, W, Nx, Ny, Nz, Px, Py, Pz, spec } = G, { camX, camY, camZ } = G.cam, L = st.sun.dir;
  const { sunC } = lightColors(st);
  const light = f32(n * 3), specT = f32(n * 3);
  const lampL = separateLamps ? f32(n * 3) : light;
  const specI = st.specular ?? 0.35;
  const H = n / W;
  if (ambient.params) rows(import.meta.url, kShadeSun, { W, Nx, Ny, Nz, Px, Py, Pz, spec, direct, light, specT, camX, camY, camZ, L, sunC, specI, amb: ambient.params }, H);
  else kShadeSun({ W, Nx, Ny, Nz, Px, Py, Pz, spec, direct, light, specT, camX, camY, camZ, L, sunC, specI, ambient }, 0, H);
  // точечные источники
  const lights = deferredLights(scene, t, states);
  let litCount = 0, rays = 0;
  for (const lt of lights) {
    const kk = lampGain(st, lt);
    if (kk <= 0 || !(lt.radius > 0)) continue;
    const lc = rgb(lt.color).map((v) => lin22(v) * lt.energy * kk * 2.2);
    const [lx, ly, lz] = lt.p3, r = lt.radius;
    const rect = lampRect(G, lx, ly, lz, r);
    if (!rect) continue;
    const [xa, xb, ya, yb] = rect;
    litCount++;
    const shadowed = (lt.shadows ?? lt.group === 'lamp') && st.lightShadows && bvh;
    let vis = null;
    if (shadowed) { vis = lampVisibility(G, bvh, lx, ly, lz, r, rect); rays += vis.rays; }
    rows(import.meta.url, kShadeLamp, { W, ya, xa, xb, lx, ly, lz, r, lc, Nx, Ny, Nz, Px, Py, Pz, spec, camX, camY, camZ, specI, lampL, specT, vis: vis ? vis.data : null, vw: vis?.w, vx0: vis?.x0, vy0: vis?.y0 }, yb - ya + 1);
  }
  return { light, specT, lampL, lights, litCount, rays };
}

/** Полоса строк y0…y1: окружающий свет, солнце и его блик (light, specT). */
export function kShadeSun({ W, Nx, Ny, Nz, Px, Py, Pz, spec, direct, light, specT, camX, camY, camZ, L, sunC, specI, amb, ambient }, y0, y1) {
  if (!ambient) ambient = ambientOf(amb);
  for (let i = y0 * W, iEnd = y1 * W; i < iEnd; i++) {
    let vx = camX - Px[i], vy = camY - Py[i], vz = camZ - Pz[i];
    const vl = Math.hypot(vx, vy, vz) + 1e-6; vx /= vl; vy /= vl; vz /= vl;
    const hx = L[0] + vx, hy = L[1] + vy, hz = L[2] + vz;
    const hl = Math.hypot(hx, hy, hz) + 1e-6;
    const sp = Math.pow(clamp01((Nx[i] * hx + Ny[i] * hy + Nz[i] * hz) / hl), 40) * spec[i] * direct[i] * specI;
    for (let c = 0; c < 3; c++) {
      light[i * 3 + c] = ambient(i, c) + sunC[c] * direct[i];
      specT[i * 3 + c] = sp * sunC[c];
    }
  }
}

/** Полоса строк рамки лампы (y0…y1 — от её верхней строки ya): свет и блик лампы в lampL, specT. */
export function kShadeLamp({ W, ya, xa, xb, lx, ly, lz, r, lc, Nx, Ny, Nz, Px, Py, Pz, spec, camX, camY, camZ, specI, lampL, specT, vis, vw, vx0, vy0 }, y0, y1) {
  for (let y = ya + y0; y < ya + y1; y++) for (let x = xa; x <= xb; x++) {
    const i = y * W + x;
    const ddx = lx - Px[i], ddy = ly - Py[i], ddz = lz - Pz[i], dist = Math.hypot(ddx, ddy, ddz) + 1e-4;
    if (dist >= r) continue;
    const ldx = ddx / dist, ldy = ddy / dist, ldz = ddz / dist;
    const att = (1 - (dist / r) ** 2) ** 2;
    const nd = clamp01(Nx[i] * ldx + Ny[i] * ldy + Nz[i] * ldz);
    const vv = vis ? vis[(y - vy0) * vw + (x - vx0)] : 1;
    let vx = camX - Px[i], vy = camY - Py[i], vz = camZ - Pz[i];
    const vl = Math.hypot(vx, vy, vz) + 1e-6; vx /= vl; vy /= vl; vz /= vl;
    const hx = ldx + vx, hy = ldy + vy, hz = ldz + vz;
    const hl = Math.hypot(hx, hy, hz) + 1e-6;
    const sp = Math.pow(clamp01((Nx[i] * hx + Ny[i] * hy + Nz[i] * hz) / hl), 30) * spec[i] * att * vv * specI;
    for (let c = 0; c < 3; c++) { lampL[i * 3 + c] += nd * att * vv * lc[c]; specT[i * 3 + c] += sp * lc[c]; }
  }
}
