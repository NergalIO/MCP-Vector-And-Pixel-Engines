// Эталоны сборки 2.5D-мира: SHA-256 вывода toScene/toNodes для набора описаний world_build и материалов.
// Сборка детерминирована, сравнение точное. Оптимизация и рефакторинг engine/world3d.js не должны менять хеши;
// намеренное изменение вида — только с --update.
//   node test/world-golden.mjs           — сравнить
//   node test/world-golden.mjs --update  — перезаписать test/world.golden.json
import * as W3 from '../engine/world3d.js';
import { sha, runGolden } from './helpers/golden.mjs';

const file = new URL('world.golden.json', import.meta.url);

/** Предметы на все типы v1 (поля — как в описаниях world_build). */
export const ITEMS = {
  ground: { type: 'ground', x: [-20, 20], z: [0, 40] },
  groundSlabs: { type: 'ground', x: [-8, 8], z: [0, 12], mat: 'slabs', color: '#c8b090' },
  houseBrick: { type: 'house', x: [-14, -6], z: [12, 20], h: 9, mat: 'brick', doorAt: 3, chimney: 0.3, plinth: 0.5, pipe: 'end' },
  housePlaster: { type: 'house', x: [-5, 4], z: [14, 22], h: 11, mat: 'plaster', doorAt: 4, litP: 0.6 },
  houseStone: { type: 'house', x: [6, 14], z: [12, 20], h: 8, mat: 'stone', ridge: 'z', facades: ['front', 'left'] },
  houseFlat: { type: 'house', x: [15, 20], z: [10, 14], h: 6, mat: 'none', roofType: 'flat', pmat: 'plaster' },
  stairs: { type: 'stairs', x: [-2, 2], z: [8, 12], h: 1.2 },
  boxWood: { type: 'box', x: [-1, 1], y: [0, 1], z: [5, 6], mats: { all: ['wood', '#8a5a3a'] } },
  boxMats: { type: 'box', x: [2, 4], y: [0, 2], z: [6, 8], color: 'stone', mats: { front: ['tile', '#a05040'], side: ['panels', '#606870'], top: ['stripes', '#d0c0a0'] } },
  boxGlow: { type: 'box', x: [-4, -3], y: [1, 1.5], z: [4, 5], emissive: '#ffd890', occ: false },
  lamp: { type: 'lamp', X: -4, Z: 6 },
  cyl: { type: 'cyl', X: 0, Z: 4, r: 0.4, y: [0, 1], bands: 0.25 },
  disc: { type: 'disc', X: 1, Z: 3, rx: 0.6, rz: 0.3, wob: true },
  wallBrick: { type: 'wall', ps: [[-20, 0, 30], [20, 0, 30], [20, 6, 30], [-20, 6, 30]], mat: 'brick' },
  wallCobble: { type: 'wall', ps: [[-6, 0, 10], [-3, 0, 10], [-3, 3, 10], [-4.5, 4, 10], [-6, 3, 10]], mat: 'cobble' },
  light: { type: 'light', p: [0, 2, 3], color: '#ffa060', radius: 4, energy: 1.2, shadows: false },
  cloud: { type: 'cloud', x: 400, y: 120 },
  window: { type: 'window', on: { wall: [-3, 3, 9, 6] }, a: 1, b: 1, lit: true, shut: 'teal', box: true },
  door: { type: 'door', on: { o: [-1, 0, 9], u: [1, 0, 0], v: [0, 1, 0], w: 3, h: 3, n: [0, 0, -1] }, a: 0.5 },
  pipe: { type: 'pipe', on: { ps: [[3, 0, 9], [5, 0, 9], [5, 5, 9], [3, 5, 9]] }, a: 0.3, h: 5 },
  ivy: { type: 'ivy', on: { wall: [-3, 3, 8.9, 6] }, a: 0.5, b: 0, w: 2, h: 4 },
};
const ALL = Object.values(ITEMS);
/** Предметы, появившиеся с версией 2 (и новые поля старых): вальмовая и односкатная крыши, анимация фонаря. */
export const ITEMS2 = {
  houseHip: { type: 'house', x: [-14, -4], z: [12, 18], h: 8, roofType: 'hip' },
  houseHipZ: { type: 'house', x: [-3, 1], z: [12, 22], h: 7, roofType: 'hip', mat: 'stone' },
  houseShed: { type: 'house', x: [3, 9], z: [12, 17], h: 6, roofType: 'shed', mat: 'brick' },
  arch: { type: 'arch', x: [-1.5, 1.5], z: 10, spring: 1.8, mat: 'stone' },
  sphere: { type: 'sphere', X: 3, Z: 8, r: 1, wob: 0.1 },
  dome: { type: 'sphere', X: -4, Z: 14, r: 1.5, dome: true },
  lathe: { type: 'lathe', X: 1, Z: 5, profile: 'vase', smooth: true },
  fountain: { type: 'fountain', X: -2, Z: 7 },
  awning: { type: 'awning', x: [-2, 2], z: 10, y: 3 },
  text: { type: 'text', on: { wall: [-3, 3, 9, 6] }, a: 0, b: 2, text: 'KONTUR' },
  array: { type: 'array', item: { type: 'cyl', X: 0, Z: 0, r: 0.2, y: [0, 1.2] }, count: 5, step: [1.5, 0, 0], at: [-3, 0, 6] },
  scatter: { type: 'scatter', item: { type: 'sphere', X: 0, Z: 0, r: 0.4 }, area: { x: [-6, 6], z: [4, 10] }, count: 8 },
  slab: { type: 'slab', x: [-2, 2], z: [6, 7], y: 2 },
  ramp: { type: 'ramp', x: [4, 6], z: [4, 8], y: [0, 1] },
  road: { type: 'road', x: [-3, 3], z: [2, 30] },
  lampAnim: { type: 'lamp', X: -4, Z: 6, anim: { flicker: 0.3 } },
};
const ALL2 = [...ALL, ...Object.values(ITEMS2)];
const CAMS = {
  default: { ...W3.CAMERA_DEFAULT, cx: 960 },
  low: { ...W3.CAMERA_DEFAULT, cx: 960, camH: 0.8 },
  turned: { ...W3.CAMERA_DEFAULT, cx: 960, yaw: 12, pitch: -6 },
  far: { ...W3.CAMERA_DEFAULT, cx: 700, dz: 9, f: 1800 },
};
const sceneOf = (opts, nodeOpts = {}) => {
  const { S, errors } = W3.buildWorld({ width: 1920, height: 1080, ...opts });
  return JSON.stringify({ errors, scene: W3.toScene(S, {}, nodeOpts) });
};

export function computeWorldGolden() {
  const out = {};
  for (const [k, d] of Object.entries(ITEMS)) out[`item|${k}`] = sha(sceneOf({ items: [d], camera3d: CAMS.default, seed: 3 }));
  for (const [k, cam] of Object.entries(CAMS)) out[`all|${k}`] = sha(sceneOf({ items: ALL, camera3d: cam, seed: 1 }));
  out['all|manual-occ'] = sha(sceneOf({ items: ALL, camera3d: CAMS.default, occ: 'manual', sky: ['#203050', '#806080', '#f0a070'] }));
  out['all|prefix'] = sha(sceneOf({ items: ALL.slice(0, 6), camera3d: CAMS.default, seed: 9 }, { group: 'g', idPrefix: 'g_', parent: 'p', lights: false }));
  // материал на грань (material_apply)
  const S = W3.Scene({ W: 1920, H: 1080, ...CAMS.default });
  const fr = { o: [-2, 0, 8], u: [1, 0, 0], v: [0, 1, 0], w: 4, h: 3, n: [0, 0, -1] };
  for (const m of W3.MATERIALS) out[`mat|${m}`] = sha(JSON.stringify(W3.withSeed(5, () => W3.materialPrims(S, fr, m, null, {}))));
  // мелкие построители напрямую
  const T = W3.Scene({ W: 1920, H: 1080, ...CAMS.default });
  W3.withSeed(2, () => {
    W3.arch(T, -1.5, 1.5, 12, 0, 1.8, 0.5, '#e0c090', { mat: 'stone' });
    W3.sphere(T, 3, 1.5, 9, 1, '#5a8040', { wob: 0.1, flat: 0.3 });
    W3.sphere(T, -4, 3, 14, 1.5, '#a0a0b0', { dome: true });
    W3.awning(T, -2, 2, 10, 3, 1.2, 0.5, {});
    W3.lathe(T, 1, 5, W3.PROFILES.vase(), '#a06040', { smooth: true });
    W3.latheStack(T, -2, 7, [{ prof: W3.PROFILES.fountainBasin(0.6, 1.5), color: 'stone', fill: { y: 0.45, r: 1.4 } }, { prof: W3.PROFILES.column(1.4, 0.15), color: 'stone', y0: 0.3 }]);
  });
  out['shapes'] = sha(JSON.stringify(W3.toScene(T, {})));
  // версия 2: подсиды, стабильные id, детализация lod и слияние merge
  for (const [k, d] of Object.entries(ITEMS2)) out[`v2|item|${k}`] = sha(sceneOf({ items: [d], camera3d: CAMS.default, seed: 3, v: 2 }));
  out['v2|all|default'] = sha(sceneOf({ items: ALL2, camera3d: CAMS.default, seed: 1, v: 2 }));
  out['v2|all|turned'] = sha(sceneOf({ items: ALL2, camera3d: CAMS.turned, seed: 1, v: 2 }));
  out['v2|all|lod0-nomerge'] = sha(sceneOf({ items: ALL2, camera3d: CAMS.default, seed: 1, v: 2, lod: 0, merge: false }));
  out['v2|all|lod2'] = sha(sceneOf({ items: ALL2, camera3d: CAMS.far, seed: 1, v: 2, lod: 2 }));
  out['v2|pan'] = sha(sceneOf({ items: ALL.slice(0, 8), camera3d: CAMS.default, seed: 1, v: 2 }, { pan: [[0, 0], [2, 1.5], [4, 3]] }));
  return out;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/').replace(/^\/?/, '/')}` || process.argv[1]?.endsWith('world-golden.mjs')) {
  runGolden(file, computeWorldGolden(), {
    written: (n) => console.log(`✓ test/world.golden.json: ${n} эталонов`),
    report: ({ bad, n }) => {
      if (bad.length) console.error(`✗ сборка мира изменилась (${bad.length}):\n  ${bad.join('\n  ')}`);
      else console.log(`✓ сборка мира совпадает с эталонами: ${n}`);
    },
  });
}
