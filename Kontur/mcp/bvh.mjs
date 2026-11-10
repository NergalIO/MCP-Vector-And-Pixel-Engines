// BVH по треугольникам и коробкам окклюдеров: лучи теней солнца и ламп, объёмный свет.
// Разбиение по SAH на корзинах (12 корзин по оси с наибольшим разбросом центров), typed arrays, обход стеком без рекурсии.
// Треугольник с alpha < 1 (листва, флажки, решётки) задерживает луч с вероятностью alpha (хеш луча и номера) —
// после размытия это частичная тень.

/**
 * Построить BVH. occ: { boxes: [[x0,x1,y0,y1,z0,z1]…], tris: [[[x,y,z]×3]…], triAlpha?: [a…], boxAlpha?: [a…] }.
 * Возвращает { occluded(ox,oy,oz,dx,dy,dz,tmax,seed) → bool, closest(ox,oy,oz,dx,dy,dz,tmax) → t | Infinity, nodes, prims }.
 */
export function buildBVH({ boxes = [], tris = [], triAlpha = [], boxAlpha = [] } = {}) {
  const nt = tris.length, nb = boxes.length, n = nt + nb;
  // примитивы: треугольник — v0 и рёбра; коробка — min/max
  const T = new Float32Array(nt * 9), A = new Float32Array(n).fill(1);
  const B = new Float32Array(n * 6), Cx = new Float32Array(n), Cy = new Float32Array(n), Cz = new Float32Array(n);
  for (let i = 0; i < nt; i++) {
    const t = tris[i], a = t[0], b = t[1], c = t[2];
    T.set([a[0], a[1], a[2], b[0] - a[0], b[1] - a[1], b[2] - a[2], c[0] - a[0], c[1] - a[1], c[2] - a[2]], i * 9);
    const x0 = Math.min(a[0], b[0], c[0]), x1 = Math.max(a[0], b[0], c[0]), y0 = Math.min(a[1], b[1], c[1]), y1 = Math.max(a[1], b[1], c[1]), z0 = Math.min(a[2], b[2], c[2]), z1 = Math.max(a[2], b[2], c[2]);
    B.set([x0, y0, z0, x1, y1, z1], i * 6);
    Cx[i] = (x0 + x1) / 2; Cy[i] = (y0 + y1) / 2; Cz[i] = (z0 + z1) / 2;
    if (triAlpha[i] != null) A[i] = triAlpha[i];
  }
  for (let j = 0; j < nb; j++) {
    const b = boxes[j], i = nt + j;
    const x0 = Math.min(b[0], b[1]), x1 = Math.max(b[0], b[1]), y0 = Math.min(b[2], b[3]), y1 = Math.max(b[2], b[3]), z0 = Math.min(b[4], b[5]), z1 = Math.max(b[4], b[5]);
    B.set([x0, y0, z0, x1, y1, z1], i * 6);
    Cx[i] = (x0 + x1) / 2; Cy[i] = (y0 + y1) / 2; Cz[i] = (z0 + z1) / 2;
    if (boxAlpha[j] != null) A[i] = boxAlpha[j];
  }
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  // узлы: границы (6) + [левый или начало, правый или −число] (лист: second < 0 → count = −second)
  const maxNodes = Math.max(1, 2 * n);
  const NB = new Float32Array(maxNodes * 6), NC = new Int32Array(maxNodes * 2);
  let nodes = 0;
  const C = [Cx, Cy, Cz], LEAF = 4, BINS = 12;
  const bounds = (s, e, o) => {
    let a = Infinity, b = Infinity, c = Infinity, d = -Infinity, f = -Infinity, g = -Infinity;
    for (let k = s; k < e; k++) { const p = idx[k] * 6; if (B[p] < a) a = B[p]; if (B[p + 1] < b) b = B[p + 1]; if (B[p + 2] < c) c = B[p + 2]; if (B[p + 3] > d) d = B[p + 3]; if (B[p + 4] > f) f = B[p + 4]; if (B[p + 5] > g) g = B[p + 5]; }
    NB[o] = a; NB[o + 1] = b; NB[o + 2] = c; NB[o + 3] = d; NB[o + 4] = f; NB[o + 5] = g;
  };
  const area = (x0, y0, z0, x1, y1, z1) => { const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0; return dx * dy + dy * dz + dz * dx; };
  const stack = [[0, n, nodes++]];
  if (n) {
    const binB = new Float64Array(BINS * 6), binN = new Int32Array(BINS);
    while (stack.length) {
      const [s, e, id] = stack.pop();
      bounds(s, e, id * 6);
      const cnt = e - s;
      if (cnt <= LEAF) { NC[id * 2] = s; NC[id * 2 + 1] = -cnt; continue; }
      // ось и разброс центров
      let ax = 0, lo = 0, hi = 0, best = -1;
      for (let a = 0; a < 3; a++) {
        let l = Infinity, h = -Infinity;
        for (let k = s; k < e; k++) { const v = C[a][idx[k]]; if (v < l) l = v; if (v > h) h = v; }
        if (h - l > best) { best = h - l; ax = a; lo = l; hi = h; }
      }
      let mid = (s + e) >> 1;
      if (best > 1e-9) {
        // SAH по корзинам
        binN.fill(0);
        for (let b = 0; b < BINS; b++) { binB[b * 6] = binB[b * 6 + 1] = binB[b * 6 + 2] = Infinity; binB[b * 6 + 3] = binB[b * 6 + 4] = binB[b * 6 + 5] = -Infinity; }
        const sc = BINS / (hi - lo) * 0.99999;
        for (let k = s; k < e; k++) {
          const p = idx[k], b = Math.min(BINS - 1, Math.floor((C[ax][p] - lo) * sc)), q = p * 6, o = b * 6;
          binN[b]++;
          for (let j = 0; j < 3; j++) { if (B[q + j] < binB[o + j]) binB[o + j] = B[q + j]; if (B[q + 3 + j] > binB[o + 3 + j]) binB[o + 3 + j] = B[q + 3 + j]; }
        }
        let bestCost = Infinity, bestSplit = -1;
        for (let sp = 1; sp < BINS; sp++) {
          let nl = 0, nr = 0;
          const L = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], R = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
          for (let b = 0; b < BINS; b++) {
            if (!binN[b]) continue;
            const T2 = b < sp ? L : R; if (b < sp) nl += binN[b]; else nr += binN[b];
            for (let j = 0; j < 3; j++) { if (binB[b * 6 + j] < T2[j]) T2[j] = binB[b * 6 + j]; if (binB[b * 6 + 3 + j] > T2[3 + j]) T2[3 + j] = binB[b * 6 + 3 + j]; }
          }
          if (!nl || !nr) continue;
          const cost = nl * area(...L) + nr * area(...R);
          if (cost < bestCost) { bestCost = cost; bestSplit = sp; }
        }
        if (bestSplit > 0) {
          const cut = lo + (bestSplit / sc);
          let i = s, j = e - 1;
          while (i <= j) { if (C[ax][idx[i]] < cut) i++; else { const t = idx[i]; idx[i] = idx[j]; idx[j] = t; j--; } }
          mid = i;
        }
        if (mid <= s || mid >= e) { // медиана
          const sub = Array.from(idx.subarray(s, e)).sort((p, q) => C[ax][p] - C[ax][q]);
          idx.set(sub, s); mid = (s + e) >> 1;
        }
      }
      const l = nodes++, r = nodes++;
      NC[id * 2] = l; NC[id * 2 + 1] = r;
      stack.push([s, mid, l], [mid, e, r]);
    }
  }
  const st = new Int32Array(512);
  const hitPrim = (p, ox, oy, oz, dx, dy, dz, tmax) => {
    if (p < nt) {
      const o = p * 9, e1x = T[o + 3], e1y = T[o + 4], e1z = T[o + 5], e2x = T[o + 6], e2y = T[o + 7], e2z = T[o + 8];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = px * e1x + py * e1y + pz * e1z;
      if (det > -1e-9 && det < 1e-9) return Infinity;
      const id = 1 / det, sx = ox - T[o], sy = oy - T[o + 1], sz = oz - T[o + 2];
      const u = (sx * px + sy * py + sz * pz) * id;
      if (u < 0 || u > 1) return Infinity;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * id;
      if (v < 0 || u + v > 1) return Infinity;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * id;
      return tt > 1e-3 && tt < tmax ? tt : Infinity;
    }
    const q = p * 6;
    const ix = 1 / (Math.abs(dx) < 1e-9 ? 1e-9 : dx), iy = 1 / (Math.abs(dy) < 1e-9 ? 1e-9 : dy), iz = 1 / (Math.abs(dz) < 1e-9 ? 1e-9 : dz);
    let t1 = (B[q] - ox) * ix, t2 = (B[q + 3] - ox) * ix, tn = Math.min(t1, t2), tf = Math.max(t1, t2);
    t1 = (B[q + 1] - oy) * iy; t2 = (B[q + 4] - oy) * iy; tn = Math.max(tn, Math.min(t1, t2)); tf = Math.min(tf, Math.max(t1, t2));
    t1 = (B[q + 2] - oz) * iz; t2 = (B[q + 5] - oz) * iz; tn = Math.max(tn, Math.min(t1, t2)); tf = Math.min(tf, Math.max(t1, t2));
    if (tf >= Math.max(tn, 1e-3) && tn < tmax) return Math.max(tn, 1e-3);
    return Infinity;
  };
  /** Хеш (луч, примитив) → [0, 1): для частичной тени alpha. */
  const hash = (seed, p) => { let h = (seed ^ Math.imul(p + 1, 0x9e3779b1)) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const trav = (ox, oy, oz, dx, dy, dz, tmax, any, seed) => {
    if (!n) return Infinity;
    const ix = 1 / (Math.abs(dx) < 1e-9 ? 1e-9 : dx), iy = 1 / (Math.abs(dy) < 1e-9 ? 1e-9 : dy), iz = 1 / (Math.abs(dz) < 1e-9 ? 1e-9 : dz);
    let sp = 0, best = tmax;
    st[sp++] = 0;
    while (sp) {
      const id = st[--sp], o = id * 6;
      let t1 = (NB[o] - ox) * ix, t2 = (NB[o + 3] - ox) * ix, tn = t1 < t2 ? t1 : t2, tf = t1 < t2 ? t2 : t1;
      t1 = (NB[o + 1] - oy) * iy; t2 = (NB[o + 4] - oy) * iy; tn = Math.max(tn, t1 < t2 ? t1 : t2); tf = Math.min(tf, t1 < t2 ? t2 : t1);
      t1 = (NB[o + 2] - oz) * iz; t2 = (NB[o + 5] - oz) * iz; tn = Math.max(tn, t1 < t2 ? t1 : t2); tf = Math.min(tf, t1 < t2 ? t2 : t1);
      if (tf < tn || tf < 0 || tn > best) continue;
      const a = NC[id * 2], b = NC[id * 2 + 1];
      if (b < 0) {
        for (let k = a; k < a - b; k++) {
          const p = idx[k], t = hitPrim(p, ox, oy, oz, dx, dy, dz, best);
          if (t < best) {
            if (A[p] < 1 && hash(seed, p) >= A[p]) continue;
            if (any) return t;
            best = t;
          }
        }
      } else if (sp < 510) { st[sp++] = a; st[sp++] = b; }
    }
    return best < tmax ? best : Infinity;
  };
  return {
    nodes, prims: n,
    occluded: (ox, oy, oz, dx, dy, dz, tmax = 1e9, seed = 0) => trav(ox, oy, oz, dx, dy, dz, tmax, true, seed) < Infinity,
    closest: (ox, oy, oz, dx, dy, dz, tmax = 1e9, seed = 0) => trav(ox, oy, oz, dx, dy, dz, tmax, false, seed),
  };
}

/** Тот же тест полным перебором (для проверки BVH). */
export function bruteOccluded({ boxes = [], tris = [] }, ox, oy, oz, dx, dy, dz, tmax = 1e9) {
  for (const t of tris) {
    const [a, b, c] = t, e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const p = [dy * e2[2] - dz * e2[1], dz * e2[0] - dx * e2[2], dx * e2[1] - dy * e2[0]], det = p[0] * e1[0] + p[1] * e1[1] + p[2] * e1[2];
    if (Math.abs(det) < 1e-9) continue;
    const id = 1 / det, s = [ox - a[0], oy - a[1], oz - a[2]], u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * id;
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]], v = (dx * q[0] + dy * q[1] + dz * q[2]) * id;
    if (v < 0 || u + v > 1) continue;
    const tt = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * id;
    if (tt > 1e-3 && tt < tmax) return true;
  }
  for (const b of boxes) {
    const lo = [Math.min(b[0], b[1]), Math.min(b[2], b[3]), Math.min(b[4], b[5])], hi = [Math.max(b[0], b[1]), Math.max(b[2], b[3]), Math.max(b[4], b[5])], o = [ox, oy, oz], d = [dx, dy, dz];
    let tn = -Infinity, tf = Infinity;
    for (let k = 0; k < 3; k++) { const inv = 1 / (Math.abs(d[k]) < 1e-9 ? 1e-9 : d[k]); const t1 = (lo[k] - o[k]) * inv, t2 = (hi[k] - o[k]) * inv; tn = Math.max(tn, Math.min(t1, t2)); tf = Math.min(tf, Math.max(t1, t2)); }
    if (tf >= Math.max(tn, 1e-3) && tn < tmax) return true;
  }
  return false;
}
