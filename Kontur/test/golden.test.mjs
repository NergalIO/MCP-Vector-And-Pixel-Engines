// Эталоны вывода SVG (test/golden.json) для модульного движка и для сборки одним файлом.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleEngine, engineNames } from '../mcp/bundle.mjs';
import { runNode } from './helpers/common.mjs';

const golden = fileURLToPath(new URL('golden.mjs', import.meta.url));

test('эталоны SVG: engine/kontur.js', () => {
  runNode(golden);
});

test('эталоны SVG: движок одним модулем (mcp/bundle.mjs)', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'kontur-b-')), 'kontur.mjs');
  writeFileSync(f, bundleEngine());
  runNode(golden, '--engine', f);
});

test('сборка одним модулем отдаёт тот же набор имён', async () => {
  const K = await import('../engine/kontur.js');
  const src = bundleEngine();
  const f = join(mkdtempSync(join(tmpdir(), 'kontur-b-')), 'kontur.mjs');
  writeFileSync(f, src);
  const B = await import(pathToFileURL(f).href);
  assert.deepEqual(Object.keys(B).sort(), Object.keys(K).sort());
  assert.deepEqual(engineNames().sort(), Object.keys(K).sort());
  assert.ok(!/^import /m.test(src), 'в сборке нет import');
  assert.ok(readFileSync(new URL('../engine/kontur.js', import.meta.url), 'utf8').length < 4000, 'engine/kontur.js — только реэкспорты');
  // переименованный импорт (invalidate as invalidateAll в svgimport.js) работает в сборке
  const scene = { width: 10, height: 10, duration: 1, nodes: [] };
  const r = B.insertSVG(scene, '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="2" height="2"/></svg>');
  assert.equal(scene.nodes.length, r.ids.length);
});
