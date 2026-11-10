// Видеокарта для отложенного света (WebGPU через пакет webgpu — Dawn). Включается KONTUR_GPU:
//   1 / on / all — все перенесённые этапы; список через запятую (filters,ao,gi,sun,shade,lamps,materials,post,paint) — только они;
//   0 / пусто — выкл.
// Устройство живёт в отдельном потоке (gpu-worker.mjs); этап отдаёт задание и ждёт его через Atomics.wait, так что
// вызов синхронный, как у пула потоков. Нет пакета, нет адаптера или ошибка задания — этап считается на процессоре
// (после первой ошибки GPU выключается до конца процесса, причина — в gpuInfo()). GPU считает во float32: кадр
// отличается от процессорного в пределах округления (единицы уровней яркости у редких пикселей).
import { Worker, isMainThread } from 'node:worker_threads';
import { workerExecArgv, rows } from './pool.mjs';

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
 * passes: [{ entry, uni?: ArrayBuffer, bind?: [номера bufs → binding 1, 2, …] (по умолчанию все bufs по порядку), groups: [x, y, z], key?, code? (свой шейдер прохода) }] }.
 * 'in' (по умолчанию) — только загрузить, 'out' — только прочитать обратно (буфер на GPU начинается с нулей),
 * 'inout' — и то и другое. Массивы не в общей памяти копируются туда (и обратно, если читаются).
 */
export function gpuExec({ key, code, bufs, passes }) {
  const t0 = performance.now();
  try { gpuExecRaw({ key, code, bufs, passes }); } finally {
    const s = jobStats.get(key) || { n: 0, ms: 0 };
    s.n++; s.ms += performance.now() - t0;
    jobStats.set(key, s);
  }
}
const jobStats = new Map();
/** Время заданий GPU по ключам шейдеров с прошлого вызова: { key: { n, ms } } (и сброс). */
export function gpuJobStats() {
  const o = Object.fromEntries([...jobStats].map(([k, s]) => [k, { n: s.n, ms: Math.round(s.ms) }]));
  jobStats.clear();
  return o;
}
function gpuExecRaw({ key, code, bufs, passes }) {
  const back = [];
  const b2 = bufs.map((b) => {
    if (!b.data) return { bytes: b.bytes };
    const io = b.io || 'in', rd = io !== 'in';
    const res = resident.get(b.data);
    if (res && io === 'in') return { data: res.d, up: true, read: false, rid: res.rid };
    if (res) { resident.delete(b.data); worker.postMessage({ type: 'release', ids: [res.rid] }); } // массив меняется — больше не резидентный
    let d = b.data;
    if (!(d.buffer instanceof SAB)) { const s = new d.constructor(new SAB(Math.max(4, d.byteLength))).subarray(0, d.length); if (io !== 'out') s.set(d); if (rd) back.push([b.data, s]); d = s; }
    return { data: d, up: io !== 'out', read: rd };
  });
  const ctrl = new Int32Array(new SAB(4)), err = new Uint8Array(new SAB(1024));
  worker.ref();
  const all = bufs.map((_, k) => k);
  worker.postMessage({ ctrl, err, key, code, bufs: b2, passes: passes.map((p) => (p.bind ? p : { ...p, bind: all })) });
  const r = Atomics.wait(ctrl, 0, 0, 120000);
  worker.unref();
  if (r === 'timed-out') { failure = `${key}: GPU не ответил за 2 минуты`; throw new Error(failure); }
  if (ctrl[0] === 2) { failure = `${key}: ${new TextDecoder().decode(err).replace(/\0+$/, '')}`; throw new Error(failure); }
  for (const [o, s] of back) o.set(s);
}

/*
 * Резидентные массивы: неизменные до конца кадра входы (позиции, нормали плоскостей, глубина, маска, половинные поля)
 * этапы грузили каждый заново — 3–4 раза за кадр. Помеченный массив грузится на GPU один раз и остаётся там до
 * gpuReleaseResident (конец кадра). Массив вне общей памяти копируется в неё один раз. Массив, отданный заданию
 * на запись ('out'/'inout'), перестаёт быть резидентным.
 */
const resident = new Map(); // TypedArray → { rid, d (он же или копия в общей памяти) }
let ridNext = 1;
/** Пометить массивы неизменными до конца кадра (без GPU — ничего). */
export function gpuResident(...arrs) {
  if (!info || failure) return;
  for (const a of arrs) {
    if (!a || resident.has(a)) continue;
    let d = a;
    if (!(a.buffer instanceof SAB)) { d = new a.constructor(new SAB(Math.max(4, a.byteLength))).subarray(0, a.length); d.set(a); }
    resident.set(a, { rid: ridNext++, d });
  }
}
/** Конец кадра: отпустить резидентные буферы (в пул GPU-потока). */
export function gpuReleaseResident() {
  if (!resident.size) return;
  if (worker) worker.postMessage({ type: 'release', ids: [...resident.values()].map((r) => r.rid) });
  resident.clear();
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

/** Этап на GPU, а без него — ядро kernel полосами строк на пуле (rows): частый вид viaGPU. */
export const viaRows = (stage, n, gpu, modUrl, kernel, args, nRows) => viaGPU(stage, n, gpu, () => rows(modUrl, kernel, args, nRows));
/** Попробовать этап на GPU: true — посчитан там, false — считать на процессоре (вызывающий сам). */
export const tryGPU = (stage, n, gpu) => viaGPU(stage, n, () => (gpu(), true), () => false);

/** Упаковка uniform: поля по 4 байта подряд (u — u32, i — i32, f — f32), как структура WGSL из скаляров. */
export function uniforms(fields) {
  const n = Math.max(4, Math.ceil(fields.length / 4) * 4), dv = new DataView(new ArrayBuffer(n * 4));
  fields.forEach(([t, v], k) => { if (t === 'f') dv.setFloat32(k * 4, v, true); else if (t === 'i') dv.setInt32(k * 4, v | 0, true); else dv.setUint32(k * 4, v >>> 0, true); });
  return dv.buffer;
}
/** Число групп 16×16 на сетку w×h. */
export const groups2 = (w, h) => [Math.ceil(w / 16), Math.ceil(h / 16), 1];
/** Группы по 256 для одномерной сетки n (вторая ось — если групп больше 65535). */
export const groups1 = (n) => { const g = Math.ceil(n / 256); return g <= 65535 ? [g, 1, 1] : [65535, Math.ceil(g / 65535), 1]; };
/** Заглушка привязки, которую шейдер не читает (layout 'auto' требует буфер на каждом binding). */
export const GPU_DUMMY = Object.freeze({ bytes: 16 });
