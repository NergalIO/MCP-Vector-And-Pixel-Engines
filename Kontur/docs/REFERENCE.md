# Kontur — справочник по формату сцены

Сцена — обычный JSON. Всё время — в секундах, углы — в градусах, координаты — в пикселях
(начало — левый верхний угол, ось Y вниз).

```json
{
  "version": 1, "width": 1920, "height": 1080, "duration": 6, "fps": 60, "loop": true,
  "background": "#0d0f1a",
  "nodes": [ { "id": "c1", "type": "circle", "parent": null, "props": {}, "keys": {}, "mods": [] } ]
}
```

`background` — цвет или градиент. Порядок `nodes` = порядок отрисовки (ниже в списке — выше на экране).

## Узлы

| type | Свойства геометрии | Примечание |
|---|---|---|
| `group` | — | контейнер, дети наследуют трансформацию и время |
| `rect` | `width`, `height`, `radius` | центр в (x, y) |
| `circle` / `ellipse` | `r` или `rx`, `ry` | |
| `polygon` | `sides`, `radius`, `cornerRadius` | |
| `star` | `points`, `outerRadius`, `innerRadius`, `cornerRadius` | |
| `line` | `x1`, `y1`, `x2`, `y2` | обводка по умолчанию белая |
| `path` | `d` (SVG path / описание фигуры) или `points` + `smooth` + `closed` | |
| `blob` | `radius`, `points`, `amount`, `frequency`, `speed`, `seed`, `tension`, `stretchX/Y` | «живая» органическая клякса — анимируется сама |
| `text` | `text`, `fontSize`, `fontFamily`, `fontWeight`, `textAlign`, `letterSpacing`, `textReveal` (0..1) | |
| `image` | `src`, `width`, `height`, `fit`, `pixelated`, `sheet`, `frame` | растровый слой, центр в (x, y) |

Любой узел может иметь свойство `d` (или ключи `d`) — тогда его форма задаётся им, и её можно **морфить**.

### Общие свойства
- Трансформация: `x`, `y`, `rotation`, `scale`, `scaleX`, `scaleY`, `skewX`, `anchorX`, `anchorY` (точка поворота в локальных координатах), `opacity`.
- Заливка/обводка: `fill`, `stroke` (цвет или градиент), `strokeWidth`, `lineCap`, `lineJoin`, `dash` ([длины]), `dashOffset`, `fillRule`.
- Прорисовка контура: `trimStart`, `trimEnd`, `trimOffset` (0..1, смещение циклически).
- Эффекты: `blur`, `glow: {blur, color, strength}`, `shadow: {x, y, blur, color, opacity}`, `blend` (mix-blend-mode: screen, multiply, …).
- Маски: `clip: "<id>"`, `mask: "<id>"` — узел-маска (лучше соседний по иерархии) не рисуется сам, а обрезает этот узел. `mask` — по яркости (белое видно).
- Время: `inPoint`, `outPoint` (окно видимости), `timeOffset` (задержка), `timeScale` (скорость).
- Размножение: `repeat: {count, x, y, rotation, scale, opacity, cx, cy, delay, reverse}` — копии с накопительной трансформацией и задержкой во времени (каскад/волна). `rotation` вращает вокруг (`cx`, `cy`) в координатах родителя; `scale` уменьшает каждую копию относительно её собственного центра (`scaleAround: true` — относительно `cx`, `cy`).

### Цвета и градиенты
Цвета: `#rgb`, `#rrggbb(aa)`, `rgb()/rgba()`, `hsl()/hsla()`, имена. Интерполяция идёт в OKLab — переходы без «грязи».

```json
{ "type": "linear", "angle": 45, "length": 300, "stops": [[0, "#f0abfc"], [1, "#22d3ee"]] }
{ "type": "linear", "x1": -100, "y1": 0, "x2": 100, "y2": 0, "stops": [[0, "#fff"], [1, "#000", 0.5]] }
{ "type": "radial", "cx": 0, "cy": 0, "r": 120, "fx": -30, "fy": -30, "stops": [{ "offset": 0, "color": "#fff" }, { "offset": 1, "color": "#f60" }] }
```
Координаты градиента — в локальной системе узла. Градиенты с одинаковым числом стопов плавно интерполируются (и с цветом тоже).

### Описания фигур (для `d` и морфинга)
- строка SVG path: `"M0 0 C50 -80 100 80 150 0"` (M L H V C S Q T A Z, абсолютные и относительные)
- `{"shape":"circle","r":100}`, `{"shape":"ellipse","rx":..,"ry":..}`, `{"shape":"rect","width":..,"height":..,"radius":..}`
- `{"shape":"polygon","sides":6,"radius":100,"cornerRadius":10}`, `{"shape":"star","points":5,"outerRadius":100,"innerRadius":45,"cornerRadius":0}`
- `{"shape":"heart","size":200}`, `{"shape":"line","x1":..,"y1":..,"x2":..,"y2":..}`, `{"shape":"blob", ...параметры blob}`
- `{"points":[[x,y],...], "smooth":true, "closed":true, "tension":1}`

Морфинг работает между **любыми** фигурами: число сегментов выравнивается, начальные точки и направление обхода подбираются автоматически, разное число подпутей допускается (лишние «вырастают» из центра).

## Растровые слои (`image`)

- `src` — путь к файлу (относительно файла сцены или абсолютный), `https://…` или `data:` URI. PNG, JPG, WebP, GIF, SVG.
- `width`, `height` — размер на сцене; `fit`: `stretch` (по умолчанию), `contain`, `cover`.
- `pixelated: true` — без сглаживания при масштабировании (пиксель-арт).
- Спрайт-лист: `sheet: {cols, rows, count, fps, frameWidth, frameHeight, loop}` — кадры сменяются с частотой `fps`
  или по анимируемому свойству `frame` (номер кадра, например `keys.frame`).
- Работают все общие свойства: трансформации, `opacity`, `blend` (`multiply`, `overlay`, `screen`… — удобно для фактур),
  `blur`, `glow`, `shadow`, `clip`/`mask`, ключи и модификаторы. Ключами можно менять и `src` (подмена картинки).
- При рендере в PNG/видео и экспорте в HTML локальные файлы встраиваются автоматически, сцена остаётся лёгкой.
- MCP-инструмент `image_add` копирует файл в `assets/` рядом со сценой и берёт размер из файла.

## Дизеринг теней

Упорядоченный растр вместо плоской заливки — ретро/пиксельный вид теней и переходов.

- Пометьте теневые слои: `"shade": true` (или объект с переопределениями: `"shade": {"density": [0.2, 1], "angle": 45}`).
- Включите глобально в сцене:
  ```json
  "dither": { "enabled": true, "pattern": "bayer4", "cell": 3, "density": 0.6, "angle": 90 }
  ```
  Выключение `enabled: false` возвращает плоские тени — без правки узлов.
- Принудительно для одного узла (независимо от переключателя): `"dither": { "pattern": "dots", "density": 0.5 }`; `"dither": false` — запретить.
- `pattern`: `bayer2`, `bayer4`, `bayer8`, `dots` (кластерные точки), `lines`, `diagonal`.
- `cell` — размер «пикселя» растра в px (в локальных координатах узла).
- `density` — доля закрашенных точек 0..1, либо `[от, до]` — плавный переход вдоль направления `angle`
  (0° — слева направо, 90° — сверху вниз). Уровни вложенные, поэтому переход без швов.
- `color` — цвет растра (по умолчанию — заливка узла). Обводка узла рисуется как обычно.
- `density` и весь объект можно анимировать ключами.
- MCP: `dither_set` — включить/выключить, сменить узор, пометить узлы тенями.

## Именованные клипы

Клипы — именованные отрезки общей шкалы времени. Анимации idle, walk и talk раскладываются на одной шкале друг за другом:

```json
"clips": [
  { "name": "idle", "start": 0,   "end": 2,   "loop": true },
  { "name": "walk", "start": 2,   "end": 3.2, "loop": true, "fps": 12 },
  { "name": "talk", "start": 3.2, "end": 5,   "loop": false, "next": "idle" }
]
```
- `loop: false` + `next` — что играть после окончания (в студии и в экспорте для Godot).
- `fps` — частота кадров клипа при экспорте в спрайты.
- Студия: список «Клип» и полосы клипов на линейке; MCP: `clip_set`, `clip_remove`; `render_contact_sheet` и `export` принимают `clip`.
- В коде: `player.setClip('walk')`, `clipRange(scene, 'walk')`, `clipTime(scene, 'walk', localT)`.

## Рельеф и карты нормалей

Карта нормалей строится по карте высот, которую движок рендерит в режиме `mode: 'height'`:
каждая фигура — «подушка» высотой `height`, поднимающаяся от края на `depth` по профилю за `bevel` пикселей.
Порядок слоёв сохраняется: верхняя фигура перекрывает нижнюю, на стыках получаются фаски и канавки.

- Сцена: `"relief": { "height": 0.5, "depth": 0.3, "bevel": 8, "profile": "round", "luma": 0.25 }`.
- Узел (наследуется детьми): `"relief": { "height": 0.6, "depth": 0.4, "bevel": 18, "profile": "round" | "linear" | "sharp" | "flat", "invert": true }`;
  `"relief": false` — узел не участвует. Слои с `blend` и полупрозрачные (opacity < 0.6) не участвуют автоматически.
- Растровые слои: рельеф из яркости картинки (`luma`) плюс фаска по альфе.
- `normalMap` у растрового слоя — путь к готовой карте нормалей (переносится в манифест экспорта).
- Генерация: MCP `normal_map_generate` — для кадра сцены, набора узлов или растрового файла; настройки
  `strength`, `blur`, `bevel`, `depth`, `height`, `profile`, `detail` (рельеф из яркости цвета), `detailRadius`,
  `luma`, `yUp` (true — OpenGL/Godot, false — DirectX), `invertX`; для файлов `base`, `invertLuma`, `lumaBlur`.
  Возвращает карту и превью освещения.

## Экспорт в Godot 4

Импорт SVG в Godot не понимает фильтры (свечение, размытие, тени), режимы наложения и растр-паттерны.
`compat_check` перечисляет такие места. Экспорт `format: "godot"` переносит сцену без потерь:

- сцена раскладывается на слои; узлы, которые не перекрываются, объединяются, чтобы слоёв было мало;
- статичные слои → `Sprite2D` с PNG, где эффекты уже запечены;
- анимированные слои → `AnimatedSprite2D`; каждый клип сцены становится анимацией SpriteFrames
  (одинаковые подряд кадры склеиваются через длительность кадра);
- режимы наложения → `ShaderMaterial` с `kontur_blend.gdshader` (multiply, screen, overlay, soft-light, …);
- `normals: true` → карты нормалей через `CanvasTexture` для 2D-света (`normals: { animated: true, … }` — и для кадров анимации);
- `kontur_player.gd` на корне: `play(&"walk")` синхронно переключает все слои, `next_clips` — переходы;
- `kontur_manifest.json` — описание слоёв, кадров и клипов для собственного конвертера.

Параметры: `fps` (12), `scale` (масштаб текстур), `clips` (какие экспортировать), `resPath` (по умолчанию `res://<имя папки>`).

## Ключевые кадры

```json
"keys": {
  "x":       [{ "t": 0, "v": 100, "ease": "outBack" }, { "t": 1.2, "v": 900 }],
  "fill":    [{ "t": 0, "v": "#ff0066" }, { "t": 2, "v": "#00ccff" }],
  "d":       [{ "t": 0, "v": {"shape":"circle","r":80} }, { "t": 1, "v": {"shape":"star","points":6,"outerRadius":110} }],
  "opacity": [[0, 0, "outQuad"], [0.5, 1]]
}
```
- `ease` у ключа задаёт кривую **до следующего** ключа. По умолчанию `inOutCubic`. `"hold": true` — ступенька.
- Сокращённая запись ключа: `[t, v, ease]`.
- Анимировать можно любое свойство: числа, цвета, массивы чисел, градиенты, фигуры (`d`), объекты (покомпонентно).

### Кривые (ease)
`linear`, `hold`, `in/out/inOut` + `Sine|Quad|Cubic|Quart|Quint|Expo|Circ|Back|Elastic|Bounce`,
`ease`, `ease-in`, `ease-out`, `ease-in-out`, `smooth`, `snappy`, `anticipate`,
`"cubic-bezier(0.2,0.8,0.2,1)"` или `[0.2,0.8,0.2,1]`,
`"spring(180,12,1)"` или `{"spring":{"stiffness":180,"damping":12,"mass":1,"velocity":0}}`, `{"steps":5}`.

## Процедурные модификаторы (`mods`)

Применяются по порядку поверх ключей. Общие поля: `enabled`, `start`, `end`, `fadeIn`, `fadeOut`, `weight` (0..1).

| type | Что делает | Параметры |
|---|---|---|
| `wiggle` | плавный шум | `prop`/`props`, `amp` (число или массив по props), `freq`, `seed`, `octaves`, `perCopy` |
| `oscillate` | колебания | `prop`/`props`, `amp`, `freq`, `phase`, `phaseStep` (на копию repeat), `wave`: sine/triangle/saw/square |
| `orbit` | движение по эллипсу | `cx`, `cy`, `radius`, `radiusY`, `speed` (об/с), `phase`, `phaseStep`, `additive` |
| `spin` | вращение | `speed` (°/с) |
| `followPath` | вдоль пути | `path` (d / фигура / id узла), `progress` или ключи `pathProgress` или `speed`, `offset`, `offsetStep`, `orient`, `loop` |
| `spring` | инерция/пружина | `prop`/`props`, `stiffness`, `damping`, `mass` — сглаживает резкие ключи в «живое» движение с перелётом |
| `deform` | органическая деформация контура | `amount`, `scale`, `speed`, `seed`, `detail` |
| `link` | связь с другим узлом | `prop`, `source`, `sourceProp`, `mul`, `add`, `delay`, `additive` |
| `noiseColor` | дрейф оттенка | `prop`, `amount`, `speed`, `seed` |
| `expr` | JS-выражение | `prop`/`props`, `code` — тело `function(t, v, n, i, ctx)`; ctx: noise1, noise3, fbm, lerp, clamp, ease(name,u), scene |

## Пресеты
`popIn`, `fadeOut`, `drawOn`, `morphSequence`, `float`, `pulse`, `stagger`, `typewriter`, `orbitRing` — макросы,
которые раскладывают ключи и модификаторы (см. инструмент `preset_apply`).

## Рецепты плавности
- Плавный морфинг: `ease: "inOutCubic"` или `"inOutBack"` + небольшой `spin` во время перехода.
- «Живой» объект: `wiggle` по `x,y,rotation` с `freq` 0.2–0.6 и маленькой амплитудой.
- Пружинистый отклик: резкие ключи (`hold`) + модификатор `spring` (stiffness 60–200, damping 6–14).
- Волна по массиву: `repeat` + `oscillate` с `phaseStep` или `repeat.delay`.
- Прорисовка: `trimEnd` 0→1, затем `trimStart` 0→1 — «стирание»; кометы — короткий отрезок и анимированный `trimOffset`.
- Жидкие линии: `path` из точек + `deform` + `repeat` с `delay` (волна распространяется по копиям).
