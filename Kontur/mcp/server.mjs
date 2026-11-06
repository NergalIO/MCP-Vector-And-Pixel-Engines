#!/usr/bin/env node
/**
 * Kontur MCP-сервер (stdio, JSON-RPC 2.0, без зависимостей)
 * + встроенный HTTP-сервер живого превью (SSE): каждое изменение сцены сразу видно в браузере.
 *
 * Переменные окружения:
 *   KONTUR_SCENE  — путь к файлу сцены (по умолчанию ./kontur-scene.json, автосохранение)
 *   KONTUR_PORT   — порт превью (по умолчанию 7788; 0 — отключить)
 *   KONTUR_HOST   — адрес превью (по умолчанию 127.0.0.1)
 */
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname, extname, basename, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VERSION, createScene, ops, applyPreset, PRESETS, MODIFIERS, NODE_TYPES, easings,
  validateScene, describeScene, renderSVG, invalidate, evaluate, clipRange,
} from '../engine/kontur.js';
import { probeRaster, rasterHelp, svgToPng, canPng, contactSheetSVG, exportVideo, standaloneHTML, capabilities, inlineAssets, resolveSrc, imageSize, fileToDataURI, IMAGE_MIME } from './render.mjs';
import { DITHER_PATTERNS, RELIEF_DEFAULT } from '../engine/kontur.js';
import { sceneNormalMap, imageNormalMap, encodePNG, decodePNG, litPreview, sideBySide, scaleDown, NORMAL_DEFAULTS } from './normals.mjs';
import { compatReport, exportGodot } from './godot.mjs';

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
if (existsSync(scenePath)) {
  try { scene = loadFrom(scenePath); log('загружена сцена', scenePath); } catch (e) { log('не удалось загрузить сцену:', e.message); }
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
  try { mkdirSync(dirname(scenePath), { recursive: true }); writeFileSync(scenePath, JSON.stringify(scene, null, 1)); }
  catch (e) { log('ошибка сохранения:', e.message); }
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
let previewUrl = null;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css' };

function startPreview() {
  const port0 = Number(process.env.KONTUR_PORT ?? 7788);
  if (port0 === 0 && process.env.KONTUR_PORT === '0') return;
  const host = process.env.KONTUR_HOST || '127.0.0.1';
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, body, type = 'text/plain; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    try {
      if (u.pathname === '/' || u.pathname === '/index.html') return send(200, readFileSync(resolve(ROOT, 'player/index.html')), MIME['.html']);
      if (u.pathname === '/engine/kontur.js') return send(200, readFileSync(resolve(ROOT, 'engine/kontur.js')), MIME['.js']);
      if (u.pathname.startsWith('/examples/') && (extname(u.pathname) === '.json' || IMAGE_MIME[extname(u.pathname).toLowerCase()])) {
        const f = resolve(ROOT, '.' + decodeURIComponent(u.pathname));
        if (!f.startsWith(resolve(ROOT, 'examples'))) return send(403, 'forbidden');
        if (!existsSync(f)) return send(404, 'not found');
        return send(200, readFileSync(f), MIME[extname(f)] || IMAGE_MIME[extname(f).toLowerCase()]);
      }
      if (u.pathname === '/scene.json' && req.method === 'GET') {
        const out = mapSrc(scene, (src) => { const p = resolveSrc(src, baseDir()); return p ? '/asset?p=' + encodeURIComponent(p) : src; });
        return send(200, JSON.stringify({ rev, scene: out }), MIME['.json']);
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
            mutate('правка из превью', () => { scene = s; });
            send(200, JSON.stringify({ rev }), MIME['.json']);
          } catch (e) { send(400, e.message); }
        });
        return;
      }
      if (u.pathname === '/frame.svg') return send(200, renderSVG(S(), Number(u.searchParams.get('t') || 0)), MIME['.svg']);
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
      return text(`${describeScene(scene)}\n\nФайл: ${scenePath}\nПревью: ${previewUrl || 'выключено'}\nPNG-кадры: ${png}\nВидео: ${capabilities.ffmpeg && canPng() ? 'да' : capabilities.ffmpeg ? 'нет (нет растеризатора)' : 'нет (нужен ffmpeg)'}${issues.length ? `\nСовместимость с Godot (импорт SVG): ${issues.length} замечаний — подробно в compat_check; для переноса с эффектами используйте export format "godot".` : ''}`);
    },
  },
  {
    name: 'docs',
    description: 'Справочник по формату сцены, типам узлов, свойствам, кривым, модификаторам, пресетам и рецептам плавных анимаций. Прочитайте перед созданием сложных анимаций.',
    inputSchema: { type: 'object', properties: { topic: { type: 'string', enum: ['all', 'modifiers', 'presets', 'easings'] } } },
    run: ({ topic = 'all' }) => {
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
    run: (a) => { mutate('новая сцена', () => { scene = createScene(a); }); return summary('Создана новая сцена.'); },
  },
  {
    name: 'scene_settings',
    description: 'Изменить параметры сцены: width, height, duration, fps, background (цвет или градиент), loop, dither (глобальный дизеринг теней, см. dither_set).',
    inputSchema: { type: 'object', properties: { width: NUM, height: NUM, duration: NUM, fps: NUM, background: ANY, loop: { type: 'boolean' }, dither: ANY, relief: ANY } },
    run: (a) => { mutate('настройки', () => { for (const k of ['width', 'height', 'duration', 'fps', 'background', 'loop', 'dither', 'relief']) if (a[k] !== undefined) scene[k] = a[k]; }); return summary('Настройки обновлены.'); },
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
    inputSchema: { type: 'object', properties: { path: STR }, required: ['path'] },
    run: ({ path }) => {
      let p = resolve(path);
      if (!existsSync(p) && existsSync(resolve(ROOT, path))) { const ex = resolve(ROOT, path); const s = rebase(loadFrom(ex), dirname(ex), baseDir()); mutate('открыть пример', () => { scene = s; }); return summary(`Открыт пример ${path} (сохраняется в ${scenePath}).`); }
      const s = loadFrom(p);
      scenePath = p;
      mutate('открыть', () => { scene = s; });
      return summary(`Открыт ${p}.`);
    },
  },
  {
    name: 'scene_save_as',
    description: 'Сохранить сцену в другой файл; дальнейшее автосохранение пойдёт туда.',
    inputSchema: { type: 'object', properties: { path: STR }, required: ['path'] },
    run: ({ path }) => { const old = baseDir(); scenePath = resolve(path); scene = rebase(scene, old, baseDir()); save(); return text(`Сохранено: ${scenePath}`); },
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
    name: 'compat_check',
    description: 'Проверка совместимости сцены с целевой платформой. target "godot": что потеряется при импорте SVG в Godot (свечение, размытие, тени, режимы наложения, растр-дизеринг, маски, текст) и как это перенести (export format "godot" запекает эффекты в PNG-слои).',
    inputSchema: { type: 'object', properties: { target: { type: 'string', enum: ['godot'] } } },
    run: ({ target = 'godot' }) => {
      const issues = compatReport(scene, target);
      if (!issues.length) return text('Замечаний нет: сцена использует только то, что Godot импортирует из SVG.');
      return text(`Замечаний: ${issues.length}\n` + issues.map((i) => `• ${i.node}: ${i.feature} — ${i.effect}`).join('\n') + '\n\nРешение без ручной переделки: export format "godot" — слои с эффектами запекаются в PNG, анимация — в AnimatedSprite2D по клипам.');
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
    description: 'Отрендерить кадр в момент t и вернуть изображение (PNG), чтобы увидеть результат. format "svg" вернёт SVG-текст.',
    inputSchema: { type: 'object', properties: { t: NUM, width: NUM, format: { type: 'string', enum: ['png', 'svg'] } }, required: ['t'] },
    run: async ({ t, width = 800, format = 'png' }) => {
      const svg = renderSVG(S(), t, { width });
      await probeRaster();
      if (format === 'svg' || !canPng()) return text((canPng() ? '' : `(PNG недоступен: ${capabilities.pngError}. ${rasterHelp()} Ниже SVG кадра.)\n`) + svg);
      const png = await svgToPng(svg, width);
      return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }, { type: 'text', text: `t = ${t}s` }] };
    },
  },
  {
    name: 'render_contact_sheet',
    description: 'Раскадровка: сетка из нескольких кадров в одном изображении — лучший способ проверить движение целиком. Задайте times (массив секунд) или count (равномерно по длительности), опционально start/end или clip (имя клипа).',
    inputSchema: { type: 'object', properties: { times: { type: 'array', items: NUM }, count: NUM, start: NUM, end: NUM, clip: STR, cols: NUM, cellWidth: NUM } },
    run: async ({ times, count = 8, start = 0, end = scene.duration, clip, cols, cellWidth = 360 }) => {
      if (clip) { const r = clipRange(scene, clip); start = r.start; end = r.end; }
      if (!times) times = Array.from({ length: count }, (_, i) => start + ((end - start) * i) / (count > 1 && end < scene.duration && !clip ? count - 1 : count));
      const svg = contactSheetSVG(S(), times.slice(0, 24), { cols, cellWidth });
      await probeRaster();
      if (!canPng()) return text(`(PNG недоступен: ${capabilities.pngError}. ${rasterHelp()})\n` + svg);
      const png = await svgToPng(svg);
      return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }, { type: 'text', text: `Кадры: ${times.map((t) => t.toFixed(2)).join(', ')}` }] };
    },
  },
  {
    name: 'export',
    description: 'Экспорт: "html" — автономный плеер одним файлом; "svg" — кадр; "json" — сцена; "mp4"/"webm"/"gif" — видео (нужен ffmpeg и растеризатор); "godot" — папка-проект для Godot 4: статичные части запекаются в PNG-слои со всеми эффектами, анимированные — в AnimatedSprite2D, клипы сцены становятся анимациями (clips — какие экспортировать), fps (по умолчанию 12 или fps клипа), scale (масштаб текстур), normals (true или настройки — карты нормалей для 2D-света через CanvasTexture). clip — для видео/gif взять отрезок клипа.',
    inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['html', 'svg', 'json', 'mp4', 'webm', 'gif', 'godot'] }, path: STR, t: NUM, fps: NUM, width: NUM, start: NUM, end: NUM, clip: STR, title: STR, scale: NUM, normals: ANY, clips: { type: 'array', items: STR } }, required: ['format', 'path'] },
    run: async ({ format, path, t = 0, fps, width, start, end, clip, title, scale, normals, clips }) => {
      if (clip && format !== 'godot') { const r = clipRange(scene, clip); start = r.start; end = r.end; }
      const p = resolve(path);
      mkdirSync(dirname(p), { recursive: true });
      if (format === 'godot') {
        await probeRaster();
        if (!canPng()) throw new Error(`Для экспорта в Godot нужен растеризатор SVG: ${capabilities.pngError}. ${rasterHelp()}`);
        const r = await exportGodot(S(), p, { fps, scale, normals, clips, title, log });
        return text(r.summary);
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
    name: 'preview_url',
    description: 'Адрес живого превью в браузере (обновляется автоматически при каждом изменении сцены, есть таймлайн и редактор JSON).',
    inputSchema: { type: 'object', properties: {} },
    run: () => text(previewUrl ? `Откройте ${previewUrl}` : 'Превью выключено (KONTUR_PORT=0) или ещё запускается.'),
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
rl.on('close', () => { if (!argv.includes('--preview')) queue.then(() => process.exit(0)); });
if (argv.includes('--preview')) { log('режим только превью: Ctrl+C для выхода'); }
log(`Kontur MCP ${VERSION} запущен. Сцена: ${scenePath}`);
