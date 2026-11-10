// Эталоны вывода SVG (test/golden.json) для модульного движка и для сборки одним файлом.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bundleEngine } from '../mcp/bundle.mjs';

const golden = fileURLToPath(new URL('golden.mjs', import.meta.url));

test('эталоны SVG: engine/kontur.js', () => {
  execFileSync(process.execPath, [golden], { stdio: 'pipe' });
});

test('эталоны SVG: движок одним модулем (mcp/bundle.mjs)', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'kontur-b-')), 'kontur.mjs');
  writeFileSync(f, bundleEngine());
  execFileSync(process.execPath, [golden, '--engine', f], { stdio: 'pipe' });
});

test('сборка одним модулем отдаёт тот же набор имён', async () => {
  const K = await import('../engine/kontur.js');
  const src = bundleEngine();
  const names = src.match(/export \{([^}]*)\};\s*$/)[1].split(',').map((s) => s.trim()).sort();
  assert.deepEqual(names, Object.keys(K).sort());
  assert.ok(!/^import /m.test(src), 'в сборке нет import');
  assert.ok(readFileSync(new URL('../engine/kontur.js', import.meta.url), 'utf8').length < 4000, 'engine/kontur.js — только реэкспорты');
});
