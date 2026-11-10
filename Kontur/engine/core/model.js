/** Модель сцены: значения по умолчанию, индекс и кэши сцены (типы узлов — types.js). */
import { TYPE_DEFAULTS } from './types.js';


export const VERSION = '0.2.0';



export const DEFAULTS = {
  x: 0, y: 0, rotation: 0, scale: 1, scaleX: 1, scaleY: 1, skewX: 0, anchorX: 0, anchorY: 0, opacity: 1,
  strokeWidth: 2, lineCap: 'round', lineJoin: 'round', trimStart: 0, trimEnd: 1, trimOffset: 0,
  blur: 0, width: 100, height: 100, radius: 0, rx: 50, ry: 50, sides: 6, points: 5, outerRadius: 50,
  innerRadius: 22, cornerRadius: 0, x1: 0, y1: 0, x2: 100, y2: 0, fontSize: 48,
  fontFamily: 'Inter, Segoe UI, Roboto, Helvetica, Arial, sans-serif', fontWeight: 600, textAlign: 'center',
  letterSpacing: 0, textReveal: 1, text: '', pathProgress: 0, visible: true,
};
export function defaultFor(type, prop) {
  if (prop === 'fill') return type === 'path' || type === 'line' || type === 'group' ? 'none' : '#ffffff';
  if (prop === 'stroke') return type === 'line' ? '#ffffff' : 'none';
  if (TYPE_DEFAULTS[type] && prop in TYPE_DEFAULTS[type]) return TYPE_DEFAULTS[type][prop];
  return DEFAULTS[prop];
}

/** Значение свойства по умолчанию для типа узла (для редактора и инструментов). */
export const propDefault = (type, prop) => defaultFor(type, prop);

export function createScene(o = {}) {
  return {
    version: 1,
    width: o.width ?? 1920, height: o.height ?? 1080,
    duration: o.duration ?? 6, fps: o.fps ?? 60,
    background: o.background ?? '#0d0f1a', loop: o.loop ?? true,
    nodes: [],
  };
}

/* ---- кэши, зависящие от сцены ---- */
export const sceneCaches = new WeakMap();
export function cacheFor(scene) {
  let c = sceneCaches.get(scene);
  if (!c) { c = { children: null, byId: null, clipRefs: null, springs: new Map(), measures: new Map(), evalCache: new Map(), stat: new Map(), tracks: new Map(), modMaps: new WeakMap(), autoNext: new Map() }; sceneCaches.set(scene, c); }
  return c;
}

/** Сбросить все кэши после изменения сцены. */
export function invalidate(scene) { sceneCaches.delete(scene); }

/**
 * Сбросить только то, что зависит от узла id (его свойства, ключи или модификаторы изменились, а id, родитель,
 * тип, маски и IK — нет): пружины, дорожки, статичный кэш узла, предков и тех, кто ссылается на узел.
 * Если индекса ещё нет или узел неизвестен — полный сброс.
 */
export function invalidateNode(scene, id) {
  const c = sceneCaches.get(scene);
  if (!c || !c.byId || !c.byId.has(id)) { sceneCaches.delete(scene); return; }
  const node = c.byId.get(id);
  // кто зависит: сам узел, его пользователи (маски, link, followPath) — и предки всех их
  const touched = new Set([id]);
  const queue = [id];
  while (queue.length) { const x = queue.pop(); for (const u of c.refUsers.get(x) || []) if (!touched.has(u)) { touched.add(u); queue.push(u); } }
  const drop = new Set();
  for (const x of touched) for (let p = x; p != null && !drop.has(p); p = c.byId.get(p)?.parent ?? null) drop.add(p);
  for (const x of drop) c.stat.delete(x);
  if (c.evalCache.size) for (const k of [...c.evalCache.keys()]) if (drop.has(k.slice(0, k.indexOf('|')))) c.evalCache.delete(k);
  if (touched.size > 1) c.springs.clear();
  else for (const k of [...c.springs.keys()]) if (k.startsWith(id + '|')) c.springs.delete(k);
  for (const k of [...c.measures.keys()]) if (k.startsWith('fp|' + id + '|')) c.measures.delete(k);
  for (const k in node.keys || {}) c.tracks.delete(node.keys[k]);
  c.modMaps.delete(node);
}

/**
 * Узел добавлен в конец scene.nodes: дополнить индекс без полного пересчёта (тысячи addNode подряд — O(n)).
 * Узлы с масками, IK или вставкой не в конец требуют полного сброса.
 */
export function noteNodeAdded(scene, node) {
  const c = sceneCaches.get(scene);
  if (!c || !c.byId || node.props?.ik || node.props?.clip || node.props?.mask || scene.nodes[scene.nodes.length - 1] !== node) { sceneCaches.delete(scene); return; }
  if (c.nodesRef !== scene.nodes || c.nodesLen !== scene.nodes.length - 1) { sceneCaches.delete(scene); return; }
  c.nodesLen++;
  c.byId.set(node.id, node);
  const p = node.parent ?? null;
  if (!c.children.has(p)) c.children.set(p, []);
  c.children.get(p).push(node);
  addRefs(c, node);
  if (p != null) invalidateNode(scene, p);
}

function addRefs(c, n) {
  const add = (target) => { if (!c.refUsers.has(target)) c.refUsers.set(target, new Set()); c.refUsers.get(target).add(n.id); };
  for (const k of ['clip', 'mask']) if (n.props?.[k]) add(n.props[k]);
  if (n.type === 'text' && typeof n.props?.path === 'string') add(n.props.path);
  for (const m of n.mods || []) {
    if (m.type === 'link' && m.source) add(m.source);
    if (m.type === 'followPath' && typeof m.path === 'string') add(m.path);
  }
}

export function index(scene) {
  let c = cacheFor(scene);
  // сцену поменяли в обход ops (новый массив узлов или другая длина) — индекс и кэши устарели
  if (c.byId && (c.nodesRef !== scene.nodes || c.nodesLen !== scene.nodes.length)) { sceneCaches.delete(scene); c = cacheFor(scene); }
  if (!c.byId) {
    c.nodesRef = scene.nodes; c.nodesLen = scene.nodes.length;
    c.byId = new Map(); c.children = new Map(); c.clipRefs = new Set(); c.refUsers = new Map();
    c.ik = []; c.ikAffected = new Set(); c.stateAffected = new Set();
    for (const n of scene.nodes) {
      c.byId.set(n.id, n);
      const p = n.parent ?? null;
      if (!c.children.has(p)) c.children.set(p, []);
      c.children.get(p).push(n);
      for (const k of ['clip', 'mask']) if (n.props?.[k]) c.clipRefs.add(n.props[k]);
      addRefs(c, n);
      if (n.keys) for (const k in n.keys) if (n.keys[k].some((a, i, arr) => i && arr[i - 1].t > a.t)) n.keys[k].sort((a, b) => a.t - b.t);
    }
    // IK-цепочки: props.ik на конечном узле; поворачиваются его родитель и дед
    const depth = (id) => { let d = 0, p = c.byId.get(id)?.parent; while (p && d < 999) { d++; p = c.byId.get(p)?.parent; } return d; };
    for (const n of scene.nodes) {
      const ik = n.props?.ik;
      if (!ik || typeof ik !== 'object' || !ik.target || ik.enabled === false) continue;
      const B = c.byId.get(n.parent), A = B && c.byId.get(B.parent);
      if (!A || !c.byId.has(ik.target)) continue;
      c.ik.push({ end: n.id, mid: B.id, root: A.id, cfg: ik, depth: depth(A.id) });
      c.ikAffected.add(A.id); c.ikAffected.add(B.id); if (ik.orient) c.ikAffected.add(n.id);
    }
    c.ik.sort((a, b) => a.depth - b.depth);
    for (const g of scene.states || []) for (const v of Object.values(g.values || {})) for (const id of Object.keys(v || {})) c.stateAffected.add(id);
  }
  return c;
}
