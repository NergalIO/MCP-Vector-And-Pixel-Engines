// Kontur world3d — Фасады: дом, окна, двери, водостоки, плющ, персонаж-картинка, надписи.
import { C, dark } from './color.js';
import { rnd } from './rng.js';
import { add, mul, norm } from './geom.js';
import { bevel, blob } from './materials.js';
import { face, frameOf, box, arch, disc } from './shapes.js';
import { triangulate } from './geom.js';

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
  // mat 'none' — фасад без векторных деталей (фактуру даёт попиксельный материал pmat)
  const m = mat === 'none' ? null : mat === 'stone' ? ['stone', c] : mat === 'brick' ? ['brick', c] : ['plaster', c];
  const decor = { front: decorFor('front'), left: decorFor('left'), right: decorFor('right') };
  if (o.plinth) box(S, x0 - 0.06, x1 + 0.06, y0, y0 + o.plinth, z0 - 0.06, z1 + 0.06, C.stone, { key: key + 0.003, name: 'plinth', mats: { all: ['stone', C.stone, { bh: 0.38 }] }, occ: false });
  box(S, x0, x1, y0, y1, z0, z1, c, { key: key + 0.002, name: 'house', mats: m ? { all: m, top: null } : {}, decor, sides: o.sides });
  const prims = [], tris = [];
  const roofFace = (ps, fr) => face(S, ps, roofCol, { center: [(x0 + x1) / 2, y1 - 1, (z0 + z1) / 2], mat: 'tile', matCol: roofCol, frame: fr, spec: 0.2 });
  if (o.ridge === 'z') {
    const xm = (x0 + x1) / 2, yr = y1 + rh, L = z1 - z0 + 2 * ov, sl = Math.hypot(xm - x0 + ov, rh);
    prims.push(...face(S, [[x0, y1, z0], [x1, y1, z0], [xm, yr, z0]], c, { center: [xm, y1, (z0 + z1) / 2] }));
    prims.push(...roofFace([[x0 - ov, y1 - 0.12, z0 - ov], [xm, yr, z0 - ov], [xm, yr, z1 + ov], [x0 - ov, y1 - 0.12, z1 + ov]], (n) => S.frame([x0 - ov, y1 - 0.12, z1 + ov], [0, 0, -1], norm([xm - x0 + ov, rh + 0.12, 0]), L, sl, n)));
    prims.push(...roofFace([[x1 + ov, y1 - 0.12, z0 - ov], [xm, yr, z0 - ov], [xm, yr, z1 + ov], [x1 + ov, y1 - 0.12, z1 + ov]], (n) => S.frame([x1 + ov, y1 - 0.12, z0 - ov], [0, 0, 1], norm([xm - x1 - ov, rh + 0.12, 0]), L, sl, n)));
    tris.push([[x0 - ov, y1, z0 - ov], [xm, yr, z0 - ov], [xm, yr, z1 + ov]], [[x0 - ov, y1, z0 - ov], [xm, yr, z1 + ov], [x0 - ov, y1, z1 + ov]], [[x1 + ov, y1, z0 - ov], [xm, yr, z0 - ov], [xm, yr, z1 + ov]], [[x1 + ov, y1, z0 - ov], [xm, yr, z1 + ov], [x1 + ov, y1, z1 + ov]]);
  } else if (o.roofType === 'hip' || o.roofType === 'shed') {
    const ex0 = x0 - ov, ex1 = x1 + ov, ez0 = z0 - ov, ez1 = z1 + ov, ye = y1 - 0.12, yr = y1 + rh;
    const slope = (ps) => { prims.push(...roofFace(ps, (n) => frameOf(S, ps, n))); tris.push(...triangulate(ps)); };
    if (o.roofType === 'shed') {
      // односкатная: низ спереди, верх над задней стеной; боковые стены — треугольники фасада
      const cen = [(x0 + x1) / 2, y1, (z0 + z1) / 2], yAt = (z) => ye + ((yr - ye) * (z - ez0)) / (ez1 - ez0);
      prims.push(...face(S, [[x0, y1, z0], [x0, y1, z1], [x0, yAt(z1), z1], [x0, Math.max(y1, yAt(z0)), z0]], c, { center: cen }));
      prims.push(...face(S, [[x1, y1, z0], [x1, y1, z1], [x1, yAt(z1), z1], [x1, Math.max(y1, yAt(z0)), z0]], c, { center: cen }));
      // скат — после стен: свес крыши закрывает их верх
      slope([[ex0, ye, ez0], [ex1, ye, ez0], [ex1, yr, ez1], [ex0, yr, ez1]]);
    } else {
      // вальмовая: конёк вдоль длинной стороны, торцы — треугольные скаты
      const W = ex1 - ex0, D = ez1 - ez0;
      if (W >= D) {
        const zm = (ez0 + ez1) / 2, xa = Math.min(ex0 + D / 2, (ex0 + ex1) / 2), xb = Math.max(ex1 - D / 2, (ex0 + ex1) / 2);
        slope([[ex0, ye, ez0], [ex1, ye, ez0], [xb, yr, zm], [xa, yr, zm]]);
        slope([[ex1, ye, ez1], [ex0, ye, ez1], [xa, yr, zm], [xb, yr, zm]]);
        slope([[ex0, ye, ez1], [ex0, ye, ez0], [xa, yr, zm]]);
        slope([[ex1, ye, ez0], [ex1, ye, ez1], [xb, yr, zm]]);
      } else {
        const xm = (ex0 + ex1) / 2, za = Math.min(ez0 + W / 2, (ez0 + ez1) / 2), zb = Math.max(ez1 - W / 2, (ez0 + ez1) / 2);
        slope([[ex0, ye, ez1], [ex0, ye, ez0], [xm, yr, za], [xm, yr, zb]]);
        slope([[ex1, ye, ez0], [ex1, ye, ez1], [xm, yr, zb], [xm, yr, za]]);
        slope([[ex0, ye, ez0], [ex1, ye, ez0], [xm, yr, za]]);
        slope([[ex1, ye, ez1], [ex0, ye, ez1], [xm, yr, zb]]);
      }
    }
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

/** Надпись на грани рамки fr: центр (a, b) в метрах грани, высота букв size (м). */
export function textPrim(S, fr, a, b, text, size, color, o = {}) {
  return { t: 'text', text, at: add(fr.at(a, b), mul(fr.n, 0.006)), u: fr.u, v: fr.v, size, color, n: fr.n, pl: fr.pl, font: o.font, weight: o.weight, spacing: o.spacing, em: o.em };
}
