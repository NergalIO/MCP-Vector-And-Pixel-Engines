// Доводка по плиткам референса (refs/stairs.webp): предметы, заданные в пикселях кадра 1920×1081 на плоскости z = Z.
// gy — экранная y линии земли для этой глубины (для фасада: hor + camH·f/Z), тогда Y = (gy − y)·Z/f — настоящая высота.
import { registerWorldItem, dark, lite, jit, rnd } from '../../engine/world3d.js';

const TAU = Math.PI * 2;
const reg = (type, build) => registerWorldItem(type, { doc: type, build });

/**
 * Карта pxMap для створки, повёрнутой на петлях: точка в t = (x − hx)·k от петли уходит вдоль стены на t·cos(ang) и к
 * камере на |t|·sin(ang); сдвиг слоя dz — по нормали створки. side — куда от петли лежит створка (±1 по x).
 */
function ajarMap(M, hx, ang, side) {
  const { k, Z0 } = M, S = M.S, cs = Math.cos(ang), sn = Math.sin(ang);
  const Rv = (v) => side > 0 ? [v[0] * cs + v[2] * sn, v[1], -v[0] * sn + v[2] * cs] : [v[0] * cs - v[2] * sn, v[1], v[0] * sn + v[2] * cs];
  let N = Rv([0, 0, -1]);
  const P = (x, y, dz = 0) => { const h = M.P(hx, y, 0), t = (x - hx) * k; return [h[0] + t * cs - N[0] * dz, h[1], Z0 - Math.abs(t) * sn - N[2] * dz]; };
  const mid = P(hx + side * 5, 0);
  const flip = !S.faces(N, mid) ? -1 : 1;
  const fl = (v) => Rv(v).map((q, i) => (i === 1 ? q : q * flip));
  N = N.map((q) => q * flip);
  const flat = (pts, dz, alb, o = {}) => { const ps = pts.map(([x, y]) => P(x, y, dz)); return { t: 'poly', ps, alb, n: fl(o.n || [0, 0.08, -1]), pl: [...N, N[0] * ps[0][0] + N[1] * ps[0][1] + N[2] * ps[0][2]],
    base: !o.bump, bump: !!o.bump, ink: o.ink ?? false, sw: M.pxw(o.sw ?? 0.01, Z0), spec: o.spec ?? 0.2, op: o.op ?? 1 }; };
  const line = (x0, y0, x1, y1, dz, c, t, o = {}) => S.line(P(x0, y0, dz), P(x1, y1, dz), c, M.pxw(t, Z0), o);
  return { ...M, P, flat, line };
}

export function pxMap(S, d) {
  const Z0 = d.Z, f = d.f ?? 2000, cx = d.cx ?? 950, gy = d.gy, k = Z0 / f;
  const P = (x, y, dz = 0) => [(x - cx) * k, (gy - y) * k, Z0 + dz];
  const pxw = (t, z = Z0) => Math.max(0.6, t * S.pxPerUnit(z));
  const flat = (pts, dz, alb, o = {}) => ({ t: 'poly', ps: pts.map(([x, y]) => P(x, y, dz)), alb, n: o.n || [0, 0.08, -1], pl: [0, 0, -1, -(Z0 + dz)],
    base: !o.bump, bump: !!o.bump, ink: o.ink ?? false, sw: pxw(o.sw ?? 0.01, Z0 + dz), spec: o.spec ?? 0.2, op: o.op ?? 1, ...(o.em ? { em: o.em } : {}) });
  const rect = (x0, y0, x1, y1) => [[x0, y1], [x1, y1], [x1, y0], [x0, y0]];
  const line = (x0, y0, x1, y1, dz, c, t, o = {}) => S.line(P(x0, y0, dz), P(x1, y1, dz), c, pxw(t, Z0 + dz), o);
  return { S, Z0, k, P, pxw, flat, rect, line };
}

/**
 * Ставня-жалюзи: прямоугольник [x0,y0,x1,y1] с рамкой и косыми ламелями. sw = {hx, ang} — приоткрыта: петли на кромке hx
 * (у окна), дальняя кромка отходит от стены на угол ang; тогда в occ — четырёхугольник створки (тень на стену).
 */
function shutter(M, x0, y0, x1, y1, dz, c, out, sw = null, occ = null) {
  if (sw?.ang) M = ajarMap(M, sw.hx, sw.ang, x0 + x1 - 2 * sw.hx > 0 ? 1 : -1);
  const { flat, rect, line } = M;
  out.push(flat(rect(x0, y0, x1, y1), dz, c, { ink: true, sw: 0.012, n: [0, 0.05, -1] }));
  if (sw?.ang) { // торец у дальней кромки и тень
    const xo = x0 + x1 - 2 * sw.hx > 0 ? x1 : x0;
    out.push(line(xo, y0, xo, y1, dz, dark(c, 0.5), 0.035));
    occ?.push([M.P(x0, y0, dz), M.P(x1, y0, dz), M.P(x1, y1, dz), M.P(x0, y1, dz)]);
  }
  const b = Math.max(2, (x1 - x0) * 0.12);
  out.push(flat(rect(x0 + b, y0 + b, x1 - b, y1 - b), dz - 0.002, dark(c, 0.12), { bump: true }));
  for (let y = y0 + b + 4; y < y1 - b - 1; y += 5.5) {
    out.push(flat(rect(x0 + b, y, x1 - b, y + 2.2), dz - 0.004, lite(c, 0.1), { bump: true, n: [0, 0.6, -1] }));
    out.push(line(x0 + b, y + 2.4, x1 - b, y + 2.4, dz - 0.004, dark(c, 0.45), 0.006));
  }
  const mid = (y0 + y1) / 2;
  out.push(flat(rect(x0 + b, mid - 2, x1 - b, mid + 2), dz - 0.006, c, { bump: true, ink: true, sw: 0.006 }));
}

/**
 * Окно по пикселям: {Z, gy, glass:[x0,y0,x1,y1], shutL:[x0,x1], shutR:[x0,x1], shut (цвет), lit, cols, rows, trim, sill, frame}.
 * Светлый наличник, тёмная рама с переплётом, янтарное стекло (lit) с бликом сверху, подоконник, жалюзи.
 */
reg('pxWin', (S, d) => {
  const M = pxMap(S, d), { flat, rect, line, P } = M, out = [];
  const [x0, y0, x1, y1] = d.glass, tr = d.trimW ?? 6, frame = d.frame || '#4a2c1c', trim = d.trim || '#efe2c8';
  if (d.trim !== false) out.push(flat(rect(x0 - tr, y0 - tr, x1 + tr, y1 + 2), -0.004, trim, { ink: true, sw: 0.01, n: [0, 0.1, -1] }));
  out.push(flat(rect(x0, y0, x1, y1), -0.006, frame, { bump: true }));
  const fw = d.frameW ?? 3, lit = d.lit !== false;
  const gx0 = x0 + fw, gx1 = x1 - fw, gy0 = y0 + fw, gy1 = y1 - fw;
  if (lit) {
    out.push(flat(rect(gx0, gy0, gx1, gy1), -0.008, d.glow || '#d88430', { bump: true, em: d.em || '#a85010', spec: 0.6 }));
    out.push(flat(rect(gx0, gy0, gx1, gy0 + (gy1 - gy0) * 0.45), -0.009, d.glowHi || '#f8c060', { bump: true, em: '#c87820', spec: 0.6, op: 0.7 }));
    S.light([...P((x0 + x1) / 2, (y0 + y1) / 2, -0.7)], '#ffb860', d.radius ?? 2.6, d.energy ?? 0.6, 'window');
  } else {
    // тёмное стекло отражает закатное небо: тёплый верх, холодный низ, косой блик
    const gh = gy1 - gy0, gw = gx1 - gx0;
    out.push(flat(rect(gx0, gy0, gx1, gy1), -0.008, d.glass2 || '#4a5672', { bump: true, spec: 1 }));
    out.push(flat(rect(gx0, gy0, gx1, gy0 + gh * 0.4), -0.0085, d.refl || '#d8a898', { bump: true, spec: 1, op: 0.75 }));
    out.push(flat(rect(gx0, gy0 + gh * 0.4, gx1, gy0 + gh * 0.62), -0.0085, '#9a90a8', { bump: true, spec: 1, op: 0.55 }));
    out.push(flat([[gx0 + gw * 0.15, gy1], [gx0 + gw * 0.42, gy1], [gx0 + gw * 0.95, gy0 + gh * 0.08], [gx0 + gw * 0.68, gy0 + gh * 0.08]], -0.009, '#f4e8dc', { bump: true, spec: 1, op: 0.3 }));
  }
  const cols = d.cols ?? 2, rows = d.rows ?? 3;
  for (let i = 1; i < cols; i++) { const x = gx0 + ((gx1 - gx0) * i) / cols; out.push(flat(rect(x - fw / 2, gy0, x + fw / 2, gy1), -0.01, frame, { bump: true })); }
  for (let j = 1; j < rows; j++) { const y = gy0 + ((gy1 - gy0) * j) / rows; out.push(flat(rect(gx0, y - 1, gx1, y + 1), -0.01, frame, { bump: true })); }
  if (d.sill !== false) out.push(flat(rect(x0 - tr - 4, y1 + 1, x1 + tr + 4, y1 + 6), -0.03, d.sillColor || '#d8c4a8', { ink: true, sw: 0.008, n: [0, 0.8, -1] }));
  // ставни приоткрыты (ajar, рад; 0 — плашмя на стене): петли у окна, дальние кромки отходят от стены и бросают тень
  const sc = d.shut, aj = d.ajar ?? 0.38, occ = [];
  if (sc && d.shutL) shutter(M, d.shutL[0], y0 - 3, d.shutL[1], y1 + 2, -0.02, sc, out, { hx: d.shutL[1], ang: aj }, occ);
  if (sc && d.shutR) shutter(M, d.shutR[0], y0 - 3, d.shutR[1], y1 + 2, -0.02, sc, out, { hx: d.shutR[0], ang: aj }, occ);
  const it = S.item(d.key ?? d.Z - 0.03, out, { name: 'pxWin', force: occ.length > 0 });
  for (const [a, b, c, e] of occ) { S.tri3([a, b, c], it); S.tri3([a, c, e], it); }
});

/** Отдельная ставня (окно за кадром или за листвой): {Z, gy, r:[x0,y0,x1,y1], color}. */
reg('pxShutter', (S, d) => { const M = pxMap(S, d), out = []; shutter(M, ...d.r, -0.02, d.color, out); S.item(d.key ?? d.Z - 0.03, out, { name: 'pxShutter' }); });

/** Настенный светильник-шар на кронштейне: {Z, gy, at:[x,y], r (px)}. */
reg('wallBulb', (S, d) => {
  const M = pxMap(S, d), { flat, line } = M, [x, y] = d.at, r = d.r ?? 9, out = [];
  const ring = (cx, cy, rr, n = 20) => Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * TAU) * rr, cy + Math.sin((i / n) * TAU) * rr]);
  out.push(flat(ring(x - 3, y, r * 0.75), -0.01, '#2a2224', { ink: true, n: [-0.3, 0.2, -1] }));
  out.push(line(x - 3, y, x + r * 0.9, y + 2, -0.03, '#2a2224', 0.02));
  out.push(flat(ring(x + r * 0.2, y + 1, r * 0.55), -0.04, '#3a3034', { ink: true, n: [0.3, 0.3, -1], spec: 0.8 }));
  S.item(d.key ?? d.Z - 0.05, out, { name: 'wallBulb' });
});

/** Чугунная крышка люка с узором: кольца, радиальные рёбра, ромбики по кругу. {X, Z, r}. */
reg('manholeDeco', (S, d) => {
  const { X, Z } = d, r = d.r ?? 0.42, out = [];
  const disc = (y, rr, c, o = {}) => { const ps = []; for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU; ps.push([X + Math.cos(a) * rr, y, Z + Math.sin(a) * rr]); } return { t: 'poly', ps, alb: c, n: [0, 1, 0], pl: [0, 1, 0, y], base: !!o.base, bump: !o.base, ink: o.ink ?? false, sw: Math.max(0.6, 0.01 * S.pxPerUnit(Z)), spec: o.spec ?? 0.5, op: 1 }; };
  const seg = (a, b, c, t) => S.line([X + a[0], 0.009, Z + a[1]], [X + b[0], 0.009, Z + b[1]], c, Math.max(0.6, t * S.pxPerUnit(Z)));
  out.push(disc(0.004, r * 1.1, '#5a4e4a', { base: true, ink: true }), disc(0.006, r, '#4a3e3c'), disc(0.007, r * 0.97, '#6a5c56'));
  for (const k of [0.8, 0.42]) { const ps = []; for (let i = 0; i <= 48; i++) { const a = (i / 48) * TAU; ps.push([Math.cos(a) * r * k, Math.sin(a) * r * k]); } for (let i = 0; i < 48; i++) out.push(seg(ps[i], ps[i + 1], '#2e2624', 0.018)); }
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, c = Math.cos(a), s = Math.sin(a); out.push(seg([c * r * 0.42, s * r * 0.42], [c * r * 0.8, s * r * 0.8], '#2e2624', 0.014)); }
  for (let i = 0; i < 24; i++) { const a = ((i + 0.5) / 24) * TAU, c = Math.cos(a), s = Math.sin(a), q = r * 0.89, e = r * 0.035; out.push(seg([c * (q - e), s * (q - e)], [c * (q + e), s * (q + e)], '#2e2624', 0.02)); }
  out.push(disc(0.0085, r * 0.15, '#3a302e'));
  for (let i = -2; i <= 2; i++) out.push(seg([-r * 0.3, i * r * 0.07], [r * 0.3, i * r * 0.07], '#3a302e', 0.012));
  S.item(d.key ?? Z + r, out, { name: 'manhole' });
});

/** Бочка поверх токарной формы: клёпки разного тона со швами и железные обручи. {X, Z, r, h, n, hoops:[y…], color}. */
reg('barrelStaves', (S, d) => {
  const { X, Z } = d, r = d.r ?? 0.3, h = d.h ?? 1, n = d.n ?? 16, out = [], y0 = d.Y ?? 0, c = d.color || '#b8743a';
  const rr = (t) => r * (0.84 + 0.16 * Math.sin(Math.PI * t)) + 0.004;
  const th = Math.atan2(S.cam[2] - Z, S.cam[0] - X), vis = (a) => Math.abs(Math.atan2(Math.sin(a - th), Math.cos(a - th))) < Math.PI / 2 - 0.05;
  const P = (a, t, dr = 0) => [X + Math.cos(a) * (rr(t) + dr), y0 + t * h, Z + Math.sin(a) * (rr(t) + dr)];
  const quad = (ps, col, a, o = {}) => { const nn = [Math.cos(a), 0.15, Math.sin(a)]; return { t: 'poly', ps, alb: col, n: nn, pl: [...nn, nn[0] * ps[0][0] + nn[1] * ps[0][1] + nn[2] * ps[0][2]], bump: true, base: false, ink: false, spec: o.spec ?? 0.3, op: 1 }; };
  const sw = Math.max(0.6, 0.01 * S.pxPerUnit(Z));
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU, am = (a0 + a1) / 2;
    if (!vis(am)) continue;
    const col = jit(i % 3 === 0 ? lite(c, 0.08) : i % 3 === 1 ? c : dark(c, 0.08), 0.05);
    for (let k = 0; k < 6; k++) { const t0 = k / 6, t1 = (k + 1) / 6; out.push(quad([P(a0, t0), P(a1, t0), P(a1, t1), P(a0, t1)], col, am)); }
    for (let k = 0; k < 6; k++) out.push(S.line(P(a0, k / 6, 0.001), P(a0, (k + 1) / 6, 0.001), dark(c, 0.5), sw));
  }
  for (const hy of d.hoops ?? [0.1, 0.42, 0.8]) {
    const hw = 0.055;
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * TAU, a1 = ((i + 1) / 24) * TAU, am = (a0 + a1) / 2;
      if (!vis(am)) continue;
      out.push(quad([P(a0, hy, 0.01), P(a1, hy, 0.01), P(a1, hy + hw, 0.01), P(a0, hy + hw, 0.01)], d.hoop || '#3e3638', am, { spec: 0.8 }));
      out.push(S.line(P(a0, hy + hw, 0.012), P(a1, hy + hw, 0.012), '#8a8088', sw * 0.8));
    }
  }
  S.item(d.key ?? Z - r - 0.01, out, { name: 'barrel_staves' });
});

/** Ящик с цветами вдоль оси Z (на перилах, уходящих вглубь): {X, z:[z0,z1], y (низ), h, d (вынос по +X), flower, leaf}. */
import { obox, occluders } from './plaza.props.mjs';
import { sphere } from '../../engine/world3d.js';
reg('zPlanter', (S, d) => {
  const [z0, z1] = d.z, h = d.h ?? 0.2, dep = d.d ?? 0.22, X = d.X, y = d.y, prims = [], occ = [];
  obox(S, { o: [X + dep, z0], ang: 90, len: z1 - z0, wid: dep, y: [y, y + h], color: d.color || '#9a6438', top: '#4a3020', side: dark(d.color || '#9a6438', 0.15), key: d.key ?? z0 - 0.02, name: 'zplanter' });
  const n = Math.max(3, Math.round((z1 - z0) / 0.16)), fl = Array.isArray(d.flower) ? d.flower : [d.flower || '#e85a4a'];
  const list = [];
  for (let i = 0; i < n; i++) {
    const z = z0 + ((i + 0.5) * (z1 - z0)) / n;
    list.push({ p: [X + dep / 2 + (rnd() - 0.5) * 0.08, y + h + 0.06, z], r: 0.11 + rnd() * 0.04, c: jit(d.leaf || '#5a8a3a', 0.12), l: true });
    for (let k = 0; k < 3; k++) list.push({ p: [X + dep / 2 + (rnd() - 0.5) * 0.18, y + h + 0.1 + rnd() * 0.08, z + (rnd() - 0.5) * 0.14 - 0.04], r: 0.045 + rnd() * 0.02, c: jit(fl[Math.floor(rnd() * fl.length)], 0.08), l: false });
  }
  list.sort((A, B) => B.p[2] - A.p[2]);
  for (const q of list) { prims.push(...sphere(S, q.p[0], q.p[1], q.p[2], q.r, q.c, { prims: true, flat: q.l ? 0.45 : 0.2, wob: 0.12, ink: true })); if (q.l) occ.push([q.p, q.r]); }
  const it = S.item(d.key != null ? d.key - 0.01 : z0 - 0.05, prims, { name: 'zplanter_plants' });
  occluders(S, it, occ);
});

/** Пустой предмет-слот для анимации (stairs.anim.mjs): группа узлов на месте key в порядке художника. */
reg('animSlot', (S, d) => { S.item(d.key, [], { force: true, keep: true, name: `slot:${d.slot}` }); });
