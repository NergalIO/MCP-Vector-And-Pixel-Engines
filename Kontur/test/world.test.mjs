// 2.5D-мир (engine/world3d.js): эталоны сборки и поведение версии 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const golden = fileURLToPath(new URL('world-golden.mjs', import.meta.url));

test('эталоны сборки мира (test/world.golden.json)', () => {
  execFileSync(process.execPath, [golden], { stdio: 'pipe' });
});

/* ---------------- версия 2: подсиды, стабильные id, кэш, правка предмета, lod/merge/pan ---------------- */
import * as W3 from '../engine/world3d.js';
import { worldBuild, worldItemEdit, subtreeIds } from '../mcp/world_ops.mjs';

const CAM = { ...W3.CAMERA_DEFAULT, cx: 960 };
const HOUSES = [
  { id: 'a', type: 'house', x: [-14, -6], z: [12, 20], h: 9, mat: 'brick', litP: 0.5 },
  { id: 'b', type: 'house', x: [-5, 4], z: [14, 22], h: 11, mat: 'plaster', litP: 0.5 },
  { id: 'c', type: 'house', x: [6, 14], z: [12, 20], h: 8, mat: 'stone', litP: 0.5 },
];
const newScene = () => ({ version: 1, width: 1920, height: 1080, duration: 4, fps: 30, nodes: [], camera3d: { ...CAM } });
/** Узлы предмета: его элементы — группы `<group>_<id>-<k>` под корнем — с поддеревьями (для сравнения между сборками). */
const itemNodes = (scene, group, id) => {
  const ids = new Set();
  for (const n of scene.nodes) if (n.parent === group && n.id.startsWith(`${group}_${id}-`)) for (const k of subtreeIds(scene, n.id)) ids.add(k);
  return JSON.stringify(scene.nodes.filter((n) => ids.has(n.id)));
};
const build = (o) => W3.buildWorld({ width: 1920, height: 1080, camera3d: CAM, ...o });

test('v2: случайные решения не зависят от камеры (окна и свет в 3D одинаковы)', () => {
  // коробка с материалом впереди: её верх виден только с высокой камеры (v1 тратил на него общий поток случайных чисел)
  const items = [{ id: 'k', type: 'box', x: [-3, -1], y: [0, 2], z: [6, 8], mats: { all: ['tile', '#a05040'] } }, ...HOUSES];
  const at = (cam, v) => {
    const S = build({ items, camera3d: cam, v, lod: 0, merge: false }).S;
    const front = S.items.flatMap((it) => it.prims).filter((p) => p.ps && p.n?.[2] < -0.99).map((p) => [p.ps, p.alb]);
    return JSON.stringify([front, S.lights.map((l) => l.p)]);
  };
  for (const camH of [0.8, 12]) {
    assert.equal(at({ ...CAM, camH }, 2), at(CAM, 2), `v2, camH ${camH}`);
    assert.notEqual(at({ ...CAM, camH }, 1), at(CAM, 1), `v1 зависел от камеры (camH ${camH})`);
  }
});

test('v2: правка одного предмета не меняет остальные; id узлов стабильны', () => {
  const sc = newScene();
  worldBuild(sc, { items: HOUSES, group: 'w' });
  assert.ok(itemNodes(sc, 'w', 'a').length > 1000);
  const a0 = itemNodes(sc, 'w', 'a'), c0 = itemNodes(sc, 'w', 'c'), b0 = itemNodes(sc, 'w', 'b');
  const r = worldItemEdit(sc, { group: 'w', id: 'b', patch: { h: 6, litP: null } });
  assert.equal(r.index, 1);
  assert.equal(itemNodes(sc, 'w', 'a'), a0);
  assert.equal(itemNodes(sc, 'w', 'c'), c0);
  assert.notEqual(itemNodes(sc, 'w', 'b'), b0);
  const g = sc.nodes.find((n) => n.id === 'w');
  assert.equal(g.props.world3d.items[1].h, 6);
  assert.ok(!('litP' in g.props.world3d.items[1]), 'patch null удаляет поле');
  // кэш: неизменённые предметы взяты из прошлой сборки
  assert.deepEqual(r.stats.map((s) => !!s.cached), [true, false, true]);
});

test('v2: предметам без id даются id по номеру, удаление не сдвигает остальных', () => {
  const sc = newScene();
  worldBuild(sc, { items: HOUSES.map(({ id, ...d }) => d), group: 'w' });
  assert.deepEqual(sc.nodes.find((n) => n.id === 'w').props.world3d.items.map((d) => d.id), [0, 1, 2]);
  const c0 = itemNodes(sc, 'w', 2);
  worldItemEdit(sc, { group: 'w', index: 0, remove: true });
  assert.equal(itemNodes(sc, 'w', 2), c0);
  assert.equal(itemNodes(sc, 'w', 0), '[]');
  const r = worldItemEdit(sc, { group: 'w', add: { type: 'lamp', X: 0, Z: 8 } });
  assert.equal(r.index, 2);
  assert.equal(itemNodes(sc, 'w', 2), c0, 'старый предмет 2 не тронут');
  assert.ok(sc.nodes.some((n) => n.id === 'w_2_1-0'), 'новый предмет получил свободный id 2_1');
  assert.equal(sc.nodes.find((n) => n.id === 'w').props.world3d.items[2].id, '2_1');
});

test('v2: сборка из кэша совпадает со свежей', () => {
  const sc1 = newScene(), sc2 = newScene();
  worldBuild(sc1, { items: HOUSES, group: 'k1' });
  const r = worldBuild(sc1, { items: HOUSES, group: 'k1' });
  assert.ok(r.stats.every((s) => s.cached));
  worldBuild(sc2, { items: HOUSES, group: 'k1x' });
  const strip = (sc, g) => JSON.stringify(sc.nodes).replaceAll(`"${g}`, '"G');
  assert.equal(strip(sc1, 'k1'), strip(sc2, 'k1x'));
});

test('v2: повторяющиеся id — ошибка, предмет не строится', () => {
  const r = build({ items: [HOUSES[0], { ...HOUSES[1], id: 'a' }], v: 2 });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /id «a»/);
});

test('схема предметов: обязательные поля, типы, опечатки', () => {
  const e = W3.checkWorldItem({ type: 'house', x: [0, 4], heigth: 5, roofType: 'dome' });
  assert.ok(e.errors.some((s) => s.includes('z')), 'нет z');
  assert.ok(e.errors.some((s) => s.includes('roofType')), 'неверный enum');
  assert.ok(e.warnings.some((s) => s.includes('«heigth»')));
  assert.deepEqual(W3.checkWorldItem(HOUSES[0]), { errors: [], warnings: [] });
  assert.match(W3.checkWorldItem({ type: 'teapot' }).errors[0], /неизвестный тип/);
  const r = build({ items: [{ type: 'box', x: [0, 1] }, { type: 'lamp', X: 0, Z: 5 }], v: 2 });
  assert.equal(r.errors.length, 1);
  assert.ok(r.S.lights.length === 1, 'ошибка в одном предмете не мешает остальным');
});

test('merge и lod уменьшают число узлов', () => {
  const items = [{ type: 'ground', x: [-20, 20], z: [0, 40] }, ...HOUSES];
  const count = (o) => W3.toNodes(build({ items, v: 2, ...o }).S).nodes.length;
  const full = count({ lod: 0, merge: false }), merged = count({ lod: 0 }), lod2 = count({ lod: 2, merge: false });
  assert.ok(merged * 5 < full, `merge: ${merged} vs ${full}`);
  assert.ok(lod2 < full, `lod2: ${lod2} vs ${full}`);
});

test('новые предметы строятся без ошибок; array и scatter размножают предмет', async () => {
  const { ITEMS2 } = await import('./world-golden.mjs');
  for (const [k, d] of Object.entries(ITEMS2)) {
    const r = build({ items: [d], v: 2 });
    assert.deepEqual([k, r.errors, r.warnings], [k, [], []]);
    assert.ok(W3.toNodes(r.S).nodes.length > 1, k);
  }
  const cyl = { type: 'cyl', X: 0, Z: 0, r: 0.2, y: [0, 1] };
  const n1 = build({ items: [{ ...cyl, Z: 6 }], v: 2 }).S.items.length;
  const n4 = build({ items: [{ type: 'array', item: cyl, count: 4, step: [1, 0, 0], at: [0, 0, 6] }], v: 2 }).S.items.length;
  assert.equal(n4, n1 * 4);
  const sc = build({ items: [{ type: 'scatter', item: { ...cyl, Z: 0 }, area: { x: [-6, 6], z: [4, 12] }, count: 6, minDist: 1.5 }], v: 2 }).S;
  assert.equal(sc.items.length, n1 * 6);
});

test('анимация света и проезд камеры дают ключи', () => {
  const sc = newScene();
  worldBuild(sc, { items: [{ id: 'l', type: 'lamp', X: 0, Z: 6, anim: { flicker: 0.4 } }, { id: 'near', type: 'box', x: [-1, 1], z: [4, 5] }, { id: 'far', type: 'box', x: [-1, 1], z: [30, 31] }], group: 'p', pan: [[0, 0], [2, 1]] });
  const light = sc.nodes.find((n) => n.type === 'light');
  assert.ok(light?.keys?.energy?.length > 2, 'ключи energy у света');
  const dx = (id) => Math.abs(sc.nodes.find((n) => n.id === `p_${id}-0`).keys.x.at(-1)[1]);
  assert.ok(dx('near') > dx('far') * 3, `параллакс: ${dx('near')} vs ${dx('far')}`);
  assert.equal(sc.nodes.find((n) => n.id === 'p').props.world3d.pan.length, 2, 'pan сохранён для пересборки');
});
