// Собирает автономную страницу Kontur Studio (движок + редактор + примеры в одном HTML).
// node scripts/build-artifact.mjs dist/kontur-studio.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineAssets } from '../mcp/render.mjs';
/** Имена из строки «export const a = …, b = …» (запятые внутри скобок и строк не считаются). */
function declNames(line) {
  const out = [], body = line.replace(/^export (?:const|let) /, '');
  let depth = 0, start = true;
  for (let i = 0; i < body.length; i++) {
    if (start) { const m = /^\s*(\w+)\s*=(?!=)/.exec(body.slice(i)); if (m) out.push(m[1]); start = false; }
    const c = body[i];
    if (c === "'" || c === '"' || c === '`') { for (i++; i < body.length && body[i] !== c; i++) if (body[i] === '\\') i++; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) start = true;
  }
  return out;
}
/** Все имена, которые экспортирует модуль (только формы export function/class/const/let в начале строки). */
function exportNames(src) {
  const names = [];
  for (const line of src.split('\n')) {
    const m = /^export (?:async )?(?:function\*?|class) (\w+)/.exec(line);
    if (m) names.push(m[1]);
    else if (/^export (?:const|let) /.test(line)) names.push(...declNames(line));
  }
  return names;
}
const root = new URL('..', import.meta.url);
const out = process.argv[2] || 'dist/kontur-studio.html';
const read = (p) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');

// Движок: обычный модуль, все экспорты — в window.Kontur (редактор берёт их оттуда).
let engine = read('engine/kontur.js');
const names = exportNames(engine);
engine = engine.replace(/^export /gm, '') + `\nwindow.Kontur = { ${names.join(', ')} };\n`;

// Редактор: модули player/ed/*.js по порядку зависимостей, каждый — в своей асинхронной обёртке,
// импорты превращаются в разбор объекта модуля (имена верхнего уровня в разных модулях пересекаются).
const ORDER = ['core', 'view', 'geom', 'overlay', 'actions', 'tools', 'inspector', 'layers', 'timeline', 'scenepanel', 'preview', 'app'];
const done = new Set();
let editor = '';
for (const name of ORDER) {
  let src = read(`player/ed/${name}.js`);
  src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*'\.\/(\w+)\.js';?$/gm, (_, list, dep) => {
    if (!done.has(dep)) throw new Error(`${name}.js: модуль ${dep}.js должен стоять в ORDER раньше`);
    const parts = list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const [a, b] = s.split(/\s+as\s+/); return b ? `${a}: ${b}` : a; });
    return `const { ${parts.join(', ')} } = __m_${dep};`;
  });
  src = src.replace(/^import\s*'\.\/(\w+)\.js';?$/gm, (_, dep) => { if (!done.has(dep)) throw new Error(`${name}.js: ${dep}.js не собран`); return ''; });
  if (/^import\s/m.test(src)) throw new Error(`${name}.js: неразобранный import`);
  const exp = exportNames(src);
  if (/^export\s+(?!(?:async )?(?:function|const|class|let)\b)/m.test(src)) throw new Error(`${name}.js: такая форма export не поддержана`);
  src = src.replace(/^export /gm, '');
  editor += `const __m_${name} = await (async () => {\n${src}\nreturn { ${exp.join(', ')} };\n})();\n`;
  done.add(name);
}
for (const f of ['core', 'app']) if (!done.has(f)) throw new Error('нет ' + f);

const ex = {};
for (const n of ['bay', 'flow', 'liquid', 'reveal']) ex[n] = inlineAssets(JSON.parse(read(`examples/${n}.json`)), fileURLToPath(new URL('examples/', root)));

let html = read('player/index.html').replace(/^<!doctype html>\n/i, '');
html = html.replace(/<meta charset[^>]*>\n<meta name="viewport"[^>]*>\n/, '');
const tag = /<script type="module">\n\/\/[^\n]*\nimport '\.\/ed\/app\.js';\n<\/script>/;
if (!tag.test(html)) throw new Error('в player/index.html не найден <script type="module"> с import \'./ed/app.js\'');
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
const inject = `<script>window.KONTUR_EXAMPLES = ${JSON.stringify(ex).replace(/</g, '\\u003c')};</script>\n`
  + `<script type="module">\n${safe(engine)}</script>\n<script type="module">\n${safe(editor)}</script>`;
html = html.replace(tag, () => inject);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`✓ ${out} (${(html.length / 1024).toFixed(0)} КБ, модулей редактора: ${done.size})`);
