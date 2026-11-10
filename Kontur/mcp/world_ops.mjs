// Операции 2.5D над сценой Kontur: сборка мира из 3D-описания, пересборка после смены камеры, материал на грань.
import { invalidate, nodeWorldMatrix, mat, toGeom, resolveSurface, surfaceAxes, subtreeOf } from '../engine/kontur.js';
import { buildWorld, toNodes, Scene, materialPrims, unproject, camera, CAMERA_DEFAULT, fitCamera, MATERIALS, withSeed } from '../engine/world3d.js';
import { MATERIAL_PRESETS } from './materials.mjs';
import { nodeById, needNode } from './scene_util.mjs';

/** id узла и всех его потомков (индекс движка). */
export const subtreeIds = (scene, id) => new Set(subtreeOf(scene, id));
/**
 * Заменить поддерево id новыми узлами на том же месте (или добавить в конец).
 * preserve (пересборка мира): ключи анимации узлов с тем же id переносятся в новые узлы, а узлы, добавленные в группу
 * вручную (id не начинается с префикса сборки), остаются — под тем же родителем, если он есть в новой сборке.
 */
function replaceSubtree(scene, id, nodes, preserve = null) {
  const old = scene.nodes.some((n) => n.id === id) ? subtreeIds(scene, id) : new Set();
  if (preserve && old.size) {
    const fresh = new Map(nodes.map((n) => [n.id, n]));
    const extra = [];
    for (const n of scene.nodes) {
      if (!old.has(n.id) || n.id === id) continue;
      const nn = fresh.get(n.id);
      if (nn) { if (n.keys && !nn.keys) nn.keys = n.keys; continue; }
      if (!n.id.startsWith(preserve.prefix) && (fresh.has(n.parent) || extra.some((e) => e.id === n.parent))) extra.push(n);
    }
    if (extra.length) nodes = [...nodes, ...extra];
  }
  const at = scene.nodes.findIndex((n) => old.has(n.id));
  const keep = scene.nodes.filter((n) => !old.has(n.id));
  const taken = new Set(keep.map((n) => n.id));
  const clash = nodes.find((n) => taken.has(n.id));
  if (clash) throw new Error(`id «${clash.id}» уже занят другим узлом — задайте другое имя группы`);
  const pos = at < 0 ? keep.length : Math.min(at, keep.length);
  scene.nodes = [...keep.slice(0, pos), ...nodes, ...keep.slice(pos)];
  invalidate(scene);
}

export function cameraOf(scene) { return { ...CAMERA_DEFAULT, cx: scene.width / 2, ...(scene.camera3d || {}) }; }

/**
 * Собрать узлы из 3D-описания в группу group (заменяя прежнюю). Описание хранится в props.world3d группы —
 * при смене камеры мир пересобирается. Возвращает { group, nodes, items, lights, occluders, errors }.
 */
/** Кэш сборки по группам мира: результаты предметов прошлой сборки (v2) — пересобираются только изменённые. */
const WORLD_CACHE = new Map();
/** Предметам без id (v2) — id по номеру (не занятый): удаление и вставка предметов не сдвигают подсиды остальных. */
export function withItemIds(items) {
  const taken = new Set(items.filter((d) => d?.id != null).map((d) => String(d.id)));
  return items.map((d, i) => {
    if (!d || typeof d !== 'object' || d.id != null) return d;
    let id = String(i), k = 1;
    while (taken.has(id)) id = `${i}_${k++}`;
    taken.add(id);
    return { id: /^\d+$/.test(id) ? +id : id, ...d };
  });
}
/**
 * v: версия сборки мира — 2 (по умолчанию для новых миров): подсиды предметов и граней, стабильные id,
 * детализация lod (1) и слияние деталей merge (true); 1 — прежняя. pan — проезд камеры [[t, dx], …].
 */
export function worldBuild(scene, { items = [], seed = 1, group = 'world', sky, background, parent = null, occ, materials, v = 2, lod, merge, tess, pan } = {}) {
  if (v >= 2) items = withItemIds(items);
  if (!scene.camera3d) scene.camera3d = fitCamera({ width: scene.width, height: scene.height });
  // попиксельные материалы (pmat у предметов): описание сливается в scene.materials
  if (materials && typeof materials === 'object') scene.materials = { ...(scene.materials || {}), ...materials };
  const { S, errors, warnings, stats, cache } = buildWorld({ width: scene.width, height: scene.height, camera3d: cameraOf(scene), seed, items, sky, v, lod, merge, tess, cache: WORLD_CACHE.get(group) || new Map(), ...(occ ? { occ } : {}) });
  if (cache) WORLD_CACHE.set(group, cache);
  const opt = { ...(v >= 2 ? { v: 2 } : {}), ...(lod != null ? { lod } : {}), ...(merge != null ? { merge } : {}), ...(tess ? { tess } : {}), ...(pan ? { pan } : {}), ...(sky ? { sky } : {}), ...(occ ? { occ } : {}) };
  const r = toNodes(S, { group, idPrefix: `${group}_`, parent, pan, world3d: { items, seed, ...opt } });
  replaceSubtree(scene, group, r.nodes, { prefix: `${group}_` });
  const defBg = !scene.background || scene.background === '#0d0f1a';
  if (background === true || (background !== false && (sky || defBg))) scene.background = r.background;
  for (const [i, n] of Object.entries(r.perItem)) if (stats[i]) stats[i].nodes = n;
  return { group, nodes: r.nodes.length, items: S.items.length, lights: S.lights.length, occluders: S.occ.length + S.tris.length, errors, warnings, stats, hints: worldHints(items, stats, r.nodes.length) };
}
/** Подсказки агенту: тяжёлые предметы и как их облегчить. */
export function worldHints(items, stats, total) {
  const out = [];
  stats.forEach((s, i) => {
    if (!s || !(s.nodes > 2000)) return;
    const d = items[i] || {};
    const tip = d.mat || d.type === 'ground' || d.type === 'house' ? 'векторный материал даёт тысячи деталей — задайте mat: false (house: mat: "none") и pmat (попиксельная фактура)' : 'уменьшите размер или детализацию';
    out.push(`#${i} (${s.type}): ${s.nodes} узлов — ${tip}`);
  });
  if (total > 15000) out.push(`всего ${total} узлов: рендер и отложенный свет замедлятся; lod: 2 упрощает дальние детали`);
  return out;
}
const worldOpts = (w) => ({ items: w.items, seed: w.seed, sky: w.sky, occ: w.occ, v: w.v ?? 1, lod: w.lod, merge: w.merge, tess: w.tess, pan: w.pan });
/**
 * Правка одного предмета мира group: найти по id (или index), заменить (item), дополнить (patch; null — удалить поле),
 * удалить (remove) или добавить новый (add). Мир пересобирается; неизменённые предметы берутся из кэша.
 */
export function worldItemEdit(scene, { group = 'world', id, index, item, patch, remove, add } = {}) {
  const g = nodeById(scene, group);
  if (!g?.props?.world3d) throw new Error(`Группа мира ${group} не найдена (world_build создаёт её)`);
  const w = g.props.world3d, items = w.items.slice();
  let i = -1;
  if (add) items.push(add);
  else {
    i = id != null ? items.findIndex((d) => d && String(d.id) === String(id)) : index ?? -1;
    if (!(i >= 0 && i < items.length)) throw new Error(`Предмет ${id != null ? `id «${id}»` : `#${index}`} не найден в ${group} (предметов: ${items.length})`);
    if (remove) items.splice(i, 1);
    else if (item) items[i] = item;
    else if (patch) { const d = { ...items[i] }; for (const [k, v] of Object.entries(patch)) { if (v === null) delete d[k]; else d[k] = v; } items[i] = d; }
    else throw new Error('нужно item, patch, remove или add');
  }
  const r = worldBuild(scene, { ...worldOpts(w), items, group, parent: g.parent ?? null, background: false });
  return { ...r, index: add ? items.length - 1 : i };
}
/** Пересобрать все группы с props.world3d (после смены камеры или размеров). */
export function rebuildWorlds(scene) {
  const groups = scene.nodes.filter((n) => n.props?.world3d && Array.isArray(n.props.world3d.items));
  const out = [];
  for (const g of groups) {
    const w = g.props.world3d;
    out.push(worldBuild(scene, { ...worldOpts(w), group: g.id, parent: g.parent ?? null, background: false }));
  }
  return out;
}
/** Камера: явные параметры и/или подбор по росту персонажа у нижнего края кадра. */
export function cameraSet(scene, a = {}) {
  let c = { ...cameraOf(scene) };
  if (a.charPx || a.fit) c = { ...c, ...fitCamera({ width: scene.width, height: scene.height, hor: a.hor ?? c.hor, charPx: a.charPx, bottom: a.bottom ?? scene.height, f: a.f, dz: a.dz ?? c.dz }) };
  for (const k of ['hor', 'f', 'camH', 'dz', 'cx', 'yaw', 'pitch']) if (a[k] != null) c[k] = a[k];
  if (a.keepVerticals != null) c.keepVerticals = !!a.keepVerticals;
  // нулевой поворот не храним: камера без yaw/pitch — та же формула, что и раньше
  for (const k of ['yaw', 'pitch']) if (!c[k]) delete c[k];
  if (!c.keepVerticals) delete c.keepVerticals;
  scene.camera3d = c;
  return c;
}

/** Действующая поверхность узла (с предками). */
export function surfaceOfNode(scene, id) {
  const by = new Map(scene.nodes.map((n) => [n.id, n]));
  const chain = [];
  for (let n = by.get(id); n; n = n.parent ? by.get(n.parent) : null) chain.unshift(n);
  let s = null;
  for (const n of chain) s = resolveSurface(s, n.props?.surface);
  return s;
}
const SHAPE_OF = (n) => {
  const p = n.props || {};
  if (p.d) return p.d;
  if (n.type === 'rect') return { shape: 'rect', width: p.width ?? 100, height: p.height ?? 100, radius: p.radius ?? 0 };
  if (n.type === 'ellipse' || n.type === 'circle') return { shape: 'ellipse', rx: p.rx ?? p.r ?? 50, ry: p.ry ?? p.r ?? 50 };
  if (Array.isArray(p.points)) return { points: p.points, closed: p.closed ?? true };
  return null;
};
/**
 * Наложить материал на узел-грань: детали строятся на её плоскости (surface.plane) в рамке по габаритам узла
 * и кладутся группой <id>_mat сразу после узла, обрезанные копией его контура.
 */
export function materialApply(scene, { id, material, color, options = {}, seed = 1, frame, mode, params } = {}) {
  if (mode === 'pixel') return materialApplyPixel(scene, { id, material, params });
  if (!MATERIALS.includes(material)) throw new Error(`Материал ${material}? Есть: ${MATERIALS.join(', ')}`);
  const node = needNode(scene, id);
  const s = surfaceOfNode(scene, id);
  if (!s?.plane) throw new Error(`У узла ${id} нет surface.plane — материалу не на что лечь (задайте surface_set или постройте грань world_build)`);
  const cam = camera(cameraOf(scene), scene.width);
  const shape = SHAPE_OF(node);
  if (!shape) throw new Error(`Узел ${id} (${node.type}) — не фигура`);
  const geom = toGeom(shape, 0);
  const M = nodeWorldMatrix(scene, id, 0);
  let fr = frame;
  if (!fr) {
    const pts = [];
    for (const sp of geom) { pts.push([sp.x0, sp.y0]); for (const c of sp.segs) pts.push([c[4], c[5]]); }
    const P3 = pts.map(([x, y]) => unproject(cam, ...mat.apply(M, x, y), s.plane)).filter(Boolean);
    if (P3.length < 3) throw new Error('Плоскость грани не видна камерой: проверьте surface.plane и camera3d');
    const n = s.plane.slice(0, 3), ax = surfaceAxes(n);
    const u = s.u || ax.u, v = s.v || ax.v;
    const as = P3.map((p) => p[0] * u[0] + p[1] * u[1] + p[2] * u[2]), bs = P3.map((p) => p[0] * v[0] + p[1] * v[1] + p[2] * v[2]);
    const a0 = Math.min(...as), b0 = Math.min(...bs);
    const i0 = as.indexOf(a0);
    // начало рамки: точка плоскости с координатами (a0, b0)
    const base = P3[i0], db = b0 - bs[i0];
    fr = { o: [base[0] + v[0] * db, base[1] + v[1] * db, base[2] + v[2] * db], u, v, w: Math.max(...as) - a0, h: Math.max(...bs) - b0, n };
  }
  const S = Scene({ W: scene.width, H: scene.height, ...cameraOf(scene) });
  const prims = withSeed(seed, () => materialPrims(S, fr, material, color, options));
  S.item(0, prims, { name: material });
  const gid = `${id}_mat`, cid = `${id}_matclip`;
  const r = toNodes(S, { group: gid, idPrefix: `${id}_m`, parent: node.parent ?? null, lights: false });
  // детали — в экранных координатах: под трансформированным родителем группа получает обратную трансформацию
  const inv = node.parent ? decompose(mat.inv(nodeWorldMatrix(scene, node.parent, 0))) : {};
  r.nodes[0].props = { ...r.nodes[0].props, ...inv, name: `${material} на ${id}` };
  const wrap = { id: `${gid}_clip`, type: 'group', parent: node.parent ?? null, props: { clip: cid } };
  r.nodes[0].parent = wrap.id;
  r.nodes.unshift(wrap);
  const clipNode = { id: cid, type: node.type === 'path' ? 'path' : node.type, parent: node.parent ?? null, props: { ...JSON.parse(JSON.stringify(node.props || {})), fill: '#ffffff', stroke: 'none' } };
  delete clipNode.props.surface; delete clipNode.props.clip; delete clipNode.props.mask;
  // заменить прежний материал, затем вставить сразу после узла-грани
  for (const old of [`${gid}_clip`, gid, cid]) if (scene.nodes.some((n) => n.id === old)) { const ids = subtreeIds(scene, old); scene.nodes = scene.nodes.filter((n) => !ids.has(n.id)); }
  const at = scene.nodes.findIndex((n) => n.id === id);
  scene.nodes.splice(at + 1, 0, clipNode, ...r.nodes);
  invalidate(scene);
  return { group: gid, nodes: r.nodes.length, frame: fr };
}

/**
 * Попиксельный материал (этап 2): описание кладётся в scene.materials[material] (params, иначе готовое из
 * MATERIAL_PRESETS или уже существующее), узел получает surface.mat — компоновщик сам считает вариацию цвета,
 * грязь, износ рёбер, текстуру и микрорельеф. Векторный материал <id>_mat, если был, удаляется.
 */
export function materialApplyPixel(scene, { id, material, params }) {
  const ids = Array.isArray(id) ? id : [id];
  const def = params || scene.materials?.[material] || MATERIAL_PRESETS[material];
  if (!def) throw new Error(`Материал ${material}: нет params и нет готового (есть: ${Object.keys(MATERIAL_PRESETS).join(', ')}${scene.materials ? `; в сцене: ${Object.keys(scene.materials).join(', ')}` : ''})`);
  scene.materials = { ...(scene.materials || {}), [material]: def };
  for (const nid of ids) {
    const node = needNode(scene, nid);
    node.props = { ...(node.props || {}), surface: { ...(typeof node.props?.surface === 'object' ? node.props.surface : {}), mat: material } };
    for (const old of [`${nid}_mat_clip`, `${nid}_mat`, `${nid}_matclip`]) if (scene.nodes.some((n) => n.id === old)) { const s = subtreeIds(scene, old); scene.nodes = scene.nodes.filter((n) => !s.has(n.id)); }
  }
  invalidate(scene);
  return { mode: 'pixel', material, ids, params: def, materials: Object.keys(scene.materials) };
}

/** Матрица [a,b,c,d,e,f] → свойства узла (translate · rotate · skewX · scale). */
function decompose([a, b, c, d, e, f]) {
  const near = (x, y) => Math.abs(x - y) < 1e-9;
  if (near(a, 1) && near(b, 0) && near(c, 0) && near(d, 1) && near(e, 0) && near(f, 0)) return {};
  const r = Math.atan2(b, a), sx = Math.hypot(a, b), cs = Math.cos(r), sn = Math.sin(r);
  const c2 = cs * c + sn * d, sy = -sn * c + cs * d;
  return { x: e, y: f, rotation: (r * 180) / Math.PI, skewX: (Math.atan(c2 / (sy || 1e-12)) * 180) / Math.PI, scaleX: sx, scaleY: sy };
}
