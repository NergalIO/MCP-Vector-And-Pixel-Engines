// Kontur world3d — Перевод построенной сцены в узлы Kontur (toNodes, toScene).
import { sub, add, mul, sub2 } from './geom.js';

/* ============================== В УЗЛЫ KONTUR ============================== */
const r1 = (v) => Math.round(v * 10) / 10;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const same3 = (a, b) => a && b && Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4 && Math.abs(a[2] - b[2]) < 1e-4;
const plEq = (a, b) => a && b && same3(a, b) && Math.abs(a[3] - b[3]) < 1e-4;

/**
 * Превратить построенную сцену в узлы Kontur.
 * opts: idPrefix ('w'), parent (id родителя для корневой группы), group (id корневой группы, 'world'), lights (true),
 *   pan — проезд камеры вбок [[t, dx м], …]: группы элементов получают ключи x = −f·dx/(Z + dz) по своей ближней
 *   глубине Z (точно для граней, обращённых к камере; объёмные предметы — приближённо; свет и тени остаются на месте).
 * Возвращает { nodes, camera3d, background, root } — nodes уже в порядке художника (дальние раньше).
 */
export function toNodes(S, opts = {}) {
  const pre = opts.idPrefix ?? 'w';
  const rootId = opts.group ?? 'world';
  const nodes = [{ id: rootId, type: 'group', parent: opts.parent ?? null, props: {} }];
  if (opts.world3d) nodes[0].props.world3d = opts.world3d;
  const push = (n) => { nodes.push(n); return n; };
  const P2 = (ps) => ps.map((p) => S.P(p));
  const pathD = (q) => { let d = 'M'; for (let i = 0; i < q.length; i++) d += (i ? 'L' : '') + r1(q[i][0]) + ' ' + r1(q[i][1]); return d + 'Z'; };
  // проекция многоугольника в общий буфер (без массивов на точку): рамка и путь за один проход
  const proj = S.camera?.projector ? S.camera.projector(1) : (X, Y, Z, out) => { const p = S.P([X, Y, Z]); out[0] = p[0]; out[1] = p[1]; return out; };
  const tmp = [0, 0, 0];
  let QB = new Float64Array(512), lastBB = null;
  const minPx = S.lod >= 2 ? 0.6 : 0.3;
  const polyD = (ps) => {
    const n = ps.length;
    if (QB.length < n * 2) QB = new Float64Array(n * 4);
    let a = Infinity, b = -Infinity, c = Infinity, e = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = ps[i]; proj(p[0], p[1], p[2], tmp);
      const x = tmp[0], y = tmp[1]; QB[2 * i] = x; QB[2 * i + 1] = y;
      if (x < a) a = x; if (x > b) b = x; if (y < c) c = y; if (y > e) e = y;
    }
    lastBB = S.merge ? { bb: [a, c, b, e], pts: QB.slice(0, 2 * n) } : null;
    if (b - a < minPx || e - c < minPx || b < -50 || a > S.W + 50 || e < -50 || c > S.H + 50) return null;
    let d = 'M';
    for (let i = 0; i < n; i++) d += (i ? 'L' : '') + r1(QB[2 * i]) + ' ' + r1(QB[2 * i + 1]);
    return d + 'Z';
  };
  // небо: облака и прочие фигуры неба
  if (S.sky.length) {
    const sid = `${pre}sky`;
    push({ id: sid, type: 'group', parent: rootId, props: { surface: { sky: true } } });
    S.sky.forEach((c, i) => push({ id: `${sid}_${i}`, type: 'ellipse', parent: sid, props: { x: r1(c.x), y: r1(c.y), rx: r1(c.rx), ry: r1(c.ry), fill: c.fill, ...(c.op < 1 ? { opacity: c.op } : {}) } }));
  }
  const items = S.items.map((it, i) => ({ it, i })).sort((a, b) => b.it.key - a.it.key || a.i - b.i);
  const prim2node = (p, id, parent, gpl) => {
    if (p.t === 'img') {
      return { id, type: 'image', parent, props: { x: r1(p.x + p.w / 2), y: r1(p.y + p.h / 2), width: r1(p.w), height: r1(p.h), src: p.uri, ...(p.flip ? { scaleX: -1 } : {}),
        surface: { normal: [0, 0, -1], plane: [0, 0, -1, r4(-p.Z)], spec: 0.15, base: true, ...(p.tag ? { tag: p.tag } : {}) } } };
    }
    if (p.t === 'text') {
      const c = S.P(p.at), ex = sub2(S.P(add(p.at, mul(p.u, 0.01))), c), ey = sub2(S.P(sub(p.at, mul(p.v, 0.01))), c);
      const dm = decompose2([ex[0], ex[1], ey[0], ey[1]]);
      if (!(Math.abs(dm.scaleX) > 1e-3)) return null;
      const props = { x: r1(c[0]), y: r1(c[1]), text: p.text, fontSize: +(p.size * 100).toFixed(1), fontFamily: p.font || 'Georgia, serif', fontWeight: p.weight || 'bold', fill: p.color, textAlign: 'center', letterSpacing: p.spacing || 0, ...dm };
      props.surface = { plane: p.pl.map(r4), normal: p.n.map(r4), bump: true };
      if (p.em) props.surface.emissive = p.em;
      return { id, type: 'text', parent, props };
    }
    if (p.t === 'line') {
      const [x1, y1] = S.P(p.a), [x2, y2] = S.P(p.b);
      if (Math.hypot(x2 - x1, y2 - y1) < 0.3) return null;
      const props = { x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2), stroke: p.col, strokeWidth: +p.w.toFixed(2), lineCap: 'round' };
      if (p.op < 1) props.opacity = p.op;
      if (p.ink) props.surface = { ink: true, sw: +p.w.toFixed(2) };
      return { id, type: 'line', parent, props };
    }
    let d = polyD(p.ps);
    if (d === null) return null;
    const s = {};
    if (!plEq(p.pl, gpl)) s.plane = p.pl.map(r4);
    const nRef = s.plane ? p.pl : gpl;
    if (p.n && !same3(p.n, nRef)) { s.normal = p.n.map(r4); if (!p.bump) s.bump = false; }
    else if (p.bump) s.bump = true;
    if (p.base) s.base = true;
    if (p.ink) { s.ink = true; if (p.sw != null) s.sw = +p.sw.toFixed(2); else { const z = Math.min(...p.ps.map((v) => v[2])); s.sw = +S.sw(z).toFixed(2); } }
    if (p.spec != null && Math.abs(p.spec - 0.1) > 1e-6) s.spec = p.spec;
    if (p.em) s.emissive = p.em;
    if (p.ng) s.normalGrad = roundNG(p.ng);
    if (p.geo) s.geo = true;
    const props = { d, fill: p.alb, surface: s };
    if (p.holes?.length) { for (const h of p.holes) d += pathD(P2(h)); props.d = d; props.fillRule = 'evenodd'; }
    if (p.op < 1) props.opacity = p.op;
    return { id, type: 'path', parent, props };
  };
  // рамка узла в px (для слияния): путь — из последней проекции, линия — по концам, остальное — бесконечная
  const bbOf = (n) => {
    if (n.type === 'path') return lastBB;
    if (n.type === 'line') {
      const p = n.props, w = (p.strokeWidth || 1) / 2, bb = [Math.min(p.x1, p.x2) - w, Math.min(p.y1, p.y2) - w, Math.max(p.x1, p.x2) + w, Math.max(p.y1, p.y2) + w];
      return { bb, pts: Float64Array.of(bb[0], bb[1], bb[2], bb[1], bb[2], bb[3], bb[0], bb[3]) };
    }
    return null;
  };
  const roundNG = (ng) => {
    const r = (L) => {
      const o = { kind: L.kind };
      if (L.from) o.from = L.from.map(r1); if (L.to) o.to = L.to.map(r1); if (L.c) o.c = L.c.map(r1);
      if (L.r != null) o.r = Array.isArray(L.r) ? L.r.map(r1) : r1(L.r);
      if (L.flat) o.flat = L.flat; if (L.ch) o.ch = L.ch;
      if (L.stops) o.stops = L.stops.map(([t, n]) => [r4(t), n.map((v) => Math.round(v * 1000) / 1000)]);
      return o;
    };
    return Array.isArray(ng) ? ng.map(r) : r(ng);
  };
  const perItem = {};
  const pan = Array.isArray(opts.pan) && opts.pan.length ? opts.pan : null;
  for (const { it, i } of items) {
    // v2: id от предмета описания (его id или номер) и номера элемента в нём — не зависит от камеры
    const iid = it.sid != null ? `${pre}${it.sid}` : `${pre}${i}`;
    const at0 = nodes.length;
    const ip = { };
    if (it.name) ip.name = it.name;
    // автоокклюдеры — если у элемента нет своих коробок и треугольников
    const tris = it.tris.length || it.occ.length ? it.tris : it.auto || [];
    if (it.occ.length || tris.length) ip.occluder = { ...(it.occ.length ? { boxes: it.occ.map((b) => b.map(r4)) } : {}), ...(tris.length ? { tris: tris.map((t) => t.map((v) => v.map(r4))) } : {}), ...(it.alpha != null && it.alpha < 1 ? { alpha: it.alpha } : {}) };
    if (it.pmat) ip.surface = { mat: it.pmat };
    const eg = push({ id: iid, type: 'group', parent: rootId, props: ip });
    if (pan) { const z = nearZ(it); eg.keys = { x: pan.map(([t, dx]) => [t, r1((-S.f * dx) / Math.max(0.05, z + S.dz))]) }; }
    // подряд идущие примитивы одной грани (общая плоскость и обрезка) — в общую группу с surface.plane и clip
    let j = 0, gi = 0;
    const ps = it.prims;
    while (j < ps.length) {
      const p = ps[j];
      let k = j + 1;
      if (p.t !== 'img' && p.t !== 'text') while (k < ps.length && ps[k].t !== 'img' && ps[k].t !== 'text' && ps[k].pl === p.pl && ps[k].clip === p.clip && p.pl) k++;
      const run = ps.slice(j, k);
      const r0 = nodes.length;
      if (run.length === 1 && !p.clip) {
        const n = prim2node(p, `${iid}_${gi++}`, iid, null);
        if (n) push(n);
      } else {
        const gid = `${iid}_${gi++}`;
        const g = push({ id: gid, type: 'group', parent: iid, props: p.pl ? { surface: { plane: p.pl.map(r4) } } : {} });
        if (p.clip) {
          const cl = Array.isArray(p.clip) ? { ps: p.clip } : p.clip;
          let d = pathD(P2(cl.ps));
          for (const h of cl.holes || []) d += pathD(P2(h));
          push({ id: `${gid}c`, type: 'path', parent: iid, props: { d, fill: '#ffffff', ...(cl.holes?.length ? { fillRule: 'evenodd' } : {}) } });
          g.props.clip = `${gid}c`;
        }
        let m = 0;
        const c0 = nodes.length;
        if (S.merge) {
          const list = [];
          for (const q of run) { const n = prim2node(q, `${gid}_${m++}`, gid, p.pl); if (n) list.push([n, bbOf(n)]); }
          for (const n of mergeRun(list, { W: S.W, H: S.H })) push(n);
        } else for (const q of run) { const n = prim2node(q, `${gid}_${m++}`, gid, p.pl); if (n) push(n); }
        if (nodes.length === c0) nodes.length = r0; // все дети за кадром — без пустой группы и её обрезки
      }
      j = k;
    }
    // элемент без видимых узлов остаётся, только если отбрасывает тень
    if (nodes.length === at0 + 1 && !ip.occluder && !it.keep) nodes.length = at0;
    if (it.src != null) perItem[it.src] = (perItem[it.src] || 0) + nodes.length - at0;
  }
  if (opts.lights !== false && S.lights.length) {
    const lid = `${pre}lights`;
    push({ id: lid, type: 'group', parent: rootId, props: {} });
    S.lights.forEach((l, i) => {
      if (l.src != null) perItem[l.src] = (perItem[l.src] || 0) + 1;
      const [x, y] = S.P(l.p);
      const ln = push({ id: `${lid}_${i}`, type: 'light', parent: lid, props: { x: r1(x), y: r1(y), p3: l.p.map(r4), color: l.col, radius: l.r, energy: l.i, group: l.kind, ...(l.shadows != null ? { shadows: l.shadows } : {}) } });
      if (l.keys) ln.keys = { energy: l.keys };
    });
  }
  const [top, mid, low] = S.skyGrad;
  return {
    nodes, root: rootId, perItem,
    camera3d: { hor: S.hor, f: S.f, camH: S.camH, dz: S.dz, cx: S.cx, ...S.camExtra },
    background: { type: 'linear', x1: 0, y1: 0, x2: 0, y2: S.H, stops: [[0, top], [0.6, mid], [1, low]] },
  };
}
/** Линейная матрица [a, b, c, d] → rotation, skewX, scaleX, scaleY узла (как decompose в world_ops). */
function decompose2([a, b, c, d]) {
  const r = Math.atan2(b, a), sx = Math.hypot(a, b), cs = Math.cos(r), sn = Math.sin(r);
  const c2 = cs * c + sn * d, sy = -sn * c + cs * d;
  const out = { rotation: +((r * 180) / Math.PI).toFixed(3), scaleX: +sx.toFixed(5), scaleY: +sy.toFixed(5) };
  const sk = (Math.atan(c2 / (sy || 1e-12)) * 180) / Math.PI;
  if (Math.abs(sk) > 0.01) out.skewX = +sk.toFixed(3);
  return out;
}
/** Полная сцена Kontur из построителя: размеры, камера, фон-небо, узлы. extra — поля сцены (lighting, style, …). */
export function toScene(S, extra = {}, opts = {}) {
  const r = toNodes(S, opts);
  return { version: 1, width: S.W, height: S.H, duration: extra.duration ?? 4, fps: 30, loop: true, background: r.background, camera3d: r.camera3d, ...extra, nodes: r.nodes };
}

/**
 * Слить узлы одной грани (общая плоскость и обрезка) с одинаковым видом в составные пути.
 * list: [[узел, {bb, pts} | null], …] в порядке рисования (pts — вершины в px подряд x, y). Узел вливается в последнюю группу своего вида, только если
 * не перекрывает ничего, что нарисовано в ней или после неё (иначе порядок художника изменился бы, а совпадающие
 * подпути с разным обходом дали бы дыры при nonzero). Возвращает узлы в порядке рисования.
 */
export function mergeRun(list, { W = 4096, H = 4096, cell = 48 } = {}) {
  const out = [], latest = new Map(), grid = new Map(), infs = [];
  const EPS = 0.05;
  const boxes = (a, b) => a[0] < b[2] - EPS && b[0] < a[2] - EPS && a[1] < b[3] - EPS && b[1] < a[3] - EPS;
  // разделяющая ось по рёбрам обоих многоугольников: найдена — фигуры точно не пересекаются (верно и для
  // невыпуклых); не найдена — считаем, что пересекаются (осторожно)
  const apart = (P, Q) => {
    for (const [A, B] of [[P, Q], [Q, P]]) {
      const n = A.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ex = A[2 * j] - A[2 * i], ey = A[2 * j + 1] - A[2 * i + 1];
        const L = Math.hypot(ex, ey);
        if (L < 1e-9) continue;
        const nx = -ey / L, ny = ex / L;
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (let k = 0; k < A.length; k += 2) { const v = A[k] * nx + A[k + 1] * ny; if (v < a0) a0 = v; if (v > a1) a1 = v; }
        for (let k = 0; k < B.length; k += 2) { const v = B[k] * nx + B[k + 1] * ny; if (v < b0) b0 = v; if (v > b1) b1 = v; }
        if (a1 <= b0 + EPS || b1 <= a0 + EPS) return true;
      }
    }
    return false;
  };
  const overlap = (a, b) => boxes(a.bb, b.bb) && !apart(a.pts, b.pts);
  const each = (bb, f) => {
    // сетка только над кадром с полями: огромные рамки (точки у плоскости камеры) не раздувают её
    const cl = (v, m) => Math.floor(Math.max(-256, Math.min(m + 256, v)) / cell);
    const x0 = cl(bb[0], W), x1 = cl(bb[2], W), y0 = cl(bb[1], H), y1 = cl(bb[3], H);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) f(x * 100003 + y);
  };
  const maxOrd = (bb) => {
    let m = -1;
    for (const e of infs) if (e.ord > m) m = e.ord;
    each(bb.bb, (k) => { const L = grid.get(k); if (L) for (const e of L) if (e.ord > m && overlap(e.sh, bb)) m = e.ord; });
    return m;
  };
  const record = (bb, ord) => {
    if (!bb) { infs.push({ ord }); return; }
    const e = { sh: bb, ord };
    each(bb.bb, (k) => { const L = grid.get(k); if (L) L.push(e); else grid.set(k, [e]); });
  };
  for (const [n, bb] of list) {
    const key = n.type === 'path' && !n.props.fillRule ? n.props.fill + '|' + (n.props.opacity ?? 1) + '|' + JSON.stringify(n.props.surface) : null;
    const g = key && latest.get(key);
    if (g && bb && maxOrd(bb) < g.ord) { g.node.props.d += n.props.d; record(bb, g.ord); continue; }
    const ng = { node: n, ord: out.length };
    out.push(ng);
    if (key) latest.set(key, ng);
    record(bb, ng.ord);
  }
  return out.map((g) => g.node);
}

/** Ближняя глубина элемента (min Z по точкам примитивов; нет точек — ключ). */
function nearZ(it) {
  let z = Infinity;
  for (const p of it.prims) {
    if (p.ps) for (const q of p.ps) { if (q[2] < z) z = q[2]; }
    else if (p.t === 'line') z = Math.min(z, p.a[2], p.b[2]);
    else if (p.t === 'img') z = Math.min(z, p.Z);
    else if (p.at) z = Math.min(z, p.at[2]);
  }
  return Number.isFinite(z) ? z : it.key;
}
