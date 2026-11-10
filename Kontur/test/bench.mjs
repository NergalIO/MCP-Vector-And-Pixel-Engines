// Замеры производительности движка: node test/bench.mjs [--ci] [--json] [--update]
// Каждый замер — медиана нескольких прогонов. Бюджеты — в test/bench.json (обновляются --update на эталонной машине).
// --ci: регресс больше 20 % от бюджета — предупреждение (::warning для GitHub Actions); больше 3× — ошибка
// (машины CI сильно разнятся, поэтому жёсткий порог грубый).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createScene, ops, evaluate, renderSVG, invalidate } from '../engine/kontur.js';
import { ex } from './helpers/common.mjs';

const args = process.argv.slice(2);
const CI = args.includes('--ci');
const budgetsFile = new URL('bench.json', import.meta.url);
const budgets = existsSync(budgetsFile) ? JSON.parse(readFileSync(budgetsFile, 'utf8')) : {};

function measure(name, fn, { runs = 11, warmup = 3, setup } = {}) {
  for (let i = 0; i < warmup; i++) fn(setup?.());
  const ts = [];
  for (let i = 0; i < runs; i++) {
    const ctx = setup?.();
    const t0 = performance.now();
    fn(ctx);
    ts.push(performance.now() - t0);
  }
  ts.sort((a, b) => a - b);
  return { name, ms: +ts[Math.floor(ts.length / 2)].toFixed(2), min: +ts[0].toFixed(2) };
}

const blob = (n, r) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r]; });
const cases = [
  ['addNode ×4000', () => measure('addNode ×4000', (s) => { for (let i = 0; i < 4000; i++) ops.addNode(s, { type: 'rect', props: { x: i } }); }, { setup: () => createScene() })],
  ['анимированные узлы ×2000, кадр', () => {
    const s = createScene({ duration: 4 });
    for (let i = 0; i < 2000; i++) ops.addNode(s, { type: 'circle', props: { r: 4, x: i % 100 * 10, y: (i / 100 | 0) * 10, fill: '#fa0' }, keys: { x: [{ t: 0, v: 0 }, { t: 4, v: 300, ease: 'inOutCubic' }], opacity: [{ t: 0, v: 0 }, { t: 2, v: 1 }] } });
    evaluate(s, 0);
    let t = 0;
    return measure('анимированные узлы ×2000, кадр', () => evaluate(s, (t += 0.016) % 4));
  }],
  ['морфинг 50×300 точек, кадр', () => {
    const s = createScene({ duration: 2 });
    for (let i = 0; i < 50; i++) ops.addNode(s, { type: 'path', props: { x: i * 20, y: 300 }, keys: { d: [{ t: 0, v: { points: blob(300, 40) } }, { t: 2, v: { points: blob(300, 80) } }] } });
    evaluate(s, 0);
    let t = 0;
    return measure('морфинг 50×300 точек, кадр', () => evaluate(s, (t += 0.016) % 2));
  }],
  ['bay.json renderSVG ×10', () => { const s = ex('bay'); renderSVG(s, 0); return measure('bay.json renderSVG ×10', () => { for (let i = 0; i < 10; i++) renderSVG(s, i * 0.37); }, { runs: 5 }); }],
  ['flow.json renderSVG ×10', () => { const s = ex('flow'); renderSVG(s, 0); return measure('flow.json renderSVG ×10', () => { for (let i = 0; i < 10; i++) renderSVG(s, i * 0.37); }, { runs: 5 }); }],
  ['правка узла + кадр (bay)', () => {
    const s = ex('bay'); renderSVG(s, 0);
    const id = s.nodes[Math.floor(s.nodes.length / 2)].id;
    let k = 0;
    return measure('правка узла + кадр (bay)', () => { ops.updateNode(s, id, { props: { opacity: 0.5 + (k++ % 2) * 0.5 } }); renderSVG(s, 1); });
  }],
  ['холодный кадр (bay, invalidate)', () => { const s = ex('bay'); return measure('холодный кадр (bay, invalidate)', () => { invalidate(s); renderSVG(s, 1); }); }],
];

const results = [];
let warn = 0, bad = 0;
for (const [name, run] of cases) {
  const r = run();
  const b = budgets[name];
  const ratio = b ? r.ms / b : null;
  r.budget = b ?? null;
  results.push(r);
  const mark = ratio == null ? '·' : ratio > 3 ? '✗' : ratio > 1.2 ? '!' : '✓';
  if (ratio > 3) bad++; else if (ratio > 1.2) warn++;
  if (!args.includes('--json')) console.log(`${mark} ${name.padEnd(34)} ${String(r.ms).padStart(8)} мс${b ? `  (бюджет ${b} мс, ×${ratio.toFixed(2)})` : ''}`);
  if (CI && ratio > 1.2) console.log(`::warning title=bench::${name}: ${r.ms} мс при бюджете ${b} мс (×${ratio.toFixed(2)})`);
}
if (args.includes('--json')) console.log(JSON.stringify(results, null, 1));
if (args.includes('--update')) {
  // бюджет — с запасом 50 % над текущей медианой
  writeFileSync(budgetsFile, JSON.stringify(Object.fromEntries(results.map((r) => [r.name, +(r.ms * 1.5).toFixed(1)])), null, 1) + '\n');
  console.log('бюджеты записаны в test/bench.json');
}
if (warn || bad) console.log(`регрессий: ${warn} предупреждений, ${bad} ошибок`);
process.exit(CI && bad ? 1 : 0);
