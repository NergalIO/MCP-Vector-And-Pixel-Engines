// Инструменты холста: выбор и трансформации, точки контура, перо, карандаш, фигуры, текст, картинка, кости, свет, рука.
import { K, E, emit, node, kidsOf, ancestors, isLocked, isHidden, topSel, uid, getVal, setVal, round, localM, setLocalM, screenM, M, applyPt, linear, begin, preview, commit, cancel, edit, select, toast, cloneNodes, insertClones } from './core.js';
import { stage, hitAt, pickLevel, cornersOf, localBox, aabb, selAABB, toStage } from './view.js';
import { requestOverlay } from './overlay.js';
import { geomOf, toPts, fromPts, clonePts, isSmooth, toggleSmooth, splitSeg, nearestOnPath, boneEnds, isPathLike, pathKey } from './geom.js';
import { raw, toPathNode, deleteIds } from './actions.js';

let D = null; // текущее перетаскивание
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const deg = (r) => (r * 180) / Math.PI;
const parentScreen = (id) => screenM(node(id)?.parent ?? null);
const toParent = (parent, sx, sy) => applyPt(M.inv(screenM(parent)), [sx, sy]);
const addNode = (n) => { if (!n.parent) delete n.parent; E.scene.nodes.push(n); E.ver++; K.invalidate(E.scene); return n; };

export function setTool(name) {
  if (E.pen && name !== 'pen') finishPen();
  if (E.tool === name) return;
  E.tool = name; E.anchorSel.clear(); D = null;
  stage.style.cursor = TOOLS[name]?.cursor || 'default';
  emit('tool');
}

/* =================== Выбор и трансформации =================== */
const select_ = {
  cursor: 'default',
  down(ev) {
    const { e, h } = ev;
    if (h) return gizmoDown(ev, h);
    const deep = e.ctrlKey || e.metaKey;
    const hid = hitAt(e);
    if (hid) {
      const chain = [hid, ...ancestors(hid)];
      if (E.scope && !chain.includes(E.scope) && !deep) { E.scope = null; emit('scope'); }
      const id = deep ? hid : pickLevel(hid);
      if (e.shiftKey) { select(id, { toggle: true }); if (!E.sel.includes(id)) return; }
      else if (!E.sel.includes(id)) select(id);
      D = { kind: 'move', sx: ev.sx, sy: ev.sy, moved: false, clicked: id, alt: e.altKey };
    } else {
      if (!e.shiftKey) select([]);
      D = { kind: 'marquee', sx: ev.sx, sy: ev.sy, base: e.shiftKey ? [...E.sel] : [] };
    }
  },
  move(ev) {
    if (!D) { hover(ev); return; }
    DRAG[D.kind]?.move(ev);
  },
  up(ev) {
    if (!D) return;
    DRAG[D.kind]?.up?.(ev);
    D = null; E.guides = []; E.marquee = null; requestOverlay();
  },
  dbl(ev) {
    const hid = hitAt(ev.e);
    const cur = E.sel.length === 1 ? node(E.sel[0]) : null;
    if (hid && cur) {
      const chain = [hid, ...ancestors(hid)], i = chain.indexOf(cur.id);
      if (cur.type === 'group' && i > 0) { E.scope = cur.id; select(chain[i - 1]); emit('scope'); return; }
      if (cur.id === hid || i >= 0) {
        if (isPathLike(cur)) { setTool('direct'); return; }
        if (cur.type === 'text') { emit('focusProp', 'text'); return; }
      }
    }
    if (!hid && E.scope) { const s = E.scope; E.scope = node(s)?.parent ?? null; select(s); emit('scope'); }
  },
};
let hoverRaf = 0;
function hover(ev) {
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    const hid = hitAt(ev.e);
    const id = hid ? (ev.e.ctrlKey || ev.e.metaKey || E.tool === 'direct' ? hid : pickLevel(hid)) : null;
    if (id !== E.hover) { E.hover = id; requestOverlay(); }
  });
}

/** Нажатие на ручку или значок. */
function gizmoDown(ev, h) {
  const [kind, id] = h.includes('|') ? [h.slice(0, h.indexOf('|')), h.slice(h.indexOf('|') + 1)] : h.split(':');
  if (kind === 's') return startScale(ev, id);
  if (kind === 'r') return startRotate(ev);
  if (kind === 'pivot') return startPivot(ev);
  if (kind === 'l' || kind === 't' || kind === 'j') { if (!E.sel.includes(id) || E.sel.length > 1) select(id); D = { kind: 'move', sx: ev.sx, sy: ev.sy, moved: false, clicked: id }; return; }
  if (kind === 'b') {
    select(id);
    if (ev.e.ctrlKey || ev.e.metaKey) { D = { kind: 'move', sx: ev.sx, sy: ev.sy, moved: false, clicked: id }; return; }
    const { joint } = boneEnds(id);
    return startRotate(ev, joint);
  }
  if (kind === 'lr') { select(id); const n = node(id), m = screenM(id); D = { kind: 'lradius', n, c: applyPt(m, [getVal(n, 'anchorX'), getVal(n, 'anchorY')]), k: Math.hypot(m[0], m[1]) }; begin(); return; }
  if (kind === 'penstart') return;
}
const items = () => topSel().filter((id) => !isLocked(id)).map((id) => { const n = node(id), P = parentScreen(id); return { n, P, Pi: M.inv(P), L0: localM(n) }; });

const DRAG = {
  move: {
    move(ev) {
      if (!D.moved) {
        if (dist([ev.sx, ev.sy], [D.sx, D.sy]) < 3) return;
        D.moved = true; begin();
        if (D.alt) {
          // Alt+перетаскивание — копия
          const out = [];
          raw(() => { for (const id of topSel()) out.push(...insertClones(cloneNodes([id]), node(id).parent ?? null, id)); });
          K.invalidate(E.scene); E.sel = out; emit('sel');
        }
        D.items = items();
        D.box0 = selAABB(D.items.map((i) => i.n.id));
        D.targets = snapTargets(D.items.map((i) => i.n.id));
      }
      let dx = ev.sx - D.sx, dy = ev.sy - D.sy;
      if (ev.e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      [dx, dy] = snapMove(dx, dy, ev.e);
      const T = [1, 0, 0, 1, dx, dy];
      for (const it of D.items) setLocalM(it.n, M.mul(it.Pi, M.mul(T, M.mul(it.P, it.L0))));
      preview();
    },
    up(ev) {
      if (D.moved) commit(D.alt ? 'копия' : 'перемещение');
      else if (!ev.e.shiftKey && E.sel.length > 1 && D.clicked) select(D.clicked);
    },
  },
  marquee: {
    move(ev) { E.marquee = [D.sx, D.sy, ev.sx, ev.sy]; requestOverlay(); },
    up() {
      if (!E.marquee) return;
      const [x0, y0, x1, y1] = E.marquee, r = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
      if (r[2] - r[0] < 3 && r[3] - r[1] < 3) return;
      const hit = kidsOf(E.scope).filter((n) => n.type !== 'light' && !isLocked(n.id) && !isHidden(n.id)).filter((n) => {
        const c = cornersOf(n.id); if (!c) return false;
        const b = aabb(c); return b[0] < r[2] && b[2] > r[0] && b[1] < r[3] && b[3] > r[1];
      }).map((n) => n.id);
      select([...D.base, ...hit]);
    },
  },
  scale: {
    move(ev) {
      const q = applyPt(D.Ni, [ev.sx, ev.sy]);
      const O = ev.e.altKey ? D.C : D.O;
      let fx = D.h[0] === 0.5 ? 1 : (q[0] - O[0]) / (D.H[0] - O[0] || 1e-9);
      let fy = D.h[1] === 0.5 ? 1 : (q[1] - O[1]) / (D.H[1] - O[1] || 1e-9);
      if (ev.e.shiftKey) {
        if (D.h[0] === 0.5) fx = Math.abs(fy); else if (D.h[1] === 0.5) fy = Math.abs(fx);
        else { const s = Math.max(Math.abs(fx), Math.abs(fy)); fx = Math.sign(fx || 1) * s; fy = Math.sign(fy || 1) * s; }
      }
      if (Math.abs(fx) < 1e-3) fx = 1e-3; if (Math.abs(fy) < 1e-3) fy = 1e-3;
      if (D.multi) {
        const S = [fx, 0, 0, fy, O[0] - fx * O[0], O[1] - fy * O[1]];
        for (const it of D.items) setLocalM(it.n, M.mul(it.Pi, M.mul(S, M.mul(it.P, it.L0))));
      } else if (D.resize && fx > 0 && fy > 0) {
        const n = D.n;
        setLocalM(n, M.mul(D.L0, [1, 0, 0, 1, O[0] - fx * O[0], O[1] - fy * O[1]]));
        for (const [p, v, k] of D.resize) setVal(n, p, v * (k === 'x' ? fx : fy));
      } else {
        if (D.resize) for (const [p, v] of D.resize) setVal(D.n, p, v);
        setLocalM(D.n, M.mul(D.L0, [fx, 0, 0, fy, O[0] - fx * O[0], O[1] - fy * O[1]]));
      }
      preview();
    },
    up() { commit('масштаб'); },
  },
  rotate: {
    move(ev) {
      let da = Math.atan2(ev.sy - D.pv[1], ev.sx - D.pv[0]) - D.a0;
      if (ev.e.shiftKey) da = (Math.round(deg(da) / 15) * 15 * Math.PI) / 180;
      const c = Math.cos(da), s = Math.sin(da), [px, py] = D.pv;
      const R = [c, s, -s, c, px - c * px + s * py, py - s * px - c * py];
      for (const it of D.items) setLocalM(it.n, M.mul(it.Pi, M.mul(R, M.mul(it.P, it.L0))));
      preview();
    },
    up() { commit('поворот'); },
  },
  pivot: {
    move(ev) {
      let a = applyPt(D.Ni, [ev.sx, ev.sy]);
      // привязка к углам, серединам и центру рамки
      if (D.box) {
        const [x, y, w, h] = D.box, N0 = M.inv(D.Ni);
        for (const u of [0, 0.5, 1]) for (const v of [0, 0.5, 1]) { const p = [x + w * u, y + h * v]; if (dist(applyPt(N0, p), [ev.sx, ev.sy]) < 8) a = p; }
      }
      const p = applyPt(D.L0, a);
      setVal(D.n, 'anchorX', a[0]); setVal(D.n, 'anchorY', a[1]); setVal(D.n, 'x', p[0]); setVal(D.n, 'y', p[1]);
      preview();
    },
    up() { commit('опорная точка'); },
  },
  lradius: {
    move(ev) { setVal(D.n, 'radius', Math.max(5, dist([ev.sx, ev.sy], D.c) / (D.k || 1))); preview(); },
    up() { commit('радиус света'); },
  },
};

function startScale(ev, hname) {
  const ids = topSel().filter((id) => !isLocked(id));
  if (!ids.length) return;
  const h = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] }[hname];
  begin();
  if (ids.length > 1) {
    const b = selAABB(ids), pt = (u, v) => [b[0] + (b[2] - b[0]) * u, b[1] + (b[3] - b[1]) * v];
    D = { kind: 'scale', multi: true, items: items(), h, H: pt(...h), O: pt(1 - h[0], 1 - h[1]), C: pt(0.5, 0.5), Ni: M.id() };
    return;
  }
  const n = node(ids[0]), box = localBox(n.id) || [-10, -10, 20, 20];
  const P = parentScreen(n.id), L0 = localM(n), N0 = M.mul(P, L0);
  const pt = (u, v) => [box[0] + box[2] * u, box[1] + box[3] * v];
  // прямоугольник, эллипс и картинка меняют размер, а не масштаб (обводка не растягивается)
  let resize = null;
  if (!pathKey(n) && !['scale', 'scaleX', 'scaleY'].some((p) => n.keys?.[p]?.length)) {
    if (n.type === 'rect' || n.type === 'image') resize = [['width', getVal(n, 'width'), 'x'], ['height', getVal(n, 'height'), 'y']];
    if (n.type === 'ellipse') resize = [['rx', getVal(n, 'rx'), 'x'], ['ry', getVal(n, 'ry'), 'y']];
  }
  D = { kind: 'scale', n, P, L0, Ni: M.inv(N0), h, H: pt(...h), O: pt(1 - h[0], 1 - h[1]), C: pt(0.5, 0.5), resize };
}
function startRotate(ev, pivot) {
  const its = items();
  if (!its.length) return;
  let pv = pivot;
  if (!pv) {
    if (its.length === 1) { const n = its[0].n; pv = applyPt(screenM(n.id), [getVal(n, 'anchorX'), getVal(n, 'anchorY')]); }
    else { const b = selAABB(its.map((i) => i.n.id)); pv = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }
  }
  begin();
  D = { kind: 'rotate', items: its, pv, a0: Math.atan2(ev.sy - pv[1], ev.sx - pv[0]) };
}
function startPivot() {
  const n = node(E.sel[0]);
  if (!n) return;
  const L0 = localM(n), N0 = M.mul(parentScreen(n.id), L0);
  begin();
  D = { kind: 'pivot', n, L0, Ni: M.inv(N0), box: localBox(n.id) };
}

/* ---------- привязка ---------- */
function snapTargets(ids) {
  const ex = new Set(ids);
  const [X0, Y0] = toStage(0, 0), [X1, Y1] = toStage(E.scene.width, E.scene.height);
  const xs = [X0, (X0 + X1) / 2, X1], ys = [Y0, (Y0 + Y1) / 2, Y1];
  const pool = new Set([...kidsOf(E.scope), ...ids.flatMap((id) => kidsOf(node(id)?.parent ?? null))]);
  for (const n of pool) {
    if (ex.has(n.id) || n.type === 'light' || isHidden(n.id)) continue;
    const c = cornersOf(n.id);
    if (!c) continue;
    const b = aabb(c);
    xs.push(b[0], (b[0] + b[2]) / 2, b[2]); ys.push(b[1], (b[1] + b[3]) / 2, b[3]);
  }
  return { xs, ys };
}
function snapMove(dx, dy, e) {
  E.guides = [];
  const b = D.box0;
  if (!b || !E.snap || e.ctrlKey || e.metaKey) return [dx, dy];
  const T = 6;
  const best = (vals, targets) => { let r = null; for (const v of vals) for (const t of targets) { const d = t - v; if (Math.abs(d) <= T && (!r || Math.abs(d) < Math.abs(r.d))) r = { d, t }; } return r; };
  const bx = best([b[0] + dx, (b[0] + b[2]) / 2 + dx, b[2] + dx], D.targets.xs);
  const by = best([b[1] + dy, (b[1] + b[3]) / 2 + dy, b[3] + dy], D.targets.ys);
  if (bx) { dx += bx.d; E.guides.push([bx.t, -1e4, bx.t, 1e4]); }
  if (by) { dy += by.d; E.guides.push([-1e4, by.t, 1e4, by.t]); }
  // пиксельный режим: левый верхний край — по сетке пикселей
  const px = E.scene.pixel?.enabled ? E.scene.pixel.size : 0;
  if (px) {
    const g = px * E.zoom;
    if (!bx) dx = Math.round((b[0] + dx - E.panX) / g) * g + E.panX - b[0];
    if (!by) dy = Math.round((b[1] + dy - E.panY) / g) * g + E.panY - b[1];
  }
  return [dx, dy];
}

/** Сдвиг стрелками (в пикселях экрана). */
export function nudge(dx, dy) {
  if (E.tool === 'direct' && E.anchorSel.size) return nudgeAnchors(dx, dy);
  const its = items();
  if (!its.length) return false;
  edit('сдвиг', () => { const T = [1, 0, 0, 1, dx, dy]; for (const it of its) setLocalM(it.n, M.mul(it.Pi, M.mul(T, M.mul(it.P, it.L0)))); });
  return true;
}

/* =================== Точки контура =================== */
function editableNodes() { return [...new Set([...E.anchorSel].map((k) => k.split('|')[0]))].map(node).filter(Boolean); }
/** Записать контур в узел (фигура при первой правке превращается в контур). */
function writeGeom(n, subs) {
  const g = fromPts(subs);
  if (!pathKey(n)) { if (toPathNode(n, g)) toast('Анимация размеров фигуры снята: теперь это контур', true); K.invalidate(E.scene); return; }
  const k = pathKey(n);
  if (k === 'shape' && n.props?.shape != null && !n.keys?.shape?.length) { delete n.props.shape; (n.props ||= {}).d = K.geomToPath(g); return; }
  setVal(n, k === 'shape' ? 'shape' : 'd', K.geomToPath(g));
}
const direct = {
  cursor: 'default',
  down(ev) {
    const { e, h } = ev;
    if (h && /^[aio]\|/.test(h)) {
      const [kind, id, si, k] = h.split('|'), key = `${id}|${si}|${k}`;
      if (kind === 'a') {
        if (e.altKey) {
          const n = node(id), subs = toPts(geomOf(n));
          edit('угол/гладкая', () => { toggleSmooth(subs[+si], +k); writeGeom(n, subs); });
          return;
        }
        if (e.shiftKey) { E.anchorSel.has(key) ? E.anchorSel.delete(key) : E.anchorSel.add(key); }
        else if (!E.anchorSel.has(key)) { E.anchorSel.clear(); E.anchorSel.add(key); }
        requestOverlay();
        if (!E.anchorSel.has(key)) return;
        D = { kind: 'pts', mode: 'a', sx: ev.sx, sy: ev.sy, moved: false, nodes: editableNodes() };
      } else D = { kind: 'pts', mode: kind, key, sx: ev.sx, sy: ev.sy, moved: false, nodes: [node(id)] };
      D.base = D.nodes.map((n) => ({ n, mi: M.inv(linear(screenM(n.id))), subs: toPts(geomOf(n)) }));
      return;
    }
    if (h) return select_.down(ev);
    const hid = hitAt(e);
    if (hid && !E.sel.includes(hid)) { select(hid); E.anchorSel.clear(); requestOverlay(); return; }
    if (!e.shiftKey) E.anchorSel.clear();
    D = { kind: 'amarq', sx: ev.sx, sy: ev.sy, base: e.shiftKey ? [...E.anchorSel] : [] };
    requestOverlay();
  },
  move(ev) {
    if (!D) { hover(ev); return; }
    if (D.kind === 'amarq') { E.marquee = [D.sx, D.sy, ev.sx, ev.sy]; requestOverlay(); return; }
    if (D.kind !== 'pts') return DRAG[D.kind]?.move(ev);
    if (!D.moved) { if (dist([ev.sx, ev.sy], [D.sx, D.sy]) < 2) return; D.moved = true; begin(); }
    let d = [ev.sx - D.sx, ev.sy - D.sy];
    if (ev.e.shiftKey) { if (Math.abs(d[0]) > Math.abs(d[1])) d[1] = 0; else d[0] = 0; }
    for (const b of D.base) {
      const dl = applyPt(b.mi, d), subs = clonePts(b.subs), id = b.n.id;
      if (D.mode === 'a') {
        for (const key of E.anchorSel) {
          const [kid, si, k] = key.split('|');
          if (kid !== id) continue;
          const p = subs[+si]?.pts[+k];
          if (!p) continue;
          p.x += dl[0]; p.y += dl[1]; p.i = [p.i[0] + dl[0], p.i[1] + dl[1]]; p.o = [p.o[0] + dl[0], p.o[1] + dl[1]];
        }
      } else {
        const [, si, k] = D.key.split('|'), p = subs[+si].pts[+k], p0 = b.subs[+si].pts[+k];
        const hk = D.mode, other = hk === 'i' ? 'o' : 'i';
        p[hk] = [p0[hk][0] + dl[0], p0[hk][1] + dl[1]];
        if (!ev.e.altKey && isSmooth(p0)) {
          const L = Math.hypot(p0[other][0] - p.x, p0[other][1] - p.y), vx = p[hk][0] - p.x, vy = p[hk][1] - p.y, l = Math.hypot(vx, vy) || 1;
          p[other] = [p.x - (vx / l) * L, p.y - (vy / l) * L];
        }
      }
      writeGeom(b.n, subs);
    }
    preview();
  },
  up(ev) {
    if (!D) return;
    if (D.kind === 'amarq') {
      const m = E.marquee; E.marquee = null;
      if (m) {
        const r = [Math.min(m[0], m[2]), Math.min(m[1], m[3]), Math.max(m[0], m[2]), Math.max(m[1], m[3])];
        E.anchorSel = new Set(D.base);
        for (const id of E.sel) {
          const n = node(id); if (!n || !isPathLike(n)) continue;
          const mm = screenM(id);
          toPts(geomOf(n)).forEach((s, si) => s.pts.forEach((p, k) => { const q = applyPt(mm, [p.x, p.y]); if (q[0] >= r[0] && q[0] <= r[2] && q[1] >= r[1] && q[1] <= r[3]) E.anchorSel.add(`${id}|${si}|${k}`); }));
        }
      }
    } else if (D.kind === 'pts') { if (D.moved) commit('точки'); }
    else DRAG[D.kind]?.up?.(ev);
    D = null; requestOverlay();
  },
  dbl(ev) {
    // двойной щелчок по контуру — новая точка
    for (const id of E.sel) {
      const n = node(id); if (!n || !isPathLike(n)) continue;
      const subs = toPts(geomOf(n)), near = nearestOnPath(subs, screenM(id), ev.sx, ev.sy);
      if (near && near.d < 10) {
        edit('новая точка', () => { splitSeg(subs[near.si], near.k, near.u); writeGeom(n, subs); });
        E.anchorSel = new Set([`${id}|${near.si}|${near.k + 1}`]);
        requestOverlay();
        return;
      }
    }
  },
};
function nudgeAnchors(dx, dy) {
  const ns = editableNodes();
  edit('сдвиг точек', () => {
    for (const n of ns) {
      const subs = toPts(geomOf(n)), dl = applyPt(M.inv(linear(screenM(n.id))), [dx, dy]);
      for (const key of E.anchorSel) { const [kid, si, k] = key.split('|'); if (kid !== n.id) continue; const p = subs[+si]?.pts[+k]; if (!p) continue; p.x += dl[0]; p.y += dl[1]; p.i = [p.i[0] + dl[0], p.i[1] + dl[1]]; p.o = [p.o[0] + dl[0], p.o[1] + dl[1]]; }
      writeGeom(n, subs);
    }
  });
  return true;
}
/** Удалить выбранные точки (контур без точек удаляется). */
export function deleteAnchors() {
  const ns = editableNodes();
  if (!ns.length) return false;
  const empty = [];
  edit('удалить точки', () => {
    for (const n of ns) {
      const subs = toPts(geomOf(n));
      const kill = new Set([...E.anchorSel].filter((k) => k.startsWith(n.id + '|')).map((k) => k.slice(n.id.length + 1)));
      subs.forEach((s, si) => { s.pts = s.pts.filter((_, k) => !kill.has(`${si}|${k}`)); });
      const left = subs.filter((s) => s.pts.length >= 2);
      if (!left.length) { empty.push(n.id); continue; }
      writeGeom(n, left);
    }
  });
  E.anchorSel.clear();
  if (empty.length) deleteIds(empty, 'удалить пустой контур');
  requestOverlay();
  return true;
}

/* =================== Перо =================== */
const pen = {
  cursor: 'crosshair',
  down(ev) {
    let P = E.pen;
    if (P && P.pts.length >= 2) {
      const first = applyPt(screenM(P.parent), [P.pts[0].x, P.pts[0].y]);
      if (ev.h === 'penstart' || dist(first, [ev.sx, ev.sy]) < 8) { P.closed = true; finishPen(); return; }
    }
    if (!P) {
      begin();
      const parent = E.scope ?? null, id = uid('path');
      addNode({ id, type: 'path', parent, props: { d: 'M0 0', fill: 'none', stroke: E.stroke, strokeWidth: 3 } });
      P = E.pen = { id, parent, pts: [], closed: false, Pi: M.inv(screenM(parent)) };
      E.sel = [id]; emit('sel');
    }
    const q = applyPt(P.Pi, [ev.sx, ev.sy]);
    P.pts.push({ x: q[0], y: q[1], i: [...q], o: [...q] });
    P.drag = [ev.sx, ev.sy];
    updatePen();
  },
  move(ev) {
    const P = E.pen;
    if (!P) return;
    P.cursor = [ev.sx, ev.sy];
    if (P.drag && dist(P.drag, [ev.sx, ev.sy]) > 3) {
      const p = P.pts[P.pts.length - 1], q = applyPt(P.Pi, [ev.sx, ev.sy]);
      p.o = q; p.i = [2 * p.x - q[0], 2 * p.y - q[1]];
      updatePen();
    }
    requestOverlay();
  },
  up() { if (E.pen) E.pen.drag = null; },
  dbl() { finishPen(); },
};
function updatePen() {
  const P = E.pen, n = node(P.id);
  n.props.d = P.pts.length > 1 ? K.geomToPath(fromPts([{ closed: P.closed, pts: P.pts }])) : 'M0 0';
  preview();
}
/** Перенести начало координат контура в центр его точек (чтобы вращать вокруг центра). */
function recenter(n, geom) {
  const xs = [], ys = [];
  for (const s of geom) { xs.push(s.x0); ys.push(s.y0); for (const g of s.segs) { xs.push(g[4]); ys.push(g[5]); } }
  const cx = round((Math.min(...xs) + Math.max(...xs)) / 2), cy = round((Math.min(...ys) + Math.max(...ys)) / 2);
  n.props.d = K.geomToPath(K.translateGeom(geom, -cx, -cy));
  n.props.x = cx; n.props.y = cy;
}
export function finishPen() {
  const P = E.pen;
  if (!P) return;
  E.pen = null;
  while (P.pts.length > 1) { const a = P.pts[P.pts.length - 1], b = P.pts[P.pts.length - 2]; if (Math.hypot(a.x - b.x, a.y - b.y) < 0.5) P.pts.pop(); else break; }
  const n = node(P.id);
  if (!n || P.pts.length < 2) { cancel(); select([]); requestOverlay(); return; }
  recenter(n, fromPts([{ closed: P.closed, pts: P.pts }]));
  if (P.closed) n.props.fill = E.fill;
  commit('перо');
  select(P.id);
}

/* =================== Карандаш =================== */
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let best = 0, bi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], L = dist(a, b) || 1;
    const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L;
    if (d > best) { best = d; bi = i; }
  }
  if (best <= eps) return [a, b];
  return [...rdp(pts.slice(0, bi + 1), eps).slice(0, -1), ...rdp(pts.slice(bi), eps)];
}
const pencil = {
  cursor: 'crosshair',
  down(ev) { E.pencil = [[ev.sx, ev.sy]]; },
  move(ev) { const P = E.pencil; if (!P) return; if (dist(P[P.length - 1], [ev.sx, ev.sy]) > 2) { P.push([ev.sx, ev.sy]); requestOverlay(); } },
  up() {
    const P = E.pencil; E.pencil = null; requestOverlay();
    if (!P || P.length < 3) return;
    const closed = P.length > 6 && dist(P[0], P[P.length - 1]) < 14;
    let pts = rdp(P, 2.2);
    if (closed && pts.length > 2) pts = pts.slice(0, -1);
    if (pts.length < 2) return;
    const parent = E.scope ?? null, Pi = M.inv(screenM(parent));
    const local = pts.map((p) => applyPt(Pi, p));
    const id = uid('path');
    edit('карандаш', () => {
      const n = addNode({ id, type: 'path', parent, props: { fill: closed ? E.fill : 'none', stroke: E.stroke, strokeWidth: 3 } });
      recenter(n, K.smoothGeom(local, closed, 1));
    });
    select(id);
  },
};

/* =================== Фигуры =================== */
function shapeTool(type) {
  return {
    cursor: 'crosshair',
    down(ev) {
      begin();
      const parent = E.scope ?? null, Pi = M.inv(screenM(parent)), a = applyPt(Pi, [ev.sx, ev.sy]);
      const id = uid(type);
      const props = { rect: { width: 1, height: 1, fill: E.fill }, ellipse: { rx: 1, ry: 1, fill: E.fill }, polygon: { radius: 1, sides: 6, fill: E.fill }, star: { outerRadius: 1, innerRadius: 0.45, points: 5, fill: E.fill }, line: { x1: 0, y1: 0, x2: 1, y2: 0, stroke: E.stroke, strokeWidth: 3 } }[type];
      addNode({ id, type, parent, props: { x: round(a[0]), y: round(a[1]), ...props } });
      D = { kind: 'shape', id, Pi, a, sx: ev.sx, sy: ev.sy, moved: false };
      E.sel = [id]; emit('sel'); preview();
    },
    move(ev) {
      if (!D) return;
      if (!D.moved && dist([ev.sx, ev.sy], [D.sx, D.sy]) < 3) return;
      D.moved = true;
      const n = node(D.id), a = D.a, b = applyPt(D.Pi, [ev.sx, ev.sy]), p = n.props;
      let w = b[0] - a[0], h = b[1] - a[1];
      if (type === 'rect' || type === 'ellipse') {
        if (ev.e.shiftKey) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
        const c = ev.e.altKey ? a : [a[0] + w / 2, a[1] + h / 2], W = ev.e.altKey ? Math.abs(w) * 2 : Math.abs(w), H = ev.e.altKey ? Math.abs(h) * 2 : Math.abs(h);
        p.x = round(c[0]); p.y = round(c[1]);
        if (type === 'rect') { p.width = round(W); p.height = round(H); } else { p.rx = round(W / 2); p.ry = round(H / 2); }
      } else if (type === 'polygon' || type === 'star') {
        const r = Math.hypot(w, h);
        if (type === 'polygon') p.radius = round(r); else { p.outerRadius = round(r); p.innerRadius = round(r * 0.45); }
        p.rotation = ev.e.shiftKey ? 0 : round(deg(Math.atan2(h, w)) + 90);
      } else if (type === 'line') {
        if (ev.e.shiftKey) { const ang = Math.round(Math.atan2(h, w) / (Math.PI / 4)) * (Math.PI / 4), L = Math.hypot(w, h); w = Math.cos(ang) * L; h = Math.sin(ang) * L; }
        p.x2 = round(w); p.y2 = round(h);
      }
      preview();
    },
    up() {
      if (!D) return;
      const n = node(D.id), p = n.props;
      if (!D.moved) {
        if (type === 'rect') { p.width = 100; p.height = 100; }
        if (type === 'ellipse') { p.rx = 50; p.ry = 50; }
        if (type === 'polygon') p.radius = 50;
        if (type === 'star') { p.outerRadius = 50; p.innerRadius = 22; }
        if (type === 'line') p.x2 = 100;
      }
      commit('фигура');
      D = null;
      setTool('select');
      select(n.id);
    },
  };
}

/* =================== Текст, картинка, свет, кости =================== */
const text = {
  cursor: 'text',
  down(ev) {
    const parent = E.scope ?? null, a = toParent(parent, ev.sx, ev.sy), id = uid('text');
    edit('текст', () => addNode({ id, type: 'text', parent, props: { x: round(a[0]), y: round(a[1]), text: 'Текст', fontSize: 48, fill: E.fill } }));
    setTool('select'); select(id);
    setTimeout(() => emit('focusProp', 'text'), 30);
  },
};
const image = {
  cursor: 'copy',
  down(ev) {
    const parent = E.scope ?? null, at = toParent(parent, ev.sx, ev.sy);
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => inp.files[0] && addImageFile(inp.files[0], at, parent);
    inp.click();
  },
};
const fileToDataURL = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
/** Картинка в сцену: на сервер (рядом со сценой, в assets/) или внутрь файла сцены. */
export async function addImageFile(file, at, parent = E.scope ?? null) {
  let src, w, h;
  try {
    if (E.live && E.source === '__live') {
      const r = await fetch('/asset?name=' + encodeURIComponent(file.name), { method: 'POST', body: file });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json(); src = d.url; w = d.width; h = d.height;
    } else src = await fileToDataURL(file);
    if (!w || !h) { const img = new Image(); img.src = src; await img.decode(); w = img.naturalWidth; h = img.naturalHeight; }
  } catch (e) { toast('Картинка не добавлена: ' + e.message, true); return; }
  if (!at) { const P = M.inv(screenM(parent)); const r = stage.getBoundingClientRect(); at = applyPt(P, [r.width / 2, r.height / 2]); }
  const s = Math.min(1, (E.scene.width * 0.6) / w, (E.scene.height * 0.6) / h);
  const id = uid(file.name.replace(/\.\w+$/, '') || 'image');
  edit('картинка', () => addNode({ id, type: 'image', parent, props: { x: round(at[0]), y: round(at[1]), src, width: round(w * s), height: round(h * s) } }));
  setTool('select'); select(id);
}
const light = {
  cursor: 'crosshair',
  down(ev) {
    const parent = E.scope ?? null, a = toParent(parent, ev.sx, ev.sy), id = uid('light');
    edit('свет', () => addNode({ id, type: 'light', parent, props: { x: round(a[0]), y: round(a[1]), z: 80, color: '#ffd9a0', energy: 1, radius: round(Math.min(E.scene.width, E.scene.height) * 0.45) } }));
    setTool('select'); select(id);
    if (!E.lightPreview) toast('Свет виден в превью: кнопка «Свет» внизу справа');
  },
};
const bone = {
  cursor: 'crosshair',
  down(ev) {
    let parent = E.scope ?? null, start = [ev.sx, ev.sy];
    const sb = node(E.sel[0]);
    if (sb?.props?.bone) { const { tip } = boneEnds(sb.id); if (dist(tip, start) < 14) { parent = sb.id; start = tip; } }
    begin();
    const Pi = M.inv(screenM(parent)), a = applyPt(Pi, start), id = uid('bone');
    addNode({ id, type: 'group', parent, props: { x: round(a[0]), y: round(a[1]), bone: true, boneLength: 1 } });
    D = { kind: 'bone', id, Pi, a, start };
    E.sel = [id]; emit('sel'); preview();
  },
  move(ev) {
    if (!D) { return; }
    const n = node(D.id), b = applyPt(D.Pi, [ev.sx, ev.sy]), v = [b[0] - D.a[0], b[1] - D.a[1]];
    n.props.rotation = round(deg(Math.atan2(v[1], v[0])));
    n.props.boneLength = round(Math.hypot(v[0], v[1]));
    preview();
  },
  up(ev) {
    if (!D) return;
    const id = D.id;
    if (dist([ev.sx, ev.sy], D.start) < 6) { D = null; cancel(); toast('Протяните мышью от сустава к концу кости'); return; }
    D = null;
    commit('кость');
    select(id);
  },
};
const hand = { cursor: 'grab' };

export const TOOLS = {
  select: select_, direct, pen, pencil, rect: shapeTool('rect'), ellipse: shapeTool('ellipse'), polygon: shapeTool('polygon'), star: shapeTool('star'), line: shapeTool('line'),
  text, image, bone, light, hand,
};
E.tools = TOOLS;
