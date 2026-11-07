// Геометрия для редактора: точки контура (якоря и рычаги), разбиение сегмента, кости.
import { K, E, getVal, screenM, kidsOf, node, applyPt } from './core.js';

const hasOwnPath = (n) => !!(n.keys?.d?.length || n.props?.d != null || n.keys?.shape?.length || n.props?.shape != null);
/** У узла есть контур, который можно править по точкам (или фигура, которую можно в него превратить). */
export const isPathLike = (n) => !!n && (hasOwnPath(n) || ['rect', 'ellipse', 'circle', 'polygon', 'star', 'line', 'path'].includes(n.type));
export const pathKey = (n) => (n.keys?.d?.length ? 'd' : n.keys?.shape?.length ? 'shape' : n.props?.d != null ? 'd' : n.props?.shape != null ? 'shape' : null);

/** Геометрия узла в момент плейхеда (в локальных координатах). */
export function geomOf(n) {
  const k = pathKey(n);
  if (k) return K.toGeom(getVal(n, k), E.t);
  const g = (p) => getVal(n, p);
  switch (n.type) {
    case 'rect': return K.toGeom({ shape: 'rect', width: g('width'), height: g('height'), radius: g('radius') });
    case 'ellipse': case 'circle': { const r = n.props?.r != null || n.keys?.r ? g('r') : null; return K.toGeom({ shape: 'ellipse', rx: r ?? g('rx'), ry: r ?? g('ry') }); }
    case 'polygon': return K.toGeom({ shape: 'polygon', sides: Math.round(g('sides')), radius: g('radius') || 50, cornerRadius: g('cornerRadius') });
    case 'star': return K.toGeom({ shape: 'star', points: Math.round(g('points')), outerRadius: g('outerRadius'), innerRadius: g('innerRadius'), cornerRadius: g('cornerRadius') });
    case 'line': return K.toGeom({ shape: 'line', x1: g('x1'), y1: g('y1'), x2: g('x2'), y2: g('y2') });
    case 'path': return n.props?.points ? K.toGeom({ points: g('points'), smooth: g('smooth'), closed: g('closed') }) : [];
  }
  return [];
}

const near = (a, b, e = 1e-3) => Math.abs(a - b) < e;
/** Контур → якоря с рычагами {x, y, i:[x,y], o:[x,y]}; прямые сегменты получают «сложенные» рычаги. */
export function toPts(geom) {
  return geom.map((sp) => {
    const pts = [{ x: sp.x0, y: sp.y0, i: [sp.x0, sp.y0], o: [sp.x0, sp.y0] }];
    for (const s of sp.segs) {
      const a = pts[pts.length - 1];
      const straight = near(s[0], a.x + (s[4] - a.x) / 3) && near(s[1], a.y + (s[5] - a.y) / 3) && near(s[2], a.x + (2 * (s[4] - a.x)) / 3) && near(s[3], a.y + (2 * (s[5] - a.y)) / 3);
      a.o = straight ? [a.x, a.y] : [s[0], s[1]];
      pts.push({ x: s[4], y: s[5], i: straight ? [s[4], s[5]] : [s[2], s[3]], o: [s[4], s[5]] });
    }
    if (sp.closed && pts.length > 1) { const last = pts.pop(); pts[0].i = last.i; }
    return { closed: !!sp.closed, pts };
  });
}
export function fromPts(subs) {
  return subs.filter((s) => s.pts.length).map((s) => {
    const P = s.pts, segs = [];
    for (let k = 0; k < P.length - 1; k++) segs.push([...P[k].o, ...P[k + 1].i, P[k + 1].x, P[k + 1].y]);
    const closed = s.closed && P.length > 1;
    if (closed) { const a = P[P.length - 1], b = P[0]; segs.push([...a.o, ...b.i, b.x, b.y]); }
    return { x0: P[0].x, y0: P[0].y, segs, closed };
  }).filter((s) => s.segs.length);
}
export const clonePts = (subs) => subs.map((s) => ({ closed: s.closed, pts: s.pts.map((p) => ({ x: p.x, y: p.y, i: [...p.i], o: [...p.o] })) }));
export const isCorner = (p) => near(p.i[0], p.x) && near(p.i[1], p.y) && near(p.o[0], p.x) && near(p.o[1], p.y);
/** Рычаги на одной прямой — точка «гладкая», второй рычаг следует за первым. */
export function isSmooth(p) {
  const ax = p.i[0] - p.x, ay = p.i[1] - p.y, bx = p.o[0] - p.x, by = p.o[1] - p.y;
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  if (la < 1e-3 || lb < 1e-3) return false;
  return (ax * bx + ay * by) / (la * lb) < -0.995;
}
/** Угол ↔ гладкая точка. */
export function toggleSmooth(sub, k) {
  const P = sub.pts, p = P[k];
  if (!isCorner(p)) { p.i = [p.x, p.y]; p.o = [p.x, p.y]; return; }
  const n = P.length, prev = P[k - 1] || (sub.closed ? P[n - 1] : null), next = P[k + 1] || (sub.closed ? P[0] : null);
  const a = prev || p, b = next || p;
  let dx = b.x - a.x, dy = b.y - a.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
  const lp = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) / 3 : 0, ln = next ? Math.hypot(next.x - p.x, next.y - p.y) / 3 : 0;
  p.i = [p.x - dx * lp, p.y - dy * lp]; p.o = [p.x + dx * ln, p.y + dy * ln];
}
const lerp2 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
/** Вставить точку в сегмент k (от якоря k к следующему) на доле u (де Кастельжо). */
export function splitSeg(sub, k, u) {
  const P = sub.pts, a = P[k], b = P[(k + 1) % P.length];
  const p0 = [a.x, a.y], p1 = a.o, p2 = b.i, p3 = [b.x, b.y];
  const q0 = lerp2(p0, p1, u), q1 = lerp2(p1, p2, u), q2 = lerp2(p2, p3, u);
  const r0 = lerp2(q0, q1, u), r1 = lerp2(q1, q2, u), s = lerp2(r0, r1, u);
  a.o = q0; b.i = q2;
  P.splice(k + 1, 0, { x: s[0], y: s[1], i: r0, o: r1 });
}
const bez = (p0, p1, p2, p3, u) => { const v = 1 - u; return [v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0], v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1]]; };
/** Ближайшая к точке экрана позиция на контуре: {si, k, u, d} (матрица m — локальные → экран). */
export function nearestOnPath(subs, m, sx, sy) {
  let best = null;
  subs.forEach((s, si) => {
    const P = s.pts, n = s.closed ? P.length : P.length - 1;
    for (let k = 0; k < n; k++) {
      const a = P[k], b = P[(k + 1) % P.length];
      for (let j = 1; j < 40; j++) {
        const u = j / 40, q = applyPt(m, bez([a.x, a.y], a.o, b.i, [b.x, b.y], u)), d = Math.hypot(q[0] - sx, q[1] - sy);
        if (!best || d < best.d) best = { si, k, u, d };
      }
    }
  });
  return best;
}

/** Сустав и конец кости в пикселях холста. */
export function boneEnds(id) {
  const n = node(id), m = screenM(id);
  const ax = getVal(n, 'anchorX'), ay = getVal(n, 'anchorY');
  let tip;
  const len = getVal(n, 'boneLength');
  if (len > 0) tip = [ax + len, ay];
  else { const c = kidsOf(id).find((x) => x.props?.bone); tip = c ? [getVal(c, 'x'), getVal(c, 'y')] : [ax + 30, ay]; }
  return { joint: applyPt(m, [ax, ay]), tip: applyPt(m, tip) };
}
