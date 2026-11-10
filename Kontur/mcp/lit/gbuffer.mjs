// G-буфер отложенного света: проходы renderSVG (color, normal, plane, planeD, emissive, ink, cover, matId, mask:<метка>)
// → маски, нормали (детали и плоскости), мировые позиции пикселей (луч камеры ∩ плоскость), глубина, блик.
// Камера — общая модель движка (cameraModel), та же, что у построителя мира.
import { cameraModel } from '../../engine/kontur.js';
import { decodePNG } from '../normals.mjs';
import { f32, u8, u16 } from './pool.mjs';

/**
 * Камера кадра шириной W (k = W / W0): фокус, горизонт, центр, позиция и оси; ray(x, y, out) — направление луча
 * через центр пикселя (не нормированное: для плоской камеры z = 1), proj — мир → [x, y, глубина вдоль оси].
 */
export function frameCamera(c3, W0, k) {
  const cm = cameraModel({ dz: 0, ...c3 }, W0);
  const f = cm.f * k, hor = cm.horEff * k, cx = cm.cx * k, plain = cm.plain, CR = cm.right, CU = cm.up, CF = cm.fwd;
  const [camX, camY, camZ] = cm.pos;
  const ray = plain
    ? (x, y, out) => { out[0] = (x + 0.5 - cx) / f; out[1] = -(y + 0.5 - hor) / f; out[2] = 1; return out; }
    : (x, y, out) => {
      const a = (x + 0.5 - cx) / f, b = -(y + 0.5 - hor) / f;
      out[0] = a * CR[0] + b * CU[0] + CF[0]; out[1] = a * CR[1] + b * CU[1] + CF[1]; out[2] = a * CR[2] + b * CU[2] + CF[2];
      return out;
    };
  return { cm, f, hor, cx, camH: cm.camH, dz: cm.dz, camX, camY, camZ, plain, CR, CU, CF, proj: cm.projector(k), ray };
}

/** Проходы → RGBA-байты нужного размера (готовые PNG от вызывающего или RGBA-картинки). */
export function passReader(pngs, W, H) {
  const imgOf = (m) => (pngs[m]?.data && pngs[m].width ? pngs[m] : decodePNG(pngs[m]));
  const dec = (m) => { const im = imgOf(m); if (im.width !== W || im.height !== H) throw new Error(`проход ${m}: ${im.width}×${im.height} вместо ${W}×${H}`); return im.data; };
  return { imgOf, dec };
}

/**
 * Собрать G-буфер. Возвращает поля (Float32/Uint8, по пикселю):
 * mask (есть поверхность), cover (покрыт узлом), chm (маска персонажей 0..1), inkL (яркость прохода ink), mid (номер
 * материала), N* (нормаль с рельефом), PN* (нормаль плоскости), P* (позиция, м), Dp (глубина), spec (блик), alb, em.
 */
export function buildGBuffer(scene, pngs, { W, H, chrTag, withMatId }) {
  const W0 = scene.width, k = W / W0, n = W * H;
  const { imgOf, dec } = passReader(pngs, W, H);
  const alb = dec('color'), nrm = dec('normal'), pn = dec('plane'), pdm = dec('planeD'), em = dec('emissive'), ink = dec('ink'), cov = dec('cover'), chrD = dec(`mask:${chrTag}`);
  const midD = withMatId && pngs.matId ? dec('matId') : null;
  const cam = frameCamera(scene.camera3d, W0, k);
  const { camX, camY, camZ, plain, dz } = cam;
  // поля — в общей памяти: этапы читают их из воркеров пула без копирования
  const mask = u8(n), cover = u8(n), chm = f32(n), inkL = f32(n);
  const Nx = f32(n), Ny = f32(n), Nz = f32(n);
  const PNx = f32(n), PNy = f32(n), PNz = f32(n);
  const Px = f32(n), Py = f32(n), Pz = f32(n), spec = f32(n), Dp = f32(n);
  const mid = midD ? u16(n) : null;
  const rd = [0, 0, 0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = i * 4;
    mask[i] = pn[o + 3] > 127.5 ? 1 : 0;
    cover[i] = cov[o] > 127 ? 1 : 0;
    chm[i] = (0.299 * chrD[o] + 0.587 * chrD[o + 1] + 0.114 * chrD[o + 2]) / 255;
    inkL[i] = (0.299 * ink[o] + 0.587 * ink[o + 1] + 0.114 * ink[o + 2]) / 255;
    if (mid && midD[o + 3] > 127) mid[i] = (midD[o] << 8) | midD[o + 1];
    let ax = pn[o] / 127.5 - 1, ay = pn[o + 1] / 127.5 - 1, az = pn[o + 2] / 127.5 - 1;
    const l = Math.hypot(ax, ay, az) + 1e-6;
    ax /= l; ay /= l; az /= l;
    PNx[i] = ax; PNy[i] = ay; PNz[i] = az;
    if (nrm[o + 3] > 127.5) { const bx = nrm[o] / 127.5 - 1, by = nrm[o + 1] / 127.5 - 1, bz = nrm[o + 2] / 127.5 - 1; const m = Math.hypot(bx, by, bz) + 1e-6; Nx[i] = bx / m; Ny[i] = by / m; Nz[i] = bz / m; }
    else { Nx[i] = ax; Ny[i] = ay; Nz[i] = az; }
    const d = ((pdm[o] << 8) + pdm[o + 1]) / 100 - 200;
    spec[i] = pdm[o + 2] / 255;
    cam.ray(x, y, rd);
    const dx = rd[0], dy = rd[1], dzz = rd[2];
    let den = ax * dx + ay * dy + az * dzz;
    if (Math.abs(den) < 1e-4) den = den < 0 ? -1e-4 : 1e-4;
    let tt = (d - (ax * camX + ay * camY + az * camZ)) / den;
    if (!(mask[i] && tt > 0)) tt = 1e4;
    Px[i] = camX + dx * tt; Py[i] = camY + dy * tt; Pz[i] = camZ + dzz * tt;
    Dp[i] = plain ? Pz[i] + dz : tt;
  }
  const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2);
  return { W, H, n, W0, H0: scene.height, k, hw, hh, hn: hw * hh, cam, imgOf, alb, em, mask, cover, chm, inkL, mid, Nx, Ny, Nz, PNx, PNy, PNz, Px, Py, Pz, Dp, spec };
}

/** Индекс полного кадра для пикселя (x, y) половинного (левый верхний из четвёрки, как в эскизах). */
export const fullIndex = (G, x, y) => 2 * y * G.W + 2 * x;
