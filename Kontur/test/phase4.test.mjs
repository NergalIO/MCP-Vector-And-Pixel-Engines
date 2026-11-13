// Символы и экземпляры, маркеры, текст по кривой, импорт SVG, экспорт в Lottie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScene, ops, renderSVG, evaluate, validateStructure, validateScene, markersCrossed, Player, importSVG, insertSVG, decomposeMatrix, exportLottie, parseXML, diffScenes, applyEdits } from '../engine/kontur.js';
import { matMul } from '../engine/core/ir.js';
import { trimDash } from '../engine/core/paint.js';

function walkerScene() {
  const sc = createScene({ width: 200, height: 100, duration: 4 });
  ops.addNode(sc, { id: 'w', type: 'group', props: { x: 30, y: 40 } });
  ops.addNode(sc, { id: 'dot', type: 'circle', parent: 'w', props: { r: 5, fill: '#f00' }, keys: { x: [{ t: 0, v: 0, ease: 'linear' }, { t: 1, v: 20 }] } });
  return sc;
}

/* ---------- символы ---------- */
test('символ из поддерева: экземпляр на месте, сдвиг корня — на экземпляре, кадр не изменился', () => {
  const sc = walkerScene();
  const before = renderSVG(sc, 0.5);
  const r = ops.symbolFromNode(sc, 'w', 'walker', { duration: 1 });
  assert.equal(r.instance.type, 'instance');
  assert.deepEqual(r.instance.props, { symbol: 'walker', x: 30, y: 40 });
  assert.equal(sc.symbols.walker.nodes[0].parent, null);
  assert.deepEqual(validateScene(sc), []);
  // внутренние элементы без data-node — в остальном тот же вид
  const shape = (svg) => [...svg.matchAll(/transform="([^"]*)"|<path [^>]*>/g)].map((m) => m[0]).join('|');
  assert.equal(shape(renderSVG(sc, 0.5)), shape(before));
});

test('экземпляры: своё время (timeOffset, timeScale), цикл и остановка, symbolTime', () => {
  const sc = walkerScene();
  ops.symbolFromNode(sc, 'w', 'walker', { duration: 1 });
  ops.addNode(sc, { id: 'a', type: 'instance', props: { symbol: 'walker', timeOffset: 0.5 } });
  ops.addNode(sc, { id: 'b', type: 'instance', props: { symbol: 'walker', loop: false } });
  ops.addNode(sc, { id: 'c', type: 'instance', props: { symbol: 'walker', timeScale: 2 } });
  ops.addNode(sc, { id: 'd', type: 'instance', props: { symbol: 'walker', symbolTime: 0.25 } });
  const xOf = (t, id) => {
    const g = evaluate(sc, t).children.find((c) => c.attrs['data-node'] === id);
    return +/translate\(([-\d.]+)/.exec(g.children[0].children[0].attrs.transform)[1];
  };
  assert.equal(xOf(1.25, 'w'), 5);      // по кругу: 1.25 → 0.25
  assert.equal(xOf(0.25, 'a'), 15);     // -0.25 → 0.75
  assert.equal(xOf(3, 'b'), 20);        // остановка на конце
  assert.equal(xOf(0.25, 'c'), 10);     // вдвое быстрее
  assert.equal(xOf(3.7, 'd'), 5);       // явное время
});

test('символы: проверка ссылок и циклов, удаление, правки переносят symbols', () => {
  const sc = walkerScene();
  ops.symbolFromNode(sc, 'w', 'walker', { duration: 1 });
  ops.addNode(sc, { id: 'u', type: 'instance', props: { symbol: 'nope' } });
  assert.match(validateStructure(sc).join(), /символ «nope» не найден/);
  ops.removeNode(sc, 'u');
  const bad = structuredClone(sc);
  bad.symbols.walker.nodes.push({ id: 'i', type: 'instance', props: { symbol: 'walker' } });
  assert.match(validateStructure(bad).join(), /Цикл символов: walker → walker/);
  assert.doesNotThrow(() => renderSVG(bad, 0), 'цикл не зацикливает вычисление');
  const base = structuredClone(sc);
  ops.defineSymbol(sc, 'dot2', { nodes: [{ id: 'q', type: 'rect' }] });
  assert.deepEqual(applyEdits(base, diffScenes(base, sc)).scene.symbols, sc.symbols);
  assert.throws(() => ops.removeSymbol(sc, 'walker'), /используют: w/);
  assert.deepEqual(ops.removeSymbol(sc, 'walker', { force: true }), ['w']);
  assert.ok(!sc.nodes.some((n) => n.id === 'w') && !sc.symbols.walker);
  assert.throws(() => ops.defineSymbol(sc, '1bad', { nodes: [] }), /Недопустимое имя/);
});

/* ---------- маркеры ---------- */
test('маркеры: пересечение интервала, по кругу, проверка', () => {
  const sc = createScene({ duration: 4 });
  ops.setMarker(sc, 'hit', 1); ops.setMarker(sc, 'end', 3.9, { power: 2 });
  assert.deepEqual(markersCrossed(sc, 0.5, 1.5).map((m) => m.name), ['hit']);
  assert.deepEqual(markersCrossed(sc, 1, 1.5), [], 'начало интервала не включается');
  assert.deepEqual(markersCrossed(sc, 3.8, 0.2, { wrap: true }).map((m) => m.name), ['end']);
  ops.setMarker(sc, 'hit', 2);
  assert.deepEqual(sc.markers.map((m) => `${m.name}@${m.t}`), ['hit@2', 'end@3.9']);
  assert.throws(() => ops.setMarker(sc, 'x', 9), /0\.\.4/);
  assert.deepEqual(validateStructure(sc), []);
  sc.markers.push({ name: 'hit', t: 1 });
  assert.match(validateStructure(sc).join(), /Повтор маркера hit/);
  assert.equal(ops.removeMarker(sc, 'end'), 1);
});

test('Player.onMarker вызывается при воспроизведении, в том числе через конец цикла', () => {
  const frames = [];
  globalThis.requestAnimationFrame = (f) => frames.push(f);
  globalThis.performance ??= { now: () => 0 };
  const sc = createScene({ duration: 1 });
  ops.setMarker(sc, 'a', 0.25); ops.setMarker(sc, 'b', 0.9);
  const p = new Player(null, sc, { renderer: { render() {} }, autoplay: false });
  const got = [];
  p.onMarker((m) => got.push(m.name));
  p.play(); p.last = 0;
  for (const now of [80, 160, 240, 320, 400, 480, 560, 640, 720, 800, 880, 960, 1040, 1120, 1200, 1280]) p._tick(now);
  assert.deepEqual(got, ['a', 'b', 'a']);
});

/* ---------- текст по кривой ---------- */
test('текст по кривой: textPath на путь узла (со сдвигом) или строку d; pathOffset и выравнивание', () => {
  const sc = createScene({ width: 200, height: 100 });
  ops.addNode(sc, { id: 'arc', type: 'path', props: { d: 'M0 0 L100 0', x: 10, stroke: '#fff' } });
  ops.addNode(sc, { id: 'tx', type: 'text', props: { text: 'Hi', path: 'arc', pathOffset: 0.1 } });
  ops.addNode(sc, { id: 'ty', type: 'text', props: { text: 'Yo', path: 'M0 50 L200 50', textAlign: 'left' } });
  const s = renderSVG(sc, 0);
  assert.match(s, /<path id="k-tp-tx" d="M10 0L110 0"/);
  assert.match(s, /<textPath href="#k-tp-tx" startOffset="60%">Hi<\/textPath>/);
  assert.match(s, /<textPath href="#k-tp-ty" startOffset="0%">Yo<\/textPath>/);
  // переименование узла пути ведёт за собой ссылку текста
  ops.updateNode(sc, 'arc', { newId: 'curve' });
  assert.equal(sc.nodes.find((n) => n.id === 'tx').props.path, 'curve');
});

/* ---------- импорт SVG ---------- */
test('разложение матрицы собирается обратно в ту же (translate · rotate · skewX · scale)', () => {
  const R = Math.PI / 180;
  for (const m of [[1, 0, 0, 1, 5, 6], [0.5, 0.8, -1.2, 0.3, 10, -4], [1, 0, 0, -1, 0, 0], [2, 0, 0.5, 1, 0, 0]]) {
    const t = decomposeMatrix(m), a = t.rotation * R;
    const back = matMul(matMul(matMul([1, 0, 0, 1, t.x, t.y], [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]), [1, 0, Math.tan(t.skewX * R), 1, 0, 0]), [t.scaleX, 0, 0, t.scaleY, 0, 0]);
    m.forEach((v, i) => assert.ok(Math.abs(v - back[i]) < 1e-9, `${m} → ${back}`));
  }
});

test('разбор XML: сущности, CDATA, комментарии, DOCTYPE', () => {
  const d = parseXML('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "b">]><!-- c --><svg a="1 &amp; 2"><style><![CDATA[.x{fill:red}]]></style><text>A &lt; B &#65;</text></svg>');
  const svg = d.children[0];
  assert.equal(svg.attrs.a, '1 & 2');
  assert.equal(svg.children[0].children[0].text, '.x{fill:red}');
  assert.equal(svg.children[1].children[0].text, 'A < B A');
});

test('импорт SVG: фигуры, стили, наследование, градиент по рамке, use, предупреждения', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="10 20 200 100">
    <style>.a { fill: navy; stroke: #fff; stroke-width: 3 }</style>
    <defs><linearGradient id="lg"><stop offset="0" stop-color="gold"/><stop offset="1" stop-color="red" stop-opacity="0.5"/></linearGradient><circle id="dot" r="4"/></defs>
    <g fill="#0f0" opacity="0.5" transform="translate(5 6)">
      <rect class="a" x="10" y="20" width="40" height="20" rx="4"/>
      <ellipse id="e" cx="100" cy="50" rx="20" ry="10" fill="url(#lg)"/>
      <polygon points="0,0 10,0 5,8" fill-opacity="0.5"/>
    </g>
    <use xlink:href="#dot" x="150" y="60"/>
    <text x="20" y="90" font-size="10" text-anchor="middle">Hi <tspan>there</tspan></text>
    <path d="M0 0" clip-path="url(#c)"/>
  </svg>`;
  const r = importSVG(svg);
  assert.deepEqual([r.width, r.height], [200, 100]);
  const by = (id) => r.nodes.find((n) => n.id === id);
  assert.deepEqual(by('svg').props, { name: 'SVG', x: -10, y: -20 });
  const g = r.nodes.find((n) => n.type === 'group' && n.parent === 'svg');
  assert.deepEqual([g.props.x, g.props.y, g.props.opacity], [5, 6, 0.5]);
  const rect = r.nodes.find((n) => n.type === 'rect');
  assert.deepEqual([rect.props.x, rect.props.y, rect.props.width, rect.props.radius, rect.props.fill, rect.props.stroke, rect.props.strokeWidth], [30, 30, 40, 4, '#000080', '#fff', 3]);
  assert.deepEqual(by('e').props.fill, { type: 'linear', x1: -20, y1: -10, x2: 20, y2: -10, stops: [{ offset: 0, color: '#ffd700' }, { offset: 1, color: '#ff0000', opacity: 0.5 }] });
  const poly = r.nodes.find((n) => n.type === 'path' && n.props.d.startsWith('M0 0L10'));
  assert.equal(poly.props.fill, 'rgba(0,255,0,0.5)', 'заливка унаследована от группы, fill-opacity — в цвет');
  const circ = r.nodes.find((n) => n.type === 'circle');
  assert.equal(circ.props.fill, '#000000', 'use: оформление по умолчанию');
  assert.equal(r.nodes.find((n) => n.id === circ.parent).props.x, 150);
  const tx = r.nodes.find((n) => n.type === 'text');
  assert.deepEqual([tx.props.text, tx.props.textAlign, tx.props.fontWeight, tx.props.y], ['Hi there', 'center', 400, 86.5]);
  assert.ok(r.warnings.some((w) => /clip-path/.test(w)));
});

test('insertSVG: уникальные id, вписывание, сцена проходит проверку и рисуется', () => {
  const sc = createScene({ width: 400, height: 200 });
  ops.addNode(sc, { id: 'svg', type: 'rect' });
  const svg = '<svg viewBox="0 0 100 50"><rect id="svg" width="100" height="50" fill="red"/></svg>';
  const r = insertSVG(sc, svg, { fit: [400, 200] });
  assert.equal(r.root, 'svg_2');
  assert.equal(sc.nodes.find((n) => n.id === r.root).props.scale, 4);
  assert.deepEqual(validateScene(sc), []);
  assert.match(renderSVG(sc, 0), /fill="#ff0000"/);
});

/* ---------- Lottie ---------- */
/** Значение свойства Lottie на кадре f (линейно между ключами, со скачком у h). */
function valAt(p, f) {
  if (!p.a) return Array.isArray(p.k) ? p.k[0] : p.k;
  const k = p.k;
  let i = 0;
  while (i < k.length - 1 && k[i + 1].t <= f) i++;
  if (i === k.length - 1 || k[i].h) return k[i].s[0];
  const u = (f - k[i].t) / (k[i + 1].t - k[i].t);
  return k[i].s[0] + (k[i + 1].s[0] - k[i].s[0]) * u;
}
function lottieItems(l) {
  const out = [];
  const walk = (it) => it.forEach((x) => { out.push(x); if (x.it) walk(x.it); });
  walk(l.layers[0].shapes);
  return out;
}
test('Lottie: структура, движение ключами, лишние ключи отброшены, маркеры', () => {
  const sc = createScene({ width: 300, height: 200, duration: 2, fps: 30, background: '#102030' });
  ops.addNode(sc, { id: 'box', type: 'rect', props: { fill: '#ff0000', width: 40, height: 20 }, keys: { x: [{ t: 0, v: 0, ease: 'linear' }, { t: 2, v: 200 }] } });
  ops.setMarker(sc, 'mid', 1);
  const { lottie, warnings, frames } = exportLottie(sc, { fps: 10 });
  assert.equal(frames, 20);
  assert.deepEqual([lottie.w, lottie.h, lottie.fr, lottie.op], [300, 200, 10, 20]);
  assert.deepEqual(lottie.markers, [{ tm: 10, cm: 'mid', dr: 0 }]);
  assert.deepEqual(warnings, []);
  const box = lottieItems(lottie).find((x) => x.ty === 'gr' && x.nm === 'box');
  const tr = box.it.at(-1);
  assert.equal(tr.ty, 'tr');
  assert.equal(tr.p.a, 1);
  assert.deepEqual(tr.p.k.map((k) => k.t), [0, 20], 'линейное движение — два ключа');
  assert.deepEqual([tr.p.k[0].s, tr.p.k[1].s], [[0, 0], [200, 0]]);
  const fl = lottieItems(lottie).find((x) => x.ty === 'fl' && x.c.k[0] === 1);
  assert.deepEqual(fl.c.k, [1, 0, 0, 1]);
  assert.ok(lottieItems(lottie).some((x) => x.ty === 'fl' && Math.abs(x.c.k[2] - 48 / 255) < 1e-3), 'фон');
});

test('Lottie: обрезка обводки → Trim Paths, заливка не обрезается; появление — ключ со скачком', () => {
  const sc = createScene({ duration: 1, fps: 10 });
  ops.addNode(sc, { id: 'c', type: 'circle', props: { r: 50, fill: '#00ff00', stroke: '#fff', strokeWidth: 4, inPoint: 0.3 }, keys: { trimEnd: [{ t: 0, v: 0.2, ease: 'linear' }, { t: 1, v: 0.8 }] } });
  const { lottie } = exportLottie(sc, { fps: 10 });
  const items = lottieItems(lottie);
  const tm = items.find((x) => x.ty === 'tm');
  assert.ok(tm, 'есть Trim Paths');
  const e = valAt(tm.e, 5);
  assert.ok(Math.abs(e - 50) < 0.5, `видимая часть на t=0.5 — 50%, а не ${e}`);
  const c = items.find((x) => x.nm === 'c');
  const pg = c.it.find((x) => x.nm === 'path');
  assert.deepEqual(pg.it.filter((x) => x.ty === 'gr').map((x) => x.nm), ['stroke', 'fill']);
  assert.ok(pg.it[0].it.some((x) => x.ty === 'tm') && !pg.it[1].it.some((x) => x.ty === 'tm'), 'обрезка — только в группе обводки');
  const op = c.it.at(-1).o;
  assert.equal(valAt(op, 2), 0);
  assert.equal(valAt(op, 2.9), 0, 'до inPoint — прозрачность 0 со скачком');
  assert.equal(valAt(op, 3), 100);
});

test('обрезка движка восстанавливается из штрихов (с переходом через начало и без)', () => {
  // формулы trimDash ↔ разбор в lottie.js: проверяем на экспорте прямоугольника с разными trimOffset
  for (const [s, e, o] of [[0.1, 0.4, 0], [0.6, 0.9, 0.3], [0, 0.5, 0.75]]) {
    const L = 400, td = trimDash(s, e, o, L);
    assert.ok(td && td.dash.split(' ').length === 4);
    const sc = createScene({ duration: 1 });
    ops.addNode(sc, { id: 'r', type: 'rect', props: { fill: 'none', stroke: '#fff', trimStart: s, trimEnd: e, trimOffset: o } });
    const tm = lottieItems(exportLottie(sc, { fps: 4 }).lottie).find((x) => x.ty === 'tm');
    assert.ok(Math.abs(tm.e.k - (e - s) * 100) < 0.01, `${s}-${e}+${o}: e=${tm.e.k}`);
    const start = ((s + o) % 1) * 360;
    assert.ok(Math.abs(((tm.o.k % 360) + 360) % 360 - start) < 0.05, `${s}-${e}+${o}: o=${tm.o.k}, ждали ${start}`);
  }
});

test('Lottie: символы и неподдержанное — с предупреждениями, без ошибок', () => {
  const sc = walkerScene();
  ops.symbolFromNode(sc, 'w', 'walker', { duration: 1 });
  ops.addNode(sc, { id: 't', type: 'text', props: { text: 'x' } });
  ops.addNode(sc, { id: 'b', type: 'rect', props: { blur: 3 } });
  const { lottie, warnings } = exportLottie(sc, { fps: 10 });
  assert.ok(warnings.some((w) => /текст/.test(w)) && warnings.some((w) => /фильтры/.test(w)));
  assert.ok(lottieItems(lottie).some((x) => x.ty === 'sh'), 'фигуры символа экспортированы');
});
