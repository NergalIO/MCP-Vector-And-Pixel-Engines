// Kontur world3d — Детерминированная случайность (Парк — Миллер): общий поток, подсиды hashSeed, withSeed.

import { makeRng, pmStep } from '../kontur.js';

export { makeRng };
let seed = 1;
export const rnd = () => (seed = pmStep(seed)) / 2147483647;
export const reseed = (s) => { seed = Math.max(1, Math.round(s) % 2147483647); };
/**
 * Выполнить fn с последовательностью ГСЧ от сида s и вернуть прежнее состояние после: вложенные и
 * последовательные постройки не сбивают друг другу случайные числа (результат зависит только от своего сида).
 */
/**
 * Подсид: детерминированный хэш (сид, ключ) → сид ГСЧ. Мир версии 2 даёт свой подсид каждому предмету
 * (hashSeed(seed, id ?? номер)) и каждой грани внутри предмета — правка одного предмета и смена камеры
 * не сдвигают случайные числа остальных.
 */
export function hashSeed(s, k) {
  let h = (Math.round(s) ^ 0x9e3779b9) >>> 0;
  const str = String(k);
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) % 2147483646 + 1;
}
export function withSeed(s, fn) {
  const prev = seed;
  reseed(s);
  try { return fn(); } finally { seed = prev; }
}
