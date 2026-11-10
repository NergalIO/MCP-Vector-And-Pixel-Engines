// Холст: плеер, масштаб и панорама, попадание щелчком, рамки объектов, разбор событий мыши для инструментов.
import { K, E, on, emit, node, ancestors, isLocked, screenM, applyPt } from './core.js';

const $ = (id) => document.getElementById(id);
export const stage = $('stage'), canvasBox = $('canvas'), ovSvg = $('ov');
let fitted = false, pan = null, space = { down: false, used: false };

export function initView() {
  E.canvasRender = E.canvasRender ?? (/[?&]renderer=canvas/.test(location.search) || readPref('kontur.renderer') === 'canvas');
  E.player = new K.Player(canvasBox, E.scene, { autoplay: false, states: E.states, renderer: makeRenderer() });
  E.player.on((t) => { E.t = t; emit('frame'); });
  new ResizeObserver(() => (fitted ? layout() : fit())).observe(stage);
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('dblclick', (e) => E.tools[E.tool]?.dbl?.(info(e)));
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('pointerleave', () => { if (E.hover) { E.hover = null; emit('overlay'); } });
}

const readPref = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
/** Рендерер кадра: SVG в DOM (по умолчанию) или Canvas 2D. */
/**
 * Canvas в редакторе: картинку рисует CanvasRenderer, а под ним — невидимый SVG того же кадра (opacity 0):
 * по нему работают попадание мышью (elementsFromPoint), рамки выделения (getBBox) и ручки — как в режиме SVG.
 */
class EditorCanvasRenderer {
  constructor(box) {
    this.canvas = new K.CanvasRenderer(box);
    this.hit = document.createElement('div');
    Object.assign(this.hit.style, { position: 'absolute', inset: '0', opacity: '0' });
    box.appendChild(this.hit);
    this.dom = new K.DOMRenderer(this.hit);
  }
  get stats() { return this.canvas.stats; }
  render(tree, player) { this.canvas.render(tree, player); this.dom.render(tree); }
}
export function makeRenderer() { return E.canvasRender ? new EditorCanvasRenderer(canvasBox) : new K.DOMRenderer(canvasBox); }
/** Переключить бэкенд на лету (кнопка «Canvas»). */
export function setRenderer(canvas) {
  E.canvasRender = !!canvas;
  try { localStorage.setItem('kontur.renderer', canvas ? 'canvas' : 'svg'); } catch {}
  E.player.renderer = makeRenderer();
  E.player.draw();
}

/* ---------- масштаб и панорама ---------- */
export function layout() {
  const W = E.scene.width, H = E.scene.height;
  Object.assign(canvasBox.style, { left: E.panX + 'px', top: E.panY + 'px', width: W * E.zoom + 'px', height: H * E.zoom + 'px' });
  $('zoom').textContent = Math.round(E.zoom * 100) + '%';
  emit('view');
}
export function fit() {
  const r = stage.getBoundingClientRect();
  if (r.width < 20 || r.height < 20) return;
  const W = E.scene.width, H = E.scene.height, pad = 36;
  E.zoom = Math.max(0.02, Math.min((r.width - pad * 2) / W, (r.height - pad * 2) / H));
  E.panX = (r.width - W * E.zoom) / 2; E.panY = (r.height - H * E.zoom) / 2;
  fitted = true;
  layout();
}
export function zoomAt(f, sx, sy) {
  const z = Math.min(64, Math.max(0.02, E.zoom * f));
  E.panX = sx - ((sx - E.panX) * z) / E.zoom; E.panY = sy - ((sy - E.panY) * z) / E.zoom; E.zoom = z;
  layout();
}
export function zoomTo(z) { const r = stage.getBoundingClientRect(); zoomAt(z / E.zoom, r.width / 2, r.height / 2); }
function onWheel(e) {
  e.preventDefault();
  const [sx, sy] = stagePt(e);
  // колесо мыши — масштаб; жесты тачпада — панорама; Ctrl + тачпад — масштаб
  const mouse = e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40;
  if (e.ctrlKey || e.metaKey || mouse) zoomAt(Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * (e.ctrlKey && !mouse ? 0.012 : 0.0025)), sx, sy);
  else { E.panX -= e.deltaX; E.panY -= e.deltaY; layout(); }
}
export const toScene = (sx, sy) => [(sx - E.panX) / E.zoom, (sy - E.panY) / E.zoom];
export const toStage = (x, y) => [x * E.zoom + E.panX, y * E.zoom + E.panY];
export function stagePt(e) { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

/** Пробел: зажат — рука (панорама), короткое нажатие — воспроизведение. */
export function spaceKey(down) {
  if (down) { if (!space.down) { space.down = true; space.used = false; stage.style.cursor = 'grab'; } return; }
  space.down = false; stage.style.cursor = '';
  emit('cursor');
  if (!space.used) E.player.toggle();
}

/* ---------- события мыши ---------- */
function info(e) {
  const [sx, sy] = stagePt(e), [x, y] = toScene(sx, sy);
  const h = e.target?.closest?.('[data-h]')?.getAttribute('data-h') || null;
  return { e, sx, sy, x, y, h };
}
function onDown(e) {
  if (e.target.closest('.viewbar, .banner')) return;
  stage.focus({ preventScroll: true }); E.focus = 'canvas';
  if (e.button === 1 || (e.button === 0 && (space.down || E.tool === 'hand'))) {
    e.preventDefault(); space.used = true;
    pan = { x: e.clientX, y: e.clientY, px: E.panX, py: E.panY };
    stage.setPointerCapture(e.pointerId); stage.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0) return;
  stage.setPointerCapture(e.pointerId);
  E.tools[E.tool]?.down?.(info(e));
}
function onMove(e) {
  const i = info(e);
  $('status').textContent = `${Math.round(i.x)}, ${Math.round(i.y)}${E.hover ? ' · ' + E.hover : ''}`;
  if (pan) { E.panX = pan.px + e.clientX - pan.x; E.panY = pan.py + e.clientY - pan.y; layout(); return; }
  E.tools[E.tool]?.move?.(i);
}
function onUp(e) {
  if (pan) { pan = null; stage.style.cursor = space.down ? 'grab' : ''; emit('cursor'); return; }
  E.tools[E.tool]?.up?.(info(e));
}

/* ---------- попадание и рамки ---------- */
/** Самый глубокий незаблокированный узел под курсором. */
export function hitAt(e) {
  for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
    if (!canvasBox.contains(el)) continue;
    const g = el.closest('[data-node]');
    if (!g) continue;
    const id = g.getAttribute('data-node');
    if (!node(id) || isLocked(id)) continue;
    return id;
  }
  return null;
}
/** Уровень выбора как в Figma: ребёнок текущей группы (scope) или верхний объект. */
export function pickLevel(id) {
  const chain = [id, ...ancestors(id)];
  if (E.scope) { const i = chain.indexOf(E.scope); if (i > 0) return chain[i - 1]; }
  return chain[chain.length - 1];
}
export const elOf = (id) => canvasBox.querySelector(`[data-node="${CSS.escape(id)}"]`);
/** Рамка содержимого узла в его локальных координатах [x, y, w, h] или null. */
export function localBox(id) {
  const el = elOf(id);
  if (!el) return null;
  try { const b = el.getBBox(); if (b.width > 0 || b.height > 0) return [b.x, b.y, b.width, b.height]; } catch {}
  return null;
}
/** Углы рамки узла в пикселях холста. */
export function cornersOf(id, box = localBox(id)) {
  if (!box) return null;
  const m = screenM(id), [x, y, w, h] = box;
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map((p) => applyPt(m, p));
}
export function aabb(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
/** Общая рамка нескольких узлов (пиксели холста); узлы без содержимого — по их опорной точке. */
export function selAABB(ids) {
  const pts = [];
  for (const id of ids) {
    const c = cornersOf(id);
    if (c) pts.push(...c);
    else { const n = node(id); pts.push(applyPt(screenM(id), [n.props?.anchorX ?? 0, n.props?.anchorY ?? 0])); }
  }
  return pts.length ? aabb(pts) : null;
}
