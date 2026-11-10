// Постобработка кадра на WebGPU: bloom (post.mjs), тонмаппинг, перенос палитры и цветокоррекция (color.mjs) —
// те же формулы во float32. Вызываются через viaGPU с запасным путём на процессоре.
import { gpuExec, uniforms, groups1, groups2 } from './gpu.mjs';
import { binds, REFL, C01 } from './wgsl.mjs';

const IDX = 'let i = g.x + g.y * 65535u * 256u;\n  if (i >= p.n) { return; }';

/* ---------------- bloom ---------------- */
// Плоскости каналов лежат подряд (c·w·h). Радиус больше 6 — через уменьшенную копию (как gauss в filters.mjs).
const BLOOM = /* wgsl */ `
struct U { w: u32, h: u32, r: i32, ko: u32, W: u32, H: u32, f: u32, sw: u32, sh: u32, thr: f32, wgt: f32 }
@group(0) @binding(0) var<uniform> p: U;
${binds([['col', 'f32', true], ['em'], ['a'], ['o', 'f32', true], ['k']])}
// у layout 'auto' в привязках — только то, что точка входа использует; проходы bloom привязывают всё — touch() «использует» всё
fn touch() { if (p.w == 0xffffffffu) { o[0] = col[0] + em[0] + a[0] + k[0]; col[0] = 0.0; } }
${REFL}
// яркое выше порога + свечение → три плоскости o
@compute @workgroup_size(16, 16) fn extract(@builtin(global_invocation_id) g: vec3u) {
  touch();
  if (g.x >= p.W || g.y >= p.H) { return; }
  let i = g.y * p.W + g.x; let n = p.W * p.H;
  for (var c = 0u; c < 3u; c++) { o[c * n + i] = max(0.0, col[i * 3u + c] - p.thr) + em[i * 3u + c] * 0.6; }
}
// гаусс по плоскости w×h канала g.z: r < 0 — по x (радиус −r), иначе по y
@compute @workgroup_size(16, 16) fn blur(@builtin(global_invocation_id) g: vec3u) {
  touch();
  if (g.x >= p.w || g.y >= p.h) { return; }
  let x = i32(g.x); let y = i32(g.y); let w = i32(p.w); let h = i32(p.h); let base = g.z * p.w * p.h;
  let r = abs(p.r);
  var s = 0.0;
  if (p.r < 0) { for (var q = -r; q <= r; q++) { s += a[base + u32(y * w + refl(x + q, w))] * k[p.ko + u32(q + r)]; } }
  else { for (var q = -r; q <= r; q++) { s += a[base + u32(refl(y + q, h) * w + x)] * k[p.ko + u32(q + r)]; } }
  o[base + g.y * p.w + g.x] = s;
}
// среднее по блокам f×f: из W×H в sw×sh (канал g.z)
@compute @workgroup_size(16, 16) fn down(@builtin(global_invocation_id) g: vec3u) {
  touch();
  if (g.x >= p.sw || g.y >= p.sh) { return; }
  let n = p.W * p.H; var s = 0.0; var cnt = 0.0;
  for (var y = g.y * p.f; y < min(p.H, (g.y + 1u) * p.f); y++) { for (var x = g.x * p.f; x < min(p.W, (g.x + 1u) * p.f); x++) { s += a[g.z * n + y * p.W + x]; cnt += 1.0; } }
  o[g.z * p.sw * p.sh + g.y * p.sw + g.x] = s / max(cnt, 1.0);
}
// col += upF(a) · wgt (f = 1 — та же сетка)
@compute @workgroup_size(16, 16) fn add(@builtin(global_invocation_id) g: vec3u) {
  touch();
  if (g.x >= p.W || g.y >= p.H) { return; }
  let i = g.y * p.W + g.x;
  if (p.f <= 1u) { let n = p.W * p.H; for (var c = 0u; c < 3u; c++) { col[i * 3u + c] += a[c * n + i] * p.wgt; } return; }
  let ff = f32(p.f); let sw = p.sw; let sh = p.sh;
  let fy = min(f32(sh - 1u), max(0.0, (f32(g.y) + 0.5) / ff - 0.5)); let y0 = u32(floor(fy)); let y1 = min(sh - 1u, y0 + 1u); let ty = fy - f32(y0);
  let fx = min(f32(sw - 1u), max(0.0, (f32(g.x) + 0.5) / ff - 0.5)); let x0 = u32(floor(fx)); let x1 = min(sw - 1u, x0 + 1u); let tx = fx - f32(x0);
  for (var c = 0u; c < 3u; c++) {
    let b = c * sw * sh;
    let v = (a[b + y0 * sw + x0] * (1.0 - tx) + a[b + y0 * sw + x1] * tx) * (1.0 - ty) + (a[b + y1 * sw + x0] * (1.0 - tx) + a[b + y1 * sw + x1] * tx) * ty;
    col[i * 3u + c] += v * p.wgt;
  }
}`;
/** Bloom (на месте в col, как bloom из post.mjs). kern(s) → { k, r } — gaussKernel из filters.mjs. */
export function gpuBloom(col, emL, W, H, strength, threshold, kern) {
  const n = W * H, ks = [], passes = [];
  const kOff = (s) => { const { k, r } = kern(s), ko = ks.length; ks.push(...k); return { ko, r }; };
  const U = (o) => uniforms([['u', o.w ?? W], ['u', o.h ?? H], ['i', o.r ?? 0], ['u', o.ko ?? 0], ['u', W], ['u', H], ['u', o.f ?? 1], ['u', o.sw ?? 1], ['u', o.sh ?? 1], ['f', threshold], ['f', o.wgt ?? 0]]);
  const full = groups2(W, H);
  // буферы: 0 col, 1 em, 2 br (яркое, три плоскости), 3 и 4 — временные плоскости, 5 ядра; привязки: col, em, a (чтение), o (запись), k
  passes.push({ entry: 'extract', uni: U({}), bind: [0, 1, 3, 2, 5], groups: full });
  for (const [s0, wgt] of [[4, 0.5], [14, 0.35], [40, 0.25]]) {
    const s = s0 * (W / 2560), w = wgt * strength;
    if (s <= 6) {
      const { ko, r } = kOff(s), gz = [full[0], full[1], 3];
      passes.push({ entry: 'blur', uni: U({ r: -r, ko }), bind: [0, 1, 2, 3, 5], groups: gz });
      passes.push({ entry: 'blur', uni: U({ r, ko }), bind: [0, 1, 3, 4, 5], groups: gz });
      passes.push({ entry: 'add', uni: U({ wgt: w }), bind: [0, 1, 4, 3, 5], groups: full });
    } else {
      const f = Math.max(2, Math.floor(s / 3)), sw = Math.ceil(W / f), sh = Math.ceil(H / f), { ko, r } = kOff(s / f), sg = groups2(sw, sh), gz = [sg[0], sg[1], 3];
      passes.push({ entry: 'down', uni: U({ f, sw, sh }), bind: [0, 1, 2, 3, 5], groups: gz });
      passes.push({ entry: 'blur', uni: U({ w: sw, h: sh, r: -r, ko }), bind: [0, 1, 3, 4, 5], groups: gz });
      passes.push({ entry: 'blur', uni: U({ w: sw, h: sh, r, ko }), bind: [0, 1, 4, 3, 5], groups: gz });
      passes.push({ entry: 'add', uni: U({ f, sw, sh, wgt: w }), bind: [0, 1, 3, 4, 5], groups: full });
    }
  }
  gpuExec({ key: 'bloom', code: BLOOM, bufs: [{ data: col, io: 'inout' }, { data: emL }, { bytes: n * 12 }, { bytes: n * 12 }, { bytes: n * 12 }, { data: Float32Array.from(ks) }], passes });
}

/* ---------------- цвет: общие функции ---------------- */
const COLOR = /* wgsl */ `
${C01}
fn acesC(x: f32) -> f32 { return c01((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)); }
fn agx(c: vec3f) -> vec3f {
  let MIN = -12.47393; let MAX = 4.026069; let R = MAX - MIN;
  let i = vec3f(0.842479062253094 * c.x + 0.0784335999999992 * c.y + 0.0792237451477643 * c.z,
    0.0423282422610123 * c.x + 0.878468636469772 * c.y + 0.0791661274605434 * c.z,
    0.0423756549057051 * c.x + 0.0784336 * c.y + 0.879142973793104 * c.z);
  let x = (min(vec3f(MAX), max(vec3f(MIN), log2(max(vec3f(1e-10), i)))) - MIN) / R; let x2 = x * x; let x4 = x2 * x2;
  let e = 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  return clamp(vec3f(1.19687900512017 * e.x - 0.0980208811401368 * e.y - 0.0990297440797205 * e.z,
    -0.0528968517574562 * e.x + 1.15190312990417 * e.y - 0.0989611768448433 * e.z,
    -0.0529716355144438 * e.x - 0.0980434501171241 * e.y + 1.15107367264116 * e.z), vec3f(0.0), vec3f(1.0));
}
fn hueTm(c: vec3f) -> vec3f {
  let m = max(c.x, max(c.y, c.z));
  if (!(m > 1e-8)) { return vec3f(0.0); }
  let t = acesC(m); let k = t / m; let q = c01((m - 0.8) / 5.2);
  let w = q * q * (3.0 - 2.0 * q) * 0.6;
  return pow(clamp(c * k + (vec3f(t) - c * k) * w, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
}
fn s2l(c: f32) -> f32 { return select(pow((c + 0.055) / 1.055, 2.4), c / 12.92, c <= 0.04045); }
fn l2s(c: f32) -> f32 { return select(1.055 * pow(max(c, 0.0), 1.0 / 2.4) - 0.055, c * 12.92, c <= 0.0031308); }
fn labF(t: f32) -> f32 { return select(7.787 * t + 16.0 / 116.0, pow(max(t, 0.0), 1.0 / 3.0), t > 0.008856); }
fn labFi(f: f32) -> f32 { let f3 = f * f * f; return select((f - 16.0 / 116.0) / 7.787, f3, f3 > 0.008856); }
fn toLab(c: vec3f) -> vec3f {
  let r = s2l(c.x); let g = s2l(c.y); let b = s2l(c.z);
  let fx = labF((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047); let fy = labF(0.2126 * r + 0.7152 * g + 0.0722 * b); let fz = labF((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return vec3f(116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz));
}
fn fromLab(L: f32, a: f32, b: f32) -> vec3f {
  let fy = (L + 16.0) / 116.0; let X = 0.95047 * labFi(fy + a / 500.0); let Y = labFi(fy); let Z = 1.08883 * labFi(fy - b / 200.0);
  return vec3f(c01(l2s(3.2406 * X - 1.5372 * Y - 0.4986 * Z)), c01(l2s(-0.9689 * X + 1.8758 * Y + 0.0415 * Z)), c01(l2s(0.0557 * X - 0.204 * Y + 1.057 * Z)));
}
fn zoneW(L: f32) -> vec3f { let w0 = c01(1.0 - L / 50.0); let w2 = c01((L - 50.0) / 50.0); return vec3f(w0, 1.0 - w0 - w2, w2); }
`;

/* ---------------- тонмаппинг ---------------- */
const TONEMAP = COLOR + /* wgsl */ `
struct U { n: u32, mode: u32, exp: f32, sat: f32 }
@group(0) @binding(0) var<uniform> p: U;
${binds([['col'], ['img', 'f32', true]])}
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) g: vec3u) {
  ${IDX}
  let c = vec3f(col[i * 3u], col[i * 3u + 1u], col[i * 3u + 2u]) * p.exp;
  var o: vec3f;
  if (p.mode == 2u) { o = agx(c); }
  else if (p.mode == 3u) { o = hueTm(c); }
  else if (p.mode == 1u) { o = pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2)); }
  else { o = pow(vec3f(acesC(c.x), acesC(c.y), acesC(c.z)), vec3f(1.0 / 2.2)); }
  let lum = (o.x + o.y + o.z) / 3.0;
  o = clamp(vec3f(lum) + (o - vec3f(lum)) * p.sat, vec3f(0.0), vec3f(1.0));
  img[i * 3u] = o.x; img[i * 3u + 1u] = o.y; img[i * 3u + 2u] = o.z;
}`;
/** Тонмаппинг кадра (tonemapFrame): col (линейный HDR) → img (экранный 0..1). tonemap: aces | none | agx | hue. */
export function gpuTonemap(col, img, n, { exposure, tonemap, saturation }) {
  const mode = tonemap === 'agx' ? 2 : tonemap === 'hue' ? 3 : tonemap === 'none' ? 1 : 0;
  gpuExec({ key: 'tonemap', code: TONEMAP, bufs: [{ data: col }, { data: img, io: 'out' }], passes: [
    { entry: 'main', uni: uniforms([['u', n], ['u', mode], ['f', exposure], ['f', saturation]]), groups: groups1(n) },
  ] });
}

/* ---------------- перенос палитры ---------------- */
const MATCH = COLOR + /* wgsl */ `
struct U { n: u32, zones: u32, amt: f32, wl: f32, kL: f32, kC: f32, sMeanL: f32, rMeanL: f32,
  sa0: f32, sa1: f32, sa2: f32, sb0: f32, sb1: f32, sb2: f32, ra0: f32, ra1: f32, ra2: f32, rb0: f32, rb1: f32, rb2: f32, sga: f32, sgb: f32, rga: f32, rgb: f32 }
@group(0) @binding(0) var<uniform> p: U;
${binds([['img', 'f32', true]])}
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) g: vec3u) {
  ${IDX}
  let q = toLab(vec3f(img[i * 3u], img[i * 3u + 1u], img[i * 3u + 2u])); let w = zoneW(q.x);
  let L2 = q.x + ((q.x - p.sMeanL) * p.kL + p.rMeanL - q.x) * p.wl * p.amt;
  let w2 = zoneW(L2);
  var sa = p.sga; var sb = p.sgb; var ra = p.rga; var rb = p.rgb;
  if (p.zones != 0u) {
    sa = dot(w, vec3f(p.sa0, p.sa1, p.sa2)); sb = dot(w, vec3f(p.sb0, p.sb1, p.sb2));
    ra = dot(w2, vec3f(p.ra0, p.ra1, p.ra2)); rb = dot(w2, vec3f(p.rb0, p.rb1, p.rb2));
  }
  let a2 = (q.y - sa) * p.kC + ra; let b2 = (q.z - sb) * p.kC + rb;
  let o = fromLab(L2, q.y + (a2 - q.y) * p.amt, q.z + (b2 - q.z) * p.amt);
  img[i * 3u] = o.x; img[i * 3u + 1u] = o.y; img[i * 3u + 2u] = o.z;
}`;
/** Цикл matchPalette по пикселям (на месте) с готовыми статистиками src, ref и коэффициентами kL, kC. */
export function gpuMatch(img, n, { src, ref, amt, wl, kL, kC, zones }) {
  const f = (v) => ['f', v];
  gpuExec({ key: 'match', code: MATCH, bufs: [{ data: img, io: 'inout' }], passes: [
    { entry: 'main', uni: uniforms([['u', n], ['u', zones ? 1 : 0], f(amt), f(wl), f(kL), f(kC), f(src.meanL), f(ref.meanL),
      ...src.ma.map(f), ...src.mb.map(f), ...ref.ma.map(f), ...ref.mb.map(f), f(src.ga), f(src.gb), f(ref.ga), f(ref.gb)]), groups: groups1(n) },
  ] });
}

/* ---------------- цветокоррекция ---------------- */
const GRADE = /* wgsl */ `
struct U { n: u32, hasSplit: u32, con: f32, bal: f32, amount: f32, shL: f32, hiL: f32, pad: f32,
  lift: vec4f, gamma: vec4f, gain: vec4f, sh: vec4f, hi: vec4f }
@group(0) @binding(0) var<uniform> p: U;
${binds([['img', 'f32', true]])}
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) g: vec3u) {
  ${IDX}
  var v = vec3f(img[i * 3u], img[i * 3u + 1u], img[i * 3u + 2u]);
  v = p.gain.xyz * (v + p.lift.xyz * (vec3f(1.0) - v));
  v = pow(max(vec3f(0.0), v), vec3f(1.0) / p.gamma.xyz);
  if (p.con != 1.0) { v = (v - vec3f(0.5)) * p.con + vec3f(0.5); }
  if (p.hasSplit != 0u) {
    let l = clamp(0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z, 0.0, 1.0);
    let a = clamp(1.0 - l - p.bal, 0.0, 1.0); let b = clamp(l - p.bal, 0.0, 1.0);
    let ws = a * a * p.amount * 2.0; let wh = b * b * p.amount * 2.0;
    v += (p.sh.xyz - vec3f(p.shL)) * ws + (p.hi.xyz - vec3f(p.hiL)) * wh;
  }
  v = clamp(v, vec3f(0.0), vec3f(1.0));
  img[i * 3u] = v.x; img[i * 3u + 1u] = v.y; img[i * 3u + 2u] = v.z;
}`;
/** Цветокоррекция без LUT (applyGrade): lift/gamma/gain, контраст, split toning. */
export function gpuGrade(img, n, g) {
  const sp = g.split, lum3 = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], v4 = (c) => [...c.map((x) => ['f', x]), ['f', 0]];
  gpuExec({ key: 'grade', code: GRADE, bufs: [{ data: img, io: 'inout' }], passes: [
    { entry: 'main', uni: uniforms([['u', n], ['u', sp ? 1 : 0], ['f', g.contrast ?? 1], ['f', sp?.balance ?? 0], ['f', sp?.amount ?? 0], ['f', sp ? lum3(sp.shadows) : 0], ['f', sp ? lum3(sp.highlights) : 0], ['f', 0],
      ...v4(g.lift), ...v4(g.gamma.map((x) => x || 1)), ...v4(g.gain), ...v4(sp ? sp.shadows : [0, 0, 0]), ...v4(sp ? sp.highlights : [0, 0, 0])]), groups: groups1(n) },
  ] });
}
