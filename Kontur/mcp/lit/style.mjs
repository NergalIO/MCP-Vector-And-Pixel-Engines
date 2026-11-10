// Цепочка стилей — LDR-постобработка над экранным кадром (Float32 RGB 0..1, n·3), по порядку scene.style:
// cel (учтён в освещении), kuwahara, paint (анизотропный Кувахара), hatch, ink, paper, vignette, pixelate,
// fxaa (сглаживание краёв), sharpen (адаптивная резкость), chromatic (хроматическая аберрация), grain (зерно плёнки).
// Размеры эффектов заданы для кадра шириной 2560 и масштабируются (W / 2560).
import { noise3 } from '../../engine/kontur.js';
import { upscaleNearest } from '../render.mjs';
import { uniform, gauss, dilate3, splitRGB } from './filters.mjs';
import { medianCut } from './color.mjs';
import { clamp01, hash01 } from './util.mjs';
import { rows, f32 } from './pool.mjs';

const luma = (img, i) => 0.299 * img[i * 3] + 0.587 * img[i * 3 + 1] + 0.114 * img[i * 3 + 2];

/** Пост-эффект стиля s над img. ctx: { W, H, W0, mask, chm, inkL, alb, Dp }. Возвращает новый буфер (или тот же). */
export function applyStyle(s, img, ctx) {
  const fn = STYLES[s.type];
  return fn ? fn(s, img, ctx) : img;
}

const STYLES = {
  cel: (s, img) => img, // ступени света считаются в освещении (sunDirect)

  kuwahara(s, img, { W, H }) {
    const n = W * H, sk = W / 2560;
    const r = Math.max(1, Math.round((s.radius ?? 3) * Math.max(0.35, sk))), size = r + 1;
    const ch = splitRGB(img, n);
    const m = ch.map((a) => uniform(a, W, H, size)), m2 = ch.map((a) => { const q = new Float32Array(n); for (let i = 0; i < n; i++) q[i] = a[i] * a[i]; return uniform(q, W, H, size); });
    const out = new Float32Array(n * 3), best = new Float32Array(n).fill(1e9);
    for (const [oy, ox] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const sy = Math.floor((oy * r) / 2), sx = Math.floor((ox * r) / 2);
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
  },

  paint(s, img, { W, H }) {
    // анизотропный Кувахара: окно-эллипс вытянуто вдоль штриха (тензор структуры), 8 секторов со взвешиванием
    // по дисперсии (обобщённый Кувахара, q = 8) — мазки идут по форме, края остаются чистыми
    const n = W * H, sk = W / 2560;
    const R = Math.max(1.5, (s.radius ?? 4) * Math.max(0.4, sk * 1.6)), q = s.sharpness ?? 8, alpha = 1;
    const Lm = new Float32Array(n);
    for (let i = 0; i < n; i++) Lm[i] = luma(img, i);
    const E = new Float32Array(n), F = new Float32Array(n), Gm = new Float32Array(n);
    for (let y = 0; y < H; y++) {
      const ym = (y > 0 ? y - 1 : 0) * W, y0 = y * W, yp = (y < H - 1 ? y + 1 : y) * W;
      for (let x = 0; x < W; x++) {
        const xm = x > 0 ? x - 1 : 0, xp = x < W - 1 ? x + 1 : x;
        const gx = (Lm[ym + xp] + 2 * Lm[y0 + xp] + Lm[yp + xp] - Lm[ym + xm] - 2 * Lm[y0 + xm] - Lm[yp + xm]) / 4;
        const gy = (Lm[yp + xm] + 2 * Lm[yp + x] + Lm[yp + xp] - Lm[ym + xm] - 2 * Lm[ym + x] - Lm[ym + xp]) / 4;
        const i = y0 + x; E[i] = gx * gx; F[i] = gx * gy; Gm[i] = gy * gy;
      }
    }
    const ss = Math.max(1, 2 * Math.max(0.5, sk * 1.5)), Es = gauss(E, W, H, ss), Fs = gauss(F, W, H, ss), Gs = gauss(Gm, W, H, ss);
    // выборка в единичном круге: центр + кольца; сектор каждой точки фиксирован (в локальных осях)
    const pts = [];
    for (const [rr, cnt] of [[0.35, 8], [0.68, 12], [1, 16]]) for (let j = 0; j < cnt; j++) { const a = ((j + 0.5) / cnt) * 6.2831853; pts.push([rr * Math.cos(a), rr * Math.sin(a), Math.floor((a / 6.2831853) * 8) & 7]); }
    const out = f32(n * 3);
    rows(import.meta.url, kPaint, { W, H, R, q, alpha, Es, Fs, Gs, img, out, pts }, H);
    return out;
  },

  hatch(s, img, { W, H, mask, chm }) {
    const sk = W / 2560;
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
  },

  ink(s, img, { W, H, mask, inkL, alb, Dp, coc }) {
    const n = W * H;
    const a0 = s.strength ?? 1, out = new Float32Array(n * 3);
    const byAlb = s.color === 'albedo', hc = byAlb ? null : s.color || [0, 0, 0], dk = s.darken ?? 0.3;
    let cov = null;
    // глубина резкости: линия вне фокуса размывается вместе с предметом (уровни гаусса по кружку coc) и бледнеет
    const defocus = (c) => {
      if (!coc) return c;
      const base = c || (() => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = 1 - inkL[i]; return a; })();
      const lv = [0, 1.5, 4, 9], bl = lv.map((sg) => (sg ? gauss(base, W, H, sg) : base)), o = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const sg = Math.min(9, coc[i] * 0.5);
        let k = 0; while (k < 2 && sg > lv[k + 1]) k++;
        const q = Math.min(1, (sg - lv[k]) / (lv[k + 1] - lv[k]));
        o[i] = (bl[k][i] * (1 - q) + bl[k + 1][i] * q) / (1 + coc[i] * 0.08);
      }
      return o;
    };
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
    cov = defocus(cov);
    for (let i = 0; i < n; i++) {
      const a = (cov ? cov[i] : 1 - inkL[i]) * a0;
      if (byAlb) for (let c = 0; c < 3; c++) { const lc = (alb[i * 4 + c] / 255) * dk; out[i * 3 + c] = img[i * 3 + c] * (1 - a) + lc * a; }
      else for (let c = 0; c < 3; c++) out[i * 3 + c] = img[i * 3 + c] * (1 - a) + hc[c] * a;
    }
    return out;
  },

  paper(s, img, { W, H }) {
    // фактура бумаги: зерно + волокна (шум в координатах эталонного кадра 2560 — одинаково при любой ширине)
    const n = W * H, sk = W / 2560;
    const a0 = s.strength ?? 0.08, tint = s.color ? s.color : [0.98, 0.95, 0.88], ta = s.tint ?? 0.12, sc = (s.scale ?? 1) * sk, out = new Float32Array(n * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, X = x / sc, Y = y / sc;
      const g = noise3(X * 0.45, Y * 0.45, 0.5, 71) * 0.55 + noise3(X * 0.12, Y * 0.12, 1.5, 73) * 0.3 + noise3(X * 0.02, Y * 0.35, 2.5, 79) * 0.35;
      const m = 1 + g * a0;
      for (let c = 0; c < 3; c++) { const v = img[i * 3 + c] * m; out[i * 3 + c] = clamp01(v * (1 - ta) + v * tint[c] * ta); }
    }
    return out;
  },

  vignette(s, img, { W, H }) {
    const n = W * H, v0 = s.strength ?? 0.22, out = new Float32Array(n * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = 1 - v0 * (((x - W / 2) / (W / 2)) ** 2 + ((y - H / 2) / (H / 1.2)) ** 2), i = y * W + x;
      for (let c = 0; c < 3; c++) out[i * 3 + c] = clamp01(img[i * 3 + c] * v);
    }
    return out;
  },

  pixelate(s, img, { W, H, W0 }) {
    // сетка пикселей задана в единицах сцены: size 4 при ширине 2560 → 640 «пикселей» при любой ширине вывода
    const n = W * H, ps = s.size ?? 4, lw = Math.max(1, Math.floor(W0 / ps)), lh = Math.max(1, Math.floor((H * W0) / W / ps));
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
  },

  /**
   * FXAA 3.11 (упрощённый, качество 12 шагов): ищет край по контрасту яркости, идёт вдоль него до конца
   * и смешивает пиксель с соседом поперёк края. Убирает «лесенку» растеризации проходов и стилей.
   */
  fxaa(s, img, { W, H }) {
    const n = W * H, Lm = new Float32Array(n), out = new Float32Array(img);
    for (let i = 0; i < n; i++) Lm[i] = Math.sqrt(luma(img, i)); // перцептивная яркость
    const thr = s.threshold ?? 0.125, thrMin = s.thresholdMin ?? 0.0312, sub = s.subpix ?? 0.75;
    const at = (x, y) => Lm[(y < 0 ? 0 : y >= H ? H - 1 : y) * W + (x < 0 ? 0 : x >= W ? W - 1 : x)];
    const STEPS = [1, 1, 1, 1, 1, 1.5, 2, 2, 2, 2, 4, 8];
    const sample = (fx, fy, c) => { // билинейная выборка канала c
      const x0 = Math.max(0, Math.min(W - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(H - 1, Math.floor(fy))), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), tx = clamp01(fx - x0), ty = clamp01(fy - y0);
      return (img[(y0 * W + x0) * 3 + c] * (1 - tx) + img[(y0 * W + x1) * 3 + c] * tx) * (1 - ty) + (img[(y1 * W + x0) * 3 + c] * (1 - tx) + img[(y1 * W + x1) * 3 + c] * tx) * ty;
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const lC = at(x, y), lN = at(x, y - 1), lS = at(x, y + 1), lW = at(x - 1, y), lE = at(x + 1, y);
      const lMax = Math.max(lC, lN, lS, lW, lE), lMin = Math.min(lC, lN, lS, lW, lE), range = lMax - lMin;
      if (range < Math.max(thrMin, lMax * thr)) continue;
      const lNW = at(x - 1, y - 1), lNE = at(x + 1, y - 1), lSW = at(x - 1, y + 1), lSE = at(x + 1, y + 1);
      const eH = Math.abs(lNW + lNE - 2 * lN) + 2 * Math.abs(lW + lE - 2 * lC) + Math.abs(lSW + lSE - 2 * lS);
      const eV = Math.abs(lNW + lSW - 2 * lW) + 2 * Math.abs(lN + lS - 2 * lC) + Math.abs(lNE + lSE - 2 * lE);
      const horz = eH >= eV;
      const l1 = horz ? lN : lW, l2 = horz ? lS : lE, g1 = Math.abs(l1 - lC), g2 = Math.abs(l2 - lC);
      const neg = g1 >= g2, grad = Math.max(g1, g2) * 0.25, lEdge = ((neg ? l1 : l2) + lC) * 0.5, stepLen = neg ? -1 : 1;
      // вдоль края до концов
      let ux = x + 0.5 + (horz ? 0 : stepLen * 0.5), uy = y + 0.5 + (horz ? stepLen * 0.5 : 0);
      const dx = horz ? 1 : 0, dy = horz ? 0 : 1;
      const lumAt = (fx, fy) => { const xi = Math.floor(fx - 0.5), yi = Math.floor(fy - 0.5), tx = fx - 0.5 - xi, ty = fy - 0.5 - yi; return (at(xi, yi) * (1 - tx) + at(xi + 1, yi) * tx) * (1 - ty) + (at(xi, yi + 1) * (1 - tx) + at(xi + 1, yi + 1) * tx) * ty; };
      let p1x = ux - dx, p1y = uy - dy, p2x = ux + dx, p2y = uy + dy;
      let e1 = lumAt(p1x, p1y) - lEdge, e2 = lumAt(p2x, p2y) - lEdge, d1 = Math.abs(e1) >= grad, d2 = Math.abs(e2) >= grad;
      for (let k = 1; k < STEPS.length && !(d1 && d2); k++) {
        if (!d1) { p1x -= dx * STEPS[k]; p1y -= dy * STEPS[k]; e1 = lumAt(p1x, p1y) - lEdge; d1 = Math.abs(e1) >= grad; }
        if (!d2) { p2x += dx * STEPS[k]; p2y += dy * STEPS[k]; e2 = lumAt(p2x, p2y) - lEdge; d2 = Math.abs(e2) >= grad; }
      }
      const dist1 = horz ? x + 0.5 - p1x : y + 0.5 - p1y, dist2 = horz ? p2x - x - 0.5 : p2y - y - 0.5;
      const near1 = dist1 < dist2, dmin = Math.min(dist1, dist2), span = dist1 + dist2;
      const good = ((near1 ? e1 : e2) < 0) !== (lC - lEdge < 0);
      let off = good ? 0.5 - dmin / span : 0;
      // субпиксельное сглаживание (одиночные яркие точки)
      const lAvg = (2 * (lN + lS + lW + lE) + lNW + lNE + lSW + lSE) / 12, sp = clamp01(Math.abs(lAvg - lC) / range), spf = (-2 * sp + 3) * sp * sp;
      off = Math.max(off, spf * spf * sub);
      const fx = x + 0.5 + (horz ? 0 : off * stepLen) - 0.5, fy = y + 0.5 + (horz ? off * stepLen : 0) - 0.5, i = y * W + x;
      for (let c = 0; c < 3; c++) out[i * 3 + c] = sample(fx, fy, c);
    }
    return out;
  },

  /** Адаптивная резкость (по мотивам AMD CAS): сила обратна локальному контрасту — шум и края не пересвечиваются. */
  sharpen(s, img, { W, H }) {
    const n = W * H, out = new Float32Array(n * 3), amt = clamp01(s.amount ?? 0.4);
    const peak = -1 / (8 - 3 * amt); // −0.125 … −0.2
    for (let y = 0; y < H; y++) {
      const ym = (y > 0 ? y - 1 : 0) * W, y0 = y * W, yp = (y < H - 1 ? y + 1 : y) * W;
      for (let x = 0; x < W; x++) {
        const xm = x > 0 ? x - 1 : 0, xp = x < W - 1 ? x + 1 : x, i = y0 + x;
        for (let c = 0; c < 3; c++) {
          const a = img[(ym + x) * 3 + c], b = img[(y0 + xm) * 3 + c], e = img[i * 3 + c], d = img[(y0 + xp) * 3 + c], f = img[(yp + x) * 3 + c];
          const mn = Math.min(a, b, e, d, f), mx = Math.max(a, b, e, d, f);
          const k = Math.sqrt(clamp01(Math.min(mn, 1 - mx) / Math.max(1e-4, mx))) * peak;
          out[i * 3 + c] = clamp01((e + k * (a + b + d + f)) / (1 + 4 * k));
        }
      }
    }
    return out;
  },

  /** Хроматическая аберрация: красный и синий сдвинуты радиально от центра (amount px у края кадра 2560). */
  chromatic(s, img, { W, H }) {
    const n = W * H, out = new Float32Array(n * 3), amt = (s.amount ?? 1.5) * (W / 2560), cx = W / 2, cy = H / 2, rN = Math.hypot(cx, cy);
    const samp = (fx, fy, c) => {
      const x0 = Math.max(0, Math.min(W - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(H - 2, Math.floor(fy))), tx = clamp01(fx - x0), ty = clamp01(fy - y0);
      const i00 = (y0 * W + x0) * 3 + c;
      return (img[i00] * (1 - tx) + img[i00 + 3] * tx) * (1 - ty) + (img[i00 + W * 3] * (1 - tx) + img[i00 + W * 3 + 3] * tx) * ty;
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) / rN, k = (amt * r) / rN; // сдвиг = amt·r² px
      out[i * 3] = samp(x + dx * k, y + dy * k, 0);
      out[i * 3 + 1] = img[i * 3 + 1];
      out[i * 3 + 2] = samp(x - dx * k, y - dy * k, 2);
    }
    return out;
  },

  /** Зерно плёнки: детерминированный шум, сильнее в средних тонах, size — размер зерна (px кадра 2560). */
  grain(s, img, { W, H }) {
    const n = W * H, out = new Float32Array(n * 3), amt = s.amount ?? 0.04, size = Math.max(0.5, (s.size ?? 1.2) * (W / 2560)), seed = s.seed ?? 1, mono = s.color !== true;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, gx = Math.floor(x / size), gy = Math.floor(y / size), cell = gy * 65521 + gx;
      const l = luma(img, i), w = 4 * l * (1 - l) * 0.75 + 0.25; // средние тона — зернистее
      for (let c = 0; c < 3; c++) {
        const r = (hash01(cell, seed * 7 + (mono ? 0 : c)) + hash01(cell, seed * 7 + 3 + (mono ? 0 : c)) - 1) * amt * w;
        out[i * 3 + c] = clamp01(img[i * 3 + c] + r);
      }
    }
    return out;
  },
};

/** Полоса строк y0…y1 анизотропного Кувахары (стиль paint): out по img и тензору структуры (Es, Fs, Gs). */
export function kPaint({ W, H, R, q, alpha, Es, Fs, Gs, img, out, pts }, y0, y1) {
  const np = pts.length;
  const sm = new Float64Array(8 * 3), sq = new Float64Array(8), cn = new Float64Array(8);
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
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
}
