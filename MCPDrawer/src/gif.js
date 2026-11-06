// Minimal animated GIF89a encoder. Index 0 is reserved for transparency (alpha < 128).

function buildPalette(frames) {
  const map = new Map();
  for (const { rgba } of frames) {
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] < 128) continue;
      const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
      if (!map.has(key)) map.set(key, map.size + 1);
      if (map.size > 255) break;
    }
  }
  if (map.size <= 255) {
    const colors = [[0, 0, 0], ...[...map.keys()].map((k) => [k >> 16, (k >> 8) & 255, k & 255])];
    return { colors, index: (r, g, b) => map.get((r << 16) | (g << 8) | b) };
  }
  // Too many colors: fall back to a 6x7x6 color cube.
  const colors = [[0, 0, 0]];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) {
    colors.push([Math.round((r * 255) / 5), Math.round((g * 255) / 6), Math.round((b * 255) / 5)]);
  }
  return { colors, index: (r, g, b) => 1 + Math.round((r * 5) / 255) * 42 + Math.round((g * 6) / 255) * 6 + Math.round((b * 5) / 255) };
}

function lzw(indices, minCodeSize) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1, next = eoi + 1, dict = new Map();
  const out = [];
  let cur = 0, curBits = 0;
  const emit = (code) => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) { out.push(cur & 0xff); cur >>>= 8; curBits -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = (prefix << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      dict = new Map();
      codeSize = minCodeSize + 1;
      next = eoi + 1;
    } else {
      if (next >= 1 << codeSize) codeSize++;
      dict.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (curBits > 0) out.push(cur & 0xff);
  const blocks = [];
  for (let i = 0; i < out.length; i += 255) {
    const n = Math.min(255, out.length - i);
    blocks.push(n);
    for (let k = 0; k < n; k++) blocks.push(out[i + k]);
  }
  blocks.push(0);
  return blocks;
}

const u16 = (v) => [v & 255, (v >> 8) & 255];

// frames: [{rgba, duration(ms)}], all w*h.
export function encodeGif(frames, w, h, loops = 0) {
  const { colors, index } = buildPalette(frames);
  let bits = 1;
  while (1 << bits < colors.length) bits++;
  const bytes = [...Buffer.from('GIF89a'), ...u16(w), ...u16(h), 0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0];
  for (let i = 0; i < 1 << bits; i++) bytes.push(...(colors[i] || [0, 0, 0]));
  bytes.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, ...u16(loops), 0x00);
  const minCode = Math.max(2, bits);
  for (const f of frames) {
    const delay = Math.max(2, Math.round(f.duration / 10));
    bytes.push(0x21, 0xf9, 0x04, (2 << 2) | 1, ...u16(delay), 0, 0); // dispose: restore bg, transparent idx 0
    bytes.push(0x2c, 0, 0, 0, 0, ...u16(w), ...u16(h), 0);
    const idx = new Uint8Array(w * h);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) idx[p] = f.rgba[i + 3] < 128 ? 0 : index(f.rgba[i], f.rgba[i + 1], f.rgba[i + 2]);
    bytes.push(minCode);
    for (const b of lzw(idx, minCode)) bytes.push(b);
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}
