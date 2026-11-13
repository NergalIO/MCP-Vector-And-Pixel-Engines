// Ядра для проверки пула потоков (test/reliability.test.mjs): обычная задача и задача, роняющая воркер.
import { isMainThread } from 'node:worker_threads';

/** Удвоить x; where — где посчитано. */
export function double({ x }) { return { result: { y: x * 2, where: isMainThread ? 'main' : 'worker' } }; }
/** В воркере — завершить поток посреди задачи (как при сбое); в главном потоке — посчитать. */
export function crash({ x }) {
  if (!isMainThread) process.exit(3);
  return double({ x });
}
/** Полосы строк: out[y] = y * 2. */
export function fillRows({ out }, y0, y1) { for (let y = y0; y < y1; y++) out[y] = y * 2; return y1 - y0; }
