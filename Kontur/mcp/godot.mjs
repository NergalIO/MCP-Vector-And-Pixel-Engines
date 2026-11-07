// Godot 4: проверка совместимости и экспорт с запеканием эффектов.
//
// Импорт SVG в Godot (ThorVG) не поддерживает фильтры (свечение, размытие, тени), режимы наложения
// и растр-паттерны. Экспорт обходит это: сцена раскладывается на слои (mcp/layers.mjs), каждый слой рендерится
// движком Kontur в PNG со всеми эффектами; анимированные слои — покадрово в AnimatedSprite2D
// (клипы сцены → анимации SpriteFrames); режимы наложения — шейдером по SCREEN_TEXTURE.
import { writeFileSync } from 'node:fs';
import { join, basename, relative, sep } from 'node:path';
import { parseColor } from '../engine/kontur.js';
import { bakeLayers, layersManifest, SANE } from './layers.mjs';

/* ============================== совместимость ============================== */
const hasProp = (n, k) => n.props?.[k] != null && n.props[k] !== false || !!n.keys?.[k]?.length;

/** Что потеряется при импорте SVG: target 'godot' (ThorVG) или 'unity' (пакет Vector Graphics) — набор потерь одинаковый. */
export function compatReport(scene, target = 'godot') {
  if (target !== 'godot' && target !== 'unity') return [];
  const U = target === 'unity';
  const ex = `export ${target}`;
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
  if (scene.states?.length) out.push({ node: '(сцена)', feature: `состояния (${scene.states.map((g) => g.name).join(', ')})`, effect: `в SVG попадёт только вариант по умолчанию; ${ex} делает слой на каждый вариант и ${U ? 'SetState()' : 'set_state()'}` });
  if (scene.nodes.some((n) => n.type === 'light')) out.push({ node: '(сцена)', feature: 'источники света', effect: `в SVG не попадут; ${ex} переносит их в ${U ? 'Light2D (URP)' : 'PointLight2D'}` });
  if (scene.pixel?.enabled) out.push({ node: '(сцена)', feature: 'пиксельный режим', effect: `SVG будет гладким; ${ex} запекает пиксели и ставит фильтр ${U ? 'Point' : '«ближайший»'}` });
  return out;
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
 * opts: fps (12), scale (1 — масштаб текстур; в пиксельном режиме по умолчанию 1/размер пикселя),
 *       normals (false | true | {…настройки, animated}), clips (имена; по умолчанию все или «default» = вся шкала),
 *       resPath ('res://<папка>'), log, lights (false — не переносить источники света)
 */
export async function exportGodot(scene, dir, opts = {}) {
  const resPath = (opts.resPath || `res://${basename(dir)}`).replace(/\/$/, '');
  const b = await bakeLayers(scene, dir, { ...opts, tag: 'godot', layersDir: 'layers' });
  const { W, px, scale, clips, fpsOf, nodes, lights, frameCount, t0 } = b;
  const Hh = b.H, normalsOpt = b.normals;
  const resOf = (f) => `${resPath}/${relative(dir, f).split(sep).join('/')}`;
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
  const stateAttrs = (n) => (n.state ? `${n.state.visible ? '' : '\nvisible = false'}\nmetadata/kontur_state = "${n.state.group}=${n.state.value}"` : '');
  const sc = scale !== 1 ? `\nscale = Vector2(${(1 / scale).toFixed(5)}, ${(1 / scale).toFixed(5)})` : '';
  const firstClip = clips[0].name;
  body.push(`[node name="${SANE(opts.title || 'KonturScene')}" type="Node2D"]${px ? '\ntexture_filter = 1' : ''}\nscript = ExtResource("${scriptId}")\nclip = &"${firstClip}"\nnext_clips = {${clips.filter((c) => c.next).map((c) => `${JSON.stringify(c.name)}: ${JSON.stringify(c.next)}`).join(', ')}}\n`);
  for (const n of nodes) {
    if (n.type === 'static') {
      let mat = '';
      if (n.blend) {
        const m = subId(`shader = ExtResource("${shaderId}")\nshader_parameter/mode = ${BLEND_MODES[n.blend] || 3}`, 'ShaderMaterial');
        mat = `\nmaterial = SubResource("${m}")`;
      }
      body.push(`[node name="${n.name}" type="Sprite2D" parent="."]${stateAttrs(n)}\ntexture = ${texRef(n.file, n.normal)}\ncentered = false\nposition = Vector2(${n.x}, ${n.y})${sc}${mat}\n`);
    } else {
      const anims = n.anims.map((a) => `{\n"frames": [${a.frames.map((f) => `{\n"duration": ${f.duration.toFixed(1)},\n"texture": ${texRef(f.file, f.normal)}\n}`).join(', ')}],\n"loop": ${a.loop ? 'true' : 'false'},\n"name": &"${a.name}",\n"speed": ${a.fps.toFixed(1)}\n}`).join(', ');
      const sf = subId(`animations = [${anims}]`, 'SpriteFrames');
      let mat = '';
      if (n.blend) mat = `\nmaterial = SubResource("${subId(`shader = ExtResource("${shaderId}")\nshader_parameter/mode = ${BLEND_MODES[n.blend] || 3}`, 'ShaderMaterial')}")`;
      body.push(`[node name="${n.name}" type="AnimatedSprite2D" parent="."]${stateAttrs(n)}\nsprite_frames = SubResource("${sf}")\nanimation = &"${firstClip}"\nautoplay = "${firstClip}"\ncentered = false\nposition = Vector2(${n.x}, ${n.y})${sc}${mat}\n`);
    }
  }
  if (lights.length) {
    const amb = parseColor(scene.ambient || '#4a4f5c');
    body.push(`[node name="Ambient" type="CanvasModulate" parent="."]\ncolor = Color(${amb.slice(0, 3).map((v) => v.toFixed(4)).join(', ')}, 1)\n`);
    const texOf = new Map();
    for (const l of lights) {
      const f = l.falloff ?? 1;
      if (!texOf.has(f)) {
        const n = f === 1 ? 2 : 6, offs = [], cols = [];
        for (let i = 0; i < n; i++) { const u = i / (n - 1); offs.push(u.toFixed(4)); cols.push(`1, 1, 1, ${Math.pow(1 - u, f).toFixed(4)}`); }
        const g = subId(`offsets = PackedFloat32Array(${offs.join(', ')})\ncolors = PackedColorArray(${cols.join(', ')})`, 'Gradient');
        texOf.set(f, subId(`gradient = SubResource("${g}")\nwidth = 256\nheight = 256\nfill = 1\nfill_from = Vector2(0.5, 0.5)\nfill_to = Vector2(1, 0.5)`, 'GradientTexture2D'));
      }
      const c = parseColor(l.color) || [1, 1, 1];
      body.push(`[node name="Light_${SANE(l.name || l.id)}" type="PointLight2D" parent="."]${stateAttrs(l)}\nposition = Vector2(${l.x.toFixed(2)}, ${l.y.toFixed(2)})\ncolor = Color(${c.slice(0, 3).map((v) => v.toFixed(4)).join(', ')}, 1)\nenergy = ${(+l.energy).toFixed(3)}\ntexture = SubResource("${texOf.get(f)}")\ntexture_scale = ${((2 * l.radius) / 256).toFixed(4)}\nheight = ${(+l.z).toFixed(1)}\n`);
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

## Переключить вариант группы состояний: показываются слои с меткой «группа=вариант».
func set_state(group: String, value: String) -> void:
	for c in get_children():
		if c.has_meta("kontur_state"):
			var parts: PackedStringArray = String(c.get_meta("kontur_state")).split("=")
			if parts[0] == group:
				c.visible = parts[1] == value

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
  const manifest = layersManifest(scene, dir, b, { target: 'godot' });
  writeFileSync(join(dir, 'kontur_manifest.json'), JSON.stringify(manifest, null, 1));
  const stat = nodes.filter((n) => n.type === 'static').length, an = nodes.length - stat;
  const summary = `Экспорт для Godot: ${dir}
Слоёв: ${nodes.length} (статичных ${stat}, анимированных ${an}), PNG-кадров: ${frameCount}, клипы: ${clips.map((c) => `${c.name}@${fpsOf(c)}fps`).join(', ')}${normalsOpt ? ', карты нормалей: да' : ''}${lights.length ? `, свет: ${lights.length} PointLight2D + CanvasModulate` : ''}${px ? `, пиксели ×${px.size} (фильтр «ближайший»)` : ''}${(scene.states || []).length ? `, состояния: ${scene.states.map((g) => g.name).join(', ')} — $Scene.set_state("группа", "вариант")` : ''}, ${((Date.now() - t0) / 1000).toFixed(1)}s.
Свечение, размытие, тени и дизеринг запечены в PNG; режимы наложения — шейдер kontur_blend.gdshader.
Скопируйте папку в проект так, чтобы она была по пути ${resPath}/ (или передайте resPath), и откройте scene.tscn.
Переключение клипа из кода: $Scene.play(&"имя"). Описание слоёв для своего конвертера — kontur_manifest.json.`;
  return { summary, manifest };
}
