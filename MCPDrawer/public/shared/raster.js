// Shared pixel primitives — used by both the browser editor and the Node server.
// Pixel buffers are RGBA Uint8Array / Uint8ClampedArray of size w*h*4, straight alpha.

export const TRANSPARENT = [0, 0, 0, 0];

export function parseColor(c) {
  if (Array.isArray(c)) {
    const [r, g, b, a = 255] = c;
    return [r | 0, g | 0, b | 0, a | 0];
  }
  if (c === null || c === undefined) throw new Error('color is required');
  const s = String(c).trim().toLowerCase();
  if (s === 'transparent' || s === 'none' || s === 'clear') return [0, 0, 0, 0];
  const m = s.replace(/^#/, '');
  if (!/^[0-9a-f]+$/.test(m)) throw new Error(`bad color "${c}" (use #rgb, #rrggbb, #rrggbbaa or "transparent")`);
  if (m.length === 3 || m.length === 4) {
    const v = [...m].map((ch) => parseInt(ch + ch, 16));
    return [v[0], v[1], v[2], v.length === 4 ? v[3] : 255];
  }
  if (m.length === 6 || m.length === 8) {
    return [
      parseInt(m.slice(0, 2), 16),
      parseInt(m.slice(2, 4), 16),
      parseInt(m.slice(4, 6), 16),
      m.length === 8 ? parseInt(m.slice(6, 8), 16) : 255,
    ];
  }
  throw new Error(`bad color "${c}" (use #rgb, #rrggbb, #rrggbbaa or "transparent")`);
}

export function toHex(rgba) {
  const [r, g, b, a] = rgba;
  if (a === 0) return 'transparent';
  const h = (v) => v.toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b) + (a < 255 ? h(a) : '');
}

export function getPx(buf, w, h, x, y) {
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const i = (y * w + x) * 4;
  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
}

export function setPx(buf, w, h, x, y, rgba) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  buf[i] = rgba[0];
  buf[i + 1] = rgba[1];
  buf[i + 2] = rgba[2];
  buf[i + 3] = rgba[3];
}

export function linePoints(x0, y0, x1, y1) {
  const pts = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return pts;
}

function norm(x0, y0, x1, y1) {
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

// Inclusive corners.
export function rectPoints(x0, y0, x1, y1, fill) {
  [x0, y0, x1, y1] = norm(x0, y0, x1, y1);
  const pts = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (fill || y === y0 || y === y1 || x === x0 || x === x1) pts.push([x, y]);
    }
  }
  return pts;
}

// Ellipse inscribed in the inclusive bounding box.
export function ellipsePoints(x0, y0, x1, y1, fill) {
  [x0, y0, x1, y1] = norm(x0, y0, x1, y1);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rx = Math.max(0.5, (x1 - x0 + 1) / 2 - 0.25);
  const ry = Math.max(0.5, (y1 - y0 + 1) / 2 - 0.25);
  const inside = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const pts = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      if (fill || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) pts.push([x, y]);
    }
  }
  return pts;
}

const same = (buf, i, c) => buf[i] === c[0] && buf[i + 1] === c[1] && buf[i + 2] === c[2] && buf[i + 3] === c[3];
const sameRgba = (buf, i, c) => (buf[i + 3] === 0 && c[3] === 0) || same(buf, i, c);

// Returns number of changed pixels.
export function floodFill(buf, w, h, x, y, rgba, contiguous = true) {
  const target = getPx(buf, w, h, x, y);
  if (!target) return 0;
  if (sameRgba(buf, (y * w + x) * 4, rgba) && rgba[3] === target[3]) return 0;
  let n = 0;
  if (!contiguous) {
    for (let i = 0; i < w * h * 4; i += 4) {
      if (sameRgba(buf, i, target)) { buf.set(rgba, i); n++; }
    }
    return n;
  }
  const seen = new Uint8Array(w * h);
  const stack = [x, y];
  while (stack.length) {
    const py = stack.pop(), px = stack.pop();
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    const p = py * w + px;
    if (seen[p]) continue;
    seen[p] = 1;
    if (!sameRgba(buf, p * 4, target)) continue;
    buf.set(rgba, p * 4);
    n++;
    stack.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
  }
  return n;
}

// layers: [{visible, opacity}] bottom→top; cels: matching array of RGBA buffers.
export function composite(layers, cels, w, h, out) {
  out = out || new Uint8ClampedArray(w * h * 4);
  out.fill(0);
  for (let l = 0; l < layers.length; l++) {
    const L = layers[l];
    if (!L.visible || !cels[l]) continue;
    const op = L.opacity ?? 1;
    const src = cels[l];
    for (let i = 0; i < w * h * 4; i += 4) {
      const sa = (src[i + 3] / 255) * op;
      if (sa <= 0) continue;
      const da = out[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let k = 0; k < 3; k++) out[i + k] = (src[i + k] * sa + out[i + k] * da * (1 - sa)) / oa;
      out[i + 3] = oa * 255;
    }
  }
  return out;
}
