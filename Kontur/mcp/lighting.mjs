// Отложенное освещение 2.5D-сцен Kontur — оркестратор конвейера (этапы — в mcp/lit/*.mjs).
// Проходы renderSVG → G-буфер (позиции по плоскостям и лучу камеры) → попиксельные материалы (с фильтрацией по следу
// пикселя) → тени солнца (BVH, полутень) и контактные тени → AO (SSAO или GTAO с изогнутыми нормалями, цветной,
// многократный отскок) → солнце, небо, лампы → отражённый свет (GI, до трёх отскоков) → сборка (живописные тени,
// персонажи, свечение, туман, воздушная перспектива) → небо → SSR → объёмный свет → глубина резкости → bloom →
// автоэкспозиция → тонмаппинг (ACES/AgX/hue) → палитра с референса и цветокоррекция → цепочка стилей (cel, штриховка,
// Кувахара, краска, пиксели, контур, бумага, виньетка, FXAA, резкость, хроматическая аберрация, зерно).
// Всё новое выключено по умолчанию: старые сцены дают тот же кадр пиксель в пиксель (test/lit-matrix.mjs).
// Исключение — фильтрация фактур (textureFilter, исправление муара): она меняет только дальние пиксели материалов.
import { evaluate, treeToString, dropUnderBg, modeInfo, parseColor, sceneMemo } from '../engine/kontur.js';
import { svgToPng, svgToRGBA, mapLimit, probeRaster, adoptRaster, capabilities } from './render.mjs';
import { encodePNG, sideBySide, scaleDown, heightToNormalSrc } from './normals.mjs';
import { buildBVH } from './bvh.mjs';
import { prepareMaterials, applyMaterials } from './materials.mjs';
import { LIN8, stageTimer, stackV, byte01, grayToRGBA, rgbToRGBA } from './lit/util.mjs';
import { resolveLighting, resolveStyle, effectsSummary } from './lit/params.mjs';
import { buildGBuffer, forgetHalf } from './lit/gbuffer.mjs';
import { occluders, sunShadows, contactShadows } from './lit/shadows.mjs';
import { ambientOcclusion } from './lit/ao.mjs';
import { ambientFn, sunDirect, shadeSurface } from './lit/shade.mjs';
import { screenGI } from './lit/gi.mjs';
import { composeSurface, composeSky } from './lit/compose.mjs';
import { screenReflections } from './lit/ssr.mjs';
import { volumetricLight } from './lit/volumetric.mjs';
import { bloom, depthOfField, autoExposure } from './lit/post.mjs';
import { tonemapFrame, matchPalette, loadRefStats, applyGrade } from './lit/color.mjs';
import { applyStyle } from './lit/style.mjs';
import { warm, task, frameArena, POOL, THREADS } from './lit/pool.mjs';
import { initGPU, gpuInfo, gpuResident, gpuReleaseResident, rasterWanted } from './lit/gpu.mjs';
import { treeToGeometry } from './lit/raster-geom.mjs';
import { initRasterGPU, rasterize, renderLayers } from './lit/gpu-raster.mjs';

export { LIGHT_PRESETS, STYLE_TYPES, TONEMAPS, resolveLighting, resolveStyle, effectsSummary } from './lit/params.mjs';
export { gauss } from './lit/filters.mjs';
export { occluders } from './lit/shadows.mjs';
export { deferredLights } from './lit/shade.mjs';
export { loadCube, agx, hueTonemap, loadRefStats, matchPalette } from './lit/color.mjs';
export { normalMapFromPass } from './normals.mjs';

/** Модули с попиксельными ядрами пула (mcp/lit/pool.mjs): воркеры загружают их заранее. */
const KERNEL_MODS = ['./lit/filters.mjs', './lit/shadows.mjs', './lit/ao.mjs', './lit/gi.mjs', './lit/shade.mjs', './lit/compose.mjs', './lit/gbuffer.mjs', './lit/style.mjs', './materials.mjs'].map((m) => new URL(m, import.meta.url).href);

/* ============================== проходы ============================== */
export const PASS_LIST = ['color', 'normal', 'plane', 'planeD', 'emissive', 'ink', 'cover'];
/** Нужен ли сцене проход matId (есть попиксельные материалы). */
export const needsMatId = (scene) => !!(scene.materials && Object.keys(scene.materials).length);
/**
 * Отрендерить проходы: { color, normal, plane, planeD, emissive, ink, cover, matId?, 'mask:chr' } — PNG,
 * а с raw: true — RGBA-картинки { width, height, data } (без кодирования в PNG и обратно).
 */
export async function renderPasses(scene, t = 0, { width = scene.width, states, masks = ['chr'], passes, raw = false } = {}) {
  passes = passes || (needsMatId(scene) ? [...PASS_LIST, 'matId'] : PASS_LIST);
  const list = [...passes, ...masks.map((m) => `mask:${m}`)];
  const out = {};
  // с пулом потоков каждый проход (сборка SVG и растеризация) идёт в своём воркере; без пула — не больше двух сразу (память)
  await probeRaster();
  // сцена уходит в воркеры ссылкой на JSON в общей памяти (sharedScene): без копии строки на каждый проход
  const base = { shared: POOL ? sharedScene(scene) : null, scene: POOL ? null : scene, t, width, states, raw, raster: capabilities.png, candidates: capabilities.candidates };
  if (raw && rasterWanted() && !rasterFailed && await initRasterGPU()) {
    try { return await gpuPasses(scene, list, base); } catch (e) {
      rasterFailed = true;
      process.stderr.write(`[kontur] растеризатор GPU выключен, проходы — через resvg: ${e.message}
`);
    }
  }
  lastRaster = 'cpu';
  const run = (mode, solidOK) => {
    const local = async () => (await passTask({ ...base, scene, mode, solidOK })).result;
    // воркер не смог (сцена не переносится в JSON, упал воркер) — проход в главном потоке
    return task(import.meta.url, 'passTask', { ...base, mode, solidOK }, local).catch(local);
  };
  await mapLimit(list, POOL ? THREADS : 2, async (mode) => { out[mode] = await run(mode, list.length > 1); });
  // сплошные проходы (нет свечения, масок, контуров) не растеризовались: заливка фоном по размеру растеризованных
  const solid = list.filter((m) => out[m].solid);
  if (solid.length) {
    const ref = list.find((m) => !out[m].solid);
    const size = ref ? imageSize(out[ref], raw) : null;
    for (const m of solid) out[m] = size ? solidImage(size, out[m].solid, raw) : await run(m, false);
  }
  if (!raw) for (const m of list) out[m] = Buffer.from(out[m].buffer, out[m].byteOffset, out[m].byteLength);
  return out;
}
/* ---------- растеризатор проходов на видеокарте (KONTUR_GPU=raster, прототип) ---------- */
/** Сверхвыборка сглаженных проходов (цель ss× крупнее; вместе с MSAA 4× — ss²·4 выборок на пиксель). */
const RASTER_SS = Math.max(1, Math.min(4, +(process.env.KONTUR_RASTER_SS || 2) | 0));
let rasterFailed = false, lastRaster = 'cpu';
/** Чем растеризованы проходы последнего кадра: 'gpu' | 'cpu' (для stats). */
export const lastPassRaster = () => lastRaster;
/**
 * Проходы на видеокарте: вычисление сцены и геометрия (контуры, треугольники) — в воркерах пула параллельно,
 * растеризация — на GPU по очереди, по мере готовности геометрии. Результат — RGBA, как у svgToRGBA.
 */
async function gpuPasses(scene, list, base) {
  const out = {}, geoms = {};
  // сначала геометрия всех проходов (воркеры), затем растеризация по очереди: ожидание mapAsync в Dawn не должно
  // пересекаться с приёмом сообщений воркеров: при наложении процесс падал в Dawn (0xC0000005 / 0xC0000409, раз в 10–30
  // кадров); так — 120 кадров подряд без падений
  await mapLimit(list, POOL ? THREADS : 2, async (mode) => {
    const local = async () => (await geomTask({ ...base, scene, mode, ss: RASTER_SS })).result;
    geoms[mode] = await task(import.meta.url, 'geomTask', { ...base, mode, ss: RASTER_SS }, local).catch(local);
  });
  const layers = Object.fromEntries(await Promise.all(list.map(async (m) => [m, await renderLayers(geoms[m].layers, geoms[m].width, geoms[m].height)])));
  for (const mode of list) out[mode] = await rasterize(geoms[mode], layers[mode], { aa: geoms[mode].aa });
  lastRaster = 'gpu';
  return out;
}
/** Геометрия прохода mode для растеризатора GPU (raster-geom.mjs). Задача воркера пула. */
export async function geomTask({ scene, shared, t, width, states, mode, ss }) {
  if (!scene) scene = sceneOf(shared);
  let tree = evaluate(scene, t, { width, states, mode: mode === 'color' ? undefined : mode, cache: true });
  const bg = mode === 'color' ? null : modeInfo(mode).bg;
  if (bg) tree = dropUnderBg(tree, bg).tree;
  const crisp = tree.attrs['shape-rendering'] === 'crispEdges';
  const g = treeToGeometry(tree, { ss: crisp ? 1 : ss });
  g.aa = !crisp;
  return { result: g, transfer: [g.verts.buffer, g.items.buffer, g.paints.buffer, g.stops.buffer] };
}

/** Размер прохода: RGBA-картинки или PNG (заголовок IHDR). */
const imageSize = (im, raw) => (raw ? { width: im.width, height: im.height } : { width: readU32(im, 16), height: readU32(im, 20) });
const readU32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
/** Картинка цвета css (непрозрачная): RGBA или PNG. */
function solidImage({ width, height }, css, raw) {
  const [r, g, b] = parseColor(css).map((v) => Math.round(v * 255));
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; }
  const im = { width, height, data };
  return raw ? im : new Uint8Array(encodePNG(im));
}

/**
 * Разобранная сцена воркера: та же строка JSON (следующий кадр той же сцены) — тот же объект, а с ним и кэши движка
 * (статичные поддеревья, пути, поверхности) живут между кадрами. Сравнение строк дешевле повторного JSON.parse.
 */
let parsed = { id: null, scene: null };
function sceneOf({ id, sab }) {
  if (parsed.id !== id) parsed = { id, scene: JSON.parse(Buffer.from(sab).toString('utf8')) };
  return parsed.scene;
}
let sharedSerial = 0;
/**
 * Сцена для воркеров: JSON один раз на версию сцены (sceneMemo — до invalidate) в общей памяти. Задачи проходов
 * получают ссылку, а не копию строки (14 МБ × 9 проходов на кадр), воркер разбирает сцену только при новом id.
 */
const sharedScene = (scene) => sceneMemo(scene, 'shared', () => {
  const json = JSON.stringify(scene), sab = new SharedArrayBuffer(Buffer.byteLength(json));
  Buffer.from(sab).write(json, 'utf8');
  return { id: `${process.pid}:${++sharedSerial}`, sab };
});
/** Один проход: SVG сцены в режиме mode → RGBA { width, height, data } (raw) или PNG-байты. Задача воркера пула. */
export async function passTask({ scene, shared, t, width, states, raw, mode, raster, candidates, solidOK = false }) {
  adoptRaster(raster, candidates);
  if (!scene) scene = sceneOf(shared);
  // cache: статичные поддеревья берутся из кэша кадра во всех режимах (сцена меняется только через invalidate)
  let tree = evaluate(scene, t, { width, states, mode: mode === 'color' ? undefined : mode, cache: true });
  // у проходов с фоном нарисованное цветом фона под всем остальным невидимо — не растеризуется; проход одного цвета
  // не растеризуется вовсе: { solid } — renderPasses зальёт его по размеру остальных
  const bg = mode === 'color' ? null : modeInfo(mode).bg;
  if (bg) {
    const r = dropUnderBg(tree, bg);
    if (solidOK && r.solid) return { result: { solid: bg } };
    tree = r.tree;
  }
  const svg = treeToString(tree);
  if (raw) {
    const im = await svgToRGBA(svg, width);
    return { result: im, transfer: im.data.byteOffset === 0 && im.data.byteLength === im.data.buffer.byteLength ? [im.data.buffer] : [] };
  }
  const png = new Uint8Array(await svgToPng(svg, width));
  return { result: png, transfer: [png.buffer] };
}

/** Для stats: { gpu: имя адаптера } или { gpu: false, gpuError } (только если KONTUR_GPU включён). */
function gpuStats() {
  const g = gpuInfo();
  if (!g.wanted.length) return {};
  return g.adapter && !g.failure ? { gpu: g.adapter.device, gpuStages: g.wanted } : { gpu: false, gpuError: g.failure || 'нет адаптера' };
}

/**
 * res.png — PNG картинки res.image, кодируется при первом обращении: тем, кому нужна только картинка (слои, видео
 * в ffmpeg), сжатие не стоит ничего. level — уровень deflate (opts.pngLevel; для кадров видео хватает 1).
 */
function lazyPNG(res, level) {
  return Object.defineProperty(res, 'png', { enumerable: true, configurable: true, get() {
    const png = encodePNG(res.image, { level: level ?? 6 });
    Object.defineProperty(res, 'png', { value: png, enumerable: true, writable: true });
    return png;
  } });
}

/* ============================== кадр ============================== */
/**
 * Кадр с отложенным светом. Возвращает { png, image, debug? (PNG листа «цвет / нормали / тени+AO / итог»), shadowAO?, stats }.
 * opts: width, states, lighting (поверх scene.lighting), style (поверх scene.style), debug, debugWidth, passes (готовые
 * проходы: PNG или RGBA), baseDir (относительные пути текстур, LUT, карт высот, референса), bake: 'albedo'.
 */
export async function renderLit(scene, t = 0, opts = {}) {
  // резидентные буферы GPU и арена полей — на кадр (поля, ушедшие в результат, из арены не берутся)
  const arena = frameArena();
  try { return await litFrame(scene, t, opts, arena); } finally { gpuReleaseResident(); arena.release(); }
}
async function litFrame(scene, t, opts, arena) {
  const t0 = Date.now();
  if (!scene.camera3d) throw new Error('Отложенный свет требует scene.camera3d (camera3d_set): без камеры позиции пикселей не восстановить.');
  // карты высот → нормали: производная сцена одна на версию сцены (иначе каждый кадр — новый объект без кэшей)
  scene = sceneMemo(scene, `h2n|${opts.baseDir || ''}`, (s) => heightToNormalSrc(s, opts.baseDir));
  const W0 = scene.width, H0 = scene.height;
  const W = Math.max(16, Math.round(opts.width ?? W0)), H = Math.max(9, Math.round((W * H0) / W0)), n = W * H;
  const st = resolveLighting(scene, opts.lighting);
  const style = resolveStyle(scene, opts.style);
  const chrTag = st.characters.tag;
  const mats = needsMatId(scene) ? prepareMaterials(scene) : [];
  warm(KERNEL_MODS); // воркеры пула стартуют и грузят этапы, пока идут проходы
  const gpuReady = initGPU(); // KONTUR_GPU: устройство поднимается параллельно с проходами
  const pngs = opts.passes || await renderPasses(scene, t, { width: W, states: opts.states, masks: [chrTag], raw: true });
  await gpuReady;
  const tPass = Date.now();
  const { stages, lap } = stageTimer();

  // ---------- G-буфер ----------
  const G = buildGBuffer(scene, pngs, { W, H, chrTag, withMatId: mats.length > 0, arena });
  const { mask, alb, mid } = G;
  gpuResident(G.Px, G.Py, G.Pz, G.PNx, G.PNy, G.PNz, G.Dp, mask); // до конца кадра не меняются
  lap('positions');

  // ---------- окклюдеры ----------
  // окклюдеры — статичные свойства (не анимируются): BVH один на версию сцены, а не на кадр
  const { occ, bvh } = sceneMemo(scene, 'bvh', (s) => { const occ = occluders(s); return { occ, bvh: occ.boxes.length + occ.tris.length > 0 ? buildBVH(occ) : null }; });
  lap('bvh');

  // ---------- тени солнца ----------
  let shadow, rays = 0;
  if (opts.bake) shadow = new Float32Array(n).fill(1); // запекание альбедо: тени не нужны
  else ({ shadow, rays } = sunShadows(G, st.sun, bvh));
  let contact = null;
  if (st.contactShadows && !opts.bake && st.sun.shadows !== false) {
    contact = contactShadows(G, st.sun.dir, st.contactShadows);
    if (contact) for (let i = 0; i < n; i++) shadow[i] *= contact[i];
  }
  lap('sun');

  // ---------- окклюзия окружения ----------
  const AO = ambientOcclusion(G, st.ao);
  const ao = AO.ao;
  lap('ao');

  // ---------- альбедо и попиксельные материалы ----------
  const lin = arena.f32(n * 3, false); // заполняется целиком ниже
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) lin[i * 3 + c] = LIN8[alb[i * 4 + c]];
  let matPixels = 0;
  // textureFilter: false — фактуры одной точкой на пиксель, как до фильтрации (вдали возможен муар)
  if (mid) matPixels = applyMaterials(mats, { W, H, mid, lin, Nx: G.Nx, Ny: G.Ny, Nz: G.Nz, PNx: G.PNx, PNy: G.PNy, PNz: G.PNz, Px: G.Px, Py: G.Py, Pz: G.Pz, ao, baseDir: opts.baseDir, filter: st.textureFilter !== false });
  // материалы меняют нормали на месте; дальше они не меняются
  forgetHalf(G, G.Nx, G.Ny, G.Nz);
  gpuResident(G.Nx, G.Ny, G.Nz);
  lap('materials');
  if (opts.bake === 'albedo') {
    // альбедо с попиксельными материалами (для экспорта слоёв): цвет прохода color, где материала нет
    const data = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      for (let c = 0; c < 3; c++) data[o + c] = mid && mid[i] ? byte01(Math.pow(lin[i * 3 + c], 1 / 2.2)) : alb[o + c];
      data[o + 3] = alb[o + 3];
    }
    const image = { width: W, height: H, data };
    return lazyPNG({ image, stats: { width: W, height: H, materials: mats.length, matPixels, ms: Date.now() - t0 } }, opts.pngLevel);
  }

  // ---------- освещение поверхности ----------
  const direct = sunDirect(G, st, shadow, style.find((s) => s.type === 'cel'));
  const ambient = ambientFn(G, st, AO, lin);
  const sh = shadeSurface(G, st, { direct, ambient, bvh, scene, t, states: opts.states, separateLamps: !!st.paint });
  rays += sh.rays;
  lap('shade');
  if (st.gi && st.gi.strength > 0) { screenGI(G, st.gi, { light: sh.light, lampL: sh.lampL, lin, ao, ambient }); lap('gi'); }

  // ---------- сборка HDR ----------
  const { col, emL } = composeSurface(G, st, { light: sh.light, lampL: sh.lampL, specT: sh.specT, lin });
  composeSky(G, st, col, lin);
  lap('compose');
  let ssrPixels = 0;
  if (st.reflections && st.reflections.strength > 0) { ssrPixels = screenReflections(G, st.reflections, col); lap('ssr'); }
  const V = st.volumetric;
  if (V) { rays += volumetricLight(G, st, V, { col, lights: sh.lights, bvh }); lap('volumetric'); }

  // ---------- HDR-постобработка ----------
  let dofInfo = null, aeInfo = null;
  if (st.dof) { dofInfo = depthOfField(G, st.dof, col); lap('dof'); }
  if ((st.bloom?.strength ?? 0) > 0) bloom(G, col, emL, st.bloom.strength, st.bloom?.threshold ?? 0.9);
  if (st.autoExposure) aeInfo = autoExposure(G, st.autoExposure, col);
  const { img, tonemap: tmo } = tonemapFrame(col, n, { exposure: (st.exposure ?? 1) * (aeInfo ? aeInfo.k : 1), tonemap: st.tonemap, saturation: st.saturation ?? 1 });
  if (st.grade?.matchRef) matchPalette(img, n, await loadRefStats(st.grade.matchRef.src, opts.baseDir), st.grade.matchRef);
  if (st.grade) applyGrade(st.grade, img, n, opts.baseDir);
  lap('post');

  // ---------- стиль ----------
  let out = img;
  const sctx = { W, H, W0, mask, chm: G.chm, inkL: G.inkL, alb, Dp: G.Dp, coc: dofInfo?.coc || null };
  for (const s of style) out = applyStyle(s, out, sctx);
  lap('style');

  const image = { width: W, height: H, data: rgbToRGBA(out, n) };
  const P = st.paint, AE = st.aerial, sunAngle = Math.max(0, st.sun.angle || 0);
  const res = lazyPNG({ image, stats: { width: W, height: H, preset: st.preset, style: style.map((s) => s.type), lights: sh.lights.length, litLights: sh.litCount, boxes: occ.boxes.length, tris: occ.tris.length, rays,
    ...(sunAngle > 0 ? { sunAngle } : {}), ...(mats.length ? { materials: mats.length, matPixels } : {}), ...(st.gi ? { gi: true } : {}), ...(V ? { volumetric: true } : {}), ...(st.reflections ? { ssrPixels } : {}),
    ...(P ? { paint: true } : {}), ...(AE ? { aerial: true } : {}), ...(tmo ? { tonemap: tmo } : {}), ...(st.grade?.matchRef ? { matchRef: st.grade.matchRef.src } : {}),
    ...(st.ao?.mode === 'gtao' ? { ao: 'gtao' } : {}), ...(contact ? { contactShadows: true } : {}), ...(st.gi?.bounces > 1 ? { giBounces: st.gi.bounces } : {}),
    ...(dofInfo ? { dofFocus: +dofInfo.focus.toFixed(2) } : {}), ...(aeInfo ? { autoExposure: +aeInfo.k.toFixed(3) } : {}),
    ...gpuStats(), ...(lastRaster === 'gpu' && !opts.passes ? { raster: 'gpu' } : {}), effects: effectsSummary(st), passMs: tPass - t0, stageMs: stages, ms: Date.now() - t0 } }, opts.pngLevel);
  if (opts.debug) {
    const so = grayToRGBA(n, (i) => shadow[i] * ao[i]);
    const cell = Math.min(W, opts.debugWidth || 960);
    const im = (d) => scaleDown(d, cell);
    const top = sideBySide([im(G.imgOf('color')), im(G.imgOf('normal'))]), bot = sideBySide([im({ width: W, height: H, data: so }), im(image)]);
    res.shadowAO = { width: W, height: H, data: so };
    // отдельно AO (без тени солнца): видно, что даёт GTAO против SSAO
    res.aoMap = { width: W, height: H, data: grayToRGBA(n, (i) => ao[i]) };
    res.debug = encodePNG(stackV([top, bot]));
  }
  return res;
}
