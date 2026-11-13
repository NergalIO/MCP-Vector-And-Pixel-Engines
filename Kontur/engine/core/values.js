/** Значения свойств: ключи, состояния, модификаторы; геометрия узла. */
import { deformGeom, toGeom } from './geom.js';
import { NODE_DEFS } from './types.js';
import { lerp } from './math.js';
import { defaultFor } from './model.js';
import { MODIFIERS, modActive } from './modifiers.js';
import { sampleKeys } from './tracks.js';

const NO_MODS = new Map();
/** Карта «свойство → номера модификаторов» узла (строится один раз на узел, хранится в кэше сцены). */
export function modMapOf(node, c) {
  const mods = node.mods;
  if (!mods || !mods.length) return NO_MODS;
  const mm = c.modMaps.get(node);
  if (mm && mm.src === mods && mm.len === mods.length) return mm.map;
  const map = new Map();
  mods.forEach((m, mi) => {
    const def = MODIFIERS[m.type];
    if (!def) return;
    for (const p of def.targets(m)) { if (!map.has(p)) map.set(p, []); map.get(p).push(mi); }
  });
  c.modMaps.set(node, { src: mods, len: mods.length, map });
  return map;
}

/** Значение свойства узла с учётом ключей, состояний и модификаторов. */
export function propValue(node, name, t, ctx, copy = 0, upTo = Infinity) {
  if (name === 'rotation' && ctx.ikRot && ctx.ikRot.has(node.id) && upTo === Infinity) return ctx.ikRot.get(node.id);
  let v;
  const k = node.keys?.[name];
  const ov = ctx.over && ctx.over.get(node.id);
  if (ov && name in ov) v = ov[name];
  else if (k && k.length) v = sampleKeys(k, t, name, ctx.c.tracks);
  else if (node.props && name in node.props) v = node.props[name];
  else v = defaultFor(node.type, name);
  if (name === 'scale' && v == null) v = 1;
  if (!node.mods) return v;
  const list = modMapOf(node, ctx.c).get(name);
  if (!list) return v;
  for (let j = 0; j < list.length; j++) {
    const mi = list[j];
    if (mi >= upTo) break;
    const m = node.mods[mi];
    const w = modActive(m, t);
    if (!w) continue;
    v = applyMod(node, m, mi, name, v, t, ctx, copy, w);
  }
  return v;
}

/** Применить модификатор (по реестру MODIFIERS). */
export function applyMod(node, m, mi, name, v, t, ctx, copy, w) {
  const def = MODIFIERS[m.type];
  return def ? def.apply(node, m, mi, name, v, t, ctx, copy, w) : v;
}

/** Пружина: детерминированная симуляция от t=0 с фиксированным шагом, с кэшем. */
export function springValue(node, m, mi, name, t, ctx, copy, w, current) {
  const key = `${node.id}|${mi}|${name}|${copy}`;
  const dt = 1 / 240;
  let rec = ctx.c.springs.get(key);
  if (!rec) { rec = { xs: [], vs: [] }; ctx.c.springs.set(key, rec); }
  const target = (tt) => propValue(node, name, tt, ctx, copy, mi);
  const steps = Math.max(0, Math.ceil(t / dt));
  if (!rec.xs.length) { const t0 = target(0); rec.xs.push(typeof t0 === 'number' ? t0 : 0); rec.vs.push(0); }
  const k = m.stiffness ?? 120, c = m.damping ?? 12, mass = m.mass ?? 1;
  while (rec.xs.length <= steps) {
    const i = rec.xs.length - 1;
    const x = rec.xs[i], vel = rec.vs[i];
    const tg = target(i * dt);
    if (typeof tg !== 'number') return current;
    const a = (-k * (x - tg) - c * vel) / mass;
    const nv = vel + a * dt;
    rec.vs.push(nv); rec.xs.push(x + nv * dt);
  }
  const f = t / dt, i0 = Math.floor(f);
  const sv = lerp(rec.xs[i0], rec.xs[Math.min(i0 + 1, rec.xs.length - 1)], f - i0);
  return typeof current === 'number' ? lerp(current, sv, w) : sv;
}

/** Геометрия узла (в его локальных координатах). */
export function nodeGeom(node, t, ctx, copy) {
  const P = (n) => propValue(node, n, t, ctx, copy);
  let g;
  const hasD = node.keys?.d?.length || node.props?.d != null || node.keys?.shape?.length || node.props?.shape != null;
  if (hasD) {
    const k = node.keys?.d?.length ? 'd' : node.keys?.shape?.length ? 'shape' : node.props?.d != null ? 'd' : 'shape';
    let v = node.keys?.[k]?.length ? sampleKeys(node.keys[k], t, k, ctx.c.tracks) : node.props[k];
    if (v && typeof v === 'object' && v.shape === 'blob') v = { ...v, time: t };
    g = toGeom(v, t);
  } else {
    // геометрия по типу — из реестра (types.js)
    const def = NODE_DEFS[node.type];
    g = def?.geom ? def.geom(P, node, t) : [];
  }
  if (node.mods) {
    node.mods.forEach((m) => {
      if (m.type !== 'deform') return;
      const w = modActive(m, t);
      if (!w) return;
      g = deformGeom(g, { ...m, amount: (m.amount ?? 10) * w, seed: (m.seed ?? 0) + copy * 7 }, t);
    });
  }
  return g;
}
