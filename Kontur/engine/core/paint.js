/** Краски, обрезка обводки, растровые слои, дизеринг. */
import { formatColor, parseColor } from './color.js';
import { DEG, clamp, fmt, hashStr } from './math.js';
import { isGrad, normStops } from './tracks.js';

export function paintAttr(v, key, kind, ctx) {
  if (v == null) return 'none';
  if (typeof v === 'string') return v;
  if (isGrad(v)) {
    const id = ctx.id(key, kind);
    const stops = normStops(v.stops).map((s) => ({ tag: 'stop', attrs: { offset: fmt(s.offset), 'stop-color': s.color, 'stop-opacity': fmt(s.opacity ?? 1) } }));
    if (v.type === 'linear') {
      let { x1 = -50, y1 = 0, x2 = 50, y2 = 0 } = v;
      if (v.angle != null) {
        const len = v.length ?? 100, a = v.angle * DEG;
        x1 = -Math.cos(a) * len / 2; y1 = -Math.sin(a) * len / 2; x2 = -x1; y2 = -y1;
      }
      ctx.addDef({ tag: 'linearGradient', attrs: { id, gradientUnits: 'userSpaceOnUse', x1: fmt(x1), y1: fmt(y1), x2: fmt(x2), y2: fmt(y2) }, children: stops });
    } else {
      ctx.addDef({ tag: 'radialGradient', attrs: { id, gradientUnits: 'userSpaceOnUse', cx: fmt(v.cx ?? 0), cy: fmt(v.cy ?? 0), r: fmt(v.r ?? 50), fx: fmt(v.fx ?? v.cx ?? 0), fy: fmt(v.fy ?? v.cy ?? 0) }, children: stops });
    }
    return `url(#${id})`;
  }
  return 'none';
}

export function trimDash(s, e, o, L) {
  s = clamp(s); e = clamp(e);
  if (e < s) [s, e] = [e, s];
  const span = e - s;
  if (span >= 0.9999) return null;
  if (span <= 1e-5) return { hide: true };
  let a = s + o;
  a -= Math.floor(a);
  const b = a + span;
  if (b <= 1) return { dash: `0 ${fmt(a * L)} ${fmt(span * L)} ${fmt(L * 2)}`, off: 0 };
  return { dash: `${fmt((b - 1) * L)} ${fmt((a - (b - 1)) * L)} ${fmt((1 - a) * L)} ${fmt(L)}`, off: 0 };
}

/* ---------- растровые слои ---------- */
export const FIT = { stretch: 'none', contain: 'xMidYMid meet', cover: 'xMidYMid slice' };
export function imageElement(node, Pt, t, ctx, nkey) {
  const src = Pt('src') || '';
  const w = Pt('width'), h = Pt('height');
  const style = Pt('pixelated') ? 'image-rendering:pixelated;image-rendering:crisp-edges' : null;
  const sheet = Pt('sheet');
  if (sheet && sheet.cols) {
    // спрайт-лист: кадр выбирается свойством frame или по fps
    const cols = sheet.cols, rows = sheet.rows || 1, count = sheet.count || cols * rows;
    const fw = sheet.frameWidth, fh = sheet.frameHeight;
    let f = node.keys?.frame || node.props?.frame != null ? Pt('frame') : t * (sheet.fps || 12);
    f = Math.floor(f);
    f = sheet.loop === false ? clamp(f, 0, count - 1) : ((f % count) + count) % count;
    const fx = (f % cols) * fw, fy = Math.floor(f / cols) * fh;
    return {
      tag: 'svg', attrs: { x: fmt(-w / 2), y: fmt(-h / 2), width: fmt(w), height: fmt(h), viewBox: `${fx} ${fy} ${fw} ${fh}`, preserveAspectRatio: 'none', overflow: 'hidden' },
      children: [{ tag: 'image', attrs: { href: src, 'xlink:href': src, x: 0, y: 0, width: cols * fw, height: rows * fh, preserveAspectRatio: 'none', style } }],
    };
  }
  return { tag: 'image', attrs: { href: src, 'xlink:href': src, x: fmt(-w / 2), y: fmt(-h / 2), width: fmt(w), height: fmt(h), preserveAspectRatio: FIT[Pt('fit')] || Pt('fit') || 'none', style } };
}

/* ---------- дизеринг ---------- */
export function bayer(n) {
  let m = [[0]];
  while (m.length < n) {
    const k = m.length, out = Array.from({ length: k * 2 }, () => new Array(k * 2));
    for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) {
      const v = 4 * m[y][x];
      out[y][x] = v; out[y][x + k] = v + 2; out[y + k][x] = v + 3; out[y + k][x + k] = v + 1;
    }
    m = out;
  }
  return m;
}
export const DITHER_PATTERNS = {
  bayer2: bayer(2),
  bayer4: bayer(4),
  bayer8: bayer(8),
  checker: [[0, 1], [1, 0]].map((r) => r.map((v) => v * 2)),
  dots: [[12, 5, 6, 13], [4, 0, 1, 7], [11, 3, 2, 8], [15, 10, 9, 14]],
  lines: [0, 2, 1, 3].map((row) => [0, 2, 1, 3].map((c) => row * 4 + c)),
  diagonal: Array.from({ length: 4 }, (_, y) => Array.from({ length: 4 }, (_, x) => ((x + y) % 4) * 4 + x)),
};
export const DITHER_DEFAULT = { pattern: 'bayer4', cell: 3, density: 0.5, angle: 90 };

export function effectiveDither(node, Pt, ctx) {
  const own = Pt('dither');
  if (own === false) return null;
  const glob = ctx.scene.dither;
  let d = null;
  if (own && typeof own === 'object') { if (own.enabled === false) return null; d = { ...DITHER_DEFAULT, ...(glob || {}), ...own }; }
  else if (own === true) d = { ...DITHER_DEFAULT, ...(glob || {}) };
  else {
    const sh = Pt('shade');
    if (sh && glob && glob.enabled) d = { ...DITHER_DEFAULT, ...glob, ...(typeof sh === 'object' ? sh : {}) };
  }
  if (!d) return null;
  if (!DITHER_PATTERNS[d.pattern]) d.pattern = 'bayer4';
  return d;
}
export const solidOf = (fill) => (typeof fill === 'string' ? fill : isGrad(fill) ? normStops(fill.stops)[0].color : 'none');

/** Паттерн из ячеек матрицы с рангом в [lo, hi). */
export function ditherPattern(ctx, name, hi, color, cell, alpha, lo = 0) {
  const key = `${name}|${lo}|${hi}|${color}|${cell}|${alpha}`;
  if (ctx.patterns.has(key)) return ctx.reuse(key);
  const M = DITHER_PATTERNS[name], n = M.length;
  const id = `${ctx.prefix}-dp${hashStr(key)}`;
  const rects = [];
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      const inR = (v) => v >= lo && v < hi;
      if (inR(M[y][x])) {
        let x2 = x; while (x2 + 1 < n && inR(M[y][x2 + 1])) x2++;
        rects.push({ tag: 'rect', attrs: { x: x * cell, y: y * cell, width: (x2 - x + 1) * cell, height: cell } });
        x = x2 + 1;
      } else x++;
    }
  }
  return ctx.share(key, { tag: 'pattern', attrs: { id, patternUnits: 'userSpaceOnUse', width: n * cell, height: n * cell },
    children: [{ tag: 'g', attrs: { fill: color, 'fill-opacity': alpha < 1 ? fmt(alpha) : null, 'shape-rendering': 'crispEdges' }, children: rects }] });
}

/** Заливка фигуры упорядоченным растром. density — число или [от, до] (вдоль угла angle). */
export function ditherElements(geom, d, dith, fillVal, fillRule, ctx, nkey) {
  const color = dith.color || solidOf(fillVal);
  if (!color || color === 'none') return null;
  const pc = parseColor(color);
  const alpha = pc ? pc[3] : 1;
  const opaque = pc ? formatColor([pc[0], pc[1], pc[2], 1]) : color;
  const M = DITHER_PATTERNS[dith.pattern], L = M.length * M.length;
  const cell = Math.max(0.5, dith.cell);
  const dens = dith.density;
  const levelFill = (k) => (k >= L ? (alpha < 1 ? color : opaque) : ditherPattern(ctx, dith.pattern, k, opaque, cell, alpha));
  if (!Array.isArray(dens)) {
    const k = Math.round(clamp(dens) * L);
    if (k <= 0) return null;
    return { tag: 'path', attrs: { d, fill: levelFill(k), 'fill-rule': fillRule || null } };
  }
  // градиент плотности: полосы по уровням, обрезанные формой
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const sp of geom) {
    const pts = [[sp.x0, sp.y0], ...sp.segs.flatMap((c) => [[c[0], c[1]], [c[2], c[3]], [c[4], c[5]]])];
    for (const [x, y] of pts) { if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  }
  if (!Number.isFinite(xmin)) return null;
  const a = (dith.angle ?? 90) * DEG, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
  const corners = [[xmin, ymin], [xmax, ymin], [xmax, ymax], [xmin, ymax]];
  const ps = corners.map(([x, y]) => x * ux + y * uy), qs = corners.map(([x, y]) => x * vx + y * vy);
  const pmin = Math.min(...ps) - 1, pmax = Math.max(...ps) + 1, qmin = Math.min(...qs) - 1, qmax = Math.max(...qs) + 1;
  const [d0, d1] = [clamp(dens[0]), clamp(dens[dens.length - 1])];
  const pAt = (dv) => (d1 === d0 ? (dv <= d0 ? pmin : pmax) : pmin + ((dv - d0) / (d1 - d0)) * (pmax - pmin));
  // уровни вложены (ранги Байера): каждая полуплоскость добавляет ровно один ранг — без швов
  const bands = [];
  const P = (p, q) => `${fmt(p * ux + q * vx)} ${fmt(p * uy + q * vy)}`;
  for (let k = 1; k <= L; k++) {
    let a0 = pAt((k - 0.5) / L), a1;
    if (d1 >= d0) a1 = pmax; else { a1 = a0; a0 = pmin; }
    a0 = Math.max(a0, pmin); a1 = Math.min(a1, pmax);
    if (a1 - a0 <= 0.01) continue;
    bands.push({ tag: 'path', attrs: { d: `M${P(a0, qmin)}L${P(a1, qmin)}L${P(a1, qmax)}L${P(a0, qmax)}Z`, fill: ditherPattern(ctx, dith.pattern, k, opaque, cell, alpha, k - 1) } });
  }
  if (!bands.length) return null;
  const cid = ctx.id(nkey, 'dc');
  ctx.addDef({ tag: 'clipPath', attrs: { id: cid, clipPathUnits: 'userSpaceOnUse' }, children: [{ tag: 'path', attrs: { d, 'clip-rule': fillRule || null } }] });
  return { tag: 'g', attrs: { 'clip-path': `url(#${cid})` }, children: bands };
}
