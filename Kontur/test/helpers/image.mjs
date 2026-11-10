// Сравнение кадров по пикселям.

/**
 * Разница двух буферов RGBA (или любых с шагом stride на пиксель).
 * channels — сколько первых каналов пикселя сравнивать (3 — без альфы);
 * big — порог: bigPx считает пиксели, у которых наибольшая разница по каналам больше big.
 * → { sum — сумма |a−b|, max — наибольшая |a−b|, count — каналов с отличием, bigPx, px — пикселей, mean — sum на канал }
 */
export function imageDiff(a, b, { channels = 4, stride = 4, big = Infinity } = {}) {
  let sum = 0, max = 0, count = 0, bigPx = 0;
  for (let i = 0; i < a.length; i += stride) {
    let m = 0;
    for (let c = 0; c < channels && i + c < a.length; c++) {
      const d = Math.abs(a[i + c] - b[i + c]);
      sum += d;
      if (d) count++;
      if (d > m) m = d;
    }
    if (m > max) max = m;
    if (m > big) bigPx++;
  }
  const px = a.length / stride;
  return { sum, max, count, bigPx, px, mean: sum / (px * channels) };
}
