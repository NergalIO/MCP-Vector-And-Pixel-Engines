// Окклюзия окружения (AO), половинное разрешение.
// ssao — прежний (радиусы в пикселях эталона 2560, по нормалям плоскостей): кадр не меняется.
// gtao — горизонтный (GTAO/HBAO): в каждом из dirs экранных направлений ищется наивысший горизонт с обеих сторон
//   в радиусе radius МЕТРОВ (проекция по глубине: ближнее — шире, дальнее — уже), видимость косинусно взвешена;
//   изогнутая нормаль (bent normal) — среднее свободное направление, по ней берётся свет неба и земли
//   (щели и углы получают небо «сверху», а не по своей нормали); multiBounce — отскок света внутри щелей по альбедо.
import { gauss, bilateral, zoom2 } from './filters.mjs';
import { clamp01, pyRound, hash01 } from './util.mjs';
import { rows, f32, u8 } from './pool.mjs';
import { viaGPU } from './gpu.mjs';
import { gpuGtao, gpuSsao } from './gpu-kernels.mjs';

/** Прежний SSAO: Float32 n (1 — открыто). */
export function ssao(G, o) {
  const { W, H, n, hw, hh, hn, mask, Px, Py, Pz, PNx, PNy, PNz } = G;
  const hx = f32(hn), hy = f32(hn), hz = f32(hn), hnx = f32(hn), hny = f32(hn), hnz = f32(hn);
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    const i = 2 * y * W + 2 * x, j = y * hw + x;
    if (mask[i]) { hx[j] = Px[i]; hy[j] = Py[i]; hz[j] = Pz[i]; } else { hx[j] = 0; hy[j] = 0; hz[j] = 1e4; }
    hnx[j] = PNx[i]; hny[j] = PNy[i]; hnz[j] = PNz[i];
  }
  const occA = f32(hn), rad = o.radius ?? 0.9, offs = [];
  for (const r0 of [3, 8, 18, 34]) {
    const r = r0 * (W / 2560); // радиусы — пиксели половинного кадра шириной 2560 (эталон), масштабируются с шириной
    for (let q = 0; q < 8; q++) {
      const a = (q * Math.PI) / 4 + r0 * 0.37;
      offs.push(pyRound(Math.cos(a) * r), pyRound(Math.sin(a) * r));
    }
  }
  const cnt = offs.length / 2;
  const sargs = { hw, hh, hx, hy, hz, hnx, hny, hnz, occA, rad, offs };
  viaGPU('ao', hn, () => gpuSsao(sargs), () => rows(import.meta.url, kSsao, sargs, hh));
  const aoH = f32(hn);
  for (let j = 0; j < hn; j++) aoH[j] = 1 - clamp01((occA[j] / cnt) * 2.6);
  const ao = zoom2(gauss(aoH, hw, hh, 1.2), hw, hh, W, H);
  const s = o.strength ?? 1;
  for (let i = 0; i < n; i++) ao[i] = 1 - (1 - ao[i]) * s;
  return { ao };
}

/**
 * GTAO: { ao (Float32 n), bent?: [bx, by, bz] (Float32 n, нормированы) }.
 * o: radius (м, 0.9), strength, dirs (4), steps (8 на сторону), falloff (доля радиуса без затухания, 0.6), bent, bias.
 */
export function gtao(G, o) {
  const { W, H, n, hw, hh, hn, mask, Px, Py, Pz, PNx, PNy, PNz, Nx, Ny, Nz, Dp } = G;
  const rad = o.radius ?? 0.9, dirs = Math.max(2, o.dirs | 0 || 4), steps = Math.max(3, o.steps | 0 || 8), fall0 = rad * clamp01(o.falloff ?? 0.6), bias = o.bias ?? 0.04;
  const fHalf = G.cam.f / 2, maxPx = 64 * Math.max(1, hw / 960);
  const hm = u8(hn), hx = f32(hn), hy = f32(hn), hz = f32(hn), hnx = f32(hn), hny = f32(hn), hnz = f32(hn), hD = f32(hn);
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    const i = 2 * y * W + 2 * x, j = y * hw + x;
    hm[j] = mask[i]; hx[j] = Px[i]; hy[j] = Py[i]; hz[j] = Pz[i]; hnx[j] = PNx[i]; hny[j] = PNy[i]; hnz[j] = PNz[i]; hD[j] = Dp[i];
  }
  const vis = f32(hn).fill(1);
  const wantBent = o.bent !== false;
  const bx = wantBent ? f32(hn) : null, by = wantBent ? f32(hn) : null, bz = wantBent ? f32(hn) : null;
  const gargs = { hw, hh, hm, hx, hy, hz, hnx, hny, hnz, hD, vis, bx, by, bz, wantBent, rad, dirs, steps, fall0, bias, fHalf, maxPx };
  viaGPU('ao', hn, () => gpuGtao(gargs), () => rows(import.meta.url, kGtao, gargs, hh));
  const sc = Math.max(1, hw / 960), sig = (o.denoise ?? 1) * 1.6 * sc;
  const up = (a) => zoom2(bilateral(a, hw, hh, sig, hD, hnx, hny, hnz, hm), hw, hh, W, H);
  const ao = up(vis), s = o.strength ?? 1, chm = G.chm;
  // персонажи-спрайты нарисованы со своей светотенью: AO их не темнит (тень от них на полу остаётся)
  for (let i = 0; i < n; i++) ao[i] = mask[i] ? 1 - (1 - clamp01(ao[i])) * s * (1 - chm[i]) : 1;
  if (!wantBent) return { ao };
  const fx = up(bx), fy = up(by), fz = up(bz);
  for (let i = 0; i < n; i++) {
    if (!mask[i]) { fx[i] = Nx[i]; fy[i] = Ny[i]; fz[i] = Nz[i]; continue; }
    // рельеф материалов и деталей: сдвиг нормали относительно плоскости переносится на изогнутую нормаль
    let ex = fx[i] + (Nx[i] - PNx[i]), ey = fy[i] + (Ny[i] - PNy[i]), ez = fz[i] + (Nz[i] - PNz[i]);
    const l = Math.hypot(ex, ey, ez);
    if (l < 1e-6) { ex = Nx[i]; ey = Ny[i]; ez = Nz[i]; } else { ex /= l; ey /= l; ez /= l; }
    // не дальше 75° от нормали (иначе узкие щели светятся небом «сбоку»)
    const dn = ex * Nx[i] + ey * Ny[i] + ez * Nz[i];
    if (dn < 0.26) { const w = (0.26 - dn) / 1.26; ex += (Nx[i] - ex) * w * 2; ey += (Ny[i] - ey) * w * 2; ez += (Nz[i] - ez) * w * 2; const l2 = Math.hypot(ex, ey, ez) || 1; ex /= l2; ey /= l2; ez /= l2; }
    fx[i] = ex; fy[i] = ey; fz[i] = ez;
  }
  return { ao, bent: [fx, fy, fz] };
}

/** Полоса строк y0…y1 половинной сетки GTAO: видимость vis и изогнутая нормаль (bx, by, bz). */
export function kGtao({ hw, hh, hm, hx, hy, hz, hnx, hny, hnz, hD, vis, bx, by, bz, wantBent, rad, dirs, steps, fall0, bias, fHalf, maxPx }, y0, y1) {
  const fall = (d) => (d <= fall0 ? 1 : d >= rad ? 0 : 1 - (d - fall0) / (rad - fall0 || 1e-6));
  for (let y = y0; y < y1; y++) for (let x = 0; x < hw; x++) {
    const j = y * hw + x;
    if (!hm[j]) continue;
    const px = hx[j], py = hy[j], pz = hz[j], nx = hnx[j], ny = hny[j], nzz = hnz[j];
    const rpx = Math.min(maxPx, (rad * fHalf) / Math.max(0.3, hD[j]));
    if (wantBent) { bx[j] = nx * 0.2; by[j] = ny * 0.2; bz[j] = nzz * 0.2; }
    if (rpx < 1) { if (wantBent) { bx[j] = nx; by[j] = ny; bz[j] = nzz; } continue; }
    const rot = hash01(j, 31) * Math.PI, jit = hash01(j, 37);
    let vsum = 0;
    for (let d = 0; d < dirs; d++) {
      const a = rot + (d * Math.PI) / dirs, ca = Math.cos(a), sa = Math.sin(a);
      for (let side = -1; side <= 1; side += 2) {
        let hmax = 0, tx = 0, ty = 0, tz = 0, has = false;
        for (let s = 0; s < steps; s++) {
          const t = 1 + (rpx - 1) * ((s + jit) / steps);
          const sx = Math.round(x + side * ca * t), sy = Math.round(y + side * sa * t);
          if (sx < 0 || sy < 0 || sx >= hw || sy >= hh) break;
          const q = sy * hw + sx;
          if (!hm[q] || q === j) continue;
          const vx = hx[q] - px, vy = hy[q] - py, vz = hz[q] - pz, dist = Math.hypot(vx, vy, vz) + 1e-5;
          if (!has) { tx = vx; ty = vy; tz = vz; has = true; }
          if (dist >= rad) continue;
          const h = ((vx * nx + vy * ny + vz * nzz) / dist - bias) * fall(dist);
          if (h > hmax) hmax = h;
        }
        hmax = Math.min(1, hmax);
        const v = 1 - hmax;
        vsum += v;
        if (wantBent && has) {
          // касательная стороны: направление к первой выборке, спроецированное на плоскость
          const dn = tx * nx + ty * ny + tz * nzz;
          let ux = tx - dn * nx, uy = ty - dn * ny, uz = tz - dn * nzz;
          const ul = Math.hypot(ux, uy, uz);
          if (ul > 1e-6) {
            ux /= ul; uy /= ul; uz /= ul;
            // середина свободного сектора: между горизонтом (asin hmax) и нормалью
            const e = (Math.asin(hmax) + Math.PI / 2) / 2, ce = Math.cos(e), se = Math.sin(e);
            bx[j] += (ce * ux + se * nx) * v; by[j] += (ce * uy + se * ny) * v; bz[j] += (ce * uz + se * nzz) * v;
          }
        }
      }
    }
    vis[j] = vsum / (2 * dirs);
  }
}

/** Полоса строк y0…y1 половинной сетки SSAO: сумма заслонения по смещениям offs (пары dx, dy) в occA. */
export function kSsao({ hw, hh, hx, hy, hz, hnx, hny, hnz, occA, rad, offs }, y0, y1) {
  for (let y = y0; y < y1; y++) for (let k = 0; k < offs.length; k += 2) {
    const ox = offs[k], oy = offs[k + 1], sy = Math.min(hh - 1, Math.max(0, y + oy));
    for (let x = 0; x < hw; x++) {
      const sx = Math.min(hw - 1, Math.max(0, x + ox)), j = y * hw + x, s = sy * hw + sx;
      const vx = hx[s] - hx[j], vy = hy[s] - hy[j], vz = hz[s] - hz[j];
      const dist = Math.hypot(vx, vy, vz) + 1e-4;
      occA[j] += clamp01((vx * hnx[j] + vy * hny[j] + vz * hnz[j]) / dist - 0.12) / (1 + (dist / rad) ** 2);
    }
  }
}

/** AO по настройкам ao (null — выключено): { ao, bent? }. */
export function ambientOcclusion(G, o) {
  if (!((o?.strength ?? 1) > 0)) return { ao: new Float32Array(G.n).fill(1) };
  return o?.mode === 'gtao' ? gtao(G, o) : ssao(G, o || {});
}

/**
 * Многократный отскок внутри щелей (Jimenez 2016): светлые поверхности теряют меньше света в AO.
 * ao — видимость, alb — линейное альбедо канала.
 */
export const multiBounce = (ao, alb) => {
  const a = 2.0404 * alb - 0.3324, b = -4.7951 * alb + 0.6417, c = 2.7552 * alb + 0.6903;
  return Math.max(ao, ((ao * a + b) * ao + c) * ao);
};
