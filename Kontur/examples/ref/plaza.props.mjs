// Предметы world_build для examples/ref/stairs (регистрируются при импорте через registerWorldItem;
// ядро движка не меняется). Все размеры — метры, Y вверх, Z вглубь; key — ключ художника (больше — дальше).
import { registerWorldItem, face, box, cyl, lathe, latheStack, sphere, sphereTris, disc, PROFILES, textPrim, C, dark, lite, mix, jit, rnd, norm, sub, add, mul, dot, cross } from '../../engine/world3d.js';

const TAU = Math.PI * 2;
const reg = (type, build) => registerWorldItem(type, { doc: type, build });
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const minZ = (ps) => Math.min(...ps.map((p) => p[2]));
/** Рамка грани из описания {o,u,v,w,h,n}. */
const frOf = (S, F) => S.frame(F.o, F.u, F.v, F.w ?? 1, F.h ?? 1, F.n);
/** Толщина линии в px для толщины t м на глубине Z. */
const pxw = (S, t, Z) => Math.max(0.6, t * S.pxPerUnit(Z));

/* ---------- ориентированная коробка ---------- */
/** Коробка с основанием-прямоугольником: угол o=[X,Z], ось длины под углом ang (° от +X к +Z), ширина — влево от оси. */
export function obox(S, d, prims = null) {
  const [X, Z] = d.o, ang = ((d.ang ?? 0) * Math.PI) / 180;
  const u = [Math.cos(ang), 0, Math.sin(ang)], w = [-Math.sin(ang), 0, Math.cos(ang)];
  const [y0, y1] = d.y, L = d.len, Wd = d.wid;
  const p = (a, b, y) => [X + u[0] * a + w[0] * b, y, Z + u[2] * a + w[2] * b];
  const cen = p(L / 2, Wd / 2, (y0 + y1) / 2);
  const F = [[p(0, 0, y0), p(L, 0, y0), p(L, 0, y1), p(0, 0, y1)], [p(L, 0, y0), p(L, Wd, y0), p(L, Wd, y1), p(L, 0, y1)],
    [p(L, Wd, y0), p(0, Wd, y0), p(0, Wd, y1), p(L, Wd, y1)], [p(0, Wd, y0), p(0, 0, y0), p(0, 0, y1), p(0, Wd, y1)],
    [p(0, 0, y1), p(L, 0, y1), p(L, Wd, y1), p(0, Wd, y1)], [p(0, 0, y0), p(L, 0, y0), p(L, Wd, y0), p(0, Wd, y0)]];
  const out = [];
  F.forEach((ps, i) => {
    if (i === 5 && y0 < 0.01) return;
    const c = i === 4 ? d.top || d.color : (i === 1 || i === 3) ? d.side || d.color : d.color;
    out.push(...face(S, ps, c, { center: cen, spec: d.spec, em: d.em, ink: d.ink ?? true, sw: d.sw }));
  });
  if (prims) { prims.push(...out); return out; }
  S.item(d.key ?? Math.min(...F.flat().map((q) => q[2])), out, { name: d.name || 'obox', pmat: d.pmat });
  return out;
}
reg('obox', (S, d) => obox(S, d));

/* ---------- фонари ---------- */
/** Фонарь-«карета»: стекло со свечением, рамка, шатёр, навершие; hang — на крюке, wall — кронштейн к стене -X/+X. */
function lanternPrims(S, X, Y, Z, s, o = {}) {
  const prims = [], hw = 0.17 * s, hh = 0.42 * s, iron = o.iron || '#2c2428';
  const y0 = Y - hh / 2, y1 = Y + hh / 2;
  const sw = pxw(S, 0.025 * s, Z);
  const glass = (ps) => face(S, ps, o.glass || '#ffe2a0', { center: [X, Y, Z], em: o.glow || '#ffc860', ink: false, spec: 0.6 });
  const P = (a, y, b) => [X + a, y, Z + b];
  // стекло (4 грани чуть сужаются книзу)
  const t = hw, bt = hw * 0.8;
  prims.push(...glass([P(-bt, y0, -bt), P(bt, y0, -bt), P(t, y1, -t), P(-t, y1, -t)]));
  prims.push(...glass([P(bt, y0, -bt), P(bt, y0, bt), P(t, y1, t), P(t, y1, -t)]));
  prims.push(...glass([P(-bt, y0, bt), P(-bt, y0, -bt), P(-t, y1, -t), P(-t, y1, t)]));
  // рёбра рамки
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) prims.push(S.line(P(a * bt, y0, b * bt), P(a * t, y1, b * t), iron, sw, { ink: true }));
  prims.push(S.line(P(-t, y1, -t), P(t, y1, -t), iron, sw * 1.3, { ink: true }), S.line(P(-bt, y0, -bt), P(bt, y0, -bt), iron, sw * 1.3, { ink: true }));
  // шатёр и навершие
  const cap = hw * 1.45, ch = 0.22 * s;
  for (const [a, b] of [[[-cap, -cap], [cap, -cap]], [[cap, -cap], [cap, cap]], [[-cap, cap], [-cap, -cap]]]) prims.push(...face(S, [P(a[0], y1, a[1]), P(b[0], y1, b[1]), P(0, y1 + ch, 0)], iron, { center: [X, y1 + ch / 3, Z], spec: 0.5, sw }));
  prims.push(...face(S, [P(-cap, y1 - 0.03 * s, -cap), P(cap, y1 - 0.03 * s, -cap), P(cap, y1, -cap), P(-cap, y1, -cap)], dark(iron, 0.2), { center: [X, y1, Z], sw }));
  prims.push(...sphere(S, X, y1 + ch + 0.04 * s, Z, 0.045 * s, iron, { prims: true, spec: 0.6 }));
  // низ
  prims.push(...face(S, [P(-bt * 1.2, y0 - 0.06 * s, -bt * 1.2), P(bt * 1.2, y0 - 0.06 * s, -bt * 1.2), P(bt * 1.2, y0, -bt * 1.2), P(-bt * 1.2, y0, -bt * 1.2)], iron, { center: [X, y0, Z], sw }));
  prims.push(...face(S, [P(-0.04 * s, y0 - 0.14 * s, -0.04 * s), P(0.04 * s, y0 - 0.14 * s, -0.04 * s), P(0, y0 - 0.06 * s, -0.06 * s)], iron, { center: [X, y0, Z], sw }));
  return prims;
}
/** Фонарь: {p:[X,Y,Z], s, wall:±1 (кронштейн к стене по X), hangTo: Y крюка, radius, energy, color}. */
reg('lantern', (S, d) => {
  const [X, Y, Z] = d.p, s = d.s ?? 1, prims = [];
  const iron = '#2c2428', sw = pxw(S, 0.03 * s, Z);
  if (d.wall) { // кронштейн: от стены к верху фонаря
    const top = Y + 0.33 * s, wx = X + d.wall * 0.45 * s;
    prims.push(S.line([wx, top + 0.12 * s, Z], [X, top + 0.12 * s, Z], iron, sw * 1.6, { ink: true }), S.line([X, top + 0.12 * s, Z], [X, top, Z], iron, sw, { ink: true }));
    prims.push(S.line([wx, top - 0.25 * s, Z], [X + d.wall * 0.12 * s, top + 0.12 * s, Z], iron, sw, { ink: true }));
  }
  if (d.hangTo != null) prims.push(S.line([X, d.hangTo, Z], [X, Y + 0.3 * s, Z], iron, sw, { ink: true }));
  prims.push(...lanternPrims(S, X, Y, Z, s, { glow: d.glow }));
  S.item(d.key ?? Z - 0.3, prims, { name: 'lantern' });
  S.light([X, Y, Z - 0.25], d.color || '#ffb860', d.radius ?? 4, d.energy ?? 1.2, 'lamp');
});
/** Столб с фонарём: {X, Z, Y=0, h, s}. */
reg('lampPost', (S, d) => {
  const { X, Z } = d, Y = d.Y ?? 0, h = d.h ?? 3, s = d.s ?? 1;
  latheStack(S, X, Z, [
    { prof: [[0.11 * s, 0, 'c'], [0.11 * s, 0.25, 'c'], [0.06 * s, 0.35], [0.045 * s, h - 0.2], [0.07 * s, h - 0.1, 'c'], [0.09 * s, h, 'c'], [0, h, 'c']], color: '#2c2428', y0: Y, spec: 0.6 },
  ], { key: d.key ?? Z - 0.1, name: 'lamp_post' });
  S.item((d.key ?? Z - 0.1) - 0.05, lanternPrims(S, X, Y + h + 0.24 * s, Z, s), { name: 'lantern' });
  S.light([X, Y + h + 0.24 * s, Z - 0.25], d.color || '#ffb860', d.radius ?? 5, d.energy ?? 1.3, 'lamp');
});

/* ---------- гирлянды ---------- */
const sagAt = (a, b, sag, t) => { const p = lerp3(a, b, t); p[1] -= 4 * sag * t * (1 - t); return p; };
/** Флажки: {from, to, sag, n, w, h, colors}; path — ломаная [[X,Y,Z]…] вместо провиса, shapes — строка 't'/'r' (треугольник/вымпел) на флажок. */
function pathAt(path) {
  const L = [0]; for (let i = 1; i < path.length; i++) L.push(L[i - 1] + Math.hypot(...sub(path[i], path[i - 1])));
  const T = L[L.length - 1];
  return (t) => { const s = t * T; let i = 1; while (i < L.length - 1 && L[i] < s) i++; const u = (s - L[i - 1]) / (L[i] - L[i - 1] || 1); return lerp3(path[i - 1], path[i], Math.min(1, Math.max(0, u))); };
}
reg('bunting', (S, d) => {
  const n = d.n ?? 14, cols = d.colors || ['#d9503f', '#2a8a8a', '#e3a647', '#4a76b8', '#e98aa6', '#8a5aa8'];
  const prims = [];
  const at = d.path ? pathAt(d.path) : (t) => sagAt(d.from, d.to, d.sag ?? 0.4, t);
  const pts = []; for (let k = 0; k <= 40; k++) pts.push(at(k / 40));
  for (let k = 0; k < 40; k++) prims.push(S.line(pts[k], pts[k + 1], '#3a2a2a', pxw(S, 0.012, pts[k][2]), { ink: true }));
  const fw = d.w ?? 0.55, fh = d.h ?? 0.5;
  for (let i = 0; i < n; i++) {
    const t0 = (i + 0.06) / n, t1 = (i + 0.94) / n, tm = (t0 + t1) / 2;
    const m = at(tm), b0 = at(t1), a0 = at(t0);
    const dir = norm(sub(b0, a0)), rect = d.shapes?.[i] === 'r', w = rect ? (d.rw ?? fw * 0.55) : fw, h = rect ? (d.rh ?? fh * 1.6) : fh;
    const aa = sub(m, mul(dir, w / 2)), bb = add(m, mul(dir, w / 2));
    const c = cols[i % cols.length];
    const tip = [m[0] + (rnd() - 0.5) * 0.06, m[1] - h, m[2] - 0.05];
    const poly = rect ? [aa, bb, [bb[0] + (rnd() - 0.5) * 0.04, bb[1] - h, bb[2] - 0.05], [aa[0] + (rnd() - 0.5) * 0.04, aa[1] - h, aa[2] - 0.05]] : [aa, bb, tip];
    const fp = face(S, poly, c, { center: add(m, [0, 0, 1]), spec: 0.15, sw: pxw(S, 0.012, m[2]) })[0];
    if (fp) prims.push({ ...fp, ng: { kind: 'linear', from: S.P(aa), to: S.P(bb), stops: [[0, [-0.25, 0.1, -1]], [0.5, [0, 0.15, -1]], [1, [0.25, 0.1, -1]]] } });
    // складка ткани
    if (rect) prims.push({ t: 'poly', ps: [lerp3(aa, bb, 0.5), lerp3(aa, bb, 0.62), lerp3(poly[2], poly[3], 0.45), lerp3(poly[2], poly[3], 0.6)], alb: dark(c, 0.14), n: [0.2, 0, -1], pl: [0, 0, -1, -m[2]], bump: true, op: 0.6, spec: 0.1 });
    else prims.push({ t: 'poly', ps: [lerp3(aa, bb, 0.55), lerp3(aa, bb, 0.7), lerp3(tip, bb, 0.15)], alb: dark(c, 0.12), n: [0.2, 0, -1], pl: [0, 0, -1, -m[2]], bump: true, op: 0.6, spec: 0.1 });
  }
  S.item(d.key ?? Math.min(...(d.path ? d.path.map((q) => q[2]) : [d.from[2], d.to[2]])) - 0.1, prims, { name: 'bunting' });
});
/** Нить лампочек: {from, to, sag, n, r, every (свет у каждой k-й), color}. */
reg('fairy', (S, d) => {
  const n = d.n ?? 20, r = d.r ?? 0.06, prims = [], sag = d.sag ?? 0.4;
  const pts = []; for (let k = 0; k <= 48; k++) pts.push(sagAt(d.from, d.to, sag, k / 48));
  for (let k = 0; k < 48; k++) prims.push(S.line(pts[k], pts[k + 1], '#2a2226', pxw(S, 0.01, pts[k][2]), { ink: true }));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, p = sagAt(d.from, d.to, sag, t);
    prims.push(S.line(p, [p[0], p[1] - r * 0.8, p[2]], '#2a2226', pxw(S, 0.012, p[2])));
    prims.push(...sphere(S, p[0], p[1] - r * 1.6, p[2], r, d.bulb || '#fff2c8', { prims: true, em: d.color || '#ffd890', spec: 0.6, ink: true }));
    if (d.every && i % d.every === 0) S.light([p[0], p[1] - r * 1.6, p[2] - 0.1], '#ffc070', d.radius ?? 2.2, d.energy ?? 0.5, 'fairy');
  }
  S.item(d.key ?? Math.min(d.from[2], d.to[2]) - 0.12, prims, { name: 'fairy' });
});

/* ---------- ящики, горшки, растения ---------- */
/** Ящик из досок: {o:[X,Z], len, wid, h, y0, ang, color, fill: цвет плодов, fruit: r}. */
reg('crate', (S, d) => {
  const y0 = d.y0 ?? 0, h = d.h ?? 0.6, c = d.color || '#a8743c', prims = [];
  const ang = ((d.ang ?? 0) * Math.PI) / 180, u = [Math.cos(ang), 0, Math.sin(ang)], w = [-Math.sin(ang), 0, Math.cos(ang)];
  const [X, Z] = d.o, L = d.len ?? 0.8, Wd = d.wid ?? 0.6;
  obox(S, { o: d.o, ang: d.ang, len: L, wid: Wd, y: [y0, y0 + h], color: c, top: d.fill ? dark(c, 0.45) : lite(c, 0.08), side: dark(c, 0.08) }, prims);
  const p = (a, b, y) => [X + u[0] * a + w[0] * b, y, Z + u[2] * a + w[2] * b];
  const zc = Z + (u[2] * L + w[2] * Wd) / 2;
  const sw = pxw(S, 0.02, zc), sl = dark(c, 0.45);
  // плоскости граней: рейки и щели лежат на них (иначе край толстой рейки освещается как стена за ящиком — «просвечивает»)
  const plOf = (nv, q) => ({ pl: [nv[0], nv[1], nv[2], nv[0] * q[0] + nv[1] * q[1] + nv[2] * q[2]] });
  const front = plOf([-w[0], 0, -w[2]], p(0, 0, y0)), left = plOf([-u[0], 0, -u[2]], p(0, 0, y0)), right = plOf([u[0], 0, u[2]], p(L, 0, y0));
  // щели между досками и уголки-рейки
  for (const k of [1, 2]) {
    const y = y0 + (h * k) / 3;
    prims.push(S.line(p(0, -0.002, y), p(L, -0.002, y), sl, sw, front));
    prims.push(S.line(p(L + 0.002, 0, y), p(L + 0.002, Wd, y), sl, sw, right));
    prims.push(S.line(p(-0.002, 0, y), p(-0.002, Wd, y), sl, sw, left));
  }
  for (const [a, b, pl] of [[0, 0, front], [L, 0, front], [0, Wd, left], [L, Wd, right]]) prims.push(S.line(p(a, b, y0), p(a, b, y0 + h), dark(c, 0.25), pxw(S, 0.07, zc), pl));
  prims.push(S.line(p(0.02, -0.003, y0 + 0.03), p(L - 0.02, -0.003, y0 + h - 0.03), dark(c, 0.2), pxw(S, 0.05, zc), front));
  if (d.fill) { // плоды горкой
    const fr = d.fruit ?? 0.07, list = [];
    for (let i = 0; i < 40; i++) {
      const a = fr + rnd() * (L - 2 * fr), b = fr + rnd() * (Wd - 2 * fr), q = p(a, b, y0 + h - 0.02 + fr * (0.5 + rnd() * 0.6));
      list.push(q);
    }
    list.sort((A, B) => B[2] - A[2] || A[1] - B[1]);
    const fills = Array.isArray(d.fill) ? d.fill : [d.fill];
    for (const q of list) prims.push(...sphere(S, q[0], q[1], q[2], fr * (0.85 + rnd() * 0.3), jit(fills[Math.floor(rnd() * fills.length)], 0.12), { prims: true, spec: 0.5, ink: true }));
  }
  S.item(d.key ?? Math.min(Z, Z + u[2] * L, Z + w[2] * Wd, Z + u[2] * L + w[2] * Wd), prims, { name: 'crate', pmat: d.pmat });
});
/** Шапка листвы/цветов: комки-сферы и цветы над точкой. */
function foliage(S, X, Y, Z, r, o = {}) {
  const out = [], n = o.n ?? 9, leaf = o.leaf || '#5f8a3a', list = [];
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, rr = r * Math.sqrt(rnd()) * 0.75;
    list.push({ p: [X + Math.cos(a) * rr, Y + r * (0.35 + rnd() * 0.5) * (o.tall ?? 1), Z + Math.sin(a) * rr * 0.8], s: r * (0.38 + rnd() * 0.25), c: jit(leaf, 0.15), k: 'l' });
  }
  const fl = o.flower ? (o.flowers ?? 16) : 0;
  for (let i = 0; i < fl; i++) {
    const a = rnd() * TAU, rr = r * Math.sqrt(rnd()) * 0.85;
    const fc = Array.isArray(o.flower) ? o.flower[Math.floor(rnd() * o.flower.length)] : o.flower;
    list.push({ p: [X + Math.cos(a) * rr, Y + r * (0.6 + rnd() * 0.5) * (o.tall ?? 1), Z + Math.sin(a) * rr * 0.8 - r * 0.15], s: r * (o.fs ?? 0.17) * (0.8 + rnd() * 0.5), c: jit(fc, 0.1), k: 'f' });
  }
  list.sort((A, B) => B.p[2] - A.p[2] || A.p[1] - B.p[1]);
  for (const q of list) out.push(...sphere(S, q.p[0], q.p[1], q.p[2], q.s, q.c, { prims: true, flat: q.k === 'l' ? 0.45 : 0.2, wob: 0.12, spec: q.k === 'f' ? 0.25 : 0.2, ink: true }));
  if (o.occ) for (const q of list) if (q.k === 'l') o.occ.push([q.p, q.s]); // комки листвы — в тени (по запросу)
  return out;
}
/** Окклюдеры теней для сфер [[центр, r]…]: грубые сферы (6 долек), чтобы листва бросала тень на горшок и стену. */
export function occluders(S, it, list, k = 0.8) { for (const [c, r] of list) for (const t of sphereTris(c, r * k, false, 6)) S.tri3(t, it); }
/** Горшок с растением: {X, Z, Y, r, h, color, plant:'bush'|'tree'|'flowers', leaf, flower, fr (радиус кроны)}. */
reg('pot', (S, d) => {
  const { X, Z } = d, Y = d.Y ?? 0, r = d.r ?? 0.2, h = d.h ?? r * 1.7, c = d.color || '#c0643a';
  const key = d.key ?? Z - r;
  if (d.bucket) cyl(S, X, Z, r, Y, Y + h, '#8a8c94', { key, bands: h / 3, spec: 0.5 });
  // матовая глина с фактурой (материал terracotta сцены, если он есть): гладкий горшок с бликом выглядел пластиковым
  else lathe(S, X, Z, PROFILES.pot(h, r), c, { y0: Y, key, top: '#4a3020', spec: d.spec ?? 0.04, pmat: d.pmat ?? 'terracotta' });
  const fr = d.fr ?? r * 1.5;
  const prims = [], occ = d.occ ? [] : null;
  if (d.plant === 'tree') {
    prims.push(S.line([X, Y + h, Z], [X, Y + h + fr * 1.1, Z], '#5a3a24', pxw(S, 0.035, Z), { ink: true }));
    prims.push(...foliage(S, X, Y + h + fr * 0.9, Z, fr, { leaf: d.leaf || '#4f7a30', flower: d.flower || '#f2c838', flowers: 14, fs: 0.13, n: 10, occ }));
  } else prims.push(...foliage(S, X, Y + h * 0.85, Z, fr, { leaf: d.leaf, flower: d.flower, flowers: d.flowers ?? 18, n: d.n ?? 9, fs: d.fs, occ }));
  // крона пропускает часть света: тень от неё пятнистая, а не гладкий шар
  const it = S.item(key - 0.02, prims, { name: 'plant', alpha: 0.65 });
  if (occ) occluders(S, it, occ);
});
/** Ящик-кашпо на стене или перилах: {x:[a,b], y, z, flower, leaf, trail} (фронтальный). */
reg('planter', (S, d) => {
  const [a, b] = d.x, y = d.y, z = d.z, prims = [];
  box(S, a, b, y, y + (d.h ?? 0.22), z - (d.d ?? 0.25), z, d.color || '#9a6438', { key: z - (d.d ?? 0.25), name: 'planter' });
  const n = Math.max(2, Math.round((b - a) / 0.22));
  const occ = d.occ ? [] : null;
  for (let i = 0; i < n; i++) prims.push(...foliage(S, a + ((i + 0.5) * (b - a)) / n, y + 0.12, z - 0.12, 0.2, { leaf: d.leaf || '#5a8a3a', flower: d.flower || '#f4f2ea', flowers: 10, n: 4, fs: 0.2, occ }));
  if (d.trail) for (let i = 0; i < d.trail; i++) { // свисающий плющ
    const x = a + rnd() * (b - a), L = 0.3 + rnd() * (d.trailLen ?? 0.8);
    const m = Math.max(5, Math.round(L / 0.045));
    for (let k = 0; k < m; k++) prims.push(leaf(S, [x + Math.sin(k * 0.9 + i) * 0.04 + (rnd() - 0.5) * 0.05, y - (L * k) / m, z - 0.27], 0.04 + rnd() * 0.02));
  }
  const it = S.item(z - (d.d ?? 0.25) - 0.02, prims, { name: 'planter_plants', alpha: 0.65 });
  if (occ) occluders(S, it, occ);
});
/** Лист: ромбик, обращённый к камере, со случайным наклоном нормали и тоном. */
function leaf(S, p, r) {
  const t = rnd() * TAU, c = Math.cos(t), s = Math.sin(t), q = (u, v) => [p[0] + u * c - v * s, p[1] + u * s + v * c, p[2]];
  const n = norm([(rnd() - 0.5) * 1.2, (rnd() - 0.2) * 1.0, -1]);
  return { t: 'poly', ps: [q(r, 0), q(0, r * 0.55), q(-r * 0.8, 0), q(0, -r * 0.55)], alb: jit(['#4f7a34', '#6f9a44', '#3f6a2c', '#86aa50'][Math.floor(rnd() * 4)], 0.08), n, pl: [0, 0, -1, -p[2]], base: true, ink: false, spec: 0.3, op: 1 };
}
/** Плющ, свисающий с края: {x:[a,b], y, z, len, n} или {pts:[[X,Y,Z,len]…]} (лозы с любых точек). */
reg('drape', (S, d) => {
  const prims = [];
  if (d.pts) {
    for (const [X, Y, Z, L0] of d.pts) for (let j = 0; j < (d.per ?? 3); j++) {
      const L = L0 * (0.5 + rnd() * 0.5), m = Math.max(6, Math.round(L / 0.06)), ox = (rnd() - 0.5) * 0.25;
      prims.push(S.line([X + ox, Y, Z - 0.03], [X + ox + Math.sin(m * 0.6 + j) * 0.05, Y - L, Z - 0.03], '#3a5a28', pxw(S, 0.01, Z)));
      for (let k = 0; k < m; k++) prims.push(leaf(S, [X + ox + Math.sin(k * 0.6 + j) * 0.05 + (rnd() - 0.5) * 0.08, Y - (L * k) / m, Z - 0.03 - rnd() * 0.03], 0.05 + rnd() * 0.03));
    }
    S.item(d.key ?? Math.min(...d.pts.map((p) => p[2])) - 0.06, prims, { name: 'drape' });
    return;
  }
  const [a, b] = d.x;
  for (let i = 0; i < (d.n ?? 8); i++) {
    const x = a + rnd() * (b - a), L = (d.len ?? 1) * (0.4 + rnd() * 0.6), m = Math.max(6, Math.round(L / 0.045));
    for (let k = 0; k < m; k++) prims.push(leaf(S, [x + Math.sin(k * 0.7 + i) * 0.05 + (rnd() - 0.5) * 0.06, d.y - (L * k) / m, d.z - 0.02 - rnd() * 0.04], 0.04 + rnd() * 0.025));
  }
  S.item(d.key ?? d.z - 0.05, prims, { name: 'drape' });
});

/* ---------- балюстрады и перила ---------- */
/** Каменная балюстрада вдоль X: {x:[a,b], y, z, h, step, r, color, posts:[X…]}. */
reg('balustrade', (S, d) => {
  const [a, b] = d.x, y = d.y, z = d.z, h = d.h ?? 0.95, c = d.color || '#ead8b6', step = d.step ?? 0.24, r = d.r ?? 0.055;
  box(S, a, b, y, y + 0.12, z - 0.13, z + 0.13, dark(c, 0.06), { key: z - 0.13, name: 'bal_base' });
  const posts = d.posts || [];
  for (let x = a + step / 2; x < b; x += step) {
    if (posts.some((px) => Math.abs(px - x) < 0.22)) continue;
    lathe(S, x, z, PROFILES.baluster(h - 0.24, r), c, { y0: y + 0.12, key: z - 0.05, n: 10, smooth: false });
  }
  box(S, a - 0.05, b + 0.05, y + h - 0.12, y + h, z - 0.15, z + 0.15, lite(c, 0.05), { key: z - 0.16, name: 'bal_rail' });
  for (const px of posts) box(S, px - 0.17, px + 0.17, y, y + h + 0.05, z - 0.17, z + 0.17, c, { key: z - 0.18, name: 'bal_post' });
});
/** Деревянные перила от p0 до p1 (горизонтальные или наклонные): {from:[X,Y,Z], to:[X,Y,Z], h, step, color, iron}. */
reg('rail', (S, d) => {
  const A = d.from, B = d.to, h = d.h ?? 0.95, c = d.color || '#8a5a30', L = Math.hypot(B[0] - A[0], B[2] - A[2]);
  const n = Math.max(1, Math.round(L / (d.step ?? 0.22))), prims = [];
  const zk = Math.min(A[2], B[2]);
  const spind = d.iron ? '#2c2428' : dark(c, 0.1);
  for (let i = 0; i <= n; i++) {
    const p = lerp3(A, B, i / n);
    if (d.iron) prims.push(S.line(p, [p[0], p[1] + h, p[2]], spind, pxw(S, 0.025, p[2]), { ink: true }));
    else prims.push(S.line(p, [p[0], p[1] + h, p[2]], spind, pxw(S, 0.06, p[2]), { ink: true }));
  }
  const tw = d.tw ?? 0.09, tt = d.tt ?? 0.08;
  // поручень — брус: верх и лицевая грань
  const dir = norm([B[0] - A[0], 0, B[2] - A[2]]), side = [-dir[2], 0, dir[0]];
  const off = (p, s, dy) => [p[0] + side[0] * s, p[1] + h + dy, p[2] + side[2] * s];
  const top = [off(A, -tw / 2, 0), off(B, -tw / 2, 0), off(B, tw / 2, 0), off(A, tw / 2, 0)];
  const fr1 = [off(A, -tw / 2, -tt), off(B, -tw / 2, -tt), off(B, -tw / 2, 0), off(A, -tw / 2, 0)];
  const fr2 = [off(A, tw / 2, -tt), off(B, tw / 2, -tt), off(B, tw / 2, 0), off(A, tw / 2, 0)];
  const cen = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2 + h - tt / 2, (A[2] + B[2]) / 2];
  for (const ps of [fr1, fr2, top]) prims.push(...face(S, ps, ps === top ? lite(c, 0.1) : c, { center: cen, spec: 0.3 }));
  if (d.bottom) { const bt = [off(A, -0.03, -h + 0.08), off(B, -0.03, -h + 0.08), off(B, -0.03, -h + 0.14), off(A, -0.03, -h + 0.14)]; prims.push(...face(S, bt, c, { center: add(cen, [0, -h, 0]) })); }
  S.item(d.key ?? zk - 0.05, prims, { name: 'rail' });
});

/* ---------- знамя, полки, скамья ---------- */
/** Знамя: {X, z, y:[низ, верх], w, color, border, emblem}. */
reg('banner', (S, d) => {
  const { X, z } = d, [y0, y1] = d.y, w = d.w ?? 1, c = d.color || '#b8282a', g = d.border || '#e8b830', prims = [];
  const fr = S.frame([X - w / 2, y0, z], [1, 0, 0], [0, 1, 0], w, y1 - y0, [0, 0, -1]);
  const tipH = 0.32 * w;
  const shape = (m) => [fr.at(m, tipH + m * 0.4), fr.at(w / 2, m * 1.2), fr.at(w - m, tipH + m * 0.4), fr.at(w - m, y1 - y0 - m * 0.3), fr.at(m, y1 - y0 - m * 0.3)];
  const pl = fr.pl, ng = { kind: 'linear', from: S.P(fr.at(0, 1)), to: S.P(fr.at(w, 1)), stops: [[0, [-0.35, 0, -1]], [0.25, [0.1, 0, -1]], [0.5, [-0.15, 0, -1]], [0.75, [0.15, 0, -1]], [1, [0.35, 0, -1]]] };
  prims.push({ t: 'poly', ps: shape(0), alb: g, n: [0, 0, -1], pl, base: true, ink: true, spec: 0.3, op: 1, ng });
  prims.push({ t: 'poly', ps: shape(0.06 * w), alb: c, n: [0, 0, -1], pl, bump: true, spec: 0.15, op: 1, ng });
  // поперечная полоса и лимон
  prims.push(S.det(fr, fr.rect(0.06 * w, y1 - y0 - 0.3 * w, w * 0.88, 0.045 * w), g, { spec: 0.4 }));
  const ec = d.emblem || '#f2c430', e = [];
  for (let k = 0; k < 24; k++) { const t = (k / 24) * TAU; e.push(fr.at(w / 2 + Math.cos(t) * w * 0.3 * (1 + 0.12 * Math.cos(2 * t) ** 8), (y1 - y0) * 0.55 + Math.sin(t) * w * 0.2)); }
  prims.push({ t: 'poly', ps: e, alb: ec, n: [0, 0.2, -1], pl, bump: true, ink: true, sw: S.sw(z) * 0.7, spec: 0.4, op: 1 });
  prims.push(S.det(fr, [fr.at(w * 0.36, (y1 - y0) * 0.6), fr.at(w * 0.5, (y1 - y0) * 0.66), fr.at(w * 0.6, (y1 - y0) * 0.62)], lite(ec, 0.4), { op: 0.7 }));
  // штанга
  prims.push(S.line([X - w * 0.6, y1 + 0.02, z - 0.02], [X + w * 0.6, y1 + 0.02, z - 0.02], '#4a3020', pxw(S, 0.05, z), { ink: true }));
  S.item(d.key ?? z - 0.05, prims, { name: 'banner' });
});
/** Полки с книгами в нише: {x:[a,b], z, y:[y0,y1], rows, color}. */
reg('bookshelf', (S, d) => {
  const [a, b] = d.x, z = d.z, [y0, y1] = d.y, rows = d.rows ?? 3, c = d.color || '#c8a070', prims = [];
  const fr = S.frame([a, y0, z], [1, 0, 0], [0, 1, 0], b - a, y1 - y0, [0, 0, -1]);
  const W = b - a, H = y1 - y0, rh = H / rows;
  prims.push(S.det(fr, fr.rect(0, 0, W, H), dark(c, 0.5), { solid: true }));
  const BK = ['#8a3a2a', '#2f5a7a', '#c8a040', '#4a6a3a', '#7a3a5a', '#d06a3a', '#3a3a5a', '#e0d0b0'];
  for (let r = 0; r < rows; r++) {
    const yb = r * rh + 0.04;
    prims.push(S.det(fr, fr.rect(0, r * rh, W, 0.04), lite(c, 0.1), { n: fr.tilt(0, 1, 0.8), ink: true, sw: S.sw(z) * 0.5 }));
    for (let x = 0.04; x < W - 0.06;) {
      if (rnd() < 0.12) { x += 0.1 + rnd() * 0.15; continue; }
      const bw = 0.04 + rnd() * 0.05, bh = rh * (0.55 + rnd() * 0.35);
      if (rnd() < 0.15) { // стопка лёжа или предмет
        prims.push(S.det(fr, fr.rect(x, yb, 0.22, 0.05), BK[Math.floor(rnd() * 8)], { ink: true, sw: S.sw(z) * 0.4, bump: true }));
        prims.push(S.det(fr, fr.rect(x + 0.02, yb + 0.05, 0.18, 0.05), BK[Math.floor(rnd() * 8)], { ink: true, sw: S.sw(z) * 0.4, bump: true }));
        x += 0.26; continue;
      }
      prims.push(S.det(fr, fr.rect(x, yb, bw, bh), jit(BK[Math.floor(rnd() * 8)], 0.1), { ink: true, sw: S.sw(z) * 0.4, n: fr.tilt((rnd() - 0.5) * 0.4, 0, 0.6) }));
      x += bw + 0.005;
    }
  }
  prims.push(S.det(fr, fr.rect(0, 0, 0.05, H), c, { n: fr.tilt(-1, 0, 0.7), ink: true, sw: S.sw(z) * 0.5 }), S.det(fr, fr.rect(W - 0.05, 0, 0.05, H), c, { n: fr.tilt(1, 0, 0.7), ink: true, sw: S.sw(z) * 0.5 }));
  prims.push(S.det(fr, fr.rect(0, H - 0.05, W, 0.05), c, { ink: true, sw: S.sw(z) * 0.5 }));
  S.item(d.key ?? z - 0.01, prims, { name: 'bookshelf' });
});
/** Скамья с чугунными боковинами: {o:[X,Z], ang, len}. Сиденье — вдоль оси, спинка — сзади (по +ширине). */
reg('bench', (S, d) => {
  const L = d.len ?? 1.6, c = d.color || '#a8682e', iron = '#2a2428', prims = [];
  const ang = ((d.ang ?? 0) * Math.PI) / 180, u = [Math.cos(ang), 0, Math.sin(ang)], w = [-Math.sin(ang), 0, Math.cos(ang)];
  const [X, Z] = d.o;
  const p = (a, b, y) => [X + u[0] * a + w[0] * b, y, Z + u[2] * a + w[2] * b];
  // ножки-боковины
  for (const a of [0.08, L - 0.08]) {
    prims.push(S.line(p(a, 0.02, 0), p(a, 0.05, 0.45), iron, pxw(S, 0.05, Z), { ink: true }), S.line(p(a, 0.42, 0), p(a, 0.4, 0.45), iron, pxw(S, 0.05, Z), { ink: true }));
    prims.push(S.line(p(a, 0.4, 0.45), p(a, 0.5, 0.95), iron, pxw(S, 0.05, Z), { ink: true }));
    prims.push(S.line(p(a, 0.0, 0.62), p(a, 0.42, 0.66), iron, pxw(S, 0.045, Z), { ink: true }), S.line(p(a, 0.0, 0.62), p(a, 0.05, 0.45), iron, pxw(S, 0.04, Z), { ink: true }));
  }
  for (let k = 0; k < 4; k++) obox(S, { o: [p(0, 0.02 + k * 0.1, 0)[0], p(0, 0.02 + k * 0.1, 0)[2]], ang: d.ang, len: L, wid: 0.085, y: [0.42, 0.46], color: jit(c, 0.06), sw: 1 }, prims);
  for (let k = 0; k < 3; k++) {
    const b = 0.42 + k * 0.03, y = 0.56 + k * 0.13;
    const q = [p(0, b, y), p(L, b, y), p(L, b + 0.02, y + 0.1), p(0, b + 0.02, y + 0.1)];
    prims.push(...face(S, q, jit(c, 0.06), { center: p(L / 2, 0.9, 0.7), spec: 0.25, sw: pxw(S, 0.012, Z) }));
  }
  S.item(d.key ?? Math.min(p(0, 0, 0)[2], p(L, 0, 0)[2]) - 0.05, prims, { name: 'bench' });
});

/* ---------- ограждение ямы ---------- */
/** Конус-столбик: {X, Z, h, color}. */
reg('cone', (S, d) => {
  const { X, Z } = d, h = d.h ?? 0.45, c = d.color || '#b8682e', wc = '#f2ece2', r = h * 0.2;
  const seg = (y0, y1, col) => ({ prof: [[r * (1 - (y0 / h) * 0.8), y0, 'c'], [r * (1 - (y1 / h) * 0.8), y1, 'c']], color: col, top: false, spec: 0.35 });
  latheStack(S, X, Z, [
    { prof: [[r * 1.35, 0, 'c'], [r * 1.35, h * 0.06, 'c'], [r, h * 0.06, 'c']], color: '#5a3a2a', top: false },
    seg(h * 0.06, h * 0.32, c), seg(h * 0.32, h * 0.44, wc), seg(h * 0.44, h * 0.64, c), seg(h * 0.64, h * 0.74, wc), seg(h * 0.74, h * 0.92, c),
    { prof: [[r * 0.3, h * 0.92, 'c'], [r * 0.3, h, 'c'], [0, h, 'c']], color: '#3a2a22' },
  ], { key: d.key ?? Z - r, name: 'cone' });
});
/** Лента красно-белая по точкам: {pts:[[X,Y,Z]…], seg, w}. */
reg('tape', (S, d) => {
  const prims = [], seg = d.seg ?? 0.16;
  for (let i = 0; i + 1 < d.pts.length; i++) {
    const A = d.pts[i], B = d.pts[i + 1], L = Math.hypot(B[0] - A[0], B[2] - A[2]), n = Math.max(2, Math.round(L / seg)), sag = d.sag ?? 0.08;
    for (let k = 0; k < n; k++) {
      const a = sagAt(A, B, sag, k / n), b = sagAt(A, B, sag, (k + 1) / n);
      prims.push(S.line(a, b, k % 2 ? '#f4eee6' : '#c8282a', pxw(S, d.w ?? 0.035, a[2]), { ink: k === 0 }));
    }
  }
  S.item(d.key ?? Math.min(...d.pts.map((p) => p[2])) - 0.3, prims, { name: 'tape' });
});
/** Складной знак «домик»: {X, Z, h, w, ang, kind:'work'|'chalk'}. */
reg('aframe', (S, d) => {
  const { X, Z } = d, h = d.h ?? 0.75, w = d.w ?? 0.55, prims = [];
  const ang = ((d.ang ?? 0) * Math.PI) / 180, u = [Math.cos(ang), 0, Math.sin(ang)], wv = [-Math.sin(ang), 0, Math.cos(ang)];
  const p = (a, b, y) => [X + u[0] * a + wv[0] * b, y, Z + u[2] * a + wv[2] * b];
  const sp = h * 0.28;
  const back = [p(-w / 2, sp, 0), p(w / 2, sp, 0), p(w / 2, 0.02, h), p(-w / 2, 0.02, h)];
  const front = [p(-w / 2, -sp, 0), p(w / 2, -sp, 0), p(w / 2, 0, h), p(-w / 2, 0, h)];
  const cen = p(0, 0, h / 2);
  const kind = d.kind || 'work';
  const fc = kind === 'work' ? '#f0c020' : '#2a2a2c';
  prims.push(...face(S, back, '#7a5a3a', { center: cen }));
  prims.push(...face(S, front, kind === 'work' ? '#e8b818' : '#8a5a30', { center: cen, spec: 0.3, sw: pxw(S, 0.02, Z) }));
  // лицевая панель как рамка
  const n = norm(cross(sub(front[1], front[0]), sub(front[3], front[0])));
  const nn = dot(n, sub(S.cam, cen)) < 0 ? mul(n, -1) : n;
  const fr = S.frame(add(front[0], mul(nn, 0.005)), norm(sub(front[1], front[0])), norm(sub(front[3], front[0])), w, Math.hypot(sp, h), nn);
  const FW = w, FH = fr.h;
  if (kind === 'work') {
    prims.push(S.det(fr, [fr.at(FW * 0.1, FH * 0.18), fr.at(FW * 0.9, FH * 0.18), fr.at(FW * 0.5, FH * 0.86)], '#1e1a1a', { ink: false }));
    prims.push(S.det(fr, [fr.at(FW * 0.2, FH * 0.25), fr.at(FW * 0.8, FH * 0.25), fr.at(FW * 0.5, FH * 0.76)], '#f2c418', {}));
    // рабочий с лопатой
    prims.push(S.det(fr, [fr.at(FW * 0.45, FH * 0.3), fr.at(FW * 0.52, FH * 0.3), fr.at(FW * 0.55, FH * 0.48), fr.at(FW * 0.47, FH * 0.5)], '#1e1a1a'));
    prims.push(S.det(fr, [fr.at(FW * 0.47, FH * 0.53), fr.at(FW * 0.53, FH * 0.53), fr.at(FW * 0.53, FH * 0.59), fr.at(FW * 0.47, FH * 0.59)], '#1e1a1a'));
    prims.push(S.det(fr, [fr.at(FW * 0.36, FH * 0.29), fr.at(FW * 0.39, FH * 0.29), fr.at(FW * 0.55, FH * 0.45), fr.at(FW * 0.52, FH * 0.46)], '#1e1a1a'));
    prims.push(S.det(fr, [fr.at(FW * 0.3, FH * 0.27), fr.at(FW * 0.44, FH * 0.27), fr.at(FW * 0.4, FH * 0.32)], '#1e1a1a'));
  } else {
    prims.push(S.det(fr, fr.rect(FW * 0.08, FH * 0.08, FW * 0.84, FH * 0.84), fc, { spec: 0.05 }));
    const chalk = '#e8e4dc', lw = pxw(S, 0.012, Z);
    const circ = (a0, b0, r, k = 14) => { for (let i = 0; i < k; i++) { const t0 = (i / k) * TAU, t1 = ((i + 1) / k) * TAU; prims.push(S.line(fr.at(a0 + Math.cos(t0) * r, b0 + Math.sin(t0) * r), fr.at(a0 + Math.cos(t1) * r, b0 + Math.sin(t1) * r), chalk, lw)); } };
    circ(FW * 0.35, FH * 0.7, FW * 0.12); circ(FW * 0.65, FH * 0.66, FW * 0.1); circ(FW * 0.5, FH * 0.38, FW * 0.14);
    prims.push(S.line(fr.at(FW * 0.35, FH * 0.82), fr.at(FW * 0.38, FH * 0.88), chalk, lw), S.line(fr.at(FW * 0.3, FH * 0.2), fr.at(FW * 0.7, FH * 0.2), chalk, lw));
  }
  S.item(d.key ?? Z - h * 0.3, prims, { name: 'aframe' });
});

/* ---------- яма, люки, решётки, лужи ---------- */
/** Открытый колодец: {X, Z, R (бортик), r (проём), depth}. */
reg('pit', (S, d) => {
  const { X, Z } = d, R = d.R ?? 1.8, r = d.r ?? 1.3, dep = d.depth ?? 1.6, prims = [];
  const ring = (rr, y, n = 48) => { const ps = []; for (let i = 0; i < n; i++) { const a = (i / n) * TAU; ps.push([X + Math.cos(a) * rr, y, Z + Math.sin(a) * rr]); } return ps; };
  const hole = ring(r, 0.004);
  prims.push({ t: 'poly', ps: hole, alb: '#140e0c', n: [0, 1, 0], pl: [0, 1, 0, 0.004], base: true, ink: false, spec: 0, op: 1 });
  // задняя внутренняя стенка (видна сверху), обрезана по проёму
  const n = 32;
  for (let i = 0; i < n; i++) {
    const a0 = Math.PI * (i / n), a1 = Math.PI * ((i + 1) / n), am = (a0 + a1) / 2;
    const q = (a, y) => [X + Math.cos(a) * r, y, Z + Math.sin(a) * r];
    const ps = [q(a0, 0), q(a1, 0), q(a1, -dep), q(a0, -dep)];
    const nn = [-Math.cos(am), 0, -Math.sin(am)];
    const sh = 0.25 + 0.5 * Math.sin(am);
    prims.push({ t: 'poly', ps, alb: mix('#5a3e30', '#1c130f', sh), n: nn, pl: [...nn, dot(nn, ps[0])], base: true, ink: false, spec: 0.15, op: 1, clip: hole });
    if (i % 2 === 0) prims.push({ t: 'line', a: q(a0, -0.25), b: q(a1, -0.25), col: '#3a2a20', w: pxw(S, 0.02, Z), ink: false, op: 0.8 });
  }
  // труба поперёк и дно
  const py = -0.42, pr = 0.12;
  const pz = Z + r * 0.55;
  const pipe = (dy, c) => ({ t: 'poly', ps: [[X - r, py + dy, pz], [X + r, py + dy, pz], [X + r, py + dy + pr, pz], [X - r, py + dy + pr, pz]], alb: c, n: [0, dy > 0 ? 0.7 : -0.3, -1], pl: [0, 0, -1, -pz], base: true, ink: true, sw: 1.2, spec: 0.6, op: 1, clip: hole });
  prims.push(pipe(0, '#8a5a3a'), pipe(pr * 0.9, '#c08050'));
  for (const xx of [-0.5, 0.45]) prims.push({ t: 'poly', ps: [[X + xx - 0.06, py - 0.02, pz - 0.01], [X + xx + 0.06, py - 0.02, pz - 0.01], [X + xx + 0.06, py + 2 * pr, pz - 0.01], [X + xx - 0.06, py + 2 * pr, pz - 0.01]], alb: '#5a3a28', n: [0, 0, -1], pl: [0, 0, -1, -(pz - 0.01)], base: true, ink: true, sw: 1, spec: 0.5, op: 1, clip: hole });
  S.item(Z + r * 0.5, prims, { name: 'pit_inside', force: true });
  // лампочки внутри
  for (const a of [0.9, 1.7, 2.4]) {
    const p = [X + Math.cos(a) * r * 0.97, -0.12, Z + Math.sin(a) * r * 0.97];
    S.item(Z + r * 0.45, sphere(S, p[0], p[1], p[2], 0.05, '#fff0c0', { prims: true, em: '#ffd080', ink: false }).map((q) => ({ ...q, clip: hole })), { name: 'pit_bulb' });
    S.light([p[0], p[1], p[2] - 0.35], '#ffb860', 0.9, 0.35, 'lamp');
  }
  // бортик из каменных блоков с щелями
  const hb = 0.14, NB = 22, sc = d.stone || '#b8a284';
  S.item(Z + R, [{ t: 'poly', ps: ring(R + 0.03, 0.005, 64), holes: [ring(r, 0.005, 64)], alb: '#4a3a30', n: [0, 1, 0], pl: [0, 1, 0, 0.005], base: true, ink: false, spec: 0.1, op: 1 }], { name: 'pit_bed' });
  for (let i = 0; i < NB; i++) {
    const a0 = (i / NB) * TAU + 0.012, a1 = ((i + 1) / NB) * TAU - 0.012, am = (a0 + a1) / 2;
    const q = (a, rr, y) => [X + Math.cos(a) * rr, y, Z + Math.sin(a) * rr];
    const c = jit(sc, 0.1), cen = q(am, (R + r) / 2, hb / 2), yb = hb * (0.92 + rnd() * 0.12);
    const pr = [];
    pr.push(...face(S, [q(a0, R, 0), q(a1, R, 0), q(a1, R, yb), q(a0, R, yb)], dark(c, 0.1), { center: cen, sw: pxw(S, 0.012, Z), spec: 0.15 }));
    pr.push(...face(S, [q(a0, r, 0), q(a1, r, 0), q(a1, r, yb), q(a0, r, yb)], dark(c, 0.25), { center: cen, sw: pxw(S, 0.012, Z), spec: 0.1 }));
    for (const aa of [a0, a1]) pr.push(...face(S, [q(aa, r, 0), q(aa, R, 0), q(aa, R, yb), q(aa, r, yb)], dark(c, 0.15), { center: cen, ink: false }));
    pr.push(...face(S, [q(a0, R, yb), q(a1, R, yb), q(a1, r, yb), q(a0, r, yb)], c, { center: cen, sw: pxw(S, 0.012, Z), spec: 0.2 }));
    S.item(Math.min(q(a0, R, 0)[2], q(a1, R, 0)[2]), pr, { name: 'pit_curb', pmat: 'stone' });
  }
});
/** Люк: {X, Z, r}. */
reg('manhole', (S, d) => {
  const { X, Z } = d, r = d.r ?? 0.4, prims = [];
  prims.push(disc(S, X, 0.004, Z, r * 1.08, r * 1.08, '#3e3434', { base: true, spec: 0.4, ink: true }));
  prims.push(disc(S, X, 0.006, Z, r, r, '#5a4c48', { spec: 0.6 }));
  for (const k of [0.75, 0.5, 0.25]) prims.push(disc(S, X, 0.007, Z, r * k, r * k, k === 0.5 ? '#3e3434' : '#6a5a54', { spec: 0.6, op: 0.9 }));
  for (let i = -3; i <= 3; i++) prims.push(S.line([X + i * r * 0.22, 0.008, Z - r * 0.85], [X + i * r * 0.22, 0.008, Z + r * 0.85], '#2e2626', pxw(S, 0.025, Z)));
  S.item(d.key ?? Z + r, prims, { name: 'manhole' });
});
/** Решётка стока: {X, Z, w, d}. */
reg('grate', (S, d) => {
  const { X, Z } = d, w = d.w ?? 0.6, dd = d.d ?? 0.35, prims = [];
  prims.push({ t: 'poly', ps: [[X - w / 2, 0.004, Z - dd / 2], [X + w / 2, 0.004, Z - dd / 2], [X + w / 2, 0.004, Z + dd / 2], [X - w / 2, 0.004, Z + dd / 2]], alb: '#4a3e3c', n: [0, 1, 0], pl: [0, 1, 0, 0.004], base: true, ink: true, spec: 0.5, op: 1 });
  for (let i = 1; i < 8; i++) { const x = X - w / 2 + (w * i) / 8; prims.push({ t: 'poly', ps: [[x - 0.012, 0.006, Z - dd * 0.42], [x + 0.012, 0.006, Z - dd * 0.42], [x + 0.012, 0.006, Z + dd * 0.42], [x - 0.012, 0.006, Z + dd * 0.42]], alb: '#140e0e', n: [0, 1, 0], pl: [0, 1, 0, 0.006], bump: true, ink: false, spec: 0, op: 1 }); }
  S.item(d.key ?? Z + dd, prims, { name: 'grate' });
});
/** Лужа: {X, Z, rx, rz, color}. */
reg('puddle', (S, d) => {
  const prims = [disc(S, d.X, 0.005, d.Z, d.rx, d.rz ?? d.rx * 0.45, d.color || '#5a5a78', { spec: 1, wob: true, op: 0.9, base: true, n: 28 })];
  S.item(d.key ?? d.Z + 1, prims, { name: 'puddle' });
});
/** Рассыпь листьев и бумажек по земле: {x:[a,b], z:[a,b], n, colors, paper}. */
reg('litter', (S, d) => {
  const prims = [];
  for (let i = 0; i < (d.n ?? 30); i++) {
    const X = d.x[0] + rnd() * (d.x[1] - d.x[0]), Z = d.z[0] + rnd() * (d.z[1] - d.z[0]);
    const s = (d.s ?? 0.07) * (0.7 + rnd() * 0.6), a = rnd() * TAU, c = (d.colors || ['#e8a030', '#d07028', '#f0c040'])[Math.floor(rnd() * 3)];
    const ps = [0, 1, 2, 3].map((k) => { const t = a + (k * TAU) / 4, rr = k % 2 ? s * 0.45 : s; return [X + Math.cos(t) * rr, 0.006, Z + Math.sin(t) * rr]; });
    prims.push({ t: 'poly', ps, alb: c, n: [0.1, 1, 0], pl: [0, 1, 0, 0.006], bump: true, ink: false, spec: 0.2, op: 1 });
  }
  for (const [X, Z, w, h, a, c] of d.paper || []) {
    const ca = Math.cos(a), sa = Math.sin(a), q = (u, v) => [X + u * ca - v * sa, 0.007, Z + u * sa + v * ca];
    prims.push({ t: 'poly', ps: [q(-w / 2, -h / 2), q(w / 2, -h / 2), q(w / 2, h / 2), q(-w / 2, h / 2)], alb: c || '#f0e6e0', n: [0, 1, 0], pl: [0, 1, 0, 0.007], bump: true, ink: true, sw: 1, spec: 0.1, op: 1 });
  }
  S.item(d.key ?? 9e5, prims, { name: 'litter' });
});

/* ---------- фонтан ---------- */
/** Фонтан с чашей, колонной, верхней чашей, струями и кувшинками: {X, Z, R}. */
reg('fountain2', (S, d) => {
  const { X, Z } = d, R = d.R ?? 1.36, c = d.color || '#c8b294', wtr = '#3a74b4';
  const k = R / 1.36;
  const sc = (p) => p.map(([r, y, f]) => [r * k, y, f]);
  latheStack(S, X, Z, [
    { prof: sc([[1.32, 0, 'c'], [1.32, 0.06, 'c'], [1.25, 0.1, 'c'], [1.25, 0.58, 'c'], [1.37, 0.62, 'c'], [1.37, 0.74, 'c'], [1.2, 0.74, 'c'], [1.2, 0.4, 'c']]), color: c, fill: { y: 0.62, r: 1.2 * k, color: wtr, spec: 1 }, n: 32 },
    { prof: [[0.44, 0.62, 'c'], [0.44, 0.74, 'c'], [0.32, 0.8], [0.26, 1.0], [0.23, 1.5], [0.27, 1.62, 'c'], [0.36, 1.7, 'c'], [0.36, 1.74, 'c']], color: c, top: false },
    { prof: [[0.14, 1.72, 'c'], [0.3, 1.78], [0.58, 1.9], [0.72, 1.98, 'c'], [0.72, 2.06, 'c'], [0.62, 2.06, 'c'], [0.62, 1.98, 'c']], color: c, fill: { y: 2.03, r: 0.62, color: wtr, spec: 1 }, n: 24 },
    { prof: [[0.12, 2.0, 'c'], [0.12, 2.15], [0.2, 2.22, 'c'], [0.2, 2.28, 'c'], [0.1, 2.33], [0.08, 2.5], [0.14, 2.56, 'c'], [0.03, 2.76, 'c'], [0, 2.76, 'c']], color: '#3a5a7a', spec: 0.6 },
  ], { key: d.key ?? Z - R, name: 'fountain' });
  // герб на чаше спереди: корона в венке
  const fz = Z - 1.27 * k, fr = S.frame([X - 0.3, 0.12, fz - 0.03], [1, 0, 0], [0, 1, 0], 0.6, 0.46, [0, 0, -1]), em = [];
  const gold = '#e0a830';
  const ringP = (rr, n = 20) => { const out = []; for (let i = 0; i < n; i++) { const t = (i / n) * TAU; out.push(fr.at(0.3 + Math.cos(t) * rr, 0.23 + Math.sin(t) * rr)); } return out; };
  em.push({ t: 'poly', ps: ringP(0.2), alb: '#7a6248', n: [0, 0, -1], pl: fr.pl, bump: true, ink: true, sw: S.sw(fz) * 0.7, spec: 0.2, op: 1 });
  em.push({ t: 'poly', ps: ringP(0.17), alb: '#5a4636', n: [0, 0, -1], pl: fr.pl, bump: true, spec: 0.2, op: 1 });
  em.push(S.det(fr, [fr.at(0.19, 0.15), fr.at(0.41, 0.15), fr.at(0.43, 0.3), fr.at(0.36, 0.22), fr.at(0.3, 0.33), fr.at(0.24, 0.22), fr.at(0.17, 0.3)], gold, { spec: 0.9, ink: true, sw: S.sw(fz) * 0.5, n: [0, 0.3, -1] }));
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) { const t = -1.1 + i * 0.45; em.push(S.det(fr, [fr.at(0.3 + s * 0.2 * Math.cos(t), 0.23 + 0.2 * Math.sin(t)), fr.at(0.3 + s * 0.26 * Math.cos(t + 0.15), 0.23 + 0.26 * Math.sin(t + 0.15)), fr.at(0.3 + s * 0.21 * Math.cos(t + 0.3), 0.23 + 0.21 * Math.sin(t + 0.3))], gold, { spec: 0.8, n: [s * 0.3, 0.2, -1] })); }
  // резные панели по кругу
  const pan = [];
  for (let i = 0; i < 14; i++) {
    const a = Math.PI * 1.5 + ((i - 6.5) / 14) * Math.PI * 1.25, rr = 1.255 * k;
    if (Math.abs(a - Math.PI * 1.5) < 0.18) continue;
    const q = (aa, y) => [X + Math.cos(aa) * rr, y, Z + Math.sin(aa) * rr];
    const da = 0.09;
    const n = [Math.cos(a), 0, Math.sin(a)];
    pan.push({ t: 'poly', ps: [q(a - da, 0.18), q(a + da, 0.18), q(a + da, 0.5), q(a, 0.54), q(a - da, 0.5)], alb: dark(c, 0.14), n: norm(add(n, [0, -0.3, 0])), pl: [...n, dot(n, q(a, 0.3))], bump: true, ink: true, sw: S.sw(Z) * 0.4, spec: 0.1, op: 0.9 });
  }
  S.item(Z - R - 0.02, [...pan, ...em], { name: 'fountain_relief' });
  // струи: с верхней чаши в нижнюю, и из навершия
  const st = [], wcol = '#cfe8ff';
  for (let i = 0; i < 22; i++) {
    const a = Math.PI * 1.5 + ((i - 10.5) / 22) * Math.PI * 1.7 + (rnd() - 0.5) * 0.05;
    let prev = null;
    for (let s = 0; s <= 10; s++) {
      const t = s / 10, rr = 0.72 + t * (0.28 + rnd() * 0.04), y = 2.0 - t * t * 1.36;
      const p = [X + Math.cos(a) * rr, y, Z + Math.sin(a) * rr];
      if (prev) { st.push(S.line(prev, p, '#4f7fb8', pxw(S, 0.034 + t * 0.016, Z), { op: 0.45 })); st.push(S.line(prev, p, i % 3 ? wcol : '#ffffff', pxw(S, 0.016 + t * 0.01, Z), { op: 0.9 })); }
      prev = p;
    }
  }
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; let prev = [X, 2.76, Z]; for (let s = 1; s <= 6; s++) { const t = s / 6, p = [X + Math.cos(a) * 0.22 * t, 2.78 + 0.1 * Math.sin(t * Math.PI) - t * 0.75, Z + Math.sin(a) * 0.22 * t]; st.push(S.line(prev, p, wcol, pxw(S, 0.014, Z), { op: 0.6 })); prev = p; } }
  // всплески и рябь на воде
  for (let i = 0; i < 26; i++) { const a = Math.PI * 1.5 + ((i - 13) / 26) * Math.PI * 1.8, rr = 0.98 + rnd() * 0.06; const p = [X + Math.cos(a) * rr, 0.63, Z + Math.sin(a) * rr]; st.push(S.line(p, [p[0], 0.7 + rnd() * 0.06, p[2]], '#f4fbff', pxw(S, 0.02, Z), { op: 0.7 })); }
  S.item(Z - R - 0.05, st, { name: 'fountain_water' });
  // кувшинки
  const lp = [];
  for (const [aa, rr, fl] of [[3.4, 0.95, 1], [4.0, 1.0, 0], [4.9, 0.95, 1], [5.6, 0.9, 0], [2.7, 0.85, 0], [3.0, 1.05, 1]]) {
    const px = X + Math.cos(aa) * rr * k, pz = Z + Math.sin(aa) * rr * k;
    lp.push(disc(S, px, 0.625, pz, 0.15, 0.15, jit('#4a8a3a', 0.1), { base: true, spec: 0.3, ink: true }));
    if (fl) lp.push(...sphere(S, px + 0.03, 0.67, pz - 0.02, 0.055, '#f0a0c0', { prims: true, spec: 0.3, ink: true }));
  }
  S.item(Z - R + 0.3, lp, { name: 'lilies' });
});
/** Площадка-мозаика вокруг фонтана со встроенными огнями: {X, Z, R, n}. */
reg('mosaic', (S, d) => {
  const { X, Z } = d, R = d.R ?? 2.2, prims = [];
  prims.push(disc(S, X, 0.004, Z, R, R, '#6a6070', { base: true, spec: 0.35, n: 64 }));
  prims.push(disc(S, X, 0.005, Z, R - 0.12, R - 0.12, '#4a4660', { spec: 0.4, n: 64 }));
  prims.push(disc(S, X, 0.006, Z, R - 0.6, R - 0.6, '#5a5470', { spec: 0.35, n: 64 }));
  const n = d.n ?? 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + 0.12, p = [X + Math.cos(a) * (R - 0.32), 0.008, Z + Math.sin(a) * (R - 0.32)];
    prims.push(disc(S, p[0], p[1], p[2], 0.1, 0.1, '#4a3a2a', { spec: 0.6 }));
    prims.push(disc(S, p[0], 0.009, p[2], 0.07, 0.07, '#fff0b8', { em: '#ffd070', spec: 0.6 }));
    if (Math.sin(a) < 0.3) S.light([p[0], 0.15, p[2]], '#ffb860', 1.1, 0.5, 'lamp');
  }
  S.item(d.key ?? Z + R, prims, { name: 'mosaic' });
});

/* ---------- вывески, плакаты, маркиза вдоль Z ---------- */
/** Вывеска-панель на грани F: {on:F(рамка {o,u,v,n}), a, b, w, h, text, color, textColor, border, size, d}. */
reg('signboard', (S, d) => {
  const F = d.on, fr = frOf(S, F), prims = [], dd = d.d ?? 0.05;
  const off = (p, t) => add(p, mul(F.n, t));
  const r = (m, t) => [off(fr.at(d.a + m, d.b + m), t), off(fr.at(d.a + d.w - m, d.b + m), t), off(fr.at(d.a + d.w - m, d.b + d.h - m), t), off(fr.at(d.a + m, d.b + d.h - m), t)];
  const outer = r(0, dd), cen = off(fr.at(d.a + d.w / 2, d.b + d.h / 2), 0);
  prims.push(...face(S, outer, d.border || '#7a4a28', { center: cen, spec: 0.3, sw: pxw(S, 0.02, outer[0][2]) }));
  // торцы
  const o0 = r(0, 0);
  for (let i = 0; i < 4; i++) prims.push(...face(S, [o0[i], o0[(i + 1) % 4], outer[(i + 1) % 4], outer[i]], dark(d.border || '#7a4a28', 0.15), { center: cen }));
  const ifr = S.frame(off(fr.at(d.a, d.b), dd + 0.004), F.u, F.v, d.w, d.h, F.n);
  const m = d.m ?? 0.07;
  prims.push(S.det(ifr, ifr.rect(m, m, d.w - 2 * m, d.h - 2 * m), d.color || '#f4ead0', { ink: true, sw: pxw(S, 0.012, outer[0][2]), spec: 0.2 }));
  if (d.text) prims.push(textPrim(S, ifr, d.w / 2, d.h / 2 - (d.size ?? d.h * 0.55) * 0.36, d.text, d.size ?? d.h * 0.55, d.textColor || '#b8302a', { font: d.font || 'Impact, Arial Black, sans-serif', weight: d.weight || 'bold', spacing: d.spacing, em: d.em }));
  S.item(d.key ?? Math.min(...outer.map((p) => p[2])) - 0.01, prims, { name: 'signboard' });
  if (d.light) S.light(off(fr.at(d.a + d.w / 2, d.b + d.h / 2), 0.6), '#ffc070', d.light, 0.5, 'lamp');
});
/** Плакат/картина на грани: {on:F, a, b, w, h, color, art:'violin'|'apple'|'grapes'|'text'|'note', text}. */
reg('poster', (S, d) => {
  const F = d.on, fr0 = frOf(S, F), prims = [];
  const fr = S.frame(add(fr0.at(d.a, d.b), mul(F.n, 0.01)), F.u, F.v, d.w, d.h, F.n);
  const z = Math.min(fr.at(0, 0)[2], fr.at(d.w, 0)[2]);
  const sw = pxw(S, 0.012, z), W = d.w, H = d.h;
  prims.push(S.det(fr, fr.rect(0, 0, W, H), d.frame || '#e8dcc0', { ink: true, sw, spec: 0.15 }));
  prims.push(S.det(fr, fr.rect(W * 0.08, H * 0.06, W * 0.84, H * 0.88), d.color || '#f4eedd', { spec: 0.1 }));
  const art = d.art;
  if (art === 'violin') {
    const vc = '#a0522a';
    const body = []; for (let i = 0; i < 20; i++) { const t = (i / 20) * TAU; const rr = 0.16 + 0.05 * Math.cos(2 * t); body.push(fr.at(W * 0.5 + Math.cos(t) * W * rr, H * 0.38 + Math.sin(t) * H * 0.2 * (1 + 0.2 * Math.sin(t)))); }
    prims.push(S.det(fr, body, vc, { ink: true, sw, spec: 0.5 }));
    prims.push(S.det(fr, fr.rect(W * 0.48, H * 0.5, W * 0.04, H * 0.35), '#3a2418', { ink: true, sw: sw * 0.6 }));
  } else if (art === 'apple' || art === 'grapes') {
    const cc = art === 'apple' ? '#7ab040' : '#8a4aa8';
    if (art === 'apple') { const ps = []; for (let i = 0; i < 18; i++) { const t = (i / 18) * TAU; ps.push(fr.at(W * 0.5 + Math.cos(t) * W * 0.28, H * 0.45 + Math.sin(t) * H * 0.2)); } prims.push(S.det(fr, ps, cc, { ink: true, sw, spec: 0.4 })); }
    else for (let r = 0; r < 4; r++) for (let i = 0; i <= 3 - r; i++) { const ps = []; for (let k = 0; k < 10; k++) { const t = (k / 10) * TAU; ps.push(fr.at(W * (0.32 + i * 0.12 + r * 0.06) + Math.cos(t) * W * 0.07, H * (0.6 - r * 0.1) + Math.sin(t) * H * 0.05)); } prims.push(S.det(fr, ps, cc, { ink: true, sw: sw * 0.7, spec: 0.4 })); }
    prims.push(S.det(fr, fr.rect(W * 0.2, H * 0.12, W * 0.6, H * 0.06), '#5a4a3a'));
  } else if (art === 'note' || art === 'text') {
    for (let i = 0; i < 5; i++) prims.push(S.det(fr, fr.rect(W * 0.18, H * (0.2 + i * 0.13), W * (0.4 + rnd() * 0.25), H * 0.04), '#6a5a4a', { op: 0.8 }));
    if (art === 'note') prims.push(S.det(fr, fr.rect(W * 0.18, H * 0.8, W * 0.64, H * 0.08), '#c04030'));
  }
  if (d.text) prims.push(textPrim(S, fr, W / 2, H * 0.78, d.text, d.size ?? H * 0.12, '#3a2a2a', { font: 'Georgia, serif' }));
  S.item(d.key ?? z - 0.012, prims, { name: 'poster' });
});
/** Маркиза на стене X = const (смотрит в -X): {X, z:[z0,z1], y, depth, drop, colors}. */
reg('awningX', (S, d) => {
  const X = d.X, [z0, z1] = d.z, y1 = d.y, dep = d.depth ?? 0.8, drop = d.drop ?? 0.4, cols = d.colors || ['#d8403a', '#f4ece0'], st = d.stripe ?? 0.22;
  const xf = X - dep, yf = y1 - drop, prims = [];
  const n0 = norm(cross(sub([X, y1, z1], [X, y1, z0]), sub([xf, yf, z0], [X, y1, z0])));
  const n = n0[1] < 0 ? mul(n0, -1) : n0, pl = [...n, dot(n, [X, y1, z0])];
  const k = Math.max(1, Math.round((z1 - z0) / st));
  for (let i = 0; i < k; i++) {
    const a = z0 + ((z1 - z0) * i) / k, b = z0 + ((z1 - z0) * (i + 1)) / k;
    prims.push({ ...S.base([[X, y1, a], [X, y1, b], [xf, yf, b], [xf, yf, a]], cols[i % 2], n, pl, { ink: false, spec: 0.15 }) });
    const vh = 0.2, ps = [[xf, yf, a], [xf, yf, b], [xf, yf - vh, b]];
    for (let j = 1; j < 8; j++) { const t = j / 8; ps.push([xf, yf - vh - Math.sin(t * Math.PI) * 0.12, b - (b - a) * t]); }
    ps.push([xf, yf - vh, a]);
    prims.push(S.base(ps, dark(cols[i % 2], 0.06), [-1, 0, 0], [-1, 0, 0, -xf], { ink: false, spec: 0.1 }));
  }
  prims.push(S.line([xf, yf, z0], [xf, yf, z1], '#5a2020', pxw(S, 0.02, z0), { ink: true }));
  S.item(d.key ?? z0 - 0.02, prims, { name: 'awning' });
});
/** Связки (бананы, лаванда): {pts:[[X,Y,Z]…], kind:'banana'|'lavender'}. */
reg('bunches', (S, d) => {
  const prims = [];
  for (const [X, Y, Z] of d.pts) {
    if (d.kind === 'lavender') {
      prims.push(S.line([X, Y, Z], [X, Y - 0.12, Z], '#5a6a3a', pxw(S, 0.02, Z)));
      for (let i = 0; i < 7; i++) { const a = (i - 3) * 0.08; prims.push(S.line([X + a * 0.3, Y - 0.1, Z], [X + a, Y - 0.45 - rnd() * 0.1, Z - 0.02], i % 2 ? '#8a6ac0' : '#a080d0', pxw(S, 0.035, Z), { ink: false })); }
    } else {
      prims.push(S.line([X, Y, Z], [X, Y - 0.08, Z], '#5a4a2a', pxw(S, 0.02, Z)));
      for (let i = 0; i < 5; i++) {
        const a = (i - 2) * 0.05, ps = [];
        for (let k = 0; k <= 6; k++) { const t = k / 6; ps.push([X + a + Math.sin(t * 2) * 0.06 * Math.sign(a || 1), Y - 0.08 - t * 0.28, Z - 0.03]); }
        for (let k = 6; k >= 0; k--) { const t = k / 6; ps.push([X + a + Math.sin(t * 2) * 0.06 * Math.sign(a || 1) + 0.04, Y - 0.1 - t * 0.26, Z - 0.03]); }
        prims.push({ t: 'poly', ps, alb: jit('#f2cc30', 0.08), n: [0, 0, -1], pl: [0, 0, -1, -(Z - 0.03)], base: true, ink: true, sw: pxw(S, 0.008, Z), spec: 0.4, op: 1 });
      }
    }
  }
  S.item(d.key ?? Math.min(...d.pts.map((p) => p[2])) - 0.1, prims, { name: d.kind || 'bunch' });
});
/** Шест: {X, Z, h, r, color}. */
reg('pole', (S, d) => cyl(S, d.X, d.Z, d.r ?? 0.05, 0, d.h ?? 6, d.color || '#d8a030', { key: d.key ?? d.Z - 0.1, spec: 0.8, n: 10, name: 'pole' }));
/** Подушки/плед на скамье: фронтальные округлые формы {pts:[[X,Y,Z,w,h,color]…]}. */
reg('cushions', (S, d) => {
  const prims = [];
  for (const [X, Y, Z, w, h, c] of d.pts) {
    const ps = []; for (let i = 0; i < 16; i++) { const t = (i / 16) * TAU; ps.push([X + Math.cos(t) * w / 2 * (1 + 0.1 * Math.cos(4 * t)), Y + h / 2 + Math.sin(t) * h / 2, Z]); }
    prims.push({ t: 'poly', ps, alb: c, n: [0, 0, -1], pl: [0, 0, -1, -Z], base: true, ink: true, sw: S.sw(Z) * 0.6, spec: 0.15, op: 1, ng: { kind: 'sphere', c: S.P([X, Y + h / 2, Z]), r: [w / 2 * S.pxPerUnit(Z), h / 2 * S.pxPerUnit(Z)], flat: 0.3 } });
  }
  S.item(d.key ?? Math.min(...d.pts.map((p) => p[2])) - 0.01, prims, { name: 'cushions' });
});
/** Кирпичная заплатка на штукатурке: {on:F, a, b, w, h}. */
reg('brickPatch', (S, d) => {
  const fr0 = frOf(S, d.on), prims = [];
  const fr = S.frame(add(fr0.at(d.a, d.b), mul(d.on.n, 0.006)), d.on.u, d.on.v, d.w, d.h, d.on.n);
  const ring = []; for (let k = 0; k < 14; k++) { const t = (k / 14) * TAU; ring.push(fr.at(d.w / 2 + Math.cos(t) * d.w * (0.42 + rnd() * 0.08), d.h / 2 + Math.sin(t) * d.h * (0.42 + rnd() * 0.08))); }
  prims.push(S.det(fr, ring, '#7a4a3a', { ink: true, sw: 1.2 }));
  for (let r = 0, b = d.h * 0.12; b < d.h * 0.85; b += 0.11, r++) for (let a = d.w * 0.12 + (r % 2) * 0.1; a < d.w * 0.85; a += 0.22) {
    const dx = (a - d.w / 2) / (d.w * 0.4), dy = (b - d.h / 2) / (d.h * 0.4);
    if (dx * dx + dy * dy > 0.9) continue;
    prims.push(S.det(fr, fr.rect(a, b, 0.19, 0.08), jit('#b8604a', 0.12), { n: fr.tilt(0, 0.3, 0.5) }));
  }
  const z = Math.min(fr.at(0, 0)[2], fr.at(d.w, 0)[2]);
  S.item(d.key ?? z - 0.011, prims, { name: 'bricks', force: true });
});

/** Земля без окклюдера: плоскость не затеняет сама себя (8-битная нормаль прохода plane опускает восстановленную точку под пол). */
registerWorldItem('flatGround', { doc: 'земля без тени на себя', build: (S, d) => {
  const c = d.color, y = d.y ?? 0, [x0, x1] = d.x, [z0, z1] = d.z;
  const fr = (n) => S.frame([x0, y, z0], [1, 0, 0], [0, 0, 1], x1 - x0, z1 - z0, n);
  S.item(d.key ?? 1e6, face(S, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], c, { mat: d.mat ?? false, matCol: c, frame: fr, matOpt: { maxZ: d.maxZ ?? 26 }, ink: false, spec: d.spec ?? 0.25, occ: false }), { name: 'ground', pmat: d.pmat });
} });
