// @ts-check
// Очередь тяжёлых рендеров: кадры со светом, раскадровки, экспорт (инструменты MCP) и /lit.png студии не считаются
// одновременно. Каждый такой рендер занимает все ядра (пул потоков) и сотни мегабайт; два параллельных не быстрее
// двух подряд, но вдвое тяжелее по памяти, а общие буферы GPU рассчитаны на один кадр за раз.
// Ключ key — «более новый запрос заменяет ждущий»: превью при прокрутке времени не копит устаревшие кадры.
// signal (AbortSignal) — отмена, пока задача ждёт (например, браузер закрыл соединение).

/** Задача заменена более новой с тем же ключом, пока ждала очереди. */
export class Superseded extends Error {
  constructor() { super('запрос заменён более новым'); this.name = 'Superseded'; }
}
const aborted = () => Object.assign(new Error('запрос отменён'), { name: 'AbortError' });

/** Очередь не больше чем на concurrency одновременных задач. */
export function createQueue(concurrency = 1) {
  let active = 0;
  const waiting = [];
  const drop = (job, err) => { const i = waiting.indexOf(job); if (i >= 0) { waiting.splice(i, 1); job.reject(err); } };
  function pump() {
    while (active < concurrency && waiting.length) {
      const job = waiting.shift();
      job.signal?.removeEventListener('abort', job.onAbort);
      active++;
      Promise.resolve().then(job.fn).then(job.resolve, job.reject).finally(() => { active--; pump(); });
    }
  }
  return {
    /**
     * Выполнить fn(), когда освободится место. Промис — результат fn.
     * @template T
     * @param {() => T | Promise<T>} fn
     * @param {{ key?: string, signal?: AbortSignal }} [opts] key — новая задача с тем же ключом вытесняет ждущую (Superseded)
     * @returns {Promise<T>}
     */
    run(fn, { key, signal } = {}) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(aborted());
        if (key != null) for (const j of waiting.filter((w) => w.key === key)) drop(j, new Superseded());
        const job = { fn, key, signal, resolve, reject };
        if (signal) { job.onAbort = () => drop(job, aborted()); signal.addEventListener('abort', job.onAbort, { once: true }); }
        waiting.push(job);
        pump();
      });
    },
    /** { active, waiting } — сколько задач считается и сколько ждёт. */
    stats: () => ({ active, waiting: waiting.length }),
  };
}

/** Общая очередь рендеров сервера. KONTUR_RENDER_JOBS — сколько рендеров одновременно (по умолчанию 1). */
export const renderQueue = createQueue(Math.max(1, Math.min(8, Number(process.env.KONTUR_RENDER_JOBS) || 1)));
