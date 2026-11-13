// Протокол MCP глазами агента: прогресс, отмена (идущего и ещё не начатого вызова), ping и отмена вне очереди,
// краткие описания инструментов с полным текстом в docs { tool }, пути от папки сцены, отмена долгого экспорта.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler, serveStdio, progressReporter } from '../mcp/rpc.mjs';
import { createTools, checkTools, DESC_MAX } from '../mcp/tools/index.mjs';
import { Session } from '../mcp/session.mjs';
import { exportVideo } from '../mcp/render.mjs';
import { createScene, ops } from '../engine/kontur.js';
import { needRaster } from './helpers/common.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (p) => mkdtempSync(join(tmpdir(), `kontur-${p}-`));
const idle = () => ({ signal: new AbortController().signal, progress() {} });

/** Обработчик с поддельными инструментами: slow ждёт release() или отмены, fast отвечает сразу. */
function harness() {
  const out = [], calls = [];
  let release = () => {};
  const tools = [
    {
      name: 'slow', description: 'ждёт', inputSchema: { type: 'object' },
      run: (a, { signal, progress }) => new Promise((res, rej) => {
        calls.push('slow');
        progress(1, 2, 'половина');
        signal.addEventListener('abort', () => rej(signal.reason));
        release = () => res({ content: [{ type: 'text', text: 'готово' }] });
      }),
    },
    { name: 'fast', description: 'сразу', inputSchema: { type: 'object' }, run: () => { calls.push('fast'); return { content: [{ type: 'text', text: 'ok' }] }; } },
  ];
  const write = (m) => out.push(m);
  return { out, calls, write, handle: createHandler({ tools, write }), release: () => release() };
}

test('прогресс: только растёт, не чаще раза в 100 мс, последний шаг — всегда; без токена — ничего', async () => {
  const out = [];
  const p = progressReporter('tk', (m) => out.push(m));
  p(0, 3, 'старт'); p(1, 3); p(1, 3); p(0.5, 3); p(3, 3, 'готово');
  assert.deepEqual(out, [
    { method: 'notifications/progress', params: { progressToken: 'tk', progress: 0, total: 3, message: 'старт' } },
    { method: 'notifications/progress', params: { progressToken: 'tk', progress: 3, total: 3, message: 'готово' } },
  ]);
  p(2, 3);
  assert.equal(out.length, 2, 'значение меньше прежнего не отправляется');
  await wait(110);
  p(4);
  assert.deepEqual(out.at(-1).params, { progressToken: 'tk', progress: 4 }, 'через 100 мс — снова, total не обязателен');
  progressReporter(undefined, () => assert.fail('без токена ничего не отправляется'))(1, 2);
});

test('отмена идущего вызова: инструмент видит signal, ответа на вызов нет', async () => {
  const h = harness();
  const call = h.handle({ id: 1, method: 'tools/call', params: { name: 'slow', arguments: {}, _meta: { progressToken: 7 } } });
  await h.handle({ method: 'notifications/cancelled', params: { requestId: 1, reason: 'передумал' } });
  await call;
  assert.deepEqual(h.out, [{ method: 'notifications/progress', params: { progressToken: 7, progress: 1, total: 2, message: 'половина' } }]);
  await h.handle({ id: 2, method: 'tools/call', params: { name: 'fast' } });
  assert.equal(h.out.at(-1).id, 2, 'следующий вызов работает');
});

test('отмена до начала: вызов пропускается без ответа', async () => {
  const h = harness();
  await h.handle({ method: 'notifications/cancelled', params: { requestId: 5 } });
  await h.handle({ id: 5, method: 'tools/call', params: { name: 'fast' } });
  assert.deepEqual([h.calls, h.out], [[], []]);
  await h.handle({ id: 5, method: 'tools/call', params: { name: 'fast' } });
  assert.equal(h.out[0]?.id, 5, 'пометка об отмене одноразовая');
});

test('stdio: ping и отмена обрабатываются сразу, пока идёт долгий вызов; закрытие отменяет идущий', async () => {
  const h = harness();
  const input = new PassThrough();
  let closed = false;
  serveStdio(h.handle, { input, write: h.write, onClose: () => { closed = true; } });
  const line = (m) => input.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  line({ id: 1, method: 'tools/call', params: { name: 'slow' } });
  line({ id: 2, method: 'tools/call', params: { name: 'fast' } });
  line({ id: 3, method: 'ping' });
  await wait(30);
  assert.deepEqual(h.out.map((m) => m.id), [3], 'ping ответил сразу, fast ждёт очереди');
  line({ method: 'notifications/cancelled', params: { requestId: 2 } });
  await wait(30);
  h.release();
  await wait(30);
  assert.deepEqual(h.out.map((m) => m.id), [3, 1], 'slow ответил, отменённый в очереди fast — нет');
  assert.deepEqual(h.calls, ['slow']);
  line({ id: 4, method: 'tools/call', params: { name: 'slow' } });
  await wait(30);
  input.end();
  await wait(30);
  assert.ok(closed, 'onClose после закрытия входа');
  assert.ok(!h.out.some((m) => m.id === 4), 'идущий вызов отменён при отключении клиента, ответа нет');
});

test('описания: не длиннее DESC_MAX, полный текст — docs { tool }', (t) => {
  const s = new Session({ scenePath: join(tmp('desc'), 'd.json') });
  t.after(() => s.close());
  const tools = createTools(s);
  for (const x of tools) assert.ok(x.description.length <= DESC_MAX, `${x.name}: ${x.description.length}`);
  const docs = tools.find((x) => x.name === 'docs');
  const wb = docs.run({ tool: 'world_build' }).content[0].text;
  assert.ok(wb.length > 3000 && wb.includes('seed'), 'полное описание world_build');
  assert.match(docs.run({ tool: 'scene_info' }).content[0].text, /^scene_info: Сводка/, 'без help — обычное описание');
  assert.throws(() => docs.run({ tool: 'nope' }), /Нет инструмента nope/);
  assert.match(checkTools([{ name: 'x', description: 'a'.repeat(DESC_MAX + 1), run() {}, inputSchema: { type: 'object' } }]).join(), /длиннее/);
  const bytes = Buffer.byteLength(JSON.stringify(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))));
  assert.ok(bytes < 45000, `tools/list ${bytes} байт`);
});

test('пути: запись — от папки сцены, чтение — сначала из неё, потом из рабочей папки', async (t) => {
  const base = tmp('paths'), dir = join(base, 'scenes'), cwd = process.cwd();
  const s = new Session({ scenePath: join(dir, 'a.json'), saveDelay: 0 });
  t.after(() => { process.chdir(cwd); s.close(); });
  s.initialLoad();
  assert.equal(s.resolvePath('out/x.png'), join(dir, 'out', 'x.png'));
  assert.equal(s.resolvePath(join(base, 'abs.png')), join(base, 'abs.png'), 'абсолютный — как есть');
  mkdirSync(join(dir, 'img'), { recursive: true });
  writeFileSync(join(dir, 'img', 'a.png'), 'x');
  writeFileSync(join(base, 'only-cwd.png'), 'x');
  process.chdir(base);
  assert.equal(s.findPath('img/a.png'), join(dir, 'img', 'a.png'));
  assert.equal(s.findPath('only-cwd.png'), join(base, 'only-cwd.png'), 'нет в папке сцены — из рабочей');
  assert.equal(s.findPath('nope.png'), join(dir, 'nope.png'), 'нигде нет — путь от папки сцены (для ошибки)');
  const run = (name, args) => createTools(s).find((x) => x.name === name).run(args, idle());
  await run('export', { format: 'json', path: 'out/scene.json' });
  assert.ok(existsSync(join(dir, 'out', 'scene.json')), 'export пишет относительно папки сцены, а не рабочей');
  run('scene_save_as', { path: '../other/b.json' });
  assert.equal(s.scenePath, join(base, 'other', 'b.json'));
  assert.ok(existsSync(s.scenePath));
});

test('отмена долгого экспорта: видео и запекание слоёв останавливаются по signal', async (t) => {
  const ac = new AbortController();
  ac.abort(Object.assign(new Error('стоп'), { name: 'AbortError' }));
  const sc = createScene({ width: 320, height: 180, duration: 1 });
  ops.addNode(sc, { id: 'r', type: 'rect', props: { x: 10, y: 10, width: 50, height: 50, fill: '#f00' } });
  const dir = tmp('abort');
  await assert.rejects(exportVideo(sc, join(dir, 'v.mp4'), { signal: ac.signal }), { name: 'AbortError' });
  assert.ok(!existsSync(join(dir, 'v.mp4')));
  if (!(await needRaster(t))) return;
  const s = new Session({ scenePath: join(dir, 'g.json') });
  t.after(() => s.close());
  s.initialLoad();
  s.replaceScene('тест', sc);
  const exp = createTools(s).find((x) => x.name === 'export');
  const notes = [];
  await assert.rejects(exp.run({ format: 'godot', path: 'godot' }, { signal: ac.signal, progress: (...a) => notes.push(a) }), { name: 'AbortError' });
  assert.deepEqual(notes, [[0, undefined, 'godot: разметка слоёв']], 'прогресс дошёл до разметки, дальше — отмена');
});
