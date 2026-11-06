# Kontur — движок векторной анимации с MCP-сервером

Векторные сцены, ключевые кадры с любыми кривыми, морфинг между любыми формами,
процедурное движение (шум, пружины, орбиты, движение по пути, органическая деформация,
каскады копий, JS-выражения) и встроенный MCP-сервер, через который ИИ-агент строит
и правит анимацию, а вы смотрите результат вживую в браузере.

Без зависимостей: нужен только Node.js 18+.

```
kontur/
  engine/kontur.js      — ядро (ES-модуль, браузер + Node)
  mcp/server.mjs        — MCP-сервер (stdio) + живое превью по HTTP
  mcp/render.mjs        — PNG-кадры, раскадровки, экспорт видео/GIF/HTML
  player/index.html     — студия-превью: сцена, слои, инспектор, дорожки ключей, JSON
  docs/REFERENCE.md     — справочник формата (его же получает агент через инструмент docs)
  examples/*.json       — демо: bay (ремонтный отсек: растр + дизеринг), flow, liquid, reveal
  examples/assets/      — растровые ассеты демо (фактура, спрайт-лист)
  scripts/              — CLI-рендер, сборка автономной страницы, тест MCP
```

## Подключение MCP

**Claude Code**
```bash
claude mcp add kontur -- node /путь/к/kontur/mcp/server.mjs
```

**Claude Desktop / Cursor / любой MCP-клиент** (`claude_desktop_config.json`, `.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "kontur": {
      "command": "node",
      "args": ["/путь/к/kontur/mcp/server.mjs"],
      "env": { "KONTUR_SCENE": "/путь/к/проекту/scene.json", "KONTUR_PORT": "7788" }
    }
  }
}
```

После запуска откройте **http://127.0.0.1:7788/** — превью обновляется на каждое изменение,
которое делает агент. Правка JSON во вкладке «JSON» уходит обратно на сервер.

Переменные: `KONTUR_SCENE` (файл сцены, автосохранение), `KONTUR_PORT` (0 — без превью), `KONTUR_HOST`.
Только превью без MCP-клиента: `node mcp/server.mjs --preview --scene examples/flow.json`.

### Инструменты сервера
| Группа | Инструменты |
|---|---|
| Сцена | `scene_info`, `docs`, `scene_new`, `scene_settings`, `scene_get_json`, `scene_set_json`, `scene_open`, `scene_save_as` |
| Узлы | `node_add`, `nodes_add_batch`, `node_update`, `node_remove`, `node_duplicate`, `node_reorder` |
| Растр и стиль | `image_add` (растровые слои, спрайт-листы), `dither_set` (дизеринг теней) |
| Клипы | `clip_set`, `clip_remove` — именованные отрезки шкалы (idle, walk, talk) |
| Нормали | `normal_map_generate` — карты нормалей для сцены, узлов или файла с превью освещения |
| Godot | `compat_check`, `export` с `format: "godot"` (запекание эффектов, AnimatedSprite2D по клипам, нормали) |
| Анимация | `keys_set`, `keys_set_many`, `key_add`, `keys_clear`, `animate`, `preset_apply` |
| Процедурное | `mod_add`, `mod_remove` |
| Проверка | `render_frame`, `render_contact_sheet` — агент **видит** кадры и раскадровку |
| Вывод | `export` (html, svg, json, mp4, webm, gif), `preview_url`, `undo`, `redo` |

Все изменения транзакционны: если правка ломает сцену, она откатывается и агент получает текст ошибки.

Пример запроса агенту: *«Сделай 6-секундный луп 1080×1080: пульсирующая клякса с градиентом,
вокруг кольцо из 24 точек, по которому бежит волна масштаба, в центре круг морфится в звезду
и в сердце с пружинистым отскоком. Покажи раскадровку».*

## Рендер PNG и видео
Растеризатор выбирается пробным рендером при запуске, в таком порядке:
1. `@resvg/resvg-js` — **рекомендуется, особенно на Windows**: `npm i` в папке kontur (пакет указан
   в optionalDependencies) или `npm i @resvg/resvg-js`;
2. `rsvg-convert` (librsvg: `brew install librsvg`, `apt install librsvg2-bin`);
3. ImageMagick 7 (`magick`). Системный `C:\Windows\System32\convert.exe` больше не принимается за ImageMagick;
4. установленный Edge или Chrome в headless-режиме (медленнее, но есть почти везде).

`scene_info` показывает, какой растеризатор реально работает, или почему ни один не подошёл.
Выбрать вручную: `KONTUR_RASTER=resvg-js|rsvg-convert|imagemagick|browser`, путь к браузеру — `KONTUR_BROWSER`.
Видео и GIF — через `ffmpeg`. Без растеризатора работают превью, HTML- и SVG-экспорт.

```bash
node scripts/render.mjs examples/flow.json sheet sheet.png 8
node scripts/render.mjs examples/flow.json frame 2.5 frame.png 1280
node scripts/render.mjs examples/flow.json video flow.mp4 60
node scripts/render.mjs examples/flow.json html flow.html     # автономный плеер одним файлом
```

## Использование ядра в коде
```js
import { createScene, ops, Player, renderSVG } from './engine/kontur.js';

const s = createScene({ width: 800, height: 800, duration: 4 });
ops.addNode(s, { id: 'a', type: 'path', props: { x: 400, y: 400, d: { shape: 'circle', r: 120 }, fill: '#7c83ff' } });
ops.setKeys(s, 'a', 'd', [
  { t: 0, v: { shape: 'circle', r: 120 }, ease: 'inOutBack' },
  { t: 1.5, v: { shape: 'star', points: 5, outerRadius: 170, innerRadius: 80 }, ease: 'inOutBack' },
  { t: 3, v: { shape: 'heart', size: 300 } },
]);
ops.addMod(s, 'a', { type: 'wiggle', props: ['x', 'y', 'rotation'], amp: [12, 12, 4], freq: 0.5 });

new Player(document.querySelector('#stage'), s);   // в браузере
const svg = renderSVG(s, 1.2);                      // любой кадр строкой SVG
```

Формат сцены, все свойства, кривые и модификаторы — в [docs/REFERENCE.md](docs/REFERENCE.md).

## Проверка
```bash
node examples/build-demos.mjs     # пересобрать демо через API
node scripts/test-mcp.mjs         # сквозной тест протокола и инструментов
```

## Растровые слои и дизеринг
- `image` — PNG/JPG/WebP/GIF/SVG как слой сцены: трансформации, маски, режимы наложения, спрайт-листы.
  Пути — относительно файла сцены; при экспорте и рендере файлы встраиваются автоматически.
- Дизеринг теней: пометьте теневые слои `shade: true` и включите `scene.dither.enabled` —
  в студии это галочка «Дизеринг теней» с выбором узора и размера точки; агенту — инструмент `dither_set`.
  Плотность может плавно меняться по направлению (`density: [0.2, 1]`).

## Клипы, карты нормалей, Godot
- **Клипы** — именованные отрезки общей шкалы: `"clips": [{"name":"idle","start":0,"end":2}, …]`.
  В студии — выбор клипа и полосы на линейке, в MCP — `clip_set`, в Godot — отдельные анимации.
- **Карты нормалей** — `normal_map_generate`: рельеф из векторных форм (фаски, профили, глубина по узлам через
  `relief`), из альфы и яркости растра; Y вверх (Godot/OpenGL) или вниз (DirectX). Превью освещения в ответе.
- **Godot** — импорт SVG теряет свечение, размытие, тени, наложения и дизеринг (трубка лампы становится серой,
  фактура в режиме overlay ложится пеленой). `export` с `format: "godot"` запекает эти эффекты в PNG-слои,
  наложения переносит шейдером, анимацию — в `AnimatedSprite2D` по клипам, нормали — в `CanvasTexture`.
  Проверено сборкой кадра из экспортированных слоёв: расхождение с прямым рендером около 0,1 %.

## Ограничения
- Рендер — SVG (в браузере обновляются только изменившиеся атрибуты). Очень тяжёлые сцены
  с сотнями размытых слоёв лучше упрощать или экспортировать в видео.
- Модификатор `expr` исполняет JS-код — это локальный инструмент, не открывайте превью-порт наружу.
- Текст не морфится (меняется целиком, есть `textReveal` для печати).
- Растр дизеринга привязан к локальным координатам узла: при вращении узла поворачивается и растр.
- Экспорт в Godot переносит анимацию кадрами (PNG), а не твинами: точность по времени — fps клипа.
  Для длинных клипов с крупными анимированными областями растёт число файлов.
- Карты нормалей векторных сцен строятся по формам и порядку слоёв, а не по нарисованному светотеневому
  рисунку: для «скульптурного» результата задавайте `relief` важным узлам.
