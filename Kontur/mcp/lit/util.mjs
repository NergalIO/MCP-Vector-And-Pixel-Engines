// Общие мелочи конвейера отложенного света: числа, цвета, хеши, таблицы гаммы, замер этапов.
import { parseColor } from '../../engine/kontur.js';

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a || 1e-6)); return t * t * (3 - 2 * t); };
/** Яркость (Rec. 709) линейного RGB. */
export const Y3 = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Нормализовать вектор (массив). */
export const nz = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
/** Экранное значение → линейное (гамма 2.2, как в эскизах). */
export const lin22 = (v) => Math.pow(Math.max(0, v), 2.2);
/** Таблица lin22(i / 255) для байтов проходов: то же значение, что Math.pow, без возведения в степень на пиксель. */
export const LIN8 = (() => { const t = new Float64Array(256); for (let i = 0; i < 256; i++) t[i] = Math.pow(i / 255, 2.2); return t; })();
/** Python-округление (банковское на .5) — радиусы SSAO как в исходном render.py. */
export const pyRound = (v) => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 ? r - 1 : r; };
/** Хеш пикселя → [0, 1). */
export const hash01 = (i, s) => { let h = Math.imul(i ^ Math.imul(s, 0x9e3779b1), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

/** Цвет света: [r,g,b] 0..1 или CSS-цвет (доли без гаммы). */
export const rgb = (c, def = [1, 1, 1]) => {
  if (Array.isArray(c)) return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
  const p = c != null ? parseColor(String(c)) : null;
  return p ? [p[0], p[1], p[2]] : def;
};
export const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
/** Глубокое слияние объектов (массивы заменяются целиком). */
export const deep = (a, b) => { const o = { ...a }; for (const k in b) o[k] = isObj(a?.[k]) && isObj(b[k]) ? deep(a[k], b[k]) : b[k]; return o; };
/** Включаемый блок: true → значения по умолчанию, объект → поверх них, false/null/enabled:false → выключен. */
export const block = (v, def) => (v === true ? { ...def } : isObj(v) && v.enabled !== false ? { ...def, ...v } : null);
/** Скаляр или тройка → тройка. */
export const tri = (v, d) => (v == null ? [d, d, d] : typeof v === 'number' ? [v, v, v] : rgb(v, [d, d, d]));

/** Замер этапов: lap('имя') пишет время с прошлого замера в stages. */
export function stageTimer() {
  const stages = {};
  let tq = Date.now();
  return { stages, lap(name) { const now = Date.now(); stages[name] = (stages[name] || 0) + now - tq; tq = now; } };
}

/** Картинки RGBA друг под другом (лист отладки). */
export function stackV(imgs, gap = 8) {
  const w = Math.max(...imgs.map((i) => i.width)), h = imgs.reduce((a, i) => a + i.height, 0) + gap * (imgs.length - 1), data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([34, 34, 34, 255], i * 4);
  let oy = 0;
  for (const im of imgs) { for (let y = 0; y < im.height; y++) data.set(im.data.subarray(y * im.width * 4, (y + 1) * im.width * 4), ((oy + y) * w) * 4); oy += im.height + gap; }
  return { width: w, height: h, data };
}
