// Постобработка HDR (до тонмаппинга): глубина резкости, bloom, автоэкспозиция.
import { gauss, gaussKernel } from './filters.mjs';
import { viaGPU } from './gpu.mjs';
import { gpuBloom } from './gpu-post.mjs';
import { clamp01, Y3 } from './util.mjs';

/** Bloom (на месте): яркое выше threshold и свечение размываются тремя радиусами и добавляются. */
export function bloom(G, col, emL, strength, threshold) {
  const { W, H, n } = G;
  viaGPU('post', n, () => gpuBloom(col, emL, W, H, strength, threshold, gaussKernel), () => bloomCPU(W, H, n, col, emL, strength, threshold));
}
function bloomCPU(W, H, n, col, emL, strength, threshold) {
  const br = [0, 1, 2].map(() => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) br[c][i] = Math.max(0, col[i * 3 + c] - threshold) + emL[i * 3 + c] * 0.6;
  for (const [s, wgt] of [[4, 0.5], [14, 0.35], [40, 0.25]]) for (let c = 0; c < 3; c++) {
    const b = gauss(br[c], W, H, s * (W / 2560));
    for (let i = 0; i < n; i++) col[i * 3 + c] += b[i] * wgt * strength;
  }
}

/** Глубина фокуса 'auto': медиана глубины поверхностей в центральном окне кадра (иначе — по всему кадру). */
export function autoFocus(G) {
  const { W, H, mask, Dp } = G, vals = [];
  const pick = (x0, x1, y0, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * W + x; if (mask[i]) vals.push(Dp[i]); } };
  pick(Math.floor(W * 0.42), Math.ceil(W * 0.58), Math.floor(H * 0.4), Math.ceil(H * 0.62));
  if (vals.length < 16) { vals.length = 0; pick(0, W, 0, H); }
  if (!vals.length) return 10;
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

/**
 * Глубина резкости (на месте в col): кружок рассеяния coc = aperture·8·|1 − focus/глубина| px (для кадра 1280,
 * масштабируется), не больше maxBlur. Сбор по диску Фогеля: сосед вносит вклад, если его кружок дотягивается до
 * пикселя; задний план не наползает на резкий передний (его вклад ограничен своим кружком). Яркие точки HDR дают
 * «боке». near: false — передний план резкий. Возвращает { focus, maxCoc, coc (Float32 n или null) } — coc нужен
 * стилям, которые рисуют поверх (контур размывается вместе с тем, что он обводит).
 */
export function depthOfField(G, D, col) {
  const { W, H, n, mask, Dp } = G;
  const focus = D.focus === 'auto' || D.focus == null ? autoFocus(G) : Math.max(0.1, +D.focus);
  const sk = W / 1280, maxB = Math.max(0.5, (D.maxBlur ?? 14) * sk), ap = (D.aperture ?? 1) * 8 * sk;
  const coc = new Float32Array(n), depth = new Float32Array(n);
  let maxCoc = 0;
  for (let i = 0; i < n; i++) {
    const d = mask[i] ? Math.max(0.05, Dp[i]) : 1e4;
    depth[i] = d;
    let c = ap * Math.abs(1 - focus / d);
    if (D.near === false && d < focus) c = 0;
    c = Math.min(maxB, c);
    coc[i] = c;
    if (c > maxCoc) maxCoc = c;
  }
  if (maxCoc < 0.5) return { focus, maxCoc, coc: null };
  // радиус поиска: максимум кружков в соседних плитках (размытый передний план может наползать на резкий)
  const T = 16, tw = Math.ceil(W / T), th = Math.ceil(H / T), tile = new Float32Array(tw * th), tmax = new Float32Array(tw * th);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = ((y / T) | 0) * tw + ((x / T) | 0); if (coc[y * W + x] > tile[t]) tile[t] = coc[y * W + x]; }
  const reach = Math.ceil(maxB / T);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    let m = 0;
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) { const yy = ty + dy, xx = tx + dx; if (yy >= 0 && yy < th && xx >= 0 && xx < tw && tile[yy * tw + xx] > m) m = tile[yy * tw + xx]; }
    tmax[ty * tw + tx] = m;
  }
  // диск Фогеля (золотой угол): равномерные точки в единичном круге
  const S = Math.max(8, D.samples | 0 || 24), disk = new Float32Array(S * 3);
  for (let s = 0; s < S; s++) { const r = Math.sqrt((s + 0.5) / S), a = s * 2.39996323; disk[s * 3] = r * Math.cos(a); disk[s * 3 + 1] = r * Math.sin(a); disk[s * 3 + 2] = r; }
  const src = new Float32Array(col);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, R = Math.max(coc[i], tmax[((y / T) | 0) * tw + ((x / T) | 0)]);
    if (R < 0.5) continue;
    const ci = coc[i], di = depth[i];
    let ar = src[i * 3], ag = src[i * 3 + 1], ab = src[i * 3 + 2], ws = 1;
    for (let s = 0; s < S; s++) {
      const dist = disk[s * 3 + 2] * R, sx = Math.round(x + disk[s * 3] * R), sy = Math.round(y + disk[s * 3 + 1] * R);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const j = sy * W + sx;
      // передний сосед размывается поверх нас своим кружком; задний — не дальше нашего
      const eff = depth[j] < di ? coc[j] : Math.min(coc[j], ci);
      const w = clamp01(eff - dist + 1);
      if (w <= 0) continue;
      ar += src[j * 3] * w; ag += src[j * 3 + 1] * w; ab += src[j * 3 + 2] * w; ws += w;
    }
    col[i * 3] = ar / ws; col[i * 3 + 1] = ag / ws; col[i * 3 + 2] = ab / ws;
  }
  return { focus, maxCoc, coc };
}

/**
 * Автоэкспозиция: множитель, приводящий среднюю логарифмическую яркость кадра к key (с пределами min…max и долей
 * amount в логарифме). Самые яркие 2% (лампы, солнце в bloom) не учитываются — экспозиция не «прыгает» от источников.
 */
export function autoExposure(G, A, col) {
  const { n } = G, step = Math.max(1, Math.floor(n / 200000)), ys = [];
  for (let i = 0; i < n; i += step) ys.push(Y3(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]));
  ys.sort((a, b) => a - b);
  const m = Math.max(1, Math.floor(ys.length * 0.98));
  let s = 0;
  for (let i = 0; i < m; i++) s += Math.log(1e-4 + ys[i]);
  const avg = Math.exp(s / m), target = Math.min(A.max ?? 3, Math.max(A.min ?? 0.35, (A.key ?? 0.18) / Math.max(1e-4, avg)));
  return { k: Math.exp(Math.log(target) * clamp01(A.amount ?? 1)), avg };
}
