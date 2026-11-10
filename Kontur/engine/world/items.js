// Kontur world3d — Реестр предметов world_build, схема их параметров и сборка мира из JSON-описания.
import { C, col, withJitSteps } from './color.js';
import { rnd, hashSeed, withSeed } from './rng.js';
import { sub, mul, dot, cross, norm, avg, polyNormal } from './geom.js';
import { CAMERA_DEFAULT } from './camera.js';
import { Scene } from './builder.js';
import { MATERIALS } from './materials.js';
import { face, frameOf, box, cyl, disc, stairs, arch, sphere, lathe, latheStack, awning, PROFILES } from './shapes.js';
import { house, windowPrims, doorPrims, pipePrims, ivy, char, textPrim } from './facade.js';

/* ============================== СХЕМА ПАРАМЕТРОВ ============================== */
/**
 * Параметр предмета — строка «тип[!][=умолчание][ — пояснение]»: ! — обязательный, умолчание — для справки
 * (построитель применяет его сам). Типы: num, int, bool, str, color (#hex или имя палитры C), range ([a, b]),
 * vec3 ([X, Y, Z]), pts ([[X,Y,Z], …]), obj, list, any, mats ({грань: [материал, цвет, параметры]}), mat (имя
 * материала), face ({on} — грань для окна/двери), enum:a|b|c. Несколько типов — через «/» (str/pts).
 */
const COMMON = { type: 'str!', id: 'str/num — стабильный id (узлы, подсид, правка предмета)', name: 'str', key: 'num — ключ глубины (больше — дальше)', pmat: 'str — попиксельный материал из scene.materials' };
const parseParam = (spec) => {
  const m = String(spec).match(/^([^!=\s]+)(!)?(?:=(\S+))?(?:\s+—\s+(.*))?$/);
  if (!m) return { types: ['any'], req: false };
  return { types: m[1].split('/'), req: !!m[2], def: m[3], text: m[4] };
};
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec = (v, n) => Array.isArray(v) && v.length >= n && v.slice(0, n).every(isNum);
const CHECK = {
  num: isNum, int: (v) => Number.isInteger(v), bool: (v) => typeof v === 'boolean', str: (v) => typeof v === 'string',
  color: (v) => typeof v === 'string', range: (v) => isVec(v, 2), vec3: (v) => isVec(v, 3),
  pts: (v) => Array.isArray(v) && v.length >= 3 && v.every((p) => isVec(p, 3)), obj: (v) => v && typeof v === 'object' && !Array.isArray(v),
  list: Array.isArray, any: () => true, face: (v) => v && typeof v === 'object',
  mat: (v) => v === false || v === null || v === 'none' || MATERIALS.includes(v),
  mats: (v) => v && typeof v === 'object' && Object.values(v).every((m) => m === null || (Array.isArray(m) && MATERIALS.includes(m[0]))),
};
const typeOk = (t, v) => (t.startsWith('enum:') ? t.slice(5).split('|').includes(v) : (CHECK[t] || CHECK.any)(v));
const TYPE_DOC = { range: '[a,b]', vec3: '[X,Y,Z]', pts: '[[X,Y,Z],…]', mats: '{грань:[материал,цвет,опции]}', face: '{on}', list: '[…]', obj: '{…}' };
const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
/**
 * Проверить описание предмета по схеме его типа. Возвращает { errors, warnings }: ошибки — обязательные поля и
 * неверные типы (предмет не строится), предупреждения — неизвестные поля (с подсказкой ближайшего имени).
 */
export function checkWorldItem(d) {
  const errors = [], warnings = [];
  const def = WORLD_ITEMS[d?.type];
  if (!def) return { errors: [`неизвестный тип ${d?.type} (есть: ${Object.keys(WORLD_ITEMS).join(', ')})`], warnings };
  if (!def.params) return { errors, warnings };
  const all = { ...COMMON, ...def.params };
  for (const [k, spec] of Object.entries(all)) {
    const p = parseParam(spec), v = d[k];
    if (v === undefined) { if (p.req) errors.push(`нет обязательного поля ${k}`); continue; }
    if (v === null && !p.req) continue;
    if (!p.types.some((t) => typeOk(t, v))) {
      const want = p.types.map((t) => (t.startsWith('enum:') ? t.slice(5) : TYPE_DOC[t] || t)).join(' или ');
      const extra = p.types.includes('mats') || p.types.includes('mat') ? ` (материалы: ${MATERIALS.join(', ')})` : '';
      errors.push(`поле ${k}: ожидается ${want}, получено ${JSON.stringify(v)?.slice(0, 40)}${extra}`);
    }
  }
  for (const k of Object.keys(d)) if (!(k in all)) {
    const near = Object.keys(all).map((n) => [n, lev(k.toLowerCase(), n.toLowerCase())]).sort((a, b) => a[1] - b[1])[0];
    warnings.push(`неизвестное поле «${k}»${near && near[1] <= 2 ? ` — может быть, «${near[0]}»?` : ''}`);
  }
  return { errors, warnings };
}

/* ============================== ПРЕДМЕТЫ world_build ============================== */
/**
 * Реестр типов предметов для buildWorld: WORLD_ITEMS[type] = { doc, params, build(S, d, ctx) }.
 * doc — краткое описание, params — схема параметров (см. выше); ctx: { mats, frameFrom, col }.
 * Свои типы — registerWorldItem(type, { doc, params, build }); без params описание не проверяется.
 */
export const WORLD_ITEMS = {
  box: { doc: 'коробка (дно видно снизу)', params: { x: 'range!', y: 'range=[0,1]', z: 'range!', color: 'color=stone', mats: 'mats — front|back|left|right|top|bottom|side|all', top: 'color', sides: 'color', spec: 'num', emissive: 'color', occ: 'bool' },
    build: (S, d, { mats }) => box(S, d.x[0], d.x[1], d.y?.[0] ?? 0, d.y?.[1] ?? 1, d.z[0], d.z[1], col(d.color) || C.stone, { mats: mats(d.mats), top: col(d.top), sides: col(d.sides), spec: d.spec, em: d.emissive, key: d.key, occ: d.occ, name: d.name }) },
  house: { doc: 'дом: коробка с фасадом, крыша черепицей, окна и двери', params: { x: 'range!', z: 'range!', h: 'num=8', y0: 'num=0', color: 'color=plaster', roof: 'color=roof', mat: 'enum:plaster|stone|brick|none=plaster', ridge: 'enum:z — конёк вглубь (иначе вдоль X)', roofType: 'enum:flat|gable|hip|shed=gable', roofH: 'num=1.6', facades: 'list=["front","left","right"]', doorAt: 'num — положение двери на фасаде, м', doorColor: 'color', shut: 'color — ставни', plinth: 'num', chimney: 'num — 0..1 вдоль дома', pipe: 'str/bool — "end" — у правого края', litP: 'num=0.25 — доля горящих окон', skip: 'any', sides: 'color' },
    build: (S, d) => house(S, d.x[0], d.x[1], d.z[0], d.z[1], d.h ?? 8, { ...d, col: col(d.color), roof: col(d.roof), shut: col(d.shut), doorCol: col(d.doorColor), sides: col(d.sides) }) },
  cyl: { doc: 'цилиндр (гладкая нормаль)', params: { X: 'num!', Z: 'num!', r: 'num=0.3', y: 'range=[0,1]', color: 'color=stone', top: 'color', bands: 'num — шаг полос, м', n: 'int=16', spec: 'num', occ: 'bool' },
    build: (S, d) => cyl(S, d.X, d.Z, d.r ?? 0.3, d.y?.[0] ?? 0, d.y?.[1] ?? 1, col(d.color) || C.stone, { n: d.n, top: col(d.top), bands: d.bands, spec: d.spec, key: d.key, occ: d.occ, name: d.name }) },
  disc: { doc: 'плоский эллипс: лужи, люки, ковры', params: { X: 'num!', Y: 'num=0.003', Z: 'num!', rx: 'num=0.5', rz: 'num', color: 'color=iron', spec: 'num', base: 'bool', ink: 'bool', wob: 'bool', normal: 'vec3', opacity: 'num', emissive: 'color' },
    build: (S, d) => S.item(d.key ?? d.Z, [disc(S, d.X, d.Y ?? 0.003, d.Z, d.rx ?? 0.5, d.rz ?? d.rx ?? 0.5, col(d.color) || C.iron, { spec: d.spec, base: d.base, ink: d.ink, wob: d.wob, n3: d.normal && norm(d.normal), op: d.opacity, em: d.emissive })], { name: d.name || 'disc' }) },
  stairs: { doc: 'лестница вдоль Z', params: { x: 'range!', z: 'range!', h: 'num=2', y0: 'num=0', steps: 'int', color: 'color=stoneHi', mat: 'mat=stone', jitter: 'bool' },
    build: (S, d) => stairs(S, d.x[0], d.x[1], d.z[0], d.z[1], d.h ?? 2, col(d.color) || C.stoneHi, { steps: d.steps, mat: d.mat, y0: d.y0, jitter: d.jitter }) },
  ground: { doc: 'земля (горизонтальная грань)', params: { x: 'range!', z: 'range!', y: 'num=0', color: 'color=cobble', mat: 'mat=cobble — false — гладкая (фактура — pmat)', matOpt: 'obj', maxZ: 'num=26', spec: 'num=0.25' },
    build: (S, d) => {
      const c = col(d.color), y = d.y ?? 0, [x0, x1] = d.x, [z0, z1] = d.z;
      const fr = (n) => S.frame([x0, y, z0], [1, 0, 0], [0, 0, 1], x1 - x0, z1 - z0, n);
      S.item(d.key ?? 1e6, face(S, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], c || C.cobble, { mat: d.mat ?? 'cobble', matCol: c || C.cobble, frame: fr, matOpt: { maxZ: d.maxZ ?? 26, ...(d.matOpt || {}) }, ink: false, spec: d.spec ?? 0.25 }), { name: d.name || 'ground' });
    } },
  wall: { doc: 'грань-многоугольник (фронтон, арка; детали обрезаются по ней)', params: { ps: 'pts!', holes: 'list — проёмы [[[X,Y,Z],…], …] в той же плоскости', color: 'color=plaster', mat: 'mat', matColor: 'color', matOpt: 'obj', spec: 'num', emissive: 'color', ink: 'bool', clip: 'bool' },
    build: (S, d) => {
      const c = col(d.color), ps = d.ps;
      S.item(d.key ?? Math.min(...ps.map((p) => p[2])), face(S, ps, c || C.plaster, { mat: d.mat, matCol: col(d.matColor) || c, matOpt: d.matOpt, frame: d.mat ? (n) => frameOf(S, ps, n) : null, spec: d.spec, em: d.emissive, ink: d.ink, clip: d.clip, ...(d.holes?.length ? { holes: d.holes } : {}) }), { name: d.name || 'wall' });
    } },
  light: { doc: 'точечный источник света', params: { p: 'vec3!', color: 'color=#ffc070', radius: 'num=5 — м', energy: 'num=1', group: 'enum:lamp|window|candle|fairy=lamp', shadows: 'bool', anim: 'obj' },
    build: (S, d) => { S.light(d.p, d.color || '#ffc070', d.radius ?? 5, d.energy ?? 1, d.group || 'lamp', d.shadows != null ? { shadows: d.shadows } : {}); animLight(S, d.anim); } },
  lamp: { doc: 'уличный фонарь со светом', params: { X: 'num!', Y: 'num=0', Z: 'num!', h: 'num=3', color: 'color=#ffc070', radius: 'num=5.5', energy: 'num=1.3', glow: 'color=#ffd890', anim: 'obj' },
    build: (S, d) => {
      const { X, Y = 0, Z, h = 3 } = d;
      cyl(S, X, Z, 0.07, Y, Y + h, C.iron, { n: 8, key: Z - 0.2, spec: 0.6, name: 'lamp_post' });
      box(S, X - 0.2, X + 0.2, Y + h, Y + h + 0.45, Z - 0.2, Z + 0.2, C.glow, { key: Z - 0.31, em: col(d.glow) || '#ffd890', occ: false, name: 'lamp' });
      S.item(Z - 0.32, face(S, [[X - 0.3, Y + h + 0.45, Z - 0.3], [X + 0.3, Y + h + 0.45, Z - 0.3], [X, Y + h + 0.8, Z]], C.iron, {}), { name: 'lamp_cap' });
      S.light([X, Y + h + 0.22, Z - 0.3], col(d.color) || '#ffc070', d.radius ?? 5.5, d.energy ?? 1.3, 'lamp');
      animLight(S, d.anim);
    } },
  cloud: { doc: 'облако (экранные px, остаётся небом)', params: { x: 'num!', y: 'num!', rx: 'num=160', ry: 'num=32', color: 'color=#fff0e0', opacity: 'num=0.55' },
    build: (S, d) => S.cloud(d.x, d.y, d.rx ?? 160, d.ry ?? 32, col(d.color) || '#fff0e0', d.opacity ?? 0.55) },
  // ---- готовые построители форм (раньше были доступны только из JS) ----
  arch: { doc: 'арка-портал в стене z: проём, свод, клинчатые камни', params: { x: 'range!', z: 'num!', y0: 'num=0', spring: 'num=2 — высота пяты свода', thick: 'num=0.5', color: 'color=stone', top: 'num — верх блока', margin: 'num=0.45', mat: 'mat', matColor: 'color', matOpt: 'obj', voussoirs: 'bool=true', keystone: 'bool=true', stones: 'int=9', stoneColor: 'color', back: 'color — цвет за проёмом (null — сквозной)', occ: 'bool' },
    build: (S, d) => arch(S, d.x[0], d.x[1], d.z, d.y0 ?? 0, d.spring ?? 2, d.thick ?? 0.5, col(d.color) || C.stone, { top: d.top, margin: d.margin, mat: d.mat || undefined, matColor: col(d.matColor), matOpt: d.matOpt, voussoirs: d.voussoirs, keystone: d.keystone, stones: d.stones, stoneColor: col(d.stoneColor), back: d.back === null ? null : col(d.back), occ: d.occ, key: d.key, name: d.name, pmat: d.pmat }) },
  sphere: { doc: 'сфера или купол (dome): крона, шар, купол', params: { X: 'num!', Y: 'num — центр (по умолчанию r над землёй; купол — 0)', Z: 'num!', r: 'num=0.5', R: 'num — то же, что r', color: 'color=#5a8040', flat: 'num=0 — 0..0.9 сплющенность нормали (листва)', dome: 'bool', wob: 'num — неровность края 0..0.3', spec: 'num', emissive: 'color', ink: 'bool', occ: 'bool' },
    build: (S, d) => { const r = d.r ?? d.R ?? 0.5; sphere(S, d.X, d.Y ?? (d.dome ? 0 : r), d.Z, r, col(d.color) || '#5a8040', { flat: d.flat, dome: d.dome, wob: d.wob, spec: d.spec, em: d.emissive, ink: d.ink, occ: d.occ, key: d.key, name: d.name }); } },
  lathe: { doc: `тело вращения по профилю: готовый (${Object.keys(PROFILES).join(', ')}) или свой [[r, y, "c"?], …]`, params: { X: 'num!', Z: 'num!', profile: 'str/list!', h: 'num — высота готового профиля', r: 'num — радиус готового профиля', y0: 'num=0', color: 'color=stone', n: 'int=16', smooth: 'bool/int', crease: 'num=50', spec: 'num', emissive: 'color', top: 'color', fill: 'obj — {y, r, color, spec} гладь внутри', rings: 'obj — {ys, color}', ink: 'bool', occ: 'bool' },
    build: (S, d) => lathe(S, d.X, d.Z, profileOf(d), col(d.color) || C.stone, { y0: d.y0, n: d.n, smooth: d.smooth, crease: d.crease, spec: d.spec, em: d.emissive, top: d.top === false ? false : col(d.top), fill: d.fill && { ...d.fill, color: col(d.fill.color) }, rings: d.rings && { ...d.rings, color: col(d.rings.color) }, ink: d.ink, occ: d.occ, key: d.key, name: d.name, pmat: d.pmat }) },
  fountain: { doc: 'фонтан: чаша с водой, колонна, верхняя чаша', params: { X: 'num!', Z: 'num!', r: 'num=2 — радиус нижней чаши', h: 'num=1.6 — высота колонны', color: 'color=stone', water: 'color=water', tiers: 'int=2' },
    build: (S, d) => {
      const r = d.r ?? 2, h = d.h ?? 1.6, c = col(d.color) || C.stone, w = col(d.water) || C.water;
      const parts = [{ prof: PROFILES.fountainBasin(0.6, r), color: c, fill: { y: 0.45, r: r * 0.93, color: w } }, { prof: PROFILES.column(h, Math.max(0.1, r * 0.08)), color: c }];
      if ((d.tiers ?? 2) >= 2) parts.push({ prof: PROFILES.fountainBasin(0.25, r * 0.38), color: c, y0: h, fill: { y: 0.18, r: r * 0.35, color: w } });
      latheStack(S, d.X, d.Z, parts, { key: d.key, name: d.name || 'fountain', pmat: d.pmat });
    } },
  awning: { doc: 'маркиза в полоску с фестонами над витриной', params: { x: 'range!', z: 'num! — стена', y: 'num! — верхняя кромка', depth: 'num=1.2', drop: 'num=0.5', colors: 'list=["red","cream"]', stripe: 'num=0.3', scallop: 'num=0.16', valance: 'num=0.22', occ: 'bool' },
    build: (S, d) => awning(S, d.x[0], d.x[1], d.z, d.y, d.depth ?? 1.2, d.drop ?? 0.5, { colors: d.colors, stripe: d.stripe, scallop: d.scallop, valance: d.valance, occ: d.occ, key: d.key, name: d.name }) },
  char: { doc: 'персонаж-картинка с тенью и окклюдером', params: { img: 'obj! — {uri, w, h, k}', X: 'num!', Y: 'num=0', Z: 'num!', flip: 'bool', shadow: 'bool=true', tag: 'str=chr' },
    build: (S, d) => char(S, d.img, d.X, d.Y ?? 0, d.Z, { flip: d.flip, shadow: d.shadow, tag: d.tag, key: d.key, name: d.name }) },
  text: { doc: 'надпись на грани: вывеска, номер дома', params: { on: 'face!', a: 'num=0 — центр по грани, м', b: 'num=0', text: 'str!', size: 'num=0.3 — высота букв, м', color: 'color=#2e2a3c', font: 'str', weight: 'str/num', spacing: 'num', emissive: 'color' },
    build: (S, d, { frameFrom }) => { const fr = frameFrom(d.on); S.item(d.key ?? fr.z - 0.012, [textPrim(S, fr, d.a ?? 0, d.b ?? 0, d.text, d.size ?? 0.3, col(d.color) || C.line, { font: d.font, weight: d.weight, spacing: d.spacing, em: col(d.emissive) })], { name: d.name || 'text' }); } },
};
/* ---- составные: ряд и рассыпь копий предмета ---- */
WORLD_ITEMS.array = { doc: 'ряд копий предмета: item задан в своих координатах, копия k сдвинута на at + k·step (сдвигаются x, y, z, X, Y, Z, y0, p, ps, holes, on, spring, top)',
  params: { item: 'obj!', count: 'int!', step: 'vec3!', at: 'vec3=[0,0,0]' },
  build: (S, d, ctx) => {
    const at = d.at || [0, 0, 0];
    for (let k = 0; k < d.count; k++) ctx.sub(offsetItem(d.item, [at[0] + d.step[0] * k, at[1] + d.step[1] * k, at[2] + d.step[2] * k]), 'a' + k);
  } };
WORLD_ITEMS.scatter = { doc: 'рассыпь копий предмета по площадке (случайно, не ближе minDist): item — в своих координатах вокруг (0, 0, 0)',
  params: { item: 'obj!', area: 'obj! — {x:[x0,x1], z:[z0,z1]}', count: 'int!', minDist: 'num=1', y: 'num=0' },
  build: (S, d, ctx) => {
    const [x0, x1] = d.area.x, [z0, z1] = d.area.z, md2 = (d.minDist ?? 1) ** 2, pts = [];
    for (let k = 0, tries = 0; k < d.count && tries < d.count * 30; tries++) {
      const p = [x0 + rnd() * (x1 - x0), z0 + rnd() * (z1 - z0)];
      if (pts.some((q) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < md2)) continue;
      pts.push(p); k++;
    }
    pts.forEach((p, k) => ctx.sub(offsetItem(d.item, [p[0], d.y ?? 0, p[1]]), 's' + k));
  } };
/* ---- геометрия улицы ---- */
WORLD_ITEMS.slab = { doc: 'плита толщиной t (балкон, козырёк, ступень): коробка с видимым дном',
  params: { x: 'range!', z: 'range!', y: 'num=0 — низ', t: 'num=0.2', color: 'color=stone', mats: 'mats', occ: 'bool' },
  build: (S, d, { mats }) => box(S, d.x[0], d.x[1], d.y ?? 0, (d.y ?? 0) + (d.t ?? 0.2), d.z[0], d.z[1], col(d.color) || C.stone, { mats: mats(d.mats), key: d.key, occ: d.occ, name: d.name || 'slab' }) };
WORLD_ITEMS.ramp = { doc: 'пандус: наклонный верх от высоты y[0] у z[0] до y[1] у z[1], боковины',
  params: { x: 'range!', z: 'range!', y: 'range! — высоты верха у z0 и z1', base: 'num=0', color: 'color=stone', mat: 'mat', matColor: 'color', sides: 'bool=true' },
  build: (S, d) => {
    const [x0, x1] = d.x, [z0, z1] = d.z, [ya, yb] = d.y, b = d.base ?? 0, c = col(d.color) || C.stone;
    const cen = [(x0 + x1) / 2, (b + (ya + yb) / 2) / 2, (z0 + z1) / 2], prims = [];
    const top = [[x0, ya, z0], [x1, ya, z0], [x1, yb, z1], [x0, yb, z1]];
    prims.push(...face(S, top, c, { center: cen, mat: d.mat || undefined, matCol: col(d.matColor) || c, frame: d.mat ? (n) => frameOf(S, top, n) : null }));
    const quad = (ps) => { const q = ps.filter((p, i) => i === 0 || Math.abs(p[1] - ps[i - 1][1]) + Math.abs(p[0] - ps[i - 1][0]) + Math.abs(p[2] - ps[i - 1][2]) > 1e-6); if (q.length >= 3) prims.push(...face(S, q, c, { center: cen })); };
    if (d.sides !== false) for (const x of [x0, x1]) quad([[x, b, z0], [x, b, z1], [x, yb, z1], [x, ya, z0]]);
    if (ya > b + 1e-3) quad([[x0, b, z0], [x1, b, z0], [x1, ya, z0], [x0, ya, z0]]);
    if (yb > b + 1e-3) quad([[x0, b, z1], [x1, b, z1], [x1, yb, z1], [x0, yb, z1]]);
    S.item(d.key ?? z0, prims, { name: d.name || 'ramp' });
  } };
WORLD_ITEMS.road = { doc: 'улица: проезжая часть, разметка, бордюры и тротуары',
  params: { x: 'range! — проезжая часть', z: 'range!', y: 'num=0', color: 'color=#5d5752', lines: 'bool=true — пунктир по оси', lineColor: 'color=#e8dcc0', curb: 'num=0.15 — высота бордюра', curbW: 'num=0.25', curbColor: 'color=stoneHi', walk: 'num=2 — ширина тротуара', walkColor: 'color=stone', walkMat: 'mat=slabs' },
  build: (S, d, { mats }) => {
    const [x0, x1] = d.x, [z0, z1] = d.z, y = d.y ?? 0, c = col(d.color) || '#5d5752';
    const ch = d.curb ?? 0.15, cw = d.curbW ?? 0.25, ww = d.walk ?? 2, wc = col(d.walkColor) || C.stone, wm = d.walkMat === undefined ? 'slabs' : d.walkMat;
    const fr = S.frame([x0, y, z0], [1, 0, 0], [0, 0, 1], x1 - x0, z1 - z0, [0, 1, 0]);
    const prims = face(S, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], c, { ink: false, spec: 0.15 });
    if (d.lines !== false && prims.length) for (let b = 0.5; b < fr.h - 0.5; b += 3) prims.push(S.det(fr, fr.rect(fr.w / 2 - 0.06, b, 0.12, Math.min(1.5, fr.h - b)), col(d.lineColor) || '#e8dcc0', { spec: 0.2 }));
    S.item(d.key ?? 1e6 - 1, prims, { name: d.name || 'road' });
    if (ch > 0) for (const [a, b] of [[x0 - cw, x0], [x1, x1 + cw]]) box(S, a, b, y, y + ch, z0, z1, col(d.curbColor) || C.stoneHi, { key: 1e6 - 3, name: 'curb' });
    if (ww > 0) for (const [a, b] of [[x0 - cw - ww, x0 - cw], [x1 + cw, x1 + cw + ww]]) {
      const ps = [[a, y + ch, z0], [b, y + ch, z0], [b, y + ch, z1], [a, y + ch, z1]];
      const wf = (n) => S.frame([a, y + ch, z0], [1, 0, 0], [0, 0, 1], b - a, z1 - z0, n);
      S.item(1e6 - 2, face(S, ps, wc, { mat: wm || undefined, matCol: wc, frame: wm ? wf : null, ink: false, spec: 0.2 }), { name: 'sidewalk' });
    }
  } };
/** Сдвинуть координаты предмета (копии array/scatter). */
export function offsetItem(d, off) {
  const AX = { x: 0, X: 0, y: 1, Y: 1, y0: 1, spring: 1, top: 1, z: 2, Z: 2 };
  if (d.type === 'cloud') return { ...d };
  const o = { ...d };
  for (const [k, ax] of Object.entries(AX)) {
    const v = o[k];
    if (typeof v === 'number') o[k] = v + off[ax];
    else if (Array.isArray(v) && v.length === 2 && v.every(isNum)) o[k] = [v[0] + off[ax], v[1] + off[ax]];
  }
  const sh = (p) => [p[0] + off[0], p[1] + off[1], p[2] + off[2], ...p.slice(3)];
  if (isVec(o.p, 3)) o.p = sh(o.p);
  if (Array.isArray(o.ps)) o.ps = o.ps.map(sh);
  if (Array.isArray(o.holes)) o.holes = o.holes.map((h) => h.map(sh));
  if (o.on && typeof o.on === 'object') {
    const on = { ...o.on };
    if (Array.isArray(on.wall)) { const [a, b, z, h = 6, yy = 0] = on.wall; on.wall = [a + off[0], b + off[0], z + off[2], h, yy + off[1]]; }
    if (Array.isArray(on.ps)) on.ps = on.ps.map(sh);
    if (on.o) on.o = sh(on.o);
    o.on = on;
  }
  if (o.item) o.item = offsetItem(o.item, off);
  return o;
}
/**
 * Анимация последнего источника света: anim { flicker 0..1 (мерцание), pulse 0..1 (плавное дыхание), speed — ключей
 * в секунду (8), period — период дыхания (2 с), duration — длина цикла (4 с) }. Ключи energy; цикл замкнут.
 */
function animLight(S, a) {
  const l = S.lights[S.lights.length - 1];
  if (!a || !l || !(a.flicker || a.pulse)) return;
  const dur = a.duration ?? 4, sp = a.speed ?? 8, per = a.period ?? 2, n = Math.max(2, Math.round(dur * sp));
  const keys = [];
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * dur;
    let e = l.i * (1 - (a.pulse || 0) * 0.5 * (1 - Math.cos((2 * Math.PI * t) / per)));
    if (a.flicker && k < n) e *= 1 - a.flicker * rnd();
    keys.push([+t.toFixed(3), +e.toFixed(3)]);
  }
  keys[n][1] = keys[0][1];
  l.keys = keys;
}
/** Профиль lathe: имя готового (с h, r) или свой массив. */
function profileOf(d) {
  if (Array.isArray(d.profile)) return d.profile;
  const f = PROFILES[d.profile];
  if (!f) throw new Error(`профиль ${d.profile}? Есть: ${Object.keys(PROFILES).join(', ')}`);
  return d.h != null || d.r != null ? f(d.h, d.r) : f();
}
const ON = 'face! — {wall:[x0,x1,z,h]} | {ps:[…]} | {o,u,v,w,h,n}';
const onFace = (kind, doc, params) => ({ doc, params: { on: ON, a: 'num — по грани, м', b: 'num', ...params }, build: (S, d, { frameFrom }) => {
  const fr = frameFrom(d.on);
  const pr = kind === 'window' ? windowPrims(S, fr, d.a ?? 0, d.b ?? 1, d.w ?? 0.84, d.h ?? 1.2, { lit: d.lit, shut: col(d.shut), box: d.box })
    : kind === 'door' ? doorPrims(S, fr, d.a ?? 0, d.w ?? 1.1, d.h ?? 2.1, col(d.color) || C.wood)
      : kind === 'pipe' ? pipePrims(S, fr, d.a ?? 0.25, d.b ?? 0, d.h ?? fr.h)
        : ivy(S, fr, d.a ?? 0, d.b ?? 0, d.w ?? 1.5, d.h ?? 3, d.density ?? 80);
  S.item(d.key ?? fr.z - 0.01, pr, { name: d.name || kind });
} });
WORLD_ITEMS.window = onFace('window', 'окно с наличником, переплётом, ставнями, ящиком цветов', { w: 'num=0.84', h: 'num=1.2', lit: 'bool', shut: 'color', box: 'bool' });
WORLD_ITEMS.door = onFace('door', 'арочная дверь', { w: 'num=1.1', h: 'num=2.1', color: 'color=wood' });
WORLD_ITEMS.pipe = onFace('pipe', 'водосточная труба', { h: 'num — длина (по умолчанию высота грани)' });
WORLD_ITEMS.ivy = onFace('ivy', 'плющ', { w: 'num=1.5', h: 'num=3', density: 'int=80' });
/** Добавить или заменить тип предмета world_build: { doc, params?, build(S, d, ctx) }. */
export function registerWorldItem(type, def) {
  if (typeof def?.build !== 'function') throw new Error(`registerWorldItem(${type}): нужен build(S, d, ctx)`);
  WORLD_ITEMS[type] = { doc: '', ...def };
  return WORLD_ITEMS[type];
}
const paramDoc = (k, spec) => {
  const p = parseParam(spec);
  const t = p.types.map((x) => (x.startsWith('enum:') ? x.slice(5) : TYPE_DOC[x] || '')).filter(Boolean).join('/');
  return `${k}${t ? ':' + t : ''}${p.req ? '!' : ''}${p.def != null ? '=' + p.def : ''}`;
};
/** Справка по типам предметов (docs topic "props"): параметры из схемы, ! — обязательный, =умолчание. */
export const worldItemsDoc = () => Object.entries(WORLD_ITEMS).map(([k, v]) => {
  if (!v.params) return `• ${k} ${v.doc}`;
  return `• ${k} {${Object.entries(v.params).map(([n, s]) => paramDoc(n, s)).join(', ')}} — ${v.doc}`;
}).join('\n') + `\nОбщие поля любого предмета: ${Object.entries(COMMON).filter(([k]) => k !== 'type').map(([k, s]) => paramDoc(k, s)).join(', ')}.`;
/** Схема параметров предмета для справки и форм: { param: { types, req, def, text } }. */
export const worldItemParams = (type) => { const v = WORLD_ITEMS[type]; return v?.params ? Object.fromEntries(Object.entries({ ...COMMON, ...v.params }).map(([k, s]) => [k, parseParam(s)])) : null; };

/* ============================== ОПИСАНИЕ → ПОСТРОЕНИЕ ============================== */
/**
 * Собрать сцену из JSON-описания (инструмент MCP world_build). items — массив { type, …параметры }:
 * типы и их параметры — реестр WORLD_ITEMS (worldItemsDoc()). Цвета — #hex или имена палитры C.
 * occ: 'auto' (по умолчанию) — окклюдеры теней из граней всех предметов; 'manual'/'boxes' — только явные.
 * v: 2 — подсиды предметов и граней, стабильные id. Возвращает { S, errors, warnings, stats }:
 * stats[i] = { type, elements, ms } по предметам (узлы добавляет toNodes: r.perItem).
 */
export function buildWorld(opts = {}) { return withSeed(opts.seed ?? 1, () => buildWorldRaw(opts)); }
function buildWorldRaw({ width = 1920, height = 1080, camera3d = {}, items = [], sky, occ = 'auto', seed = 1, v = 1, lod, merge, cache } = {}) {
  const S = Scene({ W: width, H: height, ...CAMERA_DEFAULT, ...camera3d });
  // 'manual' и 'boxes' — только явные коробки и треугольники (инструмент world_build называет режим 'boxes')
  S.autoOcc = occ !== 'manual' && occ !== 'boxes';
  S.v = v >= 2 ? 2 : 1;
  S.keepEmpty = S.v >= 2;
  // v2: по умолчанию упрощать невидимо мелкие фаски и сливать детали граней в составные пути
  S.lod = Math.max(0, Math.min(2, Math.round(lod ?? (S.v >= 2 ? 1 : 0))));
  S.merge = merge ?? S.v >= 2;
  if (Array.isArray(sky) && sky.length === 3) S.skyGrad = sky.map(col);
  const errs = [], warns = [], stats = [];
  const mats = (m) => { if (!m) return undefined; const o = {}; for (const k in m) o[k] = m[k] ? [m[k][0], col(m[k][1]), m[k][2] || {}] : null; return o; };
  const frameFrom = (on) => {
    if (on && on.o && on.u && on.v) return S.frame(on.o, on.u, on.v, on.w, on.h, on.n || norm(cross(on.u, on.v)).map((v) => -v));
    if (on && Array.isArray(on.ps)) { let n = polyNormal(on.ps); if (dot(n, sub(S.cam, avg(on.ps))) < 0) n = mul(n, -1); return frameOf(S, on.ps, n); }
    if (on && Array.isArray(on.wall)) { // стена z = wall[2] от x = wall[0] до wall[1], высота wall[3]
      const [xa, xb, z, h = 6, y = 0] = on.wall; return S.frame([xa, y, z], [1, 0, 0], [0, 1, 0], xb - xa, h, [0, 0, -1]);
    }
    throw new Error('нужно on: {o,u,v,w,h,n}, {ps} или {wall: [x0, x1, z, h]}');
  };
  const ctx = { mats, frameFrom, col, items: WORLD_ITEMS };
  /** Вложенный предмет (array, scatter, свои составные типы): проверка схемы и свой подсид k внутри текущего предмета. */
  ctx.sub = (d2, k) => {
    const chk = checkWorldItem(d2);
    if (chk.errors.length) throw new Error(`${d2?.type}: ${chk.errors.join('; ')}`);
    const run = () => WORLD_ITEMS[d2.type].build(S, d2, ctx);
    if (S.v < 2) return run();
    const prev = [S.seed, S.faceN];
    S.seed = hashSeed(prev[0], k); S.faceN = 0;
    try { return withSeed(S.seed, run); } finally { [S.seed, S.faceN] = prev; }
  };
  // кэш (v2): предметы независимы (свой подсид), поэтому результат предмета можно взять из прошлой сборки,
  // если не изменились сам предмет, его сид, камера и настройки
  const useCache = S.v >= 2 && cache instanceof Map;
  const cacheOut = useCache ? new Map() : null;
  const world = useCache ? JSON.stringify([width, height, camera3d, occ, S.lod, S.merge]) : '';
  const one = (d, i, label) => {
    const at = { items: S.items.length, lights: S.lights.length, sky: S.sky.length, occ: S.occ.length, tris: S.tris.length };
    const t0 = performance.now();
    const ck = useCache ? world + '|' + hashSeed(seed, d?.id ?? i) + '|' + JSON.stringify(d) : null;
    const hit = ck && cache.get(ck);
    if (hit) {
      S.items.push(...hit.items); S.lights.push(...hit.lights); S.sky.push(...hit.sky); S.occ.push(...hit.occ); S.tris.push(...hit.tris);
      for (const w of hit.warnings) warns.push(`${label}: ${w}`);
      const src = d.id != null ? String(d.id).replace(/[^\w-]/g, '_') : String(i);
      hit.items.forEach((it, j) => { it.src = i; it.sid = `${src}-${j}`; });
      for (const l of hit.lights) l.src = i;
      cacheOut.set(ck, hit);
      stats[i] = { type: d.type, elements: hit.items.length, lights: hit.lights.length, ms: +(performance.now() - t0).toFixed(2), cached: true };
      return;
    }
    const w0 = warns.length;
    try {
      const chk = checkWorldItem(d);
      for (const w of chk.warnings) warns.push(`${label}: ${w}`);
      if (chk.errors.length) throw new Error(chk.errors.join('; '));
      const P = WORLD_ITEMS[d.type];
      if (S.v >= 2) {
        // свой поток случайных чисел у предмета: правка одного предмета не меняет остальные
        S.seed = hashSeed(seed, d.id ?? i); S.faceN = 0;
        withSeed(S.seed, () => P.build(S, d, ctx));
        const src = d.id != null ? String(d.id).replace(/[^\w-]/g, '_') : String(i);
        for (let j = at.items; j < S.items.length; j++) S.items[j].sid = `${src}-${j - at.items}`;
      } else P.build(S, d, ctx);
      for (let j = at.items; j < S.items.length; j++) S.items[j].src = i;
      for (let j = at.lights; j < S.lights.length; j++) S.lights[j].src = i;
      // pmat: попиксельный материал (scene.materials) для всех элементов предмета
      if (d.pmat) for (let j = at.items; j < S.items.length; j++) S.items[j].pmat ??= d.pmat;
    } catch (e) {
      // предмет с ошибкой не оставляет половину себя в мире
      S.items.length = at.items; S.lights.length = at.lights; S.sky.length = at.sky; S.occ.length = at.occ; S.tris.length = at.tris;
      errs.push(`${label} (${d?.type}): ${e.message}`);
    }
    S.pend = [];
    stats[i] = { type: d?.type, elements: S.items.length - at.items, lights: S.lights.length - at.lights, ms: +(performance.now() - t0).toFixed(2) };
    if (ck && errs.every((e) => !e.startsWith(label + ' '))) {
      cacheOut.set(ck, { items: S.items.slice(at.items), lights: S.lights.slice(at.lights), sky: S.sky.slice(at.sky), occ: S.occ.slice(at.occ), tris: S.tris.slice(at.tris),
        warnings: warns.slice(w0).map((w) => w.slice(label.length + 2)) });
    }
  };
  if (S.v >= 2) {
    const seen = new Map();
    items.forEach((d, i) => { if (d?.id == null) return; const k = String(d.id); if (seen.has(k)) errs.push(`#${i} (${d.type}): id «${k}» уже у предмета #${seen.get(k)}`); else seen.set(k, i); });
  }
  const dup = new Set(errs.map((e) => +e.match(/^#(\d+)/)?.[1]));
  ctx.build = (d, i) => one(d, i, `#${i}`);
  withJitSteps(S.merge ? 6 : 0, () => items.forEach((d, i) => { if (!dup.has(i)) one(d, i, `#${i}`); }));
  return { S, errors: errs, warnings: warns, stats, cache: cacheOut };
}
