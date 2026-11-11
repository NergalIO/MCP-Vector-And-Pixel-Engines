// Свои предметы для examples/ref/stairs.build.mjs (площадь с лестницами): зонт кафе, столики, тележка с колесом,
// урна, тумба, указатель со стрелками, доска объявлений, классики, утка, чемодан, ступенчатый парапет с огнями.
// Плюс предметы plaza.props.mjs (фонари, флажки, гирлянды, ящики, горшки, перила, плакаты, вывески).
import './plaza.props.mjs';
import { obox } from './plaza.props.mjs';
import { registerWorldItem, face, box, cyl, lathe, latheStack, sphere, disc, PROFILES, textPrim, dark, lite, jit, rnd, norm, sub, add, mul, dot } from '../../engine/world3d.js';

const TAU = Math.PI * 2;
const reg = (type, build) => registerWorldItem(type, { doc: type, build });
const pxw = (S, t, Z) => Math.max(0.6, t * S.pxPerUnit(Z));

/** Зонт кафе: {X, Z, Y, r, h, colors, n} — шест, восьмигранный купол долями двух цветов, фестоны. */
reg('umbrella', (S, d) => {
  const { X, Z } = d, Y = d.Y ?? 0, r = d.r ?? 1.1, h = d.h ?? 2.2, n = d.n ?? 8, cols = d.colors || ['#2a9a98', '#f4ece0'];
  const prims = [], top = [X, Y + h + 0.32, Z], rimY = Y + h;
  cyl(S, X, Z, 0.025, Y, Y + h + 0.36, '#d8d0c4', { key: Z - 0.05, n: 8, spec: 0.6, name: 'umb_pole' });
  const rim = (i) => { const a = (i / n) * TAU + Math.PI / n; return [X + Math.cos(a) * r, rimY, Z + Math.sin(a) * r]; };
  for (let i = 0; i < n; i++) {
    const a = rim(i), b = rim(i + 1), c = cols[i % cols.length];
    prims.push(...face(S, [a, b, top], c, { center: [X, rimY - 0.4, Z], spec: 0.2, sw: pxw(S, 0.012, Z) }));
    // фестон доли
    const m = [(a[0] + b[0]) / 2, rimY - 0.14, (a[2] + b[2]) / 2];
    prims.push(...face(S, [a, b, m], dark(c, 0.08), { center: [X, rimY, Z], spec: 0.1, sw: pxw(S, 0.01, Z) }));
  }
  prims.push(...sphere(S, top[0], top[1] + 0.04, top[2], 0.05, '#d8d0c4', { prims: true, spec: 0.6 }));
  S.item(d.key ?? Z - r - 0.05, prims, { name: 'umbrella' });
});

/** Столик кафе: {X, Z, Y, r, h, color} — круглая столешница на одной ножке. */
reg('cafeTable', (S, d) => {
  const { X, Z } = d, Y = d.Y ?? 0, r = d.r ?? 0.4, h = d.h ?? 0.74, c = d.color || '#7a4a2a';
  latheStack(S, X, Z, [
    { prof: [[0.2, 0, 'c'], [0.2, 0.03, 'c'], [0.04, 0.05, 'c'], [0.035, h - 0.04, 'c']], color: '#2c2428', y0: Y, spec: 0.5 },
    { prof: [[r, h - 0.04, 'c'], [r, h, 'c'], [0, h, 'c']], color: c, y0: Y, spec: 0.3, top: lite(c, 0.12) },
  ], { key: d.key ?? Z - r, name: 'cafe_table' });
});
/** Табурет/стул кафе: {X, Z, Y, r, h, color}. */
reg('stool', (S, d) => {
  const { X, Z } = d, Y = d.Y ?? 0, r = d.r ?? 0.17, h = d.h ?? 0.46, c = d.color || '#2a6a6a', prims = [];
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) prims.push(S.line([X + a * r * 0.75, Y, Z + b * r * 0.75], [X + a * r * 0.55, Y + h - 0.04, Z + b * r * 0.55], d.legs || '#2c2428', pxw(S, 0.026, Z), { ink: false }));
  S.item((d.key ?? Z - r) + 0.01, prims, { name: 'stool_legs' });
  latheStack(S, X, Z, [{ prof: [[r, h - 0.05, 'c'], [r, h, 'c'], [0, h, 'c']], color: c, y0: Y, spec: 0.35, top: lite(c, 0.15) }], { key: d.key ?? Z - r, name: 'stool' });
  if (d.back) obox(S, { o: [X - r, Z + r * 0.8], len: 2 * r, wid: 0.04, y: [Y + h, Y + h + 0.4], color: c });
});

/** Тележка торговца: {X, Z, len, wid, h, color, cloth} — кузов, колесо со спицами, оглобли, ткань на борту. */
reg('cart', (S, d) => {
  const { X, Z } = d, L = d.len ?? 2.0, Wd = d.wid ?? 0.8, y0 = d.y0 ?? 0.45, hb = d.h ?? 0.38, c = d.color || '#8a5a32', prims = [];
  obox(S, { o: [X, Z], len: L, wid: Wd, y: [y0, y0 + hb], color: c, top: dark(c, 0.3), side: dark(c, 0.1), pmat: 'wood' });
  // полка-надстройка и стойки
  if (d.shelf !== false) {
    obox(S, { o: [X + L - 0.95, Z + 0.15], len: 0.85, wid: 0.45, y: [y0 + hb, y0 + hb + 0.03], color: lite(c, 0.05) });
    obox(S, { o: [X + L - 0.95, Z + 0.15], len: 0.85, wid: 0.45, y: [y0 + hb + 0.34, y0 + hb + 0.37], color: lite(c, 0.05) });
    for (const a of [L - 0.93, L - 0.14]) obox(S, { o: [X + a, Z + 0.17], len: 0.05, wid: 0.05, y: [y0 + hb, y0 + hb + 0.6], color: dark(c, 0.15) });
  }
  // доски кузова
  const zf = Z - 0.004, sw = pxw(S, 0.012, Z);
  for (const k of [1, 2]) prims.push(S.line([X, y0 + (hb * k) / 3, zf], [X + L, y0 + (hb * k) / 3, zf], dark(c, 0.4), sw));
  // колесо (переднее, у левого края) — кольцо, обод, спицы
  const wr = d.wheel ?? 0.45, wc = [X + 0.62, wr, Z - 0.06], ring = (rr, k = 28) => { const ps = []; for (let i = 0; i < k; i++) { const t = (i / k) * TAU; ps.push([wc[0] + Math.cos(t) * rr, wc[1] + Math.sin(t) * rr, wc[2]]); } return ps; };
  const wood = '#7a4a26', zw = wc[2];
  prims.push({ t: 'poly', ps: ring(wr), holes: [ring(wr * 0.8).reverse()], alb: wood, n: [0, 0, -1], pl: [0, 0, -1, -zw], base: true, ink: true, sw: pxw(S, 0.015, zw), spec: 0.3, op: 1 });
  for (let i = 0; i < 10; i++) { const t = (i / 10) * TAU; prims.push(S.line([wc[0] + Math.cos(t) * wr * 0.12, wc[1] + Math.sin(t) * wr * 0.12, zw - 0.005], [wc[0] + Math.cos(t) * wr * 0.82, wc[1] + Math.sin(t) * wr * 0.82, zw - 0.005], wood, pxw(S, 0.03, zw), { ink: true })); }
  prims.push(...sphere(S, wc[0], wc[1], zw - 0.03, wr * 0.13, dark(wood, 0.2), { prims: true, spec: 0.5 }));
  // ткань, свисающая с борта
  if (d.cloth) {
    const [a, w] = d.clothAt || [0.65, 0.6], cc = d.cloth, y1 = y0 + hb + 0.05, y2 = y0 - 0.12, zc = Z - 0.02;
    const ps = [[X + a, y1, zc], [X + a + w, y1, zc], [X + a + w + 0.04, y2, zc]];
    for (let k = 1; k < 6; k++) ps.push([X + a + w - (w * k) / 6 + 0.02, y2 - Math.sin(k * 1.3) * 0.04, zc]);
    ps.push([X + a - 0.03, y2 + 0.02, zc]);
    prims.push({ t: 'poly', ps, alb: cc, n: [0, 0.05, -1], pl: [0, 0, -1, -zc], base: true, ink: true, sw, spec: 0.15, op: 1 });
    for (let k = 0; k < 3; k++) prims.push(S.line([X + a + 0.05, y1 - 0.08 - k * 0.14, zc - 0.003], [X + a + w - 0.05, y1 - 0.08 - k * 0.14, zc - 0.003], lite(cc, 0.35), pxw(S, 0.012, zc)));
    for (let k = 0; k < 4; k++) { const q = X + a + 0.1 + (k * (w - 0.2)) / 3; prims.push(S.line([q, y1 - 0.06, zc - 0.003], [q, y2 + 0.06, zc - 0.003], dark(cc, 0.25), pxw(S, 0.01, zc))); }
  }
  S.item(d.key ?? Z - 0.1, prims, { name: 'cart' });
});

/** Урна для раздельного сбора: {X, Z, r, h, color} — цилиндр, крышка, белый значок. */
reg('bin', (S, d) => {
  const { X, Z } = d, r = d.r ?? 0.24, h = d.h ?? 1.0, c = d.color || '#2a7a78';
  latheStack(S, X, Z, [
    { prof: [[r * 0.9, 0, 'c'], [r * 0.95, 0.04, 'c'], [r, h - 0.12, 'c'], [r * 1.06, h - 0.1, 'c'], [r * 1.06, h - 0.04, 'c']], color: c, spec: 0.4, top: false },
    { prof: [[r * 1.04, h - 0.04, 'c'], [r * 0.8, h, 'c'], [0, h + 0.02, 'c']], color: dark(c, 0.15), spec: 0.4 },
  ], { key: d.key ?? Z - r, name: 'bin' });
  // значок переработки: три стрелки по кругу
  const zc = Z - r - 0.005, cy = h * 0.55, prims = [], sw = pxw(S, 0.025, zc);
  for (let k = 0; k < 3; k++) {
    const t0 = (k / 3) * TAU + 0.35, t1 = t0 + 1.5, R = 0.09;
    const p0 = [X + Math.cos(t0) * R, cy + Math.sin(t0) * R, zc], p1 = [X + Math.cos(t1) * R, cy + Math.sin(t1) * R, zc];
    prims.push(S.line(p0, p1, '#f4f2ea', sw));
    prims.push({ t: 'poly', ps: [add(p1, [Math.cos(t1 + 1.9) * 0.04, Math.sin(t1 + 1.9) * 0.04, 0]), add(p1, [Math.cos(t1 - 1.0) * 0.045, Math.sin(t1 - 1.0) * 0.045, 0]), add(p1, [Math.cos(t1 + 0.4) * 0.05, Math.sin(t1 + 0.4) * 0.05, 0])], alb: '#f4f2ea', n: [0, 0, -1], pl: [0, 0, -1, -zc], bump: false, base: true, ink: false, spec: 0.2, op: 1 });
  }
  S.item(zc - 0.01, prims, { name: 'bin_logo' });
});
/** Тумба-столбик: {X, Z, r, h, color, band}. */
reg('bollard', (S, d) => {
  const { X, Z } = d, r = d.r ?? 0.17, h = d.h ?? 0.75, c = d.color || '#3a3a40';
  latheStack(S, X, Z, [
    { prof: [[r, 0, 'c'], [r, h - 0.1, 'c']], color: c, spec: 0.4, top: false },
    { prof: [[r, h - 0.1, 'c'], [r, h - 0.06, 'c']], color: d.band || '#c8a040', spec: 0.6, top: false },
    { prof: [[r, h - 0.06, 'c'], [r * 0.95, h, 'c'], [0, h + 0.01, 'c']], color: lite(c, 0.1), spec: 0.5 },
  ], { key: d.key ?? Z - r, name: 'bollard' });
});

/**
 * Труба на скате: {x:[x0,x1], z:[z0,z1], roof:[ez, ey, rz, ry] — линия ската (карниз → конёк), up — высота над скатом,
 * color, cap, pot — глиняный колпак-горшок (иначе плоская плита)}. Низ боковых граней идёт по скату, а не горизонтально,
 * у основания — фартук-оклад; тело и колпак отбрасывают тень на черепицу.
 */
reg('roofChimney', (S, d) => {
  const [x0, x1] = d.x, [z0, z1] = d.z, [ez, ey, rz, ry] = d.roof, yR = (z) => ey + ((z - ez) / (rz - ez)) * (ry - ey);
  const top = yR(z0) + (d.up ?? 0.9), c = d.color || '#d09a84', cap = d.cap || '#8a5a50', prims = [];
  const cen = [(x0 + x1) / 2, (yR(z0) + top) / 2, (z0 + z1) / 2], f = (ps, cc, o = {}) => prims.push(...face(S, ps, cc, { center: cen, spec: 0.1, ...o }));
  f([[x0, yR(z0) - 0.03, z0], [x1, yR(z0) - 0.03, z0], [x1, top, z0], [x0, top, z0]], c);
  for (const x of [x0, x1]) f([[x, yR(z0) - 0.03, z0], [x, yR(z1) - 0.03, z1], [x, top, z1], [x, top, z0]], dark(c, 0.04));
  // подложка: цоколь шире тела, низ — по скату; на плоском окладе тело выглядело висящим над черепицей
  const p = 0.06, hb = d.base ?? 0.16, pz0 = z0 - p, pz1 = z1 + p, bc = d.baseColor || dark(c, 0.22), pc = [cen[0], yR(z0) + hb / 2, cen[2]];
  const g0 = (ps, col) => prims.push(...face(S, ps, col, { center: pc, spec: 0.1 }));
  g0([[x0 - p, yR(pz0) - 0.03, pz0], [x1 + p, yR(pz0) - 0.03, pz0], [x1 + p, yR(pz0) + hb, pz0], [x0 - p, yR(pz0) + hb, pz0]], bc);
  for (const x of [x0 - p, x1 + p]) g0([[x, yR(pz0) - 0.03, pz0], [x, yR(pz1) - 0.03, pz1], [x, yR(pz0) + hb, pz1], [x, yR(pz0) + hb, pz0]], dark(bc, 0.06));
  g0([[x0 - p, yR(pz0) + hb, pz0], [x1 + p, yR(pz0) + hb, pz0], [x1 + p, yR(pz0) + hb, z0], [x0 - p, yR(pz0) + hb, z0]], lite(bc, 0.08));
  // плита-оголовок со свесом
  const m = 0.05, a0 = x0 - m, a1 = x1 + m, b0 = z0 - m, b1 = z1 + m, t1 = top + 0.07, cc = [cen[0], top + 0.035, cen[2]];
  const g = (ps, col) => prims.push(...face(S, ps, col, { center: cc, spec: 0.2 }));
  g([[a0, top, b0], [a1, top, b0], [a1, t1, b0], [a0, t1, b0]], cap);
  for (const x of [a0, a1]) g([[x, top, b0], [x, top, b1], [x, t1, b1], [x, t1, b0]], dark(cap, 0.08));
  g([[a0, top, b0], [a1, top, b0], [a1, top, b1], [a0, top, b1]], dark(cap, 0.3));
  const it = S.item(d.key ?? z0 - 0.01, prims, { name: 'chimney' });
  S.box3([x0, x1, yR(z0), t1, z0, z1], it);
  if (d.pot) { // глиняный горшок с куполком
    const r = Math.min(x1 - x0, z1 - z0) * 0.32, h = d.potH ?? 0.32;
    lathe(S, (x0 + x1) / 2, (z0 + z1) / 2, [[r, 0, 'c'], [r * 0.82, h * 0.75], [r * 0.9, h, 'c'], [r * 1.25, h + 0.03, 'c'], [r * 0.7, h + 0.11], [0, h + 0.14]], d.potColor || '#c0643a',
      { y0: t1, n: 14, spec: 0.25, key: (d.key ?? z0 - 0.01) - 0.005, name: 'chimney_pot' });
  }
});

/**
 * Указатель: столб и стрелки. {X, Z, h, r, color, arrows:[{y, w, h, dir:±1, text, color, textColor, a (сдвиг центра),
 * yaw (поворот доски вокруг столба, рад: > 0 — левый конец уходит вглубь)}],
 * vertical:{y, w, h, text, color, textColor} — вертикальная табличка-стрелка вверх}.
 */
reg('signpost', (S, d) => {
  const { X, Z } = d, h = d.h ?? 3.4, prims = [];
  cyl(S, X, Z, d.r ?? 0.06, 0, h, d.color || '#6a4228', { key: Z - 0.08, n: 10, spec: 0.3, name: 'post' });
  cyl(S, X, Z, (d.r ?? 0.06) * 1.6, 0, 0.12, dark(d.color || '#6a4228', 0.3), { key: Z - 0.1, n: 10, name: 'post_foot' });
  const zf = Z - (d.r ?? 0.06) - 0.03;
  const font = d.font || 'Arial Narrow, Arial, sans-serif', em = d.em ?? 0.6; // em — средняя ширина заглавной буквы в долях кегля
  const board = (pts, col, txt, txtCol, size, cxy, vert, avail, yaw = 0) => {
    // yaw: доска повёрнута вокруг оси столба; всё строится в плоскости z = zf и поворачивается
    const cs = Math.cos(yaw), sn = Math.sin(yaw), Rv = (v) => [v[0] * cs + v[2] * sn, v[1], -v[0] * sn + v[2] * cs];
    const R = (p) => { const q = Rv([p[0] - X, 0, p[2] - Z]); return [X + q[0], p[1], Z + q[2]]; };
    const ps = pts.map(([x, y]) => [x, y, zf]), nn = Rv([0, 0, -1]), psR = ps.map(R);
    prims.push({ t: 'poly', ps: psR, alb: col, n: Rv([0, 0.05, -1]), pl: [...nn, dot(nn, psR[0])], base: true, ink: true, sw: pxw(S, 0.018, zf), spec: 0.25, op: 1 });
    if (d.painted) { // крашеная доска: кайма темнее, волокна, гвозди
      const cxm = ps.reduce((a, p) => a + p[0], 0) / ps.length, cym = ps.reduce((a, p) => a + p[1], 0) / ps.length;
      const inner = ps.map(([x, y]) => [cxm + (x - cxm) * (1 - 0.05 / Math.max(0.2, Math.abs(x - cxm) + 0.1)), cym + (y - cym) * 0.72, zf - 0.002]);
      for (let i = 0; i < inner.length; i++) prims.push(S.line(R(inner[i]), R(inner[(i + 1) % inner.length]), dark(col, 0.28), pxw(S, 0.008, zf)));
      const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]), [xa, xb, ya, yb] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      for (let k = 0; k < 4; k++) { const y = ya + ((yb - ya) * (k + 0.5)) / 4, x0 = xa + (xb - xa) * (0.1 + rnd() * 0.3); prims.push(S.line(R([x0, y, zf - 0.001]), R([x0 + (xb - xa) * (0.2 + rnd() * 0.3), y + (rnd() - 0.5) * 0.01, zf - 0.001]), dark(col, 0.1), pxw(S, 0.004, zf), { op: 0.7 })); }
    }
    // торец доски (толщина) — тёмная кромка снизу
    const lo = Math.min(...pts.map((p) => p[1])), xs = pts.filter((p) => Math.abs(p[1] - lo) < 1e-6).map((p) => p[0]);
    if (xs.length >= 2) prims.push(S.line(R([Math.min(...xs), lo - 0.012, zf + 0.01]), R([Math.max(...xs), lo - 0.012, zf + 0.01]), dark(col, 0.35), pxw(S, 0.025, zf)));
    if (txt) {
      const fr = S.frame(R([cxy[0], cxy[1], zf - 0.004]), vert ? [0, -1, 0] : Rv([1, 0, 0]), vert ? Rv([1, 0, 0]) : [0, 1, 0], 1, 1, nn);
      const fit = avail ? Math.min(size, avail / (Math.max(1, [...txt].length) * em)) : size;
      prims.push(textPrim(S, fr, 0, 0, txt, fit, txtCol, { font, weight: 'bold', spacing: d.spacing }));
    }
  };
  for (const A of d.arrows || []) {
    const w = A.w ?? 1.1, hh = A.h ?? 0.26, dir = A.dir ?? 1, cx = X + (A.a ?? dir * (w / 2 - 0.08)), y = A.y, tip = hh * 0.55;
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const pts = dir > 0 ? [[x0, y - hh / 2], [x1 - tip, y - hh / 2], [x1, y], [x1 - tip, y + hh / 2], [x0, y + hh / 2]]
      : [[x0 + tip, y - hh / 2], [x1, y - hh / 2], [x1, y + hh / 2], [x0 + tip, y + hh / 2], [x0, y]];
    board(pts, A.color || '#f2ead8', A.text, A.textColor || '#2a2a3a', A.size ?? hh * 0.62, [cx + (dir > 0 ? -tip / 2 : tip / 2), y], false, w - tip - 0.12, A.yaw);
  }
  if (d.vertical) {
    const V = d.vertical, w = V.w ?? 0.34, hh = V.h ?? 1.2, y0 = V.y, x0 = X - w / 2 + (V.a ?? 0), tip = w * 0.6;
    board([[x0, y0], [x0 + w, y0], [x0 + w, y0 + hh], [x0 + w / 2, y0 + hh + tip], [x0, y0 + hh]], V.color || '#3a6ab8', V.text, V.textColor || '#f4f0e6', V.size ?? w * 0.62, [x0 + w / 2, y0 + hh / 2], true, hh - 0.08);
  }
  S.item(d.key ?? zf - 0.02, prims, { name: 'signpost' });
});

/** Доска объявлений на стене z: {x:[a,b], y:[a,b], z, color, notes:[{a,b,w,h,color,art}]} — рама и листки. */
reg('noticeboard', (S, d) => {
  const [a, b] = d.x, [y0, y1] = d.y, z = d.z - 0.04, prims = [], fw = d.frameW ?? 0.07, c = d.color || '#7a4a2a';
  const P = (x, y, zz = z) => [x, y, zz];
  prims.push({ t: 'poly', ps: [P(a, y0), P(b, y0), P(b, y1), P(a, y1)], alb: c, n: [0, 0, -1], pl: [0, 0, -1, -z], base: true, ink: true, sw: pxw(S, 0.015, z), spec: 0.3, op: 1 });
  const zi = z - 0.006;
  prims.push({ t: 'poly', ps: [P(a + fw, y0 + fw, zi), P(b - fw, y0 + fw, zi), P(b - fw, y1 - fw, zi), P(a + fw, y1 - fw, zi)], alb: d.cork || '#a87850', n: [0, 0, -1], pl: [0, 0, -1, -zi], bump: true, ink: false, spec: 0.1, op: 1 });
  for (const N of d.notes || []) {
    const zn = zi - 0.006 - rnd() * 0.004, x0 = N.a, x1 = N.a + N.w, yb = N.b, yt = N.b + N.h;
    prims.push({ t: 'poly', ps: [P(x0, yb, zn), P(x1, yb, zn), P(x1, yt, zn), P(x0, yt, zn)], alb: N.color || '#f4eedc', n: [0, 0.02, -1], pl: [0, 0, -1, -zn], base: true, ink: true, sw: pxw(S, 0.008, zn), spec: 0.1, op: 1 });
    const zt = zn - 0.003, iw = N.w, ih = N.h;
    if (N.art === 'cube') {
      const cx = x0 + iw / 2, cy = yb + ih * 0.55, s = Math.min(iw, ih) * 0.28;
      const top = [P(cx, cy + s, zt), P(cx + s * 0.9, cy + s * 0.5, zt), P(cx, cy, zt), P(cx - s * 0.9, cy + s * 0.5, zt)];
      const lf = [P(cx - s * 0.9, cy + s * 0.5, zt), P(cx, cy, zt), P(cx, cy - s, zt), P(cx - s * 0.9, cy - s * 0.5, zt)];
      const rt = [P(cx, cy, zt), P(cx + s * 0.9, cy + s * 0.5, zt), P(cx + s * 0.9, cy - s * 0.5, zt), P(cx, cy - s, zt)];
      for (const [ps, col] of [[top, '#8ab0e0'], [lf, '#4a70b8'], [rt, '#2a50a0']]) prims.push({ t: 'poly', ps, alb: col, n: [0, 0, -1], pl: [0, 0, -1, -zt], bump: true, ink: true, sw: pxw(S, 0.006, zt), spec: 0.2, op: 1 });
    } else if (N.art === 'mountains') {
      prims.push({ t: 'poly', ps: [P(x0 + iw * 0.08, yb + ih * 0.1, zt), P(x1 - iw * 0.08, yb + ih * 0.1, zt), P(x1 - iw * 0.08, yt - ih * 0.1, zt), P(x0 + iw * 0.08, yt - ih * 0.1, zt)], alb: '#9ac8e8', n: [0, 0, -1], pl: [0, 0, -1, -zt], bump: true, ink: false, spec: 0.2, op: 1 });
      const zm = zt - 0.002;
      prims.push({ t: 'poly', ps: [P(x0 + iw * 0.08, yb + ih * 0.1, zm), P(x0 + iw * 0.38, yb + ih * 0.7, zm), P(x0 + iw * 0.6, yb + ih * 0.35, zm), P(x0 + iw * 0.75, yb + ih * 0.6, zm), P(x1 - iw * 0.08, yb + ih * 0.3, zm), P(x1 - iw * 0.08, yb + ih * 0.1, zm)], alb: '#6a7a8a', n: [0, 0, -1], pl: [0, 0, -1, -zm], bump: true, ink: false, spec: 0.1, op: 1 });
      prims.push({ t: 'poly', ps: [P(x0 + iw * 0.08, yb + ih * 0.1, zm - 0.001), P(x1 - iw * 0.08, yb + ih * 0.1, zm - 0.001), P(x1 - iw * 0.08, yb + ih * 0.22, zm - 0.001), P(x0 + iw * 0.08, yb + ih * 0.26, zm - 0.001)], alb: '#5a8a3a', n: [0, 0, -1], pl: [0, 0, -1, -zm], bump: true, ink: false, spec: 0.1, op: 1 });
    } else {
      for (let i = 0; i < (N.lines ?? 5); i++) prims.push(S.line(P(x0 + iw * 0.15, yt - ih * (0.2 + i * 0.14), zt), P(x0 + iw * (0.5 + rnd() * 0.35), yt - ih * (0.2 + i * 0.14), zt), '#6a5a4a', pxw(S, 0.012, zt)));
    }
    prims.push(...sphere(S, x0 + iw / 2, yt - 0.025, zt - 0.004, 0.012, '#c83a2a', { prims: true, spec: 0.6, ink: false }));
  }
  S.item(d.key ?? z - 0.03, prims, { name: 'noticeboard' });
});

/** Классики мелом на земле: {X, Z, cell, ang} — клетки 1-1-2-1-2-1-«небо» тонкими плоскими полосами (линии
 *  на земле съел бы попиксельный материал мостовой; полосы — свои многоугольники со своим цветом). */
reg('hopscotch', (S, d) => {
  const { X, Z } = d, c = d.cell ?? 0.5, prims = [], chalk = d.color || '#ece6dc', y = 0.006, t = d.t ?? 0.028;
  const ang = ((d.ang ?? 0) * Math.PI) / 180, u = [Math.cos(ang), 0, Math.sin(ang)], v = [-Math.sin(ang), 0, Math.cos(ang)];
  const P = (a, b) => [X + u[0] * a + v[0] * b, y, Z + u[2] * a + v[2] * b];
  const strip = (a0, b0, a1, b1, w = t) => {
    const da = a1 - a0, db = b1 - b0, L = Math.hypot(da, db) || 1, na = (-db / L) * w / 2, nb = (da / L) * w / 2;
    prims.push({ t: 'poly', ps: [P(a0 - na, b0 - nb), P(a1 - na, b1 - nb), P(a1 + na, b1 + nb), P(a0 + na, b0 + nb)], alb: chalk, n: [0, 1, 0], pl: [0, 1, 0, y], base: true, ink: false, spec: 0.1, op: 0.85 });
  };
  const rows = [[0], [0], [-0.5, 0.5], [0], [-0.5, 0.5], [0], [0]];
  let k = 1;
  rows.forEach((cols, r) => {
    for (const cx of cols) {
      const a0 = cx * c - c / 2, b0 = r * c;
      strip(a0, b0, a0 + c, b0); strip(a0 + c, b0, a0 + c, b0 + c); strip(a0 + c, b0 + c, a0, b0 + c); strip(a0, b0 + c, a0, b0);
      const am = a0 + c / 2, bm = b0 + c / 2, s = c * 0.16;
      strip(am - s * 0.25, bm - s, am + s * 0.2, bm + s, t * 0.8);
      if (k++ % 2 === 0) strip(am - s * 0.5, bm - s, am + s * 0.5, bm - s, t * 0.8);
    }
  });
  const b0 = rows.length * c, arc = [];
  for (let i = 0; i <= 12; i++) { const th = Math.PI * (i / 12); arc.push([-Math.cos(th) * c * 0.75, b0 + Math.sin(th) * c * 0.75]); }
  for (let i = 0; i < 12; i++) strip(arc[i][0], arc[i][1], arc[i + 1][0], arc[i + 1][1]);
  S.item(d.key ?? 1e5, prims, { name: 'hopscotch', force: true });
});

/** Резиновая утка: {X, Y, Z, s}. */
reg('duck', (S, d) => {
  const { X, Z } = d, Y = d.Y ?? 0, s = d.s ?? 1, prims = [], c = '#f4c020';
  prims.push(...sphere(S, X, Y + 0.09 * s, Z, 0.11 * s, c, { prims: true, spec: 0.5 }));
  prims.push(...sphere(S, X - 0.04 * s, Y + 0.24 * s, Z - 0.01, 0.075 * s, c, { prims: true, spec: 0.5 }));
  prims.push(...sphere(S, X - 0.12 * s, Y + 0.22 * s, Z - 0.03, 0.035 * s, '#f07a20', { prims: true, spec: 0.4 }));
  prims.push(...sphere(S, X - 0.07 * s, Y + 0.27 * s, Z - 0.075 * s, 0.012 * s, '#1a1418', { prims: true, spec: 0.8, ink: false }));
  prims.push(...sphere(S, X + 0.08 * s, Y + 0.16 * s, Z - 0.02, 0.04 * s, lite(c, 0.1), { prims: true, spec: 0.5 }));
  S.item(d.key ?? Z - 0.15 * s, prims, { name: 'duck' });
});

/** Чемодан с ремнями: {o:[X,Z], len, wid, h, color, ang}. */
reg('suitcase', (S, d) => {
  const c = d.color || '#7a4a30', [X, Z] = d.o, L = d.len ?? 0.5, Wd = d.wid ?? 0.25, h = d.h ?? 0.8, prims = [];
  obox(S, { o: d.o, len: L, wid: Wd, y: [d.y0 ?? 0, (d.y0 ?? 0) + h], color: c, top: lite(c, 0.06), side: dark(c, 0.1) }, prims);
  const zf = Z - 0.006, y0 = d.y0 ?? 0;
  for (const a of [L * 0.25, L * 0.75]) prims.push(S.line([X + a, y0 + 0.02, zf], [X + a, y0 + h - 0.02, zf], '#3a2418', pxw(S, 0.035, Z)));
  prims.push(S.line([X + 0.03, y0 + h * 0.5, zf], [X + L - 0.03, y0 + h * 0.5, zf], dark(c, 0.3), pxw(S, 0.02, Z)));
  prims.push(S.line([X + L * 0.35, y0 + h + 0.06, Z + Wd / 2], [X + L * 0.65, y0 + h + 0.06, Z + Wd / 2], '#2a1a14', pxw(S, 0.03, Z), { ink: true }));
  S.item(d.key ?? Z - 0.02, prims, { name: 'suitcase' });
});

/**
 * Ступенчатый парапет лестницы вдоль Z (щека): {x:[a,b], z:[z0,z1], y:[низ у z0, верх у z1] (высота марша), steps
 * (уступов), over (выше ступеней), color, cap, lights (огонёк в каждом уступе)}.
 */
reg('stepWall', (S, d) => {
  const [x0, x1] = d.x, [z0, z1] = d.z, [ya, yb] = d.y, n = d.steps ?? 6, over = d.over ?? 0.55, c = d.color || '#cdb8a2', cap = d.cap || lite(c, 0.12);
  for (let i = 0; i < n; i++) {
    const za = z0 + ((z1 - z0) * i) / n, zb = z0 + ((z1 - z0) * (i + 1)) / n, top = ya + ((yb - ya) * (i + 1)) / n + over;
    box(S, x0, x1, 0, top, za, zb + 0.01, jit(c, 0.04), { key: za, name: 'stepwall', mats: d.mats });
    box(S, x0 - 0.04, x1 + 0.04, top, top + 0.09, za - 0.04, zb + 0.05, cap, { key: za - 0.04, name: 'stepwall_cap' });
    if (d.lights) {
      const zl = za - 0.005, yl = top - 0.22, xl = x0 + (x1 - x0) * 0.5;
      const ps = [[xl - 0.07, yl, zl], [xl + 0.07, yl, zl], [xl + 0.07, yl + 0.09, zl], [xl - 0.07, yl + 0.09, zl]];
      S.item(zl - 0.01, [{ t: 'poly', ps, alb: '#fff0c0', n: [0, 0, -1], pl: [0, 0, -1, -zl], bump: true, ink: true, sw: 0.8, spec: 0.3, em: '#ffc860', op: 1 }], { name: 'wall_light' });
      // огонёк сбоку (виден с камеры слева)
      const ps2 = [[x0 - 0.005, yl, za + 0.15], [x0 - 0.005, yl, za + 0.32], [x0 - 0.005, yl + 0.09, za + 0.32], [x0 - 0.005, yl + 0.09, za + 0.15]];
      S.item(za, [{ t: 'poly', ps: ps2, alb: '#fff0c0', n: [-1, 0, 0], pl: [-1, 0, 0, -(x0 - 0.005)], bump: true, ink: true, sw: 0.8, spec: 0.3, em: '#ffc860', op: 1 }], { name: 'wall_light' });
      if (i % 2 === 0) S.light([x0 - 0.3, yl + 0.05, za + 0.2], '#ffb860', 1.6, 0.5, 'lamp');
    }
  }
});

/** Огоньки в подступёнках лестницы вдоль Z: {x (X огонька), z:[z0,z1], y0, h, steps, every}. */
reg('riserLights', (S, d) => {
  const [z0, z1] = d.z, n = d.steps, y0 = d.y0 ?? 0, prims = [], X = d.x;
  for (let i = 1; i < n; i += d.every ?? 1) {
    const z = z0 + ((z1 - z0) * i) / n - 0.004, yb = y0 + (d.h * i) / n + 0.03;
    prims.push({ t: 'poly', ps: [[X - 0.09, yb, z], [X + 0.09, yb, z], [X + 0.09, yb + 0.06, z], [X - 0.09, yb + 0.06, z]], alb: '#fff0c0', n: [0, 0, -1], pl: [0, 0, -1, -z], bump: true, ink: false, spec: 0.3, em: '#ffc860', op: 1 });
  }
  S.item(d.key ?? z0 - 0.01, prims, { name: 'riser_lights' });
});

/** Рулоны ткани на витрине (торцами к камере): {x:[a,b], y, z, colors}. */
reg('spools', (S, d) => {
  const [a, b] = d.x, cols = d.colors || ['#f0a0b8', '#f4e0c8', '#e88aa8', '#f8f0e0'], n = d.n ?? 6, r = d.r ?? ((b - a) / n) * 0.46, prims = [];
  for (let i = 0; i < n; i++) {
    const X = a + ((i + 0.5) * (b - a)) / n, c = cols[i % cols.length], ring = (rr) => { const ps = []; for (let k = 0; k < 18; k++) { const t = (k / 18) * TAU; ps.push([X + Math.cos(t) * rr, d.y + r + Math.sin(t) * rr, d.z]); } return ps; };
    prims.push({ t: 'poly', ps: ring(r), alb: c, n: [0, 0, -1], pl: [0, 0, -1, -d.z], base: true, ink: true, sw: pxw(S, 0.01, d.z), spec: 0.2, op: 1 });
    for (const k of [0.66, 0.36]) prims.push(S.line(ring(r * k)[0], ring(r * k)[9], dark(c, 0.12), 0.6, { op: 0 }));
    prims.push({ t: 'poly', ps: ring(r * 0.22), alb: '#8a6a4a', n: [0, 0, -1], pl: [0, 0, -1, -(d.z + 0.001)], bump: true, ink: false, spec: 0.1, op: 1 });
  }
  S.item(d.key ?? d.z - 0.02, prims, { name: 'spools' });
});

/** Плед, переброшенный через перила (фронтальный): {x:[a,b], y (верх), len, z, color, stripes}. */
reg('blanket', (S, d) => {
  const [a, b] = d.x, y = d.y, L = d.len ?? 0.6, z = d.z, c = d.color || '#d8783a', prims = [];
  const ps = [[a, y, z], [b, y, z], [b + 0.02, y - L, z]];
  for (let k = 1; k < 8; k++) ps.push([b - ((b - a) * k) / 8, y - L - (k % 2 ? 0.035 : 0), z]);
  ps.push([a - 0.02, y - L, z]);
  prims.push({ t: 'poly', ps, alb: c, n: [0, 0.1, -1], pl: [0, 0, -1, -z], base: true, ink: true, sw: pxw(S, 0.012, z), spec: 0.1, op: 1 });
  for (let k = 1; k < (d.folds ?? 5); k++) { const x = a + ((b - a) * k) / (d.folds ?? 5); prims.push(S.line([x, y - 0.02, z - 0.003], [x + 0.01, y - L + 0.03, z - 0.003], dark(c, 0.22), pxw(S, 0.012, z))); }
  for (const t of d.stripes ?? [0.15, 0.85]) prims.push(S.line([a, y - L * t, z - 0.003], [b, y - L * t, z - 0.003], d.stripe || '#f0d8a0', pxw(S, 0.02, z)));
  S.item(d.key ?? z - 0.01, prims, { name: 'blanket' });
});

/** Почтовый ящик на стене z: {X, Y, z, color}. */
reg('mailbox', (S, d) => {
  const { X, Y } = d, z = d.z, c = d.color || '#2a4a90';
  box(S, X - 0.16, X + 0.16, Y, Y + 0.42, z - 0.16, z, c, { key: z - 0.16, name: 'mailbox' });
  box(S, X - 0.18, X + 0.18, Y + 0.42, Y + 0.46, z - 0.19, z, dark(c, 0.15), { key: z - 0.19, name: 'mailbox_lid' });
  S.item(z - 0.17, [S.line([X - 0.09, Y + 0.33, z - 0.162], [X + 0.09, Y + 0.33, z - 0.162], '#101018', pxw(S, 0.03, z)), S.line([X - 0.07, Y + 0.15, z - 0.162], [X + 0.07, Y + 0.15, z - 0.162], '#e8c040', pxw(S, 0.03, z))], { name: 'mailbox_slot' });
});

/** Голубь сбоку: {X, Z, s, flip} — тело с выпуклой нормалью, светлое крыло с тёмными полосами, переливчатая шея,
 *  тёмная голова, клюв, красные лапки. */
reg('pigeon', (S, d) => {
  const { X, Z } = d, k = d.s ?? 1, sx = d.flip ? -1 : 1, y0 = d.Y ?? 0, prims = [], z = Z;
  const P = (a, b, dz = 0) => [X + a * k * sx, y0 + b * k, z - dz];
  const poly = (pts, alb, o = {}) => prims.push({ t: 'poly', ps: pts, alb, n: o.n || [0, 0.1, -1], pl: [0, 0, -1, -(z - (o.dz ?? 0))], base: !o.bump, bump: !!o.bump, ink: !!o.ink, sw: pxw(S, 0.008, z), spec: o.spec ?? 0.35, op: 1, ...(o.ng ? { ng: o.ng } : {}) });
  const body = [P(-0.19, 0.115), P(-0.1, 0.06), P(-0.02, 0.035), P(0.06, 0.04), P(0.11, 0.075), P(0.125, 0.13), P(0.11, 0.18), P(0.06, 0.185), P(-0.02, 0.165), P(-0.11, 0.14), P(-0.2, 0.13)];
  poly(body, '#5c6684', { ink: true, ng: { kind: 'sphere', c: S.P(P(0, 0.1)), r: [0.16 * k * S.pxPerUnit(z), 0.07 * k * S.pxPerUnit(z)], flat: 0.15 } });
  poly([P(-0.15, 0.13, 0.003), P(-0.02, 0.16, 0.003), P(0.06, 0.15, 0.003), P(0.05, 0.1, 0.003), P(-0.04, 0.08, 0.003)], '#8a92ae', { bump: true, dz: 0.003, n: [0, 0.4, -1] });
  poly([P(-0.08, 0.1, 0.005), P(-0.04, 0.1, 0.005), P(-0.05, 0.13, 0.005), P(-0.09, 0.125, 0.005)], '#3a3e52', { bump: true, dz: 0.005 });
  poly([P(-0.01, 0.1, 0.005), P(0.03, 0.1, 0.005), P(0.02, 0.135, 0.005), P(-0.02, 0.13, 0.005)], '#3a3e52', { bump: true, dz: 0.005 });
  poly([P(0.08, 0.13, 0.004), P(0.14, 0.13, 0.004), P(0.15, 0.2, 0.004), P(0.1, 0.21, 0.004)], '#4a8a7a', { bump: true, dz: 0.004, spec: 0.8 });
  prims.push(...sphere(S, P(0.15, 0.225)[0], P(0.15, 0.225)[1], z - 0.008, 0.042 * k, '#4a5070', { prims: true, spec: 0.5 }));
  poly([P(0.185, 0.23, 0.012), P(0.235, 0.215, 0.012), P(0.185, 0.21, 0.012)], '#d8a070', { bump: true, dz: 0.012 });
  prims.push(...sphere(S, P(0.165, 0.235)[0], P(0.165, 0.235)[1], z - 0.05 * k, 0.008 * k, '#e86a30', { prims: true, spec: 0.8, ink: false }));
  prims.push(S.line(P(0.03, 0.04), P(0.035, 0), '#d0503a', pxw(S, 0.014 * k, z)), S.line(P(-0.03, 0.04), P(-0.035, 0), '#d0503a', pxw(S, 0.014 * k, z)));
  S.item(d.key ?? z - 0.05, prims, { name: 'pigeon' });
});

/** Невидимый окклюдер (только тень): {x:[a,b], y:[a,b], z:[a,b]} — дом за кадром, дающий тень на площадь. */
reg('shadowBox', (S, d) => {
  const it = S.item(d.key ?? d.z[0], [], { force: true, name: 'shadow_box' });
  S.box3([d.x[0], d.x[1], d.y[0], d.y[1], d.z[0], d.z[1]], it);
});

/** Цветы-шапкой в ящике/кашпо на земле или перилах (фронтальный ряд кустиков): см. planter в plaza.props. */
export { obox };
void disc; void lathe; void PROFILES; void norm; void sub; void mul;
