// Отложенный свет на видеокарте (KONTUR_GPU): кадр совпадает с процессорным в пределах округления float32.
// Без пакета webgpu или адаптера — пропуск. KONTUR_GPU читается при загрузке модулей, поэтому оба кадра — в дочерних процессах.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const CHILD = `
import { buildWorld, toScene } from './engine/world3d.js';
import { renderLit } from './mcp/lighting.mjs';
import { probeRaster } from './mcp/render.mjs';
if (!(await probeRaster())) { console.log(JSON.stringify({ skip: 'нет растеризатора' })); process.exit(0); }
const { S } = buildWorld({ width: 480, height: 270, camera3d: { hor: 90, charPx: 90, f: 390, dz: 2 }, seed: 5, items: [
  { type: 'ground', x: [-8, 8], z: [0, 40], pmat: 'pavers' },
  { type: 'box', x: [-1, 1], y: [0, 2], z: [6, 7], color: '#d88a9a', pmat: 'plaster' },
  { type: 'box', x: [1.5, 3], y: [0, 1], z: [5, 6], color: '#8ac0d8', pmat: 'wood' },
  { type: 'lamp', X: 2, Z: 4 },
] });
// материалы: плитка с палитрой, шум, грязь, износ, рельеф, доски — все ветки ядра материалов
const materials = {
  pavers: { tex: { kind: 'tiles', su: 0.3, sv: 0.22, offset: 0.5, grout: 0.02, color: '#c49a8e', color2: '#7a6062', palette: ['#b89488', '#9a8086', '#d8b0a0'], vary: 0.4, jitter: 0.25, pillow: 0.45 }, noise: { scale: 0.6, amount: 0.24, octaves: 3 }, grime: { height: 0.05, amount: 0.2, ao: 0.6 } },
  plaster: { noise: { scale: 0.7, amount: 0.14, octaves: 4 }, grime: { height: 0.9, amount: 0.4 }, wear: { amount: 0.25 }, bump: { scale: 0.05, amount: 0.12 } },
  wood: { tex: { kind: 'planks', color: '#7a4a2a', color2: '#a0683a', w: 0.16, len: 1.4 }, wear: { amount: 0.3, color: '#c89a68' } },
};
const scene = toScene(S, { materials, lighting: { preset: 'golden', volumetric: false, bloom: { strength: 0.4, threshold: 0.8 }, grade: { lift: [0, 0, 0.012], contrast: 1.15, split: { shadows: [0.36, 0.3, 0.52], highlights: [1, 0.86, 0.7], amount: 0.05 } }, gi: { strength: 0.8, bounces: 2 }, ao: { mode: 'gtao', multiBounce: true }, sun: { angle: 2 } }, style: [{ type: 'paint', radius: 1.5 }] });
const r = await renderLit(scene, 0, { width: 480 });
console.log(JSON.stringify({ matPixels: r.stats.matPixels ?? 0, gpu: r.stats.gpu ?? null, gpuError: r.stats.gpuError ?? null, data: Buffer.from(r.image.data).toString('base64') }));
process.exit(0);
`;
const render = (gpu) => {
  const env = { ...process.env, KONTUR_GPU: gpu ? '1' : '0' };
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], { cwd: root, env, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(r.stderr || `код ${r.status}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
};
const hasAdapter = async () => {
  try {
    const { create, globals } = await import('webgpu');
    Object.assign(globalThis, globals);
    const { softwareAdapter } = await import('../mcp/lit/gpu.mjs');
    keep.gpu = create([]); // ссылка до конца процесса: собранный GC экземпляр Dawn роняет процесс
    keep.a = await keep.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!keep.a) return 'нет адаптера WebGPU';
    // программный адаптер (CI без видеокарты) рендер не берёт — кадр считался бы на процессоре
    return softwareAdapter(keep.a) ? `программный адаптер (${keep.a.info?.description || keep.a.info?.vendor})` : null;
  } catch (e) { return `нет пакета webgpu (${e.message})`; }
};
const keep = {};

test('KONTUR_GPU: кадр на видеокарте совпадает с процессорным в пределах округления', async (t) => {
  const why = await hasAdapter();
  if (why) { t.skip(why); return; }
  t.diagnostic(`адаптер: ${keep.a.info?.vendor} | ${keep.a.info?.architecture} | ${keep.a.info?.description}`);
  const cpu = render(false), gpu = render(true);
  if (cpu.skip) { t.skip(cpu.skip); return; }
  assert.equal(cpu.gpu, null, 'без KONTUR_GPU видеокарта не используется');
  assert.ok(gpu.gpu, `видеокарта не включилась: ${gpu.gpuError}`);
  const A = Buffer.from(cpu.data, 'base64'), B = Buffer.from(gpu.data, 'base64');
  assert.ok(cpu.matPixels > 1000, 'материалы в кадре');
  assert.equal(gpu.matPixels, cpu.matPixels, 'материалов столько же');
  assert.equal(A.length, B.length);
  let sum = 0, big = 0;
  for (let i = 0; i < A.length; i += 4) {
    let m = 0;
    for (let c = 0; c < 3; c++) { const d = Math.abs(A[i + c] - B[i + c]); sum += d; if (d > m) m = d; }
    if (m > 8) big++;
  }
  const px = A.length / 4, mean = sum / (px * 3);
  assert.ok(mean < 0.05, `средняя разница ${mean.toFixed(4)} уровня`);
  assert.ok(big / px < 0.001, `пикселей с разницей > 8: ${big}`);
});
