// Godot 4: проверка совместимости и экспорт с запеканием эффектов.
//
// Импорт SVG в Godot (ThorVG) не поддерживает фильтры (свечение, размытие, тени), режимы наложения
// и растр-паттерны. Экспорт обходит это: сцена раскладывается на слои, каждый слой рендерится
// движком Kontur в PNG со всеми эффектами; анимированные слои — покадрово в AnimatedSprite2D
// (клипы сцены → анимации SpriteFrames); режимы наложения — шейдером по SCREEN_TEXTURE.
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, basename, relative, sep } from 'node:path';
import { renderSVG, clipRange } from '../engine/kontur.js';
import { svgToPng } from './render.mjs';
import { decodePNG, encodePNG, sceneNormalMap } from './normals.mjs';

/* ============================== совместимость ============================== */
const hasProp = (n, k) => n.props?.[k] != null && n.props[k] !== false || !!n.keys?.[k]?.length;

export function compatReport(scene, target = 'godot') {
  if (target !== 'godot') return [];
  const out = [];
  const add = (node, feature, effect) => out.push({ node, feature, effect });
  let animated = 0;
  for (const n of scene.nodes) {
    const p = n.props || {};
    if (hasProp(n, 'glow')) add(n.id, 'свечение (glow)', 'пропадёт: элемент станет плоским (так трубка лампы выглядит серой)');
    if ((p.blur > 0) || n.keys?.blur?.length) add(n.id, 'размытие (blur)', 'пропадёт, края станут резкими');
    if (hasProp(n, 'shadow')) add(n.id, 'тень (shadow)', 'пропадёт');
    if (p.blend && p.blend !== 'normal') add(n.id, `режим наложения ${p.blend}`, 'заменится обычным: фактура или свет лягут непрозрачной пеленой');
    if (p.dither || (p.shade && scene.dither?.enabled)) add(n.id, 'дизеринг (pattern)', 'растр-паттерн не отрисуется или отрисуется сплошной заливкой');
    if (p.mask) add(n.id, 'маска (mask)', 'может отрисоваться иначе — проверьте');
    if (n.type === 'text') add(n.id, 'текст', 'шрифт может не найтись — лучше перевести в кривые');
    if (n.type === 'image' && p.sheet) add(n.id, 'спрайт-лист', 'в статичном SVG будет показан целиком, а не кадром');
    if (n.keys && Object.keys(n.keys).length || n.mods?.some((m) => m.enabled !== false && !(m.type === 'deform' && !m.speed))) animated++;
  }
  if (animated) out.push({ node: '(сцена)', feature: `анимация (${animated} узл.)`, effect: 'импорт SVG даёт статичную картинку' });
  return out;
}

/* ============================== анализ слоёв ============================== */
function isAnimated(scene, id, byId, kids, memo = new Map()) {
  if (memo.has(id)) return memo.get(id);
  memo.set(id, false);
  const n = byId.get(id);
  const p = n.props || {};
  let a = false;
  if (n.keys && Object.values(n.keys).some((k) => k.length > 1 || (k.length === 1 && false))) a = true;
  if (n.mods?.some((m) => m.enabled !== false && !(m.type === 'deform' && !m.speed))) a = true;
  if (n.type === 'blob' && (p.speed ?? 0.5) !== 0) a = true;
  if (n.type === 'image' && p.sheet) a = true;
  if (p.inPoint != null || p.outPoint != null) a = true;
  for (const k of ['clip', 'mask']) if (p[k] && byId.has(p[k]) && isAnimated(scene, p[k], byId, kids, memo)) a = true;
  for (const c of kids.get(id) || []) if (isAnimated(scene, c.id, byId, kids, memo)) a = true;
  memo.set(id, a);
  return a;
}
const area = (b) => (b ? (b[2] - b[0]) * (b[3] - b[1]) : 0);
const union = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
const overlap = (a, b) => a && b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
function alphaBox(img, k = 1) {
  const { width: w, height: h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : [x0 * k, y0 * k, (x1 + 1) * k, (y1 + 1) * k];
}

/* ============================== экспорт ============================== */
const BLEND_MODES = { multiply: 1, screen: 2, overlay: 3, 'soft-light': 4, 'hard-light': 5, darken: 6, lighten: 7, 'color-dodge': 8, 'plus-lighter': 9, difference: 10 };
const SHADER = `shader_type canvas_item;
// Режимы наложения Kontur поверх того, что уже нарисовано под слоем (запечённая альфа = непрозрачность слоя).
uniform int mode = 3; // 1 multiply, 2 screen, 3 overlay, 4 soft-light, 5 hard-light, 6 darken, 7 lighten, 8 color-dodge, 9 add, 10 difference
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;

vec3 blend(vec3 b, vec3 s) {
	if (mode == 1) return b * s;
	if (mode == 2) return 1.0 - (1.0 - b) * (1.0 - s);
	if (mode == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
	if (mode == 4) return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (sqrt(b) - b), step(0.5, s));
	if (mode == 5) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, s));
	if (mode == 6) return min(b, s);
	if (mode == 7) return max(b, s);
	if (mode == 8) return min(vec3(1.0), b / max(vec3(1e-4), 1.0 - s));
	if (mode == 9) return min(vec3(1.0), b + s);
	if (mode == 10) return abs(b - s);
	return s;
}
void fragment() {
	vec4 s = COLOR; // уже = текстура × modulate
	vec3 b = texture(screen_tex, SCREEN_UV).rgb;
	COLOR = vec4(blend(b, s.rgb), s.a);
}
`;

/**
 * exportGodot(scene, dir, opts)
 * opts: fps (12), scale (1 — масштаб текстур), normals (false | true | {…настройки, animated}),
 *       clips (имена; по умолчанию все или «default» = вся шкала), resPath ('res://<папка>'), log
 */
export async function exportGodot(scene, dir, opts = {}) {
  const t0 = Date.now();
  const log = opts.log || (() => {});
  const scale = opts.scale || 1;
  const W = scene.width, Hh = scene.height;
  const resPath = (opts.resPath || `res://${basename(dir)}`).replace(/\/$/, '');
  const normalsOpt = opts.normals ? (typeof opts.normals === 'object' ? opts.normals : {}) : null;
  if (existsSync(join(dir, 'layers'))) rmSync(join(dir, 'layers'), { recursive: true, force: true });
  mkdirSync(join(dir, 'layers'), { recursive: true });

  // клипы
  let clips = (scene.clips || []).filter((c) => !opts.clips || opts.clips.includes(c.name)).map((c) => clipRange(scene, c.name));
  if (!clips.length) clips = [{ name: 'default', start: 0, end: scene.duration, loop: scene.loop !== false }];
  const fpsOf = (c) => c.fps || opts.fps || 12;
  const sampleTimes = [];
  for (const c of clips) { const n = Math.max(1, Math.min(24, Math.round((c.end - c.start) * 4))); for (let i = 0; i < n; i++) sampleTimes.push(c.start + ((c.end - c.start) * i) / n); }

  // индекс сцены
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const kids = new Map();
  const clipRefs = new Set();
  for (const n of scene.nodes) {
    const p = n.parent ?? null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(n);
    for (const k of ['clip', 'mask']) if (n.props?.[k]) clipRefs.add(n.props[k]);
  }
  const roots = (kids.get(null) || []).filter((n) => !clipRefs.has(n.id));
  const memo = new Map();

  // 1. рамки узлов (низкое разрешение; для анимированных — объединение по времени)
  const LOW = Math.max(160, Math.round(W / 6)), k = W / LOW;
  const items = [];
  if (scene.background && scene.background !== 'none') items.push({ id: '__bg', kind: 'static', bbox: [0, 0, W, Hh], ids: [], bg: true });
  for (const n of roots) {
    const anim = isAnimated(scene, n.id, byId, kids, memo);
    const blend = n.props?.blend && n.props.blend !== 'normal' ? n.props.blend : null;
    const times = anim ? sampleTimes : [clips[0].start];
    let bb = null;
    for (const t of times) {
      const img = decodePNG(await svgToPng(renderSVG(scene, t, { only: [n.id], width: LOW, background: false }), LOW));
      bb = union(bb, alphaBox(img, k));
    }
    if (!bb) continue;
    const pad = anim ? k * 2 : k;
    bb = [Math.max(0, Math.floor(bb[0] - pad)), Math.max(0, Math.floor(bb[1] - pad)), Math.min(W, Math.ceil(bb[2] + pad)), Math.min(Hh, Math.ceil(bb[3] + pad))];
    items.push({ id: n.id, ids: [n.id], kind: blend ? `blend:${n.id}` : anim ? 'anim' : 'static', anim, blend, bbox: bb });
  }
  log(`godot: узлов ${items.length}, анализ рамок ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // 2. раскладка по слоям: переставлять можно только неперекрывающиеся узлы
  const layers = [];
  for (const it of items) {
    let barrier = -1;
    for (let li = layers.length - 1; li >= 0 && barrier < 0; li--) if (layers[li].items.some((o) => overlap(o.bbox, it.bbox))) barrier = li;
    let target = -1;
    if (!it.kind.startsWith('blend')) {
      for (let li = Math.max(0, barrier); li < layers.length; li++) {
        const L = layers[li];
        if (L.kind !== it.kind) continue;
        if (it.kind === 'anim') { const u = union(L.bbox, it.bbox); if (area(u) > Math.max((area(L.bbox) + area(it.bbox)) * 1.6, W * Hh * 0.15)) continue; }
        target = li; break;
      }
    }
    if (target < 0) { layers.push({ kind: it.kind, anim: it.kind === 'anim' || !!it.anim, items: [it], bbox: it.bbox, blend: it.blend }); }
    else { const L = layers[target]; L.items.push(it); L.bbox = union(L.bbox, it.bbox); }
  }

  // 3. рендер слоёв
  const files = [];
  const resOf = (f) => `${resPath}/${relative(dir, f).split(sep).join('/')}`;
  const saveLayer = async (L, li, t, tag) => {
    const [x0, y0, x1, y1] = L.bbox, bw = x1 - x0, bh = y1 - y0;
    const ids = L.items.flatMap((i) => i.ids);
    const bg = L.items.some((i) => i.bg);
    const ow = Math.max(1, Math.round(bw * scale));
    const png = await svgToPng(renderSVG(scene, t, { only: ids.length ? ids : ['__none__'], viewBox: [x0, y0, bw, bh], width: ow, background: bg }), ow);
    return { png, ids, bg, ow };
  };
  const nodes = [];
  const SANE = (s) => s.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
  let frameCount = 0;
  for (let li = 0; li < layers.length; li++) {
    const L = layers[li];
    const name = `L${String(li).padStart(2, '0')}_${SANE(L.items.find((i) => !i.bg)?.id || 'background')}`;
    const [x0, y0, x1, y1] = L.bbox;
    if (L.anim) {
      const anims = [];
      for (const c of clips) {
        const fps = fpsOf(c), n = Math.max(1, Math.round((c.end - c.start) * fps));
        const frames = [];
        let prev = null;
        for (let i = 0; i < n; i++) {
          const t = c.start + i / fps;
          const { png, ids, bg, ow } = await saveLayer(L, li, t);
          if (prev && png.equals(prev.png)) { prev.duration++; continue; }
          const f = join(dir, 'layers', name, `${SANE(c.name)}_${String(i).padStart(4, '0')}.png`);
          mkdirSync(join(dir, 'layers', name), { recursive: true });
          writeFileSync(f, png);
          const fr = { file: f, png, duration: 1 };
          if (normalsOpt && normalsOpt.animated && !L.blend) {
            const r = await sceneNormalMap(scene, { t, only: ids, viewBox: [x0, y0, x1 - x0, y1 - y0], width: ow, settings: normalsOpt });
            fr.normal = f.replace(/\.png$/, '_n.png'); writeFileSync(fr.normal, encodePNG(r.normal));
          }
          frames.push(fr); prev = fr; frameCount++;
          void bg;
        }
        anims.push({ name: c.name, fps, loop: c.loop, next: c.next, frames });
      }
      nodes.push({ type: 'anim', name, x: x0, y: y0, anims, blend: L.blend, items: L.items.map((i) => i.id) });
    } else {
      const t = clips[0].start;
      const { png, ids, ow } = await saveLayer(L, li, t);
      const f = join(dir, 'layers', `${name}.png`);
      writeFileSync(f, png);
      const node = { type: 'static', name, x: x0, y: y0, file: f, blend: L.blend, items: L.items.map((i) => i.id) };
      if (normalsOpt && !L.blend) {
        const r = await sceneNormalMap(scene, { t, only: ids.length ? ids : undefined, viewBox: [x0, y0, x1 - x0, y1 - y0], width: ow, settings: normalsOpt });
        node.normal = f.replace(/\.png$/, '_n.png'); writeFileSync(node.normal, encodePNG(r.normal));
      }
      nodes.push(node);
      frameCount++;
    }
    log(`godot: слой ${li + 1}/${layers.length} ${name}`);
  }

  // 4. .tscn
  const ext = [], sub = [];
  const extId = (path, type) => { let e = ext.find((x) => x.path === path); if (!e) { e = { id: `${ext.length + 1}_k`, path, type }; ext.push(e); } return e.id; };
  const subId = (body, type) => { const id = `${type}_${sub.length + 1}`; sub.push({ id, type, body }); return id; };
  const texRef = (file, normal) => {
    const d = extId(resOf(file), 'Texture2D');
    if (!normal) return `ExtResource("${d}")`;
    const nn = extId(resOf(normal), 'Texture2D');
    return `SubResource("${subId(`diffuse_texture = ExtResource("${d}")\nnormal_texture = ExtResource("${nn}")`, 'CanvasTexture')}")`;
  };
  const shaderId = nodes.some((n) => n.blend) ? extId(`${resPath}/kontur_blend.gdshader`, 'Shader') : null;
  const scriptId = extId(`${resPath}/kontur_player.gd`, 'Script');
  const body = [];
  const sc = scale !== 1 ? `\nscale = Vector2(${(1 / scale).toFixed(5)}, ${(1 / scale).toFixed(5)})` : '';
  const firstClip = clips[0].name;
  body.push(`[node name="${SANE(opts.title || 'KonturScene')}" type="Node2D"]\nscript = ExtResource("${scriptId}")\nclip = &"${firstClip}"\nnext_clips = {${clips.filter((c) => c.next).map((c) => `${JSON.stringify(c.name)}: ${JSON.stringify(c.next)}`).join(', ')}}\n`);
  for (const n of nodes) {
    if (n.type === 'static') {
      let mat = '';
      if (n.blend) {
        const m = subId(`shader = ExtResource("${shaderId}")\nshader_parameter/mode = ${BLEND_MODES[n.blend] || 3}`, 'ShaderMaterial');
        mat = `\nmaterial = SubResource("${m}")`;
      }
      body.push(`[node name="${n.name}" type="Sprite2D" parent="."]\ntexture = ${texRef(n.file, n.normal)}\ncentered = false\nposition = Vector2(${n.x}, ${n.y})${sc}${mat}\n`);
    } else {
      const anims = n.anims.map((a) => `{\n"frames": [${a.frames.map((f) => `{\n"duration": ${f.duration.toFixed(1)},\n"texture": ${texRef(f.file, f.normal)}\n}`).join(', ')}],\n"loop": ${a.loop ? 'true' : 'false'},\n"name": &"${a.name}",\n"speed": ${a.fps.toFixed(1)}\n}`).join(', ');
      const sf = subId(`animations = [${anims}]`, 'SpriteFrames');
      let mat = '';
      if (n.blend) mat = `\nmaterial = SubResource("${subId(`shader = ExtResource("${shaderId}")\nshader_parameter/mode = ${BLEND_MODES[n.blend] || 3}`, 'ShaderMaterial')}")`;
      body.push(`[node name="${n.name}" type="AnimatedSprite2D" parent="."]\nsprite_frames = SubResource("${sf}")\nanimation = &"${firstClip}"\nautoplay = "${firstClip}"\ncentered = false\nposition = Vector2(${n.x}, ${n.y})${sc}${mat}\n`);
    }
  }
  const tscn = [`[gd_scene load_steps=${ext.length + sub.length + 1} format=3]\n`,
    ...ext.map((e) => `[ext_resource type="${e.type}" path="${e.path}" id="${e.id}"]`), '',
    ...sub.map((s) => `[sub_resource type="${s.type}" id="${s.id}"]\n${s.body}\n`), ...body].join('\n');
  writeFileSync(join(dir, 'scene.tscn'), tscn);
  writeFileSync(join(dir, 'kontur_player.gd'), `extends Node2D
## Сцена, экспортированная из Kontur. Проигрывает клип во всех анимированных слоях синхронно.
## Клипы: ${clips.map((c) => c.name).join(', ')}

@export var clip: StringName = &"${firstClip}"
## Какой клип включить после неповторяющегося (имя → имя).
@export var next_clips: Dictionary = {}

func _ready() -> void:
	for c in get_children():
		if c is AnimatedSprite2D:
			c.animation_finished.connect(_on_finished.bind(c))
	play(clip)

func play(name: StringName) -> void:
	clip = name
	for c in get_children():
		if c is AnimatedSprite2D and c.sprite_frames.has_animation(name):
			c.play(name)

func _on_finished(sprite: AnimatedSprite2D) -> void:
	if sprite.animation == clip and next_clips.has(String(clip)):
		play(StringName(next_clips[String(clip)]))
`);
  if (shaderId) writeFileSync(join(dir, 'kontur_blend.gdshader'), SHADER);
  const manifest = {
    generator: 'kontur', size: [W, Hh], scale, clips: clips.map((c) => ({ name: c.name, start: c.start, end: c.end, loop: c.loop, fps: fpsOf(c), next: c.next })),
    layers: nodes.map((n) => ({ name: n.name, type: n.type, position: [n.x, n.y], blend: n.blend || null, nodes: n.items,
      ...(n.type === 'static' ? { file: relative(dir, n.file).split(sep).join('/'), normal: n.normal ? relative(dir, n.normal).split(sep).join('/') : null }
        : { animations: n.anims.map((a) => ({ name: a.name, fps: a.fps, loop: a.loop, frames: a.frames.map((f) => ({ file: relative(dir, f.file).split(sep).join('/'), duration: f.duration, normal: f.normal ? relative(dir, f.normal).split(sep).join('/') : null })) })) }) })),
  };
  const nm = Object.fromEntries(scene.nodes.filter((n) => n.type === 'image' && n.props?.normalMap).map((n) => [n.id, n.props.normalMap]));
  if (Object.keys(nm).length) manifest.sourceNormalMaps = nm;
  writeFileSync(join(dir, 'kontur_manifest.json'), JSON.stringify(manifest, null, 1));
  const stat = nodes.filter((n) => n.type === 'static').length, an = nodes.length - stat;
  const summary = `Экспорт для Godot: ${dir}
Слоёв: ${nodes.length} (статичных ${stat}, анимированных ${an}), PNG-кадров: ${frameCount}, клипы: ${clips.map((c) => `${c.name}@${fpsOf(c)}fps`).join(', ')}${normalsOpt ? ', карты нормалей: да' : ''}, ${((Date.now() - t0) / 1000).toFixed(1)}s.
Свечение, размытие, тени и дизеринг запечены в PNG; режимы наложения — шейдер kontur_blend.gdshader.
Скопируйте папку в проект так, чтобы она была по пути ${resPath}/ (или передайте resPath), и откройте scene.tscn.
Переключение клипа из кода: $Scene.play(&"имя"). Описание слоёв для своего конвертера — kontur_manifest.json.`;
  return { summary, manifest };
}
