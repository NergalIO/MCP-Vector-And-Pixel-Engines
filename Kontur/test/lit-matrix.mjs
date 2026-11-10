// Матрица кадров отложенного света для проверки рефакторинга: node test/lit-matrix.mjs <папка> [--compare <папка-эталон>]
// Рендерит реф-сцены (examples/ref) во всех пресетах и режимах; с --compare сравнивает пиксели с эталоном.
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { makeScene } from '../examples/ref/common.mjs';
import { renderLit, renderPasses } from '../mcp/lighting.mjs';
import { probeRaster } from '../mcp/render.mjs';
import { encodePNG, decodePNG } from '../mcp/normals.mjs';
import { imageDiff } from './helpers/image.mjs';

const ref = resolve(dirname(fileURLToPath(import.meta.url)), '../examples/ref');
const args = process.argv.slice(2);
const out = resolve(args[0] || 'lit-out');
const ci = args.indexOf('--compare'), cmp = ci >= 0 ? resolve(args[ci + 1]) : null;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const W = 480;
mkdirSync(out, { recursive: true });
await probeRaster();
const cases = [];
const scenes = {};
for (const name of ['stairs']) scenes[name] = makeScene((await import(`../examples/ref/${name}.build.mjs`)).default).scene;
const add = (id, scene, opts = {}) => cases.push({ id, scene, opts });
for (const name of Object.keys(scenes)) add(name, scenes[name]);
const sq = scenes.stairs;
for (const p of ['day', 'comic', 'night', 'pixel', 'golden', 'dusk']) add(`stairs-${p}`, sq, { lighting: { preset: p }, style: p });
add('stairs-agx', sq, { lighting: { preset: 'golden', tonemap: 'agx' } });
add('stairs-none', sq, { lighting: { preset: 'day', tonemap: 'none', sun: { angle: 0 } } });
add('stairs-full', sq, { lighting: { preset: 'dusk', paint: true, aerial: true, ao: { color: '#402040' }, gi: { strength: 0.8 }, volumetric: true, sun: { angle: 2 } }, style: [{ type: 'kuwahara', radius: 3 }, { type: 'hatch' }, { type: 'paper' }] });
add('stairs-debug', sq, { debug: true });
add('stairs-bake', sq, { bake: 'albedo' });
const passCache = new Map();
const res = {};
let bad = 0;
for (const c of cases) {
  if (only && !c.id.includes(only)) continue;
  if (!passCache.has(c.scene)) passCache.set(c.scene, await renderPasses(c.scene, 0, { width: W, masks: ['chr'], raw: true }));
  const r = await renderLit(c.scene, 0, { width: W, passes: passCache.get(c.scene), baseDir: ref, ...c.opts });
  const buf = c.opts.debug ? Buffer.from(r.debug) : Buffer.from(r.png);
  writeFileSync(resolve(out, `${c.id}.png`), buf);
  const h = createHash('sha1').update(r.image.data).digest('hex').slice(0, 12);
  res[c.id] = { hash: h, ms: r.stats.ms };
  let note = '';
  if (cmp && existsSync(resolve(cmp, `${c.id}.png`))) {
    const a = decodePNG(readFileSync(resolve(cmp, `${c.id}.png`))), b = c.opts.debug ? decodePNG(buf) : r.image;
    if (a.width !== b.width || a.height !== b.height) { note = ' РАЗМЕР'; bad++; }
    else { const { max: mx, count: cnt } = imageDiff(a.data, b.data); note = cnt ? ` diff max ${mx}, ${cnt} каналов` : ' =='; if (mx > 2) bad++; }
  }
  console.log(`${c.id.padEnd(16)} ${h} ${String(r.stats.ms).padStart(6)} мс${note}`);
}
writeFileSync(resolve(out, 'hashes.json'), JSON.stringify(res, null, 1));
if (cmp) { console.log(bad ? `✗ отличий: ${bad}` : '✓ совпадает'); process.exit(bad ? 1 : 0); }
