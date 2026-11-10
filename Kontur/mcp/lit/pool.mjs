// Пул потоков отложенного света: попиксельные циклы этапов делятся на полосы строк и считаются на всех ядрах.
// Данные — в SharedArrayBuffer (без копирования); главный поток считает полосы вместе с воркерами и ждёт остальных
// через Atomics.wait, поэтому этапы остаются синхронными. Каждый пиксель считается тем же кодом, что и в одном
// потоке (хеши — от номера пикселя), — кадр совпадает пиксель в пиксель при любом числе потоков.
// KONTUR_THREADS=1 — без пула (всё в главном потоке), KONTUR_THREADS=N — не больше N потоков вместе с главным.
import { Worker, isMainThread } from 'node:worker_threads';
import { availableParallelism, cpus } from 'node:os';

const envN = process.env.KONTUR_THREADS;
const CORES = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
/** Потоков на этап вместе с главным (в самом воркере — 1: пул не вкладывается). */
export const THREADS = !isMainThread ? 1 : envN != null && envN !== '' ? Math.max(1, Math.min(64, envN | 0 || 1)) : Math.max(1, Math.min(16, CORES));
export const POOL = THREADS > 1;

/* ---------------- общая память ---------------- */
const SAB = typeof SharedArrayBuffer === 'function' ? SharedArrayBuffer : null;
const alloc = (Ctor, n) => (POOL && SAB ? new Ctor(new SAB(n * Ctor.BYTES_PER_ELEMENT)) : new Ctor(n));
/** Float32Array в общей памяти (без пула — обычный). */
export const f32 = (n) => alloc(Float32Array, n);
export const u8 = (n) => alloc(Uint8Array, n);
export const u16 = (n) => alloc(Uint16Array, n);
export const i32 = (n) => alloc(Int32Array, n);
/** Копия typed array в общей памяти. */
export const sharedCopy = (a) => { const s = alloc(a.constructor, a.length); s.set(a); return s; };
const isShared = (v) => SAB && v.buffer instanceof SAB;

/* ---------------- воркеры ---------------- */
/**
 * Флаги Node для воркеров: undefined — унаследовать как есть; если среди флагов процесса есть относящиеся только к
 * коду из строки (node --input-type -e), — те же без них (явный список Node проверяет строже, поэтому только в этом случае).
 */
export const workerExecArgv = () => {
  const keep = process.execArgv.filter((a) => !/^--(input-type|eval|print)\b/.test(a));
  return keep.length === process.execArgv.length ? undefined : keep;
};
let workers = null;
const pending = new Map();
let taskSeq = 0;

function ensure() {
  if (workers || !POOL) return;
  workers = [];
  for (let k = 0; k < THREADS - 1; k++) {
    const w = new Worker(new URL('./worker.mjs', import.meta.url), { execArgv: workerExecArgv() });
    w.busy = 0;
    w.on('message', (m) => {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (--w.busy === 0) w.unref();
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result);
    });
    w.on('error', (e) => { for (const [id, p] of pending) if (p.w === w) { pending.delete(id); p.reject(e); } w.busy = 0; w.unref(); });
    w.unref(); // пул не держит процесс; после on('message'): подписка снова включает ref
    workers.push(w);
  }
}
const preloaded = new Set();
/** Запустить воркеры заранее (пока идут проходы SVG) и загрузить в них модули mods: к этапам света они уже готовы. */
export function warm(mods = []) {
  ensure();
  if (!workers) return;
  const fresh = mods.filter((m) => !preloaded.has(m));
  if (!fresh.length) return;
  for (const m of fresh) preloaded.add(m);
  for (const w of workers) w.postMessage({ type: 'preload', mods: fresh });
}

/**
 * Посчитать kernel(args, y0, y1) по полосам строк 0…rows на всех потоках. kernel — экспортированная функция модуля
 * modUrl (import.meta.url) с тем же именем: воркер импортирует её сам. Typed arrays в args (и во вложенных массивах и
 * объектах) не в общей памяти копируются туда и обратно — результат верен, но медленнее. Возвращает сумму чисел, которые вернули полосы.
 */
export function rows(modUrl, kernel, args, nRows, { grain = 8 } = {}) {
  if (!POOL || nRows < grain * 2) return +kernel(args, 0, nRows) || 0;
  ensure();
  const back = [];
  const conv = (v, depth) => {
    if (ArrayBuffer.isView(v)) { if (isShared(v)) return v; const s = sharedCopy(v); back.push([v, s]); return s; }
    if (depth > 2 || !v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => conv(x, depth + 1));
    if (Object.getPrototypeOf(v) !== Object.prototype) return v;
    const o = {};
    for (const k in v) o[k] = conv(v[k], depth + 1);
    return o;
  };
  const a = conv(args, 0);
  const chunk = Math.max(grain, Math.ceil(nRows / (THREADS * 4))), total = Math.ceil(nRows / chunk);
  const ctrl = new Int32Array(new SAB(16)), res = new Float64Array(new SAB(total * 8)), err = new Uint8Array(new SAB(1024));
  const job = { mod: modUrl, name: kernel.name, args: a, ctrl, res, err, nRows, chunk, total };
  for (const w of workers) w.postMessage(job);
  let localErr = null;
  for (;;) {
    const c = Atomics.add(ctrl, 0, 1);
    if (c >= total) break;
    try { res[c] = +kernel(a, c * chunk, Math.min(nRows, (c + 1) * chunk)) || 0; } catch (e) { localErr = localErr || e; }
    Atomics.add(ctrl, 1, 1);
  }
  // ждём полосы, взятые воркерами; без движения 2 минуты — воркер умер
  for (;;) {
    const d = Atomics.load(ctrl, 1);
    if (d >= total) break;
    if (Atomics.wait(ctrl, 1, d, 120000) === 'timed-out' && Atomics.load(ctrl, 1) === d) throw new Error(`пул потоков: ${kernel.name} не завершился (${d}/${total} полос)`);
  }
  if (localErr) throw localErr;
  if (ctrl[2]) throw new Error(`${kernel.name} в воркере: ${new TextDecoder().decode(err).replace(/\0+$/, '')}`);
  for (const [v, s] of back) v.set(s);
  let sum = 0;
  for (let c = 0; c < total; c++) sum += res[c];
  return sum;
}

/**
 * Асинхронная задача в свободном воркере: fn(args) из модуля modUrl, результат возвращается сообщением.
 * Без пула (или если воркер не смог) — в главном потоке через local(args).
 */
export async function task(modUrl, name, args, local) {
  if (!POOL) return local(args);
  ensure();
  const w = workers.reduce((a, b) => (b.busy < a.busy ? b : a));
  const id = ++taskSeq;
  if (w.busy++ === 0) w.ref(); // пока задача в работе, процесс ждёт ответа воркера
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject, w }); w.postMessage({ type: 'task', id, mod: modUrl, name, args }); });
}
