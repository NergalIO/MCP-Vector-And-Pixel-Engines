// GPU-поток отложенного света (mcp/lit/gpu.mjs): владеет устройством WebGPU (Dawn, пакет webgpu) и выполняет задания —
// загрузка массивов из общей памяти, цепочка compute-проходов, чтение результатов обратно в общую память.
// Главный поток ждёт ответа через Atomics.wait, поэтому для этапов вызов синхронный.
import { parentPort } from 'node:worker_threads';

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

const S = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
const pad4 = (n) => Math.max(16, Math.ceil(n / 4) * 4);

async function run(job) {
  const { key, code, bufs, passes } = job;
  const made = [];
  try {
    device.pushErrorScope('validation');
    device.pushErrorScope('out-of-memory');
    const gb = bufs.map((b) => {
      const bytes = b.data ? b.data.byteLength : b.bytes;
      const g = device.createBuffer({ size: pad4(bytes), usage: S() });
      made.push(g);
      if (b.data && b.up && b.data.byteLength) {
        if (b.data.byteLength % 4) { const t = new Uint8Array(pad4(b.data.byteLength)); t.set(new Uint8Array(b.data.buffer, b.data.byteOffset, b.data.byteLength)); device.queue.writeBuffer(g, 0, t); }
        else device.queue.writeBuffer(g, 0, b.data);
      }
      return g;
    });
    const enc = device.createCommandEncoder();
    for (const p of passes) {
      const pipe = pipeline(key, code, p.entry);
      const entries = [];
      if (p.uni) {
        const u = device.createBuffer({ size: pad4(p.uni.byteLength), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        made.push(u);
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
      const st = device.createBuffer({ size: pad4(b.data.byteLength), usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      made.push(st);
      enc.copyBufferToBuffer(gb[i], 0, st, 0, pad4(b.data.byteLength));
      reads.push([st, b.data]);
    });
    device.queue.submit([enc.finish()]);
    const oom = await device.popErrorScope(), val = await device.popErrorScope();
    if (val || oom) throw new Error((val || oom).message);
    await Promise.all(reads.map(([st]) => st.mapAsync(GPUMapMode.READ)));
    for (const [st, data] of reads) {
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength).set(new Uint8Array(st.getMappedRange(), 0, data.byteLength));
      st.unmap();
    }
  } finally {
    for (const g of made) g.destroy();
  }
}

parentPort.on('message', async (msg) => {
  if (msg.type === 'init') {
    try { parentPort.postMessage({ ready: await init() }); } catch (e) { parentPort.postMessage({ failed: String(e?.message || e) }); }
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
