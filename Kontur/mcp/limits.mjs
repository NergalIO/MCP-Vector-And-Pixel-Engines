// @ts-check
// Пределы размеров растра: опечатка (width: 1e6) или чужая сцена не должны валить процесс MCP нехваткой памяти.
// Проверяются там, где выделяется растр: растеризация SVG, кадр отложенного света, увеличение, разбор PNG.
// Поднять: KONTUR_MAX_SIDE (px по стороне), KONTUR_MAX_PIXELS (пикселей в кадре).
const envNum = (name, def) => { const v = Number(process.env[name]); return Number.isFinite(v) && v > 0 ? v : def; };

/** Наибольшая сторона кадра, px. */
export const MAX_SIDE = envNum('KONTUR_MAX_SIDE', 16384);
/** Наибольшая площадь кадра, пикселей (64 Мпикс: 8K — 33 Мпикс). */
export const MAX_PIXELS = envNum('KONTUR_MAX_PIXELS', 64e6);

/** Наибольший размер картинки, которую принимают image_add и загрузка из студии, байт. */
export const MAX_IMAGE_BYTES = 40e6;

/** Бросить понятную ошибку, если растр w×h не помещается в пределы. what — что считается («кадр», «PNG»). */
export function checkRaster(w, h, what = 'кадр') {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error(`${what}: неверный размер ${w}×${h}`);
  if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_PIXELS) {
    throw new Error(`${what} ${Math.round(w)}×${Math.round(h)} больше предела: ${MAX_SIDE} px по стороне и ${MAX_PIXELS / 1e6} Мпикс (KONTUR_MAX_SIDE, KONTUR_MAX_PIXELS)`);
  }
}
