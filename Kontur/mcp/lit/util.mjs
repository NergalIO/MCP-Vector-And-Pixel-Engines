// Общие мелочи конвейера отложенного света: числа, цвета, хеши, таблицы гаммы, замер этапов.
import { parseColor } from '../../engine/kontur.js';

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a || 1e-6)); return t * t * (3 - 2 * t); };
/** Яркость (Rec. 709) линейного RGB. */
export const Y3 = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Яркость (Rec. 601) — для масок и карт высот из экранных байтов. */
export const Y601 = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
/** Байт закодированной нормали 0..255 → −1..1. */
export const unorm8 = (b) => b / 127.5 - 1;
/** Билинейная смесь четырёх соседей (a00 — левый верхний) с долями tx, ty. */
export const bilin = (a00, a10, a01, a11, tx, ty) => (a00 * (1 - tx) + a10 * tx) * (1 - ty) + (a01 * (1 - tx) + a11 * tx) * ty;
/** Нормализовать вектор (массив). */
export const nz = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
/** Экранное значение → линейное (гамма 2.2, как в эскизах). */
export const lin22 = (v) => Math.pow(Math.max(0, v), 2.2);
/** Таблица lin22(i / 255) для байтов проходов: то же значение, что Math.pow, без возведения в степень на пиксель. */
export const LIN8 = (() => { const t = new Float64Array(256); for (let i = 0; i < 256; i++) t[i] = Math.pow(i / 255, 2.2); return t; })();
/** Python-округление (банковское на .5) — радиусы SSAO как в исходном render.py. */
export const pyRound = (v) => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 ? r - 1 : r; };
/** Доля 0..1 → байт (с отсечением). */
export const byte01 = (v) => Math.round(clamp01(v) * 255);
/** Серая непрозрачная картинка RGBA n пикселей: яркость f(i) (0..1). */
export function grayToRGBA(n, f) {
  const d = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = byte01(f(i)); d[i * 4 + 3] = 255; }
  return d;
}
/** Непрозрачная RGBA из тройки на пиксель (Float32 0..1). */
export function rgbToRGBA(rgb3, n) {
  const d = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { for (let c = 0; c < 3; c++) d[i * 4 + c] = byte01(rgb3[i * 3 + c]); d[i * 4 + 3] = 255; }
  return d;
}
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

/**
 * Склеить картинки RGBA в ряд (vertical — столбиком) через gap пикселей фона bg; полупрозрачные — поверх фона.
 * Превью и листы отладки (sideBySide, stackV).
 */
export function tileImages(imgs, { gap = 8, bg = [34, 34, 34, 255], vertical = false } = {}) {
  const along = vertical ? 'height' : 'width', across = vertical ? 'width' : 'height';
  const A = imgs.reduce((s, i) => s + i[along], 0) + gap * (imgs.length - 1), B = Math.max(...imgs.map((i) => i[across]));
  const w = vertical ? B : A, h = vertical ? A : B, data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(bg, i * 4);
  let off = 0;
  for (const im of imgs) {
    const ox = vertical ? 0 : off, oy = vertical ? off : 0;
    for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
      const s = (y * im.width + x) * 4, d = ((oy + y) * w + ox + x) * 4, a = im.data[s + 3] / 255;
      for (let c = 0; c < 3; c++) data[d + c] = im.data[s + c] * a + data[d + c] * (1 - a);
      data[d + 3] = 255;
    }
    off += im[along] + gap;
  }
  return { width: w, height: h, data };
}
/** Картинки друг под другом (лист отладки). */
export const stackV = (imgs, gap = 8) => tileImages(imgs, { gap, vertical: true });
