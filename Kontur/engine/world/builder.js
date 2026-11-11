// Kontur world3d — Построитель сцены Scene(): элементы (ключ художника), свет, окклюдеры, рамки граней, конструкторы примитивов.
import { C, col } from './color.js';
import { hashSeed } from './rng.js';
import { sub, add, mul, dot, norm } from './geom.js';
import { camera } from './camera.js';

/* ============================== СЦЕНА-ПОСТРОИТЕЛЬ ============================== */
/**
 * Примитив — то, что построители кладут в элемент (S.item) и что toNodes превращает в узел.
 * @typedef {object} Prim
 * @property {'poly'|'line'|'img'|'text'} t
 * @property {number[][]} [ps]   poly: вершины [X,Y,Z] в мире
 * @property {number[][][]} [holes] poly: дыры (evenodd)
 * @property {string} [alb]      цвет-альбедо (#hex)
 * @property {number[]} [n]      нормаль для света
 * @property {number[]} [pl]     плоскость [nx,ny,nz,d] (n·P = d); общий объект pl у соседних примитивов = одна группа
 * @property {boolean} [base]    тело (перекрывает всё за собой в проходах)
 * @property {boolean} [bump]    деталь меняет только нормаль
 * @property {boolean} [ink]     контур; sw — его толщина (px)
 * @property {number} [spec]     блик 0..1 (0.1 по умолчанию)
 * @property {string} [em]       цвет свечения
 * @property {number} [op]       непрозрачность
 * @property {object|object[]} [ng] градиент нормали (surface.normalGrad)
 * @property {boolean} [geo]     только для восстановления позиции (не рисуется в цвете)
 * @property {number[][]|{ps:number[][],holes?:number[][][]}} [clip] обрезка деталей по грани
 * @property {number[]} [a]      line: начало [X,Y,Z]; b — конец, col — цвет, w — толщина
 */
/** Как Scene() из lib2: { W, H, hor, f, camH, dz, cx }. Элементы копятся в S.items, свет — в S.lights. */
export function Scene({ W = 1920, H = 1080, hor, f, camH, dz = 0, cx, yaw, pitch, keepVerticals } = {}) {
  const extra = {};
  if (yaw) extra.yaw = yaw;
  if (pitch) extra.pitch = pitch;
  if (keepVerticals) extra.keepVerticals = true;
  const cm = camera({ hor, f, camH, dz, cx: cx ?? W / 2, ...extra }, W);
  const S = { W, H, hor: cm.hor, f: cm.f, camH: cm.camH, dz: cm.dz, cx: cm.cx, camExtra: extra, items: [], lights: [], occ: [], tris: [], sky: [], skyGrad: [C.skyTop, C.skyMid, C.skyLow] };
  /** Автоокклюдеры: треугольники всех базовых граней (и невидимых камере) копятся в pend и уходят элементу. */
  S.autoOcc = false;
  S.pend = [];
  /** Версия мира (buildWorld v): 2 — подсиды предметов и граней, стабильные id, пустые элементы сохраняются. */
  S.v = 1;
  S.keepEmpty = false;
  /** Детализация: 0 — полная; 1 — без фасок мельче ~1 px; 2 — без фасок мельче ~2 px и мелочи материалов. */
  S.lod = 0;
  /** Слияние деталей одной грани с одинаковым видом в составные пути (toNodes). */
  S.merge = false;
  /** Экранных px на метр в точке (a, b) рамки — для решений детализации (Infinity, если lod выключен). */
  S.lodPx = (fr, a, b) => { if (!S.lod) return Infinity; const z = fr.at(a, b)[2]; const k = S.pxPerUnit(z); return k > 0 ? k : Infinity; };
  /** Порог детализации в px для текущего lod. */
  S.lodMin = () => (S.lod >= 2 ? 2 : S.lod >= 1 ? 0.9 : 0);
  /** Квантование мелкого разброса (наклоны нормалей) при слиянии: одинаковые значения сливаются. */
  S.q = (v, step = 0.05) => (S.merge ? Math.round(v / step) * step : v);
  S.seed = 1;
  S.faceN = 0;
  /** Подсид следующей грани предмета (v2) или 0 (v1: общий поток ГСЧ). */
  S.faceSeed = () => (S.v >= 2 ? hashSeed(S.seed, 'f' + S.faceN++) : 0);
  S.cam = cm.pos;
  S.camera = cm;
  S.P = cm.P;
  /**
   * Адаптивная тесселяция кривых (тела вращения, сферы, диски, арки, их окклюдеры): null — прежние постоянные числа
   * сегментов (кадр мира не меняется); { px, min, max } — сегмент дуги на экране около px пикселей: ближние предметы
   * глаже (силуэт и тень без граней), дальние — проще (меньше узлов).
   */
  S.tess = null;
  /** Число сегментов дуги радиуса r (м) с углом arc около точки at: base без тесселяции. */
  S.segs = (base, r, at, arc = Math.PI * 2, min = 8) => {
    if (!S.tess) return base;
    const px = (arc * r * cm.f) / Math.max(0.3, cm.depth(at));
    return Math.max(min, S.tess.min ?? 0, Math.min(S.tess.max ?? 96, Math.ceil(px / (S.tess.px || 6))));
  };
  S.charPx = (Z) => cm.charPx(Z);
  S.sw = cm.sw;
  S.pxPerUnit = cm.pxPerUnit;
  /** Элемент сцены: key — ключ сортировки художника (больше — дальше, рисуется раньше). o.keep — оставить пустую группу узлов (слот). */
  S.item = (key, prims, o = {}) => {
    if (!prims.length && !o.force && !S.keepEmpty) return null;
    const it = { key, prims, name: o.name, occ: [], tris: [], auto: S.pend, alpha: o.alpha, pmat: o.pmat, ...(o.keep ? { keep: true } : {}) };
    S.pend = [];
    S.items.push(it);
    return it;
  };
  /**
   * Составной предмет: элементы, созданные в fn, сливаются в один элемент с ключом key (порядок внутри — по их
   * ключам, дальние раньше), окклюдеры объединяются. Так части предмета не перемешиваются с соседями.
   */
  S.compose = (key, name, fn, o = {}) => {
    const start = S.items.length;
    fn();
    const its = S.items.splice(start);
    if (!its.length) return null;
    its.forEach((it, i) => { it._i = i; });
    its.sort((a, b) => b.key - a.key || a._i - b._i);
    const it = { key, name, prims: [], occ: [], tris: [], auto: [], alpha: o.alpha, pmat: o.pmat };
    for (const s of its) {
      it.prims.push(...s.prims);
      it.occ.push(...s.occ);
      it.tris.push(...(s.tris.length || s.occ.length ? s.tris : s.auto || []));
    }
    S.items.push(it);
    return it;
  };
  S.light = (p, color, r, i = 1, kind = 'lamp', o = {}) => S.lights.push({ p, col: color, r, i, kind, ...o });
  /** Окклюдер-коробка [x0,x1,y0,y1,z0,z1] для теней; owner — элемент (по умолчанию последний). */
  S.box3 = (b, owner = S.items[S.items.length - 1]) => { S.occ.push(b); if (owner) owner.occ.push(b); };
  S.tri3 = (t, owner = S.items[S.items.length - 1]) => { S.tris.push(t); if (owner) owner.tris.push(t); };
  /** Облако или другая фигура неба (в экранных координатах): эллипс, остаётся небом при перестройке неба. */
  S.cloud = (x, y, rx, ry, fill = '#fff0e0', op = 0.55) => S.sky.push({ x, y, rx, ry, fill, op });
  S.faces = (n, p) => dot(n, sub(S.cam, p)) > 1e-6;
  S.frame = (o, u, v, w, h, n) => {
    const fr = { o, u, v, w, h, n, pl: [...n, dot(n, o)] };
    fr.at = (a, b) => [o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b, o[2] + u[2] * a + v[2] * b];
    fr.rect = (a, b, ww, hh) => [fr.at(a, b), fr.at(a + ww, b), fr.at(a + ww, b + hh), fr.at(a, b + hh)];
    fr.tilt = (du, dv, k = 0.75) => norm(add(n, add(mul(u, du * k), mul(v, dv * k))));
    fr.z = Math.min(o[2], o[2] + u[2] * w, o[2] + v[2] * h, o[2] + u[2] * w + v[2] * h);
    return fr;
  };
  S.base = (ps, alb, n, pl, o = {}) => ({ t: 'poly', ps, alb, n, pl, base: true, ink: o.ink ?? true, spec: o.spec ?? 0.1, em: o.em, op: 1, sw: o.sw, ng: o.ng, geo: o.geo, holes: o.holes });
  S.det = (fr, ps, alb, o = {}) => ({ t: 'poly', ps, alb, n: o.n || fr.n, pl: fr.pl, bump: !!o.n || o.bump, base: !!o.solid, ink: o.ink || false, spec: o.spec ?? 0.1, em: o.em, op: o.op ?? 1, sw: o.sw });
  /** Линия; o.pl — плоскость [nx,ny,nz,d], на которой она лежит: тогда линия — тело в проходах (свет и тень по своей грани, а не по тому, что за ней). */
  S.line = (a, b, c, w, o = {}) => ({ t: 'line', a, b, col: c, w, ink: o.ink || false, op: o.op ?? 1, ...(o.pl ? { lpl: o.pl } : {}) });
  return S;
}
