// Kontur world3d — Камера сцены (cameraModel ядра) и её подбор, обратная проекция.
import { cameraModel, CAMERA3D_DEFAULT } from '../kontur.js';
import { add, mul, dot } from './geom.js';

/* ============================== КАМЕРА ============================== */
export const CAMERA_DEFAULT = CAMERA3D_DEFAULT;
/**
 * Камера сцены (cameraModel ядра): без поворота P([X,Y,Z]) = [cx + f·X/(Z+dz), hor + f·(camH − Y)/(Z+dz)];
 * yaw, pitch, keepVerticals — поворот и наклон (см. cameraModel).
 */
export function camera(cam = {}, W = 1920) {
  const c = cameraModel(cam, W);
  const { f, dz } = c;
  return {
    ...c,
    charPx: (Z, h = 1.7) => (f * h) / (Z + dz),
    sw: (Z) => Math.max(1.2, Math.min(5, (f * 0.0096) / (Z + dz))),
    pxPerUnit: (Z) => f / (Z + dz),
  };
}
/** Подбор камеры: рост персонажа charPx у нижнего края кадра (экранная Y = bottom) и горизонт hor. */
export function fitCamera({ width = 1920, height = 1080, hor = Math.round(height * 0.26), charPx = Math.round(height * 0.3), bottom = height, charH = 1.7, f, dz = 2.5 } = {}) {
  const camH = (charH * (bottom - hor)) / charPx;
  f = f ?? Math.round(width * 0.6);
  return { hor, f, camH: +camH.toFixed(3), dz, cx: width / 2 };
}
/** Точка пересечения луча через пиксель с плоскостью [nx,ny,nz,d] или null. */
export function unproject(cam, x, y, plane) {
  const c = cam.P ? cam : camera(cam);
  const dir = c.ray(x, y), n = plane.slice(0, 3), den = dot(n, dir);
  if (Math.abs(den) < 1e-6) return null;
  const t = (plane[3] - dot(n, c.pos)) / den;
  return t > 0 ? add(c.pos, mul(dir, t)) : null;
}
