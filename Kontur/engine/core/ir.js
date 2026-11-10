/**
 * Промежуточное представление кадра: плоский список отображения из дерева evaluate.
 * Дерево {tag, attrs, children} остаётся общим источником для бэкендов (SVG-строка — treeToString, DOM —
 * DOMRenderer, Canvas — CanvasRenderer); resolve() даёт тот же кадр как список фигур с итоговыми матрицами,
 * прозрачностью и ссылками — для границ слоёв, проверок статичности и внешних бэкендов.
 */
import { evaluate } from './evaluate.js';
import { BoundedCache } from './cache.js';
import { DEG, mat } from './math.js';

/** Матрица [a, b, c, d, e, f] (как в SVG/Canvas). */
export const IDENTITY = Object.freeze(mat.id());
export const matMul = mat.mul;
const RAD = DEG;
const tfCache = new BoundedCache(20000);
/** Разбор атрибута transform (translate, rotate(a [cx cy]), scale, skewX, skewY, matrix) в матрицу. */
export function parseTransform(s) {
  if (!s) return IDENTITY;
  let m = tfCache.get(s);
  if (m) return m;
  m = IDENTITY;
  const re = /(matrix|translate|rotate|scale|skewX|skewY)\s*\(([^)]*)\)/g;
  let x;
  while ((x = re.exec(s))) {
    const a = x[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n;
    switch (x[1]) {
      case 'matrix': n = a.length === 6 ? a : IDENTITY; break;
      case 'translate': n = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; break;
      case 'scale': n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const r = (a[0] || 0) * RAD, c = Math.cos(r), sn = Math.sin(r);
        n = [c, sn, -sn, c, 0, 0];
        if (a.length >= 3) n = matMul(matMul([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      }
      case 'skewX': n = [1, 0, Math.tan((a[0] || 0) * RAD), 1, 0, 0]; break;
      case 'skewY': n = [1, Math.tan((a[0] || 0) * RAD), 0, 1, 0, 0]; break;
    }
    m = matMul(m, n);
  }
  tfCache.set(s, m);
  return m;
}
/** id из url(#id) или null. */
export const urlRef = (v) => { const m = /^url\(#([^)]+)\)$/.exec(String(v || '')); return m ? m[1] : null; };
/** Определения кадра (defs) по id. */
export function defsOf(tree) {
  const out = new Map();
  const walk = (n) => { if (n.attrs?.id) out.set(n.attrs.id, n); for (const c of n.children || []) walk(c); };
  for (const c of tree.children || []) if (c.tag === 'defs') walk(c);
  return out;
}
const DRAWABLE = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image']);

/**
 * Плоский список отображения кадра: [{ id, tag, attrs, matrix, opacity, clip[], mask[], filter[], blend }] в порядке
 * рисования. id — ближайший узел сцены (data-node), clip/mask/filter — стеки id определений от предков.
 * opts — как у evaluate; tree — уже вычисленное дерево (не пересчитывать).
 */
export function resolve(scene, t, opts = {}, tree = null) {
  tree = tree || evaluate(scene, t, opts);
  const items = [];
  const vb = String(tree.attrs.viewBox || `0 0 ${scene.width} ${scene.height}`).split(/\s+/).map(Number);
  const walk = (n, st) => {
    if (n.tag === 'defs' || n.tag === 'clipPath' || n.tag === 'mask' || n.tag === 'pattern' || n.tag === 'filter') return;
    const a = n.attrs || {};
    let m = st.m, op = st.op, id = st.id, clip = st.clip, mask = st.mask, filter = st.filter, blend = st.blend;
    if (a.transform) m = matMul(m, parseTransform(a.transform));
    if (n.tag === 'svg' && n !== tree && a.viewBox) {
      const [vx, vy, vw, vh] = String(a.viewBox).split(/\s+/).map(Number);
      m = matMul(m, [(+a.width || vw) / vw, 0, 0, (+a.height || vh) / vh, (+a.x || 0) - vx * ((+a.width || vw) / vw), (+a.y || 0) - vy * ((+a.height || vh) / vh)]);
    }
    if (a.opacity != null) op *= +a.opacity;
    if (a['data-node']) id = a['data-node'];
    const cp = urlRef(a['clip-path']); if (cp) clip = [...clip, cp];
    const mk = urlRef(a.mask); if (mk) mask = [...mask, mk];
    const fl = urlRef(a.filter); if (fl) filter = [...filter, fl];
    const bm = /mix-blend-mode:\s*([\w-]+)/.exec(a.style || ''); if (bm) blend = bm[1];
    if (DRAWABLE.has(n.tag)) items.push({ id, tag: n.tag, attrs: a, text: n.text, matrix: m, opacity: op, clip, mask, filter, blend });
    const s2 = { m, op, id, clip, mask, filter, blend };
    for (const c of n.children || []) walk(c, s2);
  };
  for (const c of tree.children || []) walk(c, { m: IDENTITY, op: 1, id: null, clip: [], mask: [], filter: [], blend: null });
  return { width: scene.width, height: scene.height, viewBox: vb, defs: defsOf(tree), items, tree };
}
