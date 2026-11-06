// Карты нормалей: PNG-кодек без зависимостей, карта высот → нормали, рельеф из альфы/яркости, превью освещения.
import { inflateSync, deflateSync } from 'node:zlib';
import { renderSVG } from '../engine/kontur.js';
import { svgToPng } from './render.mjs';

/* ============================== PNG ============================== */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** PNG → {width, height, data: Uint8Array RGBA}. 8 бит, все типы цвета, без interlace. */
export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Не PNG');
  let pos = 8, w, h, depth, ctype, inter, palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), d = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; inter = d[12]; }
    else if (type === 'PLTE') palette = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (inter) throw new Error('PNG с interlace не поддерживается');
  if (depth !== 8 && !(ctype === 3 && depth <= 8)) throw new Error(`PNG ${depth} бит/канал не поддерживается`);
  const raw = inflateSync(Buffer.concat(idat));
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const bpp = Math.max(1, (ch * depth) >> 3), stride = Math.ceil((w * ch * depth) / 8);
  const cur = new Uint8Array(stride), prev = new Uint8Array(stride);
  const out = new Uint8Array(w * h * 4);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[rp++];
    for (let i = 0; i < stride; i++) {
      const x = raw[rp++], a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v;
      switch (f) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: throw new Error('Неверный фильтр PNG');
      }
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (ctype === 6) { out[o] = cur[x * 4]; out[o + 1] = cur[x * 4 + 1]; out[o + 2] = cur[x * 4 + 2]; out[o + 3] = cur[x * 4 + 3]; }
      else if (ctype === 2) { out[o] = cur[x * 3]; out[o + 1] = cur[x * 3 + 1]; out[o + 2] = cur[x * 3 + 2]; out[o + 3] = 255; }
      else if (ctype === 0) { out[o] = out[o + 1] = out[o + 2] = cur[x]; out[o + 3] = 255; }
      else if (ctype === 4) { out[o] = out[o + 1] = out[o + 2] = cur[x * 2]; out[o + 3] = cur[x * 2 + 1]; }
      else {
        const bits = depth, per = 8 / bits, byte = cur[Math.floor(x / per)], idx = (byte >> (8 - bits * ((x % per) + 1))) & ((1 << bits) - 1);
        out[o] = palette[idx * 3]; out[o + 1] = palette[idx * 3 + 1]; out[o + 2] = palette[idx * 3 + 2]; out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
    prev.set(cur);
  }
  return { width: w, height: h, data: out };
}

/** RGBA → PNG Buffer. */
export function encodePNG({ width: w, height: h, data }) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 2; // фильтр Up — хорошо сжимает плавные карты
    for (let i = 0; i < stride; i++) raw[y * (stride + 1) + 1 + i] = (data[y * stride + i] - (y ? data[(y - 1) * stride + i] : 0)) & 0xff;
  }
  const chunk = (type, d) => {
    const b = Buffer.alloc(12 + d.length);
    b.writeUInt32BE(d.length, 0); b.write(type, 4, 'ascii'); d.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + d.length)), 8 + d.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ============================== поля ============================== */
function boxBlur(src, w, h, r) {
  if (r < 1) return src;
  r = Math.round(r);
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    const a = pass ? out : src, b = tmp;
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let x = -r; x <= r; x++) s += a[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[y * w + x] = s / (2 * r + 1);
        s += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = s / (2 * r + 1);
        s += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return out;
}
const luminance = (img) => {
  const { width: w, height: h, data } = img, L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
  return L;
};
/** Расстояние до края непрозрачной области (фаска 3-4, в пикселях). */
function distanceToEdge(alpha, w, h, thr = 0.5) {
  const INF = 1e9, d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = alpha[i] >= thr ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.4142, at(x + 1, y - 1) + 1.4142);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.4142, at(x - 1, y + 1) + 1.4142);
  }
  return d;
}
const PROFILES = { round: (u) => Math.sqrt(1 - (1 - u) * (1 - u)), linear: (u) => u, sharp: (u) => u * u, flat: () => 1, smooth: (u) => u * u * (3 - 2 * u) };

/** Рельеф для растрового изображения: фаска от края альфы + детали из яркости. */
export function heightFromImage(img, { bevel = 8, profile = 'round', depth = 0.6, base = 0.2, luma = 0.35, invertLuma = false, lumaBlur = 0 } = {}) {
  const { width: w, height: h, data } = img, n = w * h;
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = data[i * 4 + 3] / 255;
  const H = new Float32Array(n);
  const prof = PROFILES[profile] || PROFILES.round;
  const dist = bevel > 0 ? distanceToEdge(alpha, w, h) : null;
  let L = luma ? luminance(img) : null;
  if (L && lumaBlur) L = boxBlur(L, w, h, lumaBlur);
  for (let i = 0; i < n; i++) {
    if (alpha[i] < 0.02) { H[i] = 0; continue; }
    const b = dist ? prof(Math.min(1, dist[i] / bevel)) : 1;
    const l = L ? (invertLuma ? 1 - L[i] : L[i]) - 0.5 : 0;
    H[i] = base + depth * b + luma * l;
  }
  return { H, alpha, w, h };
}

/** Высоты → нормали (RGBA). */
export function normalsFromHeight(H, alpha, w, h, { strength = 3, blur = 1, yUp = true, invertX = false, detail = null, detailAmount = 0, detailRadius = 4 } = {}) {
  let F = blur ? boxBlur(H, w, h, blur) : H;
  if (detail && detailAmount) {
    // высокочастотные детали из яркости цветного кадра
    const lo = boxBlur(detail, w, h, detailRadius);
    const G = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) G[i] = F[i] + detailAmount * (detail[i] - lo[i]);
    F = G;
  }
  const out = new Uint8Array(w * h * 4);
  const s = strength * 4;
  const at = (x, y) => F[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, o = i * 4;
    if (alpha && alpha[i] < 0.02) { out[o] = 128; out[o + 1] = 128; out[o + 2] = 255; out[o + 3] = 0; continue; }
    // Собель (ось y вниз)
    const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) / 8;
    const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) / 8;
    let nx = -gx * s, nyDown = -gy * s, nz = 1;
    const len = Math.hypot(nx, nyDown, nz);
    nx /= len; nyDown /= len; nz /= len;
    if (invertX) nx = -nx;
    const ny = yUp ? -nyDown : nyDown; // OpenGL/Godot: зелёный = вверх
    out[o] = Math.round((nx * 0.5 + 0.5) * 255);
    out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    out[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    out[o + 3] = alpha ? Math.round(alpha[i] * 255) : 255;
  }
  return { width: w, height: h, data: out };
}

/** Превью освещения: цвет × (ambient + diffuse·N·L) от точечного источника. */
export function litPreview(color, normal, { x = 0.25, y = 0.2, z = 0.35, ambient = 0.35, intensity = 1.1, lightColor = [1, 0.97, 0.92], yUp = true } = {}) {
  const { width: w, height: h } = color, out = new Uint8Array(w * h * 4);
  const lx = x * w, ly = y * h, lz = z * Math.max(w, h);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const o = (py * w + px) * 4;
    const nx = normal.data[o] / 127.5 - 1, nyStored = normal.data[o + 1] / 127.5 - 1, nz = normal.data[o + 2] / 127.5 - 1;
    const nyDown = yUp ? -nyStored : nyStored;
    let dx = lx - px, dy = ly - py, dz = lz;
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    const diff = Math.max(0, nx * dx + nyDown * dy + nz * dz);
    const att = 1 / (1 + (l / Math.max(w, h)) ** 2 * 1.5);
    for (let c = 0; c < 3; c++) out[o + c] = Math.min(255, color.data[o + c] * (ambient + intensity * diff * att * lightColor[c]));
    out[o + 3] = color.data[o + 3];
  }
  return { width: w, height: h, data: out };
}

/** Склеить изображения по горизонтали (для превью). */
export function sideBySide(imgs, gap = 8, bg = [34, 34, 34, 255]) {
  const h = Math.max(...imgs.map((i) => i.height)), w = imgs.reduce((s, i) => s + i.width, 0) + gap * (imgs.length - 1);
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(bg, i * 4);
  let ox = 0;
  for (const im of imgs) {
    for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
      const s = (y * im.width + x) * 4, d = (y * w + ox + x) * 4, a = im.data[s + 3] / 255;
      for (let c = 0; c < 3; c++) data[d + c] = im.data[s + c] * a + data[d + c] * (1 - a);
      data[d + 3] = 255;
    }
    ox += im.width + gap;
  }
  return { width: w, height: h, data };
}
export function scaleDown(img, maxW) {
  if (img.width <= maxW) return img;
  const k = img.width / maxW, w = maxW, h = Math.round(img.height / k), data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.floor(x * k), sy = Math.floor(y * k), s = (sy * img.width + sx) * 4, d = (y * w + x) * 4;
    data[d] = img.data[s]; data[d + 1] = img.data[s + 1]; data[d + 2] = img.data[s + 2]; data[d + 3] = img.data[s + 3];
  }
  return { width: w, height: h, data };
}

export const NORMAL_DEFAULTS = {
  strength: 3, blur: 1, yUp: true, invertX: false,
  bevel: 8, depth: 0.3, height: 0.5, profile: 'round',
  detail: 0.15, detailRadius: 4, luma: 0.25,
};

/**
 * Карта нормалей для кадра сцены (или подмножества узлов).
 * Рельеф: каждая фигура — «подушка» с фаской (bevel/profile/depth), узлы могут переопределять props.relief.
 * opts: { t, only, viewBox, width, settings }
 */
export async function sceneNormalMap(scene, { t = 0, only, viewBox, width, settings = {} } = {}) {
  const st = { ...NORMAL_DEFAULTS, ...(scene.relief || {}), ...settings };
  const relief = { height: st.height, depth: st.depth, bevel: st.bevel, profile: st.profile, luma: st.luma, background: st.background ?? 0 };
  const opt = { only, viewBox, width, background: only ? false : undefined };
  const hPng = await svgToPng(renderSVG(scene, t, { ...opt, mode: 'height', relief }), width);
  const cPng = await svgToPng(renderSVG(scene, t, opt), width);
  const hi = decodePNG(hPng), ci = decodePNG(cPng);
  const n = hi.width * hi.height, H = new Float32Array(n), A = new Float32Array(n);
  for (let i = 0; i < n; i++) { H[i] = hi.data[i * 4] / 255; A[i] = Math.max(hi.data[i * 4 + 3], ci.data[i * 4 + 3]) / 255; }
  const nm = normalsFromHeight(H, only ? A : null, hi.width, hi.height, { ...st, detail: st.detail ? luminance(ci) : null, detailAmount: st.detail });
  return { normal: nm, color: ci, height: hi, settings: st };
}

/** Карта нормалей для растрового файла (PNG/JPG/... — через растеризатор). */
export async function imageNormalMap(buf, mime, settings = {}) {
  const st = { ...NORMAL_DEFAULTS, base: 0.2, depth: 0.6, luma: 0.35, ...settings };
  let img;
  if (mime === 'image/png') { try { img = decodePNG(buf); } catch { img = null; } }
  if (!img) {
    const { imageSize } = await import('./render.mjs');
    const sz = imageSize(buf) || { width: 512, height: 512 };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${sz.width}" height="${sz.height}"><image width="${sz.width}" height="${sz.height}" href="data:${mime};base64,${buf.toString('base64')}" xlink:href="data:${mime};base64,${buf.toString('base64')}"/></svg>`;
    img = decodePNG(await svgToPng(svg, sz.width));
  }
  const { H, alpha, w, h } = heightFromImage(img, { bevel: st.bevel, profile: st.profile, depth: st.depth, base: st.base, luma: st.luma, invertLuma: st.invertLuma, lumaBlur: st.lumaBlur });
  const hasAlpha = alpha.some((a) => a < 0.98);
  const nm = normalsFromHeight(H, hasAlpha ? alpha : null, w, h, st);
  const hv = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = Math.round(Math.min(1, Math.max(0, H[i])) * 255); hv[i * 4] = hv[i * 4 + 1] = hv[i * 4 + 2] = v; hv[i * 4 + 3] = 255; }
  return { normal: nm, color: img, height: { width: w, height: h, data: hv }, settings: st };
}
