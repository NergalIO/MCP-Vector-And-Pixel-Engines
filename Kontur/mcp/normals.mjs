// Карты нормалей: PNG-кодек без зависимостей, карта высот → нормали, рельеф из альфы/яркости, превью освещения.
import { inflateSync, deflateSync } from 'node:zlib';
import { renderSVG } from '../engine/kontur.js';
import { svgToRGBA } from './render.mjs';
import { readSrc, toDataURI } from './files.mjs';
import { Y3, Y601, unorm8, rgb, tileImages, grayToRGBA } from './lit/util.mjs';

/* ============================== PNG ============================== */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
/** CRC32 байтов (Buffer / Uint8Array) — для чанков PNG и путей Unity (unity_common: по байтам UTF-8). */
export const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** Байты — PNG (по сигнатуре)? */
export const isPng = (b) => !!b && b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
/** PNG → {width, height, data: Uint8Array RGBA}. 8 бит, все типы цвета, без interlace. */
export function decodePNG(buf) {
  if (!isPng(buf)) throw new Error('Не PNG');
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

/** RGBA → PNG Buffer. level — сжатие deflate (1 — быстро, для промежуточных кадров видео; 6 — по умолчанию). */
export function encodePNG({ width: w, height: h, data }, { level = 6 } = {}) {
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
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level })), chunk('IEND', Buffer.alloc(0))]);
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
  for (let i = 0; i < w * h; i++) L[i] = Y3(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) / 255;
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

/**
 * Освещение как в Godot 2D: цвет × (ambient + Σ цвет_света·energy·затухание·max(0, N·L)).
 * lights: [{x, y, z, color, energy, radius, falloff}] в пикселях картинки; ambient — [r, g, b] 0..1 (CanvasModulate).
 * Затухание — линейный радиальный градиент текстуры PointLight2D: (1 − d/radius)^falloff.
 */
export function lightImage(color, normal, lights, { ambient = [0.29, 0.31, 0.36], yUp = true } = {}) {
  const { width: w, height: h } = color, out = new Uint8Array(w * h * 4);
  const L = lights.map((l) => {
    const c = lightRGB(l.color);
    return { x: l.x, y: l.y, z: l.z ?? 80, r: Math.max(1, l.radius ?? 500), f: l.falloff ?? 1, cr: c[0] * (l.energy ?? 1), cg: c[1] * (l.energy ?? 1), cb: c[2] * (l.energy ?? 1) };
  });
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const o = (py * w + px) * 4;
    let nx = 0, ny = 0, nz = 1;
    if (normal) { nx = unorm8(normal.data[o]); const ns = unorm8(normal.data[o + 1]); ny = yUp ? -ns : ns; nz = unorm8(normal.data[o + 2]); }
    let ar = ambient[0], ag = ambient[1], ab = ambient[2];
    for (const l of L) {
      const dx = l.x - px, dy = l.y - py, d2 = Math.hypot(dx, dy);
      if (d2 >= l.r) continue;
      const att = Math.pow(1 - d2 / l.r, l.f);
      const len = Math.hypot(dx, dy, l.z) || 1;
      const nl = Math.max(0, (nx * dx + ny * dy + nz * l.z) / len) * att;
      ar += l.cr * nl; ag += l.cg * nl; ab += l.cb * nl;
    }
    out[o] = Math.min(255, color.data[o] * ar); out[o + 1] = Math.min(255, color.data[o + 1] * ag); out[o + 2] = Math.min(255, color.data[o + 2] * ab);
    out[o + 3] = color.data[o + 3];
  }
  return { width: w, height: h, data: out };
}
/** Цвет света: CSS-цвет движка (и hex без #), массив — как есть, иначе белый. */
const lightRGB = (c) => rgb(typeof c === 'string' && /^[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(c.trim()) ? '#' + c.trim() : c ?? '#fff');

/** Превью освещения: цвет × (ambient + diffuse·N·L) от точечного источника. */
export function litPreview(color, normal, { x = 0.25, y = 0.2, z = 0.35, ambient = 0.35, intensity = 1.1, lightColor = [1, 0.97, 0.92], yUp = true } = {}) {
  const { width: w, height: h } = color, out = new Uint8Array(w * h * 4);
  const lx = x * w, ly = y * h, lz = z * Math.max(w, h);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const o = (py * w + px) * 4;
    const nx = unorm8(normal.data[o]), nyStored = unorm8(normal.data[o + 1]), nz = unorm8(normal.data[o + 2]);
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
export const sideBySide = (imgs, gap = 8, bg = [34, 34, 34, 255]) => tileImages(imgs, { gap, bg });
/** Уменьшение до ширины maxW ближайшим соседом (уже не шире — как есть). */
export function scaleDown(img, maxW) {
  if (img.width <= maxW) return img;
  const k = img.width / maxW, w = maxW, h = Math.max(1, Math.round(img.height / k)), data = new Uint8Array(w * h * 4);
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
export async function sceneNormalMap(scene, { t = 0, only, viewBox, width, settings = {}, states, crisp } = {}) {
  scene = heightToNormalSrc(scene);
  const st = { ...NORMAL_DEFAULTS, ...(scene.relief || {}), ...settings };
  const relief = { height: st.height, depth: st.depth, bevel: st.bevel, profile: st.profile, luma: st.luma, background: st.background ?? 0 };
  const opt = { only, viewBox, width, background: only ? false : undefined, states, crisp };
  const [hi, ci] = await Promise.all([svgToRGBA(renderSVG(scene, t, { ...opt, mode: 'height', relief }), width), svgToRGBA(renderSVG(scene, t, opt), width)]);
  const n = hi.width * hi.height, H = new Float32Array(n), A = new Float32Array(n);
  for (let i = 0; i < n; i++) { H[i] = hi.data[i * 4] / 255; A[i] = Math.max(hi.data[i * 4 + 3], ci.data[i * 4 + 3]) / 255; }
  const nm = normalsFromHeight(H, only ? A : null, hi.width, hi.height, { ...st, detail: st.detail ? luminance(ci) : null, detailAmount: st.detail });
  // 2.5D-сцены: явные нормали узлов с props.surface (проход normal) поверх нормалей из высот
  if (st.source !== 'height' && hasSurfaces(scene)) {
    const sp = normalMapFromPass(await svgToRGBA(renderSVG(scene, t, { ...opt, mode: 'normal' }), width), { yUp: st.yUp !== false });
    if (sp.width === nm.width && sp.height === nm.height) for (let i = 0; i < sp.data.length; i += 4) if (sp.data[i + 3]) { nm.data[i] = sp.data[i]; nm.data[i + 1] = sp.data[i + 1]; nm.data[i + 2] = sp.data[i + 2]; nm.data[i + 3] = Math.max(nm.data[i + 3], ci.data[i + 3]); }
  }
  return { normal: nm, color: ci, height: hi, settings: st };
}

/**
 * Проход normal (мировые нормали узлов с props.surface) → карта нормалей 2D-движков:
 * мир x вправо, y вверх, z от камеры → карта x, y (yUp), z к зрителю. Пиксели без поверхности — прозрачные.
 */
export function normalMapFromPass(png, { yUp = true } = {}) {
  const im = Buffer.isBuffer(png) ? decodePNG(png) : png, d = im.data, out = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) { out[i] = 128; out[i + 1] = 128; out[i + 2] = 255; out[i + 3] = 0; continue; }
    const nx = unorm8(d[i]), ny = unorm8(d[i + 1]), nzv = -unorm8(d[i + 2]);
    out[i] = Math.round((nx * 0.5 + 0.5) * 255); out[i + 1] = Math.round(((yUp ? ny : -ny) * 0.5 + 0.5) * 255); out[i + 2] = Math.round((Math.max(0, nzv) * 0.5 + 0.5) * 255); out[i + 3] = 255;
  }
  return { width: im.width, height: im.height, data: out };
}
const hasSurfaces = (scene) => !!scene.camera3d || scene.nodes.some((n) => n.props?.surface);

/** Карта нормалей для растрового файла (PNG/JPG/... — через растеризатор). */
export async function imageNormalMap(buf, mime, settings = {}) {
  const st = { ...NORMAL_DEFAULTS, base: 0.2, depth: 0.6, luma: 0.35, ...settings };
  let img;
  if (mime === 'image/png') { try { img = decodePNG(buf); } catch { img = null; } }
  if (!img) {
    const { imageSize } = await import('./render.mjs');
    const sz = imageSize(buf) || { width: 512, height: 512 };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${sz.width}" height="${sz.height}"><image width="${sz.width}" height="${sz.height}" href="data:${mime};base64,${buf.toString('base64')}" xlink:href="data:${mime};base64,${buf.toString('base64')}"/></svg>`;
    img = await svgToRGBA(svg, sz.width);
  }
  const { H, alpha, w, h } = heightFromImage(img, { bevel: st.bevel, profile: st.profile, depth: st.depth, base: st.base, luma: st.luma, invertLuma: st.invertLuma, lumaBlur: st.lumaBlur });
  const hasAlpha = alpha.some((a) => a < 0.98);
  const nm = normalsFromHeight(H, hasAlpha ? alpha : null, w, h, st);
  return { normal: nm, color: img, height: { width: w, height: h, data: grayToRGBA(w * h, (i) => H[i]) }, settings: st };
}

/* ---------- heightSrc → normalSrc (этап 3) ---------- */
const hnCache = new Map();
/**
 * Узлы-картинки с props.heightSrc (карта высот, PNG: data: URI или путь от baseDir) и без normalSrc получают
 * normalSrc — касательную карту нормалей (зелёный вверх), посчитанную Собелем по яркости (props.heightStrength, 3).
 * Результат кэшируется по источнику и силе. Сцена не меняется — возвращается копия.
 */
export function heightToNormalSrc(scene, baseDir) {
  if (!scene?.nodes?.some((n) => n.props?.heightSrc && !n.props.normalSrc)) return scene;
  return { ...scene, nodes: scene.nodes.map((n) => {
    const p = n.props;
    if (!p?.heightSrc || p.normalSrc) return n;
    const strength = p.heightStrength ?? 3, key = `${strength}|${p.heightSrc}`;
    let uri = hnCache.get(key);
    if (uri === undefined) {
      uri = null;
      try {
        const src = String(p.heightSrc);
        const buf = readSrc(src, baseDir);
        const im = decodePNG(buf), m = im.width * im.height, H = new Float32Array(m), A = new Float32Array(m);
        for (let i = 0; i < m; i++) { const o = i * 4; H[i] = Y601(im.data[o], im.data[o + 1], im.data[o + 2]) / 255; A[i] = im.data[o + 3] / 255; }
        uri = toDataURI(encodePNG(normalsFromHeight(H, A, im.width, im.height, { strength, blur: 1, yUp: true })), 'image/png');
      } catch { uri = null; }
      hnCache.set(key, uri);
    }
    return uri ? { ...n, props: { ...p, normalSrc: uri, normalYUp: true } } : n;
  }) };
}
