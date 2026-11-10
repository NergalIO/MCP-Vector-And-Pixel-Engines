// Отложенный свет: живописное затенение, тонмапперы, воздушная перспектива, палитра с референса, фильтрация фактур.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveLighting, agx, hueTonemap, matchPalette, loadRefStats, renderLit } from '../mcp/lighting.mjs';
import { prepareMaterials, applyMaterials } from '../mcp/materials.mjs';
import { encodePNG } from '../mcp/normals.mjs';
import { probeRaster } from '../mcp/render.mjs';
import { buildWorld, toScene } from '../engine/world3d.js';

test('новые блоки света выключены по умолчанию, true даёт значения по умолчанию', () => {
  const st = resolveLighting({ lighting: { preset: 'golden' } });
  assert.equal(st.paint, null);
  assert.equal(st.aerial, null);
  assert.equal(st.ao.color, undefined);
  const on = resolveLighting({ lighting: { paint: true, aerial: { density: 0.1 }, ao: { color: '#4d3366' }, grade: { matchRef: 'r.png' } } });
  assert.equal(on.paint.amount, 0.4);
  assert.equal(on.paint.shadow.length, 3);
  assert.equal(on.aerial.density, 0.1);
  assert.equal(on.aerial.start, 8);
  assert.ok(Math.abs(on.ao.color[0] - 0x4d / 255) < 1e-6);
  assert.deepEqual({ src: on.grade.matchRef.src, amount: on.grade.matchRef.amount }, { src: 'r.png', amount: 0.6 });
  assert.equal(resolveLighting({ lighting: { grade: { matchRef: {} } } }).grade.matchRef, undefined, 'matchRef без src отбрасывается');
});

test('тонмапперы: ноль в ноль, монотонность, hue сохраняет отношение каналов', () => {
  const o = [0, 0, 0];
  for (const f of [agx, hueTonemap]) {
    f(0, 0, 0, o); assert.ok(o.every((v) => v < 0.02), `${f.name}: чёрное`);
    let prev = -1;
    for (const x of [0.01, 0.1, 0.5, 1, 4, 20]) { f(x, x, x, o); assert.ok(o[1] > prev, `${f.name}: монотонно на ${x}`); prev = o[1]; }
    f(100, 100, 100, o); assert.ok(o.every((v) => v > 0.9), `${f.name}: очень яркое — почти белое`);
  }
  // насыщенный оранжевый средней яркости: ACES по каналам увёл бы его в жёлтый, hue — нет
  hueTonemap(0.6, 0.24, 0.06, o);
  const lin = o.map((v) => v ** 2.2);
  assert.ok(Math.abs(lin[1] / lin[0] - 0.4) < 0.01 && Math.abs(lin[2] / lin[0] - 0.1) < 0.01, `отношения каналов ${lin.map((v) => v.toFixed(3))}`);
});

test('matchPalette сводит статистику Lab к референсу; amount 0 ничего не меняет', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kontur-ref-'));
  try {
    // референс: светлый тёплый; кадр: тёмный холодный
    const w = 64, h = 32, data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { const t = (i % w) / w; data.set([Math.round(150 + 90 * t), Math.round(110 + 70 * t), Math.round(70 + 40 * t), 255], i * 4); }
    writeFileSync(join(dir, 'ref.png'), encodePNG({ width: w, height: h, data }));
    const ref = await loadRefStats('ref.png', dir);
    const n = 4000, img = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const t = (i % 100) / 100; img[i * 3] = 0.1 + 0.3 * t; img[i * 3 + 1] = 0.15 + 0.3 * t; img[i * 3 + 2] = 0.3 + 0.4 * t; }
    const before = Float32Array.from(img);
    matchPalette(img, n, ref, { amount: 0 });
    assert.ok(img.every((v, i) => Math.abs(v - before[i]) < 2e-3), 'amount 0 — кадр как был');
    matchPalette(img, n, ref, { amount: 1, lum: 1, chroma: 1 });
    const after = matchPalette(Float32Array.from(img), n, ref, { amount: 0 }).src;
    assert.ok(Math.abs(after.meanL - ref.meanL) < 2, `L ${after.meanL.toFixed(1)} → ${ref.meanL.toFixed(1)}`);
    assert.ok(Math.abs(after.ga - ref.ga) < 3 && Math.abs(after.gb - ref.gb) < 3, `a/b ${after.ga.toFixed(1)}/${after.gb.toFixed(1)} → ${ref.ga.toFixed(1)}/${ref.gb.toFixed(1)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/** Пол под скользящим углом: строка y — глубина Z(y), вдали (малые y) пиксель накрывает несколько плиток. */
function floorBuffers(W, H) {
  const n = W * H, f = (k) => new Float32Array(n * k);
  const b = { W, H, mid: new Uint16Array(n).fill(1), lin: f(3).fill(0.5), Nx: f(1), Ny: f(1).fill(1), Nz: f(1), PNx: f(1), PNy: f(1).fill(1), PNz: f(1), Px: f(1), Py: f(1), Pz: f(1), ao: f(1).fill(1) };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const Z = 1 + 120 / (y + 1), i = y * W + x; b.Pz[i] = Z; b.Px[i] = ((x - W / 2) * Z) / 400; }
  return b;
}
const rowVar = (lin, W, y) => { let s = 0, s2 = 0; for (let x = 0; x < W; x++) { const v = lin[(y * W + x) * 3]; s += v; s2 += v * v; } return s2 / W - (s / W) ** 2; };

test('фильтрация фактур: вдали муар гаснет, вблизи кадр тот же', () => {
  const W = 96, H = 80;
  const scene = { materials: { pav: { tex: { kind: 'tiles', su: 0.3, sv: 0.36, grout: 0.022, color: '#b89a86', color2: '#4a3a3a', jitter: 0.75, pillow: 0.4 } } } };
  const raw = floorBuffers(W, H), flt = floorBuffers(W, H);
  applyMaterials(prepareMaterials(scene), { ...raw, filter: false });
  applyMaterials(prepareMaterials(scene), flt);
  let vr = 0, vf = 0;
  for (let y = 0; y < 8; y++) { vr += rowVar(raw.lin, W, y); vf += rowVar(flt.lin, W, y); }
  assert.ok(vf < vr * 0.25, `разброс дальних строк: ${vf.toExponential(2)} против ${vr.toExponential(2)}`);
  // ближняя строка: след пикселя меньше детали — значения совпадают
  const y = H - 1;
  for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; assert.equal(flt.lin[i], raw.lin[i], `ближняя строка, x=${x}`); }
});

test('рендер со светом: paint, aerial, цветной AO и оба тонмаппера дают кадр', async (t) => {
  if (!(await probeRaster())) { t.skip('нет растеризатора'); return; }
  const { S } = buildWorld({ width: 320, height: 180, camera3d: { hor: 60, charPx: 60, f: 260, dz: 2 }, seed: 3, items: [
    { type: 'ground', x: [-8, 8], z: [0, 40] },
    { type: 'box', x: [-1, 1], y: [0, 2], z: [6, 7], color: '#d88a9a' },
    { type: 'lamp', X: 2, Z: 4 },
  ] });
  const scene = toScene(S, { lighting: { preset: 'golden', volumetric: false, gi: false } });
  const base = await renderLit(scene, 0, { width: 160 });
  for (const tonemap of ['hue', 'agx']) {
    const r = await renderLit(scene, 0, { width: 160, lighting: { paint: true, aerial: true, ao: { color: '#4d3366' }, tonemap } });
    assert.equal(r.stats.paint, true);
    assert.equal(r.stats.aerial, true);
    assert.equal(r.stats.tonemap, tonemap);
    let diff = 0;
    for (let i = 0; i < r.image.data.length; i++) diff += Math.abs(r.image.data[i] - base.image.data[i]);
    assert.ok(diff > 0, `${tonemap}: кадр отличается от обычного`);
  }
});
