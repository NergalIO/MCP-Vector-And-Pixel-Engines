// Анимация сцены «Лестница» (stairs.build.mjs): петля T секунд, запечённая в ключи узлов Kontur.
//  • кот на ступени: лежит (дыхание, хвост, моргание), играет с листом и своим хвостом, крадётся к голубям,
//    виляет задом, прыгает, промахивается, смотрит вслед, умывается, возвращается и ложится;
//  • голуби: двое садятся на ступень рядом с котом, двое ходят и клюют на площади; все взлетают от прыжка кота,
//    голуби площади возвращаются;
//  • ветер: флажки качаются, плющ и цветы колышутся (модификаторы oscillate с частотами, кратными 1/T), по площади
//    перекатываются листья.
// Персонажи рисуются по кадрам: поза (скелет + формы) → контуры в пикселях кадра 1920×1080, ключи d с hold.
// Порядок художника — через пустые предметы animSlot (stairs.build.mjs): актёр становится детьми слота.

export const T = 20, FPS = 24;
const NF = T * FPS;
const F = 2000, HOR = 380, CAMH = 3.38, CX = 950;
const TAU = Math.PI * 2;

/* ============================== математика ============================== */
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, u) => a + (b - a) * u;
const sm = (u) => { u = clamp(u); return u * u * (3 - 2 * u); };
const seg = (t, a, b) => clamp((t - a) / (b - a));
const pulse = (t, c, w) => { const u = Math.abs(t - c) / w; return u >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * u); };
const frac = (v) => v - Math.floor(v);
const easeIn = (u) => u * u, easeOut = (u) => 1 - (1 - u) * (1 - u);
const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]);
const rot = (p, a, c = [0, 0]) => { const s = Math.sin(a), co = Math.cos(a), x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * co - y * s, c[1] + x * s + y * co]; };
const clone = (o) => JSON.parse(JSON.stringify(o));
function mix(a, b, u) {
  if (typeof a === 'number') return a + (b - a) * u;
  if (Array.isArray(a)) return a.map((v, i) => mix(v, b[i], u));
  const o = {};
  for (const k in a) o[k] = k in b ? mix(a[k], b[k], u) : a[k];
  return o;
}
const proj = (X, Y, Z) => [CX + (X * F) / Z, HOR + ((CAMH - Y) * F) / Z];
const stepTop = (Z) => 0.15 * (Math.floor((Z - 10.5) / 0.4) + 1);

/* ============================== контуры ============================== */
const ellipse = (c, rx, ry, a = 0, n = 14) => Array.from({ length: n }, (_, i) => { const t = (i / n) * TAU; return rot([c[0] + rx * Math.cos(t), c[1] + ry * Math.sin(t)], a, c); });
/** Открытый сплайн Катмулла — Рома через точки, per отрезков на интервал. */
function spline(ps, per = 4) {
  const out = [ps[0]];
  for (let i = 0; i < ps.length - 1; i++) {
    const p0 = ps[Math.max(0, i - 1)], p1 = ps[i], p2 = ps[i + 1], p3 = ps[Math.min(ps.length - 1, i + 2)];
    for (let k = 1; k <= per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  return out;
}
/** Конечность с толщинами, заданными по точкам (линейно по длине). */
function limbW(ps, w0, w1, capN = 4) {
  const ws = ps.map((_, i) => lerp(w0, w1, i / Math.max(1, ps.length - 1)));
  const n = ps.length, L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = ps[Math.max(0, i - 1)], b = ps[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const w = ws[i] / 2;
    L.push([ps[i][0] - ty * w, ps[i][1] + tx * w]); R.push([ps[i][0] + ty * w, ps[i][1] - tx * w]);
  }
  const arc = (c, from, to) => {
    const r = Math.hypot(from[0] - c[0], from[1] - c[1]), a0 = Math.atan2(from[1] - c[1], from[0] - c[0]);
    let da = Math.atan2(to[1] - c[1], to[0] - c[0]) - a0;
    while (da > 0) da -= TAU; while (da < -TAU) da += TAU;
    if (da > -0.1) da -= TAU;
    const out = []; for (let k = 1; k < capN; k++) { const a = a0 + (da * k) / capN; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
    return out;
  };
  const Rr = R.slice().reverse();
  return [...L, ...arc(ps[n - 1], L[n - 1], R[n - 1]), ...Rr, ...arc(ps[0], R[0], L[0])];
}
/** Двухзвенная ИК: сустав J, стопа P, звенья L1/L2, bend +1 — колено вперёд, −1 — назад. */
function ik(J, P, L1, L2, bend) {
  const d = sub(P, J); let dl = len(d); const maxd = (L1 + L2) * 0.995;
  let Pt = P;
  if (dl > maxd) { Pt = add(J, mul(d, maxd / dl)); dl = maxd; }
  dl = Math.max(dl, Math.abs(L1 - L2) + 1e-3);
  const a = Math.acos(clamp((L1 * L1 + dl * dl - L2 * L2) / (2 * L1 * dl), -1, 1));
  const base = Math.atan2(d[1], d[0]), ang = base + bend * a;
  return [J, add(J, [L1 * Math.cos(ang), L1 * Math.sin(ang)]), Pt];
}
const r1 = (v) => Math.round(v * 10) / 10;
/** Гладкий замкнутый путь (Катмулл — Ром → кубические Безье). */
function smoothD(ps) {
  const n = ps.length; let d = `M${r1(ps[0][0])} ${r1(ps[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = ps[(i - 1 + n) % n], p1 = ps[i], p2 = ps[(i + 1) % n], p3 = ps[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return d + 'Z';
}
const polyD = (ps) => 'M' + ps.map((p) => `${r1(p[0])} ${r1(p[1])}`).join('L') + 'Z';
const NONE = 'M0 0Z';

/* ============================== кот ============================== */
// Локальные координаты кота: метры, x — вперёд (к морде), y — вверх, 0 — земля под серединой тела.
const LIE = { ho: [-0.075, 0.004], hip: [-0.14, 0.075], sh: [0.12, 0.085], head: [0.215, 0.175], hr: 0.05, ear: 0, fN: [0.25, 0.012], fF: [0.22, 0.012], hN: [-0.03, 0.02], hF: [-0.05, 0.02], thigh: 1, tail: { a: 3.3, c: 0.3, w: 0.05 }, bt: 0.075, blink: 0, lift: 0 };
const STAND = { ho: [-0.035, 0.07], hip: [-0.15, 0.175], sh: [0.13, 0.18], head: [0.235, 0.27], hr: 0, ear: 0, fN: [0.13, 0], fF: [0.11, 0], hN: [-0.15, 0], hF: [-0.17, 0], thigh: 0, tail: { a: 1.95, c: -0.16, w: 0.05 }, bt: 0.07, blink: 0, lift: 0 };
const CROUCH = { ho: [-0.065, 0.03], hip: [-0.15, 0.13], sh: [0.13, 0.112], head: [0.25, 0.15], hr: -0.06, ear: 0.55, fN: [0.13, 0], fF: [0.1, 0], hN: [-0.11, 0], hF: [-0.13, 0], thigh: 0.45, tail: { a: 3.1, c: 0.02, w: 0.04 }, bt: 0.066, blink: 0, lift: 0 };
const POUNCE = { ho: [-0.06, 0.03], hip: [-0.2, 0.19], sh: [0.17, 0.23], head: [0.275, 0.285], hr: 0.12, ear: 0.3, fN: [0.35, 0.13], fF: [0.32, 0.11], hN: [-0.37, 0.08], hF: [-0.35, 0.095], thigh: 0, tail: { a: 3.0, c: -0.04, w: 0.02 }, bt: 0.06, blink: 0, lift: 0 };
const SIT = { ho: [-0.085, 0.004], hip: [-0.08, 0.075], sh: [0.06, 0.225], head: [0.115, 0.325], hr: 0.05, ear: 0, fN: [0.1, 0], fF: [0.085, 0], hN: [0.03, 0], hF: [0.0, 0], thigh: 1, tail: { a: 4.35, c: 0.5, w: 0.04 }, bt: 0.072, blink: 0, lift: 0 };

const CAT = { body: '#2c2830', far: '#1f1b24', rim: '#4c4660', ear: '#6a4a5a', eye: '#f2d040' };
export const CAT_PARTS = ['legFF', 'legHF', 'tail', 'body', 'legHN', 'thigh', 'neck', 'earF', 'head', 'earN', 'earIn', 'rim', 'eyeF', 'eyeN', 'legFN'];
export const CAT_FILL = { legFF: CAT.far, legHF: CAT.far, tail: CAT.body, body: CAT.body, thigh: CAT.body, legHN: CAT.body, neck: CAT.body, earF: CAT.far, head: CAT.body, earN: CAT.body, earIn: CAT.ear, rim: CAT.rim, eyeF: CAT.eye, eyeN: CAT.eye, legFN: CAT.body };

/** Цепочка хвоста в локальных координатах. */
function tailChain(p, ph) {
  const u = sub(p.sh, p.hip), L = len(u) || 1, ux = [u[0] / L, u[1] / L], vy = [-ux[1], ux[0]];
  const rH = p.bt * 1.05;
  let P = add(add(p.hip, mul(ux, -rH * 0.8)), mul(vy, rH * 0.25));
  const pts = [P]; let th = p.tail.a;
  for (let i = 0; i < 7; i++) {
    th += (i ? p.tail.c : 0) + p.tail.w * Math.sin(ph - i * 0.75);
    P = add(P, [0.047 * Math.cos(th), 0.047 * Math.sin(th)]);
    pts.push([P[0], Math.max(0.014, P[1])]);
  }
  return pts;
}

/** Контуры кота: {part: d}. tf(l) — локальная точка → пиксели кадра. */
export function catShapes(p, tf, ph) {
  const T_ = (pts) => pts.map(tf), out = {};
  const u = sub(p.sh, p.hip), L = len(u) || 1, ux = [u[0] / L, u[1] / L], vy = [-ux[1], ux[0]];
  const H = p.hip, S = p.sh, bt = p.bt, rH = bt * 1.05, rS = bt;
  const at = (o, a, b) => add(add(o, mul(ux, a)), mul(vy, b));
  // ноги: кости — отдельные сужающиеся капсулы (подпути одного пути с одинаковым обходом), лапа — овал.
  // Передняя: плечо → локоть (назад) → лапа. Задняя: бедро → колено (вперёд) → скакательный сустав → лапа.
  const PR = 0.015, above = (q) => [q[0], Math.max(0.012, q[1])];
  const capsule = (A, B, wa, wb, n = 6) => {
    let d = sub(B, A), l = len(d); if (l < 1e-6) { d = [1, 0]; l = 1; }
    const a0 = Math.atan2(d[0] / l, -d[1] / l), pts = [];
    for (let k = 0; k <= n; k++) { const a = a0 - (Math.PI * k) / n; pts.push([B[0] + (wb / 2) * Math.cos(a), B[1] + (wb / 2) * Math.sin(a)]); }
    for (let k = 0; k <= n; k++) { const a = a0 - Math.PI - (Math.PI * k) / n; pts.push([A[0] + (wa / 2) * Math.cos(a), A[1] + (wa / 2) * Math.sin(a)]); }
    return polyD(T_(pts));
  };
  const paw = (c) => capsule(add(c, [-0.007, 0]), add(c, [0.011, 0]), PR * 2, PR * 1.9);
  const front = (joint, foot, k) => {
    const [J, E0, P] = ik(joint, add(foot, [0, PR]), 0.085, 0.08, -1), E = above(E0);
    return capsule(J, E, 0.05 * k, 0.033 * k) + capsule(E, P, 0.032 * k, 0.027 * k) + paw(P);
  };
  const hind = (joint, foot, k) => {
    const want = add(add(foot, [0, PR]), p.ho);
    const [J, K0, Hk0] = ik(joint, want, 0.08, 0.072, 1), K = above(K0), Hk = above(Hk0);
    const P = sub(Hk, p.ho);
    return capsule(J, K, 0.072 * k, 0.045 * k) + capsule(K, Hk, 0.036 * k, 0.027 * k) + capsule(Hk, P, 0.027 * k, 0.025 * k) + paw(P);
  };
  const jF = at(S, 0.0, -0.025), jH = at(H, -0.015, -0.01);
  out.legFF = front(add(jF, [-0.014, 0.004]), p.fF, 0.92);
  out.legHF = hind(add(jH, [-0.014, 0.004]), p.hF, 0.92);
  out.legHN = hind(jH, p.hN, 1);
  out.legFN = front(jF, p.fN, 1);
  // хвост
  const tc = spline(tailChain(p, ph), 3);
  out.tail = smoothD(T_(limbW(tc, 0.04, 0.028, 4)));
  // тело
  const body = [at(H, -rH, 0.0), at(H, -rH * 0.45, rH * 0.95), at(H, L * 0.5, bt * 0.82), at(S, -rS * 0.1, rS * 1.04), at(S, rS * 1.0, -rS * 0.05),
    at(S, rS * 0.35, -rS * 0.95), at(H, L * 0.5, -bt * 0.85), at(H, -rH * 0.35, -rH * 0.92)];
  out.body = smoothD(T_(body));
  out.thigh = p.thigh > 0.02 ? smoothD(T_(ellipse(at(H, 0.025, -0.01), 0.075 * p.thigh + 0.001, 0.058 * p.thigh + 0.001, Math.atan2(ux[1], ux[0]) - 0.2, 12))) : NONE;
  // голова: точки в системе головы (x вперёд), поворот hr
  const hc = p.head, hrot = (q) => add(hc, rot(q, p.hr));
  out.neck = smoothD(T_(limbW([at(S, 0.02, 0.02), add(hc, rot([-0.02, -0.01], p.hr))], 0.105, 0.085, 4)));
  const headPts = [[-0.055, 0.0], [-0.045, 0.04], [0.0, 0.057], [0.045, 0.04], [0.068, 0.008], [0.062, -0.022], [0.03, -0.042], [-0.02, -0.045], [-0.05, -0.028]].map(hrot);
  out.head = smoothD(T_(headPts));
  const ear = (base0, tip, base1) => { const c = mul(add(base0, base1), 0.5), tp = rot(tip, p.ear * 0.9, c); return [base0, tp, base1]; };
  const eF = ear([-0.045, 0.03], [-0.04, 0.1], [-0.008, 0.05]), eN = ear([-0.014, 0.048], [0.008, 0.118], [0.036, 0.042]);
  out.earF = polyD(T_(eF.map(hrot)));
  out.earN = polyD(T_(eN.map(hrot)));
  const cN = [(eN[0][0] + eN[1][0] + eN[2][0]) / 3, (eN[0][1] + eN[1][1] + eN[2][1]) / 3];
  out.earIn = polyD(T_(eN.map((q) => add(cN, mul(sub(q, cN), 0.5))).map((q) => add(q, [0, 0.004])).map(hrot)));
  // светлая кромка спины и затылка
  out.rim = smoothD(T_(limbW(spline([at(H, -rH * 0.5, rH * 0.8), at(H, L * 0.5, bt * 0.7), at(S, -rS * 0.15, rS * 0.88)], 3), 0.014, 0.01, 3)));
  // глаза
  const bl = 1 - 0.92 * p.blink;
  out.eyeN = smoothD(T_(ellipse(hrot([0.038, 0.012]), 0.0145, 0.013 * bl + 0.001, p.hr, 10)));
  out.eyeF = smoothD(T_(ellipse(hrot([0.006, 0.016]), 0.0115, 0.011 * bl + 0.001, p.hr, 10)));
  return out;
}

/* ---------- сценарий кота ---------- */
const ZC = 17.45, sC = F / ZC, gyC = proj(0, stepTop(ZC), ZC)[1];
const xC = (X) => CX + X * sC;
const XH = 7.45, XS = 6.92, XP = 6.32;

/** Лист, с которым играет кот (0.55–2.8 с): точки пути в пикселях. */
const LEAF1 = [[0.5, 1650, 386], [0.85, 1712, 410], [1.2, 1768, 442], [1.45, 1749, 414], [1.8, 1771, 449], [2.05, 1810, 422], [2.4, 1895, 434], [2.85, 2000, 444]];
function pathAt(keys, t) {
  if (t <= keys[0][0]) return [keys[0][1], keys[0][2]];
  if (t >= keys[keys.length - 1][0]) { const k = keys[keys.length - 1]; return [k[1], k[2]]; }
  let i = 0; while (keys[i + 1][0] < t) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(keys.length - 1, i + 2)];
  const u = (t - k1[0]) / (k2[0] - k1[0]), u2 = u * u, u3 = u2 * u;
  return [1, 2].map((j) => 0.5 * (2 * k1[j] + (-k0[j] + k2[j]) * u + (2 * k0[j] - 5 * k1[j] + 4 * k2[j] - k3[j]) * u2 + (-k0[j] + 3 * k1[j] - 3 * k2[j] + k3[j]) * u3));
}

function gait(p, dist, stride, liftH, duty = 0.62) {
  const ph = dist / stride, S = stride * duty;
  for (const [k, o] of [['hN', 0], ['fN', 0.25], ['hF', 0.5], ['fF', 0.75]]) {
    const q = frac(ph + o);
    let dx, dy = 0;
    if (q < duty) dx = S / 2 - q * stride;
    else { const r = (q - duty) / (1 - duty); dx = -S / 2 + r * S; dy = liftH * Math.sin(Math.PI * r); }
    p[k] = [p[k][0] + dx, p[k][1] + dy];
  }
  const bob = 0.006 * Math.cos(TAU * 2 * ph);
  p.hip[1] += bob; p.sh[1] += bob * 0.7; p.head[1] += bob * 0.5;
}
const turn = (u, d0, d1) => (u < 0.5 ? d0 : d1) * Math.max(0.32, Math.abs(Math.cos(Math.PI * u)));
const toLocal = (q, x0, y0, s, dir) => [(q[0] - x0) / (dir * s), (y0 - q[1]) / s];

export function catAt(t) {
  let X = XH, dir = -1, p, lieK = 0;
  const x0 = () => xC(X);
  if (t < 4.2) {
    p = clone(LIE); lieK = 1;
    // игра с листом: голова следит, лапа бьёт в 1.2 и 1.8 с
    if (t > 0.5 && t < 2.9) {
      const lf = toLocal(pathAt(LEAF1, t), xC(XH), gyC, sC, -1);
      const k = sm(seg(t, 0.5, 0.8)) * (1 - sm(seg(t, 2.4, 2.9)));
      const look = clamp(Math.atan2(lf[1] - p.head[1], lf[0] - p.head[0]), -0.5, 0.7);
      p.head = mix(p.head, [0.225, 0.205], k); p.hr = lerp(p.hr, look * 0.8, k); p.ear = lerp(0, -0.25, k);
      const sw = Math.max(pulse(t, 1.2, 0.17), pulse(t, 1.8, 0.17));
      const reach = add(p.sh, [0.0, -0.035]), want = sub(lf, reach), wl = len(want), lim = 0.17;
      const tgt = wl > lim ? add(reach, mul(want, lim / wl)) : lf;
      p.fN = mix(p.fN, tgt, sw);
      p.tail.w = lerp(0.05, 0.16, k);
    }
    // настороженность: голова поднимается и смотрит на голубей, уши вперёд, кончик хвоста дёргается
    const al = sm(seg(t, 3.55, 4.0));
    p.head = mix(p.head, [0.235, 0.2], al); p.hr = lerp(p.hr, -0.1, al); p.ear = lerp(p.ear, -0.3, al);
    p.tail.w = lerp(p.tail.w, 0.12, al);
    p.ear += -0.6 * pulse(t, 2.95, 0.12);
  } else if (t < 4.8) {
    const a = clone(LIE); a.head = [0.235, 0.2]; a.hr = -0.1; a.ear = -0.3;
    p = mix(a, CROUCH, sm(seg(t, 4.2, 4.8))); lieK = 1 - seg(t, 4.2, 4.6);
  } else if (t < 7.0) {
    X = lerp(XH, XS, seg(t, 4.8, 7.0));
    p = clone(CROUCH); gait(p, XH - X, 0.15, 0.022);
  } else if (t < 7.8) {
    X = XS; p = clone(CROUCH);
    const k = sm(seg(t, 7.0, 7.25)) * (1 - sm(seg(t, 7.65, 7.8)));
    p.hip = [p.hip[0] + 0.014 * Math.sin(TAU * 3.2 * t) * k, p.hip[1] + 0.02 * k];
    p.hN = [p.hN[0], p.hN[1] + 0.012 * Math.max(0, Math.sin(TAU * 3.2 * t)) * k];
    p.hF = [p.hF[0], p.hF[1] + 0.012 * Math.max(0, -Math.sin(TAU * 3.2 * t)) * k];
    p.tail.w = 0.06 + 0.08 * k; p.tail.a = 3.05;
    p.sh[1] -= 0.01 * k; p.head[1] -= 0.012 * k;
  } else if (t < 8.3) {
    const u = seg(t, 7.8, 8.3);
    X = lerp(XS, XP, sm(u * 1.05));
    p = u < 0.5 ? mix(CROUCH, POUNCE, sm(u / 0.3)) : mix(POUNCE, CROUCH, sm((u - 0.55) / 0.45));
    p.lift = 0.2 * Math.sin(Math.PI * clamp(u * 1.08));
  } else if (t < 8.8) {
    X = XP; p = clone(CROUCH); p.ear = 0.2; p.hr = 0.05;
  } else if (t < 9.4) {
    X = XP; const a = clone(CROUCH); a.ear = 0.2; a.hr = 0.05; p = mix(a, SIT, sm(seg(t, 8.8, 9.4)));
  } else if (t < 10.8) {
    X = XP; p = clone(SIT);
    // смотрит вслед улетевшим голубям: голова вверх, потом опускается
    const up = sm(seg(t, 9.4, 9.8)) * (1 - 0.6 * sm(seg(t, 10.2, 10.8)));
    p.hr = lerp(0.05, 0.75, up); p.head = mix(p.head, [0.105, 0.335], up); p.ear = -0.2 * up;
    p.tail.w = 0.1; p.tail.a = 4.35 + 0.15 * Math.sin(TAU * 1.5 * t);
  } else if (t < 12.2) {
    X = XP; p = clone(SIT);
    // умывается: лапа к морде, голова наклонена, лижет
    const g = sm(seg(t, 10.8, 11.1)) * (1 - sm(seg(t, 11.9, 12.2)));
    const lick = 0.012 * Math.sin(TAU * 4 * t) * g;
    p.hr = lerp(0.29, -0.35, g); p.head = [p.head[0] + 0.01 * g, p.head[1] - 0.02 * g + lick];
    p.fN = mix(p.fN, add(p.head, [0.03, -0.065]), g);
    p.blink = 0.85 * g;
  } else if (t < 12.7) {
    X = XP; p = mix(SIT, STAND, sm(seg(t, 12.2, 12.7)));
  } else if (t < 13.0) {
    X = XP; p = clone(STAND); dir = turn(seg(t, 12.7, 13.0), -1, 1);
  } else if (t < 14.3) {
    dir = 1; X = lerp(XP, XH, seg(t, 13.0, 14.3));
    p = clone(STAND); gait(p, X - XP, 0.27, 0.045);
  } else if (t < 14.6) {
    X = XH; p = clone(STAND); dir = turn(seg(t, 14.3, 14.6), 1, -1);
  } else if (t < 15.2) {
    p = mix(STAND, LIE, sm(seg(t, 14.6, 15.2))); lieK = seg(t, 14.9, 15.2);
  } else {
    p = clone(LIE); lieK = 1;
    // игра с хвостом: хвост подтягивается вперёд, кончик дёргается, лапа бьёт по кончику
    const k = sm(seg(t, 16.3, 16.6)) * (1 - sm(seg(t, 17.6, 17.9)));
    p.tail.a = lerp(3.3, 3.75, k); p.tail.c = lerp(0.3, 0.42, k); p.tail.w = lerp(0.05, 0.22, k);
    const tip = tailChain(p, TAU * t / 2)[7];
    const sw = Math.max(pulse(t, 16.9, 0.16), pulse(t, 17.4, 0.16));
    p.fN = mix(p.fN, add(tip, [0.02, 0.02]), sw * 0.9);
    p.hr = lerp(p.hr, -0.25, k); p.head = mix(p.head, [0.2, 0.16], k);
  }
  // дыхание, моргание, подёргивание уха
  if (lieK > 0) { const br = Math.sin((TAU * t) / 2.5); p.bt *= 1 + 0.035 * br * lieK; p.head[1] += 0.003 * br * lieK; }
  p.blink = Math.max(p.blink, pulse(t, 3.1, 0.09), pulse(t, 6.2, 0.08), pulse(t, 15.7, 0.09), pulse(t, 19.25, 0.09), pulse(t, 9.15, 0.08));
  p.ear += -0.7 * pulse(t, 18.4, 0.1);
  return { x: x0(), y: gyC, s: sC, dir, p };
}

/* ============================== голубь ============================== */
// Локальные координаты: метры, x — вперёд, y — вверх, 0 — лапы.
const PIG_PARTS = ['wingF', 'tail', 'legF', 'legN', 'body', 'wingN', 'bars', 'neck', 'head', 'beak', 'eye'];
function pigeonShapes(q, tf, pal) {
  const out = {}, T_ = (pts) => pts.map((v) => tf(rot(v, q.pitch)));
  // ноги
  const legs = q.legs; // 0 — поджаты, 1 — стоит
  const lg = (hip, foot) => limbW([hip, foot], 0.013, 0.011, 3);
  if (legs > 0.05) {
    out.legF = smoothD(T_(lg([-0.005, 0.05], [lerp(-0.03, -0.012, legs) + q.stepF, lerp(0.05, 0.0, legs) + q.liftF])));
    out.legN = smoothD(T_(lg([0.02, 0.05], [lerp(-0.01, 0.024, legs) + q.stepN, lerp(0.05, 0.0, legs) + q.liftN])));
  } else { out.legF = NONE; out.legN = NONE; }
  out.body = smoothD(T_([[-0.12, 0.1], [-0.03, 0.145], [0.055, 0.158], [0.1, 0.128], [0.092, 0.075], [0.04, 0.045], [-0.04, 0.05], [-0.1, 0.078]]));
  out.tail = polyD(T_([[-0.11, 0.115], [-0.215, 0.106 + q.tailUp], [-0.222, 0.086 + q.tailUp], [-0.1, 0.082]]));
  // голова и шея
  const hc = add([0.112, 0.2], q.head);
  out.neck = smoothD(T_([[0.04, 0.15], [hc[0] - 0.02, hc[1] + 0.02], [hc[0] + 0.022, hc[1] - 0.018], [0.1, 0.1]]));
  out.head = smoothD(T_(ellipse(hc, 0.033, 0.031, 0, 10)));
  const bk = q.headDir;
  out.beak = polyD(T_([add(hc, rot([0.028, 0.008], bk)), add(hc, rot([0.062, -0.002], bk)), add(hc, rot([0.028, -0.009], bk))]));
  out.eye = smoothD(T_(ellipse(add(hc, rot([0.012, 0.009], bk)), 0.0075, 0.0075, 0, 8)));
  // крылья
  const W0 = [0.03, 0.135];
  if (q.fly > 0.01) {
    const wa = q.wing, up = Math.sin(wa) * 0.27, fold = 1 - q.fly;
    const wing = (k) => { const tip = add(W0, [-0.12 - 0.05 * fold, (up * k + 0.02) * q.fly]); return [add(W0, [0.045, 0.004]), add(tip, [0.05, 0.012]), tip, add(tip, [-0.06, -0.035 * Math.sign(up || 1)]), add(W0, [-0.12, -0.01])]; };
    out.wingN = smoothD(T_(wing(1)));
    out.wingF = smoothD(T_(wing(0.82).map((v) => add(v, [-0.012, 0.01]))));
    out.bars = NONE;
  } else {
    out.wingN = smoothD(T_([[-0.135, 0.108], [-0.04, 0.142], [0.055, 0.138], [0.045, 0.098], [-0.06, 0.088]]));
    out.wingF = NONE;
    out.bars = polyD(T_([[-0.05, 0.1], [-0.035, 0.128], [-0.025, 0.128], [-0.04, 0.098], [-0.075, 0.1], [-0.062, 0.126], [-0.052, 0.126], [-0.065, 0.098]]));
  }
  void pal;
  return out;
}
const PIG_PAL = [
  { body: '#5c6684', wingN: '#8a92ae', wingF: '#4a5270', bars: '#2e3246', tail: '#3e4460', neck: '#4a8a7a', head: '#4a5070', beak: '#d8a070', eye: '#f07030', legF: '#a83a2a', legN: '#d0503a' },
  { body: '#767c96', wingN: '#a8aec4', wingF: '#5c627c', bars: '#3a3e52', tail: '#4a5068', neck: '#5a8a86', head: '#5a6080', beak: '#dcae80', eye: '#f07030', legF: '#a83a2a', legN: '#d0503a' },
  { body: '#5a6280', wingN: '#9098b4', wingF: '#4a5270', bars: '#2e3246', tail: '#3a4058', neck: '#4e7e8a', head: '#4a5070', beak: '#d8a070', eye: '#f07030', legF: '#a83a2a', legN: '#d0503a' },
  { body: '#8a8c9c', wingN: '#c4c8d6', wingF: '#6a6e80', bars: '#4a4e60', tail: '#5a5e70', neck: '#6a9a8a', head: '#6a7088', beak: '#dcae80', eye: '#f07030', legF: '#a83a2a', legN: '#d0503a' },
];

/* ---------- поведение голубя ---------- */
// Наземный сценарий: [начало, конец, действие, параметр]: peck — клюёт, walk — идёт на dx метров, look — оглядывается, face — поворот.
function groundPose(script, tau, X0) {
  let X = X0, dir = script.dir0, q = { pitch: 0, head: [0, 0], headDir: 0, legs: 1, stepF: 0, stepN: 0, liftF: 0, liftN: 0, fly: 0, wing: 0, tailUp: 0 };
  for (const [a, b, act, v] of script.acts) {
    if (tau < a) break;
    const u = seg(tau, a, b);
    if (act === 'walk') {
      if (tau <= b) dir = Math.sign(v);
      const d = Math.abs(v) * u; X += Math.sign(v) * d;
      if (tau < b) {
        const ph = d / 0.06;
        q.stepF = 0.022 * Math.sin(TAU * ph); q.stepN = -q.stepF;
        q.liftF = 0.012 * Math.max(0, Math.cos(TAU * ph)); q.liftN = 0.012 * Math.max(0, -Math.cos(TAU * ph));
        q.head = [0.022 * (frac(ph) < 0.5 ? frac(ph) * 2 - 0.5 : 0.5 - (frac(ph) - 0.5) * 2) - 0.004, 0.004 * Math.sin(TAU * ph)];
      }
    } else if (act === 'face') { if (tau >= a) dir = v; }
    else if (act === 'peck' && tau < b) {
      const n = v || 2, k = sm(seg(tau, a, a + 0.2)) * (1 - sm(seg(tau, b - 0.2, b)));
      const pk = Math.pow(Math.max(0, Math.sin(Math.PI * frac(u * n))), 0.7) * k;
      q.pitch = -0.55 * pk; q.head = [0.03 * pk, -0.075 * pk]; q.headDir = -0.5 * pk; q.tailUp = 0.03 * pk;
    } else if (act === 'look' && tau < b) {
      const k = Math.sin(Math.PI * u);
      q.head = [-0.01 * k, 0.012 * k]; q.headDir = 0.25 * Math.sin(TAU * u);
    }
  }
  return { X, dir, q };
}
/** Полёт: wing — фаза взмаха; fly 0..1 — раскрытость крыльев. */
function flightPose(t, f, pitch, fly = 1) { return { pitch, head: [0.004, 0.006], headDir: 0.05, legs: 0, stepF: 0, stepN: 0, liftF: 0, liftN: 0, fly, wing: TAU * f * t, tailUp: 0.012 }; }

/** Голубь: { Z0, Y0, land: {t, X, from:[X,Y,Z], dur}, off: {t, to:[dX,Y,dZ], dur}, script }. */
function pigeonAt(P, t) {
  const tl = (t - P.land.t + T) % T, toff = (P.off.t - P.land.t + T) % T;
  // наземная часть: tau = tl - 0 … toff
  const ground = (tau) => groundPose(P.script, tau, P.land.X);
  if (tl <= toff) {
    const g = ground(tl);
    // складывание крыльев после посадки
    const fold = 1 - sm(seg(tl, 0, 0.3));
    if (fold > 0) { g.q.fly = fold; g.q.wing = 1.2; }
    return { X: g.X, Y: P.Y0, Z: P.Z0, dir: g.dir, q: g.q };
  }
  // взлёт и улёт
  const g0 = ground(toff), ta = tl - toff, ud = ta / P.off.dur;
  if (ud <= 1.15) {
    const u = easeIn(clamp(ud * 0.9)) + 0.1 * clamp(ud);
    const X = g0.X + P.off.to[0] * u, Y = P.Y0 + (P.off.to[1] - P.Y0) * u, Z = P.Z0 + P.off.to[2] * u;
    const pitch = lerp(-0.45, -0.08, sm(ud * 2));
    const q = flightPose(t, lerp(8.5, 6, clamp(ud)), pitch, sm(ud * 6));
    q.legs = 1 - sm(ud * 4);
    return { X, Y, Z, dir: Math.sign(P.off.to[0]) || g0.dir, q };
  }
  // возвращение: последние land.dur секунд перед посадкой
  const tin = (P.land.t - t + T) % T; // сколько осталось до посадки
  if (tin <= P.land.dur) {
    const u = 1 - tin / P.land.dur, e = easeOut(u);
    const [fx, fy, fz] = P.land.from;
    const X = lerp(fx, P.land.X, e), Y = lerp(fy, P.Y0, e), Z = lerp(fz, P.Z0, e);
    const dir = Math.sign(P.land.X - fx) || -1;
    let q;
    if (u < 0.62) q = flightPose(t, 5.5, -0.05);
    else if (u < 0.86) { q = flightPose(t, 0, -0.08); q.wing = 1.0; }
    else { const k = seg(u, 0.86, 1); q = flightPose(t, 3, lerp(-0.1, -0.5, sm(k))); q.wing = 1.2 + 0.6 * Math.sin(TAU * 3 * t); q.legs = sm(k * 1.6); }
    return { X, Y, Z, dir, q };
  }
  // за кадром
  const [fx, fy, fz] = P.land.from;
  return { X: fx, Y: fy, Z: fz, dir: -1, q: flightPose(t, 5, 0) };
}

const PIGEONS = [
  // на ступени у кота: прилетают слева сверху, лицом вправо, потом отворачиваются; взлетают от прыжка кота
  { id: 'pgA', slot: 'stairs', Z0: 17.55, Y0: stepTop(17.55), pal: 0, s: 0.95,
    land: { t: 2.95, X: 6.02, from: [2.4, 7.6, 21], dur: 0.95 },
    off: { t: 7.9, to: [-3.6, 9.2, 4.5], dur: 1.3 },
    script: { dir0: 1, acts: [[0.25, 0.3, 'face', -1], [0.45, 1.6, 'peck', 3], [1.65, 2.35, 'walk', -0.12], [2.4, 3.6, 'peck', 3], [3.65, 4.05, 'look'], [4.1, 4.95, 'peck', 2]] } },
  { id: 'pgB', slot: 'stairs', Z0: 17.55, Y0: stepTop(17.55), pal: 1, s: 0.92,
    land: { t: 3.15, X: 6.28, from: [2.0, 8.2, 22], dur: 1.0 },
    off: { t: 7.84, to: [-3.0, 10.0, 3.0], dur: 1.25 },
    script: { dir0: 1, acts: [[0.2, 1.1, 'peck', 2], [1.2, 1.75, 'walk', 0.1], [1.8, 1.85, 'face', -1], [1.95, 3.1, 'peck', 3], [3.2, 3.7, 'walk', -0.07], [3.75, 4.69, 'peck', 2]] } },
  // на площади (места референса): ходят и клюют, взлетают по тревоге, возвращаются
  { id: 'pgC', slot: 'square', Z0: 14.2, Y0: 0, pal: 2, s: 0.97,
    land: { t: 15.9, X: -0.55, from: [4.0, 9.0, 12.5], dur: 1.9 },
    off: { t: 8.15, to: [-4.2, 9.5, -2.0], dur: 1.6 },
    script: { dir0: -1, acts: [[0.4, 1.6, 'peck', 3], [1.7, 2.7, 'walk', -0.22], [2.8, 3.3, 'look'], [3.4, 4.6, 'peck', 3], [4.8, 6.0, 'walk', 0.25], [6.1, 7.4, 'peck', 3], [7.5, 8.0, 'walk', 0.1], [8.1, 9.6, 'peck', 4], [9.7, 10.2, 'look'], [10.3, 11.1, 'walk', -0.15], [11.2, 12.2, 'peck', 2]] } },
  { id: 'pgD', slot: 'square', Z0: 13.41, Y0: 0, pal: 3, s: 0.95,
    land: { t: 16.1, X: -0.45, from: [3.5, 9.5, 12.0], dur: 1.8 },
    off: { t: 8.35, to: [-3.6, 9.0, -1.5], dur: 1.5 },
    script: { dir0: -1, acts: [[0.3, 1.5, 'peck', 3], [1.6, 2.4, 'walk', 0.15], [2.5, 4.5, 'peck', 4], [4.6, 5.0, 'look'], [5.1, 6.4, 'walk', -0.3], [6.5, 8.0, 'peck', 3], [8.1, 8.6, 'walk', 0.1], [8.7, 10.2, 'peck', 3], [10.3, 10.7, 'look'], [10.8, 12.2, 'peck', 3]] } },
];

/* ============================== листья ============================== */
const LEAF_SHAPE = [[-0.5, 0], [-0.25, 0.28], [0.15, 0.32], [0.5, 0.05], [0.2, -0.22], [-0.2, -0.22]];
function leafD(c, size, ang, squash) { return smoothD(LEAF_SHAPE.map(([u, v]) => { const p = rot([u * size, v * size * squash], ang); return [c[0] + p[0], c[1] + p[1]]; })); }
/** Листья по площади: катятся порывом слева направо. */
const GROUND_LEAVES = [
  { t0: 4.6, t1: 8.8, y: 992, x0: 180, x1: 1240, size: 13, col: '#d88a3a' },
  { t0: 12.4, t1: 16.6, y: 948, x0: 300, x1: 1420, size: 11, col: '#c8622a' },
  { t0: 13.1, t1: 17.6, y: 1020, x0: 120, x1: 980, size: 14, col: '#e0a848' },
];

/* ============================== ветер ============================== */
// Частоты кратны 1/T — петля без шва. Фаза бежит слева направо (порыв проходит по кадру).
const WF = [10 / T, 15 / T, 33 / T];
const windMods = (prop, amp, x, seed = 0, ks = [0.55, 0.32, 0.13]) => WF.map((f, i) => ({ type: 'oscillate', prop, amp: +(amp * ks[i]).toFixed(3), freq: +f.toFixed(4), phase: Math.round(-x * 0.12 * (1 + i * 0.4) + seed * (37 + i * 71)) % 360 }));

/** Рамка пути d (только числа M/L/C/Q/Z в абсолютных координатах — так их пишет emit). */
function bboxD(d) {
  const nums = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) { const x = nums[i], y = nums[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x0 <= x1 ? [x0, y0, x1, y1] : null;
}
function nodeBox(n) {
  const p = n.props;
  if (n.type === 'path' && typeof p.d === 'string') return bboxD(p.d);
  if (n.type === 'ellipse') return [p.x - p.rx, p.y - p.ry, p.x + p.rx, p.y + p.ry];
  if (n.type === 'circle') return [p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r];
  if (n.type === 'line') return [Math.min(p.x1, p.x2), Math.min(p.y1, p.y2), Math.max(p.x1, p.x2), Math.max(p.y1, p.y2)];
  return null;
}

const FOLIAGE = new Set(['plant', 'planter_plants', 'zplanter_plants', 'hydrangea_leaves', 'hydrangea_heads', 'herbs', 'lavender']);
function applyWind(scene) {
  const kids = new Map();
  for (const n of scene.nodes) { if (!kids.has(n.parent)) kids.set(n.parent, []); kids.get(n.parent).push(n); }
  const leaves = (id, acc = []) => { for (const c of kids.get(id) || []) { if (c.type === 'group') leaves(c.id, acc); else acc.push(c); } return acc; };
  let count = 0;
  scene.nodes.filter((g) => g.parent === 'world' && g.type === 'group').forEach((g, gi) => {
    const name = g.props.name;
    if (name === 'bunting') {
      // флажки: качание вокруг верхнего края (шнурок — линии — неподвижен)
      for (const n of leaves(g.id)) {
        if (n.type !== 'path') continue;
        const b = nodeBox(n); if (!b) continue;
        const cx = (b[0] + b[2]) / 2, top = b[1], h = b[3] - b[1];
        if (h < 4) continue;
        Object.assign(n.props, { x: r1(cx), y: r1(top), anchorX: r1(cx), anchorY: r1(top) });
        n.mods = [...(n.mods || []), ...windMods('rotation', 9, cx, gi)];
        count++;
      }
    } else if (name === 'drape' || FOLIAGE.has(name)) {
      const ls = leaves(g.id).map((n) => ({ n, b: nodeBox(n) })).filter((o) => o.b);
      if (!ls.length) return;
      const top = Math.min(...ls.map((o) => o.b[1])), bot = Math.max(...ls.map((o) => o.b[3])), H = Math.max(8, bot - top);
      for (const { n, b } of ls) {
        const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        let amp;
        if (name === 'drape') {
          // плющ висит: размах растёт к низу плети (верх — ближайшая по x вершина)
          let lt = cy;
          for (const o of ls) if (Math.abs((o.b[0] + o.b[2]) / 2 - cx) < 26 && o.b[1] < lt) lt = o.b[1];
          amp = clamp((cy - lt) * 0.03, 0.2, 7);
        } else amp = 0.35 + 2.0 * clamp((bot - cy) / H);
        n.mods = [...(n.mods || []), ...windMods('x', amp, cx, gi), { type: 'oscillate', prop: 'y', amp: +(amp * 0.18).toFixed(3), freq: +(WF[1] * 2).toFixed(4), phase: Math.round(cx * 0.3) % 360 }];
        count++;
      }
    }
  });
  return count;
}

/* ============================== запекание ============================== */
const surfV = (Z, extra = {}) => ({ plane: [0, 0, -1, -Z], normal: [0, 0, -1], ...extra });
/** Ключи hold по кадрам; одинаковые подряд значения не повторяются. */
function bake(values) {
  const keys = [];
  let last;
  values.forEach((v, i) => { if (v !== last) { keys.push({ t: +(i / FPS).toFixed(4), v, hold: true }); last = v; } });
  return keys;
}

export function animate(scene) {
  const nodes = scene.nodes;
  const slotOf = (name) => nodes.find((n) => n.props?.name === `slot:${name}`);
  const out = [];
  const pushActor = (slot, id, surface, parts, frames, fills, extra = {}) => {
    const s = slotOf(slot); if (!s) throw new Error(`нет слота ${slot}`);
    out.push({ at: s.id, nodes: [{ id, type: 'group', parent: s.id, props: { name: id, surface }, ...extra }, ...parts.map((k) => {
      const ds = frames.map((f) => f[k] || NONE);
      return { id: `${id}_${k}`, type: 'path', parent: id, props: { d: ds[0], fill: fills[k], surface: { base: true } }, keys: { d: bake(ds) } };
    })] });
  };
  const times = Array.from({ length: NF }, (_, i) => i / FPS);

  // тени на ступени/площади (отдельно: плоскость земли, без метки персонажа)
  const shadowNode = (id, slot, plane, frames) => {
    const s = slotOf(slot);
    out.push({ at: s.id, nodes: [{ id, type: 'path', parent: s.id, props: { d: frames[0], fill: '#1a1018', opacity: 0.32, surface: { plane, normal: [0, 1, 0], base: true } }, keys: { d: bake(frames) } }] });
  };

  // голуби
  for (const P of PIGEONS) {
    const fr = times.map((t) => {
      const st = pigeonAt(P, t), [x, y] = proj(st.X, st.Y, st.Z), s = (F / st.Z) * P.s;
      return { st, x, y, s, shapes: pigeonShapes(st.q, (l) => [x + st.dir * s * l[0], y - s * l[1]], PIG_PAL[P.pal]) };
    });
    shadowNode(`${P.id}Shadow`, P.slot, [0, 1, 0, P.Y0], fr.map(({ st, s }) => {
      const h = st.Y - P.Y0; if (h > 1.2) return NONE;
      const [gx, gy] = proj(st.X, P.Y0, st.Z), k = 1 - h / 1.2;
      return smoothD(ellipse([gx, gy + 1], 0.13 * s * k + 1, 0.022 * s * k + 0.5, 0, 12));
    }));
    pushActor(P.slot, P.id, surfV(P.Z0, { normal: [0, 0.3, -0.954] }), PIG_PARTS, fr.map((f) => f.shapes), PIG_PAL[P.pal]);
  }

  // кот
  const catFrames = times.map((t) => {
    const st = catAt(t), y0 = st.y - st.p.lift * st.s;
    return { st, shapes: catShapes(st.p, (l) => [st.x + st.dir * st.s * l[0], y0 - st.s * l[1]], (TAU * t) / 2) };
  });
  shadowNode('catShadow', 'stairs', [0, 1, 0, stepTop(ZC)], catFrames.map(({ st }) => {
    const p = st.p, cx = (p.hip[0] + p.sh[0]) / 2, k = 1 / (1 + 3 * p.lift);
    return smoothD(ellipse([st.x + st.dir * st.s * cx, st.y + 1.5], 0.27 * st.s * k * Math.abs(st.dir) + 2, 0.03 * st.s * k + 1, 0, 14));
  }));
  pushActor('stairs', 'cat', surfV(ZC, { tag: 'chr' }), CAT_PARTS, catFrames.map((f) => f.shapes), CAT_FILL);
  // лист, с которым играет кот
  const leafS = slotOf('stairs');
  out.push({ at: leafS.id, nodes: [{ id: 'catLeaf', type: 'path', parent: leafS.id, props: { d: NONE, fill: '#e09a3a', surface: { plane: [0, 0, -1, -ZC + 0.05], normal: [0, 0.3, -0.954], base: true } },
    keys: { d: bake(times.map((t) => (t >= 0.5 && t <= 2.85 ? leafD(pathAt(LEAF1, t), 14, 2.2 * t + 0.6 * Math.sin(9 * t), 0.55 + 0.45 * Math.cos(7 * t)) : NONE))) } }] });

  // листья по площади
  const gl = slotOf('leaves');
  GROUND_LEAVES.forEach((L, i) => {
    const ds = times.map((t) => {
      const tt = ((t - L.t0) % T + T) % T, dur = L.t1 - L.t0;
      if (tt > dur) return NONE;
      const u = tt / dur, gust = sm(u * 2.5) * (1 - 0.4 * sm((u - 0.6) * 2.5));
      const x = lerp(L.x0, L.x1, u * 0.35 + 0.65 * sm(u)), hop = Math.abs(Math.sin(TAU * 2.2 * u + i)) * 22 * gust;
      return leafD([x, L.y - hop], L.size, TAU * 1.6 * u * (1 + i * 0.3) + i, 0.35 + 0.65 * Math.abs(Math.cos(TAU * 1.3 * u + i)));
    });
    out.push({ at: gl.id, nodes: [{ id: `windLeaf${i}`, type: 'path', parent: gl.id, props: { d: NONE, fill: L.col, stroke: '#7a3a1a', strokeWidth: 0.8, surface: { plane: [0, 1, 0, 0.02], normal: [0, 0.8, -0.6], base: true } }, keys: { d: bake(ds) } }] });
  });

  // дерево строится по parent: порядок среди детей слота = порядок добавления (голуби, затем кот и лист)
  for (const { nodes: add_ } of out) nodes.push(...add_);
  const wind = applyWind(scene);
  scene.duration = T;
  scene.fps = FPS;
  scene.clips = [{ name: 'loop', start: 0, end: T, loop: true, fps: FPS }];
  return { wind, frames: NF };
}
