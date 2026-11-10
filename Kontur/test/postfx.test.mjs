// Постобработка и тесселяция: GTAO, контактные тени, GI в несколько отскоков, глубина резкости, автоэкспозиция,
// стили fxaa / sharpen / chromatic / grain, адаптивная тесселяция мира.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLighting, effectsSummary, renderLit, LIGHT_PRESETS } from '../mcp/lighting.mjs';
import { depthOfField, autoExposure } from '../mcp/lit/post.mjs';
import { multiBounce } from '../mcp/lit/ao.mjs';
import { applyStyle } from '../mcp/lit/style.mjs';
import { buildWorld, toScene, normTess } from '../engine/world3d.js';
import { needRaster } from './helpers/common.mjs';
import { imageDiff } from './helpers/image.mjs';

test('новые эффекты выключены по умолчанию; true и mode дают значения по умолчанию', () => {
  const st = resolveLighting({ lighting: { preset: 'day' } });
  assert.equal(st.contactShadows ?? null, null);
  assert.equal(st.dof ?? null, null);
  assert.equal(st.autoExposure ?? null, null);
  assert.notEqual(st.ao?.mode, 'gtao');
  const on = resolveLighting({ lighting: { ao: { mode: 'gtao' }, contactShadows: true, dof: true, autoExposure: true, gi: { bounces: 2 } } });
  assert.deepEqual({ dirs: on.ao.dirs, steps: on.ao.steps, bent: on.ao.bent, multiBounce: on.ao.multiBounce }, { dirs: 4, steps: 8, bent: true, multiBounce: false });
  assert.equal(on.contactShadows.length, 0.4);
  assert.equal(on.dof.focus, 'auto');
  assert.equal(on.autoExposure.key, 0.18);
  assert.equal(on.gi.bounces, 2);
  const fx = effectsSummary(on).join(', ');
  for (const w of ['GTAO', 'контактные тени', 'GI×2', 'глубина резкости', 'автоэкспозиция']) assert.ok(fx.includes(w), `${w} в «${fx}»`);
  assert.ok(LIGHT_PRESETS.cinematic, 'пресет cinematic');
  const cin = resolveLighting({ lighting: { preset: 'cinematic' } });
  assert.equal(cin.ao.mode, 'gtao');
  assert.ok(cin.contactShadows && cin.dof && cin.autoExposure);
});

test('multiBounce: AO не темнее исходного и светлее на светлом альбедо', () => {
  for (const ao of [0, 0.3, 0.7, 1]) {
    const dark = multiBounce(ao, 0.05), light = multiBounce(ao, 0.9);
    assert.ok(dark >= ao - 1e-6 && light >= dark, `ao ${ao}: ${dark.toFixed(3)} ≤ ${light.toFixed(3)}`);
  }
  assert.ok(Math.abs(multiBounce(1, 0.5) - 1) < 1e-6);
});

/** Полосатый кадр: слева близко (5 м), справа далеко (50 м). */
function stripes(W, H) {
  const n = W * H, mask = new Uint8Array(n).fill(1), Dp = new Float32Array(n), col = new Float32Array(n * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, v = (x + y) % 2 ? 1 : 0; Dp[i] = x < W / 2 ? 5 : 50; col.fill(v, i * 3, i * 3 + 3); }
  return { G: { W, H, n, mask, Dp }, col };
}
const spread = (col, W, x0, x1, y) => { let mn = 1, mx = 0; for (let x = x0; x < x1; x++) { const v = col[(y * W + x) * 3]; mn = Math.min(mn, v); mx = Math.max(mx, v); } return mx - mn; };

test('глубина резкости: в фокусе резко, вдали размыто; near:false не трогает передний план', () => {
  const W = 640, H = 48; // кружок рассеяния масштабируется с шириной кадра (задан для 1280)
  const a = stripes(W, H), src = Float32Array.from(a.col);
  const info = depthOfField(a.G, { focus: 5, aperture: 4, maxBlur: 20, samples: 24 }, a.col);
  assert.equal(info.focus, 5);
  assert.ok(info.coc && info.maxCoc > 1);
  for (let x = 4; x < 280; x++) assert.equal(a.col[(20 * W + x) * 3], src[(20 * W + x) * 3], `резкий пиксель x=${x}`);
  assert.ok(spread(a.col, W, 500, 636, 20) < 0.5, `дальняя половина размыта: размах ${spread(a.col, W, 500, 636, 20).toFixed(2)}`);
  // фокус вдали, передний план не размывается
  const b = stripes(W, H), srcB = Float32Array.from(b.col);
  depthOfField(b.G, { focus: 50, aperture: 4, maxBlur: 20, near: false }, b.col);
  for (let x = 4; x < 280; x++) assert.equal(b.col[(20 * W + x) * 3], srcB[(20 * W + x) * 3]);
  // aperture 0 — ничего не делает
  const c = stripes(W, H);
  assert.equal(depthOfField(c.G, { focus: 5, aperture: 0 }, c.col).coc, null);
});

test('автоэкспозиция: приводит среднюю яркость к key, держит пределы и долю amount', () => {
  const flat = (v, n = 4096) => new Float32Array(n * 3).fill(v);
  const G = { n: 4096 };
  assert.ok(Math.abs(autoExposure(G, { key: 0.18 }, flat(0.09)).k - 2) < 0.01);
  assert.ok(Math.abs(autoExposure(G, { key: 0.18 }, flat(0.36)).k - 0.5) < 0.01);
  assert.ok(Math.abs(autoExposure(G, { key: 0.18, max: 3 }, flat(0.001)).k - 3) < 1e-9, 'предел max');
  assert.ok(Math.abs(autoExposure(G, { key: 0.18, amount: 0.5, max: 8 }, flat(0.045)).k - 2) < 0.02, 'половина шага в логарифме: 4 → 2');
  // самые яркие 2% (лампы) не сдвигают экспозицию
  const lamps = flat(0.09);
  for (let i = 0; i < 40; i++) lamps.fill(50, i * 3, i * 3 + 3);
  assert.ok(Math.abs(autoExposure(G, { key: 0.18 }, lamps).k - 2) < 0.01);
});

test('стили fxaa / sharpen / chromatic / grain', () => {
  const W = 64, H = 48, n = W * H, ctx = { W, H };
  const flat = new Float32Array(n * 3).fill(0.4);
  for (const type of ['fxaa', 'sharpen', 'chromatic']) {
    const out = applyStyle({ type }, flat, ctx);
    assert.ok(out.every((v) => Math.abs(v - 0.4) < 1e-5), `${type}: ровный кадр не меняется`);
  }
  // fxaa сглаживает ступенчатую диагональ: появляются промежуточные значения
  const stair = new Float32Array(n * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x > y * 1.3) stair.fill(1, (y * W + x) * 3, (y * W + x) * 3 + 3);
  const aa = applyStyle({ type: 'fxaa' }, stair, ctx);
  assert.ok(aa.some((v) => v > 0.05 && v < 0.95), 'fxaa: на краю есть полутона');
  // sharpen усиливает перепад
  const step = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) step.fill(i % W < W / 2 ? 0.3 : 0.6, i * 3, i * 3 + 3);
  const sh = applyStyle({ type: 'sharpen', amount: 1 }, step, ctx), r = 10 * W + W / 2;
  assert.ok(sh[(r - 1) * 3] < 0.3 && sh[r * 3] > 0.6, `sharpen: ${sh[(r - 1) * 3].toFixed(3)} / ${sh[r * 3].toFixed(3)}`);
  // chromatic: зелёный не сдвигается
  const ca = applyStyle({ type: 'chromatic', amount: 40 }, stair, ctx);
  for (let i = 0; i < n; i++) assert.equal(ca[i * 3 + 1], stair[i * 3 + 1]);
  // grain детерминирован и меняется с seed
  const g1 = applyStyle({ type: 'grain', amount: 0.1 }, flat, ctx), g2 = applyStyle({ type: 'grain', amount: 0.1 }, flat, ctx), g3 = applyStyle({ type: 'grain', amount: 0.1, seed: 2 }, flat, ctx);
  assert.deepEqual(g1, g2);
  assert.notDeepEqual(g1, g3);
  assert.ok(g1.some((v) => Math.abs(v - 0.4) > 0.01));
});

test('normTess: формы записи и ошибки', () => {
  assert.equal(normTess(undefined), null);
  assert.equal(normTess(false), null);
  assert.deepEqual(normTess(true), { px: 6, min: 8, max: 96 });
  assert.deepEqual(normTess('adaptive'), { px: 6, min: 8, max: 96 });
  assert.deepEqual(normTess(3), { px: 3, min: 8, max: 96 });
  assert.deepEqual(normTess({ px: 4, max: 500 }), { px: 4, min: 8, max: 256 });
  assert.throws(() => normTess('x'), /tess/);
});

const verts = (S) => { let k = 0; for (const it of S.items) for (const p of it.prims) if (p.ps) k += p.ps.length; return k; };
const roundWorld = (Z, tess) => buildWorld({ width: 640, height: 360, seed: 2, tess, camera3d: { hor: 180, charPx: 90, f: 520 }, items: [
  { type: 'sphere', X: 0, Z, r: 1, y: 1 },
  { type: 'cyl', X: 2.5, Z, r: 0.6, h: 2 },
  { type: 'disc', X: -2.5, Z, r: 1 },
] }).S;

test('тесселяция: без неё мир прежний; вблизи сегментов больше, вдали — меньше', () => {
  assert.equal(verts(roundWorld(6)), verts(roundWorld(6, false)), 'tess:false = без тесселяции');
  const base = verts(roundWorld(6)), near = verts(roundWorld(4, { px: 2 })), far = verts(roundWorld(80, true));
  assert.ok(near > base, `вблизи: ${near} > ${base}`);
  assert.ok(far < verts(roundWorld(80)), `вдали: ${far} < ${verts(roundWorld(80))}`);
});

test('рендер: GTAO, контактные тени, GI×2, глубина резкости, автоэкспозиция и новые стили дают кадр', async (t) => {
  if (!(await needRaster(t))) return;
  const { S } = buildWorld({ width: 320, height: 180, camera3d: { hor: 60, charPx: 60, f: 260, dz: 2 }, seed: 3, tess: true, items: [
    { type: 'ground', x: [-8, 8], z: [0, 40] },
    { type: 'box', x: [-1, 1], y: [0, 2], z: [6, 7], color: '#d88a9a' },
    { type: 'sphere', X: 2.2, Z: 5, r: 0.7, y: 0.7 },
    { type: 'lamp', X: 2, Z: 4 },
  ] });
  const scene = toScene(S, { lighting: { preset: 'day', volumetric: false } });
  const base = await renderLit(scene, 0, { width: 160 });
  const r = await renderLit(scene, 0, { width: 160, debug: true,
    lighting: { ao: { mode: 'gtao', multiBounce: true }, contactShadows: true, gi: { bounces: 2 }, dof: { focus: 6, aperture: 2 }, autoExposure: true },
    style: [{ type: 'fxaa' }, { type: 'sharpen' }, { type: 'chromatic' }, { type: 'grain' }] });
  assert.equal(r.stats.ao, 'gtao');
  assert.equal(r.stats.giBounces, 2);
  assert.equal(r.stats.dofFocus, 6);
  assert.ok(r.stats.autoExposure > 0);
  assert.deepEqual(r.stats.style.slice(-4), ['fxaa', 'sharpen', 'chromatic', 'grain']);
  assert.ok(r.stats.stageMs && typeof r.stats.stageMs === 'object');
  assert.ok(r.aoMap && r.aoMap.data.length === r.aoMap.width * r.aoMap.height * 4, 'карта AO в отладке');
  let dark = 0;
  for (let i = 0; i < r.aoMap.data.length; i += 4) if (r.aoMap.data[i] < 250) dark++;
  assert.ok(dark > 0, 'GTAO что-то затеняет');
  const diff = imageDiff(r.image.data, base.image.data).sum;
  assert.ok(diff > 0, 'кадр отличается от обычного');
});
