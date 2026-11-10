// Инструменты MCP: Вывод: кадры, раскадровка, проходы, карты нормалей, совместимость и экспорт.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, extname, basename } from 'node:path';
import { ops, renderSVG, clipRange, pixelOf, exportLottie } from '../../engine/kontur.js';
import { probeRaster, requireRaster, rasterNote, svgToPng, canPng, contactSheetSVG, exportVideo, standaloneHTML, resolveSrc, IMAGE_MIME, renderPNG, isDeferred, litOf } from '../render.mjs';
import { writeFileEnsured } from '../paths.mjs';
import { sceneNormalMap, imageNormalMap, encodePNG, decodePNG, litPreview, sideBySide, scaleDown, NORMAL_DEFAULTS } from '../normals.mjs';
import { compatReport, exportGodot } from '../godot.mjs';
import { exportUnity } from '../unity.mjs';
import { renderLit, renderPasses, normalMapFromPass } from '../lighting.mjs';
import { log, scene, mutate, baseDir, S, toRel } from '../store.mjs';
import { ANY, NUM, STR, OBJ, text, image, withImage, nodeById } from './common.mjs';

export const tools = [
  {
    name: 'render_frame',
    description: 'Отрендерить кадр в момент t и вернуть изображение (PNG), чтобы увидеть результат. format "svg" вернёт SVG-текст. states — варианты групп состояний {группа: вариант}; lit — с освещением источниками light по карте нормалей (true или {ambient}); lit: "deferred" (или {mode: "deferred", lighting, style}) — отложенный свет 2.5D-сцены (camera3d + props.surface): солнце с тенями лучами по окклюдерам, AO, лампы с тенями, блики, свечение, туман, bloom и стиль (scene.lighting, scene.style); debug: true — лист «цвет | нормали / тени×AO | итог»; out — сохранить итог в PNG. pixel: false — без пиксельного режима сцены.',
    inputSchema: { type: 'object', properties: { t: NUM, width: NUM, format: { type: 'string', enum: ['png', 'svg'] }, states: OBJ, lit: ANY, pixel: { type: 'boolean' }, debug: { type: 'boolean' }, out: STR }, required: ['t'] },
    run: async ({ t, width = 800, format = 'png', states, lit, pixel, debug, out }) => {
      await probeRaster();
      if (format === 'svg' || !canPng()) return text((canPng() ? '' : `(${rasterNote()} Ниже SVG кадра.)\n`) + renderSVG(S(), t, { width, states }));
      if (isDeferred(lit)) {
        const L = litOf(lit);
        const r = await renderLit(S(), t, { width, states, debug, lighting: L.lighting, style: L.style, baseDir: baseDir() });
        if (out) writeFileEnsured(resolve(out), r.png);
        const st = r.stats;
        return withImage(debug ? r.debug : r.png, `t = ${t}s, отложенный свет: пресет ${st.preset}, стиль [${st.style.join(', ')}], источников ${st.litLights}/${st.lights}, окклюдеров ${st.boxes} коробок + ${st.tris} треугольников, ${st.width}×${st.height}, ${(st.ms / 1000).toFixed(1)} с (проходы ${(st.passMs / 1000).toFixed(1)} с)${st.effects?.length ? `. Эффекты: ${st.effects.join(', ')}` : ''}${st.stageMs ? `. Этапы, мс: ${Object.entries(st.stageMs).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}${debug ? '. Лист: цвет | нормали / тени×AO | итог' : ''}${out ? `. Сохранено: ${resolve(out)}` : ''}`);
      }
      const png = await renderPNG(S(), t, { width, states, lit, pixel, baseDir: baseDir() });
      return withImage(png, `t = ${t}s${states ? ' ' + JSON.stringify(states) : ''}${lit ? ', со светом' : ''}${pixelOf(scene) && pixel !== false ? ', пиксельный режим' : ''}`);
    },
  },
  {
    name: 'render_contact_sheet',
    description: 'Раскадровка: сетка из нескольких кадров в одном изображении — лучший способ проверить движение целиком. Задайте times (массив секунд) или count (равномерно по длительности), опционально start/end или clip (имя клипа), states — варианты состояний {группа: вариант}.',
    inputSchema: { type: 'object', properties: { times: { type: 'array', items: NUM }, count: NUM, start: NUM, end: NUM, clip: STR, cols: NUM, cellWidth: NUM, states: OBJ } },
    run: async ({ times, count = 8, start = 0, end = scene.duration, clip, cols, cellWidth = 360, states }) => {
      if (clip) { const r = clipRange(scene, clip); start = r.start; end = r.end; }
      if (!times) times = Array.from({ length: count }, (_, i) => start + ((end - start) * i) / (count > 1 && end < scene.duration && !clip ? count - 1 : count));
      const svg = contactSheetSVG(S(), times.slice(0, 24), { cols, cellWidth, states });
      await probeRaster();
      if (!canPng()) return text(`(${rasterNote()})\n` + svg);
      const png = await svgToPng(svg);
      return withImage(png, `Кадры: ${times.map((t) => t.toFixed(2)).join(', ')}`);
    },
  },
  {
    name: 'render_passes',
    description: 'Выгрузить проходы отложенного света в PNG (папка dir, по умолчанию <папка сцены>/passes): color (альбедо), normal (мировые нормали), plane (нормаль плоскости; альфа — геометрия), planeD (d плоскости 16 бит в R,G, блик в B), emissive, ink (маска контуров), cover (покрытие не-небом), mask_<метка> (masks, по умолчанию chr); normal_map — нормали в соглашении 2D-движков (Y вверх, Z к зрителю; yUp: false — Y вниз) для URP 2D / CanvasTexture; с lit: true — ещё shadow_ao и lit (итог). Возвращает превью.',
    inputSchema: { type: 'object', properties: { t: NUM, width: NUM, dir: STR, masks: { type: 'array', items: STR }, lit: { type: 'boolean' }, yUp: { type: 'boolean' } } },
    run: async ({ t = 0, width, dir, masks = ['chr'], lit, yUp = true }) => {
      await requireRaster('для проходов');
      const sc = S(), w = Math.round(width || sc.width);
      const out = resolve(dir || resolve(baseDir(), 'passes'));
      mkdirSync(out, { recursive: true });
      const p = await renderPasses(sc, t, { width: w, masks });
      const files = [];
      const put = (name, buf) => { const f = resolve(out, `${name}.png`); writeFileSync(f, buf); files.push(f); };
      for (const [k, png] of Object.entries(p)) put(k.replace(':', '_'), png);
      put('normal_map', encodePNG(normalMapFromPass(p.normal, { yUp })));
      let litImg = null;
      if (lit) {
        if (!sc.camera3d) throw new Error('lit: true требует camera3d (camera3d_set)');
        const r = await renderLit(sc, t, { width: w, passes: p, debug: true, baseDir: baseDir() });
        put('lit', r.png); put('shadow_ao', encodePNG(r.shadowAO)); litImg = r.image;
      }
      const tiles = [decodePNG(p.color), decodePNG(p.normal), litImg || decodePNG(p.emissive)].map((im) => scaleDown(im, 480));
      return withImage(encodePNG(sideBySide(tiles)), `Проходы ${w}px (превью: color | normal | ${litImg ? 'lit' : 'emissive'}):\n${files.join('\n')}`);
    },
  },
  {
    name: 'normal_map_generate',
    description: `Сгенерировать карту нормалей (PNG, для 2D-освещения в Godot и других движках) и показать превью освещения.
target: "scene" — кадр сцены целиком; "nodes" — только узлы ids (с потомками, на прозрачном фоне); "image" — растровый файл (file) или растровый слой (id).
Векторный рельеф: каждая фигура — «подушка» с фаской. Настройки по умолчанию для всей сцены — scene.relief, для узла — props.relief {height 0..1, depth, bevel px, profile round|linear|sharp|flat, invert (вдавлено), luma}; relief:false — узел не участвует. Слои с blend и полупрозрачные не участвуют.
settings (все необязательны): strength (крутизна, ${NORMAL_DEFAULTS.strength}), blur (сглаживание высот, px, ${NORMAL_DEFAULTS.blur}), bevel (${NORMAL_DEFAULTS.bevel}), depth (${NORMAL_DEFAULTS.depth}), height (${NORMAL_DEFAULTS.height}), profile, detail (0..1 — мелкий рельеф из яркости цвета, ${NORMAL_DEFAULTS.detail}), detailRadius (${NORMAL_DEFAULTS.detailRadius}), luma (вклад яркости растровых слоёв), yUp (true — OpenGL/Godot, false — DirectX/Unity HDRP), invertX; для image: base, invertLuma, lumaBlur.
attach: true — записать путь в props.normalMap и props.normalSrc растрового слоя (для target image с id): отложенный свет 2.5D берёт рельеф из normalSrc (касательная карта, переводится в мировые нормали по трансформации узла).`,
    inputSchema: { type: 'object', properties: {
      target: { type: 'string', enum: ['scene', 'nodes', 'image'] }, ids: { type: 'array', items: STR }, id: STR, file: STR,
      t: NUM, width: NUM, out: STR, settings: OBJ, saveHeight: { type: 'boolean' }, preview: { type: 'boolean' },
      light: { type: 'object', properties: { x: NUM, y: NUM, z: NUM, ambient: NUM, intensity: NUM } }, attach: { type: 'boolean' },
    } },
    run: async (a) => {
      await requireRaster('для генерации нормалей');
      const target = a.target || (a.ids ? 'nodes' : a.file || a.id ? 'image' : 'scene');
      const settings = a.settings || {};
      let r, name;
      if (target === 'image') {
        let p;
        if (a.file) p = resolve(a.file);
        else {
          const n = nodeById(scene, a.id);
          if (!n || n.type !== 'image') throw new Error(`Растровый слой ${a.id} не найден`);
          p = resolveSrc(n.props.src, baseDir());
          if (!p) throw new Error('У слоя нет локального файла (src — URL или data:). Сохраните картинку в файл и укажите file.');
        }
        r = await imageNormalMap(readFileSync(p), IMAGE_MIME[extname(p).toLowerCase()] || 'image/png', settings);
        name = basename(p).replace(/\.[^.]+$/, '');
      } else {
        const S0 = S();
        r = await sceneNormalMap(S0, { t: a.t || 0, only: target === 'nodes' ? a.ids : undefined, width: a.width, settings });
        name = target === 'nodes' ? a.ids.join('+') : 'scene';
      }
      const out = resolve(a.out || resolve(baseDir(), 'normals', `${name}_n.png`));
      writeFileEnsured(out, encodePNG(r.normal));
      let extra = '';
      if (a.saveHeight) { const hp = out.replace(/(_n)?\.png$/i, '_h.png'); writeFileSync(hp, encodePNG(r.height)); extra += `\nКарта высот: ${hp}`; }
      if (a.attach && a.id) {
        const rel = toRel(baseDir())(out);
        mutate('карта нормалей', () => ops.updateNode(scene, a.id, { props: { normalMap: rel, normalSrc: rel, normalYUp: r.settings.yUp !== false } }));
        extra += `\nСлой ${a.id}: normalMap = ${rel} (и normalSrc — рельеф для отложенного света)`;
      }
      const content = [{ type: 'text', text: `Карта нормалей: ${out} (${r.normal.width}×${r.normal.height}, ${r.settings.yUp === false ? 'DirectX, Y вниз' : 'OpenGL/Godot, Y вверх'}).${extra}` }];
      if (a.preview !== false) {
        const lit = litPreview(r.color, r.normal, { ...(a.light || {}), yUp: r.settings.yUp !== false });
        const pv = sideBySide([scaleDown(r.normal, 640), scaleDown(lit, 640)]);
        content.unshift(image(encodePNG(pv)));
        content.push({ type: 'text', text: 'Слева — карта нормалей, справа — превью освещения точечным светом (light.x/y — доли кадра, z — высота).' });
      }
      return { content };
    },
  },
  {
    name: 'compat_check',
    description: 'Проверка совместимости сцены с целевой платформой: что потеряется при импорте SVG (свечение, размытие, тени, режимы наложения, растр-дизеринг, маски, текст, анимация, свет) и как это перенести. target "godot" (импорт SVG в Godot 4) или "unity" (пакет Vector Graphics). Export format "godot"/"unity" запекает эффекты в PNG-слои.',
    inputSchema: { type: 'object', properties: { target: { type: 'string', enum: ['godot', 'unity'] } } },
    run: ({ target = 'godot' }) => {
      const issues = compatReport(scene, target);
      const U = target === 'unity';
      if (!issues.length) return text(`Замечаний нет: сцена использует только то, что ${U ? 'Unity (Vector Graphics)' : 'Godot'} импортирует из SVG.`);
      return text(`Замечаний: ${issues.length}\n` + issues.map((i) => `• ${i.node}: ${i.feature} — ${i.effect}`).join('\n') + (U
        ? '\n\nРешение без ручной переделки: export format "unity" — слои с эффектами запекаются в PNG-спрайты, анимация — в клипы Animator, свет — в Light2D (URP), всё собрано в префаб.'
        : '\n\nРешение без ручной переделки: export format "godot" — слои с эффектами запекаются в PNG, анимация — в AnimatedSprite2D по клипам.'));
    },
  },
  {
    name: 'export',
    description: 'Экспорт: "lottie" — Lottie JSON (bodymovin) для веба и мобильных: кадры движка сэмплируются (fps, по умолчанию fps сцены до 60) в ключи трансформаций, форм, красок и обрезки обводки, лишние ключи отбрасываются (tolerance — допуск формы, 0.25); маркеры сцены → markers; текст, растр, маски, фильтры и наложения не переносятся (предупреждения). "html" — автономный плеер одним файлом; "svg" — кадр; "png" — кадр PNG (с lit "deferred" — с отложенным светом и стилем); "json" — сцена; "mp4"/"webm"/"gif" — видео (нужен ffmpeg и растеризатор); "godot" — папка-проект для Godot 4: статичные части запекаются в PNG-слои со всеми эффектами, анимированные — в AnimatedSprite2D, клипы сцены становятся анимациями (clips — какие экспортировать), fps (по умолчанию 12 или fps клипа), scale (масштаб текстур), normals (true или настройки — карты нормалей для 2D-света через CanvasTexture). "unity" — то же для Unity 6/2022+: path — папка внутри Assets проекта (например <проект>/Assets/Kontur/room); PNG-спрайты с .meta, клипы — AnimationClip + Animator Controller, всё собрано в префаб <title>.prefab (SortingGroup, KonturPlayer.Play/SetState); свет — Light2D (pipeline "urp", по умолчанию) или без света ("builtin"); режимы наложения — материал Kontur/Sprite Blend; ppu — пикселей сцены на единицу Unity (100), origin — "center" (по умолчанию) или "top-left". 2.5D-сцены (camera3d + surface): lit "deferred" — статичные слои запекаются со светом, тенями и стилем, источники света не выводятся (lights: true — всё равно вывести); без lit, с normals — живой свет движка: карты нормалей берутся из props.surface (проход normal), лампы с p3 ставятся в проекции камеры. clip — для видео/gif взять отрезок клипа.',
    inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['html', 'svg', 'json', 'png', 'mp4', 'webm', 'gif', 'godot', 'unity', 'lottie'] }, path: STR, tolerance: NUM, t: NUM, fps: NUM, width: NUM, start: NUM, end: NUM, clip: STR, title: STR, scale: NUM, normals: ANY, clips: { type: 'array', items: STR }, ppu: NUM, origin: { type: 'string', enum: ['center', 'top-left'] }, pipeline: { type: 'string', enum: ['urp', 'builtin'] }, lit: { type: 'string', enum: ['deferred'] }, lights: { type: 'boolean' } }, required: ['format', 'path'] },
    run: async ({ format, path, t = 0, fps, width, start, end, clip, title, scale, normals, clips, ppu, origin, pipeline, lit, lights, tolerance }) => {
      const engineExport = format === 'godot' || format === 'unity';
      if (clip && !engineExport) { const r = clipRange(scene, clip); start = r.start; end = r.end; }
      const p = resolve(path);
      mkdirSync(dirname(p), { recursive: true });
      if (engineExport) {
        await requireRaster(`для экспорта в ${format === 'unity' ? 'Unity' : 'Godot'}`);
        const r = format === 'unity'
          ? await exportUnity(S(), p, { fps, scale, normals, clips, title, ppu, origin, pipeline, log, lit, lights })
          : await exportGodot(S(), p, { fps, scale, normals, clips, title, log, lit, lights });
        return text(r.summary);
      }
      if (format === 'png') {
        await requireRaster('для PNG');
        writeFileSync(p, await renderPNG(S(), t, { width: width || scene.width, lit, baseDir: baseDir() }));
        return text(`Кадр${lit ? ' с отложенным светом' : ''}: ${p}`);
      }
      if (format === 'lottie') {
        const r = exportLottie(scene, { fps, tolerance, name: title });
        const js = JSON.stringify(r.lottie);
        writeFileSync(p, js);
        return text('Lottie: ' + p + ' (' + r.frames + ' кадров при ' + r.lottie.fr + ' fps, ' + (js.length / 1024).toFixed(0) + ' КБ)' + (r.warnings.length ? '\nНе перенесено: ' + r.warnings.join('; ') : ''));
      }
      if (format === 'html') writeFileSync(p, standaloneHTML(S(), { title }));
      else if (format === 'svg') writeFileSync(p, renderSVG(S(), t, { width }));
      else if (format === 'json') writeFileSync(p, JSON.stringify(scene, null, 1));
      else {
        const r = await exportVideo(S(), p, { fps, width, start, end, format, lit, baseDir: baseDir() });
        return text(`Видео: ${p} (${r.frames} кадров)`);
      }
      return text(`Сохранено: ${p}`);
    },
  },
];
