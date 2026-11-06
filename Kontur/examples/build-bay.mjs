// Сцена «Ремонтный отсек орбитальной станции» — фон для point-and-click игры.
// node examples/build-bay.mjs  → examples/bay.json
import { writeFileSync } from 'node:fs';
import { createScene, ops, validateScene } from '../engine/kontur.js';

const W = 1920, H = 1080, DUR = 8;
const s = createScene({ width: W, height: H, duration: DUR, fps: 60, background: '#3c4a5c' });
// Дизеринг теней: выключен по умолчанию, включается одной настройкой (студия, MCP dither_set)
s.dither = { enabled: false, pattern: 'bayer4', cell: 3, density: 0.62, angle: 90 };
const SH = (o = true) => ({ shade: o }); // пометка «слой-тень»

// палитра
const C = {
  line: '#263040', wall: '#5b6b7e', panel: '#66788c', panelSh: '#4f5e70', panelHi: '#7f91a5',
  ceil: '#3a4656', gun: '#454f5c', gunSh: '#353e4a', pipe: '#71849a', pipeHi: '#97abc0', pipeSh: '#52627a',
  floor: '#4a5665', floorSh: '#3b4553', cyan: '#c4f4ff', glow: '#8fe8ff',
  yellow: '#f2c14e', yellowSh: '#c99a30', rust: '#c8623a', rustSh: '#96472a', wood: '#a8703f',
  space: '#121a36',
};
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const wob = (amount = 2.2, sd = 0) => ({ type: 'deform', amount, scale: 0.012, speed: 0, seed: sd, detail: 10 });
const ink = (w = 5) => ({ stroke: C.line, strokeWidth: w, lineJoin: 'round' });
let n = 0;
const add = (o) => ops.addNode(s, { id: o.id || `n${++n}`, ...o });
/** прямоугольник по левому верхнему углу */
const box = (x, y, w, h, props = {}, extra = {}) => add({ type: 'rect', props: { x: x + w / 2, y: y + h / 2, width: w, height: h, ...props }, ...extra });

/* ---------------- стена и панели ---------------- */
box(0, 0, W, 834, { fill: C.wall });
const cols = 8, colW = W / cols;
for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
  const x = c * colW + 8, y = 100 + r * 340, w = colW - 16, h = 326;
  box(x, y, w, h, { fill: C.panel, radius: 10, ...ink(4) }, { mods: [wob(2.4, r * 10 + c)] });
  add({ type: 'path', props: { x: 0, y: 0, fill: C.panelSh, ...SH({ density: [0.35, 1], angle: 50 }),
    d: `M${x + w - 3} ${y + 14} L${x + w - 3} ${y + h - 10} Q${x + w - 3} ${y + h - 3} ${x + w - 10} ${y + h - 3} L${x + 14} ${y + h - 3} L${x + 22} ${y + h - 18} L${x + w - 18} ${y + h - 18} L${x + w - 18} ${y + 22}Z` } });
  // мазок-блик
  add({ type: 'path', props: { x: x + 26, y: y + 30, d: `M0 ${40 + rnd() * 30} C4 20 14 4 ${50 + rnd() * 40} 0`, stroke: C.panelHi, strokeWidth: 7, opacity: 0.45 } });
  // заклёпки сверху и снизу
  for (const ry of [y + 16, y + h - 16])
    add({ type: 'circle', props: { x: x + 20, y: ry, r: 5, fill: C.panelHi, ...ink(2.5), repeat: { count: 5, x: (w - 40) / 4 } } });
}
// живописная фактура: мягкие пятна
for (let i = 0; i < 14; i++) {
  add({ type: 'blob', props: { x: rnd() * W, y: 120 + rnd() * 640, radius: 60 + rnd() * 110, points: 7, amount: 0.35, speed: 0, seed: i,
    fill: i % 2 ? C.panelHi : C.panelSh, opacity: 0.16, blur: 22 } });
}
// плинтус
box(0, 776, W, 30, { fill: C.gunSh, ...ink(4) }, { mods: [wob(1.5, 3)] });

/* ---------------- потолок и светильник ---------------- */
box(-10, -10, W + 20, 100, { fill: C.ceil, ...ink(5) }, { mods: [wob(2, 4)] });
box(-10, 40, W + 20, 30, { fill: C.pipe, ...ink(4) }, { mods: [wob(1.5, 5)] });
box(-10, 44, W + 20, 8, { fill: C.pipeHi });
box(-10, 58, W + 20, 9, { fill: C.pipeSh, ...SH() });
for (let i = 0; i < 6; i++) box(120 + i * 340, 34, 26, 42, { fill: C.gun, radius: 4, ...ink(3) });
// подвесы светильника
for (const x of [640, 880]) box(x - 3, 88, 6, 26, { fill: C.gunSh, ...ink(2) });
box(570, 110, 380, 34, { fill: C.gun, radius: 8, ...ink(5) }, { mods: [wob(1.5, 8)] });
box(570, 130, 380, 14, { fill: C.gunSh, radius: 6, ...SH() });
// трубка — главный источник мерцания
const flicker = `
  const k = Math.floor(t * 14), r = Math.abs(Math.sin(k * 127.1) * 43758.5453) % 1;
  const c = t % 4;
  if ((c > 2.6 && c < 3.05) || (c > 3.2 && c < 3.32)) return r > 0.45 ? 1 : 0.18;
  return 0.94 + 0.06 * Math.sin(t * 60);`;
add({ id: 'tube', type: 'rect', props: { x: 760, y: 154, width: 340, height: 16, radius: 8, fill: C.cyan, ...ink(3), glow: { blur: 16, color: C.glow, strength: 0.9 } },
  mods: [{ type: 'expr', prop: 'opacity', code: flicker }] });
for (const x of [598, 922]) box(x - 7, 144, 14, 22, { fill: C.gun, radius: 3, ...ink(2) });

/* ---------------- трубы ---------------- */
const PIPE_RELIEF = { height: 0.55, depth: 0.4, bevel: 18, profile: 'round' };
function vpipe(x, y0, y1, w = 44, sd = 0) {
  box(x, y0, w, y1 - y0, { fill: C.pipe, ...ink(5), relief: PIPE_RELIEF }, { mods: [wob(2.5, sd)] });
  box(x + 8, y0 + 4, 9, y1 - y0 - 8, { fill: C.pipeHi, opacity: 0.9 });
  box(x + w - 15, y0 + 4, 11, y1 - y0 - 8, { fill: C.pipeSh, ...SH() });
}
function hpipe(x0, x1, y, h = 40, sd = 0) {
  box(x0, y, x1 - x0, h, { fill: C.pipe, ...ink(5), relief: PIPE_RELIEF }, { mods: [wob(2.5, sd)] });
  box(x0 + 4, y + 7, x1 - x0 - 8, 8, { fill: C.pipeHi, opacity: 0.9 });
  box(x0 + 4, y + h - 14, x1 - x0 - 8, 10, { fill: C.pipeSh, ...SH() });
}
const flangeV = (x, y, w = 44) => box(x - 8, y, w + 16, 22, { fill: C.gun, radius: 4, ...ink(4) });
const flangeH = (x, y, h = 40) => box(x, y - 8, 24, h + 16, { fill: C.gun, radius: 4, ...ink(4) });

vpipe(46, 86, 790, 44, 11); vpipe(104, 86, 790, 34, 12);
for (const y of [250, 520]) { flangeV(46, y); flangeV(104, y, 34); }
vpipe(1840, 86, 790, 40, 13); vpipe(1792, 86, 790, 30, 14);
for (const y of [330, 610]) { flangeV(1840, y, 40); flangeV(1792, y, 30); }
// горизонтальный пучок внизу
hpipe(130, 1080, 646, 40, 15);
hpipe(130, 1080, 698, 46, 16);
for (const x of [300, 760]) { flangeH(x, 646); }
box(1066, 636, 30, 116, { fill: C.gun, radius: 5, ...ink(4) }); // заглушка-ввод в стену
// протекающий стык
box(506, 686, 30, 72, { fill: C.rustSh, radius: 5, ...ink(4) }, { mods: [wob(1.5, 17)] });
box(510, 692, 10, 58, { fill: C.rust });
add({ type: 'path', props: { x: 521, y: 752, d: 'M-10 0 C-8 10 -3 14 0 22 C3 14 8 10 10 0Z', fill: C.rustSh, opacity: 0.8 } }); // ржавый подтёк
// вентиль с паром
add({ type: 'circle', props: { x: 900, y: 632, r: 26, fill: 'none', stroke: C.rust, strokeWidth: 8 } });
add({ type: 'circle', props: { x: 900, y: 632, r: 26, fill: 'none', ...ink(3), strokeWidth: 2 } });
box(896, 606, 8, 52, { fill: C.rustSh });
box(874, 628, 52, 8, { fill: C.rustSh });
box(890, 640, 20, 10, { fill: C.gun, ...ink(3) });
add({
  id: 'steam', type: 'blob',
  props: { x: 914, y: 600, radius: 24, points: 8, amount: 0.28, speed: 1.2, fill: '#d6e3ee', stroke: '#8fa3b8', strokeWidth: 3, repeat: { count: 5, delay: 0.6 } },
  mods: [
    { type: 'expr', props: ['y', 'x', 'scale', 'opacity'], code: `
      const c = (((t % 3) + 3) % 3) / 3;
      if (ctx.prop === 'y') return v - 170 * c;
      if (ctx.prop === 'x') return v + 30 * c + Math.sin(c * 6) * 8;
      if (ctx.prop === 'scale') return 0.3 + 1.4 * c;
      return c < 0.15 ? c / 0.15 * 0.8 : 0.8 * (1 - (c - 0.15) / 0.85);` },
  ],
});

/* ---------------- стенд с инструментами ---------------- */
box(260, 290, 380, 270, { fill: '#56677b', radius: 8, ...ink(5) }, { mods: [wob(2, 18)] });
box(268, 298, 364, 254, { fill: '#5f7185', radius: 6 });
for (let r = 0; r < 7; r++) add({ type: 'circle', props: { x: 285, y: 312 + r * 36, r: 3.5, fill: C.line, opacity: 0.55, repeat: { count: 12, x: 30 } } });
function tool(id, x, y, parts, phase) {
  add({ id, type: 'group', props: { x, y }, mods: [{ type: 'oscillate', prop: 'rotation', amp: 2.2, freq: 0.35, phase }] });
  for (const p of parts) add({ ...p, parent: id });
  add({ type: 'circle', props: { x, y, r: 5, fill: C.gun, ...ink(2) } });
}
// гаечный ключ
tool('wrench', 320, 322, [
  { type: 'rect', props: { x: 0, y: 95, width: 18, height: 140, radius: 9, fill: C.pipeHi, ...ink(4) } },
  { type: 'path', props: { x: 0, y: 22, d: 'M-26 -4 C-26 -26 26 -26 26 -4 C26 10 14 16 10 18 L8 2 L-8 2 L-10 18 C-14 16 -26 10 -26 -4Z', fill: C.pipeHi, ...ink(4) } },
  { type: 'rect', props: { x: 5, y: 95, width: 5, height: 120, radius: 2, fill: C.pipeSh, shade: true } },
], 0);
// молоток
tool('hammer', 400, 322, [
  { type: 'rect', props: { x: 0, y: 100, width: 18, height: 150, radius: 8, fill: C.wood, ...ink(4) } },
  { type: 'rect', props: { x: 5, y: 100, width: 6, height: 140, radius: 3, fill: '#7e5230' } },
  { type: 'rect', props: { x: 6, y: 26, width: 82, height: 32, radius: 6, fill: C.gun, ...ink(4) } },
  { type: 'rect', props: { x: 6, y: 36, width: 76, height: 8, radius: 3, fill: C.gunSh, shade: true } },
], 70);
// отвёртки
for (const [i, col, sh] of [[0, C.rust, C.rustSh], [1, C.yellow, C.yellowSh]]) tool(`driver${i}`, 478 + i * 46, 322, [
  { type: 'rect', props: { x: 0, y: 38, width: 26, height: 62, radius: 10, fill: col, ...ink(4) } },
  { type: 'rect', props: { x: 7, y: 38, width: 7, height: 54, radius: 3, fill: sh, shade: true } },
  { type: 'rect', props: { x: 0, y: 118, width: 8, height: 92, radius: 3, fill: C.pipeHi, ...ink(3) } },
], 140 + i * 50);
// моток кабеля
tool('cable', 590, 330, [
  { type: 'circle', props: { x: 0, y: 46, r: 38, fill: 'none', stroke: C.line, strokeWidth: 15 } },
  { type: 'circle', props: { x: 0, y: 46, r: 38, fill: 'none', stroke: C.rust, strokeWidth: 9 } },
  { type: 'circle', props: { x: 0, y: 46, r: 24, fill: 'none', stroke: C.line, strokeWidth: 13 } },
  { type: 'circle', props: { x: 0, y: 46, r: 24, fill: 'none', stroke: C.rustSh, strokeWidth: 7 } },
], 230);

/* ---------------- иллюминатор ---------------- */
const PX = 1300, PY = 395;
add({ type: 'circle', props: { x: PX + 14, y: PY + 16, r: 242, fill: C.panelSh, ...SH({ density: 0.5 }) } }); // тень на стене
add({ type: 'circle', props: { x: PX, y: PY, r: 238, fill: C.gun, ...ink(6) }, mods: [wob(2.5, 30)] });
add({ type: 'circle', props: { x: PX, y: PY, r: 205, fill: '#6b7c90', ...ink(5) }, mods: [wob(2, 31)] });
add({ type: 'circle', props: { x: PX + 221, y: PY, r: 8, fill: C.pipeHi, ...ink(3), repeat: { count: 12, rotation: 30, cx: PX, cy: PY } } });
add({ id: 'glass', type: 'circle', props: { x: PX, y: PY, r: 186 } });
add({ id: 'view', type: 'group', props: { clip: 'glass', relief: { height: 0.18, depth: 0.04, profile: 'flat' } } }); // за стеклом — плоско и глубоко
add({ parent: 'view', type: 'rect', props: { x: PX, y: PY, width: 420, height: 420,
  fill: { type: 'radial', cx: 0, cy: -40, r: 260, stops: [[0, '#2a2f6a'], [0.6, C.space], [1, '#0b1026']] } } });
add({ parent: 'view', type: 'blob', props: { x: PX - 80, y: PY - 60, radius: 110, speed: 0.08, seed: 4, fill: '#7b4fb0', opacity: 0.35, blur: 24 } });
for (let i = 0; i < 26; i++) {
  const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * 180;
  add({ parent: 'view', type: 'circle', props: { x: PX + Math.cos(a) * rr, y: PY + Math.sin(a) * rr, r: 1.5 + rnd() * 2.2, fill: i % 5 ? '#e8f3ff' : C.yellow, opacity: 0.6 },
    mods: [{ type: 'oscillate', prop: 'opacity', amp: 0.35, freq: 0.25 + rnd() * 0.5, phase: rnd() * 360 }] });
}
// планета
add({ id: 'planet', parent: 'view', type: 'group', props: { x: PX + 70, y: PY + 80 }, mods: [{ type: 'oscillate', prop: 'y', amp: 4, freq: 0.125 }] });
add({ parent: 'planet', type: 'ellipse', props: { rx: 250, ry: 44, rotation: -14, fill: 'none', stroke: '#e9d6a2', strokeWidth: 9, opacity: 0.9 } });
add({ id: 'pclip', parent: 'planet', type: 'circle', props: { r: 150 } });
add({ id: 'pbody', parent: 'planet', type: 'group', props: { clip: 'pclip' } });
add({ parent: 'pbody', type: 'circle', props: { r: 152, fill: { type: 'radial', cx: -60, cy: -60, r: 230, stops: [[0, '#8fe6d2'], [0.45, '#3f8fd8'], [1, '#5a3a9a']] } } });
const bandPts = (y0, amp) => Array.from({ length: 25 }, (_, i) => [-600 + i * 50, y0 + amp * Math.sin((2 * Math.PI * (i * 50)) / 300)]);
const bands = [[-70, 14, C.rust, 0.55], [-10, 9, C.yellow, 0.5], [55, 12, '#f29e6b', 0.6], [105, 8, C.yellow, 0.4]];
bands.forEach(([y0, amp, col, op], i) => {
  const top = bandPts(y0, amp), bot = bandPts(y0 + 22 + i * 4, amp * 0.8).reverse();
  add({ parent: 'pbody', type: 'path', props: { points: [...top, ...bot], smooth: true, fill: col, opacity: op },
    mods: [{ type: 'expr', prop: 'x', code: `return v + ((t / ${DUR}) * ${i % 2 ? -300 : 300}) % 300;` }] });
});
add({ parent: 'pbody', type: 'circle', props: { x: 85, y: 75, r: 165, fill: '#1b2150', opacity: 0.55, ...SH({ density: [0.15, 1], angle: 40, cell: 4 }) } }); // теневая сторона
add({ parent: 'planet', type: 'circle', props: { r: 150, fill: 'none', ...ink(5) } });
add({ parent: 'planet', type: 'path', props: { rotation: -14, d: 'M-250 0 A250 44 0 0 0 250 0', fill: 'none', stroke: '#e9d6a2', strokeWidth: 9 } });
add({ parent: 'view', type: 'circle', props: { r: 20, fill: '#cfd3e0', ...ink(3.5) },
  mods: [{ type: 'orbit', cx: PX - 40, cy: PY - 40, radius: 120, radiusY: 60, speed: 1 / DUR, phase: 200 }] });
// блик стекла
add({ type: 'path', props: { x: PX, y: PY, d: 'M-150 -40 A158 158 0 0 1 -40 -150', fill: 'none', stroke: '#ffffff', strokeWidth: 14, opacity: 0.22 } });
add({ type: 'circle', props: { x: PX - 92, y: PY - 128, r: 7, fill: '#ffffff', opacity: 0.3 } });
add({ type: 'circle', props: { x: PX, y: PY, r: 186, fill: 'none', ...ink(6) } });

/* ---------------- правая стена: щиток и полка ---------------- */
box(1610, 190, 150, 120, { fill: C.panelSh, radius: 8, ...ink(5) }, { mods: [wob(1.8, 40)] });
box(1616, 196, 132, 104, { fill: '#6a7c90', radius: 6 });
box(1630, 214, 70, 46, { fill: '#2a3a46', radius: 5, ...ink(3) });
add({ id: 'screen', type: 'image', props: { x: 1665, y: 237, width: 64, height: 40, src: 'assets/screen-sheet.png', pixelated: true, sheet: { cols: 4, rows: 2, count: 8, fps: 8, frameWidth: 32, frameHeight: 20 } } });
add({ id: 'led', type: 'circle', props: { x: 1725, y: 226, r: 9, fill: C.yellow, ...ink(3), glow: { blur: 10, color: C.yellow, strength: 0.9 } },
  mods: [{ type: 'expr', prop: 'opacity', code: 'return (t * 1.25) % 1 < 0.45 ? 1 : 0.2;' }] });
add({ type: 'circle', props: { x: 1725, y: 258, r: 9, fill: C.rust, ...ink(3) } });
box(1626, 276, 112, 14, { fill: C.yellow, radius: 3 });
add({ type: 'path', props: { x: 1626, y: 276, d: 'M8 0 L20 0 L12 14 L0 14Z M36 0 L48 0 L40 14 L28 14Z M64 0 L76 0 L68 14 L56 14Z M92 0 L104 0 L96 14 L84 14Z', fill: C.line } });
// кабель из щитка
add({ type: 'path', props: { x: 0, y: 0, d: 'M1690 310 C1690 360 1640 380 1600 420', fill: 'none', stroke: C.line, strokeWidth: 11 } });
add({ type: 'path', props: { x: 0, y: 0, d: 'M1690 310 C1690 360 1640 380 1600 420', fill: 'none', stroke: C.gunSh, strokeWidth: 5 } });
// полка
box(1570, 520, 200, 18, { fill: C.gun, radius: 3, ...ink(4) });
for (const x of [1590, 1730]) add({ type: 'path', props: { x, y: 538, d: 'M0 0 L28 0 L0 34Z', fill: C.gunSh, ...ink(3) } });
box(1570, 538, 200, 26, { fill: C.panelSh, ...SH({ density: [1, 0], angle: 90 }) }); // тень под полкой
// канистры на полке
box(1585, 412, 62, 108, { fill: C.rust, radius: 10, ...ink(4) }, { mods: [wob(1.5, 41)] });
box(1625, 418, 16, 96, { fill: C.rustSh, radius: 6, ...SH() });
box(1600, 400, 26, 16, { fill: C.gun, radius: 3, ...ink(3) });
box(1660, 450, 92, 70, { fill: C.yellow, radius: 6, ...ink(4) }, { mods: [wob(1.5, 42)] });
box(1730, 456, 16, 58, { fill: C.yellowSh, radius: 4, ...SH() });
box(1672, 476, 50, 12, { fill: C.line, radius: 3, opacity: 0.8 });

/* ---------------- пол ---------------- */
box(-10, 834, W + 20, H - 834 + 10, { fill: C.floor, ...ink(5), relief: { height: 0.4, depth: 0.08, bevel: 4 } });
box(0, 838, W, 54, { fill: C.floorSh, ...SH({ density: [1, 0], angle: 90 }) });
add({ type: 'line', props: { x1: 0, y1: 960, x2: W, y2: 960, stroke: C.floorSh, strokeWidth: 5 } });
for (let i = 1; i < 6; i++) add({ type: 'line', props: { x1: i * 320 + 40, y1: 878, x2: i * 320 + 40, y2: H, stroke: C.floorSh, strokeWidth: 4 } });
add({ type: 'circle', props: { x: 60, y: 945, r: 4.5, fill: '#5d6a7a', ...ink(2), repeat: { count: 24, x: 80 } } });
// предупреждающая полоса по краю пола
box(0, 806, W, 34, { fill: C.line });
add({ id: 'stripClip', type: 'rect', props: { x: W / 2, y: 823, width: W, height: 26 } });
add({ type: 'path', props: { x: -30, y: 810, d: 'M0 0 L28 0 L10 26 L-18 26Z', fill: C.yellow, clip: 'stripClip', repeat: { count: 36, x: 56 } } });
add({ type: 'line', props: { x1: 0, y1: 808, x2: W, y2: 808, stroke: C.line, strokeWidth: 4 } });
add({ type: 'line', props: { x1: 0, y1: 838, x2: W, y2: 838, stroke: C.line, strokeWidth: 4 } });

/* ---------------- лужа и капля ---------------- */
const DROP = 2.0;
add({ type: 'ellipse', props: { x: 524, y: 902, rx: 96, ry: 15, fill: '#5f7d93', ...ink(3.5) }, mods: [wob(2, 50)] });
add({ type: 'ellipse', props: { x: 505, y: 899, rx: 60, ry: 7, fill: '#8fc4d6', opacity: 0.55 } });
add({ type: 'ellipse', props: { x: 470, y: 897, rx: 14, ry: 3, fill: C.cyan, opacity: 0.8 } });
add({
  id: 'ripple', type: 'ellipse', props: { x: 524, y: 902, rx: 30, ry: 5.5, fill: 'none', stroke: '#c9eef8', strokeWidth: 3, repeat: { count: 2, delay: 0.28 } },
  mods: [{ type: 'expr', props: ['scale', 'opacity'], code: `
    const c = ((((t - 1.52) % ${DROP}) + ${DROP}) % ${DROP}) / 0.9;
    if (c > 1) return ctx.prop === 'scale' ? 1 : 0;
    return ctx.prop === 'scale' ? 0.3 + 2.2 * ctx.ease('outCubic', c) : 1 - c;` }],
});
add({
  id: 'drop', type: 'path',
  props: { x: 524, y: 760, d: 'M0 -14 C6 -4 10 2 10 8 C10 14 5 18 0 18 C-5 18 -10 14 -10 8 C-10 2 -6 -4 0 -14Z', fill: '#a9dcea', ...ink(3) },
  mods: [{ type: 'expr', props: ['y', 'scale', 'scaleY', 'opacity'], code: `
    const c = ((t % ${DROP}) + ${DROP}) % ${DROP};
    const grow = 1.1, fall = 0.42;
    const p = ctx.prop;
    if (c < grow) {
      const u = c / grow;
      if (p === 'y') return v + 6 * ctx.ease('inOutSine', u);
      if (p === 'scale') return 0.25 + 0.75 * ctx.ease('outCubic', u);
      if (p === 'scaleY') return 1 + 0.15 * u;
      return 1;
    }
    const u = Math.min(1, (c - grow) / fall);
    if (p === 'y') return v + 6 + (888 - v - 6) * u * u;
    if (p === 'scale') return 1;
    if (p === 'scaleY') return 1.4;
    return u >= 1 ? 0 : 1;` }],
});
// брызги
add({
  id: 'splash', type: 'circle', props: { x: 512, y: 892, r: 3.5, fill: '#c9eef8', repeat: { count: 3, x: 12 } },
  mods: [{ type: 'expr', props: ['y', 'x', 'opacity'], code: `
    const c = ((((t - 1.52) % ${DROP}) + ${DROP}) % ${DROP}) / 0.35;
    if (c > 1) return ctx.prop === 'opacity' ? 0 : v;
    const dir = (i - 1);
    if (ctx.prop === 'y') return v - 40 * c * (1 - c) * 2 * (1 - Math.abs(dir) * 0.3);
    if (ctx.prop === 'x') return v + dir * 14 * c;
    return 1 - c * 0.6;` }],
});

/* ---------------- свет ---------------- */
add({ id: 'cone', type: 'path',
  props: { d: 'M600 162 L920 162 L1160 834 L360 834Z', blend: 'screen',
    fill: { type: 'linear', x1: 0, y1: 162, x2: 0, y2: 834, stops: [[0, C.glow, 0.32], [1, C.glow, 0]] } },
  mods: [{ type: 'link', prop: 'opacity', source: 'tube', mul: 1 }] });
add({ id: 'pool', type: 'ellipse', props: { x: 760, y: 872, rx: 420, ry: 46, fill: C.glow, opacity: 0.16, blur: 18, blend: 'screen' },
  mods: [{ type: 'link', prop: 'opacity', source: 'tube', mul: 0.24 }] });
// пылинки в луче
for (let i = 0; i < 16; i++) {
  add({ type: 'circle', props: { x: 520 + rnd() * 480, y: 220 + rnd() * 560, r: 1.6 + rnd() * 1.8, fill: C.cyan, opacity: 0.5 },
    mods: [{ type: 'wiggle', props: ['x', 'y'], amp: [26, 34], freq: 0.12 + rnd() * 0.1, seed: i * 3 },
      { type: 'link', prop: 'opacity', source: 'tube', mul: 0.55 }] });
}
// растровая живописная фактура поверх сцены
add({ id: 'paint', type: 'image', props: { x: W / 2, y: H / 2, width: W, height: H, src: 'assets/paint-texture.jpg', blend: 'overlay', opacity: 0.55 } });
// виньетка
add({ type: 'rect', props: { x: W / 2, y: H / 2, width: W, height: H,
  fill: { type: 'radial', cx: 0, cy: -60, r: 1150, stops: [[0, '#0b1020', 0], [0.6, '#0b1020', 0.05], [1, '#0b1020', 0.55]] } } });

// клипы: общий цикл и отдельный «срыв» лампы
ops.setClip(s, { name: 'ambient', start: 0, end: DUR, loop: true });
ops.setClip(s, { name: 'flicker', start: 2.5, end: 3.4, loop: false, next: 'ambient' });
// рельеф по умолчанию для карт нормалей
s.relief = { height: 0.5, depth: 0.3, bevel: 8, profile: 'round' };

const errs = validateScene(s);
if (errs.length) { console.error(errs); process.exit(1); }
writeFileSync(new URL('bay.json', import.meta.url), JSON.stringify(s));
console.log(`✓ bay.json — узлов: ${s.nodes.length}`);
