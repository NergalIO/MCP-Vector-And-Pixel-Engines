/**
 * Процедурные модификаторы — реестр. Каждый модификатор узла: { type, ...параметры, enabled?, start?, end?, fadeIn?, fadeOut?, weight? }.
 * Запись реестра: { targets(m) → свойства, apply(ctx) → новое значение, isStatic(m) → не зависит от времени,
 * params — схема параметров (тип, по умолчанию, описание), doc }. Из реестра строятся документация (docs),
 * схема сцены и проверка; новые модификаторы добавляются registerModifier без правки ядра.
 */
import { formatColor, oklabToRgb, parseColor, rgbToOklab } from './color.js';
import { resolveEase } from './ease.js';
import { allowExprFunctions, compileExpr } from './expr.js';
import { measureGeom, pointAtFraction, toGeom, translateGeom } from './geom.js';
import { DEG, TAU, clamp, fbm, lerp, noise1, noise3 } from './math.js';
import { interpolate } from './tracks.js';
import { nodeGeom, propValue, springValue } from './values.js';

const pNum = (def, doc) => ({ type: 'number', default: def, doc });
const pStr = (def, doc) => ({ type: 'string', default: def, doc });
const pBool = (def, doc) => ({ type: 'boolean', default: def, doc });
const PROP_PARAMS = { prop: pStr(undefined, 'свойство'), props: { type: 'array', doc: 'несколько свойств' } };
const ampOf = (m, pi) => (Array.isArray(m.amp) ? m.amp[pi] ?? m.amp[0] : m.amp ?? 10);
/** Помощники выражений expr: одни и те же функции на всё время работы (их вызов разрешён в безопасном режиме). */
const exprEase = (n, u) => resolveEase(n)(u);
allowExprFunctions(noise1, noise3, fbm, lerp, clamp, exprEase);

export const MODIFIERS = {
  wiggle: {
    targets: (m) => m.props || [m.prop || 'x'],
    params: { ...PROP_PARAMS, amp: { type: 'number|array', default: 10, doc: 'размах (на свойство — массив)' }, freq: pNum(1, 'частота'), seed: pNum(0), octaves: pNum(2), perCopy: pNum(17, 'сдвиг сида на копию repeat') },
    doc: 'Плавный шум: v += amp·fbm(t·freq). Параметры: prop|props, amp, freq, seed, octaves, perCopy (сдвиг сида для копий repeat).',
    apply: (node, m, mi, name, v, t, ctx, copy, w) => {
      const pi = (m.props || [m.prop || 'x']).indexOf(name);
      const seed = (m.seed ?? 0) + pi * 101 + copy * (m.perCopy ?? 17);
      return addTo(v, fbm(t * (m.freq ?? 1), seed, m.octaves ?? 2) * ampOf(m, pi) * w);
    },
  },
  oscillate: {
    targets: (m) => m.props || [m.prop || 'y'],
    params: { ...PROP_PARAMS, amp: { type: 'number|array', default: 10 }, freq: pNum(1), phase: pNum(0, 'градусы'), wave: { type: 'string', enum: ['sine', 'triangle', 'saw', 'square'], default: 'sine' }, phaseStep: pNum(0, 'сдвиг фазы на копию'), propPhase: pNum(0) },
    doc: 'Периодические колебания: v += amp·wave(2π·freq·t + phase). wave: sine|triangle|saw|square. Параметры: prop|props, amp, freq, phase (градусы), wave, phaseStep (сдвиг фазы на копию).',
    apply: (node, m, mi, name, v, t, ctx, copy, w) => {
      const pi = (m.props || [m.prop || 'y']).indexOf(name);
      const ph = ((m.phase ?? 0) + (m.phaseStep ?? 0) * copy + (m.propPhase ?? 0) * pi) * DEG;
      return addTo(v, ampOf(m, pi) * wave(m.wave, TAU * (m.freq ?? 1) * t + ph) * w);
    },
  },
  orbit: {
    targets: () => ['x', 'y'],
    params: { cx: pNum(0), cy: pNum(0), radius: pNum(100), radiusY: pNum(undefined), speed: pNum(0.25, 'оборотов/с'), phase: pNum(0), phaseStep: pNum(0), additive: pBool(false) },
    doc: 'Движение по эллипсу. Параметры: cx, cy, radius, radiusY, speed (оборотов/сек), phase (градусы), phaseStep, additive (true — прибавлять к x/y).',
    apply: (node, m, mi, name, v, t, ctx, copy, w) => {
      const ph = ((m.phase ?? 0) + (m.phaseStep ?? 0) * copy) * DEG + TAU * (m.speed ?? 0.25) * t;
      const r = m.radius ?? 100, ry = m.radiusY ?? r;
      const val = name === 'x' ? (m.cx ?? 0) + Math.cos(ph) * r : (m.cy ?? 0) + Math.sin(ph) * ry;
      return m.additive ? v + (val - (name === 'x' ? m.cx ?? 0 : m.cy ?? 0)) * w : lerp(v, val, w);
    },
  },
  spin: {
    targets: () => ['rotation'],
    params: { speed: pNum(90, 'градусы/с') },
    doc: 'Постоянное вращение: rotation += speed·t (градусы/сек).',
    apply: (node, m, mi, name, v, t, ctx, copy, w) => v + (m.speed ?? 90) * t * w,
  },
  followPath: {
    targets: (m) => (m.orient ? ['x', 'y', 'rotation'] : ['x', 'y']),
    params: { path: { type: 'any', doc: 'd, фигура или id узла-пути' }, progress: pNum(undefined), speed: pNum(0.2), orient: pBool(false), offset: pNum(0), offsetStep: pNum(0), loop: pBool(true) },
    refs: (m) => (typeof m.path === 'string' ? [m.path] : []), // строка может быть и d, и id — вызывающий оставляет существующие id
    doc: 'Движение вдоль пути. Параметры: path (d, фигура или id узла-пути), progress (число 0..1; по умолчанию берётся свойство pathProgress), speed (циклов/сек, если progress не задан и pathProgress не анимирован), orient, offset (сдвиг доли), loop.',
    apply: (node, m, mi, name, v, t, ctx, copy, w) => {
      let meas;
      if (typeof m.path === 'string' && ctx.c.byId.has(m.path)) {
        const src = ctx.c.byId.get(m.path);
        const g = translateGeom(nodeGeom(src, t, ctx, 0), propValue(src, 'x', t, ctx), propValue(src, 'y', t, ctx));
        meas = measureGeom(g, 24);
      } else {
        const key = `fp|${node.id}|${mi}`;
        meas = ctx.c.measures.get(key);
        if (!meas) { meas = measureGeom(toGeom(m.path, t), 24); ctx.c.measures.set(key, meas); }
      }
      let p;
      if (m.progress != null) p = m.progress;
      else if (node.keys?.pathProgress) p = propValue(node, 'pathProgress', t, ctx, copy);
      else p = (m.speed ?? 0.2) * t;
      p += (m.offset ?? 0) + (m.offsetStep ?? 0) * copy;
      if (m.loop !== false) p = ((p % 1) + 1) % 1; else p = clamp(p);
      const pt = pointAtFraction(meas, p);
      if (name === 'rotation') return v + pt.angle * w;
      return lerp(v, name === 'x' ? pt.x : pt.y, w);
    },
  },
  spring: {
    targets: (m) => m.props || [m.prop || 'x'],
    params: { ...PROP_PARAMS, stiffness: pNum(120), damping: pNum(12), mass: pNum(1) },
    doc: 'Физическая пружина: значение «догоняет» целевое (ключи + предыдущие модификаторы) с инерцией. Параметры: prop|props, stiffness, damping, mass.',
    apply: (node, m, mi, name, v, t, ctx, copy, w) => springValue(node, m, mi, name, t, ctx, copy, w, v),
  },
  deform: {
    targets: () => ['geometry'],
    params: { amount: pNum(10, 'px'), scale: pNum(0.01), speed: pNum(0.5), seed: pNum(0), detail: pNum(0, 'мин. число сегментов') },
    isStatic: (m) => m.speed === 0 && m.start == null && m.end == null && m.weight == null,
    doc: 'Органическая деформация контура шумом. Параметры: amount (px), scale (пространственная частота), speed, seed, detail (мин. число сегментов).',
    apply: (node, m, mi, name, v, t, ctx, copy, w) => v, // применяется к геометрии в nodeGeom
  },
  link: {
    targets: (m) => [m.prop],
    params: { prop: pStr(undefined), source: pStr(undefined, 'id узла'), sourceProp: pStr(undefined), mul: pNum(1), add: pNum(0), delay: pNum(0, 'сек'), additive: pBool(false) },
    refs: (m) => (m.source ? [m.source] : []),
    doc: 'Связь со свойством другого узла: v = src·mul + add (или v += …, если additive). Параметры: prop, source (id), sourceProp, mul, add, delay (сек), additive.',
    apply: (node, m, mi, name, v, t, ctx, copy, w) => {
      const src = ctx.c.byId.get(m.source);
      if (!src || ctx.depth > 16) return v;
      ctx.depth++;
      const sv = propValue(src, m.sourceProp || name, t - (m.delay ?? 0), ctx, copy);
      ctx.depth--;
      if (typeof sv !== 'number') return lerp(0, 1, w) < 0.5 ? v : sv;
      const out = sv * (m.mul ?? 1) + (m.add ?? 0);
      return m.additive ? v + out * w : lerp(v, out, w);
    },
  },
  noiseColor: {
    targets: (m) => [m.prop || 'fill'],
    params: { prop: pStr('fill'), amount: pNum(0.15, '0..1'), speed: pNum(0.3), seed: pNum(3) },
    doc: 'Плавное «плавание» оттенка. Параметры: prop, amount (0..1), speed, seed.',
    apply: (node, m, mi, name, v, t, ctx, copy, w) => {
      const c = parseColor(v);
      if (!c) return v;
      const lab = rgbToOklab(c);
      const amt = (m.amount ?? 0.15) * w;
      const ang = noise1(t * (m.speed ?? 0.3), (m.seed ?? 3) + copy * 13) * Math.PI * amt * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      return formatColor([...oklabToRgb([lab[0], lab[1] * ca - lab[2] * sa, lab[1] * sa + lab[2] * ca]), c[3]]);
    },
  },
  expr: {
    targets: (m) => m.props || [m.prop],
    params: { ...PROP_PARAMS, code: pStr(undefined, 'тело функции (t, v, n, i, ctx)') },
    doc: 'Выражение: тело функции (t, v, n, i, ctx) → новое значение. i — индекс копии, ctx — {noise1, noise3, fbm, lerp, clamp, ease(name, u), scene, prop}. Безопасное подмножество JS (const/let, if/else, return, арифметика, тернарный, Math.*); код вне подмножества исполняется как JS только при KONTUR_TRUST_EXPR=1 (в браузере — всегда). Пример: "return v + Math.sin(t*3 + i)*20".',
    validate: (m) => { if (typeof m.code !== 'string') throw new Error('expr: нужен code — строка'); compileExpr(m.code, { strict: true }); },
    apply: (node, m, mi, name, v, t, ctx, copy, w) => {
      const f = compileExpr(m.code);
      if (f.disabled) return v;
      const out = f(t, v, node, copy, { noise1, noise3, fbm, lerp, clamp, ease: exprEase, scene: ctx.scene, prop: name });
      return out === undefined ? v : w === 1 ? out : interpolate(v, out, w, name);
    },
  },
};

/** Добавить модификатор в реестр: { targets(m), apply(node, m, mi, name, v, t, ctx, copy, w), params?, isStatic?, refs?, validate?, doc }. */
export function registerModifier(type, def) {
  if (!def || typeof def.apply !== 'function' || typeof def.targets !== 'function') throw new Error('registerModifier: нужны targets(m) и apply(...)');
  MODIFIERS[type] = { params: {}, doc: '', ...def };
  return MODIFIERS[type];
}
/** Статичен ли модификатор (не зависит от времени): выключен или так объявил реестр. */
export const modIsStatic = (m) => m.enabled === false || !!MODIFIERS[m.type]?.isStatic?.(m);
/** Кандидаты в id узлов, на которые ссылается модификатор (вызывающий оставляет существующие). */
export const modRefs = (m) => MODIFIERS[m.type]?.refs?.(m) || [];

export const wave = (kind, x) => {
  switch (kind) {
    case 'triangle': return (2 / Math.PI) * Math.asin(Math.sin(x));
    case 'saw': { const f = x / TAU; return 2 * (f - Math.floor(f + 0.5)); }
    case 'square': return Math.tanh(Math.sin(x) * 8);
    default: return Math.sin(x);
  }
};
export function modActive(m, t) {
  if (m.enabled === false) return 0;
  if (m.start != null && t < m.start) return 0;
  if (m.end != null && t > m.end) return 0;
  // плавный вход/выход силы модификатора
  let w = 1;
  if (m.start != null && m.fadeIn) w = Math.min(w, clamp((t - m.start) / m.fadeIn));
  if (m.end != null && m.fadeOut) w = Math.min(w, clamp((m.end - t) / m.fadeOut));
  if (m.weight != null) w *= m.weight;
  return w;
}
export const addTo = (v, d) => (typeof v === 'number' ? v + d : Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? x + d : x)) : v);
