// Автотесты ядра: node scripts/test-engine.mjs
// IK, состояния, правки поверх сцены (edits), свет, палитра, кэш статичных частей, матрицы.
import {
  createScene, ops, evaluate, renderSVG, treeToString, nodeWorldMatrix, mat, collectLights,
  diffScenes, applyEdits, editsEmpty, editsCount, quantizeRGBA, validateScene, invalidate, describeScene,
} from '../engine/kontur.js';

let fails = 0, passed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { fails++; console.log('  ✗', msg); } };
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const section = (s) => console.log('•', s);
const strip = (svg) => svg; // svg-строки сравниваются целиком

/* ---------- матрицы ---------- */
section('матрицы совпадают с трансформацией SVG');
{
  const m = mat.compose({ x: 100, y: 50, rotation: 30, scaleX: 2, scaleY: 0.5, anchorX: 10, anchorY: 4 });
  const [px, py] = mat.apply(m, 10, 4);
  ok(near(px, 100) && near(py, 50), 'anchor переходит в (x, y)');
  const inv = mat.apply(mat.inv(m), ...mat.apply(m, 7, -3));
  ok(near(inv[0], 7) && near(inv[1], -3), 'обратная матрица');
}

/* ---------- IK ---------- */
function rig({ mirror = false } = {}) {
  const s = createScene({ width: 400, height: 400, duration: 2 });
  ops.addNode(s, { id: 'root', type: 'group', props: { x: 200, y: 100, scaleX: mirror ? -1 : 1 } });
  ops.addNode(s, { id: 'thigh', type: 'group', parent: 'root', props: { x: 0, y: 0, rotation: 0 } });
  ops.addNode(s, { id: 'shin', type: 'group', parent: 'thigh', props: { x: 0, y: 80, rotation: 10 } });
  ops.addNode(s, { id: 'foot', type: 'group', parent: 'shin', props: { x: 0, y: 70 } });
  ops.addNode(s, { id: 'tgt', type: 'group', props: { x: 230, y: 220 } });
  ops.setKeys(s, 'tgt', 'x', [{ t: 0, v: 230 }, { t: 2, v: 150 }]);
  return s;
}
section('IK: конечное звено приходит в цель');
for (const mirror of [false, true]) {
  const s = rig({ mirror });
  ops.setIK(s, 'foot', { target: 'tgt' });
  for (const t of [0, 0.7, 2]) {
    const mf = nodeWorldMatrix(s, 'foot', t), mt = nodeWorldMatrix(s, 'tgt', t);
    ok(near(mf[4], mt[4], 0.01) && near(mf[5], mt[5], 0.01), `стопа в цели (зеркало ${mirror}, t=${t}): ${mf[4].toFixed(2)},${mf[5].toFixed(2)} vs ${mt[4].toFixed(2)},${mt[5].toFixed(2)}`);
  }
  // сгиб по текущей позе: колено (shin.rotation 10 → сгиб в ту же сторону)
  const ms = nodeWorldMatrix(s, 'shin', 0);
  const s2 = rig({ mirror }); s2.nodes.find((n) => n.id === 'shin').props.rotation = -10; invalidate(s2);
  ops.setIK(s2, 'foot', { target: 'tgt' });
  const ms2 = nodeWorldMatrix(s2, 'shin', 0);
  ok(Math.abs(ms[4] - ms2[4]) > 1, `сторона сгиба берётся из позы (зеркало ${mirror})`);
}
{
  const s = rig();
  ops.setIK(s, 'foot', { target: 'tgt' });
  s.nodes.find((n) => n.id === 'tgt').keys.x = [{ t: 0, v: 900 }]; invalidate(s); // недостижимо
  const mf = nodeWorldMatrix(s, 'foot', 0);
  ok(near(Math.hypot(mf[4] - 200, mf[5] - 100), 150, 0.05), 'недостижимая цель — нога вытянута');
  ops.updateNode(s, 'foot', { props: { ikWeight: 0 } });
  const fk = nodeWorldMatrix(s, 'shin', 0);
  ok(near(fk[4], 200) && near(fk[5], 180), 'ikWeight 0 — чистый FK');
  ops.updateNode(s, 'tgt', { props: { rotation: 25 } }); ops.updateNode(s, 'foot', { props: { ikWeight: 1 } });
  ops.setIK(s, 'foot', { target: 'tgt', orient: true });
  const mf2 = nodeWorldMatrix(s, 'foot', 0);
  ok(near(Math.atan2(mf2[1], mf2[0]) * 180 / Math.PI, 25, 0.01), 'orient: стопа повторяет поворот цели');
  ok(validateScene(s).length === 0, 'сцена с IK проходит проверку');
  let threw = false; try { ops.setIK(s, 'shin', { target: 'thigh' }); } catch { threw = true; }
  ok(threw, 'цель не может быть звеном цепочки');
}

/* ---------- состояния ---------- */
section('состояния подменяют свойства');
{
  const s = createScene({ width: 200, height: 200, duration: 1 });
  ops.addNode(s, { id: 'door', type: 'rect', props: { x: 50, y: 50, fill: '#f00' } });
  ops.addNode(s, { id: 'open', type: 'rect', props: { x: 80, y: 50, fill: '#0f0', visible: false } });
  ops.setState(s, { name: 'locker', default: 'closed', values: { closed: {}, open: { door: { visible: false }, open: { visible: true } } } });
  const a = renderSVG(s, 0), b = renderSVG(s, 0, { states: { locker: 'open' } });
  ok(a.includes('#f00') && !a.includes('#0f0'), 'по умолчанию закрыто');
  ok(!b.includes('#f00') && b.includes('#0f0'), 'вариант open');
  ok(validateScene(s).length === 0, 'проверка сцены со состояниями');
  ok(describeScene(s).includes('locker = [closed] | open'), 'сводка показывает состояния');
}

/* ---------- кэш статичных частей ---------- */
section('кэш: тот же SVG, что без кэша');
{
  const s = createScene({ width: 300, height: 300, duration: 2 });
  s.dither = { enabled: true, pattern: 'bayer4', cell: 3, density: [0.1, 0.9], angle: 90 };
  ops.addNode(s, { id: 'g', type: 'group' });
  ops.addNode(s, { id: 'w', type: 'path', parent: 'g', props: { d: 'M0 0L100 0L100 100Z', fill: '#345', shade: true }, mods: [{ type: 'deform', amount: 3, speed: 0, seed: 2 }] });
  ops.addNode(s, { id: 'r', type: 'rect', parent: 'g', props: { x: 150, y: 150, fill: { type: 'linear', stops: [[0, '#fff'], [1, '#000']] }, glow: { blur: 4, color: '#0ff' } } });
  ops.addNode(s, { id: 'mv', type: 'circle', props: { r: 20, fill: '#abc', shade: true } });
  ops.setKeys(s, 'mv', 'x', [{ t: 0, v: 10 }, { t: 2, v: 290 }]);
  for (const t of [0, 0.5, 1.3, 0.5]) {
    const plain = renderSVG(s, t), cached = treeToString(evaluate(s, t, { cache: true }));
    ok(plain === cached, `t=${t}: SVG совпадает`);
  }
  ops.updateNode(s, 'r', { props: { fill: '#f0f' } });
  ok(treeToString(evaluate(s, 0, { cache: true })).includes('#f0f'), 'после правки кэш сброшен');
}

/* ---------- правки поверх сцены ---------- */
section('правки: diff → apply даёт ту же сцену');
{
  const base = createScene({ width: 500, height: 500, duration: 3 });
  ops.addNode(base, { id: 'bg', type: 'rect', props: { x: 250, y: 250, width: 500, height: 500, fill: '#111' } });
  ops.addNode(base, { id: 'g', type: 'group', props: { x: 10 } });
  for (const id of ['a', 'b', 'c', 'd']) ops.addNode(base, { id, type: 'circle', parent: 'g', props: { x: id.charCodeAt(0), r: 10, fill: '#fff' } });
  ops.setKeys(base, 'b', 'y', [{ t: 0, v: 0 }, { t: 1, v: 50 }]);
  const cur = JSON.parse(JSON.stringify(base));
  const N = (id) => cur.nodes.find((n) => n.id === id);
  N('a').props.x = 400; N('a').props.fill = '#f00';            // правка свойств
  delete N('c').props.fill;                                     // удаление свойства
  N('b').keys.y.push({ t: 2, v: 0 });                           // ключ
  cur.nodes = cur.nodes.filter((n) => n.id !== 'd');            // удаление узла
  const ni = cur.nodes.indexOf(N('a'));
  cur.nodes.splice(ni + 1, 0, { id: 'new1', type: 'rect', parent: 'g', props: { x: 5, fill: '#0f0' } }); // новый узел после a
  const cn = cur.nodes.splice(cur.nodes.indexOf(N('c')), 1)[0]; cur.nodes.splice(cur.nodes.indexOf(N('a')), 0, cn); // c перед a
  cur.background = '#202020';
  const ed = diffScenes(base, cur);
  const { scene: back, warnings } = applyEdits(base, ed);
  ok(JSON.stringify(back) === JSON.stringify(cur), 'apply(diff) == правленая сцена');
  ok(warnings.length === 0, 'без предупреждений: ' + warnings.join('; '));
  ok(editsCount(ed) === 6, 'считается 6 правок: ' + editsCount(ed));
  ok(editsEmpty(diffScenes(base, JSON.parse(JSON.stringify(base)))), 'без изменений — пустые правки');

  // скрипт пересобрал сцену: новые узлы, изменённые значения — правки ложатся сверху
  const rebuilt = JSON.parse(JSON.stringify(base));
  rebuilt.nodes.find((n) => n.id === 'b').props.r = 30;                           // скрипт поменял не тронутое свойство
  rebuilt.nodes.find((n) => n.id === 'a').props.x = 120;                          // и тронутое
  rebuilt.nodes.push({ id: 'e', type: 'circle', parent: 'g', props: { r: 4 } }); // новый узел скрипта
  const r2 = applyEdits(rebuilt, ed);
  const R = (id) => r2.scene.nodes.find((n) => n.id === id);
  ok(R('b').props.r === 30, 'изменение скрипта видно');
  ok(R('a').props.x === 400, 'правка пережила пересборку');
  ok(!!R('e') && !R('d'), 'новый узел скрипта на месте, удалённый — удалён');
  ok(r2.warnings.some((w) => w.includes('«a».x')), 'предупреждение: скрипт поменял правленое значение');
  // id сдвинулись: на месте «a» теперь другой тип
  const shifted = JSON.parse(JSON.stringify(base)); shifted.nodes.find((n) => n.id === 'a').type = 'rect';
  ok(applyEdits(shifted, ed).warnings.some((w) => w.includes('правка не применена')), 'сменился тип — правка пропущена с предупреждением');
  ok(validateScene(back).length === 0, 'результат проходит проверку');
}

/* ---------- свет ---------- */
section('свет: мировые координаты источников');
{
  const s = createScene({ width: 400, height: 300, duration: 1 });
  ops.addNode(s, { id: 'lamp', type: 'group', props: { x: 100, y: 20, scale: 2 } });
  ops.addNode(s, { id: 'L', type: 'light', parent: 'lamp', props: { x: 10, y: 5, radius: 100, energy: 0.8, color: '#ffcc88' } });
  const L = collectLights(s, 0);
  ok(L.length === 1 && near(L[0].x, 120) && near(L[0].y, 30) && near(L[0].radius, 200), 'позиция и радиус с учётом родителя');
  ok(!renderSVG(s, 0).includes('#ffcc88'), 'свет ничего не рисует');
  ok(describeScene(s).includes('Свет: источников 1'), 'сводка показывает свет');
}

/* ---------- палитра ---------- */
section('пиксельный режим: палитра');
{
  const d = new Uint8Array([250, 10, 10, 255, 20, 20, 240, 200, 120, 120, 120, 0]);
  quantizeRGBA(d, ['#ff0000', '#0000ff', '#000000']);
  ok(d[0] === 255 && d[1] === 0 && d[6] === 255 && d[7] === 255 && d[11] === 0, 'ближайшие цвета, прозрачное не трогается');
  const s = createScene({ width: 320, height: 180 });
  ops.setPixel(s, { size: 4, palette: ['#000', '#fff'] });
  ok(describeScene(s).includes('кадр 80×45'), 'сводка: размер кадра в пикселях');
  ok(renderSVG(s, 0, { crisp: true }).includes('shape-rendering="crispEdges"'), 'crisp отключает сглаживание');
}

console.log(fails ? `\n✗ провалено ${fails}, прошло ${passed}` : `\n✓ все проверки прошли (${passed})`);
process.exit(fails ? 1 : 0);
