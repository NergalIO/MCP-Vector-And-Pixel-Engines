// Сборщик модулей (mcp/bundle.mjs): свои области видимости, циклы, переименования, ошибки неподдержанных форм.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundle } from '../mcp/bundle.mjs';

/** Пишет файлы во временную папку и собирает от main.js. */
function build(files, opts) {
  const dir = mkdtempSync(join(tmpdir(), 'kontur-bundle-'));
  for (const [name, src] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), src);
  }
  const out = bundle(join(dir, 'main.js'), opts);
  const file = join(dir, 'out.mjs');
  writeFileSync(file, out.code);
  return { ...out, load: () => import(pathToFileURL(file).href) };
}

test('у каждого модуля своя область: одинаковые имена верхнего уровня не мешают', async () => {
  const r = build({
    'main.js': "import { a } from './x.js';\nimport { a as b } from './lib/y.js';\nconst tmp = 'main';\nexport const both = a() + b() + tmp;\n",
    'x.js': "const tmp = 'x';\nexport function a() { return tmp; }\n",
    'lib/y.js': "const tmp = 'y';\nexport const a = () => tmp;\n",
  });
  assert.deepEqual(r.names, ['both']);
  assert.deepEqual(r.modules, ['x.js', 'lib/y.js', 'main.js']);
  assert.equal((await r.load()).both, 'xymain');
});

test('цикл импортов — одна общая обёртка, порядок выполнения как в ESM', async () => {
  const r = build({
    'main.js': "import { ping } from './p.js';\nexport { ping } from './p.js';\nexport const out = ping(3);\n",
    'p.js': "import { pong } from './q.js';\nexport const P = 'p';\nexport function ping(n) { return n ? pong(n - 1) : P; }\n",
    'q.js': "import {\n  ping,\n  P,\n} from './p.js';\nexport function pong(n) { return n ? ping(n - 1) : 'q' + P; }\n",
  });
  assert.match(r.code, /const \[__m_q, __m_p\] = /);
  const m = await r.load();
  assert.equal(m.out, 'qp');
  assert.equal(m.ping(2), 'p');
});

test('await верхнего уровня — асинхронная обёртка; sync: true его запрещает', async () => {
  const files = { 'main.js': "import { v } from './w.js';\nexport const twice = v * 2;\n", 'w.js': 'export const v = await Promise.resolve(21);\n' };
  const r = build(files);
  assert.match(r.code, /const __m_w = await \(async \(\) => \{/);
  assert.equal((await r.load()).twice, 42);
  assert.throws(() => build(files, { sync: true }), /await верхнего уровня/);
});

test('формат global и заголовок /*! */ входного файла', () => {
  const r = build({ 'main.js': '/*! lib v1 */\nexport function f() { return 1; }\n' }, { format: 'global', globalName: 'Lib' });
  assert.ok(r.code.startsWith('/*! lib v1 */\n'));
  assert.equal(r.code.split('/*! lib v1 */').length, 2, 'заголовок один раз');
  assert.match(r.code, /window\.Lib = __m_main;\n$/);
});

test('ошибки: неподдержанные формы и несходящиеся имена', () => {
  const bad = (files, re) => assert.throws(() => build(files), re);
  bad({ 'main.js': 'export let x = 1;\n' }, /main\.js: строка 1: export let не поддержан/);
  bad({ 'main.js': 'export default 1;\n' }, /неподдержанная форма export/);
  bad({ 'main.js': "import x from './x.js';\n", 'x.js': '' }, /неподдержанная форма import/);
  bad({ 'main.js': "import * as x from './x.js';\n", 'x.js': '' }, /неподдержанная форма import/);
  bad({ 'main.js': "import { nope } from './x.js';\n", 'x.js': 'export const yes = 1;\n' }, /main\.js: nope не экспортируется из x\.js/);
  bad({ 'main.js': "import { a } from 'pkg';\n" }, /только относительные пути/);
  bad({ 'main.js': "import { a } from './missing.js';\n" }, /missing\.js: не читается/);
  bad({ 'main.js': 'const a = 1, b = 2;\nexport { a, b };\n' }, /неподдержанная форма export/);
  // в цикле имена верхнего уровня общие
  bad({
    'main.js': "import { f } from './a.js';\nexport const r = f();\n",
    'a.js': "import { g } from './b.js';\nconst tmp = 1;\nexport function f() { return g() + tmp; }\n",
    'b.js': "import { f } from './a.js';\nconst tmp = 2;\nexport function g() { return tmp; }\n",
  }, /цикл .*имя tmp объявлено и в/);
  bad({
    'main.js': "import { f } from './a.js';\nexport const r = f();\n",
    'a.js': "import { g as h } from './b.js';\nexport function f() { return h(); }\n",
    'b.js': "import { f } from './a.js';\nexport function g() { return 1; }\n",
  }, /переименование g as h внутри цикла/);
});

test('динамический import() и import.meta остаются как есть', () => {
  const r = build({ 'main.js': "export const K = globalThis.K || import('./late.js');\nexport const u = import.meta.url;\n" });
  assert.match(r.code, /import\('\.\/late\.js'\)/);
  assert.match(r.code, /import\.meta\.url/);
});
