/**
 * Живое превью и студия (HTTP + SSE). Защита от чужих страниц в браузере:
 *  • Host — только адреса loopback с нашим портом (против DNS rebinding); при привязке к внешнему адресу — любой;
 *  • всё, что читает сцену и файлы или меняет состояние, требует токен: cookie kontur_<порт> (HttpOnly,
 *    SameSite=Strict — ставится при открытии страницы студии) или заголовок x-kontur-token;
 *  • POST с чужим Origin отклоняется (соседние сайты на localhost — «тот же сайт» для cookie);
 *  • /asset отдаёт только картинки из папки сцены, папки движка или те, на которые ссылается сцена;
 *  • /open открывает только .json из папки текущей сцены или examples/.
 * Токен: KONTUR_TOKEN или случайный при запуске (печатается в журнал вместе с адресом).
 */
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, extname, sep } from 'node:path';
import { renderSVG, applyEdits, editsEmpty } from '../engine/kontur.js';
import { probeRaster, resolveSrc, imageSize, IMAGE_MIME } from './render.mjs';
import { renderLit } from './lighting.mjs';
import * as store from './store.mjs';
import { ROOT, log, baseDir, S, mapSrc, toRel, replaceScene, editsInfo, resetEdits, openPath, editsPathFor, buildScriptFor, onChange, setPreviewUrl, undo, redo, historyInfo } from './store.mjs';

export const TOKEN = process.env.KONTUR_TOKEN || randomBytes(18).toString('base64url');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css' };
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const inside = (f, dir) => f === dir || f.startsWith(dir + sep);
const sameToken = (a) => { if (typeof a !== 'string' || a.length !== TOKEN.length) return false; return timingSafeEqual(Buffer.from(a), Buffer.from(TOKEN)); };
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2));

/** Картинки, на которые ссылается текущая сцена (абсолютные пути). */
function sceneAssets() {
  const out = new Set();
  for (const n of store.scene.nodes) {
    if (n.type !== 'image') continue;
    for (const src of [n.props?.src, ...(n.keys?.src || []).map((k) => k.v)]) { const p = resolveSrc(src, baseDir()); if (p) out.add(resolve(p)); }
  }
  return out;
}
export function assetAllowed(p) {
  const f = resolve(p);
  if (!IMAGE_MIME[extname(f).toLowerCase()]) return false;
  return inside(f, resolve(baseDir())) || inside(f, ROOT) || sceneAssets().has(f);
}
export function openAllowed(p) {
  const f = resolve(p);
  if (!/\.json$/i.test(f) || /\.edits\.json$/i.test(f)) return false;
  return dirname(f) === resolve(baseDir()) || inside(f, resolve(ROOT, 'examples'));
}

function readBody(req, limit) {
  return new Promise((ok, fail) => {
    const chunks = []; let size = 0;
    req.on('data', (d) => { size += d.length; if (size > limit) { fail(new Error('слишком большой запрос')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

/** Сцена, как её видит браузер: локальные картинки — по адресам /asset?p=. */
const clientView = () => mapSrc(store.scene, (src) => { const p = resolveSrc(src, baseDir()); return p ? '/asset?p=' + encodeURIComponent(p) : src; });
/** Обратно: адреса /asset?p= → пути относительно папки сцены. */
const fromClient = (s) => mapSrc(s, (src) => (typeof src === 'string' && src.startsWith('/asset?p=') ? toRel(baseDir())(decodeURIComponent(src.slice(9))) : src));
const historyCounts = () => { const h = historyInfo(); return { undo: h.undo.length, redo: h.redo.length, last: h.undo.at(-1) ?? null, next: h.redo[0] ?? null }; };

export function startPreview({ port: port0 = 7788, host = '127.0.0.1', keepAlive = false } = {}) {
  const clients = new Set();
  onChange((rev, info) => {
    const ids = JSON.stringify({ rev, ids: info?.ids ?? null });
    for (const res of clients) res.write(`event: scene\ndata: ${rev}\n\nevent: nodes\ndata: ${ids}\n\n`);
  });
  const anyHost = !LOOPBACK.has(host);
  let port = port0;
  const cookieName = () => `kontur_${port}`;

  const srv = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, body, type = 'text/plain; charset=utf-8', extra = {}) => { if (res.headersSent) return; res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra }); res.end(body); };
    try {
      // Host: против DNS rebinding (чужой домен, указывающий на 127.0.0.1)
      const hh = String(req.headers.host || '');
      const hostOnly = hh.replace(/:\d+$/, '');
      if (!anyHost && (!LOOPBACK.has(hostOnly) || (hh !== hostOnly && hh.slice(hostOnly.length + 1) !== String(port)))) return send(403, 'host not allowed');
      const origin = req.headers.origin;
      if (req.method !== 'GET' && req.method !== 'HEAD' && origin && origin !== 'null' && origin !== `http://${hh}`) return send(403, 'origin not allowed');
      if (req.method !== 'GET' && req.method !== 'HEAD' && origin === 'null') return send(403, 'origin not allowed');
      const authed = sameToken(req.headers['x-kontur-token']) || sameToken(cookies(req)[cookieName()]);
      const need = () => { if (authed) return false; send(401, 'нужен токен: откройте студию по адресу превью (cookie) или передайте заголовок x-kontur-token'); return true; };
      const setCookie = { 'set-cookie': `${cookieName()}=${TOKEN}; Path=/; HttpOnly; SameSite=Strict` };

      if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(302, { location: '/player/index.html', ...setCookie }); return res.end(); }
      if (u.pathname.startsWith('/engine/') && u.pathname.endsWith('.js')) {
        // движок как ES-модули (engine/kontur.js реэкспортирует engine/core/*.js)
        const f = resolve(ROOT, '.' + decodeURIComponent(u.pathname));
        if (!inside(f, resolve(ROOT, 'engine')) || !existsSync(f)) return send(404, 'not found');
        return send(200, readFileSync(f), MIME['.js']);
      }
      if (u.pathname.startsWith('/player/')) {
        const f = resolve(ROOT, '.' + decodeURIComponent(u.pathname));
        if (!inside(f, resolve(ROOT, 'player')) || !existsSync(f) || statSync(f).isDirectory()) return send(404, 'not found');
        return send(200, readFileSync(f), MIME[extname(f)] || 'application/octet-stream', extname(f) === '.html' ? setCookie : {});
      }
      if (u.pathname.startsWith('/examples/') && (extname(u.pathname) === '.json' || IMAGE_MIME[extname(u.pathname).toLowerCase()])) {
        const f = resolve(ROOT, '.' + decodeURIComponent(u.pathname));
        if (!inside(f, resolve(ROOT, 'examples'))) return send(403, 'forbidden');
        if (!existsSync(f)) return send(404, 'not found');
        return send(200, readFileSync(f), MIME[extname(f)] || IMAGE_MIME[extname(f).toLowerCase()]);
      }
      // ниже — только с токеном
      if (need()) return;
      if (u.pathname === '/scenes' && req.method === 'GET') {
        // сцены в папке текущей (для «Открыть» в редакторе)
        const dir = baseDir(), out = [];
        for (const name of readdirSync(dir)) {
          if (!/\.json$/i.test(name) || /\.edits\.json$/i.test(name)) continue;
          const f = resolve(dir, name);
          try { if (statSync(f).size > 30e6) continue; const j = JSON.parse(readFileSync(f, 'utf8')); if (Array.isArray(j.nodes)) out.push({ name, path: f, nodes: j.nodes.length, edits: existsSync(editsPathFor(f)), build: !!(buildScriptFor(f) && existsSync(buildScriptFor(f))) }); } catch {}
        }
        return send(200, JSON.stringify({ dir, current: store.scenePath, scenes: out }), MIME['.json']);
      }
      if (u.pathname === '/asset' && req.method === 'POST') {
        // загрузка картинки из редактора → <папка сцены>/assets/<имя>
        const buf = await readBody(req, 40e6);
        const name = (u.searchParams.get('name') || 'image.png').replace(/[^\w.\-а-яё]/gi, '_').replace(/^\.+/, '_').slice(0, 80);
        if (!IMAGE_MIME[extname(name).toLowerCase()]) return send(400, 'Нужна картинка: ' + Object.keys(IMAGE_MIME).join(' '));
        if (store.readOnly) return send(409, store.readOnly);
        const dir = resolve(baseDir(), 'assets'); mkdirSync(dir, { recursive: true });
        let f = resolve(dir, name), i = 2;
        while (existsSync(f)) f = resolve(dir, name.replace(/(\.\w+)$/, `_${i++}$1`));
        writeFileSync(f, buf);
        const sz = imageSize(buf) || {};
        return send(200, JSON.stringify({ src: toRel(baseDir())(f), url: '/asset?p=' + encodeURIComponent(f), width: sz.width, height: sz.height }), MIME['.json']);
      }
      if ((u.pathname === '/open' || u.pathname === '/edits/reset') && req.method === 'POST') {
        const buf = await readBody(req, 1e6);
        const a = buf.length ? JSON.parse(buf.toString('utf8')) : {};
        if (u.pathname === '/open') {
          if (typeof a.path !== 'string' || !openAllowed(a.path)) return send(403, 'Открыть можно только сцену .json из папки текущей сцены или examples/');
          openPath(a.path, a.edits ?? 'auto');
          return send(200, JSON.stringify({ rev: store.rev, path: store.scenePath }), MIME['.json']);
        }
        const s2 = resetEdits(a.ids);
        replaceScene('сброс правок', s2);
        return send(200, JSON.stringify({ rev: store.rev }), MIME['.json']);
      }
      if (u.pathname === '/scene.json' && req.method === 'GET') {
        return send(200, JSON.stringify({ rev: store.rev, scene: clientView(), path: store.scenePath, edits: editsInfo(), readOnly: store.readOnly, history: historyCounts() }), MIME['.json']);
      }
      if (u.pathname === '/patch' && req.method === 'POST') {
        // правка из редактора патчем (формат diffScenes): накладывается на вид сцены для браузера, пути ассетов — обратно
        const a = JSON.parse((await readBody(req, 20e6)).toString('utf8'));
        if (!a.edits || editsEmpty(a.edits)) return send(200, JSON.stringify({ rev: store.rev, edits: editsInfo(), warnings: [], history: historyCounts() }), MIME['.json']);
        const r = applyEdits(clientView(), a.edits);
        replaceScene(String(u.searchParams.get('label') || 'правка из редактора').slice(0, 60), fromClient(r.scene));
        return send(200, JSON.stringify({ rev: store.rev, edits: editsInfo(), warnings: r.warnings, readOnly: store.readOnly, history: historyCounts() }), MIME['.json']);
      }
      if ((u.pathname === '/undo' || u.pathname === '/redo') && req.method === 'POST') {
        // одна история на сервере: отмена в студии — та же, что у инструмента undo
        const label = u.pathname === '/undo' ? undo() : redo();
        return send(200, JSON.stringify({ rev: store.rev, label, history: historyCounts() }), MIME['.json']);
      }
      if (u.pathname === '/asset' && (req.method === 'GET' || req.method === 'HEAD')) {
        const p = u.searchParams.get('p') || '';
        const mime = IMAGE_MIME[extname(p).toLowerCase()];
        if (!mime || !assetAllowed(p)) return send(403, 'forbidden');
        if (!existsSync(p)) return send(404, 'not found');
        return send(200, readFileSync(p), mime);
      }
      if (u.pathname === '/scene.json' && req.method === 'POST') {
        const body = (await readBody(req, 20e6)).toString('utf8');
        replaceScene(String(u.searchParams.get('label') || 'правка из редактора').slice(0, 60), fromClient(JSON.parse(body)));
        return send(200, JSON.stringify({ rev: store.rev, edits: editsInfo(), readOnly: store.readOnly, history: historyCounts() }), MIME['.json']);
      }
      if (u.pathname === '/frame.svg') return send(200, renderSVG(S(), Number(u.searchParams.get('t') || 0)), MIME['.svg']);
      if (u.pathname === '/lit.png') {
        // отложенный свет для студии (кнопка «Отложенный свет»): считается на сервере
        if (!store.scene.camera3d) return send(409, 'Нужна camera3d (camera3d_set) и узлы с surface (world_build)');
        let st;
        try { st = JSON.parse(u.searchParams.get('states') || 'null') || undefined; } catch {}
        const w = Math.max(160, Math.min(2560, Number(u.searchParams.get('w')) || 960));
        await probeRaster();
        const r = await renderLit(S(), Number(u.searchParams.get('t') || 0), { width: w, states: st });
        return send(200, r.png, 'image/png');
      }
      if (u.pathname === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`event: scene\ndata: ${store.rev}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => { clients.delete(res); clearInterval(ping); });
        return;
      }
      send(404, 'not found');
    } catch (e) { send(req.method === 'POST' || e instanceof SyntaxError ? 400 : 500, e.message); }
  });
  let tries = 0;
  srv.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries++ < 10) { port++; srv.listen(port, host); }
    else log('превью недоступно:', e.message);
  });
  srv.on('listening', () => {
    port = srv.address().port;
    const url = `http://${anyHost ? 'localhost' : host.includes(':') ? `[${host}]` : host}:${port}/`;
    setPreviewUrl(url);
    log('превью:', url, process.env.KONTUR_TOKEN ? '(токен из KONTUR_TOKEN)' : `(токен API: ${TOKEN})`);
  });
  srv.listen(port, host);
  if (!keepAlive) srv.unref();
  return srv;
}
