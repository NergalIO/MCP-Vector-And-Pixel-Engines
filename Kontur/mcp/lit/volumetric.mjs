// Объёмный свет: лучи солнца в дымке (марш по лучу камеры с тенью по BVH, фаза Хеньи — Гринстейна, 1/4 разрешения)
// и ореолы ламп (аналитический интеграл рассеяния 1/d² вдоль луча внутри сферы влияния).
import { gauss, upF } from './filters.mjs';
import { hash01 } from './util.mjs';
import { lampGain, lampRect, lightColors, lampColor } from './shade.mjs';

/** Добавить объёмный свет в col (на месте). Возвращает число лучей теней. */
export function volumetricLight(G, st, V, { col, lights, bvh }) {
  const { W, H, n, mask, Px, Py, Pz } = G, { camX, camY, camZ, ray } = G.cam;
  const L = st.sun.dir, { sunC } = lightColors(st), rd = [0, 0, 0];
  let rays = 0;
  const vf = 4, vw = Math.ceil(W / vf), vh = Math.ceil(H / vf), vn = vw * vh, steps = Math.max(4, V.steps | 0);
  const g = V.g ?? 0.5, dens = V.density, vc = V.color;
  const hg = (c) => (1 - g * g) / Math.pow(1 + g * g - 2 * g * c, 1.5);
  if (V.sun !== false && dens > 0) {
    const acc = new Float32Array(vn);
    for (let y = 0; y < vh; y++) for (let x = 0; x < vw; x++) {
      const fx = Math.min(W - 1, x * vf + (vf >> 1)), fy = Math.min(H - 1, y * vf + (vf >> 1)), i = fy * W + fx, j = y * vw + x;
      ray(fx, fy, rd);
      let dx = rd[0], dy = rd[1], dzz = rd[2];
      const dl = Math.hypot(dx, dy, dzz); dx /= dl; dy /= dl; dzz /= dl;
      const tEnd = mask[i] ? Math.min(V.maxDist, Math.hypot(Px[i] - camX, Py[i] - camY, Pz[i] - camZ)) : V.maxDist;
      const dt = tEnd / steps, jit = hash01(j, 13);
      let sum = 0;
      for (let s = 0; s < steps; s++) {
        const tt = (s + jit) * dt;
        const vis = bvh ? (bvh.occluded(camX + dx * tt, camY + dy * tt, camZ + dzz * tt, L[0], L[1], L[2], 1e9, j * 64 + s) ? 0 : 1) : 1;
        sum += vis * Math.exp(-dens * tt) * dt;
      }
      rays += bvh ? steps : 0;
      acc[j] = sum * dens * hg(dx * L[0] + dy * L[1] + dzz * L[2]);
    }
    const up = upF(gauss(acc, vw, vh, 1.2), vw, vh, vf, W, H);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) col[i * 3 + c] += up[i] * sunC[c] * vc[c] * 0.6;
  }
  // ореолы ламп
  if ((V.lamps ?? 0) > 0) {
    const ld = (V.lampDensity ?? 0.025) * V.lamps;
    for (const lt of lights) {
      const kk = lampGain(st, lt);
      if (kk <= 0 || !(lt.radius > 0) || lt.halo === false) continue;
      const lc = lampColor(lt, kk, ld, lt.halo ?? (lt.group === 'fairy' ? 0.3 : 1));
      const [lx, ly, lz] = lt.p3, r = Math.min(lt.radius, (V.haloRadius ?? 0.45) * lt.radius + 0.6), r2 = r * r;
      const rect = lampRect(G, lx, ly, lz, r);
      if (!rect) continue;
      const [xa, xb, ya, yb] = rect;
      const ex = lx - camX, ey = ly - camY, ez = lz - camZ, e2 = ex * ex + ey * ey + ez * ez;
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        const i = y * W + x;
        ray(x, y, rd);
        let dx = rd[0], dy = rd[1], dzz = rd[2];
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
  return rays;
}
