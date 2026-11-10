// Реестры → схема и справка; миграции формата; новый тип узла через registerNodeType.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runNode } from './helpers/common.mjs';
import { sceneSchema, migrate, SCENE_VERSION, registerNodeType, NODE_TYPES, createScene, ops, renderSVG, validateScene, MODIFIERS, toGeom } from '../engine/kontur.js';

test('справка и схема соответствуют реестрам (npm run docs)', () => {
  runNode(fileURLToPath(new URL('../scripts/gen-docs.mjs', import.meta.url)), '--check');
});

test('схема: все типы узлов и модификаторов', () => {
  const s = sceneSchema();
  assert.equal(s.$defs.node.oneOf.length, NODE_TYPES.length);
  assert.equal(s.$defs.mod.oneOf.length, Object.keys(MODIFIERS).length);
  const rect = s.$defs.node.oneOf.find((n) => n.properties.type.const === 'rect');
  assert.equal(rect.properties.props.properties.width.default, 100);
});

test('миграции: без version → текущая; из будущего — ошибка', () => {
  const s = { width: 10, height: 10, duration: 1, nodes: [] };
  assert.deepEqual(migrate(s), ['0→1']);
  assert.equal(s.version, SCENE_VERSION);
  assert.deepEqual(migrate(s), []);
  assert.throws(() => migrate({ version: SCENE_VERSION + 1, nodes: [] }), /новее/);
});

test('registerNodeType: свой тип рисуется и проходит проверку', () => {
  registerNodeType('diamond', { doc: 'ромб', props: { size: { type: 'number', default: 40 } }, geom: (P) => { const r = P('size') ?? 40; return toGeom({ points: [[0, -r], [r, 0], [0, r], [-r, 0]], closed: true }); } });
  const sc = createScene({ width: 100, height: 100 });
  ops.addNode(sc, { id: 'd', type: 'diamond', props: { x: 50, y: 50, fill: '#f00' } });
  assert.deepEqual(validateScene(sc), []);
  const svg = renderSVG(sc, 0);
  assert.match(svg, /data-node="d"/);
  assert.match(svg, /<path[^>]*d="M0 -40/);
});
