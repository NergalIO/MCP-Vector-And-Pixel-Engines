// Надёжность и производительность сервера: очередь рендеров, ограниченные кеши файлов, замена упавших воркеров
// пула, остановка ffmpeg при ошибке экспорта, отложенная запись сцены (и запись при выходе), кеш списка /scenes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';

process.env.KONTUR_THREADS = '3'; // пул из двух воркеров и на машине с одним ядром (до импорта pool.mjs)
const { createQueue, Superseded } = await import('../mcp/queue.mjs');
const { stampCache } = await import('../mcp/files.mjs');
const { createScene, ops } = await import('../engine/kontur.js');
const { startServer } = await import('./helpers/mcp-child.mjs');
const { needRaster } = await import('./helpers/common.mjs');

const tmp = (p) => mkdtempSync(join(tmpdir(), `kontur-${p}-`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('очередь: по одной задаче, ждущая с тем же ключом заменяется, отмена снимает из очереди', async () => {
  const q = createQueue(1);
  const log = [];
  let release;
  const first = q.run(() => new Promise((r) => { log.push('a'); release = r; }));
  const b = q.run(() => log.push('b'), { key: 'k' });
  const c = q.run(() => { log.push('c'); return 'c'; }, { key: 'k' });
  const ac = new AbortController();
  const d = q.run(() => log.push('d'), { signal: ac.signal });
  assert.deepEqual(q.stats(), { active: 1, waiting: 2 });
  await assert.rejects(b, Superseded);
  ac.abort();
  await assert.rejects(d, { name: 'AbortError' });
  release('a');
  assert.equal(await first, 'a');
  assert.equal(await c, 'c');
  assert.deepEqual(log, ['a', 'c'], 'заменённая и отменённая задачи не выполнялись');
  await assert.rejects(q.run(() => { throw new Error('boom'); }), /boom/);
  assert.equal(await q.run(() => 5), 5, 'после ошибки очередь работает');
});

test('кеш файлов: только последняя версия, вытеснение по числу и весу', () => {
  const c = stampCache({ max: 3, maxWeight: 10, weigh: (v) => v?.length || 0 });
  c.set('a', 'a|1', 'xxx');
  assert.equal(c.get('a', 'a|1'), 'xxx');
  c.set('a', 'a|2', 'yyyy'); // файл изменился — прежняя версия не копится
  assert.equal(c.size, 1);
  assert.equal(c.get('a', 'a|1'), undefined);
  c.set('n', 'n|1', null);
  assert.equal(c.get('n', 'n|1'), null, 'null — запомненный результат, а не промах');
  c.set('b', 'b|1', 'zz');
  c.get('a', 'a|2'); // a использована недавно
  c.set('c', 'c|1', 'qq');
  assert.equal(c.size, 3);
  assert.equal(c.get('n', 'n|1'), undefined, 'вытеснена самая давняя');
  c.set('d', 'd|1', 'wwwww'); // вес 4 + 2 + 2 + 5 > 10
  assert.ok(c.weight <= 10 && c.get('d', 'd|1') === 'wwwww');
});

test('пул потоков: упавший воркер заменяется, его задача досчитывается в главном потоке', async () => {
  const { task, rows, poolInfo, i32 } = await import('../mcp/lit/pool.mjs');
  const mod = new URL('./helpers/pool-kernels.mjs', import.meta.url).href;
  const K = await import(mod);
  const local = (fn) => (a) => K[fn](a).result;
  assert.deepEqual(await task(mod, 'double', { x: 2 }, local('double')), { y: 4, where: 'worker' });
  const before = poolInfo();
  assert.equal(before.workers, 2);
  const r = await task(mod, 'crash', { x: 5 }, local('crash'));
  assert.deepEqual(r, { y: 10, where: 'main' });
  assert.equal(poolInfo().deaths, before.deaths + 1);
  const again = await task(mod, 'double', { x: 7 }, local('double'));
  assert.equal(again.y, 14);
  assert.equal(poolInfo().workers, 2, 'на место упавшего запущен новый');
  const out = i32(256);
  assert.equal(rows(mod, K.fillRows, { out }, 256), 256);
  assert.equal(out[255], 510);
});

test('экспорт видео: ошибка кадра останавливает ffmpeg и удаляет недописанный файл', async (t) => {
  if (!(await needRaster(t))) return;
  const R = await import('../mcp/render.mjs');
  if (!R.capabilities.ffmpeg) return t.skip('нет ffmpeg');
  const s = createScene({ width: 64, height: 64, duration: 1, fps: 10 });
  ops.addNode(s, { id: 'r', type: 'rect', props: { x: 32, y: 32, width: 20, height: 20, fill: '#f00' } });
  // с 0.5 с — 500 × 500 × 500 копий: кадры второй половины не считаются
  ops.addNode(s, { id: 'g', type: 'group', props: { inPoint: 0.5, repeat: { count: 500 } } });
  ops.addNode(s, { id: 'h', type: 'group', parent: 'g', props: { repeat: { count: 500 } } });
  ops.addNode(s, { id: 'b', type: 'rect', parent: 'h', props: { repeat: { count: 500 } } });
  const out = join(tmp('video'), 'v.mp4');
  await assert.rejects(R.exportVideo(s, out, { fps: 10 }), /вложенные повторы/);
  assert.ok(!existsSync(out), 'недописанного файла нет');
  assert.equal(R.runningChildren(), 0, 'ffmpeg не остался ждать кадров');
  ops.removeNode(s, 'g');
  await R.exportVideo(s, out, { fps: 10 });
  assert.ok(existsSync(out));
});

test('сервер: /scenes видит изменения файлов, отложенная запись сохраняется при выходе', async () => {
  const dir = tmp('reliab');
  const scenePath = join(dir, 'main.json');
  const sq = createScene({ width: 64, height: 64, duration: 1 });
  writeFileSync(scenePath, JSON.stringify(sq));
  const other = join(dir, 'other.json');
  const withNodes = (k) => { const s = createScene(); for (let i = 0; i < k; i++) ops.addNode(s, { id: 'n' + i, type: 'rect' }); return JSON.stringify(s); };
  writeFileSync(other, withNodes(2));
  writeFileSync(join(dir, 'notes.json'), '{"не сцена": true}');
  const port = 20000 + Math.floor(Math.random() * 20000), token = 'rel-' + port;
  const S = startServer({ env: { KONTUR_SCENE: scenePath, KONTUR_PORT: String(port), KONTUR_TOKEN: token, KONTUR_SAVE_DELAY: '60000' }, failOnExit: false });
  const exited = once(S.srv, 'exit');
  try {
    await S.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const url = (await S.call('preview_url')).content[0].text.match(/http:\/\/\S+?\//)[0];
    const scenes = async () => (await (await fetch(url + 'scenes', { headers: { 'x-kontur-token': token } })).json()).scenes;
    const count = (list, name) => list.find((x) => x.name === name)?.nodes;
    const list = await scenes();
    assert.equal(count(list, 'other.json'), 2);
    assert.ok(!list.some((x) => x.name === 'notes.json'), 'JSON без nodes — не сцена');
    writeFileSync(other, withNodes(5));
    assert.equal(count(await scenes(), 'other.json'), 5, 'изменённый файл разобран заново');
    rmSync(other);
    assert.ok(!(await scenes()).some((x) => x.name === 'other.json'));

    // запись отложена на минуту — до выхода файл не меняется, при закрытии stdin изменения записываются
    await S.call('node_add', { id: 'late', type: 'rect', props: { x: 10, y: 10, width: 5, height: 5 } });
    await wait(200);
    assert.ok(!readFileSync(scenePath, 'utf8').includes('"late"'), 'запись отложена');
  } finally { S.srv.stdin.end(); }
  const [code] = await exited;
  assert.equal(code, 0, S.stderr().slice(-500));
  assert.ok(JSON.parse(readFileSync(scenePath, 'utf8')).nodes.some((n) => n.id === 'late'), 'при выходе сцена записана');
});
