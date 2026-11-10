/** Геометрия: разбор путей, фигуры, морфинг, измерение, деформация.
 * Геометрия = массив подпутей { x0, y0, segs: [[c1x,c1y,c2x,c2y,x,y], ...], closed } */
import { DEG, TAU, clamp, lerp, noise3, num3 } from './math.js';

export const lineSeg = (x0, y0, x, y) => [x0 + (x - x0) / 3, y0 + (y - y0) / 3, x0 + (2 * (x - x0)) / 3, y0 + (2 * (y - y0)) / 3, x, y];

export function arcToCubics(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  if (rx === 0 || ry === 0) return [lineSeg(x1, y1, x2, y2)];
  const sinp = Math.sin(phi * DEG), cosp = Math.cos(phi * DEG);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cosp * dx + sinp * dy, yp = -sinp * dx + cosp * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  let co = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) co = -co;
  const cxp = (co * rx * yp) / ry, cyp = (-co * ry * xp) / rx;
  const cx = cosp * cxp - sinp * cyp + (x1 + x2) / 2;
  const cy = sinp * cxp + cosp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!fs && dt > 0) dt -= TAU;
  if (fs && dt < 0) dt += TAU;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const d = dt / n, k = (4 / 3) * Math.tan(d / 4);
  const out = [];
  let a = t1;
  const pt = (t) => [cx + rx * Math.cos(t) * cosp - ry * Math.sin(t) * sinp, cy + rx * Math.cos(t) * sinp + ry * Math.sin(t) * cosp];
  const dv = (t) => [-rx * Math.sin(t) * cosp - ry * Math.cos(t) * sinp, -rx * Math.sin(t) * sinp + ry * Math.cos(t) * cosp];
  for (let i = 0; i < n; i++) {
    const b = a + d;
    const p0 = pt(a), p1 = pt(b), d0 = dv(a), d1 = dv(b);
    out.push([p0[0] + k * d0[0], p0[1] + k * d0[1], p1[0] - k * d1[0], p1[1] - k * d1[1], p1[0], p1[1]]);
    a = b;
  }
  const last = out[out.length - 1]; last[4] = x2; last[5] = y2;
  return out;
}

export const pathCache = new Map();
/** Разбор SVG path d → геометрия. Поддерживает M L H V C S Q T A Z (абс./отн.). */
export function parsePath(d) {
  if (pathCache.has(d)) return pathCache.get(d);
  const toks = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) || [];
  let i = 0;
  const subs = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = '', prevC = null, prevQ = null;
  const num = () => {
    const t = toks[i++];
    if (t === undefined || /[a-z]/i.test(t)) throw new Error(`Ошибка разбора пути около «${t}»`);
    return parseFloat(t);
  };
  const flag = () => {
    const t = toks[i];
    if (t.length > 1 && (t[0] === '0' || t[0] === '1')) { toks[i] = t.slice(1); return t[0] === '1'; }
    i++; return t === '1';
  };
  const ensure = () => { if (!cur) { cur = { x0: x, y0: y, segs: [], closed: false }; subs.push(cur); } };
  while (i < toks.length) {
    if (/[a-z]/i.test(toks[i])) cmd = toks[i++];
    else if (!cmd) throw new Error('Путь должен начинаться с команды');
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z' ? 1 : 0;
    const C = cmd.toUpperCase();
    let nextC = null, nextQ = null;
    switch (C) {
      case 'M': {
        x = num() + rel * x; y = num() + rel * y;
        cur = { x0: x, y0: y, segs: [], closed: false }; subs.push(cur); sx = x; sy = y;
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L': { ensure(); const nx = num() + rel * x, ny = num() + rel * y; cur.segs.push(lineSeg(x, y, nx, ny)); x = nx; y = ny; break; }
      case 'H': { ensure(); const nx = num() + rel * x; cur.segs.push(lineSeg(x, y, nx, y)); x = nx; break; }
      case 'V': { ensure(); const ny = num() + rel * y; cur.segs.push(lineSeg(x, y, x, ny)); y = ny; break; }
      case 'C': {
        ensure();
        const a = num() + rel * x, b = num() + rel * y, c = num() + rel * x, e = num() + rel * y, nx = num() + rel * x, ny = num() + rel * y;
        cur.segs.push([a, b, c, e, nx, ny]); nextC = [c, e]; x = nx; y = ny; break;
      }
      case 'S': {
        ensure();
        const a = prevC ? 2 * x - prevC[0] : x, b = prevC ? 2 * y - prevC[1] : y;
        const c = num() + rel * x, e = num() + rel * y, nx = num() + rel * x, ny = num() + rel * y;
        cur.segs.push([a, b, c, e, nx, ny]); nextC = [c, e]; x = nx; y = ny; break;
      }
      case 'Q': case 'T': {
        ensure();
        let qx, qy;
        if (C === 'Q') { qx = num() + rel * x; qy = num() + rel * y; }
        else { qx = prevQ ? 2 * x - prevQ[0] : x; qy = prevQ ? 2 * y - prevQ[1] : y; }
        const nx = num() + rel * x, ny = num() + rel * y;
        cur.segs.push([x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny]);
        nextQ = [qx, qy]; x = nx; y = ny; break;
      }
      case 'A': {
        ensure();
        const rx = num(), ry = num(), phi = num(), fa = flag(), fs = flag();
        const nx = num() + rel * x, ny = num() + rel * y;
        cur.segs.push(...arcToCubics(x, y, rx, ry, phi, fa, fs, nx, ny)); x = nx; y = ny; break;
      }
      case 'Z': {
        if (cur) {
          if (Math.hypot(x - cur.x0, y - cur.y0) > 1e-9) cur.segs.push(lineSeg(x, y, cur.x0, cur.y0));
          cur.closed = true;
        }
        x = sx; y = sy; cur = null; break;
      }
      default: throw new Error(`Неизвестная команда пути ${cmd}`);
    }
    prevC = nextC; prevQ = nextQ;
  }
  const out = subs.filter((s) => s.segs.length > 0);
  if (pathCache.size > 1000) pathCache.clear();
  pathCache.set(d, out);
  return out;
}

export function geomToPath(g) {
  let s = '';
  for (const sp of g) {
    s += 'M' + num3(sp.x0) + ' ' + num3(sp.y0);
    for (const c of sp.segs) s += 'C' + num3(c[0]) + ' ' + num3(c[1]) + ' ' + num3(c[2]) + ' ' + num3(c[3]) + ' ' + num3(c[4]) + ' ' + num3(c[5]);
    if (sp.closed) s += 'Z';
  }
  return s;
}

export const K = 0.5522847498;
export function ellipseGeom(rx, ry) {
  return [{ x0: rx, y0: 0, closed: true, segs: [
    [rx, K * ry, K * rx, ry, 0, ry], [-K * rx, ry, -rx, K * ry, -rx, 0],
    [-rx, -K * ry, -K * rx, -ry, 0, -ry], [K * rx, -ry, rx, -K * ry, rx, 0],
  ] }];
}
export function polyGeom(pts, closed = true) {
  const segs = [];
  for (let i = 1; i < pts.length; i++) segs.push(lineSeg(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  if (closed && pts.length > 2) segs.push(lineSeg(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]));
  return [{ x0: pts[0][0], y0: pts[0][1], segs, closed }];
}
/** Гладкая кривая через точки (Catmull-Rom → кубики). tension 0..1 (1 = обычный CR). */
export function smoothGeom(pts, closed = true, tension = 1) {
  const n = pts.length, segs = [];
  if (n < 2) return [{ x0: pts[0]?.[0] || 0, y0: pts[0]?.[1] || 0, segs: [], closed: false }];
  const P = (i) => (closed ? pts[((i % n) + n) % n] : pts[clamp(i, 0, n - 1)]);
  const last = closed ? n : n - 1, k = tension / 6;
  for (let i = 0; i < last; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    segs.push([p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k, p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k, p2[0], p2[1]]);
  }
  return [{ x0: pts[0][0], y0: pts[0][1], segs, closed }];
}
export function rectGeom(w, h, r = 0) {
  const x = -w / 2, y = -h / 2;
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r < 1e-6) return polyGeom([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
  const k = r * (1 - K), segs = [];
  let px = x + r, py = y;
  const L = (nx, ny) => { segs.push(lineSeg(px, py, nx, ny)); px = nx; py = ny; };
  const A = (a, b, c, d, nx, ny) => { segs.push([a, b, c, d, nx, ny]); px = nx; py = ny; };
  L(x + w - r, y); A(x + w - k, y, x + w, y + k, x + w, y + r);
  L(x + w, y + h - r); A(x + w, y + h - k, x + w - k, y + h, x + w - r, y + h);
  L(x + r, y + h); A(x + k, y + h, x, y + h - k, x, y + h - r);
  L(x, y + r); A(x, y + k, x + k, y, x + r, y);
  return [{ x0: x + r, y0: y, segs, closed: true }];
}
export function regularPts(n, r, rInner = null, rotation = 0) {
  const pts = [], count = rInner == null ? n : n * 2;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + rotation * DEG + (i * TAU) / count;
    const rr = rInner == null || i % 2 === 0 ? r : rInner;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return pts;
}
/** Сглаживает углы многоугольника дугами радиуса rad. */
export function roundedPoly(pts, rad) {
  if (!rad) return polyGeom(pts);
  const n = pts.length, segs = [];
  const corners = pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const r = Math.min(rad, da / 2, db / 2);
    const ia = [p[0] + ((a[0] - p[0]) * r) / da, p[1] + ((a[1] - p[1]) * r) / da];
    const ib = [p[0] + ((b[0] - p[0]) * r) / db, p[1] + ((b[1] - p[1]) * r) / db];
    return { p, ia, ib };
  });
  for (let i = 0; i < n; i++) {
    const c = corners[i], nx = corners[(i + 1) % n];
    segs.push([c.ia[0] + (c.p[0] - c.ia[0]) * K, c.ia[1] + (c.p[1] - c.ia[1]) * K, c.ib[0] + (c.p[0] - c.ib[0]) * K, c.ib[1] + (c.p[1] - c.ib[1]) * K, c.ib[0], c.ib[1]]);
    segs.push(lineSeg(c.ib[0], c.ib[1], nx.ia[0], nx.ia[1]));
  }
  return [{ x0: corners[0].ia[0], y0: corners[0].ia[1], segs, closed: true }];
}
export function blobGeom(p, t) {
  const n = Math.max(3, Math.round(p.points ?? 8)), pts = [];
  const R = p.radius ?? 80, amt = p.amount ?? 0.25, fr = p.frequency ?? 1.2, sp = p.speed ?? 0.5, seed = p.seed ?? 1;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const nz = noise3(Math.cos(a) * fr + 10, Math.sin(a) * fr + 10, t * sp, seed);
    const r = R * (1 + amt * nz);
    pts.push([Math.cos(a) * r * (p.stretchX ?? 1), Math.sin(a) * r * (p.stretchY ?? 1)]);
  }
  return smoothGeom(pts, true, p.tension ?? 1);
}

/**
 * Описание фигуры → геометрия. Принимает:
 *   строку path d; {shape:'rect'|'ellipse'|'circle'|'polygon'|'star'|'line'|'blob'|'heart', ...};
 *   {points:[[x,y],...], closed, smooth}; уже готовую геометрию {geom:[...]}.
 */
export function toGeom(v, t = 0) {
  if (v == null) return [];
  if (typeof v === 'string') return parsePath(v);
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === 'object' && 'segs' in v[0]) return v;
    if (v.length && Array.isArray(v[0])) return polyGeom(v, true);
    return [];
  }
  if (v.geom) return v.geom;
  if (v.points && Array.isArray(v.points)) {
    const closed = v.closed !== false;
    return v.smooth ? smoothGeom(v.points, closed, v.tension ?? 1) : polyGeom(v.points, closed);
  }
  const s = v.shape;
  const g = (() => {
    switch (s) {
      case 'rect': return rectGeom(v.width ?? 100, v.height ?? 100, v.radius ?? 0);
      case 'circle': return ellipseGeom(v.r ?? v.radius ?? 50, v.r ?? v.radius ?? 50);
      case 'ellipse': return ellipseGeom(v.rx ?? v.r ?? 50, v.ry ?? v.r ?? 50);
      case 'polygon': return roundedPoly(regularPts(v.sides ?? 6, v.radius ?? 50, null, v.rotation ?? 0), v.cornerRadius ?? 0);
      case 'star': return roundedPoly(regularPts(v.points ?? 5, v.outerRadius ?? v.radius ?? 50, v.innerRadius ?? (v.outerRadius ?? v.radius ?? 50) * 0.45, v.rotation ?? 0), v.cornerRadius ?? 0);
      case 'line': return polyGeom([[v.x1 ?? 0, v.y1 ?? 0], [v.x2 ?? 100, v.y2 ?? 0]], false);
      case 'blob': return blobGeom(v, v.time ?? t);
      case 'heart': {
        const r = (v.size ?? 100) / 100;
        return parsePath('M0 30C-25 10-50 0-50-22C-50-42-34-55-18-55C-6-55 0-46 0-40C0-46 6-55 18-55C34-55 50-42 50-22C50 0 25 10 0 30Z')
          .map((sp) => ({ ...sp, x0: sp.x0 * r, y0: sp.y0 * r, segs: sp.segs.map((c) => c.map((q) => q * r)) }));
      }
      default: throw new Error(`Неизвестная фигура: ${s}`);
    }
  })();
  if (v.x || v.y) return translateGeom(g, v.x || 0, v.y || 0);
  return g;
}
export function translateGeom(g, dx, dy) {
  return g.map((sp) => ({ ...sp, x0: sp.x0 + dx, y0: sp.y0 + dy, segs: sp.segs.map((c) => [c[0] + dx, c[1] + dy, c[2] + dx, c[3] + dy, c[4] + dx, c[5] + dy]) }));
}

export function splitSeg(x0, y0, c, u = 0.5) {
  const [x1, y1, x2, y2, x3, y3] = c;
  const ax = lerp(x0, x1, u), ay = lerp(y0, y1, u), bx = lerp(x1, x2, u), by = lerp(y1, y2, u), cx = lerp(x2, x3, u), cy = lerp(y2, y3, u);
  const dx = lerp(ax, bx, u), dy = lerp(ay, by, u), ex = lerp(bx, cx, u), ey = lerp(by, cy, u);
  const fx = lerp(dx, ex, u), fy = lerp(dy, ey, u);
  return [[ax, ay, dx, dy, fx, fy], [ex, ey, cx, cy, x3, y3]];
}
export const segStart = (sp, i) => (i === 0 ? [sp.x0, sp.y0] : [sp.segs[i - 1][4], sp.segs[i - 1][5]]);
export function segLenEst(x0, y0, c) {
  const chord = Math.hypot(c[4] - x0, c[5] - y0);
  const net = Math.hypot(c[0] - x0, c[1] - y0) + Math.hypot(c[2] - c[0], c[3] - c[1]) + Math.hypot(c[4] - c[2], c[5] - c[3]);
  return (chord + net) / 2;
}
export function subdivideTo(sp, n) {
  sp = { ...sp, segs: sp.segs.map((s) => s.slice()) };
  if (sp.segs.length === 0) {
    sp.segs.push([sp.x0, sp.y0, sp.x0, sp.y0, sp.x0, sp.y0]);
  }
  while (sp.segs.length < n) {
    let best = 0, bl = -1;
    for (let i = 0; i < sp.segs.length; i++) {
      const [x0, y0] = segStart(sp, i);
      const l = segLenEst(x0, y0, sp.segs[i]);
      if (l > bl) { bl = l; best = i; }
    }
    const [x0, y0] = segStart(sp, best);
    sp.segs.splice(best, 1, ...splitSeg(x0, y0, sp.segs[best]));
  }
  return sp;
}
export function signedArea(sp) {
  let a = 0, px = sp.x0, py = sp.y0;
  for (const c of sp.segs) { a += px * c[5] - c[4] * py; px = c[4]; py = c[5]; }
  return a / 2;
}
export function reverseSub(sp) {
  const n = sp.segs.length;
  if (!n) return sp;
  const segs = [];
  for (let i = n - 1; i >= 0; i--) {
    const c = sp.segs[i], [sx, sy] = segStart(sp, i);
    segs.push([c[2], c[3], c[0], c[1], sx, sy]);
  }
  return { ...sp, x0: sp.segs[n - 1][4], y0: sp.segs[n - 1][5], segs };
}
export function rotateSub(sp, k) {
  if (!k) return sp;
  const segs = sp.segs.slice(k).concat(sp.segs.slice(0, k));
  const [x0, y0] = segStart(sp, k);
  return { ...sp, x0, y0, segs };
}
export function centroid(sp) {
  let x = sp.x0, y = sp.y0, n = 1;
  for (const c of sp.segs) { x += c[4]; y += c[5]; n++; }
  return [x / n, y / n];
}
export function pairSubpaths(a, b) {
  if (a.closed && b.closed && Math.sign(signedArea(a)) !== Math.sign(signedArea(b))) b = reverseSub(b);
  const n = Math.max(a.segs.length, b.segs.length, 1);
  a = subdivideTo(a, n); b = subdivideTo(b, n);
  if (a.closed && b.closed) {
    let bestK = 0, best = Infinity;
    const an = a.segs.map((_, i) => segStart(a, i));
    const bn = b.segs.map((_, i) => segStart(b, i));
    for (let k = 0; k < n; k++) {
      let cost = 0;
      for (let j = 0; j < n && cost < best; j++) {
        const p = an[j], q = bn[(j + k) % n];
        cost += (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
      }
      if (cost < best) { best = cost; bestK = k; }
    }
    b = rotateSub(b, bestK);
  }
  return [a, b];
}
export const morphCache = new Map();
/** Готовит две геометрии к попарной интерполяции (одинаковое число сегментов, выравнивание старта). */
export function prepareMorph(ga, gb, key) {
  if (key && morphCache.has(key)) return morphCache.get(key);
  const n = Math.max(ga.length, gb.length);
  // большие подпути сопоставляем с большими
  const sortBy = (g) => g.map((sp, i) => ({ sp, i, a: Math.abs(signedArea(sp)) }));
  const A = sortBy(ga), B = sortBy(gb);
  const pairs = [];
  for (let i = 0; i < n; i++) {
    let a = A[i]?.sp, b = B[i]?.sp;
    if (!a) { const [cx, cy] = centroid(b); a = { x0: cx, y0: cy, segs: b.segs.map(() => [cx, cy, cx, cy, cx, cy]), closed: b.closed }; }
    if (!b) { const [cx, cy] = centroid(a); b = { x0: cx, y0: cy, segs: a.segs.map(() => [cx, cy, cx, cy, cx, cy]), closed: a.closed }; }
    pairs.push(pairSubpaths(a, b));
  }
  if (key) { if (morphCache.size > 500) morphCache.clear(); morphCache.set(key, pairs); }
  return pairs;
}
export function lerpGeom(pairs, u) {
  return pairs.map(([a, b]) => ({
    x0: lerp(a.x0, b.x0, u), y0: lerp(a.y0, b.y0, u),
    closed: u < 0.5 ? a.closed : b.closed,
    segs: a.segs.map((c, i) => c.map((q, j) => lerp(q, b.segs[i][j], u))),
  }));
}
/** Морфинг между двумя любыми фигурами/путями. */
export function morph(a, b, u) {
  const ga = toGeom(a), gb = toGeom(b);
  const key = typeof a === 'string' || typeof b === 'string' || (a && a.shape !== 'blob' && b && b.shape !== 'blob') ? JSON.stringify([a, b]) : null;
  return lerpGeom(prepareMorph(ga, gb, key), u);
}

export function cubicPt(x0, y0, c, t) {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, d = 3 * mt * t * t, e = t * t * t;
  return [a * x0 + b * c[0] + d * c[2] + e * c[4], a * y0 + b * c[1] + d * c[3] + e * c[5]];
}
/** Ломаная аппроксимация для измерения длины и движения вдоль пути. */
export function measureGeom(g, steps = 16) {
  const pts = [];
  let len = 0;
  for (const sp of g) {
    let px = sp.x0, py = sp.y0, first = true;
    for (const c of sp.segs) {
      const [x0, y0] = [px, py];
      for (let s = first ? 0 : 1; s <= steps; s++) {
        const [x, y] = cubicPt(x0, y0, c, s / steps);
        if (pts.length) len += Math.hypot(x - pts[pts.length - 1][0], y - pts[pts.length - 1][1]);
        pts.push([x, y, len]);
      }
      first = false; px = c[4]; py = c[5];
    }
  }
  return { pts, length: len };
}
export function pointAtFraction(m, f) {
  const { pts, length } = m;
  if (!pts.length) return { x: 0, y: 0, angle: 0 };
  const target = clamp(f) * length;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][2] < target) lo = mid; else hi = mid; }
  const a = pts[lo], b = pts[hi];
  const seg = b[2] - a[2] || 1, u = (target - a[2]) / seg;
  return { x: lerp(a[0], b[0], u), y: lerp(a[1], b[1], u), angle: Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG };
}

/**
 * Процедурная деформация шумом. Узлы смещаются полем шума, а управляющие точки
 * преобразуются локальной линеаризацией поля (якобиан) — гладкость кривой сохраняется.
 */
export function deformGeom(g, { amount = 10, scale = 0.01, speed = 0.5, seed = 0, detail = 0 }, t) {
  const z = t * speed;
  const field = (x, y) => [noise3(x * scale, y * scale, z, seed) * amount, noise3(x * scale + 31.7, y * scale - 12.3, z, seed + 7) * amount];
  const h = 0.5;
  const at = (ax, ay) => {
    const o = field(ax, ay), fx = field(ax + h, ay), fy = field(ax, ay + h);
    const J = [(fx[0] - o[0]) / h, (fy[0] - o[0]) / h, (fx[1] - o[1]) / h, (fy[1] - o[1]) / h];
    return { ax, ay, o, J };
  };
  const move = (A, px, py) => {
    const dx = px - A.ax, dy = py - A.ay;
    return [px + A.o[0] + A.J[0] * dx + A.J[1] * dy, py + A.o[1] + A.J[2] * dx + A.J[3] * dy];
  };
  return g.map((sp) => {
    const s = detail ? subdivideTo(sp, Math.max(detail, sp.segs.length)) : sp;
    const A0 = at(s.x0, s.y0);
    let prev = A0;
    const segs = s.segs.map((c, i) => {
      const closesLoop = i === s.segs.length - 1 && s.closed && Math.hypot(c[4] - s.x0, c[5] - s.y0) < 1e-6;
      const A1 = closesLoop ? A0 : at(c[4], c[5]);
      const p1 = move(prev, c[0], c[1]), p2 = move(A1, c[2], c[3]), p3 = move(A1, c[4], c[5]);
      prev = A1;
      return [p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]];
    });
    return { ...s, x0: s.x0 + A0.o[0], y0: s.y0 + A0.o[1], segs };
  });
}

/** Габариты геометрии по опорным точкам (для отбрасывания вырожденных фигур). */
export function geomBox(geom) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sp of geom) {
    if (sp.x0 < x0) x0 = sp.x0; if (sp.x0 > x1) x1 = sp.x0; if (sp.y0 < y0) y0 = sp.y0; if (sp.y0 > y1) y1 = sp.y0;
    for (const c of sp.segs) for (let i = 0; i < 6; i += 2) { if (c[i] < x0) x0 = c[i]; if (c[i] > x1) x1 = c[i]; if (c[i + 1] < y0) y0 = c[i + 1]; if (c[i + 1] > y1) y1 = c[i + 1]; }
  }
  return Number.isFinite(x0) ? [x1 - x0, y1 - y0] : [0, 0];
}
