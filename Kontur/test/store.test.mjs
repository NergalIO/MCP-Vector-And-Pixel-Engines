// Хранилище сервера: история дельтами, откат транзакции, атомарная запись с .bak, починка при загрузке, только чтение.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kontur-store-'));
const f = join(dir, 'a.json');
const bad = join(dir, 'bad.json');
process.env.KONTUR_SCENE = f;
const { ops } = await import('../engine/kontur.js');
const st = await import('../mcp/store.mjs');

test('mutate → undo/redo дельтами, неизменённые узлы остаются теми же объектами', () => {
  st.initialLoad(f);
  st.mutate('a', () => { ops.addNode(st.scene, { id: 'a', type: 'rect', props: { x: 1 } }); ops.addNode(st.scene, { id: 'b', type: 'rect' }); });
  const b0 = st.scene.nodes.find((n) => n.id === 'b');
  st.mutate('x', () => ops.updateNode(st.scene, 'a', { props: { x: 5 } }));
  assert.equal(st.scene.nodes[0].props.x, 5);
  assert.equal(st.undo(), 'x');
  assert.equal(st.scene.nodes[0].props.x, 1);
  assert.equal(st.scene.nodes.find((n) => n.id === 'b'), b0, 'узел b не пересоздан');
  assert.equal(st.redo(), 'x');
  assert.equal(st.scene.nodes[0].props.x, 5);
  st.mutate('rm', () => ops.removeNode(st.scene, 'a'));
  assert.deepEqual(st.scene.nodes.map((n) => n.id), ['b']);
  st.undo();
  assert.deepEqual(st.scene.nodes.map((n) => n.id), ['a', 'b'], 'порядок восстановлен');
  st.mutate('bg', () => { st.scene.background = '#123456'; });
  st.undo();
  assert.notEqual(st.scene.background, '#123456', 'настройки сцены откатываются');
});

test('ошибка в транзакции откатывает сцену', () => {
  const before = JSON.stringify(st.scene);
  assert.throws(() => st.mutate('bad', () => { st.scene.nodes[0].parent = 'nope'; }), /родитель/);
  assert.equal(JSON.stringify(st.scene), before);
  assert.throws(() => st.mutate('bad2', () => { ops.addNode(st.scene, { id: 'q', type: 'rect' }); throw new Error('boom'); }), /boom/);
  assert.ok(!st.scene.nodes.some((n) => n.id === 'q'));
});

test('запись атомарная, прежний файл — в .bak', () => {
  writeFileSync(f, readFileSync(f, 'utf8')); // файл есть
  const was = readFileSync(f, 'utf8');
  st.openPath(f);
  st.mutate('c', () => ops.addNode(st.scene, { id: 'c', type: 'circle' }));
  assert.equal(readFileSync(f + '.bak', 'utf8'), was);
  assert.ok(JSON.parse(readFileSync(f, 'utf8')).nodes.some((n) => n.id === 'c'));
  assert.ok(!readdirSync(dir).some((x) => x.endsWith('.tmp')), 'временных файлов не осталось');
});

test('висячие ссылки чинятся при загрузке', () => {
  const g = join(dir, 'dangling.json');
  writeFileSync(g, JSON.stringify({ width: 100, height: 100, duration: 1, nodes: [{ id: 'm', type: 'rect', props: { mask: 'gone' } }, { id: 'k', type: 'rect', parent: 'gone' }] }));
  st.openPath(g);
  assert.ok(st.loadNotes.length >= 2);
  assert.equal(st.scene.nodes[0].props.mask, undefined);
  assert.equal(st.scene.nodes[1].parent, null);
});

test('несчитываемый файл не перезаписывается (только чтение)', () => {
  writeFileSync(bad, '{"nodes": [ сломано');
  st.initialLoad(bad);
  assert.ok(st.readOnly);
  st.mutate('x', () => ops.addNode(st.scene, { id: 'zz', type: 'rect' }));
  assert.equal(readFileSync(bad, 'utf8'), '{"nodes": [ сломано', 'файл не тронут');
  const note = st.newScene({});
  assert.match(note, /scene-1\.json/);
  assert.equal(st.readOnly, null);
  assert.ok(existsSync(join(dir, 'scene-1.json')));
});
