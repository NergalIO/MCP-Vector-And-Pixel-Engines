// PixelForge HTTP server: serves the editor, the REST API and live updates (SSE).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Store, needsTrust } from './store.js';
import { encodePng, encodeApng } from './png.js';
import { encodeGif } from './gif.js';
import { exportUnity } from './unity.js';
import { renderFrame, renderSheet, sheetMeta, toAscii, frameList, autoScale } from './render.js';
import { ROOT, PORT, DATA_DIR, VERSION, BUILD, TOKEN_HEADER, ensureToken } from './config.js';

const PUBLIC_DIR = path.join(ROOT, 'public');
const TOKEN = ensureToken();

const store = new Store(DATA_DIR);
const clients = new Set();
let editorState = null;

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

// Pixel-only changes are sent as cel deltas; structural changes send the whole document.
store.on('change', (s, { source, op, args, touched }) => {
  const base = { source, op, frame: args.frame, layer: args.layer };
  if (touched) {
    broadcast('cels', {
      ...base, id: s.id, rev: s.rev, canUndo: s.undoStack.length > 0, canRedo: s.redoStack.length > 0,
      cels: touched.map(([f, l]) => ({ f, l, data: Buffer.from(s.frames[f].cels[l]).toString('base64') })),
    });
  } else {
    broadcast('sprite', { ...base, sprite: s.toJSON() });
  }
});
store.on('list', () => broadcast('list', store.list()));
store.on('removed', (id) => broadcast('removed', { id }));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024 * 1024) throw new HttpError(413, 'body too large');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

// --- security ----------------------------------------------------------------
// The server only listens on 127.0.0.1, but any web page the user opens could still send requests to it.
// So: Host must be ours (blocks DNS rebinding), writes must come from our own origin with a JSON body
// (cross-site "simple" requests can't send application/json), and anything touching the file system
// requires the token that only the local MCP process can read from disk.

const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
const ORIGINS = new Set([...HOSTS].map((h) => `http://${h}`));

function guard(req) {
  if (!HOSTS.has(req.headers.host)) throw new HttpError(403, 'forbidden host');
  const trusted = req.headers[TOKEN_HEADER] === TOKEN;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin && !ORIGINS.has(origin)) throw new HttpError(403, 'cross-origin request rejected');
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'cross-site request rejected');
    if (req.method === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
      throw new HttpError(415, 'Content-Type must be application/json');
    }
  }
  return trusted;
}

function requireTrust(trusted, what) {
  if (!trusted) throw new HttpError(403, `${what} is only allowed for the PixelForge MCP server`);
}

// --- rendering helpers ---------------------------------------------------------

function num(q, k, d) {
  const v = q.get(k);
  return v === null || v === '' ? d : Number(v);
}

function renderOpts(s, q) {
  return {
    scale: num(q, 'scale', 0) || autoScale(s),
    layer: q.get('layer') ?? undefined,
    background: q.get('bg') || undefined,
    grid: q.get('grid') === '1',
    onion: q.get('onion') || undefined,
    tag: q.get('tag') || undefined,
    columns: num(q, 'columns', undefined),
    padding: num(q, 'padding', 0),
    frames: q.get('frames') ? q.get('frames').split(',').map(Number) : undefined,
  };
}

function imageResponse(res, s, buf, q, suffix, ext = 'png') {
  const extra = q.get('download') === '1' ? { 'Content-Disposition': `attachment; filename="${s.id}${suffix}.${ext}"` } : {};
  send(res, 200, buf, ext === 'gif' ? 'image/gif' : 'image/png', extra);
}

const animFrames = (s, o) => frameList(s, o).map((f) => ({ rgba: renderFrame(s, f, o).rgba, duration: s.frames[f].duration }));

function exportSprite(s, a) {
  const format = a.format || 'sheet';
  const scale = Math.max(1, Number(a.scale || 1));
  let target = a.path;
  if (!target) throw new Error('path is required (absolute path to a file or folder)');
  target = path.resolve(target);
  const isDir = !path.extname(target);
  const base = isDir ? path.join(target, s.id) : target.replace(/\.(png|json|gif)$/i, '');
  fs.mkdirSync(path.dirname(base + '.x'), { recursive: true });
  const written = [];
  const write = (file, data) => { fs.writeFileSync(file, data); written.push(file); };
  const opts = { scale, tag: a.tag, frames: a.frames, layer: a.layer, background: a.background, columns: a.columns, padding: a.padding || 0 };

  if (format === 'png') {
    const img = renderFrame(s, a.frame ?? 0, opts);
    write(base + '.png', encodePng(img.rgba, img.width, img.height));
  } else if (format === 'sheet') {
    const sheet = renderSheet(s, opts);
    write(base + '.png', encodePng(sheet.rgba, sheet.width, sheet.height));
    if (a.json !== false) write(base + '.json', JSON.stringify(sheetMeta(s, sheet, scale, path.basename(base) + '.png'), null, 2));
  } else if (format === 'frames') {
    for (const f of frameList(s, opts)) {
      const img = renderFrame(s, f, opts);
      write(`${base}_${f}.png`, encodePng(img.rgba, img.width, img.height));
    }
  } else if (format === 'apng') {
    write(base + '.png', encodeApng(animFrames(s, opts), s.width * scale, s.height * scale));
  } else if (format === 'gif') {
    write(base + '.gif', encodeGif(animFrames(s, opts), s.width * scale, s.height * scale));
  } else if (format === 'json') {
    write(base + '.pixelforge.json', JSON.stringify(s.toJSON()));
  } else {
    throw new Error(`unknown format "${format}" (png | sheet | frames | apng | gif | json)`);
  }
  return { written };
}

// --- API -----------------------------------------------------------------------

async function handleApi(req, res, url, trusted) {
  const q = url.searchParams;
  const parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent); // drop "api"
  const [head, id, sub] = parts;
  const M = req.method;

  if (head === 'health') {
    return send(res, 200, { ok: true, app: 'pixelforge', version: VERSION, build: BUILD, port: PORT, pid: process.pid, clients: clients.size });
  }

  if (head === 'events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: hello\ndata: ${JSON.stringify({ build: BUILD, version: VERSION })}\n\n`);
    res.write(`event: list\ndata: ${JSON.stringify(store.list())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clients.delete(res); clearInterval(ping); });
    return;
  }

  if (head === 'shutdown' && M === 'POST') {
    requireTrust(trusted, 'shutdown');
    send(res, 200, { ok: true });
    store.flush();
    setTimeout(() => process.exit(0), 50);
    return;
  }

  if (head === 'editor-state') {
    if (M === 'POST') { editorState = { ...(await readBody(req)), at: Date.now() }; return send(res, 200, { ok: true }); }
    return send(res, 200, { state: editorState, clients: clients.size });
  }

  if (head === 'focus' && M === 'POST') {
    const b = await readBody(req);
    const s = store.get(b.id);
    broadcast('focus', { id: s.id, frame: b.frame ?? 0, layer: b.layer });
    return send(res, 200, { ok: true, clients: clients.size });
  }

  if (head === 'import' && M === 'POST') {
    const b = await readBody(req);
    if (b.path) requireTrust(trusted, 'importing from a file path');
    return send(res, 200, store.importPng(b, trusted ? 'mcp' : 'web').meta());
  }

  if (head !== 'sprites') return send(res, 404, { error: 'not found' });

  if (!id) {
    if (M === 'GET') return send(res, 200, store.list());
    if (M === 'POST') {
      const b = await readBody(req);
      return send(res, 200, store.create(b, trusted ? 'mcp' : 'web').meta());
    }
  }

  const s = store.get(id);
  const source = trusted ? 'mcp' : 'web';
  if (!sub) {
    if (M === 'GET') return send(res, 200, q.get('meta') === '1' ? s.meta() : s.toJSON());
    if (M === 'DELETE') { store.remove(s.id); return send(res, 200, { ok: true }); }
  }
  if (sub === 'op' && M === 'POST') {
    const b = await readBody(req);
    if (needsTrust(b.op, b.args)) requireTrust(trusted, 'reading files from disk');
    const result = store.apply(s.id, b.op, b.args || {}, source);
    return send(res, 200, { ok: true, rev: s.rev, result });
  }
  if (sub === 'duplicate' && M === 'POST') {
    const b = await readBody(req);
    return send(res, 200, store.duplicate(s.id, b.name, source).meta());
  }
  if (sub === 'backups') {
    if (M === 'GET') return send(res, 200, store.listBackups(s.id));
    if (M === 'POST') return send(res, 200, store.restoreBackup(s.id, (await readBody(req)).file, source));
  }
  if (sub === 'export' && M === 'POST') {
    requireTrust(trusted, 'writing files');
    return send(res, 200, exportSprite(s, await readBody(req)));
  }
  if (sub === 'unity' && M === 'POST') {
    requireTrust(trusted, 'writing files');
    return send(res, 200, exportUnity(s, await readBody(req)));
  }
  if (sub === 'frame.png') {
    const img = renderFrame(s, num(q, 'frame', 0), renderOpts(s, q));
    return imageResponse(res, s, encodePng(img.rgba, img.width, img.height), q, `_${num(q, 'frame', 0)}`);
  }
  if (sub === 'sheet.png') {
    const sheet = renderSheet(s, renderOpts(s, q));
    return imageResponse(res, s, encodePng(sheet.rgba, sheet.width, sheet.height), q, '_sheet');
  }
  if (sub === 'sheet.json') {
    const o = renderOpts(s, q);
    return send(res, 200, sheetMeta(s, renderSheet(s, o), o.scale, `${s.id}_sheet.png`));
  }
  if (sub === 'anim.png') {
    const o = renderOpts(s, q);
    return imageResponse(res, s, encodeApng(animFrames(s, o), s.width * o.scale, s.height * o.scale), q, '_anim');
  }
  if (sub === 'anim.gif') {
    const o = renderOpts(s, q);
    return imageResponse(res, s, encodeGif(animFrames(s, o), s.width * o.scale, s.height * o.scale), q, '_anim', 'gif');
  }
  if (sub === 'ascii') {
    return send(res, 200, toAscii(s, num(q, 'frame', 0), {
      layer: q.get('layer') ?? undefined, x: num(q, 'x', 0), y: num(q, 'y', 0), width: num(q, 'width', undefined), height: num(q, 'height', undefined),
    }));
  }
  return send(res, 404, { error: 'not found' });
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const trusted = guard(req);
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url, trusted);
    else serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 400, { error: e.message });
  }
});

server.on('error', (e) => {
  console.error(`[pixelforge] ${e.code === 'EADDRINUSE' ? `port ${PORT} is already in use` : e.message}`);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => console.log(`[pixelforge] editor running at http://localhost:${PORT}  (build ${BUILD}, data: ${DATA_DIR})`));

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { store.flush(); process.exit(0); });
process.on('exit', () => store.flush());
