// @ts-check
// Сборщик ES-модулей без зависимостей: граф модулей от входного файла → один исходник, где у каждого модуля
// своя область видимости (обёртка-функция), импорты — разбор объекта модуля-зависимости, экспорты — объект модуля.
// Сильно связанные модули (циклические импорты) делят одну обёртку: так цикл работает, как в ESM, а уникальность
// имён верхнего уровня требуется только внутри такой группы.
//
// Поддержанные формы (в начале строки): import { a, b as c } from './x.js' (можно в несколько строк),
// import './x.js', export function|async function|function*|class|const …, export { a, b as c } from './x.js'.
// Динамический import() остаётся как есть. Остальное (default, import * as, export let, export { a } без from) —
// ошибка сборки: такие формы либо теряют семантику при переносе, либо не нужны в engine/ и player/ed/.
//
//   import { bundle, bundleEngine } from './mcp/bundle.mjs';
//   bundleEngine() → строка ES-модуля движка;  bundle(entryURL, { format: 'none' }) → { code, names, modules }
//   node mcp/bundle.mjs dist/kontur.js
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileEnsured } from './paths.mjs';

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2;?[ \t]*$/gm;
const SIDE_IMPORT_RE = /^import\s*(['"])([^'"]+)\1;?[ \t]*$/gm;
const REEXPORT_RE = /^export\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2;?[ \t]*$/gm;
const DECL_RE = /^(?:export )?(?:async )?(?:function(?:\s*\*\s*|\s+)|class\s+)([A-Za-z_$][\w$]*)/;
const TLA_RE = /^(?![\s}/*])(?!(?:export\s+)?(?:async\s+)?function\b).*\bawait\b/m;

/**
 * Имена в «const a = …, b = …» с начала строки (запятые внутри скобок и строк не считаются).
 * @param {string} line
 */
export function declNames(line) {
  const out = [], body = line.replace(/^(?:export )?(?:const|let|var) /, '');
  let depth = 0, start = true;
  for (let i = 0; i < body.length; i++) {
    if (start) { const m = /^\s*([A-Za-z_$][\w$]*)\s*=(?!=)/.exec(body.slice(i)); if (m) out.push(m[1]); start = false; }
    const c = body[i];
    if (c === "'" || c === '"' || c === '`') { for (i++; i < body.length && body[i] !== c; i++) if (body[i] === '\\') i++; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) start = true;
  }
  return out;
}

/**
 * Имена верхнего уровня, объявленные строками с начала строки: { all, exported }.
 * @param {string} src
 */
export function topNames(src) {
  const all = [], exported = [];
  for (const line of src.split('\n')) {
    const exp = line.startsWith('export ');
    const m = DECL_RE.exec(line);
    const names = m ? [m[1]] : /^(?:export )?(?:const|let|var) /.test(line) ? declNames(line) : [];
    all.push(...names);
    if (exp) exported.push(...names);
  }
  return { all, exported };
}

/** @param {string} list «a, b as c» → [[a, a], [b, c]] (имя у источника, местное имя). */
const specList = (list) => list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
  const [from, as] = s.split(/\s+as\s+/);
  return /** @type {[string, string]} */ ([from.trim(), (as || from).trim()]);
});

/**
 * @typedef {{ url: string, name: string, id: string, src: string, deps: string[],
 *   imports: { from: string, name: string, local: string }[], reexports: { from: string, name: string, as: string }[],
 *   exports: string[], decls: string[], tla: boolean }} Mod
 */

/**
 * Собирает граф модулей от entry в один исходник.
 * @param {URL | string} entry путь или file:-URL входного модуля
 * @param {{ format?: 'esm' | 'global' | 'none', globalName?: string, sync?: boolean }} [opts]
 *   format: esm — `export const { … } = модуль`; global — `window[globalName] = модуль`; none — без экспорта.
 *   sync: запретить await верхнего уровня (сборка выполнится синхронно).
 * @returns {{ code: string, names: string[], modules: string[] }}
 */
export function bundle(entry, { format = 'esm', globalName = 'Kontur', sync = false } = {}) {
  const entryUrl = typeof entry === 'string' ? pathToFileURL(resolve(entry)).href : entry.href;
  const baseDir = dirname(fileURLToPath(entryUrl));
  /** @type {Map<string, Mod>} */
  const mods = new Map();
  const ids = new Set();

  /** @param {string} url */
  function load(url) {
    let mod = mods.get(url);
    if (mod) return mod;
    const file = fileURLToPath(url);
    const name = relative(baseDir, file).split('\\').join('/');
    const fail = (/** @type {string} */ msg) => { throw new Error(`${name}: ${msg}`); };
    let src;
    try { src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return fail(`не читается (${/** @type {Error} */ (e).message})`); }
    let id = '__m_' + name.replace(/\.m?js$/, '').replace(/\W/g, '_');
    for (let k = 2; ids.has(id); k++) id = id.replace(/_\d+$/, '') + '_' + k;
    ids.add(id);
    const dep = (/** @type {string} */ spec) => {
      if (!/^\.\.?\//.test(spec)) fail(`импорт «${spec}»: поддержаны только относительные пути`);
      return new URL(spec, url).href;
    };
    /** @type {Mod['imports']} */ const imports = [];
    /** @type {Mod['reexports']} */ const reexports = [];
    const deps = [];
    let body = src.replace(IMPORT_RE, (_, list, _q, spec) => {
      const from = dep(spec);
      deps.push(from);
      for (const [n, local] of specList(list)) imports.push({ from, name: n, local });
      return '';
    });
    body = body.replace(SIDE_IMPORT_RE, (_, _q, spec) => { deps.push(dep(spec)); return ''; });
    body = body.replace(REEXPORT_RE, (_, list, _q, spec) => {
      const from = dep(spec);
      deps.push(from);
      for (const [n, as] of specList(list)) reexports.push({ from, name: n, as });
      return '';
    });
    const line = (/** @type {RegExp} */ re) => body.slice(0, body.search(re)).split('\n').length;
    if (/^import(?!\s*\(|\.meta\b)/m.test(body)) fail(`строка ${line(/^import(?!\s*\(|\.meta\b)/m)}: неподдержанная форма import (нужно import { … } from './x.js')`);
    if (/^export\s+let\b/m.test(body)) fail(`строка ${line(/^export\s+let\b/m)}: export let не поддержан (изменения переменной не дойдут до импортёров) — используйте const или функцию`);
    const badExport = /^export\s+(?!(?:async\s+)?function\b|class\b|const\b)/m;
    if (badExport.test(body)) fail(`строка ${line(badExport)}: неподдержанная форма export`);
    const { all, exported } = topNames(body);
    const constLines = body.split('\n').filter((l) => l.startsWith('export const '));
    for (const l of constLines) if (!declNames(l).length) fail(`«${l.slice(0, 60)}»: имена export const не распознаны (деструктуризация не поддержана)`);
    mod = { url, name, id, src: body.replace(/^export /gm, '').replace(/^\n+/, ''), deps: [...new Set(deps)], imports, reexports,
      exports: [...exported, ...reexports.map((r) => r.as)], decls: all, tla: TLA_RE.test(body) };
    mods.set(url, mod);
    for (const d of mod.deps) load(d);
    return mod;
  }
  const entryMod = load(entryUrl);
  // заголовок /*! … */ входного файла (лицензия, версия) — в начало сборки
  const header = entryMod.src.match(/^\/\*![\s\S]*?\*\/\n/)?.[0] || '';
  if (header) entryMod.src = entryMod.src.slice(header.length).replace(/^\n+/, '');

  // Сильно связанные компоненты (Тарьян): выдаются зависимости раньше зависящих; внутри компонента —
  // порядок завершения обхода в глубину, тот же, в каком ESM выполняет модули цикла.
  /** @type {Map<string, { index: number, low: number, onStack: boolean }>} */
  const st = new Map();
  /** @type {Map<string, number>} */
  const finish = new Map();
  /** @type {string[]} */ const stack = [];
  /** @type {Mod[][]} */ const comps = [];
  let counter = 0;
  /** @param {string} v */
  function strong(v) {
    const s = { index: counter, low: counter, onStack: true };
    counter++;
    st.set(v, s); stack.push(v);
    for (const w of /** @type {Mod} */ (mods.get(v)).deps) {
      const t = st.get(w);
      if (!t) { strong(w); s.low = Math.min(s.low, /** @type {any} */ (st.get(w)).low); }
      else if (t.onStack) s.low = Math.min(s.low, t.index);
    }
    finish.set(v, finish.size);
    if (s.low === s.index) {
      const comp = [];
      let w;
      do { w = /** @type {string} */ (stack.pop()); /** @type {any} */ (st.get(w)).onStack = false; comp.push(/** @type {Mod} */ (mods.get(w))); } while (w !== v);
      comp.sort((a, b) => /** @type {number} */ (finish.get(a.url)) - /** @type {number} */ (finish.get(b.url)));
      comps.push(comp);
    }
  }
  strong(entryUrl);

  const exportsOf = (/** @type {string} */ url) => new Set(/** @type {Mod} */ (mods.get(url)).exports);
  let code = '';
  for (const comp of comps) {
    const inComp = new Set(comp.map((m) => m.url));
    const cycle = comp.map((m) => m.name).join(' ↔ ');
    const where = comp.length > 1 ? `цикл ${cycle}: ` : '';
    // имена верхнего уровня в общей обёртке не должны пересекаться
    /** @type {Map<string, string>} */
    const owner = new Map();
    for (const m of comp) for (const n of m.decls) {
      if (owner.has(n) && owner.get(n) !== m.name) throw new Error(`${where}имя ${n} объявлено и в ${owner.get(n)}, и в ${m.name}`);
      owner.set(n, m.name);
    }
    // импорты из других компонентов — одним разбором на зависимость; из своего компонента — просто имена в области
    /** @type {Map<string, Map<string, string>>} */
    const pulls = new Map();
    /** @type {Map<string, string>} */
    const locals = new Map();
    for (const m of comp) {
      for (const im of m.imports) {
        const src = /** @type {Mod} */ (mods.get(im.from));
        if (!exportsOf(im.from).has(im.name)) throw new Error(`${m.name}: ${im.name} не экспортируется из ${src.name}`);
        if (inComp.has(im.from)) {
          if (im.local !== im.name) throw new Error(`${m.name}: переименование ${im.name} as ${im.local} внутри цикла ${cycle} не поддержано`);
          if (!src.decls.includes(im.name)) throw new Error(`${m.name}: ${im.name} из ${src.name} — реэкспорт внутри цикла не поддержан`);
          continue;
        }
        const key = `${im.from}#${im.name}`;
        if (locals.has(im.local) && locals.get(im.local) !== key) throw new Error(`${where}местное имя ${im.local} импортировано из разных мест`);
        if (owner.has(im.local)) throw new Error(`${where}имя ${im.local} импортировано в ${m.name} и объявлено в ${owner.get(im.local)}`);
        locals.set(im.local, key);
        let p = pulls.get(im.from);
        if (!p) pulls.set(im.from, (p = new Map()));
        p.set(im.local, im.name);
      }
      for (const r of m.reexports) {
        if (!exportsOf(r.from).has(r.name)) throw new Error(`${m.name}: ${r.name} не экспортируется из ${/** @type {Mod} */ (mods.get(r.from)).name}`);
        if (inComp.has(r.from)) throw new Error(`${m.name}: реэкспорт из ${/** @type {Mod} */ (mods.get(r.from)).name} внутри цикла не поддержан`);
      }
    }
    const async = comp.some((m) => m.tla);
    if (async && sync) throw new Error(`${comp.map((m) => m.name).join(', ')}: await верхнего уровня, а сборка должна выполняться синхронно`);
    const head = [...pulls].map(([from, p]) => {
      const parts = [...p].map(([local, n]) => (local === n ? n : `${n}: ${local}`));
      return `const { ${parts.join(', ')} } = ${/** @type {Mod} */ (mods.get(from)).id};\n`;
    }).join('');
    const objOf = (/** @type {Mod} */ m) => {
      const own = m.exports.filter((n) => !m.reexports.some((r) => r.as === n));
      const re = m.reexports.map((r) => `${r.as}: ${/** @type {Mod} */ (mods.get(r.from)).id}.${r.name}`);
      return `{ ${[...own, ...re].join(', ')} }`;
    };
    const target = comp.length > 1 ? `[${comp.map((m) => m.id).join(', ')}]` : comp[0].id;
    const ret = comp.length > 1 ? `[${comp.map(objOf).join(', ')}]` : objOf(comp[0]);
    code += `/* ---- ${comp.map((m) => m.name).join(' + ')} ---- */\n`
      + `const ${target} = ${async ? 'await (async ' : '('}() => {\n${head}`
      + comp.map((m) => (comp.length > 1 ? `/* -- ${m.name} -- */\n` : '') + m.src.trimEnd() + '\n').join('')
      + `return ${ret};\n})();\n\n`;
  }

  const names = entryMod.exports.slice();
  if (format === 'esm' && names.length) code += `export const { ${names.join(', ')} } = ${entryMod.id};\n`;
  else if (format === 'global') code += `window.${globalName} = ${entryMod.id};\n`;
  return { code: header + code, names, modules: comps.flat().map((m) => m.name) };
}

const ENGINE_ENTRY = new URL('../engine/kontur.js', import.meta.url);
/** @type {Map<string, { stamp: string, out: ReturnType<typeof bundle> }>} */
const engineCache = new Map();
/** Отпечаток исходников движка (время изменения файлов): сборка повторяется, если их правили при работающем сервере. */
function engineStamp() {
  const dir = fileURLToPath(new URL('../engine/core/', import.meta.url));
  let s = String(statSync(fileURLToPath(ENGINE_ENTRY)).mtimeMs);
  for (const f of readdirSync(dir).sort()) s += `|${f}:${statSync(resolve(dir, f)).mtimeMs}`;
  return s;
}

/**
 * Движок одним модулем: ES-модуль с публичными именами engine/kontur.js или (asWindowGlobal) скрипт для
 * <script type="module">, кладущий их в window.Kontur.
 * @param {{ asWindowGlobal?: boolean }} [opts]
 */
export function bundleEngine({ asWindowGlobal = false } = {}) {
  const format = asWindowGlobal ? 'global' : 'esm';
  const stamp = engineStamp();
  const hit = engineCache.get(format);
  if (hit && hit.stamp === stamp) return hit.out.code;
  const out = bundle(ENGINE_ENTRY, { format, sync: true });
  engineCache.set(format, { stamp, out });
  return out.code;
}
/** Публичные имена движка (как в engine/kontur.js). */
export function engineNames() {
  bundleEngine();
  return /** @type {{ out: ReturnType<typeof bundle> }} */ (engineCache.get('esm')).out.names.slice();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const out = process.argv[2] || 'dist/kontur.js';
  writeFileEnsured(out, bundleEngine());
  console.log(`✓ ${out}`); // lint-allow-stdout: только при запуске как CLI
}
