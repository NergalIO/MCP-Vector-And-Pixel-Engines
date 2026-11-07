// Сквозной тест MCP-сервера: протокол, инструменты, превью.
// node scripts/test-mcp.mjs [папка-для-картинок]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, existsSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = process.argv[2] || mkdtempSync(join(tmpdir(), 'kontur-test-'));
const dir = mkdtempSync(join(tmpdir(), 'kontur-scene-'));
const srv = spawn(process.execPath, [fileURLToPath(new URL('../mcp/server.mjs', import.meta.url))], {
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
srv.on('exit', (c) => { if (c) { console.error('сервер упал:', c, stderr.slice(-2000)); process.exit(1); } });
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
  const tex = fileURLToPath(new URL('../examples/assets/paint-texture.jpg', import.meta.url));
  const sheetPng = fileURLToPath(new URL('../examples/assets/screen-sheet.png', import.meta.url));
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

  // экспорт в Unity: в проект-заглушку (Assets + ProjectSettings, Linear); формат файлов сверен с Unity 6 отдельно
  const ccU = (await call('compat_check', { target: 'unity' })).content[0].text;
  check(/export format "unity"/.test(ccU) && /префаб/.test(ccU) && /режим наложения overlay/.test(ccU), 'compat_check для Unity');
  const uProj = join(dir, 'unity-proj');
  mkdirSync(join(uProj, 'Assets'), { recursive: true });
  mkdirSync(join(uProj, 'ProjectSettings'), { recursive: true });
  writeFileSync(join(uProj, 'ProjectSettings', 'ProjectSettings.asset'), 'PlayerSettings:\n  m_ActiveColorSpace: 1\n');
  await call('node_add', { id: 'uLight', type: 'light', props: { x: 300, y: 200, z: 60, color: '#ffd090', energy: 1, radius: 300 } });
  const uDir = join(uProj, 'Assets', 'Kontur', 'Комната');
  const ux = (await call('export', { format: 'unity', path: uDir, title: 'Room', fps: 6 })).content[0].text;
  check(/Префаб Room\.prefab/.test(ux) && /клипы \(Animator\): idle@6fps, spin@6fps/.test(ux) && /1 Light2D \+ Ambient \(подобран под Linear\)/.test(ux), 'экспорт в Unity: префаб, клипы, свет');
  const rt = join(uProj, 'Assets', 'Kontur', 'Runtime');
  check(['Room.prefab', 'Room.controller', 'Animations/idle.anim', 'Animations/spin.anim', 'Materials/Kontur_overlay.mat', 'kontur_manifest.json'].every((f) => existsSync(join(uDir, f)) && existsSync(join(uDir, f) + '.meta'))
    && ['KonturPlayer.cs', 'KonturBlend.shader'].every((f) => existsSync(join(rt, f + '.meta'))), 'Unity: все файлы с .meta, скрипт и шейдер — в Assets/Kontur/Runtime');
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const metas = new Map(walk(uDir).filter((f) => f.endsWith('.png.meta')).map((f) => [/guid: ([0-9a-f]{32})/.exec(readFileSync(f, 'utf8'))[1], readFileSync(f, 'utf8')]));
  const pf = readFileSync(join(uDir, 'Room.prefab'), 'utf8');
  const spriteGuids = [...pf.matchAll(/m_Sprite: \{fileID: 21300000, guid: ([0-9a-f]{32})/g)].map((m) => m[1]);
  check(spriteGuids.length > 0 && spriteGuids.every((g) => metas.has(g) && /spriteMode: 1/.test(metas.get(g)) && /alignment: 1/.test(metas.get(g)) && /textureType: 8/.test(metas.get(g))), 'Unity: спрайты префаба ссылаются на PNG с импортом Sprite, опора слева сверху');
  const anchors = new Set([...pf.matchAll(/^--- !u!\d+ &(\d+)/gm)].map((m) => m[1]));
  const localRefs = [...pf.matchAll(/\{fileID: (\d+)\}/g)].map((m) => m[1]).filter((x) => x !== '0');
  check(anchors.size > 5 && localRefs.every((x) => anchors.has(x)), `Unity: префаб цельный — все ссылки внутри файла найдены (${anchors.size} объектов)`);
  check(/m_LightType: 3/.test(pf) && /m_LightType: 4/.test(pf) && /Kontur_overlay|guid: [0-9a-f]{32}, type: 2\}/.test(pf), 'Unity: точечный и общий свет, материал наложения');
  const ctl = readFileSync(join(uDir, 'Room.controller'), 'utf8');
  const ctlDocs = ctl.split(/^--- /m);
  const stateId = (n) => { const d = ctlDocs.find((x) => x.startsWith('!u!1102 ') && x.includes(`m_Name: ${n}\n`)); return d && /&(\d+)/.exec(d)[1]; };
  check(stateId('idle') && stateId('spin') && ctl.includes(`m_DstState: {fileID: ${stateId('idle')}}`) && ctl.includes(`m_DefaultState: {fileID: ${stateId('idle')}}`), 'Unity: контроллер — состояния клипов, spin → idle, по умолчанию idle');
  const spin = readFileSync(join(uDir, 'Animations', 'spin.anim'), 'utf8');
  const uc = await import('../mcp/unity_common.mjs'), ly = await import('../mcp/layers.mjs');
  const { crc32 } = uc;
  check(crc32('L01') === 140090239, 'CRC32 пути совпадает с Unity');
  check(Math.abs(uc.urpFalloffIntensity(1) - 0.5) < 1e-3, 'спад URP: falloff 1 → falloffIntensity 0.5');
  const fg = uc.fitUrpLight({ ambient: [0.3, 0.3, 0.3], energy: 1.2, falloff: 1.5, linear: false });
  check(fg.intensity === 1.2 && fg.exponent === 1.5, 'свет в Gamma-проекте переносится как есть');
  const sn = ly.safeNames(['ходьба', 'прыжок', 'ъ', 'ь', 'idle'], 'clip');
  check(sn.get('ходьба') === 'hodba' && sn.get('прыжок') === 'pryzhok' && sn.get('ъ') !== sn.get('ь') && sn.get('idle') === 'idle', 'имена файлов: кириллица латиницей, без совпадений');
  const animPath = /path: (L\d+_\w+)\n/.exec(spin)?.[1];
  check(/m_LoopTime: 0/.test(spin) && /m_LoopTime: 1/.test(readFileSync(join(uDir, 'Animations', 'idle.anim'), 'utf8')) && animPath && spin.includes(`path: ${crc32(animPath)}\n`) && /m_StopTime: 2\n/.test(spin), 'Unity: клипы — повтор, привязка по CRC32 пути, длина');
  await call('export', { format: 'unity', path: uDir, title: 'Room', fps: 6 });
  check(readFileSync(join(uDir, 'Room.prefab'), 'utf8') === pf, 'Unity: повторный экспорт даёт те же GUID и fileID (ссылки в сценах не рвутся)');
  await call('node_remove', { id: 'uLight' });

  // ---------- 2.5D: камера, мир, свет, проходы ----------
  await call('scene_new', { width: 640, height: 360, duration: 1, background: '#0d0f1a' });
  const cam = await call('camera3d_set', { hor: 120, charPx: 120, f: 520, dz: 2 });
  check(/camH/.test(cam.content[0].text) && /Рост персонажа/.test(cam.content[0].text), 'camera3d_set: камера по росту персонажа');
  const wb = await call('world_build', { seed: 3, sky: ['#203060', '#506090', '#c0a080'], items: [
    { type: 'ground', x: [-8, 8], z: [0, 30] },
    { type: 'house', x: [-6, -1], z: [6, 11], h: 6, mat: 'plaster', facades: ['front', 'right'], litP: 1 },
    { type: 'box', x: [1, 3], y: [0, 1.2], z: [4, 5], color: 'wood', mats: { front: ['wood', 'wood'] } },
    { type: 'lamp', X: 2, Z: 3 },
    { type: 'disc', X: -0.5, Z: 2.5, rx: 0.8, color: '#304050', spec: 1 },
    { type: 'nope' },
  ] });
  check(/Группа world/.test(wb.content[0].text) && /#5 \(nope\)/.test(wb.content[0].text), 'world_build: мир собран, ошибки объектов — в отчёте');
  const wj = JSON.parse((await call('scene_get_json')).content[0].text);
  const wroot = wj.nodes.find((n) => n.id === 'world');
  check(wroot?.props.world3d.items.length === 6 && wj.nodes.some((n) => n.props?.occluder) && wj.nodes.some((n) => n.type === 'light' && n.props.p3), 'world_build: описание, окклюдеры и источники p3 в сцене');
  check(typeof wj.background === 'object' && wj.camera3d.f === 520, 'world_build: небо стало фоном, камера сохранена');
  const n0 = wj.nodes.length;
  await call('camera3d_set', { f: 600 });
  const wj2 = JSON.parse((await call('scene_get_json')).content[0].text);
  check(wj2.camera3d.f === 600 && wj2.nodes.find((n) => n.id === 'world') && Math.abs(wj2.nodes.length - n0) < n0 * 0.5 && JSON.stringify(wj2.nodes) !== JSON.stringify(wj.nodes), 'camera3d_set: мир пересобран под новую камеру');
  // материал на свою грань
  await call('node_add', { id: 'myWall', type: 'path', props: { d: 'M 420 90 L 600 70 L 600 260 L 420 250 Z', fill: '#a07050', surface: { normal: [0, 0, -1], plane: [0, 0, -1, -9] } } });
  const ma = await call('material_apply', { id: 'myWall', material: 'brick', color: '#a05040' });
  check(/myWall_mat/.test(ma.content[0].text), 'material_apply: кладка на грани');
  const wj3 = JSON.parse((await call('scene_get_json')).content[0].text);
  const iw = wj3.nodes.findIndex((n) => n.id === 'myWall');
  check(wj3.nodes[iw + 1].id === 'myWall_matclip' && wj3.nodes.find((n) => n.id === 'myWall_mat_clip').props.clip === 'myWall_matclip' && wj3.nodes.filter((n) => n.id.startsWith('myWall_m') && n.type === 'path').length > 10,'material_apply: детали после грани, обрезаны её контуром');
  await call('material_apply', { id: 'myWall', material: 'stone' });
  const wj4 = JSON.parse((await call('scene_get_json')).content[0].text);
  check(wj4.nodes.filter((n) => n.id === 'myWall_mat').length === 1 && /stone/.test(wj4.nodes.find((n) => n.id === 'myWall_mat').props.name), 'material_apply: повтор заменяет материал');
  const ss = await call('surface_set', { ids: ['myWall'], surface: { spec: 0.4, emissive: '#ff8000' } });
  check(/"spec":0.4/.test(ss.content[0].text) && /"plane"/.test(ss.content[0].text), 'surface_set: слияние полей');
  await call('surface_set', { ids: ['myWall'], unset: ['emissive'] });
  check(!JSON.parse((await call('scene_get_json', { id: 'myWall' })).content[0].text).props.surface.emissive, 'surface_set: unset убирает поле');
  const ls = await call('lighting_set', { preset: 'night', exposure: 0.9, sun: { energy: 0.4 } });
  check(/экспозиция 0.9/.test(ls.content[0].text) && /ink → vignette/.test(ls.content[0].text), 'lighting_set: пресет + поля, стиль пресета');
  await call('style_set', { chain: [{ type: 'cel' }, { type: 'vignette', strength: 0.3 }] });
  const badStyle = await rpc('tools/call', { name: 'style_set', arguments: { chain: [{ type: 'oil' }] } });
  check(badStyle.result.isError, 'style_set: неизвестный эффект — ошибка');
  const lf = await call('render_frame', { t: 0, width: 640, lit: 'deferred', debug: true, out: join(outDir, 'lit.png') });
  check(/## 2.5D/.test((await call('docs', { topic: '2.5d' })).content[0].text), 'docs: раздел 2.5D');
  check(lf.content[0].type === 'image' && /отложенный свет: пресет night/.test(lf.content[1].text) && existsSync(join(outDir, 'lit.png')), 'render_frame lit: "deferred" + debug');
  writeFileSync(join(outDir, 'lit-debug.png'), Buffer.from(lf.content[0].data, 'base64'));
  const pDir = join(outDir, 'passes');
  await call('render_passes', { dir: pDir, width: 320, lit: true });
  check(['color', 'normal', 'plane', 'planeD', 'emissive', 'ink', 'cover', 'mask_chr', 'normal_map', 'lit', 'shadow_ao'].every((k) => existsSync(join(pDir, `${k}.png`))), 'render_passes: все проходы и карта нормалей');
  const litPng = await fetch('http://127.0.0.1:7799/lit.png?w=320');
  check(litPng.status === 200 && (await litPng.arrayBuffer()).byteLength > 1000, 'студия: /lit.png отдаёт кадр с отложенным светом');
  const ex = join(outDir, 'baked.png');
  await call('export', { format: 'png', path: ex, lit: 'deferred', width: 320 });
  check(existsSync(ex), 'export png с отложенным светом');

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
