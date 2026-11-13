// Редактор без браузера: модули player/ed/*.js разбираются, импорты между ними сходятся с экспортами (это проверяет
// сборщик mcp/bundle.mjs), автономная страница (build-artifact) собирается, код в ней разбирается как модули.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundle } from '../mcp/bundle.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const ed = join(root, 'player', 'ed');
const files = readdirSync(ed).filter((f) => f.endsWith('.js')).sort();
/** Ошибка node --check (первые строки) или null. */
const syntaxError = (f) => {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); return null; } catch (e) { return String(e.stderr).split('\n').slice(0, 5).join(' '); }
};

test('модули редактора разбираются (node --check)', () => {
  assert.ok(files.length >= 12, `модулей редактора: ${files.length}`);
  assert.deepEqual(files.map((f) => [f, syntaxError(join(ed, f))]).filter(([, e]) => e), []);
});

test('импорты между модулями сходятся с экспортами, все модули подключены к app.js', () => {
  const r = bundle(pathToFileURL(join(ed, 'app.js')), { format: 'none' }); // несходящееся имя — исключение сборщика
  assert.deepEqual(files.filter((f) => !r.modules.includes(f)), [], 'модули, которые app.js не подключает');
});

test('автономная страница: собирается, оба модуля в ней разбираются', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'kontur-ed-'));
  const out = join(tmp, 'studio.html');
  execFileSync(process.execPath, [join(root, 'scripts', 'build-artifact.mjs'), out], { stdio: 'pipe' });
  const html = readFileSync(out, 'utf8');
  const mods = [...html.matchAll(/<script type="module">\n([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(mods.length, 2, 'в странице два модуля: движок и редактор');
  mods.forEach((code, i) => {
    const f = join(tmp, `m${i}.mjs`);
    writeFileSync(f, code);
    assert.equal(syntaxError(f), null, `модуль ${i} в странице`);
  });
  const [engine, editor] = mods;
  assert.match(engine, /^window\.Kontur = __m_kontur;$/m, 'движок кладёт API в window.Kontur');
  // несколько имён в одной строке export const a = …, b = … — все попадают в объект модуля
  for (const n of ['canUndo', 'canRedo', 'canvasBox', 'ovSvg']) assert.match(editor, new RegExp(`return \\{[^}]*\\b${n}\\b`), `сборка отдаёт ${n}`);
  assert.ok(html.includes('window.KONTUR_EXAMPLES'), 'примеры встроены');
});
