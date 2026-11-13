// Инструменты MCP: Сцена целиком: сводка, справка, создание, открытие и сохранение, история, правки поверх сцены из скрипта.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRESETS, MODIFIERS, easings, describeScene } from '../../engine/kontur.js';
import { probeRaster, rasterNote, canPng, capabilities } from '../render.mjs';
import { compatReport } from '../godot.mjs';
import { worldItemsDoc } from '../../engine/world3d.js';
import { ROOT } from '../paths.mjs';
import { ANY, NUM, STR, OBJ, PATH, text, summary, nodeById } from './common.mjs';

/** docs/REFERENCE.md — читается один раз. */
let refDoc = null;
const reference = () => (refDoc ??= readFileSync(resolve(ROOT, 'docs/REFERENCE.md'), 'utf8'));

/** @param {any} session @param {{ byName?: (name: string) => any }} [registry] поиск по всем инструментам (для docs { tool }) */
export const tools = (session, { byName } = {}) => [
  {
    name: 'scene_info',
    description: 'Сводка текущей сцены: размеры, длительность, дерево узлов с ключами и модификаторами, адрес превью и путь к файлу. Начинайте работу с него.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      await probeRaster();
      const png = canPng() ? `да (${capabilities.png})` : `нет — ${rasterNote()}`;
      const issues = compatReport(session.scene, 'godot');
      const ei = session.editsInfo();
      const edl = ei.mode ? `\nПравки: ${ei.path} — объектов ${ei.count}${ei.warnings.length ? `, предупреждений ${ei.warnings.length} (edits_info)` : ''}${ei.locked ? ' — ЗАБЛОКИРОВАНЫ' : ''}. Исходный файл не перезаписывается, правки ложатся поверх при каждой пересборке.` : '';
      const ro = session.readOnly ? `\nТОЛЬКО ЧТЕНИЕ: ${session.readOnly}` : '';
      const fixed = session.loadNotes.length ? `\nПочинено при загрузке: ${session.loadNotes.length} (${session.loadNotes.slice(0, 3).join('; ')}${session.loadNotes.length > 3 ? '…' : ''})` : '';
      return text(`${describeScene(session.scene)}\n\nФайл: ${session.scenePath}${ro}${fixed}${edl}\nПревью: ${session.previewUrl || 'выключено'}\nPNG-кадры: ${png}\nВидео: ${capabilities.ffmpeg && canPng() ? 'да' : capabilities.ffmpeg ? 'нет (нет растеризатора)' : 'нет (нужен ffmpeg)'}${issues.length ? `\nСовместимость с Godot (импорт SVG): ${issues.length} замечаний — подробно в compat_check; для переноса с эффектами используйте export format "godot".` : ''}`);
    },
  },
  {
    name: 'docs',
    description: 'Справочник по формату сцены, типам узлов, свойствам, кривым, модификаторам, пресетам и рецептам плавных анимаций. Прочитайте перед созданием сложных анимаций. topic "2.5d" — только раздел о 2.5D-сценах и отложенном свете (camera3d, surface, проходы, lighting, style, world_build); topic "props" — реестр предметов world_build (типы, параметры по умолчанию, описания). tool — полное описание инструмента (у части инструментов в списке — краткое).',
    inputSchema: { type: 'object', properties: { topic: { type: 'string', enum: ['all', 'modifiers', 'presets', 'easings', '2.5d', 'props'] }, tool: { type: 'string', description: 'имя инструмента' } } },
    run: ({ topic = 'all', tool }) => {
      if (tool) {
        const t = byName?.(tool);
        if (!t) throw new Error(`Нет инструмента ${tool}`);
        return text(`${t.name}: ${t.help ?? t.description}`);
      }
      if (topic === 'props') return text(worldItemsDoc());
      if (topic === '2.5d') { const md = reference(); const i = md.indexOf('## 2.5D'); return text(md.slice(i, md.indexOf('\n## ', i + 5))); }
      if (topic === 'modifiers') return text(Object.entries(MODIFIERS).map(([k, v]) => `${k}: ${v.doc}`).join('\n'));
      if (topic === 'presets') return text(Object.entries(PRESETS).map(([k, v]) => `${k}: ${v.doc}`).join('\n'));
      if (topic === 'easings') return text(Object.keys(easings).join(', ') + '\nА также: "cubic-bezier(a,b,c,d)", [a,b,c,d], "spring(k,d,m)", {spring:{...}}, {steps:n}');
      return text(reference());
    },
  },
  {
    name: 'scene_new',
    description: 'Создать новую пустую сцену (текущая останется в истории — её можно вернуть через undo).',
    inputSchema: { type: 'object', properties: { width: NUM, height: NUM, duration: NUM, fps: NUM, background: ANY, loop: { type: 'boolean' } } },
    run: (a) => { const note = session.newScene(a); return summary(session.scene, 'Создана новая сцена.' + note); },
  },
  {
    name: 'scene_settings',
    description: 'Изменить параметры сцены: width, height, duration, fps, background (цвет или градиент), loop, dither (глобальный дизеринг теней, см. dither_set); 2.5D: camera3d, lighting, style (null — удалить; удобнее — camera3d_set, lighting_set, style_set).',
    inputSchema: { type: 'object', properties: { width: NUM, height: NUM, duration: NUM, fps: NUM, background: ANY, loop: { type: 'boolean' }, dither: ANY, relief: ANY, ambient: STR, camera3d: ANY, lighting: ANY, style: ANY } },
    run: (a) => { session.mutate('настройки', () => { for (const k of ['width', 'height', 'duration', 'fps', 'background', 'loop', 'dither', 'relief', 'ambient', 'camera3d', 'lighting', 'style']) if (a[k] !== undefined) { if (a[k] === null) delete session.scene[k]; else session.scene[k] = a[k]; } }); return summary(session.scene, 'Настройки обновлены.'); },
  },
  {
    name: 'scene_get_json',
    description: 'Получить полный JSON сцены (или одного узла по id).',
    inputSchema: { type: 'object', properties: { id: STR } },
    run: ({ id }) => text(id ? nodeById(session.scene, id) ?? `Узел ${id} не найден` : session.scene),
  },
  {
    name: 'scene_set_json',
    description: 'Заменить всю сцену JSON-объектом (формат — см. docs). Удобно, чтобы задать сложную сцену одним вызовом.',
    inputSchema: { type: 'object', properties: { scene: OBJ }, required: ['scene'] },
    run: ({ scene: s }) => {
      session.replaceScene('замена сцены', s);
      return summary(session.scene, 'Сцена заменена.');
    },
  },
  {
    name: 'scene_open',
    description: 'Открыть сцену из файла JSON (дальше автосохранение идёт в него) или один из примеров: "examples/bay.json", "examples/flow.json", "examples/liquid.json", "examples/reveal.json".',
    inputSchema: { type: 'object', properties: { path: PATH, edits: { description: '"auto" (по умолчанию: если рядом есть <имя>.edits.json или <имя>.build.mjs), true — хранить правки отдельно, false — писать прямо в файл' } }, required: ['path'] },
    run: ({ path, edits: withEdits = 'auto' }) => {
      const p = session.findPath(path);
      if (!existsSync(p) && existsSync(resolve(ROOT, path))) { session.openExample(resolve(ROOT, path)); return summary(session.scene, `Открыт пример ${path} (сохраняется в ${session.scenePath}).`); }
      session.openPath(p, withEdits);
      const ei = session.editsInfo();
      return summary(session.scene, `Открыт ${p}.${session.loadNotes.length ? `\nПочинено при загрузке (${session.loadNotes.length}):\n${session.loadNotes.join('\n')}` : ''}${ei.mode ? ` Правки хранятся отдельно: ${ei.path} (объектов: ${ei.count})${ei.warnings.length ? '\nПредупреждения:\n' + ei.warnings.join('\n') : ''}` : ''}`);
    },
  },
  {
    name: 'scene_save_as',
    description: 'Сохранить сцену в другой файл; дальнейшее автосохранение пойдёт туда.',
    inputSchema: { type: 'object', properties: { path: PATH }, required: ['path'] },
    run: ({ path }) => { const ok = session.saveAs(path); return text(ok ? `Сохранено: ${session.scenePath} (целиком, без файла правок)` : `Не удалось сохранить в ${session.scenePath} — см. журнал сервера`); },
  },
  {
    name: 'undo',
    description: 'Отменить последнее изменение сцены.',
    inputSchema: { type: 'object', properties: {} },
    run: () => { const l = session.undo(); return l == null ? text('Нечего отменять.') : summary(session.scene, `Отменено: ${l}.`); },
  },
  {
    name: 'redo',
    description: 'Вернуть отменённое изменение.',
    inputSchema: { type: 'object', properties: {} },
    run: () => { const l = session.redo(); return l == null ? text('Нечего возвращать.') : summary(session.scene, `Возвращено: ${l}.`); },
  },
  {
    name: 'edits_info',
    description: 'Правки поверх сцены из скрипта: файл, какие объекты изменены/добавлены/удалены, предупреждения после пересборки (например, id объекта сдвинулся).',
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      const ei = session.editsInfo();
      if (!ei.mode) return text(`Сцена ${session.scenePath} открыта без файла правок: изменения пишутся прямо в неё. Открыть с правками: scene_open с edits: true.`);
      return text(`Файл правок: ${ei.path}${ei.locked ? ' (ЗАБЛОКИРОВАН — не применился к сцене)' : ''}
Изменены (${ei.nodes.length}): ${ei.nodes.join(', ') || '—'}
Добавлены: ${ei.added.join(', ') || '—'}
Удалены: ${ei.removed.join(', ') || '—'}
Настройки сцены: ${ei.scene.join(', ') || '—'}
Предупреждения:\n${ei.warnings.join('\n') || '—'}`);
    },
  },
  {
    name: 'edits_reset',
    description: 'Сбросить правки — вернуть объекты к сцене из скрипта. ids — каких узлов («__scene» — настройки сцены); без ids — все.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: STR } } },
    run: ({ ids }) => { const s2 = session.resetEdits(ids); session.replaceScene('сброс правок', s2); return summary(session.scene, ids?.length ? `Сброшены правки: ${ids.join(', ')}.` : 'Все правки сброшены.'); },
  },
  {
    name: 'preview_url',
    description: 'Адрес живого превью в браузере (обновляется автоматически при каждом изменении сцены, есть таймлайн и редактор JSON).',
    inputSchema: { type: 'object', properties: {} },
    run: () => text(session.previewUrl ? `Откройте ${session.previewUrl} — там редактор: выбор и трансформации мышью, рисование фигур и пером, правка точек, ключи на таймлайне, состояния, кости, свет и пиксельный режим.` : 'Превью выключено (KONTUR_PORT=0) или ещё запускается.'),
  },
];
