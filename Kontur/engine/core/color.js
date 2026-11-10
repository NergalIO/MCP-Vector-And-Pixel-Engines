/** Цвета: разбор CSS, OKLab, смешивание. */
import { clamp, lerp, r3 } from './math.js';

export const NAMED = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', lime: '#00ff00', blue: '#0000ff',
  yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff', orange: '#ffa500', purple: '#800080',
  pink: '#ffc0cb', gray: '#808080', grey: '#808080', navy: '#000080', teal: '#008080', gold: '#ffd700',
  coral: '#ff7f50', crimson: '#dc143c', indigo: '#4b0082', violet: '#ee82ee', salmon: '#fa8072',
  turquoise: '#40e0d0', tomato: '#ff6347', orchid: '#da70d6', skyblue: '#87ceeb', hotpink: '#ff69b4',
  transparent: 'rgba(0,0,0,0)',
};
export const colorCache = new Map();
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
export const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
export function rgbToOklab([r, g, b]) {
  r = toLin(r); g = toLin(g); b = toLin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function oklabToRgb([L, a, b]) {
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
