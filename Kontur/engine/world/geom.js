// Kontur world3d — Векторы 3D, нормаль многоугольника, триангуляция с дырами.

export const sub = (a, b) => (a.length === 3 ? [a[0] - b[0], a[1] - b[1], a[2] - b[2]] : a.map((v, i) => v - b[i]));
export const add = (a, b) => (a.length === 3 ? [a[0] + b[0], a[1] + b[1], a[2] + b[2]] : a.map((v, i) => v + b[i]));
export const mul = (a, k) => (a.length === 3 ? [a[0] * k, a[1] * k, a[2] * k] : a.map((v) => v * k));
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => mul(a, 1 / ((a.length === 3 ? Math.hypot(a[0], a[1], a[2]) : Math.hypot(...a)) || 1));
export const avg = (ps) => { let x = 0, y = 0, z = 0; for (const p of ps) { x += p[0]; y += p[1]; z += p[2]; } const k = 1 / ps.length; return [x * k, y * k, z * k]; };
/** Расстояние и длина без промежуточных массивов. */
export const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const len3 = (a) => Math.hypot(a[0], a[1], a[2]);

/** Нормаль многоугольника по Ньюэллу (устойчива к вогнутым и вырожденным первым вершинам). */
export function polyNormal(ps) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i], b = ps[(i + 1) % ps.length];
    x += (a[1] - b[1]) * (a[2] + b[2]); y += (a[2] - b[2]) * (a[0] + b[0]); z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(x, y, z);
  return l > 1e-12 ? [x / l, y / l, z / l] : norm(cross(sub(ps[1], ps[0]), sub(ps[2], ps[0])));
}
/**
 * Триангуляция плоского многоугольника (3D) с дырами: дыры врезаются мостами во внешний контур,
 * затем отсечение ушей. Возвращает [[p, p, p], …].
 */
export function triangulate(ps, holes = []) {
  if (ps.length < 3) return [];
  const n = polyNormal(ps);
  let u = cross(n, [0, 1, 0]);
  if (len3(u) < 1e-4) u = [1, 0, 0]; else u = norm(u);
  const v = cross(n, u);
  const to2 = (p) => [dot(p, u), dot(p, v)];
  const area = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i].q, q = r[(i + 1) % r.length].q; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  let ring = ps.map((p) => ({ p, q: to2(p) }));
  if (area(ring) < 0) ring.reverse();
  // дыры — по убыванию правой точки, обход по часовой; мост к ближайшей видимой вершине контура
  const hs = (holes || []).filter((h) => h && h.length >= 3).map((h) => { let r = h.map((p) => ({ p, q: to2(p) })); if (area(r) > 0) r = r.reverse(); return r; });
  hs.sort((a, b) => Math.max(...b.map((x) => x.q[0])) - Math.max(...a.map((x) => x.q[0])));
  const segX = (a, b, c, d) => {
    const d1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]), d2 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
    const d3 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]), d4 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
    return d1 * d2 < -1e-12 && d3 * d4 < -1e-12;
  };
  for (const h of hs) {
    let mi = 0;
    h.forEach((x, i) => { if (x.q[0] > h[mi].q[0]) mi = i; });
    const M = h[mi].q;
    let best = -1, bd = Infinity;
    ring.forEach((x, i) => {
      const d = (x.q[0] - M[0]) ** 2 + (x.q[1] - M[1]) ** 2;
      if (d >= bd) return;
      for (let j = 0; j < ring.length; j++) if (segX(M, x.q, ring[j].q, ring[(j + 1) % ring.length].q)) return;
      for (const h2 of hs) for (let j = 0; j < h2.length; j++) if (segX(M, x.q, h2[j].q, h2[(j + 1) % h2.length].q)) return;
      bd = d; best = i;
    });
    if (best < 0) continue;
    const hh = [...h.slice(mi), ...h.slice(0, mi + 1)];
    ring = [...ring.slice(0, best + 1), ...hh, ...ring.slice(best)];
  }
  const tris = [];
  const cr = (a, b, c) => (b.q[0] - a.q[0]) * (c.q[1] - a.q[1]) - (b.q[1] - a.q[1]) * (c.q[0] - a.q[0]);
  const inside = (p, a, b, c) => cr(a, b, p) >= -1e-12 && cr(b, c, p) >= -1e-12 && cr(c, a, p) >= -1e-12;
  let r = ring.slice(), guard = 0;
  while (r.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let i = 0; i < r.length; i++) {
      const a = r[(i + r.length - 1) % r.length], b = r[i], c = r[(i + 1) % r.length];
      if (cr(a, b, c) <= 1e-12) continue;
      let ok = true;
      for (const p of r) if (p !== a && p !== b && p !== c && (p.q[0] !== a.q[0] || p.q[1] !== a.q[1]) && (p.q[0] !== c.q[0] || p.q[1] !== c.q[1]) && inside(p, a, b, c)) { ok = false; break; }
      if (!ok) continue;
      tris.push([a.p, b.p, c.p]); r.splice(i, 1); cut = true; break;
    }
    if (!cut) { // вырожденный остаток — веером
      for (let i = 1; i + 1 < r.length; i++) tris.push([r[0].p, r[i].p, r[i + 1].p]);
      return tris;
    }
  }
  if (r.length === 3) tris.push([r[0].p, r[1].p, r[2].p]);
  return tris;
}
/* ============================== ТЕЛА ВРАЩЕНИЯ, СФЕРЫ, АРКИ, МАРКИЗЫ ============================== */
export const TAU = Math.PI * 2;
export const ang2 = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])));
export const nrm2 = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
export const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
