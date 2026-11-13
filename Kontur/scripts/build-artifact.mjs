// Собирает автономную страницу Kontur Studio (движок + редактор + примеры в одном HTML).
// node scripts/build-artifact.mjs dist/kontur-studio.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineAssets } from '../mcp/render.mjs';
import { bundle, bundleEngine } from '../mcp/bundle.mjs';

const root = new URL('..', import.meta.url);
const out = process.argv[2] || 'dist/kontur-studio.html';
const read = (p) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');

// Движок: обычный модуль, все экспорты — в window.Kontur (редактор берёт их оттуда).
// Исходники — engine/core/*.js; mcp/bundle.mjs склеивает их в один модуль.
const engine = bundleEngine({ asWindowGlobal: true });

// Редактор: граф модулей от player/ed/app.js (mcp/bundle.mjs) — у каждого модуля своя область видимости,
// так что имена верхнего уровня в разных модулях могут совпадать; порядок — по импортам.
const editorBuild = bundle(new URL('player/ed/app.js', root), { format: 'none' });
const editor = editorBuild.code;

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
console.log(`✓ ${out} (${(html.length / 1024).toFixed(0)} КБ, модулей редактора: ${editorBuild.modules.length})`);
