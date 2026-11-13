#!/usr/bin/env node
/**
 * Проверка исходников без зависимостей: node scripts/lint.mjs [файлы и папки…] (без аргументов — весь проект).
 *  • синтаксис каждого .js/.mjs (node --check);
 *  • код, который грузит MCP-сервер (engine/, mcp/), не пишет в stdout: это канал JSON-RPC, лишняя строка ломает
 *    протокол у клиента (журнал — в stderr, функция log из mcp/log.mjs). Исключения: mcp/rpc.mjs (пишет сам
 *    протокол) и строки с пометкой `lint-allow-stdout` (CLI-ветки скриптов);
 *  • не осталось маркеров конфликта слияния.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { availableParallelism } from 'node:os';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['engine', 'mcp', 'player', 'scripts', 'test', 'examples'];
const SKIP = new Set(['node_modules', 'dist', 'out', 'lit-out']);
const STDOUT_DIRS = ['engine/', 'mcp/'];
const STDOUT_OK = new Set(['mcp/rpc.mjs']);
const STDOUT_RE = /\bconsole\.(?:log|info|debug|table|dir)\s*\(|\bprocess\.stdout\.write\s*\(/;
const CONFLICT_RE = /^(?:<{7} |>{7} |={7}$)/;

const rel = (f) => relative(ROOT, f).split(sep).join('/');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.m?js$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Синтаксис: null — порядок, иначе текст ошибки node --check. */
const syntax = (f) => new Promise((done) => {
  execFile(process.execPath, ['--check', f], { windowsHide: true }, (err, _out, stderr) => done(err ? String(stderr).trim() : null));
});

/** Правила по тексту файла: [{ line, msg }]. */
function textRules(f, src) {
  const r = rel(f), out = [];
  const stdoutRule = STDOUT_DIRS.some((d) => r.startsWith(d)) && !STDOUT_OK.has(r);
  src.split(/\r?\n/).forEach((line, i) => {
    if (CONFLICT_RE.test(line)) out.push({ line: i + 1, msg: 'маркер конфликта слияния' });
    if (!stdoutRule || line.includes('lint-allow-stdout')) return;
    const code = line.trimStart();
    if (code.startsWith('//') || code.startsWith('*')) return;
    if (STDOUT_RE.test(line)) out.push({ line: i + 1, msg: 'запись в stdout в коде MCP-сервера (stdout — канал JSON-RPC; журнал — в stderr)' });
  });
  return out;
}

async function mapLimit(list, limit, fn) {
  const res = new Array(list.length);
  let next = 0;
  const worker = async () => { while (next < list.length) { const i = next++; res[i] = await fn(list[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return res;
}

const args = process.argv.slice(2);
const files = args.length ? args.flatMap((a) => (statSync(a).isDirectory() ? walk(resolve(a)) : [resolve(a)])) : DIRS.flatMap((d) => walk(join(ROOT, d)));
const t0 = Date.now();
const errors = await mapLimit(files, Math.max(2, availableParallelism()), syntax);
const problems = [];
files.forEach((f, i) => {
  if (errors[i]) problems.push(`${rel(f)}: синтаксис\n    ${errors[i].split('\n').slice(0, 6).join('\n    ')}`);
  for (const p of textRules(f, readFileSync(f, 'utf8'))) problems.push(`${rel(f)}:${p.line}: ${p.msg}`);
});

const took = ((Date.now() - t0) / 1000).toFixed(1);
if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n✗ замечаний: ${problems.length} (файлов: ${files.length}, ${took} с)`);
  process.exit(1);
}
console.log(`✓ lint: файлов ${files.length}, замечаний нет (${took} с)`);
