// Референс 3: лавка тканей — розовые полосатые обои, стеллажи с рулонами, лестница-стремянка, галерея с отрезами
// ткани на перилах, прилавок с фиолетовой дорожкой, подвесные лампы, свет из окна пятнами на паркете,
// красный ковёр с ромбами, круглый столик и зеркало. Без персонажей.
const Hh = 5, Zb = 9, X0 = -7.5, X1 = 7.5;   // высота потолка, задняя стена, боковые стены
const back = [X0, X1, Zb - 0.01, Hh];          // рамка задней стены (a — от левого края)
const left = [[X0, 0, 0], [X0, 0, Zb], [X0, Hh, Zb], [X0, Hh, 0]];
const right = [[X1, 0, 0], [X1, 0, Zb], [X1, Hh, Zb], [X1, Hh, 0]];
const ceil = [[X0, Hh, 0], [X1, Hh, 0], [X1, Hh, Zb], [X0, Hh, Zb]];
const hole = (z0, z1, y0, y1) => [[X0, y0, z0], [X0, y0, z1], [X0, y1, z1], [X0, y1, z0]];
const OUT = 500; // ключ глубины для улицы за окном: рисуется раньше комнаты
const mull = (z0, z1, y0, y1) => ({ type: 'box', x: [X0 - 0.05, X0 + 0.03], y: [y0, y1], z: [z0, z1], color: '#f4ead0' });

const items = [
  // улица за окном и дверью
  { type: 'ground', key: OUT, x: [-24, X0], z: [0, 30], mat: false, color: '#c9a07c', pmat: 'cobble' },
  { type: 'wall', key: OUT, ps: [[-22, 0, 0], [-22, 0, 40], [-22, 6, 40], [-22, 6, 0]], color: '#efd2a2', pmat: 'plaster', ink: false },

  // комната: пол, стены (окно и дверь — вырезы в левой стене), потолок с балками, панели
  { type: 'ground', x: [X0, X1], z: [0, Zb], mat: false, color: '#7a4526', pmat: 'parquet', spec: 0.45 },
  { type: 'wall', ps: [[X0, 0, Zb], [X1, 0, Zb], [X1, Hh, Zb], [X0, Hh, Zb]], color: '#dc9ea4', pmat: 'rose' },
  { type: 'wall', key: Zb + 0.5, ps: left, holes: [hole(5.0, 7.2, 0.9, 3.3), hole(7.6, 8.7, 0, 2.4)], color: '#dc9ea4', pmat: 'rose' },
  { type: 'wall', key: Zb + 0.5, ps: right, color: '#dc9ea4', pmat: 'rose' },
  { type: 'wall', ps: ceil, color: '#4a2c1a', pmat: 'wood', ink: false, key: Zb + 1 },
  ...[2.2, 4.2, 6.2, 8.2].map((z) => ({ type: 'box', x: [X0, X1], y: [Hh - 0.3, Hh], z: [z, z + 0.3], color: '#5a361f', pmat: 'wood' })),
  { type: 'box', x: [X0, X1], y: [0, 0.95], z: [Zb - 0.06, Zb], color: '#6e3f22', mats: { front: ['panels', '#6e3f22', { pw: 0.9 }] } },
  // переплёт окна — он же даёт узор солнечного пятна на полу
  mull(6.05, 6.13, 0.9, 3.3), mull(5.0, 7.2, 2.06, 2.13), mull(5.5, 5.55, 0.9, 3.3), mull(6.62, 6.67, 0.9, 3.3),
  { type: 'curtain', x: [X0 + 0.02, X0 + 0.5], y: [0, 3.6], z: 4.8, color: '#7a3a8a', tie: 0.45 },

  // стеллажи слева: рулоны тканей и банки
  { type: 'shelf', x: [-5.4, -2.0], z: Zb, h: 3.6, rows: 8, depth: 0.5, fill: 'rolls', color: '#6e4026' },
  { type: 'ladder', X: -1.85, Z: Zb - 0.15, h: 3.7, lean: 0.55 },
  { type: 'shelf', x: [-1.6, 0.5], z: Zb, h: 3.3, rows: 7, depth: 0.42, fill: 'jars', color: '#6e4026' },
  { type: 'shelf', x: [-7.2, -5.8], z: Zb, y0: 1.2, h: 1.6, rows: 3, depth: 0.3, fill: 'books', color: '#6e4026' },
  { type: 'frame', on: { wall: back }, a: 0.5, b: 3.15, w: 0.75, h: 0.95, art: 'portrait' },
  { type: 'clock', on: { wall: back }, a: 8.2, b: 3.85, r: 0.3 },

  // галерея справа: настил, столбы, перила с отрезами ткани, ящики сверху
  { type: 'box', x: [0.9, X1], y: [2.7, 2.95], z: [6.7, Zb], color: '#6e4026', pmat: 'wood' },
  { type: 'box', x: [0.9, 1.15], y: [0, 2.7], z: [6.7, 6.95], color: '#5a361f', pmat: 'wood' },
  { type: 'box', x: [4.5, 4.75], y: [0, 2.7], z: [6.7, 6.95], color: '#5a361f', pmat: 'wood' },
  { type: 'railing', from: [0.9, 2.95, 6.75], to: [X1, 2.95, 6.75], kind: 'wood', h: 0.95, color: '#6e4026' },
  { type: 'hangingCloths', x: [1.3, 7.2], y: 3.88, z: 6.65, colors: ['#b860a8', '#3aa0a0', '#c83a3a', '#e0b040', '#e888a8', '#5a8ad0'], drop: 1.25, w: 0.5 },
  { type: 'shelf', x: [1.3, 7.2], z: Zb, y0: 2.95, h: 1.4, rows: 2, depth: 0.35, fill: 'boxes', color: '#6e4026' },
  { type: 'drawerCabinet', x: [1.6, 4.2], y: [0, 1.6], z: [Zb - 0.5, Zb], rows: 4, cols: 5, color: '#6e4026' },
  { type: 'shelf', x: [1.5, 4.3], z: Zb, y0: 1.65, h: 0.85, rows: 1, depth: 0.3, fill: 'jars', color: '#6e4026' },
  { type: 'door', on: { wall: back }, a: 12.6, w: 1.1, h: 2.2, color: '#5a361f' },
  { type: 'sign', on: { wall: back }, a: 12.55, b: 2.3, w: 1.2, h: 0.3, text: 'СКЛАД', color: '#3a2418', textColor: '#f4ead0' },

  // прилавок, ковёр, столик, зеркало
  { type: 'counter', x: [-1.6, 2.4], z: [4.5, 5.3], h: 1.02, color: '#6e4026', cloth: '#5a2a7a' },
  { type: 'rug', X: -0.8, Z: 2.5, w: 6.6, d: 2.4, color: '#b83228', border: '#e3a647', pattern: 'diamond' },
  { type: 'rug', X: 4.9, Z: 3.9, w: 2.8, d: 1.8, round: true, color: '#3a6ea8', border: '#24487a' },
  { type: 'table', X: 4.8, Z: 4.1, r: 0.5, cloth: '#5a2a7a', fringe: '#e3a647' },
  { type: 'stool', X: 5.6, Z: 3.4, cushion: '#5a2a7a' },
  { type: 'mirror', X: 6.6, Z: 4.4, h: 2, w: 0.8 },
  { type: 'hydrangea', X: 4.8, Z: 4.1, Y: 0.8, r: 0.26, heads: 3, flower: '#f4f0f4' },

  // вешалка с тканями у окна, корзина с клубками, растения
  { type: 'box', x: [-6.9, -5.3], y: [1.9, 1.95], z: [4.4, 4.45], color: '#c8a040' },
  { type: 'hangingCloths', x: [-6.85, -5.35], y: 1.92, z: 4.38, colors: ['#3aa0a0', '#e0b040', '#c83a3a', '#8a5ab8', '#e888a8'], drop: 1.5, w: 0.28 },
  { type: 'lathe', X: -2.6, Z: 1.9, profile: 'pot', h: 0.3, r: 0.3, color: '#b08850', top: '#6a4a2a' },
  { type: 'sphere', X: -2.75, Y: 0.36, Z: 1.9, R: 0.12, color: '#d84040' },
  { type: 'sphere', X: -2.45, Y: 0.36, Z: 1.95, R: 0.12, color: '#3aa0a0' },
  { type: 'sphere', X: -2.6, Y: 0.4, Z: 2.1, R: 0.12, color: '#e0b040' },
  { type: 'pot', X: -6.8, Z: 8.4, plant: 'bush' },
  { type: 'hangingPlant', X: -6.4, Y: 4.6, Z: 8.4, r: 0.3 },
  { type: 'pot', X: -1.1, Z: 4.9, Y: 1.02, h: 0.25, r: 0.12, plant: 'lavender' },

  // свет: подвесные лампы, гирлянда флажков
  { type: 'pendantLamp', X: -3.4, Y: Hh - 0.3, Z: 5.2, drop: 1.3, color: '#c89a40', radius: 5, energy: 1.4 },
  { type: 'pendantLamp', X: 0.4, Y: Hh - 0.3, Z: 6.0, drop: 1.2, color: '#2f5a6a', radius: 5, energy: 1.4 },
  { type: 'pendantLamp', X: 3.8, Y: Hh - 0.3, Z: 7.6, drop: 0.8, color: '#8a2a2a', radius: 4.5, energy: 1.2 },
  { type: 'bunting', from: [X0 + 0.1, 4.55, Zb - 0.15], to: [X1 - 0.1, 4.55, Zb - 0.15], sag: 0.3, size: 0.26, spacing: 0.48 },
];

export default {
  name: 'fabric', title: 'Лавка тканей',
  camera3d: { hor: 470, f: 820, camH: 1.8, dz: 2 },
  sky: ['#8fb4e0', '#f6dcb4', '#ffe6c0'],
  items,
  lighting: {
    preset: 'golden', sun: { dir: [-0.8, 0.42, 0.42], energy: 3.4, angle: 1.2 }, sky: { energy: 0.36 }, ground: { energy: 0.24 },
    groups: { lamp: 1.2, fairy: 0.8 }, exposure: 1.1, fog: { density: 0 }, gi: { strength: 0.9, radius: 2 },
    volumetric: { density: 0.012, maxDist: 12, steps: 16, lamps: 0.3, g: 0.45 },
  },
};
