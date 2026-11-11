// Референс 4 (refs/stairs.webp): вечерняя площадь с лестницами — подпорная стена с центральной лестницей на террасу,
// кафе с зонтом и лавка «Ткани» слева, «Почта» справа, верхний марш к арке, длинная лестница справа на верхнюю улицу
// с «Рынком», указатель со стрелками, тележка, скамья, классики, голуби, механик на ступенях.
// Камера подобрана по референсу (горизонт 380 px, точка схода x = 950, f = 2000 px, высота глаза 3.38 м), предметы
// поставлены по пикселям референса обратной проекцией (gp, xz, rectF): так совпадает раскладка кадра.
import './stairs.props.mjs';
import './stairs.cart.mjs';
import './stairs.detail.mjs';
import { registerWorldItem, textPrim, dot, add, sub, mul, dark, jit } from '../../engine/world3d.js';

export const CAM = { hor: 380, f: 2000, camH: 3.38, dz: 0, cx: 950 };
const { hor, f, camH, cx } = CAM;
const POS = [0, camH, 0];

/* ---------- уровни ---------- */
const ZW = 15.45; // лицо подпорной стены
const T = 1.95; // пол террасы (плитка t11: верх стены на y≈560)
const ZL = 14.0, XL = -4.65; // левый дом: фасад и боковая стена
const ZB = 24.4; // фасады «Ткани» и «Почты»
const ZM = 27.8; // дом с аркой наверху малого марша
const UP = 4.05; // площадка у арки
const TKR = 1.1; // высота конька «Ткани» над карнизом (по ней же — трубы на скате)
const ZR = 24.4, UR = 3.3; // верхняя улица справа (фасад «Рынка», её уровень)

/* ---------- экран ↔ мир ---------- */
const ray = (x, y) => [(x - cx) / f, -(y - hor) / f, 1];
/** Точка на земле (или на высоте Y) под пикселем (x, y): [X, Z]. */
const gp = (x, y, Y = 0) => { const Z = ((camH - Y) * f) / (y - hor); return [((x - cx) * Z) / f, Z]; };
const xz = (x, y, Y = 0) => { const [X, Z] = gp(x, y, Y); return { X: +X.toFixed(3), Z: +Z.toFixed(3) }; };
/** Точка на глубине Z под пикселем: [X, Y]. */
const atZ = (x, y, Z) => [((x - cx) * Z) / f, camH - ((y - hor) * Z) / f];
const hit = (x, y, n, d) => { const r = ray(x, y), t = (d - dot(n, POS)) / dot(n, r); return add(POS, mul(r, t)); };
const onF = (F, x, y) => { const P = hit(x, y, F.n, dot(F.n, F.o)), r = sub(P, F.o); return [dot(r, F.u), dot(r, F.v), P]; };
const rectF = (F, x1, y1, x2, y2) => {
  const [a1, b1, P1] = onF(F, x1, y1), [a2, b2, P2] = onF(F, x2, y2);
  return { a: Math.min(a1, a2), b: Math.min(b1, b2), w: Math.abs(a2 - a1), h: Math.abs(b2 - b1), z: Math.min(P1[2], P2[2]) };
};
/** Грань-рамка: фронтальная стена z (низ на высоте y0), x0…x1. */
const FZ = (Z, x0 = -30, x1 = 30, h = 20, y0 = 0) => ({ o: [x0, y0, Z], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, -1], w: x1 - x0, h });
/** Стена X = const, смотрит в +X (видна слева от точки схода). */
const FXp = (X, z0, z1, h = 20, y0 = 0) => ({ o: [X, y0, z0], u: [0, 0, 1], v: [0, 1, 0], n: [1, 0, 0], w: z1 - z0, h });
/** Окно по прямоугольнику стекла на экране. */
const win = (F, x1, y1, x2, y2, o = {}) => { const r = rectF(F, x1, y1, x2, y2); return { type: 'window', on: F, a: r.a, b: r.b, w: r.w, h: r.h, lit: !!o.lit, shut: o.shut ?? null, ajar: o.ajar ?? AJAR, box: !!o.box, key: o.key ?? r.z - 0.02 }; };
/** Предмет на грани по прямоугольнику на экране. */
const onRect = (type, F, x1, y1, x2, y2, o = {}) => { const r = rectF(F, x1, y1, x2, y2); return { type, on: F, a: r.a, b: r.b, w: r.w, h: r.h, key: r.z - 0.03, ...o }; };
/** Шлагбаум поперёк правой лестницы на глубине Z: тумба, красно-белая стрела, табличка «только для инспектора». */
const barrier = (Z) => {
  const y0 = 0.15 * Math.floor((Z - 10.5) / 0.4), yb = y0 + 0.95, F = FZ(Z - 0.06), out = [];
  out.push({ type: 'box', key: Z - 0.16, x: [5.27, 5.53], y: [y0, yb + 0.1], z: [Z - 0.13, Z + 0.13], color: '#e2a83a', pmat: 'wood' });
  out.push({ type: 'box', key: Z - 0.17, x: [5.25, 5.55], y: [yb + 0.1, yb + 0.15], z: [Z - 0.15, Z + 0.15], color: '#3a3438' });
  out.push({ type: 'box', key: Z - 0.18, x: [5.25, 5.55], y: [y0 + 0.32, y0 + 0.4], z: [Z - 0.135, Z + 0.135], color: '#c8302a' });
  for (let x = 5.53, k = 0; x < 8.9; x += 0.32, k++) out.push({ type: 'box', key: Z - 0.1, x: [x, Math.min(8.9, x + 0.32)], y: [yb - 0.045, yb + 0.045], z: [Z - 0.04, Z + 0.04], color: k % 2 ? '#f4efe6' : '#d23a2e' });
  out.push({ type: 'box', key: Z - 0.09, x: [8.86, 8.95], y: [y0, yb - 0.04], z: [Z - 0.04, Z + 0.04], color: '#e2a83a' });
  for (const x of [5.85, 6.75]) out.push({ type: 'box', key: Z - 0.11, x: [x - 0.012, x + 0.012], y: [yb - 0.12, yb - 0.04], z: [Z - 0.07, Z - 0.05], color: '#3a3438' });
  out.push({ type: 'plate', on: F, a: 5.68 + 30, b: yb - 0.56, w: 1.24, h: 0.44, lines: ['ТОЛЬКО ДЛЯ', 'ИНСПЕКТОРА'], color: '#f6f2e8', border: '#c8302a', textColor: '#b8282a', size: 0.14, font: FONT, key: Z - 0.12 });
  return out;
};
const X_ = (x, Z) => ((x - cx) * Z) / f, Y_ = (y, Z) => camH - ((y - hor) * Z) / f;
/** Плоскость z = Z для предметов в пикселях референса (stairs.detail.mjs): линия земли gy этой глубины. */
const PX = (Z) => ({ Z, gy: hor + (camH * f) / Z });
const SHUT = '#1a5088';
const AJAR = 0.38; // ставни приоткрыты: дальняя кромка отходит от стены (рад; у pxWin — то же по умолчанию)
/** Поворот стрелок указателя (столб в xz(1437, 882)) к правому краю низа центральной лестницы (1.06, 14.95). */
const STAIRS_YAW = (() => { const [X, Z] = gp(1437, 882); return Math.atan2(14.95 - Z, X - 1.06); })();
const FONT = 'Candara, Arial Narrow, sans-serif'; // шрифт вывесок и указателей
const SIGN_FONT = 'Constantia, Georgia, serif'; // антиква для вывески лавки, как на референсе

/* ---------- предметы этой сцены ---------- */
/** Арочный проём с каменным кольцом на грани: {on:F, a, w, spring, color, ring, dark, door}. */
registerWorldItem('archDoor', { doc: 'арочный проём', build: (S, d) => {
  const F = d.on, fr = S.frame(F.o, F.u, F.v, F.w, F.h, F.n), prims = [], R = d.w / 2, ac = d.a + R, sp = d.spring;
  const arc = (rr, n = 20) => { const out = []; for (let k = 0; k <= n; k++) { const t = Math.PI * (k / n); out.push([ac - Math.cos(t) * rr, sp + Math.sin(t) * rr]); } return out; };
  const z = Math.min(fr.at(d.a, 0)[2], fr.at(d.a + d.w, 0)[2]), sw = S.sw(z), stone = d.color || '#d8c09a', ring = d.ring ?? 0.38;
  prims.push(S.det(fr, [fr.at(d.a - ring, 0), fr.at(d.a + d.w + ring, 0), ...arc(R + ring).reverse().map(([a, b]) => fr.at(a, b))].reverse(), dark(stone, 0.05), { ink: true, sw }));
  const nv = d.stones ?? 13;
  for (let k = 0; k < nv; k++) {
    const t0 = Math.PI * (k / nv) + 0.008, t1 = Math.PI * ((k + 1) / nv) - 0.008, q = (t, rr) => fr.at(ac - Math.cos(t) * rr, sp + Math.sin(t) * rr);
    prims.push(S.det(fr, [q(t0, R), q(t1, R), q(t1, R + ring), q(t0, R + ring)], jit(stone, 0.07), { ink: true, sw: sw * 0.5, n: fr.tilt(-Math.cos((t0 + t1) / 2) * 0.3, Math.sin((t0 + t1) / 2) * 0.3, 1) }));
  }
  for (const side of [0, 1]) for (let b = 0; b < sp - 0.05; b += 0.4) {
    const a = side ? d.a + d.w : d.a - ring;
    prims.push(S.det(fr, fr.rect(a, b + 0.01, ring, Math.min(0.38, sp - b)), jit(stone, 0.07), { ink: true, sw: sw * 0.5, n: fr.tilt(side ? 0.2 : -0.2, 0, 1) }));
  }
  // проём: глубина арки (тёплая штукатурка), дверь в глубине
  const opening = [fr.at(d.a, 0), fr.at(d.a + d.w, 0), ...arc(R).reverse().map(([a, b]) => fr.at(a, b))];
  prims.push(S.det(fr, opening, d.dark || '#c89a6a', { spec: 0.05 }));
  // depth — проём в толще стены: задняя стенка с дверью на глубине depth и видимые откосы (при косом взгляде на
  // боковую стену виден дальний откос); всё, что за проёмом, обрезано его контуром
  const inner = prims.length;
  let fd = fr;
  if (d.depth) {
    fd = S.frame(sub(F.o, mul(F.n, d.depth)), F.u, F.v, F.w, F.h, F.n);
    prims.push(S.det(fd, [fd.at(d.a, 0), fd.at(d.a + d.w, 0), ...arc(R).reverse().map(([a, b]) => fd.at(a, b))], dark(d.dark || '#c89a6a', 0.3), { spec: 0.05 }));
    const Q = [[d.a, 0], ...arc(R, 24), [d.a + d.w, 0]], cIn = [ac, sp * 0.5];
    for (let i = 0; i < Q.length - 1; i++) {
      const [a0, b0] = Q[i], [a1, b1] = Q[i + 1];
      let na = b1 - b0, nb = -(a1 - a0);
      if (na * (cIn[0] - a0) + nb * (cIn[1] - b0) < 0) { na = -na; nb = -nb; }
      const l = Math.hypot(na, nb) || 1, nw = add(mul(F.u, na / l), mul(F.v, nb / l)), p0 = fr.at(a0, b0);
      if (!S.faces(nw, p0)) continue;
      prims.push(S.base([p0, fr.at(a1, b1), fd.at(a1, b1), fd.at(a0, b0)], d.reveal || d.dark || '#c89a6a', nw, [...nw, dot(nw, p0)], { ink: false, spec: 0.05 }));
    }
  }
  if (d.door) {
    const dw = d.w * 0.82, da = d.a + (d.w - dw) / 2, dsp = sp - 0.05, dR = dw / 2, dc = da + dR;
    const darc = []; for (let k = 0; k <= 16; k++) { const t = Math.PI * (k / 16); darc.push(fd.at(dc - Math.cos(t) * dR, dsp + Math.sin(t) * dR)); }
    if (d.leaf) { // открытая створка у левого косяка, в глубине — дверь потемнее
      prims.push(S.det(fd, [fd.at(da, 0), fd.at(da + dw, 0), ...darc.reverse()], dark(d.dark || '#c89a6a', 0.25), { spec: 0.05 }));
      // створка по форме арки: верх идёт по окружности проёма, доски, кованые петли и кольцо
      const lw = d.w * d.leaf, la = d.a + 0.03, Ri = R - 0.03, topAt = (x) => sp + Math.sqrt(Math.max(0, Ri * Ri - (x - ac) ** 2));
      const lp = [fd.at(la, 0), fd.at(la + lw, 0)];
      for (let k = 0; k <= 12; k++) { const x = la + lw - (lw * k) / 12; lp.push(fd.at(x, topAt(x))); }
      prims.push(S.det(fd, lp, d.door, { ink: true, sw: sw * 0.8, spec: 0.25 }));
      for (let k = 1; k < 4; k++) { const x = la + (lw * k) / 4; prims.push(S.det(fd, fd.rect(x - 0.008, 0.04, 0.016, topAt(x) - 0.08), dark(d.door, 0.4), { bump: true, n: fd.tilt(1, 0, 0.6) })); }
      for (const y of [0.45, sp - 0.2]) prims.push(S.det(fd, fd.rect(la + 0.02, y, lw * 0.75, 0.05), '#2a2224', { bump: true, spec: 0.7, ink: true, sw: sw * 0.4 }));
      const hx = la + lw - 0.1, hy = 1.05; prims.push(S.det(fd, [fd.at(hx - 0.04, hy), fd.at(hx, hy - 0.05), fd.at(hx + 0.04, hy), fd.at(hx, hy + 0.05)], '#c8a050', { bump: true, spec: 0.9 }));
    } else {
      prims.push(S.det(fd, [fd.at(da, 0), fd.at(da + dw, 0), ...darc.reverse()], d.door, { ink: true, sw: sw * 0.8, spec: 0.25 }));
      for (let k = 1; k < 5; k++) prims.push(S.det(fd, fd.rect(da + (dw * k) / 5 - 0.015, 0.05, 0.03, dsp + 0.2), dark(d.door, 0.35), { n: fd.tilt(1, 0, 0.6) }));
    }
  }
  if (d.depth) for (let i = inner; i < prims.length; i++) prims[i].clip = opening;
  S.item(d.key ?? z - 0.02, prims, { name: 'arch_door' });
} });
/** Табличка с несколькими строками: {on:F, a, b, w, h, lines:[text…], color, textColor, border, size, sizes}. */
registerWorldItem('plate', { doc: 'табличка в несколько строк', build: (S, d) => {
  const F = d.on, n = F.n, prims = [], dd = d.d ?? 0.04;
  const fr0 = S.frame(F.o, F.u, F.v, F.w, F.h, n);
  const off = (p, t) => add(p, mul(n, t));
  const q = (m, t) => [off(fr0.at(d.a + m, d.b + m), t), off(fr0.at(d.a + d.w - m, d.b + m), t), off(fr0.at(d.a + d.w - m, d.b + d.h - m), t), off(fr0.at(d.a + m, d.b + d.h - m), t)];
  const outer = q(0, dd), z = Math.min(...outer.map((p) => p[2])), sw = Math.max(0.6, 0.015 * S.pxPerUnit(z));
  const fr = S.frame(off(fr0.at(d.a, d.b), dd + 0.003), F.u, F.v, d.w, d.h, n);
  prims.push(S.det(fr, fr.rect(0, 0, d.w, d.h), d.border || d.color, { ink: true, sw, spec: 0.3, solid: true }));
  const m = d.m ?? 0.04;
  prims.push(S.det(fr, fr.rect(m, m, d.w - 2 * m, d.h - 2 * m), d.color || '#2a4a8a', { spec: 0.25 }));
  const L = d.lines || [], sizes = d.sizes || L.map(() => d.size ?? (d.h * 0.6) / Math.max(1, L.length));
  const total = sizes.reduce((s, v) => s + v * 1.18, 0);
  let top = d.h / 2 + total / 2;
  L.forEach((t, i) => { const c = top - sizes[i] * 0.59; top -= sizes[i] * 1.18; prims.push(textPrim(S, fr, d.w / 2 + (d.shift ?? 0), c, t, sizes[i], d.textColor || '#f4f0e6', { font: d.font || FONT, weight: 'bold' })); });
  if (d.icon === 'envelope') {
    const ia = 0.1, ib = d.h * 0.25, iw = d.h * 0.7, ih = d.h * 0.5;
    prims.push(S.det(fr, fr.rect(ia, ib, iw, ih), '#f2c040', { ink: true, sw: sw * 0.6 }));
    prims.push(S.line(fr.at(ia, ib + ih), fr.at(ia + iw / 2, ib + ih * 0.4), '#8a6020', sw * 0.8), S.line(fr.at(ia + iw, ib + ih), fr.at(ia + iw / 2, ib + ih * 0.4), '#8a6020', sw * 0.8));
  }
  S.item(d.key ?? z - 0.01, prims, { name: 'plate' });
  if (d.light) S.light(off(fr0.at(d.a + d.w / 2, d.b + d.h / 2), 0.7), '#ffc070', d.light, 0.45, 'lamp');
} });
/** Светильник-плафон на стене (квадратик со свечением) + точечный свет: {p:[X,Y,Z], n:[nx,0,nz], s}. */
registerWorldItem('wallGlow', { doc: 'плафон на стене', build: (S, d) => {
  const [X, Y, Z] = d.p, n = d.n || [0, 0, -1], s = d.s ?? 0.12, t = [-n[2], 0, n[0]];
  const P = (a, b) => [X + t[0] * a + n[0] * 0.01, Y + b, Z + t[2] * a + n[2] * 0.01];
  const ps = [P(-s / 2, -s * 0.6), P(s / 2, -s * 0.6), P(s / 2, s * 0.6), P(-s / 2, s * 0.6)];
  S.item(d.key ?? Z - 0.02, [{ t: 'poly', ps, alb: '#fff0c8', n, pl: [...n, dot(n, ps[0])], base: true, ink: true, sw: 1, spec: 0.4, em: '#ffc860', op: 1 }], { name: 'wall_glow' });
  S.light([X + n[0] * 0.35, Y, Z + n[2] * 0.35], d.color || '#ffb860', d.radius ?? 2.2, d.energy ?? 0.7, 'lamp');
} });

/** Освещённая витрина: рама, тёплое стекло, полки с товаром: {on:F, a, b, w, h, frame, shelves, goods}. */
registerWorldItem('shopWin', { doc: 'витрина с полками', build: (S, d) => {
  const F = d.on, fr0 = S.frame(F.o, F.u, F.v, F.w, F.h, F.n), prims = [];
  const fr = S.frame(add(fr0.at(d.a, d.b), mul(F.n, 0.01)), F.u, F.v, d.w, d.h, F.n);
  const z = Math.min(fr.at(0, 0)[2], fr.at(d.w, 0)[2]), sw = S.sw(z) * 0.8, W = d.w, H = d.h, fc = d.frame || '#f2ead8';
  prims.push(S.det(fr, fr.rect(-0.08, -0.08, W + 0.16, H + 0.16), fc, { ink: true, sw, spec: 0.3 }));
  prims.push(S.det(fr, fr.rect(0, 0, W, H), d.glass || '#d88a44', { spec: 0.6, em: d.em || '#a85c1c' }));
  prims.push(S.det(fr, fr.rect(0, H * 0.55, W, H * 0.45), '#f0b060', { bump: true, em: '#c07a2a', op: 0.6 }));
  const ns = d.shelves ?? 3, goods = d.goods || ['#c84a3a', '#e8b040', '#6a8a4a', '#f4ead8', '#8a5aa0', '#d87040', '#4a6aa8'];
  for (let k = 0; k < ns; k++) {
    const b = (H * (k + 0.3)) / ns;
    prims.push(S.det(fr, fr.rect(0.02, b - 0.03, W - 0.04, 0.03), '#7a4a2a', { em: '#3a2010' }));
    for (let a = 0.06; a < W - 0.1; a += 0.07 + jit('#808080', 0).length * 0) {
      const gw = 0.04 + ((a * 37) % 1) * 0.06, gh = 0.08 + ((a * 53 + k) % 1) * 0.14, c = goods[Math.floor((a * 91 + k * 7) % goods.length)];
      prims.push(S.det(fr, fr.rect(a, b, gw, gh), c, { em: dark(c, 0.55), ink: true, sw: sw * 0.3 }));
      a += gw;
    }
  }
  prims.push(S.det(fr, fr.rect(W / 2 - 0.03, 0, 0.06, H), fc, { bump: true }));
  prims.push(S.det(fr, fr.rect(0, H * 0.72, W, 0.05), fc, { bump: true }));
  prims.push(S.det(fr, fr.rect(-0.16, -0.18, W + 0.32, 0.1), '#d8ccb8', { ink: true, sw, n: fr.tilt(0, 1, 1) }));
  S.item(d.key ?? z - 0.02, prims, { name: 'shop_window' });
  S.light(add(fr.at(W / 2, H / 2), mul(F.n, 0.8)), '#ffb860', d.radius ?? 3.5, d.energy ?? 0.9, 'window');
} });

/* ---------- палитра ---------- */
const BLUE = '#3a5a9a', TEAL = '#2f7a7a', RED = '#b8402e', WOOD = '#8a5230';
const OCHRE = '#f8e0a4', PINK = '#e2a49a', POST = '#dcdca0', MID = '#efc488', ROSE = '#e0a0a0', BRICK = '#c07858';
const STONE = '#8e726a', STONE_HI = '#c4aea4', STEP = '#c4aea4', IRON = '#2c2428';
// ступени: светлая проступь, подступёнок темнее (иначе марш читается полосатой плоскостью)
const TREAD = '#e0ccbe', RISER = '#a8908a';

/* ---------- грани ---------- */
const FL = FZ(ZL, -12, XL, 14); // левый дом, фасад
const FLs = FXp(XL, ZL, 15.6, 14); // его боковая стена
const FLa = FXp(XL, 9.0, 15.6, 14); // она же от края кадра: арка на ней смотрит вправо, как на референсе
/** Точка на боковой стене левого дома X = XL + off под пикселем (x, y): [X, Y, Z]. */
const onXL = (x, y, off = 0.05) => { const X = XL + off, Z = (X * f) / (x - cx); return [X, camH - ((y - hor) * Z) / f, Z]; };
const FP = FZ(ZB, -6.9, -0.85, 8); // «Ткани»
const FPt = FZ(ZB, -6.9, -0.85, 6, T); // «Ткани» от пола террасы
const FPo = FZ(ZB, 0.82, 5.9, 8); // «Почта»
const FPot = FZ(ZB, 0.82, 5.9, 6, T);
const FM = FZ(ZM, -1.6, 1.6, 9); // дом с аркой
const FMt = FZ(ZM, -1.6, 1.6, 5, UP);
const FR = FZ(ZR, 5.9, 9.2, 9); // «Рынок»
const FBr = FZ(20, 7.8, 12, 12); // кирпичный дом справа
const FW = FZ(ZW, -4.65, 4.3, 2.1); // подпорная стена

const items = [
  /* ---------- земля и уровни ---------- */
  { type: 'flatGround', x: [-14, 14], z: [8.5, ZW + 0.2], mat: false, color: '#a8806e', pmat: 'pavers', spec: 0.3 },
  // терраса: подпорная стена (только лицо — пол рисуется землёй, чтобы не перекрывать стоящее на нём)
  { type: 'box', key: ZW, x: [XL, -1.38], y: [0, T], z: [ZW, ZW + 0.4], color: STONE, pmat: 'ashlar' },
  { type: 'box', key: ZW, x: [1.42, 4.75], y: [0, T], z: [ZW, ZW + 0.4], color: STONE, pmat: 'ashlarR' },
  { type: 'flatGround', key: 1e6, x: [-7, 5.9], y: T, z: [ZW, 30], mat: false, color: '#b89888', pmat: 'terrace', spec: 0.25 },
  // карниз стены
  { type: 'box', key: ZW - 0.08, x: [XL, -1.38], y: [T - 0.12, T + 0.03], z: [ZW - 0.08, ZW + 0.3], color: STONE_HI, pmat: 'stone' },
  { type: 'box', key: ZW - 0.08, x: [1.42, 4.75], y: [T - 0.12, T + 0.03], z: [ZW - 0.08, ZW + 0.3], color: STONE_HI, pmat: 'stone' },
  // центральная лестница между парапетами
  // ключ 14.86: после щёк (14.9) — ступени закрывают низ их внутренних граней, виден подъём; до карнизов щёк (14.84)
  { type: 'stairs', key: 14.86, x: [-1.0, 1.06], z: [14.95, 18.3], h: T, steps: 14, color: RISER, top: TREAD, nosing: 0.045, joints: 0.55, mat: 'none', pmat: 'stepStone' },
  { type: 'box', key: 14.9, x: [-1.38, -1.0], y: [0, T + 0.06], z: [14.9, 18.3], color: '#b8a092', pmat: 'ashlarL' },
  { type: 'box', key: 14.84, x: [-1.43, -0.96], y: [T + 0.06, T + 0.17], z: [14.84, 18.35], color: STONE_HI, pmat: 'stone' },
  { type: 'box', key: 14.9, x: [1.06, 1.42], y: [0, T + 0.06], z: [14.9, 18.3], color: '#b8a092', pmat: 'ashlarL' },
  { type: 'box', key: 14.84, x: [1.02, 1.47], y: [T + 0.06, T + 0.17], z: [14.84, 18.35], color: STONE_HI, pmat: 'stone' },
  { type: 'wallGlow', p: [-0.99, 0.9, 15.6], n: [1, 0, 0], s: 0.14, key: 15.5 },
  { type: 'wallGlow', p: [1.05, 1.5, 16.4], n: [-1, 0, 0], s: 0.14, key: 16.3 },
  // малый марш к арке
  // ключ 24.88: после боковых стен «Ткани» и «Почты» (24.9) — ступени закрывают их низ, марш виден поднимающимся
  { type: 'stairs', key: 24.88, x: [-0.82, 0.82], z: [ZB, 27.4], y0: T, h: UP - T, steps: 13, color: RISER, top: TREAD, nosing: 0.045, joints: 0.55, mat: 'none', pmat: 'stepStone' },
  { type: 'flatGround', key: 1e6 - 1, x: [-1.6, 1.6], y: UP, z: [27.4, 31], mat: false, color: '#c0a290', pmat: 'terrace' },

  /* ---------- дальние дома ---------- */
  // дом с аркой (виден в просвете между «Тканями» и «Почтой»)
  // стоит на площадке у арки (y0 = UP): с y0 = 0 фасад уходил к земле и закрывал пол террасы полосой-«бордюром»
  { type: 'house', key: ZM + 0.5, x: [-1.6, 1.6], z: [ZM, 33], y0: UP, h: 7.9 - UP, color: MID, roof: '#e4784a', mat: 'none', pmat: 'plaster', facades: [], roofType: 'gable', roofH: 0.7, tiles: 'barrel', eave: true, roofPmat: 'roofTile' },
  { type: 'archDoor', on: FMt, ...(() => { const r = rectF(FMt, 922, 235, 988, 342); return { a: r.a, w: r.w, spring: r.h - r.w / 2 }; })(), color: '#d8b888', ring: 0.18, dark: '#5a3424', door: '#7a4428', key: ZM - 0.02 },
  { type: 'lantern', p: [X_(955, ZM), Y_(262, ZM), ZM - 0.25], s: 0.5, hangTo: Y_(222, ZM), key: ZM - 0.4, radius: 2.5, energy: 0.9 },
  win(FM, 892, 95, 924, 150, { lit: true, shut: '#b86a3a' }), win(FM, 966, 95, 998, 150, { lit: true, shut: '#b86a3a' }),
  { type: 'rail', from: [X_(884, ZM - 0.3), Y_(162, ZM), ZM - 0.3], to: [X_(1010, ZM - 0.3), Y_(162, ZM), ZM - 0.3], h: 0.5, iron: true, step: 0.12, key: ZM - 0.35 , color: IRON },
  { type: 'box', key: ZM - 0.4, x: [X_(880, ZM), X_(1014, ZM)], y: [Y_(165, ZM) - 0.08, Y_(165, ZM)], z: [ZM - 0.4, ZM], color: STONE_HI },
  { type: 'pot', X: X_(902, 27.1), Z: 27.1, Y: UP, r: 0.12, plant: 'tree', fr: 0.3, flower: '#7aa848', key: 27.0 },
  { type: 'pot', X: X_(1000, 27.1), Z: 27.1, Y: UP, r: 0.1, plant: 'bush', fr: 0.2, flower: '#f0a030', key: 27.0 },

  // «Лавка шёлка» / «Ткани» (розовый дом слева на террасе)
  { type: 'house', key: ZB + 0.5, x: [-6.9, -0.85], z: [ZB, 32], y0: T, h: 5.25, color: PINK, roof: '#e4784a', mat: 'none', pmat: 'plasterRose', facades: [], roofType: 'gable', roofH: TKR, tiles: 'barrel', eave: true, roofPmat: 'roofTile' },
  // трубы на переднем скате «Ткани» (roofChimney): стоят в глубине ската, низ граней — по скату, у основания оклад,
  // у трёх — глиняные горшки, у одной — плоская плита; [x экрана, ширина, верх тела на экране (по референсу), горшок]
  ...[[428, 0.34, 40, true], [495, 0.5, 22, false], [636, 0.32, 30, true], [828, 0.36, 24, true]].map(([sx, w, yt, pot]) => {
    const Z = ZB + 1.0, X = X_(sx, Z), y1 = T + 5.25, roof = [ZB - 0.3, y1 - 0.12, (ZB + 32) / 2, y1 + TKR];
    const yR = roof[1] + ((Z - roof[0]) / (roof[2] - roof[0])) * (roof[3] - roof[1]);
    return { type: 'roofChimney', x: [X - w / 2, X + w / 2], z: [Z, Z + 0.45], roof, up: Y_(yt, Z) - yR, pot, potH: 0.24, color: '#d4a08a', cap: '#8a5a50', key: ZB - 0.5, pmat: 'plaster' };
  }),
  // вывеска антиквой с полями (кегль под 13 букв: текст не доходит до рамки)
  onRect('signboard', FP, 405, 195, 578, 245, { text: 'ЛАВКА ШЁЛКИНА', color: '#f6ecdc', textColor: '#9a2838', border: '#c8a888', m: 0.05, size: 0.2, font: SIGN_FONT, key: ZB - 0.06 }),
  { type: 'awning', x: [X_(382, ZB), X_(576, ZB)], z: ZB, y: Y_(255, ZB), depth: 0.9, drop: 0.55, colors: ['#d84a3a', '#f4ece0'], stripe: 0.24, key: ZB - 0.95 },
  onRect('plate', FP, 600, 250, 718, 295, { lines: ['ТКАНИ'], color: '#7a4a8a', border: '#5a3068', textColor: '#f6f0f4', size: 0.34, key: ZB - 0.06 }),
  { type: 'door', on: FPt, a: rectF(FPt, 627, 320, 695, 450).a, w: rectF(FPt, 627, 320, 695, 450).w, h: 2.05, color: '#b83a2a', key: ZB - 0.03 },
  onRect('shopWin', FP, 398, 330, 470, 398, { frame: '#e8d8c8', shelves: 2, goods: ['#f0a0b8', '#f4e0c8', '#e88aa8', '#c8a0d8'], key: ZB - 0.03 }), onRect('shopWin', FP, 520, 335, 575, 395, { frame: '#e8d8c8', shelves: 2, goods: ['#f0a0b8', '#a8c8e8', '#e88aa8'], key: ZB - 0.03 }),
  win(FP, 412, 118, 470, 185, { lit: true }), win(FP, 500, 118, 556, 185, { lit: true }),
  { type: 'pxWin', ...PX(ZB - 0.01), glass: [598, 158, 690, 216], cols: 3, rows: 2, trimW: 5, key: ZB - 0.03 },
  { type: 'planter', x: [X_(594, ZB), X_(694, ZB)], y: Y_(226, ZB), z: ZB - 0.01, h: 0.2, flower: '#f08a4a', leaf: '#4a7a30', d: 0.2, trail: 5, trailLen: 0.5 }, { type: 'pxWin', ...PX(ZB - 0.01), glass: [758, 112, 820, 208], shutL: [731, 755], shutR: [823, 848], shut: TEAL, lit: false, cols: 2, rows: 3, key: ZB - 0.03 },
  { type: 'rail', from: [X_(398, ZB - 0.35), Y_(180, ZB), ZB - 0.35], to: [X_(562, ZB - 0.35), Y_(180, ZB), ZB - 0.35], h: 0.45, iron: true, step: 0.12, key: ZB - 0.4 , color: IRON },
  { type: 'box', key: ZB - 0.4, x: [X_(396, ZB), X_(564, ZB)], y: [Y_(183, ZB) - 0.1, Y_(183, ZB)], z: [ZB - 0.4, ZB], color: STONE_HI },
  { type: 'planter', x: [X_(410, ZB - 0.1), X_(470, ZB - 0.1)], y: Y_(180, ZB) + 0.02, z: ZB - 0.1, flower: '#e86a5a', trail: 2, trailLen: 0.2 },
  { type: 'spools', x: [X_(458, ZB - 0.5), X_(572, ZB - 0.5)], y: Y_(426, ZB - 0.5), z: ZB - 0.5, n: 6 },
  { type: 'box', key: ZB - 0.7, x: [X_(452, ZB - 0.6), X_(578, ZB - 0.6)], y: [T, Y_(426, ZB - 0.5)], z: [ZB - 0.7, ZB - 0.2], color: '#8a5a3a', pmat: 'wood' },
  { type: 'drape', key: ZB - 0.3, per: 3, pts: [[755, 214, 1.2], [775, 215, 1.5], [795, 218, 1.6], [815, 215, 1.2], [790, 232, 0.9], [835, 216, 0.8]].map(([x, y, L]) => [X_(x, ZB - 0.1), Y_(y, ZB - 0.1), ZB - 0.1, L]) },

  // «Почта»
  { type: 'house', key: ZB + 0.5, x: [0.82, 5.9], z: [ZB, 32], y0: T, h: 5.65, color: POST, roof: '#e4784a', mat: 'none', pmat: 'plaster', facades: [], roofType: 'gable', roofH: 1.1, tiles: 'barrel', eave: true, roofPmat: 'roofTile' },
  { type: 'archDoor', on: FPot, ...(() => { const r = rectF(FPot, 1082, 315, 1150, 470); return { a: r.a, w: r.w, spring: 2.07 - r.w / 2 }; })(), color: '#d8ccb0', ring: 0.14, dark: '#2a3a6a', door: '#2a4a8a', key: ZB - 0.02 },
  onRect('poster', FPo, 1096, 342, 1136, 376, { color: '#f2c440', frame: '#c89020', art: 'none', key: ZB - 0.05 }),
  { type: 'mailbox', X: X_(1175, ZB), Y: Y_(400, ZB), z: ZB },
  onRect('plate', FPo, 1170, 225, 1350, 280, { lines: ['ПОЧТА'], color: '#2a4a80', border: '#c8a868', textColor: '#f6f0dc', size: 0.4, shift: 0.22, icon: 'envelope', key: ZB - 0.06, light: 2 }),
  onRect('shopWin', FPo, 1203, 308, 1347, 445, { frame: '#e8e0c8', shelves: 4, key: ZB - 0.03 }),
  // окна «Почты» по плитке t02: левое тёмное, правое светится; ящики с цветами под ними
  { type: 'pxWin', ...PX(ZB - 0.01), glass: [1096, 110, 1158, 204], lit: false, cols: 2, rows: 3, key: ZB - 0.03 },
  { type: 'pxWin', ...PX(ZB - 0.01), glass: [1254, 110, 1322, 208], cols: 2, rows: 3, key: ZB - 0.03 },
  { type: 'planter', x: [X_(1088, ZB), X_(1162, ZB)], y: Y_(238, ZB), z: ZB - 0.01, h: 0.22, flower: '#f4f0f4', leaf: '#5a8a3a', d: 0.2, trail: 3, trailLen: 0.3 },
  { type: 'planter', x: [X_(1248, ZB), X_(1328, ZB)], y: Y_(226, ZB), z: ZB - 0.01, h: 0.15, flower: '#f8e8c0', leaf: '#5a8a3a', d: 0.2 },
  { type: 'lantern', p: [X_(1046, ZB - 0.3), Y_(282, ZB), ZB - 0.3], s: 0.9, wall: -1, key: ZB - 0.5, radius: 3, energy: 1.2 },
  { type: 'drape', key: ZB - 0.2, per: 6, pts: [[1320, 30, 1.6], [1345, 30, 2.4], [1365, 30, 2.6], [1385, 40, 3.4], [1410, 30, 3.6], [1425, 120, 2.6], [1340, 60, 1.2], [1400, 80, 3.0]].map(([x, y, L]) => [X_(x, ZB - 0.1), Y_(y, ZB - 0.1), ZB - 0.1, L]) },
  
  // «Рынок по-деликатески» на верхней улице справа и дома за ним
  // верхняя улица: подпорная стена от угла «Почты» (X = 5.9) — с X = 4.75 её левая грань стояла перед витриной «Почты»;
  // у верха правой лестницы — площадка во всю ширину марша
  { type: 'box', key: 19.3, x: [5.9, 12], y: [0, UR], z: [19.3, ZR], color: STONE, pmat: 'stone' },
  { type: 'box', key: 19.31, x: [5.1, 5.9], y: [0, UR], z: [19.3, 20.3], color: STONE, pmat: 'stone' },
  // ключ больше, чем у «Почты» (ZB + 0.5): левая стена «Рынка» (X = 5.9) уходит вглубь за «Почту» и рисуется раньше неё
  { type: 'house', key: ZR + 0.56, x: [5.9, 9.2], z: [ZR, 30], y0: UR, h: 6.5, color: ROSE, mat: 'none', pmat: 'plasterRose', facades: [], roofType: 'flat' },
  onRect('plate', FR, 1500, 310, 1640, 377, { lines: ['РЫНОК', 'ПО-ДЕЛИКАТЕСКИ'], sizes: [0.36, 0.17], color: '#f6ecdc', border: '#b08860', textColor: '#a8303a', key: ZR - 0.06 }),
  { type: 'awning', x: [X_(1480, ZR), X_(1596, ZR)], z: ZR, y: Y_(195, ZR), depth: 0.8, drop: 0.6, colors: ['#3a9a8a', '#f2f0e4'], stripe: 0.18, key: ZR - 0.85 },
  ...[[1482, 268, 1520, 280, '#e88a30'], [1525, 266, 1560, 280, '#d84030'], [1563, 268, 1598, 280, '#f0c040'], [1600, 268, 1640, 280, '#f0a030']].map(([x1, y1, x2, y2, c]) => ({ type: 'crate', o: [X_(x1, ZR - 0.3), ZR - 0.42], len: X_(x2, ZR - 0.3) - X_(x1, ZR - 0.3), wid: 0.36, h: 0.3, y0: 4.3, color: '#a86a38', fill: c, fruit: 0.05, key: ZR - 0.45 })),
  // окна, дверь и фонарь «Рынка» по плитке t03
  { type: 'pxWin', ...PX(ZR - 0.01), glass: [1543, 60, 1565, 125], shutL: [1528, 1541], shutR: [1567, 1582], shut: TEAL, cols: 2, rows: 3, trimW: 4, key: ZR - 0.03 },
  { type: 'pxWin', ...PX(ZR - 0.01), glass: [1650, 5, 1680, 90], shutL: [1626, 1645], shutR: [1683, 1703], shut: TEAL, cols: 2, rows: 3, trimW: 4, key: ZR - 0.03 },
  { type: 'pxWin', ...PX(ZR - 0.01), glass: [1670, 190, 1698, 300], shutL: [1652, 1667], shutR: [1700, 1720], shut: TEAL, lit: false, cols: 2, rows: 4, trimW: 4, key: ZR - 0.03 },
  { type: 'pxWin', ...PX(ZR - 0.01), glass: [1604, 220, 1640, 292], cols: 2, rows: 3, trimW: 4, sill: false, key: ZR - 0.03 },
  { type: 'planter', x: [X_(1530, ZR), X_(1572, ZR)], y: Y_(185, ZR), z: ZR - 0.01, h: 0.18, flower: '#f08aa0', d: 0.18 },
  { type: 'planter', x: [X_(1648, ZR), X_(1705, ZR)], y: Y_(104, ZR), z: ZR - 0.01, h: 0.12, flower: '#e86a8a', d: 0.18 },
  { type: 'wallBulb', ...PX(ZR - 0.01), at: [1618, 200], r: 7, key: ZR - 0.06 },
  { type: 'pot', X: X_(1670, ZR - 0.4), Z: ZR - 0.4, Y: 4.02, r: 0.16, plant: 'tree', fr: 0.35, flower: '#f2d040', key: ZR - 0.5 },
  { type: 'aframe', X: X_(1692, 21.5), Z: 21.5, h: 0.75, w: 0.5, kind: 'chalk', ang: 0, key: 21.3 },
  // кирпичный дом справа
  { type: 'house', key: 20.5, x: [7.8, 12], z: [20, 20.8], h: 12, color: BRICK, mat: 'none', pmat: 'bricks', facades: [], roofType: 'flat' },
  win(FBr, 1752, 262, 1800, 378, { shut: BLUE }), win(FBr, 1892, 240, 1940, 372, { shut: BLUE }),
  win(FBr, 1822, 0, 1878, 62, { lit: true, box: true }),
  { type: 'wallBulb', ...PX(19.99), at: [1880, 58], r: 9, key: 19.9 },
  { type: 'awning', x: [X_(1784, 20), X_(1874, 20)], z: 20, y: Y_(220, 20), depth: 0.42, drop: 0.24, colors: ['#c8302a', '#c8302a'], key: 19.3 },
  onRect('poster', FBr, 1812, 330, 1850, 398, { color: '#f0c040', frame: '#c09030', art: 'note', key: 19.95 }),
  onRect('poster', FBr, 1855, 300, 1898, 396, { color: '#f4eee4', frame: '#d8d0c0', art: 'text', key: 19.95 }),
  { type: 'planter', x: [X_(1822, 19.9), X_(1890, 19.9)], y: Y_(150, 20), z: 19.9, flower: '#f6f2e8', trail: 3, trailLen: 0.4 },

  /* ---------- левый дом ---------- */
  { type: 'box', key: ZL + 0.01, x: [-14, XL], y: [0, 3.12], z: [ZL, 15.6], color: OCHRE, pmat: 'plaster' },
  // стена над балконом (X = −5.55, смотрит вправо) продолжается до угла дома: без торца ниши, смотревшего в камеру
  { type: 'box', key: ZL + 0.008, x: [-14, -5.55], y: [3.12, 7.6], z: [ZL, 15.6], color: OCHRE, pmat: 'plaster' },
  { type: 'box', key: ZL + 0.006, x: [-12, XL + 0.1], y: [3.12, 3.27], z: [ZL, 15.6], color: STONE_HI, pmat: 'stone' },
  // окна на ней: со ставнями над балконом и верхнее с красными ставнями (раньше — нарисованы в пикселях на торце)
  { type: 'window', on: FXp(-5.55, 10.4, 15.6, 4.33, 3.27), a: 14.2 - 10.4, b: 0.42, w: 0.9, h: 1.55, lit: false, shut: SHUT, box: false, ajar: AJAR, key: ZL - 0.002 },
  { type: 'window', on: FXp(-5.55, 10.4, 15.6, 4.33, 3.27), a: 14.2 - 10.4, b: 2.75, w: 0.9, h: 1.1, lit: false, shut: '#b8402e', box: false, ajar: AJAR, key: ZL - 0.003 },
  // первый этаж ближе к камере: боковая стена с аркой (смотрит вправо), над ним — балкон
  { type: 'box', key: ZL + 0.005, x: [-14, XL], y: [0, 3.12], z: [9.0, ZL], color: OCHRE, pmat: 'plaster' },
  { type: 'box', key: 15.7, x: [-14, -6.9], y: [0, 7.4], z: [15.6, ZB], color: '#e8c098', pmat: 'plaster' },
  // проём по референсу: внутренние края x 75…248 px, верх y 458 px; в глубине 0.7 м — дверь (видна слева) и освещённый дальний откос
  { type: 'archDoor', on: FLa, ...(() => { const za = onXL(75, 0, 0)[2], zb = onXL(248, 0, 0)[2], R = (zb - za) / 2, top = camH - ((458 - hor) * (za + R)) / f; return { a: za - 9.0, w: zb - za, spring: top - R }; })(),
    color: '#c4a898', ring: 0.3, dark: '#d89858', reveal: '#e8b070', depth: 0.7, door: '#4a2e22', stones: 15, key: 13.0 },
  onRect('plate', FLa, 22, 474, 55, 516, { lines: ['12'], color: '#2a4070', border: '#c8c0b0', textColor: '#f4f0e6', size: 0.17, key: 12.9 }),
  // фонарь висит в проёме арки, под её сводом
  { type: 'lantern', ...(() => { const p = onXL(170, 522, -0.3); return { p, hangTo: camH - ((458 - hor) * p[2]) / f }; })(), s: 0.72, key: 12.8, radius: 3.5, energy: 1.2 },
  // балкон смотрит вправо, как на референсе: перила вдоль X = −5 уходят вглубь (z 10.5…14), верх перил y≈271…299 px
  { type: 'box', key: 10.4, x: [-12, XL + 0.1], y: [3.12, 3.27], z: [10.4, ZL], color: STONE_HI, pmat: 'stone' },
  { type: 'rail', from: [-5.0, 3.27, 10.45], to: [-5.0, 3.27, ZL], h: 0.68, iron: true, step: 0.12, key: 10.35, color: IRON },
  { type: 'zPlanter', X: -5.0, z: [10.95, 12.3], y: 3.33, h: 0.2, d: 0.22, flower: ['#e85a4a', '#d84a3a', '#f08060'], key: 10.3 },
  { type: 'zPlanter', X: -5.0, z: [12.6, 13.9], y: 3.95, h: 0.16, d: 0.2, flower: ['#f4f0e4', '#f8f4ec', '#e8e0f0'], key: 10.32 },
  { type: 'pot', X: -5.3, Z: 11.2, Y: 3.27, r: 0.13, plant: 'bush', fr: 0.4, flower: ['#e8603a', '#f29040', '#d84a30'], flowers: 26, key: 10.31 },
  // стена за балконом тоже смотрит вправо (X = −5.55), окно со ставнями — на ней
  { type: 'box', key: 10.38, x: [-14, -5.55], y: [3.27, 7.6], z: [10.4, ZL], color: OCHRE, pmat: 'plaster' },
  { type: 'window', on: FXp(-5.55, 10.4, ZL, 4.33, 3.27), a: 12.2 - 10.4, b: 0.42, w: 1.05, h: 1.55, lit: false, shut: SHUT, box: false, ajar: AJAR, key: 10.37 },
  // окна по плитке t00: светлое окно с жалюзи, высокое окно у балкона, верхний этаж
  { type: 'drape', key: 10.2, per: 5, pts: [[10, 0, 1.0], [40, 20, 0.9], [70, 0, 0.6], [95, 10, 0.4]].map(([x, y, L]) => [...onXL(x, y, -0.85), L]) },
  // плющ у края кадра — на боковой стене с аркой
  { type: 'drape', key: 12.5, per: 5, pts: [[20, 560, 1.8], [10, 620, 1.4]].map(([x, y, L]) => [...onXL(x, y), L]) },
  { type: 'drape', key: 15.55, per: 5, pts: [[268, 0, 3.2], [290, 0, 3.0], [305, 40, 2.6], [325, 0, 3.4], [280, 150, 2.2]].map(([x, y, L]) => { const p = onXL(x, y, -2.2); return [...p, (L * p[2]) / (ZL - 0.05)]; }) },
  onRect('poster', FLs, 280, 590, 318, 740, { color: '#f2eadc', frame: '#8a6a4a', art: 'text', key: ZL - 0.005 }),
  // гортензия у левого края (плитка t20)
  // (перед боковой стеной: пиксели референса сдвинуты на 18 px вправо и 52 px вниз, иначе горшок за линией стены)
  ((mv) => ({ type: 'hydrangea', ...PX(10.2), pot: mv([72, 991]), potW: 94, potH: 88, flower: ['#b89ae0', '#c8a8e8', '#a888d8', '#d8b0e0'],
    leaves: [[18, 880, 26], [60, 892, 28], [105, 878, 26], [130, 850, 20], [10, 845, 20], [72, 860, 26]].map(mv),
    heads: [[25, 826, 24], [60, 806, 24], [96, 798, 24], [118, 832, 22], [72, 852, 24], [32, 855, 20]].map(mv) }))(([x, y, r]) => (r == null ? [x + 18, y + 52] : [x + 18, y + 52, r])),
  // урна и столбик — у боковой стены правее арки (её кольцо кончается на z 13.55), проход в арку свободен
  { type: 'bin', X: -4.36, Z: 14.2, r: 0.24, h: 1.02 },
  { type: 'bollard', X: -4.45, Z: 13.75, r: 0.16, h: 0.55, color: '#4e4a4e', band: '#c8a040' },

  /* ---------- у подножия стены ---------- */
  { type: 'lampPost', ...xz(432, 862), h: 2.95, s: 1.25 },
  onRect('plate', FZ(13.85), 288, 492, 420, 555, { lines: ['ПЛОЩАДЬ', 'ДАРОВ'], color: '#2a4478', border: '#d8d0c0', textColor: '#f4f0e6', size: 0.15, key: 13.75 }),
  // угол с тележкой — по пикселям референса (stairs.cart.mjs)
  { type: 'cartStall', Z: 15.2, gy: 817, wall: ZW },
  { type: 'hydrangea', Z: 14.96, gy: 832, pot: [387, 832], potW: 70, potH: 67,
    leaves: [[340, 748, 22], [372, 758, 22], [410, 758, 22], [446, 746, 18], [334, 714, 18], [456, 716, 16], [390, 732, 25], [426, 702, 18], [360, 692, 15]],
    heads: [[350, 705, 17], [377, 688, 17], [404, 682, 18], [433, 703, 16], [386, 716, 17], [415, 722, 17], [446, 724, 14], [345, 736, 14]] },
  { type: 'noticeboard', x: [X_(1165, ZW), X_(1340, ZW)], y: [Y_(690, ZW), Y_(600, ZW)], z: ZW, notes: [
    { a: X_(1176, ZW), b: Y_(676, ZW), w: 0.3, h: 0.48, art: 'cube' }, { a: X_(1226, ZW), b: Y_(640, ZW), w: 0.28, h: 0.26, color: '#f2d070' },
    { a: X_(1228, ZW), b: Y_(690, ZW) + 0.06, w: 0.25, h: 0.3, color: '#f4eee0' }, { a: X_(1272, ZW), b: Y_(655, ZW), w: 0.48, h: 0.38, art: 'mountains', color: '#f4f0e8' }] },
  { type: 'bench', o: [X_(1150, 14.75), 14.75], ang: 0, len: 1.5 },
  { type: 'crate', o: [X_(1162, 14.8), 14.8], len: 0.28, wid: 0.2, h: 0.1, y0: 0.46, color: '#4a6aa0' },
  { type: 'crate', o: [X_(1163, 14.82), 14.82], len: 0.26, wid: 0.18, h: 0.07, y0: 0.56, color: '#b83a3a' },
  { type: 'crate', o: [X_(1208, 14.85), 14.85], len: 0.26, wid: 0.2, h: 0.06, y0: 0.46, color: '#e8e0d0' },
  { type: 'pot', X: X_(1328, 14.95), Z: 14.95, Y: 0.46, r: 0.1, plant: 'bush', fr: 0.18, flowers: 0 },
  { type: 'suitcase', o: [X_(1356, 15.0), 15.0], len: 0.36, wid: 0.24, h: 0.62, color: '#8a5434' },
  { type: 'crate', o: [X_(1462, 14.7), 14.7], len: 0.62, wid: 0.45, h: 0.42, color: '#a8703a' },
  { type: 'pot', X: X_(1503, 14.85), Z: 14.85, Y: 0.42, r: 0.01, h: 0.01, plant: 'bush', flower: ['#f4f0e0', '#f0d040'], fr: 0.3, flowers: 22, key: 14.6 },
  { type: 'crate', o: [X_(1530, 14.9), 14.9], len: 0.52, wid: 0.45, h: 0.45, color: '#c8a070' },
  { type: 'crate', o: [X_(1536, 14.95), 14.95], len: 0.48, wid: 0.42, h: 0.42, y0: 0.45, color: '#d0aa78' },
  { type: 'pot', X: X_(1545, 15.0), Z: 15.0, Y: 0.87, r: 0.13, plant: 'bush', fr: 0.32, flowers: 0, key: 14.8 },

  /* ---------- площадь ---------- */
  { type: 'manholeDeco', ...xz(775, 966), r: 0.42 },
  { type: 'hopscotch', ...xz(1290, 1030), cell: 0.48, ang: -3 },
  // «Почта» и «Ткани» — на террасе: их стрелки повёрнуты вокруг столба к низу центральной лестницы
  { type: 'signpost', ...xz(1437, 882), h: 2.7, color: '#6a4228', font: FONT, em: 0.6, painted: true, arrows: [
    { y: Y_(533, 13.5), w: 1.22, h: 0.25, dir: -1, a: -0.62, text: 'ПЛОЩАДЬ ДАРОВ', color: '#f2ead8', textColor: '#3a2a22', size: 0.15 },
    { y: Y_(579, 13.5), w: 0.62, h: 0.26, dir: 1, a: 0.26, text: 'РЫНОК', color: '#e8902a', textColor: '#3a2210', size: 0.15 },
    { y: Y_(635, 13.5), w: 0.76, h: 0.27, dir: -1, a: -0.2, yaw: STAIRS_YAW, text: 'ПОЧТА', color: '#f4ecdc', textColor: '#2a2a3a', size: 0.16 },
    { y: Y_(686, 13.5), w: 0.78, h: 0.28, dir: -1, a: -0.2, yaw: STAIRS_YAW, text: 'ТКАНИ', color: '#ec8c9a', textColor: '#3a1a22', size: 0.16 },
  ], vertical: { y: Y_(488, 13.5), w: 0.3, h: 0.58, a: -0.24, text: 'НЕБО', color: '#3a6ab8', textColor: '#f4f0e6', size: 0.17 } },
  { type: 'lathe', ...xz(1665, 948), profile: 'barrel', h: 1.0, r: 0.31, color: '#a86a30', rings: { ys: [0.12, 0.45, 0.85], color: '#3a3030' }, top: '#3a3040', key: 11.0 }, // перед звеном парапета z 11.49…
  { type: 'duck', X: X_(1700, 11.95), Y: 1.0, Z: 11.95, s: 1.2, key: 10.98 }, // после бочки: сидит на крышке
  { type: 'barrelStaves', ...xz(1665, 948), r: 0.31, h: 1.0, n: 18, color: '#b8743a', key: 10.99 },
  // гортензия в белом горшке у парапета (плитка t23): перед боковой гранью парапета
  { type: 'hydrangea', ...PX(11.25), keyZ: 10.45, pot: [1745, 981], potW: 84, potH: 72, potColor: '#ece6dc', flower: ['#a890e0', '#8a96e0', '#b8a0e8', '#9aa8ec'],
    leaves: [[1700, 896, 20], [1736, 898, 22], [1772, 896, 20], [1690, 880, 14], [1786, 884, 14]],
    heads: [[1700, 862, 18], [1724, 843, 18], [1752, 846, 18], [1775, 866, 17], [1736, 870, 18], [1712, 886, 15], [1762, 886, 14]] },
  { type: 'animSlot', slot: 'square', key: 13.41 },
  { type: 'animSlot', slot: 'leaves', key: 11.45 },
  { type: 'litter', x: [-6, 6], z: [9, 15.2], n: 70, paper: [] },
  { type: 'shadowBox', x: [-16, -5.6], y: [0, 9], z: [2, 8.6] },
  { type: 'drape', key: ZW - 0.1, per: 4, pts: [[745, 552, 1.0], [760, 556, 0.8], [340, 560, 1.6], [355, 600, 1.2]].map(([x, y, L]) => [X_(x, ZW - 0.05), Y_(y, ZW - 0.05), ZW - 0.05, L]) },

  /* ---------- правая лестница на верхнюю улицу ---------- */
  { type: 'stairs', x: [5.1, 9.4], z: [10.5, 19.3], h: UR, steps: 22, color: '#b0907f', top: '#e2c8b4', nosing: 0.045, joints: 0.6, mat: 'none', pmat: 'stepStone' },
  { type: 'stepWall', x: [4.75, 5.1], z: [10.5, 15.45], y: [0, UR * (15.45 - 10.5) / 8.8], steps: 5, over: 0.5, color: '#c8a48e', lights: true, pmat: 'ashlarL' },
  { type: 'riserLights', x: 8.6, z: [10.5, 19.3], h: UR, steps: 22, every: 3 },
  { type: 'riserLights', x: 5.5, z: [10.5, 19.3], h: UR, steps: 22, every: 4 },
  { type: 'rail', from: [5.2, UR * (15.5 - 10.5) / 8.8, 15.5], to: [5.2, UR, 19.3], h: 0.9, iron: true, step: 0.22, key: 15.4, color: IRON },
  // кот и голуби — анимированные (stairs.anim.mjs): слоты в порядке художника
  { type: 'animSlot', slot: 'stairs', key: 17.25 },
  ...barrier(14.5),
  // горшки на крышках парапета: верх крышки звена i = UR·(15.45−10.5)/8.8·(i+1)/5 + 0.5 + 0.09 (stepWall), горшок — посередине звена
  { type: 'pot', X: 4.93, Z: 14.95, Y: UR * (15.45 - 10.5) / 8.8 + 0.59, r: 0.15, plant: 'bush', flower: ['#f6f4ec', '#f2e8a0'], fr: 0.3, flowers: 26, key: 14.415 },
  { type: 'pot', X: 4.93, Z: 11.0, Y: UR * (15.45 - 10.5) / 8.8 / 5 + 0.59, r: 0.2, plant: 'bush', flower: ['#9a7ad0', '#b090e0', '#8a6ac0'], fr: 0.34, flowers: 22, key: 10.42 },
  { type: 'pot', X: 7.66, Z: 16.3, Y: UR * (16.3 - 10.5) / 8.8, r: 0.22, plant: 'tree', fr: 0.45, flower: '#f2d040', key: 16.0 },

  /* ---------- терраса: кафе, перила, цветы ---------- */
  { type: 'rail', from: [XL, T + 0.03, 15.62], to: [-1.43, T + 0.03, 15.62], h: 0.79, iron: true, step: 0.15, key: 15.55, bottom: true, color: IRON },
  { type: 'rail', from: [1.47, T + 0.03, 15.62], to: [4.7, T + 0.03, 15.62], h: 0.79, iron: true, step: 0.15, key: 15.55, bottom: true, color: IRON },
  { type: 'umbrella', X: X_(580, 18.2), Z: 18.2, Y: T, r: 0.8, h: 1.62, colors: ['#2a9a98', '#f4ece0'] },
  { type: 'cafeTable', X: X_(580, 18.2), Z: 18.2, Y: T, r: 0.42 },
  { type: 'stool', X: X_(520, 17.6), Z: 17.6, Y: T, color: '#2a6a6a' }, { type: 'stool', X: X_(630, 17.4), Z: 17.4, Y: T, color: '#2a6a6a' },
  { type: 'cafeTable', X: X_(470, 19.5), Z: 19.5, Y: T, r: 0.38 },
  { type: 'stool', X: X_(420, 19.0), Z: 19.0, Y: T, color: '#2a6a6a' },
  { type: 'planter', x: [X_(672, 15.5), X_(760, 15.5)], y: 2.46, h: 0.3, z: 15.5, flower: '#c080d8', leaf: '#5a8a3a', d: 0.3 },
  { type: 'pot', X: X_(714, 15.45), Z: 15.45, Y: 2.9, r: 0.01, h: 0.01, plant: 'bush', flower: ['#c080d8', '#e0a0e8', '#f0d040'], fr: 0.34, flowers: 30, key: 15.3 },
  { type: 'pot', X: -1.75, Z: 19.4, Y: T, r: 0.24, plant: 'tree', fr: 0.55, flower: '#7aa848', key: 19.1 },
  // лимоны по бокам малой лестницы, у её нижней ступени (как на референсе)
  { type: 'pot', X: -1.17, Z: 24.0, Y: T, r: 0.24, plant: 'bush', fr: 0.36, flower: '#f2b030', key: 23.7 },
  { type: 'pot', X: 1.17, Z: 24.0, Y: T, r: 0.24, plant: 'bush', fr: 0.36, flower: '#f2b030', key: 23.7 },
  { type: 'crate', o: [X_(1118, 15.9), 15.9], len: 0.55, wid: 0.4, h: 0.38, y0: T, color: '#8a5a32' },
  { type: 'pot', X: X_(1150, 16.1), Z: 16.1, Y: T + 0.38, r: 0.01, h: 0.01, plant: 'bush', fr: 0.3, flowers: 0, key: 15.85 },
  { type: 'blanket', x: [X_(1220, 15.58), X_(1280, 15.58)], y: 2.84, len: 0.55, z: 15.58, color: '#d8783a', stripe: '#f0d8a0' },
  { type: 'cafeTable', X: X_(1290, 17.0), Z: 17.0, Y: T, r: 0.45, color: '#6a4a3a' },
  { type: 'pot', X: X_(1350, 17.6), Z: 17.6, Y: T, r: 0.18, plant: 'bush', fr: 0.3, flower: '#f4f0e4', flowers: 20, key: 17.3 },
  { type: 'pot', X: X_(1250, 17.2), Z: 17.2, Y: T + 0.74, r: 0.08, plant: 'bush', fr: 0.14, flower: '#4a6ac8', key: 16.9 },
  { type: 'lampPost', X: X_(1430, 17.0), Z: 17.0, Y: T, h: 2.15, s: 1.0 },
  { type: 'pot', X: X_(1490, 16.0), Z: 16.0, Y: T, r: 0.2, plant: 'bush', fr: 0.32, flower: ['#9a7ad0', '#c4a4ec'], flowers: 18, key: 15.7 },

  /* ---------- гирлянды ---------- */
  // главная нить по плитке t01/t02: слева вымпелы, правее треугольники; нижняя точка у x≈900
  { type: 'bunting', path: [[440, 72], [560, 112], [700, 140], [900, 152], [1100, 150], [1300, 142], [1440, 142], [1600, 118], [1750, 92], [1880, 56]].map(([x, y]) => [X_(x, 16), Y_(y, 16), 16]),
    n: 23, w: 0.56, h: 0.33, rw: 0.28, rh: 0.6, shapes: 'rrrrrrrtrttttttttttrtrt',
    colors: ['#3a5ab0', '#2a8a90', '#4a6ac0', '#e88a9a', '#3a5ab0', '#e07a3a', '#3a5ab0', '#9a6ac0', '#c84a3a', '#b84a32', '#e8a030', '#2a9a98', '#9a7ac8', '#8a5ab8', '#a070c8', '#c8403a', '#e8b830', '#40a8a0', '#f4f0e8', '#e898b0', '#4a7ac8', '#f4f0e8', '#e898b0'] },
  { type: 'bunting', from: [X_(330, 15), Y_(36, 15), 15], to: [X_(560, 15), Y_(140, 15), 15], sag: 0.05, n: 3, w: 0.5, h: 0.45, colors: ['#d85a3a', '#e88a40', '#3a5ab0'] },
  { type: 'fairy', from: [X_(700, 22), Y_(198, 22), 22], to: [X_(1310, 22), Y_(205, 22), 22], sag: 0.18, n: 20, r: 0.05, every: 4, radius: 2.4 },
  { type: 'fairy', from: [X_(820, 23), Y_(288, 23), 23], to: [X_(1410, 23), Y_(296, 23), 23], sag: 0.12, n: 18, r: 0.045, every: 5, radius: 2 },
  { type: 'fairy', from: [X_(208, 14), Y_(90, 14), 14], to: [X_(640, 14), Y_(150, 14), 14], sag: 0.22, n: 11, r: 0.05, every: 3, key: ZL - 0.2, bulb: '#ffe08a', color: '#ffc050' },
  { type: 'fairy', from: [X_(1400, 18), Y_(150, 18), 18], to: [X_(1900, 18), Y_(70, 18), 18], sag: 0.25, n: 12, r: 0.05, every: 4 },
];

// листва в горшках и ящиках бросает тень (окклюдеры-сферы)
for (const it of items) if (it.type === 'pot' || it.type === 'planter') it.occ = true;

export default {
  name: 'stairs', title: 'Площадь Даров: лестницы на закате',
  camera3d: CAM,
  sky: ['#7aa8d8', '#f0c8a8', '#f8d8b0'],
  items,
  lighting: {
    preset: 'golden',
    sun: { dir: [-0.35, 0.85, -0.4], color: [1, 0.92, 0.82], energy: 0.95, wrap: 0.25, angle: 3 },
    sky: { color: [0.62, 0.68, 0.86], energy: 0.65 },
    ground: { color: [0.6, 0.52, 0.52], energy: 0.3 },
    groups: { lamp: 1.1, window: 0.9, candle: 1, fairy: 1.0 },
    emissive: 1.2, exposure: 0.8, saturation: 1.08,
    bloom: { strength: 0.2, threshold: 0.9 },
    fog: { color: [0.8, 0.62, 0.6], density: 0.003, start: 22, amount: 0.08 },
    volumetric: false,
    paint: true, tonemap: 'hue', ao: { mode: 'gtao', strength: 1.15, radius: 1.0, multiBounce: true, color: [0.32, 0.22, 0.3] }, contactShadows: { length: 0.4 },
    aerial: { start: 22, density: 0.04, amount: 0.3, lift: 0.03 },
    grade: { lift: [0, 0, 0.012], gain: [0.98, 1, 1.04], contrast: 1.15, split: { shadows: [0.36, 0.3, 0.52], highlights: [1, 0.86, 0.7], amount: 0.03 },
      matchRef: { src: 'refs/stairs.webp', amount: 0.8, lum: 0.5, chroma: 0.85 } },
    backdrop: { mode: 'gradient', colors: [[0.48, 0.66, 0.86], [0.95, 0.8, 0.7], [1, 0.85, 0.7]], clouds: 0.5 },
  },
  style: [{ type: 'paint', radius: 1.2 }, { type: 'ink', strength: 0.85, color: 'albedo', darken: 0.6, depthWidth: 1.1 }, { type: 'vignette', strength: 0.15 }],
  materials: {
    pavers: { tex: { kind: 'tiles', su: 0.3, sv: 0.22, offset: 0.5, grout: 0.02, color: '#c49a8e', color2: '#7a6062', palette: ['#b89488', '#c8a294', '#9a8086', '#d8b0a0', '#a89498', '#c89478', '#b49ca0', '#8a7880', '#c4a08c'], vary: 0.4, jitter: 0.25, pillow: 0.45 }, noise: { scale: 0.6, amount: 0.24, octaves: 3 }, grime: { height: 0.05, amount: 0.2, ao: 0.6 } },
    terrace: { tex: { kind: 'tiles', su: 0.4, sv: 0.3, offset: 0.5, grout: 0.022, color: '#dab4a6', color2: '#8a6a60', palette: ['#dab4a6', '#c8a49a', '#e4c0b0', '#cfa898'], vary: 0.3, jitter: 0.2, pillow: 0.3 }, noise: { scale: 0.7, amount: 0.15 } },
    ashlar: { tex: { kind: 'tiles', su: 0.38, sv: 0.18, offset: 0.5, grout: 0.016, color: '#5e4e4e', color2: '#7a6862', palette: ['#5e4e4e', '#564646', '#685656', '#4e4242', '#625252', '#5a4a4a', '#6c5a5c'], vary: 0.35, jitter: 0.2, pillow: 0.35 }, noise: { scale: 0.5, amount: 0.15, octaves: 3 }, grime: { height: 0.4, amount: 0.12, color: '#4a3a38' } },
    ashlarR: { tex: { kind: 'tiles', su: 0.38, sv: 0.18, offset: 0.5, grout: 0.016, color: '#b08c78', color2: '#cbb09c', palette: ['#b08c78', '#a4806c', '#bc9884', '#98745e', '#b4927e', '#a88470', '#c0a08a'], vary: 0.35, jitter: 0.2, pillow: 0.35 }, noise: { scale: 0.5, amount: 0.15, octaves: 3 }, grime: { height: 0.4, amount: 0.1, color: '#4a3a38' } },
    ashlarL: { tex: { kind: 'tiles', su: 0.32, sv: 0.19, offset: 0.5, grout: 0.011, color: '#d4b49c', color2: '#8a6a5a', palette: ['#d8b8a0', '#ccaa92', '#e0c2aa', '#c4a28c', '#d2b098', '#bc9a86'], vary: 0.3, jitter: 0.12, pillow: 0.18 }, noise: { scale: 0.35, amount: 0.1, octaves: 3 }, wear: { amount: 0.25, color: '#ead6c4' }, grime: { height: 0.35, amount: 0.15, color: '#5a4a44' } },
    // глина горшков: пятна, потёки у дна, светлые сколы на кромках (вместо гладкого пластика)
    terracotta: { noise: { scale: 0.08, amount: 0.2, octaves: 3, color: '#a8502a' }, grime: { height: 0.18, amount: 0.35, color: '#5a3424' }, wear: { amount: 0.35, color: '#e8a878' } },
    glaze: { noise: { scale: 0.1, amount: 0.08, octaves: 2 }, grime: { height: 0.12, amount: 0.25, color: '#8a7a6a' } },
    stepStone: { noise: { scale: 0.45, amount: 0.14, octaves: 3 }, wear: { amount: 0.3, color: '#e0c8b4' }, grime: { height: 0.06, amount: 0.25, color: '#4a3a3a' } },
    // черепица: пятна выгоревшей глины и потемнение к карнизу (плитку рисует векторный материал barrel)
    roofTile: { noise: { scale: 0.3, amount: 0.12, octaves: 3, color: '#a85a38' } },
    bricks: { tex: { kind: 'tiles', su: 0.25, sv: 0.085, offset: 0.5, grout: 0.012, color: '#c47a5a', color2: '#7a4a3a', jitter: 0.5, pillow: 0.2 }, noise: { scale: 0.6, amount: 0.12 } },
  },
};
