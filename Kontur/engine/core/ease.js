/** Кривые сглаживания: именованные, cubic-bezier, пружины, ступени. */
import { TAU } from './math.js';

export const c1 = 1.70158, c2 = c1 * 1.525, c3 = c1 + 1, c4 = TAU / 3, c5 = TAU / 4.5;
export function outBounce(x) {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
}
export const easings = {
  linear: (x) => x,
  hold: (x) => (x < 1 ? 0 : 1),
  inSine: (x) => 1 - Math.cos((x * Math.PI) / 2),
  outSine: (x) => Math.sin((x * Math.PI) / 2),
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
  inCubic: (x) => x ** 3,
  outCubic: (x) => 1 - (1 - x) ** 3,
  inOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  inQuart: (x) => x ** 4,
  outQuart: (x) => 1 - (1 - x) ** 4,
  inOutQuart: (x) => (x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2),
  inQuint: (x) => x ** 5,
  outQuint: (x) => 1 - (1 - x) ** 5,
  inOutQuint: (x) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2),
  inExpo: (x) => (x === 0 ? 0 : 2 ** (10 * x - 10)),
  outExpo: (x) => (x === 1 ? 1 : 1 - 2 ** (-10 * x)),
  inOutExpo: (x) => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2),
  inCirc: (x) => 1 - Math.sqrt(1 - x * x),
  outCirc: (x) => Math.sqrt(1 - (x - 1) ** 2),
  inOutCirc: (x) => (x < 0.5 ? (1 - Math.sqrt(1 - (2 * x) ** 2)) / 2 : (Math.sqrt(1 - (-2 * x + 2) ** 2) + 1) / 2),
  inBack: (x) => c3 * x ** 3 - c1 * x * x,
  outBack: (x) => 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2,
  inOutBack: (x) => (x < 0.5 ? ((2 * x) ** 2 * ((c2 + 1) * 2 * x - c2)) / 2 : ((2 * x - 2) ** 2 * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2),
  inElastic: (x) => (x === 0 ? 0 : x === 1 ? 1 : -(2 ** (10 * x - 10)) * Math.sin((x * 10 - 10.75) * c4)),
  outElastic: (x) => (x === 0 ? 0 : x === 1 ? 1 : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1),
  inOutElastic: (x) => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? -(2 ** (20 * x - 10) * Math.sin((20 * x - 11.125) * c5)) / 2 : (2 ** (-20 * x + 10) * Math.sin((20 * x - 11.125) * c5)) / 2 + 1),
  inBounce: (x) => 1 - outBounce(1 - x),
  outBounce,
  inOutBounce: (x) => (x < 0.5 ? (1 - outBounce(1 - 2 * x)) / 2 : (1 + outBounce(2 * x - 1)) / 2),
};
// Синонимы в стиле CSS
easings.ease = cubicBezier(0.25, 0.1, 0.25, 1);
easings['ease-in'] = cubicBezier(0.42, 0, 1, 1);
easings['ease-out'] = cubicBezier(0, 0, 0.58, 1);
easings['ease-in-out'] = cubicBezier(0.42, 0, 0.58, 1);
easings.smooth = cubicBezier(0.65, 0, 0.35, 1);
easings.snappy = cubicBezier(0.2, 0.9, 0.1, 1);
easings.anticipate = cubicBezier(0.6, -0.3, 0.3, 1.25);

/** CSS-совместимая cubic-bezier. */
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-7) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1; t = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (x > v) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : sy(solve(x)));
}

/** Пружинная кривая: растянута на длительность сегмента, заканчивается ровно в 1. */
export function springEase({ stiffness = 180, damping = 12, mass = 1, velocity = 0 } = {}) {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  let x;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const B = (zeta * w0 - velocity) / wd;
    x = (t) => Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + B * Math.sin(wd * t));
  } else if (zeta === 1) {
    const B = w0 - velocity;
    x = (t) => (1 + B * t) * Math.exp(-w0 * t);
  } else {
    const s = Math.sqrt(zeta * zeta - 1);
    const ra = -w0 * (zeta - s), rb = -w0 * (zeta + s);
    const Cb = (-velocity - ra) / (rb - ra), Ca = 1 - Cb;
    x = (t) => Ca * Math.exp(ra * t) + Cb * Math.exp(rb * t);
  }
  // время успокоения
  let Ts = 20, calm = 0;
  for (let t = 0; t < 20; t += 1 / 240) {
    if (Math.abs(x(t)) < 5e-4) { calm += 1 / 240; if (calm > 0.3) { Ts = t; break; } } else calm = 0;
  }
  return (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 1 - x(u * Ts));
}

export const easeCache = new Map();
/**
 * Превращает описание кривой в функцию.
 * Допустимо: имя ('outBack'), 'cubic-bezier(a,b,c,d)', [a,b,c,d],
 * {spring:{stiffness,damping,mass,velocity}}, {steps:n}, функция.
 */
export function resolveEase(e) {
  if (typeof e === 'function') return e;
  if (e == null) return easings.inOutCubic;
  if (Array.isArray(e) && e.length === 4) {
    // массив пересоздаётся при каждом разборе сцены — кэш по значениям, а не по объекту
    const k = 'b' + e[0] + ',' + e[1] + ',' + e[2] + ',' + e[3];
    let f = easeCache.get(k);
    if (!f) { f = cubicBezier(...e); easeCache.set(k, f); }
    return f;
  }
  if (typeof e === 'string') {
    if (easings[e]) return easings[e];
    if (easeCache.has(e)) return easeCache.get(e);
    const m = /^cubic-bezier\(([^)]+)\)$/.exec(e.trim());
    if (m) { const f = cubicBezier(...m[1].split(',').map(Number)); easeCache.set(e, f); return f; }
    const sm = /^spring(?:\(([^)]*)\))?$/.exec(e.trim());
    if (sm) {
      const [stiffness, damping, mass] = (sm[1] || '').split(',').map((s) => (s.trim() ? Number(s) : undefined));
      const f = springEase({ stiffness, damping, mass }); easeCache.set(e, f); return f;
    }
    throw new Error(`Неизвестная кривая сглаживания: ${e}`);
  }
  if (typeof e === 'object') {
    if (e.spring) {
      const k = JSON.stringify(e.spring);
      if (!easeCache.has('s' + k)) easeCache.set('s' + k, springEase(e.spring));
      return easeCache.get('s' + k);
    }
    if (e.steps) { const n = e.steps; return (u) => Math.min(1, Math.floor(u * n) / n); }
    if (e.bezier) return cubicBezier(...e.bezier);
  }
  throw new Error(`Неизвестная кривая сглаживания: ${JSON.stringify(e)}`);
}
