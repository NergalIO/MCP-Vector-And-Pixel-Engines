// Инструменты MCP: Узлы и анимация: добавление и правка узлов, ключи, клипы, модификаторы, пресеты, состояния, IK, кости, растр и пиксельный режим.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, extname, basename, isAbsolute, dirname } from 'node:path';
import { ops, applyPreset, PRESETS, MODIFIERS, NODE_TYPES, DITHER_PATTERNS, insertSVG } from '../../engine/kontur.js';
import { imageSize, fileToDataURI, IMAGE_MIME } from '../render.mjs';
import { dataURIToBuffer, toDataURI } from '../files.mjs';
import { scene, mutate, baseDir, toRel } from '../store.mjs';
import { ANY, NUM, STR, OBJ, KEY, text, summary, nodeById } from './common.mjs';

export const tools = [
  {
    name: 'node_add',
    description: `Добавить узел. type: ${NODE_TYPES.join(', ')}. props — свойства (x, y, fill, stroke, r, width, d, repeat, clip...), keys — ключевые кадры {prop:[{t,v,ease}]}, mods — модификаторы [{type,...}]. Можно сразу задать всё.`,
    inputSchema: { type: 'object', properties: { id: STR, type: { type: 'string', enum: NODE_TYPES }, parent: STR, props: OBJ, keys: OBJ, mods: { type: 'array', items: OBJ }, index: NUM }, required: ['type'] },
    run: (a) => { const n = mutate(`добавить ${a.type}`, () => ops.addNode(scene, a)); return text(`Добавлен узел ${n.id}.`); },
  },
  {
    name: 'nodes_add_batch',
    description: 'Добавить несколько узлов за один вызов (массив объектов как у node_add). Атомарно: при ошибке ничего не меняется.',
    inputSchema: { type: 'object', properties: { nodes: { type: 'array', items: OBJ } }, required: ['nodes'] },
    run: ({ nodes }) => { const ids = mutate('добавить пакет', () => nodes.map((n) => ops.addNode(scene, n).id)); return summary(`Добавлено: ${ids.join(', ')}.`); },
  },
  {
    name: 'node_update',
    description: 'Изменить узел: props (слияние; replaceProps:true — заменить целиком), unset — список удаляемых свойств, newId — переименовать, parent — сменить родителя (null — в корень), type.',
    inputSchema: { type: 'object', properties: { id: STR, props: OBJ, replaceProps: { type: 'boolean' }, unset: { type: 'array', items: STR }, newId: STR, parent: { type: ['string', 'null'] }, type: STR }, required: ['id'] },
    run: ({ id, ...a }) => { mutate('изменить узел', () => ops.updateNode(scene, id, a)); return text(`Узел ${a.newId || id} обновлён.`); },
  },
  {
    name: 'node_remove',
    description: 'Удалить узел вместе с потомками.',
    inputSchema: { type: 'object', properties: { id: STR }, required: ['id'] },
    run: ({ id }) => { const k = mutate('удалить', () => ops.removeNode(scene, id)); return text(`Удалено: ${k.join(', ')}.${k.cleaned?.length ? `\nУбраны ссылки на удалённое: ${k.cleaned.join('; ')}` : ''}`); },
  },
  {
    name: 'node_duplicate',
    description: 'Дублировать узел с потомками.',
    inputSchema: { type: 'object', properties: { id: STR, newId: STR, props: OBJ }, required: ['id'] },
    run: ({ id, newId, props }) => {
      const n = mutate('дублировать', () => { const c = ops.duplicateNode(scene, id, newId); if (props) ops.updateNode(scene, c.id, { props }); return c; });
      return text(`Копия: ${n.id}.`);
    },
  },
  {
    name: 'node_reorder',
    description: 'Переместить узел в списке отрисовки (index 0 — самый нижний слой).',
    inputSchema: { type: 'object', properties: { id: STR, index: NUM }, required: ['id', 'index'] },
    run: ({ id, index }) => { mutate('порядок', () => ops.reorder(scene, id, index)); return text('Готово.'); },
  },
  {
    name: 'keys_set',
    description: 'Задать (заменить) все ключевые кадры свойства. keys: [{t, v, ease}] — ease описывает кривую до следующего ключа. Для формы используйте prop "d" со значениями path/описаниями фигур — получится морфинг. Пустой массив — удалить анимацию.',
    inputSchema: { type: 'object', properties: { id: STR, prop: STR, keys: { type: 'array', items: KEY } }, required: ['id', 'prop', 'keys'] },
    run: ({ id, prop, keys }) => { mutate('ключи', () => ops.setKeys(scene, id, prop, keys)); return text(`${id}.${prop}: ${keys.length} ключей.`); },
  },
  {
    name: 'keys_set_many',
    description: 'Задать ключевые кадры для нескольких свойств/узлов за один вызов: tracks: [{id, prop, keys:[...]}].',
    inputSchema: { type: 'object', properties: { tracks: { type: 'array', items: { type: 'object', properties: { id: STR, prop: STR, keys: { type: 'array', items: KEY } }, required: ['id', 'prop', 'keys'] } } }, required: ['tracks'] },
    run: ({ tracks }) => { mutate('ключи (пакет)', () => tracks.forEach((tr) => ops.setKeys(scene, tr.id, tr.prop, tr.keys))); return text(`Обновлено дорожек: ${tracks.length}.`); },
  },
  {
    name: 'key_add',
    description: 'Добавить или заменить один ключевой кадр (ключ с тем же временем заменяется).',
    inputSchema: { type: 'object', properties: { id: STR, prop: STR, t: NUM, v: ANY, ease: ANY, hold: { type: 'boolean' } }, required: ['id', 'prop', 't', 'v'] },
    run: ({ id, prop, ...k }) => { const arr = mutate('ключ', () => ops.addKey(scene, id, prop, k)); return text(`${id}.${prop}: ключей ${arr.length}.`); },
  },
  {
    name: 'keys_clear',
    description: 'Удалить анимацию свойства (или всех свойств узла, если prop не указан).',
    inputSchema: { type: 'object', properties: { id: STR, prop: STR }, required: ['id'] },
    run: ({ id, prop }) => { mutate('очистить ключи', () => ops.clearKeys(scene, id, prop)); return text('Готово.'); },
  },
  {
    name: 'animate',
    description: 'Быстрая анимация свойства: от from (по умолчанию — текущее значение в момент start) к to за duration секунд с кривой ease. Существующие ключи вне интервала сохраняются.',
    inputSchema: { type: 'object', properties: { id: STR, prop: STR, from: ANY, to: ANY, start: NUM, duration: NUM, ease: ANY }, required: ['id', 'prop', 'to'] },
    run: ({ id, prop, ...o }) => { mutate('анимация', () => ops.animate(scene, id, prop, o)); return text(`${id}.${prop} анимирован.`); },
  },
  {
    name: 'image_add',
    description: 'Добавить растровый слой (PNG/JPG/WebP/GIF/SVG) из локального файла, URL или data: URI. По умолчанию файл копируется в папку assets/ рядом со сценой, размер берётся из файла (можно задать width или height — второй посчитается по пропорции). Слой центрируется в (x, y), поддерживает все трансформации, opacity, blend (например multiply/overlay для фактур), clip/mask, ключи и модификаторы. fit: stretch|contain|cover, pixelated: true — для пиксель-арта. sheet: {cols, rows, count, fps, frameWidth, frameHeight, loop} — спрайт-лист с покадровой анимацией (или анимируйте свойство frame).',
    inputSchema: { type: 'object', properties: { path: STR, id: STR, parent: STR, x: NUM, y: NUM, width: NUM, height: NUM, fit: { type: 'string', enum: ['stretch', 'contain', 'cover'] }, pixelated: { type: 'boolean' }, copy: { type: 'boolean' }, embed: { type: 'boolean' }, sheet: OBJ, props: OBJ, index: NUM }, required: ['path'] },
    run: async (a) => {
      let src, buf = null, name;
      if (/^data:/i.test(a.path)) {
        src = a.path;
        buf = dataURIToBuffer(a.path);
      } else if (/^https?:/i.test(a.path)) {
        const r = await fetch(a.path);
        if (!r.ok) throw new Error(`Не удалось скачать ${a.path}: HTTP ${r.status}`);
        buf = Buffer.from(await r.arrayBuffer());
        name = basename(new URL(a.path).pathname) || 'image.png';
        if (a.copy === false && !a.embed) src = a.path;
      } else {
        const p = resolve(a.path);
        if (!existsSync(p)) throw new Error(`Файл не найден: ${p}`);
        buf = readFileSync(p); name = basename(p);
        if (a.embed) src = fileToDataURI(p);
        else if (a.copy === false) src = toRel(baseDir())(p);
      }
      if (!src && buf) {
        if (a.embed) src = toDataURI(buf, IMAGE_MIME[extname(name).toLowerCase()], 'image/png');
        else {
          const dir = resolve(baseDir(), 'assets');
          mkdirSync(dir, { recursive: true });
          let dest = resolve(dir, name), i = 1;
          const stem = name.replace(/\.[^.]+$/, ''), ext = extname(name) || '.png';
          while (existsSync(dest) && !(isAbsolute(a.path) && resolve(a.path) === dest)) {
            const same = readFileSync(dest).equals(buf);
            if (same) break;
            dest = resolve(dir, `${stem}-${++i}${ext}`);
          }
          if (!existsSync(dest)) writeFileSync(dest, buf);
          src = toRel(baseDir())(dest);
        }
      }
      const size = buf ? imageSize(buf) : null;
      let nw = size?.width ?? 100, nh = size?.height ?? 100;
      if (a.sheet?.cols) {
        a.sheet = { ...a.sheet, frameWidth: a.sheet.frameWidth ?? nw / a.sheet.cols, frameHeight: a.sheet.frameHeight ?? nh / (a.sheet.rows || 1) };
        nw = a.sheet.frameWidth; nh = a.sheet.frameHeight;
      }
      let w = a.width, h = a.height;
      if (w && !h) h = (w * nh) / nw;
      else if (h && !w) w = (h * nw) / nh;
      else if (!w && !h) { w = nw; h = nh; }
      const props = { x: a.x ?? scene.width / 2, y: a.y ?? scene.height / 2, width: w, height: h, src, ...(a.fit ? { fit: a.fit } : {}), ...(a.pixelated ? { pixelated: true } : {}), ...(a.sheet ? { sheet: a.sheet } : {}), ...(a.props || {}) };
      const n = mutate('растровый слой', () => ops.addNode(scene, { id: a.id, type: 'image', parent: a.parent, props, index: a.index }));
      return text(`Добавлен растровый слой ${n.id}: ${typeof src === 'string' && src.startsWith('data:') ? 'встроен в сцену' : src}, ${Math.round(w)}×${Math.round(h)}${size ? ` (исходник ${size.width}×${size.height})` : ''}.`);
    },
  },
  {
    name: 'dither_set',
    description: `Дизеринг теней: упорядоченный растр вместо плоской заливки. enabled — глобальный переключатель для всех узлов-теней (свойство shade: true); shade/unshade — пометить узлы как тени или снять пометку. Параметры по умолчанию для всех: pattern (${Object.keys(DITHER_PATTERNS).join(', ')}), cell (размер «пикселя» растра, px), density (0..1 или [от, до] — плавный переход вдоль angle, 90° = сверху вниз), color (по умолчанию — заливка узла). Отдельный узел может переопределить: props.dither = {...} или false.`,
    inputSchema: { type: 'object', properties: { enabled: { type: 'boolean' }, pattern: { type: 'string', enum: Object.keys(DITHER_PATTERNS) }, cell: NUM, density: ANY, angle: NUM, color: STR, shade: { type: 'array', items: STR }, unshade: { type: 'array', items: STR } } },
    run: (a) => {
      mutate('дизеринг', () => {
        const d = { ...(scene.dither || { enabled: false, pattern: 'bayer4', cell: 3, density: 0.5, angle: 90 }) };
        for (const k of ['enabled', 'pattern', 'cell', 'density', 'angle', 'color']) if (a[k] !== undefined) d[k] = a[k];
        scene.dither = d;
        for (const id of a.shade || []) ops.updateNode(scene, id, { props: { shade: true } });
        for (const id of a.unshade || []) ops.updateNode(scene, id, { unset: ['shade'] });
      });
      const count = scene.nodes.filter((n) => n.props?.shade).length;
      return text(`Дизеринг ${scene.dither.enabled ? 'включён' : 'выключен'}: ${JSON.stringify(scene.dither)}. Узлов-теней: ${count}.`);
    },
  },
  {
    name: 'clip_set',
    description: 'Создать или изменить именованный клип — отрезок общей шкалы времени (idle, walk, talk...). start/end в секундах, loop (по умолчанию true), fps (для экспорта спрайтов), next — какой клип играть после неповторяющегося. Если end больше длительности сцены, она увеличится. Раскладывайте клипы на шкале последовательно, например idle 0–2, walk 2–3.2, talk 3.2–5.',
    inputSchema: { type: 'object', properties: { name: STR, start: NUM, end: NUM, loop: { type: 'boolean' }, fps: NUM, next: STR }, required: ['name', 'start', 'end'] },
    run: (a) => { mutate(`клип ${a.name}`, () => ops.setClip(scene, a)); return summary(`Клип ${a.name}: ${a.start}–${a.end}s.`); },
  },
  {
    name: 'clip_remove',
    description: 'Удалить именованный клип (анимация на шкале остаётся).',
    inputSchema: { type: 'object', properties: { name: STR }, required: ['name'] },
    run: ({ name }) => { const n = mutate('удалить клип', () => ops.removeClip(scene, name)); return text(n ? `Клип ${name} удалён.` : `Клипа ${name} нет.`); },
  },
  {
    name: 'mod_add',
    description: `Добавить процедурный модификатор узлу. Типы: ${Object.entries(MODIFIERS).map(([k, v]) => `${k} — ${v.doc}`).join(' | ')}. Общие поля: start, end, fadeIn, fadeOut, weight, enabled.`,
    inputSchema: { type: 'object', properties: { id: STR, mod: { type: 'object', properties: { type: { type: 'string', enum: Object.keys(MODIFIERS) } }, required: ['type'] } }, required: ['id', 'mod'] },
    run: ({ id, mod }) => { const i = mutate('модификатор', () => ops.addMod(scene, id, mod)); return text(`Модификатор ${mod.type} добавлен к ${id} (индекс ${i}).`); },
  },
  {
    name: 'mod_remove',
    description: 'Удалить модификатор узла: по индексу, по типу, или все (если не указано).',
    inputSchema: { type: 'object', properties: { id: STR, index: NUM, type: STR }, required: ['id'] },
    run: ({ id, index, type }) => { const n = mutate('удалить модификатор', () => ops.removeMod(scene, id, index ?? type)); return text(`Удалено модификаторов: ${n}.`); },
  },
  {
    name: 'preset_apply',
    description: `Применить анимационный пресет. ${Object.entries(PRESETS).map(([k, v]) => `${k}: ${v.doc}`).join(' | ')}`,
    inputSchema: { type: 'object', properties: { preset: { type: 'string', enum: Object.keys(PRESETS) }, params: OBJ }, required: ['preset', 'params'] },
    run: ({ preset, params }) => { mutate(`пресет ${preset}`, () => applyPreset(scene, preset, params)); return summary(`Пресет ${preset} применён.`); },
  },
  {
    name: 'state_set',
    description: 'Группа состояний объекта: именованные варианты, которые подменяют свойства узлов. Пример: name "locker", default "closed", values {"closed": {}, "open": {"door": {"visible": false}, "door_open": {"visible": true}}}. В превью и редакторе переключаются, в Godot экспорт делает слой на вариант и $Scene.set_state(группа, вариант).',
    inputSchema: { type: 'object', properties: { name: STR, default: STR, values: OBJ }, required: ['name', 'values'] },
    run: (a) => { mutate('состояния', () => ops.setState(scene, a)); return summary(`Состояния «${a.name}» заданы.`); },
  },
  {
    name: 'state_remove',
    description: 'Удалить группу состояний.',
    inputSchema: { type: 'object', properties: { name: STR }, required: ['name'] },
    run: ({ name }) => { const n = mutate('удалить состояния', () => ops.removeState(scene, name)); return summary(n ? `Группа «${name}» удалена.` : 'Такой группы нет.'); },
  },
  {
    name: 'ik_set',
    description: 'Двухзвенный IK на конечном узле id (например стопа): его родитель и дед (голень, бедро) поворачиваются так, чтобы id оказался в точке узла target. bend 1|-1 — сторона сгиба (по умолчанию как в текущей позе), flip — обратная сторона, orient — конечный узел повторяет поворот цели (стопа ровно на полу). Свойство ikWeight узла (0..1, можно анимировать) смешивает IK с ключами поворота. target null — снять IK.',
    inputSchema: { type: 'object', properties: { id: STR, target: { type: ['string', 'null'] }, bend: NUM, flip: { type: 'boolean' }, orient: { type: 'boolean' }, orientOffset: NUM }, required: ['id'] },
    run: ({ id, target, ...cfg }) => { mutate('IK', () => ops.setIK(scene, id, target ? { target, ...cfg } : null)); return summary(target ? `IK: ${id} тянется к ${target}.` : `IK у ${id} снят.`); },
  },
  {
    name: 'bone_mark',
    description: 'Отметить группы как кости (props.bone: true): редактор рисует их скелетом и даёт крутить мышью вокруг сустава. Кость — группа, её x,y — сустав в координатах родителя.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: STR }, bone: { type: 'boolean' } }, required: ['ids'] },
    run: ({ ids, bone = true }) => { mutate('кости', () => { for (const id of ids) ops.updateNode(scene, id, bone ? { props: { bone: true } } : { unset: ['bone'] }); }); return text(`Костей отмечено: ${ids.length}.`); },
  },
  {
    name: 'pixel_set',
    description: 'Пиксельный режим сцены: кадр рисуется в разрешении (ширина/size × высота/size) без сглаживания и увеличивается «ближайшим» — вектор и пиксель-арт выглядят одинаково. size — размер пикселя в единицах сцены (6 для 1920×1080 → 320×180), palette — массив цветов (необязательно, всё приводится к ним), aa — оставить сглаживание краёв. enabled:false — выключить.',
    inputSchema: { type: 'object', properties: { enabled: { type: 'boolean' }, size: NUM, palette: { type: 'array', items: STR }, aa: { type: 'boolean' } } },
    run: (a) => { const r = mutate('пиксели', () => ops.setPixel(scene, a.enabled === false ? { enabled: false } : a)); return summary(r?.enabled ? `Пиксельный режим: пиксель ${r.size}.` : 'Пиксельный режим выключен.'); },
  },
  {
    name: 'symbol_define',
    description: 'Символ — переиспользуемый набор узлов со своей шкалой времени (персонаж, иконка, цикл ходьбы). Его рисуют узлы type "instance" (props.symbol — имя; своя трансформация; timeOffset/timeScale — сдвиг и скорость времени; loop — по кругу по duration символа, по умолчанию да; symbolTime — явное время, можно анимировать). Правка символа меняет все экземпляры. Здесь — задать символ из узлов nodes (как в сцене, parent — внутри символа) или из поддерева узла from (replace — заменить поддерево экземпляром на том же месте, по умолчанию да). duration — длина цикла символа.',
    inputSchema: { type: 'object', properties: { name: STR, nodes: { type: 'array', items: OBJ }, from: STR, replace: { type: 'boolean' }, duration: NUM }, required: ['name'] },
    run: ({ name, nodes, from, replace, duration }) => {
      if (from) { const r = mutate('символ ' + name, () => ops.symbolFromNode(scene, from, name, { replace, duration })); return summary('Символ «' + name + '» из «' + from + '»' + (r.instance ? ', на его месте экземпляр ' + r.instance.id : '') + '.'); }
      if (!nodes) throw new Error('Нужны nodes или from');
      mutate('символ ' + name, () => ops.defineSymbol(scene, name, { nodes, duration }));
      return summary('Символ «' + name + '»: ' + nodes.length + ' узлов. Экземпляр: node_add type "instance", props {symbol: "' + name + '"}.');
    },
  },
  {
    name: 'symbol_remove',
    description: 'Удалить символ. Если его используют экземпляры — только с force (они тоже удаляются).',
    inputSchema: { type: 'object', properties: { name: STR, force: { type: 'boolean' } }, required: ['name'] },
    run: ({ name, force }) => { const u = mutate('удалить символ', () => ops.removeSymbol(scene, name, { force })); return summary('Символ «' + name + '» удалён' + (u.length ? ', экземпляры: ' + u.join(', ') : '') + '.'); },
  },
  {
    name: 'marker_set',
    description: 'Маркер — именованная точка на шкале времени (событие: «удар», «шаг», «конец вступления»). Плеер вызывает подписчиков player.onMarker(fn) при прохождении; маркеры уходят в Lottie (markers). data — любые данные для обработчика. Повторный вызов с тем же именем передвигает маркер.',
    inputSchema: { type: 'object', properties: { name: STR, t: NUM, data: ANY }, required: ['name', 't'] },
    run: ({ name, t, data }) => { mutate('маркер ' + name, () => ops.setMarker(scene, name, t, data)); return text('Маркер «' + name + '» на ' + t + 's. Всего: ' + scene.markers.map((m) => m.name + '@' + m.t).join(', ')); },
  },
  {
    name: 'marker_remove',
    description: 'Удалить маркер по имени.',
    inputSchema: { type: 'object', properties: { name: STR }, required: ['name'] },
    run: ({ name }) => { const n = mutate('удалить маркер', () => ops.removeMarker(scene, name)); return text(n ? 'Маркер «' + name + '» удалён.' : 'Маркера «' + name + '» нет.'); },
  },
  {
    name: 'svg_import',
    description: 'Импорт SVG (файл path или текст svg) в узлы сцены: группы, rect/circle/ellipse/line, path/polygon/polyline, text, image, <use>, CSS-классы из <style>, линейные и радиальные градиенты; трансформации раскладываются в x/y/rotation/scale/skewX. Не переносятся clip-path, mask, filter, pattern, SMIL — о них предупреждения. Всё ложится в одну группу (id, по умолчанию «svg») под parent. fit [w, h] — вписать в размер, scale — масштаб, x/y — положение, center — x/y задают центр.',
    inputSchema: { type: 'object', properties: { path: STR, svg: STR, id: STR, parent: STR, x: NUM, y: NUM, scale: NUM, fit: { type: 'array', items: NUM }, center: { type: 'boolean' } } },
    run: ({ path, svg, ...o }) => {
      if (!path && !svg) throw new Error('Нужен path (файл SVG) или svg (текст)');
      const file = path ? (isAbsolute(path) ? path : resolve(baseDir(), path)) : null;
      const src = svg ?? readFileSync(file, 'utf8');
      const r = mutate('импорт SVG', () => {
        const res = insertSVG(scene, src, o);
        // относительные ссылки картинок — от папки SVG к папке сцены
        if (file) for (const id of res.ids) {
          const n = nodeById(scene, id);
          const s = n?.type === 'image' && n.props.src;
          if (s && !/^(data:|https?:|\/)/.test(s) && !isAbsolute(s)) n.props.src = toRel(baseDir())(resolve(dirname(file), s));
        }
        return res;
      });
      return summary('SVG импортирован: группа ' + r.root + ', узлов ' + r.ids.length + ', исходный размер ' + r.width + '×' + r.height + '.' + (r.warnings.length ? '\nНе перенесено: ' + r.warnings.join('; ') : ''));
    },
  },
];
