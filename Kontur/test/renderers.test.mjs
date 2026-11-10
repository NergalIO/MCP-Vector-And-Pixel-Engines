// Бэкенды отображения без браузера: ключевой DOMRenderer на маленьком поддельном DOM (итог совпадает с
// treeToString после серии кадров со сменой структуры), CanvasRenderer на записывающем контексте, resolve().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMRenderer, CanvasRenderer, evaluate, treeToString, resolve, parseTransform, createScene, ops, filterTemplate } from '../engine/kontur.js';
import { ex } from './helpers/common.mjs';

/* ---------- поддельный DOM: ровно то, что нужно DOMRenderer ---------- */
class El {
  constructor(tag) { this.tagName = tag; this.attrs = new Map(); this.childNodes = []; this.parentNode = null; this.style = {}; this._text = null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  setAttributeNS(ns, k, v) { this.attrs.set(k, String(v)); }
  removeAttribute(k) { this.attrs.delete(k); }
  removeAttributeNS(ns, k) { this.attrs.delete('xlink:' + k); }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] || null; }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, c); c.parentNode = this; return c;
  }
  removeChild(c) { this.childNodes.splice(this.childNodes.indexOf(c), 1); c.parentNode = null; return c; }
  set textContent(t) { this._text = t; this.childNodes = []; }
  set innerHTML(_) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; }
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ser = (e) => {
  let a = ''; for (const [k, v] of e.attrs) a += ` ${k}="${esc(v)}"`;
  if (e._text != null) return `<${e.tagName}${a}>${esc(e._text)}</${e.tagName}>`;
  if (!e.childNodes.length) return `<${e.tagName}${a}/>`;
  return `<${e.tagName}${a}>${e.childNodes.map(ser).join('')}</${e.tagName}>`;
};
globalThis.document = { createElementNS: (ns, tag) => new El(tag) };
// атрибуты в DOM идут в порядке установки; сверяем как множества на каждом элементе
const canon = (s) => s.replace(/<(\w+)((?: [\w:-]+="[^"]*")*)(\/?)>/g, (_, t, a, sl) => `<${t}${(a.match(/ [\w:-]+="[^"]*"/g) || []).sort().join('')}${sl}>`);
const expected = (tree) => canon(treeToString({ ...tree, attrs: { ...tree.attrs, width: null, height: null } }));

test('DOMRenderer: после каждого кадра DOM совпадает с SVG-строкой', () => {
  for (const name of ['flow', 'liquid', 'reveal', 'bay']) {
    const sc = ex(name), box = new El('div'), r = new DOMRenderer(box);
    for (let i = 0; i < 12; i++) {
      const tree = evaluate(sc, (i * sc.duration) / 12, { cache: true });
      r.render(tree);
      assert.equal(canon(ser(box.childNodes[0])), expected(tree), `${name} кадр ${i}`);
    }
  }
});

test('DOMRenderer: смена структуры — перестановка, удаление, исчезнувший атрибут', () => {
  const sc = createScene({ width: 100, height: 100 });
  ops.addNode(sc, { id: 'a', type: 'rect', props: { fill: '#f00', opacity: 0.5 } });
  ops.addNode(sc, { id: 'b', type: 'circle', props: { r: 10 } });
  ops.addNode(sc, { id: 'c', type: 'star' });
  const box = new El('div'), r = new DOMRenderer(box);
  r.render(evaluate(sc, 0));
  const elB = box.childNodes[0].childNodes.find((e) => e.attrs.get('data-node') === 'b');
  ops.reorder(sc, 'b', 2); ops.updateNode(sc, 'a', { unset: ['opacity'] }); ops.removeNode(sc, 'c');
  const tree = evaluate(sc, 0);
  r.render(tree);
  assert.equal(canon(ser(box.childNodes[0])), expected(tree));
  assert.ok(box.childNodes[0].childNodes.includes(elB), 'элемент узла b переиспользован');
  assert.ok(!box.childNodes[0].childNodes.find((e) => e.attrs.get('data-node') === 'a').attrs.has('opacity'), 'opacity снят removeAttribute');
});

/* ---------- Canvas на записывающем контексте ---------- */
function recCtx() {
  const calls = [];
  const ctx = new Proxy({ canvas: { width: 400, height: 225 } }, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      return (...a) => { calls.push(k); };
    },
    set(o, k, v) { o[k] = v; return true; },
  });
  return { ctx, calls };
}
globalThis.Path2D = class { constructor(d) { this.d = d; } addPath() {} rect() {} ellipse() {} moveTo() {} lineTo() {} roundRect() {} };
globalThis.Image = class { set src(v) { this._src = v; } get complete() { return false; } };

test('CanvasRenderer: примеры рисуются без ошибок', () => {
  for (const name of ['flow', 'liquid', 'reveal', 'bay']) {
    const sc = ex(name);
    const { ctx, calls } = recCtx();
    const r = new CanvasRenderer(null, { context: ctx, width: 400, height: 225, createCanvas: (w, h) => ({ width: w, height: h, getContext: () => recCtx().ctx }) });
    for (let i = 0; i < 4; i++) r.render(evaluate(sc, i * 0.7, { cache: true }));
    assert.ok(calls.filter((c) => c === 'fill' || c === 'stroke' || c === 'fillText').length > 0, name);
    assert.ok(r.paths.size > 0, `${name}: Path2D в кэше`);
  }
});

test('фильтры движка → CSS-фильтр Canvas', () => {
  const sc = createScene({ width: 100, height: 100 });
  ops.addNode(sc, { id: 'g', type: 'rect', props: { blur: 3, glow: { blur: 5, color: '#ff0000' }, shadow: { x: 2, y: 4, blur: 6 } } });
  const tree = evaluate(sc, 0);
  const def = tree.children[0].children.find((d) => d.tag === 'filter');
  assert.equal(filterTemplate(def)(2), 'blur(6.00px) drop-shadow(0px 0px 20.00px rgba(255,0,0,0.9)) drop-shadow(4.00px 8.00px 24.00px rgba(0,0,0,0.5))');
});

test('resolve: плоский список с итоговыми матрицами', () => {
  const sc = createScene({ width: 100, height: 100 });
  ops.addNode(sc, { id: 'p', type: 'group', props: { x: 10, y: 20, rotation: 90, opacity: 0.5 } });
  ops.addNode(sc, { id: 'r', type: 'rect', parent: 'p', props: { x: 5 } });
  ops.addNode(sc, { id: 'r2', type: 'rect', parent: 'p', props: { x: 50 } });
  const { items } = resolve(sc, 0);
  const it = items.find((x) => x.id === 'r');
  assert.ok(it && Math.abs(it.matrix[4] - 10) < 1e-9 && Math.abs(it.matrix[5] - 25) < 1e-9, JSON.stringify(it?.matrix));
  assert.equal(it.opacity, 0.5);
  assert.deepEqual(parseTransform('translate(3 4) scale(2)'), [2, 0, 0, 2, 3, 4]);
});
