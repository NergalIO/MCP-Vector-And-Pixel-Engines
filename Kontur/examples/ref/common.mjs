// Общее для референсных сцен examples/ref/*.build.mjs: размеры кадра, попиксельные материалы, сборка сцены.
// Сцена описывается списком предметов world_build (engine/world3d.js, WORLD_ITEMS) — те же items можно передать в MCP-инструмент.
import { buildWorld, toScene } from '../../engine/world3d.js';

export const W = 1920, H = 1080;

/** Попиксельные материалы (scene.materials): фактура без тысяч узлов-деталей. */
export const MATS = {
  plaster: { noise: { scale: 0.8, amount: 0.12, octaves: 4 }, grime: { height: 1.1, amount: 0.35 }, wear: { amount: 0.2 }, bump: { scale: 0.06, amount: 0.1 } },
  plasterRose: { noise: { scale: 0.8, amount: 0.1, octaves: 4 }, grime: { height: 1, amount: 0.3, color: '#5a3a3a' }, bump: { scale: 0.06, amount: 0.1 } },
  stone: { noise: { scale: 0.35, amount: 0.16, octaves: 4 }, grime: { height: 0.5, amount: 0.3, color: '#3a3428' }, wear: { amount: 0.35 } },
  paving: { noise: { scale: 0.5, amount: 0.14 }, grime: { height: 0.05, amount: 0.22, ao: 0.6 } },
  slabs: { tex: { kind: 'tiles', su: 0.62, sv: 0.62, offset: 0.5, grout: 0.022, color: '#cdb08a', color2: '#8a7058', jitter: 0.16, pillow: 0.1 }, noise: { scale: 0.8, amount: 0.1 }, grime: { height: 0.05, amount: 0.18, ao: 0.6 } },
  cobble: { tex: { kind: 'tiles', su: 0.3, sv: 0.17, offset: 0.5, grout: 0.022, color: '#c9a07c', color2: '#6e5844', jitter: 0.34, pillow: 0.5 }, noise: { scale: 0.9, amount: 0.12 }, grime: { height: 0.05, amount: 0.2, ao: 0.6 } },
  wood: { noise: { scale: 0.3, amount: 0.1 }, wear: { amount: 0.3, color: '#c89a68' } },
  parquet: { tex: { kind: 'planks', color: '#6e3f22', color2: '#9a5e34', w: 0.17, len: 1.5 }, noise: { scale: 1.2, amount: 0.08 } },
  rose: { tex: { kind: 'stripes', colors: ['#d4949c', '#e5b2b0'], w: 0.17 }, noise: { scale: 1.1, amount: 0.05 }, grime: { height: 0.4, amount: 0.12 } },
  blue: { tex: { kind: 'stripes', colors: ['#5f78a8', '#7590bd'], w: 0.15 }, noise: { scale: 1.1, amount: 0.05 }, grime: { height: 0.4, amount: 0.12 } },
};

/** Сцена Kontur из описания: { camera3d, items, seed, lighting, style, materials }. */
export function makeScene(def) {
  const { S, errors } = buildWorld({ width: W, height: H, camera3d: def.camera3d, seed: def.seed ?? 3, items: def.items, sky: def.sky, occ: 'auto' });
  if (errors.length) console.warn(`[${def.name}] ошибки предметов:\n  ${errors.join('\n  ')}`);
  const scene = toScene(S, { name: def.title, lighting: def.lighting || { preset: 'golden' }, ...(def.style ? { style: def.style } : {}), materials: { ...MATS, ...(def.materials || {}) } });
  return { scene, errors };
}

/* ---------- маленькие построители повторяющихся групп ---------- */
/** Ряд окон на фасаде-стене z (on.wall): xs — левые края, ys — низы. */
export const windows = (wall, xs, ys, o = {}) => xs.flatMap((a) => ys.map((b) => ({ type: 'window', on: { wall }, a, b, w: o.w ?? 0.9, h: o.h ?? 1.3, shut: o.shut ?? '#3f8a7a', lit: o.lit?.(a, b) ?? false, box: o.box?.(a, b) ?? false })));
/** Горшки с цветами вдоль линии. */
export const pots = (list) => list.map(([X, Z, plant = 'hydrangea', flower, Y = 0]) => ({ type: 'pot', X, Z, Y, plant, ...(flower ? { flower } : {}) }));
