// Слой подсказок поверх холста: рамки, ручки, точки контура, кости, свет, цели IK, направляющие.
import { E, on, node, getVal, screenM, applyPt, isLocked } from './core.js';
import { ovSvg, cornersOf, selAABB } from './view.js';
import { geomOf, toPts, isCorner, boneEnds } from './geom.js';
import { html, setHTML } from './html.js';

const A = '#9ea8ff', KEY = '#ffc46b';
let raf = 0;
export function requestOverlay() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
on('frame preview sel view scene tool overlay', requestOverlay);

const f = (v) => (Math.round(v * 10) / 10).toString();
const poly = (pts, attrs) => html`<polygon points="${pts.map((p) => f(p[0]) + ',' + f(p[1])).join(' ')}" ${attrs}/>`;
const line = (a, b, attrs) => html`<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" ${attrs}/>`;
const circ = (p, r, attrs) => html`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${r}" ${attrs}/>`;
const sq = (p, s, attrs) => html`<rect x="${f(p[0] - s / 2)}" y="${f(p[1] - s / 2)}" width="${s}" height="${s}" ${attrs}/>`;
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const ROT = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22'%3E%3Cpath d='M5 13a7 7 0 1 0 2-6' fill='none' stroke='white' stroke-width='3.5'/%3E%3Cpath d='M5 13a7 7 0 1 0 2-6' fill='none' stroke='black' stroke-width='1.6'/%3E%3Cpath d='M3 3v6h6' fill='none' stroke='black' stroke-width='1.6'/%3E%3C/svg%3E") 11 11, crosshair`;
/** Курсор ручки масштаба по её направлению на экране. */
function resizeCursor(c, p) {
  const a = ((Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI + 360) % 180;
  return a < 22.5 || a >= 157.5 ? 'ew-resize' : a < 67.5 ? 'nwse-resize' : a < 112.5 ? 'ns-resize' : 'nesw-resize';
}
const HN = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
function handles(out, c4, big) {
  const [nw, ne, se, sw] = c4;
  const P = { nw, n: mid(nw, ne), ne, e: mid(ne, se), se, s: mid(se, sw), sw, w: mid(sw, nw) };
  const C = mid(nw, se);
  for (const h of ['nw', 'ne', 'se', 'sw']) {
    const p = P[h], d = [p[0] - C[0], p[1] - C[1]], L = Math.hypot(...d) || 1;
    out.push(circ([p[0] + (d[0] / L) * 10, p[1] + (d[1] / L) * 10], 11, html`class="hit" data-h="r:${h}" fill="transparent" style="cursor:${ROT}"`));
  }
  for (const h of HN) {
    if (!big && h.length === 1) continue;
    out.push(sq(P[h], 8, html`class="hit" data-h="s:${h}" fill="#fff" stroke="${A}" stroke-width="1.2" style="cursor:${resizeCursor(C, P[h])}"`));
  }
}

function draw() {
  const out = [];
  if (E.showBones) rig(out);
  if (E.hover && !E.sel.includes(E.hover) && (E.tool === 'select' || E.tool === 'direct')) {
    const c = cornersOf(E.hover);
    if (c) out.push(poly(c, html`fill="none" stroke="${A}" stroke-width="1" opacity=".75"`));
  }
  if (E.tool === 'direct') paths(out);
  else selection(out);
  if (E.pen) pen(out);
  if (E.pencil?.length > 1) out.push(html`<polyline points="${E.pencil.map((p) => f(p[0]) + ',' + f(p[1])).join(' ')}" fill="none" stroke="${E.stroke}" stroke-width="2"/>`);
  for (const g of E.guides) out.push(line([g[0], g[1]], [g[2], g[3]], 'stroke="#ff5fd2" stroke-width="1"'));
  if (E.marquee) {
    const [x0, y0, x1, y1] = E.marquee;
    out.push(html`<rect x="${f(Math.min(x0, x1))}" y="${f(Math.min(y0, y1))}" width="${f(Math.abs(x1 - x0))}" height="${f(Math.abs(y1 - y0))}" fill="rgba(158,168,255,.08)" stroke="${A}" stroke-dasharray="4 3"/>`);
  }
  setHTML(ovSvg, out);
}

function selection(out) {
  const ids = E.sel.filter((id) => node(id));
  if (!ids.length) return;
  if (ids.length === 1) {
    const id = ids[0], n = node(id), c = cornersOf(id);
    const m = screenM(id), pv = applyPt(m, [getVal(n, 'anchorX'), getVal(n, 'anchorY')]);
    if (c) {
      out.push(poly(c, html`fill="none" stroke="${A}" stroke-width="1.4"`));
      if (!isLocked(id)) {
        const big = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) > 26 && Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]) > 26;
        handles(out, c, big);
      }
    }
    // Опора — только у объектов с рамкой: у пустых групп, костей и целей IK точка «опоры» и есть их положение,
    // там тянуть надо сам объект (иначе ручка опоры перекрывает крестик цели и сустав).
    if (c && !isLocked(id) && n.type !== 'light' && !E.scene.nodes.some((x) => x.props?.ik?.target === id)) {
      out.push(circ(pv, 6, html`class="hit" data-h="pivot" fill="rgba(14,16,23,.6)" stroke="#fff" stroke-width="1.4" style="cursor:move"`));
      out.push(line([pv[0] - 4, pv[1]], [pv[0] + 4, pv[1]], 'stroke="#fff" stroke-width="1.2"') + line([pv[0], pv[1] - 4], [pv[0], pv[1] + 4], 'stroke="#fff" stroke-width="1.2"'));
    }
    return;
  }
  for (const id of ids) { const c = cornersOf(id); if (c) out.push(poly(c, html`fill="none" stroke="${A}" stroke-width="1" opacity=".8"`)); }
  const b = selAABB(ids);
  if (!b) return;
  const c4 = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
  out.push(poly(c4, html`fill="none" stroke="${A}" stroke-width="1.4" stroke-dasharray="5 3"`));
  handles(out, c4, b[2] - b[0] > 26 && b[3] - b[1] > 26);
}

/** Точки контура выбранных объектов (инструмент «Точки»). */
function paths(out) {
  for (const id of E.sel.slice(0, 6)) {
    const n = node(id);
    if (!n || n.type === 'group' || n.type === 'image' || n.type === 'text' || n.type === 'light') { const c = cornersOf(id); if (c) out.push(poly(c, html`fill="none" stroke="${A}" stroke-width="1" stroke-dasharray="3 3"`)); continue; }
    const m = screenM(id), subs = toPts(geomOf(n));
    const T = (p) => applyPt(m, p);
    let d = '';
    for (const s of subs) {
      const P = s.pts;
      d += `M${T([P[0].x, P[0].y]).map(f).join(' ')}`;
      const cnt = s.closed ? P.length : P.length - 1;
      for (let k = 0; k < cnt; k++) { const a = P[k], b = P[(k + 1) % P.length]; d += `C${[...T(a.o), ...T(b.i), ...T([b.x, b.y])].map(f).join(' ')}`; }
      if (s.closed) d += 'Z';
    }
    out.push(html`<path d="${d}" fill="none" stroke="${A}" stroke-width="1.2"/>`);
    subs.forEach((s, si) => s.pts.forEach((p, k) => {
      const key = `${id}|${si}|${k}`, on = E.anchorSel.has(key);
      const P = s.pts, nb = (j) => E.anchorSel.has(`${id}|${si}|${(j + P.length) % P.length}`);
      const show = on || nb(k - 1) || nb(k + 1);
      const a = T([p.x, p.y]);
      if (show && !isCorner(p)) {
        for (const [h, hp] of [['i', p.i], ['o', p.o]]) {
          if (Math.abs(hp[0] - p.x) < 1e-3 && Math.abs(hp[1] - p.y) < 1e-3) continue;
          if (!s.closed && ((h === 'i' && k === 0) || (h === 'o' && k === P.length - 1))) continue;
          const q = T(hp);
          out.push(line(a, q, html`stroke="${A}" stroke-width="1"`));
          out.push(circ(q, 4, html`class="hit" data-h="${h}|${key}" fill="#fff" stroke="${A}" stroke-width="1.2" style="cursor:pointer"`));
        }
      }
      out.push(sq(a, 7, html`class="hit" data-h="a|${key}" fill="${on ? A : '#fff'}" stroke="${on ? '#fff' : A}" stroke-width="1.2" style="cursor:pointer"`));
    }));
  }
}

/** Кости, источники света и цели IK. */
function rig(out) {
  for (const n of E.scene.nodes) {
    if (n.props?.bone) {
      const { joint: J, tip: T } = boneEnds(n.id), sel = E.sel.includes(n.id);
      const dx = T[0] - J[0], dy = T[1] - J[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, w = Math.min(9, Math.max(3, L * 0.12));
      const b = [J[0] + ux * L * 0.18, J[1] + uy * L * 0.18];
      out.push(poly([J, [b[0] - uy * w, b[1] + ux * w], T, [b[0] + uy * w, b[1] - ux * w]], html`class="hit" data-h="b|${n.id}" fill="${sel ? 'rgba(158,168,255,.55)' : 'rgba(158,168,255,.22)'}" stroke="${A}" stroke-width="${sel ? 1.6 : 1}" style="cursor:${ROT}"`));
      out.push(circ(J, 4, html`class="hit" data-h="j|${n.id}" fill="#151823" stroke="${A}" stroke-width="1.4" style="cursor:move"`));
    }
    if (n.type === 'light') {
      const m = screenM(n.id), p = applyPt(m, [getVal(n, 'anchorX'), getVal(n, 'anchorY')]);
      const k = Math.hypot(m[0], m[1]), r = getVal(n, 'radius') * k, col = typeof getVal(n, 'color') === 'string' ? getVal(n, 'color') : '#fff';
      const sel = E.sel.includes(n.id);
      out.push(circ(p, Math.max(4, r), html`class="hit" data-h="lr|${n.id}" fill="none" stroke="${col}" stroke-opacity="${sel ? 0.8 : 0.35}" stroke-width="1.2" stroke-dasharray="6 5" style="cursor:ew-resize;pointer-events:stroke"`));
      out.push(circ(p, 9, html`class="hit" data-h="l|${n.id}" fill="${col}" stroke="${sel ? A : '#0e1017'}" stroke-width="2" style="cursor:move"`));
      for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; out.push(line([p[0] + Math.cos(a) * 12, p[1] + Math.sin(a) * 12], [p[0] + Math.cos(a) * 16, p[1] + Math.sin(a) * 16], html`stroke="${col}" stroke-width="1.5"`)); }
    }
    const ik = n.props?.ik;
    if (ik?.target && node(ik.target)) {
      const tn = node(ik.target), tp = applyPt(screenM(tn.id), [getVal(tn, 'anchorX'), getVal(tn, 'anchorY')]);
      const ep = applyPt(screenM(n.id), [getVal(n, 'anchorX'), getVal(n, 'anchorY')]);
      out.push(line(ep, tp, html`stroke="${KEY}" stroke-width="1" stroke-dasharray="3 3"`));
      const sel = E.sel.includes(tn.id);
      out.push(circ(tp, 8, html`class="hit" data-h="t|${tn.id}" fill="rgba(255,196,107,${sel ? 0.45 : 0.15})" stroke="${KEY}" stroke-width="1.6" style="cursor:move"`));
      out.push(line([tp[0] - 12, tp[1]], [tp[0] + 12, tp[1]], html`stroke="${KEY}" stroke-width="1"`), line([tp[0], tp[1] - 12], [tp[0], tp[1] + 12], html`stroke="${KEY}" stroke-width="1"`));
    }
  }
}

function pen(out) {
  const P = E.pen, n = node(P.id);
  if (!n) return;
  const m = screenM(P.parent);
  const T = (p) => applyPt(m, p);
  P.pts.forEach((p, k) => {
    const a = T([p.x, p.y]);
    if (k === P.pts.length - 1 && !isCorner(p)) { out.push(line(T(p.i), T(p.o), html`stroke="${A}" stroke-width="1"`)); out.push(circ(T(p.o), 3.5, html`fill="#fff" stroke="${A}"`)); out.push(circ(T(p.i), 3.5, html`fill="#fff" stroke="${A}"`)); }
    out.push(k === 0 && P.pts.length > 1 ? circ(a, 6, html`class="hit" data-h="penstart" fill="${A}" stroke="#fff" stroke-width="1.4" style="cursor:pointer"`) : sq(a, 7, html`fill="#fff" stroke="${A}" stroke-width="1.2"`));
  });
  if (P.cursor && !P.drag && P.pts.length) {
    const last = P.pts[P.pts.length - 1];
    out.push(line(T(last.o), P.cursor, html`stroke="${A}" stroke-width="1" stroke-dasharray="4 3"`));
  }
}
