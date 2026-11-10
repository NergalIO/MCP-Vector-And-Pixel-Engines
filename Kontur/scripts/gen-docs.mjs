// Сгенерировать разделы справки и схему сцены из реестров движка:
//   docs/REFERENCE.md — таблицы между <!-- gen:types --> … <!-- /gen:types --> и <!-- gen:modifiers --> … <!-- /gen:modifiers -->,
//     список предметов 2.5D-мира между <!-- gen:world --> … <!-- /gen:world -->;
//   docs/scene.schema.json — JSON Schema формата сцены.
// node scripts/gen-docs.mjs [--check] — с --check только сверяет (код выхода 1, если файлы устарели).
import { readFileSync, writeFileSync } from 'node:fs';
import { sceneSchema, typesTableMd, modifiersTableMd } from '../engine/kontur.js';
import { worldItemsDoc } from '../engine/world3d.js';

/** Список предметов мира в Markdown: «- **тип** `{поля}` — описание» (из реестра WORLD_ITEMS). */
const worldItemsMd = () => worldItemsDoc().split('\n').map((l) => {
  const m = l.match(/^• (\S+) (\{.*\}) — (.*)$/);
  return m ? `- **${m[1]}** \`${m[2]}\` — ${m[3]}` : l;
}).join('\n');

const check = process.argv.includes('--check');
const ref = new URL('../docs/REFERENCE.md', import.meta.url);
const schemaFile = new URL('../docs/scene.schema.json', import.meta.url);

export function renderDocs(md) {
  const put = (name, body) => {
    const re = new RegExp(`(<!-- gen:${name} -->\\n)[\\s\\S]*?(\\n<!-- /gen:${name} -->)`);
    if (!re.test(md)) throw new Error(`в REFERENCE.md нет меток <!-- gen:${name} --> … <!-- /gen:${name} -->`);
    md = md.replace(re, (_, a, b) => a + body + b);
  };
  put('types', typesTableMd());
  put('modifiers', modifiersTableMd());
  put('world', worldItemsMd());
  return md;
}

const md0 = readFileSync(ref, 'utf8');
const md1 = renderDocs(md0);
const schema = JSON.stringify(sceneSchema(), null, 1) + '\n';
let schema0 = '';
try { schema0 = readFileSync(schemaFile, 'utf8'); } catch {}
const stale = [md0 !== md1 && 'docs/REFERENCE.md', schema0 !== schema && 'docs/scene.schema.json'].filter(Boolean);
if (check) {
  if (stale.length) { console.error(`устарели: ${stale.join(', ')} — запустите npm run docs`); process.exit(1); }
  console.log('✓ справка и схема соответствуют реестрам');
} else {
  writeFileSync(ref, md1); writeFileSync(schemaFile, schema);
  console.log(stale.length ? `✓ обновлено: ${stale.join(', ')}` : '✓ без изменений');
}
