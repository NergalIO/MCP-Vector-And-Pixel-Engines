/** Операции над сценой (MCP-сервер и редактор), клипы, состояния, IK, пиксели. */
import { Ctx } from './ctx.js';
import { resolveEase } from './ease.js';
import { geomToPath } from './geom.js';
import { clamp } from './math.js';
import { index, invalidate, invalidateNode, noteNodeAdded } from './model.js';
import { NODE_TYPES } from './types.js';
import { MODIFIERS, modRefs } from './modifiers.js';
import { propValue } from './values.js';

/**
 * Свободный id вида base, base2, base3… (auto — base1, base2…: нумерация с 1, детерминированно по сцене).
 * Счётчик хранится в кэше сцены, поэтому тысячи добавлений подряд не пересматривают все id.
 */
export function uniqueId(scene, base, { auto = false } = {}) {
  const c = index(scene), ids = c.byId;
  if (auto) {
    let i = c.autoNext.get(base) || 1;
    while (ids.has(`${base}${i}`)) i++;
    c.autoNext.set(base, i + 1);
    return `${base}${i}`;
  }
  let id = base, i = 1;
  while (ids.has(id)) id = `${base}${++i}`;
  return id;
}
const listIds = (scene) => {
  const n = scene.nodes.length;
  return n ? scene.nodes.slice(0, 30).map((x) => x.id).join(', ') + (n > 30 ? ` … (всего ${n})` : '') : '(пусто)';
};
export const getNode = (scene, id) => {
  const n = index(scene).byId.get(id);
  if (!n) throw new Error(`Узел «${id}» не найден. Есть: ${listIds(scene)}`);
  return n;
};
/** id поддерева (сам узел и все потомки) по индексу детей. */
export function subtreeOf(scene, id) {
  const kids = index(scene).children, out = [];
  const stack = [id];
  while (stack.length) { const x = stack.pop(); out.push(x); const ch = kids.get(x); if (ch) for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i].id); }
  return out;
}
/** Ссылки узла на другие узлы: [{ kind, id, drop() }] — маски, link/followPath, цель IK. */
export function nodeRefs(n) {
  const out = [];
  for (const k of ['clip', 'mask']) if (n.props?.[k]) out.push({ kind: k, id: n.props[k], set: (v) => { n.props[k] = v; }, drop: () => { delete n.props[k]; } });
  (n.mods || []).forEach((m) => {
    for (const r of modRefs(m)) {
      const field = m.type === 'link' ? 'source' : 'path';
      out.push({ kind: `мод ${m.type}`, id: r, mod: m, set: (v) => { m[field] = v; }, drop: () => { n.mods = n.mods.filter((x) => x !== m); if (!n.mods.length) delete n.mods; } });
    }
  });
  // путь текста по кривой: строка — id узла или путь d (что из этого, решает тот, кто знает сцену)
  if (n.type === 'text' && typeof n.props?.path === 'string' && /^[A-Za-z_][\w-]*$/.test(n.props.path)) out.push({ kind: 'путь текста', id: n.props.path, set: (v) => { n.props.path = v; }, drop: () => { delete n.props.path; } });
  if (n.props?.ik?.target) out.push({ kind: 'IK', id: n.props.ik.target, set: (v) => { n.props.ik = { ...n.props.ik, target: v }; }, drop: () => { delete n.props.ik; } });
  return out;
}
/** Поля, смена которых меняет структуру (индекс, маски, IK) — тогда нужен полный сброс кэшей. */
const STRUCT_PROPS = ['clip', 'mask', 'ik'];

export const ops = {
  addNode(scene, { id, type = 'group', parent = null, props = {}, keys, mods, index: at } = {}) {
    if (!NODE_TYPES.includes(type)) throw new Error(`Неизвестный тип «${type}». Допустимо: ${NODE_TYPES.join(', ')}`);
    if (parent) getNode(scene, parent);
    if (id && index(scene).byId.has(id)) throw new Error(`id «${id}» уже занят`);
    if (!id) id = uniqueId(scene, type, { auto: true });
    const node = { id, type, parent: parent || null, props: { ...props } };
    if (keys) node.keys = normalizeKeys(keys);
    if (mods) node.mods = mods.map(validateMod);
    if (at == null) { scene.nodes.push(node); noteNodeAdded(scene, node); }
    else { scene.nodes.splice(at, 0, node); invalidate(scene); }
    return node;
  },
  updateNode(scene, id, { props, replaceProps = false, unset = [], newId, parent, type } = {}) {
    const n = getNode(scene, id);
    const before = n.props || {};
    let structural = !!type || parent !== undefined || (newId && newId !== id);
    if (props) {
      const next = replaceProps ? { ...props } : { ...before, ...props };
      if (STRUCT_PROPS.some((k) => next[k] !== before[k])) structural = true;
      n.props = next;
    }
    for (const k of unset) { if (STRUCT_PROPS.includes(k) && k in n.props) structural = true; delete n.props[k]; }
    if (type) { if (!NODE_TYPES.includes(type)) throw new Error(`Неизвестный тип ${type}`); n.type = type; }
    if (parent !== undefined) {
      if (parent) { getNode(scene, parent); const by = index(scene).byId; let p = parent; while (p) { if (p === id) throw new Error('Цикл в иерархии'); p = by.get(p)?.parent; } }
      n.parent = parent || null;
    }
    if (newId && newId !== id) {
      if (index(scene).byId.has(newId)) throw new Error(`id «${newId}» уже занят`);
      for (const x of scene.nodes) {
        if (x.parent === id) x.parent = newId;
        for (const r of nodeRefs(x)) if (r.id === id) r.set(newId);
      }
      for (const g of scene.states || []) for (const patch of Object.values(g.values || {})) if (patch[id]) { patch[newId] = patch[id]; delete patch[id]; }
      n.id = newId;
    }
    if (structural) invalidate(scene); else invalidateNode(scene, id);
    return n;
  },
  /**
   * Удалить узел с потомками. Ссылки остальных узлов на удалённые (маски, link, followPath, цель IK, патчи
   * состояний) убираются — иначе сохранённая сцена не прошла бы проверку при загрузке. Возвращает массив id
   * удалённых; в поле cleaned — описания убранных ссылок.
   */
  removeNode(scene, id) {
    getNode(scene, id);
    const kill = new Set(subtreeOf(scene, id));
    scene.nodes = scene.nodes.filter((n) => !kill.has(n.id));
    const cleaned = [];
    for (const n of scene.nodes) for (const r of nodeRefs(n)) if (kill.has(r.id)) { r.drop(); cleaned.push(`${n.id}: ${r.kind} → ${r.id}`); }
    for (const g of scene.states || []) for (const [v, patch] of Object.entries(g.values || {})) for (const k of Object.keys(patch || {})) if (kill.has(k)) { delete patch[k]; cleaned.push(`состояние ${g.name}=${v}: ${k}`); }
    invalidate(scene);
    const res = [...kill];
    res.cleaned = cleaned;
    return res;
  },
  /** Копия узла с потомками; ссылки внутри копии (маски, link, followPath, IK) ведут на копии, а не на оригиналы. */
  duplicateNode(scene, id, newId) {
    const src = getNode(scene, id);
    if (newId && index(scene).byId.has(newId)) throw new Error(`id «${newId}» уже занят`);
    const ids = subtreeOf(scene, id), map = new Map(), by = index(scene).byId;
    const taken = new Set(by.keys());
    for (const old of ids) {
      let nid = old === id && newId ? newId : `${old}_copy`, i = 1;
      if (!(old === id && newId)) while (taken.has(nid)) nid = `${old}_copy${++i}`;
      taken.add(nid); map.set(old, nid);
    }
    const copies = ids.map((old) => {
      const c = JSON.parse(JSON.stringify(by.get(old)));
      c.id = map.get(old);
      c.parent = old === id ? src.parent : map.get(c.parent);
      for (const r of nodeRefs(c)) if (map.has(r.id)) r.set(map.get(r.id));
      return c;
    });
    scene.nodes.push(...copies);
    invalidate(scene);
    return copies[0];
  },
  reorder(scene, id, toIndex) {
    const n = getNode(scene, id);
    scene.nodes = scene.nodes.filter((x) => x !== n);
    scene.nodes.splice(clamp(toIndex, 0, scene.nodes.length), 0, n);
    invalidate(scene);
  },
  setKeys(scene, id, prop, keys) {
    const n = getNode(scene, id);
    invalidateNode(scene, id);
    n.keys = n.keys || {};
    if (!keys || !keys.length) delete n.keys[prop];
    else n.keys[prop] = normalizeKeys({ [prop]: keys })[prop];
    return n.keys[prop];
  },
  addKey(scene, id, prop, key) {
    const n = getNode(scene, id);
    invalidateNode(scene, id);
    n.keys = n.keys || {};
    const arr = (n.keys[prop] = n.keys[prop] || []);
    const k = normalizeKeys({ [prop]: [key] })[prop][0];
    const i = arr.findIndex((x) => Math.abs(x.t - k.t) < 1e-6);
    if (i >= 0) arr[i] = k; else arr.push(k);
    arr.sort((a, b) => a.t - b.t);
    return arr;
  },
  clearKeys(scene, id, prop) {
    const n = getNode(scene, id);
    invalidateNode(scene, id);
    if (!prop) delete n.keys; else if (n.keys) delete n.keys[prop];
  },
  /** Анимировать свойство от from (по умолчанию — текущее значение) к to. */
  animate(scene, id, prop, { from, to, start = 0, duration = 1, ease = 'inOutCubic', keepExisting = true } = {}) {
    const n = getNode(scene, id);
    if (from === undefined) from = propValue(n, prop, start, new Ctx(scene), 0);
    if (from && typeof from === 'object' && from.geom) from = geomToPath(from.geom);
    const arr = keepExisting && n.keys?.[prop] ? n.keys[prop].filter((k) => k.t < start - 1e-6 || k.t > start + duration + 1e-6) : [];
    arr.push({ t: start, v: from, ease }, { t: start + duration, v: to });
    return ops.setKeys(scene, id, prop, arr);
  },
  addMod(scene, id, mod) {
    const n = getNode(scene, id);
    const m = validateMod(mod);
    n.mods = n.mods || [];
    n.mods.push(m);
    if (modRefs(m).length) invalidate(scene); else invalidateNode(scene, id);
    return n.mods.length - 1;
  },
  removeMod(scene, id, which) {
    const n = getNode(scene, id);
    if (!n.mods) return 0;
    const before = n.mods.length;
    if (typeof which === 'number') n.mods.splice(which, 1);
    else if (typeof which === 'string') n.mods = n.mods.filter((m) => m.type !== which);
    else n.mods = [];
    if (!n.mods.length) delete n.mods;
    invalidate(scene);
    return before - (n.mods?.length || 0);
  },

  /* ---------- символы ---------- */
  /** Определить (или заменить) символ: набор узлов со своей шкалой времени. */
  defineSymbol(scene, name, { nodes, duration } = {}) {
    if (!/^[A-Za-z_][\w-]*$/.test(String(name))) throw new Error(`Недопустимое имя символа «${name}»`);
    if (!Array.isArray(nodes)) throw new Error('Символу нужен массив nodes');
    const sym = { nodes: JSON.parse(JSON.stringify(nodes)) };
    if (duration != null) { if (!(duration > 0)) throw new Error('duration символа должен быть > 0'); sym.duration = duration; }
    scene.symbols = { ...(scene.symbols || {}), [name]: sym };
    invalidate(scene);
    return sym;
  },
  /**
   * Символ из поддерева узла: копия поддерева становится символом (корень — без родителя, сдвиг x/y корня
   * переходит на экземпляр). replace — заменить поддерево экземпляром на том же месте (тот же id).
   */
  symbolFromNode(scene, id, name, { replace = true, duration } = {}) {
    const root = getNode(scene, id);
    if (scene.symbols?.[name]) throw new Error(`Символ «${name}» уже есть`);
    const ids = subtreeOf(scene, id), by = index(scene).byId;
    const nodes = ids.map((x) => JSON.parse(JSON.stringify(by.get(x))));
    const r = nodes[0];
    r.parent = null;
    const keep = {};
    // постоянный сдвиг корня — на экземпляр (анимированный остаётся внутри символа)
    for (const k of ['x', 'y']) if (r.props?.[k] != null && !r.keys?.[k]?.length && !(r.mods || []).length) { keep[k] = r.props[k]; delete r.props[k]; }
    const inside = new Set(ids);
    for (const n of nodes) for (const ref of nodeRefs(n)) if (!inside.has(ref.id)) throw new Error(`${n.id}: ${ref.kind} ссылается на «${ref.id}» вне поддерева — символ нельзя выделить`);
    ops.defineSymbol(scene, name, { nodes, duration });
    if (!replace) return { symbol: name, instance: null };
    const at = scene.nodes.indexOf(root);
    const kill = new Set(ids);
    scene.nodes = scene.nodes.filter((n) => !kill.has(n.id));
    const inst = { id, type: 'instance', parent: root.parent ?? null, props: { symbol: name, ...keep } };
    if (root.props?.name) inst.props.name = root.props.name;
    scene.nodes.splice(Math.min(at, scene.nodes.length), 0, inst);
    invalidate(scene);
    return { symbol: name, instance: inst };
  },
  /** Удалить символ. Используемый экземплярами — только с force (экземпляры тоже удаляются). */
  removeSymbol(scene, name, { force = false } = {}) {
    if (!scene.symbols?.[name]) throw new Error(`Символ «${name}» не найден`);
    const users = scene.nodes.filter((n) => n.type === 'instance' && n.props?.symbol === name).map((n) => n.id);
    if (users.length && !force) throw new Error(`Символ «${name}» используют: ${users.join(', ')} (force — удалить и их)`);
    for (const u of users) if (index(scene).byId.has(u)) ops.removeNode(scene, u);
    const { [name]: _, ...rest } = scene.symbols;
    if (Object.keys(rest).length) scene.symbols = rest; else delete scene.symbols;
    invalidate(scene);
    return users;
  },

  /* ---------- маркеры ---------- */
  /** Поставить (или передвинуть) маркер: событие на шкале времени для плеера и экспорта. */
  setMarker(scene, name, t, data) {
    if (!name) throw new Error('Маркеру нужно имя');
    if (!(t >= 0 && t <= scene.duration + 1e-6)) throw new Error(`t маркера должен быть в 0..${scene.duration}`);
    const ms = (scene.markers || []).filter((m) => m.name !== name);
    const m = { t, name };
    if (data !== undefined) m.data = data;
    ms.push(m); ms.sort((a, b) => a.t - b.t);
    scene.markers = ms;
    return m;
  },
  removeMarker(scene, name) {
    const before = scene.markers?.length || 0;
    scene.markers = (scene.markers || []).filter((m) => m.name !== name);
    if (!scene.markers.length) delete scene.markers;
    return before - (scene.markers?.length || 0);
  },
};

/**
 * Маркеры, пройденные при движении времени из t0 в t1 (t0 не включается, t1 — включается). wrap — шкала
 * зациклилась: [t0, end) и [start, t1]. Для плеера (onMarker) и тестов.
 */
export function markersCrossed(scene, t0, t1, { start = 0, end = scene.duration, wrap = false } = {}) {
  const ms = scene.markers || [];
  if (!ms.length) return [];
  const inR = (t, a, b) => t > a && t <= b;
  if (!wrap) return ms.filter((m) => inR(m.t, t0, t1));
  return [...ms.filter((m) => inR(m.t, t0, end + 1e-9)), ...ms.filter((m) => m.t >= start && m.t <= t1)];
}

/** Проверка модификатора по реестру: тип, числовые параметры, собственная проверка (expr — разбор кода). */
export function validateMod(m) {
  const def = m && MODIFIERS[m.type];
  if (!def) throw new Error(`Неизвестный модификатор «${m?.type}». Допустимо: ${Object.keys(MODIFIERS).join(', ')}`);
  for (const [k, p] of Object.entries(def.params || {})) {
    if (m[k] == null || !p.type) continue;
    const ok = p.type === 'any' || p.type.split('|').some((ty) => (ty === 'array' ? Array.isArray(m[k]) : typeof m[k] === ty));
    if (!ok) throw new Error(`Модификатор ${m.type}: ${k} должен быть ${p.type}, а не ${JSON.stringify(m[k])}`);
    if (p.enum && !p.enum.includes(m[k])) throw new Error(`Модификатор ${m.type}: ${k} — одно из ${p.enum.join(', ')}`);
  }
  def.validate?.(m);
  return { ...m };
}
export function normalizeKeys(keys) {
  const out = {};
  for (const prop in keys) {
    const arr = keys[prop];
    if (!Array.isArray(arr)) throw new Error(`Ключи свойства ${prop} должны быть массивом`);
    out[prop] = arr.map((k) => {
      const kk = Array.isArray(k) ? { t: k[0], v: k[1], ease: k[2] } : { ...k };
      if (kk.time != null && kk.t == null) kk.t = kk.time, delete kk.time;
      if (kk.value !== undefined && kk.v === undefined) kk.v = kk.value, delete kk.value;
      if (typeof kk.t !== 'number') throw new Error(`Ключ свойства ${prop}: нет времени t`);
      if (kk.ease != null) resolveEase(kk.ease);
      else delete kk.ease;
      return kk;
    }).sort((a, b) => a.t - b.t);
  }
  return out;
}

/* ---------- именованные клипы ---------- */
/**
 * Клипы — именованные отрезки общей шкалы времени: idle, walk, talk...
 * scene.clips = [{ name, start, end, loop = true, fps?, next? }]
 */
export function clipRange(scene, name) {
  const c = (scene.clips || []).find((x) => x.name === name);
  if (!c) throw new Error(`Клип «${name}» не найден. Есть: ${(scene.clips || []).map((x) => x.name).join(', ') || '(нет клипов)'}`);
  return { name: c.name, start: c.start, end: c.end, loop: c.loop !== false, fps: c.fps, next: c.next };
}
/** Время внутри клипа: localT от начала клипа, с учётом зацикливания. */
export function clipTime(scene, name, localT) {
  const r = clipRange(scene, name), len = r.end - r.start;
  if (len <= 0) return r.start;
  return r.start + (r.loop ? ((localT % len) + len) % len : clamp(localT, 0, len));
}
Object.assign(ops, {
  setClip(scene, { name, start, end, loop = true, fps, next }) {
    if (!name || typeof name !== 'string') throw new Error('Нужно имя клипа');
    if (!(end > start)) throw new Error('Конец клипа должен быть позже начала');
    if (start < 0) throw new Error('Начало клипа не может быть отрицательным');
    scene.clips = scene.clips || [];
    const c = { name, start, end, loop };
    if (fps) c.fps = fps;
    if (next) c.next = next;
    const i = scene.clips.findIndex((x) => x.name === name);
    if (i >= 0) scene.clips[i] = c; else scene.clips.push(c);
    scene.clips.sort((a, b) => a.start - b.start);
    if (end > scene.duration) scene.duration = end;
    invalidate(scene);
    return c;
  },
  removeClip(scene, name) {
    const before = scene.clips?.length || 0;
    scene.clips = (scene.clips || []).filter((c) => c.name !== name);
    if (!scene.clips.length) delete scene.clips;
    invalidate(scene);
    return before - (scene.clips?.length || 0);
  },
});

/* ---------- состояния, IK, пиксели, свет ---------- */
Object.assign(ops, {
  /** Группа состояний: { name, default, values: { вариант: { id узла: { свойство: значение } } } }. */
  setState(scene, { name, values, default: def }) {
    if (!name || typeof name !== 'string') throw new Error('Нужно имя группы состояний');
    if (!values || typeof values !== 'object' || !Object.keys(values).length) throw new Error('values: нужен хотя бы один вариант');
    for (const patch of Object.values(values)) for (const id of Object.keys(patch || {})) getNode(scene, id);
    scene.states = scene.states || [];
    const g = { name, default: def ?? Object.keys(values)[0], values: JSON.parse(JSON.stringify(values)) };
    if (!(g.default in g.values)) throw new Error(`default «${g.default}» нет среди вариантов: ${Object.keys(values).join(', ')}`);
    const i = scene.states.findIndex((x) => x.name === name);
    if (i >= 0) scene.states[i] = g; else scene.states.push(g);
    invalidate(scene);
    return g;
  },
  removeState(scene, name) {
    const before = scene.states?.length || 0;
    scene.states = (scene.states || []).filter((g) => g.name !== name);
    if (!scene.states.length) delete scene.states;
    invalidate(scene);
    return before - (scene.states?.length || 0);
  },
  /** IK на конечном узле id: цель target, сгиб bend (1|-1), orient — конечное звено повторяет поворот цели. null — снять. */
  setIK(scene, id, cfg) {
    const n = getNode(scene, id);
    if (!cfg) { if (n.props) delete n.props.ik; invalidate(scene); return null; }
    getNode(scene, cfg.target);
    const B = n.parent && getNode(scene, n.parent), A = B && B.parent && getNode(scene, B.parent);
    if (!A) throw new Error(`У «${id}» нужны родитель и дед — два звена цепочки (например бедро → голень → стопа)`);
    if (cfg.target === id || cfg.target === B.id || cfg.target === A.id) throw new Error('Цель IK не может быть звеном самой цепочки');
    n.props = { ...n.props, ik: { target: cfg.target, ...(cfg.bend ? { bend: cfg.bend } : {}), ...(cfg.flip ? { flip: true } : {}), ...(cfg.orient ? { orient: true } : {}), ...(cfg.orientOffset ? { orientOffset: cfg.orientOffset } : {}) } };
    invalidate(scene);
    return n.props.ik;
  },
  setPixel(scene, cfg) {
    if (!cfg || cfg.enabled === false) { if (scene.pixel) scene.pixel.enabled = false; if (!cfg) delete scene.pixel; invalidate(scene); return scene.pixel || null; }
    const size = cfg.size ?? scene.pixel?.size ?? 6;
    if (!(size >= 1)) throw new Error('size — размер пикселя в единицах сцены, ≥ 1');
    scene.pixel = { enabled: true, size, ...(cfg.palette ? { palette: cfg.palette } : scene.pixel?.palette ? { palette: scene.pixel.palette } : {}), ...(cfg.aa ? { aa: true } : {}) };
    invalidate(scene);
    return scene.pixel;
  },
});
