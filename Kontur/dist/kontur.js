/*!
 * Kontur — движок векторной анимации
 * Ключевые кадры, морфинг путей, процедурные модификаторы, SVG-рендер.
 * Без зависимостей: работает в браузере и в Node.js. Исходники — engine/core/*.js;
 * этот файл — публичный API (одним файлом движок собирает mcp/bundle.mjs).
 */
/* ---- core/math.js ---- */
/** Математика: числа, шум Перлина, хеши, 2D-матрицы. */


const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
/** Округление до d знаков после запятой. */
const roundTo = (n, d) => { const k = 10 ** d; return Math.round(n * k) / k; };
/** Отдельный поток ГСЧ Парка — Миллера от сида s (своё состояние у каждого потока). */
const pmStep = (x) => (x * 16807) % 2147483647;
const makeRng = (s = 1) => { let x = s; return () => (x = pmStep(x)) / 2147483647; };
const r3 = (n) => Math.round(n * 1000) / 1000;
const r4 = (n) => roundTo(n, 4);
const FRAC = Array.from({ length: 1000 }, (_, f) => (f ? '.' + String(f).padStart(3, '0').replace(/0+$/, '') : ''));
/**
 * Строка числа, округлённого до 0,001 — то же, что String(r3(n)), но без медленного dtoa:
 * целая часть и дробь из таблицы (горячий путь сериализации путей).
 */
function num3(n) {
  const r = Math.round(n * 1000);
  if (!(r > -1e15 && r < 1e15)) return String(r3(n));
  if (r === 0) return '0';
  const a = r < 0 ? -r : r, ip = Math.floor(a / 1000);
  return (r < 0 ? '-' : '') + ip + FRAC[a - ip * 1000];
}

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
function noise3(x, y, z, seed = 0) {
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
const noise1 = (x, seed = 0) => noise3(x, 0.371, 0.713, seed);
/** Фрактальный шум. */
function fbm(x, seed = 0, octaves = 1, y = 0.371, z = 0.713) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(x * freq, y * freq, z * freq, seed + o * 31);
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

/** Короткий стабильный хеш строки (FNV-1a) — для id в defs. */
function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

const fmt = (n) => (typeof n === 'number' ? r3(n) : n);


/** Векторы 3D (массивы [x, y, z]). */
const vec3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};

const mat = {
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
  /**
   * Разложить [a b c d e f] в трансформацию узла: translate · rotate · skewX · scale (обратное compose без якоря).
   * Точно для любой невырожденной матрицы (отражение — отрицательный scaleY); вырожденная: нулевой столбец x —
   * нули, нулевой scaleY — без наклона.
   */
  decompose: (m) => {
    const [a, b, c, d, e, f] = m;
    const sx = Math.hypot(a, b);
    if (sx < 1e-12) return { x: e, y: f, rotation: 0, scaleX: 0, scaleY: 0, skewX: 0 };
    const th = Math.atan2(b, a), cs = Math.cos(th), sn = Math.sin(th);
    const c2 = cs * c + sn * d, sy = -sn * c + cs * d;
    const skew = Math.abs(sy) > 1e-12 ? Math.atan(c2 / sy) : 0;
    return { x: e, y: f, rotation: (th * 180) / Math.PI, scaleX: sx, scaleY: sy, skewX: (skew * 180) / Math.PI };
  },
};

/* ---- core/ease.js ---- */
/** Кривые сглаживания: именованные, cubic-bezier, пружины, ступени. */

const c1 = 1.70158, c2 = c1 * 1.525, c3 = c1 + 1, c4 = TAU / 3, c5 = TAU / 4.5;
function outBounce(x) {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
}
const easings = {
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
function cubicBezier(x1, y1, x2, y2) {
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
function springEase({ stiffness = 180, damping = 12, mass = 1, velocity = 0 } = {}) {
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
function resolveEase(e) {
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

/* ---- core/cache.js ---- */
/** Общие кеши движка. */

/**
 * Map с ограничением размера: по числу записей или по суммарному весу (weight(key, value), например длина строки).
 * При переполнении вытесняются самые старые записи (порядок вставки), пока не останется 3/4 предела, — а не весь кеш
 * разом: сброс целиком заставлял большие сцены (тысячи путей и цветов) пересчитывать всё на каждом кадре.
 */
class BoundedCache extends Map {
  constructor(limit, weight = null) {
    super();
    this.limit = limit;
    this.weight = weight;
    this.total = 0;
  }
  w(k, v) { return this.weight ? this.weight(k, v) : 1; }
  set(k, v) {
    if (super.has(k)) this.total -= this.w(k, super.get(k));
    super.set(k, v);
    this.total += this.w(k, v);
    if (this.total > this.limit) this.trim();
    return this;
  }
  trim() {
    for (const [k, v] of super.entries()) {
      if (this.total <= this.limit * 0.75) break;
      super.delete(k);
      this.total -= this.w(k, v);
    }
  }
  delete(k) {
    if (super.has(k)) this.total -= this.w(k, super.get(k));
    return super.delete(k);
  }
  clear() { super.clear(); this.total = 0; }
}

/**
 * Запоминание чистой функции одного объектного аргумента (WeakMap: запись живёт, пока жив объект).
 * Для объектов, которые не меняются на месте (геометрия из кеша путей, поверхности узлов).
 */
function memoByObject(fn) {
  const memo = new WeakMap();
  return (o) => {
    if (o === null || typeof o !== 'object') return fn(o);
    let v = memo.get(o);
    if (v === undefined) { v = fn(o); memo.set(o, v); }
    return v;
  };
}

/* ---- core/color.js ---- */
/** Цвета: разбор CSS, OKLab, смешивание. */


const NAMED = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', lime: '#00ff00', blue: '#0000ff',
  yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff', orange: '#ffa500', purple: '#800080',
  pink: '#ffc0cb', gray: '#808080', grey: '#808080', navy: '#000080', teal: '#008080', gold: '#ffd700',
  coral: '#ff7f50', crimson: '#dc143c', indigo: '#4b0082', violet: '#ee82ee', salmon: '#fa8072',
  turquoise: '#40e0d0', tomato: '#ff6347', orchid: '#da70d6', skyblue: '#87ceeb', hotpink: '#ff69b4',
  transparent: 'rgba(0,0,0,0)',
};
const colorCache = new BoundedCache(50000);
/** Разбор цвета в [r,g,b,a] (0..1, sRGB) или null. */
function parseColor(s) {
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
function formatColor([r, g, b, a = 1]) {
  const R = Math.round(clamp(r) * 255), G = Math.round(clamp(g) * 255), B = Math.round(clamp(b) * 255);
  if (a >= 0.999) return '#' + [R, G, B].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `rgba(${R},${G},${B},${r3(clamp(a))})`;
}
function mixColor(ca, cb, u) {
  const A = parseColor(ca), B = parseColor(cb);
  if (!A || !B) return u < 1 ? ca : cb;
  // прозрачный цвет перенимает оттенок другого, чтобы не «проваливаться» в серый
  const la = A[3] === 0 ? rgbToOklab(B) : rgbToOklab(A);
  const lb = B[3] === 0 ? rgbToOklab(A) : rgbToOklab(B);
  const L = [lerp(la[0], lb[0], u), lerp(la[1], lb[1], u), lerp(la[2], lb[2], u)];
  return formatColor([...oklabToRgb(L), lerp(A[3], B[3], u)]);
}

/* ---- core/geom.js ---- */
/** Геометрия: разбор путей, фигуры, морфинг, измерение, деформация.
 * Геометрия = массив подпутей { x0, y0, segs: [[c1x,c1y,c2x,c2y,x,y], ...], closed } */


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

/**
 * Кеш разобранных путей: d → геометрия. Ограничен суммарной длиной строк (а не числом записей: в больших сценах
 * десятки тысяч путей, и сброс по счёту заставлял разбирать каждый путь заново на каждом проходе). Переполнение —
 * вытесняются самые старые записи.
 */
const pathCache = new BoundedCache(16e6, (d) => d.length);
/** Разбор SVG path d → геометрия. Поддерживает M L H V C S Q T A Z (абс./отн.). */
function parsePath(d) {
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
  pathCache.set(d, out);
  return out;
}

/** Отрезок, заданный кривой (lineSeg): контрольные точки — на трети и двух третях прямой из (x, y). */
const isLineSeg = (x, y, c) => {
  const e = 1e-9 * (1 + Math.abs(x) + Math.abs(y) + Math.abs(c[4]) + Math.abs(c[5]));
  return Math.abs(c[0] - (x + (c[4] - x) / 3)) <= e && Math.abs(c[1] - (y + (c[5] - y) / 3)) <= e
    && Math.abs(c[2] - (x + (2 * (c[4] - x)) / 3)) <= e && Math.abs(c[3] - (y + (2 * (c[5] - y)) / 3)) <= e;
};
const pathStr = new WeakMap();
/**
 * Геометрия → строка d. Прямые отрезки пишутся как L (а не кривой из шести чисел), замыкающий отрезок перед Z
 * не пишется — d короче в разы, а SVG кадра быстрее разбирает растеризатор. Строка кешируется на объекте геометрии
 * (геометрия из кеша путей — одна и та же между проходами и кадрами; менять её на месте нельзя).
 */
function geomToPath(g) {
  const hit = pathStr.get(g);
  if (hit !== undefined) return hit;
  let s = '';
  for (const sp of g) {
    s += 'M' + num3(sp.x0) + ' ' + num3(sp.y0);
    let x = sp.x0, y = sp.y0;
    const segs = sp.segs, last = segs.length - 1;
    for (let k = 0; k <= last; k++) {
      const c = segs[k];
      if (isLineSeg(x, y, c)) {
        // замыкающий отрезок к началу контура рисует сам Z
        if (!(k === last && sp.closed && Math.abs(c[4] - sp.x0) < 1e-9 && Math.abs(c[5] - sp.y0) < 1e-9)) s += 'L' + num3(c[4]) + ' ' + num3(c[5]);
      } else s += 'C' + num3(c[0]) + ' ' + num3(c[1]) + ' ' + num3(c[2]) + ' ' + num3(c[3]) + ' ' + num3(c[4]) + ' ' + num3(c[5]);
      x = c[4]; y = c[5];
    }
    if (sp.closed) s += 'Z';
  }
  if (g && typeof g === 'object') pathStr.set(g, s);
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
function smoothGeom(pts, closed = true, tension = 1) {
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
function toGeom(v, t = 0) {
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
function translateGeom(g, dx, dy) {
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
const morphCache = new BoundedCache(500);
/** Готовит две геометрии к попарной интерполяции (одинаковое число сегментов, выравнивание старта). */
function prepareMorph(ga, gb, key) {
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
  if (key) morphCache.set(key, pairs);
  return pairs;
}
function lerpGeom(pairs, u) {
  return pairs.map(([a, b]) => ({
    x0: lerp(a.x0, b.x0, u), y0: lerp(a.y0, b.y0, u),
    closed: u < 0.5 ? a.closed : b.closed,
    segs: a.segs.map((c, i) => c.map((q, j) => lerp(q, b.segs[i][j], u))),
  }));
}
/** Морфинг между двумя любыми фигурами/путями. */
function morph(a, b, u) {
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
function measureGeom(g, steps = 16) {
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
function pointAtFraction(m, f) {
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
function deformGeom(g, { amount = 10, scale = 0.01, speed = 0.5, seed = 0, detail = 0 }, t) {
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

/** Габариты геометрии по опорным точкам (для отбрасывания вырожденных фигур); запоминаются на объекте геометрии. */
const geomBox = memoByObject(geomBoxRaw);
function geomBoxRaw(geom) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sp of geom) {
    if (sp.x0 < x0) x0 = sp.x0; if (sp.x0 > x1) x1 = sp.x0; if (sp.y0 < y0) y0 = sp.y0; if (sp.y0 > y1) y1 = sp.y0;
    for (const c of sp.segs) for (let i = 0; i < 6; i += 2) { if (c[i] < x0) x0 = c[i]; if (c[i] > x1) x1 = c[i]; if (c[i + 1] < y0) y0 = c[i + 1]; if (c[i + 1] > y1) y1 = c[i + 1]; }
  }
  return Number.isFinite(x0) ? [x1 - x0, y1 - y0] : [0, 0];
}

/* ---- core/tracks.js ---- */
/** Интерполяция значений и дорожки ключевых кадров. */




const GEOM_PROPS = new Set(['d', 'path', 'shape']);
const isGrad = (v) => v && typeof v === 'object' && (v.type === 'linear' || v.type === 'radial') && Array.isArray(v.stops);
const normStops = (st) => st.map((s) => (Array.isArray(s) ? { offset: s[0], color: s[1], opacity: s[2] } : s));

function interpolate(a, b, u, prop) {
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
function compileTrack(keys, prop) {
  const n = keys.length, times = new Float64Array(n), eases = new Array(n);
  for (let j = 0; j < n; j++) { times[j] = keys[j].t; eases[j] = keys[j].hold ? null : resolveEase(keys[j].ease); }
  // источники (для проверки правок на месте без invalidate): кривая и значение каждого ключа
  return { keys, times, eases, src: keys.map((k) => [k.ease, k.v, !!k.hold]), geom: GEOM_PROPS.has(prop), morphs: new Array(n), ends: [null, null], hint: 0 };
}
/** Индекс сегмента: наибольший i ∈ [0, n−2], для которого times[i] ≤ t (как прежний линейный поиск). */
function segIndex(tr, t) {
  const T = tr.times, n = T.length;
  let i = tr.hint;
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
function sampleKeys(keys, t, prop, cache) {
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

/* ---- core/types.js ---- */
/**
 * Реестр типов узлов: геометрия, свойства (для схемы, справки и инспектора) и особенности отрисовки.
 * Новый тип — registerNodeType(name, def); NODE_TYPES обновляется на месте.
 *
 * def: { doc, note?, props: { имя: { type, default?, doc? } }, geom?(P, node, t) → geom,
 *        draw?: 'shape' | 'group' | 'text' | 'image' | 'light', animated?(node) → true, если узел меняется сам по себе }
 */

const tNum = (d, doc) => ({ type: 'number', ...(d !== undefined ? { default: d } : {}), ...(doc ? { doc } : {}) });
const tStr = (d, doc) => ({ type: 'string', ...(d !== undefined ? { default: d } : {}), ...(doc ? { doc } : {}) });
const tAny = (doc) => ({ type: 'any', ...(doc ? { doc } : {}) });
const tBool = (d, doc) => ({ type: 'boolean', ...(d !== undefined ? { default: d } : {}), ...(doc ? { doc } : {}) });

/** Общие для всех узлов свойства (трансформация, отрисовка). */
const COMMON_PROPS = {
  x: tNum(0), y: tNum(0), rotation: tNum(0, 'градусы'), scale: tNum(1), scaleX: tNum(1), scaleY: tNum(1), skewX: tNum(0),
  anchorX: tNum(0), anchorY: tNum(0), opacity: tNum(1), visible: tBool(true),
  fill: tAny('цвет или градиент'), stroke: tAny('цвет или градиент'), strokeWidth: tNum(2), lineCap: tStr('round'), lineJoin: tStr('round'),
  dash: tAny('массив штрихов'), trimStart: tNum(0), trimEnd: tNum(1), trimOffset: tNum(0),
  blur: tNum(0), glow: tAny(), shadow: tAny(), blend: tStr(undefined, 'режим наложения'),
  clip: tStr(undefined, 'id узла-маски обрезки'), mask: tStr(undefined, 'id узла-маски'), repeat: tAny('копии'),
  name: tStr(), shade: tBool(false, 'тень для дизеринга'), dither: tAny(), relief: tAny(), surface: tAny('поверхность для отложенного света'),
};

const NODE_DEFS = {
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

const NODE_TYPES = Object.keys(NODE_DEFS);
/** Значения по умолчанию, отличные от общих (для defaultFor). */
const TYPE_DEFAULTS = { polygon: { radius: 50 } };
for (const [k, d] of Object.entries(NODE_DEFS)) if (d.defaults) TYPE_DEFAULTS[k] = { ...(TYPE_DEFAULTS[k] || {}), ...d.defaults };

/** Зарегистрировать тип узла (или заменить существующий). */
function registerNodeType(name, def) {
  if (!/^[a-z][\w-]*$/i.test(name)) throw new Error(`Недопустимое имя типа «${name}»`);
  NODE_DEFS[name] = { props: {}, draw: def.geom ? 'shape' : def.draw || 'shape', ...def };
  if (!NODE_TYPES.includes(name)) NODE_TYPES.push(name);
  // значения по умолчанию: явные defaults или default из описаний свойств
  const defs = def.defaults || Object.fromEntries(Object.entries(def.props || {}).filter(([, p]) => p?.default !== undefined).map(([k, p]) => [k, p.default]));
  if (Object.keys(defs).length) TYPE_DEFAULTS[name] = defs; else delete TYPE_DEFAULTS[name];
  return NODE_DEFS[name];
}
/** Свойства типа (общие + свои) с описаниями. */
function typeProps(type) { return { ...COMMON_PROPS, ...(NODE_DEFS[type]?.props || {}) }; }
/** Меняется ли узел сам по себе (без ключей и модификаторов): клякса с движением, спрайт-лист, свет. */
const typeAnimated = (n) => !!NODE_DEFS[n.type]?.animated?.(n);

/* ---- core/model.js ---- */
/** Модель сцены: значения по умолчанию, индекс и кэши сцены (типы узлов — types.js). */

const VERSION = '0.2.0';



const DEFAULTS = {
  x: 0, y: 0, rotation: 0, scale: 1, scaleX: 1, scaleY: 1, skewX: 0, anchorX: 0, anchorY: 0, opacity: 1,
  strokeWidth: 2, lineCap: 'round', lineJoin: 'round', trimStart: 0, trimEnd: 1, trimOffset: 0,
  blur: 0, width: 100, height: 100, radius: 0, rx: 50, ry: 50, sides: 6, points: 5, outerRadius: 50,
  innerRadius: 22, cornerRadius: 0, x1: 0, y1: 0, x2: 100, y2: 0, fontSize: 48,
  fontFamily: 'Inter, Segoe UI, Roboto, Helvetica, Arial, sans-serif', fontWeight: 600, textAlign: 'center',
  letterSpacing: 0, textReveal: 1, text: '', pathProgress: 0, visible: true,
};
function defaultFor(type, prop) {
  if (prop === 'fill') return type === 'path' || type === 'line' || type === 'group' ? 'none' : '#ffffff';
  if (prop === 'stroke') return type === 'line' ? '#ffffff' : 'none';
  if (TYPE_DEFAULTS[type] && prop in TYPE_DEFAULTS[type]) return TYPE_DEFAULTS[type][prop];
  return DEFAULTS[prop];
}

/** Значение свойства по умолчанию для типа узла (для редактора и инструментов). */
const propDefault = (type, prop) => defaultFor(type, prop);

function createScene(o = {}) {
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
  if (!c) { c = { children: null, byId: null, clipRefs: null, springs: new Map(), measures: new Map(), evalCache: new Map(), stat: new Map(), tracks: new Map(), modMaps: new WeakMap(), autoNext: new Map() }; sceneCaches.set(scene, c); }
  return c;
}

/** Сбросить все кэши после изменения сцены. */
function invalidate(scene) { sceneCaches.delete(scene); }

/**
 * Значение, производное от всей сцены (сериализация, сводки), — посчитать один раз и держать, пока сцену не изменили:
 * живёт в тех же кэшах, что и индекс, поэтому сбрасывается invalidate / invalidateNode и заменой массива узлов.
 */
function sceneMemo(scene, key, make) {
  const c = index(scene);
  const m = c.memo || (c.memo = new Map());
  if (!m.has(key)) m.set(key, make(scene));
  return m.get(key);
}

/**
 * Сбросить только то, что зависит от узла id (его свойства, ключи или модификаторы изменились, а id, родитель,
 * тип, маски и IK — нет): пружины, дорожки, статичный кэш узла, предков и тех, кто ссылается на узел.
 * Если индекса ещё нет или узел неизвестен — полный сброс.
 */
function invalidateNode(scene, id) {
  const c = sceneCaches.get(scene);
  if (!c || !c.byId || !c.byId.has(id)) { sceneCaches.delete(scene); return; }
  const node = c.byId.get(id);
  // кто зависит: сам узел, его пользователи (маски, link, followPath) — и предки всех их
  const touched = new Set([id]);
  const queue = [id];
  while (queue.length) { const x = queue.pop(); for (const u of c.refUsers.get(x) || []) if (!touched.has(u)) { touched.add(u); queue.push(u); } }
  const drop = new Set();
  for (const x of touched) for (let p = x; p != null && !drop.has(p); p = c.byId.get(p)?.parent ?? null) drop.add(p);
  for (const x of drop) c.stat.delete(x);
  c.frame = null; c.memo = null;
  if (c.evalCache.size) for (const k of [...c.evalCache.keys()]) if (drop.has(k.slice(0, k.indexOf('|')))) c.evalCache.delete(k);
  if (touched.size > 1) c.springs.clear();
  else for (const k of [...c.springs.keys()]) if (k.startsWith(id + '|')) c.springs.delete(k);
  for (const k of [...c.measures.keys()]) if (k.startsWith('fp|' + id + '|')) c.measures.delete(k);
  for (const k in node.keys || {}) c.tracks.delete(node.keys[k]);
  c.modMaps.delete(node);
}

/**
 * Узел добавлен в конец scene.nodes: дополнить индекс без полного пересчёта (тысячи addNode подряд — O(n)).
 * Узлы с масками, IK или вставкой не в конец требуют полного сброса.
 */
function noteNodeAdded(scene, node) {
  const c = sceneCaches.get(scene);
  if (!c || !c.byId || node.props?.ik || node.props?.clip || node.props?.mask || scene.nodes[scene.nodes.length - 1] !== node) { sceneCaches.delete(scene); return; }
  if (c.nodesRef !== scene.nodes || c.nodesLen !== scene.nodes.length - 1) { sceneCaches.delete(scene); return; }
  c.nodesLen++;
  c.byId.set(node.id, node);
  const p = node.parent ?? null;
  if (!c.children.has(p)) c.children.set(p, []);
  c.children.get(p).push(node);
  addRefs(c, node);
  if (p != null) invalidateNode(scene, p);
}

function addRefs(c, n) {
  const add = (target) => { if (!c.refUsers.has(target)) c.refUsers.set(target, new Set()); c.refUsers.get(target).add(n.id); };
  for (const k of ['clip', 'mask']) if (n.props?.[k]) add(n.props[k]);
  if (n.type === 'text' && typeof n.props?.path === 'string') add(n.props.path);
  for (const m of n.mods || []) {
    if (m.type === 'link' && m.source) add(m.source);
    if (m.type === 'followPath' && typeof m.path === 'string') add(m.path);
  }
}

function index(scene) {
  let c = cacheFor(scene);
  // сцену поменяли в обход ops (новый массив узлов или другая длина) — индекс и кэши устарели
  if (c.byId && (c.nodesRef !== scene.nodes || c.nodesLen !== scene.nodes.length)) { sceneCaches.delete(scene); c = cacheFor(scene); }
  if (!c.byId) {
    c.nodesRef = scene.nodes; c.nodesLen = scene.nodes.length;
    c.byId = new Map(); c.children = new Map(); c.clipRefs = new Set(); c.refUsers = new Map();
    c.ik = []; c.ikAffected = new Set(); c.stateAffected = new Set();
    for (const n of scene.nodes) {
      c.byId.set(n.id, n);
      const p = n.parent ?? null;
      if (!c.children.has(p)) c.children.set(p, []);
      c.children.get(p).push(n);
      for (const k of ['clip', 'mask']) if (n.props?.[k]) c.clipRefs.add(n.props[k]);
      addRefs(c, n);
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

/* ---- core/expr.js ---- */
/**
 * Безопасные выражения модификатора expr: подмножество JS без доступа к среде.
 *
 * Поддерживается: const/let/var, if/else, return, блоки, присваивание локальных переменных (= += -= *= /=),
 * числа, строки, true/false/null/undefined/NaN/Infinity, массивы [a, b], операторы
 * ?: ?? || && === !== == != < > <= >= + - * / % ** ! унарные - + typeof, скобки,
 * чтение полей (a.b, a[i]) и вызов только разрешённых функций: Math.*, ctx.noise1/noise3/fbm/lerp/clamp/ease,
 * Number.isFinite, isNaN, isFinite. Циклов нет — выражение всегда завершается.
 * Поля constructor, prototype, __proto__ и т. п. закрыты: выйти к Function нельзя.
 *
 * Код, который не укладывается в подмножество, исполняется как настоящий JS (new Function) только
 * если это разрешено политикой: в браузере — да, в Node — при KONTUR_TRUST_EXPR=1 (или setExprPolicy).
 */

const KEYWORDS = new Set(['const', 'let', 'var', 'if', 'else', 'return', 'true', 'false', 'null', 'undefined', 'typeof', 'NaN', 'Infinity']);
const BLOCKED = new Set(['constructor', 'prototype', '__proto__', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__', 'caller', 'callee', 'arguments', 'call', 'apply', 'bind', 'valueOf', 'toString', 'toLocaleString', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable']);
const PUNCT = ['===', '!==', '**=', '...', '==', '!=', '<=', '>=', '&&', '||', '??', '**', '+=', '-=', '*=', '/=', '%=', '=>', '?.', '(', ')', '[', ']', '{', '}', ',', ';', '?', ':', '.', '+', '-', '*', '/', '%', '<', '>', '!', '='];

class ExprSyntaxError extends Error {}

function tokenize(src) {
  const out = [];
  let i = 0, line = 1;
  const err = (m) => { throw new ExprSyntaxError(`${m} (строка ${line})`); };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; out.nl = true; if (out.length) out[out.length - 1].nlAfter = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) err('незакрытый комментарий'); for (let k = i; k < e; k++) if (src[k] === '\n') line++; i = e + 2; continue; }
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      const m = /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(src.slice(i));
      out.push({ k: 'num', v: Number(m[0]), line }); i += m[0].length; continue;
    }
    if (c === "'" || c === '"') {
      let s = '', j = i + 1;
      for (; j < src.length && src[j] !== c; j++) {
        if (src[j] === '\n') err('перевод строки внутри строки');
        if (src[j] === '\\') { const n = src[++j]; s += n === 'n' ? '\n' : n === 't' ? '\t' : n; } else s += src[j];
      }
      if (j >= src.length) err('незакрытая строка');
      out.push({ k: 'str', v: s, line }); i = j + 1; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
      out.push({ k: KEYWORDS.has(m[0]) ? 'kw' : 'id', v: m[0], line }); i += m[0].length; continue;
    }
    const p = PUNCT.find((q) => src.startsWith(q, i));
    if (!p) err(`недопустимый символ «${c}»`);
    out.push({ k: 'p', v: p, line }); i += p.length;
  }
  out.push({ k: 'eof', v: '', line });
  return out;
}

/* ---------- разбор в дерево ---------- */
function parse(src) {
  const T = tokenize(src);
  let p = 0;
  const peek = () => T[p];
  const err = (m, t = T[p]) => { throw new ExprSyntaxError(`${m}${t.k === 'eof' ? ' в конце' : ` около «${t.v}»`} (строка ${t.line})`); };
  const is = (v, k = 'p') => T[p].k === k && T[p].v === v;
  const isKw = (v) => is(v, 'kw');
  const eat = (v, k = 'p') => { if (!is(v, k)) err(`ожидалось «${v}»`); return T[p++]; };
  const semi = () => { if (is(';')) p++; };

  function program() { const body = []; while (peek().k !== 'eof') body.push(statement()); return { type: 'block', body }; }
  function statement() {
    if (is(';')) { p++; return { type: 'empty' }; }
    if (is('{')) { p++; const body = []; while (!is('}')) { if (peek().k === 'eof') err('ожидалось «}»'); body.push(statement()); } p++; return { type: 'block', body }; }
    if (isKw('const') || isKw('let') || isKw('var')) {
      p++;
      const decls = [];
      do {
        const id = T[p]; if (id.k !== 'id') err('ожидалось имя переменной'); p++;
        let init = null;
        if (is('=')) { p++; init = assign(); }
        decls.push({ name: id.v, init });
      } while (is(',') && ++p);
      semi();
      return { type: 'decl', decls };
    }
    if (isKw('if')) {
      p++; eat('('); const test = expression(); eat(')');
      const then = statement();
      let other = null;
      if (isKw('else')) { p++; other = statement(); }
      return { type: 'if', test, then, other };
    }
    if (isKw('return')) {
      const r = T[p++];
      if (is(';') || is('}') || peek().k === 'eof' || r.nlAfter) { semi(); return { type: 'return', arg: null }; }
      const arg = expression(); semi();
      return { type: 'return', arg };
    }
    const e = expression(); semi();
    return { type: 'expr', e };
  }
  function expression() {
    let e = assign();
    while (is(',')) { p++; e = { type: 'seq', a: e, b: assign() }; }
    return e;
  }
  function assign() {
    const left = ternary();
    if (peek().k === 'p' && ['=', '+=', '-=', '*=', '/=', '%=', '**='].includes(peek().v)) {
      const op = T[p++].v;
      if (left.type !== 'id') err('присваивать можно только локальной переменной', T[p - 1]);
      return { type: 'assign', op, name: left.name, value: assign() };
    }
    return left;
  }
  function ternary() {
    const test = binary(0);
    if (!is('?')) return test;
    p++; const a = assign(); eat(':'); const b = assign();
    return { type: 'cond', test, a, b };
  }
  const LEVELS = [['??'], ['||'], ['&&'], ['===', '!==', '==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
  function binary(lvl) {
    if (lvl === LEVELS.length) return power();
    let a = binary(lvl + 1);
    while (peek().k === 'p' && LEVELS[lvl].includes(peek().v)) { const op = T[p++].v; a = { type: 'bin', op, a, b: binary(lvl + 1) }; }
    return a;
  }
  function power() {
    const a = unary();
    if (is('**')) { p++; return { type: 'bin', op: '**', a, b: power() }; }
    return a;
  }
  function unary() {
    if (peek().k === 'p' && ['!', '-', '+'].includes(peek().v)) { const op = T[p++].v; return { type: 'un', op, a: unary() }; }
    if (isKw('typeof')) { p++; return { type: 'un', op: 'typeof', a: unary() }; }
    return postfix();
  }
  function postfix() {
    let e = primary();
    for (;;) {
      if (is('.')) { p++; const id = T[p]; if (id.k !== 'id' && id.k !== 'kw') err('ожидалось имя поля'); p++; e = { type: 'member', obj: e, key: { type: 'lit', v: id.v } }; }
      else if (is('[')) { p++; const key = expression(); eat(']'); e = { type: 'member', obj: e, key }; }
      else if (is('(')) {
        p++; const args = [];
        while (!is(')')) { args.push(assign()); if (!is(')')) eat(','); }
        p++; e = { type: 'call', callee: e, args };
      } else return e;
    }
  }
  function primary() {
    const t = T[p];
    if (t.k === 'num' || t.k === 'str') { p++; return { type: 'lit', v: t.v }; }
    if (t.k === 'kw') {
      const lits = { true: true, false: false, null: null, undefined, NaN, Infinity };
      if (t.v in lits) { p++; return { type: 'lit', v: lits[t.v] }; }
      err('неожиданное слово');
    }
    if (t.k === 'id') { p++; return { type: 'id', name: t.v }; }
    if (is('(')) { p++; const e = expression(); eat(')'); return e; }
    if (is('[')) {
      p++; const items = [];
      while (!is(']')) { items.push(assign()); if (!is(']')) eat(','); }
      p++; return { type: 'array', items };
    }
    err('неожиданный символ');
  }
  return program();
}

/* ---------- компиляция дерева в замыкания ---------- */
const SAFE_MATH = Object.create(null);
for (const k of Object.getOwnPropertyNames(Math)) SAFE_MATH[k] = Math[k];
const GLOBALS = { Math: SAFE_MATH, Number: { isFinite: Number.isFinite, isNaN: Number.isNaN, isInteger: Number.isInteger, EPSILON: Number.EPSILON, MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER }, isNaN, isFinite, parseFloat, parseInt };
const SAFE_FNS = new Set([...Object.values(SAFE_MATH).filter((f) => typeof f === 'function'), Number.isFinite, Number.isNaN, Number.isInteger, isNaN, isFinite, parseFloat, parseInt]);
const PARAMS = ['t', 'v', 'n', 'i', 'ctx'];
/** Разрешить вызов функций из выражений (помощники ctx: noise1, fbm, ease…). Функции должны быть чистыми. */
function allowExprFunctions(...fns) { for (const f of fns) if (typeof f === 'function') SAFE_FNS.add(f); }

function getField(obj, key) {
  if (obj == null) throw new Error(`выражение: чтение поля «${String(key)}» у ${obj}`);
  if (typeof key !== 'number' && typeof key !== 'string') throw new Error('выражение: имя поля должно быть строкой или числом');
  if (BLOCKED.has(key)) throw new Error(`выражение: поле «${key}» недоступно`);
  if (typeof obj === 'string') return key === 'length' ? obj.length : typeof key === 'number' ? obj[key] : undefined;
  if (typeof obj !== 'object' && typeof obj !== 'function') return undefined;
  if (Array.isArray(obj)) return key === 'length' ? obj.length : obj[key];
  // только собственные поля: прототипы недоступны
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function compileNode(n, scope) {
  switch (n.type) {
    case 'lit': { const v = n.v; return () => v; }
    case 'array': { const items = n.items.map((x) => compileNode(x, scope)); return (f) => items.map((g) => g(f)); }
    case 'id': {
      const name = n.name;
      const pi = PARAMS.indexOf(name);
      if (pi >= 0) return (f) => (name in f.L ? f.L[name] : f.a[pi]);
      if (name in GLOBALS) { const g = GLOBALS[name]; return (f) => (name in f.L ? f.L[name] : g); }
      return (f) => { if (!(name in f.L)) throw new Error(`выражение: неизвестное имя «${name}»`); return f.L[name]; };
    }
    case 'member': { const o = compileNode(n.obj, scope), k = compileNode(n.key, scope); return (f) => getField(o(f), k(f)); }
    case 'call': {
      const callee = compileNode(n.callee, scope), args = n.args.map((x) => compileNode(x, scope));
      return (f) => {
        const fn = callee(f);
        if (typeof fn !== 'function' || !SAFE_FNS.has(fn)) throw new Error('выражение: вызывать можно только Math.* и функции ctx');
        return fn(...args.map((g) => g(f)));
      };
    }
    case 'un': {
      const a = compileNode(n.a, scope);
      switch (n.op) {
        case '!': return (f) => !a(f);
        case '-': return (f) => -a(f);
        case '+': return (f) => +a(f);
        default: return (f) => typeof a(f);
      }
    }
    case 'bin': {
      const a = compileNode(n.a, scope), b = compileNode(n.b, scope);
      switch (n.op) {
        case '+': return (f) => a(f) + b(f);
        case '-': return (f) => a(f) - b(f);
        case '*': return (f) => a(f) * b(f);
        case '/': return (f) => a(f) / b(f);
        case '%': return (f) => a(f) % b(f);
        case '**': return (f) => a(f) ** b(f);
        case '<': return (f) => a(f) < b(f);
        case '>': return (f) => a(f) > b(f);
        case '<=': return (f) => a(f) <= b(f);
        case '>=': return (f) => a(f) >= b(f);
        case '===': return (f) => a(f) === b(f);
        case '!==': return (f) => a(f) !== b(f);
        // eslint-disable-next-line eqeqeq
        case '==': return (f) => a(f) == b(f);
        // eslint-disable-next-line eqeqeq
        case '!=': return (f) => a(f) != b(f);
        case '&&': return (f) => a(f) && b(f);
        case '||': return (f) => a(f) || b(f);
        case '??': return (f) => a(f) ?? b(f);
      }
      break;
    }
    case 'cond': { const t = compileNode(n.test, scope), a = compileNode(n.a, scope), b = compileNode(n.b, scope); return (f) => (t(f) ? a(f) : b(f)); }
    case 'seq': { const a = compileNode(n.a, scope), b = compileNode(n.b, scope); return (f) => (a(f), b(f)); }
    case 'assign': {
      const name = n.name, val = compileNode(n.value, scope);
      if (!scope.has(name)) throw new ExprSyntaxError(`присваивание необъявленной переменной «${name}»`);
      const ops = { '=': (x, y) => y, '+=': (x, y) => x + y, '-=': (x, y) => x - y, '*=': (x, y) => x * y, '/=': (x, y) => x / y, '%=': (x, y) => x % y, '**=': (x, y) => x ** y };
      const op = ops[n.op];
      return (f) => (f.L[name] = op(f.L[name], val(f)));
    }
  }
  throw new ExprSyntaxError(`неподдержанная конструкция ${n.type}`);
}
/** Оператор → функция (f) => true, если выполнен return (значение в f.r). */
function compileStmt(n, scope) {
  switch (n.type) {
    case 'empty': return () => false;
    case 'block': {
      const list = n.body.map((s) => compileStmt(s, scope));
      return (f) => { for (let k = 0; k < list.length; k++) if (list[k](f)) return true; return false; };
    }
    case 'decl': {
      for (const d of n.decls) scope.add(d.name);
      const ds = n.decls.map((d) => [d.name, d.init ? compileNode(d.init, scope) : null]);
      return (f) => { for (const [name, init] of ds) f.L[name] = init ? init(f) : undefined; return false; };
    }
    case 'if': {
      const t = compileNode(n.test, scope), a = compileStmt(n.then, scope), b = n.other ? compileStmt(n.other, scope) : null;
      return (f) => (t(f) ? a(f) : b ? b(f) : false);
    }
    case 'return': { const a = n.arg ? compileNode(n.arg, scope) : null; return (f) => { f.r = a ? a(f) : undefined; return true; }; }
    case 'expr': { const e = compileNode(n.e, scope); return (f) => { e(f); return false; }; }
  }
  throw new ExprSyntaxError(`неподдержанный оператор ${n.type}`);
}

/**
 * Скомпилировать безопасное выражение. Возвращает функцию (t, v, n, i, ctx) → значение (как тело JS-функции:
 * без return — undefined). Бросает ExprSyntaxError, если код выходит за подмножество.
 */
function compileSafeExpr(code) {
  const tree = parse(String(code));
  const run = compileStmt(tree, new Set());
  const fn = (t, v, n, i, ctx) => {
    const f = { a: [t, v, n, i, ctx], L: Object.create(null), r: undefined };
    run(f);
    return f.r;
  };
  fn.safe = true;
  return fn;
}
const isExprSyntaxError = (e) => e instanceof ExprSyntaxError;

/* ---------- политика: можно ли исполнять настоящий JS ---------- */
const envTrust = () => {
  try { return globalThis.process?.env?.KONTUR_TRUST_EXPR === '1'; } catch { return false; }
};
const policy = { allowJS: typeof window !== 'undefined' || envTrust() };
/** allowJS: исполнять ли код вне безопасного подмножества как JS. По умолчанию: браузер — да, Node — KONTUR_TRUST_EXPR=1. */
function setExprPolicy(p = {}) { if ('allowJS' in p) policy.allowJS = !!p.allowJS; exprCache.clear(); return { ...policy }; }
const exprPolicy = () => ({ ...policy });

const exprCache = new BoundedCache(2000);
const JS_OFF = 'JS-выражения выключены (безопасный режим): код выходит за подмножество выражений. Разрешить: KONTUR_TRUST_EXPR=1 или setExprPolicy({ allowJS: true })';
/**
 * Функция выражения expr. strict — для добавления модификатора: код, требующий JS при выключенном JS,
 * — ошибка. Без strict (вычисление загруженной сцены) такой модификатор просто не действует (fn.disabled).
 */
function compileExpr(code, { strict = false } = {}) {
  const key = (strict ? 's|' : 'l|') + code;
  if (exprCache.has(key)) return exprCache.get(key);
  let fn;
  try { fn = compileSafeExpr(code); }
  catch (safeErr) {
    if (!isExprSyntaxError(safeErr)) throw safeErr;
    let js;
    try { js = new Function('t', 'v', 'n', 'i', 'ctx', code); } // только разбор: тело не исполняется
    catch (e) { throw new Error(`Ошибка в выражении: ${e.message}`); }
    if (policy.allowJS) fn = js;
    else if (strict) throw new Error(`${JS_OFF}. Не поддержано: ${safeErr.message}`);
    else { fn = () => undefined; fn.disabled = `${JS_OFF}. ${safeErr.message}`; }
  }
  exprCache.set(key, fn);
  return fn;
}

/* ---- core/values.js ---- */
/** Значения свойств: ключи, состояния, модификаторы; геометрия узла. */






const NO_MODS = new Map();
/** Карта «свойство → номера модификаторов» узла (строится один раз на узел, хранится в кэше сцены). */
function modMapOf(node, c) {
  const mods = node.mods;
  if (!mods || !mods.length) return NO_MODS;
  let mm = c.modMaps.get(node);
  if (mm && mm.src === mods && mm.len === mods.length) return mm.map;
  const map = new Map();
  mods.forEach((m, mi) => {
    const def = MODIFIERS[m.type];
    if (!def) return;
    for (const p of def.targets(m)) { if (!map.has(p)) map.set(p, []); map.get(p).push(mi); }
  });
  c.modMaps.set(node, { src: mods, len: mods.length, map });
  return map;
}

/** Значение свойства узла с учётом ключей, состояний и модификаторов. */
function propValue(node, name, t, ctx, copy = 0, upTo = Infinity) {
  if (name === 'rotation' && ctx.ikRot && ctx.ikRot.has(node.id) && upTo === Infinity) return ctx.ikRot.get(node.id);
  let v;
  const k = node.keys?.[name];
  const ov = ctx.over && ctx.over.get(node.id);
  if (ov && name in ov) v = ov[name];
  else if (k && k.length) v = sampleKeys(k, t, name, ctx.c.tracks);
  else if (node.props && name in node.props) v = node.props[name];
  else v = defaultFor(node.type, name);
  if (name === 'scale' && v == null) v = 1;
  if (!node.mods) return v;
  const list = modMapOf(node, ctx.c).get(name);
  if (!list) return v;
  for (let j = 0; j < list.length; j++) {
    const mi = list[j];
    if (mi >= upTo) break;
    const m = node.mods[mi];
    const w = modActive(m, t);
    if (!w) continue;
    v = applyMod(node, m, mi, name, v, t, ctx, copy, w);
  }
  return v;
}

/** Применить модификатор (по реестру MODIFIERS). */
function applyMod(node, m, mi, name, v, t, ctx, copy, w) {
  const def = MODIFIERS[m.type];
  return def ? def.apply(node, m, mi, name, v, t, ctx, copy, w) : v;
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
    let v = node.keys?.[k]?.length ? sampleKeys(node.keys[k], t, k, ctx.c.tracks) : node.props[k];
    if (v && typeof v === 'object' && v.shape === 'blob') v = { ...v, time: t };
    g = toGeom(v, t);
  } else {
    // геометрия по типу — из реестра (types.js)
    const def = NODE_DEFS[node.type];
    g = def?.geom ? def.geom(P, node, t) : [];
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

/* ---- core/modifiers.js ---- */
/**
 * Процедурные модификаторы — реестр. Каждый модификатор узла: { type, ...параметры, enabled?, start?, end?, fadeIn?, fadeOut?, weight? }.
 * Запись реестра: { targets(m) → свойства, apply(ctx) → новое значение, isStatic(m) → не зависит от времени,
 * params — схема параметров (тип, по умолчанию, описание), doc }. Из реестра строятся документация (docs),
 * схема сцены и проверка; новые модификаторы добавляются registerModifier без правки ядра.
 */







const pNum = (def, doc) => ({ type: 'number', default: def, doc });
const pStr = (def, doc) => ({ type: 'string', default: def, doc });
const pBool = (def, doc) => ({ type: 'boolean', default: def, doc });
const PROP_PARAMS = { prop: pStr(undefined, 'свойство'), props: { type: 'array', doc: 'несколько свойств' } };
const ampOf = (m, pi) => (Array.isArray(m.amp) ? m.amp[pi] ?? m.amp[0] : m.amp ?? 10);
/** Помощники выражений expr: одни и те же функции на всё время работы (их вызов разрешён в безопасном режиме). */
const exprEase = (n, u) => resolveEase(n)(u);
allowExprFunctions(noise1, noise3, fbm, lerp, clamp, exprEase);

const MODIFIERS = {
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
function registerModifier(type, def) {
  if (!def || typeof def.apply !== 'function' || typeof def.targets !== 'function') throw new Error('registerModifier: нужны targets(m) и apply(...)');
  MODIFIERS[type] = { params: {}, doc: '', ...def };
  return MODIFIERS[type];
}
/** Статичен ли модификатор (не зависит от времени): выключен или так объявил реестр. */
const modIsStatic = (m) => m.enabled === false || !!MODIFIERS[m.type]?.isStatic?.(m);
/** Кандидаты в id узлов, на которые ссылается модификатор (вызывающий оставляет существующие). */
const modRefs = (m) => MODIFIERS[m.type]?.refs?.(m) || [];

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

/* ---- core/surface.js ---- */
/** Поверхности и проходы отложенного света (2.5D), камера 2.5D. */




/** Настройки рельефа по умолчанию (режим высот для карт нормалей). */
const RELIEF_DEFAULT = { height: 0.5, depth: 0.3, bevel: 8, profile: 'round', luma: 0.25, background: 0 };
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
 * surface узла: { normal, normalGrad, tilt: [du, dv, k], plane: [nx, ny, nz, d], u, v, spec, emissive, mat, base, bump, ink, sw, tag, sky }.
 * normal — нормаль для света (может быть наклонена: рельеф), plane — плоскость n·P = d для восстановления позиции.
 * normalGrad — градиент нормали внутри узла (скругления): слой или массив слоёв, см. normalGradLayers.
 * mat — имя материала из scene.materials (проход matId: номер материала для попиксельных деталей).
 * Наследуются детьми: plane, normal, normalGrad, u, v, spec, emissive, mat, tag, sky. Только свои: base, bump, ink, sw, tilt.
 */
/**
 * Режимы рендера (стратегии кадра): data — проход с данными для отложенного света (не цвет), bg — фон прохода,
 * crisp — без сглаживания краёв (смешанный край дал бы мусорные данные), cache — можно брать статичные поддеревья
 * из кэша кадра. Маски mask:<метка> — отдельная запись MASK_MODE. Новый режим — registerRenderMode.
 */
const RENDER_MODES = {
  color: { data: false, cache: true },
  height: { data: false },
  normal: { data: true, bg: null, crisp: true },
  plane: { data: true, bg: null, crisp: true },
  planeD: { data: true, bg: null, crisp: true },
  emissive: { data: true, bg: '#000000' },
  ink: { data: true, bg: '#ffffff' },
  cover: { data: true, bg: '#000000' },
  matId: { data: true, bg: null, crisp: true },
};
const MASK_MODE = { data: true, bg: '#000000' };
/** Описание режима (неизвестный — как color). */
const modeInfo = (m) => RENDER_MODES[m] || (typeof m === 'string' && m.startsWith('mask:') && m.length > 5 ? MASK_MODE : RENDER_MODES.color);
function registerRenderMode(name, def) { RENDER_MODES[name] = { data: true, bg: null, ...def }; if (RENDER_MODES[name].data && !PASS_MODES.includes(name)) PASS_MODES.push(name); PASS_BG[name] = RENDER_MODES[name].bg ?? null; }
const PASS_MODES = Object.keys(RENDER_MODES).filter((k) => RENDER_MODES[k].data);
/** Фон проходов: данные — прозрачный, свечение и маски — чёрный, контур — белый. */
const PASS_BG = Object.fromEntries(PASS_MODES.map((k) => [k, RENDER_MODES[k].bg ?? null]));
const isPassMode = (m) => PASS_MODES.includes(m) || (typeof m === 'string' && m.startsWith('mask:') && m.length > 5);
const SURF_INHERIT = ['plane', 'normal', 'normalGrad', 'u', 'v', 'spec', 'emissive', 'mat', 'tag', 'sky'];
const v3 = vec3;
const isVec3 = (a) => Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every((x) => typeof x === 'number' && Number.isFinite(x));
/** Оси грани по нормали: u — «вдоль» (горизонталь), v — «вверх по грани». Для пола u = X, v = +Z (вглубь). */
function surfaceAxes(n) {
  n = v3.norm(n);
  let u = v3.cross(n, [0, 1, 0]);
  if (Math.hypot(...u) < 1e-4) return { u: [1, 0, 0], v: n[1] > 0 ? [0, 0, 1] : [0, 0, -1] };
  u = v3.norm(u);
  return { u, v: v3.norm(v3.cross(u, n)) };
}
/**
 * Действующая поверхность узла: наследуемое от предков + своё. own === false — узел без поверхности.
 * Чистая функция пары объектов: результат запоминается (WeakMap по родителю, затем по своей), поэтому у статичных
 * узлов поверхность каждого кадра и прохода — тот же объект. Результат не изменять.
 */
const surfMemo = new WeakMap();
const NO_SURF = {};
function resolveSurface(parent, own) {
  if (own === false) return null;
  if (own != null && typeof own !== 'object') return resolveSurfaceRaw(parent, own);
  const pk = parent || NO_SURF;
  let m = surfMemo.get(pk);
  if (!m) surfMemo.set(pk, (m = new WeakMap()));
  const ok = own || NO_SURF;
  let s = m.get(ok);
  if (s === undefined) m.set(ok, (s = resolveSurfaceRaw(parent, own)));
  return s;
}
function resolveSurfaceRaw(parent, own) {
  const s = {};
  if (parent) for (const k of SURF_INHERIT) if (parent[k] !== undefined) s[k] = parent[k];
  const has = own && typeof own === 'object';
  if (!has && !parent) return null;
  if (has) for (const k in own) if (k !== 'tilt') s[k] = own[k];
  // своя нормаль или наклон перекрывают унаследованный градиент
  if (has && own.normalGrad === undefined && (own.normal || own.tilt)) delete s.normalGrad;
  if (s.normalGrad === null || s.normalGrad === false) delete s.normalGrad;
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
const encodeNormal = (n) => '#' + [0, 1, 2].map((i) => hex2((clamp(n[i], -1, 1) * 0.5 + 0.5) * 255)).join('');
/** d плоскости 16 бит (R старший, G младший байт: q = round((d + 200)·100)) и сила блика в B. */
function encodePlaneD(d, spec = 0.1) {
  const q = clamp(Math.round((d + 200) * 100), 0, 65535);
  return '#' + hex2(q >> 8) + hex2(q & 255) + hex2(clamp(spec) * 255);
}
/** Номер материала → цвет прохода matId: R — старший байт, G — младший, B — резерв. 0 — без материала. */
const encodeMatId = (i) => '#' + hex2((i >> 8) & 255) + hex2(i & 255) + '00';
/** Таблица номеров материалов сцены: имя → 1, 2, … по порядку ключей scene.materials. */
function materialIndex(scene) {
  const m = new Map();
  Object.keys(scene?.materials || {}).forEach((k, i) => m.set(k, i + 1));
  return m;
}
/**
 * Слои градиента нормали. Слой: { kind: 'linear', from: [x,y], to: [x,y], stops: [[t, [nx,ny,nz]], …], ch: 'xyz' }
 * или { kind: 'radial', c: [x,y], r: r | [rx, ry], stops, ch }, или { kind: 'sphere', c: [x,y], r: r | [rx, ry], flat }:
 * сфера или сплюснутый купол — три канальных слоя (x — линейно по X, y — по Y, z — радиально), смешиваются
 * через lighten, поэтому нормаль точна в каждой точке. ch — какие компоненты пишет слой (остальные — 0 в кодировке).
 */
function normalGradLayers(ng) {
  const list = Array.isArray(ng) ? ng : ng ? [ng] : [];
  const out = [];
  for (const L of list) {
    if (!L || typeof L !== 'object') continue;
    if (L.kind === 'sphere') {
      const [cx, cy] = L.c || [0, 0], rx = Array.isArray(L.r) ? L.r[0] : L.r ?? 50, ry = Array.isArray(L.r) ? L.r[1] : L.r ?? 50;
      const k = 1 - clamp(L.flat ?? 0, 0, 0.98);
      // n ≈ (k·dx, −k·dy, −√(1 − dx² − dy²)), dx, dy ∈ [−1, 1]; компилятор нормирует
      const zs = [];
      for (let i = 0; i <= 10; i++) { const t = i / 10; zs.push([t, [0, 0, -Math.max(Math.sqrt(Math.max(0, 1 - t * t)), 1 - k)]]); }
      out.push({ kind: 'linear', from: [cx - rx, cy], to: [cx + rx, cy], ch: 'x', stops: [[0, [-k, 0, 0]], [1, [k, 0, 0]]] });
      out.push({ kind: 'linear', from: [cx, cy - ry], to: [cx, cy + ry], ch: 'y', stops: [[0, [0, k, 0]], [1, [0, -k, 0]]] });
      out.push({ kind: 'radial', c: [cx, cy], r: [rx, ry], ch: 'z', stops: zs });
      continue;
    }
    if (!Array.isArray(L.stops) || !L.stops.length) continue;
    out.push({ ...L, kind: L.kind === 'radial' ? 'radial' : 'linear', ch: L.ch || 'xyz' });
  }
  return out;
}
/** Краски слоёв градиента нормали в проходе normal: url(#…) на слой (первый — обычный, остальные — lighten). */
// слои с ключами общих определений: по объекту градиента (у статичного узла — один и тот же), без JSON на каждый кадр
const keyedLayers = memoByObject((ng) => normalGradLayers(ng).map((L) => ({ L, key: `ng|${JSON.stringify(L)}` })));
function normalGradPaints(ctx, ng) {
  return keyedLayers(ng).map(({ L, key }) => {
    const keep = [L.ch.includes('x'), L.ch.includes('y'), L.ch.includes('z')];
    if (ctx.patterns.has(key)) return ctx.reuse(key);
    const stops = L.stops.map(([t, n]) => {
      const nn = keep[0] && keep[1] && keep[2] ? v3.norm(n) : n;
      const c = [0, 1, 2].map((i) => (keep[i] ? hex2((clamp(nn[i], -1, 1) * 0.5 + 0.5) * 255) : '00'));
      return { tag: 'stop', attrs: { offset: fmt(clamp(t)), 'stop-color': '#' + c.join('') } };
    });
    const id = `${ctx.prefix}-ng${hashStr(key)}`;
    if (L.kind === 'radial') {
      const [cx, cy] = L.c || [0, 0], rx = Array.isArray(L.r) ? L.r[0] : L.r ?? 50, ry = Array.isArray(L.r) ? L.r[1] : rx;
      const gt = Math.abs(rx - ry) > 1e-6 ? `translate(${fmt(cx)} ${fmt(cy)}) scale(1 ${fmt(ry / (rx || 1))}) translate(${fmt(-cx)} ${fmt(-cy)})` : null;
      return ctx.share(key, { tag: 'radialGradient', attrs: { id, gradientUnits: 'userSpaceOnUse', cx: fmt(cx), cy: fmt(cy), r: fmt(rx), fx: fmt(cx), fy: fmt(cy), gradientTransform: gt }, children: stops });
    }
    const [x1, y1] = L.from || [0, 0], [x2, y2] = L.to || [1, 0];
    return ctx.share(key, { tag: 'linearGradient', attrs: { id, gradientUnits: 'userSpaceOnUse', x1: fmt(x1), y1: fmt(y1), x2: fmt(x2), y2: fmt(y2) }, children: stops });
  });
}
/**
 * Матрица цвета для карты нормалей картинки: карта в соглашении 2D-движков (x вправо, y вверх, z к зрителю)
 * → мировые нормали прохода normal (x вправо, y вверх, z от камеры) с поворотом и отражением узла
 * (lin — линейная часть мировой матрицы [a, b, c, d]). Кодирование аффинное: c' = A(c − ½) + ½.
 */
function normalMapMatrix(lin = [1, 0, 0, 1], { yUp = true } = {}) {
  const [a, b, c, d] = lin;
  // нормали преобразуются обратной транспонированной матрицей, нормируем на √|det|
  const det = a * d - b * c || 1e-9, s = Math.sqrt(Math.abs(det));
  const N = [(d / det) * s, (-c / det) * s, (-b / det) * s, (a / det) * s]; // [N00 N01; N10 N11], экранные оси (y вниз)
  const sy = yUp ? -1 : 1; // экранная y карты = −ty при yUp
  const A = [[N[0], N[1] * sy, 0], [-N[2], -N[3] * sy, 0], [0, 0, -1]];
  const rows = A.map((r) => `${fmt(r[0])} ${fmt(r[1])} ${fmt(r[2])} 0 ${fmt(0.5 * (1 - r[0] - r[1] - r[2]))}`);
  return `${rows.join(' ')} 0 0 0 1 0`;
}
/** Фильтр «матрица цвета, альфа порогом» — карты картинок в проходах данных. */
function matrixFilter(ctx, values, region) {
  const key = `cm|${values}|${region.join(',')}`;
  if (ctx.patterns.has(key)) return ctx.reuse(key);
  const id = `${ctx.prefix}-cm${hashStr(key)}`;
  return ctx.share(key, { tag: 'filter', attrs: { id, filterUnits: 'userSpaceOnUse', x: fmt(region[0]), y: fmt(region[1]), width: fmt(region[2]), height: fmt(region[3]), 'color-interpolation-filters': 'sRGB' },
    children: [{ tag: 'feColorMatrix', attrs: { in: 'SourceGraphic', type: 'matrix', values } }, { tag: 'feComponentTransfer', attrs: {}, children: [{ tag: 'feFuncA', attrs: { type: 'discrete', tableValues: '0 1' } }] }] });
}
/** Линейная часть мировой матрицы после трансформации узла (поворот, наклон, масштаб). */
function linOf(parent, rot, skx, sx, sy) {
  if (!rot && !skx && sx === 1 && sy === 1) return parent;
  const m = mat.compose({ rotation: rot || 0, skewX: skx || 0, scaleX: sx, scaleY: sy });
  const [a, b, c, d] = parent;
  return [a * m[0] + c * m[1], b * m[0] + d * m[1], a * m[2] + c * m[3], b * m[2] + d * m[3]];
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
    case 'normal': return (s.base || s.bump) && half && !s.geo && (s.normal || s.normalGrad) ? encodeNormal(s.normal || [0, 0, -1]) : null;
    case 'plane': return s.base && s.plane ? encodeNormal(v3.norm(s.plane)) : null;
    case 'planeD': return (s.base || (s.bump && half)) && s.plane ? encodePlaneD(s.plane[3], s.spec ?? 0.1) : null;
    case 'emissive': return s.geo ? null : s.emissive && s.emissive !== 'none' ? s.emissive : s.base || opaque ? '#000000' : null;
    case 'ink': return s.base && !s.geo ? '#ffffff' : null;
    case 'cover': return s.sky || s.geo ? null : s.base || half ? '#ffffff' : null;
    case 'matId': return s.base || (s.bump && half) ? encodeMatId(s.mat ? ctx.matIdx.get(s.mat) || 0 : 0) : null;
    default: return s.geo ? null : isMaskTag(s, ctx.maskTag) ? '#ffffff' : s.base || opaque ? '#000000' : null;
  }
}
/* ---------- камера 2.5D ---------- */
const CAMERA3D_DEFAULT = { hor: 280, f: 1500, camH: 4.2, dz: 2.5 };
/**
 * Модель камеры camera3d — одна на всё (сборка мира, отложенный свет, источники света, экспорт).
 * Без yaw/pitch: P([X,Y,Z]) = [cx + f·X/(Z+dz), hor + f·(camH − Y)/(Z+dz)] (одна точка схода).
 * yaw — поворот вправо (°, две точки схода), pitch — наклон вверх (°); keepVerticals — наклон сдвигом кадра,
 * как у сдвигового объектива: вертикали остаются вертикальными, горизонт смещается на f·tan(pitch).
 */
function cameraModel(cam = {}, W = 1920) {
  const c = { ...CAMERA3D_DEFAULT, cx: W / 2, ...cam };
  const { f, cx, camH, dz } = c;
  const yaw = (c.yaw || 0) * DEG, pitch = (c.pitch || 0) * DEG, kv = !!c.keepVerticals;
  const th = kv ? 0 : pitch;
  const cY = Math.cos(yaw), sY = Math.sin(yaw), cT = Math.cos(th), sT = Math.sin(th);
  const r = [cY, 0, -sY], u = [-sY * sT, cT, -cY * sT], w = [sY * cT, sT, cY * cT];
  const hor = c.hor + (kv && pitch ? f * Math.tan(pitch) : 0);
  const pos = [0, camH, -dz];
  const plain = !yaw && !th;
  const P = plain
    ? ([X, Y, Z]) => [cx + (f * X) / (Z + dz), hor + (f * (camH - Y)) / (Z + dz)]
    : (p) => {
      const a = p[0] - pos[0], b = p[1] - pos[1], e = p[2] - pos[2];
      const zc = a * w[0] + b * w[1] + e * w[2];
      return [cx + (f * (a * r[0] + e * r[2])) / zc, hor - (f * (a * u[0] + b * u[1] + e * u[2])) / zc];
    };
  return {
    ...c, horEff: hor, pos, right: r, up: u, fwd: w, plain, P,
    /**
     * Проекция для горячих циклов: (X, Y, Z, out) → out = [x, y, глубина] в кадре шириной W·k, без выделения памяти.
     */
    projector: (k = 1) => {
      const fk = f * k, hk = hor * k, ck = cx * k;
      return plain
        ? (X, Y, Z, out) => { const zc = Z + dz; out[0] = ck + (fk * X) / zc; out[1] = hk + (fk * (camH - Y)) / zc; out[2] = zc; return out; }
        : (X, Y, Z, out) => {
          const a = X - pos[0], b = Y - pos[1], e = Z - pos[2], zc = a * w[0] + b * w[1] + e * w[2];
          out[0] = ck + (fk * (a * r[0] + e * r[2])) / zc; out[1] = hk - (fk * (a * u[0] + b * u[1] + e * u[2])) / zc; out[2] = zc; return out;
        };
    },
    /** Глубина точки вдоль оси камеры. */
    depth: plain ? (p) => p[2] + dz : (p) => (p[0] - pos[0]) * w[0] + (p[1] - pos[1]) * w[1] + (p[2] - pos[2]) * w[2],
    /** Луч камеры через пиксель (x, y): точка = pos + t·dir (без поворота dir.z = 1). */
    ray: plain
      ? (x, y) => [(x - cx) / f, -(y - hor) / f, 1]
      : (x, y) => { const a = (x - cx) / f, b = -(y - hor) / f; return [a * r[0] + b * u[0] + w[0], a * r[1] + b * u[1] + w[1], a * r[2] + b * u[2] + w[2]]; },
  };
}
/** Фильтр «залить цветом по альфе» — для картинок в проходах. */
function floodFilter(ctx, color, region) {
  const key = `fl|${color}|${region.join(',')}`;
  if (ctx.patterns.has(key)) return ctx.reuse(key);
  const id = `${ctx.prefix}-fl${hashStr(key)}`;
  return ctx.share(key, { tag: 'filter', attrs: { id, filterUnits: 'userSpaceOnUse', x: fmt(region[0]), y: fmt(region[1]), width: fmt(region[2]), height: fmt(region[3]), 'color-interpolation-filters': 'sRGB' },
    children: [{ tag: 'feFlood', attrs: { 'flood-color': color, result: 'c' } }, { tag: 'feComposite', attrs: { in: 'c', in2: 'SourceAlpha', operator: 'in' } }] });
}

/* ---- core/paint.js ---- */
/** Краски, обрезка обводки, растровые слои, дизеринг. */



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
const DITHER_PATTERNS = {
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

/* ---- core/ctx.js ---- */
/** Контекст одного вычисления кадра. */


class Ctx {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.c = index(scene);
    this.defs = [];
    this.prefix = opts.idPrefix || 'k';
    this.depth = 0;
    this.inRepeat = new Set();
    this.symStack = []; // имена символов, вычисляемых сейчас (вложенные экземпляры)
    this.patterns = new Map();
    this.mode = opts.mode || 'color';
    if (this.mode !== 'color' && this.mode !== 'height' && !isPassMode(this.mode)) throw new Error(`Неизвестный режим рендера: ${this.mode} (есть color, height, ${PASS_MODES.join(', ')}, mask:<метка>)`);
    // проходы отложенного света: данные о поверхности вместо цвета (см. dataPaint)
    this.data = isPassMode(this.mode);
    this.maskTag = this.mode.startsWith('mask:') ? this.mode.slice(5) : null;
    this.matIdx = this.mode === 'matId' ? materialIndex(scene) : null;
    this.surfCur = null; this.opCur = 1; this.scaleCur = 1; this.linCur = [1, 0, 0, 1];
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

/* ---- core/rig.js ---- */
/** Мировые матрицы, двухзвенный IK, источники света. */





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
function nodeWorldMatrix(scene, id, t = 0, opts = {}) {
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
function collectLights(scene, t = 0, opts = {}) {
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
    const p3 = P('p3'), c3 = scene.camera3d, cm = c3 && cameraModel({ dz: 0, ...c3 }, scene.width);
    if (Array.isArray(p3) && p3.length >= 3) {
      // 3D-источник: radius — в единицах мира; для 2D-превью и экспорта — проекция камерой
      l.p3 = p3.slice(0, 3); l.radius3 = P('radius'); l.group = P('group') || 'lamp';
      const sh = P('shadows'); if (sh != null) l.shadows = !!sh;
      if (c3) {
        const zz = Math.max(0.05, cm.depth(p3));
        if (cm.plain) { l.x = cm.cx + (cm.f * p3[0]) / zz; l.y = cm.horEff + (cm.f * (cm.camH - p3[1])) / zz; }
        else [l.x, l.y] = cm.P(p3);
        l.radius = l.radius3 * (cm.f / zz); l.z = Math.max(20, l.radius * 0.25);
      }
    }
    out.push(l);
  }
  return out;
}

/* ---- core/evaluate.js ---- */
/** Вычисление сцены → дерево отображения {tag, attrs, children}. */










/**
 * Значения свойств кадра, общие для всех проходов: propValue не зависит от режима (только от времени, состояний и IK),
 * поэтому анимированные значения узла (дорожки, модификаторы) считаются один раз на кадр, а не в каждом из девяти
 * проходов. Память — на индексе сцены (сбрасывается с ним), ключ — момент и состояния.
 */
function frameMemo(ctx, t, opts) {
  const key = `${t}|${opts.states ? JSON.stringify(opts.states) : ''}`;
  let f = ctx.c.frame;
  if (!f || f.key !== key) ctx.c.frame = f = { key, nodes: new Map() };
  return f.nodes;
}
function frameVals(fm, node, T, copy) {
  let e = fm.get(node);
  if (!e || e.T !== T || e.copy !== copy) fm.set(node, (e = { T, copy, v: new Map() }));
  return e.v;
}

function evalNode(node, t, ctx, key, copy, extraScale = 1) {
  const p = node.props || {};
  // временное окно и локальное время
  if (p.inPoint != null && t < p.inPoint) return null;
  if (p.outPoint != null && t >= p.outPoint) return null;
  const lt = (t - (p.timeOffset ?? 0)) * (p.timeScale ?? 1);
  const rep = p.repeat;
  if (rep && rep.count > 1 && !ctx.inRepeat.has(node)) {
    const out = { tag: 'g', attrs: { 'data-node': ctx.symStack.length ? null : node.id }, children: [] };
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
  const mm = ctx.fm && (node.mods || node.keys) ? frameVals(ctx.fm, node, T, copy) : null;
  const Pt = mm ? (n) => { let v = mm.get(n); if (v === undefined && !mm.has(n)) { v = propValue(node, n, T, ctx, copy); mm.set(n, v); } return v; } : (n) => propValue(node, n, T, ctx, copy);
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
  const g = { tag: 'g', attrs: { 'data-node': ctx.symStack.length ? null : node.id, transform: tf.trim() || null, opacity: opacity < 1 ? fmt(clamp(opacity)) : null }, children: [] };

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
  // surface.geo — узел только геометрии (плоскость для восстановления позиции): в цвете не рисуется
  if (!D && !skipOwn && node.type !== 'group' && Pt('surface')?.geo) skipOwn = true;
  if (skipOwn) {
    // предок выбранных узлов: только трансформация
  } else if (node.type === 'image') {
    const el = imageElement(node, Pt, T, ctx, nkey);
    const w = Pt('width'), h = Pt('height');
    // фильтр высоты — на обёртке: у кадра спрайт-листа (вложенный <svg>) фильтр иначе видит весь лист
    if (H) g.children.push({ tag: 'g', attrs: { filter: heightFilter(ctx, rel, true, [-w / 2, -h / 2, w, h]) }, children: [el] });
    else if (D) {
      // картинка с поверхностью — «тело» (персонаж, спрайт): заливка цветом прохода по альфе;
      // карты normalSrc / emissiveSrc / specSrc заменяют заливку в своих проходах
      const s2 = surf ? { ...surf, base: surf.base || !surf.bump } : null;
      const col = dataPaint(ctx, s2, opAcc);
      const region = [-w / 2, -h / 2, w, h];
      const alt = (prop) => imageElement(node, (n) => (n === 'src' ? Pt(prop) : Pt(n)), T, ctx, nkey);
      const nSrc = Pt('normalSrc'), eSrc = Pt('emissiveSrc'), spSrc = Pt('specSrc');
      if (col && ctx.mode === 'normal' && nSrc) {
        const lin = linOf(ctx.linCur, rot, skx, sx, sy);
        g.children.push({ tag: 'g', attrs: { filter: matrixFilter(ctx, normalMapMatrix(lin, { yUp: Pt('normalYUp') !== false }), region) }, children: [alt('normalSrc')] });
      } else if (ctx.mode === 'emissive' && eSrc && s2) {
        if (col) g.children.push({ tag: 'g', attrs: { filter: floodFilter(ctx, col, region) }, children: [el] });
        g.children.push(alt('emissiveSrc'));
      } else if (col && ctx.mode === 'planeD' && spSrc && s2?.plane) {
        const q = clamp(Math.round((s2.plane[3] + 200) * 100), 0, 65535);
        const vals = `0 0 0 0 ${fmt((q >> 8) / 255)} 0 0 0 0 ${fmt((q & 255) / 255)} 0.2126 0.7152 0.0722 0 0 0 0 0 1 0`;
        g.children.push({ tag: 'g', attrs: { filter: matrixFilter(ctx, vals, region) }, children: [alt('specSrc')] });
      } else if (col) g.children.push({ tag: 'g', attrs: { filter: floodFilter(ctx, col, region) }, children: [el] });
    }
    else g.children.push(el);
  } else if (node.type === 'instance') {
    evalInstance(node, Pt, T, ctx, key, copy, g);
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
      // текст по кривой: путь — в <defs>, начало — pathOffset (0..1) плюс выравнивание
      const tp = textPathOf(node, Pt, T, ctx, nkey);
      const startOffset = tp ? fmt(100 * ((Pt('pathOffset') ?? 0) + (anchor === 'middle' ? 0.5 : anchor === 'end' ? 1 : 0))) + '%' : null;
      g.children.push({
        tag: 'text',
        attrs: {
          x: tp ? null : 0, y: tp ? null : 0, 'text-anchor': anchor, 'dominant-baseline': 'central',
          'font-size': fmt(Pt('fontSize')), 'font-family': Pt('fontFamily'), 'font-weight': Pt('fontWeight'),
          'letter-spacing': fmt(Pt('letterSpacing')), fill, stroke, 'stroke-width': stroke !== 'none' ? fmt(sw) : null,
          'fill-opacity': single && fill !== 'none' ? fmt(clamp(opacity)) : null, 'stroke-opacity': single && stroke !== 'none' ? fmt(clamp(opacity)) : null,
          filter: H ? heightFilter(ctx, rel, false) : null,
        },
        ...(tp ? { children: [{ tag: 'textPath', attrs: { href: '#' + tp, startOffset }, text: shown }] } : { text: shown }),
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
      } else if (D && ctx.mode === 'normal' && surf?.normalGrad && attrs.fill !== 'none') {
        // градиент нормали: слои одной формы, второй и далее — lighten (лишние каналы канальных слоёв — 0)
        const paints = normalGradPaints(ctx, surf.normalGrad);
        if (!paints.length) g.children.push({ tag: 'path', attrs });
        paints.forEach((pt, i) => g.children.push({ tag: 'path', attrs: { ...attrs, fill: pt, stroke: i ? 'none' : attrs.stroke, style: i ? 'mix-blend-mode:lighten' : null } }));
      } else if (!D || attrs.fill !== 'none' || attrs.stroke !== 'none') g.children.push({ tag: 'path', attrs });
    }
  }

  // дети (рельеф, поверхность и прозрачность в проходах наследуются)
  const prevRel = ctx.reliefCur, prevSurf = ctx.surfCur, prevOp = ctx.opCur, prevScale = ctx.scaleCur, prevLin = ctx.linCur;
  if (rel) ctx.reliefCur = rel;
  if (D) { ctx.surfCur = surf; ctx.opCur = opAcc; ctx.linCur = linOf(ctx.linCur, rot, skx, sx, sy); }
  ctx.scaleCur = scaleHere;
  for (const ch of kids) {
    if (ctx.c.clipRefs.has(ch.id)) continue;
    const e = evalWithClip(ch, T, ctx, key, copy);
    if (e) g.children.push(e);
  }
  ctx.reliefCur = prevRel; ctx.surfCur = prevSurf; ctx.opCur = prevOp; ctx.scaleCur = prevScale; ctx.linCur = prevLin;
  if (D && !g.children.length) return null;
  return g;
}

/**
 * Путь для текста по кривой (свойство path) → id определения <path> в <defs> или null.
 * path: строка d, фигура ({shape…}, {points…}) или id узла (его геометрия со сдвигом x/y) — в координатах
 * родителя текста; собственные x/y/поворот текста к пути тоже применяются (обычно у такого текста x = y = 0).
 */
function textPathOf(node, Pt, T, ctx, nkey) {
  const v = Pt('path');
  if (v == null || v === '') return null;
  let geom;
  const ref = typeof v === 'string' && ctx.c.byId.get(v);
  if (ref && ref !== node) {
    geom = nodeGeom(ref, T, ctx, 0);
    const dx = propValue(ref, 'x', T, ctx), dy = propValue(ref, 'y', T, ctx);
    if (dx || dy) geom = translateGeom(geom, dx, dy);
  } else geom = toGeom(v, T);
  if (!geom.length) return null;
  const id = ctx.id(nkey, 'tp');
  ctx.addDef({ tag: 'path', attrs: { id, d: geomToPath(geom) } });
  return id;
}

/**
 * Сцена-оболочка символа: его узлы со своим индексом и кэшами. Хранится в кэше текущей сцены — любая правка
 * сцены (и символов в ней) сбрасывает и её.
 */
function symbolScene(scene, c, name) {
  const sym = scene.symbols?.[name];
  if (!sym || !Array.isArray(sym.nodes)) return null;
  if (!c.symScenes) c.symScenes = new Map();
  let e = c.symScenes.get(name);
  if (!e || e.sym !== sym || e.nodes !== sym.nodes) {
    e = { sym, nodes: sym.nodes, scene: { ...scene, nodes: sym.nodes, duration: sym.duration ?? scene.duration, states: undefined, clips: undefined } };
    c.symScenes.set(name, e);
  }
  return e.scene;
}
/** Время символа для экземпляра: явное symbolTime или локальное время узла; по длительности символа — по кругу или с остановкой. */
function instanceTime(sym, T, Pt) {
  let st = Pt('symbolTime');
  if (st == null) st = T;
  const dur = sym.duration;
  if (dur > 0) st = Pt('loop') === false ? clamp(st, 0, dur) : ((st % dur) + dur) % dur;
  return st;
}
const SYMBOL_DEPTH = 8;
/**
 * Экземпляр символа: узлы символа вычисляются как дети узла instance во времени символа. Состояния, выбор
 * подмножества (only) и IK основной сцены внутрь не проходят; IK внутри символа решается по его узлам.
 * data-node у внутренних элементов нет — в редакторе выбирается сам экземпляр.
 */
function evalInstance(node, Pt, T, ctx, key, copy, g) {
  const name = Pt('symbol');
  const ss = name != null && symbolScene(ctx.scene, ctx.c, name);
  if (!ss || ctx.symStack.includes(name) || ctx.symStack.length >= SYMBOL_DEPTH) return;
  const st = instanceTime(ss, T, Pt);
  const saved = [ctx.scene, ctx.c, ctx.over, ctx.allowed, ctx.ikRot];
  ctx.scene = ss; ctx.c = index(ss); ctx.over = null; ctx.allowed = null; ctx.ikRot = null;
  ctx.symStack.push(name);
  try {
    if (ctx.c.ik.length) solveIK(ctx, st);
    const k2 = `${key}~${node.id}`;
    for (const ch of ctx.c.children.get(null) || []) {
      if (ctx.c.clipRefs.has(ch.id)) continue;
      const e = evalWithClip(ch, st, ctx, k2, copy);
      if (e) g.children.push(e);
    }
  } finally {
    ctx.symStack.pop();
    [ctx.scene, ctx.c, ctx.over, ctx.allowed, ctx.ikRot] = saved;
  }
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
  if (s && n.mods) s = n.mods.every(modIsStatic);
  const live = (v) => v && typeof v === 'object' && v.shape === 'blob' && (v.speed ?? 0.5) !== 0;
  if (s && typeAnimated(n)) s = false; // клякса с движением, спрайт-лист, свет (реестр типов)
  if (s && (live(p.d) || live(p.shape))) s = false;
  if (s) for (const k of ['clip', 'mask']) if (p[k] && c.byId.has(p[k]) && !staticTree(c, c.byId.get(p[k]))) s = false;
  if (s && n.type === 'text' && typeof p.path === 'string' && c.byId.has(p.path) && !staticTree(c, c.byId.get(p.path))) s = false;
  if (s) for (const ch of c.children.get(n.id) || []) if (!staticTree(c, ch)) { s = false; break; }
  memo.set(n.id, s);
  return s;
}

const sameLin = (a, b) => a === b || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]);
function evalWithClip(node, t, ctx, key, copy) {
  const mi = modeInfo(ctx.mode);
  if (ctx.cache && !ctx.recording && !ctx.allowed && (mi.cache || mi.data) && !ctx.inClip && copy === 0 && staticTree(ctx.c, node)) {
    const ck = `${node.id}|${key}|${ctx.prefix}|${ctx.mode}`;
    const hit = ctx.c.evalCache.get(ck);
    // вид кэшируется вместе с накопленным масштабом предков (от него зависит отсев «тонких» фигур), а в проходах
    // данных — ещё с унаследованной поверхностью (мемо resolveSurface: тот же объект у статичных предков),
    // накопленной непрозрачностью и линейной частью матрицы (нормали картинок)
    if (hit && hit.scale === ctx.scaleCur && (!mi.data || (hit.surf === ctx.surfCur && hit.op === ctx.opCur && sameLin(hit.lin, ctx.linCur)))) { for (const d of hit.defs) ctx.addDef(d); return hit.el; }
    const defs = [];
    ctx.recording = true; ctx.recorders.push(defs);
    let el;
    try { el = evalWithClipRaw(node, t, ctx, key, copy); }
    finally { ctx.recorders.pop(); ctx.recording = false; }
    ctx.c.evalCache.set(ck, { el, defs, scale: ctx.scaleCur, surf: ctx.surfCur, op: ctx.opCur, lin: ctx.linCur });
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
  else if (n.tag === 'path' || n.tag === 'text') out.push({ ...n, attrs: { ...n.attrs, transform: t2 || null, 'clip-rule': n.attrs?.['fill-rule'] || null } });
  return out;
}

/** Вычислить сцену в момент t. Возвращает дерево отображения {tag, attrs, children}. */
function evaluate(scene, t, opts = {}) {
  const ctx = new Ctx(scene, opts);
  if (ctx.c.ik.length) solveIK(ctx, t);
  ctx.fm = frameMemo(ctx, t, opts);
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
  const crisp = opts.crisp ?? !!modeInfo(ctx.mode).crisp;
  return {
    tag: 'svg',
    attrs: { xmlns: 'http://www.w3.org/2000/svg', 'xmlns:xlink': 'http://www.w3.org/1999/xlink', viewBox: vb.map(fmt).join(' '), width: ow, height: opts.height ?? Math.round((ow * vb[3]) / vb[2]),
      'shape-rendering': crisp ? 'crispEdges' : null, 'image-rendering': crisp ? 'optimizeSpeed' : null, 'text-rendering': crisp ? 'optimizeSpeed' : null },
    children: [{ tag: 'defs', attrs: {}, children: ctx.defs }, ...bg, ...body],
  };
}

/* ---- core/pixel.js ---- */
/** Пиксельный режим: палитра. */

/** Привести RGBA-пиксели к ближайшим цветам палитры (на месте). palette — массив цветов CSS. */
function quantizeRGBA(data, palette) {
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
function pixelOf(scene) {
  const p = scene.pixel;
  if (!p || p.enabled === false || !(p.size >= 1)) return null;
  return { size: p.size, palette: p.palette || null, aa: !!p.aa };
}

/* ---- core/ir.js ---- */
/**
 * Промежуточное представление кадра: плоский список отображения из дерева evaluate.
 * Дерево {tag, attrs, children} остаётся общим источником для бэкендов (SVG-строка — treeToString, DOM —
 * DOMRenderer, Canvas — CanvasRenderer); resolve() даёт тот же кадр как список фигур с итоговыми матрицами,
 * прозрачностью и ссылками — для границ слоёв, проверок статичности и внешних бэкендов.
 */



/** Матрица [a, b, c, d, e, f] (как в SVG/Canvas). */
const IDENTITY = Object.freeze(mat.id());
const matMul = mat.mul;
const RAD = DEG;
const tfCache = new BoundedCache(20000);
/** Разбор атрибута transform (translate, rotate(a [cx cy]), scale, skewX, skewY, matrix) в матрицу. */
function parseTransform(s) {
  if (!s) return IDENTITY;
  let m = tfCache.get(s);
  if (m) return m;
  m = IDENTITY;
  const re = /(matrix|translate|rotate|scale|skewX|skewY)\s*\(([^)]*)\)/g;
  let x;
  while ((x = re.exec(s))) {
    const a = x[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n;
    switch (x[1]) {
      case 'matrix': n = a.length === 6 ? a : IDENTITY; break;
      case 'translate': n = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; break;
      case 'scale': n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const r = (a[0] || 0) * RAD, c = Math.cos(r), sn = Math.sin(r);
        n = [c, sn, -sn, c, 0, 0];
        if (a.length >= 3) n = matMul(matMul([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      }
      case 'skewX': n = [1, 0, Math.tan((a[0] || 0) * RAD), 1, 0, 0]; break;
      case 'skewY': n = [1, Math.tan((a[0] || 0) * RAD), 0, 1, 0, 0]; break;
    }
    m = matMul(m, n);
  }
  tfCache.set(s, m);
  return m;
}
/** id из url(#id) или null. */
const urlRef = (v) => { const m = /^url\(#([^)]+)\)$/.exec(String(v || '')); return m ? m[1] : null; };
/** Определения кадра (defs) по id. */
function defsOf(tree) {
  const out = new Map();
  const walk = (n) => { if (n.attrs?.id) out.set(n.attrs.id, n); for (const c of n.children || []) walk(c); };
  for (const c of tree.children || []) if (c.tag === 'defs') walk(c);
  return out;
}
const DRAWABLE = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image']);

/**
 * Плоский список отображения кадра: [{ id, tag, attrs, matrix, opacity, clip[], mask[], filter[], blend }] в порядке
 * рисования. id — ближайший узел сцены (data-node), clip/mask/filter — стеки id определений от предков.
 * opts — как у evaluate; tree — уже вычисленное дерево (не пересчитывать).
 */
function resolve(scene, t, opts = {}, tree = null) {
  tree = tree || evaluate(scene, t, opts);
  const items = [];
  const vb = String(tree.attrs.viewBox || `0 0 ${scene.width} ${scene.height}`).split(/\s+/).map(Number);
  const walk = (n, st) => {
    if (n.tag === 'defs' || n.tag === 'clipPath' || n.tag === 'mask' || n.tag === 'pattern' || n.tag === 'filter') return;
    const a = n.attrs || {};
    let m = st.m, op = st.op, id = st.id, clip = st.clip, mask = st.mask, filter = st.filter, blend = st.blend;
    if (a.transform) m = matMul(m, parseTransform(a.transform));
    if (n.tag === 'svg' && n !== tree && a.viewBox) {
      const [vx, vy, vw, vh] = String(a.viewBox).split(/\s+/).map(Number);
      m = matMul(m, [(+a.width || vw) / vw, 0, 0, (+a.height || vh) / vh, (+a.x || 0) - vx * ((+a.width || vw) / vw), (+a.y || 0) - vy * ((+a.height || vh) / vh)]);
    }
    if (a.opacity != null) op *= +a.opacity;
    if (a['data-node']) id = a['data-node'];
    const cp = urlRef(a['clip-path']); if (cp) clip = [...clip, cp];
    const mk = urlRef(a.mask); if (mk) mask = [...mask, mk];
    const fl = urlRef(a.filter); if (fl) filter = [...filter, fl];
    const bm = /mix-blend-mode:\s*([\w-]+)/.exec(a.style || ''); if (bm) blend = bm[1];
    if (DRAWABLE.has(n.tag)) items.push({ id, tag: n.tag, attrs: a, text: n.text, matrix: m, opacity: op, clip, mask, filter, blend });
    const s2 = { m, op, id, clip, mask, filter, blend };
    for (const c of n.children || []) walk(c, s2);
  };
  for (const c of tree.children || []) walk(c, { m: IDENTITY, op: 1, id: null, clip: [], mask: [], filter: [], blend: null });
  return { width: scene.width, height: scene.height, viewBox: vb, defs: defsOf(tree), items, tree };
}

/* ---- core/svg.js ---- */
/** Сериализация дерева отображения в SVG. */



const NEEDS_ESC = /[&<>"]/;
/** Экранирование для XML. Сначала одна проверка: в путях и числах (почти все атрибуты) экранировать нечего. */
const esc = (s) => { s = String(s); return NEEDS_ESC.test(s) ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : s; };
function treeToString(n) {
  let a = '';
  for (const k in n.attrs) { const v = n.attrs[k]; if (v != null && v !== '') a += ` ${k}="${esc(v)}"`; }
  if (n.text != null) return `<${n.tag}${a}>${esc(n.text)}</${n.tag}>`;
  if (!n.children || !n.children.length) return `<${n.tag}${a}/>`;
  let s = `<${n.tag}${a}>`;
  for (const c of n.children) s += treeToString(c);
  return s + `</${n.tag}>`;
}
/** SVG-строка кадра. */
function renderSVG(scene, t, opts = {}) { return treeToString(evaluate(scene, t, opts)); }

/* ---------- краски цвета фона ---------- */
const PAINTS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color'];
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'text', 'tspan', 'textPath']);
// источники цвета помимо красок: картинки, фильтры (матрицы цвета и arithmetic дают новые цвета), CSS
const OPAQUE = new Set(['image', 'feImage', 'filter', 'style', 'foreignObject', 'use']);
/**
 * Проверка «краска v — цвета фона bg»: none, прозрачная, тот же цвет или url(#id) на определение (градиент, паттерн)
 * из defs, которое само рисует только цветом фона (вместе с его href); неизвестная ссылка — «другой цвет».
 */
function bgPaint(bg, tree) {
  const ref = parseColor(bg);
  if (!ref) return null;
  const defs = defsOf(tree), seen = new Map();
  const same = (v) => {
    if (v === 'none') return true;
    if (v.startsWith('url(')) {
      const def = defs.get(urlRef(v));
      if (!def) return false;
      if (!seen.has(def)) { seen.set(def, false); seen.set(def, allBg(def, null, same) && hrefBg(def)); } // false — защита от циклов
      return seen.get(def);
    }
    const c = parseColor(v);
    return !!c && (c[3] === 0 || (Math.abs(c[0] - ref[0]) < 0.002 && Math.abs(c[1] - ref[1]) < 0.002 && Math.abs(c[2] - ref[2]) < 0.002));
  };
  const hrefBg = (def) => { const h = def.attrs?.href || def.attrs?.['xlink:href']; return !h || same(`url(${h})`); };
  return same;
}
/**
 * Всё поддерево рисует только цветом фона? Нет картинок, фильтров, стилей с краской; отсутствующий fill у фигуры —
 * чёрный (умолчание SVG, fill — унаследованный от предков). Ложное «нет» безопасно, поэтому сомнительное
 * (currentColor, style) считается другим цветом.
 */
function allBg(n, fill, same) {
  if (OPAQUE.has(n.tag)) return false;
  const a = n.attrs || {};
  if (a.style && /fill|stroke|color|blend/.test(a.style)) return false;
  for (const k of PAINTS) { const v = a[k]; if (v != null && v !== '' && !same(String(v))) return false; }
  if (a.fill != null && a.fill !== '') fill = a.fill;
  if (fill == null && SHAPES.has(n.tag) && !same('#000000')) return false;
  if (n.tag === 'stop' && (a['stop-color'] == null || a['stop-color'] === '') && !same('#000000')) return false; // остановка без цвета — чёрная
  for (const c of n.children || []) if (!allBg(c, fill, same)) return false;
  return true;
}
/** Корень кадра: defs и прямоугольник фона (его не трогаем) и тело. */
const isBgRect = (n, bg) => n.tag === 'rect' && n.attrs?.fill === bg && n.attrs.x === 0 && n.attrs.y === 0;

/**
 * Убрать невидимое: всё, что рисует цветом фона bg до первой краски другого цвета, ложится фоном на фон и ничего
 * не меняет (обычное наложение ассоциативно, прозрачность, клипы и маски группы этого не нарушают; группы с фильтром
 * не трогаем). Растеризатор упирается в заливку, поэтому в проходах данных (тысячи чёрных фигур под свечением,
 * маской персонажей) это прямо сокращает растр. Дерево не изменяется (в нём поддеревья из кэша кадра) — изменённые
 * узлы копируются. Возвращает { tree, dropped, solid } — solid: тело пусто, кадр одного цвета.
 */
function dropUnderBg(tree, bg) {
  const same = bgPaint(bg, tree);
  if (!same) return { tree, dropped: 0, solid: false };
  let open = true, dropped = 0;
  const visit = (n, fill) => {
    if (!open) return n;
    if (allBg(n, fill, same)) { dropped++; return null; }
    const a = n.attrs || {};
    if (a.filter || OPAQUE.has(n.tag) || n.text != null || !n.children?.length) { open = false; return n; }
    const f = a.fill != null && a.fill !== '' ? a.fill : fill;
    let changed = false;
    const kids = [];
    for (const c of n.children) { const r = visit(c, f); if (r !== c) changed = true; if (r) kids.push(r); }
    return changed ? { ...n, children: kids } : n;
  };
  const out = [];
  let changed = false, body = 0;
  for (const c of tree.children) {
    if (c.tag === 'defs' || (open && isBgRect(c, bg))) { out.push(c); continue; }
    const r = visit(c, null);
    if (r !== c) changed = true;
    if (r) { out.push(r); body++; }
  }
  return { tree: changed ? { ...tree, children: out } : tree, dropped, solid: body === 0 };
}
/** Кадр заведомо одного цвета bg (каждая краска — цвета фона, нет картинок и фильтров)? */
const isSolid = (tree, bg) => dropUnderBg(tree, bg).solid;

/* ---- core/ops.js ---- */
/** Операции над сценой (MCP-сервер и редактор), клипы, состояния, IK, пиксели. */








/**
 * Свободный id вида base, base2, base3… (auto — base1, base2…: нумерация с 1, детерминированно по сцене).
 * Счётчик хранится в кэше сцены, поэтому тысячи добавлений подряд не пересматривают все id.
 */
function uniqueId(scene, base, { auto = false } = {}) {
  const c = index(scene), ids = c.byId;
  if (auto) {
    let i = c.autoNext.get(base) || 1;
    while (ids.has(`${base}${i}`)) i++;
    c.autoNext.set(base, i + 1);
    return `${base}${i}`;
  }
  let id = base, i = 1;
  while (ids.has(id)) id = `${base}${++i}`;
  return id;
}
const listIds = (scene) => {
  const n = scene.nodes.length;
  return n ? scene.nodes.slice(0, 30).map((x) => x.id).join(', ') + (n > 30 ? ` … (всего ${n})` : '') : '(пусто)';
};
const getNode = (scene, id) => {
  const n = index(scene).byId.get(id);
  if (!n) throw new Error(`Узел «${id}» не найден. Есть: ${listIds(scene)}`);
  return n;
};
/** id поддерева (сам узел и все потомки) по индексу детей. */
function subtreeOf(scene, id) {
  const kids = index(scene).children, out = [];
  const stack = [id];
  while (stack.length) { const x = stack.pop(); out.push(x); const ch = kids.get(x); if (ch) for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i].id); }
  return out;
}
/** Ссылки узла на другие узлы: [{ kind, id, drop() }] — маски, link/followPath, цель IK. */
function nodeRefs(n) {
  const out = [];
  for (const k of ['clip', 'mask']) if (n.props?.[k]) out.push({ kind: k, id: n.props[k], set: (v) => { n.props[k] = v; }, drop: () => { delete n.props[k]; } });
  (n.mods || []).forEach((m) => {
    for (const r of modRefs(m)) {
      const field = m.type === 'link' ? 'source' : 'path';
      out.push({ kind: `мод ${m.type}`, id: r, mod: m, set: (v) => { m[field] = v; }, drop: () => { n.mods = n.mods.filter((x) => x !== m); if (!n.mods.length) delete n.mods; } });
    }
  });
  // путь текста по кривой: строка — id узла или путь d (что из этого, решает тот, кто знает сцену)
  if (n.type === 'text' && typeof n.props?.path === 'string' && /^[A-Za-z_][\w-]*$/.test(n.props.path)) out.push({ kind: 'путь текста', id: n.props.path, set: (v) => { n.props.path = v; }, drop: () => { delete n.props.path; } });
  if (n.props?.ik?.target) out.push({ kind: 'IK', id: n.props.ik.target, set: (v) => { n.props.ik = { ...n.props.ik, target: v }; }, drop: () => { delete n.props.ik; } });
  return out;
}
/** Поля, смена которых меняет структуру (индекс, маски, IK) — тогда нужен полный сброс кэшей. */
const STRUCT_PROPS = ['clip', 'mask', 'ik'];

const ops = {
  addNode(scene, { id, type = 'group', parent = null, props = {}, keys, mods, index: at } = {}) {
    if (!NODE_TYPES.includes(type)) throw new Error(`Неизвестный тип «${type}». Допустимо: ${NODE_TYPES.join(', ')}`);
    if (parent) getNode(scene, parent);
    if (id && index(scene).byId.has(id)) throw new Error(`id «${id}» уже занят`);
    if (!id) id = uniqueId(scene, type, { auto: true });
    const node = { id, type, parent: parent || null, props: { ...props } };
    if (keys) node.keys = normalizeKeys(keys);
    if (mods) node.mods = mods.map(validateMod);
    if (at == null) { scene.nodes.push(node); noteNodeAdded(scene, node); }
    else { scene.nodes.splice(at, 0, node); invalidate(scene); }
    return node;
  },
  updateNode(scene, id, { props, replaceProps = false, unset = [], newId, parent, type } = {}) {
    const n = getNode(scene, id);
    const before = n.props || {};
    let structural = !!type || parent !== undefined || (newId && newId !== id);
    if (props) {
      const next = replaceProps ? { ...props } : { ...before, ...props };
      if (STRUCT_PROPS.some((k) => next[k] !== before[k])) structural = true;
      n.props = next;
    }
    for (const k of unset) { if (STRUCT_PROPS.includes(k) && k in n.props) structural = true; delete n.props[k]; }
    if (type) { if (!NODE_TYPES.includes(type)) throw new Error(`Неизвестный тип ${type}`); n.type = type; }
    if (parent !== undefined) {
      if (parent) { getNode(scene, parent); const by = index(scene).byId; let p = parent; while (p) { if (p === id) throw new Error('Цикл в иерархии'); p = by.get(p)?.parent; } }
      n.parent = parent || null;
    }
    if (newId && newId !== id) {
      if (index(scene).byId.has(newId)) throw new Error(`id «${newId}» уже занят`);
      for (const x of scene.nodes) {
        if (x.parent === id) x.parent = newId;
        for (const r of nodeRefs(x)) if (r.id === id) r.set(newId);
      }
      for (const g of scene.states || []) for (const patch of Object.values(g.values || {})) if (patch[id]) { patch[newId] = patch[id]; delete patch[id]; }
      n.id = newId;
    }
    if (structural) invalidate(scene); else invalidateNode(scene, id);
    return n;
  },
  /**
   * Удалить узел с потомками. Ссылки остальных узлов на удалённые (маски, link, followPath, цель IK, патчи
   * состояний) убираются — иначе сохранённая сцена не прошла бы проверку при загрузке. Возвращает массив id
   * удалённых; в поле cleaned — описания убранных ссылок.
   */
  removeNode(scene, id) {
    getNode(scene, id);
    const kill = new Set(subtreeOf(scene, id));
    scene.nodes = scene.nodes.filter((n) => !kill.has(n.id));
    const cleaned = [];
    for (const n of scene.nodes) for (const r of nodeRefs(n)) if (kill.has(r.id)) { r.drop(); cleaned.push(`${n.id}: ${r.kind} → ${r.id}`); }
    for (const g of scene.states || []) for (const [v, patch] of Object.entries(g.values || {})) for (const k of Object.keys(patch || {})) if (kill.has(k)) { delete patch[k]; cleaned.push(`состояние ${g.name}=${v}: ${k}`); }
    invalidate(scene);
    const res = [...kill];
    res.cleaned = cleaned;
    return res;
  },
  /** Копия узла с потомками; ссылки внутри копии (маски, link, followPath, IK) ведут на копии, а не на оригиналы. */
  duplicateNode(scene, id, newId) {
    const src = getNode(scene, id);
    if (newId && index(scene).byId.has(newId)) throw new Error(`id «${newId}» уже занят`);
    const ids = subtreeOf(scene, id), map = new Map(), by = index(scene).byId;
    const taken = new Set(by.keys());
    for (const old of ids) {
      let nid = old === id && newId ? newId : `${old}_copy`, i = 1;
      if (!(old === id && newId)) while (taken.has(nid)) nid = `${old}_copy${++i}`;
      taken.add(nid); map.set(old, nid);
    }
    const copies = ids.map((old) => {
      const c = JSON.parse(JSON.stringify(by.get(old)));
      c.id = map.get(old);
      c.parent = old === id ? src.parent : map.get(c.parent);
      for (const r of nodeRefs(c)) if (map.has(r.id)) r.set(map.get(r.id));
      return c;
    });
    scene.nodes.push(...copies);
    invalidate(scene);
    return copies[0];
  },
  reorder(scene, id, toIndex) {
    const n = getNode(scene, id);
    scene.nodes = scene.nodes.filter((x) => x !== n);
    scene.nodes.splice(clamp(toIndex, 0, scene.nodes.length), 0, n);
    invalidate(scene);
  },
  setKeys(scene, id, prop, keys) {
    const n = getNode(scene, id);
    invalidateNode(scene, id);
    n.keys = n.keys || {};
    if (!keys || !keys.length) delete n.keys[prop];
    else n.keys[prop] = normalizeKeys({ [prop]: keys })[prop];
    return n.keys[prop];
  },
  addKey(scene, id, prop, key) {
    const n = getNode(scene, id);
    invalidateNode(scene, id);
    n.keys = n.keys || {};
    const arr = (n.keys[prop] = n.keys[prop] || []);
    const k = normalizeKeys({ [prop]: [key] })[prop][0];
    const i = arr.findIndex((x) => Math.abs(x.t - k.t) < 1e-6);
    if (i >= 0) arr[i] = k; else arr.push(k);
    arr.sort((a, b) => a.t - b.t);
    return arr;
  },
  clearKeys(scene, id, prop) {
    const n = getNode(scene, id);
    invalidateNode(scene, id);
    if (!prop) delete n.keys; else if (n.keys) delete n.keys[prop];
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
    const m = validateMod(mod);
    n.mods = n.mods || [];
    n.mods.push(m);
    if (modRefs(m).length) invalidate(scene); else invalidateNode(scene, id);
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

  /* ---------- символы ---------- */
  /** Определить (или заменить) символ: набор узлов со своей шкалой времени. */
  defineSymbol(scene, name, { nodes, duration } = {}) {
    if (!/^[A-Za-z_][\w-]*$/.test(String(name))) throw new Error(`Недопустимое имя символа «${name}»`);
    if (!Array.isArray(nodes)) throw new Error('Символу нужен массив nodes');
    const sym = { nodes: JSON.parse(JSON.stringify(nodes)) };
    if (duration != null) { if (!(duration > 0)) throw new Error('duration символа должен быть > 0'); sym.duration = duration; }
    scene.symbols = { ...(scene.symbols || {}), [name]: sym };
    invalidate(scene);
    return sym;
  },
  /**
   * Символ из поддерева узла: копия поддерева становится символом (корень — без родителя, сдвиг x/y корня
   * переходит на экземпляр). replace — заменить поддерево экземпляром на том же месте (тот же id).
   */
  symbolFromNode(scene, id, name, { replace = true, duration } = {}) {
    const root = getNode(scene, id);
    if (scene.symbols?.[name]) throw new Error(`Символ «${name}» уже есть`);
    const ids = subtreeOf(scene, id), by = index(scene).byId;
    const nodes = ids.map((x) => JSON.parse(JSON.stringify(by.get(x))));
    const r = nodes[0];
    r.parent = null;
    const keep = {};
    // постоянный сдвиг корня — на экземпляр (анимированный остаётся внутри символа)
    for (const k of ['x', 'y']) if (r.props?.[k] != null && !r.keys?.[k]?.length && !(r.mods || []).length) { keep[k] = r.props[k]; delete r.props[k]; }
    const inside = new Set(ids);
    for (const n of nodes) for (const ref of nodeRefs(n)) if (!inside.has(ref.id)) throw new Error(`${n.id}: ${ref.kind} ссылается на «${ref.id}» вне поддерева — символ нельзя выделить`);
    ops.defineSymbol(scene, name, { nodes, duration });
    if (!replace) return { symbol: name, instance: null };
    const at = scene.nodes.indexOf(root);
    const kill = new Set(ids);
    scene.nodes = scene.nodes.filter((n) => !kill.has(n.id));
    const inst = { id, type: 'instance', parent: root.parent ?? null, props: { symbol: name, ...keep } };
    if (root.props?.name) inst.props.name = root.props.name;
    scene.nodes.splice(Math.min(at, scene.nodes.length), 0, inst);
    invalidate(scene);
    return { symbol: name, instance: inst };
  },
  /** Удалить символ. Используемый экземплярами — только с force (экземпляры тоже удаляются). */
  removeSymbol(scene, name, { force = false } = {}) {
    if (!scene.symbols?.[name]) throw new Error(`Символ «${name}» не найден`);
    const users = scene.nodes.filter((n) => n.type === 'instance' && n.props?.symbol === name).map((n) => n.id);
    if (users.length && !force) throw new Error(`Символ «${name}» используют: ${users.join(', ')} (force — удалить и их)`);
    for (const u of users) if (index(scene).byId.has(u)) ops.removeNode(scene, u);
    const { [name]: _, ...rest } = scene.symbols;
    if (Object.keys(rest).length) scene.symbols = rest; else delete scene.symbols;
    invalidate(scene);
    return users;
  },

  /* ---------- маркеры ---------- */
  /** Поставить (или передвинуть) маркер: событие на шкале времени для плеера и экспорта. */
  setMarker(scene, name, t, data) {
    if (!name) throw new Error('Маркеру нужно имя');
    if (!(t >= 0 && t <= scene.duration + 1e-6)) throw new Error(`t маркера должен быть в 0..${scene.duration}`);
    const ms = (scene.markers || []).filter((m) => m.name !== name);
    const m = { t, name };
    if (data !== undefined) m.data = data;
    ms.push(m); ms.sort((a, b) => a.t - b.t);
    scene.markers = ms;
    return m;
  },
  removeMarker(scene, name) {
    const before = scene.markers?.length || 0;
    scene.markers = (scene.markers || []).filter((m) => m.name !== name);
    if (!scene.markers.length) delete scene.markers;
    return before - (scene.markers?.length || 0);
  },
};

/**
 * Маркеры, пройденные при движении времени из t0 в t1 (t0 не включается, t1 — включается). wrap — шкала
 * зациклилась: [t0, end) и [start, t1]. Для плеера (onMarker) и тестов.
 */
function markersCrossed(scene, t0, t1, { start = 0, end = scene.duration, wrap = false } = {}) {
  const ms = scene.markers || [];
  if (!ms.length) return [];
  const inR = (t, a, b) => t > a && t <= b;
  if (!wrap) return ms.filter((m) => inR(m.t, t0, t1));
  return [...ms.filter((m) => inR(m.t, t0, end + 1e-9)), ...ms.filter((m) => m.t >= start && m.t <= t1)];
}

/** Проверка модификатора по реестру: тип, числовые параметры, собственная проверка (expr — разбор кода). */
function validateMod(m) {
  const def = m && MODIFIERS[m.type];
  if (!def) throw new Error(`Неизвестный модификатор «${m?.type}». Допустимо: ${Object.keys(MODIFIERS).join(', ')}`);
  for (const [k, p] of Object.entries(def.params || {})) {
    if (m[k] == null || !p.type) continue;
    const ok = p.type === 'any' || p.type.split('|').some((ty) => (ty === 'array' ? Array.isArray(m[k]) : typeof m[k] === ty));
    if (!ok) throw new Error(`Модификатор ${m.type}: ${k} должен быть ${p.type}, а не ${JSON.stringify(m[k])}`);
    if (p.enum && !p.enum.includes(m[k])) throw new Error(`Модификатор ${m.type}: ${k} — одно из ${p.enum.join(', ')}`);
  }
  def.validate?.(m);
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
function clipRange(scene, name) {
  const c = (scene.clips || []).find((x) => x.name === name);
  if (!c) throw new Error(`Клип «${name}» не найден. Есть: ${(scene.clips || []).map((x) => x.name).join(', ') || '(нет клипов)'}`);
  return { name: c.name, start: c.start, end: c.end, loop: c.loop !== false, fps: c.fps, next: c.next };
}
/** Время внутри клипа: localT от начала клипа, с учётом зацикливания. */
function clipTime(scene, name, localT) {
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
    invalidate(scene);
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

/* ---- core/player.js ---- */
/** Браузерный рендерер и плеер. */




function signature(n) {
  let s = n.tag + '(' + Object.keys(n.attrs).filter((k) => n.attrs[k] != null && n.attrs[k] !== '').join(',');
  if (n.children) for (const c of n.children) s += signature(c);
  return s + ')';
}
function flatten(n, out = []) { out.push(n); if (n.children) for (const c of n.children) flatten(c, out); return out; }

const SVG_NS = 'http://www.w3.org/2000/svg', XLINK_NS = 'http://www.w3.org/1999/xlink';
/** Ключ элемента среди соседей: узел сцены (data-node), id определения, иначе тег и порядковый номер тега. */
function keysOf(children) {
  const seen = new Map();
  return children.map((c) => {
    const a = c.attrs || {};
    const base = a['data-node'] != null ? 'n:' + a['data-node'] : a.id != null ? 'i:' + a.id : c.tag;
    const k = seen.get(base) || 0; seen.set(base, k + 1); // повторы (копии repeat) — по порядку
    return base + ':' + k;
  });
}
const setAttr = (el, k, v) => { if (k === 'xlink:href') el.setAttributeNS(XLINK_NS, k, v); else el.setAttribute(k, v); };
const delAttr = (el, k) => { if (k === 'xlink:href') el.removeAttributeNS(XLINK_NS, 'href'); else el.removeAttribute(k); };
const has = (v) => v != null && v !== '';

/**
 * SVG-рендерер в DOM с сопоставлением по ключам: элементы узлов сцены (data-node) и определений (id) переживают
 * перестановки и добавления, меняются только отличающиеся атрибуты (исчезнувшие — removeAttribute), текст и
 * порядок. Полная перестройка не нужна даже при смене структуры.
 */
class DOMRenderer {
  constructor(container) { this.el = container; this.svg = null; this.prev = null; this.stats = { created: 0, removed: 0, attrs: 0 }; }
  create(v) {
    const el = document.createElementNS(SVG_NS, v.tag);
    for (const k in v.attrs) if (has(v.attrs[k])) setAttr(el, k, v.attrs[k]);
    if (v.text != null) el.textContent = v.text;
    else for (const c of v.children || []) el.appendChild(this.create(c));
    this.stats.created++;
    el.__kv = v;
    return el;
  }
  patch(el, o, v) {
    if (o === v) return; // неизменённое поддерево (кэш статичных узлов движка отдаёт тот же объект)
    const oa = o.attrs || {}, na = v.attrs || {};
    for (const k in na) { const x = na[k]; if (has(x)) { if (oa[k] !== x) { setAttr(el, k, x); this.stats.attrs++; } } else if (has(oa[k])) delAttr(el, k); }
    for (const k in oa) if (!(k in na) && has(oa[k])) delAttr(el, k);
    if (v.text != null || o.text != null) { if (v.text !== o.text) el.textContent = v.text ?? ''; el.__kv = v; return; }
    this.children(el, o.children || [], v.children || []);
    el.__kv = v;
  }
  children(el, olds, news) {
    if (olds === news) return;
    const ok = keysOf(olds), nk = keysOf(news);
    const byKey = new Map();
    const kids = el.childNodes;
    for (let i = 0; i < olds.length; i++) byKey.set(ok[i], { v: olds[i], el: kids[i] });
    const used = new Set();
    let ref = el.firstChild;
    for (let i = 0; i < news.length; i++) {
      const v = news[i], hit = byKey.get(nk[i]);
      let node;
      if (hit && hit.v.tag === v.tag && !used.has(nk[i])) { node = hit.el; used.add(nk[i]); this.patch(node, hit.v, v); }
      else node = this.create(v);
      if (node !== ref) el.insertBefore(node, ref); else ref = ref.nextSibling;
    }
    // лишнее — после последнего нового
    while (ref) { const nx = ref.nextSibling; el.removeChild(ref); this.stats.removed++; ref = nx; }
  }
  render(tree) {
    if (!this.svg || this.svg.parentNode !== this.el) {
      this.el.innerHTML = '';
      this.svg = this.create({ ...tree, attrs: { ...tree.attrs, width: null, height: null } });
      this.svg.style.width = '100%'; this.svg.style.height = '100%'; this.svg.style.display = 'block';
      this.el.appendChild(this.svg);
      this.prev = { ...tree, attrs: { ...tree.attrs, width: null, height: null } };
      return;
    }
    const v = { ...tree, attrs: { ...tree.attrs, width: null, height: null } };
    this.patch(this.svg, this.prev, v);
    this.prev = v;
  }
}

class Player {
  constructor(container, scene, opts = {}) {
    this.renderer = opts.renderer || new DOMRenderer(container);
    this.states = opts.states || {};
    this.scene = scene; this.time = 0; this.playing = false; this.speed = 1; this.listeners = new Set(); this.markerListeners = new Set();
    this.loop = opts.loop ?? scene.loop ?? true;
    this._tick = this._tick.bind(this);
    this.draw();
    if (opts.autoplay !== false) this.play();
  }
  setScene(scene, keepTime = true) { invalidate(this.scene); this.scene = scene; invalidate(scene); if (this.clip) this.clip = clipRange(scene, this.clip.name); if (!keepTime) this.time = this.clip ? this.clip.start : 0; this.time = Math.min(this.time, scene.duration); this.draw(); }
  refresh() { invalidate(this.scene); this.draw(); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  /** Подписка на маркеры сцены: fn(marker, player) при прохождении во время воспроизведения. */
  onMarker(fn) { this.markerListeners.add(fn); return () => this.markerListeners.delete(fn); }
  _fire(list) { for (const m of list) for (const f of this.markerListeners) { try { f(m, this); } catch (e) { console.error(e); } } }
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
    const t0 = this.time;
    this.time += dt * this.speed;
    const r = this.range();
    let crossed;
    if (this.time >= r.end) {
      const len = r.end - r.start || 1;
      if (this.clip ? r.loop !== false : this.loop) { this.time = r.start + ((this.time - r.start) % len); crossed = markersCrossed(this.scene, t0, this.time, { start: r.start, end: r.end, wrap: true }); }
      else if (this.clip && this.clip.next) { crossed = markersCrossed(this.scene, t0, r.end); this.clip = clipRange(this.scene, this.clip.next); this.time = this.clip.start; }
      else { this.time = r.end; this.playing = false; crossed = markersCrossed(this.scene, t0, r.end); }
    } else crossed = markersCrossed(this.scene, t0, this.time);
    if (crossed.length && this.markerListeners.size) this._fire(crossed);
    this.draw();
    if (this.playing) requestAnimationFrame(this._tick);
  }
}

/* ---- core/canvas.js ---- */
/**
 * Canvas2D-бэкенд: рисует дерево отображения кадра на <canvas>. Path2D кэшируются по строке d, градиенты — по
 * определению; прозрачность группы, режимы наложения и фильтры (размытие, тень, свечение) — через слой и
 * ctx.filter / globalCompositeOperation. Чего Canvas не умеет (маски, растровые паттерны, фильтры рельефа) —
 * поддерево рисуется через SVG-картинку (откат); пока она грузится, показывается прошлый кадр этого поддерева.
 * Ограничение отката: картинки по внешним URL внутри такого поддерева не видны (SVG как изображение их не грузит).
 */




const BLEND = new Set(['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);
const det = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
const rgba = (c, k = 1) => { const p = parseColor(String(c)); if (!p) return c; return `rgba(${Math.round(p[0] * 255)},${Math.round(p[1] * 255)},${Math.round(p[2] * 255)},${+(p[3] * k).toFixed(4)})`; };

class CanvasRenderer {
  /**
   * container — элемент, куда положить <canvas> (заполняет его, вписывание как у SVG xMidYMid meet);
   * или opts.context + opts.width/height — рисовать в готовый контекст (тесты, OffscreenCanvas).
   */
  constructor(container, opts = {}) {
    this.el = container;
    this.opts = opts;
    this.paths = new BoundedCache(8000);
    this.images = new Map();
    this.fallbacks = new Map();
    this.lastFallback = new Map();
    this.grads = new WeakMap();
    this.filterCss = new WeakMap();
    this.layers = [];
    this.stats = { items: 0, fallbacks: 0, layers: 0 };
    if (opts.context) { this.ctx = opts.context; this.canvas = opts.context.canvas || { width: opts.width, height: opts.height }; }
    else {
      this.canvas = document.createElement('canvas');
      Object.assign(this.canvas.style, { width: '100%', height: '100%', display: 'block' });
      container.innerHTML = '';
      container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
    }
  }
  /** Path2D по строке d (кэш). */
  path(d) {
    let p = this.paths.get(d);
    if (!p) { p = new Path2D(d); this.paths.set(d, p); }
    return p;
  }
  render(tree, player) {
    this.player = player;
    this.defs = defsOf(tree);
    this.stats = { items: 0, fallbacks: 0, layers: 0 };
    const vb = String(tree.attrs.viewBox || `0 0 ${tree.attrs.width} ${tree.attrs.height}`).split(/\s+/).map(Number);
    const c = this.canvas;
    let W, H, dpr = 1;
    if (this.opts.context) { W = this.opts.width ?? c.width; H = this.opts.height ?? c.height; }
    else {
      dpr = this.opts.pixelRatio ?? (globalThis.devicePixelRatio || 1);
      const r = this.el.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr));
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; this.layers.length = 0; }
    }
    this.W = W; this.H = H;
    const s = Math.min(W / vb[2], H / vb[3]);
    const ox = (W - vb[2] * s) / 2, oy = (H - vb[3] * s) / 2;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.clearRect(0, 0, W, H);
    const crisp = tree.attrs['shape-rendering'] === 'crispEdges';
    ctx.imageSmoothingEnabled = !crisp;
    this.root = tree;
    const m0 = [s, 0, 0, s, ox - vb[0] * s, oy - vb[1] * s];
    for (const ch of tree.children || []) if (ch.tag !== 'defs') this.draw(ctx, ch, m0, 0);
  }
  /** Нужен ли откат на SVG для узла (без детей): маска, неподдержанный фильтр, растровый паттерн, неизвестный тег. */
  unsupported(n) {
    const a = n.attrs || {};
    if (a.mask) return true;
    if (n.tag === 'text' && n.children?.length) return true; // текст по кривой (textPath)
    if (a.filter && this.cssFilter(this.defs.get(urlRef(a.filter)), 1) === null) return true;
    for (const k of ['fill', 'stroke']) { const id = urlRef(a[k]); if (id && this.defs.get(id)?.tag === 'pattern') return true; }
    return !KNOWN.has(n.tag);
  }
  /** Фильтр движка → строка ctx.filter (scale — пикселей на единицу) или null, если такой не переводится. */
  cssFilter(def, scale) {
    if (!def) return null;
    let tpl = this.filterCss.get(def);
    if (tpl === undefined) { tpl = filterTemplate(def); this.filterCss.set(def, tpl); }
    return tpl ? tpl(scale) : null;
  }
  layer(depth) {
    let l = this.layers[depth];
    if (!l || l.canvas.width !== this.W || l.canvas.height !== this.H) {
      const cv = this.opts.createCanvas ? this.opts.createCanvas(this.W, this.H)
        : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(this.W, this.H) : Object.assign(document.createElement('canvas'), { width: this.W, height: this.H });
      l = { canvas: cv, ctx: cv.getContext('2d') };
      this.layers[depth] = l;
    }
    l.ctx.setTransform(1, 0, 0, 1, 0, 0);
    l.ctx.globalAlpha = 1; l.ctx.globalCompositeOperation = 'source-over'; l.ctx.filter = 'none';
    l.ctx.imageSmoothingEnabled = this.ctx.imageSmoothingEnabled;
    l.ctx.clearRect(0, 0, this.W, this.H);
    return l;
  }
  draw(ctx, n, m, depth) {
    const a = n.attrs || {};
    if (a.display === 'none' || a.visibility === 'hidden') return;
    if (this.unsupported(n)) return this.fallback(ctx, n, m);
    let mm = a.transform ? matMul(m, parseTransform(a.transform)) : m;
    if (n.tag === 'g' || n.tag === 'svg') {
      let clipRect = null;
      if (n.tag === 'svg' && a.viewBox) {
        const [vx, vy, vw, vh] = String(a.viewBox).split(/\s+/).map(Number);
        const w = +a.width || vw, h = +a.height || vh, x = +a.x || 0, y = +a.y || 0;
        if (a.overflow !== 'visible') clipRect = [mm, x, y, w, h];
        const k = a.preserveAspectRatio === 'none' ? [w / vw, h / vh] : (() => { const s = Math.min(w / vw, h / vh); return [s, s]; })();
        const dx = a.preserveAspectRatio === 'none' ? 0 : (w - vw * k[0]) / 2, dy = a.preserveAspectRatio === 'none' ? 0 : (h - vh * k[1]) / 2;
        mm = matMul(mm, [k[0], 0, 0, k[1], x + dx - vx * k[0], y + dy - vy * k[1]]);
      }
      const op = a.opacity != null ? +a.opacity : 1;
      if (op <= 0) return;
      const bm = /mix-blend-mode:\s*([\w-]+)/.exec(a.style || '')?.[1];
      const blend = bm && BLEND.has(bm) ? bm : null;
      const filter = a.filter ? this.cssFilter(this.defs.get(urlRef(a.filter)), det(mm)) : null;
      const kids = (n.children || []).filter((c) => c.tag !== 'defs');
      const needLayer = blend || filter || (op < 1 && (kids.length > 1 || kids.some((c) => c.tag === 'g' || c.tag === 'svg')));
      ctx.save();
      if (clipRect) { const [cm, x, y, w, h] = clipRect; ctx.setTransform(cm[0], cm[1], cm[2], cm[3], cm[4], cm[5]); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); }
      if (a['clip-path']) this.clip(ctx, mm, urlRef(a['clip-path']));
      if (needLayer) {
        const L = this.layer(depth + 1);
        this.stats.layers++;
        for (const c of kids) this.draw(L.ctx, c, mm, depth + 1);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha *= op;
        if (blend) ctx.globalCompositeOperation = blend;
        if (filter) ctx.filter = filter;
        ctx.drawImage(L.canvas, 0, 0);
      } else {
        if (op < 1) ctx.globalAlpha *= op;
        for (const c of kids) this.draw(ctx, c, mm, depth);
      }
      ctx.restore();
      return;
    }
    this.stats.items++;
    ctx.save();
    if (a['clip-path']) this.clip(ctx, mm, urlRef(a['clip-path']));
    if (a.opacity != null) ctx.globalAlpha *= +a.opacity;
    const bm = /mix-blend-mode:\s*([\w-]+)/.exec(a.style || '')?.[1];
    if (bm && BLEND.has(bm)) ctx.globalCompositeOperation = bm;
    ctx.setTransform(mm[0], mm[1], mm[2], mm[3], mm[4], mm[5]);
    if (n.tag === 'path') this.shape(ctx, this.path(a.d || ''), a);
    else if (n.tag === 'rect') { const p = new Path2D(); const rx = +a.rx || 0; if (rx && p.roundRect) p.roundRect(+a.x || 0, +a.y || 0, +a.width, +a.height, rx); else p.rect(+a.x || 0, +a.y || 0, +a.width, +a.height); this.shape(ctx, p, a); }
    else if (n.tag === 'circle' || n.tag === 'ellipse') { const p = new Path2D(); const rx = +(a.rx ?? a.r), ry = +(a.ry ?? a.r); p.ellipse(+a.cx || 0, +a.cy || 0, rx, ry, 0, 0, Math.PI * 2); this.shape(ctx, p, a); }
    else if (n.tag === 'line') { const p = new Path2D(); p.moveTo(+a.x1 || 0, +a.y1 || 0); p.lineTo(+a.x2 || 0, +a.y2 || 0); this.shape(ctx, p, { ...a, fill: 'none' }); }
    else if (n.tag === 'text') this.text(ctx, n, a);
    else if (n.tag === 'image') this.image(ctx, a);
    ctx.restore();
  }
  clip(ctx, m, id) {
    const def = this.defs.get(id);
    if (!def) return;
    const p = new Path2D();
    let rule = 'nonzero';
    const add = (n, tm) => {
      const t2 = n.attrs?.transform ? matMul(tm, parseTransform(n.attrs.transform)) : tm;
      if (n.tag === 'path' && n.attrs.d) { p.addPath(this.path(n.attrs.d), toDOM(t2)); if (n.attrs['clip-rule'] === 'evenodd' || n.attrs['fill-rule'] === 'evenodd') rule = 'evenodd'; }
      else if (n.tag === 'rect') { const r = new Path2D(); r.rect(+n.attrs.x || 0, +n.attrs.y || 0, +n.attrs.width, +n.attrs.height); p.addPath(r, toDOM(t2)); }
      for (const c of n.children || []) add(c, t2);
    };
    for (const c of def.children || []) add(c, IDENTITY);
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.clip(p, rule);
  }
  paint(ctx, v, opacity) {
    if (v == null || v === 'none' || v === 'transparent') return null;
    const id = urlRef(v);
    if (!id) return v;
    const def = this.defs.get(id);
    if (!def) return null;
    let per = this.grads.get(def);
    if (!per) { per = new Map(); this.grads.set(def, per); }
    let g = per.get(ctx);
    if (!g) {
      const A = def.attrs;
      if (def.tag === 'linearGradient') g = ctx.createLinearGradient(+A.x1 || 0, +A.y1 || 0, +A.x2 || 0, +A.y2 || 0);
      else if (def.tag === 'radialGradient') g = ctx.createRadialGradient(+(A.fx ?? A.cx) || 0, +(A.fy ?? A.cy) || 0, 0, +A.cx || 0, +A.cy || 0, +A.r || 0);
      else return null;
      for (const st of def.children || []) {
        const off = String(st.attrs.offset ?? 0);
        const o = off.endsWith('%') ? parseFloat(off) / 100 : +off;
        try { g.addColorStop(Math.max(0, Math.min(1, o)), rgba(st.attrs['stop-color'] || '#000', st.attrs['stop-opacity'] != null ? +st.attrs['stop-opacity'] : 1)); } catch {}
      }
      per.set(ctx, g);
    }
    void opacity;
    return g;
  }
  shape(ctx, p, a) {
    const fill = this.paint(ctx, a.fill ?? '#000');
    const base = ctx.globalAlpha;
    if (fill) {
      ctx.fillStyle = fill;
      ctx.globalAlpha = base * (a['fill-opacity'] != null ? +a['fill-opacity'] : 1);
      ctx.fill(p, a['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero');
    }
    const stroke = this.paint(ctx, a.stroke);
    const sw = a['stroke-width'] != null ? +a['stroke-width'] : 1;
    if (stroke && sw > 0) {
      ctx.strokeStyle = stroke;
      ctx.globalAlpha = base * (a['stroke-opacity'] != null ? +a['stroke-opacity'] : 1);
      ctx.lineWidth = sw;
      ctx.lineCap = a['stroke-linecap'] || 'butt';
      ctx.lineJoin = a['stroke-linejoin'] || 'miter';
      ctx.miterLimit = a['stroke-miterlimit'] != null ? +a['stroke-miterlimit'] : 4;
      const dash = a['stroke-dasharray'];
      ctx.setLineDash(dash && dash !== 'none' ? String(dash).split(/[\s,]+/).map(Number) : []);
      ctx.lineDashOffset = +a['stroke-dashoffset'] || 0;
      ctx.stroke(p);
    }
    ctx.globalAlpha = base;
  }
  text(ctx, n, a) {
    const size = +a['font-size'] || 16;
    ctx.font = `${a['font-weight'] || 400} ${size}px ${a['font-family'] || 'sans-serif'}`;
    ctx.textAlign = a['text-anchor'] === 'middle' ? 'center' : a['text-anchor'] === 'end' ? 'right' : 'left';
    const db = a['dominant-baseline'];
    ctx.textBaseline = db === 'middle' || db === 'central' ? 'middle' : db === 'hanging' ? 'hanging' : 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${+a['letter-spacing'] || 0}px`;
    const s = n.text ?? '';
    const fill = this.paint(ctx, a.fill ?? '#000'), stroke = this.paint(ctx, a.stroke);
    const base = ctx.globalAlpha;
    if (fill) { ctx.fillStyle = fill; ctx.globalAlpha = base * (a['fill-opacity'] != null ? +a['fill-opacity'] : 1); ctx.fillText(s, +a.x || 0, +a.y || 0); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = +a['stroke-width'] || 1; ctx.globalAlpha = base; ctx.strokeText(s, +a.x || 0, +a.y || 0); }
    ctx.globalAlpha = base;
  }
  image(ctx, a) {
    const href = a.href || a['xlink:href'];
    if (!href) return;
    let img = this.images.get(href);
    if (!img) {
      img = new Image();
      img.onload = () => this.redraw();
      img.src = href;
      this.images.set(href, img);
    }
    if (!img.complete || !img.naturalWidth) return;
    const x = +a.x || 0, y = +a.y || 0, w = +a.width || img.naturalWidth, h = +a.height || img.naturalHeight;
    if (/pixelated|optimizeSpeed|crisp-edges/.test(a.style || '')) ctx.imageSmoothingEnabled = false;
    const par = a.preserveAspectRatio || 'xMidYMid meet';
    if (par === 'none') return ctx.drawImage(img, x, y, w, h);
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const s = /slice/.test(par) ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    const dw = iw * s, dh = ih * s;
    const al = (p, full, d) => (p === 'Min' ? 0 : p === 'Max' ? full - d : (full - d) / 2);
    const mx = /x(Min|Mid|Max)/.exec(par)?.[1] || 'Mid', my = /Y(Min|Mid|Max)/.exec(par)?.[1] || 'Mid';
    if (/slice/.test(par)) { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.drawImage(img, x + al(mx, w, dw), y + al(my, h, dh), dw, dh); ctx.restore(); }
    else ctx.drawImage(img, x + al(mx, w, dw), y + al(my, h, dh), dw, dh);
  }
  /** Откат: узел через SVG-картинку во весь кадр (матрица m уже в пикселях холста). */
  fallback(ctx, n, m) {
    this.stats.fallbacks++;
    const key = n.attrs?.['data-node'] || n.attrs?.id || n.tag;
    const defs = (this.root.children || []).find((c) => c.tag === 'defs');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${this.W}" height="${this.H}" viewBox="0 0 ${this.W} ${this.H}">${defs ? treeToString(defs) : ''}<g transform="matrix(${m.map((v) => +v.toFixed(6)).join(' ')})">${treeToString(n)}</g></svg>`;
    let img = this.fallbacks.get(svg);
    if (!img) {
      if (this.fallbacks.size > 48) this.fallbacks.delete(this.fallbacks.keys().next().value);
      img = new Image();
      img.onload = () => { this.lastFallback.set(key, img); this.redraw(); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      this.fallbacks.set(svg, img);
    }
    const ready = img.complete && img.naturalWidth ? img : this.lastFallback.get(key);
    if (!ready) return;
    if (ready === img) this.lastFallback.set(key, img);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(ready, 0, 0);
    ctx.restore();
  }
  /** Догрузилась картинка: перерисовать кадр, если плеер стоит (во время воспроизведения это сделает следующий кадр). */
  redraw() {
    const p = this.player;
    if (p && !p.playing && typeof p.draw === 'function') { clearTimeout(this._rt); this._rt = setTimeout(() => p.draw(), 0); }
    this.opts.onAsync?.();
  }
}
const KNOWN = new Set(['g', 'svg', 'path', 'rect', 'circle', 'ellipse', 'line', 'text', 'image']);
const toDOM = (m) => (typeof DOMMatrix !== 'undefined' ? new DOMMatrix(m) : { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] });

/**
 * Фильтр движка (размытие / свечение / тень, см. evaluate) → шаблон строки CSS-фильтра по масштабу, иначе null.
 * Свечение = тень без сдвига цветом свечения; радиус CSS drop-shadow — удвоенное stdDeviation.
 */
function filterTemplate(def) {
  const prims = def.children || [];
  const ok = new Set(['feGaussianBlur', 'feFlood', 'feComposite', 'feDropShadow', 'feMerge']);
  if (!prims.length || prims.some((p) => !ok.has(p.tag))) return null;
  let blur = 0, glow = null, shadow = null;
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i], A = p.attrs || {};
    if (p.tag === 'feGaussianBlur' && A.in === 'SourceGraphic' && A.result === 'b') blur = +A.stdDeviation || 0;
    else if (p.tag === 'feGaussianBlur' && A.result === 'gb') {
      const fl = prims[i + 1], co = prims[i + 2];
      if (fl?.tag !== 'feFlood' || co?.tag !== 'feComposite' || co.attrs.operator !== 'in') return null;
      glow = { std: +A.stdDeviation || 0, color: rgba(fl.attrs['flood-color'] || '#fff', fl.attrs['flood-opacity'] != null ? +fl.attrs['flood-opacity'] : 1) };
      i += 2;
    } else if (p.tag === 'feDropShadow') shadow = { dx: +A.dx || 0, dy: +A.dy || 0, std: +A.stdDeviation || 0, color: rgba(A['flood-color'] || '#000', A['flood-opacity'] != null ? +A['flood-opacity'] : 1) };
    else if (p.tag === 'feMerge') continue;
    else return null;
  }
  return (k) => [
    blur ? `blur(${(blur * k).toFixed(2)}px)` : '',
    glow ? `drop-shadow(0px 0px ${(glow.std * 2 * k).toFixed(2)}px ${glow.color})` : '',
    shadow ? `drop-shadow(${(shadow.dx * k).toFixed(2)}px ${(shadow.dy * k).toFixed(2)}px ${(shadow.std * 2 * k).toFixed(2)}px ${shadow.color})` : '',
  ].filter(Boolean).join(' ') || 'none';
}

/* ---- core/edits.js ---- */
/** Правки поверх сцены (edits): разница и наложение. */


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
function diffScenes(base, cur) {
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
function editsEmpty(ed) {
  return !ed || (!Object.keys(ed.scene || {}).length && !Object.keys(ed.nodes || {}).length && !(ed.removed || []).length && !(ed.order || []).length);
}
/** Число правленых объектов (для интерфейса). */
function editsCount(ed) {
  if (!ed) return 0;
  return new Set([...Object.keys(ed.nodes || {}), ...(ed.removed || []), ...(ed.order || []).map((o) => o.id)]).size + (Object.keys(ed.scene || {}).length ? 1 : 0);
}

/** Наложить правки на исходную сцену → { scene, warnings }. Исходная сцена не меняется. */
function applyEdits(base, ed) {
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

/* ---- core/validate.js ---- */
/** Проверка сцены. */






/** Структурная проверка сцены (без вычисления кадров): типы, id, ссылки, клипы, состояния, IK. Быстрая — для каждой правки. */
function validateStructure(scene, inner = false) {
  const errs = [];
  if (!scene || !Array.isArray(scene.nodes)) return ['scene.nodes должен быть массивом'];
  for (const k of ['width', 'height', 'duration']) if (!(scene[k] > 0)) errs.push(`scene.${k} должен быть > 0`);
  const ids = new Set();
  for (const n of scene.nodes) {
    if (!n.id) errs.push('Узел без id');
    if (ids.has(n.id)) errs.push(`Повтор id ${n.id}`);
    ids.add(n.id);
    if (!NODE_TYPES.includes(n.type)) errs.push(`${n.id}: неизвестный тип ${n.type}`);
    if (n.type === 'instance' && !scene.symbols?.[n.props?.symbol]) errs.push(`${n.id}: символ «${n.props?.symbol}» не найден в scene.symbols`);
  }
  for (const n of scene.nodes) {
    if (n.parent && !ids.has(n.parent)) errs.push(`${n.id}: родитель ${n.parent} не найден`);
    for (const k of ['clip', 'mask']) if (n.props?.[k] && !ids.has(n.props[k])) errs.push(`${n.id}: ${k} ссылается на несуществующий ${n.props[k]}`);
    for (const m of n.mods || []) if (!MODIFIERS[m.type]) errs.push(`${n.id}: неизвестный модификатор ${m.type}`);
    for (const p in n.keys || {}) for (const k of n.keys[p]) { try { if (k.ease != null) resolveEase(k.ease); } catch (e) { errs.push(`${n.id}.${p}: ${e.message}`); } }
  }
  if (!inner) checkSymbols(scene, errs);
  checkMarkers(scene, errs);
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
  return errs;
}

/** Символы: объект имя → { nodes, duration? }; узлы каждого — как у сцены; экземпляры не образуют цикла. */
function checkSymbols(scene, errs) {
  const syms = scene.symbols;
  if (syms == null) return;
  if (typeof syms !== 'object' || Array.isArray(syms)) { errs.push('scene.symbols должен быть объектом: имя → { nodes, duration? }'); return; }
  const uses = new Map();
  for (const [name, s] of Object.entries(syms)) {
    if (!s || !Array.isArray(s.nodes)) { errs.push(`Символ ${name}: нет массива nodes`); continue; }
    if (s.duration != null && !(s.duration > 0)) errs.push(`Символ ${name}: duration должен быть > 0`);
    for (const e of validateStructure({ width: 1, height: 1, duration: 1, nodes: s.nodes, symbols: syms }, true)) errs.push(`Символ ${name}: ${e}`);
    uses.set(name, s.nodes.filter((n) => n.type === 'instance').map((n) => n.props?.symbol));
  }
  // цикл: символ (через вложенные экземпляры) содержит сам себя
  const state = new Map();
  const visit = (name, path) => {
    if (state.get(name) === 2) return;
    if (state.get(name) === 1) { errs.push(`Цикл символов: ${[...path, name].join(' → ')}`); return; }
    state.set(name, 1);
    for (const u of uses.get(name) || []) if (uses.has(u)) visit(u, [...path, name]);
    state.set(name, 2);
  };
  for (const name of uses.keys()) visit(name, []);
}
/** Маркеры: [{ t, name, data? }] внутри длительности, имена без повторов. */
function checkMarkers(scene, errs) {
  const ms = scene.markers;
  if (ms == null) return;
  if (!Array.isArray(ms)) { errs.push('scene.markers должен быть массивом { t, name }'); return; }
  const seen = new Set();
  for (const m of ms) {
    if (!m || typeof m.name !== 'string' || !m.name) { errs.push('Маркер без имени'); continue; }
    if (seen.has(m.name)) errs.push(`Повтор маркера ${m.name}`);
    seen.add(m.name);
    if (!(typeof m.t === 'number' && m.t >= 0 && m.t <= scene.duration + 1e-6)) errs.push(`Маркер ${m.name}: t должен быть в 0..${scene.duration}`);
  }
}

/** Полная проверка сцены: структура + вычисление кадров 0 и середины. Возвращает список проблем. */
function validateScene(scene, { only } = {}) {
  const errs = validateStructure(scene);
  if (!errs.length) { try { evaluate(scene, 0, { only }); evaluate(scene, scene.duration / 2, { only }); } catch (e) { errs.push('Ошибка вычисления: ' + e.message); } }
  return errs;
}

/**
 * Починить висячие ссылки (на месте): маски, link/followPath, цель IK и патчи состояний на несуществующие узлы
 * убираются, узлы с несуществующим родителем переходят в корень. Возвращает описания исправлений.
 * Нужна, чтобы сцена, сохранённая с такой ошибкой, открывалась, а не терялась.
 */
function repairScene(scene) {
  const notes = [];
  if (!scene || !Array.isArray(scene.nodes)) return notes;
  const ids = new Set(scene.nodes.map((n) => n.id));
  for (const n of scene.nodes) {
    if (n.parent && !ids.has(n.parent)) { notes.push(`${n.id}: родителя ${n.parent} нет — перенесён в корень`); n.parent = null; }
    for (const r of nodeRefs(n)) {
      if (ids.has(r.id)) continue;
      // у followPath строка — либо id узла, либо путь d (с пробелами и числами): путь не трогаем
      if (r.kind === 'мод followPath' && !/^[A-Za-z_][\w-]*$/.test(r.id)) continue;
      r.drop(); notes.push(`${n.id}: ${r.kind} → ${r.id} (нет такого узла) — убрано`);
    }
  }
  for (const g of scene.states || []) for (const [v, patch] of Object.entries(g.values || {})) for (const k of Object.keys(patch || {})) if (!ids.has(k)) { delete patch[k]; notes.push(`состояние ${g.name}=${v}: ${k} (нет такого узла) — убрано`); }
  if (notes.length) invalidate(scene);
  return notes;
}

/* ---- core/presets.js ---- */
/** Пресеты и сводка сцены. */




const PRESETS = {
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
function applyPreset(scene, name, params) {
  const p = PRESETS[name];
  if (!p) throw new Error(`Неизвестный пресет «${name}». Есть: ${Object.keys(PRESETS).join(', ')}`);
  p.run(scene, params || {});
  invalidate(scene);
}

/** Краткая сводка сцены (для людей и агентов). */
function describeScene(scene) {
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

/* ---- core/schema.js ---- */
/**
 * Схема формата сцены (JSON Schema 2020-12), собранная из реестров типов узлов и модификаторов, и миграции
 * версий формата. Схема — для редакторов и внешних инструментов (подсказки, проверка); сама движок проверяет
 * сцену validateStructure/validateScene.
 */



/** Текущая версия формата сцены. */
const SCENE_VERSION = 1;

const jsType = (t) => {
  if (!t || t === 'any') return {};
  const ts = String(t).split('|').map((x) => (x === 'array' ? 'array' : x === 'number' ? 'number' : x === 'boolean' ? 'boolean' : x === 'string' ? 'string' : x === 'object' ? 'object' : null)).filter(Boolean);
  return ts.length === 1 ? { type: ts[0] } : ts.length ? { type: ts } : {};
};
const propSchema = (p) => ({ ...jsType(p.type), ...(p.default !== undefined ? { default: p.default } : {}), ...(p.enum ? { enum: p.enum } : {}), ...(p.doc ? { description: p.doc } : {}) });

/** JSON Schema сцены по текущим реестрам (учитывает типы и модификаторы, добавленные register*). */
function sceneSchema() {
  const ease = { description: `имя (${Object.keys(easings).join(', ')}), "cubic-bezier(a,b,c,d)", [a,b,c,d], "spring(k,d,m)", {spring:{…}}, {steps:n}` };
  const key = { type: 'object', required: ['t', 'v'], properties: { t: { type: 'number' }, v: {}, ease, hold: { type: 'boolean' } } };
  const mods = Object.entries(MODIFIERS).map(([type, def]) => ({
    type: 'object', required: ['type'], description: def.doc,
    properties: { type: { const: type }, start: { type: 'number' }, end: { type: 'number' }, fadeIn: { type: 'number' }, fadeOut: { type: 'number' }, weight: { type: 'number' }, enabled: { type: 'boolean' },
      ...Object.fromEntries(Object.entries(def.params || {}).map(([k, p]) => [k, propSchema(p)])) },
  }));
  const nodes = NODE_TYPES.map((type) => {
    const def = NODE_DEFS[type];
    return {
      type: 'object', required: ['id', 'type'], description: def.doc || type,
      properties: {
        id: { type: 'string' }, type: { const: type }, parent: { type: ['string', 'null'] },
        props: { type: 'object', properties: Object.fromEntries(Object.entries({ ...COMMON_PROPS, ...(def.props || {}) }).map(([k, p]) => [k, propSchema(p)])) },
        keys: { type: 'object', additionalProperties: { type: 'array', items: { $ref: '#/$defs/key' } } },
        mods: { type: 'array', items: { $ref: '#/$defs/mod' } },
      },
    };
  });
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://kontur.local/scene.schema.json',
    title: 'Kontur scene',
    type: 'object', required: ['width', 'height', 'duration', 'nodes'],
    properties: {
      version: { type: 'integer', maximum: SCENE_VERSION }, width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 },
      duration: { type: 'number', exclusiveMinimum: 0 }, fps: { type: 'number' }, background: {}, loop: { type: 'boolean' },
      clips: { type: 'array', items: { type: 'object', required: ['name', 'start', 'end'], properties: { name: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' }, loop: { type: 'boolean' }, fps: { type: 'number' }, next: { type: 'string' } } } },
      markers: { type: 'array', items: { type: 'object', required: ['t', 'name'], properties: { t: { type: 'number' }, name: { type: 'string' }, data: {} } } },
      symbols: { type: 'object', description: 'определения символов: имя → { nodes, duration? }', additionalProperties: { type: 'object', required: ['nodes'], properties: { nodes: { type: 'array', items: { $ref: '#/$defs/node' } }, duration: { type: 'number' } } } },
      states: { type: 'array' }, pixel: {}, dither: {}, relief: {}, camera3d: {}, lighting: {}, style: {}, materials: { type: 'object' },
      nodes: { type: 'array', items: { $ref: '#/$defs/node' } },
    },
    $defs: { key, mod: { oneOf: mods }, node: { oneOf: nodes } },
  };
}

/* ------------------------------------------------------------------ миграции */
/**
 * Миграции формата: MIGRATIONS[v] переводит сцену версии v в v+1 (на месте). Файл без version — версия 0
 * (до появления поля): переводится в 1 без изменений содержимого.
 */
const MIGRATIONS = {
  0: (s) => { s.version = 1; },
};
/**
 * Привести сцену к текущей версии формата (на месте). Возвращает список применённых шагов.
 * Сцена новее движка — ошибка (её нельзя молча испортить сохранением).
 */
function migrate(scene) {
  const steps = [];
  if (!scene || typeof scene !== 'object') return steps;
  let v = Number.isInteger(scene.version) ? scene.version : 0;
  if (v > SCENE_VERSION) throw new Error(`Сцена версии ${v} новее движка (поддерживается до ${SCENE_VERSION}) — обновите Kontur`);
  while (v < SCENE_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`Нет миграции формата с версии ${v}`);
    m(scene); steps.push(`${v}→${v + 1}`); v++;
    scene.version = v;
  }
  return steps;
}

/* ------------------------------------------------------------------ справка из реестров */
const code = (s) => '`' + s + '`';
/** Таблица типов узлов для docs/REFERENCE.md. */
function typesTableMd() {
  const rows = [];
  const seen = new Set();
  for (const type of NODE_TYPES) {
    if (seen.has(type)) continue;
    const def = NODE_DEFS[type];
    const alias = NODE_TYPES.filter((t) => NODE_DEFS[t].alias === type);
    alias.forEach((a) => seen.add(a));
    const names = [type, ...alias].map(code).join(' / ');
    const props = Object.entries(def.props || {}).map(([k, p]) => code(k) + (p.default !== undefined && typeof p.default !== 'string' ? ` (${p.default})` : '')).join(', ') || '—';
    rows.push(`| ${names} | ${props} | ${def.doc || ''} |`);
  }
  return ['| type | Свойства | Примечание |', '|---|---|---|', ...rows].join('\n');
}
/** Таблица модификаторов для docs/REFERENCE.md. */
function modifiersTableMd() {
  const rows = Object.entries(MODIFIERS).map(([type, def]) => {
    const what = String(def.doc || '').split(/\.\s|:\s/)[0].replace(/\|/g, '\\|');
    const params = Object.entries(def.params || {}).map(([k, p]) => code(k) + (p.default !== undefined ? ` (${typeof p.default === 'string' ? p.default : JSON.stringify(p.default)})` : '') + (p.doc ? ` — ${p.doc}` : '')).join(', ');
    return `| ${code(type)} | ${what} | ${params.replace(/\|/g, '\\|')} |`;
  });
  return ['| type | Что делает | Параметры (по умолчанию) |', '|---|---|---|', ...rows].join('\n');
}

/* ---- core/svgimport.js ---- */
/**
 * Импорт SVG → узлы Kontur. Без DOM: свой разбор XML, простые CSS-правила из <style> (тег, .класс, #id),
 * наследование оформления, трансформации (раскладываются в x/y/rotation/scaleX/scaleY/skewX), <use>,
 * градиенты (линейный и радиальный, в т.ч. objectBoundingBox). Не переносятся: clip-path, mask, filter,
 * pattern, marker, анимация SMIL — о них говорят предупреждения.
 */





/* ---------- XML ---------- */
const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const xmlUnescape = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : XML_ENT[e] ?? m));

/** Разбор XML в дерево { tag, attrs, children, text }. Комментарии, инструкции и DOCTYPE пропускаются. */
function parseXML(src) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const textEnd = lt < 0 ? src.length : lt;
    if (textEnd > i) { const t = src.slice(i, textEnd); if (t.trim()) top().children.push({ tag: '#text', text: xmlUnescape(t) }); }
    if (lt < 0) break;
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? src.length : e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt + 9); top().children.push({ tag: '#text', text: src.slice(lt + 9, e < 0 ? src.length : e) }); i = e < 0 ? src.length : e + 3; continue; }
    if (src[lt + 1] === '?') { const e = src.indexOf('?>', lt + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (src[lt + 1] === '!') {
      // <!DOCTYPE …> с возможным внутренним подмножеством […]
      let j = lt + 2, depth = 0;
      while (j < src.length && !(src[j] === '>' && depth === 0)) { if (src[j] === '[') depth++; else if (src[j] === ']') depth--; j++; }
      i = j + 1; continue;
    }
    if (src[lt + 1] === '/') {
      const e = src.indexOf('>', lt);
      const name = src.slice(lt + 2, e).trim();
      // закрываем до совпадающего тега (терпимо к ошибкам вложенности)
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === name) { stack.length = k; break; }
      i = e + 1; continue;
    }
    // открывающий тег
    const m = /^<([\w:.-]+)/.exec(src.slice(lt, lt + 200));
    if (!m) { top().children.push({ tag: '#text', text: '<' }); i = lt + 1; continue; }
    const el = { tag: m[1], attrs: {}, children: [] };
    let j = lt + m[0].length;
    const attrRe = /\s*([\w:.-]+)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s>]+))?/y;
    for (;;) {
      while (/\s/.test(src[j])) j++;
      if (src[j] === '>' || src[j] === '/' || j >= src.length) break;
      attrRe.lastIndex = j;
      const a = attrRe.exec(src);
      if (!a || !a[0]) { j++; continue; }
      let v = a[2] ?? '';
      if (v[0] === '"' || v[0] === "'") v = v.slice(1, -1);
      el.attrs[a[1]] = xmlUnescape(v);
      j = attrRe.lastIndex;
    }
    const selfClose = src[j] === '/';
    const gt = src.indexOf('>', j);
    i = gt < 0 ? src.length : gt + 1;
    top().children.push(el);
    if (!selfClose) stack.push(el);
  }
  return root;
}

/* ---------- CSS ---------- */
const siDecls = (s) => {
  const out = {};
  for (const part of String(s || '').split(';')) {
    const k = part.indexOf(':');
    if (k < 0) continue;
    const name = part.slice(0, k).trim().toLowerCase(), val = part.slice(k + 1).replace(/!important/i, '').trim();
    if (name) out[name] = val;
  }
  return out;
};
/** Правила из <style>: [{ sel: {tag?, cls?, id?}, spec, decl }] — только простые селекторы (с группами через запятую). */
function siRules(css) {
  const rules = [];
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const decl = siDecls(m[2]);
    for (const raw of m[1].split(',')) {
      const s = raw.trim();
      const p = /^([a-zA-Z][\w-]*)?(?:#([\w-]+))?((?:\.[\w-]+)*)$/.exec(s);
      if (!p || (!p[1] && !p[2] && !p[3])) continue;
      const cls = p[3] ? p[3].split('.').filter(Boolean) : [];
      rules.push({ tag: p[1] || null, id: p[2] || null, cls, spec: (p[2] ? 100 : 0) + cls.length * 10 + (p[1] ? 1 : 0), decl });
    }
  }
  return rules.map((r, i) => ({ ...r, order: i })).sort((a, b) => a.spec - b.spec || a.order - b.order);
}

/* ---------- оформление ---------- */
const INHERITED = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'stroke-dasharray',
  'font-size', 'font-family', 'font-weight', 'text-anchor', 'letter-spacing', 'visibility', 'color'];
const OWN = ['opacity', 'display', 'transform', 'clip-path', 'mask', 'filter', 'mix-blend-mode'];
const ROOT_STYLE = { fill: '#000000', stroke: 'none', 'stroke-width': '1', 'fill-opacity': '1', 'stroke-opacity': '1', 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'font-size': '16', 'text-anchor': 'start', color: '#000000' };

/** Числа из строки (списки координат, viewBox). */
const siNums = (s) => (String(s ?? '').match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) || []).map(Number);
/** Длина: число, px, % (от опорной длины), em (от 16). */
const siLen = (v, ref = 100, def = 0) => {
  if (v == null || v === '') return def;
  const s = String(v).trim();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return def;
  if (s.endsWith('%')) return (n / 100) * ref;
  if (s.endsWith('em')) return n * 16;
  if (s.endsWith('pt')) return n * 4 / 3;
  if (s.endsWith('mm')) return n * 96 / 25.4;
  if (s.endsWith('cm')) return n * 96 / 2.54;
  if (s.endsWith('in')) return n * 96;
  return n;
};

/** Цвет SVG → строка движка (hex или rgba), с прозрачностью alpha. null — нет краски. */
function siColor(v, alpha, style) {
  if (v == null) return null;
  let s = String(v).trim().toLowerCase();
  if (s === 'none' || s === 'transparent') return null;
  if (s === 'currentcolor') s = String(style.color || '#000000').toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  else if (SVG_NAMED[s]) s = SVG_NAMED[s];
  if (alpha >= 0.999) return s;
  let r, g, b, a = 1;
  const h = /^#([0-9a-f]{3,8})$/.exec(s);
  if (h) {
    let x = h[1];
    if (x.length <= 4) x = [...x].map((c) => c + c).join('');
    r = parseInt(x.slice(0, 2), 16); g = parseInt(x.slice(2, 4), 16); b = parseInt(x.slice(4, 6), 16);
    if (x.length === 8) a = parseInt(x.slice(6, 8), 16) / 255;
  } else {
    const m = /^rgba?\(([^)]+)\)$/.exec(s);
    if (!m) return s;
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    const ch = (q) => (q.endsWith('%') ? (parseFloat(q) * 255) / 100 : parseFloat(q));
    [r, g, b] = [ch(p[0]), ch(p[1]), ch(p[2])];
    if (p[3] != null) a = p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
  }
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${r4(a * alpha)})`;
}
/** Цвета SVG, которых нет в таблице движка (частые в экспорте редакторов). */
const SVG_NAMED = {
  silver: '#c0c0c0', maroon: '#800000', olive: '#808000', aqua: '#00ffff', fuchsia: '#ff00ff', darkgray: '#a9a9a9', darkgrey: '#a9a9a9',
  lightgray: '#d3d3d3', lightgrey: '#d3d3d3', dimgray: '#696969', whitesmoke: '#f5f5f5', gainsboro: '#dcdcdc', darkred: '#8b0000',
  darkgreen: '#006400', darkblue: '#00008b', steelblue: '#4682b4', royalblue: '#4169e1', dodgerblue: '#1e90ff', deepskyblue: '#00bfff',
  lightblue: '#add8e6', forestgreen: '#228b22', seagreen: '#2e8b57', limegreen: '#32cd32', khaki: '#f0e68c', beige: '#f5f5dc',
  chocolate: '#d2691e', sienna: '#a0522d', brown: '#a52a2a', tan: '#d2b48c', firebrick: '#b22222', darkorange: '#ff8c00',
  orangered: '#ff4500', slategray: '#708090', slategrey: '#708090', ivory: '#fffff0', lavender: '#e6e6fa', plum: '#dda0dd',
  wheat: '#f5deb3', linen: '#faf0e6', mintcream: '#f5fffa', midnightblue: '#191970', darkslategray: '#2f4f4f', darkviolet: '#9400d3',
};

/**
 * Разложить матрицу [a b c d e f] в трансформацию движка: translate · rotate · skewX · scale.
 * Точно для любой невырожденной матрицы (отражение — отрицательный scaleY).
 */
const decomposeMatrix = mat.decompose;
function siTransformProps(m) {
  const t = decomposeMatrix(m), out = {};
  if (Math.abs(t.x) > 1e-6) out.x = r4(t.x);
  if (Math.abs(t.y) > 1e-6) out.y = r4(t.y);
  if (Math.abs(t.rotation) > 1e-6) out.rotation = r4(t.rotation);
  if (Math.abs(t.skewX) > 1e-6) out.skewX = r4(t.skewX);
  if (Math.abs(t.scaleX - 1) > 1e-6) out.scaleX = r4(t.scaleX);
  if (Math.abs(t.scaleY - 1) > 1e-6) out.scaleY = r4(t.scaleY);
  return out;
}
/** Рамка геометрии по опорным точкам: [x, y, w, h]. */
function siBox(geom) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sp of geom) for (const [x, y] of [[sp.x0, sp.y0], ...sp.segs.flatMap((c) => [[c[0], c[1]], [c[2], c[3]], [c[4], c[5]]])]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return Number.isFinite(x0) ? [x0, y0, (x1 - x0) || 1, (y1 - y0) || 1] : [0, 0, 1, 1];
}
const siApply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * Разобрать SVG → { width, height, viewBox, nodes, warnings }. Узлы — плоский список с parent, корень — группа
 * opts.id ('svg'). opts.prefix — приставка к id без собственного id.
 */
function importSVG(src, opts = {}) {
  const doc = parseXML(String(src));
  const svg = doc.children.find((c) => c.tag === 'svg' || c.tag.endsWith(':svg'));
  if (!svg) throw new Error('Это не SVG: нет корневого <svg>');
  const warnings = new Set();
  const byId = new Map();
  const rules = [];
  (function scan(el) {
    if (el.attrs?.id) byId.set(el.attrs.id, el);
    if (el.tag === 'style') rules.push(...siRules(el.children.map((c) => c.text || '').join('')));
    for (const c of el.children || []) if (c.tag !== '#text') scan(c);
  })(svg);
  rules.sort((a, b) => a.spec - b.spec || a.order - b.order);

  const vb = siNums(svg.attrs.viewBox);
  const W = siLen(svg.attrs.width, 100, vb.length === 4 ? vb[2] : 300), H = siLen(svg.attrs.height, 100, vb.length === 4 ? vb[3] : 150);
  const viewBox = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb : [0, 0, W, H];
  const width = r3(viewBox[2]), height = r3(viewBox[3]);

  const nodes = [];
  const taken = new Set(opts.taken || []);
  const prefix = opts.prefix ?? '';
  const counters = new Map();
  const newId = (want, kind) => {
    let base = want ? String(want).replace(/[^\w-]/g, '_') : null;
    if (base && !/^[A-Za-z_]/.test(base)) base = '_' + base;
    if (!base) { const k = (counters.get(kind) || 0) + 1; counters.set(kind, k); base = `${prefix}${kind}${k}`; }
    let id = base, i = 2;
    while (taken.has(id)) id = `${base}_${i++}`;
    taken.add(id);
    return id;
  };
  const rootId = newId(opts.id || 'svg', 'g');
  const rootProps = {};
  if (viewBox[0] || viewBox[1]) { rootProps.x = -viewBox[0]; rootProps.y = -viewBox[1]; }
  nodes.push({ id: rootId, type: 'group', parent: opts.parent ?? null, props: { name: opts.name || 'SVG', ...rootProps } });

  const styleOf = (el, parent) => {
    const own = {};
    for (const k of [...INHERITED, ...OWN]) if (el.attrs[k] != null) own[k] = el.attrs[k];
    const cls = String(el.attrs.class || '').split(/\s+/).filter(Boolean);
    for (const r of rules) {
      if (r.tag && r.tag !== el.tag) continue;
      if (r.id && r.id !== el.attrs.id) continue;
      if (r.cls.some((c) => !cls.includes(c))) continue;
      Object.assign(own, r.decl);
    }
    Object.assign(own, siDecls(el.attrs.style));
    const st = {};
    for (const k of INHERITED) { const v = own[k]; st[k] = v == null || v === 'inherit' ? parent[k] : v; }
    for (const k of OWN) st[k] = own[k] ?? null;
    if (own.transform == null) st.transform = el.attrs.transform ?? null;
    return st;
  };

  /** Краска: цвет или градиент (в координатах фигуры, box — её рамка для objectBoundingBox). */
  const paint = (v, alpha, st, box) => {
    if (v == null) return null;
    const m = /^url\(\s*['"]?#([^)'"]+)['"]?\s*\)/.exec(String(v).trim());
    if (!m) return siColor(v, alpha, st);
    const g = gradientOf(m[1], alpha, box);
    if (!g) { warnings.add(`краска url(#${m[1]}) не перенесена (не градиент или не найдена)`); const fb = /\)\s*(.+)$/.exec(String(v)); return fb ? siColor(fb[1], alpha, st) : null; }
    return g;
  };
  const gradAttr = (el, k, seen = new Set()) => {
    if (el.attrs[k] != null) return el.attrs[k];
    const href = el.attrs.href || el.attrs['xlink:href'];
    const ref = href && href[0] === '#' && byId.get(href.slice(1));
    if (ref && !seen.has(ref)) { seen.add(ref); return gradAttr(ref, k, seen); }
    return null;
  };
  const gradStops = (el, seen = new Set()) => {
    const own = el.children.filter((c) => c.tag === 'stop');
    if (own.length) return own;
    const href = el.attrs.href || el.attrs['xlink:href'];
    const ref = href && href[0] === '#' && byId.get(href.slice(1));
    if (ref && !seen.has(ref)) { seen.add(ref); return gradStops(ref, seen); }
    return [];
  };
  function gradientOf(id, alpha, box) {
    const el = byId.get(id);
    if (!el || (el.tag !== 'linearGradient' && el.tag !== 'radialGradient')) return null;
    const stops = gradStops(el).map((s) => {
      const d = { ...siDecls(s.attrs.style) };
      const off = String(s.attrs.offset ?? '0');
      const color = siColor(d['stop-color'] ?? s.attrs['stop-color'] ?? '#000000', 1, ROOT_STYLE) || '#000000';
      const op = parseFloat(d['stop-opacity'] ?? s.attrs['stop-opacity'] ?? '1');
      const stop = { offset: r4(Math.min(1, Math.max(0, off.endsWith('%') ? parseFloat(off) / 100 : parseFloat(off) || 0))), color };
      const o = (Number.isFinite(op) ? op : 1) * alpha;
      if (o < 0.999) stop.opacity = r4(o);
      return stop;
    });
    if (!stops.length) return null;
    const bbox = gradAttr(el, 'gradientUnits') !== 'userSpaceOnUse';
    const [bx, by, bw, bh] = box || [0, 0, 1, 1];
    const gt = parseTransform(gradAttr(el, 'gradientTransform'));
    // в рамке фигуры: [0..1] → её координаты; затем gradientTransform (до перевода в рамку — так в SVG)
    const toLocal = (x, y) => { const [px, py] = siApply(gt, x, y); return bbox ? [bx + px * bw, by + py * bh] : [px, py]; };
    const scaleR = Math.sqrt(Math.abs(gt[0] * gt[3] - gt[1] * gt[2])) * (bbox ? Math.sqrt(Math.abs(bw * bh)) : 1);
    if (Math.abs(gt[1]) > 1e-9 || Math.abs(gt[2]) > 1e-9 || (bbox && Math.abs(bw - bh) > 1e-6 && el.tag === 'radialGradient')) warnings.add(`градиент ${id}: поворот или неравные оси переданы приближённо`);
    const L = (k, d) => { const v = gradAttr(el, k); if (v == null) return d; const s = String(v); return s.endsWith('%') ? parseFloat(s) / 100 : bbox ? parseFloat(s) : siLen(s, 100, d); };
    if (el.tag === 'linearGradient') {
      const [x1, y1] = toLocal(L('x1', 0), L('y1', 0)), [x2, y2] = toLocal(L('x2', 1), L('y2', 0));
      return { type: 'linear', x1: r4(x1), y1: r4(y1), x2: r4(x2), y2: r4(y2), stops };
    }
    const cx = L('cx', 0.5), cy = L('cy', 0.5), r = L('r', 0.5);
    const [lx, ly] = toLocal(cx, cy), [fx, fy] = toLocal(L('fx', cx), L('fy', cy));
    const g = { type: 'radial', cx: r4(lx), cy: r4(ly), r: r4(r * scaleR), stops };
    if (Math.abs(fx - lx) > 1e-6 || Math.abs(fy - ly) > 1e-6) { g.fx = r4(fx); g.fy = r4(fy); }
    return g;
  }

  /** Общие свойства фигуры: краски, обводка, прозрачность. box — рамка геометрии (для градиентов). */
  const drawProps = (st, box) => {
    const p = {};
    const fo = parseFloat(st['fill-opacity']), so = parseFloat(st['stroke-opacity']);
    const fill = paint(st.fill, Number.isFinite(fo) ? fo : 1, st, box);
    const stroke = paint(st.stroke, Number.isFinite(so) ? so : 1, st, box);
    p.fill = fill ?? 'none';
    if (stroke) {
      p.stroke = stroke;
      p.strokeWidth = r4(siLen(st['stroke-width'], 100, 1));
      p.lineCap = st['stroke-linecap'] || 'butt';
      p.lineJoin = st['stroke-linejoin'] === 'miter-clip' || st['stroke-linejoin'] === 'arcs' ? 'miter' : st['stroke-linejoin'] || 'miter';
      const dash = st['stroke-dasharray'];
      if (dash && dash !== 'none') { const d = siNums(dash); if (d.length) p.dash = d; }
    }
    if (st['fill-rule'] === 'evenodd') p.fillRule = 'evenodd';
    return p;
  };
  const ownProps = (st, el) => {
    const p = {};
    const op = parseFloat(st.opacity);
    if (Number.isFinite(op) && op < 1) p.opacity = r4(Math.max(0, op));
    if (st['mix-blend-mode'] && st['mix-blend-mode'] !== 'normal') p.blend = st['mix-blend-mode'];
    for (const k of ['clip-path', 'mask', 'filter']) if (st[k] && st[k] !== 'none') warnings.add(`${k} не переносится (${el.tag}${el.attrs.id ? '#' + el.attrs.id : ''})`);
    if (el.attrs.id && opts.keepNames !== false) p.name = el.attrs.id;
    return p;
  };

  const add = (type, want, parent, props) => { const id = newId(want, type === 'group' ? 'g' : type); nodes.push({ id, type, parent, props }); return id; };

  function walk(el, parent, inherited, extra = IDENTITY, depth = 0) {
    if (depth > 64) { warnings.add('слишком глубокая вложенность (<use>?) — обрезано'); return; }
    const st = styleOf(el, inherited);
    if (st.display === 'none') return;
    const hidden = st.visibility === 'hidden' || st.visibility === 'collapse';
    const m = matMul(extra, parseTransform(st.transform));
    const tag = el.tag.replace(/^svg:/, '');
    switch (tag) {
      case 'g': case 'a': case 'switch': {
        const id = add('group', el.attrs.id, parent, { ...siTransformProps(m), ...ownProps(st, el) });
        for (const c of el.children) if (c.tag !== '#text') walk(c, id, st, IDENTITY, depth + 1);
        return;
      }
      case 'svg': {
        // вложенный <svg>: сдвиг x/y и масштаб viewBox
        const x = siLen(el.attrs.x), y = siLen(el.attrs.y);
        const v = siNums(el.attrs.viewBox);
        let mm = matMul(m, [1, 0, 0, 1, x, y]);
        if (v.length === 4 && v[2] > 0 && v[3] > 0) {
          const w = siLen(el.attrs.width, width, v[2]), h = siLen(el.attrs.height, height, v[3]);
          const s = Math.min(w / v[2], h / v[3]);
          mm = matMul(mm, [s, 0, 0, s, -v[0] * s + (w - v[2] * s) / 2, -v[1] * s + (h - v[3] * s) / 2]);
        }
        const id = add('group', el.attrs.id, parent, { ...siTransformProps(mm), ...ownProps(st, el) });
        for (const c of el.children) if (c.tag !== '#text') walk(c, id, st, IDENTITY, depth + 1);
        return;
      }
      case 'use': {
        const href = el.attrs.href || el.attrs['xlink:href'];
        const ref = href && href[0] === '#' && byId.get(href.slice(1));
        if (!ref) { warnings.add(`<use> на ${href} — не найдено`); return; }
        const mm = matMul(m, [1, 0, 0, 1, siLen(el.attrs.x), siLen(el.attrs.y)]);
        if (ref.tag === 'symbol') {
          const id = add('group', el.attrs.id, parent, { ...siTransformProps(mm), ...ownProps(st, el) });
          for (const c of ref.children) if (c.tag !== '#text') walk(c, id, st, IDENTITY, depth + 1);
        } else {
          const id = add('group', el.attrs.id, parent, { ...siTransformProps(mm), ...ownProps(st, el) });
          walk(ref, id, st, IDENTITY, depth + 1);
        }
        return;
      }
      case 'rect': {
        const x = siLen(el.attrs.x, width), y = siLen(el.attrs.y, height), w = siLen(el.attrs.width, width), h = siLen(el.attrs.height, height);
        if (!(w > 0 && h > 0)) return;
        let rx = el.attrs.rx != null ? siLen(el.attrs.rx, width) : el.attrs.ry != null ? siLen(el.attrs.ry, height) : 0;
        rx = Math.min(rx, w / 2, h / 2);
        const props = { ...siTransformProps(matMul(m, [1, 0, 0, 1, x + w / 2, y + h / 2])), width: r4(w), height: r4(h), ...drawProps(st, [-w / 2, -h / 2, w, h]), ...ownProps(st, el) };
        if (rx > 0) props.radius = r4(rx);
        if (el.attrs.ry != null && el.attrs.rx != null && Math.abs(siLen(el.attrs.rx) - siLen(el.attrs.ry)) > 1e-6) warnings.add('rect с разными rx/ry — скругление по rx');
        if (hidden) props.visible = false;
        add('rect', el.attrs.id, parent, props);
        return;
      }
      case 'circle': case 'ellipse': {
        const cx = siLen(el.attrs.cx, width), cy = siLen(el.attrs.cy, height);
        const rx = tag === 'circle' ? siLen(el.attrs.r) : siLen(el.attrs.rx, width), ry = tag === 'circle' ? rx : siLen(el.attrs.ry, height);
        if (!(rx > 0 && ry > 0)) return;
        const props = { ...siTransformProps(matMul(m, [1, 0, 0, 1, cx, cy])), ...(tag === 'circle' ? { r: r4(rx) } : { rx: r4(rx), ry: r4(ry) }), ...drawProps(st, [-rx, -ry, 2 * rx, 2 * ry]), ...ownProps(st, el) };
        if (hidden) props.visible = false;
        add(tag, el.attrs.id, parent, props);
        return;
      }
      case 'line': {
        const p = { ...siTransformProps(m), x1: r4(siLen(el.attrs.x1)), y1: r4(siLen(el.attrs.y1)), x2: r4(siLen(el.attrs.x2)), y2: r4(siLen(el.attrs.y2)) };
        const box = [Math.min(p.x1, p.x2), Math.min(p.y1, p.y2), Math.abs(p.x2 - p.x1) || 1, Math.abs(p.y2 - p.y1) || 1];
        const props = { ...p, ...drawProps(st, box), ...ownProps(st, el) };
        props.fill = 'none';
        if (!props.stroke) return;
        if (hidden) props.visible = false;
        add('line', el.attrs.id, parent, props);
        return;
      }
      case 'polyline': case 'polygon': case 'path': {
        let d;
        if (tag === 'path') d = String(el.attrs.d || '').trim();
        else {
          const n = siNums(el.attrs.points);
          if (n.length < 4) return;
          d = 'M' + n.slice(0, 2).join(' ') + n.slice(2).reduce((s, v, i) => s + (i % 2 ? ' ' : 'L') + v, '') + (tag === 'polygon' ? 'Z' : '');
        }
        if (!d) return;
        let box;
        try { box = siBox(parsePath(d)); } catch (e) { warnings.add(`путь ${el.attrs.id || ''} не разобран: ${e.message}`); return; }
        const props = { ...siTransformProps(m), d, ...drawProps(st, box), ...ownProps(st, el) };
        if (tag === 'polyline' && props.fill !== 'none') warnings.add('polyline с заливкой: замкнута как многоугольник');
        if (hidden) props.visible = false;
        add('path', el.attrs.id, parent, props);
        return;
      }
      case 'text': {
        const txt = textOf(el).replace(/\s+/g, ' ').trim();
        if (!txt) return;
        const first = el.children.find((c) => c.tag === 'tspan' && (c.attrs.x != null || c.attrs.y != null));
        const x = siNums(el.attrs.x ?? first?.attrs.x)[0] ?? 0, y = siNums(el.attrs.y ?? first?.attrs.y)[0] ?? 0;
        const fs = siLen(st['font-size'], 16, 16);
        // SVG ставит текст по базовой линии, движок — по центру строки
        const props = { ...siTransformProps(matMul(m, [1, 0, 0, 1, x, y - fs * 0.35])), text: txt, fontSize: r4(fs),
          textAlign: { start: 'left', middle: 'center', end: 'right' }[st['text-anchor']] || 'left', ...drawProps(st, [0, -fs, fs * txt.length * 0.6, fs]), ...ownProps(st, el) };
        if (st['font-family']) props.fontFamily = st['font-family'].replace(/["']/g, '');
        const fw = st['font-weight'];
        props.fontWeight = fw === 'bold' || fw === 'bolder' ? 700 : +fw || 400;
        if (st['letter-spacing'] && st['letter-spacing'] !== 'normal') props.letterSpacing = r4(siLen(st['letter-spacing']));
        if (el.children.some((c) => c.tag === 'tspan' && (c.attrs.dy != null || (c !== first && (c.attrs.x != null || c.attrs.y != null))))) warnings.add('многострочный текст (tspan) собран в одну строку');
        if (hidden) props.visible = false;
        add('text', el.attrs.id, parent, props);
        return;
      }
      case 'image': {
        const href = el.attrs.href || el.attrs['xlink:href'];
        if (!href) return;
        const x = siLen(el.attrs.x), y = siLen(el.attrs.y), w = siLen(el.attrs.width, width), h = siLen(el.attrs.height, height);
        if (!(w > 0 && h > 0)) return;
        const par = String(el.attrs.preserveAspectRatio || 'xMidYMid meet');
        const props = { ...siTransformProps(matMul(m, [1, 0, 0, 1, x + w / 2, y + h / 2])), src: href, width: r4(w), height: r4(h),
          fit: par.startsWith('none') ? 'stretch' : /slice/.test(par) ? 'cover' : 'contain', ...ownProps(st, el) };
        if (hidden) props.visible = false;
        add('image', el.attrs.id, parent, props);
        return;
      }
      case 'defs': case 'symbol': case 'style': case 'title': case 'desc': case 'metadata': case 'script':
      case 'linearGradient': case 'radialGradient': case 'clipPath': case 'mask': case 'pattern': case 'marker': case 'filter':
        return;
      case 'animate': case 'animateTransform': case 'animateMotion': case 'set':
        warnings.add('анимация SMIL не переносится'); return;
      default:
        if (!el.tag.includes(':')) warnings.add(`<${el.tag}> не поддержан — пропущен`);
    }
  }
  const textOf = (el) => el.children.map((c) => (c.tag === '#text' ? c.text : c.tag === 'tspan' || c.tag === 'a' ? ' ' + textOf(c) : '')).join('');

  const rootStyle = styleOf(svg, ROOT_STYLE);
  for (const c of svg.children) if (c.tag !== '#text') walk(c, rootId, rootStyle);
  return { width, height, viewBox, nodes, warnings: [...warnings] };
}

/**
 * Вставить SVG в сцену (на месте): корневая группа под parent, id без повторов со сценой.
 * opts: { id, parent, x, y, scale, fit: [w, h] — вписать, center — центрировать в точке x/y }.
 * Возвращает { root, ids, width, height, warnings }.
 */
function insertSVG(scene, src, opts = {}) {
  const c = index(scene);
  if (opts.parent && !c.byId.has(opts.parent)) throw new Error(`Родитель «${opts.parent}» не найден`);
  const r = importSVG(src, { ...opts, taken: c.byId.keys() });
  const root = r.nodes[0];
  let s = opts.scale ?? 1;
  if (opts.fit) s = Math.min(opts.fit[0] / r.width, opts.fit[1] / r.height);
  const ox = root.props.x || 0, oy = root.props.y || 0;
  const cx = opts.center ? -(r.width * s) / 2 : 0, cy = opts.center ? -(r.height * s) / 2 : 0;
  if (s !== 1) {
    // масштаб корня: сдвиг viewBox — во внутреннюю группу, чтобы x/y корня были в координатах сцены
    root.props.scale = r4(s);
    if (ox || oy) { root.props.anchorX = -ox; root.props.anchorY = -oy; }
    delete root.props.x; delete root.props.y;
  }
  const bx = (s !== 1 ? 0 : ox) + cx + (opts.x ?? 0), by = (s !== 1 ? 0 : oy) + cy + (opts.y ?? 0);
  if (bx) root.props.x = r4(bx); else delete root.props.x;
  if (by) root.props.y = r4(by); else delete root.props.y;
  scene.nodes.push(...r.nodes);
  invalidateAll(scene);
  return { root: root.id, ids: r.nodes.map((n) => n.id), width: r.width, height: r.height, warnings: r.warnings };
}

/* ---- core/lottie.js ---- */
/**
 * Экспорт в Lottie (bodymovin JSON) — по кадрам вычисленной сцены. Каждый элемент дерева отображения (группа,
 * фигура) становится группой фигур Lottie с собственной трансформацией; всё, что меняется во времени
 * (трансформация, прозрачность, форма, краски, толщина и штрихи обводки), записывается ключами с линейной
 * интерполяцией, лишние ключи (лежащие на прямой между соседями) отбрасываются. Поэтому переносится всё,
 * что считает движок: пружины, выражения, IK, морфинг, повторы, символы.
 * Не переносятся (предупреждения): текст, растровые слои, маски и обрезка, фильтры (размытие, свечение, тень),
 * режимы наложения, дизеринг (узорная заливка).
 */







const LT_DRAW = new Set(['g', 'path', 'rect']);
/** Ключи элементов среди соседей — как у DOMRenderer: узел сцены, id, иначе тег; повторы по порядку. */
function ltKeys(children) {
  const seen = new Map();
  return children.map((c) => {
    const a = c.attrs || {};
    const base = (a['data-node'] != null ? 'n:' + a['data-node'] : a.id != null ? 'i:' + a.id : '') + '|' + c.tag;
    const k = seen.get(base) || 0; seen.set(base, k + 1);
    return base + ':' + k;
  });
}
class LtTrack {
  constructor(tag, name) { this.tag = tag; this.name = name; this.kids = new Map(); this.order = []; this.s = []; }
}
const ltR = r3;
const ltR2 = (v) => roundTo(v, 2);

/** Краска кадра → { kind: 'solid', c: [r,g,b], a } | { kind: 'grad', type, pts, stops } | null. */
function ltPaint(v, alpha, defs, warn) {
  if (v == null || v === 'none') return null;
  const id = urlRef(v);
  if (id) {
    const d = defs.get(id);
    if (!d || (d.tag !== 'linearGradient' && d.tag !== 'radialGradient')) { warn('узорная заливка (дизеринг, паттерн) не переносится'); return null; }
    const a = d.attrs;
    const stops = (d.children || []).filter((s) => s.tag === 'stop').map((s) => {
      const c = parseColor(s.attrs['stop-color']) || [0, 0, 0, 1];
      return { o: +s.attrs.offset || 0, c: c.slice(0, 3), a: c[3] * (s.attrs['stop-opacity'] != null ? +s.attrs['stop-opacity'] : 1) * alpha };
    });
    if (!stops.length) return null;
    if (d.tag === 'linearGradient') return { kind: 'grad', type: 1, pts: [+a.x1 || 0, +a.y1 || 0, +a.x2 || 0, +a.y2 || 0], stops };
    const cx = +a.cx || 0, cy = +a.cy || 0, r = +a.r || 0;
    return { kind: 'grad', type: 2, pts: [cx, cy, cx + r, cy], stops };
  }
  const c = parseColor(String(v));
  if (!c) { warn(`краска «${v}» не разобрана`); return null; }
  return { kind: 'solid', c: c.slice(0, 3), a: c[3] * alpha };
}

/** Геометрия элемента-фигуры кадра (path или rect фона) → подпути движка. */
function ltGeom(el) {
  const a = el.attrs;
  if (el.tag === 'rect') {
    const x = +a.x || 0, y = +a.y || 0, w = +a.width || 0, h = +a.height || 0;
    return parsePath(`M${x} ${y}H${x + w}V${y + h}H${x}Z`);
  }
  return a.d ? parsePath(a.d) : [];
}
/** Подпуть движка → фигура Lottie { i, o, v, c } (касательные — относительно вершин). */
function ltShape(sp) {
  const v = [[sp.x0, sp.y0]], i = [[0, 0]], o = [];
  sp.segs.forEach((c, k) => {
    const [px, py] = v[v.length - 1];
    o.push([c[0] - px, c[1] - py]);
    const last = k === sp.segs.length - 1;
    if (last && sp.closed && Math.hypot(c[4] - sp.x0, c[5] - sp.y0) < 1e-6) { i[0] = [c[2] - sp.x0, c[3] - sp.y0]; return; }
    v.push([c[4], c[5]]); i.push([c[2] - c[4], c[3] - c[5]]);
  });
  while (o.length < v.length) o.push([0, 0]);
  const rr = (p) => [ltR2(p[0]), ltR2(p[1])];
  return { i: i.map(rr), o: o.map(rr), v: v.map(rr), c: !!sp.closed };
}

function ltWalk(el, tr, f, defs, warn) {
  const a = el.attrs || {};
  if (a['clip-path'] || a.mask) warn('маски и обрезка не переносятся (элемент виден целиком)');
  if (a.filter) warn('фильтры (размытие, свечение, тень, рельеф) не переносятся');
  if (a.style && /mix-blend-mode/.test(a.style)) warn('режимы наложения не переносятся');
  const smp = { m: parseTransform(a.transform), o: a.opacity != null ? +a.opacity : 1 };
  if (el.tag === 'g') {
    tr.s[f] = smp;
    const kids = (el.children || []).filter((c) => {
      if (LT_DRAW.has(c.tag)) return true;
      if (c.tag === 'text') warn('текст не переносится (переведите в кривые или добавьте текстовый слой в редакторе Lottie)');
      else if (c.tag === 'image' || c.tag === 'svg') warn('растровые слои не переносятся');
      return false;
    });
    const keys = ltKeys(kids);
    let prev = null;
    kids.forEach((c, i) => {
      const k = keys[i];
      let t = tr.kids.get(k);
      if (!t) {
        t = new LtTrack(c.tag, c.attrs?.['data-node'] || c.attrs?.id || c.tag);
        tr.kids.set(k, t);
        tr.order.splice(prev ? tr.order.indexOf(prev) + 1 : 0, 0, k);
      }
      ltWalk(c, t, f, defs, warn);
      prev = k;
    });
    return;
  }
  // фигура
  const fo = a['fill-opacity'] != null ? +a['fill-opacity'] : 1, so = a['stroke-opacity'] != null ? +a['stroke-opacity'] : 1;
  smp.geom = ltGeom(el);
  smp.fill = ltPaint(a.fill ?? '#000000', fo, defs, warn);
  smp.stroke = ltPaint(a.stroke, so, defs, warn);
  smp.sw = a['stroke-width'] != null ? +a['stroke-width'] : 1;
  smp.cap = a['stroke-linecap'] || 'butt'; smp.join = a['stroke-linejoin'] || 'miter';
  smp.evenodd = a['fill-rule'] === 'evenodd';
  smp.strokeFirst = a['paint-order'] === 'stroke';
  if (a['stroke-dasharray'] && smp.stroke) {
    let d = String(a['stroke-dasharray']).split(/[\s,]+/).filter(Boolean).map(Number);
    const off = +a['stroke-dashoffset'] || 0;
    const tm = off === 0 ? ltTrimOf(d) : null;
    if (tm) smp.trim = tm;
    else if (d.reduce((x, y) => x + Math.abs(y), 0) > 1e-6) { if (d.length % 2) d = [...d, ...d]; smp.dash = d; smp.dashOff = off; }
  }
  tr.s[f] = smp;
}

/**
 * Обрезка обводки движка (trimDash): «0 A S 2L» (без перехода через начало) или «P Q R L» (с переходом) →
 * { span, a } — длина и начало видимой части в долях пути. Иначе null (это обычные штрихи).
 */
function ltTrimOf(d) {
  if (d.length !== 4 || d.some((x) => !(x >= 0))) return null;
  const [p, q, r, v4] = d, eps = 1e-2 + v4 * 1e-6;
  if (p === 0) { const L = v4 / 2; if (L > 0 && q + r <= L + eps) return { a: q / L, span: r / L }; return null; }
  const L = v4;
  if (L > 0 && Math.abs(p + q + r - L) <= eps) { const a = 1 - r / L; return { a, span: p / L + 1 - a }; }
  return null;
}

/** Значения по кадрам → свойство Lottie (статичное или с ключами). vals[f] — массив чисел. hold[f] — скачок после кадра f. */
function ltAnim(vals, hold, { eps = 1e-3, scalar = false } = {}) {
  const n = vals.length;
  const same = (x, y) => x.length === y.length && x.every((q, i) => Math.abs(q - y[i]) <= eps);
  const out = (v) => (scalar ? ltR(v[0]) : v.map(ltR));
  if (vals.every((v) => same(v, vals[0]))) return { a: 0, k: out(vals[0]) };
  const keep = [0];
  for (let f = 1; f < n - 1; f++) {
    const p = keep[keep.length - 1];
    if (hold[f] || hold[f - 1] || vals[f].length !== vals[f + 1].length || vals[p].length !== vals[f + 1].length) { keep.push(f); continue; }
    // можно ли дотянуть прямую от p до f+1 через все кадры между ними
    let ok = true;
    for (let g = p + 1; g <= f && ok; g++) {
      const u = (g - p) / (f + 1 - p);
      for (let i = 0; i < vals[g].length; i++) if (Math.abs(vals[p][i] + (vals[f + 1][i] - vals[p][i]) * u - vals[g][i]) > eps) { ok = false; break; }
    }
    if (!ok) keep.push(f);
  }
  if (n > 1) keep.push(n - 1);
  const dims = vals[0].length;
  return {
    a: 1,
    k: keep.map((f, j) => {
      const kf = { t: f, s: vals[f].map(ltR) };
      if (j < keep.length - 1) {
        if (hold[f] || vals[f].length !== vals[keep[j + 1]].length) kf.h = 1;
        else { kf.o = { x: Array(dims).fill(0), y: Array(dims).fill(0) }; kf.i = { x: Array(dims).fill(1), y: Array(dims).fill(1) }; }
      }
      return kf;
    }),
  };
}
/**
 * Фигура по кадрам: ключи только там, где форма уходит от прямой между соседними ключами больше чем на tol
 * (единиц сцены); смена числа вершин или замкнутости — ключ со скачком.
 */
function ltShapeAnim(shapes, hold, tol = 0.25) {
  const n = shapes.length;
  const sig = shapes.map((s) => JSON.stringify(s));
  if (sig.every((s) => s === sig[0])) return { a: 0, k: shapes[0] };
  const flat = shapes.map((s) => [...s.v.flat(), ...s.i.flat(), ...s.o.flat()]);
  const compat = (a, b) => shapes[a].v.length === shapes[b].v.length && shapes[a].c === shapes[b].c;
  const keep = [0];
  for (let f = 1; f < n - 1; f++) {
    const p = keep[keep.length - 1];
    if (hold[f] || hold[f - 1] || !compat(p, f + 1) || !compat(f, f + 1)) { keep.push(f); continue; }
    let ok = true;
    for (let g = p + 1; g <= f && ok; g++) {
      const u = (g - p) / (f + 1 - p), A = flat[p], B = flat[f + 1], G = flat[g];
      for (let i = 0; i < G.length; i++) if (Math.abs(A[i] + (B[i] - A[i]) * u - G[i]) > tol) { ok = false; break; }
    }
    if (!ok) keep.push(f);
  }
  if (n > 1) keep.push(n - 1);
  return {
    a: 1,
    k: keep.map((f, j) => {
      const kf = { t: f, s: [shapes[f]] };
      if (j < keep.length - 1) {
        const nx = shapes[keep[j + 1]];
        if (hold[f] || nx.v.length !== shapes[f].v.length || nx.c !== shapes[f].c) kf.h = 1;
        else { kf.o = { x: 0, y: 0 }; kf.i = { x: 1, y: 1 }; }
      }
      return kf;
    }),
  };
}

/** Заполнить пропуски (кадры, где элемента нет) ближайшим значением: сначала вперёд, потом назад. */
function ltFill(arr, n) {
  const out = new Array(n);
  let last;
  for (let f = 0; f < n; f++) { if (arr[f] !== undefined) last = arr[f]; out[f] = last; }
  let next;
  for (let f = n - 1; f >= 0; f--) { if (arr[f] !== undefined) next = arr[f]; if (out[f] === undefined) out[f] = next; }
  return out;
}

const LT_CAP = { butt: 1, round: 2, square: 3 }, LT_JOIN = { miter: 1, round: 2, bevel: 3 };

/** Трансформация группы по кадрам (матрица → p, r, s, sk; поворот без скачков через 360°). */
function ltTransform(s, present, n) {
  const filled = ltFill(s, n);
  const p = [], r = [], sc = [], sk = [], o = [];
  let prevR = null;
  for (let f = 0; f < n; f++) {
    const d = decomposeMatrix(filled[f].m);
    let rot = d.rotation;
    if (prevR != null) while (rot - prevR > 180) rot -= 360;
    if (prevR != null) while (rot - prevR < -180) rot += 360;
    prevR = rot;
    p.push([d.x, d.y]); r.push([rot]); sc.push([d.scaleX * 100, d.scaleY * 100]); sk.push([-d.skewX]);
    o.push([present[f] ? filled[f].o * 100 : 0]);
  }
  const hold = present.map((x, f) => f < n - 1 && present[f + 1] !== x);
  const none = new Array(n).fill(false);
  return { ty: 'tr', p: ltAnim(p, none), a: { a: 0, k: [0, 0] }, s: ltAnim(sc, none), r: ltAnim(r, none, { scalar: true }), o: ltAnim(o, hold, { scalar: true }), sk: ltAnim(sk, none, { scalar: true }), sa: { a: 0, k: 0 }, nm: 'Transform' };
}

/** Заливка или обводка (сплошная или градиентная) по кадрам. */
function ltPaintItem(paints, n, isStroke, smp, warn, name) {
  const present = paints.map((x) => !!x);
  if (!present.some(Boolean)) return null;
  const first = paints.find(Boolean);
  const filled = ltFill(paints.map((x) => (x && x.kind === first.kind && (x.kind === 'solid' || (x.type === first.type && x.stops.length === first.stops.length)) ? x : undefined)), n);
  if (paints.some((x) => x && filled.indexOf(x) < 0)) warn(`${name}: тип краски меняется во времени — взят первый`);
  const hold = present.map((x, f) => f < n - 1 && present[f + 1] !== x);
  const none = new Array(n).fill(false);
  const op = ltAnim(filled.map((x, f) => [present[f] ? (x.kind === 'solid' ? x.a : 1) * 100 : 0]), hold, { scalar: true });
  let item;
  if (first.kind === 'solid') item = { ty: isStroke ? 'st' : 'fl', c: ltAnim(filled.map((x) => [...x.c, 1]), none), o: op };
  else {
    // градиент: [смещение, r, g, b]… и, если есть прозрачность, [смещение, a]…
    const withA = filled.some((x) => x.stops.some((s) => s.a < 0.999));
    const g = filled.map((x) => [...x.stops.flatMap((s) => [s.o, ...s.c]), ...(withA ? x.stops.flatMap((s) => [s.o, s.a]) : [])]);
    item = { ty: isStroke ? 'gs' : 'gf', o: op, t: first.type, s: ltAnim(filled.map((x) => x.pts.slice(0, 2)), none), e: ltAnim(filled.map((x) => x.pts.slice(2, 4)), none), g: { p: first.stops.length, k: ltAnim(g, none) } };
    if (first.type === 2) { item.h = { a: 0, k: 0 }; item.a = { a: 0, k: 0 }; }
  }
  if (isStroke) {
    const s0 = smp.find(Boolean);
    Object.assign(item, { w: ltAnim(ltFill(smp.map((x) => (x ? [x.sw] : undefined)), n), none, { scalar: true }), lc: LT_CAP[s0.cap] || 1, lj: LT_JOIN[s0.join] || 1, ml: 4 });
    const dashes = smp.map((x) => x?.dash);
    if (dashes.some(Boolean)) {
      // штрихи есть не на всех кадрах или их число меняется — Lottie так не умеет: берутся первые
      const len = dashes.find(Boolean).length;
      if (smp.some((x) => x && (!x.dash || x.dash.length !== len))) warn(`${name}: штрихи меняются во времени (появляются, исчезают, другое число) — взяты первые`);
      const pad = ltFill(dashes.map((d) => (d && d.length === len ? d : undefined)), n);
      const offs = ltFill(smp.map((x) => (x?.dash ? [x.dashOff || 0] : undefined)), n);
      item.d = [...pad[0].map((_, i) => ({ n: i % 2 ? 'g' : 'd', nm: i % 2 ? 'gap' : 'dash', v: ltAnim(pad.map((d) => [d[i]]), none, { scalar: true }) })), { n: 'o', nm: 'offset', v: ltAnim(offs, none, { scalar: true }) }];
    }
  } else item.r = smp.find(Boolean).evenodd ? 2 : 1;
  item.nm = isStroke ? 'Stroke' : 'Fill';
  return item;
}

/** Trim Paths по кадрам из распознанной обрезки: s = 0, e = длина видимой части, o = её начало (градусы, без скачков). */
function ltTrimItem(smp, n) {
  if (!smp.some((x) => x?.trim)) return null;
  const filled = ltFill(smp, n);
  const e = [], o = [], hold = [];
  let prev = null;
  for (let f = 0; f < n; f++) {
    const t = filled[f].trim;
    let deg = t ? t.a * 360 : prev ?? 0;
    if (prev != null) { while (deg - prev > 180) deg -= 360; while (deg - prev < -180) deg += 360; }
    prev = deg;
    e.push([t ? t.span * 100 : 100]); o.push([deg]);
    hold.push(f < n - 1 && !!filled[f].trim !== !!filled[f + 1].trim);
  }
  return { ty: 'tm', s: { a: 0, k: 0 }, e: ltAnim(e, hold, { scalar: true }), o: ltAnim(o, hold, { scalar: true }), m: 1, nm: 'Trim' };
}

function ltEmit(tr, n, warn, tol) {
  // плотный массив: на кадрах, где элемента нет, — undefined (у разреженного map/spread пропускают дыры)
  const S = Array.from({ length: n }, (_, f) => tr.s[f]);
  const present = S.map((x) => x !== undefined);
  const it = [];
  if (tr.tag === 'g') {
    for (const k of [...tr.order].reverse()) { const c = ltEmit(tr.kids.get(k), n, warn, tol); if (c) it.push(c); }
    if (!it.length) return null;
  } else {
    // подпути: по номеру; на кадрах, где подпути нет, — вырожденная точка
    const subs = Math.max(...S.map((x) => (x ? x.geom.length : 0)));
    if (!subs) return null;
    const hold = present.map((x, f) => f < n - 1 && present[f + 1] !== x);
    const filledS = ltFill(S, n);
    for (let j = 0; j < subs; j++) {
      const shapes = filledS.map((x) => (x.geom[j] ? ltShape(x.geom[j]) : { i: [[0, 0]], o: [[0, 0]], v: [[0, 0]], c: false }));
      it.push({ ty: 'sh', nm: 'Path ' + (j + 1), ks: ltShapeAnim(shapes, hold, tol) });
    }
    const st = ltPaintItem(S.map((x, f) => (present[f] ? x.stroke : null)), n, true, S, warn, tr.name);
    const fl = ltPaintItem(S.map((x, f) => (present[f] ? x.fill : null)), n, false, S, warn, tr.name);
    if (!st && !fl) return null;
    // в Lottie верхний в списке рисуется поверх: обводка над заливкой (или наоборот при paint-order: stroke)
    const strokeFirst = S.find(Boolean)?.strokeFirst;
    const tm = st && ltTrimItem(S, n);
    if (tm) {
      // обрезка (Trim Paths) — только для обводки: обводка и заливка — в отдельных группах с теми же путями
      const paths = it.splice(0);
      const idT = { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 }, nm: 'Transform' };
      const sg = { ty: 'gr', nm: 'stroke', it: [...paths, tm, st, idT], np: paths.length + 2, cix: 2, ix: 1 };
      const fg = fl && { ty: 'gr', nm: 'fill', it: [...JSON.parse(JSON.stringify(paths)), fl, idT], np: paths.length + 1, cix: 2, ix: 2 };
      for (const x of strokeFirst ? [fg, sg] : [sg, fg]) if (x) it.push(x);
    } else for (const x of strokeFirst ? [fl, st] : [st, fl]) if (x) it.push(x);
  }
  it.push(ltTransform(S, present, n));
  return { ty: 'gr', nm: tr.name, it, np: it.length - 1, cix: 2, ix: 1 };
}

/**
 * Сцена → Lottie JSON (объект). opts: { fps (по умолчанию fps сцены, не больше 60), states, name,
 *   tolerance — допуск формы между ключами, единиц сцены (0.25; 0 — ключ на каждом кадре) }.
 * Возвращает { lottie, warnings, frames }.
 */
function exportLottie(scene, opts = {}) {
  const fps = opts.fps ?? Math.min(scene.fps || 30, 60);
  const frames = Math.max(1, Math.round(scene.duration * fps));
  const n = frames + 1;
  const warnings = new Set();
  const warn = (m) => warnings.add(m);
  const root = new LtTrack('g', 'root');
  for (let f = 0; f < n; f++) {
    const tree = evaluate(scene, Math.min(f / fps, scene.duration), { states: opts.states });
    const defs = defsOf(tree);
    const body = { tag: 'g', attrs: {}, children: tree.children.filter((c) => c.tag !== 'defs') };
    ltWalk(body, root, f, defs, warn);
  }
  const top = ltEmit(root, n, warn, opts.tolerance ?? 0.25);
  const layer = (nm, shapes, ind) => ({
    ddd: 0, ind, ty: 4, nm, sr: 1, ao: 0, ip: 0, op: frames, st: 0, bm: 0,
    ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
    shapes,
  });
  const lottie = {
    v: '5.7.4', fr: fps, ip: 0, op: frames, w: scene.width, h: scene.height, nm: opts.name || scene.name || 'Kontur', ddd: 0,
    meta: { g: `Kontur ${VERSION}` },
    assets: [],
    layers: top ? [layer('Kontur', [top], 1)] : [],
    markers: (scene.markers || []).map((m) => ({ tm: ltR(m.t * fps), cm: m.name, dr: 0 })),
  };
  return { lottie, warnings: [...warnings], frames };
}

export { clamp, lerp, noise3, noise1, fbm, hashStr, mat, vec3, roundTo, r3, r4, TAU, DEG, makeRng, pmStep, easings, cubicBezier, springEase, resolveEase, parseColor, formatColor, mixColor, toLin, toGam, parsePath, geomToPath, smoothGeom, toGeom, translateGeom, prepareMorph, lerpGeom, morph, measureGeom, pointAtFraction, deformGeom, interpolate, sampleKeys, VERSION, propDefault, createScene, invalidate, invalidateNode, sceneMemo, NODE_TYPES, NODE_DEFS, COMMON_PROPS, registerNodeType, typeProps, typeAnimated, MODIFIERS, registerModifier, modIsStatic, compileSafeExpr, compileExpr, setExprPolicy, exprPolicy, allowExprFunctions, RELIEF_DEFAULT, PASS_MODES, RENDER_MODES, modeInfo, registerRenderMode, surfaceAxes, resolveSurface, encodeNormal, encodePlaneD, encodeMatId, materialIndex, normalGradLayers, normalMapMatrix, CAMERA3D_DEFAULT, cameraModel, DITHER_PATTERNS, evaluate, symbolScene, instanceTime, nodeWorldMatrix, collectLights, quantizeRGBA, pixelOf, treeToString, renderSVG, isSolid, dropUnderBg, DOMRenderer, Player, CanvasRenderer, filterTemplate, resolve, parseTransform, matMul, defsOf, urlRef, ops, clipRange, clipTime, uniqueId, subtreeOf, nodeRefs, markersCrossed, diffScenes, editsEmpty, editsCount, applyEdits, validateScene, validateStructure, repairScene, PRESETS, applyPreset, describeScene, SCENE_VERSION, sceneSchema, migrate, MIGRATIONS, typesTableMd, modifiersTableMd, importSVG, insertSVG, parseXML, decomposeMatrix, exportLottie };
