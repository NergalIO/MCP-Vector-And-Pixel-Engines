// Растеризатор проходов на видеокарте (прототип, KONTUR_GPU=raster): геометрия на процессоре (всегда) и сравнение
// кадра видеокарты с resvg (без пакета webgpu, адаптера или resvg-js — пропуск).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenPath, convexContours, earClip, treeToGeometry, K_DIRECT, K_EVENODD, K_LAYER, ITEM_F } from '../mcp/lit/raster-geom.mjs';
import { treeToString } from '../engine/kontur.js';

const I = [1, 0, 0, 1, 0, 0];
const area = (t) => { let s = 0; for (let k = 0; k < t.length; k += 6) s += Math.abs((t[k + 2] - t[k]) * (t[k + 5] - t[k + 1]) - (t[k + 4] - t[k]) * (t[k + 3] - t[k + 1])) / 2; return s; };

test('разбиение пути: отрезки, кривые, относительные команды, дуги — в запасной слой', () => {
  const [c] = flattenPath('M0 0L10 0L10 10L0 10Z', [2, 0, 0, 2, 5, 5]);
  assert.deepEqual(c.p, [5, 5, 25, 5, 25, 25, 5, 25]);
  assert.equal(c.closed, true);
  const [q] = flattenPath('M0 0c0 10 10 10 10 0', I);
  assert.ok(q.p.length > 8, 'кривая разбита на отрезки');
  assert.deepEqual(q.p.slice(-2).map(Math.round), [10, 0]);
  assert.equal(flattenPath('M0 0A5 5 0 0 1 10 0', I), null);
});

test('выпуклость и отсечение ушей', () => {
  const sq = flattenPath('M0 0L10 0L10 10L0 10Z', I);
  assert.equal(convexContours(sq), true);
  const L = flattenPath('M0 0L10 0L10 4L4 4L4 10L0 10Z', I);
  assert.equal(convexContours(L), false);
  const t = earClip(L);
  assert.ok(t && Math.abs(area(t) - 64) < 1e-9, 'площадь L-фигуры 64');
  assert.equal(earClip(flattenPath('M0 0L10 10L10 0L0 10Z', I)), null, 'самопересечение — трафарет');
  assert.equal(convexContours(flattenPath('M50 0L61 35L98 35L68 57L79 91L50 70L21 91L32 57L2 35L39 35Z', I)), false, 'звезда не выпукла');
});

const TREE = {
  tag: 'svg', attrs: { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 200 100', width: 200, height: 100 },
  children: [
    { tag: 'defs', attrs: {}, children: [
      { tag: 'linearGradient', attrs: { id: 'lg', gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, x2: 200, y2: 0 }, children: [
        { tag: 'stop', attrs: { offset: 0, 'stop-color': '#203040' } }, { tag: 'stop', attrs: { offset: 1, 'stop-color': '#e0c090' } }] },
      { tag: 'radialGradient', attrs: { id: 'rg', gradientUnits: 'userSpaceOnUse', cx: 150, cy: 50, r: 30, fx: 140, fy: 45 }, children: [
        { tag: 'stop', attrs: { offset: 0, 'stop-color': '#ffffff' } }, { tag: 'stop', attrs: { offset: 1, 'stop-color': '#3060c0' } }] },
    ] },
    { tag: 'rect', attrs: { x: 0, y: 0, width: 200, height: 100, fill: 'url(#lg)' } },
    { tag: 'g', attrs: { transform: 'translate(10 10) rotate(10)' }, children: [
      { tag: 'path', attrs: { d: 'M0 0L40 0L40 16L16 16L16 40L0 40Z', fill: '#c03030' } },
      { tag: 'path', attrs: { d: 'M60 0L90 0L90 30L60 30ZM68 8L68 22L82 22L82 8Z', fill: '#30a040', 'fill-rule': 'evenodd' } },
    ] },
    { tag: 'path', attrs: { d: 'M150 20C170 20 180 40 180 50C180 70 160 80 150 80C130 80 120 60 120 50C120 30 135 20 150 20Z', fill: 'url(#rg)' } },
    { tag: 'path', attrs: { d: 'M10 85L60 60L110 90', fill: 'none', stroke: '#101010', 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } },
    { tag: 'path', attrs: { d: 'M120 85L190 85', fill: 'none', stroke: '#ffffff', 'stroke-width': 6, 'stroke-opacity': 0.5 } },
    { tag: 'text', attrs: { x: 100, y: 30, 'font-size': 12, fill: '#000' }, text: 'A' },
  ],
};

test('дерево → геометрия: прямые предметы, evenodd на трафарете, текст — запасной слой', () => {
  const g = treeToGeometry(TREE, { ss: 2 });
  assert.equal(g.width, 200);
  assert.equal(g.height, 100);
  const kinds = [];
  for (let o = 0; o < g.items.length; o += ITEM_F) kinds.push(g.items[o]);
  assert.equal(kinds.filter((k) => k === K_EVENODD).length, 1);
  assert.equal(kinds.filter((k) => k === K_LAYER).length, 1);
  assert.ok(kinds.filter((k) => k === K_DIRECT).length >= 4);
  assert.equal(g.layers.length, 1);
  assert.match(g.layers[0], /<text/);
  assert.equal(g.counts.reasons.text, 1);
});

test('видеокарта против resvg: отличия только на краях', async (t) => {
  const { initRasterGPU, rasterize, renderLayers, rasterGPUInfo } = await import('../mcp/lit/gpu-raster.mjs');
  const { probeRaster, svgToRGBA, capabilities } = await import('../mcp/render.mjs');
  if (!(await probeRaster()) || capabilities.png !== 'resvg-js') return t.skip('нужен @resvg/resvg-js');
  if (!(await initRasterGPU())) return t.skip(`нет видеокарты: ${rasterGPUInfo().failure}`);
  for (const crisp of [false, true]) {
    const tree = crisp ? { ...TREE, attrs: { ...TREE.attrs, 'shape-rendering': 'crispEdges' } } : TREE;
    const ref = await svgToRGBA(treeToString(tree), 200);
    const g = treeToGeometry(tree, { ss: crisp ? 1 : 2 });
    const im = await rasterize(g, await renderLayers(g.layers, g.width, g.height), { aa: !crisp });
    assert.equal(im.width, ref.width);
    assert.equal(im.height, ref.height);
    let big = 0;
    for (let i = 0; i < ref.data.length; i += 4) {
      let m = 0;
      for (let c = 0; c < 4; c++) m = Math.max(m, Math.abs(ref.data[i + c] - im.data[i + c]));
      if (m > 24) big++;
    }
    const pct = (100 * big) / (ref.data.length / 4);
    assert.ok(pct < 3, `${crisp ? 'crispEdges' : 'сглаживание'}: заметно отличается ${pct.toFixed(2)}% пикселей`);
  }
});
