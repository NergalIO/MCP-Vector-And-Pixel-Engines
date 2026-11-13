// Kontur world3d — Процедурные материалы граней (кирпич, камень, штукатурка, …) и их реестр.
import { C, col, mix, dark, lite, jit } from './color.js';
import { rnd, withSeed } from './rng.js';

/* ============================== МАТЕРИАЛЫ ============================== */
const clipR = (fr, a, b, w, h) => { const a0 = Math.max(0, a), b0 = Math.max(0, b), a1 = Math.min(fr.w, a + w), b1 = Math.min(fr.h, b + h); return a1 - a0 > 0.01 && b1 - b0 > 0.01 ? [a0, b0, a1 - a0, b1 - b0] : null; };
/** Выпуклый блок с фаской: основа + 4 скошенные полосы. */
export function bevel(S, fr, a, b, w, h, c, bv = 0.04, k = 0.8, o = {}) {
  const r = clipR(fr, a, b, w, h);
  if (!r) return [];
  [a, b, w, h] = r;
  const bvv = Math.min(bv, w / 3, h / 3);
  const out = [S.det(fr, fr.rect(a, b, w, h), c, { bump: true, spec: o.spec })];
  if (S.lod && bvv * S.lodPx(fr, a + w / 2, b + h / 2) < S.lodMin()) return out;
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
    for (let i = 0; i < Math.round((fr.w * fr.h) / 5); i++) {
      const bl = blob(fr, rnd() * fr.w, rnd() * fr.h, 0.4 + rnd() * 1.0, 10, 0.6 + rnd() * 0.6), cc = rnd() < 0.6 ? dark(c, 0.12) : lite(c, 0.12);
      // lod 2: пятна штукатурки дальше, чем ~3 px на 10 см, не видны
      if (S.lod >= 2 && 0.1 * S.pxPerUnit(bl[0][2]) < 3) continue;
      out.push(S.det(fr, bl, cc, { op: 0.35 }));
    }
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
        if (S.lod && rh * 0.28 * S.lodPx(fr, r[0], r[1]) < S.lodMin()) continue;
        const rr = clipR(fr, a + 0.01, b, tw - 0.02, rh * 0.28);
        if (rr) out.push(S.det(fr, fr.rect(...rr), dark(cc, 0.15), { n: fr.tilt(0, -1, 0.9), spec: 0.2 }));
        const rl = clipR(fr, a + 0.01, b, tw * 0.22, rh);
        if (rl) out.push(S.det(fr, fr.rect(...rl), lite(cc, 0.08), { n: fr.tilt(-1, 0, 0.5) }));
      }
    }
    for (let i = 0; i < Math.round(fr.w / 3); i++) out.push(S.det(fr, blob(fr, rnd() * fr.w, rnd() * fr.h * 0.5, 0.3 + rnd() * 0.3, 8, 0.6), C.mossSh, { op: 0.6, n: fr.tilt(0, 0.5, 0.5) }));
    return out;
  },
  /** Канальная (полукруглая) черепица: выпуклые ряды-«крышки» вдоль ската, желобки между ними, тени на стыках рядов. */
  barrel(S, fr, c = C.roof, o = {}) {
    const out = [S.det(fr, fr.rect(0, 0, fr.w, fr.h), dark(c, 0.42))];
    const tw = o.tw || 0.24, rh = o.rh || 0.42, cw = tw * 0.64, sw = cw * 0.24, pan = dark(c, 0.2);
    for (let a = (fr.w % tw) / 2 - tw; a < fr.w; a += tw) {
      // желобок (вогнутая черепица) — между крышками, в тени
      const rp = clipR(fr, a + cw, 0, tw - cw, fr.h);
      if (rp) out.push(S.det(fr, fr.rect(...rp), pan, { n: fr.tilt(0, 0.3, 1), spec: 0.15 }));
      // крышка: свет слева, середина, тень справа — полукруглое сечение по нормалям
      const rl = clipR(fr, a, 0, sw, fr.h), rr = clipR(fr, a + cw - sw, 0, sw, fr.h);
      if (rl) out.push(S.det(fr, fr.rect(...rl), lite(c, 0.1), { n: fr.tilt(-0.9, 0.3, 1), spec: 0.3 }));
      if (rr) out.push(S.det(fr, fr.rect(...rr), dark(c, 0.16), { n: fr.tilt(0.9, 0.3, 1), spec: 0.2 }));
      for (let b = 0, row = 0; b < fr.h; b += rh, row++) {
        const cc = rnd() < 0.05 ? mix(c, C.mossSh, 0.45) : jit(c, 0.1), rm = clipR(fr, a + sw, b, cw - 2 * sw, rh - 0.02);
        if (rm) out.push(S.det(fr, fr.rect(...rm), cc, { n: fr.tilt(0, 0.3, 1), spec: 0.3 }));
      }
    }
    // стыки рядов: нижний край каждой черепицы отбрасывает тень на ряд ниже
    for (let b = rh; b < fr.h; b += rh) {
      if (S.lod && rh * 0.12 * S.lodPx(fr, fr.w / 2, b) < S.lodMin()) break;
      const r = clipR(fr, 0, b - rh * 0.1, fr.w, rh * 0.1);
      if (r) out.push(S.det(fr, fr.rect(...r), dark(c, 0.3), { n: fr.tilt(0, -1, 0.8), op: 0.75 }));
    }
    for (let i = 0; i < Math.round(fr.w / 4); i++) out.push(S.det(fr, blob(fr, rnd() * fr.w, rnd() * fr.h * 0.4, 0.25 + rnd() * 0.25, 8, 0.6), C.mossSh, { op: 0.4, n: fr.tilt(0, 0.5, 0.5) }));
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
          out.push(S.det(fr, fr.rect(ra, rb, rw, rhh), cc, { n: fr.tilt(S.q((rnd() - 0.5) * 0.15, 0.075), S.q((rnd() - 0.5) * 0.15, 0.075), 1), spec: 0.25 }));
          if (S.lod && Math.min(rw, rhh) * 0.25 * S.lodPx(fr, ra, rb) < S.lodMin()) { a += w; continue; }
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
/** Обои в полоску: c — основной цвет, o.c2 — второй, o.w — ширина полосы (м), o.thin — тонкая линия. */
MAT.stripes = (S, fr, c = C.rose, o = {}) => {
  const out = [], w = o.w || 0.18, c2 = o.c2 || lite(c, 0.12);
  for (let a = 0, i = 0; a < fr.w; a += w, i++) {
    const r = clipR(fr, a, 0, w, fr.h);
    if (!r) continue;
    if (i % 2) out.push(S.det(fr, fr.rect(...r), c2, { op: o.op ?? 1 }));
    if (o.thin !== false) { const rr = clipR(fr, a + w * 0.47, 0, w * 0.06, fr.h); if (rr) out.push(S.det(fr, fr.rect(...rr), dark(c, 0.12))); }
  }
  return out;
};
/** Деревянные панели (стеновые, ящики стойки): рамки с фаской и филёнки; o.pw — ширина панели, o.rows. */
MAT.panels = (S, fr, c = C.wood, o = {}) => {
  const out = [S.det(fr, fr.rect(0, 0, fr.w, fr.h), dark(c, 0.1))];
  const pw = o.pw || 0.8, rows = o.rows || 1, n = Math.max(1, Math.round(fr.w / pw)), cw = fr.w / n, ch = fr.h / rows, m = Math.min(0.08, cw * 0.12, ch * 0.15);
  for (let i = 0; i < n; i++) for (let j = 0; j < rows; j++) {
    out.push(...bevel(S, fr, i * cw + m, j * ch + m, cw - 2 * m, ch - 2 * m, jit(c, 0.05), Math.min(0.05, m), 0.8));
    out.push(S.det(fr, fr.rect(i * cw + m * 2.2, j * ch + m * 2.2, cw - 4.4 * m, ch - 4.4 * m), dark(c, 0.06), { n: fr.tilt(0, 0, 1) }));
  }
  if (o.rail !== false) out.push(...bevel(S, fr, 0, fr.h - 0.06, fr.w, 0.06, lite(c, 0.06), 0.02, 0.9));
  return out;
};
/** Плиты мощения крупные (площадь у ратуши): o.s — размер плиты. */
MAT.slabs = (S, fr, c = C.stone, o = {}) => {
  const out = [S.det(fr, fr.rect(0, 0, fr.w, fr.h), dark(c, 0.3))];
  const s = o.s || 0.6, maxZ = o.maxZ ?? 40;
  for (let b = 0, row = 0; b < fr.h; b += s, row++) {
    if (fr.at(0, b)[2] > maxZ) break;
    for (let a = -(row % 2) * s * 0.5; a < fr.w; a += s) {
      const r = clipR(fr, a + 0.02, b + 0.02, s - 0.04, s - 0.04);
      if (r) out.push(S.det(fr, fr.rect(...r), jit(c, 0.08), { n: fr.tilt((rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.06, 1), spec: 0.2 }));
    }
  }
  return out;
};
/** Имена материалов (живой список: registerMaterial дописывает). */
export const MATERIALS = Object.keys(MAT);
/** Справка по параметрам материалов (options / matOpt). */
export const MATERIAL_DOCS = {
  brick: 'bw (ширина кирпича, 0.42), bh (высота, 0.16), b0 (сдвиг первого ряда)',
  stone: 'bh (высота ряда), moss (false — без мха)',
  plaster: 'patches (пятна штукатурки, true)',
  wood: 'pw (ширина доски), vert (вертикальные доски)',
  tile: 'rh (высота ряда черепицы), tw (ширина)',
  barrel: 'tw (шаг рядов-крышек, 0.24), rh (длина черепицы вдоль ската, 0.42)',
  cobble: 'maxZ (дальше — без камней, 26)',
  stripes: 'w (ширина полосы, 0.18), c2 (второй цвет), op, thin (false — без тонких линий)',
  panels: 'pw (ширина панели), rows (рядов), rail (поперечины), s',
  slabs: 's (размер плиты), maxZ',
};
/**
 * Добавить или заменить векторный материал: fn(S, fr, color, opt) → примитивы деталей на рамке грани fr
 * (fr.at/rect/tilt, S.det/bevel). doc — строка параметров для справки.
 */
export function registerMaterial(name, fn, doc = '') {
  if (typeof fn !== 'function') throw new Error(`registerMaterial(${name}): нужна функция (S, fr, color, opt) → примитивы`);
  MAT[name] = fn;
  if (!MATERIALS.includes(name)) MATERIALS.push(name);
  MATERIAL_DOCS[name] = doc;
  return fn;
}

/**
 * Материал на грань-узел: frame — рамка грани ({o,u,v,w,h,n}); возвращает примитивы деталей (их переводит toNodes).
 */
export function materialPrims(S, frame, name, color, opt = {}) {
  if (opt.seed != null) { const { seed: s, ...rest } = opt; return withSeed(s, () => materialPrims(S, frame, name, color, rest)); }
  if (!MAT[name]) throw new Error(`Материал ${name}? Есть: ${MATERIALS.join(', ')}`);
  const fr = S.frame(frame.o, frame.u, frame.v, frame.w, frame.h, frame.n);
  return MAT[name](S, fr, col(color) || C[name] || C.stone, opt);
}
