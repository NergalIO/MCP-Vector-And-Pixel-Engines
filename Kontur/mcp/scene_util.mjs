// Мелочи над сценой для модулей MCP: поиск узла по id, общий свет по умолчанию.
import { parseColor } from '../engine/kontur.js';

/** Узел по id (или undefined). */
export const nodeById = (scene, id) => scene.nodes.find((n) => n.id === id);
/** Узел по id; нет — ошибка «Узел … не найден». */
export function needNode(scene, id) {
  const n = nodeById(scene, id);
  if (!n) throw new Error(`Узел ${id} не найден`);
  return n;
}

/** Общий свет сцены по умолчанию (scene.ambient). */
export const DEFAULT_AMBIENT = '#4a4f5c';
const AMBIENT_FALLBACK = [0.29, 0.31, 0.36];
/** Общий свет [r, g, b] 0..1: override, иначе scene.ambient, иначе по умолчанию; неразборчивый цвет — значение по умолчанию. */
export function ambientRGB(scene, override) {
  const c = parseColor(override || scene?.ambient || DEFAULT_AMBIENT);
  return c ? c.slice(0, 3) : AMBIENT_FALLBACK.slice();
}
