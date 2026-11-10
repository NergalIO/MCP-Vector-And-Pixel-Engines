// Параметры отложенного света: пресеты, сборка scene.lighting поверх пресета, цепочка стилей (scene.style).
// Новые блоки выключены по умолчанию (block → null): старые сцены дают тот же кадр пиксель в пиксель.
import { nz, rgb, deep, block, tri } from './util.mjs';

/** Пресеты света и стиля (значения — как в эскизах сцены C). Цвета света — доли 0..1 (hex = доля·255, без гаммы). */
export const LIGHT_PRESETS = {
  day: {
    title: 'Рисованный день',
    lighting: { sun: { dir: nz([-0.62, 0.6, -0.3]), color: [1, 0.92, 0.78], energy: 1.55, wrap: 0.25, shadows: true }, sky: { color: [0.48, 0.58, 0.85], energy: 0.6 }, ground: { color: [0.55, 0.42, 0.3], energy: 0.3 },
      ao: { strength: 0.9, radius: 0.9 }, groups: { lamp: 0, window: 0, candle: 0, fairy: 0 }, emissive: 0.25, specular: 0.35, bloom: { strength: 0.15, threshold: 0.9 },
      fog: { color: [0.85, 0.82, 0.9], density: 0.012, start: 6, amount: 0.6 }, exposure: 1, saturation: 1.08, tonemap: 'aces', lightShadows: false, backdrop: { mode: 'albedo' } },
    style: [{ type: 'kuwahara', radius: 3 }, { type: 'ink', strength: 0.32, color: [0.25, 0.15, 0.12] }, { type: 'vignette', strength: 0.22 }],
  },
  comic: {
    title: 'Комикс на закате',
    lighting: { sun: { dir: nz([-0.86, 0.3, -0.42]), color: [1, 0.6, 0.36], energy: 3.2, wrap: 0, shadows: true }, sky: { color: [0.42, 0.38, 0.78], energy: 0.6 }, ground: { color: [0.6, 0.32, 0.22], energy: 0.3 },
      ao: { strength: 0.8, radius: 0.9 }, groups: { lamp: 0.6, window: 0.5, candle: 0.6, fairy: 0.6 }, emissive: 0.8, specular: 0.4, bloom: { strength: 0.3, threshold: 0.9 },
      fog: { color: [0.95, 0.6, 0.5], density: 0.01, start: 6, amount: 0.6 }, exposure: 0.9, saturation: 1.3, tonemap: 'aces', lightShadows: false,
      backdrop: { mode: 'gradient', colors: [[0.18, 0.12, 0.38], [0.95, 0.42, 0.3], [1, 0.78, 0.45]], clouds: 1.2 } },
    style: [{ type: 'cel', steps: [0.12, 0.5], detail: 0.5 }, { type: 'hatch', below: 0.42, period: 9, color: [0.08, 0.04, 0.06] }, { type: 'ink', strength: 1, color: [0.08, 0.04, 0.06] }, { type: 'vignette', strength: 0.22 }],
  },
  night: {
    title: 'Ночь с фонарями',
    lighting: { sun: { dir: nz([0.35, 0.85, -0.4]), color: [0.45, 0.55, 0.95], energy: 0.3, wrap: 0, shadows: true }, sky: { color: [0.1, 0.13, 0.3], energy: 0.32 }, ground: { color: [0.08, 0.06, 0.08], energy: 0.2 },
      ao: { strength: 1, radius: 0.9 }, groups: { lamp: 1, window: 0.35, candle: 1, fairy: 1 }, emissive: 1.1, specular: 1.6, bloom: { strength: 0.7, threshold: 0.9 },
      fog: { color: [0.1, 0.12, 0.25], density: 0.02, start: 6, amount: 0.15 }, exposure: 0.8, saturation: 1.1, tonemap: 'aces', lightShadows: true,
      backdrop: { mode: 'gradient', colors: [[0.01, 0.015, 0.05], [0.04, 0.05, 0.14], [0.16, 0.1, 0.22]], clouds: 0.25, stars: true, moon: { x: 0.78, y: 120, r: 38 } } },
    style: [{ type: 'ink', strength: 0.55, color: [0.02, 0.02, 0.05] }, { type: 'vignette', strength: 0.22 }],
  },
  pixel: {
    title: 'Пиксель-арт со светом',
    lighting: { sun: { dir: nz([-0.62, 0.5, -0.6]), color: [1, 0.78, 0.5], energy: 2.7, wrap: 0.1, shadows: true }, sky: { color: [0.35, 0.55, 0.75], energy: 0.6 }, ground: { color: [0.55, 0.4, 0.3], energy: 0.3 },
      ao: { strength: 1, radius: 0.9 }, groups: { lamp: 0.35, window: 0.35, candle: 0.35, fairy: 0.35 }, emissive: 0.6, specular: 0.5, bloom: { strength: 0.2, threshold: 0.9 },
      fog: { color: [0.95, 0.75, 0.6], density: 0.006, start: 6, amount: 0.6 }, exposure: 0.82, saturation: 1.4, tonemap: 'aces', lightShadows: false,
      backdrop: { mode: 'gradient', colors: [[0.22, 0.4, 0.65], [0.85, 0.7, 0.55], [1, 0.82, 0.55]], clouds: 1.2 } },
    style: [{ type: 'pixelate', size: 4, colors: 56, bayer: 0.07 }, { type: 'vignette', strength: 0.22 }],
  },
  golden: {
    title: 'Золотой час (иллюстрация)',
    lighting: { sun: { dir: nz([-0.7, 0.45, -0.4]), color: [1, 0.8, 0.56], energy: 1.85, wrap: 0.18, shadows: true, angle: 2.2 }, sky: { color: [0.56, 0.62, 0.86], energy: 0.55 }, ground: { color: [0.62, 0.46, 0.32], energy: 0.32 },
      ao: { strength: 0.85, radius: 0.9 }, groups: { lamp: 0.55, window: 0.45, candle: 0.55, fairy: 0.7 }, emissive: 0.7, specular: 0.45, bloom: { strength: 0.28, threshold: 0.85 },
      fog: { color: [1, 0.86, 0.7], density: 0.008, start: 8, amount: 0.45 }, exposure: 0.88, saturation: 1.12, tonemap: 'aces', lightShadows: false,
      gi: { strength: 0.55, radius: 2.5 }, volumetric: { density: 0.006, steps: 12, g: 0.55, lamps: 0.6, maxDist: 30 },
      grade: { lift: [0.015, 0.01, 0.03], gain: [1.03, 1, 0.95], contrast: 1.08, split: { shadows: [0.24, 0.3, 0.55], highlights: [1, 0.8, 0.55], amount: 0.14 } },
      backdrop: { mode: 'gradient', colors: [[0.34, 0.54, 0.86], [0.96, 0.82, 0.66], [1, 0.86, 0.62]], clouds: 1 } },
    style: [{ type: 'paint', radius: 4 }, { type: 'ink', strength: 0.42, color: 'albedo', darken: 0.32, depthWidth: 1 }, { type: 'paper', strength: 0.07 }, { type: 'vignette', strength: 0.2 }],
  },
  dusk: {
    title: 'Сумерки с фонарями',
    lighting: { sun: { dir: nz([0.82, 0.2, 0.4]), color: [1, 0.52, 0.32], energy: 1.5, wrap: 0.1, shadows: true, angle: 3 }, sky: { color: [0.32, 0.32, 0.62], energy: 0.5 }, ground: { color: [0.4, 0.26, 0.22], energy: 0.25 },
      ao: { strength: 0.95, radius: 0.9 }, groups: { lamp: 1, window: 0.8, candle: 1, fairy: 1 }, emissive: 1, specular: 0.8, bloom: { strength: 0.45, threshold: 0.85 },
      fog: { color: [0.5, 0.4, 0.62], density: 0.015, start: 6, amount: 0.45 }, exposure: 0.95, saturation: 1.15, tonemap: 'aces', lightShadows: true,
      gi: { strength: 0.4, radius: 2.5 }, volumetric: { density: 0.008, steps: 12, g: 0.5, lamps: 1, maxDist: 30 }, reflections: { strength: 0.5 },
      grade: { split: { shadows: [0.2, 0.32, 0.5], highlights: [1, 0.66, 0.42], amount: 0.16 }, gain: [1.02, 0.99, 0.97] },
      backdrop: { mode: 'gradient', colors: [[0.12, 0.12, 0.36], [0.76, 0.42, 0.46], [1, 0.66, 0.42]], clouds: 1 } },
    style: [{ type: 'paint', radius: 4 }, { type: 'ink', strength: 0.5, color: 'albedo', darken: 0.25, depthWidth: 1 }, { type: 'vignette', strength: 0.24 }],
  },
  cinematic: {
    title: 'Кино: GTAO, контактные тени, глубина резкости',
    lighting: { sun: { dir: nz([-0.55, 0.52, -0.5]), color: [1, 0.86, 0.68], energy: 2, wrap: 0.12, shadows: true, angle: 1.6 }, sky: { color: [0.5, 0.6, 0.86], energy: 0.55 }, ground: { color: [0.6, 0.45, 0.32], energy: 0.3 },
      ao: { mode: 'gtao', strength: 1, radius: 1.2, multiBounce: true }, contactShadows: { length: 0.45 }, groups: { lamp: 0.6, window: 0.5, candle: 0.6, fairy: 0.7 },
      emissive: 0.8, specular: 0.45, bloom: { strength: 0.22, threshold: 0.85 }, fog: { color: [0.9, 0.84, 0.78], density: 0.008, start: 10, amount: 0.4 },
      exposure: 1, autoExposure: { key: 0.2 }, saturation: 1.05, tonemap: 'agx', lightShadows: true, gi: { strength: 0.6, radius: 2.5, bounces: 2 },
      dof: { focus: 'auto', aperture: 1 }, grade: { contrast: 1.06, split: { shadows: [0.22, 0.3, 0.5], highlights: [1, 0.82, 0.6], amount: 0.1 } },
      backdrop: { mode: 'gradient', colors: [[0.3, 0.48, 0.8], [0.9, 0.8, 0.7], [1, 0.86, 0.66]], clouds: 0.8 } },
    style: [{ type: 'ink', strength: 0.3, color: 'albedo', darken: 0.35, depthWidth: 1 }, { type: 'chromatic', amount: 1 }, { type: 'sharpen', amount: 0.3 }, { type: 'grain', amount: 0.025 }, { type: 'vignette', strength: 0.25 }],
  },
};
/** Копия цепочки стилей пресета name (звенья — новые объекты: правка сцены не трогает пресет). */
export const presetStyle = (name) => LIGHT_PRESETS[name].style.map((x) => ({ ...x }));

/** Звенья цепочки стилей (LDR, после тонмаппинга и цветокоррекции), в любом порядке. */
export const STYLE_TYPES = ['cel', 'hatch', 'kuwahara', 'paint', 'pixelate', 'ink', 'paper', 'vignette', 'fxaa', 'sharpen', 'chromatic', 'grain'];
/** Режимы тонмаппинга. */
export const TONEMAPS = ['aces', 'agx', 'hue', 'none'];

/** Итоговые параметры света сцены: пресет + ручные поля scene.lighting (+ override поверх). */
export function resolveLighting(scene, override) {
  const L = { ...(scene.lighting || {}), ...(override || {}) };
  const pre = LIGHT_PRESETS[L.preset] || LIGHT_PRESETS.day;
  const st = deep(pre.lighting, L);
  st.sun = { ...st.sun, dir: nz(st.sun.dir || [-0.6, 0.6, -0.3]), color: rgb(st.sun.color) };
  st.sky = { ...st.sky, color: rgb(st.sky.color) };
  st.ground = { ...st.ground, color: rgb(st.ground.color) };
  st.fog = { ...st.fog, color: rgb(st.fog.color) };
  if (st.backdrop?.colors) st.backdrop = { ...st.backdrop, colors: st.backdrop.colors.map((c) => rgb(c)) };
  st.characters = { tag: 'chr', amount: 0.45, ...(st.characters || {}) };
  st.gi = block(st.gi, { strength: 0.5, radius: 2.5, bounces: 1 });
  st.volumetric = block(st.volumetric, { density: 0.015, steps: 12, g: 0.5, lamps: 0.8, maxDist: 40, sun: true });
  if (st.volumetric) st.volumetric.color = rgb(st.volumetric.color, [1, 1, 1]);
  st.reflections = block(st.reflections, { strength: 0.5, minSpec: 0.5, maxDist: 14, steps: 40, thickness: 0.6, floorOnly: true });
  st.grade = block(st.grade, {});
  if (st.grade) {
    const g = st.grade;
    g.lift = tri(g.lift, 0); g.gamma = tri(g.gamma, 1); g.gain = tri(g.gain, 1);
    if (g.split) g.split = { amount: 0.15, balance: 0, ...g.split, shadows: rgb(g.split.shadows, [0.3, 0.4, 0.6]), highlights: rgb(g.split.highlights, [1, 0.8, 0.6]) };
    if (g.matchRef) g.matchRef = { amount: 0.6, lum: 0.35, chroma: 0.6, zones: true, ...(typeof g.matchRef === 'string' ? { src: g.matchRef } : g.matchRef) };
    if (g.matchRef && !g.matchRef.src) delete g.matchRef;
  }
  // живописное затенение: свет окрашивает поверхность слабо, тень сдвигает тон к холодному, а не только темнит
  st.paint = block(st.paint, { chroma: 0.45, shadow: [0.55, 0.45, 0.75], amount: 0.4, desat: 0.2, range: [0.12, 0.7], fill: 0.03 });
  if (st.paint) st.paint.shadow = rgb(st.paint.shadow, [0.55, 0.45, 0.75]);
  // воздушная перспектива: даль бледнее и холоднее (не путать с fog — тот подмешивает цвет поверх)
  st.aerial = block(st.aerial, { color: [0.62, 0.66, 0.86], start: 8, density: 0.05, amount: 0.7, desat: 0.45, shift: 0.5, lift: 0.06 });
  if (st.aerial) st.aerial.color = rgb(st.aerial.color, [0.62, 0.66, 0.86]);
  if (st.ao?.color != null) st.ao = { ...st.ao, color: rgb(st.ao.color, [0, 0, 0]) };
  // AO: ssao (прежний, по умолчанию) или gtao — горизонты в мировых метрах, изогнутые нормали, многократный отскок
  if (st.ao?.mode === 'gtao') st.ao = { dirs: 4, steps: 8, bent: true, multiBounce: false, falloff: 0.6, ...st.ao };
  // контактные тени: короткий луч к солнцу по буферу глубины — тени мелких деталей, которых нет среди окклюдеров
  st.contactShadows = block(st.contactShadows, { length: 0.4, steps: 14, thickness: 0.12, strength: 1, lamps: false });
  // глубина резкости: кружок рассеяния по глубине (focus — метры или 'auto' — по центру кадра)
  st.dof = block(st.dof, { focus: 'auto', aperture: 1, maxBlur: 14, near: true, samples: 24 });
  // автоэкспозиция: средняя логарифмическая яркость кадра приводится к key
  st.autoExposure = block(st.autoExposure, { key: 0.18, min: 0.35, max: 3, amount: 1 });
  st.preset = L.preset || 'day';
  return st;
}

/** Цепочка стилей: scene.style (массив или имя пресета) или стиль пресета света. */
export function resolveStyle(scene, override) {
  let s = override ?? scene.style;
  if (typeof s === 'string') s = LIGHT_PRESETS[s]?.style;
  if (!Array.isArray(s)) s = LIGHT_PRESETS[scene.lighting?.preset]?.style || LIGHT_PRESETS.day.style;
  return s.filter((x) => x && x.enabled !== false).map((x) => ({ ...x, ...(x.color != null && x.color !== 'albedo' ? { color: rgb(x.color) } : {}) }));
}

/** Краткое описание включённых эффектов (для ответа инструмента и статистики). */
export function effectsSummary(st) {
  const on = [];
  if (st.sun?.angle > 0) on.push(`полутень ${st.sun.angle}°`);
  if ((st.ao?.strength ?? 1) > 0) on.push(st.ao?.mode === 'gtao' ? `GTAO${st.ao.bent ? '+изогн. нормали' : ''}${st.ao.multiBounce ? '+отскок' : ''}` : 'SSAO');
  if (st.contactShadows) on.push('контактные тени');
  if (st.gi) on.push(`GI×${st.gi.bounces ?? 1}`);
  if (st.reflections) on.push('SSR');
  if (st.volumetric) on.push('объёмный свет');
  if (st.dof) on.push('глубина резкости');
  if (st.autoExposure) on.push('автоэкспозиция');
  if (st.paint) on.push('живописные тени');
  if (st.aerial) on.push('воздушная перспектива');
  if (st.grade) on.push('цветокоррекция');
  return on;
}
