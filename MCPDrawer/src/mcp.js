#!/usr/bin/env node
// PixelForge MCP server (stdio). Talks to the PixelForge HTTP server, starting it if needed,
// so everything drawn here shows up live in the browser editor.
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PORT, HOME_DIR, VERSION, TOKEN_HEADER, readToken, computeBuild } from './config.js';
import { makeRamp } from '../public/shared/color.js';

const BASE = `http://127.0.0.1:${PORT}`;
const EDITOR_URL = `http://localhost:${PORT}`;
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const log = (...a) => process.stderr.write(`[pixelforge-mcp] ${a.join(' ')}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- HTTP server management

async function health() {
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    return j.app === 'pixelforge' ? j : null;
  } catch {
    return null;
  }
}

function startServer() {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  const out = fs.openSync(path.join(HOME_DIR, 'server.log'), 'a');
  spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    detached: true, stdio: ['ignore', out, out], windowsHide: true, env: process.env,
  }).unref();
}

let ready = false, ensuring = null;
function ensureServer() {
  if (ready) return Promise.resolve();
  ensuring ??= (async () => {
    let h = await health();
    // A server left running from older code: ask it to exit, then start the current one.
    const build = computeBuild();
    if (h && h.build !== build) {
      log(`server build ${h.build} is outdated (current ${build}), restarting it`);
      await fetch(`${BASE}/api/shutdown`, { method: 'POST', headers: { 'Content-Type': 'application/json', [TOKEN_HEADER]: readToken() || '' }, body: '{}' }).catch(() => {});
      for (let i = 0; i < 30 && (await health()); i++) await sleep(100);
      h = await health();
      if (h) log('old server did not stop; continuing with it');
    }
    if (!h) {
      startServer();
      for (let i = 0; i < 50 && !h; i++) { await sleep(150); h = await health(); }
      if (!h) throw new Error(`could not start the PixelForge server on port ${PORT} (see ${path.join(HOME_DIR, 'server.log')})`);
      log(`started editor server at ${EDITOR_URL}`);
    }
    ready = true;
  })().finally(() => { ensuring = null; });
  return ensuring;
}

async function call(method, p, body) {
  await ensureServer();
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', [TOKEN_HEADER]: readToken() || '' },
    body: body ? JSON.stringify(body) : method === 'POST' ? '{}' : undefined,
  }).catch((e) => { ready = false; throw e; });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return (r.headers.get('content-type') || '').startsWith('image/') ? Buffer.from(await r.arrayBuffer()) : r.json();
}

const sp = (s) => `/api/sprites/${encodeURIComponent(s)}`;
const op = (sprite, name, args) => call('POST', `${sp(sprite)}/op`, { op: name, args });
const meta = (sprite) => call('GET', `${sp(sprite)}?meta=1`);

// ---------------------------------------------------------------- previews

async function previewImage(a) {
  const m = await meta(a.sprite);
  const q = new URLSearchParams();
  const mode = a.mode || (a.tag ? 'sheet' : 'frame');
  let url;
  if (mode === 'frame') {
    const scale = a.scale || Math.max(1, Math.min(32, Math.floor(384 / Math.max(m.width, m.height))));
    q.set('frame', a.frame ?? 0);
    q.set('scale', scale);
    if (a.onion) q.set('onion', a.onion === true ? 'prev' : a.onion);
    url = `${sp(a.sprite)}/frame.png`;
  } else {
    let n = m.frames;
    if (a.tag) {
      const t = m.tags.find((x) => x.name.toLowerCase() === String(a.tag).toLowerCase());
      if (t) n = t.to - t.from + 1;
      q.set('tag', a.tag);
    }
    const cols = Math.min(n, a.columns || 8);
    const scale = a.scale || Math.max(1, Math.min(Math.floor(256 / Math.max(m.width, m.height)), Math.floor(1100 / (cols * m.width))));
    q.set('scale', scale);
    q.set('columns', cols);
    q.set('padding', Math.max(2, scale));
    url = `${sp(a.sprite)}/sheet.png`;
  }
  if (a.layer !== undefined) q.set('layer', a.layer);
  q.set('bg', a.background || 'checker');
  if (a.grid) q.set('grid', '1');
  const png = await call('GET', `${url}?${q}`);
  return { type: 'image', data: png.toString('base64'), mimeType: 'image/png' };
}

// ---------------------------------------------------------------- tool definitions

const S = {
  sprite: { type: 'string', description: 'Sprite id or name' },
  frame: { type: 'integer', minimum: 0, description: 'Frame index (0-based). Default 0' },
  layer: { type: ['integer', 'string'], description: 'Layer index (0 = bottom) or layer name. Default 0' },
  color: { type: ['string', 'integer'], description: 'Color: #rgb, #rrggbb, #rrggbbaa, "transparent", or a palette index (number or "p3")' },
  preview: { type: 'boolean', description: 'Return a preview image of the frame after the change' },
  all_frames: { type: 'boolean', description: 'Apply to every frame' },
  all_layers: { type: 'boolean', description: 'Apply to every layer' },
};
const target = { sprite: S.sprite, frame: S.frame, layer: S.layer };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

async function opResult(sprite, r, frame, preview) {
  const content = [{ type: 'text', text: `ok ${JSON.stringify(r.result)} (rev ${r.rev})` }];
  if (preview) content.push(await previewImage({ sprite, frame: frame ?? 0 }));
  return content;
}

// Drawing tools forward to a store op and can optionally attach a preview.
function drawTool(name, opName, description, props, required) {
  return {
    name, description,
    inputSchema: obj({ ...target, ...props, preview: S.preview }, ['sprite', ...required]),
    async run({ sprite, preview, ...rest }) {
      return opResult(sprite, await op(sprite, opName, rest), rest.frame, preview);
    },
  };
}

const TOOLS = [
  {
    name: 'list_sprites',
    description: 'List all sprites in the PixelForge editor.',
    inputSchema: obj({}),
    run: async () => JSON.stringify(await call('GET', '/api/sprites'), null, 1),
  },
  {
    name: 'create_sprite',
    description: 'Create a new sprite (and show it in the editor). Returns its id. Typical game sizes: 16x16, 32x32, 48x48, 64x64.',
    inputSchema: obj({
      name: { type: 'string' },
      width: { type: 'integer', minimum: 1, maximum: 1024 },
      height: { type: 'integer', minimum: 1, maximum: 1024 },
      frames: { type: 'integer', minimum: 1, description: 'Number of empty frames. Default 1' },
      layers: { type: 'array', items: { type: 'string' }, description: 'Layer names bottom→top, e.g. ["body","outline"]. Default one layer' },
      duration: { type: 'integer', description: 'Frame duration in ms. Default 100' },
      background: { type: 'string', description: 'Fill layer 0 with this color. Default transparent' },
      palette: { type: 'array', items: { type: 'string' }, description: 'Palette colors (hex). Default PICO-8. Palette indices can then be used as colors.' },
    }, ['name', 'width', 'height']),
    async run(a) {
      const m = await call('POST', '/api/sprites', a);
      await call('POST', '/api/focus', { id: m.id }).catch(() => {});
      return JSON.stringify(m, null, 1);
    },
  },
  {
    name: 'get_sprite',
    description: 'Get sprite info: size, layers, frame count, durations, tags, palette (with indices).',
    inputSchema: obj({ sprite: S.sprite }, ['sprite']),
    run: async (a) => JSON.stringify(await meta(a.sprite), null, 1),
  },
  {
    name: 'delete_sprite',
    description: 'Delete a sprite (it is moved to data/trash, recoverable by the user).',
    inputSchema: obj({ sprite: S.sprite }, ['sprite']),
    run: async (a) => (await call('DELETE', sp(a.sprite)), 'deleted (moved to trash)'),
  },
  {
    name: 'duplicate_sprite',
    description: 'Copy a sprite (all frames/layers) under a new name.',
    inputSchema: obj({ sprite: S.sprite, name: { type: 'string' } }, ['sprite']),
    run: async (a) => JSON.stringify(await call('POST', `${sp(a.sprite)}/duplicate`, { name: a.name }), null, 1),
  },
  drawTool('draw_ascii', 'draw_ascii',
    'BEST WAY to draw detailed pixel art. Paints a character grid onto a cel: each char in `rows` maps to a color via `legend`. '
    + '"." and " " are skipped (left unchanged); map a char to "transparent" to erase. Row 0 is the top. Legend values may be palette indices. '
    + 'Example: rows ["..KK..", ".KRRK.", "KRRRRK"], legend {"K":"#000000","R":"#ff004d"}.',
    {
      rows: { type: 'array', items: { type: 'string' }, description: 'Rows of characters, top to bottom' },
      legend: { type: 'object', additionalProperties: { type: ['string', 'integer'] }, description: 'char → color or palette index' },
      x: { type: 'integer', description: 'Left offset. Default 0' },
      y: { type: 'integer', description: 'Top offset. Default 0' },
    }, ['rows', 'legend']),
  drawTool('draw_pixels', 'set_pixels', 'Set individual pixels. pixels: [[x, y, color], ...] (color optional if `color` given).',
    {
      pixels: { type: 'array', items: { type: 'array', minItems: 2, maxItems: 3, items: { type: ['integer', 'string'] } } },
      color: S.color,
    }, ['pixels']),
  drawTool('draw_line', 'draw_line', 'Draw a 1px pixel-perfect line from (x1,y1) to (x2,y2), or a polyline through `points`.',
    {
      x1: { type: 'integer' }, y1: { type: 'integer' }, x2: { type: 'integer' }, y2: { type: 'integer' },
      points: { type: 'array', items: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 }, description: 'Polyline [[x,y],...] instead of x1..y2' },
      color: S.color,
    }, ['color']),
  drawTool('draw_rect', 'draw_rect', 'Draw a rectangle (outline or filled). x,y = top-left.',
    { x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' }, color: S.color, filled: { type: 'boolean' } },
    ['x', 'y', 'width', 'height', 'color']),
  drawTool('draw_ellipse', 'draw_ellipse', 'Draw an ellipse/circle inscribed in the box x,y,width,height (outline or filled).',
    { x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' }, color: S.color, filled: { type: 'boolean' } },
    ['x', 'y', 'width', 'height', 'color']),
  drawTool('fill', 'fill', 'Bucket fill from (x,y). contiguous=false replaces that color everywhere on the cel.',
    { x: { type: 'integer' }, y: { type: 'integer' }, color: S.color, contiguous: { type: 'boolean' } }, ['x', 'y', 'color']),
  drawTool('clear', 'clear', 'Clear a cel (or a rect region of it) to transparent, or fill it with `color`.',
    { color: S.color, x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' } }, []),
  {
    name: 'transform',
    description: 'Shift / flip / rotate pixels of a cel (or all frames/layers). action: shift (dx,dy,wrap), flip (direction), rotate (degrees: 90/180/270 clockwise, cropped to canvas).',
    inputSchema: obj({
      ...target,
      action: { type: 'string', enum: ['shift', 'flip', 'rotate'] },
      dx: { type: 'integer' }, dy: { type: 'integer' }, wrap: { type: 'boolean' },
      direction: { type: 'string', enum: ['horizontal', 'vertical'] },
      degrees: { type: 'integer', enum: [90, 180, 270, -90] },
      all_frames: S.all_frames, all_layers: S.all_layers, preview: S.preview,
    }, ['sprite', 'action']),
    async run({ sprite, preview, action, ...args }) {
      if (!['shift', 'flip', 'rotate'].includes(action)) throw new Error('action must be shift, flip or rotate');
      return opResult(sprite, await op(sprite, action, args), args.frame, preview);
    },
  },
  drawTool('replace_color', 'replace_color', 'Replace one color with another on a cel (or all frames/layers). Useful for palette swaps / recolors.',
    { from: S.color, to: S.color, tolerance: { type: 'integer', description: 'Per-channel tolerance 0-255. Default 0' }, all_frames: S.all_frames, all_layers: S.all_layers },
    ['from', 'to']),
  drawTool('outline', 'outline', 'Auto-outline: mode "outside" paints transparent pixels touching the shape; "inside" recolors the shape\'s edge pixels. diagonal=true also uses corners.',
    { color: S.color, mode: { type: 'string', enum: ['outside', 'inside'] }, diagonal: { type: 'boolean' }, all_frames: S.all_frames, all_layers: S.all_layers },
    ['color']),
  drawTool('copy_cel', 'copy_cel', 'Copy pixels from another cel (from_frame/from_layer) into the target frame/layer, optionally offset by dx,dy (offset copies only opaque pixels).',
    { from_frame: { type: 'integer' }, from_layer: S.layer, dx: { type: 'integer' }, dy: { type: 'integer' } }, ['from_frame']),
  drawTool('draw_image', 'draw_image', 'Stamp a PNG file from disk onto a cel at x,y.',
    { path: { type: 'string', description: 'Absolute path to a PNG' }, x: { type: 'integer' }, y: { type: 'integer' } }, ['path']),
  {
    name: 'batch',
    description: 'Run many drawing/frame operations on one sprite in a single call (one undo step, one editor update). '
      + 'Each op is {"op": name, ...args} where name is one of: draw_ascii, draw_pixels, draw_line, draw_rect, draw_ellipse, fill, clear, '
      + 'outline, replace_color, shift, flip, rotate, copy_cel, add_frame, delete_frame, move_frame, set_frame_duration, add_layer, '
      + 'update_layer, delete_layer, move_layer, merge_down, set_tags, set_palette, resize_canvas, scale_sprite. Args are the same as the '
      + 'single tools (frame/layer per op; add_frame takes index/copy_from/count/duration). Ideal for drawing all frames of an animation at once.',
    inputSchema: obj({
      sprite: S.sprite,
      ops: { type: 'array', items: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'] }, minItems: 1 },
      preview: { type: 'string', enum: ['none', 'frame', 'sheet'], description: 'Attach a preview afterwards. Default none' },
      preview_frame: { type: 'integer' },
    }, ['sprite', 'ops']),
    async run({ sprite, ops, preview, preview_frame }) {
      const r = await op(sprite, 'batch', { ops });
      const content = [{ type: 'text', text: `ok ${ops.length} ops (rev ${r.rev}) ${JSON.stringify(r.result)}` }];
      if (preview && preview !== 'none') content.push(await previewImage({ sprite, mode: preview, frame: preview_frame ?? 0 }));
      return content;
    },
  },
  {
    name: 'manage_layers',
    description: 'Layer operations. action: add (name, index), delete (layer), update (layer + name/visible/opacity 0..1), move (layer, to), merge_down (layer).',
    inputSchema: obj({
      sprite: S.sprite, action: { type: 'string', enum: ['add', 'delete', 'update', 'move', 'merge_down'] },
      layer: S.layer, name: { type: 'string' }, index: { type: 'integer' }, to: { type: 'integer' },
      visible: { type: 'boolean' }, opacity: { type: 'number', minimum: 0, maximum: 1 },
    }, ['sprite', 'action']),
    async run({ sprite, action, ...a }) {
      const map = { add: 'add_layer', delete: 'delete_layer', update: 'update_layer', move: 'move_layer', merge_down: 'merge_down' };
      const r = await op(sprite, map[action], a);
      return `ok ${JSON.stringify(r.result)}; layers now: ${(await meta(sprite)).layers.join(', ')}`;
    },
  },
  {
    name: 'manage_frames',
    description: 'Frame operations. action: add (index, copy_from to duplicate a frame, count, duration), delete (frame), move (frame, to), duration (duration ms for `frames` list, `frame`, or all if neither).',
    inputSchema: obj({
      sprite: S.sprite, action: { type: 'string', enum: ['add', 'delete', 'move', 'duration'] },
      frame: S.frame, index: { type: 'integer' }, copy_from: { type: 'integer' }, count: { type: 'integer', minimum: 1 },
      to: { type: 'integer' }, duration: { type: 'integer' }, frames: { type: 'array', items: { type: 'integer' } },
    }, ['sprite', 'action']),
    async run({ sprite, action, ...a }) {
      const map = { add: 'add_frame', delete: 'delete_frame', move: 'move_frame', duration: 'set_frame_duration' };
      const r = await op(sprite, map[action], a);
      const m = await meta(sprite);
      return `ok ${JSON.stringify(r.result)}; ${m.frames} frames, durations ${JSON.stringify(m.durations)}`;
    },
  },
  {
    name: 'set_tags',
    description: 'Replace the animation tags (named frame ranges like idle/walk/attack, inclusive, 0-based). Tags become Unity AnimationClips and are exported with sprite sheets.',
    inputSchema: obj({
      sprite: S.sprite,
      tags: { type: 'array', items: obj({ name: { type: 'string' }, from: { type: 'integer' }, to: { type: 'integer' }, color: { type: 'string' } }, ['name', 'from', 'to']) },
    }, ['sprite', 'tags']),
    run: async ({ sprite, tags }) => `ok (rev ${(await op(sprite, 'set_tags', { tags })).rev})`,
  },
  {
    name: 'set_palette',
    description: 'Set the sprite palette shown in the editor (list of hex colors). Palette entries can then be used as colors by index (3 or "p3").',
    inputSchema: obj({ sprite: S.sprite, colors: { type: 'array', items: { type: 'string' } } }, ['sprite', 'colors']),
    run: async ({ sprite, colors }) => `ok (rev ${(await op(sprite, 'set_palette', { colors })).rev})`,
  },
  {
    name: 'generate_ramp',
    description: 'Make hue-shifted color ramps (dark→light; shadows drift to blue/purple, highlights to yellow) from base colors. '
      + 'With `sprite`, the ramps are appended to (or replace) its palette so you can paint by palette index.',
    inputSchema: obj({
      colors: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Base colors, one ramp each' },
      steps: { type: 'integer', minimum: 2, maximum: 9, description: 'Colors per ramp. Default 5' },
      hue_shift: { type: 'number', description: 'Max hue shift in degrees at the ends. Default 20' },
      contrast: { type: 'number', description: 'Lightness spread multiplier. Default 1' },
      sprite: S.sprite,
      replace_palette: { type: 'boolean', description: 'Replace instead of append. Default false' },
    }, ['colors']),
    async run({ colors, steps, hue_shift, contrast, sprite, replace_palette }) {
      const ramps = colors.map((c) => makeRamp(c, { steps: steps ?? 5, hueShift: hue_shift ?? 20, contrast: contrast ?? 1 }));
      let text = ramps.map((r, i) => `${colors[i]}: ${r.join(' ')}`).join('\n');
      if (sprite) {
        const m = await meta(sprite);
        const existing = replace_palette ? [] : m.palette.map((p) => p.split('=')[1]);
        const start = existing.length;
        await op(sprite, 'set_palette', { colors: [...existing, ...ramps.flat()] });
        text += `\npalette updated; ramp colors start at index p${start}`;
      }
      return text;
    },
  },
  {
    name: 'resize',
    description: 'mode "canvas": change canvas size keeping pixels (anchor: center, top-left, top, top-right, left, right, bottom-left, bottom, bottom-right). mode "scale": nearest-neighbor scale to width/height or by factor.',
    inputSchema: obj({
      sprite: S.sprite, mode: { type: 'string', enum: ['canvas', 'scale'] },
      width: { type: 'integer' }, height: { type: 'integer' }, factor: { type: 'number' }, anchor: { type: 'string' },
    }, ['sprite', 'mode']),
    async run({ sprite, mode, ...a }) {
      await op(sprite, mode === 'scale' ? 'scale_sprite' : 'resize_canvas', a);
      const m = await meta(sprite);
      return `ok, now ${m.width}x${m.height}`;
    },
  },
  {
    name: 'undo',
    description: 'Undo the last change(s) to a sprite (history is shared with the user in the editor).',
    inputSchema: obj({ sprite: S.sprite, steps: { type: 'integer', minimum: 1 } }, ['sprite']),
    run: async ({ sprite, steps }) => JSON.stringify((await op(sprite, 'undo', { steps })).result),
  },
  {
    name: 'redo',
    description: 'Redo previously undone change(s).',
    inputSchema: obj({ sprite: S.sprite, steps: { type: 'integer', minimum: 1 } }, ['sprite']),
    run: async ({ sprite, steps }) => JSON.stringify((await op(sprite, 'redo', { steps })).result),
  },
  {
    name: 'preview',
    description: 'Look at the sprite as an image. mode "frame" (default) shows one frame enlarged; mode "sheet" shows all frames (or a tag\'s frames) side by side to review an animation. '
      + 'onion shows the previous frame (red tint) and/or next frame (blue tint) under the current one — use it when drawing animation poses.',
    inputSchema: obj({
      sprite: S.sprite, frame: S.frame, mode: { type: 'string', enum: ['frame', 'sheet'] }, tag: { type: 'string' },
      layer: { ...S.layer, description: 'Show only this layer' }, scale: { type: 'integer', minimum: 1, maximum: 64 },
      grid: { type: 'boolean', description: 'Overlay a pixel grid (helps counting pixels)' },
      onion: { type: ['boolean', 'string'], enum: [true, false, 'prev', 'next', 'both'], description: 'Onion skin for mode "frame"' },
      background: { type: 'string', description: '"checker" (default), "transparent" or a color' },
      columns: { type: 'integer' },
    }, ['sprite']),
    run: async (a) => [await previewImage(a)],
  },
  {
    name: 'read_pixels',
    description: 'Read pixels as an ASCII grid + legend (same format draw_ascii accepts; "." = transparent). Composite of visible layers unless `layer` is given. Optionally a region.',
    inputSchema: obj({ ...target, x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' } }, ['sprite']),
    async run(a) {
      const q = new URLSearchParams();
      for (const k of ['frame', 'layer', 'x', 'y', 'width', 'height']) if (a[k] !== undefined) q.set(k, a[k]);
      const r = await call('GET', `${sp(a.sprite)}/ascii?${q}`);
      return `region x=${r.x} y=${r.y} ${r.width}x${r.height}\nlegend: ${JSON.stringify(r.legend)}\n${r.rows.join('\n')}`;
    },
  },
  {
    name: 'export',
    description: 'Write the sprite to disk. format: "sheet" = sprite sheet PNG + JSON with frame rects/durations/tags (default), "png" = one frame, "frames" = one PNG per frame (name_0.png...), "apng" = animated PNG, "gif" = animated GIF, "json" = native PixelForge document. path: a file path or a folder (file named after the sprite id). For Unity projects prefer export_unity.',
    inputSchema: obj({
      sprite: S.sprite, path: { type: 'string', description: 'Absolute file or folder path' },
      format: { type: 'string', enum: ['sheet', 'png', 'frames', 'apng', 'gif', 'json'] },
      scale: { type: 'integer', minimum: 1, description: 'Integer upscale. Default 1 (recommended for game engines)' },
      tag: { type: 'string', description: 'Only frames of this tag' }, frames: { type: 'array', items: { type: 'integer' } },
      frame: { type: 'integer', description: 'Frame for format "png"' },
      columns: { type: 'integer', description: 'Sheet columns. Default: all frames in one row' }, padding: { type: 'integer' },
      json: { type: 'boolean', description: 'Write the .json next to a sheet. Default true' },
    }, ['sprite', 'path']),
    run: async ({ sprite, ...a }) => `written:\n${(await call('POST', `${sp(sprite)}/export`, a)).written.join('\n')}`,
  },
  {
    name: 'export_unity',
    description: 'Export straight into a Unity project, ready to use: sprite sheet PNG + .meta with pixel-art import settings (Sprite, Multiple, sliced per frame, Point filter, no compression, no mipmaps, PPU) '
      + 'and one AnimationClip (.anim, SpriteRenderer.m_Sprite) per tag (or one clip for all frames). Re-exporting keeps GUIDs/sprite IDs, so scene references survive. '
      + 'After exporting, Unity picks the files up on refresh (if the Unity MCP is available you can trigger an asset refresh there).',
    inputSchema: obj({
      sprite: S.sprite,
      folder: { type: 'string', description: 'Absolute folder inside the project\'s Assets, e.g. D:/Game/Assets/Sprites/Hero' },
      name: { type: 'string', description: 'Base file name. Default: sprite id' },
      ppu: { type: 'integer', minimum: 1, description: 'Pixels per unit. Keep the same for all sprites of the game. Default 16' },
      pivot: { type: 'string', enum: ['center', 'bottom', 'bottom-left', 'top-left', 'top', 'top-right', 'left', 'right', 'bottom-right'], description: 'Default center; "bottom" suits characters' },
      clips: { type: 'boolean', description: 'Write .anim clips. Default true' },
      loop: { type: 'boolean', description: 'Clips loop. Default true' },
      columns: { type: 'integer', description: 'Sheet columns. Default min(frames, 16)' },
    }, ['sprite', 'folder']),
    async run({ sprite, ...a }) {
      const r = await call('POST', `${sp(sprite)}/unity`, a);
      return `Unity export done (PPU ${r.ppu}). Sprites: ${r.sprites.join(', ')}\nClips: ${r.clips.join(', ') || 'none'}\nFiles:\n${r.written.join('\n')}`;
    },
  },
  {
    name: 'import_png',
    description: 'Create a new sprite from a PNG on disk. Give frame_width/frame_height to slice a sprite sheet (row-major) into frames.',
    inputSchema: obj({
      path: { type: 'string' }, name: { type: 'string' },
      frame_width: { type: 'integer' }, frame_height: { type: 'integer' }, duration: { type: 'integer' },
    }, ['path']),
    run: async (a) => JSON.stringify(await call('POST', '/api/import', a), null, 1),
  },
  {
    name: 'backups',
    description: 'Automatic version history of a sprite (saved at most every 2 minutes, last 20 kept). action "list" shows versions, "restore" brings one back (undoable).',
    inputSchema: obj({ sprite: S.sprite, action: { type: 'string', enum: ['list', 'restore'] }, file: { type: 'string', description: 'Version file name from "list"' } }, ['sprite', 'action']),
    async run({ sprite, action, file }) {
      if (action === 'list') return (await call('GET', `${sp(sprite)}/backups`)).join('\n') || 'no backups yet';
      return JSON.stringify(await call('POST', `${sp(sprite)}/backups`, { file }), null, 1);
    },
  },
  {
    name: 'get_editor_state',
    description: 'What the user currently has open in the browser editor (sprite, frame, layer, colors, tool, selection rectangle) and whether the editor is open at all.',
    inputSchema: obj({}),
    async run() {
      const r = await call('GET', '/api/editor-state');
      return JSON.stringify({ editor_url: EDITOR_URL, open_tabs: r.clients, ...r }, null, 1);
    },
  },
  {
    name: 'open_editor',
    description: 'Show a sprite/frame in the user\'s editor. If no editor tab is open (or open_browser=true) the browser is launched at the editor URL.',
    inputSchema: obj({ sprite: S.sprite, frame: S.frame, layer: S.layer, open_browser: { type: 'boolean' } }),
    async run(a) {
      const h = await call('GET', '/api/health');
      if (a.open_browser || !h.clients) openBrowser(EDITOR_URL);
      if (a.sprite) {
        if (!h.clients) await sleep(2500);
        await call('POST', '/api/focus', { id: a.sprite, frame: a.frame, layer: a.layer });
      }
      return `editor: ${EDITOR_URL}`;
    },
  },
];

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

const INSTRUCTIONS = `PixelForge: a pixel-art sprite & animation editor. Everything you draw appears live in the user's browser editor at ${EDITOR_URL}.
Conventions: x grows right, y grows down, (0,0) is top-left; frames and layers are 0-based; layer 0 is the bottom layer. Pixels are drawn as-is (no anti-aliasing).
Colors: hex (#rrggbb / #rrggbbaa), "transparent", or a palette index (3 or "p3") — get_sprite lists the palette with indices.
Workflow for game sprites:
1. create_sprite (e.g. 32x32, maybe layers ["body","details"]); generate_ramp with the sprite to build a shaded palette.
2. Draw with draw_ascii (best for detailed art: one char per pixel + legend), plus draw_rect / draw_ellipse / draw_line / fill for big shapes; outline adds a clean outline.
3. Check your work with preview (grid=true to count pixels) or read_pixels, fix with more draw calls; undo if needed.
4. Animation: use batch to add frames (add_frame with copy_from) and draw every pose in one call; preview with onion=true while posing; set_tags names ranges (idle 0-1, walk 2-5); preview mode "sheet" reviews all frames.
5. For Unity use export_unity into the project's Assets folder (sliced sheet + import settings + one .anim per tag). Otherwise export.
Use a consistent limited palette. If the user mentions "the sprite I have open" or "my selection", call get_editor_state. open_editor shows the editor to the user.`;

// ---------------------------------------------------------------- JSON-RPC over stdio

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notification
  try {
    let result;
    if (method === 'initialize') {
      const v = params?.protocolVersion;
      result = {
        protocolVersion: PROTOCOLS.includes(v) ? v : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'pixelforge', version: VERSION },
        instructions: INSTRUCTIONS,
      };
      ensureServer().catch((e) => log(e.message));
    } else if (method === 'ping') {
      result = {};
    } else if (method === 'tools/list') {
      result = { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
    } else if (method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) throw Object.assign(new Error(`unknown tool ${params?.name}`), { code: -32602 });
      try {
        const out = await tool.run(params.arguments || {});
        result = { content: typeof out === 'string' ? [{ type: 'text', text: out }] : out };
      } catch (e) {
        result = { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    } else if (method === 'resources/list') {
      result = { resources: [] };
    } else if (method === 'prompts/list') {
      result = { prompts: [] };
    } else {
      throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
    }
    send({ jsonrpc: '2.0', id, result });
  } catch (e) {
    send({ jsonrpc: '2.0', id, error: { code: e.code || -32603, message: e.message } });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
  for (const m of Array.isArray(msg) ? msg : [msg]) handle(m);
});
rl.on('close', () => process.exit(0));
