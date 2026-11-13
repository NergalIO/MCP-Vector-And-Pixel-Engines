/** Проверка сцены. */
import { resolveEase } from './ease.js';
import { evaluate } from './evaluate.js';
import { invalidate } from './model.js';
import { NODE_TYPES } from './types.js';
import { nodeRefs } from './ops.js';
import { MODIFIERS } from './modifiers.js';

/** Структурная проверка сцены (без вычисления кадров): типы, id, ссылки, клипы, состояния, IK. Быстрая — для каждой правки. */
export function validateStructure(scene, inner = false) {
  const errs = [];
  if (!scene || !Array.isArray(scene.nodes)) return ['scene.nodes должен быть массивом'];
  for (const k of ['width', 'height', 'duration']) if (typeof scene[k] !== 'number' || !(scene[k] > 0) || scene[k] === Infinity) errs.push(`scene.${k} должен быть числом > 0`);
  const ids = new Set();
  for (const n of scene.nodes) {
    if (typeof n.id !== 'string' || !n.id) errs.push(n.id == null || n.id === '' ? 'Узел без id' : `id узла должен быть строкой: ${JSON.stringify(n.id)}`);
    if (ids.has(n.id)) errs.push(`Повтор id ${n.id}`);
    ids.add(n.id);
    if (!NODE_TYPES.includes(n.type)) errs.push(`${n.id}: неизвестный тип ${n.type}`);
    if (n.type === 'instance' && !scene.symbols?.[n.props?.symbol]) errs.push(`${n.id}: символ «${n.props?.symbol}» не найден в scene.symbols`);
  }
  for (const n of scene.nodes) {
    if (n.parent && !ids.has(n.parent)) errs.push(`${n.id}: родитель ${n.parent} не найден`);
    for (const k of ['clip', 'mask']) if (n.props?.[k] && !ids.has(n.props[k])) errs.push(`${n.id}: ${k} ссылается на несуществующий ${n.props[k]}`);
    for (const m of n.mods || []) if (!MODIFIERS[m.type]) errs.push(`${n.id}: неизвестный модификатор ${m.type}`);
    for (const p in n.keys || {}) for (const k of n.keys[p]) { try { if (k.ease != null) resolveEase(k.ease); } catch (e) { errs.push(`${n.id}.${p}: ${e.message}`); } }
  }
  if (!inner) checkSymbols(scene, errs);
  checkMarkers(scene, errs);
  const cn = new Set();
  for (const c of scene.clips || []) {
    if (!c.name || typeof c.name !== 'string') errs.push('Клип без имени');
    if (typeof c.start !== 'number' || typeof c.end !== 'number') { errs.push(`Клип ${c.name}: start и end должны быть числами`); continue; }
    if (cn.has(c.name)) errs.push(`Повтор имени клипа ${c.name}`);
    cn.add(c.name);
    if (!(c.end > c.start)) errs.push(`Клип ${c.name}: end должен быть больше start`);
    if (c.end > scene.duration + 1e-6) errs.push(`Клип ${c.name} выходит за длительность сцены (${scene.duration}s)`);
    if (c.next && !(scene.clips || []).some((x) => x.name === c.next)) errs.push(`Клип ${c.name}: next ссылается на несуществующий ${c.next}`);
  }
  const sn = new Set();
  for (const g of scene.states || []) {
    if (!g.name) errs.push('Группа состояний без имени');
    if (sn.has(g.name)) errs.push(`Повтор группы состояний ${g.name}`);
    sn.add(g.name);
    if (!g.values || typeof g.values !== 'object') { errs.push(`Состояния ${g.name}: нет values`); continue; }
    if (g.default != null && !(g.default in g.values)) errs.push(`Состояния ${g.name}: default «${g.default}» не среди вариантов`);
    for (const [v, patch] of Object.entries(g.values)) for (const id of Object.keys(patch || {})) if (!ids.has(id)) errs.push(`Состояние ${g.name}=${v}: узел ${id} не найден`);
  }
  for (const n of scene.nodes) {
    const ik = n.props?.ik;
    if (!ik) continue;
    if (!ik.target || !ids.has(ik.target)) errs.push(`${n.id}: цель IK «${ik.target}» не найдена`);
    const B = scene.nodes.find((x) => x.id === n.parent);
    if (!B || !B.parent) errs.push(`${n.id}: для IK нужны родитель и дед`);
  }
  return errs;
}

/** Символы: объект имя → { nodes, duration? }; узлы каждого — как у сцены; экземпляры не образуют цикла. */
function checkSymbols(scene, errs) {
  const syms = scene.symbols;
  if (syms == null) return;
  if (typeof syms !== 'object' || Array.isArray(syms)) { errs.push('scene.symbols должен быть объектом: имя → { nodes, duration? }'); return; }
  const uses = new Map();
  for (const [name, s] of Object.entries(syms)) {
    if (!s || !Array.isArray(s.nodes)) { errs.push(`Символ ${name}: нет массива nodes`); continue; }
    if (s.duration != null && !(s.duration > 0)) errs.push(`Символ ${name}: duration должен быть > 0`);
    for (const e of validateStructure({ width: 1, height: 1, duration: 1, nodes: s.nodes, symbols: syms }, true)) errs.push(`Символ ${name}: ${e}`);
    uses.set(name, s.nodes.filter((n) => n.type === 'instance').map((n) => n.props?.symbol));
  }
  // цикл: символ (через вложенные экземпляры) содержит сам себя
  const state = new Map();
  const visit = (name, path) => {
    if (state.get(name) === 2) return;
    if (state.get(name) === 1) { errs.push(`Цикл символов: ${[...path, name].join(' → ')}`); return; }
    state.set(name, 1);
    for (const u of uses.get(name) || []) if (uses.has(u)) visit(u, [...path, name]);
    state.set(name, 2);
  };
  for (const name of uses.keys()) visit(name, []);
}
/** Маркеры: [{ t, name, data? }] внутри длительности, имена без повторов. */
function checkMarkers(scene, errs) {
  const ms = scene.markers;
  if (ms == null) return;
  if (!Array.isArray(ms)) { errs.push('scene.markers должен быть массивом { t, name }'); return; }
  const seen = new Set();
  for (const m of ms) {
    if (!m || typeof m.name !== 'string' || !m.name) { errs.push('Маркер без имени'); continue; }
    if (seen.has(m.name)) errs.push(`Повтор маркера ${m.name}`);
    seen.add(m.name);
    if (!(typeof m.t === 'number' && m.t >= 0 && m.t <= scene.duration + 1e-6)) errs.push(`Маркер ${m.name}: t должен быть в 0..${scene.duration}`);
  }
}

/** Полная проверка сцены: структура + вычисление кадров 0 и середины. Возвращает список проблем. */
export function validateScene(scene, { only } = {}) {
  const errs = validateStructure(scene);
  if (!errs.length) { try { evaluate(scene, 0, { only }); evaluate(scene, scene.duration / 2, { only }); } catch (e) { errs.push('Ошибка вычисления: ' + e.message); } }
  return errs;
}

/**
 * Починить висячие ссылки (на месте): маски, link/followPath, цель IK и патчи состояний на несуществующие узлы
 * убираются, узлы с несуществующим родителем переходят в корень. Возвращает описания исправлений.
 * Нужна, чтобы сцена, сохранённая с такой ошибкой, открывалась, а не терялась.
 */
export function repairScene(scene) {
  const notes = [];
  if (!scene || !Array.isArray(scene.nodes)) return notes;
  const ids = new Set(scene.nodes.map((n) => n.id));
  for (const n of scene.nodes) {
    if (n.parent && !ids.has(n.parent)) { notes.push(`${n.id}: родителя ${n.parent} нет — перенесён в корень`); n.parent = null; }
    for (const r of nodeRefs(n)) {
      if (ids.has(r.id)) continue;
      // у followPath строка — либо id узла, либо путь d (с пробелами и числами): путь не трогаем
      if (r.kind === 'мод followPath' && !/^[A-Za-z_][\w-]*$/.test(r.id)) continue;
      r.drop(); notes.push(`${n.id}: ${r.kind} → ${r.id} (нет такого узла) — убрано`);
    }
  }
  for (const g of scene.states || []) for (const [v, patch] of Object.entries(g.values || {})) for (const k of Object.keys(patch || {})) if (!ids.has(k)) { delete patch[k]; notes.push(`состояние ${g.name}=${v}: ${k} (нет такого узла) — убрано`); }
  if (notes.length) invalidate(scene);
  return notes;
}
