/**
 * Импорт SVG → узлы Kontur. Без DOM: свой разбор XML, простые CSS-правила из <style> (тег, .класс, #id),
 * наследование оформления, трансформации (раскладываются в x/y/rotation/scaleX/scaleY/skewX), <use>,
 * градиенты (линейный и радиальный, в т.ч. objectBoundingBox). Не переносятся: clip-path, mask, filter,
 * pattern, marker, анимация SMIL — о них говорят предупреждения.
 */
import { NAMED } from './color.js';
import { mat, r3, r4 } from './math.js';
import { parsePath } from './geom.js';
import { IDENTITY, matMul, parseTransform } from './ir.js';
import { index, invalidate as invalidateAll } from './model.js';

/* ---------- XML ---------- */
const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const xmlUnescape = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : XML_ENT[e] ?? m));

/** Разбор XML в дерево { tag, attrs, children, text }. Комментарии, инструкции и DOCTYPE пропускаются. */
export function parseXML(src) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const textEnd = lt < 0 ? src.length : lt;
    if (textEnd > i) { const t = src.slice(i, textEnd); if (t.trim()) top().children.push({ tag: '#text', text: xmlUnescape(t) }); }
    if (lt < 0) break;
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? src.length : e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt + 9); top().children.push({ tag: '#text', text: src.slice(lt + 9, e < 0 ? src.length : e) }); i = e < 0 ? src.length : e + 3; continue; }
    if (src[lt + 1] === '?') { const e = src.indexOf('?>', lt + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (src[lt + 1] === '!') {
      // <!DOCTYPE …> с возможным внутренним подмножеством […]
      let j = lt + 2, depth = 0;
      while (j < src.length && !(src[j] === '>' && depth === 0)) { if (src[j] === '[') depth++; else if (src[j] === ']') depth--; j++; }
      i = j + 1; continue;
    }
    if (src[lt + 1] === '/') {
      const e = src.indexOf('>', lt);
      const name = src.slice(lt + 2, e).trim();
      // закрываем до совпадающего тега (терпимо к ошибкам вложенности)
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === name) { stack.length = k; break; }
      i = e + 1; continue;
    }
    // открывающий тег
    const m = /^<([\w:.-]+)/.exec(src.slice(lt, lt + 200));
    if (!m) { top().children.push({ tag: '#text', text: '<' }); i = lt + 1; continue; }
    const el = { tag: m[1], attrs: {}, children: [] };
    let j = lt + m[0].length;
    const attrRe = /\s*([\w:.-]+)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s>]+))?/y;
    for (;;) {
      while (/\s/.test(src[j])) j++;
      if (src[j] === '>' || src[j] === '/' || j >= src.length) break;
      attrRe.lastIndex = j;
      const a = attrRe.exec(src);
      if (!a || !a[0]) { j++; continue; }
      let v = a[2] ?? '';
      if (v[0] === '"' || v[0] === "'") v = v.slice(1, -1);
      el.attrs[a[1]] = xmlUnescape(v);
      j = attrRe.lastIndex;
    }
    const selfClose = src[j] === '/';
    const gt = src.indexOf('>', j);
    i = gt < 0 ? src.length : gt + 1;
    top().children.push(el);
    if (!selfClose) stack.push(el);
  }
  return root;
}

/* ---------- CSS ---------- */
const siDecls = (s) => {
  const out = {};
  for (const part of String(s || '').split(';')) {
    const k = part.indexOf(':');
    if (k < 0) continue;
    const name = part.slice(0, k).trim().toLowerCase(), val = part.slice(k + 1).replace(/!important/i, '').trim();
    if (name) out[name] = val;
  }
  return out;
};
/** Правила из <style>: [{ sel: {tag?, cls?, id?}, spec, decl }] — только простые селекторы (с группами через запятую). */
function siRules(css) {
  const rules = [];
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const decl = siDecls(m[2]);
    for (const raw of m[1].split(',')) {
      const s = raw.trim();
      const p = /^([a-zA-Z][\w-]*)?(?:#([\w-]+))?((?:\.[\w-]+)*)$/.exec(s);
      if (!p || (!p[1] && !p[2] && !p[3])) continue;
      const cls = p[3] ? p[3].split('.').filter(Boolean) : [];
      rules.push({ tag: p[1] || null, id: p[2] || null, cls, spec: (p[2] ? 100 : 0) + cls.length * 10 + (p[1] ? 1 : 0), decl });
    }
  }
  return rules.map((r, i) => ({ ...r, order: i })).sort((a, b) => a.spec - b.spec || a.order - b.order);
}

/* ---------- оформление ---------- */
const INHERITED = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'stroke-dasharray',
  'font-size', 'font-family', 'font-weight', 'text-anchor', 'letter-spacing', 'visibility', 'color'];
const OWN = ['opacity', 'display', 'transform', 'clip-path', 'mask', 'filter', 'mix-blend-mode'];
const ROOT_STYLE = { fill: '#000000', stroke: 'none', 'stroke-width': '1', 'fill-opacity': '1', 'stroke-opacity': '1', 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'font-size': '16', 'text-anchor': 'start', color: '#000000' };

/** Числа из строки (списки координат, viewBox). */
const siNums = (s) => (String(s ?? '').match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) || []).map(Number);
/** Длина: число, px, % (от опорной длины), em (от 16). */
const siLen = (v, ref = 100, def = 0) => {
  if (v == null || v === '') return def;
  const s = String(v).trim();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return def;
  if (s.endsWith('%')) return (n / 100) * ref;
  if (s.endsWith('em')) return n * 16;
  if (s.endsWith('pt')) return n * 4 / 3;
  if (s.endsWith('mm')) return n * 96 / 25.4;
  if (s.endsWith('cm')) return n * 96 / 2.54;
  if (s.endsWith('in')) return n * 96;
  return n;
};

/** Цвет SVG → строка движка (hex или rgba), с прозрачностью alpha. null — нет краски. */
function siColor(v, alpha, style) {
  if (v == null) return null;
  let s = String(v).trim().toLowerCase();
  if (s === 'none' || s === 'transparent') return null;
  if (s === 'currentcolor') s = String(style.color || '#000000').toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  else if (SVG_NAMED[s]) s = SVG_NAMED[s];
  if (alpha >= 0.999) return s;
  let r, g, b, a = 1;
  const h = /^#([0-9a-f]{3,8})$/.exec(s);
  if (h) {
    let x = h[1];
    if (x.length <= 4) x = [...x].map((c) => c + c).join('');
    r = parseInt(x.slice(0, 2), 16); g = parseInt(x.slice(2, 4), 16); b = parseInt(x.slice(4, 6), 16);
    if (x.length === 8) a = parseInt(x.slice(6, 8), 16) / 255;
  } else {
    const m = /^rgba?\(([^)]+)\)$/.exec(s);
    if (!m) return s;
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    const ch = (q) => (q.endsWith('%') ? (parseFloat(q) * 255) / 100 : parseFloat(q));
    [r, g, b] = [ch(p[0]), ch(p[1]), ch(p[2])];
    if (p[3] != null) a = p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
  }
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${r4(a * alpha)})`;
}
/** Цвета SVG, которых нет в таблице движка (частые в экспорте редакторов). */
const SVG_NAMED = {
  silver: '#c0c0c0', maroon: '#800000', olive: '#808000', aqua: '#00ffff', fuchsia: '#ff00ff', darkgray: '#a9a9a9', darkgrey: '#a9a9a9',
  lightgray: '#d3d3d3', lightgrey: '#d3d3d3', dimgray: '#696969', whitesmoke: '#f5f5f5', gainsboro: '#dcdcdc', darkred: '#8b0000',
  darkgreen: '#006400', darkblue: '#00008b', steelblue: '#4682b4', royalblue: '#4169e1', dodgerblue: '#1e90ff', deepskyblue: '#00bfff',
  lightblue: '#add8e6', forestgreen: '#228b22', seagreen: '#2e8b57', limegreen: '#32cd32', khaki: '#f0e68c', beige: '#f5f5dc',
  chocolate: '#d2691e', sienna: '#a0522d', brown: '#a52a2a', tan: '#d2b48c', firebrick: '#b22222', darkorange: '#ff8c00',
  orangered: '#ff4500', slategray: '#708090', slategrey: '#708090', ivory: '#fffff0', lavender: '#e6e6fa', plum: '#dda0dd',
  wheat: '#f5deb3', linen: '#faf0e6', mintcream: '#f5fffa', midnightblue: '#191970', darkslategray: '#2f4f4f', darkviolet: '#9400d3',
};

/**
 * Разложить матрицу [a b c d e f] в трансформацию движка: translate · rotate · skewX · scale.
 * Точно для любой невырожденной матрицы (отражение — отрицательный scaleY).
 */
export const decomposeMatrix = mat.decompose;
function siTransformProps(m) {
  const t = decomposeMatrix(m), out = {};
  if (Math.abs(t.x) > 1e-6) out.x = r4(t.x);
  if (Math.abs(t.y) > 1e-6) out.y = r4(t.y);
  if (Math.abs(t.rotation) > 1e-6) out.rotation = r4(t.rotation);
  if (Math.abs(t.skewX) > 1e-6) out.skewX = r4(t.skewX);
  if (Math.abs(t.scaleX - 1) > 1e-6) out.scaleX = r4(t.scaleX);
  if (Math.abs(t.scaleY - 1) > 1e-6) out.scaleY = r4(t.scaleY);
  return out;
}
/** Рамка геометрии по опорным точкам: [x, y, w, h]. */
function siBox(geom) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sp of geom) for (const [x, y] of [[sp.x0, sp.y0], ...sp.segs.flatMap((c) => [[c[0], c[1]], [c[2], c[3]], [c[4], c[5]]])]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return Number.isFinite(x0) ? [x0, y0, (x1 - x0) || 1, (y1 - y0) || 1] : [0, 0, 1, 1];
}
const siApply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * Разобрать SVG → { width, height, viewBox, nodes, warnings }. Узлы — плоский список с parent, корень — группа
 * opts.id ('svg'). opts.prefix — приставка к id без собственного id.
 */
export function importSVG(src, opts = {}) {
  const doc = parseXML(String(src));
  const svg = doc.children.find((c) => c.tag === 'svg' || c.tag.endsWith(':svg'));
  if (!svg) throw new Error('Это не SVG: нет корневого <svg>');
  const warnings = new Set();
  const byId = new Map();
  const rules = [];
  (function scan(el) {
    if (el.attrs?.id) byId.set(el.attrs.id, el);
    if (el.tag === 'style') rules.push(...siRules(el.children.map((c) => c.text || '').join('')));
    for (const c of el.children || []) if (c.tag !== '#text') scan(c);
  })(svg);
  rules.sort((a, b) => a.spec - b.spec || a.order - b.order);

  const vb = siNums(svg.attrs.viewBox);
  const W = siLen(svg.attrs.width, 100, vb.length === 4 ? vb[2] : 300), H = siLen(svg.attrs.height, 100, vb.length === 4 ? vb[3] : 150);
  const viewBox = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb : [0, 0, W, H];
  const width = r3(viewBox[2]), height = r3(viewBox[3]);

  const nodes = [];
  const taken = new Set(opts.taken || []);
  const prefix = opts.prefix ?? '';
  const counters = new Map();
  const newId = (want, kind) => {
    let base = want ? String(want).replace(/[^\w-]/g, '_') : null;
    if (base && !/^[A-Za-z_]/.test(base)) base = '_' + base;
    if (!base) { const k = (counters.get(kind) || 0) + 1; counters.set(kind, k); base = `${prefix}${kind}${k}`; }
    let id = base, i = 2;
    while (taken.has(id)) id = `${base}_${i++}`;
    taken.add(id);
    return id;
  };
  const rootId = newId(opts.id || 'svg', 'g');
  const rootProps = {};
  if (viewBox[0] || viewBox[1]) { rootProps.x = -viewBox[0]; rootProps.y = -viewBox[1]; }
  nodes.push({ id: rootId, type: 'group', parent: opts.parent ?? null, props: { name: opts.name || 'SVG', ...rootProps } });

  const styleOf = (el, parent) => {
    const own = {};
    for (const k of [...INHERITED, ...OWN]) if (el.attrs[k] != null) own[k] = el.attrs[k];
    const cls = String(el.attrs.class || '').split(/\s+/).filter(Boolean);
    for (const r of rules) {
      if (r.tag && r.tag !== el.tag) continue;
      if (r.id && r.id !== el.attrs.id) continue;
      if (r.cls.some((c) => !cls.includes(c))) continue;
      Object.assign(own, r.decl);
    }
    Object.assign(own, siDecls(el.attrs.style));
    const st = {};
    for (const k of INHERITED) { const v = own[k]; st[k] = v == null || v === 'inherit' ? parent[k] : v; }
    for (const k of OWN) st[k] = own[k] ?? null;
    if (own.transform == null) st.transform = el.attrs.transform ?? null;
    return st;
  };

  /** Краска: цвет или градиент (в координатах фигуры, box — её рамка для objectBoundingBox). */
  const paint = (v, alpha, st, box) => {
    if (v == null) return null;
    const m = /^url\(\s*['"]?#([^)'"]+)['"]?\s*\)/.exec(String(v).trim());
    if (!m) return siColor(v, alpha, st);
    const g = gradientOf(m[1], alpha, box);
    if (!g) { warnings.add(`краска url(#${m[1]}) не перенесена (не градиент или не найдена)`); const fb = /\)\s*(.+)$/.exec(String(v)); return fb ? siColor(fb[1], alpha, st) : null; }
    return g;
  };
  const gradAttr = (el, k, seen = new Set()) => {
    if (el.attrs[k] != null) return el.attrs[k];
    const href = el.attrs.href || el.attrs['xlink:href'];
    const ref = href && href[0] === '#' && byId.get(href.slice(1));
    if (ref && !seen.has(ref)) { seen.add(ref); return gradAttr(ref, k, seen); }
    return null;
  };
  const gradStops = (el, seen = new Set()) => {
    const own = el.children.filter((c) => c.tag === 'stop');
    if (own.length) return own;
    const href = el.attrs.href || el.attrs['xlink:href'];
    const ref = href && href[0] === '#' && byId.get(href.slice(1));
    if (ref && !seen.has(ref)) { seen.add(ref); return gradStops(ref, seen); }
    return [];
  };
  function gradientOf(id, alpha, box) {
    const el = byId.get(id);
    if (!el || (el.tag !== 'linearGradient' && el.tag !== 'radialGradient')) return null;
    const stops = gradStops(el).map((s) => {
      const d = { ...siDecls(s.attrs.style) };
      const off = String(s.attrs.offset ?? '0');
      const color = siColor(d['stop-color'] ?? s.attrs['stop-color'] ?? '#000000', 1, ROOT_STYLE) || '#000000';
      const op = parseFloat(d['stop-opacity'] ?? s.attrs['stop-opacity'] ?? '1');
      const stop = { offset: r4(Math.min(1, Math.max(0, off.endsWith('%') ? parseFloat(off) / 100 : parseFloat(off) || 0))), color };
      const o = (Number.isFinite(op) ? op : 1) * alpha;
      if (o < 0.999) stop.opacity = r4(o);
      return stop;
    });
    if (!stops.length) return null;
    const bbox = gradAttr(el, 'gradientUnits') !== 'userSpaceOnUse';
    const [bx, by, bw, bh] = box || [0, 0, 1, 1];
    const gt = parseTransform(gradAttr(el, 'gradientTransform'));
    // в рамке фигуры: [0..1] → её координаты; затем gradientTransform (до перевода в рамку — так в SVG)
    const toLocal = (x, y) => { const [px, py] = siApply(gt, x, y); return bbox ? [bx + px * bw, by + py * bh] : [px, py]; };
    const scaleR = Math.sqrt(Math.abs(gt[0] * gt[3] - gt[1] * gt[2])) * (bbox ? Math.sqrt(Math.abs(bw * bh)) : 1);
    if (Math.abs(gt[1]) > 1e-9 || Math.abs(gt[2]) > 1e-9 || (bbox && Math.abs(bw - bh) > 1e-6 && el.tag === 'radialGradient')) warnings.add(`градиент ${id}: поворот или неравные оси переданы приближённо`);
    const L = (k, d) => { const v = gradAttr(el, k); if (v == null) return d; const s = String(v); return s.endsWith('%') ? parseFloat(s) / 100 : bbox ? parseFloat(s) : siLen(s, 100, d); };
    if (el.tag === 'linearGradient') {
      const [x1, y1] = toLocal(L('x1', 0), L('y1', 0)), [x2, y2] = toLocal(L('x2', 1), L('y2', 0));
      return { type: 'linear', x1: r4(x1), y1: r4(y1), x2: r4(x2), y2: r4(y2), stops };
    }
    const cx = L('cx', 0.5), cy = L('cy', 0.5), r = L('r', 0.5);
    const [lx, ly] = toLocal(cx, cy), [fx, fy] = toLocal(L('fx', cx), L('fy', cy));
    const g = { type: 'radial', cx: r4(lx), cy: r4(ly), r: r4(r * scaleR), stops };
    if (Math.abs(fx - lx) > 1e-6 || Math.abs(fy - ly) > 1e-6) { g.fx = r4(fx); g.fy = r4(fy); }
    return g;
  }

  /** Общие свойства фигуры: краски, обводка, прозрачность. box — рамка геометрии (для градиентов). */
  const drawProps = (st, box) => {
    const p = {};
    const fo = parseFloat(st['fill-opacity']), so = parseFloat(st['stroke-opacity']);
    const fill = paint(st.fill, Number.isFinite(fo) ? fo : 1, st, box);
    const stroke = paint(st.stroke, Number.isFinite(so) ? so : 1, st, box);
    p.fill = fill ?? 'none';
    if (stroke) {
      p.stroke = stroke;
      p.strokeWidth = r4(siLen(st['stroke-width'], 100, 1));
      p.lineCap = st['stroke-linecap'] || 'butt';
      p.lineJoin = st['stroke-linejoin'] === 'miter-clip' || st['stroke-linejoin'] === 'arcs' ? 'miter' : st['stroke-linejoin'] || 'miter';
      const dash = st['stroke-dasharray'];
      if (dash && dash !== 'none') { const d = siNums(dash); if (d.length) p.dash = d; }
    }
    if (st['fill-rule'] === 'evenodd') p.fillRule = 'evenodd';
    return p;
  };
  const ownProps = (st, el) => {
    const p = {};
    const op = parseFloat(st.opacity);
    if (Number.isFinite(op) && op < 1) p.opacity = r4(Math.max(0, op));
    if (st['mix-blend-mode'] && st['mix-blend-mode'] !== 'normal') p.blend = st['mix-blend-mode'];
    for (const k of ['clip-path', 'mask', 'filter']) if (st[k] && st[k] !== 'none') warnings.add(`${k} не переносится (${el.tag}${el.attrs.id ? '#' + el.attrs.id : ''})`);
    if (el.attrs.id && opts.keepNames !== false) p.name = el.attrs.id;
    return p;
  };

  const add = (type, want, parent, props) => { const id = newId(want, type === 'group' ? 'g' : type); nodes.push({ id, type, parent, props }); return id; };

  function walk(el, parent, inherited, extra = IDENTITY, depth = 0) {
    if (depth > 64) { warnings.add('слишком глубокая вложенность (<use>?) — обрезано'); return; }
    const st = styleOf(el, inherited);
    if (st.display === 'none') return;
    const hidden = st.visibility === 'hidden' || st.visibility === 'collapse';
    const m = matMul(extra, parseTransform(st.transform));
    const tag = el.tag.replace(/^svg:/, '');
    switch (tag) {
      case 'g': case 'a': case 'switch': {
        const id = add('group', el.attrs.id, parent, { ...siTransformProps(m), ...ownProps(st, el) });
        for (const c of el.children) if (c.tag !== '#text') walk(c, id, st, IDENTITY, depth + 1);
        return;
      }
      case 'svg': {
        // вложенный <svg>: сдвиг x/y и масштаб viewBox
        const x = siLen(el.attrs.x), y = siLen(el.attrs.y);
        const v = siNums(el.attrs.viewBox);
        let mm = matMul(m, [1, 0, 0, 1, x, y]);
        if (v.length === 4 && v[2] > 0 && v[3] > 0) {
          const w = siLen(el.attrs.width, width, v[2]), h = siLen(el.attrs.height, height, v[3]);
          const s = Math.min(w / v[2], h / v[3]);
          mm = matMul(mm, [s, 0, 0, s, -v[0] * s + (w - v[2] * s) / 2, -v[1] * s + (h - v[3] * s) / 2]);
        }
        const id = add('group', el.attrs.id, parent, { ...siTransformProps(mm), ...ownProps(st, el) });
        for (const c of el.children) if (c.tag !== '#text') walk(c, id, st, IDENTITY, depth + 1);
        return;
      }
      case 'use': {
        const href = el.attrs.href || el.attrs['xlink:href'];
        const ref = href && href[0] === '#' && byId.get(href.slice(1));
        if (!ref) { warnings.add(`<use> на ${href} — не найдено`); return; }
        const mm = matMul(m, [1, 0, 0, 1, siLen(el.attrs.x), siLen(el.attrs.y)]);
        if (ref.tag === 'symbol') {
          const id = add('group', el.attrs.id, parent, { ...siTransformProps(mm), ...ownProps(st, el) });
          for (const c of ref.children) if (c.tag !== '#text') walk(c, id, st, IDENTITY, depth + 1);
        } else {
          const id = add('group', el.attrs.id, parent, { ...siTransformProps(mm), ...ownProps(st, el) });
          walk(ref, id, st, IDENTITY, depth + 1);
        }
        return;
      }
      case 'rect': {
        const x = siLen(el.attrs.x, width), y = siLen(el.attrs.y, height), w = siLen(el.attrs.width, width), h = siLen(el.attrs.height, height);
        if (!(w > 0 && h > 0)) return;
        let rx = el.attrs.rx != null ? siLen(el.attrs.rx, width) : el.attrs.ry != null ? siLen(el.attrs.ry, height) : 0;
        rx = Math.min(rx, w / 2, h / 2);
        const props = { ...siTransformProps(matMul(m, [1, 0, 0, 1, x + w / 2, y + h / 2])), width: r4(w), height: r4(h), ...drawProps(st, [-w / 2, -h / 2, w, h]), ...ownProps(st, el) };
        if (rx > 0) props.radius = r4(rx);
        if (el.attrs.ry != null && el.attrs.rx != null && Math.abs(siLen(el.attrs.rx) - siLen(el.attrs.ry)) > 1e-6) warnings.add('rect с разными rx/ry — скругление по rx');
        if (hidden) props.visible = false;
        add('rect', el.attrs.id, parent, props);
        return;
      }
      case 'circle': case 'ellipse': {
        const cx = siLen(el.attrs.cx, width), cy = siLen(el.attrs.cy, height);
        const rx = tag === 'circle' ? siLen(el.attrs.r) : siLen(el.attrs.rx, width), ry = tag === 'circle' ? rx : siLen(el.attrs.ry, height);
        if (!(rx > 0 && ry > 0)) return;
        const props = { ...siTransformProps(matMul(m, [1, 0, 0, 1, cx, cy])), ...(tag === 'circle' ? { r: r4(rx) } : { rx: r4(rx), ry: r4(ry) }), ...drawProps(st, [-rx, -ry, 2 * rx, 2 * ry]), ...ownProps(st, el) };
        if (hidden) props.visible = false;
        add(tag, el.attrs.id, parent, props);
        return;
      }
      case 'line': {
        const p = { ...siTransformProps(m), x1: r4(siLen(el.attrs.x1)), y1: r4(siLen(el.attrs.y1)), x2: r4(siLen(el.attrs.x2)), y2: r4(siLen(el.attrs.y2)) };
        const box = [Math.min(p.x1, p.x2), Math.min(p.y1, p.y2), Math.abs(p.x2 - p.x1) || 1, Math.abs(p.y2 - p.y1) || 1];
        const props = { ...p, ...drawProps(st, box), ...ownProps(st, el) };
        props.fill = 'none';
        if (!props.stroke) return;
        if (hidden) props.visible = false;
        add('line', el.attrs.id, parent, props);
        return;
      }
      case 'polyline': case 'polygon': case 'path': {
        let d;
        if (tag === 'path') d = String(el.attrs.d || '').trim();
        else {
          const n = siNums(el.attrs.points);
          if (n.length < 4) return;
          d = 'M' + n.slice(0, 2).join(' ') + n.slice(2).reduce((s, v, i) => s + (i % 2 ? ' ' : 'L') + v, '') + (tag === 'polygon' ? 'Z' : '');
        }
        if (!d) return;
        let box;
        try { box = siBox(parsePath(d)); } catch (e) { warnings.add(`путь ${el.attrs.id || ''} не разобран: ${e.message}`); return; }
        const props = { ...siTransformProps(m), d, ...drawProps(st, box), ...ownProps(st, el) };
        if (tag === 'polyline' && props.fill !== 'none') warnings.add('polyline с заливкой: замкнута как многоугольник');
        if (hidden) props.visible = false;
        add('path', el.attrs.id, parent, props);
        return;
      }
      case 'text': {
        const txt = textOf(el).replace(/\s+/g, ' ').trim();
        if (!txt) return;
        const first = el.children.find((c) => c.tag === 'tspan' && (c.attrs.x != null || c.attrs.y != null));
        const x = siNums(el.attrs.x ?? first?.attrs.x)[0] ?? 0, y = siNums(el.attrs.y ?? first?.attrs.y)[0] ?? 0;
        const fs = siLen(st['font-size'], 16, 16);
        // SVG ставит текст по базовой линии, движок — по центру строки
        const props = { ...siTransformProps(matMul(m, [1, 0, 0, 1, x, y - fs * 0.35])), text: txt, fontSize: r4(fs),
          textAlign: { start: 'left', middle: 'center', end: 'right' }[st['text-anchor']] || 'left', ...drawProps(st, [0, -fs, fs * txt.length * 0.6, fs]), ...ownProps(st, el) };
        if (st['font-family']) props.fontFamily = st['font-family'].replace(/["']/g, '');
        const fw = st['font-weight'];
        props.fontWeight = fw === 'bold' || fw === 'bolder' ? 700 : +fw || 400;
        if (st['letter-spacing'] && st['letter-spacing'] !== 'normal') props.letterSpacing = r4(siLen(st['letter-spacing']));
        if (el.children.some((c) => c.tag === 'tspan' && (c.attrs.dy != null || (c !== first && (c.attrs.x != null || c.attrs.y != null))))) warnings.add('многострочный текст (tspan) собран в одну строку');
        if (hidden) props.visible = false;
        add('text', el.attrs.id, parent, props);
        return;
      }
      case 'image': {
        const href = el.attrs.href || el.attrs['xlink:href'];
        if (!href) return;
        const x = siLen(el.attrs.x), y = siLen(el.attrs.y), w = siLen(el.attrs.width, width), h = siLen(el.attrs.height, height);
        if (!(w > 0 && h > 0)) return;
        const par = String(el.attrs.preserveAspectRatio || 'xMidYMid meet');
        const props = { ...siTransformProps(matMul(m, [1, 0, 0, 1, x + w / 2, y + h / 2])), src: href, width: r4(w), height: r4(h),
          fit: par.startsWith('none') ? 'stretch' : /slice/.test(par) ? 'cover' : 'contain', ...ownProps(st, el) };
        if (hidden) props.visible = false;
        add('image', el.attrs.id, parent, props);
        return;
      }
      case 'defs': case 'symbol': case 'style': case 'title': case 'desc': case 'metadata': case 'script':
      case 'linearGradient': case 'radialGradient': case 'clipPath': case 'mask': case 'pattern': case 'marker': case 'filter':
        return;
      case 'animate': case 'animateTransform': case 'animateMotion': case 'set':
        warnings.add('анимация SMIL не переносится'); return;
      default:
        if (!el.tag.includes(':')) warnings.add(`<${el.tag}> не поддержан — пропущен`);
    }
  }
  const textOf = (el) => el.children.map((c) => (c.tag === '#text' ? c.text : c.tag === 'tspan' || c.tag === 'a' ? ' ' + textOf(c) : '')).join('');

  const rootStyle = styleOf(svg, ROOT_STYLE);
  for (const c of svg.children) if (c.tag !== '#text') walk(c, rootId, rootStyle);
  return { width, height, viewBox, nodes, warnings: [...warnings] };
}

/**
 * Вставить SVG в сцену (на месте): корневая группа под parent, id без повторов со сценой.
 * opts: { id, parent, x, y, scale, fit: [w, h] — вписать, center — центрировать в точке x/y }.
 * Возвращает { root, ids, width, height, warnings }.
 */
export function insertSVG(scene, src, opts = {}) {
  const c = index(scene);
  if (opts.parent && !c.byId.has(opts.parent)) throw new Error(`Родитель «${opts.parent}» не найден`);
  const r = importSVG(src, { ...opts, taken: c.byId.keys() });
  const root = r.nodes[0];
  let s = opts.scale ?? 1;
  if (opts.fit) s = Math.min(opts.fit[0] / r.width, opts.fit[1] / r.height);
  const ox = root.props.x || 0, oy = root.props.y || 0;
  const cx = opts.center ? -(r.width * s) / 2 : 0, cy = opts.center ? -(r.height * s) / 2 : 0;
  if (s !== 1) {
    // масштаб корня: сдвиг viewBox — во внутреннюю группу, чтобы x/y корня были в координатах сцены
    root.props.scale = r4(s);
    if (ox || oy) { root.props.anchorX = -ox; root.props.anchorY = -oy; }
    delete root.props.x; delete root.props.y;
  }
  const bx = (s !== 1 ? 0 : ox) + cx + (opts.x ?? 0), by = (s !== 1 ? 0 : oy) + cy + (opts.y ?? 0);
  if (bx) root.props.x = r4(bx); else delete root.props.x;
  if (by) root.props.y = r4(by); else delete root.props.y;
  scene.nodes.push(...r.nodes);
  invalidateAll(scene);
  return { root: root.id, ids: r.nodes.map((n) => n.id), width: r.width, height: r.height, warnings: r.warnings };
}
