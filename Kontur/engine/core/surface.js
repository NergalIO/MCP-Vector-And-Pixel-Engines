/** Поверхности и проходы отложенного света (2.5D), камера 2.5D. */
import { parseColor } from './color.js';
import { DEG, clamp, fmt, hashStr, mat, vec3 } from './math.js';
import { isGrad, normStops } from './tracks.js';
import { memoByObject } from './cache.js';

/** Настройки рельефа по умолчанию (режим высот для карт нормалей). */
export const RELIEF_DEFAULT = { height: 0.5, depth: 0.3, bevel: 8, profile: 'round', luma: 0.25, background: 0 };
export function paintAlpha(v) {
  if (!v || v === 'none') return 0;
  if (typeof v === 'string') { const c = parseColor(v); return c ? c[3] : 1; }
  if (isGrad(v)) return Math.max(...normStops(v.stops).map((st) => (st.opacity ?? 1) * (parseColor(st.color)?.[3] ?? 1)));
  return 1;
}
export const grayHex = (v) => { const c = Math.round(clamp(v) * 255).toString(16).padStart(2, '0'); return `#${c}${c}${c}`; };
export function heightFilter(ctx, rel, isImage, region = null) {
  const key = `h|${rel.height}|${rel.depth}|${rel.bevel}|${rel.profile}|${rel.invert ? 1 : 0}|${isImage ? rel.luma : 0}|${region ? region.join(',') : ''}`;
  if (ctx.patterns.has(key)) return ctx.reuse(key);
  const id = `${ctx.prefix}-hf${hashStr(key)}`;
  const base = rel.height, d = (rel.invert ? -1 : 1) * rel.depth;
  const prims = [];
  const exp = { round: 0.5, linear: 1, sharp: 2 }[rel.profile];
  if (rel.profile === 'flat' || !(rel.bevel > 0) || !exp) {
    prims.push({ tag: 'feFlood', attrs: { 'flood-color': grayHex(base + d), result: 'h' } });
  } else {
    prims.push({ tag: 'feGaussianBlur', attrs: { in: 'SourceAlpha', stdDeviation: fmt(rel.bevel / 2), result: 'b' } });
    prims.push({ tag: 'feComponentTransfer', attrs: { in: 'b', result: 'p1' }, children: [{ tag: 'feFuncA', attrs: { type: 'linear', slope: 2, intercept: -1 } }] });
    prims.push({ tag: 'feComponentTransfer', attrs: { in: 'p1', result: 'p' }, children: [{ tag: 'feFuncA', attrs: { type: 'gamma', amplitude: 1, exponent: exp, offset: 0 } }] });
    const row = `0 0 0 ${fmt(d)} ${fmt(base)}`;
    prims.push({ tag: 'feColorMatrix', attrs: { in: 'p', type: 'matrix', values: `${row} ${row} ${row} 0 0 0 0 1`, result: 'h' } });
  }
  let last = 'h';
  if (isImage && rel.luma) {
    const k = rel.luma, r = `${fmt(0.2126 * k)} ${fmt(0.7152 * k)} ${fmt(0.0722 * k)} 0 ${fmt(-k / 2)}`;
    prims.push({ tag: 'feColorMatrix', attrs: { in: 'SourceGraphic', type: 'matrix', values: `${r} ${r} ${r} 0 0 0 0 1`, result: 'l' } });
    prims.push({ tag: 'feComposite', attrs: { in: 'h', in2: 'l', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'h2' } });
    last = 'h2';
  }
  prims.push({ tag: 'feComposite', attrs: { in: last, in2: 'SourceAlpha', operator: 'in' } });
  // область фильтра: доли рамки или явный прямоугольник (у кадра спрайт-листа рамка неоднозначна)
  const area = region ? { filterUnits: 'userSpaceOnUse', x: fmt(region[0]), y: fmt(region[1]), width: fmt(region[2]), height: fmt(region[3]) } : { x: '-20%', y: '-20%', width: '140%', height: '140%' };
  const def = { tag: 'filter', attrs: { id, ...area, 'color-interpolation-filters': 'sRGB' }, children: prims };
  return ctx.share(key, def);
}

/* ---------- поверхности и проходы отложенного света ----------
 * surface узла: { normal, normalGrad, tilt: [du, dv, k], plane: [nx, ny, nz, d], u, v, spec, emissive, mat, base, bump, ink, sw, tag, sky }.
 * normal — нормаль для света (может быть наклонена: рельеф), plane — плоскость n·P = d для восстановления позиции.
 * normalGrad — градиент нормали внутри узла (скругления): слой или массив слоёв, см. normalGradLayers.
 * mat — имя материала из scene.materials (проход matId: номер материала для попиксельных деталей).
 * Наследуются детьми: plane, normal, normalGrad, u, v, spec, emissive, mat, tag, sky. Только свои: base, bump, ink, sw, tilt.
 */
/**
 * Режимы рендера (стратегии кадра): data — проход с данными для отложенного света (не цвет), bg — фон прохода,
 * crisp — без сглаживания краёв (смешанный край дал бы мусорные данные), cache — можно брать статичные поддеревья
 * из кэша кадра. Маски mask:<метка> — отдельная запись MASK_MODE. Новый режим — registerRenderMode.
 */
export const RENDER_MODES = {
  color: { data: false, cache: true },
  height: { data: false },
  normal: { data: true, bg: null, crisp: true },
  plane: { data: true, bg: null, crisp: true },
  planeD: { data: true, bg: null, crisp: true },
  emissive: { data: true, bg: '#000000' },
  ink: { data: true, bg: '#ffffff' },
  cover: { data: true, bg: '#000000' },
  matId: { data: true, bg: null, crisp: true },
};
export const MASK_MODE = { data: true, bg: '#000000' };
/** Описание режима (неизвестный — как color). */
export const modeInfo = (m) => RENDER_MODES[m] || (typeof m === 'string' && m.startsWith('mask:') && m.length > 5 ? MASK_MODE : RENDER_MODES.color);
export function registerRenderMode(name, def) { RENDER_MODES[name] = { data: true, bg: null, ...def }; if (RENDER_MODES[name].data && !PASS_MODES.includes(name)) PASS_MODES.push(name); PASS_BG[name] = RENDER_MODES[name].bg ?? null; }
export const PASS_MODES = Object.keys(RENDER_MODES).filter((k) => RENDER_MODES[k].data);
/** Фон проходов: данные — прозрачный, свечение и маски — чёрный, контур — белый. */
export const PASS_BG = Object.fromEntries(PASS_MODES.map((k) => [k, RENDER_MODES[k].bg ?? null]));
export const isPassMode = (m) => PASS_MODES.includes(m) || (typeof m === 'string' && m.startsWith('mask:') && m.length > 5);
export const SURF_INHERIT = ['plane', 'normal', 'normalGrad', 'u', 'v', 'spec', 'emissive', 'mat', 'tag', 'sky'];
export const v3 = vec3;
export const isVec3 = (a) => Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every((x) => typeof x === 'number' && Number.isFinite(x));
/** Оси грани по нормали: u — «вдоль» (горизонталь), v — «вверх по грани». Для пола u = X, v = +Z (вглубь). */
export function surfaceAxes(n) {
  n = v3.norm(n);
  let u = v3.cross(n, [0, 1, 0]);
  if (Math.hypot(...u) < 1e-4) return { u: [1, 0, 0], v: n[1] > 0 ? [0, 0, 1] : [0, 0, -1] };
  u = v3.norm(u);
  return { u, v: v3.norm(v3.cross(u, n)) };
}
/**
 * Действующая поверхность узла: наследуемое от предков + своё. own === false — узел без поверхности.
 * Чистая функция пары объектов: результат запоминается (WeakMap по родителю, затем по своей), поэтому у статичных
 * узлов поверхность каждого кадра и прохода — тот же объект. Результат не изменять.
 */
const surfMemo = new WeakMap();
const NO_SURF = {};
export function resolveSurface(parent, own) {
  if (own === false) return null;
  if (own != null && typeof own !== 'object') return resolveSurfaceRaw(parent, own);
  const pk = parent || NO_SURF;
  let m = surfMemo.get(pk);
  if (!m) surfMemo.set(pk, (m = new WeakMap()));
  const ok = own || NO_SURF;
  let s = m.get(ok);
  if (s === undefined) m.set(ok, (s = resolveSurfaceRaw(parent, own)));
  return s;
}
function resolveSurfaceRaw(parent, own) {
  const s = {};
  if (parent) for (const k of SURF_INHERIT) if (parent[k] !== undefined) s[k] = parent[k];
  const has = own && typeof own === 'object';
  if (!has && !parent) return null;
  if (has) for (const k in own) if (k !== 'tilt') s[k] = own[k];
  // своя нормаль или наклон перекрывают унаследованный градиент
  if (has && own.normalGrad === undefined && (own.normal || own.tilt)) delete s.normalGrad;
  if (s.normalGrad === null || s.normalGrad === false) delete s.normalGrad;
  if (has && own.plane === 'inherit') s.plane = parent?.plane;
  if (s.plane && !isVec3(s.plane)) delete s.plane;
  const pn = s.plane ? v3.norm(s.plane) : null;
  if (s.normal && !isVec3(s.normal)) delete s.normal;
  if (has && Array.isArray(own.tilt)) {
    const n0 = v3.norm(own.normal || parent?.normal || pn || [0, 0, -1]);
    const ax = surfaceAxes(pn || n0);
    const u = isVec3(s.u) ? s.u : ax.u, v = isVec3(s.v) ? s.v : ax.v;
    const [du = 0, dv = 0, k = 0.75] = own.tilt;
    s.normal = v3.norm(v3.add(n0, v3.add(v3.mul(u, du * k), v3.mul(v, dv * k))));
  }
  if (!s.normal && pn) s.normal = pn;
  if (s.normal) s.normal = v3.norm(s.normal);
  s.base = !!(has && own.base);
  s.bump = has ? (own.bump ?? !!(own.normal || own.tilt)) : false;
  s.ink = !!(has && own.ink);
  if (!has || own.sw == null) delete s.sw;
  return s;
}
export const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
/** Нормаль → цвет: rgb((n·0.5 + 0.5)·255). */
export const encodeNormal = (n) => '#' + [0, 1, 2].map((i) => hex2((clamp(n[i], -1, 1) * 0.5 + 0.5) * 255)).join('');
/** d плоскости 16 бит (R старший, G младший байт: q = round((d + 200)·100)) и сила блика в B. */
export function encodePlaneD(d, spec = 0.1) {
  const q = clamp(Math.round((d + 200) * 100), 0, 65535);
  return '#' + hex2(q >> 8) + hex2(q & 255) + hex2(clamp(spec) * 255);
}
/** Номер материала → цвет прохода matId: R — старший байт, G — младший, B — резерв. 0 — без материала. */
export const encodeMatId = (i) => '#' + hex2((i >> 8) & 255) + hex2(i & 255) + '00';
/** Таблица номеров материалов сцены: имя → 1, 2, … по порядку ключей scene.materials. */
export function materialIndex(scene) {
  const m = new Map();
  Object.keys(scene?.materials || {}).forEach((k, i) => m.set(k, i + 1));
  return m;
}
/**
 * Слои градиента нормали. Слой: { kind: 'linear', from: [x,y], to: [x,y], stops: [[t, [nx,ny,nz]], …], ch: 'xyz' }
 * или { kind: 'radial', c: [x,y], r: r | [rx, ry], stops, ch }, или { kind: 'sphere', c: [x,y], r: r | [rx, ry], flat }:
 * сфера или сплюснутый купол — три канальных слоя (x — линейно по X, y — по Y, z — радиально), смешиваются
 * через lighten, поэтому нормаль точна в каждой точке. ch — какие компоненты пишет слой (остальные — 0 в кодировке).
 */
export function normalGradLayers(ng) {
  const list = Array.isArray(ng) ? ng : ng ? [ng] : [];
  const out = [];
  for (const L of list) {
    if (!L || typeof L !== 'object') continue;
    if (L.kind === 'sphere') {
      const [cx, cy] = L.c || [0, 0], rx = Array.isArray(L.r) ? L.r[0] : L.r ?? 50, ry = Array.isArray(L.r) ? L.r[1] : L.r ?? 50;
      const k = 1 - clamp(L.flat ?? 0, 0, 0.98);
      // n ≈ (k·dx, −k·dy, −√(1 − dx² − dy²)), dx, dy ∈ [−1, 1]; компилятор нормирует
      const zs = [];
      for (let i = 0; i <= 10; i++) { const t = i / 10; zs.push([t, [0, 0, -Math.max(Math.sqrt(Math.max(0, 1 - t * t)), 1 - k)]]); }
      out.push({ kind: 'linear', from: [cx - rx, cy], to: [cx + rx, cy], ch: 'x', stops: [[0, [-k, 0, 0]], [1, [k, 0, 0]]] });
      out.push({ kind: 'linear', from: [cx, cy - ry], to: [cx, cy + ry], ch: 'y', stops: [[0, [0, k, 0]], [1, [0, -k, 0]]] });
      out.push({ kind: 'radial', c: [cx, cy], r: [rx, ry], ch: 'z', stops: zs });
      continue;
    }
    if (!Array.isArray(L.stops) || !L.stops.length) continue;
    out.push({ ...L, kind: L.kind === 'radial' ? 'radial' : 'linear', ch: L.ch || 'xyz' });
  }
  return out;
}
/** Краски слоёв градиента нормали в проходе normal: url(#…) на слой (первый — обычный, остальные — lighten). */
// слои с ключами общих определений: по объекту градиента (у статичного узла — один и тот же), без JSON на каждый кадр
const keyedLayers = memoByObject((ng) => normalGradLayers(ng).map((L) => ({ L, key: `ng|${JSON.stringify(L)}` })));
export function normalGradPaints(ctx, ng) {
  return keyedLayers(ng).map(({ L, key }) => {
    const keep = [L.ch.includes('x'), L.ch.includes('y'), L.ch.includes('z')];
    if (ctx.patterns.has(key)) return ctx.reuse(key);
    const stops = L.stops.map(([t, n]) => {
      const nn = keep[0] && keep[1] && keep[2] ? v3.norm(n) : n;
      const c = [0, 1, 2].map((i) => (keep[i] ? hex2((clamp(nn[i], -1, 1) * 0.5 + 0.5) * 255) : '00'));
      return { tag: 'stop', attrs: { offset: fmt(clamp(t)), 'stop-color': '#' + c.join('') } };
    });
    const id = `${ctx.prefix}-ng${hashStr(key)}`;
    if (L.kind === 'radial') {
      const [cx, cy] = L.c || [0, 0], rx = Array.isArray(L.r) ? L.r[0] : L.r ?? 50, ry = Array.isArray(L.r) ? L.r[1] : rx;
      const gt = Math.abs(rx - ry) > 1e-6 ? `translate(${fmt(cx)} ${fmt(cy)}) scale(1 ${fmt(ry / (rx || 1))}) translate(${fmt(-cx)} ${fmt(-cy)})` : null;
      return ctx.share(key, { tag: 'radialGradient', attrs: { id, gradientUnits: 'userSpaceOnUse', cx: fmt(cx), cy: fmt(cy), r: fmt(rx), fx: fmt(cx), fy: fmt(cy), gradientTransform: gt }, children: stops });
    }
    const [x1, y1] = L.from || [0, 0], [x2, y2] = L.to || [1, 0];
    return ctx.share(key, { tag: 'linearGradient', attrs: { id, gradientUnits: 'userSpaceOnUse', x1: fmt(x1), y1: fmt(y1), x2: fmt(x2), y2: fmt(y2) }, children: stops });
  });
}
/**
 * Матрица цвета для карты нормалей картинки: карта в соглашении 2D-движков (x вправо, y вверх, z к зрителю)
 * → мировые нормали прохода normal (x вправо, y вверх, z от камеры) с поворотом и отражением узла
 * (lin — линейная часть мировой матрицы [a, b, c, d]). Кодирование аффинное: c' = A(c − ½) + ½.
 */
export function normalMapMatrix(lin = [1, 0, 0, 1], { yUp = true } = {}) {
  const [a, b, c, d] = lin;
  // нормали преобразуются обратной транспонированной матрицей, нормируем на √|det|
  const det = a * d - b * c || 1e-9, s = Math.sqrt(Math.abs(det));
  const N = [(d / det) * s, (-c / det) * s, (-b / det) * s, (a / det) * s]; // [N00 N01; N10 N11], экранные оси (y вниз)
  const sy = yUp ? -1 : 1; // экранная y карты = −ty при yUp
  const A = [[N[0], N[1] * sy, 0], [-N[2], -N[3] * sy, 0], [0, 0, -1]];
  const rows = A.map((r) => `${fmt(r[0])} ${fmt(r[1])} ${fmt(r[2])} 0 ${fmt(0.5 * (1 - r[0] - r[1] - r[2]))}`);
  return `${rows.join(' ')} 0 0 0 1 0`;
}
/** Фильтр «матрица цвета, альфа порогом» — карты картинок в проходах данных. */
export function matrixFilter(ctx, values, region) {
  const key = `cm|${values}|${region.join(',')}`;
  if (ctx.patterns.has(key)) return ctx.reuse(key);
  const id = `${ctx.prefix}-cm${hashStr(key)}`;
  return ctx.share(key, { tag: 'filter', attrs: { id, filterUnits: 'userSpaceOnUse', x: fmt(region[0]), y: fmt(region[1]), width: fmt(region[2]), height: fmt(region[3]), 'color-interpolation-filters': 'sRGB' },
    children: [{ tag: 'feColorMatrix', attrs: { in: 'SourceGraphic', type: 'matrix', values } }, { tag: 'feComponentTransfer', attrs: {}, children: [{ tag: 'feFuncA', attrs: { type: 'discrete', tableValues: '0 1' } }] }] });
}
/** Линейная часть мировой матрицы после трансформации узла (поворот, наклон, масштаб). */
export function linOf(parent, rot, skx, sx, sy) {
  if (!rot && !skx && sx === 1 && sy === 1) return parent;
  const m = mat.compose({ rotation: rot || 0, skewX: skx || 0, scaleX: sx, scaleY: sy });
  const [a, b, c, d] = parent;
  return [a * m[0] + c * m[1], b * m[0] + d * m[1], a * m[2] + c * m[3], b * m[2] + d * m[3]];
}
export const isMaskTag = (s, tag) => s && (s.tag === tag || (Array.isArray(s.tag) && s.tag.includes(tag)));
/**
 * Цвет фигуры в проходе (null — не рисовать). op — итоговая непрозрачность.
 * Узел без surface: в проходах данных не пишется (освещается как поверхность за ним), в emissive/mask/ink — перекрывает.
 */
export function dataPaint(ctx, s, op) {
  const m = ctx.mode, opaque = op >= 0.999, half = op >= 0.5;
  if (!s) {
    if (m === 'ink') return opaque ? '#ffffff' : null;
    if (m === 'cover') return half ? '#ffffff' : null;
    if (m === 'emissive' || ctx.maskTag) return opaque ? '#000000' : null;
    return null;
  }
  switch (m) {
    case 'normal': return (s.base || s.bump) && half && !s.geo && (s.normal || s.normalGrad) ? encodeNormal(s.normal || [0, 0, -1]) : null;
    case 'plane': return s.base && s.plane ? encodeNormal(v3.norm(s.plane)) : null;
    case 'planeD': return (s.base || (s.bump && half)) && s.plane ? encodePlaneD(s.plane[3], s.spec ?? 0.1) : null;
    case 'emissive': return s.geo ? null : s.emissive && s.emissive !== 'none' ? s.emissive : s.base || opaque ? '#000000' : null;
    case 'ink': return s.base && !s.geo ? '#ffffff' : null;
    case 'cover': return s.sky || s.geo ? null : s.base || half ? '#ffffff' : null;
    case 'matId': return s.base || (s.bump && half) ? encodeMatId(s.mat ? ctx.matIdx.get(s.mat) || 0 : 0) : null;
    default: return s.geo ? null : isMaskTag(s, ctx.maskTag) ? '#ffffff' : s.base || opaque ? '#000000' : null;
  }
}
/* ---------- камера 2.5D ---------- */
export const CAMERA3D_DEFAULT = { hor: 280, f: 1500, camH: 4.2, dz: 2.5 };
/**
 * Модель камеры camera3d — одна на всё (сборка мира, отложенный свет, источники света, экспорт).
 * Без yaw/pitch: P([X,Y,Z]) = [cx + f·X/(Z+dz), hor + f·(camH − Y)/(Z+dz)] (одна точка схода).
 * yaw — поворот вправо (°, две точки схода), pitch — наклон вверх (°); keepVerticals — наклон сдвигом кадра,
 * как у сдвигового объектива: вертикали остаются вертикальными, горизонт смещается на f·tan(pitch).
 */
export function cameraModel(cam = {}, W = 1920) {
  const c = { ...CAMERA3D_DEFAULT, cx: W / 2, ...cam };
  const { f, cx, camH, dz } = c;
  const yaw = (c.yaw || 0) * DEG, pitch = (c.pitch || 0) * DEG, kv = !!c.keepVerticals;
  const th = kv ? 0 : pitch;
  const cY = Math.cos(yaw), sY = Math.sin(yaw), cT = Math.cos(th), sT = Math.sin(th);
  const r = [cY, 0, -sY], u = [-sY * sT, cT, -cY * sT], w = [sY * cT, sT, cY * cT];
  const hor = c.hor + (kv && pitch ? f * Math.tan(pitch) : 0);
  const pos = [0, camH, -dz];
  const plain = !yaw && !th;
  const P = plain
    ? ([X, Y, Z]) => [cx + (f * X) / (Z + dz), hor + (f * (camH - Y)) / (Z + dz)]
    : (p) => {
      const a = p[0] - pos[0], b = p[1] - pos[1], e = p[2] - pos[2];
      const zc = a * w[0] + b * w[1] + e * w[2];
      return [cx + (f * (a * r[0] + e * r[2])) / zc, hor - (f * (a * u[0] + b * u[1] + e * u[2])) / zc];
    };
  return {
    ...c, horEff: hor, pos, right: r, up: u, fwd: w, plain, P,
    /**
     * Проекция для горячих циклов: (X, Y, Z, out) → out = [x, y, глубина] в кадре шириной W·k, без выделения памяти.
     */
    projector: (k = 1) => {
      const fk = f * k, hk = hor * k, ck = cx * k;
      return plain
        ? (X, Y, Z, out) => { const zc = Z + dz; out[0] = ck + (fk * X) / zc; out[1] = hk + (fk * (camH - Y)) / zc; out[2] = zc; return out; }
        : (X, Y, Z, out) => {
          const a = X - pos[0], b = Y - pos[1], e = Z - pos[2], zc = a * w[0] + b * w[1] + e * w[2];
          out[0] = ck + (fk * (a * r[0] + e * r[2])) / zc; out[1] = hk - (fk * (a * u[0] + b * u[1] + e * u[2])) / zc; out[2] = zc; return out;
        };
    },
    /** Глубина точки вдоль оси камеры. */
    depth: plain ? (p) => p[2] + dz : (p) => (p[0] - pos[0]) * w[0] + (p[1] - pos[1]) * w[1] + (p[2] - pos[2]) * w[2],
    /** Луч камеры через пиксель (x, y): точка = pos + t·dir (без поворота dir.z = 1). */
    ray: plain
      ? (x, y) => [(x - cx) / f, -(y - hor) / f, 1]
      : (x, y) => { const a = (x - cx) / f, b = -(y - hor) / f; return [a * r[0] + b * u[0] + w[0], a * r[1] + b * u[1] + w[1], a * r[2] + b * u[2] + w[2]]; },
  };
}
/** Фильтр «залить цветом по альфе» — для картинок в проходах. */
export function floodFilter(ctx, color, region) {
  const key = `fl|${color}|${region.join(',')}`;
  if (ctx.patterns.has(key)) return ctx.reuse(key);
  const id = `${ctx.prefix}-fl${hashStr(key)}`;
  return ctx.share(key, { tag: 'filter', attrs: { id, filterUnits: 'userSpaceOnUse', x: fmt(region[0]), y: fmt(region[1]), width: fmt(region[2]), height: fmt(region[3]), 'color-interpolation-filters': 'sRGB' },
    children: [{ tag: 'feFlood', attrs: { 'flood-color': color, result: 'c' } }, { tag: 'feComposite', attrs: { in: 'c', in2: 'SourceAlpha', operator: 'in' } }] });
}
