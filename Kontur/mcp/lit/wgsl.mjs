// Общие куски WGSL для ядер отложенного света (gpu-kernels, gpu-materials, gpu-post): объявления привязок и функции,
// которые были скопированы по шейдерам. Шейдер склеивает нужные строки; каждую — не больше одного раза.

/** Привязки storage-буферов по списку [имя, тип = 'f32', запись?] — binding 1, 2, … (0 — uniform). */
export const binds = (list) => list.map(([name, t = 'f32', rw], k) => `@group(0) @binding(${k + 1}) var<storage, ${rw ? 'read_write' : 'read'}> ${name}: array<${t}>;`).join('\n');

export const CONSTS = /* wgsl */ `
const PI = 3.14159265358979;
const INF = 3.0e38;`;
/** Старшие 24 бита хеша → [0, 1): точно во float32 (так делят все хеши, повторяющие процессорные). */
export const U01 = /* wgsl */ `
fn u01(h: u32) -> f32 { return f32(h >> 8u) / 16777216.0; }`;
/** Math.round (половина — вверх), а не round() WGSL (к чётному). */
export const JROUND = /* wgsl */ `
fn jround(v: f32) -> i32 { return i32(floor(v + 0.5)); }`;
/** Отражение индекса за краем (reflect, как scipy.ndimage). */
export const REFL = /* wgsl */ `
fn refl(i: i32, n: i32) -> i32 { var j = i; loop { if (j >= 0 && j < n) { break; } if (j < 0) { j = -j - 1; } else { j = 2 * n - j - 1; } } return j; }`;
export const C01 = /* wgsl */ `
fn c01(v: f32) -> f32 { return clamp(v, 0.0, 1.0); }`;
/** Чтение маски Uint8 (по 4 в u32; имя привязки m). */
export const MASK = /* wgsl */ `fn mk(i: u32) -> bool { return ((m[i >> 2u] >> ((i & 3u) * 8u)) & 0xffu) != 0u; }`;
