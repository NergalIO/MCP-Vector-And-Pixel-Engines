// Референс 5 (refs/plaza.webp): двор с фонтаном — «Площадь Даров» главы 1 (комната ch1_square в игре).
// Двор замкнут: слева дом с аркой (выход к крыльцу) и лестница на мост; в глубине мост-галерея на трёх арках — ниша-алтарь
// с полками и дарами, проход в переулок, будка «Концерты»; справа деревянный балкон на столбах с фруктовой лавкой
// и розовый магазин «Фрукты». В центре фонтан на мозаике, впереди открытый колодец с лестницей, конусами и лентой.
// Без персонажей и животных (их ставит игра).
// Камера подобрана по референсу (1920×1080): горизонт 310 px, точка схода x = 985, f = 2000 px, глаз на 4 м. Предметы
// поставлены по пикселям референса обратной проекцией (gp, X_, Y_, rectF), как в stairs.build.mjs. Перспектива
// референса нестрогая (стены нарисованы почти фронтально) — здесь стены по честной перспективе, раскладка та же.
import './stairs.build.mjs'; // предметы stairs: archDoor, plate, wallGlow, shopWin (и stairs.props, plaza.props)
import { registerWorldItem, face, dot, add, sub, mul, dark, lite, jit, disc, sphere, box, lathe, PROFILES } from '../../engine/world3d.js';
import { obox, occluders } from './plaza.props.mjs';

export const CAM = { hor: 310, f: 2000, camH: 4.0, dz: 0, cx: 985 };
const { hor, f, camH, cx } = CAM;
const POS = [0, camH, 0];

/* ---------- экран ↔ мир ---------- */
const ray = (x, y) => [(x - cx) / f, -(y - hor) / f, 1];
/** Точка на земле (или на высоте Y) под пикселем (x, y): [X, Z]. */
const gp = (x, y, Y = 0) => { const Z = ((camH - Y) * f) / (y - hor); return [((x - cx) * Z) / f, Z]; };
const xz = (x, y, Y = 0) => { const [X, Z] = gp(x, y, Y); return { X: +X.toFixed(3), Z: +Z.toFixed(3) }; };
const X_ = (x, Z) => ((x - cx) * Z) / f, Y_ = (y, Z) => camH - ((y - hor) * Z) / f;
const hit = (x, y, n, d) => { const r = ray(x, y), t = (d - dot(n, POS)) / dot(n, r); return add(POS, mul(r, t)); };
const onF = (F, x, y) => { const P = hit(x, y, F.n, dot(F.n, F.o)), r = sub(P, F.o); return [dot(r, F.u), dot(r, F.v), P]; };
const rectF = (F, x1, y1, x2, y2) => {
  const [a1, b1, P1] = onF(F, x1, y1), [a2, b2, P2] = onF(F, x2, y2);
  return { a: Math.min(a1, a2), b: Math.min(b1, b2), w: Math.abs(a2 - a1), h: Math.abs(b2 - b1), z: Math.min(P1[2], P2[2]) };
};
/** Фронтальная стена z (низ на высоте y0), x0…x1; a на ней = X + 30. */
const FZ = (Z, h = 20, y0 = 0) => ({ o: [-30, y0, Z], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, -1], w: 60, h });
const A = (X) => X + 30;
/** Стена X = const, смотрит в +X (левая сторона двора): a = Z − z0. */
const FXp = (X, z0, z1, h = 20, y0 = 0) => ({ o: [X, y0, z0], u: [0, 0, 1], v: [0, 1, 0], n: [1, 0, 0], w: z1 - z0, h });
/** Стена X = const, смотрит в −X (правая сторона двора): a = z1 − Z. */
const FXm = (X, z0, z1, h = 20, y0 = 0) => ({ o: [X, y0, z1], u: [0, 0, -1], v: [0, 1, 0], n: [-1, 0, 0], w: z1 - z0, h });
/** Окно по прямоугольнику стекла на экране. */
const win = (F, x1, y1, x2, y2, o = {}) => { const r = rectF(F, x1, y1, x2, y2); return { type: 'window', on: F, a: r.a, b: r.b, w: r.w, h: r.h, lit: !!o.lit, shut: o.shut ?? null, ajar: o.ajar ?? 0.38, box: !!o.box, key: o.key ?? r.z - 0.02 }; };
/** Предмет на грани по прямоугольнику на экране. */
const onRect = (type, F, x1, y1, x2, y2, o = {}) => { const r = rectF(F, x1, y1, x2, y2); return { type, on: F, a: r.a, b: r.b, w: r.w, h: r.h, key: r.z - 0.03, ...o }; };
/** Окно на боковой стене по центру Zc (a — по оси грани). */
const winXp = (F, Zc, b, o = {}) => ({ type: 'window', on: F, a: Zc - F.o[2] - (o.w ?? 0.95) / 2, b, w: o.w ?? 0.95, h: o.h ?? 1.2, lit: !!o.lit, shut: o.shut ?? SHUT, ajar: o.ajar ?? 0.38, box: !!o.box, key: Zc - 0.5 });
const winXm = (F, Zc, b, o = {}) => ({ type: 'window', on: F, a: F.o[2] - Zc - (o.w ?? 0.95) / 2, b, w: o.w ?? 0.95, h: o.h ?? 1.2, lit: !!o.lit, shut: o.shut ?? SHUT, ajar: o.ajar ?? 0.38, box: !!o.box, key: Zc - 0.5 });

/* ---------- уровни ---------- */
const XL = -6.0; // левый дом: стена вдоль двора (смотрит вправо)
const ZB = 23.0; // лицо моста
const DECK = 3.62; // пол моста (верх карниза)
const ZBk = 26.5; // фасады за мостом
const XR = 7.6; // правый дом: стена за балконом (смотрит влево)
const XP = 4.45; // линия столбов балкона
const BAL = 3.45; // пол балкона
const ZS0 = 16.4, ZS1 = 22.85, NS = 21; // левая лестница на мост: низ, верх, ступеней
const stepY = (Z) => (DECK * (Math.min(NS - 1, Math.floor(((Z - ZS0) / (ZS1 - ZS0)) * NS)) + 1)) / NS; // верх ступени над Z
const [FX, FZc] = gp(1130, 740); // фонтан: центр чаши на земле
const [PX, PZ] = gp(700, 915); // колодец

/* ---------- палитра ---------- */
const OCHRE = '#f0bc88', CREAM = '#f2d8a8', PINK = '#ec9aa6';
const BRIDGE = '#d8b49a', STONE_HI = '#ecd6c0', STONE = '#c4a08c';
const WOOD = '#7a4224', WOOD_LT = '#a8683a', IRON = '#2c2428';
const TEAL = '#2a8a84', BLUE = '#3a5a9a', SHUT = TEAL, RED = '#b8402e';
const TREAD = '#e2cec0', RISER = '#a8908a';
const FONT = 'Candara, Arial Narrow, sans-serif';

/* ---------- предметы этой сцены ---------- */
/** Герб-лимон на стене (фронтальный): {X, Y, Z, rx, ry, color}. */
registerWorldItem('pzPlaque', { doc: 'герб-лимон на стене', build: (S, d) => {
  const { X, Y, Z } = d, rx = d.rx ?? 0.5, ry = d.ry ?? 0.3, c = d.color || '#f0b830', prims = [];
  const oval = (kx, ky, dz, cx = X, cy = Y, tipK = 0) => { const ps = []; for (let i = 0; i < 40; i++) { const t = (i / 40) * Math.PI * 2, tip = 1 + tipK * Math.abs(Math.cos(t)) ** 12; ps.push([cx + Math.cos(t) * rx * kx * tip, cy + Math.sin(t) * ry * ky, Z - dz]); } return ps; };
  const P = (ps, alb, dz, o = {}) => ({ t: 'poly', ps, alb, n: [0, 0, -1], pl: [0, 0, -1, -(Z - dz)], base: true, ink: true, sw: S.sw(Z) * 0.6, spec: 0.4, op: 1, ...o });
  prims.push(P(oval(1.1, 1.1, 0.01), '#9a6a2a', 0.01, { sw: S.sw(Z) * 0.8 }));
  prims.push(P(oval(0.96, 0.94, 0.015), c, 0.015, { spec: 0.7 }));
  prims.push(P(oval(0.8, 0.76, 0.02), '#c8862a', 0.02, { spec: 0.5 }));
  prims.push(P(oval(0.42, 0.5, 0.025, X, Y - ry * 0.05, 0.25), '#f6d240', 0.025, { spec: 0.6 })); // лимон
  prims.push(P([[X + rx * 0.05, Y + ry * 0.38, Z - 0.03], [X + rx * 0.42, Y + ry * 0.62, Z - 0.03], [X + rx * 0.2, Y + ry * 0.3, Z - 0.03]], '#8ab040', 0.03, { sw: S.sw(Z) * 0.4 })); // лист
  S.item(d.key ?? Z - 0.03, prims, { name: 'plaque' });
} });
/** Площадка вокруг фонтана: каменное кольцо, синий пояс с золотыми точками, огоньки: {X, Z, R, n}. */
registerWorldItem('pzMosaic', { doc: 'мозаика вокруг фонтана', build: (S, d) => {
  const { X, Z } = d, R = d.R ?? 2.4, prims = [], n = d.n ?? 14, TAU = Math.PI * 2;
  const ring = (r, y, c, o = {}) => disc(S, X, y, Z, r, r, c, { spec: 0.35, n: 72, ...o });
  prims.push(ring(R, 0.004, '#b89880', { base: true }));
  prims.push(ring(R - 0.1, 0.005, '#d8c0a4'));
  prims.push(ring(R - 0.5, 0.006, '#2e4a7a', { spec: 0.5 }));
  prims.push(ring(R - 0.78, 0.007, '#d4b898'));
  for (let i = 0; i < 40; i++) { const a = (i / 40) * TAU, rr = R - 0.64; prims.push(disc(S, X + Math.cos(a) * rr, 0.0075, Z + Math.sin(a) * rr, 0.06, 0.06, i % 2 ? '#e8b840' : '#f4ece0', { spec: 0.7 })); }
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + 0.12, p = [X + Math.cos(a) * (R - 0.3), 0.008, Z + Math.sin(a) * (R - 0.3)];
    prims.push(disc(S, p[0], p[1], p[2], 0.1, 0.1, '#5a4636', { spec: 0.6 }));
    prims.push(disc(S, p[0], 0.009, p[2], 0.07, 0.07, '#fff0b8', { em: '#ffd070', spec: 0.6 }));
    if (Math.sin(a) < 0.3) S.light([p[0], 0.15, p[2]], '#ffb860', 1.1, 0.5, 'lamp');
  }
  S.item(d.key ?? Z + R, prims, { name: 'mosaic' });
} });
/** Прилавок-лавка на грани: тёмная ниша с полками и ящиками фруктов: {on:F, a, b, w, h, rows, crate, fruits}. */
registerWorldItem('pzStall', { doc: 'лавка: полки с ящиками фруктов', build: (S, d) => {
  const F = d.on, fr0 = S.frame(F.o, F.u, F.v, F.w, F.h, F.n), prims = [];
  const fr = S.frame(add(fr0.at(d.a, d.b), mul(F.n, 0.01)), F.u, F.v, d.w, d.h, F.n);
  const z = Math.min(fr.at(0, 0)[2], fr.at(d.w, 0)[2]), sw = S.sw(z) * 0.6, W = d.w, H = d.h;
  const fruits = d.fruits || ['#d83a2a', '#f0a030', '#9ac040', '#8a4aa8', '#f2d040', '#e86a3a', '#c8304a'];
  prims.push(S.det(fr, fr.rect(-0.08, -0.06, W + 0.16, H + 0.12), d.frame || '#8a5230', { ink: true, sw, spec: 0.2 }));
  prims.push(S.det(fr, fr.rect(0, 0, W, H), '#4a2c1c', { em: '#2a140a' }));
  const rows = d.rows ?? 3, cw = d.crate ?? 0.42, r = d.fr ?? 0.045;
  for (let k = 0; k < rows; k++) {
    const b0 = (H * k) / rows + 0.05, ch = (H / rows) * 0.36;
    prims.push(S.det(fr, fr.rect(0, b0 - 0.05, W, 0.05), '#7a4a2a', { ink: true, sw: sw * 0.5 }));
    for (let a = 0.06, i = 0; a + cw <= W - 0.03; a += cw + 0.05, i++) {
      const c = fruits[(k * 3 + i * 2) % fruits.length];
      for (let j = 0; j < 2; j++) for (let m = 0; m < Math.floor(cw / (2 * r)) - j; m++) {
        const cx = a + r + m * 2 * r + j * r, cy = b0 + ch + r * 0.5 + j * r * 1.4, ps = [];
        for (let q = 0; q < 10; q++) { const t = (q / 10) * Math.PI * 2; ps.push(fr.at(cx + Math.cos(t) * r, cy + Math.sin(t) * r)); }
        prims.push(S.det(fr, ps, jit(c, 0.06), { ink: true, sw: sw * 0.35, em: dark(c, 0.55), spec: 0.4 }));
      }
      prims.push(S.det(fr, fr.rect(a, b0, cw, ch), '#a86a38', { ink: true, sw: sw * 0.5, em: '#3a1e0c' }));
      prims.push(S.det(fr, fr.rect(a, b0 + ch * 0.45, cw, ch * 0.12), '#7a4822'));
    }
  }
  S.item(d.key ?? z - 0.02, prims, { name: 'stall' });
  S.light(add(fr.at(W / 2, H * 0.7), mul(F.n, 0.6)), '#ffb860', d.radius ?? 3, d.energy ?? 0.9, 'window');
} });
/** Верёвка флагштока: две пряди сверху до утки (крюка) на столбе: {X, Z, top, cleat, r (радиус столба)}. */
registerWorldItem('pzRope', { doc: 'верёвка на флагштоке', build: (S, d) => {
  const { X, Z } = d, r = d.r ?? 0.065, c = d.color || '#efe2c4', prims = [], lw = Math.max(1, 0.022 * S.pxPerUnit(Z));
  for (const dx of [-0.02, 0.025]) prims.push(S.line([X - r - 0.012 + dx * 0.3, d.top, Z - r + dx], [X - r - 0.02, d.cleat + 0.06, Z - r - 0.01 + dx], c, lw, { ink: true }));
  const cy = d.cleat; // утка и бухта верёвки
  prims.push(S.line([X - r - 0.03, cy - 0.1, Z - r - 0.02], [X - r - 0.03, cy + 0.12, Z - r - 0.02], '#5a4a3a', lw * 2.2, { ink: true }));
  for (let i = 0; i < 3; i++) { const ps = []; for (let q = 0; q <= 14; q++) { const t = (q / 14) * Math.PI * 2; ps.push([X - r - 0.05 + Math.cos(t) * 0.09, cy - 0.12 - i * 0.05 + Math.sin(t) * 0.16, Z - r - 0.06]); } for (let q = 0; q < 14; q++) prims.push(S.line(ps[q], ps[q + 1], c, lw * 1.3)); }
  S.item(d.key ?? Z - r - 0.1, prims, { name: 'rope' });
} });
/** Ящик как crate (plaza.props), но рейки, щели и уголки — только на видимых камере гранях
 *  (у crate рейки задней и скрытой боковой граней рисовались поверх передней: ящик казался прозрачным). */
let crateSeed = 7;
const crnd = () => (crateSeed = (crateSeed * 16807) % 2147483647) / 2147483647;
registerWorldItem('pzCrate', { doc: 'ящик с рейками на видимых гранях', build: (S, d) => {
  const y0 = d.y0 ?? 0, h = d.h ?? 0.6, c = d.color || '#a8743c', prims = [];
  const ang = ((d.ang ?? 0) * Math.PI) / 180, u = [Math.cos(ang), 0, Math.sin(ang)], w = [-Math.sin(ang), 0, Math.cos(ang)];
  const [X, Z] = d.o, L = d.len ?? 0.8, Wd = d.wid ?? 0.6;
  obox(S, { o: d.o, ang: d.ang, len: L, wid: Wd, y: [y0, y0 + h], color: c, top: d.fill ? dark(c, 0.45) : lite(c, 0.08), side: dark(c, 0.08) }, prims);
  const p = (a, b, y) => [X + u[0] * a + w[0] * b, y, Z + u[2] * a + w[2] * b];
  const zc = Z + (u[2] * L + w[2] * Wd) / 2, pxw = (t) => Math.max(0.6, t * S.pxPerUnit(zc)), sl = dark(c, 0.45);
  const nF = [-w[0], 0, -w[2]], nL = [-u[0], 0, -u[2]], nR = [u[0], 0, u[2]];
  const plOf = (nv, q) => ({ pl: [nv[0], nv[1], nv[2], dot(nv, q)] });
  const front = plOf(nF, p(0, 0, y0)), left = plOf(nL, p(0, 0, y0)), right = plOf(nR, p(L, 0, y0));
  const seeF = S.faces(nF, p(L / 2, 0, y0 + h / 2)), seeL = S.faces(nL, p(0, Wd / 2, y0 + h / 2)), seeR = S.faces(nR, p(L, Wd / 2, y0 + h / 2));
  for (const k of [1, 2]) {
    const y = y0 + (h * k) / 3;
    if (seeF) prims.push(S.line(p(0, -0.002, y), p(L, -0.002, y), sl, pxw(0.02), front));
    if (seeR) prims.push(S.line(p(L + 0.002, 0, y), p(L + 0.002, Wd, y), sl, pxw(0.02), right));
    if (seeL) prims.push(S.line(p(-0.002, 0, y), p(-0.002, Wd, y), sl, pxw(0.02), left));
  }
  const posts = [];
  if (seeF || seeL) posts.push([0, 0, seeF ? front : left]);
  if (seeF || seeR) posts.push([L, 0, seeF ? front : right]);
  if (seeL) posts.push([0, Wd, left]);
  if (seeR) posts.push([L, Wd, right]);
  for (const [a, b, pl] of posts) prims.push(S.line(p(a, b, y0), p(a, b, y0 + h), dark(c, 0.25), pxw(0.07), pl));
  if (seeF) prims.push(S.line(p(0.02, -0.003, y0 + 0.03), p(L - 0.02, -0.003, y0 + h - 0.03), dark(c, 0.2), pxw(0.05), front));
  if (d.fill) { // плоды горкой
    const fr = d.fruit ?? 0.07, list = [], fills = Array.isArray(d.fill) ? d.fill : [d.fill];
    for (let i = 0; i < 40; i++) list.push(p(fr + crnd() * (L - 2 * fr), fr + crnd() * (Wd - 2 * fr), y0 + h - 0.02 + fr * (0.5 + crnd() * 0.6)));
    list.sort((A, B) => B[2] - A[2] || A[1] - B[1]);
    for (const q of list) prims.push(...sphere(S, q[0], q[1], q[2], fr * (0.85 + crnd() * 0.3), jit(fills[Math.floor(crnd() * fills.length)], 0.12), { prims: true, spec: 0.5, ink: true }));
  }
  S.item(d.key ?? Math.min(Z, Z + u[2] * L, Z + w[2] * Wd, Z + u[2] * L + w[2] * Wd), prims, { name: 'crate' });
} });
/* ---------- объёмная зелень: листья — шарики с объёмной нормалью и обводкой, гроздьями (как листва гортензий улицы) ---------- */
let vegSeed = 11;
const vrnd = () => (vegSeed = (vegSeed * 16807) % 2147483647) / 2147483647;
const TAU = Math.PI * 2;
const LEAF = ['#5a8a30', '#4a7a28', '#6a9a38', '#3a6420', '#7aa840'];
const LEAF_SH = ['#90cc50', '#7cbc44', '#a2dc62', '#68a83a', '#b4e470']; // для плюща на теневых стенах
const ball = (S, q, r, c, o = {}) => sphere(S, q[0], q[1], q[2], r, c, { prims: true, flat: o.flat ?? 0.5, spec: o.spec ?? 0.2, ink: o.ink ?? true, wob: o.wob ?? 0.2 });
/** Гроздь из n листьев радиуса lr в круге R вокруг c (круг обращён к камере, середина ближе). */
function leafBalls(S, c, R, n, cols, lr) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = vrnd() * TAU, rr = R * Math.sqrt(vrnd()); pts.push([c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr * 0.85, c[2] - (1 - rr / R) * R * 0.5]); }
  pts.sort((A, B) => B[2] - A[2]);
  return pts.flatMap((q) => ball(S, q, lr * (0.8 + vrnd() * 0.45), jit(cols[Math.floor(vrnd() * cols.length)], 0.08)));
}
/** Цветки-шарики по передней стороне кроны. */
function blooms(S, c, R, n, cols, fr) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = vrnd() * TAU, rr = R * Math.sqrt(vrnd()); out.push(...ball(S, [c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr * 0.8, c[2] - R * 0.55 - vrnd() * 0.03], fr * (0.8 + vrnd() * 0.4), jit(cols[Math.floor(vrnd() * cols.length)], 0.06), { flat: 0.2, spec: 0.3 })); }
  return out;
}
/** Куст или деревце в глиняном горшке: {X, Z, Y, r (горшок), fr (крона), tree, flower (цвет или список), flowers, key}. */
registerWorldItem('pzBush', { doc: 'куст/деревце в горшке, листва гроздьями', build: (S, d) => {
  const { X, Z } = d, Y = d.Y ?? 0, r = d.r ?? 0.16, h = d.h ?? r * 1.7, key = d.key ?? Z - r;
  lathe(S, X, Z, PROFILES.pot(h, r), d.color || '#c0643a', { y0: Y, key, top: '#4a3020', spec: 0.04, pmat: 'terracotta' });
  const fr = d.fr ?? r * 1.9, tree = !!d.tree, leaf = d.leaf || LEAF, prims = [], occ = [];
  const cy = Y + h + (tree ? fr * 1.7 : fr * 0.6), zc = Z - r * 0.2;
  if (tree) prims.push(S.line([X, Y + h, Z], [X, cy - fr * 0.3, Z], '#5a3a24', Math.max(1, 0.035 * S.pxPerUnit(Z)), { ink: true }));
  const spots = (tree ? [[0, 0], [-0.55, -0.25], [0.55, -0.25], [-0.35, 0.45], [0.35, 0.45], [0, -0.5], [-0.62, 0.15], [0.62, 0.15]]
    : [[-0.6, -0.3], [0, -0.4], [0.6, -0.3], [-0.75, 0.12], [0.75, 0.12], [-0.3, 0.42], [0.3, 0.45], [0, 0.08]]).sort((A, B) => Math.hypot(...B) - Math.hypot(...A));
  const lr = fr * 0.11, cr = fr * 0.5;
  for (const [a, b] of spots) {
    const q = [X + a * fr, cy + b * fr * 0.85, zc - (1 - Math.hypot(a, b)) * fr * 0.3];
    prims.push(...leafBalls(S, q, cr, Math.round((cr / lr) * 9), leaf, lr));
    occ.push([q, cr]);
  }
  if (d.flowers) prims.push(...blooms(S, [X, cy, zc], fr * 0.85, d.flowers, [].concat(d.flower || '#f2c838'), fr * 0.085));
  const it = S.item(key - 0.06, prims, { name: 'bush', alpha: 0.65 });
  occluders(S, it, occ, 0.75);
} });
/** Плющ: плети из гроздочек листьев-шариков. pts: [[X, Y, Z, длина]]; side — вдоль стены, out — от стены к камере. */
registerWorldItem('pzIvy', { doc: 'плющ из листьев-шариков', build: (S, d) => {
  const side = d.side || [1, 0, 0], out = d.out || [0, 0, -1], lr = d.lr ?? 0.045, leaf = d.leaf || LEAF, prims = [];
  for (const [X, Y, Z, L0] of d.pts) for (let j = 0; j < (d.per ?? 4); j++) {
    const L = L0 * (0.55 + vrnd() * 0.45), off = (vrnd() - 0.5) * (d.spread ?? 0.3), ph = vrnd() * 6, m = Math.max(4, Math.round(L / (lr * 1.5)));
    for (let k = 0; k <= m; k++) {
      const t = k / m, sw = Math.sin(t * 5 + ph) * 0.05 + off;
      for (let b = 0; b < (k < 2 ? 3 : 2); b++) {
        const l = (vrnd() - 0.5) * lr * 2.2 + sw, o = 0.03 + vrnd() * 0.05;
        const q = [X + side[0] * l + out[0] * o, Y - L * t + (vrnd() - 0.5) * lr * 1.4, Z + side[2] * l + out[2] * o];
        prims.push(...ball(S, q, lr * (0.75 + vrnd() * 0.5) * (1 - t * 0.3), jit(leaf[Math.floor(vrnd() * leaf.length)], 0.08), { flat: 0.45 }));
      }
    }
  }
  S.item(d.key ?? Math.min(...d.pts.map((q) => q[2])) - 0.06, prims, { name: 'ivy', alpha: 0.7 });
} });
/** Ящик с цветами: вдоль X {x:[a,b], z (лицевая), y, h, d} или вдоль Z {X, z:[z0,z1], y, h, d}; листва гроздьями, цветки, короткие плети. */
registerWorldItem('pzPlanter', { doc: 'ящик с цветами, листва гроздьями', build: (S, d) => {
  const alongZ = Array.isArray(d.z), y = d.y, h = d.h ?? 0.2, dd = d.d ?? 0.25, c = d.color || '#9a6438';
  const [a0, a1] = alongZ ? d.z : d.x, at = (t) => (alongZ ? [d.X, 0, t] : [t, 0, d.z - dd / 2]);
  if (alongZ) box(S, d.X - dd / 2, d.X + dd / 2, y, y + h, a0, a1, c, { key: a0, name: 'planter' });
  else box(S, a0, a1, y, y + h, d.z - dd, d.z, c, { key: d.z - dd, name: 'planter' });
  const key = alongZ ? a0 - 0.02 : d.z - dd - 0.02, n = Math.max(2, Math.round((a1 - a0) / 0.2)), cr = 0.13, lr = 0.032, prims = [], occ = [];
  const front = alongZ ? [-1, 0, 0] : [0, 0, -1], fl = [].concat(d.flower || '#f4f2ea');
  for (let i = 0; i < n; i++) {
    const q0 = at(a0 + ((i + 0.5) * (a1 - a0)) / n), q = [q0[0] + front[0] * 0.04, y + h + cr * 0.45, q0[2] + front[2] * 0.04];
    prims.push(...leafBalls(S, q, cr, 30, d.leaf || LEAF, lr));
    prims.push(...blooms(S, q, cr * 0.9, d.flowers ?? 5, fl, 0.034));
    occ.push([q, cr]);
  }
  const it = S.item(key, prims, { name: 'planter_plants', alpha: 0.65 });
  occluders(S, it, occ, 0.75);
  if (d.trail) { // короткие плети через край
    const tp = [];
    for (let i = 0; i < d.trail; i++) {
      const q = at(a0 + vrnd() * (a1 - a0)), L = (d.trailLen ?? 0.3) * (0.5 + vrnd() * 0.5), m = Math.max(3, Math.round(L / 0.05));
      for (let k = 0; k <= m; k++) tp.push(...ball(S, [q[0] + front[0] * (dd * 0.5 + 0.03) + (alongZ ? 0 : (vrnd() - 0.5) * 0.05), y + h * 0.6 - (L * k) / m, q[2] + front[2] * (dd * 0.5 + 0.03) + (alongZ ? (vrnd() - 0.5) * 0.05 : 0)], 0.03 * (1 - (k / m) * 0.3), jit(LEAF[Math.floor(vrnd() * LEAF.length)], 0.08), { flat: 0.45 }));
    }
    S.item(key - 0.01, tp, { name: 'planter_trails', alpha: 0.7 });
  }
} });
/** Стоячий фонарь (без нижнего навершия — ставится на ящик): {p:[X, Yниза, Z], s, radius, energy}. */
registerWorldItem('pzLantern', { doc: 'стоячий фонарь', build: (S, d) => {
  const [X, Yb, Z] = d.p, s = d.s ?? 1, prims = [], hw = 0.17 * s, hh = 0.42 * s, iron = '#2c2428', sw = Math.max(0.6, 0.025 * s * S.pxPerUnit(Z));
  const y0 = Yb + 0.06 * s, y1 = y0 + hh, Yc = (y0 + y1) / 2, P = (a, y, b) => [X + a, y, Z + b], t = hw, bt = hw * 0.8;
  const glass = (ps) => face(S, ps, '#ffe2a0', { center: [X, Yc, Z], em: '#ffc860', ink: false, spec: 0.6 });
  prims.push(...face(S, [P(-bt * 1.25, Yb, -bt * 1.25), P(bt * 1.25, Yb, -bt * 1.25), P(bt * 1.25, y0, -bt * 1.25), P(-bt * 1.25, y0, -bt * 1.25)], iron, { center: [X, Yb, Z], sw }));
  prims.push(...glass([P(-bt, y0, -bt), P(bt, y0, -bt), P(t, y1, -t), P(-t, y1, -t)]));
  prims.push(...glass([P(bt, y0, -bt), P(bt, y0, bt), P(t, y1, t), P(t, y1, -t)]));
  prims.push(...glass([P(-bt, y0, bt), P(-bt, y0, -bt), P(-t, y1, -t), P(-t, y1, t)]));
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) prims.push(S.line(P(a * bt, y0, b * bt), P(a * t, y1, b * t), iron, sw, { ink: true }));
  prims.push(S.line(P(-t, y1, -t), P(t, y1, -t), iron, sw * 1.3, { ink: true }), S.line(P(-bt, y0, -bt), P(bt, y0, -bt), iron, sw * 1.3, { ink: true }));
  const cap = hw * 1.45, ch = 0.22 * s;
  for (const [a, b] of [[[-cap, -cap], [cap, -cap]], [[cap, -cap], [cap, cap]], [[-cap, cap], [-cap, -cap]]]) prims.push(...face(S, [P(a[0], y1, a[1]), P(b[0], y1, b[1]), P(0, y1 + ch, 0)], iron, { center: [X, y1 + ch / 3, Z], spec: 0.5, sw }));
  prims.push(...sphere(S, X, y1 + ch + 0.04 * s, Z, 0.045 * s, iron, { prims: true, spec: 0.6 }));
  S.item(d.key ?? Z - 0.3, prims, { name: 'lantern' });
  S.light([X, Yc, Z - 0.25], '#ffb860', d.radius ?? 2.2, d.energy ?? 0.55, 'lamp');
} });
/** Дары на полке алтаря (фронтально): банка, фонарик, носок — {Y (полка), Z, can, flashlight, sock (X каждого), s}. */
registerWorldItem('pzGifts', { doc: 'дары на полке: банка, фонарик, носок', build: (S, d) => {
  const { Y, Z } = d, s = d.s ?? 1, prims = [], sw = S.sw(Z) * 0.6;
  const poly = (ps, c, o = {}) => ({ t: 'poly', ps: ps.map(([x, y]) => [x, y, Z - (o.dz ?? 0)]), alb: c, n: o.n || [0, 0, -1], pl: [0, 0, -1, -(Z - (o.dz ?? 0))], base: true, ink: o.ink ?? true, sw, spec: o.spec ?? 0.3, op: 1, ...(o.ng ? { ng: o.ng } : {}) });
  const ell = (ex, ey, rx, ry, n = 16) => Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2; return [ex + Math.cos(t) * rx, ey + Math.sin(t) * ry]; });
  const roundN = (x0, x1) => ({ kind: 'linear', from: S.P([x0, Y, Z]), to: S.P([x1, Y, Z]), stops: [[0, [-0.8, 0, -1]], [0.5, [0, 0.1, -1]], [1, [0.8, 0, -1]]] });
  // банка: красная, белая полоса, светлая крышка
  { const x = d.can, r = 0.08 * s, h = 0.22 * s;
    prims.push(poly([[x - r, Y], [x + r, Y], [x + r, Y + h], [x - r, Y + h]], '#c8302a', { spec: 0.7, ng: roundN(x - r, x + r) }));
    prims.push(poly([[x - r, Y + h * 0.42], [x + r, Y + h * 0.42], [x + r, Y + h * 0.62], [x - r, Y + h * 0.62]], '#f4ece0', { dz: 0.002, ink: false, ng: roundN(x - r, x + r) }));
    prims.push(poly(ell(x, Y + h, r, r * 0.3), '#d8d0c8', { n: [0, 1, -0.5], spec: 0.8, dz: 0.003 })); }
  // фонарик лёжа: синий корпус, хромированная головка, стекло
  { const x = d.flashlight, L = 0.34 * s, r = 0.05 * s, hd = 0.08 * s;
    prims.push(poly([[x - L / 2, Y], [x + L / 2 - hd, Y], [x + L / 2 - hd, Y + 2 * r], [x - L / 2, Y + 2 * r]], '#2f5aa8', { spec: 0.6 }));
    prims.push(poly([[x + L / 2 - hd, Y - 0.012 * s], [x + L / 2, Y - 0.02 * s], [x + L / 2, Y + 2 * r + 0.02 * s], [x + L / 2 - hd, Y + 2 * r + 0.012 * s]], '#c8ccd4', { spec: 0.9 }));
    prims.push(poly([[x - L / 2 + 0.05 * s, Y + r * 1.6], [x - L / 2 + 0.11 * s, Y + r * 1.6], [x - L / 2 + 0.11 * s, Y + r * 2.15], [x - L / 2 + 0.05 * s, Y + r * 2.15]], '#1e2a44', { dz: 0.003 })); }
  // носок: розовый, буквой «Г» носком вправо, белая резинка
  { const x = d.sock, k = s;
    prims.push(poly([[x - 0.055 * k, Y + 0.36 * k], [x + 0.055 * k, Y + 0.36 * k], [x + 0.055 * k, Y + 0.11 * k], [x + 0.17 * k, Y + 0.09 * k], [x + 0.19 * k, Y + 0.03 * k], [x + 0.15 * k, Y], [x - 0.055 * k, Y]], '#e8608a', { spec: 0.12 }));
    prims.push(poly([[x - 0.055 * k, Y + 0.36 * k], [x + 0.055 * k, Y + 0.36 * k], [x + 0.055 * k, Y + 0.3 * k], [x - 0.055 * k, Y + 0.3 * k]], '#f4ece0', { dz: 0.002 }));
    prims.push(poly([[x + 0.1 * k, Y + 0.005], [x + 0.17 * k, Y + 0.02 * k], [x + 0.18 * k, Y + 0.07 * k], [x + 0.12 * k, Y + 0.07 * k]], '#c84a72', { dz: 0.002, ink: false })); }
  S.item(d.key ?? Z - 0.01, prims, { name: 'gifts' });
} });
/** Приставная лестница от a до b (низ, верх); hole: {X, Z, r} — часть ниже земли видна только в проёме колодца. */
registerWorldItem('pzLadder', { doc: 'приставная лестница', build: (S, d) => {
  const P0 = d.a, P1 = d.b, w = d.w ?? 0.44, c = d.color || '#9a6434', side = [w / 2, 0, 0], n = d.rungs ?? 9;
  const lw = (z, k = 0.05) => Math.max(1, k * S.pxPerUnit(z));
  let hole = null;
  if (d.hole) { hole = []; for (let i = 0; i < 48; i++) { const t = (i / 48) * Math.PI * 2; hole.push([d.hole.X + Math.cos(t) * d.hole.r, 0.004, d.hole.Z + Math.sin(t) * d.hole.r]); } }
  const tg = hole ? Math.min(1, Math.max(0, -P0[1] / (P1[1] - P0[1]))) : 0; // доля длины ниже земли
  const lerp = (t) => add(P0, mul(sub(P1, P0), t));
  const below = [], above = [];
  for (const sg of [-1, 1]) {
    const a = add(P0, mul(side, sg)), g = add(lerp(tg), mul(side, sg)), b = add(P1, mul(side, sg));
    if (tg > 0) below.push(S.line(a, g, c, lw(g[2]), { ink: true }));
    above.push(S.line(g, b, c, lw(b[2]), { ink: true }));
  }
  for (let i = 1; i <= n; i++) { const t = i / (n + 0.6), p = lerp(t); (t < tg ? below : above).push(S.line(sub(p, side), add(p, side), dark(c, 0.12), lw(p[2], 0.035), { ink: true })); }
  if (below.length) S.item(d.keyBelow ?? Math.max(P0[2], P1[2]), below.map((q) => ({ ...q, clip: hole })), { name: 'ladder_in', force: true });
  S.item(d.key ?? Math.min(P0[2], P1[2]) - 0.05, above, { name: 'ladder' });
} });
/** Брус-раскос между точками a и b на плоскости X = const (лента шириной w, смотрит в −X). */
registerWorldItem('pzBeam', { doc: 'брус-раскос', build: (S, d) => {
  const P0 = d.a, P1 = d.b, w = d.w ?? 0.12, c = d.color || WOOD, dir = sub(P1, P0), L = Math.hypot(...dir);
  const off = mul([0, -dir[2] / L, dir[1] / L], w / 2), ps = [sub(P0, off), sub(P1, off), add(P1, off), add(P0, off)];
  S.item(d.key ?? Math.min(P0[2], P1[2]) - 0.03, face(S, ps, c, { center: add(mul(add(P0, P1), 0.5), [1, 0, 0]), spec: 0.2 }), { name: 'beam', pmat: 'woodP' });
} });

/* ---------- грани ---------- */
const FLw = FXp(XL, 8.5, ZBk + 0.5, 12); // левый дом
const FB = FZ(ZBk, 12); // фасады за мостом
const FRw = FXm(XR, 14.6, 27, 13); // правый дом за балконом
const FS = FZ(14.6, 4); // розовый магазин «Фрукты»
const ZSH = 19.0; // магазин: задняя граница (боковая сторона X = 5.1 — лавка под маркизой)
const FSs = FXm(5.1, 14.6, ZSH, 3.2);
const FBooth = FZ(ZB + 1.19, 3);

/* ---------- гортензии (как на улице): шаблон листьев и шапок вокруг горшка, в пикселях при ширине горшка 94 px ---------- */
const HYD_LEAVES = [[-54, -111, 26], [-12, -99, 28], [33, -113, 26], [58, -141, 20], [-62, -146, 20], [0, -131, 26], [-30, -120, 22], [30, -128, 22]];
const HYD_HEADS = [[-47, -165, 24], [-12, -185, 24], [24, -193, 24], [46, -159, 22], [0, -139, 24], [-40, -136, 20], [62, -132, 18], [-62, -168, 18]];
const PINK_H = ['#e8a0c8', '#f0b8d8', '#d888b8', '#f4c4dc'], WHITE_H = ['#e6dcea', '#ecdcd8', '#dcd6ea', '#f0e4dc'];
/** Гортензия в горшке на (X, Z) и высоте Y: r — радиус горшка, м; key — по передней кромке горшка. */
const hyd = (X, Z, o = {}) => {
  const Y = o.Y ?? 0, r = o.r ?? 0.22, gy = hor + (camH * f) / Z, px = cx + (X * f) / Z, py = gy - (Y * f) / Z;
  const potW = (2 * r * f) / Z, k = potW / 94, sc = ([x, y, rr]) => [px + x * k, py + y * k, rr * k];
  return { type: 'hydrangea', Z, gy, cx, pot: [px, py], potW, potH: 88 * k, keyZ: o.key ?? Z - r, flower: o.flower || PINK_H,
    ...(o.potColor ? { potColor: o.potColor } : {}), leaves: HYD_LEAVES.map(sc), heads: HYD_HEADS.map(sc) };
};

/* ---------- колодец: конусы по кругу и лента ---------- */
const CONES = [[450, 890], [530, 845], [683, 828], [890, 858], [960, 945], [745, 1010]].map(([x, y]) => gp(x, y));
const coneH = 0.5;

const items = [
  /* ---------- земля ---------- */
  { type: 'flatGround', x: [XL, XR], z: [8.4, ZBk], mat: false, color: '#bc9480', pmat: 'pavers', spec: 0.3 },
  { type: 'flatGround', key: 1e6 + 1, x: [-2.0, 2.0], z: [ZBk - 0.05, 62], mat: false, color: '#a88a7c', pmat: 'cobbleFar', spec: 0.25 },
  { type: 'flatGround', key: 1e6 - 1, x: [XL, XR], y: DECK, z: [ZB, ZBk], mat: false, color: '#c8a898', pmat: 'terrace' },

  /* ---------- переулок за мостом и фасады над мостом ---------- */
  { type: 'house', key: ZBk + 0.6, x: [XL, -2.0], z: [ZBk, 48], h: 11.5, color: CREAM, mat: 'none', pmat: 'plaster', facades: ['right'], roofType: 'flat', litP: 0.5, shut: TEAL },
  { type: 'house', key: ZBk + 0.6, x: [2.0, XR], z: [ZBk, 48], h: 12, color: '#f4cc94', mat: 'none', pmat: 'plaster', facades: ['left'], roofType: 'flat', litP: 0.5, shut: RED },
  { type: 'house', key: 48.5, x: [-5, 5], z: [48, 54], h: 8.6, color: '#eec4a4', mat: 'none', pmat: 'plaster', facades: ['front'], roofType: 'gable', roofH: 1.6, tiles: 'barrel', eave: true, roofPmat: 'roofTile', roof: '#d8704a', litP: 0.7, shut: BLUE },
  { type: 'bunting', from: [-2, 6.4, 37], to: [2, 6.5, 37], sag: 0.45, n: 8, w: 0.36, h: 0.32 },
  { type: 'bunting', from: [-2, 7.4, 31], to: [2, 7.3, 31], sag: 0.5, n: 8, w: 0.4, h: 0.34, colors: ['#e8b830', '#c84a3a', '#3a8aa0', '#f4f0e8', '#e88aa0'] },
  { type: 'fairy', from: [-2, 5.6, 28.5], to: [2, 5.5, 29], sag: 0.4, n: 11, r: 0.045, every: 3, radius: 2.6 },
  { type: 'fairy', from: [-2, 5.2, 41], to: [2, 5.3, 41], sag: 0.35, n: 9, r: 0.045, every: 3, radius: 2.6 },
  // окна фасадов над мостом (по референсу), ящики с цветами
  win(FB, 560, 218, 602, 292, { lit: true, shut: BLUE }), win(FB, 668, 222, 732, 292, { lit: true, shut: BLUE }),
  win(FB, 548, 40, 600, 128, { lit: true, shut: TEAL }), win(FB, 662, 48, 722, 130, { lit: false, shut: TEAL }),
  win(FB, 1166, 28, 1224, 116, { lit: true, shut: RED }), win(FB, 1286, 30, 1338, 108, { lit: false, shut: RED }),
  win(FB, 1268, 222, 1326, 292, { lit: true, shut: TEAL }), win(FB, 1166, 222, 1222, 292, { lit: false, shut: TEAL }),
  win(FB, 1420, 40, 1470, 120, { lit: true, shut: TEAL }),
  { type: 'planter', x: [X_(660, ZBk), X_(735, ZBk)], y: Y_(132, ZBk), z: ZBk - 0.01, h: 0.18, flower: '#e86a5a', trail: 3, trailLen: 0.4 },
  { type: 'planter', x: [X_(1160, ZBk), X_(1230, ZBk)], y: Y_(120, ZBk), z: ZBk - 0.01, h: 0.18, flower: '#f4f0ea', trail: 3, trailLen: 0.5 },
  { type: 'planter', x: [X_(1414, ZBk), X_(1476, ZBk)], y: Y_(124, ZBk), z: ZBk - 0.01, h: 0.18, flower: '#f08aa0', trail: 2, trailLen: 0.3 },
  { type: 'pzIvy', key: ZBk - 0.2, per: 5, lr: 0.06, spread: 0.3, pts: [[-2.25, 8.2, ZBk - 0.03, 3.4], [-2.5, 8.2, ZBk - 0.03, 3.8], [-2.75, 8.0, ZBk - 0.03, 2.8]] },

  /* ---------- левый дом: арка к крыльцу, окна, плющ ---------- */
  { type: 'box', key: ZBk + 0.7, x: [-14, XL], y: [0, 12], z: [8.4, ZBk + 0.5], color: OCHRE, pmat: 'plaster' },
  { type: 'box', key: ZBk + 0.65, x: [XL - 0.1, XL + 0.06], y: [3.72, 3.88], z: [8.4, ZBk + 0.5], color: STONE_HI, pmat: 'stone' },
  { type: 'archDoor', on: FLw, a: 13.0 - 8.5, w: 2.4, spring: 2.25, color: '#dcbc9c', ring: 0.36, dark: '#3a2622', reveal: '#7a5444', depth: 0.9, stones: 15, key: 12.9 },
  { type: 'lantern', p: [XL + 0.5, 3.0, 12.2], s: 0.75, wall: -1, key: 12.0, radius: 3.5, energy: 1.2 },
  // окна: первый ряд над аркой и лестницей, второй — у верха кадра
  ...[[12.3, true], [14.6, false], [17.3, true], [19.9, true], [22.4, false], [25.0, true]].map(([Zc, lit]) => winXp(FLw, Zc, 4.15, { lit, box: Zc < 20, h: 1.25 })),
  ...[[17.3, false], [19.9, true], [22.4, true], [25.0, false]].map(([Zc, lit]) => winXp(FLw, Zc, 6.45, { lit, h: 1.15, shut: Zc > 21 ? RED : SHUT })),
  { type: 'brickPatch', on: FLw, a: 15.8 - 8.5, b: 6.1, w: 0.9, h: 0.7 },
  { type: 'brickPatch', on: FLw, a: 21.0 - 8.5, b: 3.2, w: 0.7, h: 0.5 },
  // плющ с каменного пояса (y 3.88) между аркой и лестницей: ниже окон, выше фонарика на стене
  { type: 'pzIvy', key: 15.7, per: 3, leaf: LEAF_SH, lr: 0.055, side: [0, 0, 1], out: [1, 0, 0], spread: 0.3, pts: [[XL + 0.02, 3.86, 16.0, 1.5], [XL + 0.02, 3.86, 16.25, 1.2], [XL + 0.02, 3.86, 16.45, 1.6]] },
  { type: 'pzIvy', key: 11.8, per: 3, leaf: LEAF_SH, side: [0, 0, 1], out: [1, 0, 0], spread: 0.15, pts: [[XL + 0.3, 4.05, 11.95, 0.5]] },
  { type: 'pzIvy', key: 16.9, per: 3, leaf: LEAF_SH, lr: 0.05, side: [0, 0, 1], out: [1, 0, 0], spread: 0.2, pts: [[XL + 0.3, 4.05, 17.15, 1.4], [XL + 0.3, 4.05, 17.45, 1.0]] },

  /* ---------- левая лестница на мост ---------- */
  { type: 'stairs', key: ZS1 + 0.01, // раньше боковой стенки (у её звеньев key = z звена)
    x: [XL, -4.66], z: [ZS0, ZS1], h: DECK, steps: NS, color: RISER, top: TREAD, nosing: 0.045, joints: 0.55, mat: 'none', pmat: 'stepStone' },
  { type: 'stepWall', x: [-4.74, -4.64], z: [ZS0, ZS1], y: [0, DECK], steps: NS, over: -0.03, color: '#d0ac94', cap: '#e8d0bc', lights: true, pmat: 'ashlarB' },
  { type: 'rail', from: [-4.69, 0.25, ZS0 + 0.12], to: [-4.69, DECK + 0.06, ZS1], h: 0.95, iron: true, step: 0.3, color: '#7a4424', key: ZS0 - 0.25 },
  // горшки ровным рядом под боковой стенкой лестницы (её грань x = −4.64): ниже верха стенки, на марш не заходят
  { type: 'pzBush', X: -4.42, Z: 18.5, r: 0.14, fr: 0.27, flower: ['#f2c030', '#f4d860', '#e8a020'], flowers: 16 },
  hyd(-4.42, 19.55, { r: 0.15, flower: PINK_H }),
  { type: 'pzBush', X: -4.42, Z: 20.6, r: 0.14, fr: 0.27, flower: ['#e8603a', '#f29040', '#d84a30'], flowers: 16 },
  hyd(-4.42, 21.65, { r: 0.15, flower: ['#b89ae0', '#c8a8e8', '#a888d8', '#d8b0e0'] }),

  /* ---------- мост: арки, карниз, пол, балюстрада ---------- */
  { type: 'box', key: ZB + 0.02, x: [-4.66, -4.27], y: [0, 3.32], z: [ZB, ZBk], color: BRIDGE, pmat: 'ashlarB' },
  { type: 'box', key: ZB - 0.07, x: [-4.66, -4.24], y: [0, 3.32], z: [ZB - 0.06, ZB + 0.02], color: STONE_HI, pmat: 'stone' }, // пилястра у ниши-алтаря
  { type: 'arch', key: ZB, x: [-4.05, -1.65], z: ZB, spring: 1.82, thick: 0.62, margin: 0.22, top: 3.32, color: BRIDGE, back: null, stones: 13, stoneColor: '#e6ccb2', pmat: 'ashlarB' },
  { type: 'arch', key: ZB, x: [-1.23, 1.42], z: ZB, spring: 1.7, thick: ZBk - ZB, margin: 0.2, top: 3.32, color: BRIDGE, back: null, stones: 13, stoneColor: '#e6ccb2', pmat: 'ashlarB' },
  { type: 'box', key: ZB + 0.02, x: [1.62, 2.1], y: [0, 3.32], z: [ZB, ZBk], color: BRIDGE, pmat: 'ashlarB' },
  { type: 'box', key: ZB - 0.07, x: [1.59, 2.13], y: [0, 3.32], z: [ZB - 0.06, ZB + 0.02], color: STONE_HI, pmat: 'stone' }, // пилястра между арками
  { type: 'arch', key: ZB, x: [2.3, 4.02], z: ZB, spring: 2.2, thick: ZBk - ZB, margin: 0.2, top: 3.32, color: BRIDGE, back: null, stones: 11, stoneColor: '#e6ccb2', pmat: 'ashlarB' },
  { type: 'box', key: ZB + 0.02, x: [4.22, XR], y: [0, 3.32], z: [ZB, ZBk], color: BRIDGE, pmat: 'ashlarB' },
  { type: 'box', key: ZB - 0.12, x: [-4.76, XR], y: [3.32, DECK], z: [ZB - 0.12, ZBk], color: STONE_HI, pmat: 'stone' },
  { type: 'balustrade', x: [-4.62, XP + 0.05], y: DECK, z: ZB + 0.05, h: 1.0, step: 0.22, color: '#ecd8c0', posts: [-4.45, -1.96, 2.54] },
  ...[-1.96, 2.54].flatMap((X) => [
    { type: 'box', key: ZB - 0.2, x: [X - 0.19, X + 0.19], y: [DECK + 1.05, DECK + 1.42], z: [ZB - 0.14, ZB + 0.24], color: '#ecd8c0', pmat: 'stone' },
    { type: 'box', key: ZB - 0.22, x: [X - 0.23, X + 0.23], y: [DECK + 1.42, DECK + 1.5], z: [ZB - 0.18, ZB + 0.28], color: STONE_HI },
    { type: 'lantern', p: [X, DECK + 1.5 + 0.24, ZB + 0.05], s: 1.0, key: ZB - 0.3, radius: 4, energy: 1.2 },
  ]),
  // ящики с белыми цветами на карнизе, плющ с карниза
  ...[[-3.85, -2.4], [0.98, 2.12], [2.85, 3.78]].map(([a, b]) => ({ type: 'pzPlanter', x: [a, b], y: DECK - 0.12, z: ZB - 0.12, h: 0.22, flower: ['#f6f2ea', '#f0ece4', '#fff8ee'], trail: 4, trailLen: 0.2 })), // короткие плети: не свисают в проёмы арок
  // знамя с лимоном на балюстраде
  { type: 'banner', X: X_(990, ZB), z: ZB - 0.24, y: [Y_(455, ZB), DECK + 0.98], w: 1.04, color: '#b8282a', border: '#e8b830', emblem: '#f2c430', key: ZB - 0.26 },

  /* ---------- ниша-алтарь в левой арке ---------- */
  { type: 'box', key: ZB + 0.63, x: [-4.06, -1.64], y: [0, 3.1], z: [ZB + 0.62, ZB + 0.72], color: '#e8b47e', pmat: 'plaster' },
  { type: 'pzPlaque', X: -2.86, Y: 2.42, Z: ZB + 0.62, rx: 0.48, ry: 0.27, color: '#f2b830' },
  { type: 'bookshelf', x: [-3.92, -1.78], z: ZB + 0.6, y: [0.98, 2.04], rows: 2, color: '#b88858' },
  { type: 'pzGifts', Y: 1.02, Z: ZB + 0.5, can: -3.55, flashlight: -2.92, sock: -2.38, s: 1.25 },
  { type: 'box', key: ZB + 0.04, x: [-3.98, -1.72], y: [0, 0.46], z: [ZB + 0.05, ZB + 0.6], color: '#c8a07a', pmat: 'stone' },
  { type: 'cushions', pts: [[-3.62, 0.46, ZB + 0.14, 0.42, 0.34, '#e8c040'], [-3.12, 0.46, ZB + 0.16, 0.44, 0.34, '#8aa860'], [-2.66, 0.46, ZB + 0.18, 0.4, 0.3, '#d86a4a']] },
  { type: 'box', key: ZB + 0.12, x: [-2.4, -1.9], y: [0.46, 0.74], z: [ZB + 0.2, ZB + 0.5], color: '#b07838' },
  { type: 'light', p: [-2.86, 2.0, ZB + 0.25], color: '#ffc070', radius: 2.6, energy: 0.8 },

  /* ---------- будка «Концерты» в правой арке ---------- */
  { type: 'box', key: ZBk + 0.05, x: [2.1, 4.22], y: [0, 3.3], z: [ZBk, ZBk + 0.1], color: '#5a4444' },
  // будка констебля: тёмно-синяя, табличка, окошко со светом, объявления, синий фонарь на крыше
  { type: 'box', key: ZB + 1.2, x: [2.6, 3.76], y: [0, 2.05], z: [ZB + 1.2, ZB + 2.2], color: '#24366a', pmat: 'woodP' },
  { type: 'box', key: ZB + 1.13, x: [2.53, 3.83], y: [2.05, 2.15], z: [ZB + 1.13, ZB + 2.27], color: '#1a264a' },
  { type: 'box', key: ZB + 1.3, x: [3.08, 3.28], y: [2.15, 2.22], z: [ZB + 1.6, ZB + 1.8], color: '#1a264a' },
  { type: 'sphere', key: ZB + 1.55, X: 3.18, Y: 2.32, Z: ZB + 1.7, r: 0.1, color: '#8ab4f0', emissive: '#4a84e0' },
  { type: 'light', p: [3.18, 2.4, ZB + 1.4], color: '#7aa8ff', radius: 1.8, energy: 0.6 },
  { type: 'plate', on: FBooth, a: A(2.66), b: 1.66, w: 1.04, h: 0.3, lines: ['КОНСТЕБЛЬ'], size: 0.15, color: '#1a264a', border: '#e8e4dc', textColor: '#f4f0e6', m: 0.035, key: ZB + 1.15 },
  { type: 'window', on: FBooth, a: A(2.82), b: 0.95, w: 0.72, h: 0.56, lit: true, shut: null, ajar: 0, box: false, key: ZB + 1.16 },
  { type: 'poster', on: FBooth, a: A(2.74), b: 0.28, w: 0.34, h: 0.46, color: '#f4eee0', frame: '#d8d0c0', art: 'note', key: ZB + 1.16 },
  { type: 'poster', on: FBooth, a: A(3.2), b: 0.32, w: 0.4, h: 0.3, color: '#f2d070', frame: '#c89a40', art: 'text', key: ZB + 1.16 },

  /* ---------- флагшток ---------- */
  { type: 'box', key: 22.38, x: [3.8, 4.14], y: [0, 0.32], z: [22.33, 22.67], color: STONE_HI, pmat: 'stone' },
  { type: 'pole', X: 3.97, Z: 22.5, h: 6.0, r: 0.06, color: '#d8a030', key: 22.3 },
  { type: 'sphere', key: 22.28, X: 3.97, Y: 6.1, Z: 22.5, r: 0.11, color: '#e8b030', spec: 0.9 },
  { type: 'pzRope', X: 3.97, Z: 22.5, top: 5.85, cleat: 1.25, key: 22.25 },

  /* ---------- правый дом, балкон на столбах, лавка ---------- */
  { type: 'box', key: 27.3, x: [XR, 14], y: [0, 13], z: [14.6, 27], color: '#f2c49c', pmat: 'plaster' },
  ...[16.5, 19.6, 22.7, 25.6].map((Zc, i) => winXm(FRw, Zc, 5.05, { lit: i % 2 === 0, h: 1.3, shut: i % 2 ? BLUE : TEAL })),
  ...[19.6, 22.7, 25.6].map((Zc, i) => winXm(FRw, Zc, 7.3, { lit: i !== 1, h: 1.2, shut: TEAL })),
  winXm(FRw, 20.6, 1.0, { lit: true, h: 1.3, w: 1.1, shut: null }),
  { type: 'lantern', p: [XR - 0.6, Y_(100, 26.4), 26.4], s: 0.8, wall: 1, key: 26.2, radius: 3.5 },
  { type: 'pzIvy', key: 17.8, per: 4, leaf: LEAF_SH, side: [0, 0, 1], out: [-1, 0, 0], spread: 0.2, lr: 0.05, pts: [[XR - 0.03, 6.5, 18.05, 1.4]] },
  { type: 'pzBush', X: 4.95, Z: 22.0, r: 0.22, fr: 0.42, tree: true, flower: '#f2d040', flowers: 14, key: 21.75 },
  // столбы, раскосы, настил, перила
  ...[14.0, 18.6].flatMap((Z) => [
    { type: 'box', key: Z - 0.19, x: [XP - 0.13, XP + 0.13], y: [0.22, Z < 14.5 ? BAL + 1.15 : BAL - 0.2], z: [Z - 0.13, Z + 0.13], color: WOOD, pmat: 'woodP' },
    { type: 'box', key: Z - 0.18, x: [XP - 0.17, XP + 0.17], y: [0, 0.22], z: [Z - 0.17, Z + 0.17], color: STONE, pmat: 'stone' },
  ]),
  ...[[14.0, 1], [18.6, -1], [18.6, 1]].map(([Z, s]) => ({ type: 'pzBeam', a: [XP - 0.14, BAL - 1.0, Z + s * 0.12], b: [XP - 0.14, BAL - 0.2, Z + s * 0.95], w: 0.11, color: WOOD, key: Math.min(Z, Z + s * 0.95) - 0.15 })),
  { type: 'box', key: 13.84, x: [XP - 0.16, XR], y: [BAL - 0.24, BAL], z: [13.84, ZB - 0.14], color: WOOD, pmat: 'woodP' },
  { type: 'rail', from: [XP - 0.08, BAL, 14.0], to: [XP - 0.08, BAL, ZB - 0.2], h: 1.05, step: 0.62, color: WOOD_LT, key: 13.8 },
  { type: 'rail', from: [XP - 0.08, BAL, 13.92], to: [XR, BAL, 13.92], h: 1.05, step: 0.26, color: WOOD, key: 13.76 },
  // на балконе: цветы в ящиках на перилах и горшки
  { type: 'pzPlanter', X: XP - 0.05, z: [15.0, 16.6], y: BAL + 1.07, h: 0.2, d: 0.26, flower: ['#f6f2ec', '#f0e8f0'] },
  { type: 'pzPlanter', X: XP - 0.05, z: [19.4, 20.8], y: BAL + 1.07, h: 0.2, d: 0.26, flower: ['#f6f2ec', '#f0e8f0'] },
  hyd(5.25, 14.6, { Y: BAL, r: 0.22, flower: WHITE_H }),
  { type: 'pzBush', X: 6.2, Z: 15.0, Y: BAL, r: 0.2, fr: 0.4, tree: true, flower: '#f2d040', flowers: 12, key: 14.78 },
  hyd(5.3, 18.2, { Y: BAL, r: 0.18, flower: PINK_H }),
  // розовый магазин «Фрукты»: вывеска, дверь, витрина с плакатами; прилавок под маркизой сбоку
  { type: 'box', key: ZSH - 0.05, x: [5.1, XR + 0.4], y: [0, BAL - 0.24], z: [14.6, ZSH], color: PINK, pmat: 'plasterRose' }, // key по дальнему краю: прилавок и столбы перед боковой стеной
  { type: 'pzStall', on: FSs, a: 0.2, b: 1.0, w: ZSH - 14.6 - 0.4, h: 1.5, rows: 3, key: ZSH - 0.1, radius: 3, energy: 1.0 },
  { type: 'plate', on: FS, a: A(5.3), b: 2.36, w: 1.42, h: 0.46, lines: ['ФРУКТЫ'], size: 0.27, color: '#f6ecdc', border: '#b07a40', textColor: '#c8302a', m: 0.05, key: 14.5 },
  { type: 'door', on: FS, a: A(5.4), b: 0, w: 0.64, h: 1.96, color: '#c8506a', key: 14.56 },
  hyd(6.45, 14.4, { r: 0.13, flower: WHITE_H, key: 14.2 }), // справа от двери, перед стеной // с наличником 0.18: от угла 5.1 до 5.3
  { type: 'poster', on: FS, a: A(6.5), b: 1.42, w: 0.3, h: 0.42, color: '#eef4dc', frame: '#e8dcc0', art: 'apple', key: 14.54 },
  { type: 'poster', on: FS, a: A(6.5), b: 0.88, w: 0.3, h: 0.42, color: '#f6ecf2', frame: '#e8dcc0', art: 'grapes', key: 14.54 },
  { type: 'awningX', X: 5.1, z: [14.7, ZSH - 0.1], y: 2.6, depth: 0.72, drop: 0.36, colors: ['#c8302a', '#f4ece0'], key: 14.6 },
  { type: 'box', key: ZSH - 0.15, x: [4.58, 5.1], y: [0, 0.95], z: [14.76, ZSH - 0.12], color: WOOD_LT, pmat: 'woodP' }, // key по дальнему краю: горшок и доска перед прилавком — поверх
  ...[[14.82, '#d83a2a'], [15.3, '#f0a030'], [15.78, '#8a4aa8'], [16.26, '#9ac040'], [16.74, '#f2d040'], [17.22, '#e04a30'], [17.7, '#9ac040'], [18.18, '#f0a030']].map(([Z, c]) => ({ type: 'pzCrate', o: [4.62, Z], len: 0.44, wid: 0.44, h: 0.16, y0: 0.95, color: '#a86a38', fill: c, fruit: 0.045, key: Z - 0.2 })),
  { type: 'bunches', kind: 'banana', pts: [[4.52, 2.22, 15.1], [4.52, 2.22, 15.7], [4.52, 2.22, 16.3], [4.52, 2.22, 16.9], [4.52, 2.22, 17.5], [4.52, 2.22, 18.1]], key: 14.7 },
  { type: 'fairy', from: [4.42, 2.55, 14.75], to: [4.42, 2.55, ZSH - 0.15], sag: 0.1, n: 10, r: 0.03, every: 3, radius: 2, key: 14.6 },
  { type: 'aframe', ...xz(1550, 842), h: 0.92, w: 0.56, kind: 'chalk', ang: -18, key: 14.8 }, // лицом к камере
  hyd(4.15, 17.35, { r: 0.2, flower: WHITE_H }),

  /* ---------- фонтан на мозаике ---------- */
  { type: 'pzMosaic', X: FX, Z: FZc, R: 2.55, n: 16 },
  { type: 'fountain2', X: FX, Z: FZc, R: 1.5, color: '#d4bca2' },

  /* ---------- колодец: бортик, лестница, конусы, лента, знак ---------- */
  { type: 'pit', X: PX, Z: PZ, R: 1.8, r: 1.38, depth: 1.8, stone: '#bca688' },
  { type: 'pzLadder', a: [PX + 0.55, -1.6, PZ + 0.45], b: [PX + 0.7, 0.42, PZ + 1.28], hole: { X: PX, Z: PZ, r: 1.38 }, keyBelow: PZ + 0.6, key: PZ + 1.2 },
  ...CONES.map(([X, Z]) => ({ type: 'cone', X, Z, h: coneH })),
  { type: 'tape', pts: [...CONES, CONES[0]].map(([X, Z]) => [X, coneH * 0.82, Z]), seg: 0.14, w: 0.03, sag: 0.1, key: PZ - 2.3 },
  { type: 'aframe', ...xz(1062, 1002), h: 0.64, w: 0.5, kind: 'work', ang: 12, key: 11.3 }, // вне кольца конусов, не на бортике

  /* ---------- земля: люк (крышка — предмет игры), решётка, лужи, листья и бумажки ---------- */
  { type: 'manholeDeco', ...xz(592, 735), r: 0.44 },
  { type: 'grate', ...xz(1345, 975), w: 0.66, d: 0.46 },
  { type: 'puddle', ...xz(1180, 910), rx: 0.62, rz: 0.4, color: '#7a6a88' },
  { type: 'puddle', ...xz(435, 1040), rx: 0.5, rz: 0.36, color: '#7a6a88' },
  { type: 'puddle', ...xz(880, 790), rx: 0.35, rz: 0.22, color: '#7a6a88' },
  { type: 'litter', x: [-5.5, 6], z: [10.2, 22.5], n: 70, s: 0.06,
    paper: [[...gp(1325, 850), 0.3, 0.22, 0.4, '#f4ece6'], [...gp(365, 882), 0.26, 0.2, -0.5, '#f0a8c0'], [...gp(1158, 792), 0.22, 0.16, 0.9, '#f4ece6'], [...gp(1120, 1050), 0.3, 0.22, 0.2, '#f0c8a0']] },

  /* ---------- левый передний угол: ящики, ведро с гортензией, плед, фонарь ---------- */
  { type: 'pzCrate', o: [-5.85, 12.35], len: 0.85, wid: 0.75, h: 0.72, color: '#a8743c' },
  { type: 'pzCrate', o: [-5.8, 12.42], len: 0.75, wid: 0.62, h: 0.5, y0: 0.72, color: '#9a6834', key: 12.3 }, // верхний — после нижнего
  { type: 'pzCrate', o: [-4.95, 12.0], len: 0.6, wid: 0.5, h: 0.78, color: '#a06a36' },
  { type: 'pzLantern', p: [-4.65, 0.78, 12.25], s: 0.7, key: 11.9, radius: 2.2, energy: 0.55 },
  { type: 'pzCrate', o: [-5.75, 10.35], len: 1.0, wid: 0.7, h: 0.62, color: '#a8743c' },
  hyd(-5.25, 10.7, { Y: 0.62, r: 0.22, flower: PINK_H, potColor: '#9a9ca4', key: 10.3 }), // на ящике: после ящика (его key 10.35)
  { type: 'pzCrate', o: [-4.45, 11.3], len: 0.8, wid: 0.6, h: 0.64, color: '#a8743c', fill: '#f2d040', fruit: 0.07 },

  /* ---------- гирлянды над двором ---------- */
  { type: 'bunting', path: [[220, -40], [600, 22], [950, 46], [1300, 36], [1700, -30]].map(([x, y]) => [X_(x, 12.5), Y_(y, 12.5), 12.5]),
    n: 13, w: 0.56, h: 0.47,
    colors: ['#2a7a80', '#f4f0e8', '#2f5aa8', '#e85a8a', '#c8302a', '#e8a030', '#2a8a7a', '#f0e8e0', '#3a5ab0', '#f08aa8', '#d8402a', '#f2c030', '#2a9a8a'] },
  { type: 'fairy', from: [X_(-40, 13.5), Y_(-25, 13.5), 13.5], to: [X_(1960, 13.5), Y_(-40, 13.5), 13.5], sag: 0.78, n: 16, r: 0.075, every: 3, radius: 3, key: 12.6 },
  { type: 'fairy', from: [X_(520, 24), Y_(186, 24), 24], to: [X_(1460, 24), Y_(166, 24), 24], sag: 0.28, n: 22, r: 0.045, every: 4, radius: 2.4 },
  { type: 'fairy', from: [X_(1460, 24), Y_(166, 24), 24], to: [X_(1760, 24), Y_(46, 24), 24], sag: 0.15, n: 8, r: 0.045, every: 4, radius: 2.4 },
];

// листва в горшках и ящиках бросает тень (окклюдеры-сферы)
for (const it of items) if (it.type === 'pot' || it.type === 'planter') it.occ = true;

const dirOf = ([az, el]) => { const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180; return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)]; };

export default {
  name: 'plaza', title: 'Площадь Даров: двор с фонтаном',
  camera3d: CAM,
  sky: ['#7a6aa8', '#e8a0a0', '#f8c8a0'],
  items,
  lighting: {
    preset: 'golden',
    // солнце справа спереди и высоко: двор и левая стена в свете, тени от балкона и колонн — влево-назад (dir — на солнце)
    sun: { dir: [0.42, 0.78, -0.46], color: [1, 0.86, 0.7], energy: 0.62, wrap: 0.2, angle: 3 },
    sky: { color: [0.6, 0.6, 0.86], energy: 0.5 },
    ground: { color: [0.62, 0.5, 0.5], energy: 0.3 },
    groups: { lamp: 1.1, window: 0.9, candle: 1, fairy: 1.0 },
    emissive: 1.2, exposure: 0.8, saturation: 1.08,
    bloom: { strength: 0.22, threshold: 0.9 },
    fog: { color: [0.8, 0.62, 0.6], density: 0.003, start: 26, amount: 0.08 },
    volumetric: false,
    paint: true, tonemap: 'hue', ao: { mode: 'gtao', strength: 1.15, radius: 1.0, multiBounce: true, color: [0.32, 0.22, 0.3] }, contactShadows: { length: 0.4 },
    aerial: { start: 26, density: 0.04, amount: 0.3, lift: 0.03 },
    grade: { lift: [0, 0, 0.012], gain: [0.98, 1, 1.04], contrast: 1.15, split: { shadows: [0.36, 0.3, 0.52], highlights: [1, 0.86, 0.7], amount: 0.03 },
      matchRef: { src: 'refs/plaza.webp', amount: 0.8, lum: 0.5, chroma: 0.85 } },
    backdrop: { mode: 'gradient', colors: [[0.48, 0.42, 0.7], [0.92, 0.66, 0.66], [1, 0.8, 0.66]], clouds: 0.4 },
  },
  style: [{ type: 'paint', radius: 1.2 }, { type: 'ink', strength: 0.85, color: 'albedo', darken: 0.6, depthWidth: 1.1 }, { type: 'vignette', strength: 0.15 }],
  materials: {
    pavers: { tex: { kind: 'tiles', su: 0.44, sv: 0.3, offset: 0.5, grout: 0.024, color: '#c8a090', color2: '#6a4e4c', palette: ['#b48a7a', '#c49a84', '#98766e', '#cca48c', '#a8867c', '#bc8a6c', '#ac9084', '#8a6e68', '#c0987e', '#d0ac90'], vary: 0.5, jitter: 0.3, pillow: 0.5 }, noise: { scale: 0.6, amount: 0.24, octaves: 3 }, grime: { height: 0.05, amount: 0.2, ao: 0.6 } },
    cobbleFar: { tex: { kind: 'tiles', su: 0.26, sv: 0.18, offset: 0.5, grout: 0.02, color: '#b8948a', color2: '#6a5458', palette: ['#b08c84', '#c09a8c', '#9a8088', '#c8a898'], vary: 0.35, jitter: 0.3, pillow: 0.5 }, noise: { scale: 0.6, amount: 0.2 } },
    terrace: { tex: { kind: 'tiles', su: 0.4, sv: 0.3, offset: 0.5, grout: 0.022, color: '#dab4a6', color2: '#8a6a60', palette: ['#dab4a6', '#c8a49a', '#e4c0b0', '#cfa898'], vary: 0.3, jitter: 0.2, pillow: 0.3 }, noise: { scale: 0.7, amount: 0.15 } },
    ashlarB: { tex: { kind: 'tiles', su: 0.44, sv: 0.24, offset: 0.5, grout: 0.014, color: '#d4ae94', color2: '#8a6a5a', palette: ['#d8b49a', '#ccaa90', '#e0bea4', '#c8a28a', '#d4b098', '#c09a84'], vary: 0.3, jitter: 0.12, pillow: 0.22 }, noise: { scale: 0.35, amount: 0.1, octaves: 3 }, wear: { amount: 0.25, color: '#ecd8c4' }, grime: { height: 0.5, amount: 0.15, color: '#5a4a44' } },
    woodP: { noise: { scale: 0.12, amount: 0.12, octaves: 3 }, wear: { amount: 0.3, color: '#c08a5a' }, grime: { height: 0.3, amount: 0.2, color: '#3a2418' } },
    terracotta: { noise: { scale: 0.08, amount: 0.2, octaves: 3, color: '#a8502a' }, grime: { height: 0.18, amount: 0.35, color: '#5a3424' }, wear: { amount: 0.35, color: '#e8a878' } },
    stepStone: { noise: { scale: 0.45, amount: 0.14, octaves: 3 }, wear: { amount: 0.3, color: '#e0c8b4' }, grime: { height: 0.06, amount: 0.25, color: '#4a3a3a' } },
    roofTile: { noise: { scale: 0.3, amount: 0.12, octaves: 3, color: '#a85a38' } },
  },
};
