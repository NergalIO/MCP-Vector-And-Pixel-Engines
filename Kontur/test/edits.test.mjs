// Сквозной тест режима правок и новых инструментов MCP-сервера:
// сцена из «скрипта» (*.kontur.json рядом с *.build.mjs) → правки в *.edits.json → пересборка → правки на месте.
// node --test test/edits.test.mjs (шаги идут по порядку на одном сервере)
import { test, after } from 'node:test';
import { writeFileSync, readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodePNG } from '../mcp/normals.mjs';
import { startServer, txt, check } from './helpers/mcp-child.mjs';

const dir = mkdtempSync(join(tmpdir(), 'kontur-edits-'));
const sceneFile = join(dir, 'room.kontur.json'), editsFile = join(dir, 'room.edits.json');
const PORT = 7000 + Math.floor(Math.random() * 900);
// «скрипт сборки» — просто функция, которая пишет сцену; build.mjs нужен только как признак
const build = (variant) => {
  const scene = {
    kontur: 1, width: 400, height: 300, duration: 2, fps: 24, background: '#202830',
    nodes: [
      { id: 'floor', type: 'rect', props: { x: 200, y: 260, width: 400, height: 80, fill: variant === 2 ? '#556070' : '#445060' } },
      { id: 'lamp', type: 'group', props: { x: 200, y: 60 } },
      { id: 'shade', type: 'ellipse', parent: 'lamp', props: { rx: 30, ry: 14, fill: '#c8a050' } },
      { id: 'glow', type: 'ellipse', parent: 'lamp', props: { y: 60, rx: 90, ry: 70, fill: '#ffe0a0', opacity: 0.25 } },
      { id: 'box', type: 'rect', props: { x: 100, y: 200, width: 60, height: 40, fill: '#806040' } },
      ...(variant === 2 ? [{ id: 'poster', type: 'rect', props: { x: 320, y: 120, width: 50, height: 70, fill: '#a04040' } }] : []),
    ],
  };
  writeFileSync(sceneFile, JSON.stringify(scene, null, 1));
};
build(1);
writeFileSync(join(dir, 'room.build.mjs'), '// признак: сцену пишет скрипт\n');

const { srv, rpc, call, notify, stderr } = startServer({ env: { KONTUR_SCENE: sceneFile, KONTUR_PORT: String(PORT), KONTUR_TOKEN: 'edits-' + PORT }, failOnExit: false });
const sceneNow = async () => JSON.parse(txt(await call('scene_get_json')));
const node = (s, nid) => s.nodes.find((n) => n.id === nid);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** JSON файла, как только он удовлетворит ok (запись сцены отложенная), или последнее прочитанное через 4 с. */
const jsonWhen = async (file, ok) => {
  let j = null;
  for (const t0 = Date.now(); Date.now() - t0 < 4000; await wait(50)) { try { j = JSON.parse(readFileSync(file, 'utf8')); if (ok(j)) return j; } catch {} }
  return j;
};
const http = async (path, init) => { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { ...init, headers: { ...(init?.headers || {}), 'x-kontur-token': 'edits-' + PORT } }); if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`); return r; };

after(() => srv.kill());
/** Шаг сценария; при провале к ошибке добавляется хвост stderr сервера. */
const step = (name, fn) => test(name, async () => {
  try { await fn(); } catch (e) { e.message += '\n--- stderr сервера ---\n' + stderr().split('\n').slice(-15).join('\n'); throw e; }
});
let s; // сцена, как её видит сервер (общая между шагами)

step('правки пишутся в .edits.json, исходный файл не тронут', async () => {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  notify('notifications/initialized');
  const before = readFileSync(sceneFile, 'utf8');

  check(/Правки: .*room\.edits\.json/.test(txt(await call('scene_info'))), 'build.mjs рядом → сцена открыта в режиме правок');
  await call('node_update', { id: 'box', props: { x: 140, fill: '#30a060' } });
  await call('node_add', { id: 'crate', type: 'rect', props: { x: 60, y: 230, width: 30, height: 30, fill: '#705030' } });
  await call('node_remove', { id: 'glow' });
  check(readFileSync(sceneFile, 'utf8') === before, 'исходный файл сцены не тронут');
  const ed = await jsonWhen(editsFile, (e) => e.removed?.includes('glow')); // запись отложенная
  check(ed.nodes.box?.props?.x === 140 && ed.removed.includes('glow') && ed.order.some((o) => o.id === 'crate' && o.add), 'правки записаны в room.edits.json (изменение, добавление, удаление)');

});

step('пересборка скрипта: правки ложатся сверху', async () => {
  // «пересборка»: скрипт меняет пол и добавляет плакат
  build(2);
  await wait(1800);
  s = await sceneNow();
  check(node(s, 'floor').props.fill === '#556070' && node(s, 'poster'), 'после пересборки видна новая сцена из скрипта');
  check(node(s, 'box').props.x === 140 && node(s, 'box').props.fill === '#30a060' && node(s, 'crate') && !node(s, 'glow'), 'правки наложены на пересобранную сцену');

});

step('состояния, IK, кости, пиксели, свет', async () => {
  // состояния, IK, кости, пиксели, свет
  await call('state_set', { name: 'lamp', default: 'on', values: { on: {}, off: { shade: { fill: '#504030' } } } });
  await call('node_add', { id: 'lampLight', type: 'light', props: { x: 200, y: 80, z: 60, color: '#ffd090', energy: 1.2, radius: 260 } });
  await call('node_add', { id: 'thigh', type: 'group', props: { x: 300, y: 150, bone: true } });
  await call('node_add', { id: 'shin', type: 'group', parent: 'thigh', props: { y: 40 } });
  await call('node_add', { id: 'foot', type: 'ellipse', parent: 'shin', props: { y: 40, rx: 6, ry: 4, fill: '#fff' } });
  await call('node_add', { id: 'footTarget', type: 'group', props: { x: 330, y: 220 } });
  await call('ik_set', { id: 'foot', target: 'footTarget' });
  await call('bone_mark', { ids: ['shin'] });
  check(/IK|ik/.test(txt(await call('scene_info'))), 'IK и состояния видны в описании сцены');
  const on = await call('render_frame', { t: 0, width: 200 }), off = await call('render_frame', { t: 0, width: 200, states: { lamp: 'off' } });
  check(on.content[0].type === 'image' && on.content[0].data !== off.content[0].data, 'render_frame: варианты состояний рисуются по-разному');
  const lit = await call('render_frame', { t: 0, width: 200, lit: true });
  check(lit.content[0].type === 'image' && lit.content[0].data !== on.content[0].data, 'render_frame lit: превью со светом');
  await call('pixel_set', { size: 4, palette: ['#000000', '#ffffff', '#445060', '#806040'] });
  const px = await call('render_frame', { t: 0, width: 200 });
  check(px.content[0].type === 'image' && /пиксельный/.test(txt(px)), 'pixel_set: кадр в пиксельном режиме');
  await call('pixel_set', { enabled: false });
  const sheet = await call('render_contact_sheet', { count: 2, states: { lamp: 'off' } });
  check(sheet.content[0].type === 'image', 'раскадровка с состояниями');

});

step('HTTP: сведения о правках, список сцен, сброс, загрузка картинки', async () => {
  // HTTP: сцена с информацией о правках, список сцен, сброс правки
  const j = await (await http('/scene.json')).json();
  check(j.edits?.mode && j.edits.nodes.includes('box') && j.path === sceneFile, 'GET /scene.json отдаёт сведения о правках');
  const list = await (await http('/scenes')).json();
  check(list.scenes.some((x) => x.name === 'room.kontur.json' && x.build && x.edits), 'GET /scenes: сцены папки с признаками');
  await http('/edits/reset', { method: 'POST', body: JSON.stringify({ ids: ['box'] }) });
  s = await sceneNow();
  check(node(s, 'box').props.x === 100 && node(s, 'crate'), 'сброс правки одного узла (остальные на месте)');
  const tiny = encodePNG({ width: 2, height: 2, data: new Uint8Array(16).fill(200) });
  const up = await (await http('/asset?name=пятно.png', { method: 'POST', body: tiny })).json();
  check(up.src === 'assets/пятно.png' && up.width === 2 && existsSync(join(dir, 'assets', 'пятно.png')), 'POST /asset: картинка из редактора кладётся в assets/ рядом со сценой');
  check(/box|crate/.test(txt(await call('edits_info'))), 'edits_info перечисляет правки');
  await call('edits_reset', {});
  s = await sceneNow();
  check(node(s, 'glow') && !node(s, 'crate') && !node(s, 'lampLight'), 'edits_reset: всё вернулось к сцене из скрипта');
  check((await jsonWhen(editsFile, (e) => e.order?.length === 0))?.order.length === 0, 'файл правок пуст после сброса');

});

step('undo после сброса возвращает правки', async () => {
  // undo после сброса возвращает правки
  await call('undo');
  s = await sceneNow();
  check(node(s, 'crate') && node(s, 'lampLight'), 'undo возвращает сброшенные правки');

});

step('scene_open edits:false — без файла правок', async () => {
  // явный режим без правок
  await call('scene_open', { path: sceneFile, edits: false });
  check(!/Правки:/.test(txt(await call('scene_info'))), 'scene_open edits:false — без файла правок');
});
