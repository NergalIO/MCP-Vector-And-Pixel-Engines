// Ядра отложенного света на WebGPU (WGSL) — те же формулы, что у процессорных kGauss*/kBilateral/kGtao/kSsao/kGather/
// kSun*/kShadeSun/kPaint, но во float32 (кадр совпадает с процессорным в пределах округления). Вызываются через
// viaGPU (gpu.mjs) с запасным путём на процессоре. Маски Uint8 идут на GPU как есть (по 4 в u32).
import { gpuExec, uniforms, groups2 } from './gpu.mjs';
import { f32 } from './pool.mjs';

const COMMON = /* wgsl */ `
const PI = 3.14159265358979;
const INF = 3.0e38;
// hash01 из util.mjs (целочисленная часть та же, деление — по старшим 24 битам: точно во float32)
fn hash01(i: u32, s: u32) -> f32 {
  var h = (i ^ (s * 0x9e3779b1u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u); h = h * 0xc2b2ae35u; h = h ^ (h >> 16u);
  return f32(h >> 8u) / 16777216.0;
}
// Math.round (половина — вверх), а не round() WGSL (к чётному)
fn jround(v: f32) -> i32 { return i32(floor(v + 0.5)); }
`;
/** Чтение маски Uint8 (имя привязки m). */
const MASK = /* wgsl */ `fn mk(i: u32) -> bool { return ((m[i >> 2u] >> ((i & 3u) * 8u)) & 0xffu) != 0u; }`;
const store = (b, i, t = 'f32', rw = false) => `@group(0) @binding(${i}) var<storage, ${rw ? 'read_write' : 'read'}> ${b}: array<${t}>;`;
const binds = (list) => list.map(([name, t, rw], k) => store(name, k + 1, t, rw)).join('\n');

/* ---------------- гаусс ---------------- */
const GAUSS = COMMON + /* wgsl */ `
struct U { w: u32, h: u32, r: i32, dir: u32 }
@group(0) @binding(0) var<uniform> p: U;
${binds([['src'], ['o', 'f32', true], ['k']])}
fn refl(i: i32, n: i32) -> i32 { var j = i; loop { if (j >= 0 && j < n) { break; } if (j < 0) { j = -j - 1; } else { j = 2 * n - j - 1; } } return j; }
@compute @workgroup_size(16, 16) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= p.w || g.y >= p.h) { return; }
  let x = i32(g.x); let y = i32(g.y); let w = i32(p.w); let h = i32(p.h);
  var a = 0.0;
  if (p.dir == 0u) { for (var i = -p.r; i <= p.r; i++) { a += src[y * w + refl(x + i, w)] * k[i + p.r]; } }
  else { for (var i = -p.r; i <= p.r; i++) { a += src[refl(y + i, h) * w + x] * k[i + p.r]; } }
  o[g.y * p.w + g.x] = a;
}`;
/** Гаусс (оба прохода) ядром k радиуса r. */
export function gpuGauss(src, w, h, k, r) {
  const out = f32(w * h), gr = groups2(w, h);
  gpuExec({ key: 'gauss', code: GAUSS, bufs: [{ data: src }, { bytes: w * h * 4 }, { data: out, io: 'out' }, { data: k }], passes: [
    { entry: 'main', uni: uniforms([['u', w], ['u', h], ['i', r], ['u', 0]]), bind: [0, 1, 3], groups: gr },
    { entry: 'main', uni: uniforms([['u', w], ['u', h], ['i', r], ['u', 1]]), bind: [1, 2, 3], groups: gr },
  ] });
  return out;
}

/* ---------------- совместный билатеральный ---------------- */
const BILATERAL = COMMON + /* wgsl */ `
struct U { w: u32, h: u32, r: i32, dx: u32 }
@group(0) @binding(0) var<uniform> p: U;
${binds([['a'], ['o', 'f32', true], ['D'], ['nx'], ['ny'], ['nz'], ['m', 'u32'], ['k']])}
${MASK}
@compute @workgroup_size(16, 16) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= p.w || g.y >= p.h) { return; }
  let i = g.y * p.w + g.x;
  if (!mk(i)) { o[i] = a[i]; return; }
  let d0 = D[i]; let tol = d0 * 0.035 + 0.03; let n0 = vec3f(nx[i], ny[i], nz[i]);
  let lim = select(i32(p.h), i32(p.w), p.dx == 1u);
  let pos = select(i32(g.y), i32(g.x), p.dx == 1u);
  let step = select(i32(p.w), 1, p.dx == 1u);
  var acc = 0.0; var ws = 0.0;
  for (var q = -p.r; q <= p.r; q++) {
    let pp = pos + q;
    if (pp < 0 || pp >= lim) { continue; }
    let j = u32(i32(i) + q * step);
    if (!mk(j)) { continue; }
    let dd = (D[j] - d0) / tol;
    var wt = k[q + p.r] * exp(-dd * dd);
    if (dot(n0, vec3f(nx[j], ny[j], nz[j])) < 0.75) { wt *= 0.04; }
    acc += a[j] * wt; ws += wt;
  }
  o[i] = select(a[i], acc / ws, ws > 0.0);
}`;
/** Билатеральный (оба прохода): веса по глубине D, нормали (nx, ny, nz), маска m (Uint8). */
export function gpuBilateral(src, w, h, k, r, D, nx, ny, nz, m) {
  const out = f32(w * h), gr = groups2(w, h);
  gpuExec({ key: 'bilateral', code: BILATERAL, bufs: [{ data: src }, { bytes: w * h * 4 }, { data: out, io: 'out' }, { data: D }, { data: nx }, { data: ny }, { data: nz }, { data: m }, { data: k }], passes: [
    { entry: 'main', uni: uniforms([['u', w], ['u', h], ['i', r], ['u', 1]]), bind: [0, 1, 3, 4, 5, 6, 7, 8], groups: gr },
    { entry: 'main', uni: uniforms([['u', w], ['u', h], ['i', r], ['u', 0]]), bind: [1, 2, 3, 4, 5, 6, 7, 8], groups: gr },
  ] });
  return out;
}

/* ---------------- GTAO ---------------- */
const GTAO = COMMON + /* wgsl */ `
struct U { hw: u32, hh: u32, dirs: u32, steps: u32, wantBent: u32, rad: f32, fall0: f32, bias: f32, fHalf: f32, maxPx: f32 }
@group(0) @binding(0) var<uniform> p: U;
${binds([['m', 'u32'], ['hx'], ['hy'], ['hz'], ['hnx'], ['hny'], ['hnz'], ['hD'], ['vis', 'f32', true], ['bx', 'f32', true], ['by', 'f32', true], ['bz', 'f32', true]])}
${MASK}
fn fall(d: f32) -> f32 {
  if (d <= p.fall0) { return 1.0; }
  if (d >= p.rad) { return 0.0; }
  let den = select(p.rad - p.fall0, 1e-6, p.rad - p.fall0 == 0.0);
  return 1.0 - (d - p.fall0) / den;
}
@compute @workgroup_size(16, 16) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= p.hw || g.y >= p.hh) { return; }
  let x = i32(g.x); let y = i32(g.y); let hw = i32(p.hw); let hh = i32(p.hh);
  let j = g.y * p.hw + g.x;
  if (!mk(j)) { return; }
  let P = vec3f(hx[j], hy[j], hz[j]); let N = vec3f(hnx[j], hny[j], hnz[j]);
  let rpx = min(p.maxPx, (p.rad * p.fHalf) / max(0.3, hD[j]));
  var B = N * 0.2;
  if (rpx < 1.0) { if (p.wantBent != 0u) { bx[j] = N.x; by[j] = N.y; bz[j] = N.z; } return; }
  let rot = hash01(j, 31u) * PI; let jit = hash01(j, 37u);
  var vsum = 0.0;
  for (var d = 0u; d < p.dirs; d++) {
    let a = rot + f32(d) * PI / f32(p.dirs); let ca = cos(a); let sa = sin(a);
    for (var side = -1; side <= 1; side += 2) {
      var hmax = 0.0; var t = vec3f(0.0); var has = false;
      for (var s = 0u; s < p.steps; s++) {
        let tt = 1.0 + (rpx - 1.0) * ((f32(s) + jit) / f32(p.steps));
        let sx = jround(f32(x) + f32(side) * ca * tt); let sy = jround(f32(y) + f32(side) * sa * tt);
        if (sx < 0 || sy < 0 || sx >= hw || sy >= hh) { break; }
        let q = u32(sy * hw + sx);
        if (!mk(q) || q == j) { continue; }
        let v = vec3f(hx[q], hy[q], hz[q]) - P; let dist = length(v) + 1e-5;
        if (!has) { t = v; has = true; }
        if (dist >= p.rad) { continue; }
        let hv = (dot(v, N) / dist - p.bias) * fall(dist);
        if (hv > hmax) { hmax = hv; }
      }
      hmax = min(1.0, hmax);
      let vv = 1.0 - hmax; vsum += vv;
      if (p.wantBent != 0u && has) {
        let dn = dot(t, N); var u = t - dn * N; let ul = length(u);
        if (ul > 1e-6) { u = u / ul; let e = (asin(hmax) + PI / 2.0) / 2.0; B += (cos(e) * u + sin(e) * N) * vv; }
      }
    }
  }
  vis[j] = vsum / f32(2u * p.dirs);
  if (p.wantBent != 0u) { bx[j] = B.x; by[j] = B.y; bz[j] = B.z; }
}`;
/** Основной цикл GTAO (kGtao): vis и изогнутая нормаль bx/by/bz на половинной сетке. */
export function gpuGtao({ hw, hh, hm, hx, hy, hz, hnx, hny, hnz, hD, vis, bx, by, bz, wantBent, rad, dirs, steps, fall0, bias, fHalf, maxPx }) {
  const hn = hw * hh, dummy = { bytes: 16 };
  gpuExec({ key: 'gtao', code: GTAO, bufs: [{ data: hm }, { data: hx }, { data: hy }, { data: hz }, { data: hnx }, { data: hny }, { data: hnz }, { data: hD }, { data: vis, io: 'inout' },
    wantBent ? { data: bx, io: 'inout' } : dummy, wantBent ? { data: by, io: 'inout' } : dummy, wantBent ? { data: bz, io: 'inout' } : dummy], passes: [
    { entry: 'main', uni: uniforms([['u', hw], ['u', hh], ['u', dirs], ['u', steps], ['u', wantBent ? 1 : 0], ['f', rad], ['f', fall0], ['f', bias], ['f', fHalf], ['f', maxPx]]), bind: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], groups: groups2(hw, hh) },
  ] });
  return hn;
}

/* ---------------- SSAO ---------------- */
const SSAO = COMMON + /* wgsl */ `
struct U { hw: u32, hh: u32, cnt: u32, rad: f32 }
@group(0) @binding(0) var<uniform> p: U;
${binds([['hx'], ['hy'], ['hz'], ['hnx'], ['hny'], ['hnz'], ['occ', 'f32', true], ['offs', 'i32']])}
@compute @workgroup_size(16, 16) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= p.hw || g.y >= p.hh) { return; }
  let x = i32(g.x); let y = i32(g.y); let hw = i32(p.hw); let hh = i32(p.hh);
  let j = g.y * p.hw + g.x;
  let P = vec3f(hx[j], hy[j], hz[j]); let N = vec3f(hnx[j], hny[j], hnz[j]);
  var acc = 0.0;
  for (var k = 0u; k < p.cnt; k++) {
    let sx = clamp(x + offs[2u * k], 0, hw - 1); let sy = clamp(y + offs[2u * k + 1u], 0, hh - 1);
    let s = u32(sy * hw + sx);
    let v = vec3f(hx[s], hy[s], hz[s]) - P; let dist = length(v) + 1e-4;
    let q = dist / p.rad;
    acc += clamp(dot(v, N) / dist - 0.12, 0.0, 1.0) / (1.0 + q * q);
  }
  occ[j] = acc;
}`;
/** Сумма заслонения SSAO (kSsao) по смещениям offs в occA. */
export function gpuSsao({ hw, hh, hx, hy, hz, hnx, hny, hnz, occA, rad, offs }) {
  gpuExec({ key: 'ssao', code: SSAO, bufs: [{ data: hx }, { data: hy }, { data: hz }, { data: hnx }, { data: hny }, { data: hnz }, { data: occA, io: 'out' }, { data: Int32Array.from(offs) }], passes: [
    { entry: 'main', uni: uniforms([['u', hw], ['u', hh], ['u', offs.length / 2], ['f', rad]]), bind: [0, 1, 2, 3, 4, 5, 6, 7], groups: groups2(hw, hh) },
  ] });
}

/* ---------------- GI: сбор излучения ---------------- */
const GATHER = COMMON + /* wgsl */ `
struct U { hw: u32, hh: u32, dirs: u32, nr: u32, salt: u32, kk: f32, rad: f32 }
@group(0) @binding(0) var<uniform> p: U;
${binds([['m', 'u32'], ['hx'], ['hy'], ['hz'], ['hnx'], ['hny'], ['hnz'], ['s0'], ['s1'], ['s2'], ['o0', 'f32', true], ['o1', 'f32', true], ['o2', 'f32', true], ['radii']])}
${MASK}
@compute @workgroup_size(16, 16) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= p.hw || g.y >= p.hh) { return; }
  let x = f32(g.x); let y = f32(g.y); let hw = i32(p.hw); let hh = i32(p.hh);
  let j = g.y * p.hw + g.x;
  if (!mk(j)) { return; }
  let P = vec3f(hx[j], hy[j], hz[j]); let N = vec3f(hnx[j], hny[j], hnz[j]);
  let rot = hash01(j + p.salt, 7u) * 6.2831853;
  var acc = vec3f(0.0);
  for (var ri = 0u; ri < p.nr; ri++) {
    for (var q = 0u; q < p.dirs; q++) {
      let a = rot + f32(q) * 6.2831853 / f32(p.dirs) + f32(ri) * 0.9;
      let rr = radii[ri] * (0.75 + 0.5 * hash01(j * 31u + ri * p.dirs + q + p.salt, 9u));
      let sx = jround(x + cos(a) * rr); let sy = jround(y + sin(a) * rr);
      if (sx < 0 || sy < 0 || sx >= hw || sy >= hh) { continue; }
      let s = u32(sy * hw + sx);
      if (!mk(s)) { continue; }
      let v = vec3f(hx[s], hy[s], hz[s]) - P; let d = length(v) + 1e-4;
      let cr = dot(v, N) / d; let cs = -dot(v, vec3f(hnx[s], hny[s], hnz[s])) / d;
      if (cr <= 0.05 || cs <= 0.05) { continue; }
      let dq = d / p.rad;
      let w = (cr * cs) / (1.0 + dq * dq);
      acc += vec3f(s0[s], s1[s], s2[s]) * w;
    }
  }
  o0[j] = acc.x * p.kk; o1[j] = acc.y * p.kk; o2[j] = acc.z * p.kk;
}`;
/** Сбор излучения GI (kGather): src — три канала, out — три канала. */
export function gpuGather({ hw, hh, hm, hx, hy, hz, hnx, hny, hnz, src, out, radii, dirs, kk, salt, rad }) {
  gpuExec({ key: 'gather', code: GATHER, bufs: [{ data: hm }, { data: hx }, { data: hy }, { data: hz }, { data: hnx }, { data: hny }, { data: hnz }, { data: src[0] }, { data: src[1] }, { data: src[2] },
    { data: out[0], io: 'out' }, { data: out[1], io: 'out' }, { data: out[2], io: 'out' }, { data: Float32Array.from(radii) }], passes: [
    { entry: 'main', uni: uniforms([['u', hw], ['u', hh], ['u', dirs], ['u', radii.length], ['u', salt], ['f', kk], ['f', rad]]), bind: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], groups: groups2(hw, hh) },
  ] });
}

/* ---------------- тени солнца: лучи по BVH ---------------- */
const SUN = COMMON + /* wgsl */ `
struct U { W: u32, hw: u32, hh: u32, nt: u32, nprim: u32, soft: u32, Lx: f32, Ly: f32, Lz: f32,
  T1x: f32, T1y: f32, T1z: f32, T2x: f32, T2y: f32, T2z: f32, tanH: f32, f: f32 }
@group(0) @binding(0) var<uniform> p: U;
${binds([['m', 'u32'], ['PNx'], ['PNy'], ['PNz'], ['Px'], ['Py'], ['Pz'], ['Dp'], ['shH', 'f32', true], ['pen', 'f32', true], ['T'], ['A'], ['B'], ['idx', 'i32'], ['NB'], ['NC', 'i32']])}
${MASK}
fn bhash(seed: u32, q: u32) -> f32 {
  var h = seed ^ ((q + 1u) * 0x9e3779b1u);
  h = (h ^ (h >> 16u)) * 0x85ebca6bu; h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  return f32((h ^ (h >> 16u)) >> 8u) / 16777216.0;
}
fn inv(d: f32) -> f32 { return 1.0 / select(d, 1e-9, abs(d) < 1e-9); }
fn hitPrim(q: u32, o: vec3f, d: vec3f, tmax: f32) -> f32 {
  if (q < p.nt) {
    let b = q * 9u;
    let v0 = vec3f(T[b], T[b + 1u], T[b + 2u]); let e1 = vec3f(T[b + 3u], T[b + 4u], T[b + 5u]); let e2 = vec3f(T[b + 6u], T[b + 7u], T[b + 8u]);
    let pv = cross(d, e2); let det = dot(pv, e1);
    if (det > -1e-9 && det < 1e-9) { return INF; }
    let id = 1.0 / det; let s = o - v0;
    let u = dot(s, pv) * id;
    if (u < 0.0 || u > 1.0) { return INF; }
    let qv = cross(s, e1);
    let v = dot(d, qv) * id;
    if (v < 0.0 || u + v > 1.0) { return INF; }
    let tt = dot(e2, qv) * id;
    return select(INF, tt, tt > 1e-3 && tt < tmax);
  }
  let c = q * 6u;
  let iv = vec3f(inv(d.x), inv(d.y), inv(d.z));
  let t1 = (vec3f(B[c], B[c + 1u], B[c + 2u]) - o) * iv; let t2 = (vec3f(B[c + 3u], B[c + 4u], B[c + 5u]) - o) * iv;
  let tn = max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z));
  let tf = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));
  if (tf >= max(tn, 1e-3) && tn < tmax) { return max(tn, 1e-3); }
  return INF;
}
fn trav(o: vec3f, d: vec3f, tmax: f32, any: bool, seed: u32) -> f32 {
  let iv = vec3f(inv(d.x), inv(d.y), inv(d.z));
  var st: array<u32, 64>;
  var sp = 1u; st[0] = 0u;
  var best = tmax;
  loop {
    if (sp == 0u) { break; }
    sp -= 1u;
    let id = st[sp]; let c = id * 6u;
    let t1 = (vec3f(NB[c], NB[c + 1u], NB[c + 2u]) - o) * iv; let t2 = (vec3f(NB[c + 3u], NB[c + 4u], NB[c + 5u]) - o) * iv;
    let tn = max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z));
    let tf = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));
    if (tf < tn || tf < 0.0 || tn > best) { continue; }
    let a = NC[id * 2u]; let b = NC[id * 2u + 1u];
    if (b < 0) {
      for (var k = a; k < a - b; k++) {
        let q = u32(idx[k]);
        let t = hitPrim(q, o, d, best);
        if (t < best) {
          if (A[q] < 1.0 && bhash(seed, q) >= A[q]) { continue; }
          if (any) { return t; }
          best = t;
        }
      }
    } else if (sp < 62u) { st[sp] = u32(a); st[sp + 1u] = u32(b); sp += 2u; }
  }
  return select(INF, best, best < tmax);
}
@compute @workgroup_size(16, 16) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= p.hw || g.y >= p.hh) { return; }
  let i = 2u * g.y * p.W + 2u * g.x; let j = g.y * p.hw + g.x;
  let L = vec3f(p.Lx, p.Ly, p.Lz); let PN = vec3f(PNx[i], PNy[i], PNz[i]);
  if (!mk(i) || dot(PN, L) <= -0.05) { return; }
  let o = vec3f(Px[i], Py[i], Pz[i]) + PN * 0.04;
  if (p.soft == 0u) {
    if (trav(o, L, 1e9, true, i) < 1e30) { shH[j] = 0.0; }
    return;
  }
  let r = p.tanH * sqrt(hash01(j, 1u)); let ph = 6.2831853 * hash01(j, 2u);
  let a = r * cos(ph); let b = r * sin(ph);
  let d = normalize(L + vec3f(p.T1x, p.T1y, p.T1z) * a + vec3f(p.T2x, p.T2y, p.T2z) * b);
  let th = trav(o, d, 1e9, false, j);
  if (th < 1e30) { shH[j] = 0.0; pen[j] = (th * p.tanH * 2.0 * p.f) / 2.0 / max(0.3, Dp[i]); }
}`;
/** Лучи теней солнца (kSunHard / kSunSoft) по массивам BVH (bvh.data). soft: T1, T2, tanH, f, pen. */
export function gpuSun({ W, hw, mask, PNx, PNy, PNz, Px, Py, Pz, Dp, L, shH, bvh, soft, T1 = [0, 0, 0], T2 = [0, 0, 0], tanH = 0, f = 0, pen }) {
  const hh = shH.length / hw, dummy = { bytes: 16 };
  gpuExec({ key: 'sun', code: SUN, bufs: [{ data: mask }, { data: PNx }, { data: PNy }, { data: PNz }, { data: Px }, { data: Py }, { data: Pz }, Dp ? { data: Dp } : dummy,
    { data: shH, io: 'inout' }, soft ? { data: pen, io: 'inout' } : dummy, { data: bvh.T }, { data: bvh.A }, { data: bvh.B }, { data: bvh.idx }, { data: bvh.NB }, { data: bvh.NC }], passes: [
    { entry: 'main', uni: uniforms([['u', W], ['u', hw], ['u', hh], ['u', bvh.nt], ['u', bvh.n], ['u', soft ? 1 : 0], ['f', L[0]], ['f', L[1]], ['f', L[2]],
      ['f', T1[0]], ['f', T1[1]], ['f', T1[2]], ['f', T2[0]], ['f', T2[1]], ['f', T2[2]], ['f', tanH], ['f', f]]), bind: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], groups: groups2(hw, hh) },
  ] });
}

/* ---------------- освещение: окружение + солнце ---------------- */
const SHADE = COMMON + /* wgsl */ `
struct U { W: u32, H: u32, hasBy: u32, hasAoC: u32, mb: u32, camX: f32, camY: f32, camZ: f32, Lx: f32, Ly: f32, Lz: f32,
  sun0: f32, sun1: f32, sun2: f32, specI: f32, sky0: f32, sky1: f32, sky2: f32, g0: f32, g1: f32, g2: f32, ao0: f32, ao1: f32, ao2: f32 }
@group(0) @binding(0) var<uniform> p: U;
${binds([['Nx'], ['Ny'], ['Nz'], ['Px'], ['Py'], ['Pz'], ['spec'], ['direct'], ['ao'], ['by'], ['lin'], ['light', 'f32', true], ['specT', 'f32', true]])}
fn multiBounce(a: f32, alb: f32) -> f32 {
  let ka = 2.0404 * alb - 0.3324; let kb = -4.7951 * alb + 0.6417; let kc = 2.7552 * alb + 0.6903;
  return max(a, ((a * ka + kb) * a + kc) * a);
}
@compute @workgroup_size(16, 16) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= p.W || g.y >= p.H) { return; }
  let i = g.y * p.W + g.x;
  let N = vec3f(Nx[i], Ny[i], Nz[i]);
  let v = normalize(vec3f(p.camX - Px[i], p.camY - Py[i], p.camZ - Pz[i]) );
  let hv = vec3f(p.Lx, p.Ly, p.Lz) + v;
  let hl = length(hv) + 1e-6;
  let sp = pow(clamp(dot(N, hv) / hl, 0.0, 1.0), 40.0) * spec[i] * direct[i] * p.specI;
  let up = select(Ny[i], by[0u + i * p.hasBy], p.hasBy != 0u);
  let sun = array<f32, 3>(p.sun0, p.sun1, p.sun2); let sky = array<f32, 3>(p.sky0, p.sky1, p.sky2);
  let gr = array<f32, 3>(p.g0, p.g1, p.g2); let aoc = array<f32, 3>(p.ao0, p.ao1, p.ao2);
  for (var c = 0u; c < 3u; c++) {
    var a = ao[i];
    if (p.mb != 0u) { a = multiBounce(ao[i], lin[i * 3u + c]); }
    if (p.hasAoC != 0u) { a = 1.0 - (1.0 - a) * (1.0 - aoc[c]); }
    let amb = (sky[c] * (0.5 + 0.5 * up) + gr[c] * (0.5 - 0.5 * up)) * a;
    light[i * 3u + c] = amb + sun[c] * direct[i];
    specT[i * 3u + c] = sp * sun[c];
  }
}`;
/** Окружающий свет, солнце и блик (kShadeSun): light и specT (n·3). */
export function gpuShadeSun({ W, Nx, Ny, Nz, Px, Py, Pz, spec, direct, light, specT, camX, camY, camZ, L, sunC, specI, amb }) {
  const H = Nx.length / W, dummy = { bytes: 16 }, aoC = amb.aoC || [0, 0, 0];
  gpuExec({ key: 'shade', code: SHADE, bufs: [{ data: Nx }, { data: Ny }, { data: Nz }, { data: Px }, { data: Py }, { data: Pz }, { data: spec }, { data: direct }, { data: amb.ao },
    amb.by ? { data: amb.by } : dummy, amb.mb ? { data: amb.lin } : dummy, { data: light, io: 'out' }, { data: specT, io: 'out' }], passes: [
    { entry: 'main', uni: uniforms([['u', W], ['u', H], ['u', amb.by ? 1 : 0], ['u', amb.aoC ? 1 : 0], ['u', amb.mb ? 1 : 0], ['f', camX], ['f', camY], ['f', camZ], ['f', L[0]], ['f', L[1]], ['f', L[2]],
      ['f', sunC[0]], ['f', sunC[1]], ['f', sunC[2]], ['f', specI], ['f', amb.skyC[0]], ['f', amb.skyC[1]], ['f', amb.skyC[2]], ['f', amb.gC[0]], ['f', amb.gC[1]], ['f', amb.gC[2]], ['f', aoC[0]], ['f', aoC[1]], ['f', aoC[2]]]),
    bind: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], groups: groups2(W, H) },
  ] });
}

/* ---------------- стиль paint: анизотропный Кувахара ---------------- */
const PAINT = COMMON + /* wgsl */ `
struct U { W: u32, H: u32, np: u32, R: f32, q: f32, alpha: f32 }
@group(0) @binding(0) var<uniform> p: U;
${binds([['Es'], ['Fs'], ['Gs'], ['img'], ['o', 'f32', true], ['pts']])}
@compute @workgroup_size(16, 16) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= p.W || g.y >= p.H) { return; }
  let x = f32(g.x); let y = f32(g.y); let W = i32(p.W); let H = i32(p.H);
  let i = g.y * p.W + g.x;
  let e = Es[i]; let ff = Fs[i]; let gg = Gs[i];
  let dsc = sqrt((e - gg) * (e - gg) + 4.0 * ff * ff); let l1 = (e + gg + dsc) / 2.0; let l2 = (e + gg - dsc) / 2.0;
  var tx = l1 - e; var ty = -ff;
  let tl = sqrt(tx * tx + ty * ty);
  if (tl > 1e-9) { tx /= tl; ty /= tl; } else { tx = 1.0; ty = 0.0; }
  let A = select(0.0, (l1 - l2) / (l1 + l2), l1 + l2 > 1e-9);
  let ea = (p.R * (p.alpha + A)) / p.alpha; let eb = (p.R * p.alpha) / (p.alpha + A);
  var sm: array<vec3f, 8>; var sq: array<f32, 8>; var cn: array<f32, 8>;
  let c0 = vec3f(img[i * 3u], img[i * 3u + 1u], img[i * 3u + 2u]);
  for (var s = 0u; s < 8u; s++) { sm[s] = c0; sq[s] = dot(c0, c0); cn[s] = 1.0; }
  for (var k = 0u; k < p.np; k++) {
    let u = pts[k * 3u] * ea; let v = pts[k * 3u + 1u] * eb;
    let sx = clamp(jround(x + u * tx - v * ty), 0, W - 1); let sy = clamp(jround(y + u * ty + v * tx), 0, H - 1);
    let jj = u32(sy * W + sx) * 3u;
    let s = u32(pts[k * 3u + 2u]);
    let c = vec3f(img[jj], img[jj + 1u], img[jj + 2u]);
    sm[s] += c; sq[s] += dot(c, c); cn[s] += 1.0;
  }
  var wsum = vec3f(0.0); var ws = 0.0;
  for (var s = 0u; s < 8u; s++) {
    let s2 = (s + 1u) & 7u; let c = cn[s] + cn[s2];
    let mc = (sm[s] + sm[s2]) / c;
    let vr = max(0.0, (sq[s] + sq[s2]) / c - dot(mc, mc));
    let w = 1.0 / (1.0 + pow(sqrt(vr) * 255.0, p.q / 2.0) * 1e-6);
    wsum += mc * w; ws += w;
  }
  let r = wsum / ws;
  o[i * 3u] = r.x; o[i * 3u + 1u] = r.y; o[i * 3u + 2u] = r.z;
}`;
/** Стиль paint (kPaint): out (n·3) по img и тензору структуры. */
export function gpuPaint({ W, H, R, q, alpha, Es, Fs, Gs, img, out, pts }) {
  const P = new Float32Array(pts.length * 3);
  pts.forEach((t, k) => { P[k * 3] = t[0]; P[k * 3 + 1] = t[1]; P[k * 3 + 2] = t[2]; });
  gpuExec({ key: 'paint', code: PAINT, bufs: [{ data: Es }, { data: Fs }, { data: Gs }, { data: img }, { data: out, io: 'out' }, { data: P }], passes: [
    { entry: 'main', uni: uniforms([['u', W], ['u', H], ['u', pts.length], ['f', R], ['f', q], ['f', alpha]]), bind: [0, 1, 2, 3, 4, 5], groups: groups2(W, H) },
  ] });
}

/* ---------------- лампы: свет и блик всех точечных источников ---------------- */
// Запись лампы (LREC чисел): lx, ly, lz, r, lc0, lc1, lc2, xa, xb, ya, yb, visOff, vw, vx0, vy0, hasVis
const LREC = 16;
const LAMPS = COMMON + /* wgsl */ `
struct U { W: u32, H: u32, nl: u32, specI: f32, camX: f32, camY: f32, camZ: f32 }
@group(0) @binding(0) var<uniform> p: U;
${binds([['Nx'], ['Ny'], ['Nz'], ['Px'], ['Py'], ['Pz'], ['spec'], ['lampL', 'f32', true], ['specT', 'f32', true], ['Ls'], ['vis']])}
@compute @workgroup_size(16, 16) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= p.W || g.y >= p.H) { return; }
  let i = g.y * p.W + g.x; let fx = f32(g.x); let fy = f32(g.y);
  let P = vec3f(Px[i], Py[i], Pz[i]); let N = vec3f(Nx[i], Ny[i], Nz[i]);
  var vv3 = vec3f(p.camX, p.camY, p.camZ) - P;
  let vl = length(vv3) + 1e-6; vv3 = vv3 / vl;
  var L = vec3f(lampL[i * 3u], lampL[i * 3u + 1u], lampL[i * 3u + 2u]);
  var S = vec3f(specT[i * 3u], specT[i * 3u + 1u], specT[i * 3u + 2u]);
  var hit = false;
  for (var k = 0u; k < p.nl; k++) {
    let b = k * ${LREC}u;
    if (fx < Ls[b + 7u] || fx > Ls[b + 8u] || fy < Ls[b + 9u] || fy > Ls[b + 10u]) { continue; }
    let dd = vec3f(Ls[b], Ls[b + 1u], Ls[b + 2u]) - P; let r = Ls[b + 3u];
    let dist = length(dd) + 1e-4;
    if (dist >= r) { continue; }
    let ld = dd / dist;
    let q = 1.0 - (dist / r) * (dist / r); let att = q * q;
    let nd = clamp(dot(N, ld), 0.0, 1.0);
    var vis1 = 1.0;
    if (Ls[b + 15u] != 0.0) { vis1 = vis[u32(Ls[b + 11u]) + u32(fy - Ls[b + 14u]) * u32(Ls[b + 12u]) + u32(fx - Ls[b + 13u])]; }
    let hv = ld + vv3; let hl = length(hv) + 1e-6;
    let sp = pow(clamp(dot(N, hv) / hl, 0.0, 1.0), 30.0) * spec[i] * att * vis1 * p.specI;
    let lc = vec3f(Ls[b + 4u], Ls[b + 5u], Ls[b + 6u]);
    L += nd * att * vis1 * lc; S += sp * lc; hit = true;
  }
  if (!hit) { return; }
  lampL[i * 3u] = L.x; lampL[i * 3u + 1u] = L.y; lampL[i * 3u + 2u] = L.z;
  specT[i * 3u] = S.x; specT[i * 3u + 1u] = S.y; specT[i * 3u + 2u] = S.z;
}`;
/**
 * Все лампы (kShadeLamp) одним заданием: lamps — [{ lx, ly, lz, r, lc, rect: [xa, xb, ya, yb], vis: { data, w, x0, y0 } | null }],
 * свет — в lampL, блик — в specT (n·3, на месте).
 */
export function gpuLamps({ W, H, Nx, Ny, Nz, Px, Py, Pz, spec, lampL, specT, camX, camY, camZ, specI, lamps }) {
  const Ls = new Float32Array(Math.max(1, lamps.length) * LREC);
  let vn = 0;
  for (const l of lamps) if (l.vis) vn += l.vis.data.length;
  const vis = new Float32Array(Math.max(4, vn));
  vn = 0;
  lamps.forEach((l, k) => {
    const b = k * LREC;
    Ls.set([l.lx, l.ly, l.lz, l.r, l.lc[0], l.lc[1], l.lc[2], ...l.rect], b);
    if (l.vis) { Ls.set([vn, l.vis.w, l.vis.x0, l.vis.y0, 1], b + 11); vis.set(l.vis.data, vn); vn += l.vis.data.length; }
  });
  gpuExec({ key: 'lamps', code: LAMPS, bufs: [{ data: Nx }, { data: Ny }, { data: Nz }, { data: Px }, { data: Py }, { data: Pz }, { data: spec }, { data: lampL, io: 'inout' }, { data: specT, io: 'inout' }, { data: Ls }, { data: vis }], passes: [
    { entry: 'main', uni: uniforms([['u', W], ['u', H], ['u', lamps.length], ['f', specI], ['f', camX], ['f', camY], ['f', camZ]]), bind: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], groups: groups2(W, H) },
  ] });
}
