// Отражения в экранном пространстве (SSR): полы с бликом (паркет, мокрый камень) отражают уже собранный кадр.
// Луч отражения шагает в мире, каждый шаг проецируется и сравнивается с глубиной буфера; попадание уточняется
// бинарным поиском. Сила — по Френелю, блику пикселя, краю кадра и пройденному пути.
import { clamp01, hash01 } from './util.mjs';

/** Смешать отражения в col (на месте). Возвращает число пикселей с отражением. */
export function screenReflections(G, R, col) {
  const { W, H, mask, spec, chm, PNx, PNy, PNz, Px, Py, Pz, Nx, Ny, Nz, Dp } = G, { camX, camY, camZ, proj } = G.cam;
  const steps = Math.max(8, R.steps | 0), maxD = R.maxDist, thick = R.thickness, minS = R.minSpec;
  const src = new Float32Array(col), pr = [0, 0, 0];
  let ssrPixels = 0;
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
  return ssrPixels;
}
