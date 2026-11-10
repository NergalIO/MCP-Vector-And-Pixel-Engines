#!/usr/bin/env node
/**
 * Kontur MCP-сервер (stdio, JSON-RPC 2.0, без зависимостей)
 * + встроенный HTTP-сервер живого превью (SSE): каждое изменение сцены сразу видно в браузере.
 *
 * Части: store.mjs — сцена, история, запись; http.mjs — превью и студия; rpc.mjs — протокол;
 * tools/*.mjs — инструменты по группам.
 *
 * Переменные окружения:
 *   KONTUR_SCENE  — путь к файлу сцены (по умолчанию ./kontur-scene.json, автосохранение; или --scene F)
 *   KONTUR_PORT   — порт превью (по умолчанию 7788; 0 — отключить; или --port N)
 *   KONTUR_HOST   — адрес превью (по умолчанию 127.0.0.1)
 *   KONTUR_TOKEN  — токен API превью (по умолчанию случайный; студия получает его cookie)
 *   KONTUR_TRUST_EXPR=1 — разрешить модификатору expr полный JavaScript (иначе — безопасное подмножество)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { probeRaster, capabilities } from './render.mjs';
import { ROOT, log, scene, initialLoad, stopWatch } from './store.mjs';
import { startPreview } from './http.mjs';
import { createHandler, serveStdio } from './rpc.mjs';
import { tools as sceneTools } from './tools/scene.mjs';
import { tools as nodeTools } from './tools/nodes.mjs';
import { tools as worldTools } from './tools/world.mjs';
import { tools as outputTools } from './tools/output.mjs';

const argv = process.argv.slice(2);
const argVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const previewOnly = argv.includes('--preview');

initialLoad(argVal('--scene') || process.env.KONTUR_SCENE || 'kontur-scene.json');

export const tools = [...sceneTools, ...nodeTools, ...worldTools, ...outputTools];
const resources = [
  { uri: 'kontur://docs/reference', name: 'Справочник Kontur', mimeType: 'text/markdown', read: () => readFileSync(resolve(ROOT, 'docs/REFERENCE.md'), 'utf8') },
  { uri: 'kontur://scene/current', name: 'Текущая сцена (JSON)', mimeType: 'application/json', read: () => JSON.stringify(scene, null, 1) },
];
const handle = createHandler({
  tools, resources,
  instructions: 'Kontur — движок векторной анимации. Начните с scene_info и docs. Стройте сцену node_add/nodes_add_batch, анимируйте keys_set/animate/preset_apply, добавляйте процедурное движение mod_add. Проверяйте результат render_contact_sheet и render_frame. Пользователь видит изменения вживую по preview_url.',
});

const port = Number(argVal('--port') ?? process.env.KONTUR_PORT ?? 7788);
if (!(port === 0 && process.env.KONTUR_PORT === '0')) startPreview({ port, host: process.env.KONTUR_HOST || '127.0.0.1', keepAlive: previewOnly });
probeRaster().then((n) => log(n ? `растеризатор: ${n}` : `растеризатор не найден: ${capabilities.pngError}`));
serveStdio(handle, { onClose: () => { if (!previewOnly) { stopWatch(); process.exit(0); } } });
if (previewOnly) log('режим только превью: Ctrl+C для выхода');
