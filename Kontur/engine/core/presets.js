/** Пресеты и сводка сцены. */
import { fmt } from './math.js';
import { defaultFor, index, invalidate } from './model.js';
import { getNode, ops } from './ops.js';
import { pixelOf } from './pixel.js';

export const PRESETS = {
  popIn: {
    doc: 'Появление с упругим масштабом. params: id, start=0, duration=0.6, from=0, overshoot="outBack"',
    run(scene, { id, start = 0, duration = 0.6, from = 0, ease = 'outBack' }) {
      ops.animate(scene, id, 'scale', { from, to: 1, start, duration, ease });
      ops.animate(scene, id, 'opacity', { from: 0, to: 1, start, duration: duration * 0.5, ease: 'outQuad' });
    },
  },
  fadeOut: {
    doc: 'Исчезновение. params: id, start, duration=0.5, scaleTo (необязательно)',
    run(scene, { id, start, duration = 0.5, scaleTo }) {
      ops.animate(scene, id, 'opacity', { to: 0, start, duration, ease: 'inQuad' });
      if (scaleTo != null) ops.animate(scene, id, 'scale', { to: scaleTo, start, duration, ease: 'inBack' });
    },
  },
  drawOn: {
    doc: 'Прорисовка обводки (trimEnd 0→1). params: id, start=0, duration=1.2, ease="inOutCubic", erase (сек, необязательно — затем стереть)',
    run(scene, { id, start = 0, duration = 1.2, ease = 'inOutCubic', erase }) {
      ops.setKeys(scene, id, 'trimEnd', [{ t: start, v: 0, ease }, { t: start + duration, v: 1 }]);
      if (erase != null) ops.setKeys(scene, id, 'trimStart', [{ t: erase, v: 0, ease }, { t: erase + duration, v: 1 }]);
    },
  },
  morphSequence: {
    doc: 'Цепочка морфинга фигур. params: id, shapes: [описание фигуры|path d,...], start=0, hold=0.6, duration=0.8, ease="inOutCubic", loop=true (вернуться к первой)',
    run(scene, { id, shapes, start = 0, hold = 0.6, duration = 0.8, ease = 'inOutCubic', loop = true }) {
      const list = loop ? [...shapes, shapes[0]] : shapes;
      const keys = [];
      let t = start;
      list.forEach((s, i) => {
        keys.push({ t, v: s, ease });
        if (i < list.length - 1) { keys.push({ t: t + hold, v: s, ease }); t += hold + duration; }
      });
      ops.setKeys(scene, id, 'd', keys);
    },
  },
  float: {
    doc: 'Невесомое парение: плавный шум по y и rotation. params: id, amp=12, freq=0.4, rot=4, seed',
    run(scene, { id, amp = 12, freq = 0.4, rot = 4, seed = 0 }) {
      ops.addMod(scene, id, { type: 'wiggle', props: ['y', 'x', 'rotation'], amp: [amp, amp * 0.5, rot], freq, seed });
    },
  },
  pulse: {
    doc: 'Пульсация масштаба. params: id, amp=0.08, freq=1',
    run(scene, { id, amp = 0.08, freq = 1 }) { ops.addMod(scene, id, { type: 'oscillate', prop: 'scale', amp, freq }); },
  },
  stagger: {
    doc: 'Каскадное появление списка узлов. params: ids[], start=0, step=0.08, duration=0.6, prop="y", offset=40, ease="outCubic"',
    run(scene, { ids, start = 0, step = 0.08, duration = 0.6, prop = 'y', offset = 40, ease = 'outCubic' }) {
      ids.forEach((id, i) => {
        const n = getNode(scene, id);
        const t0 = start + i * step;
        const base = n.props?.[prop] ?? defaultFor(n.type, prop);
        ops.setKeys(scene, id, prop, [{ t: t0, v: base + offset, ease }, { t: t0 + duration, v: base }]);
        ops.setKeys(scene, id, 'opacity', [{ t: t0, v: 0, ease: 'outQuad' }, { t: t0 + duration * 0.6, v: n.props?.opacity ?? 1 }]);
      });
    },
  },
  typewriter: {
    doc: 'Печать текста. params: id, start=0, duration=1.5',
    run(scene, { id, start = 0, duration = 1.5 }) { ops.setKeys(scene, id, 'textReveal', [{ t: start, v: 0, ease: 'linear' }, { t: start + duration, v: 1 }]); },
  },
  orbitRing: {
    doc: 'Кольцо из N копий узла, вращающихся вокруг центра. params: id, count=12, radius=200, cx, cy, speed=0.1, delay=0',
    run(scene, { id, count = 12, radius = 200, cx = scene.width / 2, cy = scene.height / 2, speed = 0.1, delay = 0 }) {
      const n = getNode(scene, id);
      n.props = { ...n.props, x: cx + radius, y: cy, repeat: { count, rotation: 360 / count, cx, cy, delay } };
      const wrapper = ops.addNode(scene, { type: 'group', parent: n.parent, props: { x: cx, y: cy, anchorX: cx, anchorY: cy } });
      n.parent = wrapper.id;
      ops.addMod(scene, wrapper.id, { type: 'spin', speed: speed * 360 });
      invalidate(scene);
    },
  },
};
export function applyPreset(scene, name, params) {
  const p = PRESETS[name];
  if (!p) throw new Error(`Неизвестный пресет «${name}». Есть: ${Object.keys(PRESETS).join(', ')}`);
  p.run(scene, params || {});
  invalidate(scene);
}

/** Краткая сводка сцены (для людей и агентов). */
export function describeScene(scene) {
  const c = index(scene);
  const lines = [`Сцена ${scene.width}×${scene.height}, ${scene.duration}s @${scene.fps}fps, фон ${typeof scene.background === 'string' ? scene.background : 'градиент'}, узлов: ${scene.nodes.length}${scene.dither ? `, дизеринг теней: ${scene.dither.enabled ? 'вкл' : 'выкл'} (${scene.dither.pattern || 'bayer4'})` : ''}`];
  const walk = (parent, depth) => {
    for (const n of c.children.get(parent) || []) {
      const keys = n.keys ? Object.entries(n.keys).map(([k, v]) => `${k}[${v.length}: ${v[0].t}–${v[v.length - 1].t}s]`).join(' ') : '';
      const mods = n.mods ? n.mods.map((m) => m.type).join(',') : '';
      const p = n.props || {};
      const pos = `(${fmt(p.x ?? 0)}, ${fmt(p.y ?? 0)})`;
      lines.push(`${'  '.repeat(depth)}• ${n.id} <${n.type}> ${pos}${keys ? ' ключи: ' + keys : ''}${mods ? ' мод: ' + mods : ''}${p.repeat ? ` ×${p.repeat.count}` : ''}${c.clipRefs.has(n.id) ? ' [маска]' : ''}${p.shade ? ' [тень]' : ''}${n.type === 'image' ? ` [${String(p.src || '').slice(0, 40)}]` : ''}`);
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  if (scene.clips?.length) lines.push('Клипы: ' + scene.clips.map((c) => `${c.name} [${c.start}–${c.end}s${c.loop === false ? ', один раз' : ''}${c.next ? ` → ${c.next}` : ''}]`).join(', '));
  if (scene.states?.length) lines.push('Состояния: ' + scene.states.map((g) => `${g.name} = ${Object.keys(g.values || {}).map((v) => (v === g.default ? `[${v}]` : v)).join(' | ')}`).join('; '));
  if (c.ik.length) lines.push('IK: ' + c.ik.map((k) => `${k.root} → ${k.mid} → ${k.end} ⇢ ${k.cfg.target}`).join('; '));
  const px = pixelOf(scene);
  if (px) lines.push(`Пиксельный режим: пиксель ${px.size}, кадр ${Math.round(scene.width / px.size)}×${Math.round(scene.height / px.size)}${px.palette ? `, палитра ${px.palette.length} цв.` : ''}`);
  const lights = scene.nodes.filter((n) => n.type === 'light').length;
  if (lights) lines.push(`Свет: источников ${lights}, общий фон ${scene.ambient || '#4a4f5c (по умолчанию)'}`);
  return lines.join('\n');
}
