// Kontur world3d — Палитра и цвета: разбор с кэшем, смешивание, затемнение и осветление, разброс оттенка.
import { parseColor } from '../kontur.js';
import { rnd } from './rng.js';

export const C = {
  line: '#2e2a3c', plaster: '#efd9b0', plasterSh: '#d2b084', rose: '#e8b4a0', roseSh: '#c98c7c', mint: '#b9d4b0', mintSh: '#93b08c',
  sand: '#e9c98e', roof: '#c95a3c', roofSh: '#9c3f2d', roofHi: '#e47e5a', wood: '#9a6a3e', woodSh: '#74492a', woodDark: '#5a3a24',
  stone: '#c9b597', stoneSh: '#a28d72', stoneHi: '#e2d2b6', stoneDark: '#7d6b58', cobble: '#b39a7a', cobbleSh: '#8f7860', cobbleHi: '#d2bc98',
  brick: '#b8664a', brickSh: '#8e4a36', moss: '#7f9c4c', mossSh: '#5c7838', mossHi: '#a7c06a', ochre: '#e3a647', brass: '#e8b84a',
  glass: '#3e4f72', glassHi: '#9fc0e8', glow: '#ffd98a', cream: '#fff3d6', red: '#d9503f', redSh: '#a8382c', blue: '#4a76b8', blueSh: '#355890',
  teal: '#3f9a92', purple: '#8a5aa8', pink: '#e98aa6', water: '#6fb7c9', waterHi: '#c4ecf2', straw: '#e8c75e', strawSh: '#b8952f',
  iron: '#4a4650', skyTop: '#6f7fb8', skyMid: '#d99a9a', skyLow: '#f6c38f', far: '#b88a9a',
};
// цвет → [r, g, b] 0..255 (разбор — общий parseColor движка; нераспознанный — чёрный)
// разобранные цвета кэшируются (массивы из кэша не изменять)
const RGB_CACHE = new Map();
const hexRGB = (h) => {
  const k = String(h || '#000');
  let r = RGB_CACHE.get(k);
  if (!r) { const c = parseColor(k); r = c ? [c[0] * 255, c[1] * 255, c[2] * 255] : [0, 0, 0]; if (RGB_CACHE.size > 4096) RGB_CACHE.clear(); RGB_CACHE.set(k, r); }
  return r;
};
const HEX2 = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
const hx = (v) => HEX2[Math.max(0, Math.min(255, Math.round(v)))];
const RGBhex = (c) => '#' + hx(c[0]) + hx(c[1]) + hx(c[2]);
export const col = (c) => (c && C[c] ? C[c] : c);
export const mix = (a, b, t) => { const p = hexRGB(col(a)), q = hexRGB(col(b)); return '#' + hx(p[0] + (q[0] - p[0]) * t) + hx(p[1] + (q[1] - p[1]) * t) + hx(p[2] + (q[2] - p[2]) * t); };
export const dark = (a, t = 0.25) => mix(a, '#2a1a2a', t);
export const lite = (a, t = 0.25) => mix(a, '#fff8ea', t);
let JQ = 0;
/** Выполнить fn, квантуя разброс jit до q тонов (0 — без квантования): одинаковые тона сливаются в один путь. */
export function withJitSteps(q, fn) { const p = JQ; JQ = q; try { return fn(); } finally { JQ = p; } }
export const jit = (a, amt = 0.08) => { let r = rnd(); if (JQ) r = (Math.floor(r * JQ) + 0.5) / JQ; return r < 0.5 ? dark(a, (0.5 - r) * 2 * amt) : lite(a, (r - 0.5) * 2 * amt); };

/* детерминированная случайность (Парк — Миллер) */
