// @ts-check
// Реестр инструментов MCP. Группа инструментов — функция от сессии (tools(session) → массив), так что инструменты
// работают с той сценой, которую им дали, а не с общей переменной модуля. Здесь группы собираются, а описания
// проверяются при запуске: опечатка в схеме (required без свойства, тип не объект) — ошибка сразу, а не у агента.
// Общие для всех вызовов проверки — в rpc.mjs: аргументы по inputSchema, очередь для heavy, ошибки — в ответ.
import { tools as sceneTools } from './scene.mjs';
import { tools as nodeTools } from './nodes.mjs';
import { tools as worldTools } from './world.mjs';
import { tools as outputTools } from './output.mjs';

/**
 * Прогресс долгого вызова: done растёт, total — если известен, message — что сейчас делается.
 * @typedef {(done: number, total?: number, message?: string) => void} Progress
 */
/**
 * Контекст вызова (второй аргумент run): signal — отмена клиентом (долгие циклы проверяют его между шагами),
 * progress — отчёт клиенту (без progressToken ничего не отправляет).
 * @typedef {{ signal: AbortSignal, progress: Progress }} ToolContext
 */
/**
 * @typedef {object} Tool
 * @property {string} name имя (латиница в нижнем регистре и _)
 * @property {string} description описание для агента: коротко (до DESC_MAX знаков), подробности — в help
 * @property {string} [help] полное описание: отдаёт docs { tool: имя }
 * @property {{ type: 'object', properties?: Record<string, any>, required?: string[] }} inputSchema схема аргументов (JSON Schema)
 * @property {(args: any, ctx: ToolContext) => any} run выполнение: результат MCP ({ content: [...] }) или промис с ним
 * @property {boolean} [heavy] тяжёлый рендер — через общую очередь (queue.mjs)
 */

/** Предел длины description: tools/list читается агентом целиком при каждом подключении. */
export const DESC_MAX = 600;

/** Группы инструментов по разделам. Вторым аргументом группа получает { byName } — поиск по всем инструментам (для docs). */
export const GROUPS = { scene: sceneTools, nodes: nodeTools, world: worldTools, output: outputTools };

/**
 * Все инструменты для сессии. Ошибки в описаниях — исключение.
 * @param {import('../session.mjs').Session} session
 * @returns {Tool[]}
 */
export function createTools(session) {
  // группы описаны литералами (у каждой свои выведенные типы) — форму проверяет checkTools при запуске
  /** @type {Tool[]} */
  let tools = [];
  const byName = (/** @type {string} */ name) => tools.find((t) => t.name === name);
  tools = /** @type {Tool[]} */ (Object.values(GROUPS).flatMap((group) => /** @type {any[]} */ (group(session, { byName }))));
  const errs = checkTools(tools);
  if (errs.length) throw new Error('инструменты MCP объявлены с ошибками:\n' + errs.join('\n'));
  return tools;
}

/**
 * Ошибки в описаниях инструментов (пустой массив — всё верно).
 * @param {any[]} tools
 * @returns {string[]}
 */
export function checkTools(tools) {
  const errs = [], seen = new Set();
  for (const t of tools) {
    const name = t?.name;
    const at = `инструмент ${name ?? '?'}`;
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(name)) errs.push(`${at}: имя — латиница в нижнем регистре, цифры и _`);
    if (seen.has(name)) errs.push(`${at}: объявлен дважды`);
    seen.add(name);
    if (typeof t.description !== 'string' || !t.description.trim()) errs.push(`${at}: нет описания`);
    else if (t.description.length > DESC_MAX) errs.push(`${at}: описание длиннее ${DESC_MAX} знаков (${t.description.length}) — подробности перенесите в help`);
    if (t.help !== undefined && (typeof t.help !== 'string' || !t.help.trim())) errs.push(`${at}: help — непустая строка`);
    if (typeof t.run !== 'function') errs.push(`${at}: нет run`);
    if (t.heavy !== undefined && typeof t.heavy !== 'boolean') errs.push(`${at}: heavy — true или false`);
    const s = t.inputSchema;
    if (!s || s.type !== 'object') { errs.push(`${at}: inputSchema.type должен быть "object"`); continue; }
    const props = s.properties ?? {};
    if (typeof props !== 'object' || Array.isArray(props)) { errs.push(`${at}: inputSchema.properties — объект`); continue; }
    for (const r of s.required ?? []) if (!(r in props)) errs.push(`${at}: обязательный аргумент ${r} не описан в properties`);
    for (const [k, p] of Object.entries(props)) if (!p || typeof p !== 'object' || Array.isArray(p)) errs.push(`${at}: схема аргумента ${k} — объект`);
  }
  return errs;
}
