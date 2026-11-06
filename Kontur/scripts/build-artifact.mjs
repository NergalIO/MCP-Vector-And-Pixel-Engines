// Собирает автономную страницу-плеер (движок + примеры внутри одного HTML).
// node scripts/build-artifact.mjs dist/kontur-studio.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineAssets } from '../mcp/render.mjs';
const root = new URL('..', import.meta.url);
const out = process.argv[2] || 'dist/kontur-studio.html';
let engine = readFileSync(new URL('engine/kontur.js', root), 'utf8');
const names = [...engine.matchAll(/^export (?:async )?(?:function|const|class|let) (\w+)/gm)].map((m) => m[1]);
engine = engine.replace(/^export /gm, '') + `\nwindow.Kontur = { ${names.join(', ')} };\n`;
const ex = {};
for (const n of ['bay', 'flow', 'liquid', 'reveal']) ex[n] = inlineAssets(JSON.parse(readFileSync(new URL(`examples/${n}.json`, root), 'utf8')), fileURLToPath(new URL('examples/', root)));
let html = readFileSync(new URL('player/index.html', root), 'utf8').replace(/^<!doctype html>\n/i, '');
html = html.replace(/<meta charset[^>]*>\n<meta name="viewport"[^>]*>\n/, '');
const inject = `<script>window.KONTUR_EXAMPLES = ${JSON.stringify(ex).replace(/</g, '\\u003c')};</script>\n<script type="module">\n${engine}</script>\n`;
html = html.replace('<script type="module">\nconst K', inject + '<script type="module">\nconst K');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`✓ ${out} (${(html.length / 1024).toFixed(0)} КБ)`);
