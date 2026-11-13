// Раскладка сцены на слои и запекание их в PNG — общая часть экспорта в игровые движки (Godot, Unity).
//
// Сцена делится на слои по корневым узлам; узлы, которые не перекрываются, объединяются, чтобы слоёв было мало.
// Каждый слой рендерится движком Kontur в PNG со всеми эффектами (свечение, размытие, тени, дизеринг);
// анимированные слои — покадрово по клипам (одинаковые кадры подряд склеиваются через длительность),
// варианты состояний — отдельным слоем на каждый вариант. Режимы наложения остаются у слоя (blend)
// и переносятся движком-получателем (шейдер/материал).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderSVG, clipRange, pixelOf, quantizeRGBA, collectLights, typeAnimated, modIsStatic } from '../engine/kontur.js';
import { svgToPng, svgToRGBA, mapLimit, PARALLEL, isDeferred } from './render.mjs';
import { posixRel } from './paths.mjs';
import { decodePNG, encodePNG, sceneNormalMap } from './normals.mjs';

/* ============================== анализ слоёв ============================== */
export function isAnimated(scene, id, byId, kids, memo = new Map()) {
  if (memo.has(id)) return memo.get(id);
  memo.set(id, false);
  const n = byId.get(id);
  const p = n.props || {};
  let a = false;
  if (n.keys && Object.values(n.keys).some((k) => k.length > 1)) a = true;
  // модификаторы и типы, меняющиеся сами, — по реестрам движка (как у кэша статичных поддеревьев)
  if (n.mods?.some((m) => !modIsStatic(m))) a = true;
  if (n.type !== 'light' && typeAnimated(n)) a = true; // свет уходит в движок отдельно, не слоем
  if (p.inPoint != null || p.outPoint != null) a = true;
  for (const k of ['clip', 'mask']) if (p[k] && byId.has(p[k]) && isAnimated(scene, p[k], byId, kids, memo)) a = true;
  for (const c of kids.get(id) || []) if (isAnimated(scene, c.id, byId, kids, memo)) a = true;
  memo.set(id, a);
  return a;
}
const area = (b) => (b ? (b[2] - b[0]) * (b[3] - b[1]) : 0);
const union = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
const overlap = (a, b) => a && b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
function alphaBox(img, k = 1) {
  const { width: w, height: h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : [x0 * k, y0 * k, (x1 + 1) * k, (y1 + 1) * k];
}
// кириллица — латиницей (ходьба → hodba), остальное, кроме латиницы и цифр, — «_»
const TRANSLIT = Object.fromEntries([...'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'].map((c, i) => [c, ['a', 'b', 'v', 'g', 'd', 'e', 'e', 'zh', 'z', 'i', 'y', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u', 'f', 'h', 'ts', 'ch', 'sh', 'sch', '', 'y', '', 'e', 'yu', 'ya'][i]]));
const translit = (s) => s.replace(/[а-яё]/gi, (c) => { const l = TRANSLIT[c.toLowerCase()]; return c === c.toLowerCase() ? l : l.charAt(0).toUpperCase() + l.slice(1); });
export const SANE = (s) => translit(String(s)).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
/** Имена для файлов и узлов: SANE, но без совпадений — «ходьба» и «прыжок» не сольются в «______» (тогда — fallback + номер). */
export function safeNames(names, fallback = 'n') {
  const used = new Set(), out = new Map();
  names.forEach((nm, i) => {
    if (out.has(nm)) return;
    let s = SANE(String(nm));
    if (!/[A-Za-z0-9]/.test(s)) s = `${fallback}${i}`;
    let u = s;
    for (let k = 2; used.has(u); k++) u = `${s}_${k}`;
    used.add(u); out.set(nm, u);
  });
  return out;
}

/**
 * bakeLayers(scene, dir, opts) — слои сцены в PNG в папке dir/<layersDir>.
 * opts: fps (12), scale (1; в пиксельном режиме по умолчанию 1/размер пикселя), normals (false | true | {…, animated}),
 *       clips (имена; по умолчанию все или «default» = вся шкала), lights (false — без источников света),
 *       layersDir ('layers'), tag ('godot' — префикс строк лога), log,
 *       lit: 'deferred' — статичные слои запекаются с отложенным светом и стилем (источники тогда не выводятся, если не lights: true)
 * Возвращает { W, H, px, scale, clips, fpsOf, nodes, lights, frameCount, normals }:
 *   nodes — слои снизу вверх: { type: 'static'|'anim', name, x, y (левый верхний угол, px сцены), file | anims[{name,fps,loop,next,frames[{file,duration,normal}]}],
 *           normal, blend, items (id узлов), state ({group,value,visible}|null), width, height (размер PNG) }
 *   lights — { id, name, x, y, z, color, energy, radius, falloff, state }
 */
export async function bakeLayers(scene, dir, opts = {}) {
  const t0 = Date.now();
  const tag = opts.tag || 'export';
  const log = opts.log || (() => {});
  const px = pixelOf(scene);
  const scale = opts.scale || (px ? 1 / px.size : 1);
  const W = scene.width, Hh = scene.height;
  const normalsOpt = opts.normals ? (typeof opts.normals === 'object' ? opts.normals : {}) : null;
  // прежние файлы удаляет вызывающий экспорт — только свои, по списку (export_dir.mjs); здесь папка не чистится
  const layersDir = join(dir, opts.layersDir || 'layers');
  mkdirSync(layersDir, { recursive: true });
  const files = []; // всё записанное — в список файлов экспорта
  const put = (f, data) => { writeFileSync(f, data); files.push(f); return f; };

  // клипы
  let clips = (scene.clips || []).filter((c) => !opts.clips || opts.clips.includes(c.name)).map((c) => clipRange(scene, c.name));
  if (!clips.length) clips = [{ name: 'default', start: 0, end: scene.duration, loop: scene.loop !== false }];
  const fpsOf = (c) => c.fps || opts.fps || 12;
  const clipStem = safeNames(clips.map((c) => c.name), 'clip');
  const sampleTimes = [];
  for (const c of clips) { const n = Math.max(1, Math.min(24, Math.round((c.end - c.start) * 4))); for (let i = 0; i < n; i++) sampleTimes.push(c.start + ((c.end - c.start) * i) / n); }

  // индекс сцены
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const kids = new Map();
  const clipRefs = new Set();
  for (const n of scene.nodes) {
    const p = n.parent ?? null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(n);
    for (const k of ['clip', 'mask']) if (n.props?.[k]) clipRefs.add(n.props[k]);
  }
  const roots = (kids.get(null) || []).filter((n) => !clipRefs.has(n.id) && n.type !== 'light');
  const memo = new Map();
  // состояния: какие корневые узлы меняются от какой группы (если групп несколько — берётся первая)
  const rootOf = (id) => { let n = byId.get(id); while (n?.parent) n = byId.get(n.parent); return n?.id; };
  const stateOfRoot = new Map();
  for (const g of scene.states || []) for (const patch of Object.values(g.values || {})) for (const id of Object.keys(patch || {})) {
    const r = rootOf(id);
    if (r && !stateOfRoot.has(r)) stateOfRoot.set(r, g);
  }
  const variantsOf = (rootId) => {
    const g = stateOfRoot.get(rootId);
    if (!g) return [null];
    const def = g.default ?? Object.keys(g.values)[0];
    return Object.keys(g.values).map((v) => ({ group: g.name, value: v, isDefault: v === def }));
  };
  const statesFor = (v) => (v ? { [v.group]: v.value } : undefined);
  const snap = (v, f) => (px ? f(v / px.size) * px.size : f(v));

  // 1. рамки узлов (низкое разрешение; для анимированных — объединение по времени и вариантам состояний)
  const LOW = Math.max(160, Math.round(W / 6)), k = W / LOW;
  const items = [];
  if (scene.background && scene.background !== 'none') items.push({ id: '__bg', kind: 'static', bbox: [0, 0, W, Hh], ids: [], bg: true, variants: [null] });
  const jobs = [];
  const meta = roots.map((n) => {
    const anim = isAnimated(scene, n.id, byId, kids, memo);
    const variants = variantsOf(n.id);
    const times = anim ? sampleTimes : [clips[0].start];
    for (const v of variants) for (const t of times) jobs.push({ n, t, v });
    return { n, anim, variants };
  });
  // отмена (opts.signal) проверяется перед каждым растром: экспорт большой сцены идёт минутами
  const stop = () => opts.signal?.throwIfAborted();
  opts.onProgress?.(0, undefined, `${tag}: разметка слоёв`);
  const boxes = await mapLimit(jobs, PARALLEL, async ({ n, t, v }) => stop() ?? alphaBox(await svgToRGBA(renderSVG(scene, t, { only: [n.id], width: LOW, background: false, states: statesFor(v) }), LOW), k));
  const bbOf = new Map();
  jobs.forEach((j, i) => bbOf.set(j.n.id, union(bbOf.get(j.n.id) || null, boxes[i])));
  for (const { n, anim, variants } of meta) {
    let bb = bbOf.get(n.id);
    if (!bb) continue;
    const blend = n.props?.blend && n.props.blend !== 'normal' ? n.props.blend : null;
    const pad = anim ? k * 2 : k;
    bb = [Math.max(0, snap(bb[0] - pad, Math.floor)), Math.max(0, snap(bb[1] - pad, Math.floor)), Math.min(W, snap(bb[2] + pad, Math.ceil)), Math.min(Hh, snap(bb[3] + pad, Math.ceil))];
    const stateful = variants[0] !== null;
    items.push({ id: n.id, ids: [n.id], kind: stateful ? `state:${n.id}` : blend ? `blend:${n.id}` : anim ? 'anim' : 'static', anim, blend, bbox: bb, variants });
  }
  log(`${tag}: узлов ${items.length}, анализ рамок ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // 2. раскладка по слоям: переставлять можно только неперекрывающиеся узлы
  const layers = [];
  for (const it of items) {
    let barrier = -1;
    for (let li = layers.length - 1; li >= 0 && barrier < 0; li--) if (layers[li].items.some((o) => overlap(o.bbox, it.bbox))) barrier = li;
    let target = -1;
    if (!it.kind.startsWith('blend') && !it.kind.startsWith('state')) {
      for (let li = Math.max(0, barrier); li < layers.length; li++) {
        const L = layers[li];
        if (L.kind !== it.kind) continue;
        if (it.kind === 'anim') { const u = union(L.bbox, it.bbox); if (area(u) > Math.max((area(L.bbox) + area(it.bbox)) * 1.6, W * Hh * 0.15)) continue; }
        target = li; break;
      }
    }
    if (target < 0) { layers.push({ kind: it.kind, anim: it.kind === 'anim' || !!it.anim, items: [it], bbox: it.bbox, blend: it.blend, variants: it.variants }); }
    else { const L = layers[target]; L.items.push(it); L.bbox = union(L.bbox, it.bbox); }
  }

  // 3. рендер слоёв (кадры считаются параллельно)
  const crisp = !!px && !px.aa;
  // запечённый отложенный свет: статичные слои берут цвет из итогового кадра стиля (альфа — своя)
  let litFrame = null;
  if (isDeferred(opts.lit) && scene.camera3d) {
    const { renderLit } = await import('./lighting.mjs');
    litFrame = (await renderLit(scene, clips[0].start, { width: Math.round(W * scale) })).image;
    log(`${tag}: отложенный свет запечён (${litFrame.width}×${litFrame.height})`);
  } else if (scene.camera3d && scene.materials && Object.keys(scene.materials).length) {
    // попиксельные материалы без света: запекаются в альбедо статичных слоёв
    const { renderLit } = await import('./lighting.mjs');
    litFrame = (await renderLit(scene, clips[0].start, { width: Math.round(W * scale), bake: 'albedo', baseDir: opts.baseDir })).image;
    log(`${tag}: материалы запечены в альбедо (${litFrame.width}×${litFrame.height})`);
  }
  const bakeLit = (png, x0, y0) => {
    const img = decodePNG(png), lw = litFrame.width, lh = litFrame.height, kx = lw / W;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      if (!img.data[o + 3]) continue;
      const sx = Math.min(lw - 1, Math.round(x0 * kx) + x), sy = Math.min(lh - 1, Math.round(y0 * kx) + y), s = (sy * lw + sx) * 4;
      img.data[o] = litFrame.data[s]; img.data[o + 1] = litFrame.data[s + 1]; img.data[o + 2] = litFrame.data[s + 2];
    }
    return encodePNG(img);
  };
  const renderLayer = async (L, t, v) => {
    stop();
    const [x0, y0, x1, y1] = L.bbox, bw = x1 - x0, bh = y1 - y0;
    const ids = L.items.flatMap((i) => i.ids);
    const bg = L.items.some((i) => i.bg);
    const ow = Math.max(1, Math.round(bw * scale));
    const svg = renderSVG(scene, t, { only: ids.length ? ids : ['__none__'], viewBox: [x0, y0, bw, bh], width: ow, background: bg, states: statesFor(v), crisp });
    let png = await svgToPng(svg, ow);
    if (px?.palette) { const img = decodePNG(png); quantizeRGBA(img.data, px.palette); png = encodePNG(img); }
    if (litFrame && !L.anim && !L.blend) png = bakeLit(png, x0, y0);
    return { png, ids, ow };
  };
  const normalOf = async (L, t, ids, ow, v) => {
    const [x0, y0, x1, y1] = L.bbox;
    const r = await sceneNormalMap(scene, { t, only: ids.length ? ids : undefined, viewBox: [x0, y0, x1 - x0, y1 - y0], width: ow, settings: normalsOpt, states: statesFor(v), crisp });
    return encodePNG(r.normal);
  };
  const dims = (png) => [png.readUInt32BE(16), png.readUInt32BE(20)]; // ширина и высота из заголовка PNG (IHDR)
  const nodes = [];
  let frameCount = 0;
  for (let li = 0; li < layers.length; li++) {
    const L = layers[li];
    const base = `L${String(li).padStart(2, '0')}_${SANE(L.items.find((i) => !i.bg)?.id || 'background')}`;
    const [x0, y0] = L.bbox;
    const vStem = safeNames((L.variants || []).filter(Boolean).map((v) => v.value), 'v');
    for (const v of L.variants || [null]) {
      const name = v ? `${base}__${vStem.get(v.value)}` : base;
      const state = v ? { group: v.group, value: v.value, visible: v.isDefault } : null;
      const common = { name, x: x0, y: y0, w: L.bbox[2] - x0, h: L.bbox[3] - y0, blend: L.blend, items: L.items.map((i) => i.id), state };
      if (L.anim) {
        const anims = [];
        for (const c of clips) {
          const fps = fpsOf(c), n = Math.max(1, Math.round((c.end - c.start) * fps));
          const rendered = await mapLimit(Array.from({ length: n }, (_, i) => c.start + i / fps), PARALLEL, (t) => renderLayer(L, t, v));
          const frames = [];
          let prev = null;
          for (let i = 0; i < n; i++) {
            const { png, ids, ow } = rendered[i];
            if (prev && png.equals(prev.png)) { prev.duration++; continue; }
            const f = join(layersDir, name, `${clipStem.get(c.name)}_${String(i).padStart(4, '0')}.png`);
            mkdirSync(join(layersDir, name), { recursive: true });
            put(f, png);
            const fr = { file: f, png, duration: 1 };
            if (normalsOpt && normalsOpt.animated && !L.blend) { fr.normal = f.replace(/\.png$/, '_n.png'); put(fr.normal, await normalOf(L, c.start + i / fps, ids, ow, v)); }
            frames.push(fr); prev = fr; frameCount++;
          }
          anims.push({ name: c.name, fps, loop: c.loop, next: c.next, frames });
        }
        const [width, height] = dims(anims[0].frames[0].png);
        nodes.push({ type: 'anim', ...common, width, height, anims });
      } else {
        const t = clips[0].start;
        const { png, ids, ow } = await renderLayer(L, t, v);
        const f = join(layersDir, `${name}.png`);
        put(f, png);
        const [width, height] = dims(png);
        const node = { type: 'static', ...common, width, height, file: f };
        if (normalsOpt && !L.blend) { node.normal = f.replace(/\.png$/, '_n.png'); put(node.normal, await normalOf(L, t, ids, ow, v)); }
        nodes.push(node);
        frameCount++;
      }
    }
    log(`${tag}: слой ${li + 1}/${layers.length} ${base}`);
    opts.onProgress?.(li + 1, layers.length, `${tag}: слой ${li + 1}/${layers.length}`);
  }

  // 3а. источники света (позиции и параметры — в начале первого клипа);
  // свет, который меняется от состояний, выводится по варианту на каждый (с меткой состояния)
  const lights = [];
  if (opts.lights !== false && !(litFrame && opts.lights !== true)) {
    const lightGroup = new Map();
    for (const g of scene.states || []) for (const patch of Object.values(g.values || {})) for (const id of Object.keys(patch || {})) if (byId.get(id)?.type === 'light' && !lightGroup.has(id)) lightGroup.set(id, g);
    for (const l of collectLights(scene, clips[0].start)) if (!lightGroup.has(l.id)) lights.push(l);
    for (const [id, g] of lightGroup) {
      const def = g.default ?? Object.keys(g.values)[0];
      for (const v of Object.keys(g.values)) {
        const l = collectLights(scene, clips[0].start, { states: { [g.name]: v } }).find((x) => x.id === id);
        if (l) lights.push({ ...l, name: `${id}__${v}`, state: { group: g.name, value: v, visible: v === def } });
      }
    }
  }
  // имена источников — безопасные и без совпадений (по ним называются узлы в Godot и Unity)
  const lightName = safeNames(lights.map((l) => l.name || l.id), 'light');
  for (const l of lights) l.name = lightName.get(l.name || l.id);
  return { W, H: Hh, px, scale, clips, fpsOf, clipStem, nodes, lights, frameCount, normals: !!normalsOpt, t0, files };
}

/** Описание слоёв, кадров и клипов (kontur_manifest.json) — для своих конвертеров и проверки. */
export function layersManifest(scene, dir, b, extra = {}) {
  const rel = (f) => (f ? posixRel(dir, f) : null);
  const manifest = {
    generator: 'kontur', ...extra, size: [b.W, b.H], scale: b.scale,
    clips: b.clips.map((c) => ({ name: c.name, start: c.start, end: c.end, loop: c.loop, fps: b.fpsOf(c), next: c.next })),
    pixel: b.px ? { size: b.px.size, palette: b.px.palette || null } : null,
    states: (scene.states || []).map((g) => ({ name: g.name, default: g.default ?? Object.keys(g.values)[0], values: Object.keys(g.values) })),
    lights: b.lights.map((l) => ({ id: l.id, name: l.name || l.id, position: [l.x, l.y], height: l.z, color: l.color, energy: l.energy, radius: l.radius, falloff: l.falloff ?? 1, state: l.state || null })),
    layers: b.nodes.map((n) => ({ name: n.name, type: n.type, position: [n.x, n.y], size: [n.w, n.h], blend: n.blend || null, nodes: n.items, state: n.state || null,
      ...(n.type === 'static' ? { file: rel(n.file), normal: rel(n.normal) }
        : { animations: n.anims.map((a) => ({ name: a.name, fps: a.fps, loop: a.loop, frames: a.frames.map((f) => ({ file: rel(f.file), duration: f.duration, normal: rel(f.normal) })) })) }) })),
  };
  const nm = Object.fromEntries(scene.nodes.filter((n) => n.type === 'image' && n.props?.normalMap).map((n) => [n.id, n.props.normalMap]));
  if (Object.keys(nm).length) manifest.sourceNormalMaps = nm;
  return manifest;
}
