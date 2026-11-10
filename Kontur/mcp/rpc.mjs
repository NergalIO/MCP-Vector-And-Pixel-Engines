// JSON-RPC 2.0 поверх stdio (протокол MCP): initialize, tools/*, resources/*. Без зависимостей.
import { createInterface } from 'node:readline';
import { VERSION } from '../engine/kontur.js';
import { log } from './store.mjs';

export const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
const fail = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');

/** Обработчик сообщений для набора инструментов и ресурсов. */
export function createHandler({ tools, resources = [], instructions }) {
  const toolMap = new Map();
  for (const t of tools) { if (toolMap.has(t.name)) throw new Error(`инструмент ${t.name} объявлен дважды`); toolMap.set(t.name, t); }
  return async function handle(msg) {
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
      case 'notifications/initialized': case 'notifications/cancelled': return;
      case 'ping': return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case 'tools/call': {
        const tool = toolMap.get(params.name);
        if (!tool) return fail(id, -32602, `Неизвестный инструмент ${params.name}`);
        try { return reply(id, await tool.run(params.arguments || {})); }
        catch (e) { return reply(id, { content: [{ type: 'text', text: `Ошибка: ${e.message}` }], isError: true }); }
      }
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
  };
}

/** Читать stdin построчно; сообщения обрабатываются строго по очереди. onClose — после последнего ответа. */
export function serveStdio(handle, { onClose } = {}) {
  const rl = createInterface({ input: process.stdin });
  let queue = Promise.resolve();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'Parse error'); }
    for (const m of Array.isArray(msg) ? msg : [msg]) queue = queue.then(() => handle(m)).catch((e) => { log('ошибка:', e.stack); if (m.id != null) fail(m.id, -32603, e.message); });
  });
  rl.on('close', () => queue.then(() => onClose?.()));
}
