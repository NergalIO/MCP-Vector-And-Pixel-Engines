// Видеокарта для отложенного света (WebGPU через пакет webgpu — Dawn). Включается KONTUR_GPU:
//   1 / on / all — все перенесённые этапы; список через запятую (filters,ao,gi,sun,shade,lamps,materials,post,paint) — только они;
//   0 / пусто — выкл.
// Устройство живёт в отдельном потоке (gpu-worker.mjs); этап отдаёт задание и ждёт его через Atomics.wait, так что
// вызов синхронный, как у пула потоков. Нет пакета, нет адаптера или ошибка задания — этап считается на процессоре
// (после первой ошибки GPU выключается до конца процесса, причина — в gpuInfo()). GPU считает во float32: кадр
// отличается от процессорного в пределах округления (единицы уровней яркости у редких пикселей).
import { Worker, isMainThread } from 'node:worker_threads';
import { workerExecArgv } from './pool.mjs';

const STAGES = ['filters', 'ao', 'gi', 'sun', 'shade', 'lamps', 'materials', 'post', 'paint'];
const env = String(process.env.KONTUR_GPU ?? '').trim().toLowerCase();
const wanted = !isMainThread || !env || env === '0' || env === 'off' || env === 'false' ? new Set()
  : /^(1|on|all|true)$/.test(env) ? new Set(STAGES) : new Set(env.split(/[\s,]+/).filter((s) => STAGES.includes(s)));

/**
 * Программный адаптер (WARP «Microsoft Basic Render Driver», SwiftShader, llvmpipe — машины без видеокарты, CI):
 * он медленнее процессорного пути, а Dawn на нём падает целым процессом, поэтому такой адаптер не берём.
 */
export function softwareAdapter(adapter) {
  const i = adapter?.info || {};
  return !!(adapter?.isFallbackAdapter || i.isFallbackAdapter || /microsoft|basic render|warp|swiftshader|llvmpipe|lavapipe/i.test(`${i.vendor} ${i.architecture} ${i.device} ${i.description}`));
}

/** Меньше стольких пикселей — на процессоре (пересылка дороже счёта). */
export const GPU_MIN_PIXELS = 30000;

let worker = null, ready = null, info = null, failure = null;

/** Запустить GPU-поток (один раз). Возвращает сведения об адаптере или null. Вызывается до этапов (await). */
export function initGPU() {
  if (!wanted.size) return Promise.resolve(null);
  if (ready) return ready;
  ready = new Promise((resolve) => {
    try {
      worker = new Worker(new URL('./gpu-worker.mjs', import.meta.url), { execArgv: workerExecArgv() });
    } catch (e) { failure = `поток GPU: ${e.message}`; resolve(null); return; }
    worker.on('message', (m) => {
      if (m.ready) { info = m.ready; worker.unref(); resolve(info); }
      else if (m.failed) { failure = m.failed; worker.unref(); resolve(null); }
      else if (m.lost) failure = `устройство потеряно: ${m.lost}`;
    });
    worker.on('error', (e) => { failure = `поток GPU: ${e.message}`; worker.unref(); resolve(null); });
    worker.postMessage({ type: 'init' }); // пока идёт запуск, поток держит процесс (unref — после ответа)
  });
  return ready;
}

/** Этап stage считать на GPU (включён в KONTUR_GPU, устройство готово, не было ошибок)? n — число пикселей. */
export const gpuStage = (stage, n = Infinity) => !!info && !failure && wanted.has(stage) && n >= GPU_MIN_PIXELS;
/** Сведения: { wanted: [этапы], adapter, failure }. */
export const gpuInfo = () => ({ wanted: [...wanted], adapter: info, failure });

const SAB = SharedArrayBuffer;
/**
 * Выполнить задание на GPU синхронно. job: { key (кеш шейдера), code (WGSL),
 * bufs: [{ data: TypedArray, io?: 'in' | 'out' | 'inout' } | { bytes } (временный буфер только на GPU)],
 * passes: [{ entry, uni?: ArrayBuffer, bind: [номера bufs → binding 1, 2, …], groups: [x, y, z], key?, code? (свой шейдер прохода) }] }.
 * 'in' (по умолчанию) — только загрузить, 'out' — только прочитать обратно (буфер на GPU начинается с нулей),
 * 'inout' — и то и другое. Массивы не в общей памяти копируются туда (и обратно, если читаются).
 */
export function gpuExec({ key, code, bufs, passes }) {
  const back = [];
  const b2 = bufs.map((b) => {
    if (!b.data) return { bytes: b.bytes };
    const io = b.io || 'in', rd = io !== 'in';
    let d = b.data;
    if (!(d.buffer instanceof SAB)) { const s = new d.constructor(new SAB(Math.max(4, d.byteLength))).subarray(0, d.length); if (io !== 'out') s.set(d); if (rd) back.push([b.data, s]); d = s; }
    return { data: d, up: io !== 'out', read: rd };
  });
  const ctrl = new Int32Array(new SAB(4)), err = new Uint8Array(new SAB(1024));
  worker.ref();
  worker.postMessage({ ctrl, err, key, code, bufs: b2, passes });
  const r = Atomics.wait(ctrl, 0, 0, 120000);
  worker.unref();
  if (r === 'timed-out') { failure = `${key}: GPU не ответил за 2 минуты`; throw new Error(failure); }
  if (ctrl[0] === 2) { failure = `${key}: ${new TextDecoder().decode(err).replace(/\0+$/, '')}`; throw new Error(failure); }
  for (const [o, s] of back) o.set(s);
}

/**
 * Этап на GPU с запасным путём: gpu() — версия для видеокарты, cpu() — для процессора. Ошибка GPU пишется один раз
 * в stderr, дальше всё идёт на процессоре.
 */
export function viaGPU(stage, n, gpu, cpu) {
  if (!gpuStage(stage, n)) return cpu();
  try { return gpu(); } catch (e) {
    process.stderr.write(`[kontur] GPU выключен, этапы — на процессоре: ${e.message}\n`);
    failure = failure || e.message;
    return cpu();
  }
}

/** Упаковка uniform: поля по 4 байта подряд (u — u32, i — i32, f — f32), как структура WGSL из скаляров. */
export function uniforms(fields) {
  const n = Math.max(4, Math.ceil(fields.length / 4) * 4), dv = new DataView(new ArrayBuffer(n * 4));
  fields.forEach(([t, v], k) => { if (t === 'f') dv.setFloat32(k * 4, v, true); else if (t === 'i') dv.setInt32(k * 4, v | 0, true); else dv.setUint32(k * 4, v >>> 0, true); });
  return dv.buffer;
}
/** Число групп 16×16 на сетку w×h. */
export const groups2 = (w, h) => [Math.ceil(w / 16), Math.ceil(h / 16), 1];
