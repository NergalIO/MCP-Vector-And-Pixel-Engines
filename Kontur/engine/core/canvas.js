/**
 * Canvas2D-бэкенд: рисует дерево отображения кадра на <canvas>. Path2D кэшируются по строке d, градиенты — по
 * определению; прозрачность группы, режимы наложения и фильтры (размытие, тень, свечение) — через слой и
 * ctx.filter / globalCompositeOperation. Чего Canvas не умеет (маски, растровые паттерны, фильтры рельефа) —
 * поддерево рисуется через SVG-картинку (откат); пока она грузится, показывается прошлый кадр этого поддерева.
 * Ограничение отката: картинки по внешним URL внутри такого поддерева не видны (SVG как изображение их не грузит).
 */
import { parseColor } from './color.js';
import { BoundedCache } from './cache.js';
import { IDENTITY, defsOf, matMul, parseTransform, urlRef } from './ir.js';
import { treeToString } from './svg.js';

const BLEND = new Set(['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);
const det = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
const rgba = (c, k = 1) => { const p = parseColor(String(c)); if (!p) return c; return `rgba(${Math.round(p[0] * 255)},${Math.round(p[1] * 255)},${Math.round(p[2] * 255)},${+(p[3] * k).toFixed(4)})`; };

export class CanvasRenderer {
  /**
   * container — элемент, куда положить <canvas> (заполняет его, вписывание как у SVG xMidYMid meet);
   * или opts.context + opts.width/height — рисовать в готовый контекст (тесты, OffscreenCanvas).
   */
  constructor(container, opts = {}) {
    this.el = container;
    this.opts = opts;
    this.paths = new BoundedCache(8000);
    this.images = new Map();
    this.fallbacks = new Map();
    this.lastFallback = new Map();
    this.grads = new WeakMap();
    this.filterCss = new WeakMap();
    this.layers = [];
    this.stats = { items: 0, fallbacks: 0, layers: 0 };
    if (opts.context) { this.ctx = opts.context; this.canvas = opts.context.canvas || { width: opts.width, height: opts.height }; }
    else {
      this.canvas = document.createElement('canvas');
      Object.assign(this.canvas.style, { width: '100%', height: '100%', display: 'block' });
      container.innerHTML = '';
      container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
    }
  }
  /** Path2D по строке d (кэш). */
  path(d) {
    let p = this.paths.get(d);
    if (!p) { p = new Path2D(d); this.paths.set(d, p); }
    return p;
  }
  render(tree, player) {
    this.player = player;
    this.defs = defsOf(tree);
    this.stats = { items: 0, fallbacks: 0, layers: 0 };
    const vb = String(tree.attrs.viewBox || `0 0 ${tree.attrs.width} ${tree.attrs.height}`).split(/\s+/).map(Number);
    const c = this.canvas;
    let W, H, dpr = 1;
    if (this.opts.context) { W = this.opts.width ?? c.width; H = this.opts.height ?? c.height; }
    else {
      dpr = this.opts.pixelRatio ?? (globalThis.devicePixelRatio || 1);
      const r = this.el.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr));
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; this.layers.length = 0; }
    }
    this.W = W; this.H = H;
    const s = Math.min(W / vb[2], H / vb[3]);
    const ox = (W - vb[2] * s) / 2, oy = (H - vb[3] * s) / 2;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.clearRect(0, 0, W, H);
    const crisp = tree.attrs['shape-rendering'] === 'crispEdges';
    ctx.imageSmoothingEnabled = !crisp;
    this.root = tree;
    const m0 = [s, 0, 0, s, ox - vb[0] * s, oy - vb[1] * s];
    for (const ch of tree.children || []) if (ch.tag !== 'defs') this.draw(ctx, ch, m0, 0);
  }
  /** Нужен ли откат на SVG для узла (без детей): маска, неподдержанный фильтр, растровый паттерн, неизвестный тег. */
  unsupported(n) {
    const a = n.attrs || {};
    if (a.mask) return true;
    if (n.tag === 'text' && n.children?.length) return true; // текст по кривой (textPath)
    if (a.filter && this.cssFilter(this.defs.get(urlRef(a.filter)), 1) === null) return true;
    for (const k of ['fill', 'stroke']) { const id = urlRef(a[k]); if (id && this.defs.get(id)?.tag === 'pattern') return true; }
    return !KNOWN.has(n.tag);
  }
  /** Фильтр движка → строка ctx.filter (scale — пикселей на единицу) или null, если такой не переводится. */
  cssFilter(def, scale) {
    if (!def) return null;
    let tpl = this.filterCss.get(def);
    if (tpl === undefined) { tpl = filterTemplate(def); this.filterCss.set(def, tpl); }
    return tpl ? tpl(scale) : null;
  }
  layer(depth) {
    let l = this.layers[depth];
    if (!l || l.canvas.width !== this.W || l.canvas.height !== this.H) {
      const cv = this.opts.createCanvas ? this.opts.createCanvas(this.W, this.H)
        : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(this.W, this.H) : Object.assign(document.createElement('canvas'), { width: this.W, height: this.H });
      l = { canvas: cv, ctx: cv.getContext('2d') };
      this.layers[depth] = l;
    }
    l.ctx.setTransform(1, 0, 0, 1, 0, 0);
    l.ctx.globalAlpha = 1; l.ctx.globalCompositeOperation = 'source-over'; l.ctx.filter = 'none';
    l.ctx.imageSmoothingEnabled = this.ctx.imageSmoothingEnabled;
    l.ctx.clearRect(0, 0, this.W, this.H);
    return l;
  }
  draw(ctx, n, m, depth) {
    const a = n.attrs || {};
    if (a.display === 'none' || a.visibility === 'hidden') return;
    if (this.unsupported(n)) return this.fallback(ctx, n, m);
    let mm = a.transform ? matMul(m, parseTransform(a.transform)) : m;
    if (n.tag === 'g' || n.tag === 'svg') {
      let clipRect = null;
      if (n.tag === 'svg' && a.viewBox) {
        const [vx, vy, vw, vh] = String(a.viewBox).split(/\s+/).map(Number);
        const w = +a.width || vw, h = +a.height || vh, x = +a.x || 0, y = +a.y || 0;
        if (a.overflow !== 'visible') clipRect = [mm, x, y, w, h];
        const k = a.preserveAspectRatio === 'none' ? [w / vw, h / vh] : (() => { const s = Math.min(w / vw, h / vh); return [s, s]; })();
        const dx = a.preserveAspectRatio === 'none' ? 0 : (w - vw * k[0]) / 2, dy = a.preserveAspectRatio === 'none' ? 0 : (h - vh * k[1]) / 2;
        mm = matMul(mm, [k[0], 0, 0, k[1], x + dx - vx * k[0], y + dy - vy * k[1]]);
      }
      const op = a.opacity != null ? +a.opacity : 1;
      if (op <= 0) return;
      const bm = /mix-blend-mode:\s*([\w-]+)/.exec(a.style || '')?.[1];
      const blend = bm && BLEND.has(bm) ? bm : null;
      const filter = a.filter ? this.cssFilter(this.defs.get(urlRef(a.filter)), det(mm)) : null;
      const kids = (n.children || []).filter((c) => c.tag !== 'defs');
      const needLayer = blend || filter || (op < 1 && (kids.length > 1 || kids.some((c) => c.tag === 'g' || c.tag === 'svg')));
      ctx.save();
      if (clipRect) { const [cm, x, y, w, h] = clipRect; ctx.setTransform(cm[0], cm[1], cm[2], cm[3], cm[4], cm[5]); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); }
      if (a['clip-path']) this.clip(ctx, mm, urlRef(a['clip-path']));
      if (needLayer) {
        const L = this.layer(depth + 1);
        this.stats.layers++;
        for (const c of kids) this.draw(L.ctx, c, mm, depth + 1);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha *= op;
        if (blend) ctx.globalCompositeOperation = blend;
        if (filter) ctx.filter = filter;
        ctx.drawImage(L.canvas, 0, 0);
      } else {
        if (op < 1) ctx.globalAlpha *= op;
        for (const c of kids) this.draw(ctx, c, mm, depth);
      }
      ctx.restore();
      return;
    }
    this.stats.items++;
    ctx.save();
    if (a['clip-path']) this.clip(ctx, mm, urlRef(a['clip-path']));
    if (a.opacity != null) ctx.globalAlpha *= +a.opacity;
    const bm = /mix-blend-mode:\s*([\w-]+)/.exec(a.style || '')?.[1];
    if (bm && BLEND.has(bm)) ctx.globalCompositeOperation = bm;
    ctx.setTransform(mm[0], mm[1], mm[2], mm[3], mm[4], mm[5]);
    if (n.tag === 'path') this.shape(ctx, this.path(a.d || ''), a);
    else if (n.tag === 'rect') { const p = new Path2D(); const rx = +a.rx || 0; if (rx && p.roundRect) p.roundRect(+a.x || 0, +a.y || 0, +a.width, +a.height, rx); else p.rect(+a.x || 0, +a.y || 0, +a.width, +a.height); this.shape(ctx, p, a); }
    else if (n.tag === 'circle' || n.tag === 'ellipse') { const p = new Path2D(); const rx = +(a.rx ?? a.r), ry = +(a.ry ?? a.r); p.ellipse(+a.cx || 0, +a.cy || 0, rx, ry, 0, 0, Math.PI * 2); this.shape(ctx, p, a); }
    else if (n.tag === 'line') { const p = new Path2D(); p.moveTo(+a.x1 || 0, +a.y1 || 0); p.lineTo(+a.x2 || 0, +a.y2 || 0); this.shape(ctx, p, { ...a, fill: 'none' }); }
    else if (n.tag === 'text') this.text(ctx, n, a);
    else if (n.tag === 'image') this.image(ctx, a);
    ctx.restore();
  }
  clip(ctx, m, id) {
    const def = this.defs.get(id);
    if (!def) return;
    const p = new Path2D();
    let rule = 'nonzero';
    const add = (n, tm) => {
      const t2 = n.attrs?.transform ? matMul(tm, parseTransform(n.attrs.transform)) : tm;
      if (n.tag === 'path' && n.attrs.d) { p.addPath(this.path(n.attrs.d), toDOM(t2)); if (n.attrs['clip-rule'] === 'evenodd' || n.attrs['fill-rule'] === 'evenodd') rule = 'evenodd'; }
      else if (n.tag === 'rect') { const r = new Path2D(); r.rect(+n.attrs.x || 0, +n.attrs.y || 0, +n.attrs.width, +n.attrs.height); p.addPath(r, toDOM(t2)); }
      for (const c of n.children || []) add(c, t2);
    };
    for (const c of def.children || []) add(c, IDENTITY);
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.clip(p, rule);
  }
  paint(ctx, v, opacity) {
    if (v == null || v === 'none' || v === 'transparent') return null;
    const id = urlRef(v);
    if (!id) return v;
    const def = this.defs.get(id);
    if (!def) return null;
    let per = this.grads.get(def);
    if (!per) { per = new Map(); this.grads.set(def, per); }
    let g = per.get(ctx);
    if (!g) {
      const A = def.attrs;
      if (def.tag === 'linearGradient') g = ctx.createLinearGradient(+A.x1 || 0, +A.y1 || 0, +A.x2 || 0, +A.y2 || 0);
      else if (def.tag === 'radialGradient') g = ctx.createRadialGradient(+(A.fx ?? A.cx) || 0, +(A.fy ?? A.cy) || 0, 0, +A.cx || 0, +A.cy || 0, +A.r || 0);
      else return null;
      for (const st of def.children || []) {
        const off = String(st.attrs.offset ?? 0);
        const o = off.endsWith('%') ? parseFloat(off) / 100 : +off;
        try { g.addColorStop(Math.max(0, Math.min(1, o)), rgba(st.attrs['stop-color'] || '#000', st.attrs['stop-opacity'] != null ? +st.attrs['stop-opacity'] : 1)); } catch {}
      }
      per.set(ctx, g);
    }
    void opacity;
    return g;
  }
  shape(ctx, p, a) {
    const fill = this.paint(ctx, a.fill ?? '#000');
    const base = ctx.globalAlpha;
    if (fill) {
      ctx.fillStyle = fill;
      ctx.globalAlpha = base * (a['fill-opacity'] != null ? +a['fill-opacity'] : 1);
      ctx.fill(p, a['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero');
    }
    const stroke = this.paint(ctx, a.stroke);
    const sw = a['stroke-width'] != null ? +a['stroke-width'] : 1;
    if (stroke && sw > 0) {
      ctx.strokeStyle = stroke;
      ctx.globalAlpha = base * (a['stroke-opacity'] != null ? +a['stroke-opacity'] : 1);
      ctx.lineWidth = sw;
      ctx.lineCap = a['stroke-linecap'] || 'butt';
      ctx.lineJoin = a['stroke-linejoin'] || 'miter';
      ctx.miterLimit = a['stroke-miterlimit'] != null ? +a['stroke-miterlimit'] : 4;
      const dash = a['stroke-dasharray'];
      ctx.setLineDash(dash && dash !== 'none' ? String(dash).split(/[\s,]+/).map(Number) : []);
      ctx.lineDashOffset = +a['stroke-dashoffset'] || 0;
      ctx.stroke(p);
    }
    ctx.globalAlpha = base;
  }
  text(ctx, n, a) {
    const size = +a['font-size'] || 16;
    ctx.font = `${a['font-weight'] || 400} ${size}px ${a['font-family'] || 'sans-serif'}`;
    ctx.textAlign = a['text-anchor'] === 'middle' ? 'center' : a['text-anchor'] === 'end' ? 'right' : 'left';
    const db = a['dominant-baseline'];
    ctx.textBaseline = db === 'middle' || db === 'central' ? 'middle' : db === 'hanging' ? 'hanging' : 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${+a['letter-spacing'] || 0}px`;
    const s = n.text ?? '';
    const fill = this.paint(ctx, a.fill ?? '#000'), stroke = this.paint(ctx, a.stroke);
    const base = ctx.globalAlpha;
    if (fill) { ctx.fillStyle = fill; ctx.globalAlpha = base * (a['fill-opacity'] != null ? +a['fill-opacity'] : 1); ctx.fillText(s, +a.x || 0, +a.y || 0); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = +a['stroke-width'] || 1; ctx.globalAlpha = base; ctx.strokeText(s, +a.x || 0, +a.y || 0); }
    ctx.globalAlpha = base;
  }
  image(ctx, a) {
    const href = a.href || a['xlink:href'];
    if (!href) return;
    let img = this.images.get(href);
    if (!img) {
      img = new Image();
      img.onload = () => this.redraw();
      img.src = href;
      this.images.set(href, img);
    }
    if (!img.complete || !img.naturalWidth) return;
    const x = +a.x || 0, y = +a.y || 0, w = +a.width || img.naturalWidth, h = +a.height || img.naturalHeight;
    if (/pixelated|optimizeSpeed|crisp-edges/.test(a.style || '')) ctx.imageSmoothingEnabled = false;
    const par = a.preserveAspectRatio || 'xMidYMid meet';
    if (par === 'none') return ctx.drawImage(img, x, y, w, h);
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const s = /slice/.test(par) ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    const dw = iw * s, dh = ih * s;
    const al = (p, full, d) => (p === 'Min' ? 0 : p === 'Max' ? full - d : (full - d) / 2);
    const mx = /x(Min|Mid|Max)/.exec(par)?.[1] || 'Mid', my = /Y(Min|Mid|Max)/.exec(par)?.[1] || 'Mid';
    if (/slice/.test(par)) { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.drawImage(img, x + al(mx, w, dw), y + al(my, h, dh), dw, dh); ctx.restore(); }
    else ctx.drawImage(img, x + al(mx, w, dw), y + al(my, h, dh), dw, dh);
  }
  /** Откат: узел через SVG-картинку во весь кадр (матрица m уже в пикселях холста). */
  fallback(ctx, n, m) {
    this.stats.fallbacks++;
    const key = n.attrs?.['data-node'] || n.attrs?.id || n.tag;
    const defs = (this.root.children || []).find((c) => c.tag === 'defs');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${this.W}" height="${this.H}" viewBox="0 0 ${this.W} ${this.H}">${defs ? treeToString(defs) : ''}<g transform="matrix(${m.map((v) => +v.toFixed(6)).join(' ')})">${treeToString(n)}</g></svg>`;
    let img = this.fallbacks.get(svg);
    if (!img) {
      if (this.fallbacks.size > 48) this.fallbacks.delete(this.fallbacks.keys().next().value);
      img = new Image();
      img.onload = () => { this.lastFallback.set(key, img); this.redraw(); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      this.fallbacks.set(svg, img);
    }
    const ready = img.complete && img.naturalWidth ? img : this.lastFallback.get(key);
    if (!ready) return;
    if (ready === img) this.lastFallback.set(key, img);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(ready, 0, 0);
    ctx.restore();
  }
  /** Догрузилась картинка: перерисовать кадр, если плеер стоит (во время воспроизведения это сделает следующий кадр). */
  redraw() {
    const p = this.player;
    if (p && !p.playing && typeof p.draw === 'function') { clearTimeout(this._rt); this._rt = setTimeout(() => p.draw(), 0); }
    this.opts.onAsync?.();
  }
}
const KNOWN = new Set(['g', 'svg', 'path', 'rect', 'circle', 'ellipse', 'line', 'text', 'image']);
const toDOM = (m) => (typeof DOMMatrix !== 'undefined' ? new DOMMatrix(m) : { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] });

/**
 * Фильтр движка (размытие / свечение / тень, см. evaluate) → шаблон строки CSS-фильтра по масштабу, иначе null.
 * Свечение = тень без сдвига цветом свечения; радиус CSS drop-shadow — удвоенное stdDeviation.
 */
export function filterTemplate(def) {
  const prims = def.children || [];
  const ok = new Set(['feGaussianBlur', 'feFlood', 'feComposite', 'feDropShadow', 'feMerge']);
  if (!prims.length || prims.some((p) => !ok.has(p.tag))) return null;
  let blur = 0, glow = null, shadow = null;
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i], A = p.attrs || {};
    if (p.tag === 'feGaussianBlur' && A.in === 'SourceGraphic' && A.result === 'b') blur = +A.stdDeviation || 0;
    else if (p.tag === 'feGaussianBlur' && A.result === 'gb') {
      const fl = prims[i + 1], co = prims[i + 2];
      if (fl?.tag !== 'feFlood' || co?.tag !== 'feComposite' || co.attrs.operator !== 'in') return null;
      glow = { std: +A.stdDeviation || 0, color: rgba(fl.attrs['flood-color'] || '#fff', fl.attrs['flood-opacity'] != null ? +fl.attrs['flood-opacity'] : 1) };
      i += 2;
    } else if (p.tag === 'feDropShadow') shadow = { dx: +A.dx || 0, dy: +A.dy || 0, std: +A.stdDeviation || 0, color: rgba(A['flood-color'] || '#000', A['flood-opacity'] != null ? +A['flood-opacity'] : 1) };
    else if (p.tag === 'feMerge') continue;
    else return null;
  }
  return (k) => [
    blur ? `blur(${(blur * k).toFixed(2)}px)` : '',
    glow ? `drop-shadow(0px 0px ${(glow.std * 2 * k).toFixed(2)}px ${glow.color})` : '',
    shadow ? `drop-shadow(${(shadow.dx * k).toFixed(2)}px ${(shadow.dy * k).toFixed(2)}px ${(shadow.std * 2 * k).toFixed(2)}px ${shadow.color})` : '',
  ].filter(Boolean).join(' ') || 'none';
}
