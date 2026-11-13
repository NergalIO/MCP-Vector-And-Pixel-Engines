// Растеризатор проходов на видеокарте (прототип, KONTUR_GPU=raster): геометрия из raster-geom.mjs → WebGPU.
// Каждый предмет — stencil-then-cover: веер треугольников пути считает число обходов в трафарете (nonzero —
// инкремент/декремент по стороне, evenodd — инверсия, обводка — «покрыто хоть раз»), затем прямоугольник по рамке
// предмета красит пиксели с ненулевым трафаретом и тут же его обнуляет. Порядок художника сохраняется.
// Сглаживание: MSAA 4× и сверхвыборка ss (цель ss× крупнее, затем среднее блока); проходы данных (crispEdges) —
// без сглаживания, одна выборка в центре пикселя, как у resvg. Цвета в цели — с умножением на альфу (как у resvg),
// на выходе — без (demultiply, как svgToRGBA). Запасные слои (текст и пр.) растеризует resvg, видеокарта кладёт их
// на место в порядке художника.
import { softwareAdapter } from './gpu.mjs';
import { svgToPremul } from '../render.mjs';
import { ITEM_F, PAINT_F, VERT_F, K_LAYER, K_DIRECT } from './raster-geom.mjs';

const keep = {};
let device = null, failure = null, initP = null;
const pipes = new Map();

/** Поднять устройство (один раз). Возвращает { device: имя } или null (причина — rasterGPUInfo().failure). */
export function initRasterGPU() {
  if (initP) return initP;
  initP = (async () => {
    try {
      const { create, globals } = await import('webgpu');
      Object.assign(globalThis, globals);
      keep.gpu = create([]);
      keep.adapter = await keep.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!keep.adapter) throw new Error('нет адаптера WebGPU');
      if (softwareAdapter(keep.adapter)) throw new Error('программный адаптер');
      const L = keep.adapter.limits;
      device = await keep.adapter.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: L.maxStorageBufferBindingSize, maxBufferSize: L.maxBufferSize } });
      keep.device = device;
      device.lost.then((e) => { failure = `устройство потеряно: ${e?.message || ''}`; device = null; });
      return { device: keep.adapter.info?.device || keep.adapter.info?.description || '?' };
    } catch (e) { failure = e.message; return null; }
  })();
  return initP;
}
export const rasterGPUInfo = () => ({ ready: !!device, failure, adapter: keep.adapter?.info?.device });

const WGSL = /* wgsl */ `
struct Item { a: vec4f, b: vec4f, c: vec4f };
@group(0) @binding(0) var<storage, read> items: array<Item>;
@group(0) @binding(1) var<storage, read> paints: array<vec4f>;
@group(0) @binding(2) var<storage, read> stops: array<vec4f>;
@group(0) @binding(3) var<uniform> U: vec4f; // ширина и высота цели, ss
@group(1) @binding(0) var layerTex: texture_2d<f32>;

fn clip(p: vec2f) -> vec4f { return vec4f(p.x / U.x * 2.0 - 1.0, 1.0 - p.y / U.y * 2.0, 0.0, 1.0); }

@vertex fn vsPath(@location(0) p: vec2f) -> @builtin(position) vec4f { return clip(p); }
@fragment fn fsNone() -> @location(0) vec4f { return vec4f(0.0); }

struct CovOut { @builtin(position) pos: vec4f, @location(0) @interpolate(flat) item: u32 };
@vertex fn vsCover(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> CovOut {
  let b = items[ii].b;
  var c = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
  let k = c[vi];
  var o: CovOut;
  o.pos = clip(vec2f(mix(b.x, b.z, k.x), mix(b.y, b.w, k.y)));
  o.item = ii;
  return o;
}

fn grad(off: u32, n: u32, t: f32) -> vec4f {
  if (n == 0u) { return vec4f(0.0); }
  var prev = stops[off * 2u + 1u];
  var po = stops[off * 2u].x;
  if (t <= po) { return prev; }
  for (var i = 1u; i < n; i++) {
    let o = stops[(off + i) * 2u].x;
    let c = stops[(off + i) * 2u + 1u];
    if (t <= o) {
      if (o <= po) { return c; }
      return mix(prev, c, (t - po) / (o - po));
    }
    prev = c; po = o;
  }
  return prev;
}

@vertex fn vsDirect(@location(0) p: vec2f, @location(1) item: f32) -> CovOut {
  var o: CovOut; o.pos = clip(p); o.item = u32(item); return o;
}

@fragment fn fsCover(in: CovOut) -> @location(0) vec4f {
  let it = items[in.item];
  let pi = u32(it.a.w) * ${PAINT_F / 4}u;
  let h = paints[pi];
  var col = paints[pi + 1u];
  let kind = u32(h.x);
  if (kind != 0u) {
    let m0 = paints[pi + 2u]; let m1 = paints[pi + 3u]; let g = paints[pi + 4u];
    let q = in.pos.xy;
    let p = vec2f(m0.x * q.x + m0.z * q.y + m1.x, m0.y * q.x + m0.w * q.y + m1.y);
    var t = 0.0;
    if (kind == 1u) {
      let d = g.zw - g.xy;
      t = dot(p - g.xy, d) / max(dot(d, d), 1e-12);
    } else {
      let f = paints[pi + 5u].xy;
      let cd = g.xy - f; let d = p - f; let r = g.z;
      let a = dot(cd, cd) - r * r;
      let b = dot(d, cd);
      if (abs(a) < 1e-6) { t = dot(d, d) / max(2.0 * b, 1e-12); }
      else { t = (b - sqrt(max(b * b - a * dot(d, d), 0.0))) / a; }
    }
    col = grad(u32(h.y), u32(h.z), clamp(t, 0.0, 1.0));
  }
  let al = col.a * h.w;
  return vec4f(col.rgb * al, al);
}

struct FullOut { @builtin(position) pos: vec4f };
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> FullOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: FullOut; o.pos = vec4f(p[vi], 0.0, 1.0); return o;
}
// запасной слой (resvg, выходное разрешение, с умножением на альфу, обрезан по рамке: начало — c.zw) — поверх цели
@fragment fn fsLayer(in: CovOut) -> @location(0) vec4f {
  let c = items[in.item].c;
  return textureLoad(layerTex, vec2i(in.pos.xy / U.z) - vec2i(c.zw), 0);
}
// среднее блока ss×ss разрешённой цели → выход
@fragment fn fsDown(in: FullOut) -> @location(0) vec4f {
  let s = i32(U.z);
  let o = vec2i(in.pos.xy) * s;
  var acc = vec4f(0.0);
  for (var y = 0; y < s; y++) { for (var x = 0; x < s; x++) { acc += textureLoad(layerTex, o + vec2i(x, y), 0); } }
  return acc / f32(s * s);
}
`;

function pipelines(samples) {
  if (pipes.has(samples)) return pipes.get(samples);
  const mod = device.createShaderModule({ code: WGSL });
  const V = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  const bgl0 = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: V, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: V, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: V, buffer: { type: 'uniform' } },
  ] });
  const bgl1 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl0, bgl1] });
  const fmt = 'rgba8unorm';
  const over = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  const lighten = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' } };
  const ds = (front, back = front) => ({ format: 'stencil8', depthWriteEnabled: false, depthCompare: 'always', stencilFront: front, stencilBack: back, stencilReadMask: 0xff, stencilWriteMask: 0xff });
  const op = (passOp, compare = 'always') => ({ compare, passOp, failOp: 'keep', depthFailOp: 'keep' });
  const prim = { topology: 'triangle-list', cullMode: 'none' };
  const ms = { count: samples };
  const pathV = { module: mod, entryPoint: 'vsPath', buffers: [{ arrayStride: VERT_F * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] };
  const directV = { module: mod, entryPoint: 'vsDirect', buffers: [{ arrayStride: VERT_F * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32' }] }] };
  const direct = (blend) => device.createRenderPipeline({ layout, vertex: directV, fragment: { module: mod, entryPoint: 'fsCover', targets: [{ format: fmt, blend }] }, primitive: prim, depthStencil: ds(op('keep')), multisample: ms });
  const stencil = (front, back) => device.createRenderPipeline({ layout, vertex: pathV, fragment: { module: mod, entryPoint: 'fsNone', targets: [{ format: fmt, writeMask: 0 }] }, primitive: prim, depthStencil: ds(front, back), multisample: ms });
  const cover = (blend) => device.createRenderPipeline({ layout, vertex: { module: mod, entryPoint: 'vsCover' }, fragment: { module: mod, entryPoint: 'fsCover', targets: [{ format: fmt, blend }] }, primitive: prim, depthStencil: ds(op('zero', 'not-equal')), multisample: ms });
  const p = {
    bgl0, bgl1,
    st: [stencil(op('increment-wrap'), op('decrement-wrap')), stencil(op('invert')), stencil(op('increment-clamp'))],
    cov: [cover(over), cover(lighten)],
    dir: [direct(over), direct(lighten)],
    layer: device.createRenderPipeline({ layout, vertex: { module: mod, entryPoint: 'vsCover' }, fragment: { module: mod, entryPoint: 'fsLayer', targets: [{ format: fmt, blend: over }] }, primitive: prim, depthStencil: ds(op('keep')), multisample: ms }),
    down: device.createRenderPipeline({ layout, vertex: { module: mod, entryPoint: 'vsFull' }, fragment: { module: mod, entryPoint: 'fsDown', targets: [{ format: fmt }] }, primitive: prim }),
  };
  pipes.set(samples, p);
  return p;
}

const storage = (arr) => {
  const b = device.createBuffer({ size: Math.max(16, Math.ceil(arr.byteLength / 4) * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  if (arr.byteLength) device.queue.writeBuffer(b, 0, arr.buffer, arr.byteOffset, arr.byteLength);
  return b;
};
const tex = (w, h, usage, samples = 1) => device.createTexture({ size: [w, h], format: 'rgba8unorm', usage, sampleCount: samples });

/**
 * Геометрия → RGBA { width, height, data } без умножения на альфу. layers — картинки запасных слоёв по номеру
 * ({ x, y, width, height, pixels } в пикселях выхода, с умножением на альфу; null — пустой слой), см. renderLayers.
 * aa: true — MSAA 4× (и сверхвыборка geom.ss), false — одна выборка (crispEdges).
 */
export async function rasterize(geom, layers = [], { aa = true } = {}) {
  if (!device) throw new Error(`растеризатор GPU недоступен: ${failure || 'не запущен'}`);
  const { width: W, height: H, ss } = geom;
  const TW = W * ss, TH = H * ss, samples = aa ? 4 : 1;
  const tA = performance.now();
  const P = pipelines(samples);
  const free = [];
  const keepB = (b) => (free.push(b), b);
  const items = geom.items.slice();
  for (let o = 0; o < items.length; o += ITEM_F) {
    if (items[o] !== K_LAYER) continue;
    const L = layers[items[o + 9]];
    if (!L) continue;
    items.set([L.x * ss, L.y * ss, (L.x + L.width) * ss, (L.y + L.height) * ss], o + 4);
    items[o + 10] = L.x; items[o + 11] = L.y;
  }
  const vb = keepB(storage(geom.verts)), ib = keepB(storage(items)), pb = keepB(storage(geom.paints)), sb = keepB(storage(geom.stops));
  const ub = keepB(device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
  device.queue.writeBuffer(ub, 0, new Float32Array([TW, TH, ss, 0]));
  const bg0 = device.createBindGroup({ layout: P.bgl0, entries: [ib, pb, sb, ub].map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const T = GPUTextureUsage;
  const dummy = keepB(tex(1, 1, T.TEXTURE_BINDING));
  const bgDummy = device.createBindGroup({ layout: P.bgl1, entries: [{ binding: 0, resource: dummy.createView() }] });
  const layerBG = layers.map((im) => {
    if (!im) return bgDummy;
    const t = keepB(tex(im.width, im.height, T.TEXTURE_BINDING | T.COPY_DST));
    device.queue.writeTexture({ texture: t }, im.pixels, { bytesPerRow: im.width * 4 }, [im.width, im.height]);
    return device.createBindGroup({ layout: P.bgl1, entries: [{ binding: 0, resource: t.createView() }] });
  });

  const target = keepB(tex(TW, TH, T.RENDER_ATTACHMENT | T.TEXTURE_BINDING | (samples > 1 ? 0 : T.COPY_SRC), samples));
  const resolved = samples > 1 ? keepB(tex(TW, TH, T.RENDER_ATTACHMENT | T.TEXTURE_BINDING | T.COPY_SRC)) : null;
  const stencilTex = keepB(device.createTexture({ size: [TW, TH], format: 'stencil8', usage: T.RENDER_ATTACHMENT, sampleCount: samples }));
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({
    colorAttachments: [{ view: target.createView(), resolveTarget: resolved?.createView(), clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }],
    depthStencilAttachment: { view: stencilTex.createView(), stencilClearValue: 0, stencilLoadOp: 'clear', stencilStoreOp: 'discard' },
  });
  pass.setBindGroup(0, bg0);
  pass.setBindGroup(1, bgDummy);
  pass.setVertexBuffer(0, vb);
  const it = geom.items, n = it.length / ITEM_F;
  let cur = null, draws = 0;
  const use = (p) => { if (p !== cur) { pass.setPipeline(p); cur = p; } };
  for (let i = 0; i < n; i++) {
    const o = i * ITEM_F, kind = it[o];
    if (kind === K_DIRECT) {
      // подряд идущие прямые предметы с тем же смешиванием — один вызов (вершины у них идут подряд)
      const blend = it[o + 8], v0 = it[o + 1];
      let v1 = v0 + it[o + 2];
      while (i + 1 < n && it[(i + 1) * ITEM_F] === K_DIRECT && it[(i + 1) * ITEM_F + 8] === blend) { i++; v1 = it[i * ITEM_F + 1] + it[i * ITEM_F + 2]; }
      use(P.dir[blend]); pass.draw(v1 - v0, 1, v0, 0); draws++;
      continue;
    }
    draws++;
    if (kind === K_LAYER) {
      if (!layers[it[o + 9]]) continue;
      use(P.layer); pass.setBindGroup(1, layerBG[it[o + 9]]); pass.draw(6, 1, 0, i); pass.setBindGroup(1, bgDummy);
      continue;
    }
    use(P.st[kind]); pass.draw(it[o + 2], 1, it[o + 1], 0);
    use(P.cov[it[o + 8]]); pass.draw(6, 1, 0, i);
  }
  pass.end();
  const tB = performance.now();
  // выход W×H: среднее блока ss×ss (или сама цель при ss = 1)
  let out = resolved || target;
  if (ss > 1) {
    out = keepB(tex(W, H, T.RENDER_ATTACHMENT | T.COPY_SRC));
    const bgR = device.createBindGroup({ layout: P.bgl1, entries: [{ binding: 0, resource: resolved.createView() }] });
    const dp = enc.beginRenderPass({ colorAttachments: [{ view: out.createView(), loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] });
    dp.setPipeline(P.down); dp.setBindGroup(0, bg0); dp.setBindGroup(1, bgR); dp.draw(3); dp.end();
  }
  const bpr = Math.ceil((W * 4) / 256) * 256;
  const rb = keepB(device.createBuffer({ size: bpr * H, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
  enc.copyTextureToBuffer({ texture: out }, { buffer: rb, bytesPerRow: bpr }, [W, H]);
  device.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const tC = performance.now();
  const src = new Uint8Array(rb.getMappedRange());
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const r = y * bpr, w = y * W * 4;
    for (let x = 0; x < W * 4; x += 4) {
      const a = src[r + x + 3];
      data[w + x + 3] = a;
      if (a === 255) { data[w + x] = src[r + x]; data[w + x + 1] = src[r + x + 1]; data[w + x + 2] = src[r + x + 2]; }
      else if (a) { const k = a / 255; for (let c = 0; c < 3; c++) data[w + x + c] = Math.min(255, Math.floor(src[r + x + c] / k + 0.5)); }
    }
  }
  rb.unmap();
  for (const b of free) b.destroy();
  const tD = performance.now();
  return { width: W, height: H, data, draws, ms: { encode: Math.round(tB - tA), gpu: Math.round(tC - tB), readback: Math.round(tD - tC) } };
}

/**
 * Запасные слои прохода (SVG-документы одного размера) → [{ x, y, width, height, pixels } | null]: все слои одним
 * вызовом resvg (страницы друг под другом — системные шрифты грузятся один раз), каждая страница обрезается по
 * непрозрачной рамке. Результат кэшируется по набору слоёв (статичный текст — один раз на процесс).
 */
const layerCache = new Map();
export async function renderLayers(svgs, W, H) {
  if (!svgs.length) return [];
  const key = svgs.join('\0');
  if (layerCache.has(key)) return layerCache.get(key);
  // x/y вложенного <svg> resvg не сдвигает — страница сдвигается группой
  const pages = svgs.map((svg, k) => `<g transform="translate(0 ${k * H})">${svg}</g>`).join('');
  const sheet = await svgToPremul(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H * svgs.length}" viewBox="0 0 ${W} ${H * svgs.length}">${pages}</svg>`, W);
  if (!sheet) throw new Error('запасные слои растеризатора GPU требуют @resvg/resvg-js');
  const px = sheet.pixels, out = [];
  for (let k = 0; k < svgs.length; k++) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      const row = (k * H + y) * W * 4;
      for (let x = 0; x < W; x++) if (px[row + x * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
    }
    if (x1 < 0) { out.push(null); continue; }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, pixels = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) pixels.set(px.subarray(((k * H + y0 + y) * W + x0) * 4, ((k * H + y0 + y) * W + x1 + 1) * 4), y * w * 4);
    out.push({ x: x0, y: y0, width: w, height: h, pixels });
  }
  if (layerCache.size > 64) layerCache.clear();
  layerCache.set(key, out);
  return out;
}
