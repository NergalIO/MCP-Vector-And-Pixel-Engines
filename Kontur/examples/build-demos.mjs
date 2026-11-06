// Собирает демо-сцены через API движка и сохраняет их в examples/*.json
// Запуск: node examples/build-demos.mjs
import { writeFileSync } from 'node:fs';
import { createScene, ops, applyPreset, validateScene } from '../engine/kontur.js';

const out = new URL('.', import.meta.url);

/* ---------------------------------------------------------------- 1. Поток */
function flow() {
  const s = createScene({ width: 1920, height: 1080, duration: 10, fps: 60 });
  s.background = { type: 'radial', cx: 960, cy: 540, r: 1100, stops: [[0, '#1b1640'], [0.55, '#0c0b1f'], [1, '#05050d']] };
  const cx = 960, cy = 540;

  // Большие «живые» кляксы на фоне
  const blobs = [
    { id: 'blobA', x: 560, y: 420, r: 330, seed: 3, c: ['#6d28d9', '#db2777'] },
    { id: 'blobB', x: 1400, y: 640, r: 300, seed: 9, c: ['#0891b2', '#4f46e5'] },
  ];
  for (const b of blobs) {
    ops.addNode(s, {
      id: b.id, type: 'blob',
      props: { x: b.x, y: b.y, radius: b.r, points: 9, amount: 0.22, frequency: 1.1, speed: 0.35, seed: b.seed, opacity: 0.55, blur: 40,
        fill: { type: 'linear', angle: 35, length: b.r * 2, stops: [[0, b.c[0]], [1, b.c[1]]] } },
      mods: [{ type: 'wiggle', props: ['x', 'y'], amp: 60, freq: 0.12, seed: b.seed }, { type: 'spin', speed: 6 }],
    });
  }

  // Волны-кометы: прорисовка с бегущим смещением
  for (let i = 0; i < 3; i++) {
    const pts = [];
    for (let k = 0; k <= 16; k++) pts.push([-100 + k * 132, cy + 260 + Math.sin(k * 0.8 + i) * (60 + i * 20) - i * 50]);
    ops.addNode(s, {
      id: `wave${i}`, type: 'path',
      props: { points: pts, smooth: true, closed: false, stroke: { type: 'linear', x1: 0, y1: 0, x2: 1920, y2: 0, stops: [[0, '#22d3ee'], [0.5, '#a78bfa'], [1, '#f472b6']] },
        strokeWidth: 4 - i, opacity: 0.8 - i * 0.18, trimStart: 0, trimEnd: 0.35, glow: { blur: 10, color: '#8b5cf6', strength: 0.7 } },
      keys: { trimOffset: [{ t: 0, v: i * 0.3, ease: 'linear' }, { t: 10, v: i * 0.3 + 2 }] },
      mods: [{ type: 'deform', amount: 30, scale: 0.004, speed: 0.4, seed: i * 5, detail: 32 }],
    });
  }

  // Кольцо точек с волной масштаба
  const ring = ops.addNode(s, { id: 'ring', type: 'group', props: { x: cx, y: cy, anchorX: cx, anchorY: cy }, mods: [{ type: 'spin', speed: 12 }] });
  ops.addNode(s, {
    id: 'dot', type: 'circle', parent: ring.id,
    props: { x: cx + 300, y: cy, r: 9, fill: '#e0e7ff', repeat: { count: 36, rotation: 10, cx, cy } },
    mods: [{ type: 'oscillate', prop: 'scale', amp: 0.7, freq: 0.5, phaseStep: 20 }, { type: 'noiseColor', amount: 0.5, speed: 0.4 }],
    keys: { opacity: [{ t: 0, v: 0, ease: 'outCubic' }, { t: 1.2, v: 0.9 }] },
  });
  // Внешнее пунктирное кольцо с прорисовкой
  ops.addNode(s, {
    id: 'orbitLine', type: 'circle',
    props: { x: cx, y: cy, r: 380, fill: 'none', stroke: '#c4b5fd', strokeWidth: 2, opacity: 0.5, rotation: -90 },
    mods: [{ type: 'spin', speed: -20 }],
  });
  applyPreset(s, 'drawOn', { id: 'orbitLine', start: 0.3, duration: 2.2, ease: 'inOutQuart', erase: 8.2 });

  // Частицы по траектории «восьмёрка»
  ops.addNode(s, {
    id: 'spark', type: 'circle',
    props: { r: 6, fill: '#fde68a', glow: { blur: 8, color: '#fbbf24', strength: 1 }, repeat: { count: 14, scale: 0.92, opacity: 0.85 } },
    mods: [{ type: 'followPath', path: `M${cx} ${cy} C${cx + 250} ${cy - 260} ${cx + 520} ${cy - 120} ${cx + 520} ${cy} C${cx + 520} ${cy + 120} ${cx + 250} ${cy + 260} ${cx} ${cy} C${cx - 250} ${cy - 260} ${cx - 520} ${cy - 120} ${cx - 520} ${cy} C${cx - 520} ${cy + 120} ${cx - 250} ${cy + 260} ${cx} ${cy}Z`,
      speed: 0.1, offsetStep: -0.008, orient: false }],
  });

  // Центральная фигура: цепочка морфинга с пружинным «вдохом»
  ops.addNode(s, {
    id: 'hero', type: 'path',
    props: { x: cx, y: cy, d: { shape: 'circle', r: 150 }, shadow: { y: 30, blur: 40, color: '#000', opacity: 0.5 },
      fill: { type: 'linear', angle: 60, length: 320, stops: [[0, '#f0abfc'], [0.5, '#818cf8'], [1, '#22d3ee']] } },
    mods: [{ type: 'spin', speed: 15 }, { type: 'spring', prop: 'scale', stiffness: 90, damping: 7 }],
  });
  applyPreset(s, 'morphSequence', {
    id: 'hero', start: 0.8, hold: 0.9, duration: 0.9, ease: 'inOutBack',
    shapes: [{ shape: 'circle', r: 150 }, { shape: 'star', points: 5, outerRadius: 190, innerRadius: 90, cornerRadius: 18 },
      { shape: 'rect', width: 260, height: 260, radius: 60 }, { shape: 'heart', size: 330 }, { shape: 'polygon', sides: 6, radius: 170, cornerRadius: 30 }],
  });
  // «вдох» масштаба на каждом переходе (пружина его сгладит)
  const scaleKeys = [{ t: 0, v: 0 }, { t: 0.4, v: 1 }];
  for (let k = 0; k < 5; k++) { const t0 = 1.7 + k * 1.8; scaleKeys.push({ t: t0 - 0.01, v: 1, ease: 'linear' }, { t: t0, v: 0.78, ease: 'hold' }, { t: t0 + 0.25, v: 1 }); }
  ops.setKeys(s, 'hero', 'scale', scaleKeys);
  ops.setKeys(s, 'hero', 'fill', [
    { t: 0, v: { type: 'linear', angle: 60, length: 320, stops: [[0, '#f0abfc'], [0.5, '#818cf8'], [1, '#22d3ee']] }, ease: 'inOutSine' },
    { t: 5, v: { type: 'linear', angle: 240, length: 320, stops: [[0, '#fde047'], [0.5, '#fb7185'], [1, '#a855f7']] }, ease: 'inOutSine' },
    { t: 10, v: { type: 'linear', angle: 420, length: 320, stops: [[0, '#f0abfc'], [0.5, '#818cf8'], [1, '#22d3ee']] } },
  ]);

  // Подпись
  ops.addNode(s, { id: 'title', type: 'text', props: { x: cx, y: 1000, text: 'K O N T U R', fontSize: 30, fontWeight: 300, letterSpacing: 18, fill: '#c7d2fe', opacity: 0.85 } });
  applyPreset(s, 'typewriter', { id: 'title', start: 1, duration: 1.4 });
  ops.setKeys(s, 'title', 'letterSpacing', [{ t: 1, v: 4, ease: 'outCubic' }, { t: 3, v: 18 }]);
  return s;
}

/* --------------------------------------------------------- 2. Жидкие линии */
function liquid() {
  const s = createScene({ width: 1920, height: 1080, duration: 12, fps: 60, background: '#07070c' });
  const pts = [];
  for (let k = 0; k <= 24; k++) pts.push([-80 + k * 87, 0]);
  ops.addNode(s, {
    id: 'lines', type: 'group', props: { x: 0, y: 180 },
  });
  ops.addNode(s, {
    id: 'line', type: 'path', parent: 'lines',
    props: {
      points: pts, smooth: true, closed: false, strokeWidth: 3,
      stroke: { type: 'linear', x1: 0, y1: 0, x2: 1920, y2: 0, stops: [[0, '#ff4d6d'], [0.5, '#ffb703'], [1, '#3a86ff']] },
      repeat: { count: 40, y: 18, delay: 0.06 },
    },
    mods: [
      { type: 'deform', amount: 120, scale: 0.0028, speed: 0.22, seed: 4, detail: 24 },
      { type: 'noiseColor', prop: 'stroke', amount: 0.3, speed: 0.2 },
    ],
    keys: { trimEnd: [{ t: 0, v: 0, ease: 'inOutQuart' }, { t: 2.2, v: 1 }], trimStart: [{ t: 10, v: 0, ease: 'inOutQuart' }, { t: 12, v: 1 }] },
  });
  ops.addNode(s, {
    id: 'sun', type: 'circle',
    props: { x: 960, y: 540, r: 120, fill: { type: 'radial', cx: -30, cy: -40, r: 170, stops: [[0, '#fff1c1'], [0.6, '#ffb703'], [1, '#fb5607']] }, glow: { blur: 50, color: '#ff8800', strength: 0.6 }, blend: 'screen' },
    keys: { scale: [{ t: 0.5, v: 0, ease: { spring: { stiffness: 120, damping: 9 } } }, { t: 2.5, v: 1 }, { t: 10.2, v: 1, ease: 'inBack' }, { t: 11, v: 0 }] },
    mods: [{ type: 'wiggle', props: ['x', 'y'], amp: [80, 40], freq: 0.15, seed: 2 }, { type: 'deform', amount: 6, scale: 0.02, speed: 1.2, detail: 16 }],
  });
  return s;
}

/* -------------------------------------------------------- 3. Раскрытие логотипа */
function reveal() {
  const s = createScene({ width: 1080, height: 1080, duration: 6, fps: 60, background: '#f4f1ea' });
  const c = 540;
  // маска-круг, раскрывающая цветной фон
  ops.addNode(s, { id: 'revealMask', type: 'circle', props: { x: c, y: c, r: 760, fill: '#fff' }, keys: { scale: [{ t: 0.2, v: 0, ease: 'inOutQuart' }, { t: 1.4, v: 1 }, { t: 4.8, v: 1, ease: 'inOutQuart' }, { t: 5.8, v: 0 }] } });
  ops.addNode(s, { id: 'panel', type: 'rect', props: { x: c, y: c, width: 1120, height: 1120, fill: { type: 'linear', angle: 45, length: 1400, stops: [[0, '#1d3557'], [1, '#457b9d']] }, clip: 'revealMask' } });
  // квадраты каскадом
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const id = `tile${i}`; ids.push(id);
    ops.addNode(s, { id, type: 'rect', props: { x: c - 180 + (i % 2) * 360 / 1, y: c - 180 + Math.floor(i / 2) * 360, width: 150, height: 150, radius: 28, fill: ['#e63946', '#f1faee', '#a8dadc', '#ffb703'][i], rotation: 45 },
      mods: [{ type: 'spring', prop: 'rotation', stiffness: 60, damping: 6 }] });
    ops.setKeys(s, id, 'rotation', [{ t: 0, v: 45 }, { t: 1.6 + i * 0.12, v: 45, ease: 'hold' }, { t: 1.61 + i * 0.12, v: 0 }]);
  }
  applyPreset(s, 'stagger', { ids, start: 1.2, step: 0.12, duration: 0.7, prop: 'y', offset: 120, ease: 'outBack' });
  for (const id of ids) applyPreset(s, 'fadeOut', { id, start: 4.4, duration: 0.4, scaleTo: 0 });
  // контур, прорисовывающийся и превращающийся в галочку
  ops.addNode(s, { id: 'outline', type: 'path', props: { x: c, y: c, d: { shape: 'circle', r: 300 }, fill: 'none', stroke: '#f1faee', strokeWidth: 10, rotation: -90 } });
  applyPreset(s, 'drawOn', { id: 'outline', start: 1.4, duration: 1.4, ease: 'inOutCubic' });
  ops.addNode(s, { id: 'check', type: 'path', props: { x: c, y: c, d: 'M-150 10 L-40 120 L170 -110', fill: 'none', stroke: '#ffb703', strokeWidth: 34 } });
  ops.setKeys(s, 'check', 'trimEnd', [{ t: 0, v: 0 }, { t: 4.6, v: 0, ease: 'outQuart' }, { t: 5.2, v: 1 }]);
  return s;
}

for (const [name, fn] of Object.entries({ flow, liquid, reveal })) {
  const scene = fn();
  const errs = validateScene(scene);
  if (errs.length) { console.error(name, errs); process.exitCode = 1; }
  writeFileSync(new URL(`${name}.json`, out), JSON.stringify(scene, null, 1));
  console.log(`✓ ${name}.json — узлов: ${scene.nodes.length}`);
}
