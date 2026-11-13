// @ts-check
// Журнал сервера — только в stderr: stdout занят протоколом MCP (JSON-RPC), любая строка там ломает клиента.

/** Строка в журнал сервера (stderr) с префиксом [kontur]. */
export const log = (...a) => process.stderr.write('[kontur] ' + a.join(' ') + '\n');
