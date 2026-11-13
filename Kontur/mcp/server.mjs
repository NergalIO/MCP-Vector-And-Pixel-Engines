#!/usr/bin/env node
// @ts-check
/**
 * Kontur MCP-сервер (stdio, JSON-RPC 2.0, без зависимостей)
 * + встроенный HTTP-сервер живого превью (SSE): каждое изменение сцены сразу видно в браузере.
 *
 * Части: session.mjs — сцена, история, запись (класс Session); tools/index.mjs — реестр инструментов
 * (группы в tools/*.mjs получают сессию); http.mjs — превью и студия; rpc.mjs — протокол.
 *
 * Переменные окружения:
 *   KONTUR_SCENE  — путь к файлу сцены (по умолчанию ./kontur-scene.json, автосохранение; или --scene F)
 *   KONTUR_PORT   — порт превью (по умолчанию 7788; 0 — отключить; или --port N)
 *   KONTUR_HOST   — адрес превью (по умолчанию 127.0.0.1)
 *   KONTUR_TOKEN  — токен API превью (по умолчанию случайный; студия получает его cookie)
 *   KONTUR_SAVE_DELAY — задержка автосохранения после правки, мс (по умолчанию 300; 0 — на каждой правке)
 *   KONTUR_TRUST_EXPR=1 — разрешить модификатору expr полный JavaScript (иначе — безопасное подмножество;
 *                       в студии JS включается только кнопкой «Доверять» для кода открытой сцены)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { probeRaster, capabilities } from './render.mjs';
import { ROOT } from './paths.mjs';
import { log } from './log.mjs';
import { Session } from './session.mjs';
import { startPreview } from './http.mjs';
import { createHandler, serveStdio } from './rpc.mjs';
import { createTools } from './tools/index.mjs';

const argv = process.argv.slice(2);
const argVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const previewOnly = argv.includes('--preview');

const session = new Session({ scenePath: argVal('--scene') || process.env.KONTUR_SCENE || 'kontur-scene.json' });
session.initialLoad();

const resources = [
  { uri: 'kontur://docs/reference', name: 'Справочник Kontur', mimeType: 'text/markdown', read: () => readFileSync(resolve(ROOT, 'docs/REFERENCE.md'), 'utf8') },
  { uri: 'kontur://scene/current', name: 'Текущая сцена (JSON)', mimeType: 'application/json', read: () => JSON.stringify(session.scene, null, 1) },
];
const handle = createHandler({
  tools: createTools(session), resources,
  instructions: 'Kontur — движок векторной анимации. Начните с scene_info и docs. Стройте сцену node_add/nodes_add_batch, анимируйте keys_set/animate/preset_apply, добавляйте процедурное движение mod_add. Проверяйте результат render_contact_sheet и render_frame. Пользователь видит изменения вживую по preview_url. Относительные пути в аргументах (export, out, scene_open, image_add…) считаются от папки сцены. Подробное описание инструмента — docs { tool: имя }.',
});

const port = Number(argVal('--port') ?? process.env.KONTUR_PORT ?? 7788);
if (!(port === 0 && process.env.KONTUR_PORT === '0')) startPreview({ session, port, host: process.env.KONTUR_HOST || '127.0.0.1', keepAlive: previewOnly });
probeRaster().then((n) => log(n ? `растеризатор: ${n}` : `растеризатор не найден: ${capabilities.pngError}`));
// выход: несохранённые правки записываются в обработчике exit (session.mjs); сигналы сначала выходят штатно
serveStdio(handle, { onClose: () => { if (!previewOnly) { session.close(); process.exit(0); } } });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(128 + (sig === 'SIGINT' ? 2 : sig === 'SIGTERM' ? 15 : 1)));
if (previewOnly) log('режим только превью: Ctrl+C для выхода');
