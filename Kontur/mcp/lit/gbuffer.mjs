// G-буфер отложенного света: проходы renderSVG (color, normal, plane, planeD, emissive, ink, cover, matId, mask:<метка>)
// → маски, нормали (детали и плоскости), мировые позиции пикселей (луч камеры ∩ плоскость), глубина, блик.
// Камера — общая модель движка (cameraModel), та же, что у построителя мира.
import { cameraModel } from '../../engine/kontur.js';
import { decodePNG } from '../normals.mjs';
import { rows, NO_ARENA } from './pool.mjs';
import { Y601, unorm8 } from './util.mjs';
import { gpuResident } from './gpu.mjs';

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
export function buildGBuffer(scene, pngs, { W, H, chrTag, withMatId, arena = NO_ARENA }) {
  const W0 = scene.width, k = W / W0, n = W * H;
  const { imgOf, dec } = passReader(pngs, W, H);
  const alb = dec('color'), nrm = dec('normal'), pn = dec('plane'), pdm = dec('planeD'), em = dec('emissive'), ink = dec('ink'), cov = dec('cover'), chrD = dec(`mask:${chrTag}`);
  const midD = withMatId && pngs.matId ? dec('matId') : null;
  const cam = frameCamera(scene.camera3d, W0, k);
  // поля — в общей памяти: этапы читают их из воркеров пула без копирования
  // (из арены кадра; все поля, кроме mid, ядро перезаписывает целиком — без обнуления)
  const F = (n) => arena.f32(n, false);
  const mask = arena.u8(n, false), cover = arena.u8(n, false), chm = F(n), inkL = F(n);
  const Nx = F(n), Ny = F(n), Nz = F(n);
  const PNx = F(n), PNy = F(n), PNz = F(n);
  const Px = F(n), Py = F(n), Pz = F(n), spec = F(n), Dp = F(n);
  const mid = midD ? arena.u16(n) : null;
  // попиксельно — полосами строк на всех ядрах (камера восстанавливается в воркере по camera3d)
  rows(import.meta.url, kGBuffer, { c3: scene.camera3d, W0, k, W, pn, nrm, pdm, ink, cov, chrD, midD, mask, cover, chm, inkL, mid, Nx, Ny, Nz, PNx, PNy, PNz, Px, Py, Pz, spec, Dp }, H);
  const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2);
  return { arena, W, H, n, W0, H0: scene.height, k, hw, hh, hn: hw * hh, cam, imgOf, alb, em, mask, cover, chm, inkL, mid, Nx, Ny, Nz, PNx, PNy, PNz, Px, Py, Pz, Dp, spec };
}
const camMemo = new WeakMap();
/** Полоса строк y0…y1 G-буфера: маски, нормали, луч камеры ∩ плоскость пикселя → позиция и глубина. */
export function kGBuffer(a, y0, y1) {
  const { W, pn, nrm, pdm, ink, cov, chrD, midD, mask, cover, chm, inkL, mid, Nx, Ny, Nz, PNx, PNy, PNz, Px, Py, Pz, spec, Dp } = a;
  let cam = camMemo.get(a);
  if (!cam) camMemo.set(a, (cam = frameCamera(a.c3, a.W0, a.k)));
  const { camX, camY, camZ, plain, dz } = cam;
  const rd = [0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = i * 4;
    mask[i] = pn[o + 3] > 127.5 ? 1 : 0;
    cover[i] = cov[o] > 127 ? 1 : 0;
    chm[i] = Y601(chrD[o], chrD[o + 1], chrD[o + 2]) / 255;
    inkL[i] = Y601(ink[o], ink[o + 1], ink[o + 2]) / 255;
    if (mid && midD[o + 3] > 127) mid[i] = (midD[o] << 8) | midD[o + 1];
    let ax = unorm8(pn[o]), ay = unorm8(pn[o + 1]), az = unorm8(pn[o + 2]);
    const l = Math.hypot(ax, ay, az) + 1e-6;
    ax /= l; ay /= l; az /= l;
    PNx[i] = ax; PNy[i] = ay; PNz[i] = az;
    if (nrm[o + 3] > 127.5) { const bx = unorm8(nrm[o]), by = unorm8(nrm[o + 1]), bz = unorm8(nrm[o + 2]); const m = Math.hypot(bx, by, bz) + 1e-6; Nx[i] = bx / m; Ny[i] = by / m; Nz[i] = bz / m; }
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
}

/** Индекс полного кадра для пикселя (x, y) половинного (левый верхний из четвёрки, как в эскизах). */
export const fullIndex = (G, x, y) => 2 * y * G.W + 2 * x;

/**
 * Поле G-буфера в половинном разрешении (левый верхний пиксель четвёрки) — общее для этапов кадра (тени, AO, GI
 * брали одни и те же выборки каждый своим циклом). src — массив полного кадра (G.Px, G.mask…), outside — значение
 * вне маски (undefined — как есть). Результат запоминается на G и не изменяется; на GPU он резидентный (грузится
 * один раз на кадр). Поле, изменённое на месте (нормали после материалов), — forgetHalf.
 */
export function halfOf(G, src, outside) {
  const memo = G.halves || (G.halves = new Map());
  let byOut = memo.get(src);
  if (!byOut) memo.set(src, (byOut = new Map()));
  let h = byOut.get(outside);
  if (h) return h;
  const { W, hw, hh, hn, mask } = G;
  h = src instanceof Uint8Array ? G.arena.u8(hn, false) : G.arena.f32(hn, false); // заполняется целиком
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    const i = 2 * y * W + 2 * x, j = y * hw + x;
    h[j] = outside !== undefined && !mask[i] ? outside : src[i];
  }
  gpuResident(h);
  byOut.set(outside, h);
  return h;
}
/** Забыть половинные копии полей (после изменения полей на месте). */
export function forgetHalf(G, ...srcs) { for (const s of srcs) G.halves?.delete(s); }
/** Набор половинных полей по именам G: halves(G, 'mask', 'Dp', 'PNx') → [hm, hD, hx]. */
export const halves = (G, ...names) => names.map((k) => halfOf(G, G[k]));
