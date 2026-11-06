// Sprite document model, editing operations, undo history and persistence.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  parseColor, toHex, getPx, setPx, linePoints, rectPoints, ellipsePoints, floodFill, composite,
} from '../public/shared/raster.js';
import { decodePng } from './png.js';

const HISTORY_LIMIT = 200;
const HISTORY_BYTES = 64 * 1024 * 1024; // per sprite
const BACKUP_INTERVAL = 2 * 60 * 1000;
const BACKUP_KEEP = 20;
const MAX_SIZE = 1024;
const uid = () => Math.random().toString(36).slice(2, 10);

export const DEFAULT_PALETTE = [
  '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
  '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
];

function slug(s) {
  return String(s || 'sprite').toLowerCase().replace(/[^a-z0-9а-яё_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'sprite';
}

function checkSize(w, h) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > MAX_SIZE || h > MAX_SIZE) {
    throw new Error(`size must be integers between 1 and ${MAX_SIZE}`);
  }
}

export class Sprite {
  constructor({ id, name, width, height }) {
    checkSize(width, height);
    this.id = id;
    this.name = name;
    this.width = width;
    this.height = height;
    this.rev = 0;
    this.palette = [...DEFAULT_PALETTE];
    this.tags = [];
    this.layers = [{ id: uid(), name: 'Layer 1', visible: true, opacity: 1 }];
    this.frames = [{ id: uid(), duration: 100, cels: [this.blank()] }];
    this.undoStack = [];
    this.redoStack = [];
    this.updated = Date.now();
  }

  blank() { return new Uint8Array(this.width * this.height * 4); }

  static fromJSON(j) {
    const s = new Sprite({ id: j.id, name: j.name, width: j.width, height: j.height });
    s.rev = j.rev || 0;
    s.palette = j.palette || [...DEFAULT_PALETTE];
    s.tags = j.tags || [];
    s.layers = j.layers.map((l) => ({ id: l.id || uid(), name: l.name, visible: l.visible !== false, opacity: l.opacity ?? 1 }));
    s.frames = j.frames.map((f) => ({
      id: f.id || uid(),
      duration: f.duration || 100,
      cels: f.cels.map((c) => new Uint8Array(Buffer.from(c, 'base64'))),
    }));
    s.updated = j.updated || Date.now();
    return s;
  }

  toJSON() {
    return {
      id: this.id, name: this.name, width: this.width, height: this.height, rev: this.rev,
      palette: this.palette, tags: this.tags, layers: this.layers,
      frames: this.frames.map((f) => ({ id: f.id, duration: f.duration, cels: f.cels.map((c) => Buffer.from(c).toString('base64')) })),
      updated: this.updated,
      canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0,
    };
  }

  meta() {
    return {
      id: this.id, name: this.name, width: this.width, height: this.height,
      frames: this.frames.length, layers: this.layers.map((l, i) => `${i}:${l.name}${l.visible ? '' : ' (hidden)'}`),
      durations: this.frames.map((f) => f.duration), tags: this.tags,
      palette: this.palette.map((c, i) => `p${i}=${c}`), rev: this.rev,
    };
  }

  snapshot() {
    return {
      name: this.name, width: this.width, height: this.height,
      palette: [...this.palette], tags: this.tags.map((t) => ({ ...t })),
      layers: this.layers.map((l) => ({ ...l })),
      frames: this.frames.map((f) => ({ id: f.id, duration: f.duration, cels: f.cels.map((c) => c.slice()) })),
    };
  }

  restore(s) { Object.assign(this, s); }

  frameIndex(f = 0) {
    const i = Number(f);
    if (!Number.isInteger(i) || i < 0 || i >= this.frames.length) throw new Error(`frame ${f} out of range (0..${this.frames.length - 1})`);
    return i;
  }

  layerIndex(l = 0) {
    if (typeof l === 'string' && !/^\d+$/.test(l)) {
      const i = this.layers.findIndex((L) => L.name.toLowerCase() === l.toLowerCase());
      if (i < 0) throw new Error(`no layer named "${l}"`);
      return i;
    }
    const i = Number(l);
    if (!Number.isInteger(i) || i < 0 || i >= this.layers.length) throw new Error(`layer ${l} out of range (0..${this.layers.length - 1})`);
    return i;
  }

  cel(f, l) { return this.frames[this.frameIndex(f)].cels[this.layerIndex(l)]; }

  // Colors may be hex strings, "transparent", a palette index number or "p<index>".
  color(c) {
    if (typeof c === 'number' || (typeof c === 'string' && /^p\d+$/i.test(c.trim()))) {
      const i = typeof c === 'number' ? c : Number(c.trim().slice(1));
      if (!Number.isInteger(i) || i < 0 || i >= this.palette.length) throw new Error(`palette index ${c} out of range (0..${this.palette.length - 1})`);
      return parseColor(this.palette[i]);
    }
    return parseColor(c);
  }

  compositeFrame(f, layerFilter) {
    const fr = this.frames[this.frameIndex(f)];
    const layers = layerFilter === undefined || layerFilter === null
      ? this.layers
      : this.layers.map((L, i) => ({ ...L, visible: i === this.layerIndex(layerFilter), opacity: 1 }));
    return composite(layers, fr.cels, this.width, this.height);
  }
}

// ---------------------------------------------------------------------------
// Operations. kind: 'cel' snapshots one cel for undo, 'cels' the targeted cels, 'doc' everything.

const int = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return Math.round(n);
};

function plot(s, cel, pts, color) {
  const c = Array.isArray(color) ? color : s.color(color);
  for (const [x, y] of pts) setPx(cel, s.width, s.height, x, y, c);
  return { changed: pts.length };
}

// Cels touched by an op: one (frame/layer) or many via all_frames / all_layers.
function targets(s, a) {
  const fs_ = a.all_frames ? s.frames.map((_, i) => i) : [s.frameIndex(a.frame ?? 0)];
  const ls = a.all_layers ? s.layers.map((_, i) => i) : [s.layerIndex(a.layer ?? 0)];
  const out = [];
  for (const f of fs_) for (const l of ls) out.push([f, l]);
  return out;
}
const multiKind = (a) => (a.all_frames || a.all_layers ? 'cels' : 'cel');

function transformCel(s, cel, map) {
  const out = s.blank();
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      const src = map(x, y);
      if (!src) continue;
      const p = getPx(cel, s.width, s.height, src[0], src[1]);
      if (p) setPx(out, s.width, s.height, x, y, p);
    }
  }
  cel.set(out);
}

export const OPS = {
  // --- pixel ops on a single cel ---------------------------------------------
  set_cel: {
    kind: 'cel',
    fn(s, a) {
      const data = Buffer.from(a.data, 'base64');
      if (data.length !== s.width * s.height * 4) throw new Error('cel data has wrong size');
      s.cel(a.frame, a.layer).set(data);
    },
  },
  // changes: flat [pixelIndex, 0xRRGGBBAA, pixelIndex, 0xRRGGBBAA, ...] — what the editor sends per stroke,
  // so simultaneous edits to other pixels of the same cel are not overwritten.
  patch_cel: {
    kind: 'cel',
    fn(s, a) {
      const cel = s.cel(a.frame, a.layer), ch = a.changes || [], n = s.width * s.height;
      for (let k = 0; k + 1 < ch.length; k += 2) {
        const i = ch[k], c = ch[k + 1] >>> 0;
        if (!Number.isInteger(i) || i < 0 || i >= n) continue;
        cel[i * 4] = c >>> 24; cel[i * 4 + 1] = (c >>> 16) & 255; cel[i * 4 + 2] = (c >>> 8) & 255; cel[i * 4 + 3] = c & 255;
      }
      return { changed: ch.length >> 1 };
    },
  },
  set_pixels: {
    kind: 'cel',
    fn(s, a) {
      const cel = s.cel(a.frame, a.layer);
      for (const p of a.pixels || []) {
        const [x, y, color] = Array.isArray(p) ? p : [p.x, p.y, p.color];
        setPx(cel, s.width, s.height, int(x, 'x'), int(y, 'y'), s.color(color ?? a.color));
      }
      return { changed: (a.pixels || []).length };
    },
  },
  draw_line: {
    kind: 'cel',
    fn(s, a) {
      const cel = s.cel(a.frame, a.layer);
      const pts = a.points
        ? a.points.slice(1).flatMap((p, i) => linePoints(int(a.points[i][0]), int(a.points[i][1]), int(p[0]), int(p[1])))
        : linePoints(int(a.x1, 'x1'), int(a.y1, 'y1'), int(a.x2, 'x2'), int(a.y2, 'y2'));
      return plot(s, cel, pts, a.color);
    },
  },
  draw_rect: {
    kind: 'cel',
    fn(s, a) {
      const x = int(a.x, 'x'), y = int(a.y, 'y');
      const pts = rectPoints(x, y, x + int(a.width, 'width') - 1, y + int(a.height, 'height') - 1, !!a.filled);
      return plot(s, s.cel(a.frame, a.layer), pts, a.color);
    },
  },
  draw_ellipse: {
    kind: 'cel',
    fn(s, a) {
      const x = int(a.x, 'x'), y = int(a.y, 'y');
      const pts = ellipsePoints(x, y, x + int(a.width, 'width') - 1, y + int(a.height, 'height') - 1, !!a.filled);
      return plot(s, s.cel(a.frame, a.layer), pts, a.color);
    },
  },
  fill: {
    kind: 'cel',
    fn(s, a) {
      const n = floodFill(s.cel(a.frame, a.layer), s.width, s.height, int(a.x, 'x'), int(a.y, 'y'), s.color(a.color), a.contiguous !== false);
      return { changed: n };
    },
  },
  draw_ascii: {
    kind: 'cel',
    fn(s, a) {
      const cel = s.cel(a.frame, a.layer);
      const rows = Array.isArray(a.rows) ? a.rows : String(a.rows).split('\n');
      const legend = {};
      for (const [k, v] of Object.entries(a.legend || {})) legend[k] = s.color(v);
      const ox = int(a.x ?? 0, 'x'), oy = int(a.y ?? 0, 'y');
      let n = 0;
      const unknown = new Set();
      rows.forEach((row, ry) => {
        [...row].forEach((ch, rx) => {
          const c = legend[ch];
          if (c) { setPx(cel, s.width, s.height, ox + rx, oy + ry, c); n++; }
          else if (ch !== '.' && ch !== ' ') unknown.add(ch);
        });
      });
      const res = { changed: n };
      if (unknown.size) res.warning = `chars not in legend were skipped: ${[...unknown].join(' ')}`;
      return res;
    },
  },
  clear: {
    kind: 'cel',
    fn(s, a) {
      const cel = s.cel(a.frame, a.layer);
      const c = s.color(a.color ?? 'transparent');
      if (a.width === undefined) {
        for (let i = 0; i < cel.length; i += 4) cel.set(c, i);
      } else {
        const x = int(a.x ?? 0), y = int(a.y ?? 0);
        plot(s, cel, rectPoints(x, y, x + int(a.width) - 1, y + int(a.height) - 1, true), c);
      }
    },
  },
  copy_cel: {
    kind: 'cel',
    fn(s, a) {
      const src = s.cel(a.from_frame ?? 0, a.from_layer ?? a.layer ?? 0).slice();
      const dst = s.cel(a.frame, a.layer);
      if (!a.dx && !a.dy) { dst.set(src); return; }
      for (let y = 0; y < s.height; y++) {
        for (let x = 0; x < s.width; x++) {
          const p = getPx(src, s.width, s.height, x, y);
          if (p[3]) setPx(dst, s.width, s.height, x + int(a.dx || 0), y + int(a.dy || 0), p);
        }
      }
    },
  },
  draw_image: {
    kind: 'cel',
    trusted: (a) => !!a.path,
    fn(s, a) {
      const img = decodePng(a.png_base64 ? Buffer.from(a.png_base64, 'base64') : fs.readFileSync(a.path));
      const cel = s.cel(a.frame, a.layer);
      const ox = int(a.x ?? 0), oy = int(a.y ?? 0);
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const p = getPx(img.rgba, img.width, img.height, x, y);
          if (p[3] || a.replace_transparent) setPx(cel, s.width, s.height, ox + x, oy + y, p);
        }
      }
      return { image_size: [img.width, img.height] };
    },
  },
  // --- ops that can target one cel or many -----------------------------------
  shift: {
    kind: multiKind,
    fn(s, a) {
      const dx = int(a.dx ?? 0), dy = int(a.dy ?? 0), W = s.width, H = s.height;
      for (const [f, l] of targets(s, a)) {
        transformCel(s, s.frames[f].cels[l], (x, y) => {
          let sx = x - dx, sy = y - dy;
          if (a.wrap) { sx = ((sx % W) + W) % W; sy = ((sy % H) + H) % H; }
          return [sx, sy];
        });
      }
    },
  },
  flip: {
    kind: multiKind,
    fn(s, a) {
      const v = a.direction === 'vertical';
      for (const [f, l] of targets(s, a)) {
        transformCel(s, s.frames[f].cels[l], (x, y) => (v ? [x, s.height - 1 - y] : [s.width - 1 - x, y]));
      }
    },
  },
  rotate: {
    kind: multiKind,
    fn(s, a) {
      const turns = ((int(a.degrees ?? 90) / 90) % 4 + 4) % 4;
      const cx = (s.width - 1) / 2, cy = (s.height - 1) / 2;
      for (const [f, l] of targets(s, a)) {
        transformCel(s, s.frames[f].cels[l], (x, y) => {
          let dx = x - cx, dy = y - cy;
          for (let t = 0; t < turns; t++) [dx, dy] = [dy, -dx]; // inverse of clockwise
          return [Math.round(cx + dx), Math.round(cy + dy)];
        });
      }
    },
  },
  replace_color: {
    kind: multiKind,
    fn(s, a) {
      const from = s.color(a.from), to = s.color(a.to), tol = int(a.tolerance ?? 0);
      let n = 0;
      for (const [f, l] of targets(s, a)) {
        const cel = s.frames[f].cels[l];
        for (let i = 0; i < cel.length; i += 4) {
          const match = from[3] === 0
            ? cel[i + 3] === 0
            : cel[i + 3] > 0 && Math.max(...[0, 1, 2, 3].map((k) => Math.abs(cel[i + k] - from[k]))) <= tol;
          if (match) { cel.set(to, i); n++; }
        }
      }
      return { changed: n };
    },
  },
  outline: {
    kind: multiKind,
    fn(s, a) {
      const c = s.color(a.color ?? '#000000');
      const inside = a.mode === 'inside';
      const dirs = a.diagonal ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
      let n = 0;
      for (const [f, l] of targets(s, a)) {
        const cel = s.frames[f].cels[l];
        const src = cel.slice();
        const solid = (x, y) => { const p = getPx(src, s.width, s.height, x, y); return !!p && p[3] > 0; };
        for (let y = 0; y < s.height; y++) {
          for (let x = 0; x < s.width; x++) {
            const hit = inside
              ? solid(x, y) && dirs.some(([dx, dy]) => !solid(x + dx, y + dy))
              : !solid(x, y) && dirs.some(([dx, dy]) => solid(x + dx, y + dy));
            if (hit) { setPx(cel, s.width, s.height, x, y, c); n++; }
          }
        }
      }
      return { changed: n };
    },
  },
  // --- structure ---------------------------------------------------------------
  rename: { kind: 'doc', fn(s, a) { s.name = String(a.name); } },
  resize_canvas: {
    kind: 'doc',
    fn(s, a) {
      const W = int(a.width, 'width'), H = int(a.height, 'height');
      checkSize(W, H);
      const an = a.anchor || 'center';
      const ax = an.includes('left') ? 0 : an.includes('right') ? 1 : 0.5;
      const ay = an.includes('top') ? 0 : an.includes('bottom') ? 1 : 0.5;
      const ox = Math.floor((W - s.width) * ax), oy = Math.floor((H - s.height) * ay);
      for (const fr of s.frames) {
        fr.cels = fr.cels.map((cel) => {
          const out = new Uint8Array(W * H * 4);
          for (let y = 0; y < s.height; y++) {
            for (let x = 0; x < s.width; x++) setPx(out, W, H, x + ox, y + oy, getPx(cel, s.width, s.height, x, y));
          }
          return out;
        });
      }
      s.width = W; s.height = H;
    },
  },
  scale_sprite: {
    kind: 'doc',
    fn(s, a) {
      const W = a.factor ? Math.round(s.width * a.factor) : int(a.width, 'width');
      const H = a.factor ? Math.round(s.height * a.factor) : int(a.height, 'height');
      checkSize(W, H);
      for (const fr of s.frames) {
        fr.cels = fr.cels.map((cel) => {
          const out = new Uint8Array(W * H * 4);
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              setPx(out, W, H, x, y, getPx(cel, s.width, s.height, Math.floor((x * s.width) / W), Math.floor((y * s.height) / H)));
            }
          }
          return out;
        });
      }
      s.width = W; s.height = H;
    },
  },
  add_layer: {
    kind: 'doc',
    fn(s, a) {
      const idx = a.index === undefined ? s.layers.length : Math.max(0, Math.min(s.layers.length, int(a.index)));
      s.layers.splice(idx, 0, { id: uid(), name: a.name || `Layer ${s.layers.length + 1}`, visible: true, opacity: 1 });
      for (const fr of s.frames) fr.cels.splice(idx, 0, s.blank());
      return { layer: idx };
    },
  },
  delete_layer: {
    kind: 'doc',
    fn(s, a) {
      if (s.layers.length === 1) throw new Error('cannot delete the only layer');
      const i = s.layerIndex(a.layer);
      s.layers.splice(i, 1);
      for (const fr of s.frames) fr.cels.splice(i, 1);
    },
  },
  update_layer: {
    kind: 'doc',
    fn(s, a) {
      const L = s.layers[s.layerIndex(a.layer)];
      if (a.name !== undefined) L.name = String(a.name);
      if (a.visible !== undefined) L.visible = !!a.visible;
      if (a.opacity !== undefined) L.opacity = Math.max(0, Math.min(1, Number(a.opacity)));
    },
  },
  move_layer: {
    kind: 'doc',
    fn(s, a) {
      const i = s.layerIndex(a.layer), to = Math.max(0, Math.min(s.layers.length - 1, int(a.to, 'to')));
      s.layers.splice(to, 0, s.layers.splice(i, 1)[0]);
      for (const fr of s.frames) fr.cels.splice(to, 0, fr.cels.splice(i, 1)[0]);
    },
  },
  merge_down: {
    kind: 'doc',
    fn(s, a) {
      const i = s.layerIndex(a.layer);
      if (i === 0) throw new Error('bottom layer cannot be merged down');
      for (const fr of s.frames) {
        fr.cels[i - 1] = new Uint8Array(composite([{ visible: true, opacity: 1 }, s.layers[i]], [fr.cels[i - 1], fr.cels[i]], s.width, s.height));
        fr.cels.splice(i, 1);
      }
      s.layers.splice(i, 1);
    },
  },
  add_frame: {
    kind: 'doc',
    fn(s, a) {
      const idx = a.index === undefined ? s.frames.length : Math.max(0, Math.min(s.frames.length, int(a.index)));
      const src = a.copy_from !== undefined && a.copy_from !== null ? s.frames[s.frameIndex(a.copy_from)] : null;
      const count = Math.max(1, int(a.count ?? 1));
      for (let k = 0; k < count; k++) {
        s.frames.splice(idx + k, 0, {
          id: uid(),
          duration: a.duration ?? src?.duration ?? s.frames[s.frames.length - 1]?.duration ?? 100,
          cels: s.layers.map((_, l) => (src ? src.cels[l].slice() : s.blank())),
        });
      }
      for (const t of s.tags) {
        if (t.from >= idx) t.from += count;
        if (t.to >= idx) t.to += count;
      }
      return { frame: idx, frames: s.frames.length };
    },
  },
  delete_frame: {
    kind: 'doc',
    fn(s, a) {
      if (s.frames.length === 1) throw new Error('cannot delete the only frame');
      const i = s.frameIndex(a.frame);
      s.frames.splice(i, 1);
      s.tags = s.tags
        .map((t) => ({ ...t, from: t.from > i ? t.from - 1 : t.from, to: t.to >= i ? t.to - 1 : t.to }))
        .filter((t) => t.to >= t.from && t.to >= 0);
    },
  },
  move_frame: {
    kind: 'doc',
    fn(s, a) {
      const i = s.frameIndex(a.frame), to = Math.max(0, Math.min(s.frames.length - 1, int(a.to, 'to')));
      s.frames.splice(to, 0, s.frames.splice(i, 1)[0]);
    },
  },
  set_frame_duration: {
    kind: 'doc',
    fn(s, a) {
      const list = a.frames ?? (a.frame !== undefined ? [a.frame] : s.frames.map((_, i) => i));
      for (const f of list) s.frames[s.frameIndex(f)].duration = Math.max(10, int(a.duration, 'duration'));
    },
  },
  set_tags: {
    kind: 'doc',
    fn(s, a) {
      s.tags = (a.tags || []).map((t) => {
        const from = s.frameIndex(t.from), to = s.frameIndex(t.to ?? t.from);
        if (to < from) throw new Error(`tag "${t.name}": to < from`);
        return { name: String(t.name), from, to, color: t.color || '#29adff' };
      });
    },
  },
  set_palette: {
    kind: 'doc',
    fn(s, a) { s.palette = (a.colors || []).map((c) => toHex(parseColor(c))); },
  },
};

// Batch-friendly aliases (MCP tool names → ops).
const ALIASES = { draw_pixels: 'set_pixels', resize: 'resize_canvas', scale: 'scale_sprite', duration: 'set_frame_duration' };

function resolveOp(entry) {
  let { op, ...args } = entry;
  if (op === 'transform') { op = args.action; delete args.action; }
  op = ALIASES[op] || op;
  const def = OPS[op];
  if (!def || op === 'batch') throw new Error(`unknown op "${entry.op}"`);
  return { op, def, args };
}

export function needsTrust(op, args = {}) {
  if (op === 'batch') return (args.ops || []).some((e) => { try { const r = resolveOp(e); return needsTrust(r.op, r.args); } catch { return false; } });
  return !!OPS[op]?.trusted?.(args);
}

const entryBytes = (e) => (e.type === 'cel' ? e.data.length
  : e.type === 'cels' ? e.cels.reduce((n, c) => n + c.data.length, 0)
    : e.data.frames.reduce((n, f) => n + f.cels.reduce((m, c) => m + c.length, 0), 0));

// ---------------------------------------------------------------------------

export class Store extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    this.backupDir = path.join(path.dirname(dir), 'backups');
    this.trashDir = path.join(path.dirname(dir), 'trash');
    this.sprites = new Map();
    this.saveTimers = new Map();
    this.lastBackup = new Map();
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const s = Sprite.fromJSON(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
        this.sprites.set(s.id, s);
      } catch (e) {
        console.error(`[store] failed to load ${f}: ${e.message}`);
      }
    }
  }

  list() {
    return [...this.sprites.values()]
      .sort((a, b) => b.updated - a.updated)
      .map((s) => ({ id: s.id, name: s.name, width: s.width, height: s.height, frames: s.frames.length, layers: s.layers.length, updated: s.updated }));
  }

  get(idOrName) {
    if (this.sprites.has(idOrName)) return this.sprites.get(idOrName);
    const key = String(idOrName).toLowerCase();
    for (const s of this.sprites.values()) if (s.name.toLowerCase() === key) return s;
    throw new Error(`sprite "${idOrName}" not found. Use list_sprites to see available sprites.`);
  }

  uniqueId(name) {
    const base = slug(name);
    let id = base, n = 2;
    while (this.sprites.has(id)) id = `${base}-${n++}`;
    return id;
  }

  create({ name = 'sprite', width = 32, height = 32, frames = 1, layers, background, palette, duration } = {}, source) {
    const s = new Sprite({ id: this.uniqueId(name), name, width: Number(width), height: Number(height) });
    if (palette) s.palette = palette.map((c) => toHex(parseColor(c)));
    if (layers && layers.length) {
      s.layers = layers.map((n) => ({ id: uid(), name: String(n), visible: true, opacity: 1 }));
    }
    s.frames = [];
    for (let i = 0; i < Math.max(1, frames); i++) {
      s.frames.push({ id: uid(), duration: duration || 100, cels: s.layers.map(() => s.blank()) });
    }
    if (background) {
      const c = s.color(background);
      for (const fr of s.frames) for (let i = 0; i < fr.cels[0].length; i += 4) fr.cels[0].set(c, i);
    }
    this.sprites.set(s.id, s);
    this.touch(s, { source, op: 'create' });
    this.emit('list');
    return s;
  }

  importPng({ name, path: p, png_base64, frame_width, frame_height, duration }, source) {
    const img = decodePng(png_base64 ? Buffer.from(png_base64, 'base64') : fs.readFileSync(p));
    const fw = frame_width || img.width, fh = frame_height || img.height;
    const cols = Math.floor(img.width / fw), rows = Math.floor(img.height / fh);
    if (!cols || !rows) throw new Error('frame size larger than image');
    const s = this.create({ name: name || (p ? path.basename(p, path.extname(p)) : 'imported'), width: fw, height: fh, frames: cols * rows, duration }, source);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cel = s.frames[r * cols + c].cels[0];
        for (let y = 0; y < fh; y++) {
          for (let x = 0; x < fw; x++) setPx(cel, fw, fh, x, y, getPx(img.rgba, img.width, img.height, c * fw + x, r * fh + y));
        }
      }
    }
    // Drop fully empty trailing frames of a sheet.
    while (s.frames.length > 1 && s.frames[s.frames.length - 1].cels[0].every((v, i) => i % 4 !== 3 || v === 0)) s.frames.pop();
    this.touch(s, { source, op: 'import' });
    return s;
  }

  duplicate(id, name, source) {
    const src = this.get(id);
    const s = Sprite.fromJSON({ ...src.toJSON(), id: this.uniqueId(name || src.name + ' copy'), name: name || src.name + ' copy' });
    this.sprites.set(s.id, s);
    this.touch(s, { source, op: 'duplicate' });
    this.emit('list');
    return s;
  }

  // Deleted sprites go to data/trash instead of being destroyed.
  remove(id) {
    const s = this.get(id);
    this.sprites.delete(s.id);
    clearTimeout(this.saveTimers.get(s.id));
    fs.mkdirSync(this.trashDir, { recursive: true });
    fs.writeFileSync(path.join(this.trashDir, `${s.id}-${Date.now()}.json`), JSON.stringify(s.toJSON()));
    fs.rmSync(path.join(this.dir, `${s.id}.json`), { force: true });
    this.emit('removed', s.id);
    this.emit('list');
  }

  snapshotEntry(s, kind, cels, label) {
    if (kind === 'doc') return { type: 'doc', data: s.snapshot(), label };
    if (kind === 'cel') {
      const [f, l] = cels[0];
      return { type: 'cel', f, l, data: s.frames[f].cels[l].slice(), label };
    }
    return { type: 'cels', cels: cels.map(([f, l]) => ({ f, l, data: s.frames[f].cels[l].slice() })), label };
  }

  // Swaps an entry with the current state; returns the inverse entry and the touched cels (null = whole doc).
  swapEntry(s, e) {
    if (e.type === 'cel') {
      const cur = s.frames[e.f].cels[e.l];
      const inv = { ...e, data: cur.slice() };
      cur.set(e.data);
      return [inv, [[e.f, e.l]]];
    }
    if (e.type === 'cels') {
      const inv = { ...e, cels: e.cels.map((c) => ({ ...c, data: s.frames[c.f].cels[c.l].slice() })) };
      for (const c of e.cels) s.frames[c.f].cels[c.l].set(c.data);
      return [inv, e.cels.map((c) => [c.f, c.l])];
    }
    const inv = { type: 'doc', data: s.snapshot(), label: e.label };
    s.restore(e.data);
    return [inv, null];
  }

  pushHistory(s, entry) {
    entry.bytes = entryBytes(entry);
    s.undoStack.push(entry);
    s.redoStack = [];
    let total = s.undoStack.reduce((n, e) => n + e.bytes, 0);
    while (s.undoStack.length > 1 && (s.undoStack.length > HISTORY_LIMIT || total > HISTORY_BYTES)) total -= s.undoStack.shift().bytes;
  }

  apply(id, op, args = {}, source = 'api') {
    const s = this.get(id);
    if (op === 'undo' || op === 'redo') {
      const from = op === 'undo' ? s.undoStack : s.redoStack;
      const to = op === 'undo' ? s.redoStack : s.undoStack;
      const steps = Math.max(1, int(args.steps ?? 1));
      let done = 0, touched = [];
      for (; done < steps && from.length; done++) {
        const [inv, t] = this.swapEntry(s, from.pop());
        inv.bytes = entryBytes(inv);
        to.push(inv);
        touched = touched && t ? [...touched, ...t] : null;
      }
      if (done) this.touch(s, { source, op, args, touched });
      return { [op === 'undo' ? 'undone' : 'redone']: done };
    }

    let run, kind, cels = [];
    if (op === 'batch') {
      const steps = (args.ops || []).map(resolveOp);
      if (!steps.length) throw new Error('batch needs at least one op');
      const kinds = steps.map((st) => (typeof st.def.kind === 'function' ? st.def.kind(st.args) : st.def.kind));
      kind = kinds.includes('doc') ? 'doc' : 'cels';
      if (kind === 'cels') {
        const seen = new Set();
        steps.forEach((st, i) => {
          const t = kinds[i] === 'cel' ? [[s.frameIndex(st.args.frame ?? 0), s.layerIndex(st.args.layer ?? 0)]] : targets(s, st.args);
          for (const c of t) if (!seen.has(c.join())) { seen.add(c.join()); cels.push(c); }
        });
      }
      run = () => steps.map((st, i) => {
        try { return st.def.fn(s, st.args) || {}; } catch (e) { throw new Error(`batch op #${i} (${st.op}): ${e.message}`); }
      });
    } else {
      const def = OPS[op];
      if (!def) throw new Error(`unknown op "${op}"`);
      kind = typeof def.kind === 'function' ? def.kind(args) : def.kind;
      if (kind === 'cel') cels = [[s.frameIndex(args.frame ?? 0), s.layerIndex(args.layer ?? 0)]];
      else if (kind === 'cels') cels = targets(s, args);
      run = () => def.fn(s, args) || {};
    }

    const entry = this.snapshotEntry(s, kind, cels, op);
    let result;
    try {
      result = run();
    } catch (e) {
      this.swapEntry(s, entry);
      throw e;
    }
    this.pushHistory(s, entry);
    this.touch(s, { source, op, args, touched: kind === 'doc' ? null : cels });
    if (op === 'rename' || kind === 'doc') this.emit('list');
    return result;
  }

  touch(s, info) {
    s.rev++;
    s.updated = Date.now();
    this.emit('change', s, { args: {}, touched: null, ...info });
    clearTimeout(this.saveTimers.get(s.id));
    this.saveTimers.set(s.id, setTimeout(() => this.save(s), 300));
  }

  save(s) {
    if (!this.sprites.has(s.id)) return;
    const file = path.join(this.dir, `${s.id}.json`);
    const json = JSON.stringify(s.toJSON());
    fs.writeFileSync(file + '.tmp', json);
    fs.renameSync(file + '.tmp', file);
    if (Date.now() - (this.lastBackup.get(s.id) || 0) > BACKUP_INTERVAL) this.backup(s.id, json);
  }

  // Rolling version history: data/backups/<id>/<timestamp>.json, newest BACKUP_KEEP kept.
  backup(id, json) {
    this.lastBackup.set(id, Date.now());
    const dir = path.join(this.backupDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`), json);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) fs.rmSync(path.join(dir, f), { force: true });
  }

  listBackups(id) {
    const dir = path.join(this.backupDir, this.get(id).id);
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse() : [];
  }

  restoreBackup(id, file, source) {
    const s = this.get(id);
    const name = path.basename(file);
    const j = JSON.parse(fs.readFileSync(path.join(this.backupDir, s.id, name), 'utf8'));
    const entry = this.snapshotEntry(s, 'doc', [], 'restore_backup');
    const b = Sprite.fromJSON(j);
    s.restore({ name: b.name, width: b.width, height: b.height, palette: b.palette, tags: b.tags, layers: b.layers, frames: b.frames });
    this.pushHistory(s, entry);
    this.touch(s, { source, op: 'restore_backup' });
    this.emit('list');
    return s.meta();
  }

  flush() {
    for (const [id, t] of this.saveTimers) {
      clearTimeout(t);
      if (this.sprites.has(id)) this.save(this.sprites.get(id));
    }
  }
}
