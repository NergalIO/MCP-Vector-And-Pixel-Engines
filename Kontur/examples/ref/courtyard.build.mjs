// Референс 2: двор с фонтаном — аркада с галереей и знаменем, ниша с книгами, дверь «Концерты»,
// лестница с перилами слева, лавка «Фрукты» под деревянным балконом справа, открытый люк с ограждением.
import { pots } from './common.mjs';

const G = 3.6; // уровень галереи
const wall = '#e7c79a', wallZ = 15;
const items = [
  { type: 'ground', x: [-24, 24], z: [0, 40], mat: false, color: '#c09a78', pmat: 'cobble', spec: 0.25 },

  // аркада: три арки и простенки
  { type: 'arch', x: [-6.6, -3.4], z: wallZ, spring: 1.8, thick: 0.5, top: G, color: wall, mat: null, back: null, pmat: 'plaster' },
  { type: 'arch', x: [-1.6, 1.6], z: wallZ, spring: 1.8, thick: 0.5, top: G, color: wall, mat: null, back: null, pmat: 'plaster' },
  { type: 'arch', x: [3.4, 6.6], z: wallZ, spring: 1.8, thick: 0.5, top: G, color: wall, mat: null, back: null, pmat: 'plaster' },
  ...[[-10, -7.05], [-2.95, -2.05], [2.05, 2.95], [7.05, 10]].map(([a, b]) => ({ type: 'box', x: [a, b], y: [0, G], z: [wallZ, wallZ + 0.5], color: wall, pmat: 'plaster' })),
  // ниша с книгами и скамьёй (левая арка), дверь «Концерты» (правая), проход с улицей (центр)
  { type: 'box', x: [-7.2, -2.8], y: [0, G], z: [16.4, 16.6], color: '#d9b48a', pmat: 'plaster' },
  { type: 'shelf', x: [-6.1, -3.9], z: 16.4, h: 2, depth: 0.3, rows: 4, fill: 'books', color: '#8a5a34' },
  { type: 'box', x: [-6.2, -3.8], y: [0, 0.45], z: [15.7, 16.3], color: '#b07848', pmat: 'wood' },
  { type: 'box', x: [2.8, 7.2], y: [0, G], z: [16.4, 16.6], color: '#e6a7a2', pmat: 'plasterRose' },
  { type: 'door', on: { wall: [2.8, 7.2, 16.39, G] }, a: 1.65, w: 1.1, h: 2.1, color: '#6a4a8a' },
  { type: 'sign', on: { wall: [2.8, 7.2, 16.38, G] }, a: 1.1, b: 2.35, w: 2.2, h: 0.42, text: 'КОНЦЕРТЫ', color: '#f4ead0', textColor: '#a0302a' },
  { type: 'frame', on: { wall: [2.8, 7.2, 16.38, G] }, a: 3.0, b: 0.9, w: 0.6, h: 0.8, art: 'portrait' },
  { type: 'house', x: [-5, 5], z: [24, 27], h: 9, color: '#f0d0a0', mat: 'none', pmat: 'plaster', litP: 0.5, roof: '#c0573a' },
  { type: 'house', x: [-12, -5.2], z: [21, 25], h: 7.5, color: '#e6b4a0', mat: 'none', pmat: 'plasterRose', litP: 0.5, roof: '#b9503a' },
  { type: 'house', x: [5.2, 12], z: [21, 25], h: 8, color: '#f0dc9c', mat: 'none', pmat: 'plaster', litP: 0.5, roof: '#c0573a' },

  // галерея над аркадой
  { type: 'box', x: [-10, 10], y: [G, G + 0.25], z: [13.9, wallZ + 0.5], color: '#d8bf98', pmat: 'stone' },
  { type: 'railing', from: [-10, G + 0.25, 14], to: [10, G + 0.25, 14], kind: 'baluster', color: '#e8d8b8' },
  { type: 'column', X: -2.5, Z: 14.05, Y: G + 0.25, h: 1.05, r: 0.2 },
  { type: 'column', X: 2.5, Z: 14.05, Y: G + 0.25, h: 1.05, r: 0.2 },
  { type: 'lamp', X: -2.5, Y: G + 1.3, Z: 14.05, h: 0.9, style: 'simple' },
  { type: 'lamp', X: 2.5, Y: G + 1.3, Z: 14.05, h: 0.9, style: 'simple' },
  { type: 'banner', X: 0, y: [1.7, G + 0.2], z: 13.95, w: 1.15, color: '#b03028', emblem: '#f0c030' },
  ...[-6.5, -4.5, 4.5, 6.5].map((X) => ({ type: 'hangingPlant', X, Y: G + 0.1, Z: 13.8, r: 0.28 })),
  { type: 'house', x: [-10.5, 10.5], z: [wallZ + 0.6, 19], y0: G + 0.25, h: 6.4, color: '#efd2a2', mat: 'none', pmat: 'plaster', litP: 0.45, roof: '#c0573a', shut: '#3f8a7a' },

  // слева: дом и лестница с перилами вдоль него
  { type: 'house', key: 30, x: [-24, -9.6], z: [-1, 16], h: 11.5, color: '#eccb9c', mat: 'none', pmat: 'plaster', facades: ['right'], litP: 0.4, roof: '#c0573a', shut: '#3f8a7a' },
  { type: 'stairsWalled', x: [-9.5, -7.6], z: [4.6, 13.8], h: G + 0.25, wall: 0.3, wallH: 0.9, rail: true, lights: false, color: '#dcc6a4' },
  ...pots([[-7.2, 7, 'hydrangea', '#e070a0'], [-7.2, 9.4, 'bush'], [-7.2, 11.6, 'flowers']]),
  { type: 'lamp', X: -6.8, Z: 4.4, h: 3.2 },
  { type: 'crate', X: -5.6, Z: 2.4, stack: 2, content: '#e8d070' },
  { type: 'pot', X: -5.6, Z: 2.2, Y: 1.0, plant: 'hydrangea', flower: '#e88aa8' },
  { type: 'crate', X: -4.5, Z: 1.8, stack: 1, content: '#d8a040' },

  // справа: лавка «Фрукты» под деревянным балконом
  { type: 'house', x: [6.2, 24], z: [7.2, 18], h: 10.5, color: '#eab0a4', mat: 'none', pmat: 'plasterRose', facades: ['front'], litP: 0.45, roof: '#b9503a', doorAt: 3.6 },
  { type: 'box', x: [5.2, 16], y: [G - 0.25, G], z: [4.8, 7.2], color: '#8a5a34', pmat: 'wood' },
  ...[5.4, 9.2, 13.6].map((x) => ({ type: 'box', x: [x - 0.12, x + 0.12], y: [0, G - 0.25], z: [4.9, 5.14], color: '#8a5a34', pmat: 'wood' })),
  { type: 'railing', from: [5.2, G, 4.85], to: [16, G, 4.85], kind: 'wood', h: 1 },
  ...pots([[6.2, 5.4, 'hydrangea', '#f0f0f0', G], [7.6, 5.4, 'flowers', null, G], [10.4, 5.4, 'bush', null, G]]),
  { type: 'awning', x: [6.4, 9.6], z: 7.15, y: 2.4, depth: 0.9, drop: 0.35, colors: ['#d64a3c', '#f4ead0'] },
  { type: 'sign', on: { wall: [6.2, 24, 7.18, 6] }, a: 4.4, b: 2.1, w: 2.4, h: 0.55, text: 'ФРУКТЫ', color: '#f4ead0', textColor: '#a0302a' },
  { type: 'crate', X: 6.9, Z: 6.5, stack: 1, content: '#f0c838' },
  { type: 'crate', X: 7.7, Z: 6.6, stack: 1, content: '#d04030' },
  { type: 'crate', X: 8.5, Z: 6.5, stack: 1, content: '#80b040' },
  { type: 'sign', at: [5.0, 0.55, 5.6], w: 0.6, h: 0.85, text: 'МЕНЮ', size: 0.13, color: '#2a2a2a', textColor: '#f4f0e8' },
  { type: 'bench', X: 5.4, Z: 2.6, len: 1.6 },
  { type: 'pot', X: 6.4, Z: 1.8, plant: 'hydrangea', flower: '#f4f4f0' },

  // фонтан
  { type: 'fountain', X: 0, Z: 8.6, r: 2.1, tiers: 2 },

  // открытый люк с ограждением, решётка, лужи
  { type: 'disc', X: -1.4, Y: 0.004, Z: 3.4, rx: 1.15, color: '#a89880', base: true, spec: 0.2 },
  { type: 'disc', X: -1.4, Y: 0.008, Z: 3.4, rx: 0.9, color: '#16120e', base: true, spec: 0 },
  { type: 'stanchions', points: [[-2.9, 3.4], [-2.4, 2.4], [-1.4, 2], [-0.4, 2.4], [0.1, 3.4]], h: 0.6, color: '#e07030', rope: '#f0e8e0' },
  { type: 'sign', at: [0.6, 0.45, 2.6], w: 0.5, h: 0.5, text: '!', size: 0.32, color: '#f0c030', textColor: '#2a2a2a' },
  { type: 'grate', X: 2.4, Z: 2.2, w: 0.8, d: 0.4 },
  { type: 'manhole', X: 4.2, Z: 4.4, r: 0.42 },
  { type: 'disc', X: 1.4, Y: 0.004, Z: 1.6, rx: 0.7, rz: 0.35, color: '#8ea4c0', spec: 1, wob: true, opacity: 0.45 },

  // гирлянды
  { type: 'bunting', from: [-9.6, 8, 3], to: [16, 8.4, 4.8], sag: 1.2, size: 0.42, spacing: 0.55 },
  { type: 'stringLights', from: [-9.6, 7.2, 4], to: [16, 7.6, 5], sag: 1.1 },
  { type: 'stringLights', from: [-10, G + 2.6, 14.2], to: [10, G + 2.6, 14.2], sag: 0.5 },
  { type: 'scatter', x: [-6, 6], z: [0.6, 6], count: 35, kinds: ['leaf', 'petal'] },
];

export default {
  name: 'courtyard', title: 'Двор с фонтаном',
  camera3d: { hor: 470, f: 660, camH: 3, dz: 2 },
  sky: ['#6f9ad8', '#f2c9a0', '#ffd9a0'],
  items,
  lighting: { preset: 'golden' },
};
