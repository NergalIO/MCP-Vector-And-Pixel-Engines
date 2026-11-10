// Дочерний MCP-сервер для сквозных тестов: mcp/server.mjs по stdio, JSON-RPC построчно.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../../mcp/server.mjs', import.meta.url));

/**
 * Поднять сервер. env — добавка к process.env (сцена, порт, токен);
 * failOnExit — ненулевой код выхода сервера валит тест сразу (с хвостом stderr).
 * rpc(method, params) → ответ целиком; call(name, args) → result, isError/ошибка — исключение;
 * notify(method, params) — уведомление без id; txt(result) — первый текстовый блок.
 */
export function startServer({ env = {}, failOnExit = true } = {}) {
  const srv = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', id = 0, err = '';
  const pending = new Map();
  srv.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      pending.get(m.id)?.(m); pending.delete(m.id);
    }
  });
  srv.stderr.on('data', (d) => (err += d));
  if (failOnExit) srv.on('exit', (c) => { if (c) { console.error('сервер упал:', c, err.slice(-2000)); process.exit(1); } });
  const send = (m) => srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  const rpc = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); send({ id: i, method, params }); });
  const notify = (method, params) => send(params === undefined ? { method } : { method, params });
  const call = async (name, args = {}) => {
    const r = await rpc('tools/call', { name, arguments: args });
    if (r.error || r.result.isError) throw new Error(`${name}: ${JSON.stringify(r.error || r.result.content[0].text)}`);
    return r.result;
  };
  return { srv, rpc, notify, call, txt, stderr: () => err };
}

/** Первый текстовый блок ответа инструмента. */
export const txt = (r) => r.content.find((c) => c.type === 'text')?.text || '';

let passed = 0;
/** Проверка сквозного теста: провал — исключение, успех — строка «✓ msg» и счёт. */
export const check = (cond, msg) => { if (!cond) throw new Error('ПРОВАЛ: ' + msg); passed++; console.log('✓', msg); };
/** Сколько проверок пройдено. */
export const checks = () => passed;
