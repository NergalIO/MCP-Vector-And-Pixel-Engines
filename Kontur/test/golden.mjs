// Эталоны вывода: SHA-256 SVG-строк примеров и эталонных сцен в нескольких моментах и режимах.
// Вывод детерминирован, поэтому сравнение точное. Рефакторинг ядра не должен менять ни одного хеша.
//   node test/golden.mjs           — сравнить
//   node test/golden.mjs --update  — перезаписать test/golden.json (только если изменение вывода намеренное)
import { readFileSync, existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha, runGolden } from './helpers/golden.mjs';
// --engine <файл> — проверить другой вход движка (например, собранный одним модулем)
const ei = process.argv.indexOf('--engine');
const engineUrl = ei > 0 ? pathToFileURL(resolvePath(process.argv[ei + 1])).href : '../engine/kontur.js';
const { renderSVG, evaluate, treeToString } = await import(engineUrl);

const root = new URL('..', import.meta.url);
const file = new URL('test/golden.json', root);
const MODES = ['color', 'height', 'normal', 'plane', 'planeD', 'emissive', 'ink', 'cover', 'matId', 'mask:chr'];
const CASES = [
  { f: 'examples/flow.json', modes: ['color', 'height'], times: 6 },
  { f: 'examples/liquid.json', modes: ['color', 'height'], times: 6 },
  { f: 'examples/reveal.json', modes: ['color', 'height'], times: 6 },
  { f: 'examples/bay.json', modes: ['color', 'height'], times: 4, states: true },
];
export function computeGolden({ only } = {}) {
  const out = {};
  for (const c of CASES) {
    if (only && !c.f.includes(only)) continue;
    if (!existsSync(new URL(c.f, root))) continue;
    const s = JSON.parse(readFileSync(new URL(c.f, root), 'utf8'));
    for (let i = 0; i < c.times; i++) {
      const t = c.times === 1 ? 0 : (i / (c.times - 1)) * s.duration * 0.999;
      for (const m of c.modes) out[`${c.f}|${t.toFixed(3)}|${m}`] = sha(renderSVG(s, t, { mode: m === 'color' ? undefined : m }));
      out[`${c.f}|${t.toFixed(3)}|cached`] = sha(treeToString(evaluate(s, t, { cache: true })));
      if (c.states) for (const g of s.states || []) for (const v of Object.keys(g.values || {})) out[`${c.f}|${t.toFixed(3)}|state:${g.name}=${v}`] = sha(renderSVG(s, t, { states: { [g.name]: v } }));
    }
  }
  return out;
}
const isMain = import.meta.url === new URL(process.argv[1], 'file:///').href || process.argv[1]?.endsWith('golden.mjs');
if (isMain) {
  const t0 = performance.now();
  runGolden(file, computeGolden(), {
    t0, ignoreMissing: true, exitOk: true,
    written: (n, sec) => console.log(`✓ эталоны записаны: ${n} (${sec} с)`),
    report: ({ bad, missing, n, sec }) => {
      for (const k of bad) console.log('  ✗', k);
      if (missing.length) console.log(`  (нет сцен для ${missing.length} эталонов — пропущены)`);
      console.log(bad.length ? `✗ эталонов не совпало: ${bad.length}` : `✓ эталоны совпали: ${n} (${sec} с)`);
    },
  });
}
