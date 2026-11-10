/**
 * Экспорт в Lottie (bodymovin JSON) — по кадрам вычисленной сцены. Каждый элемент дерева отображения (группа,
 * фигура) становится группой фигур Lottie с собственной трансформацией; всё, что меняется во времени
 * (трансформация, прозрачность, форма, краски, толщина и штрихи обводки), записывается ключами с линейной
 * интерполяцией, лишние ключи (лежащие на прямой между соседями) отбрасываются. Поэтому переносится всё,
 * что считает движок: пружины, выражения, IK, морфинг, повторы, символы.
 * Не переносятся (предупреждения): текст, растровые слои, маски и обрезка, фильтры (размытие, свечение, тень),
 * режимы наложения, дизеринг (узорная заливка).
 */
import { parseColor } from './color.js';
import { evaluate } from './evaluate.js';
import { parsePath } from './geom.js';
import { defsOf, parseTransform, urlRef } from './ir.js';
import { VERSION } from './model.js';
import { decomposeMatrix } from './svgimport.js';

const LT_DRAW = new Set(['g', 'path', 'rect']);
/** Ключи элементов среди соседей — как у DOMRenderer: узел сцены, id, иначе тег; повторы по порядку. */
function ltKeys(children) {
  const seen = new Map();
  return children.map((c) => {
    const a = c.attrs || {};
    const base = (a['data-node'] != null ? 'n:' + a['data-node'] : a.id != null ? 'i:' + a.id : '') + '|' + c.tag;
    const k = seen.get(base) || 0; seen.set(base, k + 1);
    return base + ':' + k;
  });
}
class LtTrack {
  constructor(tag, name) { this.tag = tag; this.name = name; this.kids = new Map(); this.order = []; this.s = []; }
}
const ltR = (v) => Math.round(v * 1000) / 1000;
const ltR2 = (v) => Math.round(v * 100) / 100;

/** Краска кадра → { kind: 'solid', c: [r,g,b], a } | { kind: 'grad', type, pts, stops } | null. */
function ltPaint(v, alpha, defs, warn) {
  if (v == null || v === 'none') return null;
  const id = urlRef(v);
  if (id) {
    const d = defs.get(id);
    if (!d || (d.tag !== 'linearGradient' && d.tag !== 'radialGradient')) { warn('узорная заливка (дизеринг, паттерн) не переносится'); return null; }
    const a = d.attrs;
    const stops = (d.children || []).filter((s) => s.tag === 'stop').map((s) => {
      const c = parseColor(s.attrs['stop-color']) || [0, 0, 0, 1];
      return { o: +s.attrs.offset || 0, c: c.slice(0, 3), a: c[3] * (s.attrs['stop-opacity'] != null ? +s.attrs['stop-opacity'] : 1) * alpha };
    });
    if (!stops.length) return null;
    if (d.tag === 'linearGradient') return { kind: 'grad', type: 1, pts: [+a.x1 || 0, +a.y1 || 0, +a.x2 || 0, +a.y2 || 0], stops };
    const cx = +a.cx || 0, cy = +a.cy || 0, r = +a.r || 0;
    return { kind: 'grad', type: 2, pts: [cx, cy, cx + r, cy], stops };
  }
  const c = parseColor(String(v));
  if (!c) { warn(`краска «${v}» не разобрана`); return null; }
  return { kind: 'solid', c: c.slice(0, 3), a: c[3] * alpha };
}

/** Геометрия элемента-фигуры кадра (path или rect фона) → подпути движка. */
function ltGeom(el) {
  const a = el.attrs;
  if (el.tag === 'rect') {
    const x = +a.x || 0, y = +a.y || 0, w = +a.width || 0, h = +a.height || 0;
    return parsePath(`M${x} ${y}H${x + w}V${y + h}H${x}Z`);
  }
  return a.d ? parsePath(a.d) : [];
}
/** Подпуть движка → фигура Lottie { i, o, v, c } (касательные — относительно вершин). */
function ltShape(sp) {
  const v = [[sp.x0, sp.y0]], i = [[0, 0]], o = [];
  sp.segs.forEach((c, k) => {
    const [px, py] = v[v.length - 1];
    o.push([c[0] - px, c[1] - py]);
    const last = k === sp.segs.length - 1;
    if (last && sp.closed && Math.hypot(c[4] - sp.x0, c[5] - sp.y0) < 1e-6) { i[0] = [c[2] - sp.x0, c[3] - sp.y0]; return; }
    v.push([c[4], c[5]]); i.push([c[2] - c[4], c[3] - c[5]]);
  });
  while (o.length < v.length) o.push([0, 0]);
  const rr = (p) => [ltR2(p[0]), ltR2(p[1])];
  return { i: i.map(rr), o: o.map(rr), v: v.map(rr), c: !!sp.closed };
}

function ltWalk(el, tr, f, defs, warn) {
  const a = el.attrs || {};
  if (a['clip-path'] || a.mask) warn('маски и обрезка не переносятся (элемент виден целиком)');
  if (a.filter) warn('фильтры (размытие, свечение, тень, рельеф) не переносятся');
  if (a.style && /mix-blend-mode/.test(a.style)) warn('режимы наложения не переносятся');
  const smp = { m: parseTransform(a.transform), o: a.opacity != null ? +a.opacity : 1 };
  if (el.tag === 'g') {
    tr.s[f] = smp;
    const kids = (el.children || []).filter((c) => {
      if (LT_DRAW.has(c.tag)) return true;
      if (c.tag === 'text') warn('текст не переносится (переведите в кривые или добавьте текстовый слой в редакторе Lottie)');
      else if (c.tag === 'image' || c.tag === 'svg') warn('растровые слои не переносятся');
      return false;
    });
    const keys = ltKeys(kids);
    let prev = null;
    kids.forEach((c, i) => {
      const k = keys[i];
      let t = tr.kids.get(k);
      if (!t) {
        t = new LtTrack(c.tag, c.attrs?.['data-node'] || c.attrs?.id || c.tag);
        tr.kids.set(k, t);
        tr.order.splice(prev ? tr.order.indexOf(prev) + 1 : 0, 0, k);
      }
      ltWalk(c, t, f, defs, warn);
      prev = k;
    });
    return;
  }
  // фигура
  const fo = a['fill-opacity'] != null ? +a['fill-opacity'] : 1, so = a['stroke-opacity'] != null ? +a['stroke-opacity'] : 1;
  smp.geom = ltGeom(el);
  smp.fill = ltPaint(a.fill ?? '#000000', fo, defs, warn);
  smp.stroke = ltPaint(a.stroke, so, defs, warn);
  smp.sw = a['stroke-width'] != null ? +a['stroke-width'] : 1;
  smp.cap = a['stroke-linecap'] || 'butt'; smp.join = a['stroke-linejoin'] || 'miter';
  smp.evenodd = a['fill-rule'] === 'evenodd';
  smp.strokeFirst = a['paint-order'] === 'stroke';
  if (a['stroke-dasharray'] && smp.stroke) {
    let d = String(a['stroke-dasharray']).split(/[\s,]+/).filter(Boolean).map(Number);
    const off = +a['stroke-dashoffset'] || 0;
    const tm = off === 0 ? ltTrimOf(d) : null;
    if (tm) smp.trim = tm;
    else if (d.reduce((x, y) => x + Math.abs(y), 0) > 1e-6) { if (d.length % 2) d = [...d, ...d]; smp.dash = d; smp.dashOff = off; }
  }
  tr.s[f] = smp;
}

/**
 * Обрезка обводки движка (trimDash): «0 A S 2L» (без перехода через начало) или «P Q R L» (с переходом) →
 * { span, a } — длина и начало видимой части в долях пути. Иначе null (это обычные штрихи).
 */
function ltTrimOf(d) {
  if (d.length !== 4 || d.some((x) => !(x >= 0))) return null;
  const [p, q, r, v4] = d, eps = 1e-2 + v4 * 1e-6;
  if (p === 0) { const L = v4 / 2; if (L > 0 && q + r <= L + eps) return { a: q / L, span: r / L }; return null; }
  const L = v4;
  if (L > 0 && Math.abs(p + q + r - L) <= eps) { const a = 1 - r / L; return { a, span: p / L + 1 - a }; }
  return null;
}

/** Значения по кадрам → свойство Lottie (статичное или с ключами). vals[f] — массив чисел. hold[f] — скачок после кадра f. */
function ltAnim(vals, hold, { eps = 1e-3, scalar = false } = {}) {
  const n = vals.length;
  const same = (x, y) => x.length === y.length && x.every((q, i) => Math.abs(q - y[i]) <= eps);
  const out = (v) => (scalar ? ltR(v[0]) : v.map(ltR));
  if (vals.every((v) => same(v, vals[0]))) return { a: 0, k: out(vals[0]) };
  const keep = [0];
  for (let f = 1; f < n - 1; f++) {
    const p = keep[keep.length - 1];
    if (hold[f] || hold[f - 1] || vals[f].length !== vals[f + 1].length || vals[p].length !== vals[f + 1].length) { keep.push(f); continue; }
    // можно ли дотянуть прямую от p до f+1 через все кадры между ними
    let ok = true;
    for (let g = p + 1; g <= f && ok; g++) {
      const u = (g - p) / (f + 1 - p);
      for (let i = 0; i < vals[g].length; i++) if (Math.abs(vals[p][i] + (vals[f + 1][i] - vals[p][i]) * u - vals[g][i]) > eps) { ok = false; break; }
    }
    if (!ok) keep.push(f);
  }
  if (n > 1) keep.push(n - 1);
  const dims = vals[0].length;
  return {
    a: 1,
    k: keep.map((f, j) => {
      const kf = { t: f, s: vals[f].map(ltR) };
      if (j < keep.length - 1) {
        if (hold[f] || vals[f].length !== vals[keep[j + 1]].length) kf.h = 1;
        else { kf.o = { x: Array(dims).fill(0), y: Array(dims).fill(0) }; kf.i = { x: Array(dims).fill(1), y: Array(dims).fill(1) }; }
      }
      return kf;
    }),
  };
}
/**
 * Фигура по кадрам: ключи только там, где форма уходит от прямой между соседними ключами больше чем на tol
 * (единиц сцены); смена числа вершин или замкнутости — ключ со скачком.
 */
function ltShapeAnim(shapes, hold, tol = 0.25) {
  const n = shapes.length;
  const sig = shapes.map((s) => JSON.stringify(s));
  if (sig.every((s) => s === sig[0])) return { a: 0, k: shapes[0] };
  const flat = shapes.map((s) => [...s.v.flat(), ...s.i.flat(), ...s.o.flat()]);
  const compat = (a, b) => shapes[a].v.length === shapes[b].v.length && shapes[a].c === shapes[b].c;
  const keep = [0];
  for (let f = 1; f < n - 1; f++) {
    const p = keep[keep.length - 1];
    if (hold[f] || hold[f - 1] || !compat(p, f + 1) || !compat(f, f + 1)) { keep.push(f); continue; }
    let ok = true;
    for (let g = p + 1; g <= f && ok; g++) {
      const u = (g - p) / (f + 1 - p), A = flat[p], B = flat[f + 1], G = flat[g];
      for (let i = 0; i < G.length; i++) if (Math.abs(A[i] + (B[i] - A[i]) * u - G[i]) > tol) { ok = false; break; }
    }
    if (!ok) keep.push(f);
  }
  if (n > 1) keep.push(n - 1);
  return {
    a: 1,
    k: keep.map((f, j) => {
      const kf = { t: f, s: [shapes[f]] };
      if (j < keep.length - 1) {
        const nx = shapes[keep[j + 1]];
        if (hold[f] || nx.v.length !== shapes[f].v.length || nx.c !== shapes[f].c) kf.h = 1;
        else { kf.o = { x: 0, y: 0 }; kf.i = { x: 1, y: 1 }; }
      }
      return kf;
    }),
  };
}

/** Заполнить пропуски (кадры, где элемента нет) ближайшим значением: сначала вперёд, потом назад. */
function ltFill(arr, n) {
  const out = new Array(n);
  let last;
  for (let f = 0; f < n; f++) { if (arr[f] !== undefined) last = arr[f]; out[f] = last; }
  let next;
  for (let f = n - 1; f >= 0; f--) { if (arr[f] !== undefined) next = arr[f]; if (out[f] === undefined) out[f] = next; }
  return out;
}

const LT_CAP = { butt: 1, round: 2, square: 3 }, LT_JOIN = { miter: 1, round: 2, bevel: 3 };

/** Трансформация группы по кадрам (матрица → p, r, s, sk; поворот без скачков через 360°). */
function ltTransform(s, present, n) {
  const filled = ltFill(s, n);
  const p = [], r = [], sc = [], sk = [], o = [];
  let prevR = null;
  for (let f = 0; f < n; f++) {
    const d = decomposeMatrix(filled[f].m);
    let rot = d.rotation;
    if (prevR != null) while (rot - prevR > 180) rot -= 360;
    if (prevR != null) while (rot - prevR < -180) rot += 360;
    prevR = rot;
    p.push([d.x, d.y]); r.push([rot]); sc.push([d.scaleX * 100, d.scaleY * 100]); sk.push([-d.skewX]);
    o.push([present[f] ? filled[f].o * 100 : 0]);
  }
  const hold = present.map((x, f) => f < n - 1 && present[f + 1] !== x);
  const none = new Array(n).fill(false);
  return { ty: 'tr', p: ltAnim(p, none), a: { a: 0, k: [0, 0] }, s: ltAnim(sc, none), r: ltAnim(r, none, { scalar: true }), o: ltAnim(o, hold, { scalar: true }), sk: ltAnim(sk, none, { scalar: true }), sa: { a: 0, k: 0 }, nm: 'Transform' };
}

/** Заливка или обводка (сплошная или градиентная) по кадрам. */
function ltPaintItem(paints, n, isStroke, smp, warn, name) {
  const present = paints.map((x) => !!x);
  if (!present.some(Boolean)) return null;
  const first = paints.find(Boolean);
  const filled = ltFill(paints.map((x) => (x && x.kind === first.kind && (x.kind === 'solid' || (x.type === first.type && x.stops.length === first.stops.length)) ? x : undefined)), n);
  if (paints.some((x) => x && filled.indexOf(x) < 0)) warn(`${name}: тип краски меняется во времени — взят первый`);
  const hold = present.map((x, f) => f < n - 1 && present[f + 1] !== x);
  const none = new Array(n).fill(false);
  const op = ltAnim(filled.map((x, f) => [present[f] ? (x.kind === 'solid' ? x.a : 1) * 100 : 0]), hold, { scalar: true });
  let item;
  if (first.kind === 'solid') item = { ty: isStroke ? 'st' : 'fl', c: ltAnim(filled.map((x) => [...x.c, 1]), none), o: op };
  else {
    // градиент: [смещение, r, g, b]… и, если есть прозрачность, [смещение, a]…
    const withA = filled.some((x) => x.stops.some((s) => s.a < 0.999));
    const g = filled.map((x) => [...x.stops.flatMap((s) => [s.o, ...s.c]), ...(withA ? x.stops.flatMap((s) => [s.o, s.a]) : [])]);
    item = { ty: isStroke ? 'gs' : 'gf', o: op, t: first.type, s: ltAnim(filled.map((x) => x.pts.slice(0, 2)), none), e: ltAnim(filled.map((x) => x.pts.slice(2, 4)), none), g: { p: first.stops.length, k: ltAnim(g, none) } };
    if (first.type === 2) { item.h = { a: 0, k: 0 }; item.a = { a: 0, k: 0 }; }
  }
  if (isStroke) {
    const s0 = smp.find(Boolean);
    Object.assign(item, { w: ltAnim(ltFill(smp.map((x) => (x ? [x.sw] : undefined)), n), none, { scalar: true }), lc: LT_CAP[s0.cap] || 1, lj: LT_JOIN[s0.join] || 1, ml: 4 });
    const dashes = smp.map((x) => x?.dash);
    if (dashes.some(Boolean)) {
      // штрихи есть не на всех кадрах или их число меняется — Lottie так не умеет: берутся первые
      const len = dashes.find(Boolean).length;
      if (smp.some((x) => x && (!x.dash || x.dash.length !== len))) warn(`${name}: штрихи меняются во времени (появляются, исчезают, другое число) — взяты первые`);
      const pad = ltFill(dashes.map((d) => (d && d.length === len ? d : undefined)), n);
      const offs = ltFill(smp.map((x) => (x?.dash ? [x.dashOff || 0] : undefined)), n);
      item.d = [...pad[0].map((_, i) => ({ n: i % 2 ? 'g' : 'd', nm: i % 2 ? 'gap' : 'dash', v: ltAnim(pad.map((d) => [d[i]]), none, { scalar: true }) })), { n: 'o', nm: 'offset', v: ltAnim(offs, none, { scalar: true }) }];
    }
  } else item.r = smp.find(Boolean).evenodd ? 2 : 1;
  item.nm = isStroke ? 'Stroke' : 'Fill';
  return item;
}

/** Trim Paths по кадрам из распознанной обрезки: s = 0, e = длина видимой части, o = её начало (градусы, без скачков). */
function ltTrimItem(smp, n) {
  if (!smp.some((x) => x?.trim)) return null;
  const filled = ltFill(smp, n);
  const e = [], o = [], hold = [];
  let prev = null;
  for (let f = 0; f < n; f++) {
    const t = filled[f].trim;
    let deg = t ? t.a * 360 : prev ?? 0;
    if (prev != null) { while (deg - prev > 180) deg -= 360; while (deg - prev < -180) deg += 360; }
    prev = deg;
    e.push([t ? t.span * 100 : 100]); o.push([deg]);
    hold.push(f < n - 1 && !!filled[f].trim !== !!filled[f + 1].trim);
  }
  return { ty: 'tm', s: { a: 0, k: 0 }, e: ltAnim(e, hold, { scalar: true }), o: ltAnim(o, hold, { scalar: true }), m: 1, nm: 'Trim' };
}

function ltEmit(tr, n, warn, tol) {
  // плотный массив: на кадрах, где элемента нет, — undefined (у разреженного map/spread пропускают дыры)
  const S = Array.from({ length: n }, (_, f) => tr.s[f]);
  const present = S.map((x) => x !== undefined);
  const it = [];
  if (tr.tag === 'g') {
    for (const k of [...tr.order].reverse()) { const c = ltEmit(tr.kids.get(k), n, warn, tol); if (c) it.push(c); }
    if (!it.length) return null;
  } else {
    // подпути: по номеру; на кадрах, где подпути нет, — вырожденная точка
    const subs = Math.max(...S.map((x) => (x ? x.geom.length : 0)));
    if (!subs) return null;
    const hold = present.map((x, f) => f < n - 1 && present[f + 1] !== x);
    const filledS = ltFill(S, n);
    for (let j = 0; j < subs; j++) {
      const shapes = filledS.map((x) => (x.geom[j] ? ltShape(x.geom[j]) : { i: [[0, 0]], o: [[0, 0]], v: [[0, 0]], c: false }));
      it.push({ ty: 'sh', nm: 'Path ' + (j + 1), ks: ltShapeAnim(shapes, hold, tol) });
    }
    const st = ltPaintItem(S.map((x, f) => (present[f] ? x.stroke : null)), n, true, S, warn, tr.name);
    const fl = ltPaintItem(S.map((x, f) => (present[f] ? x.fill : null)), n, false, S, warn, tr.name);
    if (!st && !fl) return null;
    // в Lottie верхний в списке рисуется поверх: обводка над заливкой (или наоборот при paint-order: stroke)
    const strokeFirst = S.find(Boolean)?.strokeFirst;
    const tm = st && ltTrimItem(S, n);
    if (tm) {
      // обрезка (Trim Paths) — только для обводки: обводка и заливка — в отдельных группах с теми же путями
      const paths = it.splice(0);
      const idT = { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 }, nm: 'Transform' };
      const sg = { ty: 'gr', nm: 'stroke', it: [...paths, tm, st, idT], np: paths.length + 2, cix: 2, ix: 1 };
      const fg = fl && { ty: 'gr', nm: 'fill', it: [...JSON.parse(JSON.stringify(paths)), fl, idT], np: paths.length + 1, cix: 2, ix: 2 };
      for (const x of strokeFirst ? [fg, sg] : [sg, fg]) if (x) it.push(x);
    } else for (const x of strokeFirst ? [fl, st] : [st, fl]) if (x) it.push(x);
  }
  it.push(ltTransform(S, present, n));
  return { ty: 'gr', nm: tr.name, it, np: it.length - 1, cix: 2, ix: 1 };
}

/**
 * Сцена → Lottie JSON (объект). opts: { fps (по умолчанию fps сцены, не больше 60), states, name,
 *   tolerance — допуск формы между ключами, единиц сцены (0.25; 0 — ключ на каждом кадре) }.
 * Возвращает { lottie, warnings, frames }.
 */
export function exportLottie(scene, opts = {}) {
  const fps = opts.fps ?? Math.min(scene.fps || 30, 60);
  const frames = Math.max(1, Math.round(scene.duration * fps));
  const n = frames + 1;
  const warnings = new Set();
  const warn = (m) => warnings.add(m);
  const root = new LtTrack('g', 'root');
  for (let f = 0; f < n; f++) {
    const tree = evaluate(scene, Math.min(f / fps, scene.duration), { states: opts.states });
    const defs = defsOf(tree);
    const body = { tag: 'g', attrs: {}, children: tree.children.filter((c) => c.tag !== 'defs') };
    ltWalk(body, root, f, defs, warn);
  }
  const top = ltEmit(root, n, warn, opts.tolerance ?? 0.25);
  const layer = (nm, shapes, ind) => ({
    ddd: 0, ind, ty: 4, nm, sr: 1, ao: 0, ip: 0, op: frames, st: 0, bm: 0,
    ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
    shapes,
  });
  const lottie = {
    v: '5.7.4', fr: fps, ip: 0, op: frames, w: scene.width, h: scene.height, nm: opts.name || scene.name || 'Kontur', ddd: 0,
    meta: { g: `Kontur ${VERSION}` },
    assets: [],
    layers: top ? [layer('Kontur', [top], 1)] : [],
    markers: (scene.markers || []).map((m) => ({ tm: ltR(m.t * fps), cm: m.name, dr: 0 })),
  };
  return { lottie, warnings: [...warnings], frames };
}
