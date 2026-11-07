/*!
 * Kontur — движок векторной анимации
 * Ключевые кадры, морфинг путей, процедурные модификаторы, SVG-рендер.
 * Один ES-модуль без зависимостей: работает в браузере и в Node.js.
 */

export const VERSION = '0.2.0';

/* =========================================================================
 * 1. Математика и шум
 * ========================================================================= */

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, u) => a + (b - a) * u;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const r3 = (n) => Math.round(n * 1000) / 1000;

function hash3(x, y, z, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul((s | 0) + 1013, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}
const G3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Градиентный шум Перлина 3D, диапазон примерно [-1, 1]. */
export function noise3(x, y, z, seed = 0) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  const fx = x - X, fy = y - Y, fz = z - Z;
  const g = (i, j, k) => {
    const v = G3[hash3(X + i, Y + j, Z + k, seed) % 12];
    return v[0] * (fx - i) + v[1] * (fy - j) + v[2] * (fz - k);
  };
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const x00 = lerp(g(0,0,0), g(1,0,0), u), x10 = lerp(g(0,1,0), g(1,1,0), u);
  const x01 = lerp(g(0,0,1), g(1,0,1), u), x11 = lerp(g(0,1,1), g(1,1,1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 1.1;
}
/** 1D шум (срез 3D). */
export const noise1 = (x, seed = 0) => noise3(x, 0.371, 0.713, seed);
/** Фрактальный шум. */
export function fbm(x, seed = 0, octaves = 1, y = 0.371, z = 0.713) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(x * freq, y * freq, z * freq, seed + o * 31);
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

/* =========================================================================
 * 2. Кривые сглаживания (easing)
 * ========================================================================= */

const c1 = 1.70158, c2 = c1 * 1.525, c3 = c1 + 1, c4 = TAU / 3, c5 = TAU / 4.5;
function outBounce(x) {
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

const easeCache = new Map();
/**
 * Превращает описание кривой в функцию.
 * Допустимо: имя ('outBack'), 'cubic-bezier(a,b,c,d)', [a,b,c,d],
 * {spring:{stiffness,damping,mass,velocity}}, {steps:n}, функция.
 */
export function resolveEase(e) {
  if (typeof e === 'function') return e;
  if (e == null) return easings.inOutCubic;
  if (Array.isArray(e) && e.length === 4) return cubicBezier(...e);
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

/* =========================================================================
 * 3. Цвета (интерполяция в OKLab)
 * ========================================================================= */

const NAMED = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', lime: '#00ff00', blue: '#0000ff',
  yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff', orange: '#ffa500', purple: '#800080',
  pink: '#ffc0cb', gray: '#808080', grey: '#808080', navy: '#000080', teal: '#008080', gold: '#ffd700',
  coral: '#ff7f50', crimson: '#dc143c', indigo: '#4b0082', violet: '#ee82ee', salmon: '#fa8072',
  turquoise: '#40e0d0', tomato: '#ff6347', orchid: '#da70d6', skyblue: '#87ceeb', hotpink: '#ff69b4',
  transparent: 'rgba(0,0,0,0)',
};
const colorCache = new Map();
/** Разбор цвета в [r,g,b,a] (0..1, sRGB) или null. */
export function parseColor(s) {
  if (typeof s !== 'string') return null;
  if (colorCache.has(s)) return colorCache.get(s);
  let str = s.trim().toLowerCase();
  if (NAMED[str]) str = NAMED[str];
  let out = null;
  if (str[0] === '#') {
    let h = str.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if ((h.length === 6 || h.length === 8) && /^[0-9a-f]+$/.test(h)) {
      out = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
      out.push(h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1);
    }
  } else {
    const m = /^(rgba?|hsla?)\(([^)]+)\)$/.exec(str);
    if (m) {
      const parts = m[2].split(/[\s,/]+/).filter(Boolean);
      const num = (p, scale) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p) / scale);
      if (m[1].startsWith('rgb')) {
        out = [num(parts[0], 255), num(parts[1], 255), num(parts[2], 255), parts[3] != null ? num(parts[3], 1) : 1];
      } else {
        const h = (((parseFloat(parts[0]) % 360) + 360) % 360) / 360;
        const sat = num(parts[1], 100), l = num(parts[2], 100);
        const a = parts[3] != null ? num(parts[3], 1) : 1;
        const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
        const f = (t) => {
          t = (t + 1) % 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };
        out = [f(h + 1 / 3), f(h), f(h - 1 / 3), a];
      }
    }
  }
  if (out && out.some((v) => Number.isNaN(v))) out = null;
  if (colorCache.size > 2000) colorCache.clear();
  colorCache.set(s, out);
  return out;
}
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function rgbToOklab([r, g, b]) {
  r = toLin(r); g = toLin(g); b = toLin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toGam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ].map((v) => clamp(v));
}
export function formatColor([r, g, b, a = 1]) {
  const R = Math.round(clamp(r) * 255), G = Math.round(clamp(g) * 255), B = Math.round(clamp(b) * 255);
  if (a >= 0.999) return '#' + [R, G, B].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `rgba(${R},${G},${B},${r3(clamp(a))})`;
}
export function mixColor(ca, cb, u) {
  const A = parseColor(ca), B = parseColor(cb);
  if (!A || !B) return u < 1 ? ca : cb;
  // прозрачный цвет перенимает оттенок другого, чтобы не «проваливаться» в серый
  const la = A[3] === 0 ? rgbToOklab(B) : rgbToOklab(A);
  const lb = B[3] === 0 ? rgbToOklab(A) : rgbToOklab(B);
  const L = [lerp(la[0], lb[0], u), lerp(la[1], lb[1], u), lerp(la[2], lb[2], u)];
  return formatColor([...oklabToRgb(L), lerp(A[3], B[3], u)]);
}

/* =========================================================================
 * 4. Геометрия: пути, фигуры, морфинг, измерение
 *    Геометрия = массив подпутей { x0, y0, segs: [[c1x,c1y,c2x,c2y,x,y], ...], closed }
 * ========================================================================= */

const lineSeg = (x0, y0, x, y) => [x0 + (x - x0) / 3, y0 + (y - y0) / 3, x0 + (2 * (x - x0)) / 3, y0 + (2 * (y - y0)) / 3, x, y];

function arcToCubics(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  if (rx === 0 || ry === 0) return [lineSeg(x1, y1, x2, y2)];
  const sinp = Math.sin(phi * DEG), cosp = Math.cos(phi * DEG);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cosp * dx + sinp * dy, yp = -sinp * dx + cosp * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  let co = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) co = -co;
  const cxp = (co * rx * yp) / ry, cyp = (-co * ry * xp) / rx;
  const cx = cosp * cxp - sinp * cyp + (x1 + x2) / 2;
  const cy = sinp * cxp + cosp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!fs && dt > 0) dt -= TAU;
  if (fs && dt < 0) dt += TAU;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const d = dt / n, k = (4 / 3) * Math.tan(d / 4);
  const out = [];
  let a = t1;
  const pt = (t) => [cx + rx * Math.cos(t) * cosp - ry * Math.sin(t) * sinp, cy + rx * Math.cos(t) * sinp + ry * Math.sin(t) * cosp];
  const dv = (t) => [-rx * Math.sin(t) * cosp - ry * Math.cos(t) * sinp, -rx * Math.sin(t) * sinp + ry * Math.cos(t) * cosp];
  for (let i = 0; i < n; i++) {
    const b = a + d;
    const p0 = pt(a), p1 = pt(b), d0 = dv(a), d1 = dv(b);
    out.push([p0[0] + k * d0[0], p0[1] + k * d0[1], p1[0] - k * d1[0], p1[1] - k * d1[1], p1[0], p1[1]]);
    a = b;
  }
  const last = out[out.length - 1]; last[4] = x2; last[5] = y2;
  return out;
}

const pathCache = new Map();
/** Разбор SVG path d → геометрия. Поддерживает M L H V C S Q T A Z (абс./отн.). */
export function parsePath(d) {
  if (pathCache.has(d)) return pathCache.get(d);
  const toks = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) || [];
  let i = 0;
  const subs = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = '', prevC = null, prevQ = null;
  const num = () => {
    const t = toks[i++];
    if (t === undefined || /[a-z]/i.test(t)) throw new Error(`Ошибка разбора пути около «${t}»`);
    return parseFloat(t);
  };
  const flag = () => {
    const t = toks[i];
    if (t.length > 1 && (t[0] === '0' || t[0] === '1')) { toks[i] = t.slice(1); return t[0] === '1'; }
    i++; return t === '1';
  };
  const ensure = () => { if (!cur) { cur = { x0: x, y0: y, segs: [], closed: false }; subs.push(cur); } };
  while (i < toks.length) {
    if (/[a-z]/i.test(toks[i])) cmd = toks[i++];
    else if (!cmd) throw new Error('Путь должен начинаться с команды');
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z' ? 1 : 0;
    const C = cmd.toUpperCase();
    let nextC = null, nextQ = null;
    switch (C) {
      case 'M': {
        x = num() + rel * x; y = num() + rel * y;
        cur = { x0: x, y0: y, segs: [], closed: false }; subs.push(cur); sx = x; sy = y;
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L': { ensure(); const nx = num() + rel * x, ny = num() + rel * y; cur.segs.push(lineSeg(x, y, nx, ny)); x = nx; y = ny; break; }
      case 'H': { ensure(); const nx = num() + rel * x; cur.segs.push(lineSeg(x, y, nx, y)); x = nx; break; }
      case 'V': { ensure(); const ny = num() + rel * y; cur.segs.push(lineSeg(x, y, x, ny)); y = ny; break; }
      case 'C': {
        ensure();
        const a = num() + rel * x, b = num() + rel * y, c = num() + rel * x, e = num() + rel * y, nx = num() + rel * x, ny = num() + rel * y;
        cur.segs.push([a, b, c, e, nx, ny]); nextC = [c, e]; x = nx; y = ny; break;
      }
      case 'S': {
        ensure();
        const a = prevC ? 2 * x - prevC[0] : x, b = prevC ? 2 * y - prevC[1] : y;
        const c = num() + rel * x, e = num() + rel * y, nx = num() + rel * x, ny = num() + rel * y;
        cur.segs.push([a, b, c, e, nx, ny]); nextC = [c, e]; x = nx; y = ny; break;
      }
      case 'Q': case 'T': {
        ensure();
        let qx, qy;
        if (C === 'Q') { qx = num() + rel * x; qy = num() + rel * y; }
        else { qx = prevQ ? 2 * x - prevQ[0] : x; qy = prevQ ? 2 * y - prevQ[1] : y; }
        const nx = num() + rel * x, ny = num() + rel * y;
        cur.segs.push([x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny]);
        nextQ = [qx, qy]; x = nx; y = ny; break;
      }
      case 'A': {
        ensure();
        const rx = num(), ry = num(), phi = num(), fa = flag(), fs = flag();
        const nx = num() + rel * x, ny = num() + rel * y;
        cur.segs.push(...arcToCubics(x, y, rx, ry, phi, fa, fs, nx, ny)); x = nx; y = ny; break;
      }
      case 'Z': {
        if (cur) {
          if (Math.hypot(x - cur.x0, y - cur.y0) > 1e-9) cur.segs.push(lineSeg(x, y, cur.x0, cur.y0));
          cur.closed = true;
        }
        x = sx; y = sy; cur = null; break;
      }
      default: throw new Error(`Неизвестная команда пути ${cmd}`);
    }
    prevC = nextC; prevQ = nextQ;
  }
  const out = subs.filter((s) => s.segs.length > 0);
  if (pathCache.size > 1000) pathCache.clear();
  pathCache.set(d, out);
  return out;
}

export function geomToPath(g) {
  let s = '';
  for (const sp of g) {
    s += `M${r3(sp.x0)} ${r3(sp.y0)}`;
    for (const c of sp.segs) s += `C${r3(c[0])} ${r3(c[1])} ${r3(c[2])} ${r3(c[3])} ${r3(c[4])} ${r3(c[5])}`;
    if (sp.closed) s += 'Z';
  }
  return s;
}

const K = 0.5522847498;
function ellipseGeom(rx, ry) {
  return [{ x0: rx, y0: 0, closed: true, segs: [
    [rx, K * ry, K * rx, ry, 0, ry], [-K * rx, ry, -rx, K * ry, -rx, 0],
    [-rx, -K * ry, -K * rx, -ry, 0, -ry], [K * rx, -ry, rx, -K * ry, rx, 0],
  ] }];
}
function polyGeom(pts, closed = true) {
  const segs = [];
  for (let i = 1; i < pts.length; i++) segs.push(lineSeg(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  if (closed && pts.length > 2) segs.push(lineSeg(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]));
  return [{ x0: pts[0][0], y0: pts[0][1], segs, closed }];
}
/** Гладкая кривая через точки (Catmull-Rom → кубики). tension 0..1 (1 = обычный CR). */
export function smoothGeom(pts, closed = true, tension = 1) {
  const n = pts.length, segs = [];
  if (n < 2) return [{ x0: pts[0]?.[0] || 0, y0: pts[0]?.[1] || 0, segs: [], closed: false }];
  const P = (i) => (closed ? pts[((i % n) + n) % n] : pts[clamp(i, 0, n - 1)]);
  const last = closed ? n : n - 1, k = tension / 6;
  for (let i = 0; i < last; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    segs.push([p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k, p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k, p2[0], p2[1]]);
  }
  return [{ x0: pts[0][0], y0: pts[0][1], segs, closed }];
}
function rectGeom(w, h, r = 0) {
  const x = -w / 2, y = -h / 2;
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r < 1e-6) return polyGeom([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
  const k = r * (1 - K), segs = [];
  let px = x + r, py = y;
  const L = (nx, ny) => { segs.push(lineSeg(px, py, nx, ny)); px = nx; py = ny; };
  const A = (a, b, c, d, nx, ny) => { segs.push([a, b, c, d, nx, ny]); px = nx; py = ny; };
  L(x + w - r, y); A(x + w - k, y, x + w, y + k, x + w, y + r);
  L(x + w, y + h - r); A(x + w, y + h - k, x + w - k, y + h, x + w - r, y + h);
  L(x + r, y + h); A(x + k, y + h, x, y + h - k, x, y + h - r);
  L(x, y + r); A(x, y + k, x + k, y, x + r, y);
  return [{ x0: x + r, y0: y, segs, closed: true }];
}
function regularPts(n, r, rInner = null, rotation = 0) {
  const pts = [], count = rInner == null ? n : n * 2;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + rotation * DEG + (i * TAU) / count;
    const rr = rInner == null || i % 2 === 0 ? r : rInner;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return pts;
}
/** Сглаживает углы многоугольника дугами радиуса rad. */
function roundedPoly(pts, rad) {
  if (!rad) return polyGeom(pts);
  const n = pts.length, segs = [];
  const corners = pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const r = Math.min(rad, da / 2, db / 2);
    const ia = [p[0] + ((a[0] - p[0]) * r) / da, p[1] + ((a[1] - p[1]) * r) / da];
    const ib = [p[0] + ((b[0] - p[0]) * r) / db, p[1] + ((b[1] - p[1]) * r) / db];
    return { p, ia, ib };
  });
  for (let i = 0; i < n; i++) {
    const c = corners[i], nx = corners[(i + 1) % n];
    segs.push([c.ia[0] + (c.p[0] - c.ia[0]) * K, c.ia[1] + (c.p[1] - c.ia[1]) * K, c.ib[0] + (c.p[0] - c.ib[0]) * K, c.ib[1] + (c.p[1] - c.ib[1]) * K, c.ib[0], c.ib[1]]);
    segs.push(lineSeg(c.ib[0], c.ib[1], nx.ia[0], nx.ia[1]));
  }
  return [{ x0: corners[0].ia[0], y0: corners[0].ia[1], segs, closed: true }];
}
function blobGeom(p, t) {
  const n = Math.max(3, Math.round(p.points ?? 8)), pts = [];
  const R = p.radius ?? 80, amt = p.amount ?? 0.25, fr = p.frequency ?? 1.2, sp = p.speed ?? 0.5, seed = p.seed ?? 1;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const nz = noise3(Math.cos(a) * fr + 10, Math.sin(a) * fr + 10, t * sp, seed);
    const r = R * (1 + amt * nz);
    pts.push([Math.cos(a) * r * (p.stretchX ?? 1), Math.sin(a) * r * (p.stretchY ?? 1)]);
  }
  return smoothGeom(pts, true, p.tension ?? 1);
}

/**
 * Описание фигуры → геометрия. Принимает:
 *   строку path d; {shape:'rect'|'ellipse'|'circle'|'polygon'|'star'|'line'|'blob'|'heart', ...};
 *   {points:[[x,y],...], closed, smooth}; уже готовую геометрию {geom:[...]}.
 */
export function toGeom(v, t = 0) {
  if (v == null) return [];
  if (typeof v === 'string') return parsePath(v);
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === 'object' && 'segs' in v[0]) return v;
    if (v.length && Array.isArray(v[0])) return polyGeom(v, true);
    return [];
  }
  if (v.geom) return v.geom;
  if (v.points && Array.isArray(v.points)) {
    const closed = v.closed !== false;
    return v.smooth ? smoothGeom(v.points, closed, v.tension ?? 1) : polyGeom(v.points, closed);
  }
  const s = v.shape;
  const g = (() => {
    switch (s) {
      case 'rect': return rectGeom(v.width ?? 100, v.height ?? 100, v.radius ?? 0);
      case 'circle': return ellipseGeom(v.r ?? v.radius ?? 50, v.r ?? v.radius ?? 50);
      case 'ellipse': return ellipseGeom(v.rx ?? v.r ?? 50, v.ry ?? v.r ?? 50);
      case 'polygon': return roundedPoly(regularPts(v.sides ?? 6, v.radius ?? 50, null, v.rotation ?? 0), v.cornerRadius ?? 0);
      case 'star': return roundedPoly(regularPts(v.points ?? 5, v.outerRadius ?? v.radius ?? 50, v.innerRadius ?? (v.outerRadius ?? v.radius ?? 50) * 0.45, v.rotation ?? 0), v.cornerRadius ?? 0);
      case 'line': return polyGeom([[v.x1 ?? 0, v.y1 ?? 0], [v.x2 ?? 100, v.y2 ?? 0]], false);
      case 'blob': return blobGeom(v, v.time ?? t);
      case 'heart': {
        const r = (v.size ?? 100) / 100;
        return parsePath('M0 30C-25 10-50 0-50-22C-50-42-34-55-18-55C-6-55 0-46 0-40C0-46 6-55 18-55C34-55 50-42 50-22C50 0 25 10 0 30Z')
          .map((sp) => ({ ...sp, x0: sp.x0 * r, y0: sp.y0 * r, segs: sp.segs.map((c) => c.map((q) => q * r)) }));
      }
      default: throw new Error(`Неизвестная фигура: ${s}`);
    }
  })();
  if (v.x || v.y) return translateGeom(g, v.x || 0, v.y || 0);
  return g;
}
export function translateGeom(g, dx, dy) {
  return g.map((sp) => ({ ...sp, x0: sp.x0 + dx, y0: sp.y0 + dy, segs: sp.segs.map((c) => [c[0] + dx, c[1] + dy, c[2] + dx, c[3] + dy, c[4] + dx, c[5] + dy]) }));
}

function splitSeg(x0, y0, c, u = 0.5) {
  const [x1, y1, x2, y2, x3, y3] = c;
  const ax = lerp(x0, x1, u), ay = lerp(y0, y1, u), bx = lerp(x1, x2, u), by = lerp(y1, y2, u), cx = lerp(x2, x3, u), cy = lerp(y2, y3, u);
  const dx = lerp(ax, bx, u), dy = lerp(ay, by, u), ex = lerp(bx, cx, u), ey = lerp(by, cy, u);
  const fx = lerp(dx, ex, u), fy = lerp(dy, ey, u);
  return [[ax, ay, dx, dy, fx, fy], [ex, ey, cx, cy, x3, y3]];
}
const segStart = (sp, i) => (i === 0 ? [sp.x0, sp.y0] : [sp.segs[i - 1][4], sp.segs[i - 1][5]]);
function segLenEst(x0, y0, c) {
  const chord = Math.hypot(c[4] - x0, c[5] - y0);
  const net = Math.hypot(c[0] - x0, c[1] - y0) + Math.hypot(c[2] - c[0], c[3] - c[1]) + Math.hypot(c[4] - c[2], c[5] - c[3]);
  return (chord + net) / 2;
}
function subdivideTo(sp, n) {
  sp = { ...sp, segs: sp.segs.map((s) => s.slice()) };
  if (sp.segs.length === 0) {
    sp.segs.push([sp.x0, sp.y0, sp.x0, sp.y0, sp.x0, sp.y0]);
  }
  while (sp.segs.length < n) {
    let best = 0, bl = -1;
    for (let i = 0; i < sp.segs.length; i++) {
      const [x0, y0] = segStart(sp, i);
      const l = segLenEst(x0, y0, sp.segs[i]);
      if (l > bl) { bl = l; best = i; }
    }
    const [x0, y0] = segStart(sp, best);
    sp.segs.splice(best, 1, ...splitSeg(x0, y0, sp.segs[best]));
  }
  return sp;
}
function signedArea(sp) {
  let a = 0, px = sp.x0, py = sp.y0;
  for (const c of sp.segs) { a += px * c[5] - c[4] * py; px = c[4]; py = c[5]; }
  return a / 2;
}
function reverseSub(sp) {
  const n = sp.segs.length;
  if (!n) return sp;
  const segs = [];
  for (let i = n - 1; i >= 0; i--) {
    const c = sp.segs[i], [sx, sy] = segStart(sp, i);
    segs.push([c[2], c[3], c[0], c[1], sx, sy]);
  }
  return { ...sp, x0: sp.segs[n - 1][4], y0: sp.segs[n - 1][5], segs };
}
function rotateSub(sp, k) {
  if (!k) return sp;
  const segs = sp.segs.slice(k).concat(sp.segs.slice(0, k));
  const [x0, y0] = segStart(sp, k);
  return { ...sp, x0, y0, segs };
}
function centroid(sp) {
  let x = sp.x0, y = sp.y0, n = 1;
  for (const c of sp.segs) { x += c[4]; y += c[5]; n++; }
  return [x / n, y / n];
}
function pairSubpaths(a, b) {
  if (a.closed && b.closed && Math.sign(signedArea(a)) !== Math.sign(signedArea(b))) b = reverseSub(b);
  const n = Math.max(a.segs.length, b.segs.length, 1);
  a = subdivideTo(a, n); b = subdivideTo(b, n);
  if (a.closed && b.closed) {
    let bestK = 0, best = Infinity;
    const an = a.segs.map((_, i) => segStart(a, i));
    const bn = b.segs.map((_, i) => segStart(b, i));
    for (let k = 0; k < n; k++) {
      let cost = 0;
      for (let j = 0; j < n && cost < best; j++) {
        const p = an[j], q = bn[(j + k) % n];
        cost += (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
      }
      if (cost < best) { best = cost; bestK = k; }
    }
    b = rotateSub(b, bestK);
  }
  return [a, b];
}
const morphCache = new Map();
/** Готовит две геометрии к попарной интерполяции (одинаковое число сегментов, выравнивание старта). */
export function prepareMorph(ga, gb, key) {
  if (key && morphCache.has(key)) return morphCache.get(key);
  const n = Math.max(ga.length, gb.length);
  // большие подпути сопоставляем с большими
  const sortBy = (g) => g.map((sp, i) => ({ sp, i, a: Math.abs(signedArea(sp)) }));
  const A = sortBy(ga), B = sortBy(gb);
  const pairs = [];
  for (let i = 0; i < n; i++) {
    let a = A[i]?.sp, b = B[i]?.sp;
    if (!a) { const [cx, cy] = centroid(b); a = { x0: cx, y0: cy, segs: b.segs.map(() => [cx, cy, cx, cy, cx, cy]), closed: b.closed }; }
    if (!b) { const [cx, cy] = centroid(a); b = { x0: cx, y0: cy, segs: a.segs.map(() => [cx, cy, cx, cy, cx, cy]), closed: a.closed }; }
    pairs.push(pairSubpaths(a, b));
  }
  if (key) { if (morphCache.size > 500) morphCache.clear(); morphCache.set(key, pairs); }
  return pairs;
}
export function lerpGeom(pairs, u) {
  return pairs.map(([a, b]) => ({
    x0: lerp(a.x0, b.x0, u), y0: lerp(a.y0, b.y0, u),
    closed: u < 0.5 ? a.closed : b.closed,
    segs: a.segs.map((c, i) => c.map((q, j) => lerp(q, b.segs[i][j], u))),
  }));
}
/** Морфинг между двумя любыми фигурами/путями. */
export function morph(a, b, u) {
  const ga = toGeom(a), gb = toGeom(b);
  const key = typeof a === 'string' || typeof b === 'string' || (a && a.shape !== 'blob' && b && b.shape !== 'blob') ? JSON.stringify([a, b]) : null;
  return lerpGeom(prepareMorph(ga, gb, key), u);
}

function cubicPt(x0, y0, c, t) {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, d = 3 * mt * t * t, e = t * t * t;
  return [a * x0 + b * c[0] + d * c[2] + e * c[4], a * y0 + b * c[1] + d * c[3] + e * c[5]];
}
/** Ломаная аппроксимация для измерения длины и движения вдоль пути. */
export function measureGeom(g, steps = 16) {
  const pts = [];
  let len = 0;
  for (const sp of g) {
    let px = sp.x0, py = sp.y0, first = true;
    for (const c of sp.segs) {
      const [x0, y0] = [px, py];
      for (let s = first ? 0 : 1; s <= steps; s++) {
        const [x, y] = cubicPt(x0, y0, c, s / steps);
        if (pts.length) len += Math.hypot(x - pts[pts.length - 1][0], y - pts[pts.length - 1][1]);
        pts.push([x, y, len]);
      }
      first = false; px = c[4]; py = c[5];
    }
  }
  return { pts, length: len };
}
export function pointAtFraction(m, f) {
  const { pts, length } = m;
  if (!pts.length) return { x: 0, y: 0, angle: 0 };
  const target = clamp(f) * length;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][2] < target) lo = mid; else hi = mid; }
  const a = pts[lo], b = pts[hi];
  const seg = b[2] - a[2] || 1, u = (target - a[2]) / seg;
  return { x: lerp(a[0], b[0], u), y: lerp(a[1], b[1], u), angle: Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG };
}

/**
 * Процедурная деформация шумом. Узлы смещаются полем шума, а управляющие точки
 * преобразуются локальной линеаризацией поля (якобиан) — гладкость кривой сохраняется.
 */
export function deformGeom(g, { amount = 10, scale = 0.01, speed = 0.5, seed = 0, detail = 0 }, t) {
  const z = t * speed;
  const field = (x, y) => [noise3(x * scale, y * scale, z, seed) * amount, noise3(x * scale + 31.7, y * scale - 12.3, z, seed + 7) * amount];
  const h = 0.5;
  const at = (ax, ay) => {
    const o = field(ax, ay), fx = field(ax + h, ay), fy = field(ax, ay + h);
    const J = [(fx[0] - o[0]) / h, (fy[0] - o[0]) / h, (fx[1] - o[1]) / h, (fy[1] - o[1]) / h];
    return { ax, ay, o, J };
  };
  const move = (A, px, py) => {
    const dx = px - A.ax, dy = py - A.ay;
    return [px + A.o[0] + A.J[0] * dx + A.J[1] * dy, py + A.o[1] + A.J[2] * dx + A.J[3] * dy];
  };
  return g.map((sp) => {
    const s = detail ? subdivideTo(sp, Math.max(detail, sp.segs.length)) : sp;
    const A0 = at(s.x0, s.y0);
    let prev = A0;
    const segs = s.segs.map((c, i) => {
      const closesLoop = i === s.segs.length - 1 && s.closed && Math.hypot(c[4] - s.x0, c[5] - s.y0) < 1e-6;
      const A1 = closesLoop ? A0 : at(c[4], c[5]);
      const p1 = move(prev, c[0], c[1]), p2 = move(A1, c[2], c[3]), p3 = move(A1, c[4], c[5]);
      prev = A1;
      return [p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]];
    });
    return { ...s, x0: s.x0 + A0.o[0], y0: s.y0 + A0.o[1], segs };
  });
}

/* =========================================================================
 * 5. Интерполяция значений
 * ========================================================================= */

const GEOM_PROPS = new Set(['d', 'path', 'shape']);
const isGrad = (v) => v && typeof v === 'object' && (v.type === 'linear' || v.type === 'radial') && Array.isArray(v.stops);
const normStops = (st) => st.map((s) => (Array.isArray(s) ? { offset: s[0], color: s[1], opacity: s[2] } : s));

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

/** Значение дорожки ключевых кадров в момент t. keys: [{t, v, ease}] */
export function sampleKeys(keys, t, prop) {
  if (!keys || !keys.length) return undefined;
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
    const live = (v) => (v && typeof v === 'object' && v.shape === 'blob' ? { ...v, time: t } : v);
    return { geom: morph(live(k0.v), live(k1.v), u) };
  }
  return interpolate(k0.v, k1.v, u, prop);
}

/* =========================================================================
 * 6. Модель сцены
 * ========================================================================= */

export const NODE_TYPES = ['group', 'rect', 'ellipse', 'circle', 'polygon', 'star', 'path', 'line', 'blob', 'text', 'image', 'light'];

const DEFAULTS = {
  x: 0, y: 0, rotation: 0, scale: 1, scaleX: 1, scaleY: 1, skewX: 0, anchorX: 0, anchorY: 0, opacity: 1,
  strokeWidth: 2, lineCap: 'round', lineJoin: 'round', trimStart: 0, trimEnd: 1, trimOffset: 0,
  blur: 0, width: 100, height: 100, radius: 0, rx: 50, ry: 50, sides: 6, points: 5, outerRadius: 50,
  innerRadius: 22, cornerRadius: 0, x1: 0, y1: 0, x2: 100, y2: 0, fontSize: 48,
  fontFamily: 'Inter, Segoe UI, Roboto, Helvetica, Arial, sans-serif', fontWeight: 600, textAlign: 'center',
  letterSpacing: 0, textReveal: 1, text: '', pathProgress: 0, visible: true,
};
const TYPE_DEFAULTS = {
  polygon: { radius: 50 },
  blob: { radius: 80, points: 8, amount: 0.25, frequency: 1.2, speed: 0.5, seed: 1, tension: 1 },
  // точечный свет (для превью освещения и PointLight2D в Godot): z — высота над сценой в px
  light: { z: 80, color: '#ffffff', energy: 1, radius: 500 },
};
function defaultFor(type, prop) {
  if (prop === 'fill') return type === 'path' || type === 'line' || type === 'group' ? 'none' : '#ffffff';
  if (prop === 'stroke') return type === 'line' ? '#ffffff' : 'none';
  if (TYPE_DEFAULTS[type] && prop in TYPE_DEFAULTS[type]) return TYPE_DEFAULTS[type][prop];
  return DEFAULTS[prop];
}

/** Значение свойства по умолчанию для типа узла (для редактора и инструментов). */
export const propDefault = (type, prop) => defaultFor(type, prop);

export function createScene(o = {}) {
  return {
    version: 1,
    width: o.width ?? 1920, height: o.height ?? 1080,
    duration: o.duration ?? 6, fps: o.fps ?? 60,
    background: o.background ?? '#0d0f1a', loop: o.loop ?? true,
    nodes: [],
  };
}

/* ---- кэши, зависящие от сцены ---- */
const sceneCaches = new WeakMap();
function cacheFor(scene) {
  let c = sceneCaches.get(scene);
  if (!c) { c = { children: null, byId: null, clipRefs: null, springs: new Map(), measures: new Map(), evalCache: new Map(), stat: new Map() }; sceneCaches.set(scene, c); }
  return c;
}
/** Короткий стабильный хеш строки (FNV-1a) — для id в defs. */
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
/** Сбросить кэши после изменения сцены. */
export function invalidate(scene) { sceneCaches.delete(scene); }
function index(scene) {
  const c = cacheFor(scene);
  if (!c.byId) {
    c.byId = new Map(); c.children = new Map(); c.clipRefs = new Set();
    c.ik = []; c.ikAffected = new Set(); c.stateAffected = new Set();
    for (const n of scene.nodes) {
      c.byId.set(n.id, n);
      const p = n.parent ?? null;
      if (!c.children.has(p)) c.children.set(p, []);
      c.children.get(p).push(n);
      for (const k of ['clip', 'mask']) if (n.props?.[k]) c.clipRefs.add(n.props[k]);
      if (n.keys) for (const k in n.keys) if (n.keys[k].some((a, i, arr) => i && arr[i - 1].t > a.t)) n.keys[k].sort((a, b) => a.t - b.t);
    }
    // IK-цепочки: props.ik на конечном узле; поворачиваются его родитель и дед
    const depth = (id) => { let d = 0, p = c.byId.get(id)?.parent; while (p && d < 999) { d++; p = c.byId.get(p)?.parent; } return d; };
    for (const n of scene.nodes) {
      const ik = n.props?.ik;
      if (!ik || typeof ik !== 'object' || !ik.target || ik.enabled === false) continue;
      const B = c.byId.get(n.parent), A = B && c.byId.get(B.parent);
      if (!A || !c.byId.has(ik.target)) continue;
      c.ik.push({ end: n.id, mid: B.id, root: A.id, cfg: ik, depth: depth(A.id) });
      c.ikAffected.add(A.id); c.ikAffected.add(B.id); if (ik.orient) c.ikAffected.add(n.id);
    }
    c.ik.sort((a, b) => a.depth - b.depth);
    for (const g of scene.states || []) for (const v of Object.values(g.values || {})) for (const id of Object.keys(v || {})) c.stateAffected.add(id);
  }
  return c;
}

/* =========================================================================
 * 7. Процедурные модификаторы
 * ========================================================================= */

/**
 * Каждый модификатор: { type, ...параметры, enabled?, start?, end? }
 * Список и параметры — в MODIFIERS ниже (их же отдаёт MCP-сервер как документацию).
 */
export const MODIFIERS = {
  wiggle: { targets: (m) => m.props || [m.prop || 'x'], doc: 'Плавный шум: v += amp·fbm(t·freq). Параметры: prop|props, amp, freq, seed, octaves, perCopy (сдвиг сида для копий repeat).' },
  oscillate: { targets: (m) => m.props || [m.prop || 'y'], doc: 'Периодические колебания: v += amp·wave(2π·freq·t + phase). wave: sine|triangle|saw|square. Параметры: prop|props, amp, freq, phase (градусы), wave, phaseStep (сдвиг фазы на копию).' },
  orbit: { targets: () => ['x', 'y'], doc: 'Движение по эллипсу. Параметры: cx, cy, radius, radiusY, speed (оборотов/сек), phase (градусы), phaseStep, additive (true — прибавлять к x/y).' },
  spin: { targets: () => ['rotation'], doc: 'Постоянное вращение: rotation += speed·t (градусы/сек).' },
  followPath: { targets: (m) => (m.orient ? ['x', 'y', 'rotation'] : ['x', 'y']), doc: 'Движение вдоль пути. Параметры: path (d, фигура или id узла-пути), progress (число 0..1; по умолчанию берётся свойство pathProgress), speed (циклов/сек, если progress не задан и pathProgress не анимирован), orient, offset (сдвиг доли), loop.' },
  spring: { targets: (m) => m.props || [m.prop || 'x'], doc: 'Физическая пружина: значение «догоняет» целевое (ключи + предыдущие модификаторы) с инерцией. Параметры: prop|props, stiffness, damping, mass.' },
  deform: { targets: () => ['geometry'], doc: 'Органическая деформация контура шумом. Параметры: amount (px), scale (пространственная частота), speed, seed, detail (мин. число сегментов).' },
  link: { targets: (m) => [m.prop], doc: 'Связь со свойством другого узла: v = src·mul + add (или v += …, если additive). Параметры: prop, source (id), sourceProp, mul, add, delay (сек), additive.' },
  noiseColor: { targets: (m) => [m.prop || 'fill'], doc: 'Плавное «плавание» оттенка. Параметры: prop, amount (0..1), speed, seed.' },
  expr: { targets: (m) => m.props || [m.prop], doc: 'Выражение JS: тело функции (t, v, n, i, ctx) → новое значение. i — индекс копии, ctx — {noise1, noise3, fbm, lerp, clamp, ease, scene}. Пример: "return v + Math.sin(t*3 + i)*20".' },
};

const exprCache = new Map();
function compileExpr(code) {
  if (!exprCache.has(code)) exprCache.set(code, new Function('t', 'v', 'n', 'i', 'ctx', code));
  return exprCache.get(code);
}
const wave = (kind, x) => {
  switch (kind) {
    case 'triangle': return (2 / Math.PI) * Math.asin(Math.sin(x));
    case 'saw': { const f = x / TAU; return 2 * (f - Math.floor(f + 0.5)); }
    case 'square': return Math.tanh(Math.sin(x) * 8);
    default: return Math.sin(x);
  }
};
function modActive(m, t) {
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
const addTo = (v, d) => (typeof v === 'number' ? v + d : Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? x + d : x)) : v);

/* =========================================================================
 * 8. Вычисление сцены → дерево отображения
 * ========================================================================= */

/** Настройки рельефа по умолчанию (режим высот для карт нормалей). */
export const RELIEF_DEFAULT = { height: 0.5, depth: 0.3, bevel: 8, profile: 'round', luma: 0.25, background: 0 };
function paintAlpha(v) {
  if (!v || v === 'none') return 0;
  if (typeof v === 'string') { const c = parseColor(v); return c ? c[3] : 1; }
  if (isGrad(v)) return Math.max(...normStops(v.stops).map((st) => (st.opacity ?? 1) * (parseColor(st.color)?.[3] ?? 1)));
  return 1;
}
const grayHex = (v) => { const c = Math.round(clamp(v) * 255).toString(16).padStart(2, '0'); return `#${c}${c}${c}`; };
function heightFilter(ctx, rel, isImage, region = null) {
  const key = `h|${rel.height}|${rel.depth}|${rel.bevel}|${rel.profile}|${rel.invert ? 1 : 0}|${isImage ? rel.luma : 0}|${region ? region.join(',') : ''}`;
  if (ctx.patterns.has(key)) return ctx.reuse(key);
  const id = `${ctx.prefix}-hf${hashStr(key)}`;
  const base = rel.height, d = (rel.invert ? -1 : 1) * rel.depth;
  const prims = [];
  const exp = { round: 0.5, linear: 1, sharp: 2 }[rel.profile];
  if (rel.profile === 'flat' || !(rel.bevel > 0) || !exp) {
    prims.push({ tag: 'feFlood', attrs: { 'flood-color': grayHex(base + d), result: 'h' } });
  } else {
    prims.push({ tag: 'feGaussianBlur', attrs: { in: 'SourceAlpha', stdDeviation: fmt(rel.bevel / 2), result: 'b' } });
    prims.push({ tag: 'feComponentTransfer', attrs: { in: 'b', result: 'p1' }, children: [{ tag: 'feFuncA', attrs: { type: 'linear', slope: 2, intercept: -1 } }] });
    prims.push({ tag: 'feComponentTransfer', attrs: { in: 'p1', result: 'p' }, children: [{ tag: 'feFuncA', attrs: { type: 'gamma', amplitude: 1, exponent: exp, offset: 0 } }] });
    const row = `0 0 0 ${fmt(d)} ${fmt(base)}`;
    prims.push({ tag: 'feColorMatrix', attrs: { in: 'p', type: 'matrix', values: `${row} ${row} ${row} 0 0 0 0 1`, result: 'h' } });
  }
  let last = 'h';
  if (isImage && rel.luma) {
    const k = rel.luma, r = `${fmt(0.2126 * k)} ${fmt(0.7152 * k)} ${fmt(0.0722 * k)} 0 ${fmt(-k / 2)}`;
    prims.push({ tag: 'feColorMatrix', attrs: { in: 'SourceGraphic', type: 'matrix', values: `${r} ${r} ${r} 0 0 0 0 1`, result: 'l' } });
    prims.push({ tag: 'feComposite', attrs: { in: 'h', in2: 'l', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'h2' } });
    last = 'h2';
  }
  prims.push({ tag: 'feComposite', attrs: { in: last, in2: 'SourceAlpha', operator: 'in' } });
  // область фильтра: доли рамки или явный прямоугольник (у кадра спрайт-листа рамка неоднозначна)
  const area = region ? { filterUnits: 'userSpaceOnUse', x: fmt(region[0]), y: fmt(region[1]), width: fmt(region[2]), height: fmt(region[3]) } : { x: '-20%', y: '-20%', width: '140%', height: '140%' };
  const def = { tag: 'filter', attrs: { id, ...area, 'color-interpolation-filters': 'sRGB' }, children: prims };
  return ctx.share(key, def);
}

/* ---------- поверхности и проходы отложенного света ----------
 * surface узла: { normal, tilt: [du, dv, k], plane: [nx, ny, nz, d], u, v, spec, emissive, base, bump, ink, sw, tag, sky }.
 * normal — нормаль для света (может быть наклонена: рельеф), plane — плоскость n·P = d для восстановления позиции.
 * Наследуются детьми: plane, normal, u, v, spec, emissive, tag, sky. Только свои: base, bump, ink, sw, tilt.
 */
export const PASS_MODES = ['normal', 'plane', 'planeD', 'emissive', 'ink', 'cover'];
/** Фон проходов: данные — прозрачный, свечение и маски — чёрный, контур — белый. */
const PASS_BG = { normal: null, plane: null, planeD: null, emissive: '#000000', ink: '#ffffff', cover: '#000000' };
const isPassMode = (m) => PASS_MODES.includes(m) || (typeof m === 'string' && m.startsWith('mask:') && m.length > 5);
const SURF_INHERIT = ['plane', 'normal', 'u', 'v', 'spec', 'emissive', 'tag', 'sky'];
const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
export const vec3 = v3;
const isVec3 = (a) => Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every((x) => typeof x === 'number' && Number.isFinite(x));
/** Оси грани по нормали: u — «вдоль» (горизонталь), v — «вверх по грани». Для пола u = X, v = +Z (вглубь). */
export function surfaceAxes(n) {
  n = v3.norm(n);
  let u = v3.cross(n, [0, 1, 0]);
  if (Math.hypot(...u) < 1e-4) return { u: [1, 0, 0], v: n[1] > 0 ? [0, 0, 1] : [0, 0, -1] };
  u = v3.norm(u);
  return { u, v: v3.norm(v3.cross(u, n)) };
}
/** Действующая поверхность узла: наследуемое от предков + своё. own === false — узел без поверхности. */
export function resolveSurface(parent, own) {
  if (own === false) return null;
  const s = {};
  if (parent) for (const k of SURF_INHERIT) if (parent[k] !== undefined) s[k] = parent[k];
  const has = own && typeof own === 'object';
  if (!has && !parent) return null;
  if (has) for (const k in own) if (k !== 'tilt') s[k] = own[k];
  if (has && own.plane === 'inherit') s.plane = parent?.plane;
  if (s.plane && !isVec3(s.plane)) delete s.plane;
  const pn = s.plane ? v3.norm(s.plane) : null;
  if (s.normal && !isVec3(s.normal)) delete s.normal;
  if (has && Array.isArray(own.tilt)) {
    const n0 = v3.norm(own.normal || parent?.normal || pn || [0, 0, -1]);
    const ax = surfaceAxes(pn || n0);
    const u = isVec3(s.u) ? s.u : ax.u, v = isVec3(s.v) ? s.v : ax.v;
    const [du = 0, dv = 0, k = 0.75] = own.tilt;
    s.normal = v3.norm(v3.add(n0, v3.add(v3.mul(u, du * k), v3.mul(v, dv * k))));
  }
  if (!s.normal && pn) s.normal = pn;
  if (s.normal) s.normal = v3.norm(s.normal);
  s.base = !!(has && own.base);
  s.bump = has ? (own.bump ?? !!(own.normal || own.tilt)) : false;
  s.ink = !!(has && own.ink);
  if (!has || own.sw == null) delete s.sw;
  return s;
}
const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
/** Нормаль → цвет: rgb((n·0.5 + 0.5)·255). */
export const encodeNormal = (n) => '#' + [0, 1, 2].map((i) => hex2((clamp(n[i], -1, 1) * 0.5 + 0.5) * 255)).join('');
/** d плоскости 16 бит (R старший, G младший байт: q = round((d + 200)·100)) и сила блика в B. */
export function encodePlaneD(d, spec = 0.1) {
  const q = clamp(Math.round((d + 200) * 100), 0, 65535);
  return '#' + hex2(q >> 8) + hex2(q & 255) + hex2(clamp(spec) * 255);
}
const isMaskTag = (s, tag) => s && (s.tag === tag || (Array.isArray(s.tag) && s.tag.includes(tag)));
/**
 * Цвет фигуры в проходе (null — не рисовать). op — итоговая непрозрачность.
 * Узел без surface: в проходах данных не пишется (освещается как поверхность за ним), в emissive/mask/ink — перекрывает.
 */
function dataPaint(ctx, s, op) {
  const m = ctx.mode, opaque = op >= 0.999, half = op >= 0.5;
  if (!s) {
    if (m === 'ink') return opaque ? '#ffffff' : null;
    if (m === 'cover') return half ? '#ffffff' : null;
    if (m === 'emissive' || ctx.maskTag) return opaque ? '#000000' : null;
    return null;
  }
  switch (m) {
    case 'normal': return (s.base || s.bump) && half && s.normal ? encodeNormal(s.normal) : null;
    case 'plane': return s.base && s.plane ? encodeNormal(v3.norm(s.plane)) : null;
    case 'planeD': return (s.base || (s.bump && half)) && s.plane ? encodePlaneD(s.plane[3], s.spec ?? 0.1) : null;
    case 'emissive': return s.emissive && s.emissive !== 'none' ? s.emissive : s.base || opaque ? '#000000' : null;
    case 'ink': return s.base ? '#ffffff' : null;
    case 'cover': return s.sky ? null : s.base || half ? '#ffffff' : null;
    default: return isMaskTag(s, ctx.maskTag) ? '#ffffff' : s.base || opaque ? '#000000' : null;
  }
}
/** Фильтр «залить цветом по альфе» — для картинок в проходах. */
function floodFilter(ctx, color, region) {
  const key = `fl|${color}|${region.join(',')}`;
  if (ctx.patterns.has(key)) return ctx.reuse(key);
  const id = `${ctx.prefix}-fl${hashStr(key)}`;
  return ctx.share(key, { tag: 'filter', attrs: { id, filterUnits: 'userSpaceOnUse', x: fmt(region[0]), y: fmt(region[1]), width: fmt(region[2]), height: fmt(region[3]), 'color-interpolation-filters': 'sRGB' },
    children: [{ tag: 'feFlood', attrs: { 'flood-color': color, result: 'c' } }, { tag: 'feComposite', attrs: { in: 'c', in2: 'SourceAlpha', operator: 'in' } }] });
}
/** Габариты геометрии по опорным точкам (для отбрасывания вырожденных фигур). */
function geomBox(geom) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sp of geom) {
    if (sp.x0 < x0) x0 = sp.x0; if (sp.x0 > x1) x1 = sp.x0; if (sp.y0 < y0) y0 = sp.y0; if (sp.y0 > y1) y1 = sp.y0;
    for (const c of sp.segs) for (let i = 0; i < 6; i += 2) { if (c[i] < x0) x0 = c[i]; if (c[i] > x1) x1 = c[i]; if (c[i + 1] < y0) y0 = c[i + 1]; if (c[i + 1] > y1) y1 = c[i + 1]; }
  }
  return Number.isFinite(x0) ? [x1 - x0, y1 - y0] : [0, 0];
}

class Ctx {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.c = index(scene);
    this.defs = [];
    this.prefix = opts.idPrefix || 'k';
    this.depth = 0;
    this.inRepeat = new Set();
    this.patterns = new Map();
    this.mode = opts.mode || 'color';
    if (this.mode !== 'color' && this.mode !== 'height' && !isPassMode(this.mode)) throw new Error(`Неизвестный режим рендера: ${this.mode} (есть color, height, ${PASS_MODES.join(', ')}, mask:<метка>)`);
    // проходы отложенного света: данные о поверхности вместо цвета (см. dataPaint)
    this.data = isPassMode(this.mode);
    this.maskTag = this.mode.startsWith('mask:') ? this.mode.slice(5) : null;
    this.surfCur = null; this.opCur = 1; this.scaleCur = 1;
    this.relief = { ...RELIEF_DEFAULT, ...(scene.relief || {}), ...(opts.relief || {}) };
    this.inClip = 0;
    this.defIds = new Set();
    this.recorders = [];
    this.cache = !!opts.cache;
    // состояния: выбранный вариант каждой группы → подмена свойств узлов
    if (scene.states?.length) {
      this.over = new Map();
      for (const g of scene.states) {
        const vals = g.values || {};
        const v = opts.states?.[g.name] ?? g.default ?? Object.keys(vals)[0];
        const patch = vals[v];
        if (!patch) continue;
        for (const id in patch) this.over.set(id, { ...(this.over.get(id) || {}), ...patch[id] });
      }
    }
    if (opts.only) {
      // рендер подмножества: только эти узлы (с потомками); предки дают трансформации, но не рисуются
      const ids = new Set(Array.isArray(opts.only) ? opts.only : [...opts.only]);
      this.allowed = new Set(); this.ancestors = new Set();
      const kids = this.c.children;
      const addDown = (id) => { this.allowed.add(id); for (const k of kids.get(id) || []) addDown(k.id); };
      for (const id of ids) {
        if (!this.c.byId.has(id)) continue;
        addDown(id);
        let par = this.c.byId.get(id).parent;
        while (par) { this.ancestors.add(par); par = this.c.byId.get(par)?.parent; }
      }
    }
  }
  id(key, kind) { return `${this.prefix}-${kind}-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`; }
  /** Добавить определение в <defs> (без повторов) и отметить его во всех записываемых поддеревьях. */
  addDef(def) {
    const id = def.attrs?.id;
    if (!id || !this.defIds.has(id)) { this.defs.push(def); if (id) this.defIds.add(id); }
    for (const r of this.recorders) r.push(def);
  }
  /** Общий def (паттерн, фильтр) по ключу: создаётся один раз, при повторе регистрируется заново. */
  share(key, def) { this.patterns.set(key, def); this.addDef(def); return `url(#${def.attrs.id})`; }
  reuse(key) { const def = this.patterns.get(key); this.addDef(def); return `url(#${def.attrs.id})`; }
}

/** Значение свойства узла с учётом ключей и модификаторов. */
function propValue(node, name, t, ctx, copy = 0, upTo = Infinity) {
  if (name === 'rotation' && ctx.ikRot && ctx.ikRot.has(node.id) && upTo === Infinity) return ctx.ikRot.get(node.id);
  let v;
  const k = node.keys?.[name];
  const ov = ctx.over && ctx.over.get(node.id);
  if (ov && name in ov) v = ov[name];
  else if (k && k.length) v = sampleKeys(k, t, name);
  else if (node.props && name in node.props) v = node.props[name];
  else v = defaultFor(node.type, name);
  if (name === 'scale' && v == null) v = 1;
  const mods = node.mods;
  if (!mods) return v;
  for (let mi = 0; mi < mods.length && mi < upTo; mi++) {
    const m = mods[mi];
    const def = MODIFIERS[m.type];
    if (!def || !def.targets(m).includes(name)) continue;
    const w = modActive(m, t);
    if (!w) continue;
    v = applyMod(node, m, mi, name, v, t, ctx, copy, w);
  }
  return v;
}

function applyMod(node, m, mi, name, v, t, ctx, copy, w) {
  switch (m.type) {
    case 'wiggle': {
      const props = m.props || [m.prop || 'x'];
      const pi = props.indexOf(name);
      const seed = (m.seed ?? 0) + pi * 101 + copy * (m.perCopy ?? 17);
      const amp = Array.isArray(m.amp) ? m.amp[pi] ?? m.amp[0] : m.amp ?? 10;
      const d = fbm(t * (m.freq ?? 1), seed, m.octaves ?? 2) * amp * w;
      return addTo(v, d);
    }
    case 'oscillate': {
      const props = m.props || [m.prop || 'y'];
      const pi = props.indexOf(name);
      const amp = Array.isArray(m.amp) ? m.amp[pi] ?? m.amp[0] : m.amp ?? 10;
      const ph = ((m.phase ?? 0) + (m.phaseStep ?? 0) * copy + (m.propPhase ?? 0) * pi) * DEG;
      return addTo(v, amp * wave(m.wave, TAU * (m.freq ?? 1) * t + ph) * w);
    }
    case 'orbit': {
      const ph = ((m.phase ?? 0) + (m.phaseStep ?? 0) * copy) * DEG + TAU * (m.speed ?? 0.25) * t;
      const r = m.radius ?? 100, ry = m.radiusY ?? r;
      const val = name === 'x' ? (m.cx ?? 0) + Math.cos(ph) * r : (m.cy ?? 0) + Math.sin(ph) * ry;
      return m.additive ? v + (val - (name === 'x' ? m.cx ?? 0 : m.cy ?? 0)) * w : lerp(v, val, w);
    }
    case 'spin': return v + (m.speed ?? 90) * t * w;
    case 'followPath': {
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
    }
    case 'spring': return springValue(node, m, mi, name, t, ctx, copy, w, v);
    case 'link': {
      const src = ctx.c.byId.get(m.source);
      if (!src || ctx.depth > 16) return v;
      ctx.depth++;
      const sv = propValue(src, m.sourceProp || name, t - (m.delay ?? 0), ctx, copy);
      ctx.depth--;
      if (typeof sv !== 'number') return lerp(0, 1, w) < 0.5 ? v : sv;
      const out = sv * (m.mul ?? 1) + (m.add ?? 0);
      return m.additive ? v + out * w : lerp(v, out, w);
    }
    case 'noiseColor': {
      const c = parseColor(v);
      if (!c) return v;
      const lab = rgbToOklab(c);
      const amt = (m.amount ?? 0.15) * w;
      const ang = noise1(t * (m.speed ?? 0.3), (m.seed ?? 3) + copy * 13) * Math.PI * amt * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      return formatColor([...oklabToRgb([lab[0], lab[1] * ca - lab[2] * sa, lab[1] * sa + lab[2] * ca]), c[3]]);
    }
    case 'expr': {
      const f = compileExpr(m.code);
      const out = f(t, v, node, copy, { noise1, noise3, fbm, lerp, clamp, ease: (n, u) => resolveEase(n)(u), scene: ctx.scene, prop: name });
      return out === undefined ? v : w === 1 ? out : interpolate(v, out, w, name);
    }
    default: return v;
  }
}

/** Пружина: детерминированная симуляция от t=0 с фиксированным шагом, с кэшем. */
function springValue(node, m, mi, name, t, ctx, copy, w, current) {
  const key = `${node.id}|${mi}|${name}|${copy}`;
  const dt = 1 / 240;
  let rec = ctx.c.springs.get(key);
  if (!rec) { rec = { xs: [], vs: [] }; ctx.c.springs.set(key, rec); }
  const target = (tt) => propValue(node, name, tt, ctx, copy, mi);
  const steps = Math.max(0, Math.ceil(t / dt));
  if (!rec.xs.length) { const t0 = target(0); rec.xs.push(typeof t0 === 'number' ? t0 : 0); rec.vs.push(0); }
  const k = m.stiffness ?? 120, c = m.damping ?? 12, mass = m.mass ?? 1;
  while (rec.xs.length <= steps) {
    const i = rec.xs.length - 1;
    const x = rec.xs[i], vel = rec.vs[i];
    const tg = target(i * dt);
    if (typeof tg !== 'number') return current;
    const a = (-k * (x - tg) - c * vel) / mass;
    const nv = vel + a * dt;
    rec.vs.push(nv); rec.xs.push(x + nv * dt);
  }
  const f = t / dt, i0 = Math.floor(f);
  const sv = lerp(rec.xs[i0], rec.xs[Math.min(i0 + 1, rec.xs.length - 1)], f - i0);
  return typeof current === 'number' ? lerp(current, sv, w) : sv;
}

/** Геометрия узла (в его локальных координатах). */
function nodeGeom(node, t, ctx, copy) {
  const P = (n) => propValue(node, n, t, ctx, copy);
  let g;
  const hasD = node.keys?.d?.length || node.props?.d != null || node.keys?.shape?.length || node.props?.shape != null;
  if (hasD) {
    const k = node.keys?.d?.length ? 'd' : node.keys?.shape?.length ? 'shape' : node.props?.d != null ? 'd' : 'shape';
    let v = node.keys?.[k]?.length ? sampleKeys(node.keys[k], t, k) : node.props[k];
    if (v && typeof v === 'object' && v.shape === 'blob') v = { ...v, time: t };
    g = toGeom(v, t);
  } else {
    switch (node.type) {
      case 'rect': g = rectGeom(P('width'), P('height'), P('radius')); break;
      case 'ellipse': case 'circle': {
        const r = node.props?.r != null || node.keys?.r ? P('r') : null;
        g = ellipseGeom(r ?? P('rx'), r ?? P('ry'));
        break;
      }
      case 'polygon': g = roundedPoly(regularPts(Math.round(P('sides')), P('radius') || 50), P('cornerRadius')); break;
      case 'star': g = roundedPoly(regularPts(Math.round(P('points')), P('outerRadius'), P('innerRadius')), P('cornerRadius')); break;
      case 'line': g = polyGeom([[P('x1'), P('y1')], [P('x2'), P('y2')]], false); break;
      case 'blob': g = blobGeom({ radius: P('radius'), points: P('points'), amount: P('amount'), frequency: P('frequency'), speed: P('speed'), seed: P('seed'), tension: P('tension'), stretchX: P('stretchX') ?? 1, stretchY: P('stretchY') ?? 1 }, t); break;
      case 'path': g = node.props?.points ? toGeom({ points: P('points'), smooth: P('smooth'), closed: P('closed') }) : []; break;
      default: g = [];
    }
  }
  if (node.mods) {
    node.mods.forEach((m) => {
      if (m.type !== 'deform') return;
      const w = modActive(m, t);
      if (!w) return;
      g = deformGeom(g, { ...m, amount: (m.amount ?? 10) * w, seed: (m.seed ?? 0) + copy * 7 }, t);
    });
  }
  return g;
}

const fmt = (n) => (typeof n === 'number' ? r3(n) : n);

function paintAttr(v, key, kind, ctx) {
  if (v == null) return 'none';
  if (typeof v === 'string') return v;
  if (isGrad(v)) {
    const id = ctx.id(key, kind);
    const stops = normStops(v.stops).map((s) => ({ tag: 'stop', attrs: { offset: fmt(s.offset), 'stop-color': s.color, 'stop-opacity': fmt(s.opacity ?? 1) } }));
    if (v.type === 'linear') {
      let { x1 = -50, y1 = 0, x2 = 50, y2 = 0 } = v;
      if (v.angle != null) {
        const len = v.length ?? 100, a = v.angle * DEG;
        x1 = -Math.cos(a) * len / 2; y1 = -Math.sin(a) * len / 2; x2 = -x1; y2 = -y1;
      }
      ctx.addDef({ tag: 'linearGradient', attrs: { id, gradientUnits: 'userSpaceOnUse', x1: fmt(x1), y1: fmt(y1), x2: fmt(x2), y2: fmt(y2) }, children: stops });
    } else {
      ctx.addDef({ tag: 'radialGradient', attrs: { id, gradientUnits: 'userSpaceOnUse', cx: fmt(v.cx ?? 0), cy: fmt(v.cy ?? 0), r: fmt(v.r ?? 50), fx: fmt(v.fx ?? v.cx ?? 0), fy: fmt(v.fy ?? v.cy ?? 0) }, children: stops });
    }
    return `url(#${id})`;
  }
  return 'none';
}

function trimDash(s, e, o, L) {
  s = clamp(s); e = clamp(e);
  if (e < s) [s, e] = [e, s];
  const span = e - s;
  if (span >= 0.9999) return null;
  if (span <= 1e-5) return { hide: true };
  let a = s + o, b = e + o;
  a -= Math.floor(a); b = a + span;
  if (b <= 1) return { dash: `0 ${fmt(a * L)} ${fmt(span * L)} ${fmt(L * 2)}`, off: 0 };
  return { dash: `${fmt((b - 1) * L)} ${fmt((a - (b - 1)) * L)} ${fmt((1 - a) * L)} ${fmt(L)}`, off: 0 };
}

/* ---------- растровые слои ---------- */
const FIT = { stretch: 'none', contain: 'xMidYMid meet', cover: 'xMidYMid slice' };
function imageElement(node, Pt, t, ctx, nkey) {
  const src = Pt('src') || '';
  const w = Pt('width'), h = Pt('height');
  const style = Pt('pixelated') ? 'image-rendering:pixelated;image-rendering:crisp-edges' : null;
  const sheet = Pt('sheet');
  if (sheet && sheet.cols) {
    // спрайт-лист: кадр выбирается свойством frame или по fps
    const cols = sheet.cols, rows = sheet.rows || 1, count = sheet.count || cols * rows;
    const fw = sheet.frameWidth, fh = sheet.frameHeight;
    let f = node.keys?.frame || node.props?.frame != null ? Pt('frame') : t * (sheet.fps || 12);
    f = Math.floor(f);
    f = sheet.loop === false ? clamp(f, 0, count - 1) : ((f % count) + count) % count;
    const fx = (f % cols) * fw, fy = Math.floor(f / cols) * fh;
    return {
      tag: 'svg', attrs: { x: fmt(-w / 2), y: fmt(-h / 2), width: fmt(w), height: fmt(h), viewBox: `${fx} ${fy} ${fw} ${fh}`, preserveAspectRatio: 'none', overflow: 'hidden' },
      children: [{ tag: 'image', attrs: { href: src, 'xlink:href': src, x: 0, y: 0, width: cols * fw, height: rows * fh, preserveAspectRatio: 'none', style } }],
    };
  }
  return { tag: 'image', attrs: { href: src, 'xlink:href': src, x: fmt(-w / 2), y: fmt(-h / 2), width: fmt(w), height: fmt(h), preserveAspectRatio: FIT[Pt('fit')] || Pt('fit') || 'none', style } };
}

/* ---------- дизеринг ---------- */
function bayer(n) {
  let m = [[0]];
  while (m.length < n) {
    const k = m.length, out = Array.from({ length: k * 2 }, () => new Array(k * 2));
    for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) {
      const v = 4 * m[y][x];
      out[y][x] = v; out[y][x + k] = v + 2; out[y + k][x] = v + 3; out[y + k][x + k] = v + 1;
    }
    m = out;
  }
  return m;
}
export const DITHER_PATTERNS = {
  bayer2: bayer(2),
  bayer4: bayer(4),
  bayer8: bayer(8),
  checker: [[0, 1], [1, 0]].map((r) => r.map((v) => v * 2)),
  dots: [[12, 5, 6, 13], [4, 0, 1, 7], [11, 3, 2, 8], [15, 10, 9, 14]],
  lines: [0, 2, 1, 3].map((row) => [0, 2, 1, 3].map((c) => row * 4 + c)),
  diagonal: Array.from({ length: 4 }, (_, y) => Array.from({ length: 4 }, (_, x) => ((x + y) % 4) * 4 + x)),
};
const DITHER_DEFAULT = { pattern: 'bayer4', cell: 3, density: 0.5, angle: 90 };

function effectiveDither(node, Pt, ctx) {
  const own = Pt('dither');
  if (own === false) return null;
  const glob = ctx.scene.dither;
  let d = null;
  if (own && typeof own === 'object') { if (own.enabled === false) return null; d = { ...DITHER_DEFAULT, ...(glob || {}), ...own }; }
  else if (own === true) d = { ...DITHER_DEFAULT, ...(glob || {}) };
  else {
    const sh = Pt('shade');
    if (sh && glob && glob.enabled) d = { ...DITHER_DEFAULT, ...glob, ...(typeof sh === 'object' ? sh : {}) };
  }
  if (!d) return null;
  if (!DITHER_PATTERNS[d.pattern]) d.pattern = 'bayer4';
  return d;
}
const solidOf = (fill) => (typeof fill === 'string' ? fill : isGrad(fill) ? normStops(fill.stops)[0].color : 'none');

/** Паттерн из ячеек матрицы с рангом в [lo, hi). */
function ditherPattern(ctx, name, hi, color, cell, alpha, lo = 0) {
  const key = `${name}|${lo}|${hi}|${color}|${cell}|${alpha}`;
  if (ctx.patterns.has(key)) return ctx.reuse(key);
  const M = DITHER_PATTERNS[name], n = M.length, L = n * n;
  const id = `${ctx.prefix}-dp${hashStr(key)}`;
  const rects = [];
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      const inR = (v) => v >= lo && v < hi;
      if (inR(M[y][x])) {
        let x2 = x; while (x2 + 1 < n && inR(M[y][x2 + 1])) x2++;
        rects.push({ tag: 'rect', attrs: { x: x * cell, y: y * cell, width: (x2 - x + 1) * cell, height: cell } });
        x = x2 + 1;
      } else x++;
    }
  }
  return ctx.share(key, { tag: 'pattern', attrs: { id, patternUnits: 'userSpaceOnUse', width: n * cell, height: n * cell },
    children: [{ tag: 'g', attrs: { fill: color, 'fill-opacity': alpha < 1 ? fmt(alpha) : null, 'shape-rendering': 'crispEdges' }, children: rects }] });
}

/** Заливка фигуры упорядоченным растром. density — число или [от, до] (вдоль угла angle). */
function ditherElements(geom, d, dith, fillVal, fillRule, ctx, nkey) {
  const color = dith.color || solidOf(fillVal);
  if (!color || color === 'none') return null;
  const pc = parseColor(color);
  const alpha = pc ? pc[3] : 1;
  const opaque = pc ? formatColor([pc[0], pc[1], pc[2], 1]) : color;
  const M = DITHER_PATTERNS[dith.pattern], L = M.length * M.length;
  const cell = Math.max(0.5, dith.cell);
  const dens = dith.density;
  const levelFill = (k) => (k >= L ? (alpha < 1 ? color : opaque) : ditherPattern(ctx, dith.pattern, k, opaque, cell, alpha));
  if (!Array.isArray(dens)) {
    const k = Math.round(clamp(dens) * L);
    if (k <= 0) return null;
    return { tag: 'path', attrs: { d, fill: levelFill(k), 'fill-rule': fillRule || null } };
  }
  // градиент плотности: полосы по уровням, обрезанные формой
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const sp of geom) {
    const pts = [[sp.x0, sp.y0], ...sp.segs.flatMap((c) => [[c[0], c[1]], [c[2], c[3]], [c[4], c[5]]])];
    for (const [x, y] of pts) { if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  }
  if (!Number.isFinite(xmin)) return null;
  const a = (dith.angle ?? 90) * DEG, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
  const corners = [[xmin, ymin], [xmax, ymin], [xmax, ymax], [xmin, ymax]];
  const ps = corners.map(([x, y]) => x * ux + y * uy), qs = corners.map(([x, y]) => x * vx + y * vy);
  const pmin = Math.min(...ps) - 1, pmax = Math.max(...ps) + 1, qmin = Math.min(...qs) - 1, qmax = Math.max(...qs) + 1;
  const [d0, d1] = [clamp(dens[0]), clamp(dens[dens.length - 1])];
  const pAt = (dv) => (d1 === d0 ? (dv <= d0 ? pmin : pmax) : pmin + ((dv - d0) / (d1 - d0)) * (pmax - pmin));
  // уровни вложены (ранги Байера): каждая полуплоскость добавляет ровно один ранг — без швов
  const bands = [];
  const P = (p, q) => `${fmt(p * ux + q * vx)} ${fmt(p * uy + q * vy)}`;
  for (let k = 1; k <= L; k++) {
    let a0 = pAt((k - 0.5) / L), a1;
    if (d1 >= d0) a1 = pmax; else { a1 = a0; a0 = pmin; }
    a0 = Math.max(a0, pmin); a1 = Math.min(a1, pmax);
    if (a1 - a0 <= 0.01) continue;
    bands.push({ tag: 'path', attrs: { d: `M${P(a0, qmin)}L${P(a1, qmin)}L${P(a1, qmax)}L${P(a0, qmax)}Z`, fill: ditherPattern(ctx, dith.pattern, k, opaque, cell, alpha, k - 1) } });
  }
  if (!bands.length) return null;
  const cid = ctx.id(nkey, 'dc');
  ctx.addDef({ tag: 'clipPath', attrs: { id: cid, clipPathUnits: 'userSpaceOnUse' }, children: [{ tag: 'path', attrs: { d, 'clip-rule': fillRule || null } }] });
  return { tag: 'g', attrs: { 'clip-path': `url(#${cid})` }, children: bands };
}

function evalNode(node, t, ctx, key, copy, extraScale = 1) {
  const p = node.props || {};
  // временное окно и локальное время
  if (p.inPoint != null && t < p.inPoint) return null;
  if (p.outPoint != null && t >= p.outPoint) return null;
  const lt = (t - (p.timeOffset ?? 0)) * (p.timeScale ?? 1);
  const rep = p.repeat;
  if (rep && rep.count > 1 && !ctx.inRepeat.has(node)) {
    const out = { tag: 'g', attrs: { 'data-node': node.id }, children: [] };
    const n = Math.min(500, Math.round(rep.count));
    for (let i = 0; i < n; i++) {
      const ti = t - (rep.delay ?? 0) * (rep.reverse ? n - 1 - i : i);
      const tr = [];
      const cx = rep.cx ?? 0, cy = rep.cy ?? 0;
      if (rep.x || rep.y) tr.push(`translate(${fmt((rep.x ?? 0) * i)} ${fmt((rep.y ?? 0) * i)})`);
      if (rep.rotation) tr.push(`rotate(${fmt(rep.rotation * i)} ${fmt(cx)} ${fmt(cy)})`);
      if (rep.scale != null && rep.scale !== 1 && rep.scaleAround) tr.push(`translate(${fmt(cx)} ${fmt(cy)}) scale(${fmt(rep.scale ** i)}) translate(${fmt(-cx)} ${fmt(-cy)})`);
      const op = rep.opacity != null ? rep.opacity ** i : 1;
      ctx.inRepeat.add(node);
      const child = evalNode(node, ti, ctx, `${key}r${i}`, copy * 1000 + i, rep.scale != null && !rep.scaleAround ? rep.scale ** i : 1);
      ctx.inRepeat.delete(node);
      if (child) out.children.push({ tag: 'g', attrs: { transform: tr.join(' ') || null, opacity: op < 1 ? fmt(op) : null }, children: [child] });
    }
    return out;
  }
  const T = lt;
  const Pt = (n) => propValue(node, n, T, ctx, copy);
  if (Pt('visible') === false) return null;
  let skipOwn = false;
  if (ctx.allowed && !ctx.inClip && !ctx.allowed.has(node.id)) { if (!ctx.ancestors.has(node.id)) return null; skipOwn = true; }
  const H = ctx.mode === 'height' && !ctx.inClip;
  let rel = null;
  if (H) {
    const r = Pt('relief');
    if (r === false) return null;
    const bl = Pt('blend');
    if (bl && bl !== 'normal') return null;      // фактуры/свет в режиме наложения — не рельеф
    if (Pt('opacity') < 0.6) return null;        // полупрозрачные декоративные слои
    if (node.type !== 'group' && node.type !== 'image' && paintAlpha(Pt('fill')) < 0.6 && paintAlpha(Pt('stroke')) < 0.6 && !(r && typeof r === 'object')) {
      // собственная фигура прозрачна (виньетка, засветка) — дети всё равно участвуют
      skipOwn = true;
    }
    rel = { ...(ctx.reliefCur || ctx.relief), ...(r && typeof r === 'object' ? r : {}) };
  }
  // проходы отложенного света: поверхность (наследуется) и накопленная непрозрачность вместо атрибута opacity
  const D = ctx.data && !ctx.inClip;
  let surf = null, opAcc = 1;
  if (D) {
    surf = resolveSurface(ctx.surfCur, Pt('surface'));
    opAcc = ctx.opCur * clamp(Pt('opacity'));
    if (opAcc <= 0.0005) return null;
    const bl = Pt('blend');
    if (bl && bl !== 'normal' && !surf) return null;   // фактуры и засветки в режиме наложения — только в цвете
  }
  const opacity = H || D ? 1 : Pt('opacity');
  if (opacity <= 0.0005 && !p.keepHidden) return null;

  const x = Pt('x'), y = Pt('y'), rot = Pt('rotation'), sc = Pt('scale') * extraScale;
  const sx = sc * Pt('scaleX'), sy = sc * Pt('scaleY'), skx = Pt('skewX'), ax = Pt('anchorX'), ay = Pt('anchorY');
  const scaleHere = ctx.scaleCur * (Math.sqrt(Math.abs(sx * sy)) || 0);
  let tf = '';
  if (x || y) tf += `translate(${fmt(x)} ${fmt(y)})`;
  if (rot) tf += ` rotate(${fmt(rot)})`;
  if (skx) tf += ` skewX(${fmt(skx)})`;
  if (sx !== 1 || sy !== 1) tf += ` scale(${fmt(sx)} ${fmt(sy)})`;
  if (ax || ay) tf += ` translate(${fmt(-ax)} ${fmt(-ay)})`;

  const nkey = `${node.id}${key}`;
  // opacity = 1 не пишется: у resvg элемент с opacity целиком за кадром ломает рендер
  const g = { tag: 'g', attrs: { 'data-node': node.id, transform: tf.trim() || null, opacity: opacity < 1 ? fmt(clamp(opacity)) : null }, children: [] };

  // фильтры
  const blur = Pt('blur'), shadow = Pt('shadow'), glow = Pt('glow');
  if (!H && !D && !skipOwn && (blur > 0.01 || shadow || glow)) {
    const fid = ctx.id(nkey, 'f');
    const prims = [];
    let src = 'SourceGraphic';
    if (blur > 0.01) { prims.push({ tag: 'feGaussianBlur', attrs: { in: 'SourceGraphic', stdDeviation: fmt(blur), result: 'b' } }); src = 'b'; }
    const merge = [];
    if (glow) {
      prims.push({ tag: 'feGaussianBlur', attrs: { in: src, stdDeviation: fmt(glow.blur ?? 12), result: 'gb' } });
      prims.push({ tag: 'feFlood', attrs: { 'flood-color': glow.color ?? '#ffffff', 'flood-opacity': fmt(glow.strength ?? 0.9) } });
      prims.push({ tag: 'feComposite', attrs: { in2: 'gb', operator: 'in', result: 'gc' } });
      merge.push('gc');
    }
    if (shadow) {
      prims.push({ tag: 'feDropShadow', attrs: { in: src, dx: fmt(shadow.x ?? 0), dy: fmt(shadow.y ?? 8), stdDeviation: fmt(shadow.blur ?? 12), 'flood-color': shadow.color ?? '#000', 'flood-opacity': fmt(shadow.opacity ?? 0.5), result: 'sh' } });
      merge.push('sh');
    } else merge.push(src);
    prims.push({ tag: 'feMerge', attrs: {}, children: merge.map((m) => ({ tag: 'feMergeNode', attrs: { in: m } })) });
    ctx.addDef({ tag: 'filter', attrs: { id: fid, x: '-50%', y: '-50%', width: '200%', height: '200%', 'color-interpolation-filters': 'sRGB' }, children: prims });
    g.attrs.filter = `url(#${fid})`;
  }
  const blend = Pt('blend');
  if (!H && !D && !skipOwn && blend && blend !== 'normal') g.attrs.style = `mix-blend-mode:${blend}`;
  const kids = ctx.c.children.get(node.id) || [];

  // собственная фигура
  if (skipOwn) {
    // предок выбранных узлов: только трансформация
  } else if (node.type === 'image') {
    const el = imageElement(node, Pt, T, ctx, nkey);
    const w = Pt('width'), h = Pt('height');
    // фильтр высоты — на обёртке: у кадра спрайт-листа (вложенный <svg>) фильтр иначе видит весь лист
    if (H) g.children.push({ tag: 'g', attrs: { filter: heightFilter(ctx, rel, true, [-w / 2, -h / 2, w, h]) }, children: [el] });
    else if (D) {
      // картинка с поверхностью — «тело» (персонаж, спрайт): заливка цветом прохода по альфе
      const col = dataPaint(ctx, surf ? { ...surf, base: surf.base || !surf.bump } : null, opAcc);
      if (col) g.children.push({ tag: 'g', attrs: { filter: floodFilter(ctx, col, [-w / 2, -h / 2, w, h]) }, children: [el] });
    }
    else g.children.push(el);
  } else if (node.type === 'light') {
    // источник света ничего не рисует: его собирает collectLights
  } else if (node.type !== 'group') {
    const dith = H || D ? null : effectiveDither(node, Pt, ctx);
    const hv = H ? grayHex(rel.height) : null;
    const rawFill = Pt('fill'), rawStroke = Pt('stroke');
    let fill, stroke, sw = Pt('strokeWidth');
    if (D) {
      // проход: цвет данных; у фигуры без заливки (линии) — только контур (ink) и покрытие (cover)
      const hasFill = paintAlpha(rawFill) > 0, hasStroke = paintAlpha(rawStroke) > 0;
      const pa = (v) => Math.min(1, paintAlpha(v));
      const fc = hasFill ? dataPaint(ctx, surf, opAcc * pa(rawFill)) : null;
      fill = fc || 'none';
      if (ctx.mode === 'ink') {
        stroke = surf?.ink ? '#000000' : 'none';
        if (surf?.ink) sw = surf.sw ?? (hasStroke ? sw : 2);
      } else if (hasStroke && (hasFill || surf?.base || ctx.mode === 'cover')) {
        stroke = (hasFill ? fc : dataPaint(ctx, surf, opAcc * pa(rawStroke))) || 'none';
      } else stroke = 'none';
    } else {
      fill = H ? (rawFill && rawFill !== 'none' ? hv : 'none') : dith ? 'none' : paintAttr(rawFill, nkey, 'fg', ctx);
      stroke = H ? (rawStroke && rawStroke !== 'none' ? hv : 'none') : paintAttr(rawStroke, nkey, 'sg', ctx);
    }
    // полупрозрачный лист с одной краской: fill-opacity / stroke-opacity вместо opacity группы
    const single = !H && !D && opacity < 1 && !kids.length && !dith && !g.attrs.filter && !g.attrs.style && (fill === 'none') !== (stroke === 'none');
    if (single) g.attrs.opacity = null;
    if (node.type === 'text') {
      const txt = String(Pt('text') ?? '');
      const reveal = clamp(Pt('textReveal'));
      const shown = txt.slice(0, Math.round(txt.length * reveal));
      const anchor = { left: 'start', center: 'middle', right: 'end' }[Pt('textAlign')] || 'middle';
      g.children.push({
        tag: 'text',
        attrs: {
          x: 0, y: 0, 'text-anchor': anchor, 'dominant-baseline': 'central',
          'font-size': fmt(Pt('fontSize')), 'font-family': Pt('fontFamily'), 'font-weight': Pt('fontWeight'),
          'letter-spacing': fmt(Pt('letterSpacing')), fill, stroke, 'stroke-width': stroke !== 'none' ? fmt(sw) : null,
          'fill-opacity': single && fill !== 'none' ? fmt(clamp(opacity)) : null, 'stroke-opacity': single && stroke !== 'none' ? fmt(clamp(opacity)) : null,
          filter: H ? heightFilter(ctx, rel, false) : null,
        },
        text: shown,
      });
    } else {
      const geom = nodeGeom(node, T, ctx, copy);
      // вырожденные фигуры (< 0.3 px по ширине или высоте) не рисуются: resvg на них падает
      const [bw, bh] = geomBox(geom), kpx = scaleHere;
      const thin = fill !== 'none' && stroke === 'none' ? bw * kpx < 0.3 || bh * kpx < 0.3 : D && bw * kpx < 0.3 && bh * kpx < 0.3;
      if (thin) { fill = 'none'; stroke = 'none'; }
      const d = geomToPath(geom);
      const attrs = { d, fill, stroke, 'fill-rule': p.fillRule || null };
      if (single && fill !== 'none') attrs['fill-opacity'] = fmt(clamp(opacity));
      if (single && stroke !== 'none') attrs['stroke-opacity'] = fmt(clamp(opacity));
      if (stroke !== 'none') {
        attrs['stroke-width'] = fmt(sw);
        attrs['stroke-linecap'] = Pt('lineCap');
        attrs['stroke-linejoin'] = Pt('lineJoin');
        const ts = Pt('trimStart'), te = Pt('trimEnd'), to = Pt('trimOffset');
        const dash = Pt('dash');
        if (ts > 0 || te < 1) {
          const L = measureGeom(geom, 12).length;
          const td = trimDash(ts, te, to, L);
          if (td && td.hide) attrs.stroke = 'none';
          else if (td) { attrs['stroke-dasharray'] = td.dash; attrs['stroke-dashoffset'] = 0; }
        } else if (Array.isArray(dash) && dash.length) {
          attrs['stroke-dasharray'] = dash.map(fmt).join(' ');
          attrs['stroke-dashoffset'] = fmt(Pt('dashOffset') ?? 0);
        }
      }
      if (p.strokeFirst) attrs['paint-order'] = 'stroke';
      if (H && (fill !== 'none' || attrs.stroke !== 'none')) attrs.filter = heightFilter(ctx, rel, false);
      if (thin) { /* ничего */ }
      else if (dith) {
        const filled = ditherElements(geom, d, dith, Pt('fill'), p.fillRule, ctx, nkey);
        if (filled) g.children.push(filled);
        if (attrs.stroke !== 'none') g.children.push({ tag: 'path', attrs });
      } else if (!D || attrs.fill !== 'none' || attrs.stroke !== 'none') g.children.push({ tag: 'path', attrs });
    }
  }

  // дети (рельеф, поверхность и прозрачность в проходах наследуются)
  const prevRel = ctx.reliefCur, prevSurf = ctx.surfCur, prevOp = ctx.opCur, prevScale = ctx.scaleCur;
  if (rel) ctx.reliefCur = rel;
  if (D) { ctx.surfCur = surf; ctx.opCur = opAcc; }
  ctx.scaleCur = scaleHere;
  for (const ch of kids) {
    if (ctx.c.clipRefs.has(ch.id)) continue;
    const e = evalWithClip(ch, T, ctx, key, copy);
    if (e) g.children.push(e);
  }
  ctx.reliefCur = prevRel; ctx.surfCur = prevSurf; ctx.opCur = prevOp; ctx.scaleCur = prevScale;
  if (D && !g.children.length) return null;
  return g;
}

/**
 * Статичное поддерево: ничего не зависит от времени (нет ключей, анимирующих модификаторов, спрайт-листов
 * по fps, IK, состояний). Его вычисленный вид можно переиспользовать между кадрами (opts.cache — плеер).
 */
function staticTree(c, n) {
  const memo = c.stat;
  if (memo.has(n.id)) return memo.get(n.id);
  memo.set(n.id, false); // защита от циклов
  const p = n.props || {};
  let s = !c.ikAffected.has(n.id) && !c.stateAffected.has(n.id) && p.inPoint == null && p.outPoint == null;
  if (s && n.keys) for (const k in n.keys) if (n.keys[k].length > 1) { s = false; break; }
  if (s && n.mods) s = n.mods.every((m) => m.enabled === false || (m.type === 'deform' && m.speed === 0 && m.start == null && m.end == null && m.weight == null));
  const live = (v) => v && typeof v === 'object' && v.shape === 'blob' && (v.speed ?? 0.5) !== 0;
  if (s && (n.type === 'blob' && (p.speed ?? 0.5) !== 0)) s = false;
  if (s && (live(p.d) || live(p.shape))) s = false;
  if (s && n.type === 'image' && p.sheet && p.frame == null && !n.keys?.frame) s = false;
  if (s && n.type === 'light') s = false;
  if (s) for (const k of ['clip', 'mask']) if (p[k] && c.byId.has(p[k]) && !staticTree(c, c.byId.get(p[k]))) s = false;
  if (s) for (const ch of c.children.get(n.id) || []) if (!staticTree(c, ch)) { s = false; break; }
  memo.set(n.id, s);
  return s;
}

function evalWithClip(node, t, ctx, key, copy) {
  if (ctx.cache && !ctx.recording && !ctx.allowed && ctx.mode === 'color' && !ctx.inClip && copy === 0 && staticTree(ctx.c, node)) {
    const ck = `${node.id}|${key}|${ctx.prefix}`;
    const hit = ctx.c.evalCache.get(ck);
    if (hit) { for (const d of hit.defs) ctx.addDef(d); return hit.el; }
    const defs = [];
    ctx.recording = true; ctx.recorders.push(defs);
    let el;
    try { el = evalWithClipRaw(node, t, ctx, key, copy); }
    finally { ctx.recorders.pop(); ctx.recording = false; }
    ctx.c.evalCache.set(ck, { el, defs });
    return el;
  }
  return evalWithClipRaw(node, t, ctx, key, copy);
}

function evalWithClipRaw(node, t, ctx, key, copy) {
  const el = evalNode(node, t, ctx, key, copy);
  if (!el) return null;
  const p = node.props || {};
  let wrap = el;
  for (const kind of ['clip', 'mask']) {
    const ref = p[kind];
    if (!ref) continue;
    const src = ctx.c.byId.get(ref);
    if (!src) continue;
    ctx.inClip++;
    const content = evalNode(src, t, ctx, `${key}${kind}`, copy);
    ctx.inClip--;
    if (!content) { if (kind === 'clip') return null; continue; }
    const id = ctx.id(`${node.id}${key}-${ref}`, kind === 'clip' ? 'c' : 'm');
    if (kind === 'clip') {
      ctx.addDef({ tag: 'clipPath', attrs: { id, clipPathUnits: 'userSpaceOnUse' }, children: flattenShapes(content) });
      wrap = { tag: 'g', attrs: { 'clip-path': `url(#${id})` }, children: [wrap] };
    } else {
      ctx.addDef({ tag: 'mask', attrs: { id, maskUnits: 'userSpaceOnUse', x: -1e5, y: -1e5, width: 2e5, height: 2e5 }, children: [content] });
      wrap = { tag: 'g', attrs: { mask: `url(#${id})` }, children: [wrap] };
    }
  }
  return wrap;
}

/** clipPath не допускает <g>: переносим трансформации прямо на фигуры. */
function flattenShapes(n, tf = '', out = []) {
  const t2 = [tf, n.attrs?.transform].filter(Boolean).join(' ');
  if (n.tag === 'g') { for (const c of n.children || []) flattenShapes(c, t2, out); }
  else if (n.tag === 'path' || n.tag === 'text') out.push({ ...n, attrs: { ...n.attrs, transform: t2 || null } });
  return out;
}

/** Вычислить сцену в момент t. Возвращает дерево отображения {tag, attrs, children}. */
export function evaluate(scene, t, opts = {}) {
  const ctx = new Ctx(scene, opts);
  if (ctx.c.ik.length) solveIK(ctx, t);
  const roots = ctx.c.children.get(null) || [];
  const body = [];
  for (const n of roots) {
    if (ctx.c.clipRefs.has(n.id)) continue;
    const e = evalWithClip(n, t, ctx, '', 0);
    if (e) body.push(e);
  }
  const showBg = opts.background ?? !opts.only;
  const bgFill = ctx.mode === 'height' ? grayHex(ctx.relief.background)
    : ctx.data ? PASS_BG[ctx.mode] ?? (ctx.maskTag ? '#000000' : null)
    : scene.background && scene.background !== 'none' ? paintAttr(scene.background, 'bg', 'bg', ctx) : null;
  const bg = showBg && bgFill ? [{ tag: 'rect', attrs: { x: 0, y: 0, width: scene.width, height: scene.height, fill: bgFill } }] : [];
  // viewBox: [x, y, w, h] — кадрирование (например, для вырезки слоя)
  const vb = opts.viewBox || [0, 0, scene.width, scene.height];
  const ow = opts.width ?? vb[2];
  // пиксельный режим: без сглаживания краёв (растр потом увеличивается без фильтрации)
  // проходы с данными (нормали, плоскости) — без сглаживания: смешанный край дал бы мусорную нормаль
  const crisp = opts.crisp ?? (ctx.mode === 'normal' || ctx.mode === 'plane' || ctx.mode === 'planeD');
  return {
    tag: 'svg',
    attrs: { xmlns: 'http://www.w3.org/2000/svg', 'xmlns:xlink': 'http://www.w3.org/1999/xlink', viewBox: vb.map(fmt).join(' '), width: ow, height: opts.height ?? Math.round((ow * vb[3]) / vb[2]),
      'shape-rendering': crisp ? 'crispEdges' : null, 'image-rendering': crisp ? 'optimizeSpeed' : null, 'text-rendering': crisp ? 'optimizeSpeed' : null },
    children: [{ tag: 'defs', attrs: {}, children: ctx.defs }, ...bg, ...body],
  };
}

/* =========================================================================
 * 8а. Матрицы, мировые координаты, IK, свет
 *     Матрица [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (как в SVG)
 * ========================================================================= */

export const mat = {
  id: () => [1, 0, 0, 1, 0, 0],
  mul: (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]],
  inv: (m) => {
    const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
  },
  apply: (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]],
  /** translate(x,y) rotate(r) skewX(k) scale(sx,sy) translate(-ax,-ay) — как transform узла. */
  compose: ({ x = 0, y = 0, rotation = 0, skewX = 0, scaleX = 1, scaleY = 1, anchorX = 0, anchorY = 0 }) => {
    const r = rotation * DEG, cs = Math.cos(r), sn = Math.sin(r), k = Math.tan(skewX * DEG);
    // R·K = [cs, sn, cs·k − sn, sn·k + cs]
    const a = cs * scaleX, b = sn * scaleX, c = (cs * k - sn) * scaleY, d = (sn * k + cs) * scaleY;
    return [a, b, c, d, x - (a * anchorX + c * anchorY), y - (b * anchorX + d * anchorY)];
  },
};

/** Локальные значения трансформации узла в его локальное время T. */
function localTf(node, T, ctx) {
  const P = (n) => propValue(node, n, T, ctx, 0);
  const sc = P('scale');
  return { x: P('x'), y: P('y'), rotation: P('rotation'), skewX: P('skewX'), scaleX: sc * P('scaleX'), scaleY: sc * P('scaleY'), anchorX: P('anchorX'), anchorY: P('anchorY') };
}
const localTime = (node, T) => (T - (node.props?.timeOffset ?? 0)) * (node.props?.timeScale ?? 1);

/** Мировая матрица узла (включая его собственную трансформацию) и его локальное время. */
function worldOf(ctx, id, t) {
  const chain = [];
  let n = id ? ctx.c.byId.get(id) : null;
  while (n) { chain.unshift(n); n = n.parent ? ctx.c.byId.get(n.parent) : null; }
  let m = mat.id(), T = t;
  for (const x of chain) { T = localTime(x, T); m = mat.mul(m, mat.compose(localTf(x, T, ctx))); }
  return { m, T };
}

/** Мировая матрица узла в момент t (с учётом IK и состояний). */
export function nodeWorldMatrix(scene, id, t = 0, opts = {}) {
  const ctx = new Ctx(scene, opts);
  if (ctx.c.ik.length) solveIK(ctx, t);
  return worldOf(ctx, id, t).m;
}

const wrapDeg = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
/** Двухзвенный IK: поворачивает деда (A) и родителя (B) конечного узла E так, чтобы E оказался в точке цели. */
function solveIK(ctx, t) {
  ctx.ikRot = new Map();
  const by = ctx.c.byId;
  for (const ch of ctx.c.ik) {
    const A = by.get(ch.root), B = by.get(ch.mid), E = by.get(ch.end), tgt = by.get(ch.cfg.target);
    const { m: PA, T: TP } = worldOf(ctx, A.parent, t);
    const TA = localTime(A, TP), TB = localTime(B, TA), TE = localTime(E, TB);
    const a = localTf(A, TA, ctx), b = localTf(B, TB, ctx), e = localTf(E, TE, ctx);
    const wIK = clamp(propValue(E, 'ikWeight', TE, ctx) ?? 1);
    // цель — точка опоры (anchor) целевого узла
    const tw = worldOf(ctx, tgt.id, t);
    const ta = localTf(tgt, tw.T, ctx);
    const [gx, gy] = mat.apply(mat.inv(PA), ...mat.apply(tw.m, ta.anchorX, ta.anchorY));
    // звенья в повёрнутой системе A (до поворота): u0 — к суставу B, w — от B к E
    const u0 = [a.scaleX * (b.x - a.anchorX), a.scaleY * (b.y - a.anchorY)];
    const w2 = [b.scaleX * (e.x - b.anchorX), b.scaleY * (e.y - b.anchorY)];
    const s = Math.sqrt(Math.abs(a.scaleX * a.scaleY)) || 1, refl = a.scaleX * a.scaleY < 0, sg = refl ? -1 : 1;
    const wF = [Math.sign(a.scaleX || 1) * w2[0], Math.sign(a.scaleY || 1) * w2[1]];
    const L1 = Math.hypot(...u0), L2 = s * Math.hypot(...wF);
    if (L1 < 1e-6 || L2 < 1e-6) continue;
    const dx = gx - a.x, dy = gy - a.y;
    const D = clamp(Math.hypot(dx, dy), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
    const phi = Math.acos(clamp((D * D - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1));
    const angU = Math.atan2(u0[1], u0[0]), angW = Math.atan2(wF[1], wF[0]);
    // сторона сгиба: явно (bend: 1|-1) или как в текущей (FK) позе
    let side = ch.cfg.bend;
    if (side !== 1 && side !== -1) {
      const rel = wrapDeg(sg * b.rotation + (angW - angU) / DEG);
      side = rel < 0 ? -1 : 1;
    }
    if (ch.cfg.flip) side = -side;
    const thB = sg * (angU + side * phi - angW);
    const sec = [s * Math.cos(sg * thB + angW) * Math.hypot(...wF), s * Math.sin(sg * thB + angW) * Math.hypot(...wF)];
    const thA = Math.atan2(dy, dx) - Math.atan2(u0[1] + sec[1], u0[0] + sec[0]);
    const blend = (fk, ik) => fk + wrapDeg(ik - fk) * wIK;
    ctx.ikRot.set(A.id, blend(a.rotation, thA / DEG));
    ctx.ikRot.set(B.id, blend(b.rotation, thB / DEG));
    if (ch.cfg.orient) {
      // конечное звено повторяет поворот цели (например, стопа стоит ровно на полу)
      const MB = worldOf(ctx, B.id, t).m;
      const angB = Math.atan2(MB[1], MB[0]), angT = Math.atan2(tw.m[1], tw.m[0]);
      const r = (MB[0] * MB[3] - MB[1] * MB[2] < 0 ? angB - angT : angT - angB) / DEG + (ch.cfg.orientOffset ?? 0);
      ctx.ikRot.set(E.id, blend(e.rotation, r));
    }
  }
}

/** Источники света в момент t: мировая позиция, высота, цвет, энергия, радиус. */
export function collectLights(scene, t = 0, opts = {}) {
  const ctx = new Ctx(scene, opts);
  if (ctx.c.ik.length) solveIK(ctx, t);
  const out = [];
  for (const n of scene.nodes) {
    if (n.type !== 'light') continue;
    const { m, T } = worldOf(ctx, n.id, t);
    const P = (k) => propValue(n, k, T, ctx);
    if (P('visible') === false || P('enabled') === false) continue;
    let hidden = false;
    for (let p = n.parent; p && !hidden; p = ctx.c.byId.get(p)?.parent) { const pn = ctx.c.byId.get(p); if (pn && propValue(pn, 'visible', t, ctx) === false) hidden = true; }
    if (hidden) continue;
    let [x, y] = mat.apply(m, P('anchorX'), P('anchorY'));
    const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const l = { id: n.id, x, y, z: P('z'), color: P('color'), energy: P('energy') * clamp(P('opacity')), radius: P('radius') * k, falloff: P('falloff') ?? 1 };
    const p3 = P('p3'), c3 = scene.camera3d;
    if (Array.isArray(p3) && p3.length >= 3) {
      // 3D-источник: radius — в единицах мира; для 2D-превью и экспорта — проекция камерой
      l.p3 = p3.slice(0, 3); l.radius3 = P('radius'); l.group = P('group') || 'lamp';
      const sh = P('shadows'); if (sh != null) l.shadows = !!sh;
      if (c3) {
        const f = c3.f ?? 1500, dz = c3.dz ?? 0, zz = Math.max(0.05, p3[2] + dz);
        l.x = (c3.cx ?? scene.width / 2) + (f * p3[0]) / zz; l.y = (c3.hor ?? 280) + (f * ((c3.camH ?? 4.2) - p3[1])) / zz;
        l.radius = l.radius3 * (f / zz); l.z = Math.max(20, l.radius * 0.25);
      }
    }
    out.push(l);
  }
  return out;
}

/* =========================================================================
 * 8б. Пиксельный режим: палитра
 * ========================================================================= */

/** Привести RGBA-пиксели к ближайшим цветам палитры (на месте). palette — массив цветов CSS. */
export function quantizeRGBA(data, palette) {
  const pal = (palette || []).map(parseColor).filter(Boolean).map((c) => [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)]);
  if (!pal.length) return data;
  const memo = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let best = memo.get(key);
    if (best === undefined) {
      let bd = Infinity;
      for (let j = 0; j < pal.length; j++) {
        // взвешенное расстояние (ближе к восприятию, чем простое RGB)
        const dr = data[i] - pal[j][0], dg = data[i + 1] - pal[j][1], db = data[i + 2] - pal[j][2];
        const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
        if (d < bd) { bd = d; best = j; }
      }
      memo.set(key, best);
    }
    data[i] = pal[best][0]; data[i + 1] = pal[best][1]; data[i + 2] = pal[best][2];
    data[i + 3] = data[i + 3] < 128 ? 0 : 255;
  }
  return data;
}
/** Настройки пиксельного режима сцены или null. */
export function pixelOf(scene) {
  const p = scene.pixel;
  if (!p || p.enabled === false || !(p.size >= 1)) return null;
  return { size: p.size, palette: p.palette || null, aa: !!p.aa };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function treeToString(n) {
  let a = '';
  for (const k in n.attrs) { const v = n.attrs[k]; if (v != null && v !== '') a += ` ${k}="${esc(v)}"`; }
  if (n.text != null) return `<${n.tag}${a}>${esc(n.text)}</${n.tag}>`;
  if (!n.children || !n.children.length) return `<${n.tag}${a}/>`;
  return `<${n.tag}${a}>${n.children.map(treeToString).join('')}</${n.tag}>`;
}
/** SVG-строка кадра. */
export function renderSVG(scene, t, opts = {}) { return treeToString(evaluate(scene, t, opts)); }

/* =========================================================================
 * 9. Браузерный рендерер и плеер
 * ========================================================================= */

function signature(n) {
  let s = n.tag + '(' + Object.keys(n.attrs).filter((k) => n.attrs[k] != null && n.attrs[k] !== '').join(',');
  if (n.children) for (const c of n.children) s += signature(c);
  return s + ')';
}
function flatten(n, out = []) { out.push(n); if (n.children) for (const c of n.children) flatten(c, out); return out; }

export class DOMRenderer {
  constructor(container) { this.el = container; this.sig = null; this.nodes = null; }
  render(tree) {
    const sig = signature(tree);
    if (sig !== this.sig) {
      this.el.innerHTML = treeToString(tree);
      this.svg = this.el.firstElementChild;
      this.svg.style.width = '100%'; this.svg.style.height = '100%'; this.svg.style.display = 'block';
      this.svg.removeAttribute('width'); this.svg.removeAttribute('height');
      this.nodes = [this.svg, ...this.svg.querySelectorAll('*')];
      this.prev = flatten(tree);
      this.sig = sig;
      return;
    }
    const flat = flatten(tree);
    for (let i = 1; i < flat.length; i++) {
      const n = flat[i], o = this.prev[i], el = this.nodes[i];
      for (const k in n.attrs) {
        const v = n.attrs[k];
        if (v == null || v === '') continue;
        if (o.attrs[k] !== v) el.setAttribute(k, v);
      }
      if (n.text != null && n.text !== o.text) el.textContent = n.text;
    }
    this.prev = flat;
  }
}

export class Player {
  constructor(container, scene, opts = {}) {
    this.renderer = opts.renderer || new DOMRenderer(container);
    this.states = opts.states || {};
    this.scene = scene; this.time = 0; this.playing = false; this.speed = 1; this.listeners = new Set();
    this.loop = opts.loop ?? scene.loop ?? true;
    this._tick = this._tick.bind(this);
    this.draw();
    if (opts.autoplay !== false) this.play();
  }
  setScene(scene, keepTime = true) { invalidate(this.scene); this.scene = scene; invalidate(scene); if (this.clip) this.clip = clipRange(scene, this.clip.name); if (!keepTime) this.time = this.clip ? this.clip.start : 0; this.time = Math.min(this.time, scene.duration); this.draw(); }
  refresh() { invalidate(this.scene); this.draw(); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  /** Выбрать вариант группы состояний (null — вернуть по умолчанию). */
  setState(name, value) { if (value == null) delete this.states[name]; else this.states[name] = value; this.refresh(); }
  draw() {
    try { this.renderer.render(evaluate(this.scene, this.time, { cache: true, states: this.states }), this); this.error = null; }
    catch (e) { this.error = e; console.error(e); }
    for (const f of this.listeners) f(this.time, this);
  }
  /** Ограничить воспроизведение именованным клипом (null — вся шкала). */
  setClip(name) {
    this.clip = name ? clipRange(this.scene, name) : null;
    if (this.clip) this.time = this.clip.start;
    this.draw();
  }
  range() { return this.clip || { start: 0, end: this.scene.duration, loop: this.loop }; }
  seek(t) { this.time = clamp(t, 0, this.scene.duration); this.draw(); }
  play() {
    if (this.playing) return;
    const r = this.range();
    if (this.time >= r.end - 1e-6 || this.time < r.start) this.time = r.start; this.playing = true; this.last = performance.now(); requestAnimationFrame(this._tick); this.draw(); }
  pause() { this.playing = false; this.draw(); }
  toggle() { this.playing ? this.pause() : this.play(); }
  _tick(now) {
    if (!this.playing) return;
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    this.time += dt * this.speed;
    const r = this.range();
    if (this.time >= r.end) {
      const len = r.end - r.start || 1;
      if (this.clip ? r.loop !== false : this.loop) this.time = r.start + ((this.time - r.start) % len);
      else if (this.clip && this.clip.next) { this.clip = clipRange(this.scene, this.clip.next); this.time = this.clip.start; }
      else { this.time = r.end; this.playing = false; }
    }
    this.draw();
    if (this.playing) requestAnimationFrame(this._tick);
  }
}

/* =========================================================================
 * 10. Операции над сценой (используются MCP-сервером и редактором)
 * ========================================================================= */

let autoId = 0;
function uniqueId(scene, base) {
  const ids = new Set(scene.nodes.map((n) => n.id));
  let id = base; let i = 1;
  while (ids.has(id)) id = `${base}${++i}`;
  return id;
}
const getNode = (scene, id) => {
  const n = scene.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`Узел «${id}» не найден. Есть: ${scene.nodes.map((x) => x.id).join(', ') || '(пусто)'}`);
  return n;
};

export const ops = {
  addNode(scene, { id, type = 'group', parent = null, props = {}, keys, mods, index: at } = {}) {
    if (!NODE_TYPES.includes(type)) throw new Error(`Неизвестный тип «${type}». Допустимо: ${NODE_TYPES.join(', ')}`);
    if (parent) getNode(scene, parent);
    id = id ? (scene.nodes.some((n) => n.id === id) ? (() => { throw new Error(`id «${id}» уже занят`); })() : id) : uniqueId(scene, `${type}${++autoId}`);
    const node = { id, type, parent: parent || null, props: { ...props } };
    if (keys) node.keys = normalizeKeys(keys);
    if (mods) node.mods = mods.map(validateMod);
    if (at == null) scene.nodes.push(node); else scene.nodes.splice(at, 0, node);
    invalidate(scene);
    return node;
  },
  updateNode(scene, id, { props, replaceProps = false, unset = [], newId, parent, type } = {}) {
    const n = getNode(scene, id);
    if (props) n.props = replaceProps ? { ...props } : { ...n.props, ...props };
    for (const k of unset) delete n.props[k];
    if (type) { if (!NODE_TYPES.includes(type)) throw new Error(`Неизвестный тип ${type}`); n.type = type; }
    if (parent !== undefined) {
      if (parent) { getNode(scene, parent); let p = parent; while (p) { if (p === id) throw new Error('Цикл в иерархии'); p = scene.nodes.find((x) => x.id === p)?.parent; } }
      n.parent = parent || null;
    }
    if (newId && newId !== id) {
      if (scene.nodes.some((x) => x.id === newId)) throw new Error(`id «${newId}» уже занят`);
      for (const x of scene.nodes) {
        if (x.parent === id) x.parent = newId;
        for (const k of ['clip', 'mask']) if (x.props?.[k] === id) x.props[k] = newId;
        for (const m of x.mods || []) { if (m.source === id) m.source = newId; if (m.path === id) m.path = newId; }
        if (x.props?.ik?.target === id) x.props.ik = { ...x.props.ik, target: newId };
      }
      for (const g of scene.states || []) for (const patch of Object.values(g.values || {})) if (patch[id]) { patch[newId] = patch[id]; delete patch[id]; }
      n.id = newId;
    }
    invalidate(scene);
    return n;
  },
  removeNode(scene, id) {
    getNode(scene, id);
    const kill = new Set([id]);
    let grew = true;
    while (grew) { grew = false; for (const n of scene.nodes) if (n.parent && kill.has(n.parent) && !kill.has(n.id)) { kill.add(n.id); grew = true; } }
    scene.nodes = scene.nodes.filter((n) => !kill.has(n.id));
    invalidate(scene);
    return [...kill];
  },
  duplicateNode(scene, id, newId) {
    const src = getNode(scene, id);
    const map = new Map();
    const copyTree = (n, parent) => {
      const nid = n === src && newId ? newId : uniqueId(scene, n.id + '_copy');
      map.set(n.id, nid);
      const c = JSON.parse(JSON.stringify(n)); c.id = nid; c.parent = parent;
      scene.nodes.push(c);
      for (const ch of scene.nodes.filter((x) => x.parent === n.id && !map.has(x.id))) copyTree(ch, nid);
      return c;
    };
    const res = copyTree(src, src.parent);
    invalidate(scene);
    return res;
  },
  reorder(scene, id, toIndex) {
    const n = getNode(scene, id);
    scene.nodes = scene.nodes.filter((x) => x !== n);
    scene.nodes.splice(clamp(toIndex, 0, scene.nodes.length), 0, n);
    invalidate(scene);
  },
  setKeys(scene, id, prop, keys) {
    const n = getNode(scene, id);
    n.keys = n.keys || {};
    if (!keys || !keys.length) delete n.keys[prop];
    else n.keys[prop] = normalizeKeys({ [prop]: keys })[prop];
    invalidate(scene);
    return n.keys[prop];
  },
  addKey(scene, id, prop, key) {
    const n = getNode(scene, id);
    n.keys = n.keys || {};
    const arr = (n.keys[prop] = n.keys[prop] || []);
    const k = normalizeKeys({ [prop]: [key] })[prop][0];
    const i = arr.findIndex((x) => Math.abs(x.t - k.t) < 1e-6);
    if (i >= 0) arr[i] = k; else arr.push(k);
    arr.sort((a, b) => a.t - b.t);
    invalidate(scene);
    return arr;
  },
  clearKeys(scene, id, prop) {
    const n = getNode(scene, id);
    if (!prop) delete n.keys; else if (n.keys) delete n.keys[prop];
    invalidate(scene);
  },
  /** Анимировать свойство от from (по умолчанию — текущее значение) к to. */
  animate(scene, id, prop, { from, to, start = 0, duration = 1, ease = 'inOutCubic', keepExisting = true } = {}) {
    const n = getNode(scene, id);
    if (from === undefined) from = propValue(n, prop, start, new Ctx(scene), 0);
    if (from && typeof from === 'object' && from.geom) from = geomToPath(from.geom);
    const arr = keepExisting && n.keys?.[prop] ? n.keys[prop].filter((k) => k.t < start - 1e-6 || k.t > start + duration + 1e-6) : [];
    arr.push({ t: start, v: from, ease }, { t: start + duration, v: to });
    return ops.setKeys(scene, id, prop, arr);
  },
  addMod(scene, id, mod) {
    const n = getNode(scene, id);
    n.mods = n.mods || [];
    n.mods.push(validateMod(mod));
    invalidate(scene);
    return n.mods.length - 1;
  },
  removeMod(scene, id, which) {
    const n = getNode(scene, id);
    if (!n.mods) return 0;
    const before = n.mods.length;
    if (typeof which === 'number') n.mods.splice(which, 1);
    else if (typeof which === 'string') n.mods = n.mods.filter((m) => m.type !== which);
    else n.mods = [];
    if (!n.mods.length) delete n.mods;
    invalidate(scene);
    return before - (n.mods?.length || 0);
  },
};

function validateMod(m) {
  if (!m || !MODIFIERS[m.type]) throw new Error(`Неизвестный модификатор «${m?.type}». Допустимо: ${Object.keys(MODIFIERS).join(', ')}`);
  if (m.type === 'expr') compileExpr(m.code);
  return { ...m };
}
function normalizeKeys(keys) {
  const out = {};
  for (const prop in keys) {
    const arr = keys[prop];
    if (!Array.isArray(arr)) throw new Error(`Ключи свойства ${prop} должны быть массивом`);
    out[prop] = arr.map((k) => {
      const kk = Array.isArray(k) ? { t: k[0], v: k[1], ease: k[2] } : { ...k };
      if (kk.time != null && kk.t == null) kk.t = kk.time, delete kk.time;
      if (kk.value !== undefined && kk.v === undefined) kk.v = kk.value, delete kk.value;
      if (typeof kk.t !== 'number') throw new Error(`Ключ свойства ${prop}: нет времени t`);
      if (kk.ease != null) resolveEase(kk.ease);
      else delete kk.ease;
      return kk;
    }).sort((a, b) => a.t - b.t);
  }
  return out;
}

/* ---------- именованные клипы ---------- */
/**
 * Клипы — именованные отрезки общей шкалы времени: idle, walk, talk...
 * scene.clips = [{ name, start, end, loop = true, fps?, next? }]
 */
export function clipRange(scene, name) {
  const c = (scene.clips || []).find((x) => x.name === name);
  if (!c) throw new Error(`Клип «${name}» не найден. Есть: ${(scene.clips || []).map((x) => x.name).join(', ') || '(нет клипов)'}`);
  return { name: c.name, start: c.start, end: c.end, loop: c.loop !== false, fps: c.fps, next: c.next };
}
/** Время внутри клипа: localT от начала клипа, с учётом зацикливания. */
export function clipTime(scene, name, localT) {
  const r = clipRange(scene, name), len = r.end - r.start;
  if (len <= 0) return r.start;
  return r.start + (r.loop ? ((localT % len) + len) % len : clamp(localT, 0, len));
}
Object.assign(ops, {
  setClip(scene, { name, start, end, loop = true, fps, next }) {
    if (!name || typeof name !== 'string') throw new Error('Нужно имя клипа');
    if (!(end > start)) throw new Error('Конец клипа должен быть позже начала');
    if (start < 0) throw new Error('Начало клипа не может быть отрицательным');
    scene.clips = scene.clips || [];
    const c = { name, start, end, loop };
    if (fps) c.fps = fps;
    if (next) c.next = next;
    const i = scene.clips.findIndex((x) => x.name === name);
    if (i >= 0) scene.clips[i] = c; else scene.clips.push(c);
    scene.clips.sort((a, b) => a.start - b.start);
    if (end > scene.duration) scene.duration = end;
    invalidate(scene);
    return c;
  },
  removeClip(scene, name) {
    const before = scene.clips?.length || 0;
    scene.clips = (scene.clips || []).filter((c) => c.name !== name);
    if (!scene.clips.length) delete scene.clips;
    return before - (scene.clips?.length || 0);
  },
});

/* ---------- состояния, IK, пиксели, свет ---------- */
Object.assign(ops, {
  /** Группа состояний: { name, default, values: { вариант: { id узла: { свойство: значение } } } }. */
  setState(scene, { name, values, default: def }) {
    if (!name || typeof name !== 'string') throw new Error('Нужно имя группы состояний');
    if (!values || typeof values !== 'object' || !Object.keys(values).length) throw new Error('values: нужен хотя бы один вариант');
    for (const patch of Object.values(values)) for (const id of Object.keys(patch || {})) getNode(scene, id);
    scene.states = scene.states || [];
    const g = { name, default: def ?? Object.keys(values)[0], values: JSON.parse(JSON.stringify(values)) };
    if (!(g.default in g.values)) throw new Error(`default «${g.default}» нет среди вариантов: ${Object.keys(values).join(', ')}`);
    const i = scene.states.findIndex((x) => x.name === name);
    if (i >= 0) scene.states[i] = g; else scene.states.push(g);
    invalidate(scene);
    return g;
  },
  removeState(scene, name) {
    const before = scene.states?.length || 0;
    scene.states = (scene.states || []).filter((g) => g.name !== name);
    if (!scene.states.length) delete scene.states;
    invalidate(scene);
    return before - (scene.states?.length || 0);
  },
  /** IK на конечном узле id: цель target, сгиб bend (1|-1), orient — конечное звено повторяет поворот цели. null — снять. */
  setIK(scene, id, cfg) {
    const n = getNode(scene, id);
    if (!cfg) { if (n.props) delete n.props.ik; invalidate(scene); return null; }
    getNode(scene, cfg.target);
    const B = n.parent && getNode(scene, n.parent), A = B && B.parent && getNode(scene, B.parent);
    if (!A) throw new Error(`У «${id}» нужны родитель и дед — два звена цепочки (например бедро → голень → стопа)`);
    if (cfg.target === id || cfg.target === B.id || cfg.target === A.id) throw new Error('Цель IK не может быть звеном самой цепочки');
    n.props = { ...n.props, ik: { target: cfg.target, ...(cfg.bend ? { bend: cfg.bend } : {}), ...(cfg.flip ? { flip: true } : {}), ...(cfg.orient ? { orient: true } : {}), ...(cfg.orientOffset ? { orientOffset: cfg.orientOffset } : {}) } };
    invalidate(scene);
    return n.props.ik;
  },
  setPixel(scene, cfg) {
    if (!cfg || cfg.enabled === false) { if (scene.pixel) scene.pixel.enabled = false; if (!cfg) delete scene.pixel; invalidate(scene); return scene.pixel || null; }
    const size = cfg.size ?? scene.pixel?.size ?? 6;
    if (!(size >= 1)) throw new Error('size — размер пикселя в единицах сцены, ≥ 1');
    scene.pixel = { enabled: true, size, ...(cfg.palette ? { palette: cfg.palette } : scene.pixel?.palette ? { palette: scene.pixel.palette } : {}), ...(cfg.aa ? { aa: true } : {}) };
    invalidate(scene);
    return scene.pixel;
  },
});

/* =========================================================================
 * 10а. Правки поверх сцены (edits)
 *      Сцену рисует скрипт, человек правит её в редакторе — правки хранятся отдельно (<имя>.edits.json)
 *      и накладываются на свежую сцену после каждой пересборки.
 * ========================================================================= */

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}
const same = (a, b) => a === b || stable(a) === stable(b);
function kidsMap(scene) {
  const m = new Map();
  for (const n of scene.nodes) { const p = n.parent ?? null; if (!m.has(p)) m.set(p, []); m.get(p).push(n.id); }
  return m;
}
/** Наибольшая общая подпоследовательность (id), чтобы записывать только реальные перестановки. */
function lcsSet(a, b) {
  const n = a.length, m = b.length;
  if (!n || !m) return new Set();
  if (n * m > 4e6) return new Set(a.filter((x, i) => b[i] === x));
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = new Set();
  for (let i = 0, j = 0; i < n && j < m;) { if (a[i] === b[j]) { out.add(a[i]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
  return out;
}

/** Разница между исходной сценой и правленой → объект правок. */
export function diffScenes(base, cur) {
  const ed = { kontur: 'edits', version: 1, scene: {}, nodes: {}, removed: [], order: [] };
  for (const k of new Set([...Object.keys(base), ...Object.keys(cur)])) {
    if (k === 'nodes') continue;
    if (!same(base[k], cur[k])) ed.scene[k] = cur[k] === undefined ? null : clone(cur[k]);
  }
  const bMap = new Map(base.nodes.map((n) => [n.id, n])), cMap = new Map(cur.nodes.map((n) => [n.id, n]));
  for (const n of base.nodes) if (!cMap.has(n.id)) ed.removed.push(n.id);
  for (const n of cur.nodes) {
    const b = bMap.get(n.id);
    if (!b) continue;
    const e = {}, bp = b.props || {}, cp = n.props || {}, props = {}, unset = [], was = {};
    for (const k in cp) if (!same(bp[k], cp[k])) { props[k] = clone(cp[k]); if (k in bp) was[k] = clone(bp[k]); }
    for (const k in bp) if (!(k in cp)) { unset.push(k); was[k] = clone(bp[k]); }
    if (Object.keys(props).length) e.props = props;
    if (unset.length) e.unset = unset;
    const bk = b.keys || {}, ck = n.keys || {}, keys = {};
    for (const k of new Set([...Object.keys(bk), ...Object.keys(ck)])) if (!same(bk[k], ck[k])) keys[k] = ck[k] ? clone(ck[k]) : null;
    if (Object.keys(keys).length) e.keys = keys;
    if (!same(b.mods, n.mods)) e.mods = n.mods ? clone(n.mods) : null;
    if (n.type !== b.type) e.setType = n.type;
    if (Object.keys(e).length) { e.base = { type: b.type, parent: b.parent ?? null }; if (Object.keys(was).length) e.was = was; ed.nodes[n.id] = e; }
  }
  // порядок и новые узлы: по каждому родителю — что не входит в общую подпоследовательность
  const bk = kidsMap(base), ck = kidsMap(cur), stay = new Set();
  for (const [p, cids] of ck) {
    const common = cids.filter((id) => bMap.has(id) && (bMap.get(id).parent ?? null) === p);
    const bcommon = (bk.get(p) || []).filter((id) => cMap.has(id) && (cMap.get(id).parent ?? null) === p);
    for (const id of lcsSet(bcommon, common)) stay.add(id);
  }
  for (const n of cur.nodes) {
    if (stay.has(n.id)) continue;
    const p = n.parent ?? null, sib = ck.get(p), i = sib.indexOf(n.id);
    const o = { id: n.id, parent: p, after: i > 0 ? sib[i - 1] : null };
    if (!bMap.has(n.id)) o.add = clone(n);
    ed.order.push(o);
  }
  return ed;
}
/** Пустые ли правки. */
export function editsEmpty(ed) {
  return !ed || (!Object.keys(ed.scene || {}).length && !Object.keys(ed.nodes || {}).length && !(ed.removed || []).length && !(ed.order || []).length);
}
/** Число правленых объектов (для интерфейса). */
export function editsCount(ed) {
  if (!ed) return 0;
  return new Set([...Object.keys(ed.nodes || {}), ...(ed.removed || []), ...(ed.order || []).map((o) => o.id)]).size + (Object.keys(ed.scene || {}).length ? 1 : 0);
}

/** Наложить правки на исходную сцену → { scene, warnings }. Исходная сцена не меняется. */
export function applyEdits(base, ed) {
  const s = clone(base), warnings = [];
  if (!ed || editsEmpty(ed)) return { scene: s, warnings };
  for (const k in ed.scene || {}) { if (ed.scene[k] === null) delete s[k]; else s[k] = clone(ed.scene[k]); }
  if ((ed.removed || []).length) {
    const kill = new Set(), ids = new Set(s.nodes.map((n) => n.id));
    for (const id of ed.removed) if (ids.has(id)) kill.add(id);
    let grew = true;
    while (grew) { grew = false; for (const n of s.nodes) if (n.parent && kill.has(n.parent) && !kill.has(n.id)) { kill.add(n.id); grew = true; } }
    s.nodes = s.nodes.filter((n) => !kill.has(n.id));
  }
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  for (const [id, e] of Object.entries(ed.nodes || {})) {
    const n = byId.get(id);
    if (!n) { warnings.push(`«${id}»: такого объекта нет в исходной сцене — правка не применена`); continue; }
    if (e.base && e.base.type !== n.type) { warnings.push(`«${id}»: был ${e.base.type}, теперь ${n.type} — правка не применена (id сдвинулись?)`); continue; }
    if (e.base && (e.base.parent ?? null) !== (n.parent ?? null)) warnings.push(`«${id}»: в исходной сцене сменился родитель (${e.base.parent ?? 'корень'} → ${n.parent ?? 'корень'})`);
    for (const k in e.was || {}) if (!same(e.was[k], n.props?.[k])) warnings.push(`«${id}».${k}: скрипт поменял значение, оставлена ваша правка`);
    if (e.props || e.unset) { n.props = { ...(n.props || {}), ...clone(e.props || {}) }; for (const k of e.unset || []) delete n.props[k]; }
    if (e.keys) {
      n.keys = n.keys || {};
      for (const p in e.keys) { if (e.keys[p] === null) delete n.keys[p]; else n.keys[p] = clone(e.keys[p]); }
      if (!Object.keys(n.keys).length) delete n.keys;
    }
    if ('mods' in e) { if (e.mods === null) delete n.mods; else n.mods = clone(e.mods); }
    if (e.setType) n.type = e.setType;
  }
  for (const o of ed.order || []) {
    let n;
    if (o.add) {
      n = clone(o.add);
      if (byId.has(n.id)) {
        const old = n.id; let i = 2; while (byId.has(`${old}_${i}`)) i++;
        n.id = `${old}_${i}`;
        warnings.push(`«${old}»: такой id появился в исходной сцене — ваш объект переименован в «${n.id}»`);
      }
      byId.set(n.id, n);
    } else {
      n = byId.get(o.id);
      if (!n) continue;
      s.nodes.splice(s.nodes.indexOf(n), 1);
    }
    const par = o.parent ?? null;
    if (par && !byId.has(par)) { warnings.push(`«${n.id}»: родителя «${par}» нет — объект перенесён в корень`); n.parent = null; }
    else n.parent = par;
    const aft = o.after && byId.get(o.after);
    let idx;
    if (aft && (aft.parent ?? null) === (n.parent ?? null) && s.nodes.includes(aft)) idx = s.nodes.indexOf(aft) + 1;
    else { const f = s.nodes.findIndex((x) => (x.parent ?? null) === (n.parent ?? null)); idx = f < 0 ? s.nodes.length : f; }
    s.nodes.splice(idx, 0, n);
  }
  return { scene: s, warnings };
}

/** Проверка сцены: возвращает список проблем. */
export function validateScene(scene) {
  const errs = [];
  if (!scene || !Array.isArray(scene.nodes)) return ['scene.nodes должен быть массивом'];
  for (const k of ['width', 'height', 'duration']) if (!(scene[k] > 0)) errs.push(`scene.${k} должен быть > 0`);
  const ids = new Set();
  for (const n of scene.nodes) {
    if (!n.id) errs.push('Узел без id');
    if (ids.has(n.id)) errs.push(`Повтор id ${n.id}`);
    ids.add(n.id);
    if (!NODE_TYPES.includes(n.type)) errs.push(`${n.id}: неизвестный тип ${n.type}`);
  }
  for (const n of scene.nodes) {
    if (n.parent && !ids.has(n.parent)) errs.push(`${n.id}: родитель ${n.parent} не найден`);
    for (const k of ['clip', 'mask']) if (n.props?.[k] && !ids.has(n.props[k])) errs.push(`${n.id}: ${k} ссылается на несуществующий ${n.props[k]}`);
    for (const m of n.mods || []) if (!MODIFIERS[m.type]) errs.push(`${n.id}: неизвестный модификатор ${m.type}`);
    for (const p in n.keys || {}) for (const k of n.keys[p]) { try { if (k.ease != null) resolveEase(k.ease); } catch (e) { errs.push(`${n.id}.${p}: ${e.message}`); } }
  }
  const cn = new Set();
  for (const c of scene.clips || []) {
    if (!c.name) errs.push('Клип без имени');
    if (cn.has(c.name)) errs.push(`Повтор имени клипа ${c.name}`);
    cn.add(c.name);
    if (!(c.end > c.start)) errs.push(`Клип ${c.name}: end должен быть больше start`);
    if (c.end > scene.duration + 1e-6) errs.push(`Клип ${c.name} выходит за длительность сцены (${scene.duration}s)`);
    if (c.next && !(scene.clips || []).some((x) => x.name === c.next)) errs.push(`Клип ${c.name}: next ссылается на несуществующий ${c.next}`);
  }
  const sn = new Set();
  for (const g of scene.states || []) {
    if (!g.name) errs.push('Группа состояний без имени');
    if (sn.has(g.name)) errs.push(`Повтор группы состояний ${g.name}`);
    sn.add(g.name);
    if (!g.values || typeof g.values !== 'object') { errs.push(`Состояния ${g.name}: нет values`); continue; }
    if (g.default != null && !(g.default in g.values)) errs.push(`Состояния ${g.name}: default «${g.default}» не среди вариантов`);
    for (const [v, patch] of Object.entries(g.values)) for (const id of Object.keys(patch || {})) if (!ids.has(id)) errs.push(`Состояние ${g.name}=${v}: узел ${id} не найден`);
  }
  for (const n of scene.nodes) {
    const ik = n.props?.ik;
    if (!ik) continue;
    if (!ik.target || !ids.has(ik.target)) errs.push(`${n.id}: цель IK «${ik.target}» не найдена`);
    const B = scene.nodes.find((x) => x.id === n.parent);
    if (!B || !B.parent) errs.push(`${n.id}: для IK нужны родитель и дед`);
  }
  if (!errs.length) { try { evaluate(scene, 0); evaluate(scene, scene.duration / 2); } catch (e) { errs.push('Ошибка вычисления: ' + e.message); } }
  return errs;
}

/* =========================================================================
 * 11. Пресеты (готовые анимационные приёмы)
 * ========================================================================= */

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
