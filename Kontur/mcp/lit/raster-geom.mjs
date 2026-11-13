// Геометрия для растеризатора проходов на видеокарте (gpu-raster.mjs, KONTUR_GPU=raster).
// Вычисленное дерево SVG (evaluate) → плоские массивы: вершины треугольников в пикселях цели, записи предметов
// (заливка по правилу nonzero/evenodd, обводка, запасной слой), заливки (цвет, линейный и радиальный градиент) и стопы.
// Всё, что этот путь не умеет (текст, фильтры, маски, клипы, прозрачность групп, дуги, прочие стили), уходит
// в «запасной слой»: поддерево отдельным SVG, его растеризует resvg, а видеокарта кладёт картинку на своё место
// в порядке художника. Чистый JS без зависимостей: считается в воркерах пула.
import { parseColor, treeToString } from '../../engine/kontur.js';

/**
 * Виды предметов: заливки по правилу и обводка — через трафарет; K_DIRECT — треугольники без перекрытий или
 * непрозрачные (выпуклый контур, непрозрачная обводка): рисуются сразу, подряд идущие — одним вызовом.
 */
export const K_NONZERO = 0, K_EVENODD = 1, K_STROKE = 2, K_LAYER = 3, K_DIRECT = 4;
/** Размеры записей (float); вершина — x, y, номер предмета. */
export const ITEM_F = 12, PAINT_F = 24, STOP_F = 8, VERT_F = 3;
/** Допуск разбиения кривых и окружностей, пиксели цели. */
const TOL = 0.2;

class Buf {
  constructor(n = 1 << 16) { this.a = new Float32Array(n); this.n = 0; }
  need(k) { if (this.n + k > this.a.length) { let m = this.a.length * 2; while (m < this.n + k) m *= 2; const b = new Float32Array(m); b.set(this.a.subarray(0, this.n)); this.a = b; } }
  push2(x, y) { this.need(3); this.a[this.n++] = x; this.a[this.n++] = y; this.a[this.n++] = this.cur; }
  done() { return this.a.slice(0, this.n); }
}

const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const inv = (m) => { const d = m[0] * m[3] - m[1] * m[2] || 1e-12; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };
const I = [1, 0, 0, 1, 0, 0];

const trCache = new Map();
/** Атрибут transform → матрица [a b c d e f] (null — неизвестная функция). */
export function parseTransform(s) {
  if (!s) return I;
  let m = trCache.get(s);
  if (m === undefined) { if (trCache.size > 100000) trCache.clear(); m = parseTransformRaw(s); trCache.set(s, m); }
  return m;
}
function parseTransformRaw(s) {
  let m = I;
  for (const [, fn, args] of String(s).matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = args.split(/[\s,]+/).filter(Boolean).map(Number);
    let t;
    if (fn === 'translate') t = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
    else if (fn === 'scale') t = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
    else if (fn === 'rotate') {
      const a = (v[0] * Math.PI) / 180, c = Math.cos(a), s2 = Math.sin(a);
      t = [c, s2, -s2, c, 0, 0];
      if (v.length >= 3) t = mul(mul([1, 0, 0, 1, v[1], v[2]], t), [1, 0, 0, 1, -v[1], -v[2]]);
    } else if (fn === 'matrix') t = v.slice(0, 6);
    else if (fn === 'skewX') t = [1, 0, Math.tan((v[0] * Math.PI) / 180), 1, 0, 0];
    else if (fn === 'skewY') t = [1, Math.tan((v[0] * Math.PI) / 180), 0, 1, 0, 0];
    else return null;
    m = mul(m, t);
  }
  return m;
}

/**
 * Путь d → контуры [{ p: number[] (x,y в пикселях цели), closed }] с матрицей m; дуги и неизвестное → null.
 * Кривые разбиваются по формуле Ванга с допуском TOL.
 */
export function flattenPath(d, m) {
  const tok = String(d).match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const out = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = '', i = 0, lcx = 0, lcy = 0, lq = null;
  const T = (px, py) => [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]];
  const lineTo = (px, py) => { const [a, b] = T(px, py); cur.p.push(a, b); };
  const num = () => +tok[i++];
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    const [ax, ay] = T(x, y), [bx, by] = T(x1, y1), [cx, cy] = T(x2, y2), [dx, dy] = T(x3, y3);
    const M = Math.max(Math.hypot(ax - 2 * bx + cx, ay - 2 * by + cy), Math.hypot(bx - 2 * cx + dx, by - 2 * cy + dy));
    const n = Math.max(1, Math.min(256, Math.ceil(Math.sqrt((0.75 * M) / TOL))));
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
      cur.p.push(w0 * ax + w1 * bx + w2 * cx + w3 * dx, w0 * ay + w1 * by + w2 * cy + w3 * dy);
    }
  };
  const start = () => { if (!cur) { cur = { p: [], closed: false }; out.push(cur); lineTo(x, y); } };
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
    else if (!cmd) return null;
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') { if (cur) { cur.closed = true; cur = null; } x = sx; y = sy; lq = null; cmd = ''; continue; }
    if (i >= tok.length || /[A-Za-z]/.test(tok[i])) return null;
    if (C === 'M') { x = ox + num(); y = oy + num(); sx = x; sy = y; cur = { p: [], closed: false }; out.push(cur); lineTo(x, y); cmd = rel ? 'l' : 'L'; lq = null; continue; }
    start();
    if (C === 'L') { x = ox + num(); y = oy + num(); lineTo(x, y); lq = null; }
    else if (C === 'H') { x = ox + num(); lineTo(x, y); lq = null; }
    else if (C === 'V') { y = oy + num(); lineTo(x, y); lq = null; }
    else if (C === 'C' || C === 'S') {
      let x1, y1;
      if (C === 'C') { x1 = ox + num(); y1 = oy + num(); } else if (lq === 'c') { x1 = 2 * x - lcx; y1 = 2 * y - lcy; } else { x1 = x; y1 = y; }
      const x2 = ox + num(), y2 = oy + num(), x3 = ox + num(), y3 = oy + num();
      cubic(x1, y1, x2, y2, x3, y3); lcx = x2; lcy = y2; x = x3; y = y3; lq = 'c';
    } else if (C === 'Q' || C === 'T') {
      let qx, qy;
      if (C === 'Q') { qx = ox + num(); qy = oy + num(); } else if (lq === 'q') { qx = 2 * x - lcx; qy = 2 * y - lcy; } else { qx = x; qy = y; }
      const x3 = ox + num(), y3 = oy + num();
      cubic(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x3 + (2 / 3) * (qx - x3), y3 + (2 / 3) * (qy - y3), x3, y3);
      lcx = qx; lcy = qy; x = x3; y = y3; lq = 'q';
    } else return null; // A и прочее — запасной слой
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  }
  return out;
}

/** Один выпуклый контур (веер из первой точки покрывает его ровно один раз). */
export function convexContours(cs) {
  const live = cs.filter((c) => c.p.length >= 6);
  if (live.length !== 1) return false;
  const p = live[0].p, n = p.length >> 1;
  let sign = 0, turn = 0;
  for (let k = 0; k < n; k++) {
    const a = (k + n - 1) % n, b = (k + 1) % n;
    const ux = p[2 * k] - p[2 * a], uy = p[2 * k + 1] - p[2 * a + 1], vx = p[2 * b] - p[2 * k], vy = p[2 * b + 1] - p[2 * k + 1];
    const cr = ux * vy - uy * vx;
    if (Math.abs(cr) < 1e-9 * (Math.abs(ux) + Math.abs(uy) + 1e-30) * (Math.abs(vx) + Math.abs(vy) + 1e-30)) continue;
    const sg = cr > 0 ? 1 : -1;
    if (sign && sg !== sign) return false;
    sign = sg;
    turn += Math.atan2(cr, ux * vx + uy * vy);
  }
  return Math.abs(turn) < 2 * Math.PI + 1e-3;
}
/** Не больше стольких вершин — контур режется на треугольники на процессоре (иначе трафарет). */
const EAR_MAX = 160;
const segX = (ax, ay, bx, by, cx, cy, dx, dy) => {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};
/**
 * Простой многоугольник (один контур без самопересечений) → треугольники отсечением ушей: [x,y, …] по 3 точки,
 * или null (самопересечение, много вершин, не нашлось уха) — тогда трафарет.
 */
export function earClip(cs) {
  const live = cs.filter((c) => c.p.length >= 6);
  if (live.length !== 1) return null;
  const src = live[0].p;
  const x = [], y = [];
  for (let k = 0; k < src.length; k += 2) if (!x.length || Math.abs(src[k] - x[x.length - 1]) + Math.abs(src[k + 1] - y[y.length - 1]) > 1e-7) { x.push(src[k]); y.push(src[k + 1]); }
  if (x.length > 1 && Math.abs(x[0] - x[x.length - 1]) + Math.abs(y[0] - y[y.length - 1]) <= 1e-7) { x.pop(); y.pop(); }
  const n = x.length;
  if (n < 3) return [];
  if (n > EAR_MAX) return null;
  // самопересечения (несмежные рёбра)
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const i2 = (i + 1) % n, j2 = (j + 1) % n;
    if (segX(x[i], y[i], x[i2], y[i2], x[j], y[j], x[j2], y[j2])) return null;
  }
  let area = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += x[i] * y[j] - x[j] * y[i]; }
  if (Math.abs(area) < 1e-9) return [];
  const sg = area > 0 ? 1 : -1;
  const idx = Array.from({ length: n }, (_, i) => i), out = [];
  const cross = (a, b, c) => ((x[b] - x[a]) * (y[c] - y[a]) - (y[b] - y[a]) * (x[c] - x[a])) * sg;
  let guard = 0;
  while (idx.length > 3) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const a = idx[(k + idx.length - 1) % idx.length], b = idx[k], c = idx[(k + 1) % idx.length];
      const cr = cross(a, b, c);
      if (cr < 0) continue;
      if (cr === 0) { idx.splice(k, 1); cut = true; break; } // вырожденное ухо (три точки на прямой)
      let inside = false;
      for (const q of idx) {
        if (q === a || q === b || q === c) continue;
        if (cross(a, b, q) >= 0 && cross(b, c, q) >= 0 && cross(c, a, q) >= 0) { inside = true; break; }
      }
      if (inside) continue;
      out.push(x[a], y[a], x[b], y[b], x[c], y[c]);
      idx.splice(k, 1); cut = true; break;
    }
    if (!cut || ++guard > 4 * n) return null;
  }
  out.push(x[idx[0]], y[idx[0]], x[idx[1]], y[idx[1]], x[idx[2]], y[idx[2]]);
  return out;
}
/**
 * Фигуры (путь d с линейной частью матрицы; сдвиг добавляется при выдаче вершин — ветер и перенос узлов не сбивают
 * кэш): контуры, треугольники заливки и обводок считаются один раз. Ключ — объект атрибутов элемента (статичные
 * поддеревья evaluate отдаёт тем же объектом из кадра в кадр), запасной — строка d и матрица (одни и те же пути во
 * всех проходах).
 */
const shapeByAttrs = new WeakMap(), shapeByKey = new Map();
const SHAPE_MAX = 200000;
const sameL = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
function shapeOf(attrs, d, m) {
  const w = shapeByAttrs.get(attrs);
  if (w && w.d === d && sameL(w.m, m)) return w.e;
  // два уровня (d → линейная часть): без склейки длинной строки d на каждый поиск
  let byM = shapeByKey.get(d);
  if (!byM) { if (shapeByKey.size >= SHAPE_MAX) shapeByKey.clear(); byM = new Map(); shapeByKey.set(d, byM); }
  const k = `${m[0]},${m[1]},${m[2]},${m[3]}`;
  let e = byM.get(k);
  if (e === undefined) {
    const cs = flattenPath(d, [m[0], m[1], m[2], m[3], 0, 0]);
    e = cs ? { cs, fill: null, strokes: null } : null;
    byM.set(k, e);
  }
  shapeByAttrs.set(attrs, { d, m, e });
  return e;
}
/** Сборщик треугольников фигуры [x, y, …]. */
class Tris { constructor() { this.a = []; } push2(x, y) { this.a.push(x, y); } }
/** Заливка фигуры: { direct, ear, t: Float32Array } — выпуклый веер, уши или веер для трафарета. */
function fillOf(e) {
  if (e.fill) return e.fill;
  let direct = convexContours(e.cs), ear = false, t;
  if (!direct) { t = earClip(e.cs); if (t) direct = ear = true; }
  if (!t) { const T = new Tris(); emitFill(T, e.cs); t = T.a; }
  return (e.fill = { direct, ear, t: Float32Array.from(t) });
}
function strokeOf(e, h, cap, join) {
  const k = `${h}|${cap}|${join}`;
  e.strokes ||= new Map();
  let t = e.strokes.get(k);
  if (!t) { const T = new Tris(); emitStroke(T, e.cs, h, cap, join); t = Float32Array.from(T.a); e.strokes.set(k, t); }
  return t;
}
/** Треугольники фигуры со сдвигом (tx, ty) → вершины предмета (x, y, номер предмета). */
function put(V, t, tx, ty) {
  const n = t.length >> 1;
  V.need(n * 3);
  const a = V.a, it = V.cur;
  let o = V.n;
  for (let k = 0; k < t.length; k += 2) { a[o++] = t[k] + tx; a[o++] = t[k + 1] + ty; a[o++] = it; }
  V.n = o;
}
/** Заливка треугольниками веером из первой точки пути: правило заполнения считает трафарет. */
function emitFill(V, contours) {
  const o = contours.find((c) => c.p.length >= 2);
  if (!o) return;
  const ox = o.p[0], oy = o.p[1];
  for (const { p } of contours) {
    const n = p.length >> 1;
    if (n < 2) continue;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      V.push2(ox, oy); V.push2(p[2 * k], p[2 * k + 1]); V.push2(p[2 * j], p[2 * j + 1]);
    }
  }
}
function disc(V, x, y, r) {
  const k = Math.max(6, Math.min(64, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - TOL / Math.max(r, TOL))))));
  let px = x + r, py = y;
  for (let i = 1; i <= k; i++) {
    const t = (i / k) * 2 * Math.PI, qx = x + r * Math.cos(t), qy = y + r * Math.sin(t);
    V.push2(x, y); V.push2(px, py); V.push2(qx, qy);
    px = qx; py = qy;
  }
}
function quad(V, ax, ay, bx, by, cx, cy, dx, dy) { V.push2(ax, ay); V.push2(bx, by); V.push2(cx, cy); V.push2(cx, cy); V.push2(bx, by); V.push2(dx, dy); }
/**
 * Обводка полуширины h треугольниками (трафарет «покрыто хоть раз», направление обхода не важно): отрезки — четырёхугольники,
 * соединения round — круги, остальные — скос (miter приближается скосом), концы round/square/butt.
 */
function emitStroke(V, contours, h, cap, join) {
  for (const c of contours) {
    const p = [];
    for (let k = 0; k < c.p.length; k += 2) if (!p.length || Math.hypot(c.p[k] - p[p.length - 2], c.p[k + 1] - p[p.length - 1]) > 1e-6) p.push(c.p[k], c.p[k + 1]);
    let n = p.length >> 1;
    if (c.closed && n > 2 && Math.hypot(p[0] - p[2 * n - 2], p[1] - p[2 * n - 1]) < 1e-6) { p.length -= 2; n--; }
    if (n === 1) { if (cap === 'round') disc(V, p[0], p[1], h); continue; }
    const closed = c.closed && n > 2, segs = closed ? n : n - 1;
    const nx = [], ny = [];
    for (let s = 0; s < segs; s++) {
      const j = (s + 1) % n;
      let ax = p[2 * s], ay = p[2 * s + 1], bx = p[2 * j], by = p[2 * j + 1];
      const L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L;
      nx.push(-uy * h); ny.push(ux * h);
      if (!closed && cap === 'square') { if (s === 0) { ax -= ux * h; ay -= uy * h; } if (s === segs - 1) { bx += ux * h; by += uy * h; } }
      quad(V, ax + nx[s], ay + ny[s], bx + nx[s], by + ny[s], ax - nx[s], ay - ny[s], bx - nx[s], by - ny[s]);
    }
    for (let v = 0; v < n; v++) {
      const interior = closed || (v > 0 && v < n - 1);
      if (!interior) { if (cap === 'round') disc(V, p[2 * v], p[2 * v + 1], h); continue; }
      if (join === 'round') { disc(V, p[2 * v], p[2 * v + 1], h); continue; }
      const a = (v - 1 + segs) % segs, b = v % segs, x = p[2 * v], y = p[2 * v + 1];
      V.push2(x, y); V.push2(x + nx[a], y + ny[a]); V.push2(x + nx[b], y + ny[b]);
      V.push2(x, y); V.push2(x - nx[a], y - ny[a]); V.push2(x - nx[b], y - ny[b]);
    }
  }
}

const PRESENT = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'stroke-linecap', 'stroke-linejoin'];
const IGNORE = new Set(['data-node', 'id', 'transform', 'opacity', 'style', 'd', 'x', 'y', 'width', 'height', ...PRESENT]);
const set = (v) => v != null && v !== '';

/**
 * Дерево прохода → геометрия: { width, height, ss, verts, items, paints, stops, layers: [svg], counts }.
 * ss — сверхвыборка (цель ss× крупнее выхода).
 */
export function treeToGeometry(tree, { ss = 1 } = {}) {
  const ra = tree.attrs;
  const vb = String(ra.viewBox || `0 0 ${ra.width} ${ra.height}`).split(/[\s,]+/).map(Number);
  const W = Math.round(+ra.width), H = Math.round(+ra.height || (W * vb[3]) / vb[2]);
  const s = (W * ss) / vb[2];
  const root = [s, 0, 0, s, -vb[0] * s, -vb[1] * s];
  const V = new Buf(1 << 20), items = new Buf(1 << 14), paints = new Buf(1 << 14), stops = new Buf(1 << 14);
  const layers = [];
  const defs = new Map();
  const counts = { fills: 0, strokes: 0, direct: 0, ear: 0, layers: 0, reasons: {} };
  const scan = (n) => { if (!n || typeof n !== 'object') return; if (n.tag === 'defs') for (const c of n.children || []) if (c?.attrs?.id) defs.set(c.attrs.id, c); (n.children || []).forEach(scan); };
  scan(tree);

  const paintCache = new Map();
  const opaque = []; // непрозрачна ли заливка (по номеру)
  /** Заливка: индекс записи или null (none), 'unsupported' — запасной слой. */
  const paintOf = (v, op, userM) => {
    if (!set(v) || v === 'none') return null;
    const u = /^url\(#([^)]+)\)$/.exec(v);
    if (!u) {
      const c = parseColor(v);
      if (!c) return 'unsupported';
      const k = `${v}|${op}`;
      if (paintCache.has(k)) return paintCache.get(k);
      const idx = paints.n / PAINT_F;
      paints.need(PAINT_F);
      const rec = new Array(PAINT_F).fill(0); rec[3] = op; rec.splice(4, 4, ...c);
      paints.a.set(rec, paints.n); paints.n += PAINT_F;
      opaque[idx] = c[3] * op >= 1;
      paintCache.set(k, idx);
      return idx;
    }
    const g = defs.get(u[1]);
    if (!g || (g.tag !== 'linearGradient' && g.tag !== 'radialGradient')) return 'unsupported';
    const a = g.attrs;
    if (a.gradientUnits !== 'userSpaceOnUse' || (set(a.spreadMethod) && a.spreadMethod !== 'pad') || set(a.href) || set(a['xlink:href'])) return 'unsupported';
    const gt = parseTransform(a.gradientTransform);
    if (!gt) return 'unsupported';
    const M = inv(mul(mul(root, userM), gt));
    const st = (g.children || []).filter((c) => c?.tag === 'stop');
    const off = stops.n / STOP_F;
    let last = 0, opq = op >= 1;
    for (const sp of st) {
      const c = parseColor(sp.attrs['stop-color'] ?? '#000');
      if (!c) return 'unsupported';
      last = Math.max(last, Math.min(1, +(sp.attrs.offset ?? 0)));
      if (c[3] * +(sp.attrs['stop-opacity'] ?? 1) < 1) opq = false;
      stops.need(STOP_F);
      stops.a.set([last, 0, 0, 0, c[0], c[1], c[2], c[3] * +(sp.attrs['stop-opacity'] ?? 1)], stops.n); stops.n += STOP_F;
    }
    const idx = paints.n / PAINT_F;
    const lin = g.tag === 'linearGradient';
    const geo = lin ? [+a.x1, +a.y1, +a.x2, +a.y2] : [+a.cx, +a.cy, +a.r, 0];
    const foc = lin ? [0, 0, 0, 0] : [+(a.fx ?? a.cx), +(a.fy ?? a.cy), 0, 0];
    paints.need(PAINT_F);
    paints.a.set([lin ? 1 : 2, off, st.length, op, 0, 0, 0, 0, M[0], M[1], M[2], M[3], M[4], M[5], 0, 0, ...geo, ...foc], paints.n); paints.n += PAINT_F;
    opaque[idx] = opq;
    return idx;
  };
  const item = (kind, vs, paint, blend, layer = -1) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = vs; k < V.n; k += 3) { const x = V.a[k], y = V.a[k + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (kind !== K_LAYER && !(x1 > x0 && y1 > y0)) { V.n = vs; return; }
    items.need(ITEM_F);
    items.a.set([kind, vs / 3, (V.n - vs) / 3, paint, Math.floor(x0) - 1, Math.floor(y0) - 1, Math.ceil(x1) + 1, Math.ceil(y1) + 1, blend, layer, 0, 0], items.n); items.n += ITEM_F;
  };
  /** Поддерево запасным слоем: отдельный SVG с нужными defs, матрицей предков и унаследованными атрибутами. */
  const layer = (n, userM, inh, why) => {
    counts.layers++; counts.reasons[why] = (counts.reasons[why] || 0) + 1;
    const json = JSON.stringify(n);
    const ids = new Set([...json.matchAll(/url\(#([^)]+)\)/g)].map((x) => x[1]));
    const wrap = { tag: 'g', attrs: { transform: `matrix(${userM.join(' ')})`, ...inh }, children: [n] };
    const svg = treeToString({ tag: 'svg', attrs: { ...ra }, children: [{ tag: 'defs', attrs: {}, children: [...ids].map((id) => defs.get(id)).filter(Boolean) }, wrap] });
    layers.push(svg);
    item(K_LAYER, V.n, 0, 0, layers.length - 1);
  };

  const walk = (n, userM, inh) => {
    if (!n || typeof n !== 'object' || n.tag === 'defs') return;
    const a = n.attrs || {};
    if (n.tag === 'svg') { for (const c of n.children || []) walk(c, userM, inh); return; }
    if (n.tag === 'stop' || n.tag === 'linearGradient' || n.tag === 'radialGradient') return;
    const t = parseTransform(a.transform);
    if (!t) return layer(n, userM, inh, 'transform');
    const M = mul(userM, t);
    const inh2 = { ...inh };
    for (const k of PRESENT) if (set(a[k])) inh2[k] = a[k];
    let why = null;
    for (const k in a) if (!IGNORE.has(k) && set(a[k])) { why = k; break; }
    let blend = 0;
    if (set(a.style)) {
      const st = String(a.style).trim().replace(/;$/, '');
      if (st === 'mix-blend-mode:lighten' && n.tag !== 'g') blend = 1; else why = why || 'style';
    }
    const op = set(a.opacity) ? +a.opacity : 1;
    if (n.tag === 'g') {
      if (why) return layer(n, userM, inh, why);
      if (op < 1) return layer(n, userM, inh, 'group-opacity');
      for (const c of n.children || []) walk(c, M, inh2);
      return;
    }
    if (n.tag !== 'path' && n.tag !== 'rect') return layer(n, userM, inh, n.tag);
    if (why) return layer(n, userM, inh, why);
    let d = a.d;
    if (n.tag === 'rect') {
      const x = +(a.x || 0), y = +(a.y || 0), w = +a.width, h = +a.height;
      if (set(a.rx) || set(a.ry)) return layer(n, userM, inh, 'rx');
      if (!(w > 0 && h > 0)) return;
      d = `M${x} ${y}L${x + w} ${y}L${x + w} ${y + h}L${x} ${y + h}Z`;
    }
    const fill = inh2.fill ?? '#000', stroke = inh2.stroke ?? 'none';
    const sw = +(inh2['stroke-width'] ?? 1);
    const hasS = set(stroke) && stroke !== 'none' && sw > 0;
    if (op < 1 && hasS && fill !== 'none') return layer(n, userM, inh, 'opacity-fill-stroke');
    const tm = mul(root, M);
    const e = shapeOf(a, d, tm);
    if (!e) return layer(n, userM, inh, 'path');
    const fp = paintOf(fill, op * +(inh2['fill-opacity'] ?? 1), M);
    const sp = hasS ? paintOf(stroke, op * +(inh2['stroke-opacity'] ?? 1), M) : null;
    if (fp === 'unsupported' || sp === 'unsupported') return layer(n, userM, inh, 'paint');
    if (fp != null) {
      const vs = V.n; V.cur = items.n / ITEM_F;
      const { direct, ear, t } = fillOf(e);
      put(V, t, tm[4], tm[5]);
      if (ear) counts.ear++;
      item(direct ? K_DIRECT : inh2['fill-rule'] === 'evenodd' ? K_EVENODD : K_NONZERO, vs, fp, blend);
      counts.fills++; if (direct) counts.direct++;
    }
    if (sp != null) {
      const vs = V.n; V.cur = items.n / ITEM_F;
      put(V, strokeOf(e, (sw / 2) * Math.sqrt(Math.abs(tm[0] * tm[3] - tm[1] * tm[2])), inh2['stroke-linecap'] || 'butt', inh2['stroke-linejoin'] || 'miter'), tm[4], tm[5]);
      // перекрытия треугольников обводки видны только при прозрачности (и не видны при lighten)
      const direct = opaque[sp] || blend === 1;
      item(direct ? K_DIRECT : K_STROKE, vs, sp, blend);
      counts.strokes++; if (direct) counts.direct++;
    }
  };
  walk(tree, I, {});
  return { width: W, height: H, ss, verts: V.done(), items: items.done(), paints: paints.done(), stops: stops.done(), layers, counts };
}
