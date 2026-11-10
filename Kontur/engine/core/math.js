/** Математика: числа, шум Перлина, хеши, 2D-матрицы. */


export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, u) => a + (b - a) * u;
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const r3 = (n) => Math.round(n * 1000) / 1000;
const FRAC = Array.from({ length: 1000 }, (_, f) => (f ? '.' + String(f).padStart(3, '0').replace(/0+$/, '') : ''));
/**
 * Строка числа, округлённого до 0,001 — то же, что String(r3(n)), но без медленного dtoa:
 * целая часть и дробь из таблицы (горячий путь сериализации путей).
 */
export function num3(n) {
  const r = Math.round(n * 1000);
  if (!(r > -1e15 && r < 1e15)) return String(r3(n));
  if (r === 0) return '0';
  const a = r < 0 ? -r : r, ip = Math.floor(a / 1000);
  return (r < 0 ? '-' : '') + ip + FRAC[a - ip * 1000];
}

export function hash3(x, y, z, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul((s | 0) + 1013, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}
export const G3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
export const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

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

/** Короткий стабильный хеш строки (FNV-1a) — для id в defs. */
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export const fmt = (n) => (typeof n === 'number' ? r3(n) : n);


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
