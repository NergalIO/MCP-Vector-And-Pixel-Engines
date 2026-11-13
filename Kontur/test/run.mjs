// Запуск всех тестов по очереди: node test/run.mjs [фильтр]
// Каждый test/*.test.mjs идёт через встроенный node:test (отдельный процесс), по одному:
// сквозные тесты поднимают свои серверы превью.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dir = fileURLToPath(new URL('.', import.meta.url));
const filter = process.argv[2];
const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs') && (!filter || f.includes(filter))).sort();
const failed = [];
const t0 = Date.now();
for (const f of files) {
  const t = Date.now();
  const r = spawnSync(process.execPath, ['--test', join(dir, f)], { stdio: 'inherit' });
  console.log(`${r.status === 0 ? '✓' : '✗'} ${f} (${((Date.now() - t) / 1000).toFixed(1)} с)\n`);
  if (r.status !== 0) failed.push(f);
}
console.log(failed.length ? `✗ провалены: ${failed.join(', ')}` : `✓ все наборы прошли: ${files.length} (${((Date.now() - t0) / 1000).toFixed(1)} с)`);
process.exit(failed.length ? 1 : 0);
