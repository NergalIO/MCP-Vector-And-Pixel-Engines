/** Пиксельный режим: палитра. */
import { parseColor } from './color.js';

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
