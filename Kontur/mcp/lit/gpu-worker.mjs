// GPU-поток отложенного света (mcp/lit/gpu.mjs): владеет устройством WebGPU (Dawn, пакет webgpu) и выполняет задания —
// загрузка массивов из общей памяти, цепочка compute-проходов, чтение результатов обратно в общую память.
// Главный поток ждёт ответа через Atomics.wait, поэтому для этапов вызов синхронный.
import { parentPort } from 'node:worker_threads';
import { softwareAdapter } from './gpu.mjs';

// Экземпляр Dawn и адаптер держим ссылками: если сборщик мусора заберёт их обёртки, живое устройство роняет процесс.
const keep = {};
let device = null;
const modules = new Map(), pipelines = new Map();

async function init() {
  const { create, globals } = await import('webgpu');
  Object.assign(globalThis, globals);
  keep.gpu = create([]);
  keep.adapter = await keep.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!keep.adapter) throw new Error('нет адаптера WebGPU');
  if (softwareAdapter(keep.adapter)) throw new Error(`программный адаптер (${keep.adapter.info?.description || keep.adapter.info?.vendor || '?'}) — этапы на процессоре`);
  const L = keep.adapter.limits;
  device = await keep.adapter.requestDevice({ requiredLimits: {
    maxStorageBuffersPerShaderStage: Math.min(16, L.maxStorageBuffersPerShaderStage),
    maxStorageBufferBindingSize: L.maxStorageBufferBindingSize,
    maxBufferSize: L.maxBufferSize,
  } });
  keep.device = device;
  device.lost.then((e) => { device = null; parentPort.postMessage({ lost: String(e?.message || e?.reason || 'device lost') }); });
  const i = keep.adapter.info;
  return { vendor: i.vendor, device: i.device, description: i.description };
}

function pipeline(key, code, entry) {
  const pk = `${key}#${entry}`;
  let p = pipelines.get(pk);
  if (p) return p;
  let m = modules.get(key);
  if (!m) { m = device.createShaderModule({ code }); modules.set(key, m); }
  p = device.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint: entry } });
  pipelines.set(pk, p);
  return p;
}

const residentBufs = new Map(); // rid → { g, size } — резидентные входы кадра (gpu.mjs gpuResident)
const S = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
const pad4 = (n) => Math.max(16, Math.ceil(n / 4) * 4);

/**
 * Пул буферов GPU: задания одного кадра (и соседних кадров) просят буферы тех же размеров, поэтому буфер после
 * задания возвращается в пул по (вид, размер), а не уничтожается. Буфер из пула не обнулён — выходные буферы
 * ('out', временные) перед заданием заливаются нулями (clearBuffer на GPU), как новые. Лишнее сверх POOL_BYTES
 * уничтожается (самые давние).
 */
const POOL_BYTES = 768 << 20;
const free = new Map(); // `${kind}|${size}` → [GPUBuffer]
let freeBytes = 0;
const order = []; // [ключ, буфер, размер] в порядке возврата
const USAGE = { s: () => S(), u: () => GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, r: () => GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST };
function take(kind, size) {
  const list = free.get(`${kind}|${size}`);
  if (list && list.length) {
    const g = list.pop();
    freeBytes -= size;
    const i = order.findIndex((o) => o[1] === g);
    if (i >= 0) order.splice(i, 1);
    return { g, fresh: false };
  }
  return { g: device.createBuffer({ size, usage: USAGE[kind]() }), fresh: true };
}
function give(kind, size, g) {
  const k = `${kind}|${size}`;
  if (!free.has(k)) free.set(k, []);
  free.get(k).push(g);
  order.push([k, g, size]);
  freeBytes += size;
  while (freeBytes > POOL_BYTES && order.length) {
    const [ok, og, os] = order.shift();
    const l = free.get(ok);
    l.splice(l.indexOf(og), 1);
    freeBytes -= os;
    og.destroy();
  }
}

async function run(job) {
  const { key, code, bufs, passes } = job;
  const made = []; // [вид, размер, буфер] — в пул после задания
  const get = (kind, size) => { const r = take(kind, size); made.push([kind, size, r.g]); return r; };
  let ok = false;
  try {
    device.pushErrorScope('validation');
    device.pushErrorScope('out-of-memory');
    const enc = device.createCommandEncoder();
    const gb = bufs.map((b) => {
      const bytes = b.data ? b.data.byteLength : b.bytes;
      const size = pad4(bytes);
      if (b.rid) { const r = residentBufs.get(b.rid); if (r) return r.g; } // уже на GPU с прошлого этапа кадра
      const { g, fresh } = b.rid ? take('s', size) : get('s', size);
      if (b.rid) residentBufs.set(b.rid, { g, size }); // живёт до release, не возвращается в пул после задания
      if (b.data && b.up) {
        // загрузка — на весь буфер (хвост до размера нулями): буфер из пула со старыми данными так полностью перезаписан
        if (b.data.byteLength === size) device.queue.writeBuffer(g, 0, b.data);
        else { const t = new Uint8Array(size); t.set(new Uint8Array(b.data.buffer, b.data.byteOffset, b.data.byteLength)); device.queue.writeBuffer(g, 0, t); }
      } else if (!fresh) enc.clearBuffer(g, 0, size); // не загружается (выход, временный) — с нулей, как новый
      return g;
    });
    for (const p of passes) {
      const pipe = pipeline(p.key || key, p.code || code, p.entry); // проход может взять свой шейдер
      const entries = [];
      if (p.uni) {
        const { g: u } = get('u', pad4(p.uni.byteLength));
        device.queue.writeBuffer(u, 0, p.uni);
        entries.push({ binding: 0, resource: { buffer: u } });
      }
      p.bind.forEach((bi, k) => entries.push({ binding: k + 1, resource: { buffer: gb[bi] } }));
      const pass = enc.beginComputePass();
      pass.setPipeline(pipe);
      pass.setBindGroup(0, device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries }));
      pass.dispatchWorkgroups(...p.groups);
      pass.end();
    }
    const reads = [];
    bufs.forEach((b, i) => {
      if (!b.read) return;
      const { g: st } = get('r', pad4(b.data.byteLength));
      enc.copyBufferToBuffer(gb[i], 0, st, 0, pad4(b.data.byteLength));
      reads.push([st, b.data]);
    });
    device.queue.submit([enc.finish()]);
    // ошибки и чтение ждём вместе: каждое ожидание Dawn — круг опроса событий, последовательно они складывались
    const scopes = Promise.all([device.popErrorScope(), device.popErrorScope()]);
    const maps = Promise.allSettled(reads.map(([st]) => st.mapAsync(GPUMapMode.READ)));
    const [oom, val] = await scopes;
    if (val || oom) throw new Error((val || oom).message);
    for (const m of await maps) if (m.status === 'rejected') throw m.reason;
    for (const [st, data] of reads) {
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength).set(new Uint8Array(st.getMappedRange(), 0, data.byteLength));
      st.unmap();
    }
    ok = true;
  } finally {
    // после ошибки буферы могли остаться в неизвестном состоянии (staging замаплен) — их не возвращаем
    for (const [kind, size, g] of made) { if (ok) give(kind, size, g); else g.destroy(); }
  }
}

parentPort.on('message', async (msg) => {
  if (msg.type === 'init') {
    try { parentPort.postMessage({ ready: await init() }); } catch (e) { parentPort.postMessage({ failed: String(e?.message || e) }); }
    return;
  }
  if (msg.type === 'release') {
    for (const id of msg.ids) { const r = residentBufs.get(id); if (r) { residentBufs.delete(id); give('s', r.size, r.g); } }
    return;
  }
  const { ctrl, err } = msg;
  try {
    if (!device) throw new Error('устройство WebGPU потеряно');
    await run(msg);
    Atomics.store(ctrl, 0, 1);
  } catch (e) {
    err.set(new TextEncoder().encode(String(e?.message || e)).subarray(0, err.length));
    Atomics.store(ctrl, 0, 2);
  }
  Atomics.notify(ctrl, 0);
});
