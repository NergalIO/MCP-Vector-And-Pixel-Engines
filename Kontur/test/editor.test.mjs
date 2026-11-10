// Проверка редактора без браузера: импорты между модулями player/ed/*.js сходятся с экспортами,
// автономная сборка (build-artifact) собирается и разбирается как JS-модуль.
// node test/editor.test.mjs
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ed = join(root, 'player', 'ed');
let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; console.log('✓ ' + msg); } else { fails++; console.log('✗ ' + msg); } };

// 1. Экспорты каждого модуля (те же правила, что в сборке: function/class/const/let в начале строки).
const src = {}, exportsOf = {};
for (const f of readdirSync(ed).filter((f) => f.endsWith('.js'))) {
  const s = readFileSync(join(ed, f), 'utf8').replace(/\r\n/g, '\n');
  src[f] = s;
  const names = new Set();
  for (const line of s.split('\n')) {
    const m = /^export (?:async )?(?:function\*?|class) (\w+)/.exec(line);
    if (m) names.add(m[1]);
    else if (/^export (?:const|let) /.test(line)) {
      const body = line.replace(/^export (?:const|let) /, '');
      let depth = 0, start = true;
      for (let i = 0; i < body.length; i++) {
        if (start) { const mm = /^\s*(\w+)\s*=(?!=)/.exec(body.slice(i)); if (mm) names.add(mm[1]); start = false; }
        const c = body[i];
        if (c === "'" || c === '"' || c === '`') { for (i++; i < body.length && body[i] !== c; i++) if (body[i] === '\\') i++; continue; }
        if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--; else if (c === ',' && depth === 0) start = true;
      }
    }
  }
  exportsOf[f] = names;
}
ok(Object.keys(src).length >= 12, `модулей редактора: ${Object.keys(src).length}`);

// 2. Каждый импортированный из ./x.js идентификатор существует в x.js.
const missing = [];
for (const [f, s] of Object.entries(src)) {
  for (const m of s.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'\.\/(\w+\.js)';?$/gm)) {
    const dep = m[2];
    if (!exportsOf[dep]) { missing.push(`${f}: нет файла ${dep}`); continue; }
    for (const part of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      const name = part.split(/\s+as\s+/)[0];
      if (!exportsOf[dep].has(name)) missing.push(`${f}: ${name} не экспортируется из ${dep}`);
    }
  }
}
ok(!missing.length, 'импорты между модулями сходятся' + (missing.length ? ':\n  ' + missing.join('\n  ') : ''));

// 3. Каждый модуль разбирается (node --check).
const bad = [];
for (const f of Object.keys(src)) {
  try { execFileSync(process.execPath, ['--check', join(ed, f)], { stdio: 'pipe' }); } catch (e) { bad.push(f + ': ' + String(e.stderr).split('\n').slice(0, 4).join(' ')); }
}
ok(!bad.length, 'синтаксис модулей' + (bad.length ? ':\n  ' + bad.join('\n  ') : ''));

// 4. Автономная сборка: собирается, все скрипты-модули внутри разбираются.
const tmp = mkdtempSync(join(tmpdir(), 'kontur-ed-'));
const out = join(tmp, 'studio.html');
let built = false;
try { execFileSync(process.execPath, [join(root, 'scripts', 'build-artifact.mjs'), out], { stdio: 'pipe' }); built = true; } catch (e) { console.log(String(e.stderr)); }
ok(built, 'build-artifact собирает страницу');
if (built) {
  const html = readFileSync(out, 'utf8');
  const mods = [...html.matchAll(/<script type="module">\n([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  ok(mods.length === 2, `в странице два модуля (движок и редактор): ${mods.length}`);
  const errs = [];
  mods.forEach((code, i) => {
    const f = join(tmp, `m${i}.mjs`);
    writeFileSync(f, code);
    try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { errs.push(`модуль ${i}: ` + String(e.stderr).split('\n').slice(0, 5).join(' ')); }
  });
  ok(!errs.length, 'код в собранной странице разбирается' + (errs.length ? ':\n  ' + errs.join('\n  ') : ''));
  const editor = mods[1] || '';
  for (const n of ['canUndo', 'canRedo', 'canvasBox', 'ovSvg']) ok(new RegExp(`return \\{[^}]*\\b${n}\\b`).test(editor), `сборка отдаёт ${n} (несколько имён в одной строке export)`);
  ok(html.includes('window.KONTUR_EXAMPLES'), 'примеры встроены');
}

console.log(fails ? `\n✗ провалено: ${fails}, прошло: ${passes}` : `\nВсе проверки пройдены: ${passes}`);
process.exit(fails ? 1 : 0);
