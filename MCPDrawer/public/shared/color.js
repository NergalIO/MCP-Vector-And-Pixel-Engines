// Color helpers shared by the editor and the server: HSL conversion and hue-shifted ramps.
import { parseColor, toHex } from './raster.js';

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Signed shortest hue move from h toward target, limited to `max` degrees.
function toward(h, target, max) {
  const d = ((target - h + 540) % 360) - 180;
  return Math.sign(d) * Math.min(Math.abs(d), max);
}

// Ramp dark → light around `base` (base sits in the middle). Shadows drift toward blue/purple,
// highlights toward yellow, which reads better in pixel art than plain lightness changes.
export function makeRamp(base, { steps = 5, hueShift = 20, contrast = 1 } = {}) {
  const [h0, s0, l0] = rgbToHsl(parseColor(base));
  const n = Math.max(1, Math.floor(steps / 2));
  const out = [];
  for (let k = -n; k <= n; k++) {
    if (steps % 2 === 0 && k === 0) continue;
    const t = k / n;
    let h = h0, s = s0, l = l0;
    if (t < 0) {
      h += toward(h0, 250, hueShift) * -t;
      s = clamp01(s0 + 0.1 * -t);
      l = clamp01(l0 - (l0 - 0.06) * -t * 0.85 * contrast);
    } else if (t > 0) {
      h += toward(h0, 55, hueShift) * t;
      s = clamp01(s0 - 0.15 * t);
      l = clamp01(l0 + (0.96 - l0) * t * 0.8 * contrast);
    }
    out.push(toHex([...hslToRgb([h, s, l]), 255]));
  }
  return out;
}
