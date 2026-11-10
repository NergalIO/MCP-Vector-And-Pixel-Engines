// Угол с тележкой (refs/stairs.webp, x 320…770, y 590…835): тележка с большим спицевым колесом, красная дорожка
// с узором, посылки с бечёвкой и жёлтый подарок, ведро лаванды, полочка с баночками, травы и мёд, ящик с бутылками,
// меловая доска с подарком и куст гортензии в терракотовом горшке.
// Предметы заданы в пикселях референса (1920×1081) и переводятся в мир на глубине Z: так силуэты совпадают с кадром.
import { obox, occluders } from './plaza.props.mjs';
import { registerWorldItem, lathe, sphere, dark, lite, jit, rnd } from '../../engine/world3d.js';

const TAU = Math.PI * 2;
const reg = (type, build) => registerWorldItem(type, { doc: type, build });

/** Отображение «пиксель референса → мир» на глубине Z: gy — линия земли на референсе под предметом. */
function mapper(S, d) {
  const Z0 = d.Z, f = d.f ?? 2000, cx = d.cx ?? 950, gy = d.gy, k = Z0 / f;
  const m = (px) => px * k;
  const P = (x, y, dz = 0) => [(x - cx) * k, (gy - y) * k, Z0 + dz];
  const pxw = (t, z = Z0) => Math.max(0.6, t * S.pxPerUnit(z));
  /** Плоский многоугольник в плоскости z = Z0 + dz; n — нормаль затенения. */
  const flat = (pts, dz, alb, o = {}) => ({ t: 'poly', ps: pts.map(([x, y]) => P(x, y, dz)), alb, n: o.n || [0, 0.08, -1], pl: [0, 0, -1, -(Z0 + dz)],
    base: !o.bump, bump: !!o.bump, ink: o.ink ?? false, sw: pxw(o.sw ?? 0.01, Z0 + dz), spec: o.spec ?? 0.2, op: o.op ?? 1, ...(o.em ? { em: o.em } : {}) });
  const rect = (x0, y0, x1, y1) => [[x0, y1], [x1, y1], [x1, y0], [x0, y0]];
  /** Коробка: передняя грань — прямоугольник на экране, глубина dep м, передняя плоскость на dz. */
  const bx = (x0, y0, x1, y1, dz, dep, c, o = {}, prims = null) => obox(S, { o: [(x0 - cx) * k, Z0 + dz], len: m(x1 - x0), wid: dep, y: [(gy - y1) * k, (gy - y0) * k], color: c, top: o.top ?? lite(c, 0.06), side: o.side ?? dark(c, 0.12), ink: o.ink ?? true, sw: pxw(0.008), spec: o.spec, key: o.key, name: o.name }, prims);
  const line = (x0, y0, x1, y1, dz, c, t, o = {}) => S.line(P(x0, y0, dz), P(x1, y1, dz), c, pxw(t, Z0 + dz), o);
  const ring = (x, y, r, n = 32, rot = 0) => { const out = []; for (let i = 0; i < n; i++) { const t = rot + (i / n) * TAU; out.push([x + Math.cos(t) * r, y - Math.sin(t) * r]); } return out; };
  const ball = (x, y, dz, r, c, o = {}) => { const p = P(x, y, dz); return sphere(S, p[0], p[1], p[2], m(r), c, { prims: true, ...o }); };
  return { Z0, k, m, P, pxw, flat, rect, bx, line, ring, ball };
}

/** Кисть мелких сфер-соцветий: шапка гортензии, лаванда, травы. */
function cluster(M, x, y, dz, r, n, cols, fr, o = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, rr = r * Math.sqrt(rnd());
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * (o.sq ?? 0.85), dz - (1 - rr / r) * M.m(r) * 0.5]);
  }
  pts.sort((A, B) => B[2] - A[2]);
  return pts.flatMap(([px, py, z]) => M.ball(px, py, z, fr * (0.8 + rnd() * 0.45), jit(cols[Math.floor(rnd() * cols.length)], 0.08), { flat: o.flat ?? 0.2, spec: o.spec ?? 0.2, ink: o.ink ?? false, wob: o.wob }));
}

reg('cartStall', (S, d) => {
  const M = mapper(S, d), { Z0, flat, rect, bx, line, ring, ball, P, m } = M;
  // ключи отрисовки: всё, что стоит на тележке, — между стеной (d.wall) и передом тележки, по порядку
  const wall = d.wall ?? Z0 + 0.25, K = (i) => wall - 0.005 - i * 0.004;
  const WOOD = '#8a4c28', WOOD_D = '#5e3016', WOOD_L = '#c87444';

  /* ---------- дальнее колесо (тень за кузовом) ---------- */
  {
    const pr = [flat(ring(560, 768, 44, 28), 0.5, dark(WOOD_D, 0.3), { ink: true }), flat(ring(560, 768, 36, 28), 0.499, '#3a2a26', { bump: true })];
    S.item(K(0), pr, { name: 'cart_rear_wheel' });
  }

  /* ---------- кузов: столешница-полка, короб из досок, стойки ---------- */
  const body = [];
  bx(452, 680, 732, 691, -0.03, 0.62, WOOD_L, { top: '#d08050', side: dark(WOOD_L, 0.2) }, body); // столешница с выносом
  bx(466, 691, 722, 760, 0.0, 0.55, WOOD, { top: WOOD_D }, body); // короб
  for (let y = 705; y < 758; y += 14) body.push(line(467, y, 721, y, -0.003, dark(WOOD, 0.45), 0.012));
  for (let i = 0; i < 26; i++) { const y = 693 + rnd() * 64, x = 470 + rnd() * 230, L = 12 + rnd() * 30; body.push(line(x, y, x + L, y + (rnd() - 0.5) * 1.5, -0.002, dark(WOOD, 0.25), 0.004)); }
  for (const [a, b] of [[466, 476], [594, 604], [712, 722]]) body.push(flat(rect(a, 691, b, 762), -0.012, dark(WOOD, 0.12), { ink: true, n: [0, 0.05, -1] }));
  body.push(flat([[700, 760], [710, 760], [712, 818], [702, 818]], 0.05, WOOD_D, { ink: true })); // ножка
  body.push(flat([[468, 690], [478, 690], [500, 772], [490, 772]], -0.02, dark(WOOD, 0.08), { ink: true })); // подкос к оси
  body.push(line(452, 690.5, 732, 690.5, -0.032, dark(WOOD_L, 0.35), 0.01));
  S.item(K(1), body, { name: 'cart_body' });

  /* ---------- полочка справа: стойки, верхняя доска, баночки ---------- */
  const shelf = [];
  bx(607, 641, 721, 648, 0.08, 0.3, WOOD, { top: WOOD_L }, shelf);
  for (const [a, b] of [[608, 615], [713, 720]]) bx(a, 648, b, 681, 0.1, 0.05, WOOD_D, {}, shelf);
  bx(615, 648, 713, 681, 0.36, 0.02, dark(WOOD_D, 0.2), { ink: false }, shelf); // задняя стенка
  S.item(K(2), shelf, { name: 'cart_shelf' });
  for (const [x, c, lc] of [[630, '#d88a60', '#f0d0c0'], [646, '#c86a50', '#f4e0d0'], [681, '#e0a050', '#f0d8c8'], [698, '#d07a58', '#f4e4d4']]) {
    const p = P(x, 681, 0.2);
    lathe(S, p[0], p[2], [[m(7), 0, 'c'], [m(7.5), m(4)], [m(7.5), m(15)], [m(6), m(16), 'c'], [m(6.5), m(16), 'c'], [m(6.5), m(20), 'c'], [0, m(20), 'c']], c, { y0: p[1], key: K(3), spec: 0.7, top: '#c84a3a' });
    S.item(K(4), [flat(rect(x - 6, 668, x + 6, 676), 0.2 - m(7.6), lc, { bump: true })], { name: 'jar_label' });
  }
  // ящик с травами и банка мёда на верхней доске
  const herb = [];
  bx(616, 624, 676, 642, 0.15, 0.2, '#a8683a', {}, herb);
  S.item(K(5), herb, { name: 'herb_box' });
  S.item(K(6), [
    ...cluster(M, 632, 598, 0.2, 22, 70, ['#6a8a30', '#7a9a3a', '#5a7a2a', '#8aa040'], 3.6, { flat: 0.4, sq: 1.1 }),
    ...cluster(M, 662, 602, 0.22, 18, 55, ['#8a9a38', '#6a8a2e', '#9aa848'], 3.4, { flat: 0.4, sq: 1.0 }),
    ...cluster(M, 664, 598, 0.18, 15, 30, ['#e8c840', '#f0d860', '#d8b030'], 2.2, { flat: 0.1 }),
  ], { name: 'herbs' });
  {
    const p = P(690, 642, 0.22);
    lathe(S, p[0], p[2], [[m(11), 0, 'c'], [m(12), m(4)], [m(12), m(28)], [m(10), m(31), 'c'], [m(10.5), m(31), 'c'], [m(10.5), m(38), 'c'], [0, m(38), 'c']], '#e0902e', { y0: p[1], key: K(7), spec: 0.8, top: '#9a3a26' });
    S.item(K(8), [flat(rect(681, 617, 699, 632), 0.22 - m(12.2), '#f4e8d0', { bump: true, ink: true }), line(684, 622, 696, 622, 0.22 - m(12.4), '#7a4a2a', 0.006), line(685, 627, 695, 627, 0.22 - m(12.4), '#7a4a2a', 0.006)], { name: 'honey_label' });
  }

  /* ---------- посылки с бечёвкой и подарок ---------- */
  const twine = '#b0482a';
  const parcel = (x0, y0, x1, y1, dz, dep, c, tx) => {
    const pr = [];
    bx(x0, y0, x1, y1, dz, dep, c, { top: lite(c, 0.12), side: dark(c, 0.14) }, pr);
    pr.push(line(tx, y0, tx, y1, dz - 0.003, twine, 0.018), line(x0, (y0 + y1) / 2, x1, (y0 + y1) / 2, dz - 0.003, twine, 0.012));
    const t0 = P(tx, y0, dz), t1 = P(tx, y0, dz + dep);
    pr.push(S.line([t0[0], t0[1] + 0.002, t0[2]], [t1[0], t1[1] + 0.002, t1[2]], twine, M.pxw(0.018)));
    pr.push(flat(rect(tx + 14, (y0 + y1) / 2 + 4, tx + 30, y1 - 5), dz - 0.004, '#f4ecdc', { bump: true }));
    S.item(K(9 + dz), pr, { name: 'parcel' });
  };
  parcel(466, 641, 566, 681, 0.08, 0.42, '#e4c098', 480);
  parcel(471, 619, 561, 641, 0.12, 0.36, '#eccca4', 538);
  {
    const pr = [];
    bx(487, 600, 547, 619, 0.16, 0.28, '#f0b830', { top: '#f8cc48' }, pr);
    pr.push(line(503, 600, 503, 619, 0.157, '#d08a18', 0.02));
    for (const s of [-1, 1]) pr.push(flat([[503, 600], [503 + s * 16, 590], [503 + s * 20, 597], [503 + s * 12, 604]], 0.15, '#e8a020', { ink: true, n: [s * 0.3, 0.2, -1] }));
    pr.push(...ball(503, 600, 0.145, 4, '#d89018', { flat: 0.2 }));
    S.item(K(10), pr, { name: 'gift' });
  }

  /* ---------- ведро лаванды ---------- */
  {
    const p = P(588, 681, 0.25);
    lathe(S, p[0], p[2], [[m(12), 0, 'c'], [m(17.5), m(44), 'c'], [m(18.5), m(45), 'c'], [m(16.5), m(45), 'c']], '#a8a8b0', { y0: p[1], key: K(11), spec: 0.9, top: '#4a5a2a', rings: { ys: [p[1] + m(8), p[1] + m(36)], color: '#7a7a84' } });
    const lav = [];
    for (let i = 0; i < 34; i++) {
      const a = -0.8 + (1.6 * i) / 33 + (rnd() - 0.5) * 0.15, L = 30 + rnd() * 20, bx0 = 588 + a * 8, x1 = 588 + Math.sin(a) * L, y1 = 637 - Math.cos(a) * L;
      const dz = 0.25 + (rnd() - 0.5) * 0.1;
      lav.push(line(bx0, 637, x1, y1, dz, '#5a7a3a', 0.008));
      for (let s = 0; s < 7; s++) { const t = 0.5 + (s / 7) * 0.5; lav.push({ dz, b: ball(bx0 + (x1 - bx0) * t, 637 + (y1 - 637) * t, dz - 0.01, 3.6 - s * 0.3, jit(['#8a6ad0', '#a888e8', '#7050b8'][s % 3], 0.08), { flat: 0.2, spec: 0.15, ink: false }) }); }
    }
    const lines = lav.filter((q) => q.t), balls = lav.filter((q) => !q.t).sort((A, B) => B.dz - A.dz).flatMap((q) => q.b);
    S.item(K(12), [...lines, ...balls], { name: 'lavender' });
  }

  /* ---------- переднее колесо ---------- */
  {
    const cx = 514, cy = 772, R = 46, dz = -0.08, pr = [], wood = '#b06838';
    pr.push({ ...flat(ring(cx, cy, R, 40), dz, wood, { ink: true, sw: 0.012 }), holes: [ring(cx, cy, R * 0.8, 40).map(([x, y]) => P(x, y, dz)).reverse()] });
    pr.push({ ...flat(ring(cx, cy, R, 40), dz - 0.002, '#4a3028', { bump: true }), holes: [ring(cx, cy, R * 0.94, 40).map(([x, y]) => P(x, y, dz - 0.002)).reverse()] });
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * TAU + 0.13, c = Math.cos(t), s = Math.sin(t);
      const w = 2.3, nx = -s * w, ny = -c * w, a0 = 8, a1 = R * 0.82;
      pr.push(flat([[cx + c * a0 + nx, cy - s * a0 + ny], [cx + c * a1 + nx * 0.7, cy - s * a1 + ny * 0.7], [cx + c * a1 - nx * 0.7, cy - s * a1 - ny * 0.7], [cx + c * a0 - nx, cy - s * a0 - ny]], dz - 0.004, '#9a5a30', { ink: true, sw: 0.006, n: [c * 0.2, s * 0.2, -1] }));
    }
    pr.push(flat(ring(cx, cy, 10, 20), dz - 0.01, '#7a3e1e', { ink: true, n: [0, 0, -1] }), flat(ring(cx, cy, 4.5, 14), dz - 0.012, '#3a2418', { bump: true }));
    for (let i = 0; i < 12; i++) { const t = (i / 12) * TAU; pr.push(line(cx + Math.cos(t) * R * 0.87, cy - Math.sin(t) * R * 0.87, cx + Math.cos(t + 0.03) * R * 0.94, cy - Math.sin(t + 0.03) * R * 0.94, dz - 0.004, dark(wood, 0.4), 0.01)); }
    S.item(Z0 - 0.08, pr, { name: 'cart_wheel' });
  }

  /* ---------- красная дорожка с узором и бахромой ---------- */
  {
    const RED = '#a8382a', pr = [], dz = -0.045, yTop = 681;
    // часть на столешнице (уходит вглубь) и свисающая спереди
    const top = [[536, 0.3], [608, 0.3], [612, -0.035], [527, -0.035]].map(([x, z]) => { const p = P(x, 680, 0); return [p[0], p[1] + 0.004, Z0 + z]; });
    pr.push({ t: 'poly', ps: top, alb: RED, n: [0, 1, -0.2], pl: [0, 1, 0, top[0][1]], base: true, ink: true, sw: M.pxw(0.008), spec: 0.15, op: 1 });
    const drape = [[527, yTop], [612, yTop], [610, 720], [601, 752], [588, 749], [570, 747], [550, 744], [536, 742], [526, 740], [528, 712]];
    pr.push(flat(drape, dz, RED, { ink: true, n: [0, 0.12, -1] }));
    // ромбическая сетка узора и светлая кайма
    const clipLines = [];
    for (let k = -6; k < 10; k++) {
      clipLines.push([527 + k * 10, 690, 527 + k * 10 + 50, 750], [527 + k * 10 + 50, 690, 527 + k * 10, 750]);
    }
    const inside = (x, y) => x > 531 && x < 607 && y > 690 && y < 739 + (x - 526) * 0.12;
    for (const [k, [x0, y0, x1, y1]] of clipLines.entries()) {
      let prev = null;
      for (let s = 0; s <= 20; s++) {
        const x = x0 + ((x1 - x0) * s) / 20, y = y0 + ((y1 - y0) * s) / 20, ok = inside(x, y);
        if (ok && prev) pr.push(line(prev[0], prev[1], x, y, dz - 0.003, (k % 4 < 2) ? '#e8a07a' : '#5a140e', 0.013));
        prev = ok ? [x, y] : null;
      }
    }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const x = 541 + i * 18 + (j % 2) * 9, y = 701 + j * 11; if (x < 604) pr.push(...ball(x, y, dz - 0.004, 2.4, j % 2 ? '#f4d098' : '#2a1a40', { flat: 0.5, ink: false })); }
    pr.push(line(531, 735, 606, 744, dz - 0.003, '#f0c090', 0.02), line(531, 694, 607, 694, dz - 0.003, '#f0c090', 0.02));
    pr.push(line(531, 694, 531, 735, dz - 0.003, '#e8b888', 0.01), line(607, 694, 606, 744, dz - 0.003, '#e8b888', 0.01));
    for (let i = 0; i < 9; i++) { const x = 528 + i * 9.5, y = 740 + (x - 526) * 0.14; pr.push(line(x, y, x - 1, y + 7, dz - 0.002, '#c85a40', 0.008)); }
    for (let y = 700; y < 740; y += 6) pr.push(line(527, y, 522, y + 4, dz - 0.002, '#c85a40', 0.008));
    S.item(Z0 - 0.085, pr, { name: 'runner' });
  }

  /* ---------- ящик с бутылками ---------- */
  {
    const x0 = 602, x1 = 685, yT = 768, yB = 822, dz = -0.24, dep = 0.32, c = '#a8682e';
    const inner = [];
    bx(x0, yT - 4, x1, yB, dz + dep - 0.02, 0.02, dark(c, 0.35), { ink: false }, inner);
    S.item(Z0 + dz + dep, inner, { name: 'crate_back' });
    for (const [i, bc] of [[0, '#4a7a3a'], [1, '#9a5a28'], [2, '#5a8a48'], [3, '#b07a38'], [4, '#3e6a34'], [5, '#8a4a24']].map((q) => q)) {
      const x = 619 + i * 11 + (i % 2) * 2, p = P(x, yB, dz + 0.1 + (i % 2) * 0.1), h = 78 - (i % 3) * 6;
      lathe(S, p[0], p[2], [[m(5), 0, 'c'], [m(5), m(h * 0.62), 'c'], [m(2), m(h * 0.8)], [m(1.8), m(h), 'c'], [0, m(h), 'c']], bc, { y0: p[1], key: Z0 + dz + 0.1 + (i % 2) * 0.1, spec: 1.0, top: '#d8b878' });
      S.item(Z0 + dz + 0.095 + (i % 2) * 0.1, [flat(rect(x - 3.5, yB - h * 0.5, x + 3.5, yB - h * 0.36), dz + 0.1 + (i % 2) * 0.1 - m(5.2), '#f0e4c8', { bump: true }), flat(rect(x - 1.8, yB - h - 1, x + 1.8, yB - h * 0.93), dz + 0.1 + (i % 2) * 0.1 - m(2), '#d8a840', { bump: true })], { name: 'bottle_label' });
    }
    const fr = [];
    const Y0 = P(0, yB)[1], Y1 = P(0, yT)[1], X0 = P(x0, 0)[0], X1 = P(x1, 0)[0], zf = Z0 + dz, zb = zf + dep;
    const quad = (ps, col, n) => fr.push({ t: 'poly', ps, alb: col, n, pl: [...n, n[0] * ps[0][0] + n[1] * ps[0][1] + n[2] * ps[0][2]], base: true, ink: true, sw: M.pxw(0.008), spec: 0.15, op: 1 });
    quad([[X0, Y0, zf], [X1, Y0, zf], [X1, Y1, zf], [X0, Y1, zf]], c, [0, 0, -1]);
    if (X1 < 0) quad([[X1, Y0, zf], [X1, Y0, zb], [X1, Y1, zb], [X1, Y1, zf]], dark(c, 0.15), [1, 0, 0]);
    for (const y of [786, 804]) fr.push(line(x0 + 1, y, x1 - 1, y, dz - 0.003, dark(c, 0.5), 0.012));
    for (const [a, b] of [[x0, x0 + 6], [x1 - 6, x1]]) fr.push(flat(rect(a, yT, b, yB), dz - 0.006, dark(c, 0.1), { bump: true, ink: true }));
    for (let i = 0; i < 14; i++) { const y = yT + 4 + rnd() * (yB - yT - 6), x = x0 + 8 + rnd() * 50; fr.push(line(x, y, x + 8 + rnd() * 16, y, dz - 0.004, dark(c, 0.28), 0.004)); }
    fr.push(flat(rect(x0, yT, x1, yT + 5), dz - 0.004, lite(c, 0.1), { bump: true }));
    fr.push(flat(rect(611, 788, 626, 799), dz - 0.005, '#f4ecdc', { bump: true, ink: true }));
    S.item(zf, fr, { name: 'crate_front' });
  }

  /* ---------- меловая доска с подарком ---------- */
  {
    const dz = -0.32, pr = [], fc = '#6a3a1c', n = [0, 0.35, -1];
    pr.push(flat([[688, 712], [697, 712], [709, 820], [699, 820]], dz + 0.25, dark(fc, 0.3), { ink: true })); // задняя нога
    pr.push(flat([[686, 708], [762, 708], [766, 820], [758, 820], [756, 805], [691, 805], [688, 820], [680, 820]], dz, fc, { ink: true, n }));
    pr.push(flat([[694, 716], [754, 716], [756, 799], [692, 799]], dz - 0.002, '#3e3a3a', { bump: true, n, spec: 0.05 }));
    const ch = '#ece8e0', t = 0.006, L = (a, b, c2, e) => pr.push(line(a, b, c2, e, dz - 0.004, ch, t));
    L(707, 760, 741, 760); L(741, 760, 741, 786); L(741, 786, 707, 786); L(707, 786, 707, 760);
    L(704, 752, 744, 752); L(744, 752, 744, 760); L(704, 760, 704, 752);
    L(724, 752, 724, 786);
    L(724, 752, 712, 738); L(712, 738, 708, 746); L(708, 746, 724, 752);
    L(724, 752, 736, 738); L(736, 738, 740, 746); L(740, 746, 724, 752);
    S.item(Z0 + dz, pr, { name: 'chalkboard' });
  }
});

/** Гортензия в терракотовом горшке: пиксели референса, своя глубина Z и линия земли gy. */
reg('hydrangea', (S, d) => {
  const M = mapper(S, d), { Z0, P, m } = M, KZ = d.keyZ ?? Z0;
  const [px, pyB] = d.pot, pw = d.potW ?? 70, ph = d.potH ?? 67, p = P(px, pyB);
  const r = m(pw / 2);
  lathe(S, p[0], p[2], [[r * 0.72, 0, 'c'], [r * 0.78, m(ph) * 0.1], [r * 0.95, m(ph) * 0.8], [r, m(ph) * 0.84, 'c'], [r * 1.06, m(ph) * 0.86], [r * 1.06, m(ph), 'c'], [r * 0.9, m(ph), 'c']], d.potColor || '#c8682e', { y0: p[1], key: KZ - 0.02, spec: 0.3, top: '#3a2a1a', rings: { ys: [p[1] + m(ph) * 0.84], color: '#8a3a1a' } });
  const leaves = [], heads = [];
  for (const [x, y, rr] of d.leaves) leaves.push(...cluster(M, x, y, -0.05, rr, Math.round(rr * 1.6), ['#5a8a30', '#4a7a28', '#6a9a38', '#3a6420', '#7aa840'], 6.5, { flat: 0.5, ink: true, wob: 0.2 }));
  const itL = S.item(KZ - 0.06, leaves, { name: 'hydrangea_leaves' });
  occluders(S, itL, d.leaves.map(([x, y, rr]) => [P(x, y, -0.05), m(rr)]), 0.75);
  const cols = d.flower || ['#e8a8d0', '#d898c8', '#c8a0e0', '#f0b8d8'];
  for (const [x, y, rr] of d.heads) {
    const c = cols[Math.floor(rnd() * cols.length)];
    heads.push(...M.ball(x, y, -0.1, rr, dark(c, 0.15), { flat: 0.1, ink: true }));
    heads.push(...cluster(M, x, y, -0.1 - m(rr) * 0.5, rr * 0.92, Math.round(rr * 1.6), [c, lite(c, 0.12), dark(c, 0.06)], rr * 0.24, { flat: 0.15 }));
  }
  const itH = S.item(KZ - 0.12, heads, { name: 'hydrangea_heads' });
  occluders(S, itH, d.heads.map(([x, y, rr]) => [P(x, y, -0.1), m(rr)]), 0.85);
});
