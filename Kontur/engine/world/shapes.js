// Kontur world3d — Построители форм: грань, коробка, тела вращения, сфера, арка, маркиза, диск, лестница.
import { C, col, dark, lite, jit } from './color.js';
import { rnd, hashSeed, withSeed } from './rng.js';
import { sub, add, mul, dot, cross, norm, avg, dist3, len3, polyNormal, triangulate, TAU, ang2, nrm2 } from './geom.js';
import { MAT } from './materials.js';

/* ============================== ПОСТРОИТЕЛИ ============================== */
/** Грань многоугольником ps (3D) с материалом. Возвращает примитивы. */
export function face(S, ps, alb, o = {}) {
  let n = polyNormal(ps);
  const fc = avg(ps);
  if (o.center && dot(n, sub(fc, o.center)) < 0) n = mul(n, -1);
  if (!o.center && dot(n, sub(S.cam, fc)) < 0) n = mul(n, -1);
  // автоокклюдер: грань отбрасывает тень, даже если камера видит её изнанку
  if (S.autoOcc && o.occ !== false) S.pend.push(...triangulate(ps, o.holes));
  const fs = o.seedKey != null ? (S.v >= 2 ? hashSeed(S.seed, o.seedKey) : 0) : S.faceSeed();
  const seeded = (k, fn) => (fs ? withSeed(hashSeed(fs, k), fn) : fn());
  if (!S.faces(n, fc)) {
    // v2: декор невидимой грани (окна) строится ради побочных результатов — света окон на улицу
    if (fs && o.decor) seeded('d', () => o.decor(n));
    return [];
  }
  const out = [S.base(ps, alb, n, [...n, dot(n, ps[0])], o)];
  const det = [];
  if (o.frame && o.mat) det.push(...seeded('m', () => MAT[o.mat](S, o.frame(n), o.matCol || alb, o.matOpt || {})));
  if (o.decor) det.push(...seeded('d', () => o.decor(n)));
  if (o.clip || ps.length !== 4 || o.holes?.length) { const cl = o.holes?.length ? { ps, holes: o.holes } : ps; for (const d of det) d.clip = cl; }
  return out.concat(det);
}
/** Рамка грани по её многоугольнику: u — горизонталь грани, v — «вверх» (для пола — вглубь). */
export function frameOf(S, ps, n) {
  n = n || norm(cross(sub(ps[1], ps[0]), sub(ps[2], ps[0])));
  let u = cross(n, [0, 1, 0]);
  let v;
  if (len3(u) < 1e-4) { u = [1, 0, 0]; v = n[1] > 0 ? [0, 0, 1] : [0, 0, -1]; } else { u = norm(u); v = norm(cross(u, n)); }
  const as = ps.map((p) => dot(p, u)), bs = ps.map((p) => dot(p, v));
  const a0 = Math.min(...as), b0 = Math.min(...bs);
  const o = add(mul(u, a0), add(mul(v, b0), mul(n, dot(ps[0], n) - dot(add(mul(u, a0), mul(v, b0)), n))));
  return S.frame(o, u, v, Math.max(...as) - a0, Math.max(...bs) - b0, n);
}
/** Коробка с материалами граней. mats: {front, back, left, right, top, side, all} — [материал, цвет, параметры]. */
export function box(S, x0, x1, y0, y1, z0, z1, c, o = {}) {
  const cen = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const m = o.mats || {};
  const F = [
    { ps: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], tag: 'front', fr: (n) => S.frame([x0, y0, z0], [1, 0, 0], [0, 1, 0], x1 - x0, y1 - y0, n) },
    { ps: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], tag: 'back', fr: (n) => S.frame([x1, y0, z1], [-1, 0, 0], [0, 1, 0], x1 - x0, y1 - y0, n) },
    { ps: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], tag: 'left', fr: (n) => S.frame([x0, y0, z1], [0, 0, -1], [0, 1, 0], z1 - z0, y1 - y0, n) },
    { ps: [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], tag: 'right', fr: (n) => S.frame([x1, y0, z0], [0, 0, 1], [0, 1, 0], z1 - z0, y1 - y0, n) },
    { ps: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], tag: 'top', fr: (n) => S.frame([x0, y1, z0], [1, 0, 0], [0, 0, 1], x1 - x0, z1 - z0, n) },
    { ps: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], tag: 'bottom', fr: (n) => S.frame([x0, y0, z1], [1, 0, 0], [0, 0, -1], x1 - x0, z1 - z0, n), occ: false },
  ];
  const prims = [];
  for (const fc of F) {
    // дно: только явный mats.bottom; невидимое дно не тратит подсид грани (мир v2 не сдвигается)
    if (fc.tag === 'bottom' && !(S.faces([0, -1, 0], [cen[0], y0, cen[2]]) || m.bottom)) continue;
    const mm = fc.tag === 'bottom' ? m.bottom : m[fc.tag] || (fc.tag === 'top' ? m.top : ['left', 'right', 'back'].includes(fc.tag) ? m.side : null) || m.all;
    const cc = fc.tag === 'top' ? (o.top || c) : ['left', 'right'].includes(fc.tag) ? (o.sides || c) : c;
    prims.push(...face(S, fc.ps, cc, { center: cen, mat: mm?.[0], matCol: mm?.[1], matOpt: mm?.[2], frame: fc.fr, spec: o.spec, em: o.em, occ: fc.occ, seedKey: fc.tag === 'bottom' ? 'b' + S.faceN : undefined, decor: o.decor?.[fc.tag] ? (n) => o.decor[fc.tag](fc.fr(n)) : null }));
  }
  const it = S.item(o.key ?? z0, prims, { name: o.name || 'box' });
  if (o.occ !== false) S.box3([x0, x1, y0, y1, z0, z1], it);
  return prims;
}
/**
 * Цилиндр: тело вращения с гладкой нормалью (normalGrad поперёк, плоскости — гранями только для позиции).
 * o: n (граней на оборот, 16), top (цвет крышки), bands (шаг полос, м), spec, key, occ, name, cap.
 */
export function cyl(S, X, Z, r, y0, y1, c, o = {}) {
  const bandsLines = [];
  if (o.bands) for (let y = y0 + o.bands; y < y1 - 0.02; y += o.bands) bandsLines.push(y);
  return lathe(S, X, Z, [[r, y0, 'c'], [r, y1, 'c']], c, { ...o, y0: 0, n: o.n && o.n >= 8 ? Math.min(o.n, 24) : 16, top: o.top, rings: bandsLines.length ? { ys: bandsLines, color: dark(c, 0.3) } : null, name: o.name || 'cyl' });
}

/** Сглаживание профиля Катмулл — Ромом; точки с флагом 'c' ([r, y, 'c']) — изломы, через них не сглаживается. */
export function smoothProfile(pts, sub = 3) {
  if (pts.length < 3 || sub <= 1) return pts.map((p) => [...p]);
  const out = [];
  let run = [pts[0]];
  const flush = () => {
    if (run.length < 3) { for (let i = 0; i < run.length - 1; i++) out.push([...run[i]]); return; }
    for (let i = 0; i < run.length - 1; i++) {
      const p0 = run[Math.max(0, i - 1)], p1 = run[i], p2 = run[i + 1], p3 = run[Math.min(run.length - 1, i + 2)];
      for (let k = 0; k < sub; k++) {
        const t = k / sub, t2 = t * t, t3 = t2 * t;
        const q = [0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3));
        out.push(k === 0 ? [...p1] : [Math.max(0, q[0]), q[1]]);
      }
    }
  };
  for (let i = 1; i < pts.length; i++) {
    run.push(pts[i]);
    if (pts[i][2] === 'c' && i < pts.length - 1) { flush(); run = [pts[i]]; }
  }
  flush();
  out.push([...pts[pts.length - 1]]);
  return out;
}
/** Полуугол видимой части окружности радиуса r с расстояния D (край силуэта тела вращения). */
const horizonA = (D, r) => (D > r ? Math.acos(Math.min(1, r / D)) : Math.PI / 2);
/** Готовые профили тел вращения [[r, y], …] (y от 0 вверх). */
export const PROFILES = {
  pot: (h = 0.5, r = 0.25) => [[r * 0.62, 0, 'c'], [r * 0.7, h * 0.08], [r * 0.95, h * 0.78], [r, h * 0.84, 'c'], [r * 1.12, h * 0.86], [r * 1.12, h, 'c'], [r * 0.9, h, 'c'], [r * 0.86, h * 0.9]],
  vase: (h = 0.8, r = 0.25) => [[r * 0.5, 0, 'c'], [r * 0.55, h * 0.05], [r * 0.95, h * 0.3], [r, h * 0.45], [r * 0.7, h * 0.72], [r * 0.45, h * 0.85], [r * 0.58, h, 'c'], [r * 0.42, h, 'c']],
  barrel: (h = 1, r = 0.4) => [[r * 0.84, 0, 'c'], [r * 0.93, h * 0.2], [r, h * 0.5], [r * 0.93, h * 0.8], [r * 0.84, h, 'c'], [0, h, 'c']],
  baluster: (h = 0.8, r = 0.06) => [[r * 1.3, 0, 'c'], [r * 1.3, h * 0.08, 'c'], [r * 0.7, h * 0.12], [r * 1.25, h * 0.35], [r * 1.3, h * 0.45], [r * 0.6, h * 0.75], [r * 0.7, h * 0.86], [r * 1.3, h * 0.9, 'c'], [r * 1.3, h, 'c'], [0, h, 'c']],
  column: (h = 3, r = 0.22) => [[r * 1.35, 0, 'c'], [r * 1.35, 0.12, 'c'], [r * 1.15, 0.2], [r * 1.05, 0.28, 'c'], [r, h * 0.5], [r * 0.9, h - 0.3, 'c'], [r * 1.1, h - 0.18], [r * 1.35, h - 0.12, 'c'], [r * 1.35, h, 'c'], [0, h, 'c']],
  shade: (h = 0.3, r = 0.3) => [[r * 0.15, h, 'c'], [r * 0.3, h * 0.92], [r * 0.7, h * 0.5], [r, 0, 'c'], [r * 0.96, 0, 'c']],
  fountainBasin: (h = 0.6, r = 2) => [[r, 0, 'c'], [r * 1.02, h * 0.6], [r * 1.06, h * 0.82, 'c'], [r * 1.06, h, 'c'], [r * 0.93, h, 'c'], [r * 0.93, h * 0.3, 'c']],
};
/** Добавить профиль тела вращения: fn(h, r) → [[r, y, 'c'?], …] (снизу вверх). */
export function registerProfile(name, fn) {
  if (typeof fn !== 'function') throw new Error(`registerProfile(${name}): нужна функция (h, r) → профиль`);
  PROFILES[name] = fn;
  return fn;
}
/**
 * Тело вращения вокруг вертикали (X, Z) по профилю [[r, y], …] (снизу вверх; [r, y, 'c'] — излом).
 * Нормаль гладкая по обороту (normalGrad) и по профилю (поднормали по отрезку), плоскости — гранями
 * (surface.geo, только для восстановления позиции). Внутренние стенки (профиль внутрь) тоже видны — чаши, кашпо.
 * o: y0, n (граней на оборот, 16), smooth (сглаживание профиля, точек на отрезок), crease (угол излома, °),
 *    spec, em, top (цвет крышки при r > 0 сверху; false — без крышки), fill {y, r, color, spec, em} — гладь
 *    (вода, земля) внутри чаши, rings {ys, color} — полосы, ink (контур силуэта, true), occ, key, name, pmat.
 */
export function lathe(S, X, Z, prof, c, o = {}) {
  const y0 = o.y0 ?? 0;
  let P0 = prof.map(([r, y, fl]) => [Math.max(0, r), y + y0, fl]);
  if (o.smooth) P0 = smoothProfile(P0, o.smooth === true ? 3 : o.smooth);
  const nS = P0.length - 1;
  if (nS < 1) return [];
  // нормали отрезков профиля (r наружу, y вверх) и вершин (средние, кроме изломов)
  const sn = [];
  for (let i = 0; i < nS; i++) { const dr = P0[i + 1][0] - P0[i][0], dy = P0[i + 1][1] - P0[i][1], L = Math.hypot(dr, dy); sn.push(L < 1e-9 ? null : [dy / L, -dr / L]); }
  for (let i = 0; i < nS; i++) if (!sn[i]) sn[i] = sn[i - 1] || sn.find(Boolean) || [1, 0];
  const creaseA = ((o.crease ?? 50) * Math.PI) / 180;
  const vN = (i, side) => { // нормаль в вершине i для отрезка с этой стороны
    const own = side === 'start' ? sn[i] : sn[i - 1];
    const other = side === 'start' ? sn[i - 1] : sn[i];
    if (!other || P0[i][2] === 'c' || ang2(own, other) > creaseA) return own;
    return nrm2([own[0] + other[0], own[1] + other[1]]);
  };
  const nSeg = Math.max(8, o.n || 16);
  const cam = S.cam, Dx = cam[0] - X, Dz = cam[2] - Z, D = Math.hypot(Dx, Dz), th = Math.atan2(Dz, Dx);
  const q = (a, r, y) => [X + Math.cos(a) * r, y, Z + Math.sin(a) * r];
  const spec = o.spec ?? 0.15, sw = S.sw(Z);
  const runs = [];
  const arc = (a0, a1, r, y, steps) => { const out = []; for (let k = 0; k <= steps; k++) out.push(q(a0 + ((a1 - a0) * k) / steps, r, y)); return out; };
  for (let i = 0; i < nS; i++) {
    const [r0, ya] = P0[i], [r1, yb] = P0[i + 1];
    if (r0 < 1e-6 && r1 < 1e-6) continue;
    const na = vN(i, 'start'), nb = vN(i + 1, 'end');
    const rm = (r0 + r1) / 2, h = horizonA(D, rm);
    for (const [A, B] of [[th - h, th + h], [th + h, th - h + TAU]]) {
      const m = Math.max(1, Math.round((nSeg * (B - A)) / TAU));
      const fac = [];
      for (let k = 0; k < m; k++) {
        const a0 = A + ((B - A) * k) / m, a1 = A + ((B - A) * (k + 1)) / m, am = (a0 + a1) / 2;
        const ps = [q(a0, r0, ya), q(a1, r0, ya), q(a1, r1, yb), q(a0, r1, yb)].filter((p, j, arr) => j === 0 || dist3(p, arr[j - 1]) > 1e-9);
        if (ps.length < 3) { fac.push(null); continue; }
        let nn = polyNormal(ps);
        const ref = [sn[i][0] * Math.cos(am), sn[i][1], sn[i][0] * Math.sin(am)];
        if (dot(nn, ref) < 0) nn = mul(nn, -1);
        const cen = avg(ps);
        fac.push(S.faces(nn, cen) ? { ps, nn, cen } : null);
      }
      // непрерывные видимые серии граней → узел «вид» (градиент нормали) + узлы-плоскости
      for (let k = 0; k < m; ) {
        if (!fac[k]) { k++; continue; }
        let e = k; while (e + 1 < m && fac[e + 1]) e++;
        const as = A + ((B - A) * k) / m, ae = A + ((B - A) * (e + 1)) / m, amid = (as + ae) / 2;
        const steps = Math.max(2, Math.ceil(((ae - as) / TAU) * 48));
        const prims = [];
        const nsub = Math.max(1, Math.min(6, Math.ceil(ang2(na, nb) / (6 * Math.PI / 180))));
        for (let j = 0; j < nsub; j++) {
          const t0 = j / nsub, t1 = (j + 1) / nsub, tm = (t0 + t1) / 2;
          const rA = r0 + (r1 - r0) * t0, yA = ya + (yb - ya) * t0, rB = r0 + (r1 - r0) * t1, yB = ya + (yb - ya) * t1;
          const rM = r0 + (r1 - r0) * tm, yM = ya + (yb - ya) * tm;
          const nm = nrm2([na[0] + (nb[0] - na[0]) * tm, na[1] + (nb[1] - na[1]) * tm]);
          const ring = [...arc(as, ae, rA, yA, steps), ...arc(ae, as, rB, yB, steps)].filter((p, jj, arr) => jj === 0 || dist3(p, arr[jj - 1]) > 1e-9);
          if (ring.length < 3) continue;
          const nmid = [nm[0] * Math.cos(amid), nm[1], nm[0] * Math.sin(amid)];
          const pmid = q(amid, rM, yM);
          prims.push({ t: 'poly', ps: ring, alb: c, n: nmid, pl: [...nmid, dot(nmid, pmid)], base: true, ink: false, spec, em: o.em, op: 1, ng: ringGrad(S, q, as, ae, rM, yM, nm) });
        }
        if (o.geo !== false) for (let kk = k; kk <= e; kk++) { const f = fac[kk]; prims.push({ t: 'poly', ps: f.ps, alb: c, n: f.nn, pl: [...f.nn, dot(f.nn, f.ps[0])], base: true, geo: true, ink: false, spec, op: 1 }); }
        if (o.rings) for (const yy of o.rings.ys) if (yy > Math.min(ya, yb) && yy <= Math.max(ya, yb)) {
          const tt = (yy - ya) / (yb - ya || 1), rr = r0 + (r1 - r0) * tt, pts = arc(as, ae, rr * 1.002, yy, steps);
          for (let jj = 0; jj + 1 < pts.length; jj++) prims.push(S.line(pts[jj], pts[jj + 1], o.rings.color || dark(c, 0.3), sw * 0.6));
        }
        runs.push({ d: dist3(cam, q(amid, rm, (ya + yb) / 2)), prims });
        k = e + 1;
      }
    }
  }
  // гладь внутри чаши и крышка сверху
  const disk = (y, r, col, sp, em, nm = 'cap') => {
    if (y >= S.camH || r <= 0) return;
    const ps = arc(0, TAU * (1 - 1 / 48), r, y, 47);
    runs.push({ d: dist3(cam, [X, y, Z]) + (nm === 'fill' ? 0 : -1e-3), prims: [{ t: 'poly', ps, alb: col, n: [0, 1, 0], pl: [0, 1, 0, y], base: true, ink: nm === 'cap', spec: sp, em, op: 1, sw }] });
  };
  if (o.fill) disk(o.fill.y + y0, o.fill.r, o.fill.color || C.water, o.fill.spec ?? 0.8, o.fill.em, 'fill');
  const last = P0[nS];
  if (o.top !== false && last[0] > 1e-6) disk(last[1], last[0], o.top || lite(c, 0.12), o.topSpec ?? spec, o.em);
  const collect = Array.isArray(o.runs);
  const anyVis = runs.length > 0;
  if (collect) { o.runs.push(...runs); runs.length = 0; }
  runs.sort((a, b) => b.d - a.d);
  const prims = runs.flatMap((r) => r.prims);
  const inkStart = prims.length;
  // контур силуэта: левый и правый края профиля, нижняя кромка спереди
  if (o.ink !== false && anyVis) {
    for (const s of [-1, 1]) {
      for (let i = 0; i < nS; i++) {
        if (sn[i][0] < 0.05) continue;
        const pa = P0[i], pb = P0[i + 1];
        const ha = horizonA(D, pa[0]), hb = horizonA(D, pb[0]);
        prims.push(S.line(q(th + s * ha, pa[0], pa[1]), q(th + s * hb, pb[0], pb[1]), C.line, sw, { ink: true }));
      }
    }
    const b0 = P0[0];
    if (b0[0] > 1e-6) { const h0 = horizonA(D, b0[0]); const pts = arc(th - h0, th + h0, b0[0], b0[1], 24); for (let j = 0; j + 1 < pts.length; j++) prims.push(S.line(pts[j], pts[j + 1], C.line, sw, { ink: true })); }
  }
  if (collect) for (const l of prims.splice(inkStart)) o.runs.push({ d: dist3(cam, mul(add(l.a, l.b), 0.5)) - 1e-3, prims: [l] });
  const maxR = Math.max(...P0.map((p) => p[0]));
  const it = S.item(o.key ?? Z - maxR, prims, { name: o.name || 'lathe', pmat: o.pmat, force: Array.isArray(o.runs) });
  if (o.occ !== false && it) {
    // окклюдер: исходный профиль, 12 граней на оборот, чуть внутри поверхности (без самозатенения граней-плоскостей)
    const pr = prof.map(([r, y]) => [Math.max(0, r) * 0.9, y + y0]), m = 12;
    for (let i = 0; i + 1 < pr.length; i++) for (let k = 0; k < m; k++) {
      const a0 = (k / m) * TAU, a1 = ((k + 1) / m) * TAU;
      const A0 = q(a0, pr[i][0], pr[i][1]), A1 = q(a1, pr[i][0], pr[i][1]), B0 = q(a0, pr[i + 1][0], pr[i + 1][1]), B1 = q(a1, pr[i + 1][0], pr[i + 1][1]);
      if (pr[i][0] > 1e-6) S.tri3([A0, A1, B1], it);
      if (pr[i + 1][0] > 1e-6) S.tri3([A0, B1, B0], it);
    }
  }
  return prims;
}
/**
 * Несколько тел вращения на одной оси (фонтан, лампа): серии граней всех частей сортируются вместе,
 * поэтому ножка верхней чаши выходит из воды нижней. parts: [{ prof, color, …опции lathe }].
 */
export function latheStack(S, X, Z, parts, o = {}) {
  const runs = [], start = S.items.length;
  for (const p of parts) lathe(S, X, Z, p.prof, col(p.color) || C.stone, { ...p, runs, ink: p.ink });
  const its = S.items.splice(start);
  runs.sort((a, b) => b.d - a.d);
  const inks = its.flatMap((it) => it.prims);
  const maxR = Math.max(...parts.flatMap((p) => p.prof.map((q) => q[0])));
  const it = S.item(o.key ?? Z - maxR, [...runs.flatMap((r) => r.prims), ...inks], { name: o.name || 'stack', pmat: o.pmat });
  for (const s of its) it.tris.push(...s.tris);
  return it;
}
/** Градиент нормали поперёк серии граней тела вращения: точки дуги [as, ae] на радиусе r, высоте y. */
function ringGrad(S, q, as, ae, r, y, nm) {
  const K = 16, P = [], N = [];
  for (let k = 0; k <= K; k++) { const a = as + ((ae - as) * k) / K; P.push(S.P(q(a, r, y))); N.push([nm[0] * Math.cos(a), nm[1], nm[0] * Math.sin(a)]); }
  const from = P[0], to = P[K], dx = to[0] - from[0], dy = to[1] - from[1], L2 = dx * dx + dy * dy;
  if (L2 < 0.25) return undefined;
  const stops = [];
  let prev = -1;
  for (let k = 0; k <= K; k++) {
    const t = ((P[k][0] - from[0]) * dx + (P[k][1] - from[1]) * dy) / L2;
    if (t <= prev + 1e-4) continue;
    stops.push([Math.max(0, Math.min(1, t)), N[k]]); prev = t;
  }
  return stops.length >= 2 ? { kind: 'linear', from, to, stops } : undefined;
}
/**
 * Сфера (или купол dome: верхняя половина) радиуса R с центром [X, Y, Z]: один узел-контур с точной нормалью
 * (normalGrad kind sphere), плоскость — к камере на 0.7R ближе центра. o: flat (сплющенность нормали 0..0.9 — комки
 * листвы), dome, spec, em, ink, occ (окклюдер — сфера 0.6R), key, name, wob (неровность края 0..0.3).
 */
export function sphere(S, X, Y, Z, R, c, o = {}) {
  const cen = [X, Y, Z], v = norm(sub(S.cam, cen)), dist = dist3(S.cam, cen);
  let e1 = cross([0, 1, 0], v); e1 = len3(e1) < 1e-6 ? [1, 0, 0] : norm(e1);
  let e2 = norm(cross(v, e1)); if (e2[1] < 0) e2 = mul(e2, -1);
  if (dot(cross(e1, e2), v) < 0) e1 = mul(e1, -1);
  const rs = R * Math.sqrt(Math.max(0, 1 - (R / dist) ** 2)), cs = add(cen, mul(v, (R * R) / dist));
  const N = 40, ps = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * TAU, w = o.wob ? 1 + (rnd() - 0.5) * 2 * o.wob : 1;
    if (o.dome && Math.sin(t) < -1e-9) continue;
    ps.push(add(cs, add(mul(e1, Math.cos(t) * rs * w), mul(e2, Math.sin(t) * rs * w))));
  }
  if (o.dome) { // основание купола: передняя половина экватора
    const th = Math.atan2(S.cam[2] - Z, S.cam[0] - X);
    for (let k = 1; k < 24; k++) { const a = th + Math.PI / 2 - (Math.PI * k) / 24; ps.push([X + Math.cos(a) * R, Y, Z + Math.sin(a) * R]); }
  }
  const sc = S.P(cs), sx = S.P(add(cs, mul(e1, rs))), sy = S.P(add(cs, mul(e2, rs)));
  const rx = Math.hypot(sx[0] - sc[0], sx[1] - sc[1]), ry = Math.hypot(sy[0] - sc[0], sy[1] - sc[1]);
  const pp = add(cen, mul(v, R * 0.7));
  const prim = { t: 'poly', ps, alb: c, n: v, pl: [...v, dot(v, pp)], base: true, ink: o.ink ?? true, spec: o.spec ?? 0.15, em: o.em, op: 1, sw: S.sw(Z) * 0.8, ng: rx > 0.5 ? { kind: 'sphere', c: sc, r: [rx, ry], flat: o.flat ?? 0 } : undefined };
  if (o.prims) return [prim];
  const it = S.item(o.key ?? Z - R, [prim], { name: o.name || (o.dome ? 'dome' : 'sphere') });
  if (o.occ !== false) sphereTris(cen, R * 0.6, o.dome).forEach((t) => S.tri3(t, it));
  return [prim];
}
/** Треугольники сферы (UV 6×10) для окклюдера. */
export function sphereTris(c, r, dome = false) {
  const out = [], la = 6, lo = 10;
  const pt = (i, j) => { const ph = (dome ? 0.5 : 0) * Math.PI + (i / la) * Math.PI * (dome ? 0.5 : 1) - Math.PI / 2, th = (j / lo) * TAU; return [c[0] + Math.cos(ph) * Math.cos(th) * r, c[1] + Math.sin(ph) * r, c[2] + Math.cos(ph) * Math.sin(th) * r]; };
  for (let i = 0; i < la; i++) for (let j = 0; j < lo; j++) { out.push([pt(i, j), pt(i, j + 1), pt(i + 1, j + 1)]); out.push([pt(i, j), pt(i + 1, j + 1), pt(i + 1, j)]); }
  return out;
}
/**
 * Арка-портал в стене z = Z: проём [x0, x1] от y0 до пяты spring, полуциркульный свод, толщина thick.
 * Лицевая грань — две половины с вырезом (материал mat), откосы и свод — гладкие (normalGrad), клинчатые камни.
 * o: margin (ширина обрамления, 0.45), top (верх блока), mat, matColor, voussoirs (true), keystone, color, back (цвет за проёмом или null).
 */
export function arch(S, x0, x1, Z, y0, spring, thick, c, o = {}) {
  const w = x1 - x0, R = w / 2, xc = (x0 + x1) / 2, ys = spring, mg = o.margin ?? 0.45;
  const top = o.top ?? ys + R + mg, X0 = x0 - mg, X1 = x1 + mg, Zb = Z + thick;
  const N = 16;
  const arcP = (z, a0 = 0, a1 = Math.PI, n = N) => { const out = []; for (let k = 0; k <= n; k++) { const a = a0 + ((a1 - a0) * k) / n; out.push([xc - Math.cos(a) * R, ys + Math.sin(a) * R, z]); } return out; };
  const prims = [];
  // за проёмом — тёмная глубина (если задана)
  if (o.back !== null) {
    const bp = [[x0, y0, Zb], [x1, y0, Zb], ...arcP(Zb).reverse()];
    prims.push(S.base(bp, o.back || dark(c, 0.55), [0, 0, -1], [0, 0, -1, -Zb], { ink: false, spec: 0.05 }));
  }
  // откосы
  for (const [xx, s] of [[x0, 1], [x1, -1]]) {
    const ps = [[xx, y0, Z], [xx, y0, Zb], [xx, ys, Zb], [xx, ys, Z]], n = [s, 0, 0];
    if (S.faces(n, avg(ps))) prims.push(S.base(ps, dark(c, 0.08), n, [...n, dot(n, ps[0])], { ink: false }));
  }
  // свод: полосы-плоскости (geo) + один узел с градиентом нормали к оси свода
  const vf = arcP(Z), vb = arcP(Zb);
  const vault = [...vf, ...vb.slice().reverse()];
  const pf = S.P([xc, ys, Z]), pl = S.P([x0, ys, Z]), pr = S.P([x1, ys, Z]), pt = S.P([xc, ys + R, Z]);
  const ng = [
    { kind: 'linear', from: pl, to: pr, ch: 'x', stops: [[0, [1, 0, 0]], [1, [-1, 0, 0]]] },
    { kind: 'linear', from: pt, to: pf, ch: 'y', stops: [[0, [0, -1, 0]], [1, [0, 0, 0]]] },
    { kind: 'linear', from: pl, to: pr, ch: 'z', stops: [[0, [0, 0, 0]], [1, [0, 0, 0]]] },
  ];
  prims.push({ t: 'poly', ps: vault, alb: dark(c, 0.12), n: [0, -1, 0], pl: [0, -1, 0, -(ys + R)], base: true, ink: false, spec: 0.1, op: 1, ng });
  for (let k = 0; k < N; k++) {
    const ps = [vf[k], vf[k + 1], vb[k + 1], vb[k]];
    const am = ((k + 0.5) / N) * Math.PI, n = [Math.cos(am), -Math.sin(am), 0];
    if (S.faces(n, avg(ps))) prims.push({ t: 'poly', ps, alb: c, n, pl: [...n, dot(n, ps[0])], base: true, geo: true, ink: false, spec: 0.1, op: 1 });
  }
  // лицевая грань: две половины с вырезом
  const frameFn = (n) => S.frame([X0, y0, Z], [1, 0, 0], [0, 1, 0], X1 - X0, top - y0, n);
  const half = (left) => {
    const a = arcP(Z, left ? 0 : Math.PI / 2, left ? Math.PI / 2 : Math.PI, N / 2);
    return left ? [[X0, y0, Z], [x0, y0, Z], ...a, [xc, top, Z], [X0, top, Z]] : [[xc, top, Z], ...a, [x1, y0, Z], [X1, y0, Z], [X1, top, Z]];
  };
  for (const left of [true, false]) prims.push(...face(S, half(left), c, { mat: o.mat, matCol: o.matColor || c, matOpt: o.matOpt, frame: o.mat ? frameFn : null, spec: 0.1, clip: true, occ: o.occ }));
  // клинчатые камни
  if (o.voussoirs !== false) {
    const fr = S.frame([X0, y0, Z - 0.004], [1, 0, 0], [0, 1, 0], X1 - X0, top - y0, [0, 0, -1]);
    const nv = o.stones || 9, rr = Math.min(0.32, mg * 0.75);
    for (let k = 0; k < nv; k++) {
      const a0 = (k / nv) * Math.PI + 0.012, a1 = ((k + 1) / nv) * Math.PI - 0.012, am = (a0 + a1) / 2;
      const key = o.keystone !== false && k === (nv - 1) / 2;
      const ro = R + rr * (key ? 1.35 : 1);
      const ps = [[a0, R], [a1, R], [a1, ro], [a0, ro]].map(([a, r]) => [xc - Math.cos(a) * r, ys + Math.sin(a) * r, Z - 0.004]);
      prims.push(S.det(fr, ps, jit(o.stoneColor || lite(c, 0.06), 0.08), { n: norm([-Math.cos(am) * 0.25, Math.sin(am) * 0.25, -1]), ink: true, sw: S.sw(Z) * 0.6, spec: 0.12 }));
    }
  }
  const it = S.item(o.key ?? Z - 0.01, prims, { name: o.name || 'arch', pmat: o.pmat });
  if (o.occ !== false && S.autoOcc) for (const [xx] of [[x0], [x1]]) S.tri3([[xx, y0, Z], [xx, y0, Zb], [xx, ys, Zb]], it);
  return prims;
}
/**
 * Маркиза: наклонное полотно от стены (верхняя кромка y1 на глубине z, вынос depth, опускание drop)
 * в полоску (colors, stripe — ширина полосы, м), фестоны спереди (scallop — их глубина), лёгкий изгиб полотна.
 */
export function awning(S, x0, x1, z, y1, depth, drop, o = {}) {
  const cols = (o.colors || [C.red, C.cream]).map(col), stripe = o.stripe ?? 0.3;
  const zf = z - depth, yf = y1 - drop, sc = o.scallop ?? 0.16, vh = o.valance ?? 0.22;
  const nTop = norm(cross(sub([x1, y1, z], [x0, y1, z]), sub([x0, yf, zf], [x0, y1, z])));
  const n = nTop[1] < 0 ? mul(nTop, -1) : nTop;
  const pl = [...n, dot(n, [x0, y1, z])];
  const prims = [];
  // изгиб полотна: нормаль от «круче» у стены к «положе» у кромки
  const pA = S.P([(x0 + x1) / 2, y1, z]), pB = S.P([(x0 + x1) / 2, yf, zf]);
  const nA = norm(add(n, [0, 0.35, 0])), nB = norm(add(n, [0, -0.25, -0.35]));
  const ng = { kind: 'linear', from: pA, to: pB, stops: [[0, nA], [0.5, n], [1, nB]] };
  const k = Math.max(1, Math.round((x1 - x0) / stripe));
  for (let i = 0; i < k; i++) {
    const a = x0 + ((x1 - x0) * i) / k, b = x0 + ((x1 - x0) * (i + 1)) / k;
    prims.push({ ...S.base([[a, y1, z], [b, y1, z], [b, yf, zf], [a, yf, zf]], cols[i % cols.length], n, pl, { ink: false, spec: 0.12 }), ng });
  }
  // фестоны: вертикальная лента с полукруглыми зубцами
  const nv = [0, 0, -1], plv = [0, 0, -1, -zf];
  for (let i = 0; i < k; i++) {
    const a = x0 + ((x1 - x0) * i) / k, b = x0 + ((x1 - x0) * (i + 1)) / k;
    const ps = [[a, yf, zf], [b, yf, zf], [b, yf - vh, zf]];
    for (let j = 1; j < 8; j++) { const t = j / 8; ps.push([b - (b - a) * t, yf - vh - Math.sin(t * Math.PI) * sc, zf]); }
    ps.push([a, yf - vh, zf]);
    prims.push({ ...S.base(ps, dark(cols[i % cols.length], 0.06), nv, plv, { ink: false, spec: 0.1 }), ng: { kind: 'linear', from: S.P([a, yf, zf]), to: S.P([a, yf - vh - sc, zf]), stops: [[0, [0, 0.3, -1]], [1, [0, -0.2, -1]]] } });
  }
  prims.push(S.line([x0, yf, zf], [x1, yf, zf], dark(cols[0], 0.4), S.sw(zf) * 0.8, { ink: true }));
  prims.push(S.line([x0, y1, z], [x0, yf, zf], C.line, S.sw(zf) * 0.8, { ink: true }), S.line([x1, y1, z], [x1, yf, zf], C.line, S.sw(zf) * 0.8, { ink: true }));
  const it = S.item(o.key ?? zf - 0.02, prims, { name: o.name || 'awning' });
  if (o.occ !== false) { S.tri3([[x0, y1, z], [x1, y1, z], [x1, yf, zf]], it); S.tri3([[x0, y1, z], [x1, yf, zf], [x0, yf, zf]], it); }
  return prims;
}
/** Плоский эллипс на горизонтальной плоскости Y (лужа, люк, ковёр). Возвращает примитив. */
export function disc(S, X, Y, Z, rx, rz, c, o = {}) {
  const n = o.n || 36, ps = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; ps.push([X + Math.cos(a) * rx * (o.wob ? 0.85 + rnd() * 0.3 : 1), Y, Z + Math.sin(a) * rz * (o.wob ? 0.85 + rnd() * 0.3 : 1)]); }
  return { t: 'poly', ps, alb: c, n: o.n3 || [0, 1, 0], pl: [0, 1, 0, Y], base: o.base ?? false, bump: true, ink: o.ink ?? false, spec: o.spec ?? 0.1, em: o.em, op: o.op ?? 1 };
}
/** Лестница вдоль Z: ступени-коробки без перекрытий (каждая на своём отрезке глубины). */
export function stairs(S, x0, x1, z0, z1, h, c = C.stoneHi, o = {}) {
  const n = o.steps || Math.max(2, Math.round(h / 0.21));
  for (let i = 0; i < n; i++) {
    const za = z0 + ((z1 - z0) * i) / n, zb = z0 + ((z1 - z0) * (i + 1)) / n, y = (o.y0 ?? 0) + (h * (i + 1)) / n;
    box(S, x0, x1, o.y0 ?? 0, y, za, zb, o.jitter === false ? c : jit(c, 0.05), { key: za, name: 'step', mats: o.mat === 'none' ? {} : { front: [o.mat || 'stone', c, { bh: 0.2 }], top: null } });
  }
}
