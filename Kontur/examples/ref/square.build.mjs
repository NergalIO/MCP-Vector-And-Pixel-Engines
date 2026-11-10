// Референс 1: «Площадь Даров» — нижняя площадь, подпорная стена с лестницей по центру, терраса с лавками
// «Лавка шёлка», «Ткани», «Почта», боковая лестница к «Рынку по-деликатески», указатели, гирлянды. Без персонажей.
import { windows, pots } from './common.mjs';

const T = 1.8; // высота террасы
const items = [
  // земля: нижняя площадь и терраса
  { type: 'ground', x: [-24, 24], z: [0, 5.2], mat: false, color: '#c2a27c', pmat: 'slabs', spec: 0.2 },
  { type: 'ground', x: [-24, 24], y: T, z: [5.2, 40], mat: false, color: '#cbb08a', pmat: 'slabs', spec: 0.2 },
  // подпорная стена террасы с нишей под лестницу
  { type: 'box', x: [-14, -1.4], y: [0, T], z: [5.2, 5.6], color: '#c8ad86', mats: { front: ['stone', '#c8ad86', { bh: 0.3 }] }, pmat: 'stone' },
  { type: 'box', x: [1.4, 7.4], y: [0, T], z: [5.2, 5.6], color: '#c8ad86', mats: { front: ['stone', '#c8ad86', { bh: 0.3 }] }, pmat: 'stone' },
  { type: 'stairsWalled', x: [-1.4, 1.4], z: [2.6, 5.4], h: T, wall: 0.4, wallH: 0.8, color: '#d8c4a2', lights: true },
  { type: 'railing', from: [-9.6, T, 5.4], to: [-1.9, T, 5.4], kind: 'iron', h: 0.9 },
  { type: 'railing', from: [1.9, T, 5.4], to: [7.2, T, 5.4], kind: 'iron', h: 0.9 },
  // на стене справа от лестницы — стенды с картинками и скамья
  { type: 'frame', on: { wall: [1.4, 6.4, 5.19, T] }, a: 0.6, b: 0.55, w: 0.9, h: 0.7, art: 'text' },
  { type: 'frame', on: { wall: [1.4, 6.4, 5.19, T] }, a: 1.7, b: 0.5, w: 1.1, h: 0.8, art: 'landscape' },
  { type: 'bench', X: 3.6, Z: 4.7, len: 1.7 },
  { type: 'crate', X: 5.6, Z: 4.6, stack: 2, content: '#e3a647' },

  // левый ближний дом (боковой фасад к площади)
  { type: 'house', key: 30, x: [-22, -9.8], z: [-1, 10], h: 10.4, color: '#e9c9a0', mat: 'none', pmat: 'plaster', facades: ['right'], roof: '#c0573a', litP: 0.3, shut: '#3f7a8a' },
  { type: 'sign', at: [-3.6, 1.2, 5.15], w: 2.3, h: 0.5, text: 'ПЛОЩАДЬ ДАРОВ', color: '#2f4e8a', textColor: '#f4ead0' },
  { type: 'ivy', on: { wall: [-13.5, -2.4, 10.97, 8, T] }, a: 0.2, b: 0, w: 1.6, h: 5.5 },
  { type: 'ivy', on: { wall: [2.4, 10.6, 10.37, 8, T] }, a: 6.6, b: 0, w: 1.4, h: 5 },
  { type: 'lamp', X: -5.4, Z: 3.4, h: 3.6 },

  // терраса: розовый дом с лавками
  { type: 'house', x: [-13.5, -2.4], z: [11, 15], y0: T, h: 7.4, color: '#e6a7a2', mat: 'none', pmat: 'plasterRose', roof: '#b9503a', doorAt: 7.6, litP: 0.4, shut: '#4a7aa0' },
  { type: 'awning', x: [-12.4, -9], z: 10.95, y: T + 2.9, depth: 1.1, drop: 0.45, colors: ['#d64a3c', '#f4ead0'] },
  { type: 'sign', on: { wall: [-13.5, -2.4, 10.98, 8, T] }, a: 1.1, b: 2.3, w: 3.2, h: 0.62, text: 'ЛАВКА ШЁЛКА', color: '#f4ead0', textColor: '#7a2a24' },
  { type: 'sign', on: { wall: [-13.5, -2.4, 10.98, 8, T] }, a: 4.6, b: 2.32, w: 2.2, h: 0.58, text: 'ТКАНИ', color: '#8a4a9a', textColor: '#f4ead0' },
  { type: 'table', X: -10.6, Z: 8.4, r: 0.45, h: 0.75, cloth: '#3f7a9a', fringe: '#f4ead0', Y: T },
  { type: 'planter', x: [-5.8, -3.4], z: [8.6, 9.2], h: 0.55, flowers: ['#e070a0', '#f4d040'] },
  // центр: вторая лестница и дом наверху
  { type: 'stairs', x: [-1.2, 1.2], z: [9, 12.6], h: 2.2, y0: T, color: '#dccab0', mat: 'none', pmat: 'stone' },
  { type: 'box', x: [-1.9, -1.2], y: [T, T + 2.4], z: [9, 12.6], color: '#cdb594', pmat: 'stone' },
  { type: 'box', x: [1.2, 1.9], y: [T, T + 2.4], z: [9, 12.6], color: '#cdb594', pmat: 'stone' },
  { type: 'house', x: [-3.4, 3.4], z: [16, 19], y0: T + 2.2, h: 7, color: '#f1d9a8', mat: 'none', pmat: 'plaster', doorAt: 3, litP: 0.3, roof: '#c0573a' },
  // правый дом «Почта»
  { type: 'house', x: [2.4, 10.6], z: [10.4, 14], y0: T, h: 6.8, color: '#f0dc8c', mat: 'none', pmat: 'plaster', doorAt: 1.6, roof: '#c0573a', litP: 0.5, shut: '#3f6aa0' },
  { type: 'sign', on: { wall: [2.4, 10.6, 10.38, 8, T] }, a: 3.1, b: 2.32, w: 2.4, h: 0.58, text: 'ПОЧТА', color: '#2f5a9a', textColor: '#f4ead0' },
  { type: 'postbox', X: 5.6, Z: 9.6, Y: T, h: 1.2, text: '' },
  ...pots([[-1.9, 8.6, 'hydrangea', null, T], [1.9, 8.6, 'bush', null, T], [7.6, 9.2, 'lavender', null, T]]),

  // правая лестница вдоль стены к «Рынку»
  { type: 'stairsWalled', x: [7.8, 10.8], z: [6.2, 10.4], y0: T, h: 1.6, wall: 0.35, wallH: 0.8, color: '#d8c4a2', lights: true },
  { type: 'box', x: [7.4, 11.2], y: [0, T], z: [5.2, 5.6], color: '#c8ad86', mats: { front: ['stone', '#c8ad86', { bh: 0.3 }] }, pmat: 'stone' },
  { type: 'house', key: 30, x: [11.2, 22], z: [1, 15], y0: 0, h: 11, color: '#e9b49a', mat: 'none', pmat: 'plasterRose', facades: ['left'], roof: '#b9503a', litP: 0.4 },
  { type: 'sign', at: [9.6, 4.9, 7.6], w: 2.3, h: 0.8, text: 'РЫНОК ПО-ДЕЛИКАТЕСКИ', size: 0.24, color: '#f4ead0', textColor: '#7a2a24' },
  { type: 'lamp', X: 5.9, Z: 4.2, h: 3.4 },

  // указатели и вывеска «Небо»
  { type: 'signpost', X: 3.9, Z: 2.9, h: 3.1, arrows: [{ text: 'ПЛОЩАДЬ ДАРОВ', dir: -1, color: '#f4ead0' }, { text: 'РЫНОК', dir: 1, color: '#e3a647' }, { text: 'ПОЧТА', dir: -1, color: '#f4ead0' }, { text: 'ТКАНИ', dir: 1, color: '#e98aa6' }] },
  { type: 'sign', at: [4.6, 4.3, 8.4], w: 0.5, h: 1.3, text: 'НЕБО', size: 0.2, color: '#2f5a9a', textColor: '#f4ead0' },

  // нижняя площадь: тележка, ящики, урна, горшки, бочка, люк, классики
  { type: 'cart', X: -5, Z: 4.3, len: 1.9, load: 'crates' },
  { type: 'crate', X: -2.9, Z: 3.6, stack: 1, content: '#c04030' },
  { type: 'bin', X: -5.6, Z: 1.8, r: 0.24, h: 0.95, color: '#2f7a62' },
  ...pots([[-6.6, 4.4], [-4.6, 1.2, 'hydrangea', '#9a7ad0'], [5.6, 2.4, 'hydrangea', '#a080e0'], [-3.4, 4.9, 'lavender']]),
  { type: 'barrel', X: 6.2, Z: 3.6, h: 1, r: 0.42, water: true },
  { type: 'manhole', X: -1.6, Z: 1.5, r: 0.45 },
  { type: 'chalk', X: 2.4, Z: 1.6 },

  // гирлянды над площадью
  { type: 'bunting', from: [-9.8, 6.6, 3], to: [11.2, 7.2, 6], sag: 1.2 },
  { type: 'bunting', from: [-9.8, 8.6, 8], to: [11.2, 9.2, 12], sag: 1 },
  { type: 'stringLights', from: [-9.8, 5.8, 2], to: [11.2, 6.2, 5], sag: 1 },
  { type: 'scatter', x: [-9, 9], z: [0.5, 5], count: 50, kinds: ['leaf', 'petal', 'paper'] },
];

export default {
  name: 'square', title: 'Площадь Даров',
  camera3d: { hor: 470, f: 660, camH: 3, dz: 2 },
  sky: ['#6f9ad8', '#f2c9a0', '#ffd9a0'],
  items: [...items, ...windows([-3, 3, 15.98, 6, T + 2.2], [], [])],
  lighting: { preset: 'golden' },
};
