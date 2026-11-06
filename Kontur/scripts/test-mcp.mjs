// Сквозной тест MCP-сервера: протокол, инструменты, превью.
// node scripts/test-mcp.mjs [папка-для-картинок]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = process.argv[2] || mkdtempSync(join(tmpdir(), 'kontur-test-'));
const dir = mkdtempSync(join(tmpdir(), 'kontur-scene-'));
const srv = spawn(process.execPath, [new URL('../mcp/server.mjs', import.meta.url).pathname], {
  env: { ...process.env, KONTUR_SCENE: join(dir, 'scene.json'), KONTUR_PORT: '7799' }, stdio: ['pipe', 'pipe', 'pipe'],
});
let buf = '', id = 0;
const pending = new Map();
srv.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    const m = JSON.parse(line);
    pending.get(m.id)?.(m); pending.delete(m.id);
  }
});
let stderr = '';
srv.stderr.on('data', (d) => (stderr += d));
const rpc = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
const call = async (name, args = {}) => {
  const r = await rpc('tools/call', { name, arguments: args });
  if (r.error || r.result.isError) throw new Error(`${name}: ${JSON.stringify(r.error || r.result.content[0].text)}`);
  return r.result;
};
let ok = 0;
const check = (cond, msg) => { if (!cond) throw new Error('ПРОВАЛ: ' + msg); ok++; console.log('✓', msg); };

try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  check(init.result.serverInfo.name === 'kontur', 'initialize');
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await rpc('tools/list', {});
  check(list.result.tools.length >= 20, `tools/list: ${list.result.tools.length} инструментов`);

  await call('scene_new', { width: 1280, height: 720, duration: 4, background: '#101322' });
  await call('nodes_add_batch', { nodes: [
    { id: 'shape', type: 'path', props: { x: 640, y: 360, d: { shape: 'circle', r: 120 }, fill: '#7c83ff' } },
    { id: 'ring', type: 'circle', props: { x: 640, y: 360, r: 200, fill: 'none', stroke: '#ffd166', strokeWidth: 6 } },
    { id: 'dot', type: 'circle', props: { r: 10, fill: '#06d6a0', repeat: { count: 8, scale: 0.85 } } },
  ] });
  await call('preset_apply', { preset: 'morphSequence', params: { id: 'shape', shapes: [{ shape: 'circle', r: 120 }, { shape: 'star', points: 6, outerRadius: 160, innerRadius: 80 }, { shape: 'rect', width: 220, height: 220, radius: 40 }], hold: 0.3, duration: 0.8 } });
  await call('preset_apply', { preset: 'drawOn', params: { id: 'ring', duration: 1.5 } });
  await call('mod_add', { id: 'dot', mod: { type: 'orbit', cx: 640, cy: 360, radius: 260, speed: 0.25, phaseStep: -8 } });
  await call('mod_add', { id: 'shape', mod: { type: 'spring', prop: 'rotation', stiffness: 80, damping: 8 } });
  await call('keys_set', { id: 'shape', prop: 'rotation', keys: [{ t: 0, v: 0, ease: 'hold' }, { t: 1, v: 90, ease: 'hold' }, { t: 2.5, v: 0 }] });
  await call('animate', { id: 'shape', prop: 'fill', to: '#ef476f', start: 1, duration: 2 });
  const info = await call('scene_info');
  check(/shape <path>/.test(info.content[0].text), 'scene_info показывает дерево');

  // ошибки откатываются
  const bad = await rpc('tools/call', { name: 'keys_set', arguments: { id: 'nope', prop: 'x', keys: [] } });
  check(bad.result.isError, 'ошибка на несуществующем узле');
  const bad2 = await rpc('tools/call', { name: 'mod_add', arguments: { id: 'shape', mod: { type: 'expr', prop: 'x', code: 'return v +' } } });
  check(bad2.result.isError, 'синтаксическая ошибка в expr отклонена');

  await call('mod_add', { id: 'dot', mod: { type: 'expr', prop: 'opacity', code: 'return 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + i))' } });
  await call('undo');
  const json = JSON.parse((await call('scene_get_json', { id: 'dot' })).content[0].text);
  check(json.mods.length === 1, 'undo убрал последний модификатор');
  await call('redo');

  const frame = await call('render_frame', { t: 1.5, width: 640 });
  check(frame.content[0].type === 'image', 'render_frame вернул PNG');
  writeFileSync(join(outDir, 'mcp-frame.png'), Buffer.from(frame.content[0].data, 'base64'));
  const sheet = await call('render_contact_sheet', { count: 8 });
  writeFileSync(join(outDir, 'mcp-sheet.png'), Buffer.from(sheet.content[0].data, 'base64'));
  check(sheet.content[0].type === 'image', 'render_contact_sheet');

  await call('export', { format: 'html', path: join(outDir, 'export.html') });
  await call('export', { format: 'gif', path: join(outDir, 'export.gif'), fps: 15, width: 480 });
  check(true, 'экспорт html и gif');

  const res = await rpc('resources/read', { uri: 'kontur://docs/reference' });
  check(res.result.contents[0].text.includes('Модификаторы') || res.result.contents[0].text.includes('модификаторы'), 'ресурс документации');

  // превью
  await new Promise((r) => setTimeout(r, 200));
  const url = (await call('preview_url')).content[0].text.match(/http\S+/)[0];
  const sj = await (await fetch(url + 'scene.json')).json();
  check(sj.scene.nodes.length >= 3, `превью отдаёт сцену (${url})`);
  const page = await (await fetch(url)).text();
  check(page.includes('Kontur'), 'превью отдаёт плеер');
  const eng = await fetch(url + 'engine/kontur.js');
  check(eng.ok, 'превью отдаёт движок');

  // растровые слои и дизеринг
  const tex = new URL('../examples/assets/paint-texture.jpg', import.meta.url).pathname;
  const sheetPng = new URL('../examples/assets/screen-sheet.png', import.meta.url).pathname;
  const ia = await call('image_add', { path: tex, id: 'tex', width: 1280, props: { blend: 'overlay', opacity: 0.5 } });
  check(/1280×720/.test(ia.content[0].text), 'image_add: размер по пропорции из файла');
  const ib = await call('image_add', { path: sheetPng, id: 'spr', x: 200, y: 600, width: 128, pixelated: true, sheet: { cols: 4, rows: 2, count: 8, fps: 8 } });
  check(/128×80/.test(ib.content[0].text), 'image_add: спрайт-лист, размер кадра');
  const sj0 = JSON.parse((await call('scene_get_json', { id: 'tex' })).content[0].text);
  check(sj0.props.src === 'assets/paint-texture.jpg', 'ассет скопирован в assets/ рядом со сценой');
  await call('node_add', { id: 'shadowBox', type: 'rect', props: { x: 640, y: 600, width: 300, height: 120, fill: '#1b2150' } });
  const ds = await call('dither_set', { enabled: true, pattern: 'bayer4', cell: 4, density: [0, 1], shade: ['shadowBox'] });
  check(/включён/.test(ds.content[0].text), 'dither_set включает дизеринг');
  const svgTxt = (await call('render_frame', { t: 0.5, format: 'svg', width: 640 })).content[0].text;
  check(svgTxt.includes('<pattern') && svgTxt.includes('data:image/jpeg;base64'), 'рендер: растр-паттерн и встроенная картинка');
  const fr = await call('render_frame', { t: 0.5, width: 640 });
  writeFileSync(join(outDir, 'mcp-raster-dither.png'), Buffer.from(fr.content[0].data, 'base64'));
  const prev = await (await fetch('http://127.0.0.1:7799/scene.json')).json();
  const texSrc = prev.scene.nodes.find((n) => n.id === 'tex').props.src;
  check(texSrc.startsWith('/asset?p='), 'превью переписывает путь ассета');
  check((await fetch('http://127.0.0.1:7799' + texSrc)).ok, 'превью отдаёт ассет');

  // клипы, нормали, совместимость, экспорт в Godot
  await call('clip_set', { name: 'idle', start: 0, end: 2 });
  await call('clip_set', { name: 'spin', start: 2, end: 4, loop: false, next: 'idle' });
  const inf = (await call('scene_info')).content[0].text;
  check(/Клипы: idle \[0–2s\], spin \[2–4s, один раз → idle\]/.test(inf), 'клипы видны в scene_info');
  check(/PNG-кадры: да \(/.test(inf), 'scene_info называет рабочий растеризатор');
  const badClip = await rpc('tools/call', { name: 'clip_set', arguments: { name: 'x', start: 2, end: 1 } });
  check(badClip.result.isError, 'неверный клип отклонён');
  const cs = await call('render_contact_sheet', { clip: 'spin', count: 4 });
  check(/2\.00, 2\.50, 3\.00, 3\.50/.test(cs.content[1].text), 'раскадровка по клипу');
  const nmS = await call('normal_map_generate', { target: 'scene', t: 1, width: 640, settings: { strength: 4, bevel: 10 } });
  check(nmS.content[0].type === 'image' && /Карта нормалей: .*scene_n\.png \(640×360/.test(nmS.content[1].text), 'нормали для кадра сцены');
  writeFileSync(join(outDir, 'mcp-normals.png'), Buffer.from(nmS.content[0].data, 'base64'));
  const nmI = await call('normal_map_generate', { target: 'image', id: 'tex', attach: true, settings: { bevel: 0, luma: 1 }, preview: false });
  check(/normalMap = normals\/paint-texture_n\.png/.test(nmI.content[0].text), 'нормали для растрового слоя, привязка к слою');
  const cc = (await call('compat_check')).content[0].text;
  check(/shadowBox: дизеринг/.test(cc) && /режим наложения overlay/.test(cc), 'compat_check находит дизеринг и наложение');
  const gdDir = join(dir, 'godot-out');
  const gx = (await call('export', { format: 'godot', path: gdDir, fps: 6, normals: true })).content[0].text;
  check(/Слоёв: \d+/.test(gx) && existsSync(join(gdDir, 'scene.tscn')) && existsSync(join(gdDir, 'kontur_manifest.json')), 'экспорт в Godot: сцена, манифест');
  const tscn = readFileSync(join(gdDir, 'scene.tscn'), 'utf8');
  check(/name": &"idle"/.test(tscn) && /name": &"spin"/.test(tscn) && /CanvasTexture/.test(tscn) && /next_clips = \{"spin": "idle"\}/.test(tscn), 'tscn: анимации по клипам, карты нормалей, переходы');

  await call('scene_open', { path: 'examples/bay.json' });
  const bayTex = JSON.parse((await call('scene_get_json', { id: 'paint' })).content[0].text).props.src;
  check(bayTex.endsWith('paint-texture.jpg'), `пример с ассетами открыт (${bayTex})`);
  const fb = await call('render_frame', { t: 1, width: 480 });
  check(fb.content[0].type === 'image', 'рендер примера с ассетами');
  console.log(`\nВсе проверки пройдены: ${ok}. Картинки: ${outDir}`);
} catch (e) {
  console.error(e.message, '\n--- stderr ---\n', stderr);
  process.exitCode = 1;
} finally {
  srv.stdin.end();
}
