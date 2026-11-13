// Сессия сервера: история дельтами, откат транзакции, отложенная атомарная запись с .bak, починка при загрузке,
// только чтение, независимые сессии в одном процессе.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ops } from '../engine/kontur.js';
import { Session } from '../mcp/session.mjs';

const dir = mkdtempSync(join(tmpdir(), 'kontur-session-'));
/** Сессия с файлом name в общей временной папке (закрывается после теста). */
function open(t, name, opts = {}) {
  const s = new Session({ scenePath: join(dir, name), ...opts });
  t.after(() => s.close());
  s.initialLoad();
  return s;
}

test('mutate → undo/redo дельтами, неизменённые узлы остаются теми же объектами', (t) => {
  const st = open(t, 'a.json');
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
  assert.deepEqual(st.historyInfo().redo, ['bg']);
});

test('ошибка в транзакции откатывает сцену', (t) => {
  const st = open(t, 'b.json');
  st.mutate('a', () => ops.addNode(st.scene, { id: 'a', type: 'rect' }));
  const before = JSON.stringify(st.scene), rev = st.rev;
  assert.throws(() => st.mutate('bad', () => { st.scene.nodes[0].parent = 'nope'; }), /родитель/);
  assert.equal(JSON.stringify(st.scene), before);
  assert.throws(() => st.mutate('bad2', () => { ops.addNode(st.scene, { id: 'q', type: 'rect' }); throw new Error('boom'); }), /boom/);
  assert.ok(!st.scene.nodes.some((n) => n.id === 'q'));
  assert.equal(st.rev, rev, 'неудачная транзакция не меняет версию');
});

test('запись отложенная и атомарная, прежний файл — в .bak', (t) => {
  const f = join(dir, 'c.json');
  writeFileSync(f, JSON.stringify({ width: 100, height: 100, duration: 1, nodes: [] }));
  const was = readFileSync(f, 'utf8');
  const st = open(t, 'c.json');
  const seen = [];
  st.onChange((rev, info) => seen.push(info.label));
  st.mutate('c', () => ops.addNode(st.scene, { id: 'c', type: 'circle' }));
  st.mutate('c2', () => ops.updateNode(st.scene, 'c', { props: { r: 9 } }));
  assert.deepEqual(seen, ['c', 'c2'], 'подписчики оповещены сразу');
  assert.ok(st.savePending(), 'правки ждут записи');
  assert.equal(readFileSync(f, 'utf8'), was, 'файл не переписывается на каждой правке');
  assert.ok(st.flushSave());
  assert.ok(!st.savePending());
  assert.equal(readFileSync(f + '.bak', 'utf8'), was);
  assert.ok(JSON.parse(readFileSync(f, 'utf8')).nodes.some((n) => n.id === 'c'));
  assert.ok(!readdirSync(dir).some((x) => x.endsWith('.tmp')), 'временных файлов не осталось');
});

test('saveDelay: 0 — запись на каждой правке', (t) => {
  const st = open(t, 'd.json', { saveDelay: 0 });
  st.mutate('a', () => ops.addNode(st.scene, { id: 'now', type: 'rect' }));
  assert.ok(!st.savePending());
  assert.ok(readFileSync(join(dir, 'd.json'), 'utf8').includes('"now"'));
});

test('висячие ссылки чинятся при загрузке', (t) => {
  writeFileSync(join(dir, 'dangling.json'), JSON.stringify({ width: 100, height: 100, duration: 1, nodes: [{ id: 'm', type: 'rect', props: { mask: 'gone' } }, { id: 'k', type: 'rect', parent: 'gone' }] }));
  const st = open(t, 'dangling.json');
  assert.ok(st.loadNotes.length >= 2);
  assert.equal(st.scene.nodes[0].props.mask, undefined);
  assert.equal(st.scene.nodes[1].parent, null);
});

test('несчитываемый файл не перезаписывается (только чтение)', (t) => {
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{"nodes": [ сломано');
  const st = open(t, 'bad.json');
  assert.ok(st.readOnly);
  st.mutate('x', () => ops.addNode(st.scene, { id: 'zz', type: 'rect' }));
  st.flushSave();
  assert.equal(readFileSync(bad, 'utf8'), '{"nodes": [ сломано', 'файл не тронут');
  const note = st.newScene({});
  assert.match(note, /scene-1\.json/);
  assert.equal(st.readOnly, null);
  assert.ok(existsSync(join(dir, 'scene-1.json')));
});

test('сессии независимы: своя сцена, история и файл', (t) => {
  const a = open(t, 'one.json'), b = open(t, 'two.json');
  a.mutate('a', () => ops.addNode(a.scene, { id: 'only-a', type: 'rect' }));
  assert.equal(b.scene.nodes.length, 0);
  assert.equal(b.undo(), null, 'у второй сессии своя история');
  a.flushSave();
  assert.ok(existsSync(join(dir, 'one.json')) && !existsSync(join(dir, 'two.json')));
});
