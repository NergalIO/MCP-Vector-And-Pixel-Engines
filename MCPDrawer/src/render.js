// Turns sprites into scaled RGBA images, sprite sheets and ASCII maps.
import { parseColor, toHex } from '../public/shared/raster.js';

export function frameList(sprite, { tag, frames } = {}) {
  if (frames && frames.length) return frames.map((f) => sprite.frameIndex(f));
  if (tag) {
    const t = sprite.tags.find((x) => x.name.toLowerCase() === String(tag).toLowerCase());
    if (!t) throw new Error(`no tag "${tag}" (tags: ${sprite.tags.map((x) => x.name).join(', ') || 'none'})`);
    const out = [];
    for (let i = t.from; i <= t.to; i++) out.push(i);
    return out;
  }
  return sprite.frames.map((_, i) => i);
}

function backgroundFn(bg, scale) {
  if (!bg || bg === 'transparent' || bg === 'none') return null;
  if (bg === 'checker') {
    const cell = Math.max(8, scale * 2);
    return (x, y) => ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? [204, 204, 212, 255] : [238, 238, 244, 255]);
  }
  const c = parseColor(bg);
  return () => c;
}

// Draws a sprite-sized RGBA image into `out` at (ox, oy), scaled by `scale`.
function blit(out, OW, src, w, h, scale, ox, oy) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const a = src[si + 3];
      if (!a) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const di = ((oy + y * scale + dy) * OW + ox + x * scale + dx) * 4;
          if (a === 255 || out[di + 3] === 0) {
            out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = a;
          } else {
            const sa = a / 255, da = out[di + 3] / 255, oa = sa + da * (1 - sa);
            for (let k = 0; k < 3; k++) out[di + k] = (src[si + k] * sa + out[di + k] * da * (1 - sa)) / oa;
            out[di + 3] = oa * 255;
          }
        }
      }
    }
  }
}

function fillBg(out, W, H, bgFn) {
  if (!bgFn) return;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.set(bgFn(x, y), (y * W + x) * 4);
}

function drawGrid(out, W, H, scale, ox, oy, w, h) {
  if (scale < 4) return;
  for (let y = 0; y < h * scale; y++) {
    for (let x = 0; x < w * scale; x++) {
      if (x % scale && y % scale) continue;
      const i = ((oy + y) * W + ox + x) * 4;
      out[i] = out[i] * 0.75; out[i + 1] = out[i + 1] * 0.75; out[i + 2] = out[i + 2] * 0.75;
      out[i + 3] = Math.max(out[i + 3], 60);
    }
  }
}

export function autoScale(sprite, target = 384) {
  return Math.max(1, Math.min(32, Math.floor(target / Math.max(sprite.width, sprite.height))));
}

// Neighbor frame tinted and faded, for onion-skin previews.
function ghost(sprite, f, layer, tint, alpha) {
  const img = sprite.compositeFrame(f, layer);
  for (let i = 0; i < img.length; i += 4) {
    if (!img[i + 3]) continue;
    for (let k = 0; k < 3; k++) img[i + k] = img[i + k] * 0.25 + tint[k] * 0.75;
    img[i + 3] *= alpha;
  }
  return img;
}

export function renderFrame(sprite, frame, { scale = 1, layer, background, grid, onion } = {}) {
  const W = sprite.width * scale, H = sprite.height * scale;
  const out = new Uint8Array(W * H * 4);
  fillBg(out, W, H, backgroundFn(background, scale));
  if (onion) {
    const f = sprite.frameIndex(frame), n = sprite.frames.length;
    const ghosts = [];
    if (onion !== 'next') ghosts.push([(f - 1 + n) % n, [255, 0, 77], 0.45]);
    if (onion === 'next' || onion === 'both') ghosts.push([(f + 1) % n, [41, 173, 255], 0.35]);
    for (const [g, tint, a] of ghosts) if (g !== f) blit(out, W, ghost(sprite, g, layer, tint, a), sprite.width, sprite.height, scale, 0, 0);
  }
  blit(out, W, sprite.compositeFrame(frame, layer), sprite.width, sprite.height, scale, 0, 0);
  if (grid) drawGrid(out, W, H, scale, 0, 0, sprite.width, sprite.height);
  return { rgba: out, width: W, height: H };
}

export function renderSheet(sprite, { scale = 1, columns, padding = 0, background, layer, tag, frames, grid } = {}) {
  const list = frameList(sprite, { tag, frames });
  const cols = Math.max(1, Math.min(list.length, columns || list.length));
  const rows = Math.ceil(list.length / cols);
  const fw = sprite.width * scale, fh = sprite.height * scale;
  const W = cols * fw + (cols - 1) * padding, H = rows * fh + (rows - 1) * padding;
  const out = new Uint8Array(W * H * 4);
  const bgFn = backgroundFn(background, scale);
  const rects = list.map((f, i) => {
    const x = (i % cols) * (fw + padding), y = Math.floor(i / cols) * (fh + padding);
    if (bgFn) for (let yy = 0; yy < fh; yy++) for (let xx = 0; xx < fw; xx++) out.set(bgFn(xx, yy), ((y + yy) * W + x + xx) * 4);
    blit(out, W, sprite.compositeFrame(f, layer), sprite.width, sprite.height, scale, x, y);
    if (grid) drawGrid(out, W, H, scale, x, y, sprite.width, sprite.height);
    return { frame: f, x, y, w: fw, h: fh, duration: sprite.frames[f].duration };
  });
  return { rgba: out, width: W, height: H, rects, columns: cols, rows };
}

export function sheetMeta(sprite, sheet, scale, imageName) {
  const first = sheet.rects[0]?.frame ?? 0;
  return {
    image: imageName,
    size: { w: sheet.width, h: sheet.height },
    frameSize: { w: sprite.width * scale, h: sprite.height * scale },
    columns: sheet.columns, rows: sheet.rows, scale,
    frames: sheet.rects,
    tags: sprite.tags
      .filter((t) => sheet.rects.some((r) => r.frame >= t.from && r.frame <= t.to))
      .map((t) => ({ name: t.name, from: t.from - first, to: t.to - first })),
  };
}

const ASCII_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#@$%&*+=?!<>^~';

export function toAscii(sprite, frame, { layer, x = 0, y = 0, width, height } = {}) {
  const img = sprite.compositeFrame(frame, layer);
  const w = Math.min(width ?? sprite.width, sprite.width - x), h = Math.min(height ?? sprite.height, sprite.height - y);
  const legend = {}, byColor = new Map();
  const rows = [];
  for (let yy = y; yy < y + h; yy++) {
    let row = '';
    for (let xx = x; xx < x + w; xx++) {
      const i = (yy * sprite.width + xx) * 4;
      if (img[i + 3] === 0) { row += '.'; continue; }
      const hex = toHex([img[i], img[i + 1], img[i + 2], img[i + 3]]);
      let ch = byColor.get(hex);
      if (!ch) {
        ch = ASCII_CHARS[byColor.size] || '?';
        byColor.set(hex, ch);
        legend[ch] = hex;
      }
      row += ch;
    }
    rows.push(row);
  }
  return { x, y, width: w, height: h, rows, legend };
}
