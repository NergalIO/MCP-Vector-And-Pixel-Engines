// @ts-check
// JSON-RPC 2.0 поверх stdio (протокол MCP): initialize, tools/*, resources/*. Без зависимостей.
// Вызовы инструментов идут строго по очереди (правки сцены не перемешиваются). Отмена (notifications/cancelled)
// и ping обрабатываются сразу, вне очереди: отменённый вызов останавливается (инструмент видит ctx.signal) или,
// если ещё не начат, пропускается — ответа на него нет, как требует протокол. Прогресс (notifications/progress)
// уходит, если клиент передал _meta.progressToken.
import { createInterface } from 'node:readline';
import { VERSION } from '../engine/kontur.js';
import { log } from './log.mjs';
import { checkArgs } from './schema_check.mjs';
import { renderQueue } from './queue.mjs';

export const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
/** @typedef {(m: Record<string, any>) => void} Write отправка сообщения клиенту (без поля jsonrpc) */
/** @type {Write} */
const send = (m) => { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n'); };
const replier = (/** @type {Write} */ write) => ({
  reply: (id, result) => write({ id, result }),
  fail: (id, code, message) => write({ id, error: { code, message } }),
});
const errorResult = (msg) => ({ content: [{ type: 'text', text: `Ошибка: ${msg}` }], isError: true });
/** Сообщения, которые обрабатываются сразу, а не после идущего вызова. */
const OUT_OF_BAND = new Set(['notifications/cancelled', 'ping']);

/**
 * Отправка прогресса по токену клиента: значение только растёт (иначе пропускается), не чаще раза в 100 мс,
 * кроме последнего шага. Без токена — пустая функция.
 * @param {string | number | undefined} token
 * @param {Write} [write]
 * @returns {import('./tools/index.mjs').Progress}
 */
export function progressReporter(token, write = send) {
  if (token === undefined || token === null) return () => {};
  let last = -Infinity, at = 0;
  return (done, total, message) => {
    const now = Date.now();
    if (!(done > last) || (now - at < 100 && !(total && done >= total))) return;
    last = done; at = now;
    write({ method: 'notifications/progress', params: { progressToken: token, progress: done, ...(total ? { total } : {}), ...(message ? { message } : {}) } });
  };
}

/**
 * Обработчик сообщений для набора инструментов и ресурсов. handle.abortAll() — отменить идущие вызовы
 * (клиент отключился). write — куда отправлять ответы (по умолчанию stdout).
 * @param {{ tools: import('./tools/index.mjs').Tool[], resources?: { uri: string, name: string, mimeType: string, read: () => string }[], instructions?: string, write?: Write }} opts
 */
export function createHandler({ tools, resources = [], instructions, write = send }) {
  const { reply, fail } = replier(write);
  const toolMap = new Map();
  for (const t of tools) { if (toolMap.has(t.name)) throw new Error(`инструмент ${t.name} объявлен дважды`); toolMap.set(t.name, t); }
  /** Идущие вызовы: id запроса → AbortController. */
  const running = new Map();
  /** Отменённые до начала: очередь сообщений до них ещё не дошла (не больше 256 последних). */
  const cancelledEarly = new Set();

  async function callTool(id, params) {
    const tool = toolMap.get(params.name);
    if (!tool) return fail(id, -32602, `Неизвестный инструмент ${params.name}`);
    const args = params.arguments ?? {};
    // аргументы — по схеме инструмента до вызова: ошибка уходит агенту как результат, чтобы он исправил вызов
    const bad = checkArgs(tool.inputSchema, args);
    if (bad.length) return reply(id, errorResult(`неверные аргументы ${tool.name}:\n${bad.join('\n')}`));
    const ctl = new AbortController();
    running.set(id, ctl);
    const progress = progressReporter(params._meta?.progressToken, write);
    const ctx = { signal: ctl.signal, progress };
    try {
      let result;
      if (tool.heavy) {
        // тяжёлые рендеры — через общую очередь с превью студии: не считаются одновременно
        const q = renderQueue.stats();
        if (q.active || q.waiting) progress(0, undefined, `ждёт очереди рендеров (впереди ${q.active + q.waiting})`);
        result = await renderQueue.run(() => tool.run(args, ctx), { signal: ctl.signal });
      } else result = await tool.run(args, ctx);
      if (!ctl.signal.aborted) reply(id, result);
    } catch (e) {
      if (!ctl.signal.aborted) reply(id, errorResult(e.message));
    } finally {
      running.delete(id);
      if (ctl.signal.aborted) log(`вызов ${tool.name} отменён клиентом`);
    }
  }

  async function handle(msg) {
    const { id, method, params = {} } = msg;
    const isReq = id !== undefined && id !== null;
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED[0],
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
          serverInfo: { name: 'kontur', title: 'Kontur — векторная анимация', version: VERSION },
          instructions,
        });
      case 'notifications/initialized': return;
      case 'notifications/cancelled': {
        const rid = params.requestId;
        const ctl = running.get(rid);
        if (ctl) ctl.abort(Object.assign(new Error(params.reason || 'отменено клиентом'), { name: 'AbortError' }));
        else if (rid !== undefined && rid !== null) {
          cancelledEarly.add(rid);
          if (cancelledEarly.size > 256) cancelledEarly.delete(cancelledEarly.values().next().value);
        }
        return;
      }
      case 'ping': return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case 'tools/call':
        if (cancelledEarly.delete(id)) return; // отменён, пока ждал своей очереди: ответа не будет
        return callTool(id, params);
      case 'resources/list':
        return reply(id, { resources: resources.map(({ uri, name, mimeType }) => ({ uri, name, mimeType })) });
      case 'resources/read': {
        const r = resources.find((x) => x.uri === params.uri);
        if (!r) return fail(id, -32602, `Нет ресурса ${params.uri}`);
        return reply(id, { contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.read() }] });
      }
      case 'prompts/list': return reply(id, { prompts: [] });
      default:
        if (isReq) fail(id, -32601, `Метод не поддерживается: ${method}`);
    }
  }
  /** Отменить все идущие вызовы (клиент закрыл соединение — результат никто не ждёт). */
  handle.abortAll = () => { for (const ctl of running.values()) ctl.abort(Object.assign(new Error('клиент отключился'), { name: 'AbortError' })); };
  return handle;
}

/**
 * Читать stdin построчно; сообщения обрабатываются строго по очереди, кроме отмены и ping (сразу).
 * При закрытии stdin идущие вызовы отменяются; onClose — после последнего ответа. input/write — для тестов.
 * @param {((msg: any) => any) & { abortAll?: () => void }} handle
 * @param {{ onClose?: () => void, input?: NodeJS.ReadableStream, write?: Write }} [opts]
 */
export function serveStdio(handle, { onClose, input = process.stdin, write = send } = {}) {
  const { fail } = replier(write);
  const rl = createInterface({ input });
  let queue = Promise.resolve();
  const onError = (m) => (e) => { log('ошибка:', e.stack); if (m.id != null) fail(m.id, -32603, e.message); };
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'Parse error'); }
    for (const m of Array.isArray(msg) ? msg : [msg]) {
      if (OUT_OF_BAND.has(m?.method)) Promise.resolve().then(() => handle(m)).catch(onError(m));
      else queue = queue.then(() => handle(m)).catch(onError(m));
    }
  });
  rl.on('close', () => { handle.abortAll?.(); queue.then(() => onClose?.()); });
}
