// Kontur world3d: 3D-построители для 2.5D-сцен. Геометрия описывается в мире (1 ед. ≈ 1 м, Y вверх, Z вглубь),
// проецируется камерой camera3d и превращается в обычные узлы Kontur с props.surface (нормаль, плоскость, блик,
// свечение, контур) — их понимают проходы отложенного света (renderSVG mode normal/plane/planeD/emissive/ink).
// Перенос Tools/scene_sketch/lib2.mjs: те же примитивы, материалы и порядок случайных чисел (сцена совпадает).
// ES-модуль без зависимостей: работает в браузере и в Node.

export const C = {
  line: '#2e2a3c', plaster: '#efd9b0', plasterSh: '#d2b084', rose: '#e8b4a0', roseSh: '#c98c7c', mint: '#b9d4b0', mintSh: '#93b08c',
  sand: '#e9c98e', roof: '#c95a3c', roofSh: '#9c3f2d', roofHi: '#e47e5a', wood: '#9a6a3e', woodSh: '#74492a', woodDark: '#5a3a24',
  stone: '#c9b597', stoneSh: '#a28d72', stoneHi: '#e2d2b6', stoneDark: '#7d6b58', cobble: '#b39a7a', cobbleSh: '#8f7860', cobbleHi: '#d2bc98',
  brick: '#b8664a', brickSh: '#8e4a36', moss: '#7f9c4c', mossSh: '#5c7838', mossHi: '#a7c06a', ochre: '#e3a647', brass: '#e8b84a',
  glass: '#3e4f72', glassHi: '#9fc0e8', glow: '#ffd98a', cream: '#fff3d6', red: '#d9503f', redSh: '#a8382c', blue: '#4a76b8', blueSh: '#355890',
  teal: '#3f9a92', purple: '#8a5aa8', pink: '#e98aa6', water: '#6fb7c9', waterHi: '#c4ecf2', straw: '#e8c75e', strawSh: '#b8952f',
  iron: '#4a4650', skyTop: '#6f7fb8', skyMid: '#d99a9a', skyLow: '#f6c38f', far: '#b88a9a',
};
const hexRGB = (h) => {
  let s = String(h || '#000').trim().replace('#', '');
  if (s.length === 3) s = s.replace(/./g, '$&$&');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) || 0);
};
const RGBhex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const col = (c) => (c && C[c] ? C[c] : c);
export const mix = (a, b, t) => RGBhex(hexRGB(col(a)).map((v, i) => v + (hexRGB(col(b))[i] - v) * t));
export const dark = (a, t = 0.25) => mix(a, '#2a1a2a', t);
export const lite = (a, t = 0.25) => mix(a, '#fff8ea', t);
export const jit = (a, amt = 0.08) => { const r = rnd(); return r < 0.5 ? dark(a, (0.5 - r) * 2 * amt) : lite(a, (r - 0.5) * 2 * amt); };

/* детерминированная случайность (Парк — Миллер) */
let seed = 1;
export const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
export const reseed = (s) => { seed = Math.max(1, Math.round(s) % 2147483647); };
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const add = (a, b) => a.map((v, i) => v + b[i]);
export const mul = (a, k) => a.map((v) => v * k);
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => mul(a, 1 / (Math.hypot(...a) || 1));
const avg = (ps) => mul(ps.reduce(add, [0, 0, 0]), 1 / ps.length);

/* ============================== КАМЕРА ============================== */
export const CAMERA_DEFAULT = { hor: 280, f: 1500, camH: 4.2, dz: 2.5 };
/** Камера сцены: P([X,Y,Z]) = [cx + f·X/(Z+dz), hor + f·(camH − Y)/(Z+dz)]. */
export function camera(cam = {}, W = 1920) {
  const c = { ...CAMERA_DEFAULT, cx: W / 2, ...cam };
  const { hor, f, camH, dz, cx } = c;
  return {
    ...c,
    pos: [0, camH, -dz],
    P: ([X, Y, Z]) => [cx + (f * X) / (Z + dz), hor + (f * (camH - Y)) / (Z + dz)],
    /** Луч камеры через пиксель (x, y): точка = pos + t·dir. */
    ray: (x, y) => [(x - cx) / f, -(y - hor) / f, 1],
    charPx: (Z, h = 1.7) => (f * h) / (Z + dz),
    sw: (Z) => Math.max(1.2, Math.min(5, (f * 0.0096) / (Z + dz))),
    pxPerUnit: (Z) => f / (Z + dz),
  };
}
/** Подбор камеры: рост персонажа charPx у нижнего края кадра (экранная Y = bottom) и горизонт hor. */
export function fitCamera({ width = 1920, height = 1080, hor = Math.round(height * 0.26), charPx = Math.round(height * 0.3), bottom = height, charH = 1.7, f, dz = 2.5 } = {}) {
  const camH = (charH * (bottom - hor)) / charPx;
  f = f ?? Math.round(width * 0.6);
  return { hor, f, camH: +camH.toFixed(3), dz, cx: width / 2 };
}
/** Точка пересечения луча через пиксель с плоскостью [nx,ny,nz,d] или null. */
export function unproject(cam, x, y, plane) {
  const c = cam.P ? cam : camera(cam);
  const dir = c.ray(x, y), n = plane.slice(0, 3), den = dot(n, dir);
  if (Math.abs(den) < 1e-6) return null;
  const t = (plane[3] - dot(n, c.pos)) / den;
  return t > 0 ? add(c.pos, mul(dir, t)) : null;
}

/* ============================== СЦЕНА-ПОСТРОИТЕЛЬ ============================== */
/** Как Scene() из lib2: { W, H, hor, f, camH, dz, cx }. Элементы копятся в S.items, свет — в S.lights. */
export function Scene({ W = 1920, H = 1080, hor, f, camH, dz = 0, cx } = {}) {
  const cm = camera({ hor, f, camH, dz, cx: cx ?? W / 2 }, W);
  const S = { W, H, hor: cm.hor, f: cm.f, camH: cm.camH, dz: cm.dz, cx: cm.cx, items: [], lights: [], occ: [], tris: [], sky: [], skyGrad: [C.skyTop, C.skyMid, C.skyLow] };
  S.cam = cm.pos;
  S.camera = cm;
  S.P = cm.P;
  S.charPx = (Z) => cm.charPx(Z);
  S.sw = cm.sw;
  S.pxPerUnit = cm.pxPerUnit;
  /** Элемент сцены: key — ключ сортировки художника (больше — дальше, рисуется раньше). */
  S.item = (key, prims, o = {}) => {
    if (!prims.length && !o.force) return null;
    const it = { key, prims, name: o.name, occ: [], tris: [] };
    S.items.push(it);
    return it;
  };
  S.light = (p, color, r, i = 1, kind = 'lamp', o = {}) => S.lights.push({ p, col: color, r, i, kind, ...o });
  /** Окклюдер-коробка [x0,x1,y0,y1,z0,z1] для теней; owner — элемент (по умолчанию последний). */
  S.box3 = (b, owner = S.items[S.items.length - 1]) => { S.occ.push(b); if (owner) owner.occ.push(b); };
  S.tri3 = (t, owner = S.items[S.items.length - 1]) => { S.tris.push(t); if (owner) owner.tris.push(t); };
  /** Облако или другая фигура неба (в экранных координатах): эллипс, остаётся небом при перестройке неба. */
  S.cloud = (x, y, rx, ry, fill = '#fff0e0', op = 0.55) => S.sky.push({ x, y, rx, ry, fill, op });
  S.faces = (n, p) => dot(n, sub(S.cam, p)) > 1e-6;
  S.frame = (o, u, v, w, h, n) => {
    const fr = { o, u, v, w, h, n, pl: [...n, dot(n, o)] };
    fr.at = (a, b) => add(add(o, mul(u, a)), mul(v, b));
    fr.rect = (a, b, ww, hh) => [fr.at(a, b), fr.at(a + ww, b), fr.at(a + ww, b + hh), fr.at(a, b + hh)];
    fr.tilt = (du, dv, k = 0.75) => norm(add(n, add(mul(u, du * k), mul(v, dv * k))));
    fr.z = Math.min(...[fr.at(0, 0), fr.at(w, 0), fr.at(0, h), fr.at(w, h)].map((p) => p[2]));
    return fr;
  };
  S.base = (ps, alb, n, pl, o = {}) => ({ t: 'poly', ps, alb, n, pl, base: true, ink: o.ink ?? true, spec: o.spec ?? 0.1, em: o.em, op: 1, sw: o.sw });
  S.det = (fr, ps, alb, o = {}) => ({ t: 'poly', ps, alb, n: o.n || fr.n, pl: fr.pl, bump: !!o.n || o.bump, base: !!o.solid, ink: o.ink || false, spec: o.spec ?? 0.1, em: o.em, op: o.op ?? 1, sw: o.sw });
  S.line = (a, b, c, w, o = {}) => ({ t: 'line', a, b, col: c, w, ink: o.ink || false, op: o.op ?? 1 });
  return S;
}

/* ============================== МАТЕРИАЛЫ ============================== */
const clipR = (fr, a, b, w, h) => { const a0 = Math.max(0, a), b0 = Math.max(0, b), a1 = Math.min(fr.w, a + w), b1 = Math.min(fr.h, b + h); return a1 - a0 > 0.01 && b1 - b0 > 0.01 ? [a0, b0, a1 - a0, b1 - b0] : null; };
/** Выпуклый блок с фаской: основа + 4 скошенные полосы. */
export function bevel(S, fr, a, b, w, h, c, bv = 0.04, k = 0.8, o = {}) {
  const r = clipR(fr, a, b, w, h);
  if (!r) return [];
  [a, b, w, h] = r;
  const bvv = Math.min(bv, w / 3, h / 3);
  const out = [S.det(fr, fr.rect(a, b, w, h), c, { bump: true, spec: o.spec })];
  out.push(S.det(fr, fr.rect(a, b + h - bvv, w, bvv), lite(c, 0.12), { n: fr.tilt(0, 1, k), spec: o.spec }));
  out.push(S.det(fr, fr.rect(a, b, w, bvv), dark(c, 0.18), { n: fr.tilt(0, -1, k), spec: o.spec }));
  out.push(S.det(fr, fr.rect(a, b, bvv, h), c, { n: fr.tilt(-1, 0, k), spec: o.spec }));
  out.push(S.det(fr, fr.rect(a + w - bvv, b, bvv, h), dark(c, 0.08), { n: fr.tilt(1, 0, k), spec: o.spec }));
  return out;
}
export function blob(fr, cxu, cyv, r, n = 9, sq = 1) {
  const ps = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, rr = r * (0.7 + rnd() * 0.5); ps.push([cxu + Math.cos(a) * rr, cyv + Math.sin(a) * rr * sq]); }
  return ps.map(([a, b]) => fr.at(Math.max(0, Math.min(fr.w, a)), Math.max(0, Math.min(fr.h, b))));
}
export const MAT = {
  brick(S, fr, c = C.brick, o = {}) {
    const out = [S.det(fr, fr.rect(0, 0, fr.w, fr.h), dark(c, 0.35))];
    const bw = o.bw || 0.42, bh = o.bh || 0.16, gap = 0.035;
    for (let row = 0, b = o.b0 || 0; b < fr.h; b += bh + gap, row++) {
      for (let a = -((row % 2) * bw) / 2; a < fr.w; a += bw + gap) out.push(...bevel(S, fr, a, b, bw, bh, jit(c, 0.12), 0.03, 0.85));
    }
    return out;
  },
  stone(S, fr, c = C.stone, o = {}) {
    const out = [S.det(fr, fr.rect(0, 0, fr.w, fr.h), dark(c, 0.3))];
    const bh = o.bh || 0.5, gap = 0.05;
    for (let row = 0, b = 0; b < fr.h; b += bh + gap, row++) {
      for (let a = -rnd() * 0.6; a < fr.w; ) { const w = 0.6 + rnd() * 0.7; out.push(...bevel(S, fr, a, b, w, bh, jit(c, 0.1), 0.07, 0.8)); a += w + gap; }
    }
    if (o.moss !== false) for (let a = rnd(); a < fr.w; a += 0.8 + rnd() * 1.5) out.push(S.det(fr, blob(fr, a, 0.05, 0.35 + rnd() * 0.4, 8, 0.6), rnd() < 0.5 ? C.mossSh : C.moss, { op: 0.75, n: fr.tilt((rnd() - 0.5) * 0.6, 0.4, 0.5) }));
    return out;
  },
  plaster(S, fr, c = C.plaster, o = {}) {
    const out = [];
    for (let i = 0; i < Math.round((fr.w * fr.h) / 5); i++) out.push(S.det(fr, blob(fr, rnd() * fr.w, rnd() * fr.h, 0.4 + rnd() * 1.0, 10, 0.6 + rnd() * 0.6), rnd() < 0.6 ? dark(c, 0.12) : lite(c, 0.12), { op: 0.35 }));
    out.push(S.det(fr, fr.rect(0, 0, fr.w, 0.55), dark(c, 0.25), { op: 0.45 }));
    out.push(S.det(fr, fr.rect(0, 0, fr.w, 0.25), dark(c, 0.35), { op: 0.45 }));
    const patches = o.patches ?? Math.max(1, Math.round(fr.w / 4));
    for (let i = 0; i < patches; i++) {
      const pa = 0.3 + rnd() * (fr.w - 2), pb = 0.4 + rnd() * (fr.h - 1.6), pw = 0.7 + rnd() * 0.7, ph = 0.45 + rnd() * 0.35;
      const ring = [];
      for (let k = 0; k < 10; k++) { const t = (k / 10) * Math.PI * 2; ring.push([pa + pw / 2 + Math.cos(t) * pw * (0.3 + rnd() * 0.25), pb + ph / 2 + Math.sin(t) * ph * (0.3 + rnd() * 0.25)]); }
      out.push(S.det(fr, ring.map(([a, b]) => fr.at(a, b)), dark(C.brick, 0.4), { n: fr.n }));
      for (let row = 0, b = pb + 0.05; b < pb + ph - 0.12; b += 0.19, row++)
        for (let a = pa + 0.05 + (row % 2) * 0.2; a < pa + pw - 0.3; a += 0.44) {
          const cu = a + 0.2 - (pa + pw / 2), cv = b + 0.08 - (pb + ph / 2);
          if ((cu / (pw * 0.42)) ** 2 + (cv / (ph * 0.42)) ** 2 < 0.8) out.push(...bevel(S, fr, a, b, 0.4, 0.15, jit(C.brick, 0.12), 0.03, 0.85));
        }
    }
    for (let i = 0; i < Math.round(fr.w / 3); i++) {
      let a = rnd() * fr.w, b = rnd() * fr.h;
      for (let k = 0; k < 4; k++) { const a2 = a + (rnd() - 0.5) * 0.6, b2 = b - 0.2 - rnd() * 0.35; out.push(S.line(fr.at(a, b), fr.at(a2, b2), dark(c, 0.45), S.sw(fr.z) * 0.7)); a = a2; b = b2; }
    }
    return out;
  },
  wood(S, fr, c = C.wood, o = {}) {
    const out = [];
    const pw = o.pw || 0.32, vert = o.vert;
    const L = vert ? fr.w : fr.h;
    for (let s = 0; s < L; s += pw) {
      const cc = jit(c, 0.1);
      const r = vert ? [s, 0, pw - 0.03, fr.h] : [0, s, fr.w, pw - 0.03];
      out.push(...bevel(S, fr, ...r, cc, 0.035, 0.7));
      for (let g = 0; g < 2; g++) {
        const t = s + 0.08 + rnd() * (pw - 0.16);
        if (vert) out.push(S.line(fr.at(t, rnd() * 0.3), fr.at(t + (rnd() - 0.5) * 0.05, fr.h - rnd() * 0.3), dark(cc, 0.25), S.sw(fr.z) * 0.45));
        else out.push(S.line(fr.at(rnd() * 0.3, t), fr.at(fr.w - rnd() * 0.3, t + (rnd() - 0.5) * 0.05), dark(cc, 0.25), S.sw(fr.z) * 0.45));
      }
      if (rnd() < 0.5) { const a = rnd() * fr.w; out.push(S.det(fr, vert ? blob(fr, s + pw / 2, rnd() * fr.h, 0.05, 6) : blob(fr, a, s + pw / 2, 0.05, 6), dark(cc, 0.4))); }
    }
    return out;
  },
  tile(S, fr, c = C.roof, o = {}) {
    const out = [S.det(fr, fr.rect(0, 0, fr.w, fr.h), dark(c, 0.3))];
    const rh = o.rh || 0.32, tw = o.tw || 0.36;
    for (let row = 0, b = fr.h - rh; b > -rh; b -= rh, row++) {
      for (let a = -((row % 2) * tw) / 2; a < fr.w; a += tw) {
        const cc = rnd() < 0.06 ? mix(c, C.mossSh, 0.5) : jit(c, 0.12);
        const r = clipR(fr, a + 0.01, b, tw - 0.02, rh);
        if (!r) continue;
        out.push(S.det(fr, fr.rect(...r), cc, { n: fr.tilt(0, 0.25, 1), spec: 0.2 }));
        const rr = clipR(fr, a + 0.01, b, tw - 0.02, rh * 0.28);
        if (rr) out.push(S.det(fr, fr.rect(...rr), dark(cc, 0.15), { n: fr.tilt(0, -1, 0.9), spec: 0.2 }));
        const rl = clipR(fr, a + 0.01, b, tw * 0.22, rh);
        if (rl) out.push(S.det(fr, fr.rect(...rl), lite(cc, 0.08), { n: fr.tilt(-1, 0, 0.5) }));
      }
    }
    for (let i = 0; i < Math.round(fr.w / 3); i++) out.push(S.det(fr, blob(fr, rnd() * fr.w, rnd() * fr.h * 0.5, 0.3 + rnd() * 0.3, 8, 0.6), C.mossSh, { op: 0.6, n: fr.tilt(0, 0.5, 0.5) }));
    return out;
  },
  cobble(S, fr, c = C.cobble, o = {}) {
    const out = [S.det(fr, fr.rect(0, 0, fr.w, fr.h), dark(c, 0.42))];
    const maxZ = o.maxZ ?? 30;
    for (let row = 0, b = 0; b < fr.h; row++) {
      const z = fr.at(0, b)[2];
      const rh = 0.26 + Math.max(0, z - 12) * 0.02;
      if (z > maxZ) break;
      for (let a = -rnd() * 0.3; a < fr.w; ) {
        const w = 0.28 + rnd() * 0.16;
        const cc = jit(c, 0.14);
        const r = clipR(fr, a + 0.025, b + 0.025, w - 0.05, rh - 0.05);
        if (r) {
          const [ra, rb, rw, rhh] = r, k = 0.85;
          out.push(S.det(fr, fr.rect(ra, rb, rw, rhh), cc, { n: fr.tilt((rnd() - 0.5) * 0.15, (rnd() - 0.5) * 0.15, 1), spec: 0.25 }));
          out.push(S.det(fr, fr.rect(ra, rb, rw, rhh * 0.3), dark(cc, 0.1), { n: fr.tilt(0, -1, k), spec: 0.25 }));
          out.push(S.det(fr, fr.rect(ra + rw * 0.72, rb, rw * 0.28, rhh), dark(cc, 0.05), { n: fr.tilt(1, 0, k), spec: 0.25 }));
          out.push(S.det(fr, fr.rect(ra, rb, rw * 0.25, rhh), lite(cc, 0.06), { n: fr.tilt(-1, 0, k), spec: 0.25 }));
          out.push(S.det(fr, fr.rect(ra, rb + rhh * 0.72, rw, rhh * 0.28), lite(cc, 0.1), { n: fr.tilt(0, 1, k), spec: 0.25 }));
        }
        a += w;
      }
      b += rh;
    }
    return out;
  },
};
export const MATERIALS = Object.keys(MAT);

/* ============================== ПОСТРОИТЕЛИ ============================== */
/** Грань многоугольником ps (3D) с материалом. Возвращает примитивы. */
export function face(S, ps, alb, o = {}) {
  let n = norm(cross(sub(ps[1], ps[0]), sub(ps[2], ps[0])));
  const fc = avg(ps);
  if (o.center && dot(n, sub(fc, o.center)) < 0) n = mul(n, -1);
  if (!o.center && dot(n, sub(S.cam, fc)) < 0) n = mul(n, -1);
  if (!S.faces(n, fc)) return [];
  const out = [S.base(ps, alb, n, [...n, dot(n, ps[0])], o)];
  const det = [];
  if (o.frame && o.mat) det.push(...MAT[o.mat](S, o.frame(n), o.matCol || alb, o.matOpt || {}));
  if (o.decor) det.push(...o.decor(n));
  if (o.clip || ps.length !== 4) for (const d of det) d.clip = ps;
  return out.concat(det);
}
/** Рамка грани по её многоугольнику: u — горизонталь грани, v — «вверх» (для пола — вглубь). */
export function frameOf(S, ps, n) {
  n = n || norm(cross(sub(ps[1], ps[0]), sub(ps[2], ps[0])));
  let u = cross(n, [0, 1, 0]);
  let v;
  if (Math.hypot(...u) < 1e-4) { u = [1, 0, 0]; v = n[1] > 0 ? [0, 0, 1] : [0, 0, -1]; } else { u = norm(u); v = norm(cross(u, n)); }
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
  ];
  const prims = [];
  for (const fc of F) {
    const mm = m[fc.tag] || (fc.tag === 'top' ? m.top : ['left', 'right', 'back'].includes(fc.tag) ? m.side : null) || m.all;
    const cc = fc.tag === 'top' ? (o.top || c) : ['left', 'right'].includes(fc.tag) ? (o.sides || c) : c;
    prims.push(...face(S, fc.ps, cc, { center: cen, mat: mm?.[0], matCol: mm?.[1], matOpt: mm?.[2], frame: fc.fr, spec: o.spec, em: o.em, decor: o.decor?.[fc.tag] ? (n) => o.decor[fc.tag](fc.fr(n)) : null }));
  }
  const it = S.item(o.key ?? z0, prims, { name: o.name || 'box' });
  if (o.occ !== false) S.box3([x0, x1, y0, y1, z0, z1], it);
  return prims;
}
/** Цилиндр гранями (настоящая проекция). */
export function cyl(S, X, Z, r, y0, y1, c, o = {}) {
  const n = o.n || 24, prims = [];
  const facets = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const nn = [Math.cos(am), 0, Math.sin(am)];
    const ps = [[X + Math.cos(a0) * r, y0, Z + Math.sin(a0) * r], [X + Math.cos(a1) * r, y0, Z + Math.sin(a1) * r], [X + Math.cos(a1) * r, y1, Z + Math.sin(a1) * r], [X + Math.cos(a0) * r, y1, Z + Math.sin(a0) * r]];
    if (!S.faces(nn, avg(ps))) continue;
    facets.push({ ps, nn });
  }
  facets.sort((p, q) => avg(q.ps)[2] - avg(p.ps)[2]);
  for (const { ps, nn } of facets) {
    prims.push(S.base(ps, c, nn, [...nn, dot(nn, ps[0])], { ink: false, spec: o.spec }));
    if (o.bands) for (let y = y0 + o.bands; y < y1 - 0.02; y += o.bands) prims.push(S.line(add(ps[0], [0, y - y0, 0]), add(ps[1], [0, y - y0, 0]), dark(c, 0.3), S.sw(Z) * 0.6));
  }
  if (facets.length) {
    const ring = (y) => Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * Math.PI * 2; return [X + Math.cos(a) * r, y, Z + Math.sin(a) * r]; });
    const vis = (p) => p[2] <= Z + 1e-6;
    const bot = ring(y0).filter(vis);
    for (let i = 0; i + 1 < bot.length; i++) prims.push(S.line(bot[i], bot[i + 1], C.line, S.sw(Z), { ink: true }));
  }
  if (y1 < S.camH) {
    const top = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [X + Math.cos(a) * r, y1, Z + Math.sin(a) * r]; });
    prims.push(S.base(top, o.top || lite(c, 0.15), [0, 1, 0], [0, 1, 0, y1], { spec: o.topSpec ?? o.spec }));
  } else {
    const top = Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * Math.PI * 2; return [X + Math.cos(a) * r, y1, Z + Math.sin(a) * r]; }).filter((p) => p[2] <= Z);
    for (let i = 0; i + 1 < top.length; i++) prims.push(S.line(top[i], top[i + 1], C.line, S.sw(Z), { ink: true }));
  }
  const it = S.item(o.key ?? Z - r, prims, { name: o.name || 'cyl' });
  if (o.occ !== false) S.box3([X - r * 0.8, X + r * 0.8, y0, y1, Z - r * 0.8, Z + r * 0.8], it);
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
    box(S, x0, x1, o.y0 ?? 0, y, za, zb, o.jitter === false ? c : jit(c, 0.05), { key: za, name: 'step', mats: { front: [o.mat || 'stone', c, { bh: 0.2 }], top: null } });
  }
}
/** Дом: коробка (материал фасада) + крыша черепицей + окна/двери. */
export function house(S, x0, x1, z0, z1, h, o = {}) {
  const y0 = o.y0 ?? 0, y1 = y0 + h, c = o.col || C.plaster, roofCol = o.roof || C.roof, rh = o.roofH ?? 1.6, ov = 0.3;
  const floors = Math.max(1, Math.floor((h - 0.3) / 2.6));
  const key = o.key ?? z0;
  const facs = o.facades || ['front', 'left', 'right'];
  const mat = o.mat || 'plaster';
  const decorFor = (tag) => (fr) => {
    const out = [];
    if (!facs.includes(tag)) return out;
    const len = fr.w;
    const cols = Math.max(1, Math.floor((len - 0.8) / 1.7));
    const step = len / cols;
    for (let fl = 0; fl < floors; fl++) for (let cc = 0; cc < cols; cc++) {
      const a = (cc + 0.5) * step;
      if (fl === 0 && o.doorAt !== undefined && Math.abs(a - o.doorAt) < step * 0.6) continue;
      if (o.skip && o.skip(a, fl)) continue;
      if (rnd() < 0.1) continue;
      out.push(...windowPrims(S, fr, a - 0.42, 0.95 + fl * 2.6, 0.84, 1.2, { lit: rnd() < (o.litP ?? 0.25), shut: rnd() < 0.55 ? (o.shut || C.teal) : null, box: rnd() < 0.35 }));
    }
    if (o.doorAt !== undefined && tag === facs[0]) out.push(...doorPrims(S, fr, o.doorAt - 0.55, 1.1, 2.1, o.doorCol || C.wood));
    if (o.pipe && tag === facs[0]) out.push(...pipePrims(S, fr, o.pipe === 'end' ? len - 0.25 : 0.25, 0, h + 0.1));
    return out;
  };
  const m = mat === 'stone' ? ['stone', c] : mat === 'brick' ? ['brick', c] : ['plaster', c];
  const decor = { front: decorFor('front'), left: decorFor('left'), right: decorFor('right') };
  if (o.plinth) box(S, x0 - 0.06, x1 + 0.06, y0, y0 + o.plinth, z0 - 0.06, z1 + 0.06, C.stone, { key: key + 0.003, name: 'plinth', mats: { all: ['stone', C.stone, { bh: 0.38 }] }, occ: false });
  box(S, x0, x1, y0, y1, z0, z1, c, { key: key + 0.002, name: 'house', mats: { all: m, top: null }, decor, sides: o.sides });
  const prims = [], tris = [];
  const roofFace = (ps, fr) => face(S, ps, roofCol, { center: [(x0 + x1) / 2, y1 - 1, (z0 + z1) / 2], mat: 'tile', matCol: roofCol, frame: fr, spec: 0.2 });
  if (o.ridge === 'z') {
    const xm = (x0 + x1) / 2, yr = y1 + rh, L = z1 - z0 + 2 * ov, sl = Math.hypot(xm - x0 + ov, rh);
    prims.push(...face(S, [[x0, y1, z0], [x1, y1, z0], [xm, yr, z0]], c, { center: [xm, y1, (z0 + z1) / 2] }));
    prims.push(...roofFace([[x0 - ov, y1 - 0.12, z0 - ov], [xm, yr, z0 - ov], [xm, yr, z1 + ov], [x0 - ov, y1 - 0.12, z1 + ov]], (n) => S.frame([x0 - ov, y1 - 0.12, z1 + ov], [0, 0, -1], norm([xm - x0 + ov, rh + 0.12, 0]), L, sl, n)));
    prims.push(...roofFace([[x1 + ov, y1 - 0.12, z0 - ov], [xm, yr, z0 - ov], [xm, yr, z1 + ov], [x1 + ov, y1 - 0.12, z1 + ov]], (n) => S.frame([x1 + ov, y1 - 0.12, z0 - ov], [0, 0, 1], norm([xm - x1 - ov, rh + 0.12, 0]), L, sl, n)));
    tris.push([[x0 - ov, y1, z0 - ov], [xm, yr, z0 - ov], [xm, yr, z1 + ov]], [[x0 - ov, y1, z0 - ov], [xm, yr, z1 + ov], [x0 - ov, y1, z1 + ov]], [[x1 + ov, y1, z0 - ov], [xm, yr, z0 - ov], [xm, yr, z1 + ov]], [[x1 + ov, y1, z0 - ov], [xm, yr, z1 + ov], [x1 + ov, y1, z1 + ov]]);
  } else if (o.roofType !== 'flat') {
    const zm = (z0 + z1) / 2, yr = y1 + rh, L = x1 - x0 + 2 * ov, sl = Math.hypot(zm - z0 + ov, rh);
    prims.push(...face(S, [[x0, y1, z0], [x0, y1, z1], [x0, yr, zm]], c, { center: [(x0 + x1) / 2, y1, zm] }));
    prims.push(...face(S, [[x1, y1, z0], [x1, y1, z1], [x1, yr, zm]], c, { center: [(x0 + x1) / 2, y1, zm] }));
    prims.push(...roofFace([[x0 - ov, y1 - 0.12, z0 - ov], [x1 + ov, y1 - 0.12, z0 - ov], [x1 + ov, yr, zm], [x0 - ov, yr, zm]], (n) => S.frame([x0 - ov, y1 - 0.12, z0 - ov], [1, 0, 0], norm([0, rh + 0.12, zm - z0 + ov]), L, sl, n)));
    tris.push([[x0 - ov, y1, z0 - ov], [x1 + ov, y1, z0 - ov], [x1 + ov, yr, zm]], [[x0 - ov, y1, z0 - ov], [x1 + ov, yr, zm], [x0 - ov, yr, zm]], [[x0 - ov, y1, z1 + ov], [x1 + ov, y1, z1 + ov], [x1 + ov, yr, zm]], [[x0 - ov, y1, z1 + ov], [x1 + ov, yr, zm], [x0 - ov, yr, zm]]);
  }
  const it = S.item(key + 0.001, prims, { name: 'roof', force: tris.length > 0 });
  for (const t of tris) S.tri3(t, it);
  if (o.chimney) {
    const cxp = x0 + (x1 - x0) * o.chimney, cz = (z0 + z1) / 2;
    box(S, cxp - 0.3, cxp + 0.3, y1, y1 + rh + 1.0, cz - 0.3, cz + 0.3, C.brick, { key, name: 'chimney', mats: { all: ['brick', C.brick] } });
    box(S, cxp - 0.38, cxp + 0.38, y1 + rh + 1.0, y1 + rh + 1.2, cz - 0.38, cz + 0.38, C.stoneSh, { key: key - 0.001, name: 'chimney' });
  }
}
/** Окно: наличник, откос, стекло (блик/свечение и свет), переплёт, подоконник, ставни, ящик с цветами. */
export function windowPrims(S, fr, a, b, w, h, o = {}) {
  const out = [];
  const sw = S.sw(fr.z) * 0.8;
  out.push(...bevel(S, fr, a - 0.1, b - 0.1, w + 0.2, h + 0.2, C.cream, 0.05, 0.9));
  out.push(S.det(fr, fr.rect(a, b, w, h), dark(C.glass, 0.4), { ink: true, sw }));
  const glassCol = o.lit ? C.glow : C.glass;
  if (o.lit) S.light(add(fr.at(a + w / 2, b + h / 2), mul(fr.n, 0.7)), '#ffb860', 3.2, 0.7, 'window');
  out.push(S.det(fr, fr.rect(a + 0.05, b, w - 0.05, h - 0.06), glassCol, { spec: 0.9, em: o.lit ? '#ffc870' : null }));
  if (!o.lit) out.push(S.det(fr, fr.rect(a + w * 0.15, b + h * 0.55, w * 0.22, h * 0.32), C.glassHi, { op: 0.5, spec: 0.9 }));
  out.push(S.det(fr, fr.rect(a + w / 2 - 0.03, b, 0.06, h), C.cream, { bump: true }));
  out.push(S.det(fr, fr.rect(a, b + h * 0.55, w, 0.05), C.cream, { bump: true }));
  out.push(S.det(fr, fr.rect(a - 0.16, b - 0.16, w + 0.32, 0.08), C.stoneHi, { n: fr.tilt(0, 1, 1.2), ink: true, sw }));
  out.push(S.det(fr, fr.rect(a - 0.16, b - 0.22, w + 0.32, 0.06), C.stoneSh, { n: fr.tilt(0, -1, 0.8) }));
  if (o.shut) for (const sa of [a - w * 0.46 - 0.12, a + w + 0.12]) {
    out.push(S.det(fr, fr.rect(sa, b - 0.05, w * 0.46, h + 0.1), o.shut, { ink: true, sw, bump: true }));
    for (let k = 1; k < 6; k++) out.push(S.det(fr, fr.rect(sa + 0.03, b + ((h + 0.1) * k) / 6 - 0.02, w * 0.46 - 0.06, 0.04), dark(o.shut, 0.3), { n: fr.tilt(0, -1, 0.8) }));
  }
  if (o.box) {
    out.push(...bevel(S, fr, a - 0.08, b - 0.5, w + 0.16, 0.3, C.woodSh, 0.04, 0.8));
    for (let k = 0; k < 7; k++) {
      const fa = a + rnd() * w, fb = b - 0.22 + rnd() * 0.3, cc = [C.red, C.pink, C.ochre, C.cream][Math.floor(rnd() * 4)];
      out.push(S.det(fr, blob(fr, fa, fb, 0.12, 6), C.mossSh, { n: fr.tilt(rnd() - 0.5, 0.5, 0.8) }));
      out.push(S.det(fr, blob(fr, fa + 0.04, fb + 0.06, 0.07, 6), cc, { n: fr.tilt(rnd() - 0.5, rnd() - 0.2, 0.8), spec: 0.3 }));
    }
  }
  return out;
}
export function doorPrims(S, fr, a, w, h, c) {
  const out = [];
  const arch = (ext) => { const ps = []; for (let i = 0; i <= 10; i++) { const t = Math.PI * (i / 10); ps.push(fr.at(a + w / 2 - Math.cos(t) * (w / 2 + ext), h - w / 2 + Math.sin(t) * (w / 2 + ext))); } return ps; };
  out.push(S.det(fr, [fr.at(a + w + 0.18, 0), fr.at(a - 0.18, 0), ...arch(0.18)], C.stoneHi, { bump: true, ink: true, sw: S.sw(fr.z) }));
  out.push(S.det(fr, [fr.at(a + w, 0), fr.at(a, 0), ...arch(0)], c, { ink: true, sw: S.sw(fr.z), spec: 0.2 }));
  for (let k = 1; k < 4; k++) out.push(S.det(fr, fr.rect(a + (w * k) / 4 - 0.02, 0.05, 0.04, h - w / 2), dark(c, 0.35), { n: fr.tilt(1, 0, 0.6) }));
  out.push(S.det(fr, blob(fr, a + w * 0.8, 1.0, 0.05, 6), C.brass, { spec: 1, n: fr.tilt(-0.5, 0.5, 0.8) }));
  return out;
}
export function pipePrims(S, fr, a, b0, b1) {
  const out = [];
  out.push(S.det(fr, fr.rect(a - 0.07, b0, 0.07, b1 - b0), C.iron, { n: fr.tilt(-1, 0, 1.3), spec: 0.6, ink: true, sw: S.sw(fr.z) * 0.6 }));
  out.push(S.det(fr, fr.rect(a, b0, 0.07, b1 - b0), dark(C.iron, 0.2), { n: fr.tilt(1, 0, 1.3), spec: 0.6, ink: true, sw: S.sw(fr.z) * 0.6 }));
  for (let b = b0 + 1; b < b1; b += 1.6) out.push(S.det(fr, fr.rect(a - 0.1, b, 0.2, 0.08), dark(C.iron, 0.3), { n: fr.tilt(0, 1, 0.6) }));
  return out;
}
/** Плющ: облако листьев с разными нормалями. */
export function ivy(S, fr, a, b, w, h, dens = 60) {
  const out = [];
  for (let i = 0; i < dens; i++) {
    const t = rnd(), pa = a + rnd() * w * (0.6 + 0.4 * (1 - t)), pb = b + h - t * h;
    const r = 0.09 + rnd() * 0.07;
    out.push(S.det(fr, [fr.at(pa, pb + r), fr.at(pa + r * 0.8, pb), fr.at(pa, pb - r), fr.at(pa - r * 0.8, pb)], [C.moss, C.mossSh, C.mossHi][Math.floor(rnd() * 3)], { n: fr.tilt((rnd() - 0.5) * 1.4, (rnd() - 0.3) * 1.2, 1), spec: 0.35 }));
  }
  return out;
}
/** Персонаж-картинка: img = { uri, w, h, k } (k — множитель роста). */
export function char(S, img, X, Y, Z, o = {}) {
  const [x, y] = S.P([X, Y, Z]);
  const h = S.charPx(Z) * (img.k ?? 1), w = (h * img.w) / img.h;
  const it = S.item(o.key ?? Z, [{ t: 'img', uri: img.uri, x: x - w / 2, y: y - h, w, h, flip: !!o.flip, Z: Z - 0.18, tag: o.tag ?? 'chr', name: o.name }], { name: o.name || 'char' });
  S.box3([X - 0.22, X + 0.22, Y, Y + 1.6 * (img.k ?? 1), Z - 0.12, Z + 0.12], it);
  if (o.shadow !== false) S.item(Z + 0.3, [disc(S, X + 0.1, Y + 0.002, Z + 0.05, 0.42, 0.22, '#3a2030', { op: 0.35, n3: [0, 1, 0] })], { name: 'blob_shadow' });
}

/* ============================== В УЗЛЫ KONTUR ============================== */
const r1 = (v) => Math.round(v * 10) / 10;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const same3 = (a, b) => a && b && Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4 && Math.abs(a[2] - b[2]) < 1e-4;
const plEq = (a, b) => a && b && same3(a, b) && Math.abs(a[3] - b[3]) < 1e-4;

/**
 * Превратить построенную сцену в узлы Kontur.
 * opts: idPrefix ('w'), parent (id родителя для корневой группы), group (id корневой группы, 'world'), lights (true).
 * Возвращает { nodes, camera3d, background, root } — nodes уже в порядке художника (дальние раньше).
 */
export function toNodes(S, opts = {}) {
  const pre = opts.idPrefix ?? 'w';
  const rootId = opts.group ?? 'world';
  const nodes = [{ id: rootId, type: 'group', parent: opts.parent ?? null, props: {} }];
  if (opts.world3d) nodes[0].props.world3d = opts.world3d;
  const push = (n) => { nodes.push(n); return n; };
  const P2 = (ps) => ps.map((p) => S.P(p));
  const pathD = (q) => 'M' + q.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L') + 'Z';
  const offscreen = (q) => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const [x, y] of q) { if (x < a) a = x; if (x > b) b = x; if (y < c) c = y; if (y > d) d = y; } return b - a < 0.3 || d - c < 0.3 || b < -50 || a > S.W + 50 || d < -50 || c > S.H + 50; };
  // небо: облака и прочие фигуры неба
  if (S.sky.length) {
    const sid = `${pre}sky`;
    push({ id: sid, type: 'group', parent: rootId, props: { surface: { sky: true } } });
    S.sky.forEach((c, i) => push({ id: `${sid}_${i}`, type: 'ellipse', parent: sid, props: { x: r1(c.x), y: r1(c.y), rx: r1(c.rx), ry: r1(c.ry), fill: c.fill, ...(c.op < 1 ? { opacity: c.op } : {}) } }));
  }
  const items = S.items.map((it, i) => ({ it, i })).sort((a, b) => b.it.key - a.it.key || a.i - b.i);
  const prim2node = (p, id, parent, gpl) => {
    if (p.t === 'img') {
      return { id, type: 'image', parent, props: { x: r1(p.x + p.w / 2), y: r1(p.y + p.h / 2), width: r1(p.w), height: r1(p.h), src: p.uri, ...(p.flip ? { scaleX: -1 } : {}),
        surface: { normal: [0, 0, -1], plane: [0, 0, -1, r4(-p.Z)], spec: 0.15, base: true, ...(p.tag ? { tag: p.tag } : {}) } } };
    }
    if (p.t === 'line') {
      const [x1, y1] = S.P(p.a), [x2, y2] = S.P(p.b);
      if (Math.hypot(x2 - x1, y2 - y1) < 0.3) return null;
      const props = { x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2), stroke: p.col, strokeWidth: +p.w.toFixed(2), lineCap: 'round' };
      if (p.op < 1) props.opacity = p.op;
      if (p.ink) props.surface = { ink: true, sw: +p.w.toFixed(2) };
      return { id, type: 'line', parent, props };
    }
    const q = P2(p.ps);
    if (offscreen(q)) return null;
    const s = {};
    if (!plEq(p.pl, gpl)) s.plane = p.pl.map(r4);
    const nRef = s.plane ? p.pl : gpl;
    if (p.n && !same3(p.n, nRef)) { s.normal = p.n.map(r4); if (!p.bump) s.bump = false; }
    else if (p.bump) s.bump = true;
    if (p.base) s.base = true;
    if (p.ink) { s.ink = true; if (p.sw != null) s.sw = +p.sw.toFixed(2); else { const z = Math.min(...p.ps.map((v) => v[2])); s.sw = +S.sw(z).toFixed(2); } }
    if (p.spec != null && Math.abs(p.spec - 0.1) > 1e-6) s.spec = p.spec;
    if (p.em) s.emissive = p.em;
    const props = { d: pathD(q), fill: p.alb, surface: s };
    if (p.op < 1) props.opacity = p.op;
    return { id, type: 'path', parent, props };
  };
  for (const { it, i } of items) {
    const iid = `${pre}${i}`;
    const ip = { };
    if (it.name) ip.name = it.name;
    if (it.occ.length || it.tris.length) ip.occluder = { ...(it.occ.length ? { boxes: it.occ.map((b) => b.map(r4)) } : {}), ...(it.tris.length ? { tris: it.tris.map((t) => t.map((v) => v.map(r4))) } : {}) };
    push({ id: iid, type: 'group', parent: rootId, props: ip });
    // подряд идущие примитивы одной грани (общая плоскость и обрезка) — в общую группу с surface.plane и clip
    let j = 0, gi = 0;
    const ps = it.prims;
    while (j < ps.length) {
      const p = ps[j];
      let k = j + 1;
      if (p.t !== 'img') while (k < ps.length && ps[k].t !== 'img' && ps[k].pl === p.pl && ps[k].clip === p.clip && p.pl) k++;
      const run = ps.slice(j, k);
      if (run.length === 1 && !p.clip) {
        const n = prim2node(p, `${iid}_${gi++}`, iid, null);
        if (n) push(n);
      } else {
        const gid = `${iid}_${gi++}`;
        const g = push({ id: gid, type: 'group', parent: iid, props: p.pl ? { surface: { plane: p.pl.map(r4) } } : {} });
        if (p.clip) {
          const cq = P2(p.clip);
          push({ id: `${gid}c`, type: 'path', parent: iid, props: { d: pathD(cq), fill: '#ffffff' } });
          g.props.clip = `${gid}c`;
        }
        let m = 0;
        for (const q of run) { const n = prim2node(q, `${gid}_${m++}`, gid, p.pl); if (n) push(n); }
      }
      j = k;
    }
  }
  if (opts.lights !== false && S.lights.length) {
    const lid = `${pre}lights`;
    push({ id: lid, type: 'group', parent: rootId, props: {} });
    S.lights.forEach((l, i) => {
      const [x, y] = S.P(l.p);
      push({ id: `${lid}_${i}`, type: 'light', parent: lid, props: { x: r1(x), y: r1(y), p3: l.p.map(r4), color: l.col, radius: l.r, energy: l.i, group: l.kind, ...(l.shadows != null ? { shadows: l.shadows } : {}) } });
    });
  }
  const [top, mid, low] = S.skyGrad;
  return {
    nodes, root: rootId,
    camera3d: { hor: S.hor, f: S.f, camH: S.camH, dz: S.dz, cx: S.cx },
    background: { type: 'linear', x1: 0, y1: 0, x2: 0, y2: S.H, stops: [[0, top], [0.6, mid], [1, low]] },
  };
}
/** Полная сцена Kontur из построителя: размеры, камера, фон-небо, узлы. extra — поля сцены (lighting, style, …). */
export function toScene(S, extra = {}, opts = {}) {
  const r = toNodes(S, opts);
  return { version: 1, width: S.W, height: S.H, duration: extra.duration ?? 4, fps: 30, loop: true, background: r.background, camera3d: r.camera3d, ...extra, nodes: r.nodes };
}

/* ============================== ОПИСАНИЕ → ПОСТРОЕНИЕ ============================== */
/**
 * Собрать сцену из JSON-описания (инструмент MCP world_build). items — массив:
 *  {type:'box', x:[x0,x1], y:[y0,y1], z:[z0,z1], color, mats:{front:['stone','#c9b597',{bh:0.4}], top, side, all}, top, sides, spec, emissive, key, occ}
 *  {type:'house', x:[x0,x1], z:[z0,z1], h, color, roof, mat:'plaster'|'stone'|'brick', ridge:'x'|'z', roofType:'flat', facades, doorAt, shut, plinth, chimney, pipe, litP, y0, key}
 *  {type:'cyl', X, Z, r, y:[y0,y1], color, top, bands, n, spec, key}
 *  {type:'disc', X, Y, Z, rx, rz, color, spec, base, ink, wob, normal, opacity, key}
 *  {type:'stairs', x:[x0,x1], z:[z0,z1], h, steps, color, mat}
 *  {type:'ground', x:[x0,x1], z:[z0,z1], y, color, mat:'cobble'|'stone'|…, maxZ, key}
 *  {type:'wall', ps:[[X,Y,Z],…], color, mat, matColor, matOpt, spec, emissive, ink, key} — грань многоугольником
 *  {type:'window'|'door'|'pipe'|'ivy', on: {o,u,v,w,h,n} или wall-описание ps, a, b, w, h, lit, shut, box, color, density, key}
 *  {type:'light', p:[X,Y,Z], color, radius, energy, group:'lamp'|'window'|'candle', shadows}
 *  {type:'lamp', X, Y, Z, h} — фонарь на столбе со светом
 *  {type:'cloud', x, y, rx, ry, color, opacity}
 * Цвета — #hex или имена палитры C (stone, brick, plaster, …).
 */
export function buildWorld({ width = 1920, height = 1080, camera3d = {}, seed: sd = 1, items = [], sky } = {}) {
  reseed(sd);
  const S = Scene({ W: width, H: height, ...CAMERA_DEFAULT, ...camera3d });
  if (Array.isArray(sky) && sky.length === 3) S.skyGrad = sky.map(col);
  const errs = [];
  const mats = (m) => { if (!m) return undefined; const o = {}; for (const k in m) o[k] = m[k] ? [m[k][0], col(m[k][1]), m[k][2] || {}] : null; return o; };
  const frameFrom = (on) => {
    if (on && on.o && on.u && on.v) return S.frame(on.o, on.u, on.v, on.w, on.h, on.n || norm(cross(on.u, on.v)).map((v) => -v));
    if (on && Array.isArray(on.ps)) { let n = norm(cross(sub(on.ps[1], on.ps[0]), sub(on.ps[2], on.ps[0]))); if (dot(n, sub(S.cam, avg(on.ps))) < 0) n = mul(n, -1); return frameOf(S, on.ps, n); }
    throw new Error('нужно on: {o,u,v,w,h,n} или {ps}');
  };
  items.forEach((d, i) => {
    try {
      const c = col(d.color);
      switch (d.type) {
        case 'box': box(S, d.x[0], d.x[1], d.y?.[0] ?? 0, d.y?.[1] ?? 1, d.z[0], d.z[1], c || C.stone, { mats: mats(d.mats), top: col(d.top), sides: col(d.sides), spec: d.spec, em: d.emissive, key: d.key, occ: d.occ, name: d.name }); break;
        case 'house': house(S, d.x[0], d.x[1], d.z[0], d.z[1], d.h ?? 8, { ...d, col: c, roof: col(d.roof), shut: col(d.shut), doorCol: col(d.doorColor), sides: col(d.sides) }); break;
        case 'cyl': cyl(S, d.X, d.Z, d.r ?? 0.3, d.y?.[0] ?? 0, d.y?.[1] ?? 1, c || C.stone, { n: d.n, top: col(d.top), bands: d.bands, spec: d.spec, key: d.key, occ: d.occ, name: d.name }); break;
        case 'disc': S.item(d.key ?? d.Z, [disc(S, d.X, d.Y ?? 0.003, d.Z, d.rx ?? 0.5, d.rz ?? d.rx ?? 0.5, c || C.iron, { spec: d.spec, base: d.base, ink: d.ink, wob: d.wob, n3: d.normal && norm(d.normal), op: d.opacity, em: d.emissive })], { name: d.name || 'disc' }); break;
        case 'stairs': stairs(S, d.x[0], d.x[1], d.z[0], d.z[1], d.h ?? 2, c || C.stoneHi, { steps: d.steps, mat: d.mat, y0: d.y0 }); break;
        case 'ground': {
          const y = d.y ?? 0, [x0, x1] = d.x, [z0, z1] = d.z;
          const fr = (n) => S.frame([x0, y, z0], [1, 0, 0], [0, 0, 1], x1 - x0, z1 - z0, n);
          S.item(d.key ?? 1e6, face(S, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], c || C.cobble, { mat: d.mat ?? 'cobble', matCol: c || C.cobble, frame: fr, matOpt: { maxZ: d.maxZ ?? 26, ...(d.matOpt || {}) }, ink: false, spec: d.spec ?? 0.25 }), { name: d.name || 'ground' });
          break;
        }
        case 'wall': {
          const ps = d.ps;
          S.item(d.key ?? Math.min(...ps.map((p) => p[2])), face(S, ps, c || C.plaster, { mat: d.mat, matCol: col(d.matColor) || c, matOpt: d.matOpt, frame: d.mat ? (n) => frameOf(S, ps, n) : null, spec: d.spec, em: d.emissive, ink: d.ink, clip: d.clip }), { name: d.name || 'wall' });
          break;
        }
        case 'window': case 'door': case 'pipe': case 'ivy': {
          const fr = frameFrom(d.on);
          const pr = d.type === 'window' ? windowPrims(S, fr, d.a ?? 0, d.b ?? 1, d.w ?? 0.84, d.h ?? 1.2, { lit: d.lit, shut: col(d.shut), box: d.box })
            : d.type === 'door' ? doorPrims(S, fr, d.a ?? 0, d.w ?? 1.1, d.h ?? 2.1, c || C.wood)
              : d.type === 'pipe' ? pipePrims(S, fr, d.a ?? 0.25, d.b ?? 0, d.h ?? fr.h)
                : ivy(S, fr, d.a ?? 0, d.b ?? 0, d.w ?? 1.5, d.h ?? 3, d.density ?? 80);
          S.item(d.key ?? fr.z - 0.01, pr, { name: d.name || d.type });
          break;
        }
        case 'light': S.light(d.p, d.color || '#ffc070', d.radius ?? 5, d.energy ?? 1, d.group || 'lamp', d.shadows != null ? { shadows: d.shadows } : {}); break;
        case 'lamp': {
          const { X, Y = 0, Z, h = 3 } = d;
          cyl(S, X, Z, 0.07, Y, Y + h, C.iron, { n: 8, key: Z - 0.2, spec: 0.6, name: 'lamp_post' });
          box(S, X - 0.2, X + 0.2, Y + h, Y + h + 0.45, Z - 0.2, Z + 0.2, C.glow, { key: Z - 0.31, em: col(d.glow) || '#ffd890', occ: false, name: 'lamp' });
          S.item(Z - 0.32, face(S, [[X - 0.3, Y + h + 0.45, Z - 0.3], [X + 0.3, Y + h + 0.45, Z - 0.3], [X, Y + h + 0.8, Z]], C.iron, {}), { name: 'lamp_cap' });
          S.light([X, Y + h + 0.22, Z - 0.3], c || '#ffc070', d.radius ?? 5.5, d.energy ?? 1.3, 'lamp');
          break;
        }
        case 'cloud': S.cloud(d.x, d.y, d.rx ?? 160, d.ry ?? 32, c || '#fff0e0', d.opacity ?? 0.55); break;
        default: throw new Error(`неизвестный тип ${d.type}`);
      }
    } catch (e) { errs.push(`#${i} (${d.type}): ${e.message}`); }
  });
  return { S, errors: errs };
}

/**
 * Материал на грань-узел: frame — рамка грани ({o,u,v,w,h,n}); возвращает примитивы деталей (их переводит toNodes).
 */
export function materialPrims(S, frame, name, color, opt = {}) {
  if (!MAT[name]) throw new Error(`Материал ${name}? Есть: ${MATERIALS.join(', ')}`);
  const fr = S.frame(frame.o, frame.u, frame.v, frame.w, frame.h, frame.n);
  return MAT[name](S, fr, col(color) || C[name] || C.stone, opt);
}
