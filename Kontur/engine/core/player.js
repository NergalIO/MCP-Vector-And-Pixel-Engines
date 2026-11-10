/** Браузерный рендерер и плеер. */
import { evaluate } from './evaluate.js';
import { clamp } from './math.js';
import { invalidate } from './model.js';
import { clipRange, markersCrossed } from './ops.js';

export function signature(n) {
  let s = n.tag + '(' + Object.keys(n.attrs).filter((k) => n.attrs[k] != null && n.attrs[k] !== '').join(',');
  if (n.children) for (const c of n.children) s += signature(c);
  return s + ')';
}
export function flatten(n, out = []) { out.push(n); if (n.children) for (const c of n.children) flatten(c, out); return out; }

const SVG_NS = 'http://www.w3.org/2000/svg', XLINK_NS = 'http://www.w3.org/1999/xlink';
/** Ключ элемента среди соседей: узел сцены (data-node), id определения, иначе тег и порядковый номер тега. */
function keysOf(children) {
  const seen = new Map();
  return children.map((c) => {
    const a = c.attrs || {};
    const base = a['data-node'] != null ? 'n:' + a['data-node'] : a.id != null ? 'i:' + a.id : c.tag;
    const k = seen.get(base) || 0; seen.set(base, k + 1); // повторы (копии repeat) — по порядку
    return base + ':' + k;
  });
}
const setAttr = (el, k, v) => { if (k === 'xlink:href') el.setAttributeNS(XLINK_NS, k, v); else el.setAttribute(k, v); };
const delAttr = (el, k) => { if (k === 'xlink:href') el.removeAttributeNS(XLINK_NS, 'href'); else el.removeAttribute(k); };
const has = (v) => v != null && v !== '';

/**
 * SVG-рендерер в DOM с сопоставлением по ключам: элементы узлов сцены (data-node) и определений (id) переживают
 * перестановки и добавления, меняются только отличающиеся атрибуты (исчезнувшие — removeAttribute), текст и
 * порядок. Полная перестройка не нужна даже при смене структуры.
 */
export class DOMRenderer {
  constructor(container) { this.el = container; this.svg = null; this.prev = null; this.stats = { created: 0, removed: 0, attrs: 0 }; }
  create(v) {
    const el = document.createElementNS(SVG_NS, v.tag);
    for (const k in v.attrs) if (has(v.attrs[k])) setAttr(el, k, v.attrs[k]);
    if (v.text != null) el.textContent = v.text;
    else for (const c of v.children || []) el.appendChild(this.create(c));
    this.stats.created++;
    el.__kv = v;
    return el;
  }
  patch(el, o, v) {
    if (o === v) return; // неизменённое поддерево (кэш статичных узлов движка отдаёт тот же объект)
    const oa = o.attrs || {}, na = v.attrs || {};
    for (const k in na) { const x = na[k]; if (has(x)) { if (oa[k] !== x) { setAttr(el, k, x); this.stats.attrs++; } } else if (has(oa[k])) delAttr(el, k); }
    for (const k in oa) if (!(k in na) && has(oa[k])) delAttr(el, k);
    if (v.text != null || o.text != null) { if (v.text !== o.text) el.textContent = v.text ?? ''; el.__kv = v; return; }
    this.children(el, o.children || [], v.children || []);
    el.__kv = v;
  }
  children(el, olds, news) {
    if (olds === news) return;
    const ok = keysOf(olds), nk = keysOf(news);
    const byKey = new Map();
    const kids = el.childNodes;
    for (let i = 0; i < olds.length; i++) byKey.set(ok[i], { v: olds[i], el: kids[i] });
    const used = new Set();
    let ref = el.firstChild;
    for (let i = 0; i < news.length; i++) {
      const v = news[i], hit = byKey.get(nk[i]);
      let node;
      if (hit && hit.v.tag === v.tag && !used.has(nk[i])) { node = hit.el; used.add(nk[i]); this.patch(node, hit.v, v); }
      else node = this.create(v);
      if (node !== ref) el.insertBefore(node, ref); else ref = ref.nextSibling;
    }
    // лишнее — после последнего нового
    while (ref) { const nx = ref.nextSibling; el.removeChild(ref); this.stats.removed++; ref = nx; }
  }
  render(tree) {
    if (!this.svg || this.svg.parentNode !== this.el) {
      this.el.innerHTML = '';
      this.svg = this.create({ ...tree, attrs: { ...tree.attrs, width: null, height: null } });
      this.svg.style.width = '100%'; this.svg.style.height = '100%'; this.svg.style.display = 'block';
      this.el.appendChild(this.svg);
      this.prev = { ...tree, attrs: { ...tree.attrs, width: null, height: null } };
      return;
    }
    const v = { ...tree, attrs: { ...tree.attrs, width: null, height: null } };
    this.patch(this.svg, this.prev, v);
    this.prev = v;
  }
}

export class Player {
  constructor(container, scene, opts = {}) {
    this.renderer = opts.renderer || new DOMRenderer(container);
    this.states = opts.states || {};
    this.scene = scene; this.time = 0; this.playing = false; this.speed = 1; this.listeners = new Set(); this.markerListeners = new Set();
    this.loop = opts.loop ?? scene.loop ?? true;
    this._tick = this._tick.bind(this);
    this.draw();
    if (opts.autoplay !== false) this.play();
  }
  setScene(scene, keepTime = true) { invalidate(this.scene); this.scene = scene; invalidate(scene); if (this.clip) this.clip = clipRange(scene, this.clip.name); if (!keepTime) this.time = this.clip ? this.clip.start : 0; this.time = Math.min(this.time, scene.duration); this.draw(); }
  refresh() { invalidate(this.scene); this.draw(); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  /** Подписка на маркеры сцены: fn(marker, player) при прохождении во время воспроизведения. */
  onMarker(fn) { this.markerListeners.add(fn); return () => this.markerListeners.delete(fn); }
  _fire(list) { for (const m of list) for (const f of this.markerListeners) { try { f(m, this); } catch (e) { console.error(e); } } }
  /** Выбрать вариант группы состояний (null — вернуть по умолчанию). */
  setState(name, value) { if (value == null) delete this.states[name]; else this.states[name] = value; this.refresh(); }
  draw() {
    try { this.renderer.render(evaluate(this.scene, this.time, { cache: true, states: this.states }), this); this.error = null; }
    catch (e) { this.error = e; console.error(e); }
    for (const f of this.listeners) f(this.time, this);
  }
  /** Ограничить воспроизведение именованным клипом (null — вся шкала). */
  setClip(name) {
    this.clip = name ? clipRange(this.scene, name) : null;
    if (this.clip) this.time = this.clip.start;
    this.draw();
  }
  range() { return this.clip || { start: 0, end: this.scene.duration, loop: this.loop }; }
  seek(t) { this.time = clamp(t, 0, this.scene.duration); this.draw(); }
  play() {
    if (this.playing) return;
    const r = this.range();
    if (this.time >= r.end - 1e-6 || this.time < r.start) this.time = r.start; this.playing = true; this.last = performance.now(); requestAnimationFrame(this._tick); this.draw(); }
  pause() { this.playing = false; this.draw(); }
  toggle() { this.playing ? this.pause() : this.play(); }
  _tick(now) {
    if (!this.playing) return;
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const t0 = this.time;
    this.time += dt * this.speed;
    const r = this.range();
    let crossed;
    if (this.time >= r.end) {
      const len = r.end - r.start || 1;
      if (this.clip ? r.loop !== false : this.loop) { this.time = r.start + ((this.time - r.start) % len); crossed = markersCrossed(this.scene, t0, this.time, { start: r.start, end: r.end, wrap: true }); }
      else if (this.clip && this.clip.next) { crossed = markersCrossed(this.scene, t0, r.end); this.clip = clipRange(this.scene, this.clip.next); this.time = this.clip.start; }
      else { this.time = r.end; this.playing = false; crossed = markersCrossed(this.scene, t0, r.end); }
    } else crossed = markersCrossed(this.scene, t0, this.time);
    if (crossed.length && this.markerListeners.size) this._fire(crossed);
    this.draw();
    if (this.playing) requestAnimationFrame(this._tick);
  }
}
