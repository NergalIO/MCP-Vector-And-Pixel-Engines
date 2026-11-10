// Ядро редактора: состояние, события, история, значения свойств с учётом ключей и состояний,
// матрицы, синхронизация с MCP-сервером.
export const K = window.Kontur || await import('../../engine/kontur.js');

export const E = {
  scene: K.createScene(), ver: 0,
  sel: [], scope: null, hover: null, tool: 'select',
  t: 0, autoKey: false, record: null /* {group, value} — правки идут в вариант состояния */, states: {},
  live: false, source: null, rev: -1, path: null, edits: null, saving: false,
  zoom: 1, panX: 0, panY: 0, player: null,
  keySel: new Set(), anchorSel: new Set(), focus: 'canvas',
  fill: '#9ea8ff', stroke: '#e4e6f0', showBones: true, snap: true, pixelPreview: false, lightPreview: false, deferredPreview: false,
  collapsed: new Set(), guides: [], marquee: null, pen: null, pencil: null, clipboard: null,
};

/* ---------- события ---------- */
const handlers = new Map();
export function on(ev, fn) { for (const e of ev.split(' ')) { if (!handlers.has(e)) handlers.set(e, new Set()); handlers.get(e).add(fn); } }
export function emit(ev, ...a) { for (const f of handlers.get(ev) || []) { try { f(...a); } catch (e) { console.error(e); } } }

/* ---------- индекс сцены ---------- */
let ix = null, ixVer = -1;
export function idx() {
  if (ix && ixVer === E.ver) return ix;
  const byId = new Map(), kids = new Map();
  for (const n of E.scene.nodes) { byId.set(n.id, n); const p = n.parent ?? null; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(n); }
  ixVer = E.ver; ix = { byId, kids };
  return ix;
}
export const node = (id) => (id == null ? null : idx().byId.get(id) || null);
export const kidsOf = (id) => idx().kids.get(id ?? null) || [];
/** Предки от ближайшего к корню. */
export function ancestors(id) { const out = []; let n = node(id); while (n?.parent && out.length < 200) { out.push(n.parent); n = node(n.parent); } return out; }
export function subtree(id) { const out = [id]; for (let i = 0; i < out.length; i++) for (const c of kidsOf(out[i])) out.push(c.id); return out; }
export const isLocked = (id) => [id, ...ancestors(id)].some((x) => node(x)?.props?.locked);
export const isHidden = (id) => [id, ...ancestors(id)].some((x) => getVal(node(x), 'visible') === false);
/** Только верхние из выбранных (без тех, чей предок тоже выбран). */
export function topSel(ids = E.sel) { const s = new Set(ids); return ids.filter((id) => !ancestors(id).some((a) => s.has(a))); }
export const sceneOrder = (ids) => { const s = new Set(ids); return E.scene.nodes.filter((n) => s.has(n.id)).map((n) => n.id); };

export function uid(base = 'n') {
  base = String(base).replace(/[^\wа-яё-]/gi, '_').replace(/_\d+$/, '') || 'n';
  if (!node(base)) return base;
  let i = 2;
  while (node(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

/* ---------- значения свойств ---------- */
const r4 = (v) => Math.round(v * 1e4) / 1e4;
export const round = (v) => (typeof v === 'number' ? r4(v) : v);
export const fmtN = (v, d = 2) => (typeof v === 'number' ? String(+v.toFixed(d)) : v ?? '');
export function localT(n) {
  let T = E.t;
  for (const id of [...ancestors(n.id)].reverse().concat(n.id)) { const p = node(id)?.props || {}; T = (T - (p.timeOffset ?? 0)) * (p.timeScale ?? 1); }
  return T;
}
/** Вариант группы состояний, который сейчас показан. */
export const stateValue = (g) => E.states[g.name] ?? g.default ?? Object.keys(g.values || {})[0];
export function stateOverride(n, prop) {
  for (const g of E.scene.states || []) {
    const patch = g.values?.[stateValue(g)]?.[n.id];
    if (patch && prop in patch) return { group: g.name, v: patch[prop] };
  }
  return null;
}
/** Значение свойства в момент плейхеда (состояние → ключи → свойство → по умолчанию), без модификаторов. */
export function getVal(n, prop) {
  if (!n) return undefined;
  const o = stateOverride(n, prop);
  if (o) return o.v;
  const ks = n.keys?.[prop];
  if (ks?.length) return K.sampleKeys(ks, localT(n), prop);
  if (n.props && prop in n.props) return n.props[prop];
  return K.propDefault(n.type, prop);
}
export const keyAt = (n, prop) => { const ks = n.keys?.[prop]; if (!ks) return -1; const t = localT(n); return ks.findIndex((k) => Math.abs(k.t - t) < 1e-3); };
/** Состояние ключа свойства: 'on' — ключ в этот момент, 'keyed' — ключи есть, null — нет. */
export const keyState = (n, prop) => (!n.keys?.[prop]?.length ? null : keyAt(n, prop) >= 0 ? 'on' : 'keyed');

/** Записать значение: в вариант состояния (запись), в ключ (если свойство анимировано или автоключ) или в свойства. */
export function setVal(n, prop, v) {
  v = round(v);
  if (E.record) {
    const g = (E.scene.states || []).find((x) => x.name === E.record.group);
    if (g) { const vals = (g.values[E.record.value] ||= {}); (vals[n.id] ||= {})[prop] = v; return; }
  }
  if (n.keys?.[prop]?.length || (E.autoKey && !['visible', 'locked', 'bone', 'ik', 'text', 'src', 'blend', 'clip', 'mask'].includes(prop))) { setKey(n, prop, v); return; }
  (n.props ||= {})[prop] = v;
}
export function setKey(n, prop, v, t = localT(n)) {
  t = Math.max(0, r4(t));
  n.keys ||= {};
  const arr = (n.keys[prop] ||= []);
  if (!arr.length) {
    // первый ключ не в начале: прежнее значение остаётся в начале клипа/шкалы
    const t0 = E.player?.clip ? E.player.clip.start : 0;
    const old = n.props && prop in n.props ? n.props[prop] : K.propDefault(n.type, prop);
    if (t - t0 > 1e-3 && old !== undefined && JSON.stringify(old) !== JSON.stringify(v)) arr.push({ t: t0, v: old, ease: 'inOutCubic' });
  }
  const i = arr.findIndex((k) => Math.abs(k.t - t) < 1e-3);
  if (i >= 0) arr[i] = { ...arr[i], v };
  else {
    const prev = [...arr].reverse().find((k) => k.t < t);
    arr.push({ t, v, ease: prev?.ease ?? 'inOutCubic' });
    arr.sort((a, b) => a.t - b.t);
  }
}
/** Поставить/снять ключ свойства в момент плейхеда. */
export function toggleKey(n, prop) {
  const i = keyAt(n, prop);
  if (i >= 0) {
    const v = getVal(n, prop);
    n.keys[prop].splice(i, 1);
    if (!n.keys[prop].length) { delete n.keys[prop]; (n.props ||= {})[prop] = v?.geom ? K.geomToPath(v.geom) : v; }
    if (!Object.keys(n.keys).length) delete n.keys;
  } else {
    let v = getVal(n, prop);
    if (v?.geom) v = K.geomToPath(v.geom);
    setKey(n, prop, v);
  }
}
/** Сдвинуть узел в координатах родителя (свойство, все ключи и состояния). */
export function shiftNode(n, dx, dy) {
  for (const [p, d] of [['x', dx], ['y', dy]]) {
    if (!d) continue;
    if (n.keys?.[p]?.length) for (const k of n.keys[p]) k.v = r4(k.v + d);
    (n.props ||= {})[p] = r4((n.props[p] ?? 0) + d);
    for (const g of E.scene.states || []) for (const patch of Object.values(g.values || {})) if (patch[n.id] && p in patch[n.id]) patch[n.id][p] = r4(patch[n.id][p] + d);
  }
}

/* ---------- матрицы ---------- */
export const M = K.mat;
export const viewM = () => [E.zoom, 0, 0, E.zoom, E.panX, E.panY];
/** Мировая матрица узла (локальные координаты фигуры → сцена). null — корень. */
export const worldM = (id) => (id ? K.nodeWorldMatrix(E.scene, id, E.t, { states: E.states }) : M.id());
/** Локальные координаты фигуры → пиксели холста-сцены (stage). */
export const screenM = (id) => M.mul(viewM(), worldM(id));
/** Матрица узла относительно родителя из значений свойств (без модификаторов). */
export function localM(n) {
  const g = (p) => getVal(n, p), sc = g('scale');
  return M.compose({ x: g('x'), y: g('y'), rotation: g('rotation'), skewX: g('skewX'), scaleX: sc * g('scaleX'), scaleY: sc * g('scaleY'), anchorX: g('anchorX'), anchorY: g('anchorY') });
}
/** Разложить матрицу узла относительно родителя в x, y, rotation, skewX, scaleX, scaleY (якорь сохраняется). */
export function setLocalM(n, L) {
  const [a, b, c, d, e, f] = L;
  const g = (p) => getVal(n, p);
  const sc = g('scale') || 1, ax = g('anchorX'), ay = g('anchorY');
  const oldSx = sc * g('scaleX'), oldRot = g('rotation');
  let sx = Math.hypot(a, b), th = Math.atan2(b, a);
  if (oldSx < 0) { sx = -sx; th = Math.atan2(-b, -a); }
  const cs = Math.cos(th), sn = Math.sin(th);
  const sy = -c * sn + d * cs;
  const k = sy ? (c * cs + d * sn) / sy : 0;
  let rot = (th * 180) / Math.PI;
  rot += Math.round((oldRot - rot) / 360) * 360;
  const nv = { x: e + a * ax + c * ay, y: f + b * ax + d * ay, rotation: rot, skewX: (Math.atan(k) * 180) / Math.PI, scaleX: sx / sc, scaleY: sy / sc };
  for (const [p, v] of Object.entries(nv)) {
    const eps = p === 'x' || p === 'y' || p === 'rotation' || p === 'skewX' ? 1e-3 : 1e-5;
    if (Math.abs(v - g(p)) > eps) setVal(n, p, v);
  }
}
export const applyPt = (m, p) => M.apply(m, p[0], p[1]);
export const linear = (m) => [m[0], m[1], m[2], m[3], 0, 0];

/* ---------- история и синхронизация ---------- */
const undoStack = [], redoStack = [];
let pending = null;
export const busy = () => pending != null;
export function begin() { if (pending == null) pending = JSON.stringify(E.scene); }
/** Перерисовать после правки без записи в историю (во время перетаскивания). */
export function preview() { K.invalidate(E.scene); E.ver++; E.player?.draw(); emit('preview'); }
export function commit(label = 'правка') {
  const snap = pending;
  pending = null;
  K.invalidate(E.scene); E.ver++;
  if (snap != null && snap === JSON.stringify(E.scene)) { E.player?.draw(); emit('scene'); return false; }
  const errs = K.validateScene(E.scene);
  if (errs.length) {
    toast('Правка отменена: ' + errs.slice(0, 2).join('; '), true);
    if (snap != null) loadInto(JSON.parse(snap));
    return false;
  }
  // со связью с сервером история одна — на сервере (правка уходит патчем и записывается там)
  if (snap != null && !serverHistory()) { undoStack.push({ label, snap }); if (undoStack.length > 200) undoStack.shift(); redoStack.length = 0; }
  E.player?.draw();
  emit('scene');
  push(label);
  return true;
}
export function cancel() { if (pending != null) { const s = pending; pending = null; loadInto(JSON.parse(s)); } }
/** Правка одной функцией: снимок → изменение → запись в историю. */
export function edit(label, fn) { begin(); try { fn(); } catch (e) { cancel(); toast(e.message, true); return false; } return commit(label); }
/** История на сервере: студия открыта через Kontur MCP и показывает его сцену. */
export const serverHistory = () => !!(E.live && E.source === '__live');
async function serverStep(kind) {
  if (pushTimer) { clearTimeout(pushTimer); await doPush(); }
  try {
    const r = await fetch('/' + kind, { method: 'POST' });
    if (!r.ok) return toast('Сервер: ' + (await r.text()).slice(0, 200), true);
    const d = await r.json();
    if (d.label == null) { E.history = d.history; emit('scene'); return toast(kind === 'undo' ? 'Нечего отменять' : 'Нечего возвращать'); }
    const s = await (await fetch('/scene.json', { cache: 'no-store' })).json();
    E.rev = s.rev; E.edits = s.edits || null; E.history = s.history; E.synced = structuredClone(s.scene);
    loadInto(s.scene);
    toast((kind === 'undo' ? 'Отменено: ' : 'Повторено: ') + d.label);
  } catch { toast('Нет связи с сервером', true); }
}
export function undo() {
  if (serverHistory()) return serverStep('undo');
  const h = undoStack.pop(); if (!h) return;
  redoStack.push({ label: h.label, snap: JSON.stringify(E.scene) });
  loadInto(JSON.parse(h.snap)); push('отмена: ' + h.label); toast('Отменено: ' + h.label);
}
export function redo() {
  if (serverHistory()) return serverStep('redo');
  const h = redoStack.pop(); if (!h) return;
  undoStack.push({ label: h.label, snap: JSON.stringify(E.scene) });
  loadInto(JSON.parse(h.snap)); push(h.label); toast('Повторено: ' + h.label);
}
export const canUndo = () => (serverHistory() ? (E.history?.undo ?? 0) > 0 || pushTimer != null : undoStack.length > 0);
export const canRedo = () => (serverHistory() ? (E.history?.redo ?? 0) > 0 && pushTimer == null : redoStack.length > 0);
export function clearHistory() { undoStack.length = 0; redoStack.length = 0; }
/** Заменить сцену (история не трогается): выбор сохраняется по id. */
export function loadInto(s, { keepTime = true } = {}) {
  E.scene = s; E.ver++;
  E.sel = E.sel.filter((id) => node(id));
  if (E.scope && !node(E.scope)) E.scope = null;
  E.keySel.clear(); E.anchorSel.clear();
  for (const g of s.states || []) if (E.states[g.name] && !(E.states[g.name] in (g.values || {}))) delete E.states[g.name];
  E.player?.setScene(s, keepTime);
  emit('scene'); emit('sel');
}
/** Сцена изменилась извне (MCP): отменить можно и это. */
export function remoteReplace(s) { if (!serverHistory()) { undoStack.push({ label: 'изменение извне', snap: JSON.stringify(E.scene) }); redoStack.length = 0; } loadInto(s); }

let pushTimer = null, pushLabel = '';
export const pushing = () => pushTimer != null || E.saving;
function push(label) {
  if (!E.live || E.source !== '__live') return;
  pushLabel = label;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(doPush, 150);
}
async function doPush() {
  pushTimer = null; E.saving = true; emit('live');
  try {
    // патч от последней сцены, известной серверу (если её нет — вся сцена)
    const sent = structuredClone(E.scene);
    const r = E.synced
      ? await fetch('/patch?label=' + encodeURIComponent(pushLabel), { method: 'POST', body: JSON.stringify({ rev: E.rev, edits: K.diffScenes(E.synced, sent) }) })
      : await fetch('/scene.json?label=' + encodeURIComponent(pushLabel), { method: 'POST', body: JSON.stringify(sent) });
    if (!r.ok) toast('Сервер не принял правку: ' + (await r.text()).slice(0, 200), true);
    else {
      const d = await r.json(); E.rev = d.rev; E.edits = d.edits || null; E.history = d.history; E.synced = sent;
      if (d.warnings?.length) toast('Правка наложена с замечаниями: ' + d.warnings.slice(0, 2).join('; '), true);
    }
  } catch { toast('Нет связи с сервером — правка пока только в браузере', true); }
  E.saving = false; emit('live'); emit('pushed');
}

/* ---------- копии узлов ---------- */
/** Глубокие копии узлов вместе с поддеревьями (в порядке сцены). */
export function cloneNodes(ids) {
  const set = new Set(topSel(ids).flatMap(subtree));
  return E.scene.nodes.filter((n) => set.has(n.id)).map((n) => structuredClone(n));
}
/** Вставить копии с новыми id; верхние получают parent; вставка сразу над узлом after (или наверх). */
export function insertClones(list, parent, after = null) {
  const inList = new Set(list.map((n) => n.id)), map = new Map();
  const taken = new Set(E.scene.nodes.map((n) => n.id));
  for (const n of list) {
    let id = n.id.replace(/_\d+$/, ''), i = 2, cand = id;
    while (taken.has(cand)) cand = `${id}_${i++}`;
    taken.add(cand); map.set(n.id, cand);
  }
  const out = list.map((n) => {
    const c = structuredClone(n);
    c.id = map.get(n.id);
    c.parent = inList.has(n.parent) ? map.get(n.parent) : parent ?? undefined;
    if (c.parent == null) delete c.parent;
    for (const k of ['clip', 'mask']) if (c.props?.[k] && map.has(c.props[k])) c.props[k] = map.get(c.props[k]);
    if (c.props?.ik?.target && map.has(c.props.ik.target)) c.props.ik = { ...c.props.ik, target: map.get(c.props.ik.target) };
    return c;
  });
  let at = E.scene.nodes.length;
  if (after) { const sub = new Set(subtree(after)); let last = -1; E.scene.nodes.forEach((n, i) => { if (sub.has(n.id)) last = i; }); if (last >= 0) at = last + 1; }
  E.scene.nodes.splice(at, 0, ...out);
  E.ver++;
  return list.filter((n) => !inList.has(n.parent)).map((n) => map.get(n.id));
}
/** Переставить узел: сразу перед (before) или после (after) узла ref в массиве сцены. */
export function moveInArray(id, ref, where) {
  const nodes = E.scene.nodes, n = node(id);
  nodes.splice(nodes.indexOf(n), 1);
  let i = ref ? nodes.indexOf(node(ref)) : -1;
  if (i < 0) i = where === 'before' ? 0 : nodes.length - 1;
  nodes.splice(where === 'before' ? i : i + 1, 0, n);
  E.ver++;
}

/* ---------- выбор ---------- */
export function select(ids, { add = false, toggle = false } = {}) {
  ids = (Array.isArray(ids) ? ids : [ids]).filter((x) => x && node(x));
  if (toggle) { const s = new Set(E.sel); for (const id of ids) s.has(id) ? s.delete(id) : s.add(id); E.sel = [...s]; }
  else E.sel = add ? [...new Set([...E.sel, ...ids])] : ids;
  E.anchorSel.clear();
  emit('sel');
}

/* ---------- сообщения ---------- */
let toastTimer = null;
export function toast(msg, bad = false) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = bad ? 'bad' : ''; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), bad ? 6000 : 2200);
}
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
