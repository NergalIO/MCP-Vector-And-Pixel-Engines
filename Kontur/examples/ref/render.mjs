// Рендер референсных сцен: node examples/ref/render.mjs [имя…] [--width 1280] [--debug]
// Для каждой сцены: examples/ref/<имя>.json (сцена Kontur) и examples/ref/out/<имя>.png; в конце — лист out/sheet.png.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeScene } from './common.mjs';
import { renderLit } from '../../mcp/lighting.mjs';
import { probeRaster } from '../../mcp/render.mjs';
import { decodePNG, encodePNG, scaleDown } from '../../mcp/normals.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ALL = ['square', 'courtyard', 'fabric', 'post', 'townhall'];
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const names = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))).filter((a) => ALL.includes(a));
const width = +opt('--width', 1280);
const debug = args.includes('--debug');
await probeRaster();
mkdirSync(resolve(here, 'out'), { recursive: true });
const tiles = [];
for (const name of names.length ? names : ALL) {
  const def = (await import(`./${name}.build.mjs`)).default;
  const t0 = Date.now();
  const { scene } = makeScene(def);
  const json = JSON.stringify(scene);
  writeFileSync(resolve(here, `${name}.json`), json);
  const r = await renderLit(scene, 0, { width, debug, baseDir: here });
  writeFileSync(resolve(here, 'out', `${name}.png`), debug ? r.debug : r.png);
  tiles.push(r.image);
  console.log(`${name}: узлов ${scene.nodes.length}, JSON ${(json.length / 1024).toFixed(0)} КБ, рендер ${(r.stats.ms / 1000).toFixed(1)} с (проходы ${(r.stats.passMs / 1000).toFixed(1)} с), треугольников ${r.stats.tris}, ламп ${r.stats.lights}, всего ${((Date.now() - t0) / 1000).toFixed(1)} с`);
}
if (tiles.length > 1) {
  // лист 2 колонки
  const cw = 640, ims = tiles.map((im) => scaleDown(im, cw)), ch = ims[0].height, cols = 2, rows = Math.ceil(ims.length / cols), g = 8;
  const w = cols * cw + (cols + 1) * g, h = rows * ch + (rows + 1) * g, data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([28, 26, 30, 255], i * 4);
  ims.forEach((im, k) => {
    const ox = g + (k % cols) * (cw + g), oy = g + Math.floor(k / cols) * (ch + g);
    for (let y = 0; y < im.height; y++) data.set(im.data.subarray(y * im.width * 4, (y + 1) * im.width * 4), ((oy + y) * w + ox) * 4);
  });
  writeFileSync(resolve(here, 'out', 'sheet.png'), encodePNG({ width: w, height: h, data }));
}
void decodePNG;
