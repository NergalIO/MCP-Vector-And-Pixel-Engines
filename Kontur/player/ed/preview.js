// Превью пикселей и света: кадр растрируется в браузере; свет считается шейдером по карте высот (как 2D-свет Godot).
import { K, E, on, emit } from './core.js';
import { canvasBox } from './view.js';

const pv = document.getElementById('pv');
const ctx2 = pv.getContext('2d');
const work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });
let busy = false, again = false, srcCache = new Map(), mapped = null, mappedVer = -1;

on('frame preview scene view previewmode states', schedule);
export function schedule() {
  const on = E.pixelPreview || E.lightPreview;
  canvasBox.classList.toggle('ghost', on);
  pv.style.display = on ? 'block' : 'none';
  if (!on) return;
  place();
  if (busy) { again = true; return; }
  busy = true;
  run().catch((e) => { console.error(e); }).finally(() => { busy = false; if (again) { again = false; schedule(); } });
}
function place() {
  Object.assign(pv.style, { left: E.panX + 'px', top: E.panY + 'px', width: E.scene.width * E.zoom + 'px', height: E.scene.height * E.zoom + 'px' });
  pv.classList.toggle('pixel', !!E.pixelPreview);
}

/** Картинки сцены — внутрь SVG (картинка-SVG не грузит внешние файлы). */
async function inlineScene() {
  if (mapped && mappedVer === E.ver) return mapped;
  const s = E.scene, srcs = new Set();
  for (const n of s.nodes) if (n.type === 'image') { if (typeof n.props?.src === 'string') srcs.add(n.props.src); for (const k of n.keys?.src || []) srcs.add(k.v); }
  for (const src of srcs) {
    if (srcCache.has(src) || /^data:/.test(src)) continue;
    try { const b = await (await fetch(src)).blob(); srcCache.set(src, await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); })); } catch { srcCache.set(src, src); }
  }
  const map = (v) => srcCache.get(v) || v;
  mapped = srcs.size ? { ...s, nodes: s.nodes.map((n) => (n.type !== 'image' ? n : { ...n, props: { ...n.props, src: map(n.props?.src) }, ...(n.keys?.src ? { keys: { ...n.keys, src: n.keys.src.map((k) => ({ ...k, v: map(k.v) })) } } : {}) })) } : s;
  mappedVer = E.ver;
  return mapped;
}
async function raster(svg, w, h) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image(); img.src = url; await img.decode();
    work.width = w; work.height = h; wctx.clearRect(0, 0, w, h); wctx.drawImage(img, 0, 0, w, h);
    return wctx.getImageData(0, 0, w, h);
  } finally { URL.revokeObjectURL(url); }
}

async function run() {
  const s = await inlineScene(), W = E.scene.width, H = E.scene.height;
  const px = E.pixelPreview ? (K.pixelOf(E.scene) || { size: Math.max(2, Math.round(W / 320)) }) : null;
  const w = px ? Math.max(8, Math.round(W / px.size)) : Math.max(64, Math.min(1400, Math.round(W * E.zoom * Math.min(2, devicePixelRatio || 1))));
  const h = Math.max(8, Math.round((w * H) / W));
  const opts = { width: w, states: E.states, crisp: !!px && !px.aa };
  if (px) invalidateIfNeeded(s);
  const color = await raster(K.renderSVG(s, E.t, opts), w, h);
  if (px?.palette?.length) K.quantizeRGBA(color.data, px.palette);
  let out = color;
  if (E.lightPreview) {
    const relief = { ...K.RELIEF_DEFAULT, ...(E.scene.relief || {}) };
    const height = await raster(K.renderSVG(s, E.t, { ...opts, mode: 'height', relief }), w, h);
    out = lightGL(color, height, w / W);
  }
  pv.width = w; pv.height = h;
  if (out instanceof ImageData) ctx2.putImageData(out, 0, 0); else { ctx2.clearRect(0, 0, w, h); ctx2.drawImage(out, 0, 0); }
}
function invalidateIfNeeded(s) { if (s !== E.scene) K.invalidate(s); }

/* ---------- WebGL: нормали из высот (Собель) и свет ---------- */
let gl = null, prog = null, glc = null, texC = null, texH = null;
const MAXL = 16;
function initGL() {
  glc = document.createElement('canvas');
  gl = glc.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) return false;
  const vs = `attribute vec2 a; varying vec2 v; void main(){ v = vec2(a.x * .5 + .5, .5 - a.y * .5); gl_Position = vec4(a, 0., 1.); }`;
  const fs = `precision highp float; varying vec2 v; uniform sampler2D uC, uH; uniform vec2 uPx, uSize; uniform float uStr; uniform vec3 uAmb; uniform int uN; uniform vec4 uL[${MAXL}]; uniform vec4 uLc[${MAXL}];
  float H(vec2 o){ return texture2D(uH, v + o * uPx).r; }
  void main(){
    vec4 c = texture2D(uC, v);
    float gx = (H(vec2(1.,-1.)) + 2.*H(vec2(1.,0.)) + H(vec2(1.,1.)) - H(vec2(-1.,-1.)) - 2.*H(vec2(-1.,0.)) - H(vec2(-1.,1.))) / 8.;
    float gy = (H(vec2(-1.,1.)) + 2.*H(vec2(0.,1.)) + H(vec2(1.,1.)) - H(vec2(-1.,-1.)) - 2.*H(vec2(0.,-1.)) - H(vec2(1.,-1.))) / 8.;
    vec3 n = normalize(vec3(-gx * uStr, -gy * uStr, 1.));
    vec2 p = v * uSize; vec3 acc = uAmb;
    for (int i = 0; i < ${MAXL}; i++) { if (i >= uN) break;
      vec2 d = uL[i].xy - p; float dist = length(d);
      if (dist < uL[i].w) { float att = pow(1. - dist / uL[i].w, uLc[i].w); acc += uLc[i].rgb * max(0., dot(n, normalize(vec3(d, uL[i].z)))) * att; } }
    gl_FragColor = vec4(min(c.rgb * acc, vec3(1.)), c.a);
  }`;
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); gl.useProgram(prog);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const mk = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; };
  texC = mk(); texH = mk();
  return true;
}
function lightGL(color, height, k) {
  if (!gl && !initGL()) { emit('toast', 'WebGL недоступен — превью света выключено'); return color; }
  const w = color.width, h = color.height;
  glc.width = w; glc.height = h; gl.viewport(0, 0, w, h);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texC); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, color);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texH); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, height);
  const U = (n) => gl.getUniformLocation(prog, n);
  gl.uniform1i(U('uC'), 0); gl.uniform1i(U('uH'), 1);
  gl.uniform2f(U('uPx'), 1 / w, 1 / h); gl.uniform2f(U('uSize'), w, h);
  gl.uniform1f(U('uStr'), ((E.scene.relief?.strength ?? 3) * 4));
  const amb = K.parseColor(E.scene.ambient || '#4a4f5c') || [0.29, 0.31, 0.36];
  gl.uniform3f(U('uAmb'), amb[0], amb[1], amb[2]);
  const ls = K.collectLights(E.scene, E.t, { states: E.states }).slice(0, MAXL);
  const L = new Float32Array(MAXL * 4), C = new Float32Array(MAXL * 4);
  ls.forEach((l, i) => {
    const c = K.parseColor(l.color) || [1, 1, 1], e = l.energy ?? 1;
    L.set([l.x * k, l.y * k, (l.z ?? 80) * k, Math.max(1, (l.radius ?? 500) * k)], i * 4);
    C.set([c[0] * e, c[1] * e, c[2] * e, l.falloff ?? 1], i * 4);
  });
  gl.uniform1i(U('uN'), ls.length); gl.uniform4fv(U('uL'), L); gl.uniform4fv(U('uLc'), C);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return glc;
}
