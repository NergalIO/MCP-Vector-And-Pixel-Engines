/** Интерполяция значений и дорожки ключевых кадров. */
import { mixColor, parseColor } from './color.js';
import { resolveEase } from './ease.js';
import { lerpGeom, morph, prepareMorph, toGeom } from './geom.js';
import { lerp } from './math.js';

export const GEOM_PROPS = new Set(['d', 'path', 'shape']);
export const isGrad = (v) => v && typeof v === 'object' && (v.type === 'linear' || v.type === 'radial') && Array.isArray(v.stops);
export const normStops = (st) => st.map((s) => (Array.isArray(s) ? { offset: s[0], color: s[1], opacity: s[2] } : s));

export function interpolate(a, b, u, prop) {
  if (u <= 0 && !GEOM_PROPS.has(prop)) return a;
  if (u >= 1 && !GEOM_PROPS.has(prop)) return b;
  if (GEOM_PROPS.has(prop)) return { geom: morph(a, b, u) };
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, u);
  if (typeof a === 'string' && typeof b === 'string') {
    if (parseColor(a) && parseColor(b)) return mixColor(a, b, u);
    return u < 1 ? a : b;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((x, i) => interpolate(x, b[i], u, prop));
  if (isGrad(a) && typeof b === 'string' && parseColor(b)) b = { ...a, stops: normStops(a.stops).map((s) => ({ ...s, color: b })) };
  if (typeof a === 'string' && parseColor(a) && isGrad(b)) a = { ...b, stops: normStops(b.stops).map((s) => ({ ...s, color: a })) };
  if (isGrad(a) && isGrad(b) && a.type === b.type && a.stops.length === b.stops.length) {
    const out = { ...a };
    for (const k of ['x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'fx', 'fy', 'angle']) if (typeof a[k] === 'number' && typeof b[k] === 'number') out[k] = lerp(a[k], b[k], u);
    const sa = normStops(a.stops), sb = normStops(b.stops);
    out.stops = sa.map((s, i) => ({ offset: lerp(s.offset, sb[i].offset, u), color: mixColor(s.color, sb[i].color, u), opacity: lerp(s.opacity ?? 1, sb[i].opacity ?? 1, u) }));
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) {
    const out = { ...a };
    for (const k of Object.keys(b)) out[k] = k in a ? interpolate(a[k], b[k], u, k) : b[k];
    return out;
  }
  return u < 1 ? a : b;
}

const isLive = (v) => v && typeof v === 'object' && v.shape === 'blob';

/**
 * Скомпилированная дорожка: времена в Float64Array, готовые функции кривых, подготовленные пары морфинга.
 * Кэшируется в кэше сцены по объекту массива ключей (сбрасывается invalidate / invalidateNode).
 */
export function compileTrack(keys, prop) {
  const n = keys.length, times = new Float64Array(n), eases = new Array(n);
  for (let j = 0; j < n; j++) { times[j] = keys[j].t; eases[j] = keys[j].hold ? null : resolveEase(keys[j].ease); }
  // источники (для проверки правок на месте без invalidate): кривая и значение каждого ключа
  return { keys, times, eases, src: keys.map((k) => [k.ease, k.v, !!k.hold]), geom: GEOM_PROPS.has(prop), morphs: new Array(n), ends: [null, null], hint: 0 };
}
/** Индекс сегмента: наибольший i ∈ [0, n−2], для которого times[i] ≤ t (как прежний линейный поиск). */
function segIndex(tr, t) {
  const T = tr.times, n = T.length;
  const i = tr.hint;
  if (i < n - 1 && T[i] <= t && (i === n - 2 || t < T[i + 1])) return i;
  let lo = 0, hi = n - 2;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (T[mid] <= t) lo = mid; else hi = mid - 1; }
  tr.hint = lo;
  return lo;
}

/**
 * Значение дорожки ключевых кадров в момент t. keys: [{t, v, ease}].
 * cache — Map дорожек сцены (необязательно): с ним поиск двоичный, кривые и морфинг готовятся один раз.
 */
export function sampleKeys(keys, t, prop, cache) {
  if (!keys || !keys.length) return undefined;
  if (!cache) return sampleKeysRaw(keys, t, prop);
  let tr = cache.get(keys);
  const n = keys.length;
  if (!tr || tr.times.length !== n || tr.times[0] !== keys[0].t || tr.times[n - 1] !== keys[n - 1].t) { tr = compileTrack(keys, prop); cache.set(keys, tr); }
  if (n === 1 || t <= tr.times[0]) return tr.geom ? endGeom(tr, 0, keys[0].v, t) : keys[0].v;
  if (t >= tr.times[n - 1]) return tr.geom ? endGeom(tr, 1, keys[n - 1].v, t) : keys[n - 1].v;
  let i = segIndex(tr, t);
  let k0 = keys[i], k1 = keys[i + 1];
  if (!fresh(tr, i, k0) || !fresh(tr, i + 1, k1)) { tr = compileTrack(keys, prop); cache.set(keys, tr); i = segIndex(tr, t); k0 = keys[i]; k1 = keys[i + 1]; }
  const span = tr.times[i + 1] - tr.times[i];
  let u = span > 0 ? (t - tr.times[i]) / span : 1;
  u = k0.hold ? 0 : tr.eases[i](u);
  if (tr.geom) {
    if (isLive(k0.v) || isLive(k1.v)) return { geom: morph(isLive(k0.v) ? { ...k0.v, time: t } : k0.v, isLive(k1.v) ? { ...k1.v, time: t } : k1.v, u) };
    const pairs = tr.morphs[i] || (tr.morphs[i] = prepareMorph(toGeom(k0.v), toGeom(k1.v)));
    return { geom: lerpGeom(pairs, u) };
  }
  return interpolate(k0.v, k1.v, u, prop);
}
const fresh = (tr, j, k) => tr.times[j] === k.t && tr.src[j][0] === k.ease && tr.src[j][1] === k.v && tr.src[j][2] === !!k.hold;
function endGeom(tr, which, v, t) {
  if (isLive(v)) return { geom: toGeom(v, t) };
  const e = tr.ends[which];
  if (e && e.v === v) return e.g;
  const g = { geom: toGeom(v, t) };
  tr.ends[which] = { v, g };
  return g;
}
/** Без кэша (публичный вызов без сцены). */
function sampleKeysRaw(keys, t, prop) {
  if (keys.length === 1 || t <= keys[0].t) return GEOM_PROPS.has(prop) ? { geom: toGeom(keys[0].v, t) } : keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return GEOM_PROPS.has(prop) ? { geom: toGeom(last.v, t) } : last.v;
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const k0 = keys[i], k1 = keys[i + 1];
  const span = k1.t - k0.t;
  let u = span > 0 ? (t - k0.t) / span : 1;
  u = k0.hold ? 0 : resolveEase(k0.ease)(u);
  if (GEOM_PROPS.has(prop)) {
    const live = (v) => (isLive(v) ? { ...v, time: t } : v);
    return { geom: morph(live(k0.v), live(k1.v), u) };
  }
  return interpolate(k0.v, k1.v, u, prop);
}
