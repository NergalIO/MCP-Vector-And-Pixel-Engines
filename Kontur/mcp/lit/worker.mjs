// Воркер пула отложенного света (mcp/lit/pool.mjs): полосы строк попиксельных этапов и асинхронные задачи (проходы SVG).
import { parentPort } from 'node:worker_threads';

const mods = new Map();
const load = (url) => { let m = mods.get(url); if (!m) { m = import(url); mods.set(url, m); } return m; };

parentPort.on('message', async (job) => {
  if (job.type === 'preload') { for (const m of job.mods) load(m).catch(() => {}); return; }
  if (job.type === 'task') {
    try {
      const m = await load(job.mod);
      const { result, transfer } = await m[job.name](job.args);
      parentPort.postMessage({ id: job.id, result }, transfer || []);
    } catch (e) { parentPort.postMessage({ id: job.id, error: String(e?.stack || e) }); }
    return;
  }
  const { ctrl, res, err, nRows, chunk, total, args } = job;
  let fn;
  try { fn = (await load(job.mod))[job.name]; } catch (e) { fn = () => { throw e; }; }
  for (;;) {
    const c = Atomics.add(ctrl, 0, 1);
    if (c >= total) break;
    try { res[c] = +fn(args, c * chunk, Math.min(nRows, (c + 1) * chunk)) || 0; }
    catch (e) { if (Atomics.compareExchange(ctrl, 2, 0, 1) === 0) err.set(new TextEncoder().encode(String(e?.stack || e)).subarray(0, err.length)); }
    Atomics.add(ctrl, 1, 1);
    Atomics.notify(ctrl, 1);
  }
});
