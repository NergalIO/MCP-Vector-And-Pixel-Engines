// Kontur → Unity: общие вещи экспорта — GUID, поиск проекта, перевод света и режимов наложения.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep, basename } from 'node:path';
import { toLin, toGam } from '../engine/kontur.js';
import { crc32 as crc32Bytes } from './normals.mjs';
import { posixRel } from './paths.mjs';

/** CRC32 строки (UTF-8) — так Unity хеширует путь объекта в привязках анимации. Своя: zlib.crc32 есть только с Node 20.15. */
export const crc32 = (s) => crc32Bytes(Buffer.from(String(s), 'utf8'));

/** Стабильный GUID Unity (32 hex) из строки: повторный экспорт в то же место даёт те же GUID — ссылки в сценах не рвутся. */
export const guidOf = (key) => createHash('md5').update('kontur:' + key).digest('hex');

/** Стабильный fileID объекта внутри файла Unity (положительное 63-битное число). */
export function fileIdOf(key) {
  const h = createHash('md5').update('kontur-fid:' + key).digest();
  let v = h.readBigUInt64BE(0) & 0x3fffffffffffffffn;
  if (v < 100000n) v += 100000n;
  return v.toString();
}

/** Папка Assets проекта Unity, внутри которой лежит dir (или null). */
export function unityAssetsRoot(dir) {
  let d = resolve(dir);
  for (;;) {
    if (basename(d) === 'Assets' && existsSync(join(dirname(d), 'ProjectSettings'))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}
/**
 * Ключ для GUID: путь относительно Assets (если проект найден), иначе полный путь —
 * чтобы две сцены, выгруженные вне проекта в одноимённые папки, не получили одинаковых GUID.
 */
export function assetKey(file, assetsRoot) {
  return assetsRoot ? posixRel(assetsRoot, resolve(file)) : ('abs:' + resolve(file)).split(sep).join('/');
}

/**
 * Спад света URP 2D: яркость = t^e, t = 1 − d/радиус, e = ln(1 − b) / ln(b), b = 0.25 + falloffIntensity / 2
 * (Light2DLookupTexture.CreateFalloffLookupTexture). В Kontur яркость = t^falloff → подбираем falloffIntensity.
 */
export function urpFalloffIntensity(falloff = 1) {
  const e = Math.min(4.8, Math.max(0.21, falloff));
  const expOf = (b) => Math.log(1 - b) / Math.log(b);
  let lo = 0.2501, hi = 0.7499;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (expOf(m) < e) lo = m; else hi = m; }
  return Math.round(((lo + hi) / 2 - 0.25) * 2 * 1e4) / 1e4;
}

/** Цветовое пространство проекта: 'linear' (по умолчанию в Unity 6) или 'gamma' — из ProjectSettings. */
export function unityColorSpace(assetsRoot) {
  if (!assetsRoot) return 'linear';
  const f = join(dirname(assetsRoot), 'ProjectSettings', 'ProjectSettings.asset');
  if (!existsSync(f)) return 'linear';
  const m = /m_ActiveColorSpace:\s*(\d)/.exec(readFileSync(f, 'utf8'));
  return m && m[1] === '0' ? 'gamma' : 'linear';
}

/** sRGB ↔ линейные значения (точные формулы sRGB — toLin/toGam движка). */
export const srgbToLinear = toLin, linearToSrgb = toGam;

/*
 * Свет Kontur → URP 2D. Как считает URP (сверено с исходниками URP 17 и рендером Unity 6):
 *   итог_lin = цвет_спрайта_lin × (ambient + Σ intensity · цвет · спад · N·L),
 * где цвет общего света и цвет×intensity точечного берутся как есть (без перевода в линейные значения —
 * Light2DManager, RendererLighting), спад читается из sRGB-текстуры (Light2DLookupTexture, R8G8B8A8_SRGB):
 *   спад = lin((1 − d/r)^e), e = ln(1 − b) / ln(b), b = 0.25 + falloffIntensity / 2; N·L — только с картами нормалей.
 * Kontur (render lit): итог_sRGB = цвет_sRGB × (ambient + energy · цвет · (1 − d/r)^falloff · N·L).
 * В Gamma-проекте модели совпадают (без карт нормалей — точно). В Linear-проекте значения подбираются:
 * так, чтобы итог был ближе всего к Kontur для тёмных, средних и светлых поверхностей по всему радиусу
 * (с весом по площади кольца). Цвета в инспекторе Unity поэтому темнее, чем в Kontur, — это ожидаемо.
 */
const ALBEDO = [0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9];

/** Общий свет: значение цвета для URP на канал. */
export function urpAmbient(rgb, linear = true) {
  if (!linear) return rgb.slice(0, 3);
  return rgb.slice(0, 3).map((A) => {
    if (A <= 0) return 0;
    let best = null;
    const tryW = (w) => { let s = 0; for (const al of ALBEDO) s += Math.abs(linearToSrgb(Math.min(1, srgbToLinear(al) * w)) - Math.min(1, al * A)); if (!best || s < best.s) best = { s, w }; };
    for (let w = 0; w <= 2 * A + 0.05; w += 0.002) tryW(w);
    for (let w = best.w - 0.002; w <= best.w + 0.002; w += 0.0001) tryW(w);
    return Math.round(best.w * 1e5) / 1e5;
  });
}

/**
 * Точечный свет: intensity, falloffIntensity и цвет для URP.
 * ambient и color — [r, g, b] Kontur (0…1), ambientW — то, что получилось у urpAmbient.
 */
export function fitUrpLight({ ambient = [0.3, 0.3, 0.3], ambientW, color = [1, 1, 1], energy = 1, falloff = 1, z = 80, radius = 500, normals = false, linear = true }) {
  const E = Math.max(0, energy), r = Math.max(1, radius), C = color.slice(0, 3);
  const AW = ambientW || urpAmbient(ambient, linear);
  if (E === 0 || (!linear && !normals)) return { intensity: E, falloffIntensity: urpFalloffIntensity(falloff), exponent: falloff, color: C };
  const lin = linear ? srgbToLinear : (v) => v, out = linear ? linearToSrgb : (v) => v;
  const samples = [];
  for (let t = 0.01; t < 1; t += 0.02) { const d = r * (1 - t), nl = z / Math.hypot(d, z); samples.push({ t, w: 1 - t + 0.05, nl }); }
  const albedo = ALBEDO.map((al) => ({ al, alL: lin(al) }));
  // ошибка канала: Kontur (ambient A, свет E·c) против URP (ambient Aw, свет I·q)
  const errOf = (A, Aw, Ec, Iq, e) => {
    let s = 0;
    for (const { t, w, nl } of samples) {
      const ks = A + Ec * t ** falloff * nl;
      const kl = Aw + Iq * lin(t ** e) * (normals ? nl : 1);
      for (const { al, alL } of albedo) s += w * Math.abs(Math.min(1, al * ks) - out(Math.min(1, alL * kl)));
    }
    return s;
  };
  // 1) intensity и спад — по самому яркому каналу цвета света
  const m = C.indexOf(Math.max(...C)), cm = Math.max(1e-3, C[m]);
  const I0 = linear ? (E * cm) ** 2.2 : E * cm;
  let best = null;
  const search = (e0, e1, de, k0, k1, dk) => {
    for (let e = e0; e <= e1 + 1e-9; e += de) for (let k = k0; k <= k1 + 1e-9; k += dk) {
      const ee = Math.min(4.8, Math.max(0.21, e)), I = I0 * Math.max(0.02, k);
      const v = errOf(ambient[m], AW[m], E * cm, I, ee);
      if (!best || v < best.v) best = { v, I, e: ee, k };
    }
  };
  search(0.21, 4.8, 0.1, 0.2, 3, 0.1);
  search(best.e - 0.1, best.e + 0.1, 0.01, best.k - 0.1, best.k + 0.1, 0.01);
  // 2) остальные каналы цвета: доля от яркого (0…1) при найденных intensity и спаде
  const q = C.map((c, i) => {
    if (i === m) return 1;
    let bq = null;
    for (let x = 0; x <= 1.0001; x += 0.01) { const v = errOf(ambient[i], AW[i], E * c, best.I * x, best.e); if (!bq || v < bq.v) bq = { v, x }; }
    return Math.round(bq.x * 100) / 100;
  });
  return { intensity: Math.round(best.I * 1e4) / 1e4, falloffIntensity: urpFalloffIntensity(best.e), exponent: Math.round(best.e * 100) / 100, color: q };
}

/**
 * Режимы наложения → настройки материала Kontur/Sprite Blend.
 * BlendMode: Zero 0, One 1, DstColor 2, SrcColor 3, OneMinusDstColor 4, SrcAlpha 5, OneMinusSrcColor 6, DstAlpha 7, OneMinusDstAlpha 8, OneMinusSrcAlpha 10
 * BlendOp: Add 0, ReverseSubtract 2, Min 3, Max 4.  prep (см. KonturBlend.shader): 0 — цвет×альфа, 1 — множитель фона, 2 — удвоенный множитель, 3 — осветление,
 * 4 — добавка света, curve — степень для Linear-проекта (подобрана по сетке фон×цвет×альфа против sRGB-формулы Kontur).
 */
export const UNITY_BLEND = {
  multiply: { src: 2, dst: 0, op: 0, prep: 1, exact: true },
  screen: { src: 1, dst: 6, op: 0, prep: 4, curve: 1.6, exact: true },
  'plus-lighter': { src: 1, dst: 1, op: 0, prep: 4, curve: 1.25, exact: false },
  lighten: { src: 1, dst: 1, op: 4, prep: 0, exact: false },
  darken: { src: 1, dst: 1, op: 3, prep: 1, exact: false },
  overlay: { src: 2, dst: 3, op: 0, prep: 2, exact: false },
  'soft-light': { src: 2, dst: 3, op: 0, prep: 2, exact: false },
  'hard-light': { src: 2, dst: 3, op: 0, prep: 2, exact: false },
  'color-dodge': { src: 2, dst: 1, op: 0, prep: 3, exact: false },
  difference: { src: 1, dst: 1, op: 2, prep: 0, exact: false },
};

/** Значения для YAML: числа без лишних нулей, строки — в кавычках, если нужно. */
export const num = (v) => { const r = Math.round(v * 1e6) / 1e6; return Object.is(r, -0) ? '0' : String(r); };
export const ystr = (s) => (/^[A-Za-z0-9_][A-Za-z0-9_ .-]*$/.test(s) && !/^(true|false|null|yes|no|~)$/i.test(s) ? s : JSON.stringify(s));
