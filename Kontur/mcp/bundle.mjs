// Сборка движка в один ES-модуль без зависимостей: engine/kontur.js (реэкспорты) + engine/core/*.js.
// Модули ядра делят одно пространство имён верхнего уровня (имена уникальны — проверяется здесь),
// поэтому сборка — это склейка в порядке зависимостей без import/export и общий export в конце.
//   import { bundleEngine } from './mcp/bundle.mjs';  bundleEngine() → строка модуля
//   node mcp/bundle.mjs dist/kontur.js
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileEnsured } from './paths.mjs';

const ENGINE = new URL('../engine/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ENGINE), 'utf8').replace(/\r\n/g, '\n');
const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*'\.\/([\w-]+)\.js';?\s*$/gm;
const DECL_RE = /^(?:export )?(?:async )?(?:function\*?|class|const|let) ([A-Za-z_$][\w$]*)/gm;

let cache = null;
/** Публичные имена движка и исходник одним модулем. */
export function bundleEngine({ asWindowGlobal = false } = {}) {
  if (cache && !asWindowGlobal) return cache.code;
  const barrel = read('kontur.js');
  const pub = [], order = [], seen = new Set(), mods = new Map();
  for (const m of barrel.matchAll(/^export \{([^}]*)\} from '\.\/core\/([\w-]+)\.js';$/gm)) {
    pub.push(...m[1].split(',').map((s) => s.trim()).filter(Boolean));
    visit(m[2]);
  }
  function visit(name) {
    if (seen.has(name)) return;
    seen.add(name);
    const src = read(`core/${name}.js`);
    const deps = [...src.matchAll(IMPORT_RE)].map((m) => m[2]);
    for (const d of deps) visit(d);
    if (/^import\s/m.test(src.replace(IMPORT_RE, ''))) throw new Error(`core/${name}.js: неподдержанная форма import`);
    if (/^export\s+(?!(?:async )?(?:function|class|const|let)\b)/m.test(src)) throw new Error(`core/${name}.js: неподдержанная форма export`);
    mods.set(name, src);
    order.push(name);
  }
  const owner = new Map();
  let code = '';
  for (const name of order) {
    const src = mods.get(name);
    for (const m of src.matchAll(DECL_RE)) {
      if (owner.has(m[1])) throw new Error(`имя ${m[1]} объявлено и в core/${owner.get(m[1])}.js, и в core/${name}.js`);
      owner.set(m[1], name);
    }
    code += `/* ---- core/${name}.js ---- */\n` + src.replace(IMPORT_RE, '').replace(/^export /gm, '').trim() + '\n\n';
  }
  for (const p of pub) if (!owner.has(p)) throw new Error(`публичное имя ${p} не объявлено`);
  const head = barrel.match(/^\/\*![\s\S]*?\*\/\n/)?.[0] || '';
  const full = head + code + (asWindowGlobal ? `window.Kontur = { ${pub.join(', ')} };\n` : `export { ${pub.join(', ')} };\n`);
  if (!asWindowGlobal) cache = { code: full, names: pub };
  return full;
}
export function engineNames() { bundleEngine(); return cache.names.slice(); }

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const out = process.argv[2] || 'dist/kontur.js';
  writeFileEnsured(out, bundleEngine());
  console.log(`✓ ${out}`);
}
