// Растеризация кадров, контактные листы и экспорт видео (Node).
// PNG: rsvg-convert (librsvg) → @resvg/resvg-js (если установлен) → ImageMagick.
// Видео: ffmpeg.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join, resolve, isAbsolute, extname } from 'node:path';
import { evaluate, treeToString, renderSVG, pixelOf, quantizeRGBA, collectLights, parseColor } from '../engine/kontur.js';
import { decodePNG, encodePNG } from './normals.mjs';
// resvg рендерит в пуле потоков libuv: несколько кадров считаются параллельно
if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = String(Math.min(8, Math.max(4, cpus().length - 2)));
/** Сколько кадров растеризовать одновременно. */
export const PARALLEL = Math.max(1, +(process.env.UV_THREADPOOL_SIZE || 4));

/* ---------------- растровые ассеты ---------------- */
export const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif' };
const isRemote = (src) => /^(data:|https?:|blob:)/i.test(src);
/** Путь к локальному файлу изображения (абсолютный или относительно baseDir), иначе null. */
export function resolveSrc(src, baseDir) {
  if (!src || typeof src !== 'string' || isRemote(src)) return null;
  const p = isAbsolute(src) ? src : resolve(baseDir || '.', src);
  return existsSync(p) ? p : null;
}
/** Размер изображения по заголовку файла (PNG, JPEG, GIF, WebP, SVG). */
export function imageSize(buf) {
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.toString('ascii', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const f = buf.toString('ascii', 12, 16);
    if (f === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (f === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    if (f === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  const txt = buf.toString('utf8', 0, Math.min(buf.length, 4000));
  if (/<svg/i.test(txt)) {
    const num = (re) => { const m = re.exec(txt); return m ? parseFloat(m[1]) : null; };
    const vb = /viewBox=["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(txt);
    const w = num(/<svg[^>]*\swidth=["']([\d.]+)/i), h = num(/<svg[^>]*\sheight=["']([\d.]+)/i);
    return { width: w || (vb ? +vb[1] : 300), height: h || (vb ? +vb[2] : 150) };
  }
  return null;
}
const inlineCache = new Map();
export function fileToDataURI(p) {
  const st = statSync(p), key = p + '|' + st.mtimeMs;
  if (!inlineCache.has(key)) inlineCache.set(key, `data:${IMAGE_MIME[extname(p).toLowerCase()] || 'application/octet-stream'};base64,${readFileSync(p).toString('base64')}`);
  return inlineCache.get(key);
}
/** Копия сцены, где локальные изображения встроены как data: URI (для рендера, видео, автономного HTML). */
export function inlineAssets(scene, baseDir) {
  if (!scene.nodes.some((n) => n.type === 'image')) return scene;
  const out = { ...scene, nodes: scene.nodes.map((n) => {
    if (n.type !== 'image') return n;
    const fix = (src) => { const p = resolveSrc(src, baseDir); return p ? fileToDataURI(p) : src; };
    const c = { ...n, props: { ...n.props } };
    if (c.props.src) c.props.src = fix(c.props.src);
    if (n.keys?.src) c.keys = { ...n.keys, src: n.keys.src.map((k) => ({ ...k, v: fix(k.v) })) };
    return c;
  }) };
  if (scene.dither) out.dither = scene.dither;
  return out;
}

/* ---------------- растеризаторы ----------------
 * Порядок: @resvg/resvg-js → rsvg-convert → ImageMagick (только настоящий: проверяется по `-version`)
 * → headless Edge/Chrome. Каждый кандидат проверяется пробным рендером, а не поиском имени в PATH:
 * на Windows `convert` — это системная утилита конвертации дисков (System32\convert.exe).
 */
const isWin = process.platform === 'win32';
const which = (cmd) => {
  const r = spawnSync(isWin ? 'where' : 'which', isWin ? [cmd] : ['-a', cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
};
const has = (cmd) => which(cmd).length > 0;
let resvg, resvgAsync;
try { const m = await import('@resvg/resvg-js'); resvg = m.Resvg; resvgAsync = m.renderAsync; }
catch {
  // также ищем пакет в папке kontur, даже если сервер запущен из другого каталога
  try { const { createRequire } = await import('node:module'); const m = createRequire(new URL('../package.json', import.meta.url))('@resvg/resvg-js'); resvg = m.Resvg; resvgAsync = m.renderAsync; } catch { resvg = null; }
}

function findMagick() {
  for (const cmd of isWin ? ['magick'] : ['magick', 'convert']) {
    for (const path of which(cmd)) {
      if (isWin && /\\system32\\/i.test(path)) continue;
      const r = spawnSync(path, ['-version'], { encoding: 'utf8', timeout: 5000 });
      if (r.status === 0 && /ImageMagick/i.test(r.stdout || '')) return path;
    }
  }
  return null;
}
function findBrowser() {
  const env = process.env.KONTUR_BROWSER;
  if (env && existsSync(env)) return env;
  const cands = isWin
    ? [`${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`,
       `${process.env.PROGRAMFILES || 'C:\\Program Files'}\\Microsoft\\Edge\\Application\\msedge.exe`,
       `${process.env.PROGRAMFILES || 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
       `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      : [];
  for (const c of cands) if (c && existsSync(c)) return c;
  for (const cmd of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) { const p = which(cmd)[0]; if (p) return p; }
  return null;
}

export const capabilities = { png: null, pngError: null, ffmpeg: false, candidates: {} };

function run(cmd, args, input, timeout = 120000) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const out = [], err = [];
    const timer = setTimeout(() => { p.kill(); rej(new Error(`${cmd}: превышено время`)); }, timeout);
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', (e) => { clearTimeout(timer); rej(e); });
    p.on('close', (code) => { clearTimeout(timer); code === 0 ? res(Buffer.concat(out)) : rej(new Error(`${cmd}: ${Buffer.concat(err).toString().slice(-600)}`)); });
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

const svgW = (svg) => +(/<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] || 0);
const svgH = (svg) => +(/<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] || 0);
const BACKENDS = {
  'resvg-js': async (svg, width) => {
    // системные шрифты грузятся только для кадров с текстом — это заметная часть времени
    const opts = { fitTo: width ? { mode: 'width', value: width } : { mode: 'original' }, font: { loadSystemFonts: svg.includes('<text') } };
    if (resvgAsync) return Buffer.from((await resvgAsync(svg, opts)).asPng());
    return Buffer.from(new resvg(svg, opts).render().asPng());
  },
  'rsvg-convert': (svg, width) => run('rsvg-convert', ['-f', 'png', ...(width ? ['-w', String(width)] : [])], Buffer.from(svg)),
  imagemagick: (svg, width) => run(capabilities.candidates.imagemagick, ['-background', 'none', 'svg:-', ...(width ? ['-resize', `${width}x`] : []), 'png:-'], Buffer.from(svg)),
  browser: async (svg, width) => {
    const dir = mkdtempSync(join(tmpdir(), 'kontur-b-'));
    try {
      const w0 = svgW(svg) || 800, h0 = svgH(svg) || 600, w = Math.round(width || w0), h = Math.round((h0 * w) / w0);
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style></head><body>${svg}</body></html>`;
      const f = join(dir, 'f.html'), out = join(dir, 'f.png');
      writeFileSync(f, html);
      await run(capabilities.candidates.browser, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--default-background-color=00000000',
        `--window-size=${w},${h}`, `--screenshot=${out}`, (isWin ? 'file:///' + f.replace(/\\/g, '/') : 'file://' + f)], null, 60000);
      return readFileSync(out);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  },
};
const PROBE = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#f00"/></svg>';
const isPng = (b) => b && b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

let probing = null;
/** Найти работающий растеризатор (один раз). KONTUR_RASTER=resvg-js|rsvg-convert|imagemagick|browser — принудительно. */
export function probeRaster() {
  if (probing) return probing;
  probing = (async () => {
    capabilities.ffmpeg = has('ffmpeg');
    const order = [];
    if (resvg) order.push('resvg-js');
    if (has('rsvg-convert')) order.push('rsvg-convert');
    const mg = findMagick(); if (mg) { capabilities.candidates.imagemagick = mg; order.push('imagemagick'); }
    const br = findBrowser(); if (br) { capabilities.candidates.browser = br; order.push('browser'); }
    const forced = process.env.KONTUR_RASTER;
    const list = forced ? order.filter((x) => x === forced) : order;
    const errors = [];
    for (const name of list) {
      try {
        const png = await BACKENDS[name](PROBE, 8);
        if (isPng(png)) { capabilities.png = name; return name; }
        errors.push(`${name}: не PNG на выходе`);
      } catch (e) { errors.push(`${name}: ${e.message.split('\n')[0]}`); }
    }
    capabilities.pngError = errors.length ? errors.join('; ') : 'не найдено ни одного растеризатора';
    return null;
  })();
  return probing;
}
export const canPng = () => !!capabilities.png;
export function rasterHelp() {
  return 'Установите в папке kontur: npm i @resvg/resvg-js (работает на Windows/macOS/Linux без внешних программ), либо librsvg (rsvg-convert), либо ImageMagick 7 (magick).';
}

/** SVG-строка → PNG Buffer. */
export async function svgToPng(svg, width) {
  const name = await probeRaster();
  if (!name) throw new Error(`Нет работающего растеризатора SVG (${capabilities.pngError}). ${rasterHelp()}`);
  return BACKENDS[name](svg, width);
}

/** Обработать список параллельно (не больше limit одновременно), сохраняя порядок результатов. */
export async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  const lim = capabilities.png === 'browser' ? Math.min(limit, 3) : limit;
  const worker = async () => { while (next < list.length) { const i = next++; out[i] = await fn(list[i], i); } };
  await Promise.all(Array.from({ length: Math.min(lim, list.length) }, worker));
  return out;
}

/** Увеличить RGBA-картинку без сглаживания до размера w×h. */
export function upscaleNearest(img, w, h) {
  const out = new Uint8Array(w * h * 4), sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const row = Math.min(img.height - 1, Math.floor((y + 0.5) * sy)) * img.width;
    for (let x = 0; x < w; x++) {
      const i = (row + Math.min(img.width - 1, Math.floor((x + 0.5) * sx))) * 4, o = (y * w + x) * 4;
      out[o] = img.data[i]; out[o + 1] = img.data[i + 1]; out[o + 2] = img.data[i + 2]; out[o + 3] = img.data[i + 3];
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * Кадр сцены в PNG с учётом пиксельного режима (scene.pixel), состояний и света.
 * opts: width, viewBox, only, background, states, pixel (false — выключить), native (пиксельный кадр без увеличения),
 *       lit (true или { ambient, normals }) — освещение источниками light по карте нормалей.
 */
export async function renderPNG(scene, t = 0, opts = {}) {
  const vb = opts.viewBox || [0, 0, scene.width, scene.height];
  const outW = Math.max(1, Math.round(opts.width ?? vb[2]));
  const px = opts.pixel === false ? null : pixelOf(scene);
  const base = { viewBox: opts.viewBox, only: opts.only, background: opts.background, states: opts.states };
  const lowW = px ? Math.max(1, Math.round(vb[2] / px.size)) : outW;
  const ro = { ...base, width: lowW, crisp: !!px && !px.aa };
  let png;
  if (opts.lit) {
    const { sceneNormalMap, lightImage } = await import('./normals.mjs');
    const L = typeof opts.lit === 'object' ? opts.lit : {};
    const r = await sceneNormalMap(scene, { t, only: opts.only, viewBox: vb, width: lowW, settings: L.normals || {}, states: opts.states, crisp: ro.crisp });
    const lights = collectLights(scene, t, { states: opts.states }).map((l) => ({ ...l, x: (l.x - vb[0]) * (lowW / vb[2]), y: (l.y - vb[1]) * (lowW / vb[2]), z: l.z * (lowW / vb[2]), radius: l.radius * (lowW / vb[2]) }));
    const amb = parseColor(L.ambient || scene.ambient || '#4a4f5c');
    const lit = lightImage(r.color, r.normal, lights, { ambient: amb.slice(0, 3) });
    if (!px) return encodePNG(lit);
    png = lit;
  } else {
    const buf = await svgToPng(renderSVG(scene, t, ro), lowW);
    if (!px) return buf;
    png = decodePNG(buf);
  }
  if (px.palette) quantizeRGBA(png.data, px.palette);
  if (opts.native) return encodePNG(png);
  return encodePNG(upscaleNearest(png, outW, Math.round((outW * vb[3]) / vb[2])));
}

export function frameSVG(scene, t, width) { return renderSVG(scene, t, { width }); }

/** Контактный лист: сетка кадров в одном SVG (уникальные id для каждого кадра). */
export function contactSheetSVG(scene, times, { cols, cellWidth = 480, states } = {}) {
  cols = cols || Math.min(times.length, 4);
  const rows = Math.ceil(times.length / cols);
  const cw = cellWidth, ch = Math.round((cw * scene.height) / scene.width), lab = 26, gap = 8;
  const W = cols * (cw + gap) + gap, H = rows * (ch + lab + gap) + gap;
  let body = '';
  times.forEach((t, i) => {
    const x = gap + (i % cols) * (cw + gap), y = gap + Math.floor(i / cols) * (ch + lab + gap);
    const tree = evaluate(scene, t, { idPrefix: `f${i}`, states });
    tree.attrs.x = x; tree.attrs.y = y + lab; tree.attrs.width = cw; tree.attrs.height = ch;
    delete tree.attrs.xmlns;
    body += `<text x="${x + 4}" y="${y + 18}" font-family="monospace" font-size="15" fill="#ccc">t = ${t.toFixed(2)}s</text>${treeToString(tree)}`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#222"/>${body}</svg>`;
}

/** Экспорт видео/GIF через ffmpeg. */
export async function exportVideo(scene, path, { fps = scene.fps || 30, width = scene.width, start = 0, end = scene.duration, format, onProgress } = {}) {
  await probeRaster();
  if (!capabilities.ffmpeg) throw new Error('Для экспорта видео нужен ffmpeg в PATH');
  if (!canPng()) throw new Error(`Для экспорта видео нужен растеризатор SVG. ${rasterHelp()}`);
  const dir = mkdtempSync(join(tmpdir(), 'kontur-'));
  try {
    const n = Math.max(1, Math.round((end - start) * fps));
    const w = Math.round(width / 2) * 2;
    await mapLimit(Array.from({ length: n }, (_, i) => i), PARALLEL, async (i) => {
      const png = await renderPNG(scene, start + i / fps, { width: w });
      writeFileSync(join(dir, `f${String(i).padStart(5, '0')}.png`), png);
      if (onProgress && i % 30 === 0) onProgress(i, n);
    });
    format = format || path.split('.').pop().toLowerCase();
    const inArgs = ['-y', '-framerate', String(fps), '-i', join(dir, 'f%05d.png')];
    if (format === 'gif') {
      await run('ffmpeg', [...inArgs, '-vf', `fps=${Math.min(fps, 30)},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, '-loop', '0', path]);
    } else if (format === 'webm') {
      await run('ffmpeg', [...inArgs, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', '-pix_fmt', 'yuv420p', path]);
    } else {
      await run('ffmpeg', [...inArgs, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path]);
    }
    return { frames: n, path };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Автономный HTML-плеер: движок + сцена в одном файле. */
export function standaloneHTML(scene, { title = 'Kontur' } = {}) {
  const engine = readFileSync(new URL('../engine/kontur.js', import.meta.url), 'utf8');
  const engineB64 = Buffer.from(engine).toString('base64');
  const esc = (s) => String(s).replace(/</g, '&lt;');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
html,body{margin:0;height:100%;background:#0a0a0f;color:#ddd;font:14px system-ui,sans-serif}
#stage{position:absolute;inset:0 0 48px 0;display:flex;align-items:center;justify-content:center}
#view{width:100%;height:100%;max-width:calc((100vh - 48px)*${scene.width / scene.height});aspect-ratio:${scene.width}/${scene.height};max-height:100%}
#bar{position:absolute;left:0;right:0;bottom:0;height:48px;display:flex;gap:12px;align-items:center;padding:0 16px;box-sizing:border-box;background:#111118}
button{background:#23233a;color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer}input[type=range]{flex:1}
#t{font-variant-numeric:tabular-nums;min-width:110px;text-align:right}</style></head><body>
<div id="stage"><div id="view"></div></div>
<div id="bar"><button id="pp">❚❚</button><input id="sc" type="range" min="0" max="${scene.duration}" step="0.001" value="0"><span id="t"></span></div>
<script type="application/json" id="scene">${JSON.stringify(scene).replace(/</g, '\\u003c')}</script>
<script type="module">
const url = URL.createObjectURL(new Blob([atob('${engineB64}')].map(s=>new TextDecoder().decode(Uint8Array.from(s,c=>c.charCodeAt(0)))), {type:'text/javascript'}));
const { Player } = await import(url);
const scene = JSON.parse(document.getElementById('scene').textContent);
const p = new Player(document.getElementById('view'), scene);
const sc = document.getElementById('sc'), tt = document.getElementById('t'), pp = document.getElementById('pp');
p.on((t) => { sc.value = t; tt.textContent = t.toFixed(2) + ' / ' + scene.duration.toFixed(2) + 's'; pp.textContent = p.playing ? '❚❚' : '▶'; });
pp.onclick = () => p.toggle();
sc.oninput = () => { p.pause(); p.seek(+sc.value); };
addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); p.toggle(); } });
</script></body></html>`;
}
