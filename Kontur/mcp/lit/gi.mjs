// Отражённый свет (GI) в экранном пространстве, половинное разрешение: каждый пиксель собирает излучение соседей
// (прямой свет × альбедо) с весом по взаимной ориентации и расстоянию. bounces 2…3 — следующий отскок собирает уже
// отражённый свет (щели и внутренние углы светлеют, цветные рефлексы уходят дальше). Шум убирает билатеральный фильтр.
import { bilateral, zoom2 } from './filters.mjs';
import { hash01 } from './util.mjs';
import { f32 } from './pool.mjs';
import { halves } from './gbuffer.mjs';
import { viaRows } from './gpu.mjs';
import { gpuGather } from './gpu-kernels.mjs';

/** Добавить отражённый свет в light (на месте). ambient(i, c) — окружающая часть light (её не отражаем). */
export function screenGI(G, gi, { light, lampL, lin, ao, ambient }) {
  const { W, H, n, hw, hh, hn, mask, Px, Py, Pz, Nx, Ny, Nz, Dp } = G;
  const rad = gi.radius ?? 2.5;
  const [hm, hx, hy, hz, hnx, hny, hnz, hD] = halves(G, 'mask', 'Px', 'Py', 'Pz', 'Nx', 'Ny', 'Nz', 'Dp');
  const radc = [f32(hn), f32(hn), f32(hn)];
  const bounces = Math.max(1, Math.min(3, gi.bounces | 0 || 1));
  const halb = bounces > 1 ? [f32(hn), f32(hn), f32(hn)] : null;
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    const i = 2 * y * W + 2 * x, j = y * hw + x;
    // излучение отправителя: прямой свет солнца и ламп × альбедо (небо отражённым светом не считаем)
    if (mask[i]) for (let c = 0; c < 3; c++) {
      radc[c][j] = lin[i * 3 + c] * (light[i * 3 + c] + (lampL !== light ? lampL[i * 3 + c] : 0) - ambient(i, c));
      if (halb) halb[c][j] = lin[i * 3 + c];
    }
  }
  const radii = [5, 12, 26, 52].map((r) => r * (W / 2560) * (gi.scale ?? 1)), dirs = 6, taps = radii.length * dirs;
  const kk = (gi.strength * 2.4) / taps;
  const gather = (src, salt) => {
    const out = [f32(hn), f32(hn), f32(hn)];
    const args = { hw, hh, hm, hx, hy, hz, hnx, hny, hnz, src, out, radii, dirs, kk, salt, rad };
    viaRows('gi', hn, () => gpuGather(args), import.meta.url, kGather, args, hh);
    return out;
  };
  const acc = gather(radc, 0);
  // следующие отскоки: отражённый свет × альбедо становится излучением (другой поворот выборок — меньше узора)
  let prev = acc;
  for (let b = 1; b < bounces; b++) {
    const src = [0, 1, 2].map((c) => { const a = f32(hn); for (let j = 0; j < hn; j++) a[j] = prev[c][j] * halb[c][j]; return a; });
    prev = gather(src, b * 7919);
    for (let c = 0; c < 3; c++) for (let j = 0; j < hn; j++) acc[c][j] += prev[c][j];
  }
  const sgi = Math.max(1, hw / 640);
  for (let c = 0; c < 3; c++) {
    const up = zoom2(bilateral(acc[c], hw, hh, 2.5 * sgi, hD, hnx, hny, hnz, hm), hw, hh, W, H);
    for (let i = 0; i < n; i++) if (mask[i]) light[i * 3 + c] += up[i] * (0.4 + 0.6 * ao[i]);
  }
}

/** Полоса строк y0…y1 половинной сетки: сбор излучения src соседей в out (три канала). */
export function kGather({ hw, hh, hm, hx, hy, hz, hnx, hny, hnz, src, out, radii, dirs, kk, salt, rad }, y0, y1) {
  for (let y = y0; y < y1; y++) for (let x = 0; x < hw; x++) {
    const j = y * hw + x;
    if (!hm[j]) continue;
    const rot = hash01(j + salt, 7) * 6.2831853;
    let ar = 0, ag = 0, ab = 0;
    for (let ri = 0; ri < radii.length; ri++) for (let q = 0; q < dirs; q++) {
      const a = rot + (q * 6.2831853) / dirs + ri * 0.9, rr = radii[ri] * (0.75 + 0.5 * hash01(j * 31 + ri * dirs + q + salt, 9));
      const sx = Math.round(x + Math.cos(a) * rr), sy = Math.round(y + Math.sin(a) * rr);
      if (sx < 0 || sy < 0 || sx >= hw || sy >= hh) continue;
      const s = sy * hw + sx;
      if (!hm[s]) continue;
      const vx = hx[s] - hx[j], vy = hy[s] - hy[j], vz = hz[s] - hz[j], d = Math.hypot(vx, vy, vz) + 1e-4;
      const cr = (vx * hnx[j] + vy * hny[j] + vz * hnz[j]) / d, cs = -(vx * hnx[s] + vy * hny[s] + vz * hnz[s]) / d;
      if (cr <= 0.05 || cs <= 0.05) continue;
      const w = (cr * cs) / (1 + (d / rad) ** 2);
      ar += src[0][s] * w; ag += src[1][s] * w; ab += src[2][s] * w;
    }
    out[0][j] = ar * kk; out[1][j] = ag * kk; out[2][j] = ab * kk;
  }
}
