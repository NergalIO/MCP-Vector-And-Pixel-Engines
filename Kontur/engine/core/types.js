/**
 * Реестр типов узлов: геометрия, свойства (для схемы, справки и инспектора) и особенности отрисовки.
 * Новый тип — registerNodeType(name, def); NODE_TYPES обновляется на месте.
 *
 * def: { doc, note?, props: { имя: { type, default?, doc? } }, geom?(P, node, t) → geom,
 *        draw?: 'shape' | 'group' | 'text' | 'image' | 'light', animated?(node) → true, если узел меняется сам по себе }
 */
import { blobGeom, ellipseGeom, polyGeom, rectGeom, regularPts, roundedPoly, toGeom } from './geom.js';

const tNum = (d, doc) => ({ type: 'number', ...(d !== undefined ? { default: d } : {}), ...(doc ? { doc } : {}) });
const tStr = (d, doc) => ({ type: 'string', ...(d !== undefined ? { default: d } : {}), ...(doc ? { doc } : {}) });
const tAny = (doc) => ({ type: 'any', ...(doc ? { doc } : {}) });
const tBool = (d, doc) => ({ type: 'boolean', ...(d !== undefined ? { default: d } : {}), ...(doc ? { doc } : {}) });

/** Общие для всех узлов свойства (трансформация, отрисовка). */
export const COMMON_PROPS = {
  x: tNum(0), y: tNum(0), rotation: tNum(0, 'градусы'), scale: tNum(1), scaleX: tNum(1), scaleY: tNum(1), skewX: tNum(0),
  anchorX: tNum(0), anchorY: tNum(0), opacity: tNum(1), visible: tBool(true),
  fill: tAny('цвет или градиент'), stroke: tAny('цвет или градиент'), strokeWidth: tNum(2), lineCap: tStr('round'), lineJoin: tStr('round'),
  dash: tAny('массив штрихов'), trimStart: tNum(0), trimEnd: tNum(1), trimOffset: tNum(0),
  blur: tNum(0), glow: tAny(), shadow: tAny(), blend: tStr(undefined, 'режим наложения'),
  clip: tStr(undefined, 'id узла-маски обрезки'), mask: tStr(undefined, 'id узла-маски'), repeat: tAny('копии'),
  name: tStr(), shade: tBool(false, 'тень для дизеринга'), dither: tAny(), relief: tAny(), surface: tAny('поверхность для отложенного света'),
};

export const NODE_DEFS = {
  group: { doc: 'контейнер, дети наследуют трансформацию и время', draw: 'group', props: { bone: tBool(false, 'кость скелета'), ik: tAny('двухзвенный IK'), time: tAny('смещение/масштаб времени') } },
  rect: { doc: 'центр в (x, y)', props: { width: tNum(100), height: tNum(100), radius: tNum(0) }, geom: (P) => rectGeom(P('width'), P('height'), P('radius')) },
  ellipse: { doc: '', props: { rx: tNum(50), ry: tNum(50), r: tNum(undefined, 'радиус (вместо rx, ry)') }, geom: circleTypeGeom },
  circle: { doc: '', alias: 'ellipse', props: { r: tNum(undefined, 'радиус'), rx: tNum(50), ry: tNum(50) }, geom: circleTypeGeom },
  polygon: { doc: '', props: { sides: tNum(6), radius: tNum(50), cornerRadius: tNum(0) }, geom: (P) => roundedPoly(regularPts(Math.round(P('sides')), P('radius') || 50), P('cornerRadius')) },
  star: { doc: '', props: { points: tNum(5), outerRadius: tNum(50), innerRadius: tNum(22), cornerRadius: tNum(0) }, geom: (P) => roundedPoly(regularPts(Math.round(P('points')), P('outerRadius'), P('innerRadius')), P('cornerRadius')) },
  path: { doc: '', props: { d: tAny('SVG path / описание фигуры'), points: tAny('[[x,y],…]'), smooth: tNum(undefined), closed: tBool(undefined) },
    geom: (P, node) => (node.props?.points ? toGeom({ points: P('points'), smooth: P('smooth'), closed: P('closed') }) : []) },
  line: { doc: 'обводка по умолчанию белая', props: { x1: tNum(0), y1: tNum(0), x2: tNum(100), y2: tNum(0) }, geom: (P) => polyGeom([[P('x1'), P('y1')], [P('x2'), P('y2')]], false) },
  blob: { doc: '«живая» органическая клякса — анимируется сама',
    props: { radius: tNum(80), points: tNum(8), amount: tNum(0.25), frequency: tNum(1.2), speed: tNum(0.5), seed: tNum(1), tension: tNum(1), stretchX: tNum(1), stretchY: tNum(1) },
    defaults: { radius: 80, points: 8, amount: 0.25, frequency: 1.2, speed: 0.5, seed: 1, tension: 1 },
    animated: (n) => (n.props?.speed ?? 0.5) !== 0,
    geom: (P, node, t) => blobGeom({ radius: P('radius'), points: P('points'), amount: P('amount'), frequency: P('frequency'), speed: P('speed'), seed: P('seed'), tension: P('tension'), stretchX: P('stretchX') ?? 1, stretchY: P('stretchY') ?? 1 }, t) },
  text: { doc: '', draw: 'text', props: { text: tStr(''), fontSize: tNum(48), fontFamily: tStr(), fontWeight: tNum(600), textAlign: tStr('center'), letterSpacing: tNum(0), textReveal: tNum(1, '0..1'), path: tAny('путь для текста по кривой (d, фигура или id узла)'), pathOffset: tNum(0, 'сдвиг начала вдоль пути, 0..1') } },
  image: { doc: 'растровый слой, центр в (x, y)', draw: 'image',
    props: { src: tStr(), width: tNum(100), height: tNum(100), fit: tStr('stretch'), pixelated: tBool(false), sheet: tAny('спрайт-лист'), frame: tNum(undefined), normalSrc: tStr(), normalMap: tStr() },
    animated: (n) => !!(n.props?.sheet && n.props.frame == null && !n.keys?.frame) },
  instance: { doc: 'экземпляр символа из scene.symbols: своя трансформация и своё время (timeOffset, timeScale), символ — по кругу или с остановкой', draw: 'instance',
    props: { symbol: tStr(undefined, 'имя символа'), loop: tBool(true, 'по длительности символа — по кругу'), symbolTime: tNum(undefined, 'явное время символа (можно анимировать)'), timeOffset: tNum(0), timeScale: tNum(1) },
    animated: () => true },
  light: { doc: 'точечный свет: сам не рисуется, виден в превью «Свет» и уходит в Godot как `PointLight2D`, в Unity — как `Light2D`', draw: 'light',
    props: { z: tNum(80), color: tStr('#ffffff'), energy: tNum(1), radius: tNum(500), falloff: tNum(1) },
    defaults: { z: 80, color: '#ffffff', energy: 1, radius: 500 }, animated: () => true },
};
function circleTypeGeom(P, node) {
  const r = node.props?.r != null || node.keys?.r ? P('r') : null;
  return ellipseGeom(r ?? P('rx'), r ?? P('ry'));
}

export const NODE_TYPES = Object.keys(NODE_DEFS);
/** Значения по умолчанию, отличные от общих (для defaultFor). */
export const TYPE_DEFAULTS = { polygon: { radius: 50 } };
for (const [k, d] of Object.entries(NODE_DEFS)) if (d.defaults) TYPE_DEFAULTS[k] = { ...(TYPE_DEFAULTS[k] || {}), ...d.defaults };

/** Зарегистрировать тип узла (или заменить существующий). */
export function registerNodeType(name, def) {
  if (!/^[a-z][\w-]*$/i.test(name)) throw new Error(`Недопустимое имя типа «${name}»`);
  NODE_DEFS[name] = { props: {}, draw: def.geom ? 'shape' : def.draw || 'shape', ...def };
  if (!NODE_TYPES.includes(name)) NODE_TYPES.push(name);
  // значения по умолчанию: явные defaults или default из описаний свойств
  const defs = def.defaults || Object.fromEntries(Object.entries(def.props || {}).filter(([, p]) => p?.default !== undefined).map(([k, p]) => [k, p.default]));
  if (Object.keys(defs).length) TYPE_DEFAULTS[name] = defs; else delete TYPE_DEFAULTS[name];
  return NODE_DEFS[name];
}
/** Свойства типа (общие + свои) с описаниями. */
export function typeProps(type) { return { ...COMMON_PROPS, ...(NODE_DEFS[type]?.props || {}) }; }
/** Меняется ли узел сам по себе (без ключей и модификаторов): клякса с движением, спрайт-лист, свет. */
export const typeAnimated = (n) => !!NODE_DEFS[n.type]?.animated?.(n);
