/**
 * Схема формата сцены (JSON Schema 2020-12), собранная из реестров типов узлов и модификаторов, и миграции
 * версий формата. Схема — для редакторов и внешних инструментов (подсказки, проверка); сама движок проверяет
 * сцену validateStructure/validateScene.
 */
import { COMMON_PROPS, NODE_DEFS, NODE_TYPES } from './types.js';
import { MODIFIERS } from './modifiers.js';
import { easings } from './ease.js';

/** Текущая версия формата сцены. */
export const SCENE_VERSION = 1;

const jsType = (t) => {
  if (!t || t === 'any') return {};
  const ts = String(t).split('|').map((x) => (x === 'array' ? 'array' : x === 'number' ? 'number' : x === 'boolean' ? 'boolean' : x === 'string' ? 'string' : x === 'object' ? 'object' : null)).filter(Boolean);
  return ts.length === 1 ? { type: ts[0] } : ts.length ? { type: ts } : {};
};
const propSchema = (p) => ({ ...jsType(p.type), ...(p.default !== undefined ? { default: p.default } : {}), ...(p.enum ? { enum: p.enum } : {}), ...(p.doc ? { description: p.doc } : {}) });

/** JSON Schema сцены по текущим реестрам (учитывает типы и модификаторы, добавленные register*). */
export function sceneSchema() {
  const ease = { description: `имя (${Object.keys(easings).join(', ')}), "cubic-bezier(a,b,c,d)", [a,b,c,d], "spring(k,d,m)", {spring:{…}}, {steps:n}` };
  const key = { type: 'object', required: ['t', 'v'], properties: { t: { type: 'number' }, v: {}, ease, hold: { type: 'boolean' } } };
  const mods = Object.entries(MODIFIERS).map(([type, def]) => ({
    type: 'object', required: ['type'], description: def.doc,
    properties: { type: { const: type }, start: { type: 'number' }, end: { type: 'number' }, fadeIn: { type: 'number' }, fadeOut: { type: 'number' }, weight: { type: 'number' }, enabled: { type: 'boolean' },
      ...Object.fromEntries(Object.entries(def.params || {}).map(([k, p]) => [k, propSchema(p)])) },
  }));
  const nodes = NODE_TYPES.map((type) => {
    const def = NODE_DEFS[type];
    return {
      type: 'object', required: ['id', 'type'], description: def.doc || type,
      properties: {
        id: { type: 'string' }, type: { const: type }, parent: { type: ['string', 'null'] },
        props: { type: 'object', properties: Object.fromEntries(Object.entries({ ...COMMON_PROPS, ...(def.props || {}) }).map(([k, p]) => [k, propSchema(p)])) },
        keys: { type: 'object', additionalProperties: { type: 'array', items: { $ref: '#/$defs/key' } } },
        mods: { type: 'array', items: { $ref: '#/$defs/mod' } },
      },
    };
  });
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://kontur.local/scene.schema.json',
    title: 'Kontur scene',
    type: 'object', required: ['width', 'height', 'duration', 'nodes'],
    properties: {
      version: { type: 'integer', maximum: SCENE_VERSION }, width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 },
      duration: { type: 'number', exclusiveMinimum: 0 }, fps: { type: 'number' }, background: {}, loop: { type: 'boolean' },
      clips: { type: 'array', items: { type: 'object', required: ['name', 'start', 'end'], properties: { name: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' }, loop: { type: 'boolean' }, fps: { type: 'number' }, next: { type: 'string' } } } },
      markers: { type: 'array', items: { type: 'object', required: ['t', 'name'], properties: { t: { type: 'number' }, name: { type: 'string' }, data: {} } } },
      symbols: { type: 'object', description: 'определения символов: имя → { nodes, duration? }', additionalProperties: { type: 'object', required: ['nodes'], properties: { nodes: { type: 'array', items: { $ref: '#/$defs/node' } }, duration: { type: 'number' } } } },
      states: { type: 'array' }, pixel: {}, dither: {}, relief: {}, camera3d: {}, lighting: {}, style: {}, materials: { type: 'object' },
      nodes: { type: 'array', items: { $ref: '#/$defs/node' } },
    },
    $defs: { key, mod: { oneOf: mods }, node: { oneOf: nodes } },
  };
}

/* ------------------------------------------------------------------ миграции */
/**
 * Миграции формата: MIGRATIONS[v] переводит сцену версии v в v+1 (на месте). Файл без version — версия 0
 * (до появления поля): переводится в 1 без изменений содержимого.
 */
export const MIGRATIONS = {
  0: (s) => { s.version = 1; },
};
/**
 * Привести сцену к текущей версии формата (на месте). Возвращает список применённых шагов.
 * Сцена новее движка — ошибка (её нельзя молча испортить сохранением).
 */
export function migrate(scene) {
  const steps = [];
  if (!scene || typeof scene !== 'object') return steps;
  let v = Number.isInteger(scene.version) ? scene.version : 0;
  if (v > SCENE_VERSION) throw new Error(`Сцена версии ${v} новее движка (поддерживается до ${SCENE_VERSION}) — обновите Kontur`);
  while (v < SCENE_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`Нет миграции формата с версии ${v}`);
    m(scene); steps.push(`${v}→${v + 1}`); v++;
    scene.version = v;
  }
  return steps;
}

/* ------------------------------------------------------------------ справка из реестров */
const code = (s) => '`' + s + '`';
/** Таблица типов узлов для docs/REFERENCE.md. */
export function typesTableMd() {
  const rows = [];
  const seen = new Set();
  for (const type of NODE_TYPES) {
    if (seen.has(type)) continue;
    const def = NODE_DEFS[type];
    const alias = NODE_TYPES.filter((t) => NODE_DEFS[t].alias === type);
    alias.forEach((a) => seen.add(a));
    const names = [type, ...alias].map(code).join(' / ');
    const props = Object.entries(def.props || {}).map(([k, p]) => code(k) + (p.default !== undefined && typeof p.default !== 'string' ? ` (${p.default})` : '')).join(', ') || '—';
    rows.push(`| ${names} | ${props} | ${def.doc || ''} |`);
  }
  return ['| type | Свойства | Примечание |', '|---|---|---|', ...rows].join('\n');
}
/** Таблица модификаторов для docs/REFERENCE.md. */
export function modifiersTableMd() {
  const rows = Object.entries(MODIFIERS).map(([type, def]) => {
    const what = String(def.doc || '').split(/\.\s|:\s/)[0].replace(/\|/g, '\\|');
    const params = Object.entries(def.params || {}).map(([k, p]) => code(k) + (p.default !== undefined ? ` (${typeof p.default === 'string' ? p.default : JSON.stringify(p.default)})` : '') + (p.doc ? ` — ${p.doc}` : '')).join(', ');
    return `| ${code(type)} | ${what} | ${params.replace(/\|/g, '\\|')} |`;
  });
  return ['| type | Что делает | Параметры (по умолчанию) |', '|---|---|---|', ...rows].join('\n');
}
