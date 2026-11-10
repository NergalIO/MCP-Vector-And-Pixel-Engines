/** Правки поверх сцены (edits): разница и наложение. */


export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
export function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}
export const same = (a, b) => a === b || stable(a) === stable(b);
export function kidsMap(scene) {
  const m = new Map();
  for (const n of scene.nodes) { const p = n.parent ?? null; if (!m.has(p)) m.set(p, []); m.get(p).push(n.id); }
  return m;
}
/** Наибольшая общая подпоследовательность (id), чтобы записывать только реальные перестановки. */
export function lcsSet(a, b) {
  const n = a.length, m = b.length;
  if (!n || !m) return new Set();
  if (n * m > 4e6) return new Set(a.filter((x, i) => b[i] === x));
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = new Set();
  for (let i = 0, j = 0; i < n && j < m;) { if (a[i] === b[j]) { out.add(a[i]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
  return out;
}

/** Разница между исходной сценой и правленой → объект правок. */
export function diffScenes(base, cur) {
  const ed = { kontur: 'edits', version: 1, scene: {}, nodes: {}, removed: [], order: [] };
  for (const k of new Set([...Object.keys(base), ...Object.keys(cur)])) {
    if (k === 'nodes') continue;
    if (!same(base[k], cur[k])) ed.scene[k] = cur[k] === undefined ? null : clone(cur[k]);
  }
  const bMap = new Map(base.nodes.map((n) => [n.id, n])), cMap = new Map(cur.nodes.map((n) => [n.id, n]));
  for (const n of base.nodes) if (!cMap.has(n.id)) ed.removed.push(n.id);
  for (const n of cur.nodes) {
    const b = bMap.get(n.id);
    if (!b) continue;
    const e = {}, bp = b.props || {}, cp = n.props || {}, props = {}, unset = [], was = {};
    for (const k in cp) if (!same(bp[k], cp[k])) { props[k] = clone(cp[k]); if (k in bp) was[k] = clone(bp[k]); }
    for (const k in bp) if (!(k in cp)) { unset.push(k); was[k] = clone(bp[k]); }
    if (Object.keys(props).length) e.props = props;
    if (unset.length) e.unset = unset;
    const bk = b.keys || {}, ck = n.keys || {}, keys = {};
    for (const k of new Set([...Object.keys(bk), ...Object.keys(ck)])) if (!same(bk[k], ck[k])) keys[k] = ck[k] ? clone(ck[k]) : null;
    if (Object.keys(keys).length) e.keys = keys;
    if (!same(b.mods, n.mods)) e.mods = n.mods ? clone(n.mods) : null;
    if (n.type !== b.type) e.setType = n.type;
    if (Object.keys(e).length) { e.base = { type: b.type, parent: b.parent ?? null }; if (Object.keys(was).length) e.was = was; ed.nodes[n.id] = e; }
  }
  // порядок и новые узлы: по каждому родителю — что не входит в общую подпоследовательность
  const bk = kidsMap(base), ck = kidsMap(cur), stay = new Set();
  for (const [p, cids] of ck) {
    const common = cids.filter((id) => bMap.has(id) && (bMap.get(id).parent ?? null) === p);
    const bcommon = (bk.get(p) || []).filter((id) => cMap.has(id) && (cMap.get(id).parent ?? null) === p);
    for (const id of lcsSet(bcommon, common)) stay.add(id);
  }
  for (const n of cur.nodes) {
    if (stay.has(n.id)) continue;
    const p = n.parent ?? null, sib = ck.get(p), i = sib.indexOf(n.id);
    const o = { id: n.id, parent: p, after: i > 0 ? sib[i - 1] : null };
    if (!bMap.has(n.id)) o.add = clone(n);
    ed.order.push(o);
  }
  return ed;
}
/** Пустые ли правки. */
export function editsEmpty(ed) {
  return !ed || (!Object.keys(ed.scene || {}).length && !Object.keys(ed.nodes || {}).length && !(ed.removed || []).length && !(ed.order || []).length);
}
/** Число правленых объектов (для интерфейса). */
export function editsCount(ed) {
  if (!ed) return 0;
  return new Set([...Object.keys(ed.nodes || {}), ...(ed.removed || []), ...(ed.order || []).map((o) => o.id)]).size + (Object.keys(ed.scene || {}).length ? 1 : 0);
}

/** Наложить правки на исходную сцену → { scene, warnings }. Исходная сцена не меняется. */
export function applyEdits(base, ed) {
  const s = clone(base), warnings = [];
  if (!ed || editsEmpty(ed)) return { scene: s, warnings };
  for (const k in ed.scene || {}) { if (ed.scene[k] === null) delete s[k]; else s[k] = clone(ed.scene[k]); }
  if ((ed.removed || []).length) {
    const kill = new Set(), ids = new Set(s.nodes.map((n) => n.id));
    for (const id of ed.removed) if (ids.has(id)) kill.add(id);
    let grew = true;
    while (grew) { grew = false; for (const n of s.nodes) if (n.parent && kill.has(n.parent) && !kill.has(n.id)) { kill.add(n.id); grew = true; } }
    s.nodes = s.nodes.filter((n) => !kill.has(n.id));
  }
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  for (const [id, e] of Object.entries(ed.nodes || {})) {
    const n = byId.get(id);
    if (!n) { warnings.push(`«${id}»: такого объекта нет в исходной сцене — правка не применена`); continue; }
    if (e.base && e.base.type !== n.type) { warnings.push(`«${id}»: был ${e.base.type}, теперь ${n.type} — правка не применена (id сдвинулись?)`); continue; }
    if (e.base && (e.base.parent ?? null) !== (n.parent ?? null)) warnings.push(`«${id}»: в исходной сцене сменился родитель (${e.base.parent ?? 'корень'} → ${n.parent ?? 'корень'})`);
    for (const k in e.was || {}) if (!same(e.was[k], n.props?.[k])) warnings.push(`«${id}».${k}: скрипт поменял значение, оставлена ваша правка`);
    if (e.props || e.unset) { n.props = { ...(n.props || {}), ...clone(e.props || {}) }; for (const k of e.unset || []) delete n.props[k]; }
    if (e.keys) {
      n.keys = n.keys || {};
      for (const p in e.keys) { if (e.keys[p] === null) delete n.keys[p]; else n.keys[p] = clone(e.keys[p]); }
      if (!Object.keys(n.keys).length) delete n.keys;
    }
    if ('mods' in e) { if (e.mods === null) delete n.mods; else n.mods = clone(e.mods); }
    if (e.setType) n.type = e.setType;
  }
  for (const o of ed.order || []) {
    let n;
    if (o.add) {
      n = clone(o.add);
      if (byId.has(n.id)) {
        const old = n.id; let i = 2; while (byId.has(`${old}_${i}`)) i++;
        n.id = `${old}_${i}`;
        warnings.push(`«${old}»: такой id появился в исходной сцене — ваш объект переименован в «${n.id}»`);
      }
      byId.set(n.id, n);
    } else {
      n = byId.get(o.id);
      if (!n) continue;
      s.nodes.splice(s.nodes.indexOf(n), 1);
    }
    const par = o.parent ?? null;
    if (par && !byId.has(par)) { warnings.push(`«${n.id}»: родителя «${par}» нет — объект перенесён в корень`); n.parent = null; }
    else n.parent = par;
    const aft = o.after && byId.get(o.after);
    let idx;
    if (aft && (aft.parent ?? null) === (n.parent ?? null) && s.nodes.includes(aft)) idx = s.nodes.indexOf(aft) + 1;
    else { const f = s.nodes.findIndex((x) => (x.parent ?? null) === (n.parent ?? null)); idx = f < 0 ? s.nodes.length : f; }
    s.nodes.splice(idx, 0, n);
  }
  return { scene: s, warnings };
}
