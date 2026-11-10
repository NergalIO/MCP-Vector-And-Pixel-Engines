// Инструменты MCP: 2.5D: камера, сборка мира, материалы, поверхности, свет и стиль отложенного рендера.
import { resolveLighting, resolveStyle, effectsSummary, LIGHT_PRESETS, STYLE_TYPES } from '../lighting.mjs';
import { worldBuild, worldItemEdit, rebuildWorlds, cameraSet, materialApply, surfaceOfNode } from '../world_ops.mjs';
import { MATERIALS, worldItemsDoc } from '../../engine/world3d.js';
import { MATERIAL_PRESETS } from '../materials.mjs';
import { scene, mutate } from '../store.mjs';
import { ANY, NUM, STR, OBJ, text } from './common.mjs';

export const tools = [
  {
    name: 'camera3d_set',
    description: 'Камера 2.5D-сцены (scene.camera3d): P([X,Y,Z]) = [cx + f·X/(Z+dz), hor + f·(camH − Y)/(Z+dz)]; мир: 1 ед. ≈ 1 м, Y вверх, Z вглубь от камеры. hor — экранная Y горизонта, f — фокус в px (больше — уже угол), camH — высота камеры, dz — отъезд назад (ослабляет искажения по краям), cx — экранная X точки схода (по умолчанию середина). Подбор: charPx — рост персонажа (1.7 м) у нижнего края кадра в px (bottom — экранная Y этого края, по умолчанию высота сцены): camH = 1.7·(bottom − hor)/charPx. Поворот: yaw — рысканье в градусах (+ вправо), pitch — наклон (+ вверх); keepVerticals: true — вертикали остаются вертикальными (наклон заменяется сдвигом горизонта, «архитектурная» камера). Без поворота формула прежняя, кадры старых сцен не меняются. Одна и та же камера используется построителем, проекцией света и компоновщиком. rebuild (по умолчанию true) — пересобрать группы world_build под новую камеру. Без параметров — показать текущую; remove: true — удалить.',
    inputSchema: { type: 'object', properties: { hor: NUM, f: NUM, camH: NUM, dz: NUM, cx: NUM, yaw: NUM, pitch: NUM, keepVerticals: { type: 'boolean' }, charPx: NUM, bottom: NUM, rebuild: { type: 'boolean' }, remove: { type: 'boolean' } } },
    run: (a) => {
      if (a.remove) { mutate('камера 3D', () => { delete scene.camera3d; }); return text('camera3d удалена: сцена снова чисто 2D (отложенный свет недоступен).'); }
      if (!['hor', 'f', 'camH', 'dz', 'cx', 'charPx', 'yaw', 'pitch', 'keepVerticals'].some((k) => a[k] != null)) return text(scene.camera3d ? `camera3d: ${JSON.stringify(scene.camera3d)}` : 'camera3d не задана.');
      let rb = [];
      const c = mutate('камера 3D', () => { const c = cameraSet(scene, a); if (a.rebuild !== false) rb = rebuildWorlds(scene); return c; });
      const charAt = (Z) => ((c.f * 1.7) / (Z + c.dz)).toFixed(0);
      return text(`camera3d: ${JSON.stringify(c)}. Рост персонажа (1.7 м): ${charAt(4)} px на Z=4, ${charAt(10)} px на Z=10, ${charAt(20)} px на Z=20.${rb.length ? ` Пересобрано групп мира: ${rb.map((r) => r.group).join(', ')}.` : ''}`);
    },
  },
  {
    name: 'world_build',
    get description() {
      return `Собрать 2.5D-окружение из 3D-описания: объекты проецируются камерой camera3d (нет — подбирается) в обычные узлы-контуры с props.surface (нормаль, плоскость, блик, свечение, контур) и окклюдерами для теней. Результат — группа group (по умолчанию "world"; повторный вызов с тем же group заменяет её); описание хранится в группе и пересобирается при смене камеры (ключи анимации узлов и узлы, добавленные в группу вручную, сохраняются). Порядок рисования — по глубине (key, обычно ближняя Z). Мир: 1 ед. ≈ 1 м, Y вверх, Z вглубь.
items — предметы {type, …}; поля проверяются по схеме (ошибка — предмет пропущен, неизвестное поле — предупреждение). ! — обязательное, =умолчание:
${worldItemsDoc()}
Материалы (mat, mats): ${MATERIALS.join(', ')}. Векторный материал — тысячи деталей; для больших плоскостей лучше mat: false и pmat — попиксельный материал из materials (вариация цвета, грязь, износ, текстура без лишних узлов). Цвета — #hex или имена палитры (stone, brick, plaster, wood, roof, cobble, glass, glow, water…).
seed — случайность (детерминирована; у каждого предмета свой подсид от seed и его id/номера: правка одного предмета и смена камеры не меняют остальные). sky — [верх, середина, низ] неба (фон сцены). occ: "auto" (по умолчанию) — окклюдеры теней из граней предметов; "boxes" — только явные коробки. materials — описания попиксельных материалов, сливаются в scene.materials. v: 1 — прежняя сборка (общий поток случайных чисел, id по порядку); по умолчанию 2: предметы без id получают id по номеру, неизменённые предметы при пересборке берутся из кэша. lod: 0 — полная детализация, 1 (по умолчанию) — без фасок мельче ~1 px, 2 — грубее (дальние детали). merge (по умолчанию true) — детали грани с одинаковым видом сливаются в составные пути (в десятки раз меньше узлов, вид тот же). pan — проезд камеры вбок [[t, dx м], …]: группы предметов получают ключи x по глубине (параллакс; свет и тени остаются на месте). tess — адаптивная тесселяция кривых (тела вращения, сферы, диски, арки и их окклюдеры): true — сегмент дуги около 6 px на экране, число — px на сегмент, {px, min, max}; ближние предметы глаже (силуэт и тень без граней), дальние проще. По умолчанию выключена (постоянное число граней). Правка одного предмета — world_item. Ответ: узлы по предметам, предупреждения и подсказки для тяжёлых предметов.`;
    },
    inputSchema: { type: 'object', properties: { items: { type: 'array', items: OBJ }, group: STR, seed: NUM, sky: { type: 'array', items: STR }, background: { type: 'boolean' }, parent: STR, occ: { type: 'string', enum: ['auto', 'boxes'] }, materials: OBJ, v: NUM, lod: NUM, merge: { type: 'boolean' }, tess: ANY, pan: { type: 'array', items: ANY } }, required: ['items'] },
    run: (a) => text(worldReport(mutate(`мир ${a.group || 'world'}`, () => worldBuild(scene, a)))),
  },
  {
    name: 'world_item',
    description: 'Правка одного предмета мира (группа group, по умолчанию "world"): найти по id (или index — номер в items), item — заменить целиком, patch — дополнить поля (null — удалить поле), remove: true — удалить, add — добавить новый предмет. Мир пересобирается, неизменённые предметы берутся из кэша (v2: их вид и id узлов не меняются). Описание мира — props.world3d группы.',
    inputSchema: { type: 'object', properties: { group: STR, id: ANY, index: NUM, item: OBJ, patch: OBJ, remove: { type: 'boolean' }, add: OBJ } },
    run: (a) => {
      const r = mutate(`предмет ${a.id ?? a.index ?? 'новый'}`, () => worldItemEdit(scene, a));
      return text(`Предмет #${r.index} ${a.remove ? 'удалён' : a.add ? 'добавлен' : 'изменён'}. ${worldReport(r)}`);
    },
  },
  {
    name: 'material_apply',
    description: `Наложить материал на узел-грань с surface.plane: детали (кладка, доски, черепица, брусчатка — с наклонёнными нормалями-фасками) строятся на плоскости грани в рамке по габаритам узла и кладутся группой <id>_mat сразу после него, обрезанные его контуром. Повторный вызов заменяет материал. material: ${MATERIALS.join(', ')}; color; options (brick: bw, bh; stone: bh, moss:false; wood: pw, vert; tile: rh, tw; cobble: maxZ; plaster: patches); seed.
mode: "pixel" — попиксельный материал без узлов: описание params кладётся в scene.materials[material] (без params — готовое: ${Object.keys(MATERIAL_PRESETS).join(', ')}), узлу (id — строка или массив) ставится surface.mat. params: { noise {scale м, amount, octaves, color}, grime {height м, amount, ao, color, floor}, wear {amount, color} — износ рёбер, tex {kind: planks|stripes|tiles|checker|image, color, color2, colors, w, len, gap, s, grout, src, scale, tint, amount, mode:"multiply"} — текстура в перспективе, bump {scale, amount} — микрорельеф }. Работает в отложенном свете и при экспорте (запекается в альбедо).`,
    inputSchema: { type: 'object', properties: { id: ANY, material: STR, color: STR, options: OBJ, seed: NUM, mode: { type: 'string', enum: ['vector', 'pixel'] }, params: OBJ }, required: ['id', 'material'] },
    run: (a) => {
      const r = mutate(`материал ${a.material}`, () => materialApply(scene, a));
      if (r.mode === 'pixel') return text(`Попиксельный материал ${a.material} на ${r.ids.join(', ')}: ${JSON.stringify(r.params)}. Материалы сцены: ${r.materials.join(', ')}.`);
      return text(`Материал ${a.material} на ${a.id}: группа ${r.group}, узлов ${r.nodes}, рамка ${r.frame.w.toFixed(2)}×${r.frame.h.toFixed(2)} м.`);
    },
  },
  {
    name: 'surface_set',
    description: 'Правка props.surface у узлов — поверхность для отложенного света. Наследуются детьми: plane, normal, u, v, spec, emissive, tag, sky; свои у узла: base, bump, ink, sw, tilt. Поля: normal [x,y,z] — нормаль для света (мир: Y вверх, Z от камеры; к камере — [0,0,-1]); tilt [du,dv,k] — наклон относительно нормали родительской грани (рельеф); plane [nx,ny,nz,d] (n·P = d) — плоскость для позиции пикселя; spec 0..1 (стекло 0.9, металл 0.6, вода 1, штукатурка 0.1); emissive — цвет свечения; base: true — тело (перекрывает всё за собой в проходах); bump: true — деталь меняет только нормаль; ink + sw — контур и толщина; tag — метка маски (персонажи — "chr": мягкий свет); sky: true — фигура неба. По умолчанию поля сливаются; replace — заменить целиком; unset — убрать поля; surface: false — снять поверхность.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: STR }, surface: ANY, unset: { type: 'array', items: STR }, replace: { type: 'boolean' } }, required: ['ids'] },
    run: ({ ids, surface, unset = [], replace }) => {
      mutate('поверхность', () => {
        for (const id of ids) {
          const n = scene.nodes.find((x) => x.id === id);
          if (!n) throw new Error(`Узел ${id} не найден`);
          n.props = n.props || {};
          if (surface === false || surface === null) { delete n.props.surface; continue; }
          const cur = replace || typeof n.props.surface !== 'object' || !n.props.surface ? {} : { ...n.props.surface };
          Object.assign(cur, surface || {});
          for (const k of unset) delete cur[k];
          n.props.surface = cur;
        }
      });
      return text(ids.map((id) => `${id}: ${JSON.stringify(surfaceOfNode(scene, id))}`).join('\n'));
    },
  },
  {
    name: 'lighting_set',
    description: `Глобальный свет отложенного рендера (scene.lighting). preset: ${Object.entries(LIGHT_PRESETS).map(([k, v]) => `${k} (${v.title})`).join(', ')}. Поля (необязательны, сливаются с пресетом): sun {dir [x,y,z] — направление НА солнце, color, energy, wrap (мягкость 0..0.3), shadows}, sky {color, energy}, ground {color, energy}, ao {strength, radius}, fog {color, density, start, amount}, bloom {strength, threshold}, exposure, saturation, tonemap ("aces"|"hue" — тон сохраняется, оранжевый не уходит в жёлтый|"agx"|"none"), emissive (сила свечения), specular (сила бликов), groups {lamp, window, candle} — множители групп источников, lightShadows (тени от ламп), characters {tag, amount}, backdrop {mode: "albedo"|"gradient", colors [верх, середина, низ], clouds, stars, moon {x (доля ширины), y, r}}. Новое (по умолчанию выключено; true — значения по умолчанию): sun.angle — угловой размер солнца в градусах (мягкая полутень, растущая от точки контакта; 0 — резкая тень); gi {strength 0.5, radius 2.5} — отражённый свет (один отскок в экранном пространстве: цветные рефлексы от пола и стен); volumetric {density 0.015, steps 12, g 0.5 (вперёд-рассеяние), lamps 0.8 (ореолы ламп), maxDist 40, color} — лучи солнца в дымке; reflections {strength 0.5, minSpec 0.5, maxDist 14, floorOnly} — отражения в полах с бликом (SSR); grade {lift, gamma, gain (число или [r,g,b]), contrast, split {shadows, highlights, amount, balance}, lut (путь .cube), lutAmount} — цветокоррекция; groups.fairy — гирлянды. Цвет как в иллюстрации: paint {chroma 0.45 (насколько цвет света окрашивает поверхность), shadow [r,g,b] (тон тени), amount 0.4, desat 0.2, range [0.12,0.7], fill 0.03} — локальный цвет сохраняется, тень сдвигает тон, лампы остаются тёплыми; aerial {color, start 8, density 0.05, amount 0.7, desat 0.45, shift 0.5, lift 0.06} — воздушная перспектива; ao.color — цвет затенённого вместо чёрного; grade.matchRef ("путь к картинке" или {src, amount 0.6, lum 0.35, chroma 0.6, zones}) — палитра с референса в Lab по зонам теней/середины/светов; textureFilter (true) — фильтрация фактур вдали (без муара). Постобработка (выключена по умолчанию): ao {mode: "gtao" — горизонтная окклюзия в метрах (radius) с изогнутыми нормалями (bent, свет неба по свободному направлению), multiBounce (светлые поверхности теряют меньше света в щелях), dirs 4, steps 8, falloff 0.6}; contactShadows {length 0.4 м, steps 14, thickness 0.12, strength 1} — контактные тени по буферу глубины (мелкие детали без окклюдеров); gi.bounces 1…3 — отскоки отражённого света; dof {focus (м или "auto" — центр кадра), aperture 1, maxBlur 14 (px кадра 1280), near (true), samples 24} — глубина резкости с боке (контур размывается вместе с предметом); autoExposure {key 0.18, min 0.35, max 3, amount 1} — автоэкспозиция по средней яркости. Цвета света — #hex (доля = значение/255, без гаммы) или [r,g,b] 0..1. replace — заменить, а не слить. При смене пресета берётся и его стиль (withStyle: false — оставить текущий).`,
    inputSchema: { type: 'object', properties: { preset: { type: 'string', enum: Object.keys(LIGHT_PRESETS) }, sun: OBJ, sky: OBJ, ground: OBJ, ao: OBJ, fog: OBJ, bloom: OBJ, exposure: NUM, saturation: NUM, tonemap: STR, emissive: NUM, specular: NUM, groups: OBJ, lightShadows: { type: 'boolean' }, characters: OBJ, backdrop: OBJ, gi: ANY, volumetric: ANY, reflections: ANY, grade: ANY, paint: ANY, aerial: ANY, textureFilter: { type: 'boolean' }, contactShadows: ANY, dof: ANY, autoExposure: ANY, replace: { type: 'boolean' }, withStyle: { type: 'boolean' } } },
    run: (a) => {
      const { replace, withStyle, ...fields } = a;
      mutate('свет', () => {
        const isO = (v) => v && typeof v === 'object' && !Array.isArray(v);
        const cur = replace ? {} : { ...(scene.lighting || {}) };
        for (const [k, v] of Object.entries(fields)) cur[k] = isO(v) && isO(cur[k]) ? { ...cur[k], ...v } : v;
        scene.lighting = cur;
        if (a.preset && withStyle !== false) scene.style = LIGHT_PRESETS[a.preset].style.map((x) => ({ ...x }));
      });
      const st = resolveLighting(scene);
      const fx = effectsSummary(st);
      return text(`scene.lighting: ${JSON.stringify(scene.lighting)}\n${fx.length ? `Эффекты: ${fx.join(', ')}.\n` : ''}Итог: солнце [${st.sun.dir.map((v) => v.toFixed(2))}] ×${st.sun.energy}, небо ×${st.sky.energy}, AO ${st.ao.strength}, группы ${JSON.stringify(st.groups)}, экспозиция ${st.exposure}, туман ${st.fog.density}.\nСтиль: ${resolveStyle(scene).map((x) => x.type).join(' → ') || '—'}`);
    },
  },
  {
    name: 'style_set',
    description: `Цепочка пост-эффектов отложенного рендера (scene.style), по порядку. Типы: {type:"cel", steps:[0.12,0.5], detail:0.5} — ступенчатый свет по нормали плоскости + мягкий рельеф; {type:"hatch", below:0.42, period:9, color} — штриховка в тенях; {type:"kuwahara", radius:3} — мазки; {type:"pixelate", size:4 (px сцены), colors:56, bayer:0.07} — пиксели + Байер + палитра; {type:"paint", radius:4, sharpness:8} — анизотропный Кувахара (мазки вдоль формы, края чистые); {type:"ink", strength, color ("albedo" — цвет линии из альбедо, darken:0.3), depthWidth (ближе — толще, дальше — тоньше), refDepth:6} — контур из прохода ink; {type:"paper", strength:0.08, color, tint, scale} — фактура бумаги; {type:"vignette", strength:0.22}; {type:"fxaa", threshold:0.125, subpix:0.75} — сглаживание краёв (лесенки проходов и стилей); {type:"sharpen", amount:0.4} — адаптивная резкость (CAS); {type:"chromatic", amount:1.5} — хроматическая аберрация к краям кадра; {type:"grain", amount:0.04, size:1.2, color:false, seed} — зерно плёнки. Размеры заданы для кадра 2560 px и масштабируются. enabled: false — выключить звено. preset — стиль пресета (${Object.keys(LIGHT_PRESETS).join(', ')}); chain: [] — без стиля. Без параметров — показать текущий.`,
    inputSchema: { type: 'object', properties: { chain: { type: 'array', items: OBJ }, preset: { type: 'string', enum: Object.keys(LIGHT_PRESETS) } } },
    run: ({ chain, preset }) => {
      if (!chain && !preset) return text(`Стиль: ${scene.style ? JSON.stringify(scene.style) : `(по пресету света) ${resolveStyle(scene).map((x) => x.type).join(' → ')}`}`);
      for (const s of chain || []) if (!STYLE_TYPES.includes(s?.type)) throw new Error(`Тип стиля ${s?.type}? Есть: ${STYLE_TYPES.join(', ')}`);
      mutate('стиль', () => { scene.style = chain || LIGHT_PRESETS[preset].style.map((x) => ({ ...x })); });
      return text(`Стиль: ${scene.style.map((x) => x.type).join(' → ') || 'без эффектов'}.`);
    },
  },
];

/** Отчёт о сборке мира для агента: размеры, кэш, тяжёлые предметы, ошибки, предупреждения, подсказки. */
function worldReport(r) {
  const heavy = r.stats.map((s, i) => s && { i, ...s }).filter((s) => s && s.nodes).sort((x, y) => y.nodes - x.nodes).slice(0, 5);
  const cached = r.stats.filter((s) => s?.cached).length;
  const lines = [`Группа ${r.group}: объектов ${r.items}, узлов ${r.nodes}, источников света ${r.lights}, окклюдеров ${r.occluders}. camera3d: ${JSON.stringify(scene.camera3d)}.`];
  if (cached) lines.push(`Из кэша: ${cached} из ${r.stats.length} предметов.`);
  if (heavy.length) lines.push(`Больше всего узлов: ${heavy.map((s) => `#${s.i} ${s.type} ${s.nodes}`).join(', ')}.`);
  if (r.errors.length) lines.push(`Ошибки: ${r.errors.join('; ')}`);
  if (r.warnings.length) lines.push(`Предупреждения: ${r.warnings.join('; ')}`);
  if (r.hints.length) lines.push(`Подсказки: ${r.hints.join('; ')}`);
  lines.push('Проверка: render_frame с lit: "deferred" (debug: true — проходы).');
  return lines.join('\n');
}
