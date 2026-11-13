// @ts-check
/**
 * Живое превью и студия (HTTP + SSE). Защита от чужих страниц в браузере:
 *  • Host — только адреса loopback с нашим портом (против DNS rebinding); при привязке к внешнему адресу — любой;
 *  • всё, что читает сцену и файлы или меняет состояние, требует токен: cookie kontur_<порт> (HttpOnly,
 *    SameSite=Strict — ставится при открытии страницы студии) или заголовок x-kontur-token;
 *  • POST с чужим Origin отклоняется (соседние сайты на localhost — «тот же сайт» для cookie);
 *  • /asset отдаёт только картинки из папки сцены, папки движка или те, на которые ссылается сцена;
 *  • /open открывает только .json из папки текущей сцены или examples/;
 *  • CSP: страница студии не исполняет встроенные обработчики и чужие скрипты (inline-скрипты страницы — по хэшам),
 *    картинки и SVG по прямой ссылке открываются в песочнице (скрипт внутри SVG не исполнится).
 * Токен: KONTUR_TOKEN или случайный при запуске (печатается в журнал вместе с адресом).
 *
 * Устройство: проверки Host, Origin и токена — отдельные функции перед маршрутизацией; маршруты — таблица
 * { method, path | prefix, open, handler } (open — без токена). Обработчик получает контекст запроса ctx.
 */
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, extname, sep } from 'node:path';
import { renderSVG, applyEdits, editsEmpty } from '../engine/kontur.js';
import { probeRaster, resolveSrc, imageSize, IMAGE_MIME, IMAGE_SRC_KEYS } from './render.mjs';
import { renderLit } from './lighting.mjs';
import { MAX_IMAGE_BYTES } from './limits.mjs';
import { renderQueue, Superseded } from './queue.mjs';
import { ROOT } from './paths.mjs';
import { log } from './log.mjs';
import { mapSrc, toRel, editsPathFor, buildScriptFor } from './session.mjs';

/** @typedef {import('./session.mjs').Session} Session */
/** @typedef {import('node:http').IncomingMessage} Req */
/** @typedef {import('node:http').ServerResponse} Res */

export const TOKEN = process.env.KONTUR_TOKEN || randomBytes(18).toString('base64url');
/** @type {Record<string, string>} */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css' };
const JSON_TYPE = MIME['.json'];
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const inside = (/** @type {string} */ f, /** @type {string} */ dir) => f === dir || f.startsWith(dir + sep);
const sameToken = (/** @type {unknown} */ a) => typeof a === 'string' && a.length === TOKEN.length && timingSafeEqual(Buffer.from(a), Buffer.from(TOKEN));
/** Расширение картинки → MIME (или undefined). @param {string} p */
const imageMime = (p) => /** @type {Record<string, string>} */ (IMAGE_MIME)[extname(p).toLowerCase()];

/* ------------------------------------------------------------------ CSP */
/** Песочница для картинок и SVG, открытых по прямой ссылке: скрипты и обработчики внутри SVG не исполняются. */
export const SANDBOX_CSP = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; sandbox";
/**
 * CSP страницы студии: встроенные обработчики (onerror=…), javascript:-ссылки и скрипты с других адресов запрещены;
 * inline-скрипты самой страницы разрешены по хэшам. 'unsafe-eval' — только для JS-выражений expr, которым
 * пользователь явно доверился (кнопка «Доверять» в студии).
 * @param {string | Buffer} html
 */
export function studioCSP(html) {
  const hashes = [...String(html).matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-eval' ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: http: https:",
    "connect-src 'self' data: blob: http: https:",
    "media-src 'self' data: blob:",
    "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join('; ');
}

/* ------------------------------------------------------------------ проверки запроса */
/** @param {Req} req */
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2));
/**
 * Host — только loopback с нашим портом (против DNS rebinding: чужой домен, указывающий на 127.0.0.1).
 * @param {Req} req @param {number} port @param {boolean} anyHost
 */
function hostAllowed(req, port, anyHost) {
  if (anyHost) return true;
  const hh = String(req.headers.host || ''), hostOnly = hh.replace(/:\d+$/, '');
  return LOOPBACK.has(hostOnly) && (hh === hostOnly || hh.slice(hostOnly.length + 1) === String(port));
}
/** Запрос, меняющий состояние, — только со своей страницы (Origin пуст или совпадает с Host). @param {Req} req */
function originAllowed(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.origin;
  return !origin || origin === `http://${req.headers.host}`;
}
/** Тело запроса не больше limit байт. @param {Req} req @param {number} limit @returns {Promise<Buffer>} */
function readBody(req, limit) {
  return new Promise((ok, fail) => {
    /** @type {Buffer[]} */
    const chunks = []; let size = 0;
    req.on('data', (d) => { size += d.length; if (size > limit) { fail(new Error('слишком большой запрос')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

/* ------------------------------------------------------------------ сцена для студии */
/** @type {WeakMap<Session, { rev: number, dir: string, set: Set<string> }>} */
const assetsCache = new WeakMap();
/**
 * Картинки, на которые ссылается сцена (абсолютные пути). Считаются один раз на версию сцены: студия запрашивает
 * /asset на каждую картинку, а обход всех узлов с проверкой файлов на каждый запрос — квадрат от их числа.
 * Устаревший список только строже: ссылка, убранная из сцены, меняет версию.
 * @param {Session} session
 */
function sceneAssets(session) {
  const dir = session.baseDir(), hit = assetsCache.get(session);
  if (hit && hit.rev === session.rev && hit.dir === dir) return hit.set;
  const set = new Set();
  for (const n of session.scene.nodes) {
    if (n.type !== 'image') continue;
    for (const src of [...IMAGE_SRC_KEYS.map((k) => n.props?.[k]), ...(n.keys?.src || []).map((/** @type {any} */ k) => k.v)]) { const p = resolveSrc(src, dir); if (p) set.add(resolve(p)); }
  }
  assetsCache.set(session, { rev: session.rev, dir, set });
  return set;
}
/** Можно ли отдать картинку p: из папки сцены, папки движка или по ссылке из сцены. @param {Session} session @param {string} p */
export function assetAllowed(session, p) {
  const f = resolve(p);
  if (!imageMime(f)) return false;
  return inside(f, resolve(session.baseDir())) || inside(f, ROOT) || sceneAssets(session).has(f);
}
/** Можно ли открыть сцену p: .json из папки текущей сцены или examples/ (не файл правок). @param {Session} session @param {string} p */
export function openAllowed(session, p) {
  const f = resolve(p);
  if (!/\.json$/i.test(f) || /\.edits\.json$/i.test(f)) return false;
  return dirname(f) === resolve(session.baseDir()) || inside(f, resolve(ROOT, 'examples'));
}

/*
 * Сцены папки для «Открыть» в студии: JSON разбирается только у новых и изменившихся файлов (сцены бывают по
 * десятку мегабайт, а список запрашивается при каждом открытии диалога). В кеше — только файлы последней папки.
 */
/** @type {Map<string, { stamp: string, nodes: number | null }>} */
const sceneListCache = new Map();
/** @param {string} dir */
function sceneList(dir) {
  const out = [], seen = new Set();
  for (const name of readdirSync(dir)) {
    if (!/\.json$/i.test(name) || /\.edits\.json$/i.test(name)) continue;
    const f = resolve(dir, name);
    let st;
    try { st = statSync(f); } catch { continue; }
    if (!st.isFile() || st.size > 30e6) continue;
    seen.add(f);
    const stamp = `${st.mtimeMs}|${st.size}`;
    let c = sceneListCache.get(f);
    if (!c || c.stamp !== stamp) {
      let nodes = null;
      try { const j = JSON.parse(readFileSync(f, 'utf8')); if (Array.isArray(j?.nodes)) nodes = j.nodes.length; } catch {}
      sceneListCache.set(f, (c = { stamp, nodes }));
    }
    if (c.nodes == null) continue;
    const bs = buildScriptFor(f);
    out.push({ name, path: f, nodes: c.nodes, edits: existsSync(editsPathFor(f)), build: !!(bs && existsSync(bs)) });
  }
  for (const f of sceneListCache.keys()) if (!seen.has(f)) sceneListCache.delete(f);
  return out;
}

/** Сцена, как её видит браузер: локальные картинки — по адресам /asset?p=. @param {Session} session */
const clientView = (session) => mapSrc(session.scene, (src) => { const p = resolveSrc(src, session.baseDir()); return p ? '/asset?p=' + encodeURIComponent(p) : src; });
/** Обратно: адреса /asset?p= → пути относительно папки сцены. @param {Session} session @param {any} s */
const fromClient = (session, s) => mapSrc(s, (src) => (typeof src === 'string' && src.startsWith('/asset?p=') ? toRel(session.baseDir())(decodeURIComponent(src.slice(9))) : src));
/** @param {Session} session */
const historyCounts = (session) => { const h = session.historyInfo(); return { undo: h.undo.length, redo: h.redo.length, last: h.undo.at(-1) ?? null, next: h.redo[0] ?? null }; };
/** Состояние после правки из студии. @param {Session} session */
const afterEdit = (session) => ({ rev: session.rev, edits: session.editsInfo(), readOnly: session.readOnly, history: historyCounts(session) });
/** Подпись правки из студии (?label=). @param {URL} u */
const editLabel = (u) => String(u.searchParams.get('label') || 'правка из редактора').slice(0, 60);

/* ------------------------------------------------------------------ маршруты */
/**
 * @typedef {object} Ctx
 * @property {Req} req
 * @property {Res} res
 * @property {URL} url
 * @property {Session} session
 * @property {(code: number, body?: any, type?: string, extra?: Record<string, string>) => void} send
 * @property {(obj: any, code?: number) => void} json
 * @property {(limit: number) => Promise<Buffer>} body
 * @property {(limit?: number) => Promise<any>} bodyJSON
 * @property {Record<string, string>} setCookie
 */
/** @typedef {{ method: 'GET' | 'POST', path?: string, prefix?: string, open?: boolean, handler: (ctx: Ctx) => any }} Route */

/** Файл из папки движка, студии или примеров: путь запроса внутри dir, иначе null. @param {URL} u @param {string} dir */
function fileIn(u, dir) {
  const f = resolve(ROOT, '.' + decodeURIComponent(u.pathname));
  return inside(f, resolve(ROOT, dir)) ? f : null;
}

/** @param {Set<Res>} clients @returns {Route[]} */
function routes(clients) {
  return [
    // ---- без токена: страница студии (ставит cookie), модули движка и примеры
    { method: 'GET', path: '/', open: true, handler: ({ res, setCookie }) => { res.writeHead(302, { location: '/player/index.html', ...setCookie }); res.end(); } },
    { method: 'GET', path: '/index.html', open: true, handler: ({ res, setCookie }) => { res.writeHead(302, { location: '/player/index.html', ...setCookie }); res.end(); } },
    { method: 'GET', prefix: '/engine/', open: true, handler: ({ url, send }) => {
      // движок как ES-модули (engine/kontur.js реэкспортирует engine/core/*.js)
      const f = url.pathname.endsWith('.js') ? fileIn(url, 'engine') : null;
      if (!f || !existsSync(f)) return send(404, 'not found');
      send(200, readFileSync(f), MIME['.js']);
    } },
    { method: 'GET', prefix: '/player/', open: true, handler: ({ url, send, setCookie }) => {
      const f = fileIn(url, 'player');
      if (!f || !existsSync(f) || statSync(f).isDirectory()) return send(404, 'not found');
      const body = readFileSync(f);
      send(200, body, MIME[extname(f)] || 'application/octet-stream', extname(f) === '.html' ? { ...setCookie, 'content-security-policy': studioCSP(body) } : {});
    } },
    { method: 'GET', prefix: '/examples/', open: true, handler: ({ url, send }) => {
      const ext = extname(url.pathname);
      if (ext !== '.json' && !imageMime(ext)) return send(404, 'not found');
      const f = fileIn(url, 'examples');
      if (!f) return send(403, 'forbidden');
      if (!existsSync(f)) return send(404, 'not found');
      send(200, readFileSync(f), MIME[ext] || imageMime(ext), { 'content-security-policy': SANDBOX_CSP });
    } },

    // ---- сцена
    { method: 'GET', path: '/scene.json', handler: ({ session, json }) => json({ rev: session.rev, scene: clientView(session), path: session.scenePath, edits: session.editsInfo(), readOnly: session.readOnly, history: historyCounts(session) }) },
    { method: 'POST', path: '/scene.json', handler: async ({ session, url, json, bodyJSON }) => {
      session.replaceScene(editLabel(url), fromClient(session, await bodyJSON(20e6)));
      json(afterEdit(session));
    } },
    { method: 'POST', path: '/patch', handler: async ({ session, url, json, bodyJSON }) => {
      // правка из редактора патчем (формат diffScenes): накладывается на вид сцены для браузера, пути ассетов — обратно
      const a = await bodyJSON(20e6);
      if (!a.edits || editsEmpty(a.edits)) return json({ rev: session.rev, edits: session.editsInfo(), warnings: [], history: historyCounts(session) });
      const r = applyEdits(clientView(session), a.edits);
      session.replaceScene(editLabel(url), fromClient(session, r.scene));
      json({ ...afterEdit(session), warnings: r.warnings });
    } },
    // одна история на сервере: отмена в студии — та же, что у инструмента undo
    { method: 'POST', path: '/undo', handler: ({ session, json }) => { const label = session.undo(); json({ rev: session.rev, label, history: historyCounts(session) }); } },
    { method: 'POST', path: '/redo', handler: ({ session, json }) => { const label = session.redo(); json({ rev: session.rev, label, history: historyCounts(session) }); } },
    { method: 'POST', path: '/edits/reset', handler: async ({ session, json, bodyJSON }) => {
      const a = await bodyJSON(1e6);
      session.replaceScene('сброс правок', session.resetEdits(a.ids));
      json({ rev: session.rev });
    } },
    { method: 'GET', path: '/scenes', handler: ({ session, json }) => {
      // сцены в папке текущей (для «Открыть» в редакторе)
      const dir = session.baseDir();
      json({ dir, current: session.scenePath, scenes: sceneList(dir) });
    } },
    { method: 'POST', path: '/open', handler: async ({ session, send, json, bodyJSON }) => {
      const a = await bodyJSON(1e6);
      if (typeof a.path !== 'string' || !openAllowed(session, a.path)) return send(403, 'Открыть можно только сцену .json из папки текущей сцены или examples/');
      session.openPath(a.path, a.edits ?? 'auto');
      json({ rev: session.rev, path: session.scenePath });
    } },

    // ---- картинки
    { method: 'GET', path: '/asset', handler: ({ session, url, send }) => {
      const p = url.searchParams.get('p') || '';
      const mime = imageMime(p);
      if (!mime || !assetAllowed(session, p)) return send(403, 'forbidden');
      if (!existsSync(p)) return send(404, 'not found');
      send(200, readFileSync(p), mime, { 'content-security-policy': SANDBOX_CSP });
    } },
    { method: 'POST', path: '/asset', handler: async ({ session, url, send, json, body }) => {
      // загрузка картинки из редактора → <папка сцены>/assets/<имя>
      const buf = await body(MAX_IMAGE_BYTES);
      const name = (url.searchParams.get('name') || 'image.png').replace(/[^\w.\-а-яё]/gi, '_').replace(/^\.+/, '_').slice(0, 80);
      // и имя, и содержимое: картинка по заголовку файла, а не только по расширению
      const size = imageSize(buf);
      if (!imageMime(name) || !size) return send(400, 'Нужна картинка: ' + Object.keys(IMAGE_MIME).join(' '));
      if (session.readOnly) return send(409, session.readOnly);
      const dir = resolve(session.baseDir(), 'assets');
      mkdirSync(dir, { recursive: true });
      let f = resolve(dir, name), i = 2;
      while (existsSync(f)) f = resolve(dir, name.replace(/(\.\w+)$/, `_${i++}$1`));
      writeFileSync(f, buf);
      json({ src: toRel(session.baseDir())(f), url: '/asset?p=' + encodeURIComponent(f), width: size.width, height: size.height });
    } },

    // ---- кадры
    { method: 'GET', path: '/frame.svg', handler: ({ session, url, send }) => send(200, renderSVG(session.inlined(), Number(url.searchParams.get('t') || 0)), MIME['.svg'], { 'content-security-policy': SANDBOX_CSP }) },
    { method: 'GET', path: '/lit.png', handler: async ({ session, url, res, send }) => {
      // отложенный свет для студии (кнопка «Отложенный свет»): считается на сервере
      if (!session.scene.camera3d) return send(409, 'Нужна camera3d (camera3d_set) и узлы с surface (world_build)');
      let st;
      try { st = JSON.parse(url.searchParams.get('states') || 'null') || undefined; } catch {}
      const w = Math.max(160, Math.min(2560, Number(url.searchParams.get('w')) || 960));
      const t = Number(url.searchParams.get('t') || 0);
      await probeRaster();
      // через общую очередь рендеров; ждущий кадр заменяется более новым, закрытое соединение снимает его из очереди
      const ac = new AbortController();
      res.on('close', () => { if (!res.writableEnded) ac.abort(); });
      let r;
      try { r = await renderQueue.run(() => renderLit(session.inlined(), t, { width: w, states: st }), { key: 'http:lit.png', signal: ac.signal }); }
      catch (e) { if (e instanceof Superseded || e.name === 'AbortError') return send(204, ''); throw e; }
      send(200, r.png, 'image/png');
    } },

    // ---- оповещения об изменениях (SSE)
    { method: 'GET', path: '/events', handler: ({ session, req, res }) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`event: scene\ndata: ${session.rev}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => { clients.delete(res); clearInterval(ping); });
    } },
  ];
}
/** Маршрут для пути: { route } или { allowed } — методы, которые у пути есть (пусто — пути нет). @param {Route[]} table @param {string} method @param {string} path */
function match(table, method, path) {
  const m = method === 'HEAD' ? 'GET' : method;
  const hits = table.filter((r) => (r.path != null ? r.path === path : path.startsWith(/** @type {string} */ (r.prefix))));
  return { route: hits.find((r) => r.method === m), allowed: [...new Set(hits.map((r) => r.method))] };
}

/* ------------------------------------------------------------------ сервер */
/**
 * Запустить превью для сессии. port занят — пробуются следующие (до 10). keepAlive — сервер держит процесс.
 * @param {{ session: Session, port?: number, host?: string, keepAlive?: boolean }} opts
 */
export function startPreview({ session, port: port0 = 7788, host = '127.0.0.1', keepAlive = false }) {
  /** @type {Set<Res>} */
  const clients = new Set();
  session.onChange((rev, info) => {
    const ids = JSON.stringify({ rev, ids: info?.ids ?? null });
    for (const res of clients) res.write(`event: scene\ndata: ${rev}\n\nevent: nodes\ndata: ${ids}\n\n`);
  });
  const table = routes(clients);
  const anyHost = !LOOPBACK.has(host);
  let port = port0;

  const srv = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    /** @type {Ctx['send']} */
    const send = (code, body, type = 'text/plain; charset=utf-8', extra = {}) => {
      if (res.headersSent) return;
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
      res.end(body);
    };
    try {
      if (!hostAllowed(req, port, anyHost)) return send(403, 'host not allowed');
      if (!originAllowed(req)) return send(403, 'origin not allowed');
      const { route, allowed } = match(table, req.method || 'GET', url.pathname);
      if (!route) return allowed.length ? send(405, 'method not allowed', undefined, { allow: allowed.join(', ') }) : send(404, 'not found');
      const cookieName = `kontur_${port}`;
      if (!route.open && !sameToken(req.headers['x-kontur-token']) && !sameToken(cookies(req)[cookieName])) {
        return send(401, 'нужен токен: откройте студию по адресу превью (cookie) или передайте заголовок x-kontur-token');
      }
      /** @type {Ctx} */
      const ctx = {
        req, res, url, session, send,
        json: (obj, code = 200) => send(code, JSON.stringify(obj), JSON_TYPE),
        body: (limit) => readBody(req, limit),
        bodyJSON: async (limit = 1e6) => { const b = await readBody(req, limit); return b.length ? JSON.parse(b.toString('utf8')) : {}; },
        setCookie: { 'set-cookie': `${cookieName}=${TOKEN}; Path=/; HttpOnly; SameSite=Strict` },
      };
      await route.handler(ctx);
    } catch (e) { send(req.method === 'POST' || e instanceof SyntaxError ? 400 : 500, e.message); }
  });
  let tries = 0;
  srv.on('error', (/** @type {NodeJS.ErrnoException} */ e) => {
    if (e.code === 'EADDRINUSE' && tries++ < 10) { port++; srv.listen(port, host); }
    else log('превью недоступно:', e.message);
  });
  srv.on('listening', () => {
    const addr = srv.address();
    if (addr && typeof addr === 'object') port = addr.port;
    const url = `http://${anyHost ? 'localhost' : host.includes(':') ? `[${host}]` : host}:${port}/`;
    session.setPreviewUrl(url);
    log('превью:', url, process.env.KONTUR_TOKEN ? '(токен из KONTUR_TOKEN)' : `(токен API: ${TOKEN})`);
  });
  srv.listen(port, host);
  if (!keepAlive) srv.unref();
  return srv;
}
