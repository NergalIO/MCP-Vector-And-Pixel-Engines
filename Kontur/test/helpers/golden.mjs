// Общее для эталонов-хешей (test/golden.mjs, test/world-golden.mjs): хеш, запись и сверка.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** Короткий SHA-256 строки (20 hex). */
export const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 20);

/**
 * Записать эталоны (--update или нет файла) или сверить с ними; при отличиях — выход с кодом 1.
 * ignoreMissing — ключи эталона, которых нет в текущем прогоне, пропускаются (иначе любой лишний/пропавший ключ — отличие);
 * exitOk — после успешной сверки выйти с кодом 0 явно. t0 — начало замера времени.
 * written(n, sec) и report({ bad, missing, n, sec }) печатают итог; n — число сверенных ключей, sec — секунды строкой.
 */
export function runGolden(file, cur, { ignoreMissing = false, exitOk = false, update = process.argv.includes('--update'), t0 = performance.now(), written, report }) {
  const sec = () => ((performance.now() - t0) / 1000).toFixed(1);
  if (update || !existsSync(file)) {
    writeFileSync(file, JSON.stringify(cur, null, 1) + '\n');
    written(Object.keys(cur).length, sec());
    return;
  }
  const ref = JSON.parse(readFileSync(file, 'utf8'));
  const keys = ignoreMissing ? Object.keys(ref).filter((k) => k in cur) : [...new Set([...Object.keys(ref), ...Object.keys(cur)])];
  const bad = keys.filter((k) => ref[k] !== cur[k]);
  const missing = ignoreMissing ? Object.keys(ref).filter((k) => !(k in cur)) : [];
  report({ bad, missing, n: keys.filter((k) => k in ref && k in cur).length, sec: sec() });
  if (bad.length) process.exit(1);
  if (exitOk) process.exit(0);
}
