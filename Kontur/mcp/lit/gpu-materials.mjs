// Попиксельные материалы (kMaterials из materials.mjs) на WebGPU: шум Перлина noise3 и fbm, процедурные фактуры
// (доски, полосы, плитка, шахматы) с выборками по следу пикселя, грязь, износ рёбер, микрорельеф. Формулы и хеши —
// те же, что на процессоре; счёт во float32. Картиночные фактуры (tex.src) сюда не попадают — для них этап идёт на
// процессоре (gpuMaterialsOK).
import { gpuExec, uniforms, groups2 } from './gpu.mjs';

const STRIDE = 64;
const F = { tex: 1, noise: 2, grime: 4, wear: 8, bump: 16, tint: 32, mult: 64, noiseC: 128, wearC: 256, thin: 512, pal: 1024 };
const KIND = { planks: 0, stripes: 1, tiles: 2, checker: 3 };
const kindOf = (t) => t.kind || (t.src ? 'image' : 'planks');

/** Материалы считаются на GPU: нет картиночных фактур и неизвестных видов. */
export const gpuMaterialsOK = (mats) => mats.every((m) => !m.tex || kindOf(m.tex) in KIND);

/**
 * Таблица материалов для шейдера: M — по STRIDE чисел на материал, C — цвета палитр (тройки).
 * mean(t), det(t) — средний цвет фактуры и размер детали (texMean, texDetail из materials.mjs).
 */
function packMaterials(mats, mean, det) {
  const M = new Float32Array(Math.max(1, mats.length) * STRIDE), cols = [];
  const put = (o, arr) => { for (let k = 0; k < arr.length; k++) M[o + k] = arr[k]; };
  mats.forEach((m, q) => {
    const b = q * STRIDE;
    let fl = 0;
    if (m.tex) {
      const t = m.tex;
      fl |= F.tex;
      if (t._tint) { fl |= F.tint; put(b + 15, t._tint); }
      if (t.mode === 'multiply') fl |= F.mult;
      const k = kindOf(t);
      M[b + 1] = KIND[k]; M[b + 2] = t.amount ?? 1; M[b + 3] = det(t); put(b + 4, mean(t));
      put(b + 9, t._c1); put(b + 12, t._c2);
      if (k === 'planks') { M[b + 18] = t.w ?? 0.18; M[b + 19] = t.len ?? 1.6; M[b + 20] = t.gap ?? 0.006; }
      else if (k === 'stripes') {
        M[b + 18] = t.w ?? 0.2;
        if (t.thin !== false) fl |= F.thin;
        M[b + 28] = cols.length / 3; M[b + 29] = t._cs.length; for (const c of t._cs) cols.push(...c);
      } else {
        M[b + 21] = t.su ?? t.s ?? 0.3; M[b + 22] = t.sv ?? t.s ?? 0.3; M[b + 23] = t.grout ?? 0.012; M[b + 24] = t.offset ?? 0;
        M[b + 25] = t.vary || 0; M[b + 26] = t.jitter ?? 0.2; M[b + 27] = t.pillow || 0;
        if (t._pal) { fl |= F.pal; M[b + 28] = cols.length / 3; M[b + 29] = t._pal.length; for (const c of t._pal) cols.push(...c); }
      }
    }
    if (m.noise) {
      fl |= F.noise; M[b + 30] = m.noise.scale; M[b + 31] = m.noise.amount; M[b + 32] = m.noise.octaves;
      if (m.noise._c) { fl |= F.noiseC; put(b + 33, m.noise._c); }
    }
    if (m.grime) { fl |= F.grime; const G = m.grime; M[b + 36] = G.height; M[b + 37] = G.amount; M[b + 38] = G.floor; M[b + 39] = G.ao; put(b + 40, G._c); }
    if (m.wear) { fl |= F.wear; M[b + 43] = m.wear.amount; if (m.wear._c) { fl |= F.wearC; put(b + 44, m.wear._c); } }
    if (m.bump) { fl |= F.bump; M[b + 47] = m.bump.scale; M[b + 48] = m.bump.amount; }
    M[b] = fl;
  });
  if (!cols.length) cols.push(0, 0, 0);
  return { M, C: Float32Array.from(cols) };
}

const CURV = /* wgsl */ `
struct U { W: u32, H: u32 }
@group(0) @binding(0) var<uniform> p: U;
@group(0) @binding(1) var<storage, read> Nx: array<f32>;
@group(0) @binding(2) var<storage, read> Ny: array<f32>;
@group(0) @binding(3) var<storage, read> Nz: array<f32>;
@group(0) @binding(4) var<storage, read_write> curv: array<f32>;
@compute @workgroup_size(16, 16) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x < 1u || g.y < 1u || g.x + 1u >= p.W || g.y + 1u >= p.H) { return; }
  let i = g.y * p.W + g.x; let W = p.W;
  let dx = abs(Nx[i + 1u] - Nx[i - 1u]) + abs(Ny[i + 1u] - Ny[i - 1u]) + abs(Nz[i + 1u] - Nz[i - 1u]);
  let dy = abs(Nx[i + W] - Nx[i - W]) + abs(Ny[i + W] - Ny[i - W]) + abs(Nz[i + W] - Nz[i - W]);
  curv[i] = dx + dy;
}`;

const MATS = /* wgsl */ `
struct U { W: u32, H: u32, nm: u32, filt: u32 }
@group(0) @binding(0) var<uniform> p: U;
@group(0) @binding(1) var<storage, read> mid: array<u32>;
@group(0) @binding(2) var<storage, read_write> lin: array<f32>;
@group(0) @binding(3) var<storage, read_write> Nx: array<f32>;
@group(0) @binding(4) var<storage, read_write> Ny: array<f32>;
@group(0) @binding(5) var<storage, read_write> Nz: array<f32>;
@group(0) @binding(6) var<storage, read> PNx: array<f32>;
@group(0) @binding(7) var<storage, read> PNy: array<f32>;
@group(0) @binding(8) var<storage, read> PNz: array<f32>;
@group(0) @binding(9) var<storage, read> Px: array<f32>;
@group(0) @binding(10) var<storage, read> Py: array<f32>;
@group(0) @binding(11) var<storage, read> Pz: array<f32>;
@group(0) @binding(12) var<storage, read> ao: array<f32>;
@group(0) @binding(13) var<storage, read> curv: array<f32>;
@group(0) @binding(14) var<storage, read> M: array<f32>;
@group(0) @binding(15) var<storage, read> C: array<f32>;

fn midAt(i: u32) -> u32 { return (mid[i >> 1u] >> ((i & 1u) * 16u)) & 0xffffu; }
fn c01(v: f32) -> f32 { return clamp(v, 0.0, 1.0); }
fn smoothT(a: f32, b: f32, x: f32) -> f32 { let q = c01((x - a) / (b - a)); return q * q * (3.0 - 2.0 * q); }
fn bc(v: i32) -> u32 { return bitcast<u32>(v); }
// h2 из materials.mjs (деление — по старшим 24 битам)
fn h2(a: i32, b: i32, s: i32) -> f32 {
  var h = bc(a) * 374761393u + bc(b) * 668265263u + bc(s) * 1442695041u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return f32((h ^ (h >> 16u)) >> 8u) / 16777216.0;
}
// hash3 и noise3 из engine/core/math.js
fn hash3(x: i32, y: i32, z: i32, s: i32) -> u32 {
  var h = (bc(x) * 0x27d4eb2du) ^ (bc(y) * 0x165667b1u) ^ (bc(z) * 0x9e3779b1u) ^ (bc(s + 1013) * 0x85ebca6bu);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  return h ^ (h >> 15u);
}
// G3[h % 12]·(x, y, z): первые 4 — (±1, ±1, 0), следующие 4 — (±1, 0, ±1), последние — (0, ±1, ±1)
fn gdot(h: u32, x: f32, y: f32, z: f32) -> f32 {
  let k = h % 12u;
  let s1 = select(1.0, -1.0, (k & 1u) != 0u); let s2 = select(1.0, -1.0, (k & 2u) != 0u);
  if (k < 4u) { return s1 * x + s2 * y; }
  if (k < 8u) { return s1 * x + s2 * z; }
  return s1 * y + s2 * z;
}
fn fade(t: f32) -> f32 { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
fn noise3(x: f32, y: f32, z: f32, seed: i32) -> f32 {
  let X = floor(x); let Y = floor(y); let Z = floor(z);
  let fx = x - X; let fy = y - Y; let fz = z - Z;
  let xi = i32(X); let yi = i32(Y); let zi = i32(Z);
  let u = fade(fx); let v = fade(fy); let w = fade(fz);
  let x00 = mix(gdot(hash3(xi, yi, zi, seed), fx, fy, fz), gdot(hash3(xi + 1, yi, zi, seed), fx - 1.0, fy, fz), u);
  let x10 = mix(gdot(hash3(xi, yi + 1, zi, seed), fx, fy - 1.0, fz), gdot(hash3(xi + 1, yi + 1, zi, seed), fx - 1.0, fy - 1.0, fz), u);
  let x01 = mix(gdot(hash3(xi, yi, zi + 1, seed), fx, fy, fz - 1.0), gdot(hash3(xi + 1, yi, zi + 1, seed), fx - 1.0, fy, fz - 1.0), u);
  let x11 = mix(gdot(hash3(xi, yi + 1, zi + 1, seed), fx, fy - 1.0, fz - 1.0), gdot(hash3(xi + 1, yi + 1, zi + 1, seed), fx - 1.0, fy - 1.0, fz - 1.0), u);
  return mix(mix(x00, x10, v), mix(x01, x11, v), w) * 1.1;
}
// fbm3 (frac = false: ceil(oct) полных октав) и fbm3f (frac = true: последняя октава с долей)
fn fbm(x: f32, y: f32, z: f32, oct: f32, frac: bool, seed: i32) -> f32 {
  var s = 0.0; var a = 1.0; var f = 1.0; var n = 0.0;
  let cnt = i32(ceil(oct));
  for (var o = 0; o < cnt; o++) {
    let w = select(a, min(1.0, oct - f32(o)) * a, frac);
    s += w * noise3(x * f, y * f, z * f, seed + o * 17); n += w; a *= 0.5; f *= 2.0;
  }
  return select(0.0, s / n, n > 0.0);
}
fn col3(k: u32) -> vec3f { return vec3f(C[k * 3u], C[k * 3u + 1u], C[k * 3u + 2u]); }
fn m3(o: u32) -> vec3f { return vec3f(M[o], M[o + 1u], M[o + 2u]); }

struct TS { c: vec3f, n: vec2f }
// texSample из materials.mjs; b — начало записи материала
fn texSample(b: u32, fl: u32, u: f32, v: f32) -> TS {
  let kind = u32(M[b + 1u]); let c1 = m3(b + 9u); let c2 = m3(b + 12u);
  var o: TS; o.n = vec2f(0.0);
  if (kind == 0u) {
    let bw = M[b + 18u]; let bl = M[b + 19u]; let gap = M[b + 20u];
    let row = floor(v / bw); let ri = i32(row);
    let off = h2(ri, 7, 0) * bl; let uu = u + off; let col = floor(uu / bl); let ci = i32(col);
    let fv = v - row * bw; let fu = uu - col * bl; let r = h2(ri, ci, 3);
    let grain = 0.5 + 0.5 * noise3(uu * 2.2, v * 40.0, row * 1.7, 5) * 0.6 + 0.2 * noise3(uu * 9.0, v * 90.0, row, 9);
    let tone = 0.82 + r * 0.32;
    let edge = fv < gap || bw - fv < gap || fu < gap * 1.2 || bl - fu < gap * 1.2;
    o.c = select((c1 * (1.0 - grain * 0.35) + c2 * grain * 0.35) * tone, c1 * 0.35, edge);
    o.n = vec2f((h2(ri, ci, 9) - 0.5) * 0.06, select(select(0.0, -0.25, bw - fv < gap * 3.0), 0.25, fv < gap * 3.0));
    return o;
  }
  if (kind == 1u) {
    let w = M[b + 18u]; let fi = floor(u / w); let f = u / w - fi;
    let n = i32(M[b + 29u]); let i = i32(fi);
    let base = col3(u32(M[b + 28u]) + u32(((i % n) + n) % n));
    let thin = (fl & ${F.thin}u) != 0u && abs(f - 0.5) < 0.03;
    o.c = select(base, base * 0.82, thin);
    return o;
  }
  // плитка и шахматы
  let sv = M[b + 22u]; let gr = M[b + 23u];
  var su = M[b + 21u];
  let ivf = floor(v / sv); let iv = i32(ivf);
  let uu = u + select(0.0, M[b + 24u] * su, (iv & 1) != 0);
  let fv = v - ivf * sv;
  var iuf = floor(uu / su); var fu = uu - iuf * su;
  if (kind == 3u) { o.c = select(c1, c2, ((i32(iuf) + iv) & 1) != 0); return o; }
  let vary = M[b + 25u];
  if (vary > 0.0) {
    let pair = floor(uu / (2.0 * su));
    if (h2(i32(pair), iv, 8) < vary) { iuf = pair * 2.0; fu = uu - pair * 2.0 * su; su *= 2.0; }
  }
  let iu = i32(iuf);
  let g = fu < gr || fv < gr || su - fu < gr * 0.3 || sv - fv < gr * 0.3;
  let jt = M[b + 26u]; let r = 1.0 - jt / 2.0 + h2(iu, iv, 2) * jt;
  var cs = c1;
  if ((fl & ${F.pal}u) != 0u) { let n = u32(M[b + 29u]); cs = col3(u32(M[b + 28u]) + u32(floor(h2(iu, iv, 11) * f32(n))) % n); }
  o.c = select(cs * r, c2, g);
  if (!g) {
    let pil = M[b + 27u];
    if (pil != 0.0) { o.n = vec2f((fu / su - 0.5) * pil, (fv / sv - 0.5) * pil); }
    else { o.n = vec2f((h2(iu, iv, 5) - 0.5) * 0.05, (h2(iu, iv, 6) - 0.5) * 0.05); }
  }
  return o;
}

fn PN(k: u32) -> vec3f { return vec3f(PNx[k], PNy[k], PNz[k]); }
fn P(k: u32) -> vec3f { return vec3f(Px[k], Py[k], Pz[k]); }
// сосед k на той же плоскости того же материала
fn same(k: u32, i: u32) -> bool {
  let d = abs(PN(k) - PN(i));
  return midAt(k) == midAt(i) && d.x + d.y + d.z < 0.02 && abs(dot(PN(i), P(k) - P(i))) < 0.02;
}

@compute @workgroup_size(16, 16) fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= p.W || gid.y >= p.H) { return; }
  let x = gid.x; let y = gid.y; let W = p.W;
  let i = y * W + x;
  let id = midAt(i);
  if (id == 0u || id > p.nm) { return; }
  let b = (id - 1u) * ${STRIDE}u;
  let fl = u32(M[b]);
  let pp = P(i); let px = pp.x; let py = pp.y; let pz = pp.z;
  var r = lin[i * 3u]; var gg = lin[i * 3u + 1u]; var bb = lin[i * 3u + 2u];
  var N = vec3f(Nx[i], Ny[i], Nz[i]);
  // оси грани (surfaceAxes)
  var au = vec3f(1.0, 0.0, 0.0); var av = vec3f(0.0, 0.0, 1.0);
  var u = 0.0; var v = 0.0;
  let texOrBump = (fl & ${F.tex | F.bump}u) != 0u;
  if (texOrBump) {
    let pn0 = PN(i); let pl = length(pn0);
    let n = pn0 / select(pl, 1.0, pl == 0.0);
    let cu = vec3f(-n.z, 0.0, n.x);
    if (length(cu) < 1e-4) { au = vec3f(1.0, 0.0, 0.0); av = select(vec3f(0.0, 0.0, -1.0), vec3f(0.0, 0.0, 1.0), n.y > 0.0); }
    else { au = normalize(cu); let cv = cross(au, n); let vl = length(cv); av = cv / select(vl, 1.0, vl == 0.0); }
    u = dot(pp, au); v = dot(pp, av);
  }
  // след пикселя
  var ex = vec3f(0.0); var ey = vec3f(0.0); var hasFp = false;
  if (p.filt != 0u && (fl & ${F.tex | F.bump | F.noise}u) != 0u) {
    var okx = true; var oky = true;
    if (x + 1u < W && same(i + 1u, i)) { ex = P(i + 1u) - pp; }
    else if (x > 0u && same(i - 1u, i)) { ex = pp - P(i - 1u); }
    else { okx = false; }
    if (y + 1u < p.H && same(i + W, i)) { ey = P(i + W) - pp; }
    else if (y > 0u && same(i - W, i)) { ey = pp - P(i - W); }
    else { oky = false; }
    hasFp = okx || oky;
    if (!okx) { ex = ey; }
    if (!oky) { ey = ex; }
  }
  let lx = select(0.0, length(ex), hasFp); let ly = select(0.0, length(ey), hasFp);
  let fpLod = select(0.0, max(min(lx, ly), max(lx, ly) / 8.0), hasFp);
  let fp = select(0.0, sqrt(lx * ly), hasFp);
  if ((fl & ${F.tex}u) != 0u) {
    let k = M[b + 2u]; let det = M[b + 3u];
    let lod = select(0.0, smoothT(4.0 * det, 6.0 * det, fpLod), hasFp);
    let mc = m3(b + 4u); let mn = vec2f(M[b + 7u], M[b + 8u]);
    var tc = vec3f(0.0); var tn = vec2f(0.0);
    if (lod >= 1.0) { tc = mc; tn = mn; }
    else if (hasFp && max(lx, ly) > det) {
      let dux = dot(ex, au); let dvx = dot(ex, av); let duy = dot(ey, au); let dvy = dot(ey, av);
      let sx = i32(min(8.0, ceil(length(vec2f(dux, dvx)) / det))); let sy = i32(min(8.0, ceil(length(vec2f(duy, dvy)) / det)));
      let ja = h2(i32(i), 1, 57); let jb = h2(i32(i), 2, 57);
      var ac = vec3f(0.0); var an = vec2f(0.0);
      for (var a = 0; a < sx; a++) {
        for (var q = 0; q < sy; q++) {
          let fa = (f32(a) + ja) / f32(sx) - 0.5; let fb = (f32(q) + jb) / f32(sy) - 0.5;
          let s = texSample(b, fl, u + fa * dux + fb * duy, v + fa * dvx + fb * dvy);
          ac += s.c; an += s.n;
        }
      }
      let ns = f32(sx * sy);
      if (lod > 0.0) { tc = (ac / ns) * (1.0 - lod) + mc * lod; tn = (an / ns) * (1.0 - lod) + mn * lod; }
      else { tc = ac / ns; tn = an / ns; }
    } else { let s = texSample(b, fl, u, v); tc = s.c; tn = s.n; }
    if ((fl & ${F.tint}u) != 0u) { tc *= m3(b + 15u); }
    if ((fl & ${F.mult}u) != 0u) { tc *= vec3f(r, gg, bb) / 0.5; }
    r += (tc.x - r) * k; gg += (tc.y - gg) * k; bb += (tc.z - bb) * k;
    if (tn.x != 0.0 || tn.y != 0.0) { N += au * tn.x + av * tn.y; }
  }
  if ((fl & ${F.noise}u) != 0u) {
    let scale = M[b + 30u]; let amt = M[b + 31u]; let octs = M[b + 32u];
    let s = 1.0 / scale;
    let oct = select(octs, max(1.0, min(octs, log2(scale / (2.0 * fp)) + 1.0)), fp > 0.0);
    let nv = fbm(px * s, py * s, pz * s, oct, oct != octs, 11);
    let f = 1.0 + amt * nv * 1.6;
    if ((fl & ${F.noiseC}u) != 0u) {
      let t = c01(nv * amt * 2.0); let nc = m3(b + 33u);
      r = r * f + (nc.x - r) * t; gg = gg * f + (nc.y - gg) * t; bb = bb * f + (nc.z - bb) * t;
    } else { r *= f; gg *= f; bb *= f; }
  }
  if ((fl & ${F.grime}u) != 0u) {
    let hgt = c01(1.0 - (py - M[b + 38u]) / M[b + 36u]); let amt = M[b + 37u];
    let nv = 0.75 + 0.5 * fbm(px * 3.1, py * 1.3, pz * 3.1, 2.0, false, 23);
    let t = c01((hgt * hgt * amt + (1.0 - ao[i]) * M[b + 39u] * amt) * nv); let gc = m3(b + 40u);
    r += (gc.x - r) * t; gg += (gc.y - gg) * t; bb += (gc.z - bb) * t;
  }
  if ((fl & ${F.wear}u) != 0u) {
    let c = c01((curv[i] - 0.15) * 2.2) * M[b + 43u] * (0.6 + 0.8 * max(0.0, fbm(px * 6.0, py * 6.0, pz * 6.0, 2.0, false, 31)));
    if ((fl & ${F.wearC}u) != 0u) { let wc = m3(b + 44u); r += (wc.x - r) * c; gg += (wc.y - gg) * c; bb += (wc.z - bb) * c; }
    else { r = r * (1.0 + c * 0.8) + 0.04 * c; gg = gg * (1.0 + c * 0.8) + 0.04 * c; bb = bb * (1.0 + c * 0.8) + 0.035 * c; }
  }
  if ((fl & ${F.bump}u) != 0u) {
    let sc = M[b + 47u];
    if (!(fp > 0.0 && fp > sc * 2.0)) {
      let s = 1.0 / sc; let e = 0.35; let fade = select(1.0, 1.0 - smoothT(sc * 0.5, sc * 2.0, fp), fp > 0.0);
      let n0 = fbm(u * s, v * s, 0.5, 2.0, false, 41); let nu = fbm(u * s + e, v * s, 0.5, 2.0, false, 41); let nvv = fbm(u * s, v * s + e, 0.5, 2.0, false, 41);
      let du = (nu - n0) * M[b + 48u] * 3.0 * fade; let dv = (nvv - n0) * M[b + 48u] * 3.0 * fade;
      N -= au * du + av * dv;
    }
  }
  if (texOrBump) { let l = length(N); N = N / select(l, 1.0, l == 0.0); Nx[i] = N.x; Ny[i] = N.y; Nz[i] = N.z; }
  lin[i * 3u] = max(0.0, r); lin[i * 3u + 1u] = max(0.0, gg); lin[i * 3u + 2u] = max(0.0, bb);
}`;

/**
 * Материалы на GPU (на месте: lin, Nx, Ny, Nz). mean, det — функции texMean / texDetail процессорной версии.
 * Возвращает число пикселей с материалом.
 */
export function gpuMaterials(mats, { W, H, mid, lin, Nx, Ny, Nz, PNx, PNy, PNz, Px, Py, Pz, ao, filter }, mean, det) {
  const { M, C } = packMaterials(mats, mean, det), n = W * H, gr = groups2(W, H);
  const needWear = mats.some((m) => m.wear);
  // буферы: 0 mid, 1 lin, 2–4 N, 5–7 PN, 8–10 P, 11 ao, 12 curv, 13 M, 14 C
  const bufs = [{ data: mid }, { data: lin, io: 'inout' }, { data: Nx, io: 'inout' }, { data: Ny, io: 'inout' }, { data: Nz, io: 'inout' },
    { data: PNx }, { data: PNy }, { data: PNz }, { data: Px }, { data: Py }, { data: Pz }, { data: ao }, { bytes: needWear ? n * 4 : 16 }, { data: M }, { data: C }];
  const passes = [];
  if (needWear) passes.push({ key: 'mat-curv', code: CURV, entry: 'main', uni: uniforms([['u', W], ['u', H]]), bind: [2, 3, 4, 12], groups: gr });
  passes.push({ entry: 'main', uni: uniforms([['u', W], ['u', H], ['u', mats.length], ['u', filter ? 1 : 0]]), bind: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], groups: gr });
  gpuExec({ key: 'materials', code: MATS, bufs, passes });
  let touched = 0;
  for (let i = 0; i < n; i++) { const id = mid[i]; if (id && id <= mats.length) touched++; }
  return touched;
}
