#!/usr/bin/env node
/**
 * Kontur MCP-сервер (stdio, JSON-RPC 2.0, без зависимостей)
 * + встроенный HTTP-сервер живого превью (SSE): каждое изменение сцены сразу видно в браузере.
 *
 * Переменные окружения:
 *   KONTUR_SCENE  — путь к файлу сцены (по умолчанию ./kontur-scene.json, автосохранение)
 *   KONTUR_PORT   — порт превью (по умолчанию 7788; 0 — отключить; или --port N)
 *   KONTUR_HOST   — адрес превью (по умолчанию 127.0.0.1)
 */
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, watchFile, unwatchFile, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, extname, basename, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VERSION, createScene, ops, applyPreset, PRESETS, MODIFIERS, NODE_TYPES, easings,
  validateScene, describeScene, renderSVG, invalidate, evaluate, clipRange,
  applyEdits, diffScenes, editsCount, pixelOf,
} from '../engine/kontur.js';
import { probeRaster, rasterHelp, svgToPng, canPng, contactSheetSVG, exportVideo, standaloneHTML, capabilities, inlineAssets, resolveSrc, imageSize, fileToDataURI, IMAGE_MIME, renderPNG, mapLimit, PARALLEL } from './render.mjs';
import { DITHER_PATTERNS, RELIEF_DEFAULT } from '../engine/kontur.js';
import { sceneNormalMap, imageNormalMap, encodePNG, decodePNG, litPreview, sideBySide, scaleDown, NORMAL_DEFAULTS } from './normals.mjs';
import { compatReport, exportGodot } from './godot.mjs';
import { exportUnity } from './unity.mjs';
import { renderLit, renderPasses, resolveLighting, resolveStyle, LIGHT_PRESETS, STYLE_TYPES, normalMapFromPass } from './lighting.mjs';
import { worldBuild, rebuildWorlds, cameraSet, materialApply, surfaceOfNode } from './world_ops.mjs';
import { MATERIALS } from '../engine/world3d.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const log = (...a) => process.stderr.write('[kontur] ' + a.join(' ') + '\n');
const argv = process.argv.slice(2);
const argVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

/* ------------------------------------------------------------------ состояние */
let scenePath = resolve(argVal('--scene') || process.env.KONTUR_SCENE || 'kontur-scene.json');
let scene = createScene();
const history = [], future = [];
let rev = 0;

function loadFrom(p) {
  const s = JSON.parse(readFileSync(p, 'utf8'));
  const errs = validateScene(s);
  if (errs.length) throw new Error('Сцена с ошибками:\n' + errs.join('\n'));
  return s;
}
/* ---- правки поверх сцены: сцену пишет скрипт (*.build.mjs), человек правит в редакторе ----
 * Исходный файл тогда не перезаписывается: правки хранятся в <имя>.edits.json и накладываются
 * на свежую сцену после каждой пересборки (файл исходной сцены отслеживается). */
let editsMode = false, editsLocked = false, base = null, editsPath = null, edits = null, editWarnings = [];
const editsPathFor = (f) => f.replace(/(\.kontur)?\.json$/i, '') + '.edits.json';
const buildScriptFor = (f) => (/\.kontur\.json$/i.test(f) ? f.replace(/\.kontur\.json$/i, '.build.mjs') : null);
function readEdits(f) { try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { log('файл правок не прочитан:', e.message); editsLocked = true; return null; } }
/** Открыть файл сцены. withEdits: 'auto' (если есть файл правок или build-скрипт рядом) | true | false. */
function openScene(f, withEdits = 'auto') {
  const raw = loadFrom(f);
  const ep = editsPathFor(f), bs = buildScriptFor(f);
  const on = withEdits === true || (withEdits === 'auto' && (existsSync(ep) || (bs && existsSync(bs))));
  stopWatch();
  scenePath = f; editsLocked = false;
  if (on) {
    base = raw; editsPath = ep; edits = existsSync(ep) ? readEdits(ep) : null; editsMode = true;
    const r = applyEdits(base, edits);
    editWarnings = r.warnings;
    const errs = validateScene(r.scene);
    if (errs.length) { editWarnings.push('Правки ломают сцену и пока не применены (файл правок не трогается): ' + errs.slice(0, 3).join('; ')); editsLocked = true; scene = raw; }
    else scene = r.scene;
    startWatch();
  } else { editsMode = false; base = null; edits = null; editsPath = null; editWarnings = []; scene = raw; }
  history.length = 0; future.length = 0;
}
let watching = null;
function startWatch() {
  const f = scenePath;
  let last = statSync(f).mtimeMs;
  watchFile(f, { interval: 700 }, (cur) => {
    if (!editsMode || f !== scenePath || cur.mtimeMs === last) return;
    last = cur.mtimeMs;
    setTimeout(() => reloadBase(f), 200); // файл мог ещё дописываться
  });
  watching = f;
}
function stopWatch() { if (watching) unwatchFile(watching); watching = null; }
/** Исходная сцена пересобрана скриптом: перечитать и заново наложить правки. */
function reloadBase(f) {
  let raw;
  try { raw = loadFrom(f); } catch (e) { log('исходная сцена не прочиталась после изменения:', e.message); return; }
  base = raw;
  const r = applyEdits(base, edits);
  editWarnings = r.warnings;
  scene = validateScene(r.scene).length ? raw : r.scene;
  history.length = 0; future.length = 0; // история относится к прежней версии сцены
  invalidate(scene); rev++; broadcast();
  log('исходная сцена обновилась — правки наложены заново' + (editWarnings.length ? `, предупреждений: ${editWarnings.length}` : ''));
}
function editsInfo() {
  if (!editsMode) return { mode: false };
  const ids = edits ? [...new Set([...Object.keys(edits.nodes || {}), ...(edits.removed || []), ...(edits.order || []).map((o) => o.id)])] : [];
  return { mode: true, path: editsPath, count: editsCount(edits), nodes: ids, removed: edits?.removed || [], added: (edits?.order || []).filter((o) => o.add).map((o) => o.id), scene: Object.keys(edits?.scene || {}), warnings: editWarnings, locked: editsLocked };
}
/** Сбросить правки (всех или указанных узлов) — вернуть значения из исходной сцены. */
function resetEdits(ids) {
  if (!editsMode) throw new Error('Сцена открыта без файла правок');
  const cur = diffScenes(base, scene);
  if (!ids || !ids.length) return applyEdits(base, null).scene;
  const kill = new Set(ids);
  for (const id of kill) delete cur.nodes[id];
  cur.removed = cur.removed.filter((id) => !kill.has(id));
  cur.order = cur.order.filter((o) => !kill.has(o.id));
  if (kill.has('__scene')) cur.scene = {};
  return applyEdits(base, cur).scene;
}
if (existsSync(scenePath)) {
  try { openScene(scenePath); log('загружена сцена', scenePath, editsMode ? `(правки: ${editsPath})` : ''); } catch (e) { log('не удалось загрузить сцену:', e.message); }
}
/* ---- растровые ассеты: пути относительно папки сцены ---- */
const baseDir = () => dirname(scenePath);
const S = () => inlineAssets(scene, baseDir());
function mapSrc(sc, fn) {
  return { ...sc, nodes: sc.nodes.map((n) => {
    if (n.type !== 'image') return n;
    const c = { ...n, props: { ...n.props } };
    if (c.props.src != null) c.props.src = fn(c.props.src);
    if (n.keys?.src) c.keys = { ...n.keys, src: n.keys.src.map((k) => ({ ...k, v: fn(k.v) })) };
    return c;
  }) };
}
const toAbs = (base) => (src) => resolveSrc(src, base) || src;
const toRel = (base) => (src) => {
  if (typeof src !== 'string' || !isAbsolute(src)) return src;
  const r = relative(base, src);
  return r.startsWith('..') || isAbsolute(r) ? src : r.split(sep).join('/');
};
const rebase = (sc, from, to) => mapSrc(mapSrc(sc, toAbs(from)), toRel(to));

function save() {
  try {
    mkdirSync(dirname(scenePath), { recursive: true });
    if (!editsMode) { writeFileSync(scenePath, JSON.stringify(scene, null, 1)); return; }
    if (editsLocked) { log('файл правок не перезаписан: он не применился к сцене'); return; }
    const d = diffScenes(base, scene);
    // правки объектов, которых сейчас нет в исходной сцене, не теряются: скрипт мог убрать их временно
    if (edits?.nodes) { const have = new Set(base.nodes.map((n) => n.id)); for (const [id, e] of Object.entries(edits.nodes)) if (!have.has(id) && !d.nodes[id]) d.nodes[id] = e; }
    edits = d;
    editWarnings = applyEdits(base, edits).warnings;
    writeFileSync(editsPath, JSON.stringify(edits, null, 1));
  } catch (e) { log('ошибка сохранения:', e.message); }
}
/** Транзакция: снимок → изменение → проверка → сохранение → оповещение превью. */
function mutate(label, fn) {
  const snapshot = JSON.stringify(scene);
  try {
    const res = fn();
    invalidate(scene);
    evaluate(scene, 0); evaluate(scene, scene.duration * 0.5); // ранняя проверка
    history.push({ label, snapshot }); if (history.length > 80) history.shift();
    future.length = 0;
    rev++; save(); broadcast();
    return res;
  } catch (e) {
    scene = JSON.parse(snapshot); invalidate(scene);
    throw e;
  }
}

/* ------------------------------------------------------------------ превью (HTTP + SSE) */
const clients = new Set();
function broadcast() { for (const res of clients) res.write(`event: scene\ndata: ${rev}\n\n`); }
let previewUrl = null, previewServer = null;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css' };

function startPreview() {
  const port0 = Number(argVal('--port') ?? process.env.KONTUR_PORT ?? 7788);
  if (port0 === 0 && process.env.KONTUR_PORT === '0') return;
  const host = process.env.KONTUR_HOST || '127.0.0.1';
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, body, type = 'text/plain; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    try {
      if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(302, { location: '/player/index.html' }); return res.end(); }
      if (u.pathname === '/engine/kontur.js') return send(200, readFileSync(resolve(ROOT, 'engine/kontur.js')), MIME['.js']);
      if (u.pathname.startsWith('/player/')) {
        const f = resolve(ROOT, '.' + decodeURIComponent(u.pathname));
        if (!f.startsWith(resolve(ROOT, 'player')) || !existsSync(f)) return send(404, 'not found');
        return send(200, readFileSync(f), MIME[extname(f)] || 'application/octet-stream');
      }
      if (u.pathname === '/scenes' && req.method === 'GET') {
        // сцены в папке текущей (для «Открыть» в редакторе)
        const dir = dirname(scenePath), out = [];
        for (const name of readdirSync(dir)) {
          if (!/\.json$/i.test(name) || /\.edits\.json$/i.test(name)) continue;
          const f = resolve(dir, name);
          try { if (statSync(f).size > 30e6) continue; const j = JSON.parse(readFileSync(f, 'utf8')); if (Array.isArray(j.nodes)) out.push({ name, path: f, nodes: j.nodes.length, edits: existsSync(editsPathFor(f)), build: !!(buildScriptFor(f) && existsSync(buildScriptFor(f))) }); } catch {}
        }
        return send(200, JSON.stringify({ dir, current: scenePath, scenes: out }), MIME['.json']);
      }
      if ((u.pathname === '/open' || u.pathname === '/edits/reset' || u.pathname === '/asset') && req.method === 'POST') {
        const chunks = [];
        req.on('data', (d) => { chunks.push(d); if (chunks.reduce((a, c) => a + c.length, 0) > 40e6) req.destroy(); });
        req.on('end', () => {
          try {
            const buf = Buffer.concat(chunks);
            if (u.pathname === '/asset') {
              // загрузка картинки из редактора → <папка сцены>/assets/<имя>
              const name = (u.searchParams.get('name') || 'image.png').replace(/[^\w.\-а-яё]/gi, '_').slice(0, 80);
              if (!IMAGE_MIME[extname(name).toLowerCase()]) return send(400, 'Нужна картинка: ' + Object.keys(IMAGE_MIME).join(' '));
              const dir = resolve(baseDir(), 'assets'); mkdirSync(dir, { recursive: true });
              let f = resolve(dir, name), i = 2;
              while (existsSync(f)) f = resolve(dir, name.replace(/(\.\w+)$/, `_${i++}$1`));
              writeFileSync(f, buf);
              const sz = imageSize(buf) || {};
              return send(200, JSON.stringify({ src: toRel(baseDir())(f), url: '/asset?p=' + encodeURIComponent(f), width: sz.width, height: sz.height }), MIME['.json']);
            }
            const a = buf.length ? JSON.parse(buf.toString('utf8')) : {};
            if (u.pathname === '/open') {
              const f = resolve(a.path);
              const old = scene;
              try { openScene(f, a.edits ?? 'auto'); } catch (e) { scene = old; throw e; }
              invalidate(scene); rev++; broadcast();
              return send(200, JSON.stringify({ rev, path: scenePath }), MIME['.json']);
            }
            const s2 = resetEdits(a.ids);
            mutate('сброс правок', () => { scene = s2; });
            return send(200, JSON.stringify({ rev }), MIME['.json']);
          } catch (e) { send(400, e.message); }
        });
        return;
      }
      if (u.pathname.startsWith('/examples/') && (extname(u.pathname) === '.json' || IMAGE_MIME[extname(u.pathname).toLowerCase()])) {
        const f = resolve(ROOT, '.' + decodeURIComponent(u.pathname));
        if (!f.startsWith(resolve(ROOT, 'examples'))) return send(403, 'forbidden');
        if (!existsSync(f)) return send(404, 'not found');
        return send(200, readFileSync(f), MIME[extname(f)] || IMAGE_MIME[extname(f).toLowerCase()]);
      }
      if (u.pathname === '/scene.json' && req.method === 'GET') {
        const out = mapSrc(scene, (src) => { const p = resolveSrc(src, baseDir()); return p ? '/asset?p=' + encodeURIComponent(p) : src; });
        return send(200, JSON.stringify({ rev, scene: out, path: scenePath, edits: editsInfo() }), MIME['.json']);
      }
      if (u.pathname === '/asset') {
        const p = u.searchParams.get('p') || '';
        const mime = IMAGE_MIME[extname(p).toLowerCase()];
        if (!mime || !existsSync(p)) return send(404, 'not found');
        return send(200, readFileSync(p), mime);
      }
      if (u.pathname === '/scene.json' && req.method === 'POST') {
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 20e6) req.destroy(); });
        req.on('end', () => {
          try {
            const s = mapSrc(JSON.parse(body), (src) => (typeof src === 'string' && src.startsWith('/asset?p=') ? toRel(baseDir())(decodeURIComponent(src.slice(9))) : src));
            const errs = validateScene(s);
            if (errs.length) return send(400, errs.join('\n'));
            mutate(String(u.searchParams.get('label') || 'правка из редактора').slice(0, 60), () => { scene = s; });
            send(200, JSON.stringify({ rev, edits: editsInfo() }), MIME['.json']);
          } catch (e) { send(400, e.message); }
        });
        return;
      }
      if (u.pathname === '/frame.svg') return send(200, renderSVG(S(), Number(u.searchParams.get('t') || 0)), MIME['.svg']);
      if (u.pathname === '/lit.png') {
        // отложенный свет для студии (кнопка «Отложенный свет»): считается на сервере
        if (!scene.camera3d) return send(409, 'Нужна camera3d (camera3d_set) и узлы с surface (world_build)', 'text/plain; charset=utf-8');
        let st;
        try { st = JSON.parse(u.searchParams.get('states') || 'null') || undefined; } catch {}
        const w = Math.max(160, Math.min(2560, Number(u.searchParams.get('w')) || 960));
        probeRaster()
          .then(() => renderLit(S(), Number(u.searchParams.get('t') || 0), { width: w, states: st }))
          .then((r) => send(200, r.png, 'image/png'), (e) => send(500, String(e.message || e), 'text/plain; charset=utf-8'));
        return;
      }
      if (u.pathname === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`event: scene\ndata: ${rev}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => { clients.delete(res); clearInterval(ping); });
        return;
      }
      send(404, 'not found');
    } catch (e) { send(500, e.message); }
  });
  let port = port0, tries = 0;
  srv.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries++ < 10) { port++; srv.listen(port, host); }
    else log('превью недоступно:', e.message);
  });
  srv.on('listening', () => { previewUrl = `http://${host === '0.0.0.0' ? 'localhost' : host}:${srv.address().port}/`; log('превью:', previewUrl); });
  srv.listen(port, host);
  if (!argv.includes('--preview')) srv.unref();
  previewServer = srv;
}

/* ------------------------------------------------------------------ инструменты */
const ANY = {};
const NUM = { type: 'number' };
const STR = { type: 'string' };
const OBJ = { type: 'object' };
const KEY = { type: 'object', properties: { t: NUM, v: ANY, ease: ANY, hold: { type: 'boolean' } }, required: ['t', 'v'] };
const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 1) }] });
const summary = (msg) => text(`${msg}\n\n${describeScene(scene)}`);

const tools = [
  {
    name: 'scene_info',
    description: 'Сводка текущей сцены: размеры, длительность, дерево узлов с ключами и модификаторами, адрес превью и путь к файлу. Начинайте работу с него.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      await probeRaster();
      const png = canPng() ? `да (${capabilities.png})` : `нет — ${capabilities.pngError}. ${rasterHelp()}`;
      const issues = compatReport(scene, 'godot');
      const ei = editsInfo();
      const edl = ei.mode ? `\nПравки: ${ei.path} — объектов ${ei.count}${ei.warnings.length ? `, предупреждений ${ei.warnings.length} (edits_info)` : ''}${ei.locked ? ' — ЗАБЛОКИРОВАНЫ' : ''}. Исходный файл не перезаписывается, правки ложатся поверх при каждой пересборке.` : '';
      return text(`${describeScene(scene)}\n\nФайл: ${scenePath}${edl}\nПревью: ${previewUrl || 'выключено'}\nPNG-кадры: ${png}\nВидео: ${capabilities.ffmpeg && canPng() ? 'да' : capabilities.ffmpeg ? 'нет (нет растеризатора)' : 'нет (нужен ffmpeg)'}${issues.length ? `\nСовместимость с Godot (импорт SVG): ${issues.length} замечаний — подробно в compat_check; для переноса с эффектами используйте export format "godot".` : ''}`);
    },
  },
  {
    name: 'docs',
    description: 'Справочник по формату сцены, типам узлов, свойствам, кривым, модификаторам, пресетам и рецептам плавных анимаций. Прочитайте перед созданием сложных анимаций. topic "2.5d" — только раздел о 2.5D-сценах и отложенном свете (camera3d, surface, проходы, lighting, style, world_build).',
    inputSchema: { type: 'object', properties: { topic: { type: 'string', enum: ['all', 'modifiers', 'presets', 'easings', '2.5d'] } } },
    run: ({ topic = 'all' }) => {
      if (topic === '2.5d') { const md = readFileSync(resolve(ROOT, 'docs/REFERENCE.md'), 'utf8'); const i = md.indexOf('## 2.5D'); return text(md.slice(i, md.indexOf('\n## ', i + 5))); }
      if (topic === 'modifiers') return text(Object.entries(MODIFIERS).map(([k, v]) => `${k}: ${v.doc}`).join('\n'));
      if (topic === 'presets') return text(Object.entries(PRESETS).map(([k, v]) => `${k}: ${v.doc}`).join('\n'));
      if (topic === 'easings') return text(Object.keys(easings).join(', ') + '\nА также: "cubic-bezier(a,b,c,d)", [a,b,c,d], "spring(k,d,m)", {spring:{...}}, {steps:n}');
      return text(readFileSync(resolve(ROOT, 'docs/REFERENCE.md'), 'utf8'));
    },
  },
  {
    name: 'scene_new',
    description: 'Создать новую пустую сцену (текущая останется в истории — её можно вернуть через undo).',
    inputSchema: { type: 'object', properties: { width: NUM, height: NUM, duration: NUM, fps: NUM, background: ANY, loop: { type: 'boolean' } } },
    run: (a) => {
      let note = '';
      if (editsMode) {
        // сцена из скрипта не затирается: новая пишется рядом в свободный файл
        stopWatch(); editsMode = false; base = null; edits = null; editsPath = null; editWarnings = [];
        let i = 1, f;
        do f = resolve(dirname(scenePath), `scene-${i++}.json`); while (existsSync(f));
        scenePath = f; note = ` Файл: ${f}.`;
      }
      mutate('новая сцена', () => { scene = createScene(a); });
      return summary('Создана новая сцена.' + note);
    },
  },
  {
    name: 'scene_settings',
    description: 'Изменить параметры сцены: width, height, duration, fps, background (цвет или градиент), loop, dither (глобальный дизеринг теней, см. dither_set); 2.5D: camera3d, lighting, style (null — удалить; удобнее — camera3d_set, lighting_set, style_set).',
    inputSchema: { type: 'object', properties: { width: NUM, height: NUM, duration: NUM, fps: NUM, background: ANY, loop: { type: 'boolean' }, dither: ANY, relief: ANY, ambient: STR, camera3d: ANY, lighting: ANY, style: ANY } },
    run: (a) => { mutate('настройки', () => { for (const k of ['width', 'height', 'duration', 'fps', 'background', 'loop', 'dither', 'relief', 'ambient', 'camera3d', 'lighting', 'style']) if (a[k] !== undefined) { if (a[k] === null) delete scene[k]; else scene[k] = a[k]; } }); return summary('Настройки обновлены.'); },
  },
  {
    name: 'scene_get_json',
    description: 'Получить полный JSON сцены (или одного узла по id).',
    inputSchema: { type: 'object', properties: { id: STR } },
    run: ({ id }) => text(id ? scene.nodes.find((n) => n.id === id) ?? `Узел ${id} не найден` : scene),
  },
  {
    name: 'scene_set_json',
    description: 'Заменить всю сцену JSON-объектом (формат — см. docs). Удобно, чтобы задать сложную сцену одним вызовом.',
    inputSchema: { type: 'object', properties: { scene: OBJ }, required: ['scene'] },
    run: ({ scene: s }) => {
      const errs = validateScene(s);
      if (errs.length) throw new Error(errs.join('\n'));
      mutate('замена сцены', () => { scene = s; });
      return summary('Сцена заменена.');
    },
  },
  {
    name: 'scene_open',
    description: 'Открыть сцену из файла JSON (дальше автосохранение идёт в него) или один из примеров: "examples/bay.json", "examples/flow.json", "examples/liquid.json", "examples/reveal.json".',
    inputSchema: { type: 'object', properties: { path: STR, edits: { description: '"auto" (по умолчанию: если рядом есть <имя>.edits.json или <имя>.build.mjs), true — хранить правки отдельно, false — писать прямо в файл' } }, required: ['path'] },
    run: ({ path, edits: withEdits = 'auto' }) => {
      let p = resolve(path);
      if (!existsSync(p) && existsSync(resolve(ROOT, path))) { const ex = resolve(ROOT, path); const s = rebase(loadFrom(ex), dirname(ex), baseDir()); mutate('открыть пример', () => { scene = s; }); return summary(`Открыт пример ${path} (сохраняется в ${scenePath}).`); }
      openScene(p, withEdits);
      invalidate(scene); rev++; broadcast();
      const ei = editsInfo();
      return summary(`Открыт ${p}.${ei.mode ? ` Правки хранятся отдельно: ${ei.path} (объектов: ${ei.count})${ei.warnings.length ? '\nПредупреждения:\n' + ei.warnings.join('\n') : ''}` : ''}`);
    },
  },
  {
    name: 'scene_save_as',
    description: 'Сохранить сцену в другой файл; дальнейшее автосохранение пойдёт туда.',
    inputSchema: { type: 'object', properties: { path: STR }, required: ['path'] },
    run: ({ path }) => { const old = baseDir(); stopWatch(); editsMode = false; base = null; edits = null; editsPath = null; editWarnings = []; scenePath = resolve(path); scene = rebase(scene, old, baseDir()); save(); return text(`Сохранено: ${scenePath} (целиком, без файла правок)`); },
  },
  {
    name: 'node_add',
    description: `Добавить узел. type: ${NODE_TYPES.join(', ')}. props — свойства (x, y, fill, stroke, r, width, d, repeat, clip...), keys — ключевые кадры {prop:[{t,v,ease}]}, mods — модификаторы [{type,...}]. Можно сразу задать всё.`,
    inputSchema: { type: 'object', properties: { id: STR, type: { type: 'string', enum: NODE_TYPES }, parent: STR, props: OBJ, keys: OBJ, mods: { type: 'array', items: OBJ }, index: NUM }, required: ['type'] },
    run: (a) => { const n = mutate(`добавить ${a.type}`, () => ops.addNode(scene, a)); return text(`Добавлен узел ${n.id}.`); },
  },
  {
    name: 'nodes_add_batch',
    description: 'Добавить несколько узлов за один вызов (массив объектов как у node_add). Атомарно: при ошибке ничего не меняется.',
    inputSchema: { type: 'object', properties: { nodes: { type: 'array', items: OBJ } }, required: ['nodes'] },
    run: ({ nodes }) => { const ids = mutate('добавить пакет', () => nodes.map((n) => ops.addNode(scene, n).id)); return summary(`Добавлено: ${ids.join(', ')}.`); },
  },
  {
    name: 'node_update',
    description: 'Изменить узел: props (слияние; replaceProps:true — заменить целиком), unset — список удаляемых свойств, newId — переименовать, parent — сменить родителя (null — в корень), type.',
    inputSchema: { type: 'object', properties: { id: STR, props: OBJ, replaceProps: { type: 'boolean' }, unset: { type: 'array', items: STR }, newId: STR, parent: { type: ['string', 'null'] }, type: STR }, required: ['id'] },
    run: ({ id, ...a }) => { mutate('изменить узел', () => ops.updateNode(scene, id, a)); return text(`Узел ${a.newId || id} обновлён.`); },
  },
  {
    name: 'node_remove',
    description: 'Удалить узел вместе с потомками.',
    inputSchema: { type: 'object', properties: { id: STR }, required: ['id'] },
    run: ({ id }) => { const k = mutate('удалить', () => ops.removeNode(scene, id)); return text(`Удалено: ${k.join(', ')}.`); },
  },
  {
    name: 'node_duplicate',
    description: 'Дублировать узел с потомками.',
    inputSchema: { type: 'object', properties: { id: STR, newId: STR, props: OBJ }, required: ['id'] },
    run: ({ id, newId, props }) => {
      const n = mutate('дублировать', () => { const c = ops.duplicateNode(scene, id, newId); if (props) ops.updateNode(scene, c.id, { props }); return c; });
      return text(`Копия: ${n.id}.`);
    },
  },
  {
    name: 'node_reorder',
    description: 'Переместить узел в списке отрисовки (index 0 — самый нижний слой).',
    inputSchema: { type: 'object', properties: { id: STR, index: NUM }, required: ['id', 'index'] },
    run: ({ id, index }) => { mutate('порядок', () => ops.reorder(scene, id, index)); return text('Готово.'); },
  },
  {
    name: 'keys_set',
    description: 'Задать (заменить) все ключевые кадры свойства. keys: [{t, v, ease}] — ease описывает кривую до следующего ключа. Для формы используйте prop "d" со значениями path/описаниями фигур — получится морфинг. Пустой массив — удалить анимацию.',
    inputSchema: { type: 'object', properties: { id: STR, prop: STR, keys: { type: 'array', items: KEY } }, required: ['id', 'prop', 'keys'] },
    run: ({ id, prop, keys }) => { mutate('ключи', () => ops.setKeys(scene, id, prop, keys)); return text(`${id}.${prop}: ${keys.length} ключей.`); },
  },
  {
    name: 'keys_set_many',
    description: 'Задать ключевые кадры для нескольких свойств/узлов за один вызов: tracks: [{id, prop, keys:[...]}].',
    inputSchema: { type: 'object', properties: { tracks: { type: 'array', items: { type: 'object', properties: { id: STR, prop: STR, keys: { type: 'array', items: KEY } }, required: ['id', 'prop', 'keys'] } } }, required: ['tracks'] },
    run: ({ tracks }) => { mutate('ключи (пакет)', () => tracks.forEach((tr) => ops.setKeys(scene, tr.id, tr.prop, tr.keys))); return text(`Обновлено дорожек: ${tracks.length}.`); },
  },
  {
    name: 'key_add',
    description: 'Добавить или заменить один ключевой кадр (ключ с тем же временем заменяется).',
    inputSchema: { type: 'object', properties: { id: STR, prop: STR, t: NUM, v: ANY, ease: ANY, hold: { type: 'boolean' } }, required: ['id', 'prop', 't', 'v'] },
    run: ({ id, prop, ...k }) => { const arr = mutate('ключ', () => ops.addKey(scene, id, prop, k)); return text(`${id}.${prop}: ключей ${arr.length}.`); },
  },
  {
    name: 'keys_clear',
    description: 'Удалить анимацию свойства (или всех свойств узла, если prop не указан).',
    inputSchema: { type: 'object', properties: { id: STR, prop: STR }, required: ['id'] },
    run: ({ id, prop }) => { mutate('очистить ключи', () => ops.clearKeys(scene, id, prop)); return text('Готово.'); },
  },
  {
    name: 'animate',
    description: 'Быстрая анимация свойства: от from (по умолчанию — текущее значение в момент start) к to за duration секунд с кривой ease. Существующие ключи вне интервала сохраняются.',
    inputSchema: { type: 'object', properties: { id: STR, prop: STR, from: ANY, to: ANY, start: NUM, duration: NUM, ease: ANY }, required: ['id', 'prop', 'to'] },
    run: ({ id, prop, ...o }) => { mutate('анимация', () => ops.animate(scene, id, prop, o)); return text(`${id}.${prop} анимирован.`); },
  },
  {
    name: 'image_add',
    description: 'Добавить растровый слой (PNG/JPG/WebP/GIF/SVG) из локального файла, URL или data: URI. По умолчанию файл копируется в папку assets/ рядом со сценой, размер берётся из файла (можно задать width или height — второй посчитается по пропорции). Слой центрируется в (x, y), поддерживает все трансформации, opacity, blend (например multiply/overlay для фактур), clip/mask, ключи и модификаторы. fit: stretch|contain|cover, pixelated: true — для пиксель-арта. sheet: {cols, rows, count, fps, frameWidth, frameHeight, loop} — спрайт-лист с покадровой анимацией (или анимируйте свойство frame).',
    inputSchema: { type: 'object', properties: { path: STR, id: STR, parent: STR, x: NUM, y: NUM, width: NUM, height: NUM, fit: { type: 'string', enum: ['stretch', 'contain', 'cover'] }, pixelated: { type: 'boolean' }, copy: { type: 'boolean' }, embed: { type: 'boolean' }, sheet: OBJ, props: OBJ, index: NUM }, required: ['path'] },
    run: async (a) => {
      let src, buf = null, name;
      if (/^data:/i.test(a.path)) {
        src = a.path;
        const m = /^data:[^;,]+(;base64)?,(.*)$/s.exec(a.path);
        if (m) buf = m[1] ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]));
      } else if (/^https?:/i.test(a.path)) {
        const r = await fetch(a.path);
        if (!r.ok) throw new Error(`Не удалось скачать ${a.path}: HTTP ${r.status}`);
        buf = Buffer.from(await r.arrayBuffer());
        name = basename(new URL(a.path).pathname) || 'image.png';
        if (a.copy === false && !a.embed) src = a.path;
      } else {
        const p = resolve(a.path);
        if (!existsSync(p)) throw new Error(`Файл не найден: ${p}`);
        buf = readFileSync(p); name = basename(p);
        if (a.embed) src = fileToDataURI(p);
        else if (a.copy === false) src = toRel(baseDir())(p);
      }
      if (!src && buf) {
        if (a.embed) src = `data:${IMAGE_MIME[extname(name).toLowerCase()] || 'image/png'};base64,${buf.toString('base64')}`;
        else {
          const dir = resolve(baseDir(), 'assets');
          mkdirSync(dir, { recursive: true });
          let dest = resolve(dir, name), i = 1;
          const stem = name.replace(/\.[^.]+$/, ''), ext = extname(name) || '.png';
          while (existsSync(dest) && !(isAbsolute(a.path) && resolve(a.path) === dest)) {
            const same = readFileSync(dest).equals(buf);
            if (same) break;
            dest = resolve(dir, `${stem}-${++i}${ext}`);
          }
          if (!existsSync(dest)) writeFileSync(dest, buf);
          src = toRel(baseDir())(dest);
        }
      }
      const size = buf ? imageSize(buf) : null;
      let nw = size?.width ?? 100, nh = size?.height ?? 100;
      if (a.sheet?.cols) {
        a.sheet = { ...a.sheet, frameWidth: a.sheet.frameWidth ?? nw / a.sheet.cols, frameHeight: a.sheet.frameHeight ?? nh / (a.sheet.rows || 1) };
        nw = a.sheet.frameWidth; nh = a.sheet.frameHeight;
      }
      let w = a.width, h = a.height;
      if (w && !h) h = (w * nh) / nw;
      else if (h && !w) w = (h * nw) / nh;
      else if (!w && !h) { w = nw; h = nh; }
      const props = { x: a.x ?? scene.width / 2, y: a.y ?? scene.height / 2, width: w, height: h, src, ...(a.fit ? { fit: a.fit } : {}), ...(a.pixelated ? { pixelated: true } : {}), ...(a.sheet ? { sheet: a.sheet } : {}), ...(a.props || {}) };
      const n = mutate('растровый слой', () => ops.addNode(scene, { id: a.id, type: 'image', parent: a.parent, props, index: a.index }));
      return text(`Добавлен растровый слой ${n.id}: ${typeof src === 'string' && src.startsWith('data:') ? 'встроен в сцену' : src}, ${Math.round(w)}×${Math.round(h)}${size ? ` (исходник ${size.width}×${size.height})` : ''}.`);
    },
  },
  {
    name: 'dither_set',
    description: `Дизеринг теней: упорядоченный растр вместо плоской заливки. enabled — глобальный переключатель для всех узлов-теней (свойство shade: true); shade/unshade — пометить узлы как тени или снять пометку. Параметры по умолчанию для всех: pattern (${Object.keys(DITHER_PATTERNS).join(', ')}), cell (размер «пикселя» растра, px), density (0..1 или [от, до] — плавный переход вдоль angle, 90° = сверху вниз), color (по умолчанию — заливка узла). Отдельный узел может переопределить: props.dither = {...} или false.`,
    inputSchema: { type: 'object', properties: { enabled: { type: 'boolean' }, pattern: { type: 'string', enum: Object.keys(DITHER_PATTERNS) }, cell: NUM, density: ANY, angle: NUM, color: STR, shade: { type: 'array', items: STR }, unshade: { type: 'array', items: STR } } },
    run: (a) => {
      mutate('дизеринг', () => {
        const d = { ...(scene.dither || { enabled: false, pattern: 'bayer4', cell: 3, density: 0.5, angle: 90 }) };
        for (const k of ['enabled', 'pattern', 'cell', 'density', 'angle', 'color']) if (a[k] !== undefined) d[k] = a[k];
        scene.dither = d;
        for (const id of a.shade || []) ops.updateNode(scene, id, { props: { shade: true } });
        for (const id of a.unshade || []) ops.updateNode(scene, id, { unset: ['shade'] });
      });
      const count = scene.nodes.filter((n) => n.props?.shade).length;
      return text(`Дизеринг ${scene.dither.enabled ? 'включён' : 'выключен'}: ${JSON.stringify(scene.dither)}. Узлов-теней: ${count}.`);
    },
  },
  {
    name: 'normal_map_generate',
    description: `Сгенерировать карту нормалей (PNG, для 2D-освещения в Godot и других движках) и показать превью освещения.
target: "scene" — кадр сцены целиком; "nodes" — только узлы ids (с потомками, на прозрачном фоне); "image" — растровый файл (file) или растровый слой (id).
Векторный рельеф: каждая фигура — «подушка» с фаской. Настройки по умолчанию для всей сцены — scene.relief, для узла — props.relief {height 0..1, depth, bevel px, profile round|linear|sharp|flat, invert (вдавлено), luma}; relief:false — узел не участвует. Слои с blend и полупрозрачные не участвуют.
settings (все необязательны): strength (крутизна, ${NORMAL_DEFAULTS.strength}), blur (сглаживание высот, px, ${NORMAL_DEFAULTS.blur}), bevel (${NORMAL_DEFAULTS.bevel}), depth (${NORMAL_DEFAULTS.depth}), height (${NORMAL_DEFAULTS.height}), profile, detail (0..1 — мелкий рельеф из яркости цвета, ${NORMAL_DEFAULTS.detail}), detailRadius (${NORMAL_DEFAULTS.detailRadius}), luma (вклад яркости растровых слоёв), yUp (true — OpenGL/Godot, false — DirectX/Unity HDRP), invertX; для image: base, invertLuma, lumaBlur.
attach: true — записать путь в props.normalMap растрового слоя (для target image с id).`,
    inputSchema: { type: 'object', properties: {
      target: { type: 'string', enum: ['scene', 'nodes', 'image'] }, ids: { type: 'array', items: STR }, id: STR, file: STR,
      t: NUM, width: NUM, out: STR, settings: OBJ, saveHeight: { type: 'boolean' }, preview: { type: 'boolean' },
      light: { type: 'object', properties: { x: NUM, y: NUM, z: NUM, ambient: NUM, intensity: NUM } }, attach: { type: 'boolean' },
    } },
    run: async (a) => {
      await probeRaster();
      if (!canPng()) throw new Error(`Для генерации нормалей нужен растеризатор SVG: ${capabilities.pngError}. ${rasterHelp()}`);
      const target = a.target || (a.ids ? 'nodes' : a.file || a.id ? 'image' : 'scene');
      const settings = a.settings || {};
      let r, name;
      if (target === 'image') {
        let p;
        if (a.file) p = resolve(a.file);
        else {
          const n = scene.nodes.find((x) => x.id === a.id);
          if (!n || n.type !== 'image') throw new Error(`Растровый слой ${a.id} не найден`);
          p = resolveSrc(n.props.src, baseDir());
          if (!p) throw new Error('У слоя нет локального файла (src — URL или data:). Сохраните картинку в файл и укажите file.');
        }
        r = await imageNormalMap(readFileSync(p), IMAGE_MIME[extname(p).toLowerCase()] || 'image/png', settings);
        name = basename(p).replace(/\.[^.]+$/, '');
      } else {
        const S0 = S();
        r = await sceneNormalMap(S0, { t: a.t || 0, only: target === 'nodes' ? a.ids : undefined, width: a.width, settings });
        name = target === 'nodes' ? a.ids.join('+') : 'scene';
      }
      const out = resolve(a.out || resolve(baseDir(), 'normals', `${name}_n.png`));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, encodePNG(r.normal));
      let extra = '';
      if (a.saveHeight) { const hp = out.replace(/(_n)?\.png$/i, '_h.png'); writeFileSync(hp, encodePNG(r.height)); extra += `\nКарта высот: ${hp}`; }
      if (a.attach && a.id) {
        const rel = toRel(baseDir())(out);
        mutate('карта нормалей', () => ops.updateNode(scene, a.id, { props: { normalMap: rel } }));
        extra += `\nСлой ${a.id}: normalMap = ${rel}`;
      }
      const content = [{ type: 'text', text: `Карта нормалей: ${out} (${r.normal.width}×${r.normal.height}, ${r.settings.yUp === false ? 'DirectX, Y вниз' : 'OpenGL/Godot, Y вверх'}).${extra}` }];
      if (a.preview !== false) {
        const lit = litPreview(r.color, r.normal, { ...(a.light || {}), yUp: r.settings.yUp !== false });
        const pv = sideBySide([scaleDown(r.normal, 640), scaleDown(lit, 640)]);
        content.unshift({ type: 'image', data: encodePNG(pv).toString('base64'), mimeType: 'image/png' });
        content.push({ type: 'text', text: 'Слева — карта нормалей, справа — превью освещения точечным светом (light.x/y — доли кадра, z — высота).' });
      }
      return { content };
    },
  },
  {
    name: 'camera3d_set',
    description: 'Камера 2.5D-сцены (scene.camera3d): P([X,Y,Z]) = [cx + f·X/(Z+dz), hor + f·(camH − Y)/(Z+dz)]; мир: 1 ед. ≈ 1 м, Y вверх, Z вглубь от камеры. hor — экранная Y горизонта, f — фокус в px (больше — уже угол), camH — высота камеры, dz — отъезд назад (ослабляет искажения по краям), cx — экранная X точки схода (по умолчанию середина). Подбор: charPx — рост персонажа (1.7 м) у нижнего края кадра в px (bottom — экранная Y этого края, по умолчанию высота сцены): camH = 1.7·(bottom − hor)/charPx. rebuild (по умолчанию true) — пересобрать группы world_build под новую камеру. Без параметров — показать текущую; remove: true — удалить.',
    inputSchema: { type: 'object', properties: { hor: NUM, f: NUM, camH: NUM, dz: NUM, cx: NUM, charPx: NUM, bottom: NUM, rebuild: { type: 'boolean' }, remove: { type: 'boolean' } } },
    run: (a) => {
      if (a.remove) { mutate('камера 3D', () => { delete scene.camera3d; }); return text('camera3d удалена: сцена снова чисто 2D (отложенный свет недоступен).'); }
      if (!['hor', 'f', 'camH', 'dz', 'cx', 'charPx'].some((k) => a[k] != null)) return text(scene.camera3d ? `camera3d: ${JSON.stringify(scene.camera3d)}` : 'camera3d не задана.');
      let rb = [];
      const c = mutate('камера 3D', () => { const c = cameraSet(scene, a); if (a.rebuild !== false) rb = rebuildWorlds(scene); return c; });
      const charAt = (Z) => ((c.f * 1.7) / (Z + c.dz)).toFixed(0);
      return text(`camera3d: ${JSON.stringify(c)}. Рост персонажа (1.7 м): ${charAt(4)} px на Z=4, ${charAt(10)} px на Z=10, ${charAt(20)} px на Z=20.${rb.length ? ` Пересобрано групп мира: ${rb.map((r) => r.group).join(', ')}.` : ''}`);
    },
  },
  {
    name: 'world_build',
    description: `Собрать 2.5D-окружение из 3D-описания: объекты проецируются камерой camera3d (нет — подбирается) в обычные узлы-контуры с props.surface (нормаль, плоскость, блик, свечение, контур) и окклюдерами для теней. Результат — группа group (по умолчанию "world"; повторный вызов с тем же group заменяет её); описание хранится в группе и пересобирается при смене камеры. Порядок рисования — по глубине (key, обычно ближняя Z). items:
• {type:"box", x:[x0,x1], y:[y0,y1], z:[z0,z1], color, mats:{front|back|left|right|top|side|all: [материал, цвет, параметры]}, top, sides, spec, emissive, key, occ}
• {type:"house", x:[x0,x1], z:[z0,z1], h, color, roof, mat:"plaster"|"stone"|"brick", ridge:"z" (конёк вглубь, иначе вдоль X), roofType:"flat", facades:["front","left","right"], doorAt, shut (цвет ставен), plinth, chimney (0..1), pipe:"end", litP (доля горящих окон), skip}
• {type:"cyl", X, Z, r, y:[y0,y1], color, top, bands, n} • {type:"disc", X, Y, Z, rx, rz, color, spec, base, ink, wob, normal, opacity} — лужи, люки
• {type:"stairs", x:[x0,x1], z:[z0,z1], h, steps, color, mat} • {type:"ground", x:[x0,x1], z:[z0,z1], y, color, mat:"cobble", maxZ}
• {type:"wall", ps:[[X,Y,Z],…], color, mat, matColor, matOpt, spec, emissive} — грань-многоугольник (арка, фронтон; детали обрезаются по ней)
• {type:"window"|"door"|"pipe"|"ivy", on:{ps:[…]} или {o,u,v,w,h,n}, a, b (координаты на грани, м), w, h, lit, shut, box, color, density}
• {type:"lamp", X, Y, Z, h, color, radius, energy} — фонарь со светом • {type:"light", p:[X,Y,Z], color, radius (м), energy, group:"lamp"|"window"|"candle", shadows}
• {type:"cloud", x, y, rx, ry, color, opacity} — облако (экранные px, остаётся небом)
Материалы: ${MATERIALS.join(', ')}. Цвета — #hex или имена палитры (stone, brick, plaster, wood, roof, cobble, glass, glow…). seed — случайность (детерминирована). sky — [верх, середина, низ] неба (фон сцены).`,
    inputSchema: { type: 'object', properties: { items: { type: 'array', items: OBJ }, group: STR, seed: NUM, sky: { type: 'array', items: STR }, background: { type: 'boolean' }, parent: STR }, required: ['items'] },
    run: (a) => {
      const r = mutate(`мир ${a.group || 'world'}`, () => worldBuild(scene, a));
      return text(`Группа ${r.group}: объектов ${r.items}, узлов ${r.nodes}, источников света ${r.lights}, окклюдеров ${r.occluders}. camera3d: ${JSON.stringify(scene.camera3d)}.${r.errors.length ? `\nОшибки: ${r.errors.join('; ')}` : ''}\nПроверка: render_frame с lit: "deferred" (debug: true — проходы).`);
    },
  },
  {
    name: 'material_apply',
    description: `Наложить материал на узел-грань с surface.plane: детали (кладка, доски, черепица, брусчатка — с наклонёнными нормалями-фасками) строятся на плоскости грани в рамке по габаритам узла и кладутся группой <id>_mat сразу после него, обрезанные его контуром. Повторный вызов заменяет материал. material: ${MATERIALS.join(', ')}; color; options (brick: bw, bh; stone: bh, moss:false; wood: pw, vert; tile: rh, tw; cobble: maxZ; plaster: patches); seed.`,
    inputSchema: { type: 'object', properties: { id: STR, material: { type: 'string', enum: MATERIALS }, color: STR, options: OBJ, seed: NUM }, required: ['id', 'material'] },
    run: (a) => { const r = mutate(`материал ${a.material}`, () => materialApply(scene, a)); return text(`Материал ${a.material} на ${a.id}: группа ${r.group}, узлов ${r.nodes}, рамка ${r.frame.w.toFixed(2)}×${r.frame.h.toFixed(2)} м.`); },
  },
  {
    name: 'surface_set',
    description: 'Правка props.surface у узлов — поверхность для отложенного света. Наследуются детьми: plane, normal, u, v, spec, emissive, tag, sky; свои у узла: base, bump, ink, sw, tilt. Поля: normal [x,y,z] — нормаль для света (мир: Y вверх, Z от камеры; к камере — [0,0,-1]); tilt [du,dv,k] — наклон относительно нормали родительской грани (рельеф); plane [nx,ny,nz,d] (n·P = d) — плоскость для позиции пикселя; spec 0..1 (стекло 0.9, металл 0.6, вода 1, штукатурка 0.1); emissive — цвет свечения; base: true — тело (перекрывает всё за собой в проходах); bump: true — деталь меняет только нормаль; ink + sw — контур и толщина; tag — метка маски (персонажи — "chr": мягкий свет); sky: true — фигура неба. По умолчанию поля сливаются; replace — заменить целиком; unset — убрать поля; surface: false — снять поверхность.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: STR }, surface: ANY, unset: { type: 'array', items: STR }, replace: { type: 'boolean' } }, required: ['ids'] },
    run: ({ ids, surface, unset = [], replace }) => {
      mutate('поверхность', () => {
        for (const id of ids) {
          const n = scene.nodes.find((x) => x.id === id);
          if (!n) throw new Error(`Узел ${id} не найден`);
          n.props = n.props || {};
          if (surface === false || surface === null) { delete n.props.surface; continue; }
          const cur = replace || typeof n.props.surface !== 'object' || !n.props.surface ? {} : { ...n.props.surface };
          Object.assign(cur, surface || {});
          for (const k of unset) delete cur[k];
          n.props.surface = cur;
        }
      });
      return text(ids.map((id) => `${id}: ${JSON.stringify(surfaceOfNode(scene, id))}`).join('\n'));
    },
  },
  {
    name: 'lighting_set',
    description: `Глобальный свет отложенного рендера (scene.lighting). preset: ${Object.entries(LIGHT_PRESETS).map(([k, v]) => `${k} (${v.title})`).join(', ')}. Поля (необязательны, сливаются с пресетом): sun {dir [x,y,z] — направление НА солнце, color, energy, wrap (мягкость 0..0.3), shadows}, sky {color, energy}, ground {color, energy}, ao {strength, radius}, fog {color, density, start, amount}, bloom {strength, threshold}, exposure, saturation, tonemap ("aces"|"none"), emissive (сила свечения), specular (сила бликов), groups {lamp, window, candle} — множители групп источников, lightShadows (тени от ламп), characters {tag, amount}, backdrop {mode: "albedo"|"gradient", colors [верх, середина, низ], clouds, stars, moon {x (доля ширины), y, r}}. Цвета света — #hex (доля = значение/255, без гаммы) или [r,g,b] 0..1. replace — заменить, а не слить. При смене пресета берётся и его стиль (withStyle: false — оставить текущий).`,
    inputSchema: { type: 'object', properties: { preset: { type: 'string', enum: Object.keys(LIGHT_PRESETS) }, sun: OBJ, sky: OBJ, ground: OBJ, ao: OBJ, fog: OBJ, bloom: OBJ, exposure: NUM, saturation: NUM, tonemap: STR, emissive: NUM, specular: NUM, groups: OBJ, lightShadows: { type: 'boolean' }, characters: OBJ, backdrop: OBJ, replace: { type: 'boolean' }, withStyle: { type: 'boolean' } } },
    run: (a) => {
      const { replace, withStyle, ...fields } = a;
      mutate('свет', () => {
        const isO = (v) => v && typeof v === 'object' && !Array.isArray(v);
        const cur = replace ? {} : { ...(scene.lighting || {}) };
        for (const [k, v] of Object.entries(fields)) cur[k] = isO(v) && isO(cur[k]) ? { ...cur[k], ...v } : v;
        scene.lighting = cur;
        if (a.preset && withStyle !== false) scene.style = LIGHT_PRESETS[a.preset].style.map((x) => ({ ...x }));
      });
      const st = resolveLighting(scene);
      return text(`scene.lighting: ${JSON.stringify(scene.lighting)}\nИтог: солнце [${st.sun.dir.map((v) => v.toFixed(2))}] ×${st.sun.energy}, небо ×${st.sky.energy}, AO ${st.ao.strength}, группы ${JSON.stringify(st.groups)}, экспозиция ${st.exposure}, туман ${st.fog.density}.\nСтиль: ${resolveStyle(scene).map((x) => x.type).join(' → ') || '—'}`);
    },
  },
  {
    name: 'style_set',
    description: `Цепочка пост-эффектов отложенного рендера (scene.style), по порядку. Типы: {type:"cel", steps:[0.12,0.5], detail:0.5} — ступенчатый свет по нормали плоскости + мягкий рельеф; {type:"hatch", below:0.42, period:9, color} — штриховка в тенях; {type:"kuwahara", radius:3} — мазки; {type:"pixelate", size:4 (px сцены), colors:56, bayer:0.07} — пиксели + Байер + палитра; {type:"ink", strength, color} — контур из прохода ink; {type:"vignette", strength:0.22}. Размеры заданы для кадра 2560 px и масштабируются. enabled: false — выключить звено. preset — стиль пресета (${Object.keys(LIGHT_PRESETS).join(', ')}); chain: [] — без стиля. Без параметров — показать текущий.`,
    inputSchema: { type: 'object', properties: { chain: { type: 'array', items: OBJ }, preset: { type: 'string', enum: Object.keys(LIGHT_PRESETS) } } },
    run: ({ chain, preset }) => {
      if (!chain && !preset) return text(`Стиль: ${scene.style ? JSON.stringify(scene.style) : `(по пресету света) ${resolveStyle(scene).map((x) => x.type).join(' → ')}`}`);
      for (const s of chain || []) if (!STYLE_TYPES.includes(s?.type)) throw new Error(`Тип стиля ${s?.type}? Есть: ${STYLE_TYPES.join(', ')}`);
      mutate('стиль', () => { scene.style = chain || LIGHT_PRESETS[preset].style.map((x) => ({ ...x })); });
      return text(`Стиль: ${scene.style.map((x) => x.type).join(' → ') || 'без эффектов'}.`);
    },
  },
  {
    name: 'render_passes',
    description: 'Выгрузить проходы отложенного света в PNG (папка dir, по умолчанию <папка сцены>/passes): color (альбедо), normal (мировые нормали), plane (нормаль плоскости; альфа — геометрия), planeD (d плоскости 16 бит в R,G, блик в B), emissive, ink (маска контуров), cover (покрытие не-небом), mask_<метка> (masks, по умолчанию chr); normal_map — нормали в соглашении 2D-движков (Y вверх, Z к зрителю; yUp: false — Y вниз) для URP 2D / CanvasTexture; с lit: true — ещё shadow_ao и lit (итог). Возвращает превью.',
    inputSchema: { type: 'object', properties: { t: NUM, width: NUM, dir: STR, masks: { type: 'array', items: STR }, lit: { type: 'boolean' }, yUp: { type: 'boolean' } } },
    run: async ({ t = 0, width, dir, masks = ['chr'], lit, yUp = true }) => {
      await probeRaster();
      if (!canPng()) throw new Error(`Нужен растеризатор SVG: ${capabilities.pngError}. ${rasterHelp()}`);
      const sc = S(), w = Math.round(width || sc.width);
      const out = resolve(dir || resolve(baseDir(), 'passes'));
      mkdirSync(out, { recursive: true });
      const p = await renderPasses(sc, t, { width: w, masks });
      const files = [];
      const put = (name, buf) => { const f = resolve(out, `${name}.png`); writeFileSync(f, buf); files.push(f); };
      for (const [k, png] of Object.entries(p)) put(k.replace(':', '_'), png);
      put('normal_map', encodePNG(normalMapFromPass(p.normal, { yUp })));
      let litImg = null;
      if (lit) {
        if (!sc.camera3d) throw new Error('lit: true требует camera3d (camera3d_set)');
        const r = await renderLit(sc, t, { width: w, passes: p, debug: true });
        put('lit', r.png); put('shadow_ao', encodePNG(r.shadowAO)); litImg = r.image;
      }
      const tiles = [decodePNG(p.color), decodePNG(p.normal), litImg || decodePNG(p.emissive)].map((im) => scaleDown(im, 480));
      return { content: [{ type: 'image', data: encodePNG(sideBySide(tiles)).toString('base64'), mimeType: 'image/png' }, { type: 'text', text: `Проходы ${w}px (превью: color | normal | ${litImg ? 'lit' : 'emissive'}):\n${files.join('\n')}` }] };
    },
  },
  {
    name: 'compat_check',
    description: 'Проверка совместимости сцены с целевой платформой: что потеряется при импорте SVG (свечение, размытие, тени, режимы наложения, растр-дизеринг, маски, текст, анимация, свет) и как это перенести. target "godot" (импорт SVG в Godot 4) или "unity" (пакет Vector Graphics). Export format "godot"/"unity" запекает эффекты в PNG-слои.',
    inputSchema: { type: 'object', properties: { target: { type: 'string', enum: ['godot', 'unity'] } } },
    run: ({ target = 'godot' }) => {
      const issues = compatReport(scene, target);
      const U = target === 'unity';
      if (!issues.length) return text(`Замечаний нет: сцена использует только то, что ${U ? 'Unity (Vector Graphics)' : 'Godot'} импортирует из SVG.`);
      return text(`Замечаний: ${issues.length}\n` + issues.map((i) => `• ${i.node}: ${i.feature} — ${i.effect}`).join('\n') + (U
        ? '\n\nРешение без ручной переделки: export format "unity" — слои с эффектами запекаются в PNG-спрайты, анимация — в клипы Animator, свет — в Light2D (URP), всё собрано в префаб.'
        : '\n\nРешение без ручной переделки: export format "godot" — слои с эффектами запекаются в PNG, анимация — в AnimatedSprite2D по клипам.'));
    },
  },
  {
    name: 'clip_set',
    description: 'Создать или изменить именованный клип — отрезок общей шкалы времени (idle, walk, talk...). start/end в секундах, loop (по умолчанию true), fps (для экспорта спрайтов), next — какой клип играть после неповторяющегося. Если end больше длительности сцены, она увеличится. Раскладывайте клипы на шкале последовательно, например idle 0–2, walk 2–3.2, talk 3.2–5.',
    inputSchema: { type: 'object', properties: { name: STR, start: NUM, end: NUM, loop: { type: 'boolean' }, fps: NUM, next: STR }, required: ['name', 'start', 'end'] },
    run: (a) => { mutate(`клип ${a.name}`, () => ops.setClip(scene, a)); return summary(`Клип ${a.name}: ${a.start}–${a.end}s.`); },
  },
  {
    name: 'clip_remove',
    description: 'Удалить именованный клип (анимация на шкале остаётся).',
    inputSchema: { type: 'object', properties: { name: STR }, required: ['name'] },
    run: ({ name }) => { const n = mutate('удалить клип', () => ops.removeClip(scene, name)); return text(n ? `Клип ${name} удалён.` : `Клипа ${name} нет.`); },
  },
  {
    name: 'mod_add',
    description: `Добавить процедурный модификатор узлу. Типы: ${Object.entries(MODIFIERS).map(([k, v]) => `${k} — ${v.doc}`).join(' | ')}. Общие поля: start, end, fadeIn, fadeOut, weight, enabled.`,
    inputSchema: { type: 'object', properties: { id: STR, mod: { type: 'object', properties: { type: { type: 'string', enum: Object.keys(MODIFIERS) } }, required: ['type'] } }, required: ['id', 'mod'] },
    run: ({ id, mod }) => { const i = mutate('модификатор', () => ops.addMod(scene, id, mod)); return text(`Модификатор ${mod.type} добавлен к ${id} (индекс ${i}).`); },
  },
  {
    name: 'mod_remove',
    description: 'Удалить модификатор узла: по индексу, по типу, или все (если не указано).',
    inputSchema: { type: 'object', properties: { id: STR, index: NUM, type: STR }, required: ['id'] },
    run: ({ id, index, type }) => { const n = mutate('удалить модификатор', () => ops.removeMod(scene, id, index ?? type)); return text(`Удалено модификаторов: ${n}.`); },
  },
  {
    name: 'preset_apply',
    description: `Применить анимационный пресет. ${Object.entries(PRESETS).map(([k, v]) => `${k}: ${v.doc}`).join(' | ')}`,
    inputSchema: { type: 'object', properties: { preset: { type: 'string', enum: Object.keys(PRESETS) }, params: OBJ }, required: ['preset', 'params'] },
    run: ({ preset, params }) => { mutate(`пресет ${preset}`, () => applyPreset(scene, preset, params)); return summary(`Пресет ${preset} применён.`); },
  },
  {
    name: 'render_frame',
    description: 'Отрендерить кадр в момент t и вернуть изображение (PNG), чтобы увидеть результат. format "svg" вернёт SVG-текст. states — варианты групп состояний {группа: вариант}; lit — с освещением источниками light по карте нормалей (true или {ambient}); lit: "deferred" (или {mode: "deferred", lighting, style}) — отложенный свет 2.5D-сцены (camera3d + props.surface): солнце с тенями лучами по окклюдерам, AO, лампы с тенями, блики, свечение, туман, bloom и стиль (scene.lighting, scene.style); debug: true — лист «цвет | нормали / тени×AO | итог»; out — сохранить итог в PNG. pixel: false — без пиксельного режима сцены.',
    inputSchema: { type: 'object', properties: { t: NUM, width: NUM, format: { type: 'string', enum: ['png', 'svg'] }, states: OBJ, lit: ANY, pixel: { type: 'boolean' }, debug: { type: 'boolean' }, out: STR }, required: ['t'] },
    run: async ({ t, width = 800, format = 'png', states, lit, pixel, debug, out }) => {
      await probeRaster();
      if (format === 'svg' || !canPng()) return text((canPng() ? '' : `(PNG недоступен: ${capabilities.pngError}. ${rasterHelp()} Ниже SVG кадра.)\n`) + renderSVG(S(), t, { width, states }));
      if (lit === 'deferred' || lit?.mode === 'deferred') {
        const r = await renderLit(S(), t, { width, states, debug, lighting: lit?.lighting, style: lit?.style });
        if (out) { const p = resolve(out); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, r.png); }
        const st = r.stats;
        return { content: [{ type: 'image', data: (debug ? r.debug : r.png).toString('base64'), mimeType: 'image/png' }, { type: 'text', text: `t = ${t}s, отложенный свет: пресет ${st.preset}, стиль [${st.style.join(', ')}], источников ${st.litLights}/${st.lights}, окклюдеров ${st.boxes} коробок + ${st.tris} треугольников, ${st.width}×${st.height}, ${(st.ms / 1000).toFixed(1)} с (проходы ${(st.passMs / 1000).toFixed(1)} с)${debug ? '. Лист: цвет | нормали / тени×AO | итог' : ''}${out ? `. Сохранено: ${resolve(out)}` : ''}` }] };
      }
      const png = await renderPNG(S(), t, { width, states, lit, pixel });
      return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }, { type: 'text', text: `t = ${t}s${states ? ' ' + JSON.stringify(states) : ''}${lit ? ', со светом' : ''}${pixelOf(scene) && pixel !== false ? ', пиксельный режим' : ''}` }] };
    },
  },
  {
    name: 'render_contact_sheet',
    description: 'Раскадровка: сетка из нескольких кадров в одном изображении — лучший способ проверить движение целиком. Задайте times (массив секунд) или count (равномерно по длительности), опционально start/end или clip (имя клипа), states — варианты состояний {группа: вариант}.',
    inputSchema: { type: 'object', properties: { times: { type: 'array', items: NUM }, count: NUM, start: NUM, end: NUM, clip: STR, cols: NUM, cellWidth: NUM, states: OBJ } },
    run: async ({ times, count = 8, start = 0, end = scene.duration, clip, cols, cellWidth = 360, states }) => {
      if (clip) { const r = clipRange(scene, clip); start = r.start; end = r.end; }
      if (!times) times = Array.from({ length: count }, (_, i) => start + ((end - start) * i) / (count > 1 && end < scene.duration && !clip ? count - 1 : count));
      const svg = contactSheetSVG(S(), times.slice(0, 24), { cols, cellWidth, states });
      await probeRaster();
      if (!canPng()) return text(`(PNG недоступен: ${capabilities.pngError}. ${rasterHelp()})\n` + svg);
      const png = await svgToPng(svg);
      return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }, { type: 'text', text: `Кадры: ${times.map((t) => t.toFixed(2)).join(', ')}` }] };
    },
  },
  {
    name: 'export',
    description: 'Экспорт: "html" — автономный плеер одним файлом; "svg" — кадр; "png" — кадр PNG (с lit "deferred" — с отложенным светом и стилем); "json" — сцена; "mp4"/"webm"/"gif" — видео (нужен ffmpeg и растеризатор); "godot" — папка-проект для Godot 4: статичные части запекаются в PNG-слои со всеми эффектами, анимированные — в AnimatedSprite2D, клипы сцены становятся анимациями (clips — какие экспортировать), fps (по умолчанию 12 или fps клипа), scale (масштаб текстур), normals (true или настройки — карты нормалей для 2D-света через CanvasTexture). "unity" — то же для Unity 6/2022+: path — папка внутри Assets проекта (например <проект>/Assets/Kontur/room); PNG-спрайты с .meta, клипы — AnimationClip + Animator Controller, всё собрано в префаб <title>.prefab (SortingGroup, KonturPlayer.Play/SetState); свет — Light2D (pipeline "urp", по умолчанию) или без света ("builtin"); режимы наложения — материал Kontur/Sprite Blend; ppu — пикселей сцены на единицу Unity (100), origin — "center" (по умолчанию) или "top-left". 2.5D-сцены (camera3d + surface): lit "deferred" — статичные слои запекаются со светом, тенями и стилем, источники света не выводятся (lights: true — всё равно вывести); без lit, с normals — живой свет движка: карты нормалей берутся из props.surface (проход normal), лампы с p3 ставятся в проекции камеры. clip — для видео/gif взять отрезок клипа.',
    inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['html', 'svg', 'json', 'png', 'mp4', 'webm', 'gif', 'godot', 'unity'] }, path: STR, t: NUM, fps: NUM, width: NUM, start: NUM, end: NUM, clip: STR, title: STR, scale: NUM, normals: ANY, clips: { type: 'array', items: STR }, ppu: NUM, origin: { type: 'string', enum: ['center', 'top-left'] }, pipeline: { type: 'string', enum: ['urp', 'builtin'] }, lit: { type: 'string', enum: ['deferred'] }, lights: { type: 'boolean' } }, required: ['format', 'path'] },
    run: async ({ format, path, t = 0, fps, width, start, end, clip, title, scale, normals, clips, ppu, origin, pipeline, lit, lights }) => {
      const engineExport = format === 'godot' || format === 'unity';
      if (clip && !engineExport) { const r = clipRange(scene, clip); start = r.start; end = r.end; }
      const p = resolve(path);
      mkdirSync(dirname(p), { recursive: true });
      if (engineExport) {
        await probeRaster();
        if (!canPng()) throw new Error(`Для экспорта в ${format === 'unity' ? 'Unity' : 'Godot'} нужен растеризатор SVG: ${capabilities.pngError}. ${rasterHelp()}`);
        const r = format === 'unity'
          ? await exportUnity(S(), p, { fps, scale, normals, clips, title, ppu, origin, pipeline, log, lit, lights })
          : await exportGodot(S(), p, { fps, scale, normals, clips, title, log, lit, lights });
        return text(r.summary);
      }
      if (format === 'png') {
        await probeRaster();
        if (!canPng()) throw new Error(`PNG недоступен: ${capabilities.pngError}. ${rasterHelp()}`);
        writeFileSync(p, await renderPNG(S(), t, { width: width || scene.width, lit }));
        return text(`Кадр${lit ? ' с отложенным светом' : ''}: ${p}`);
      }
      if (format === 'html') writeFileSync(p, standaloneHTML(S(), { title }));
      else if (format === 'svg') writeFileSync(p, renderSVG(S(), t, { width }));
      else if (format === 'json') writeFileSync(p, JSON.stringify(scene, null, 1));
      else {
        const r = await exportVideo(S(), p, { fps, width, start, end, format });
        return text(`Видео: ${p} (${r.frames} кадров)`);
      }
      return text(`Сохранено: ${p}`);
    },
  },
  {
    name: 'undo',
    description: 'Отменить последнее изменение сцены.',
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      const h = history.pop();
      if (!h) return text('Нечего отменять.');
      future.push(JSON.stringify(scene));
      scene = JSON.parse(h.snapshot); invalidate(scene); rev++; save(); broadcast();
      return summary(`Отменено: ${h.label}.`);
    },
  },
  {
    name: 'redo',
    description: 'Вернуть отменённое изменение.',
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      const f = future.pop();
      if (!f) return text('Нечего возвращать.');
      history.push({ label: 'redo', snapshot: JSON.stringify(scene) });
      scene = JSON.parse(f); invalidate(scene); rev++; save(); broadcast();
      return summary('Возвращено.');
    },
  },
  {
    name: 'state_set',
    description: 'Группа состояний объекта: именованные варианты, которые подменяют свойства узлов. Пример: name "locker", default "closed", values {"closed": {}, "open": {"door": {"visible": false}, "door_open": {"visible": true}}}. В превью и редакторе переключаются, в Godot экспорт делает слой на вариант и $Scene.set_state(группа, вариант).',
    inputSchema: { type: 'object', properties: { name: STR, default: STR, values: OBJ }, required: ['name', 'values'] },
    run: (a) => { mutate('состояния', () => ops.setState(scene, a)); return summary(`Состояния «${a.name}» заданы.`); },
  },
  {
    name: 'state_remove',
    description: 'Удалить группу состояний.',
    inputSchema: { type: 'object', properties: { name: STR }, required: ['name'] },
    run: ({ name }) => { const n = mutate('удалить состояния', () => ops.removeState(scene, name)); return summary(n ? `Группа «${name}» удалена.` : 'Такой группы нет.'); },
  },
  {
    name: 'ik_set',
    description: 'Двухзвенный IK на конечном узле id (например стопа): его родитель и дед (голень, бедро) поворачиваются так, чтобы id оказался в точке узла target. bend 1|-1 — сторона сгиба (по умолчанию как в текущей позе), flip — обратная сторона, orient — конечный узел повторяет поворот цели (стопа ровно на полу). Свойство ikWeight узла (0..1, можно анимировать) смешивает IK с ключами поворота. target null — снять IK.',
    inputSchema: { type: 'object', properties: { id: STR, target: { type: ['string', 'null'] }, bend: NUM, flip: { type: 'boolean' }, orient: { type: 'boolean' }, orientOffset: NUM }, required: ['id'] },
    run: ({ id, target, ...cfg }) => { mutate('IK', () => ops.setIK(scene, id, target ? { target, ...cfg } : null)); return summary(target ? `IK: ${id} тянется к ${target}.` : `IK у ${id} снят.`); },
  },
  {
    name: 'bone_mark',
    description: 'Отметить группы как кости (props.bone: true): редактор рисует их скелетом и даёт крутить мышью вокруг сустава. Кость — группа, её x,y — сустав в координатах родителя.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: STR }, bone: { type: 'boolean' } }, required: ['ids'] },
    run: ({ ids, bone = true }) => { mutate('кости', () => { for (const id of ids) ops.updateNode(scene, id, bone ? { props: { bone: true } } : { unset: ['bone'] }); }); return text(`Костей отмечено: ${ids.length}.`); },
  },
  {
    name: 'pixel_set',
    description: 'Пиксельный режим сцены: кадр рисуется в разрешении (ширина/size × высота/size) без сглаживания и увеличивается «ближайшим» — вектор и пиксель-арт выглядят одинаково. size — размер пикселя в единицах сцены (6 для 1920×1080 → 320×180), palette — массив цветов (необязательно, всё приводится к ним), aa — оставить сглаживание краёв. enabled:false — выключить.',
    inputSchema: { type: 'object', properties: { enabled: { type: 'boolean' }, size: NUM, palette: { type: 'array', items: STR }, aa: { type: 'boolean' } } },
    run: (a) => { const r = mutate('пиксели', () => ops.setPixel(scene, a.enabled === false ? { enabled: false } : a)); return summary(r?.enabled ? `Пиксельный режим: пиксель ${r.size}.` : 'Пиксельный режим выключен.'); },
  },
  {
    name: 'edits_info',
    description: 'Правки поверх сцены из скрипта: файл, какие объекты изменены/добавлены/удалены, предупреждения после пересборки (например, id объекта сдвинулся).',
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      const ei = editsInfo();
      if (!ei.mode) return text(`Сцена ${scenePath} открыта без файла правок: изменения пишутся прямо в неё. Открыть с правками: scene_open с edits: true.`);
      return text(`Файл правок: ${ei.path}${ei.locked ? ' (ЗАБЛОКИРОВАН — не применился к сцене)' : ''}
Изменены (${ei.nodes.length}): ${ei.nodes.join(', ') || '—'}
Добавлены: ${ei.added.join(', ') || '—'}
Удалены: ${ei.removed.join(', ') || '—'}
Настройки сцены: ${ei.scene.join(', ') || '—'}
Предупреждения:\n${ei.warnings.join('\n') || '—'}`);
    },
  },
  {
    name: 'edits_reset',
    description: 'Сбросить правки — вернуть объекты к сцене из скрипта. ids — каких узлов («__scene» — настройки сцены); без ids — все.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: STR } } },
    run: ({ ids }) => { const s2 = resetEdits(ids); mutate('сброс правок', () => { scene = s2; }); return summary(ids?.length ? `Сброшены правки: ${ids.join(', ')}.` : 'Все правки сброшены.'); },
  },
  {
    name: 'preview_url',
    description: 'Адрес живого превью в браузере (обновляется автоматически при каждом изменении сцены, есть таймлайн и редактор JSON).',
    inputSchema: { type: 'object', properties: {} },
    run: () => text(previewUrl ? `Откройте ${previewUrl} — там редактор: выбор и трансформации мышью, рисование фигур и пером, правка точек, ключи на таймлайне, состояния, кости, свет и пиксельный режим.` : 'Превью выключено (KONTUR_PORT=0) или ещё запускается.'),
  },
];
const toolMap = new Map(tools.map((t) => [t.name, t]));

/* ------------------------------------------------------------------ ресурсы */
const resources = [
  { uri: 'kontur://docs/reference', name: 'Справочник Kontur', mimeType: 'text/markdown', read: () => readFileSync(resolve(ROOT, 'docs/REFERENCE.md'), 'utf8') },
  { uri: 'kontur://scene/current', name: 'Текущая сцена (JSON)', mimeType: 'application/json', read: () => JSON.stringify(scene, null, 1) },
];

/* ------------------------------------------------------------------ JSON-RPC */
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function fail(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n'); }

async function handle(msg) {
  const { id, method, params = {} } = msg;
  const isReq = id !== undefined && id !== null;
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED[0],
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: { name: 'kontur', title: 'Kontur — векторная анимация', version: VERSION },
        instructions: 'Kontur — движок векторной анимации. Начните с scene_info и docs. Стройте сцену node_add/nodes_add_batch, анимируйте keys_set/animate/preset_apply, добавляйте процедурное движение mod_add. Проверяйте результат render_contact_sheet и render_frame. Пользователь видит изменения вживую по preview_url.',
      });
    case 'notifications/initialized': case 'notifications/cancelled': return;
    case 'ping': return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = toolMap.get(params.name);
      if (!tool) return fail(id, -32602, `Неизвестный инструмент ${params.name}`);
      try { return reply(id, await tool.run(params.arguments || {})); }
      catch (e) { return reply(id, { content: [{ type: 'text', text: `Ошибка: ${e.message}` }], isError: true }); }
    }
    case 'resources/list':
      return reply(id, { resources: resources.map(({ uri, name, mimeType }) => ({ uri, name, mimeType })) });
    case 'resources/read': {
      const r = resources.find((x) => x.uri === params.uri);
      if (!r) return fail(id, -32602, `Нет ресурса ${params.uri}`);
      return reply(id, { contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.read() }] });
    }
    case 'prompts/list': return reply(id, { prompts: [] });
    default:
      if (isReq) fail(id, -32601, `Метод не поддерживается: ${method}`);
  }
}

startPreview();
probeRaster().then((n) => log(n ? `растеризатор: ${n}` : `растеризатор не найден: ${capabilities.pngError}`));
const rl = createInterface({ input: process.stdin });
let queue = Promise.resolve();
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'Parse error'); }
  const batch = Array.isArray(msg) ? msg : [msg];
  for (const m of batch) queue = queue.then(() => handle(m)).catch((e) => { log('ошибка:', e.stack); if (m.id != null) fail(m.id, -32603, e.message); });
});
rl.on('close', () => { if (!argv.includes('--preview')) queue.then(() => { stopWatch(); process.exit(0); }); });
if (argv.includes('--preview')) { log('режим только превью: Ctrl+C для выхода'); }
log(`Kontur MCP ${VERSION} запущен. Сцена: ${scenePath}`);
