// Действия над объектами: удалить, копировать, вставить, дублировать, группировать, порядок, перенос в другую группу.
import { K, E, node, kidsOf, subtree, topSel, sceneOrder, uid, edit, select, toast, cloneNodes, insertClones, moveInArray, shiftNode, getVal, localM, setLocalM, worldM, screenM, M, applyPt, emit } from './core.js';
import { selAABB, localBox } from './view.js';

/** Структурные правки пишут в свойства, а не в ключи/состояния. */
export function raw(fn) {
  const ak = E.autoKey, rec = E.record;
  E.autoKey = false; E.record = null;
  try { return fn(); } finally { E.autoKey = ak; E.record = rec; }
}
function removeDeep(ids) {
  const kill = new Set(ids.flatMap(subtree));
  E.scene.nodes = E.scene.nodes.filter((n) => !kill.has(n.id));
  for (const n of E.scene.nodes) {
    for (const k of ['clip', 'mask']) if (n.props?.[k] && kill.has(n.props[k])) delete n.props[k];
    if (n.props?.ik && kill.has(n.props.ik.target)) delete n.props.ik;
  }
  for (const g of E.scene.states || []) for (const patch of Object.values(g.values || {})) for (const id of Object.keys(patch)) if (kill.has(id)) delete patch[id];
  E.ver++;
  return kill;
}
export function deleteSel() {
  const ids = topSel();
  if (!ids.length) return;
  if (edit('удалить', () => removeDeep(ids))) select([]);
}
export function deleteIds(ids, label = 'удалить') { return edit(label, () => removeDeep(ids)); }

export function copySel() {
  const ids = topSel();
  if (!ids.length) return;
  E.clipboard = { nodes: cloneNodes(ids), parent: node(ids[0]).parent ?? null };
  toast(`Скопировано: ${ids.length}`);
}
export function cutSel() { copySel(); deleteSel(); }
export function paste() {
  if (!E.clipboard) return;
  const parent = E.scope ?? null;
  let ids = [];
  edit('вставка', () => raw(() => {
    const list = structuredClone(E.clipboard.nodes);
    ids = insertClones(list, parent, null);
    K.invalidate(E.scene);
    // вставка на то же место сдвигается, чтобы копия была видна
    if (parent === E.clipboard.parent) for (const id of ids) { const d = applyPt(M.inv(linearOf(screenM(parent))), [20, 20]); shiftNode(node(id), d[0], d[1]); }
  }));
  select(ids);
}
const linearOf = (m) => [m[0], m[1], m[2], m[3], 0, 0];
export function duplicateSel() {
  const ids = topSel();
  if (!ids.length) return;
  let out = [];
  edit('дубль', () => { for (const id of ids) out.push(...insertClones(cloneNodes([id]), node(id).parent ?? null, id)); });
  select(out);
}

export function groupSel() {
  const ids = sceneOrder(topSel());
  if (!ids.length) return;
  const parent = node(ids[0]).parent ?? null;
  if (ids.some((id) => (node(id).parent ?? null) !== parent)) return toast('Сгруппировать можно объекты одного уровня', true);
  const b = selAABB(ids);
  const c = b ? applyPt(M.inv(screenM(parent)), [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]) : [0, 0];
  const gid = uid('group');
  const ok = edit('группа', () => raw(() => {
    const last = Math.max(...ids.map((id) => E.scene.nodes.indexOf(node(id))));
    const g = { id: gid, type: 'group', props: { x: Math.round(c[0] * 100) / 100, y: Math.round(c[1] * 100) / 100 } };
    if (parent) g.parent = parent;
    E.scene.nodes.splice(last + 1, 0, g);
    E.ver++;
    for (const id of ids) { const n = node(id); n.parent = gid; shiftNode(n, -g.props.x, -g.props.y); }
  }));
  if (ok) select(gid);
}
const TF = ['x', 'y', 'rotation', 'scale', 'scaleX', 'scaleY', 'skewX', 'anchorX', 'anchorY'];
export function ungroupSel() {
  const groups = topSel().map(node).filter((n) => n?.type === 'group' && kidsOf(n.id).length);
  if (!groups.length) return toast('Выберите группу', true);
  const freed = [];
  let lost = false;
  const ok = edit('разгруппировать', () => raw(() => {
    for (const g of groups) {
      const L = localM(g), pure = Math.abs(L[0] - 1) < 1e-9 && Math.abs(L[1]) < 1e-9 && Math.abs(L[2]) < 1e-9 && Math.abs(L[3] - 1) < 1e-9;
      if (TF.some((p) => g.keys?.[p]?.length) || g.mods?.length || (g.props?.opacity ?? 1) < 1 || g.props?.blend || g.props?.clip || g.props?.mask) lost = true;
      const kids = kidsOf(g.id);
      for (const c of kids) {
        if (pure) shiftNode(c, L[4], L[5]);
        else { if (TF.some((p) => c.keys?.[p]?.length)) lost = true; setLocalM(c, M.mul(L, localM(c))); }
        if (g.parent) c.parent = g.parent; else delete c.parent;
        freed.push(c.id);
      }
      // дети встают на место группы
      const nodes = E.scene.nodes, set = new Set(kids.map((k) => k.id));
      const moved = nodes.filter((n) => set.has(n.id));
      E.scene.nodes = nodes.filter((n) => !set.has(n.id));
      E.scene.nodes.splice(E.scene.nodes.indexOf(g), 1, ...moved);
      E.ver++;
      K.invalidate(E.scene);
    }
  }));
  if (ok) { select(freed); if (lost) toast('У группы были анимация, прозрачность или эффекты — они не перенесены на детей', true); }
}

/** Выше/ниже среди соседей (to: 'up' | 'down' | 'top' | 'bottom'). */
export function restack(to) {
  const ids = topSel();
  if (!ids.length) return;
  edit('порядок', () => {
    const list = to === 'up' || to === 'top' ? [...sceneOrder(ids)].reverse() : sceneOrder(ids);
    for (const id of list) {
      const sib = kidsOf(node(id).parent ?? null), i = sib.findIndex((n) => n.id === id);
      if (to === 'up' && i < sib.length - 1 && !ids.includes(sib[i + 1].id)) moveInArray(id, sib[i + 1].id, 'after');
      if (to === 'down' && i > 0 && !ids.includes(sib[i - 1].id)) moveInArray(id, sib[i - 1].id, 'before');
      if (to === 'top' && i < sib.length - 1) moveInArray(id, sib[sib.length - 1].id, 'after');
      if (to === 'bottom' && i > 0) moveInArray(id, sib[0].id, 'before');
    }
  });
}

/** Перенести объекты в другую группу (с сохранением положения на экране) и поставить рядом с ref. */
export function reparent(ids, newParent, ref, where) {
  let approx = false;
  const ok = edit('перенос', () => raw(() => {
    for (const id of ids) {
      if (id === newParent || (newParent && subtree(id).includes(newParent))) throw new Error('Нельзя вложить объект в самого себя');
      const n = node(id), old = n.parent ?? null;
      if (old !== newParent) {
        const D = M.mul(M.inv(worldM(newParent)), worldM(old));
        if (Math.abs(D[0] - 1) < 1e-6 && Math.abs(D[1]) < 1e-6 && Math.abs(D[2]) < 1e-6 && Math.abs(D[3] - 1) < 1e-6) shiftNode(n, D[4], D[5]);
        else { if (TF.some((p) => n.keys?.[p]?.length)) approx = true; setLocalM(n, M.mul(D, localM(n))); }
        if (newParent) n.parent = newParent; else delete n.parent;
        E.ver++; K.invalidate(E.scene);
      }
      if (ref !== id) moveInArray(id, ref, where);
    }
  }));
  if (ok && approx) toast('Анимация трансформации пересчитана только для текущего кадра', true);
  if (ok) emit('sel');
}

/** Превратить фигуру в контур (для правки точек). */
const SHAPE_PROPS = ['width', 'height', 'radius', 'rx', 'ry', 'r', 'sides', 'points', 'outerRadius', 'innerRadius', 'cornerRadius', 'x1', 'y1', 'x2', 'y2', 'smooth', 'closed', 'tension', 'shape'];
export function toPathNode(n, geom) {
  const fill = n.props?.fill ?? K.propDefault(n.type, 'fill'), stroke = n.props?.stroke ?? K.propDefault(n.type, 'stroke');
  const keyed = SHAPE_PROPS.some((p) => n.keys?.[p]?.length);
  for (const p of SHAPE_PROPS) { if (n.props) delete n.props[p]; if (n.keys) delete n.keys[p]; }
  n.type = 'path';
  n.props = { ...n.props, d: K.geomToPath(geom), fill, stroke };
  if (n.keys && !Object.keys(n.keys).length) delete n.keys;
  E.ver++;
  return keyed;
}

/** Опора в центр рамки: картинка остаётся на месте (сдвигаются x/y со всеми ключами). */
export function centerPivot(ids = topSel()) {
  if (E.record) return toast('Выйдите из записи состояния, чтобы двигать опору');
  edit('опора в центр', () => {
    for (const id of ids) {
      const n = node(id), box = localBox(id);
      if (!n || !box || n.type === 'light') continue;
      const a = [box[0] + box[2] / 2, box[1] + box[3] / 2], p = applyPt(localM(n), a);
      const da = [a[0] - getVal(n, 'anchorX'), a[1] - getVal(n, 'anchorY')];
      for (const [prop, d] of [['anchorX', da[0]], ['anchorY', da[1]]]) {
        if (Math.abs(d) < 1e-6) continue;
        if (n.keys?.[prop]?.length) for (const k of n.keys[prop]) k.v = r4(k.v + d);
        (n.props ||= {})[prop] = r4((n.props[prop] ?? 0) + d);
      }
      shiftNode(n, p[0] - getVal(n, 'x'), p[1] - getVal(n, 'y'));
    }
  });
}
const r4 = (v) => Math.round(v * 1e4) / 1e4;
