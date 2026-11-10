// Автотесты ядра: node test/engine.test.mjs
// IK, состояния, правки поверх сцены (edits), свет, палитра, кэш статичных частей, матрицы.
import {
  createScene, ops, evaluate, renderSVG, treeToString, nodeWorldMatrix, mat, collectLights,
  diffScenes, applyEdits, editsEmpty, editsCount, quantizeRGBA, validateScene, invalidate, describeScene,
  encodeNormal, encodePlaneD, resolveSurface, surfaceAxes, encodeMatId, materialIndex, cameraModel, makeRng,
} from '../engine/kontur.js';
import * as W3 from '../engine/world3d.js';

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

/* ---------- 2.5D: проходы отложенного света ---------- */
section('2.5D: кодирование, наследование поверхности, проходы');
{
  ok(encodeNormal([0, 0, -1]) === '#8080' + '00' && encodeNormal([1, 0, 0]) === '#ff8080', 'нормаль → rgb((n·0.5+0.5)·255)');
  const pd = encodePlaneD(-9, 0.5);
  const q = Math.round((-9 + 200) * 100);
  ok(pd === '#' + (q >> 8).toString(16).padStart(2, '0') + (q & 255).toString(16).padStart(2, '0') + '80', 'planeD: d в 16 бит (R,G), блик в B');
  const wall = resolveSurface(null, { plane: [0, 0, -1, -9], spec: 0.3, base: true, emissive: '#ff0000' });
  ok(wall.normal.join() === '0,0,-1' && wall.base && !wall.bump, 'грань: нормаль из плоскости, base');
  const brick = resolveSurface(wall, { tilt: [1, 0, 1] });
  ok(brick.plane[3] === -9 && brick.spec === 0.3 && brick.emissive === '#ff0000' && !brick.base && brick.bump, 'деталь наследует plane/spec/emissive, но не base; tilt делает её bump');
  ok(brick.normal[0] > 0.5 && brick.normal[2] < -0.5, 'tilt наклоняет нормаль по оси u грани');
  ok(resolveSurface(wall, false) === null && resolveSurface(null, undefined) === null, 'surface: false снимает поверхность');
  const ax = surfaceAxes([0, 1, 0]);
  ok(ax.u.join() === '1,0,0' && ax.v.join() === '0,0,1', 'оси пола: u = X, v = Z');

  const s = createScene({ width: 200, height: 100, background: '#123456' });
  s.nodes.push(
    { id: 'face', type: 'group', props: { surface: { plane: [0, 0, -1, -5], base: true, spec: 0.2, emissive: '#00ff00' } } },
    { id: 'body', type: 'rect', parent: 'face', props: { x: 0, y: 0, width: 200, height: 100, fill: '#aaaaaa', surface: { base: true } } },
    { id: 'det', type: 'rect', parent: 'face', props: { x: 10, y: 10, width: 20, height: 20, fill: '#bbbbbb', surface: { tilt: [0, 1, 1] } } },
    { id: 'thin', type: 'rect', parent: 'face', props: { x: 50, y: 10, width: 0.1, height: 20, fill: '#cccccc', surface: { base: true } } },
    { id: 'chr', type: 'rect', props: { x: 120, y: 20, width: 30, height: 60, fill: '#dd0000', opacity: 0.5, surface: { tag: 'chr', normal: [0, 0, -1] } } },
    { id: 'free', type: 'circle', props: { x: 180, y: 50, r: 8, fill: '#ffffff' } },
    { id: 'blend', type: 'rect', props: { x: 0, y: 0, width: 50, height: 50, fill: '#ffffff', blend: 'screen' } },
  );
  const color = renderSVG(s, 0);
  ok(color.includes('fill-opacity="0.5"') && !/<rect[^>]*\sopacity="0.5"/.test(color), 'одиночная фигура: fill-opacity вместо opacity (нет швов)');
  ok(!color.includes('#cccccc'), 'вырожденная фигура (0.1 px) отбрасывается');
  const nrm = renderSVG(s, 0, { mode: 'normal' });
  ok(nrm.includes(encodeNormal([0, 0, -1])) && !nrm.includes('#123456') && !nrm.includes('#aaaaaa'), 'normal: цвета — нормали, фона нет');
  ok(!nrm.includes('mix-blend-mode') && !/r="8"/.test(nrm), 'normal: узлы без поверхности и наложения не пишутся');
  const pdS = renderSVG(s, 0, { mode: 'planeD' });
  ok(pdS.includes(encodePlaneD(-5, 0.2)), 'planeD: d и блик грани');
  const em = renderSVG(s, 0, { mode: 'emissive' });
  ok(em.includes('#00ff00') && em.includes('#000000'), 'emissive: свечение грани на чёрном');
  const mk = renderSVG(s, 0, { mode: 'mask:chr' });
  ok(mk.includes('#ffffff') && mk.includes('#000000'), 'mask:chr: метка белым, тела чёрным');
  const cov = renderSVG(s, 0, { mode: 'cover' });
  ok(cov.includes('#ffffff'), 'cover: покрытие');
  let threw = false; try { renderSVG(s, 0, { mode: 'bogus' }); } catch { threw = true; }
  ok(threw, 'неизвестный режим — ошибка');
}

section('2.5D: world3d — камера, сборка мира, узлы');
{
  const cam = W3.camera({ hor: 200, f: 1000, camH: 2, dz: 0, cx: 500 }, 1000);
  const p = cam.P([1, 0, 10]);
  ok(near(p[0], 600) && near(p[1], 400), 'проекция P = [cx + f·X/(Z+dz), hor + f·(camH−Y)/(Z+dz)]');
  const un = W3.unproject(cam, 600, 400, [0, 1, 0, 0]);
  ok(un && near(un[0], 1) && near(un[2], 10) && near(un[1], 0), 'unproject на плоскость пола');
  const fc = W3.fitCamera({ width: 1920, height: 1080, hor: 300, charPx: 260 });
  ok(near(fc.camH, (1.7 * (1080 - 300)) / 260), 'fitCamera: camH = 1.7·(bottom−hor)/charPx');
  const items = [
    { type: 'ground', x: [-6, 6], z: [0, 20] },
    { type: 'house', x: [-5, -1], z: [5, 9], h: 5, mat: 'brick', litP: 1 },
    { type: 'box', x: [1, 2], y: [0, 1], z: [3, 4], mats: { front: ['wood'] } },
    { type: 'lamp', X: 2, Z: 2.5 },
    { type: 'cloud', x: 300, y: 80 },
  ];
  const a = W3.buildWorld({ width: 640, height: 360, camera3d: { hor: 120, f: 500, camH: 2.5, dz: 2 }, seed: 7, items });
  const b = W3.buildWorld({ width: 640, height: 360, camera3d: { hor: 120, f: 500, camH: 2.5, dz: 2 }, seed: 7, items });
  ok(!a.errors.length && JSON.stringify(a.S.items.map((i) => i.prims)) === JSON.stringify(b.S.items.map((i) => i.prims)), 'сборка детерминирована по seed');
  const c = W3.buildWorld({ width: 640, height: 360, camera3d: { hor: 120, f: 500, camH: 2.5, dz: 2 }, seed: 8, items });
  ok(JSON.stringify(a.S.items.map((i) => i.prims)) !== JSON.stringify(c.S.items.map((i) => i.prims)), 'другой seed — другие детали');
  ok(a.S.lights.length >= 1 && a.S.occ.length >= 2, 'фонарь дал источник, коробки — окклюдеры');
  const bad = W3.buildWorld({ width: 640, height: 360, items: [{ type: 'window' }, { type: 'zzz' }] });
  ok(bad.errors.length === 2, 'ошибки объектов собираются, а не роняют сборку');
  const r = W3.toNodes(a.S, { group: 'w', idPrefix: 'w_' });
  const ids = new Set(r.nodes.map((n) => n.id));
  ok(ids.size === r.nodes.length && r.nodes.every((n) => !n.parent || ids.has(n.parent)), 'узлы: уникальные id, родители на месте');
  ok(r.nodes.some((n) => n.props?.occluder?.boxes?.length) && r.nodes.some((n) => n.type === 'light' && Array.isArray(n.props.p3)), 'узлы: окклюдеры и свет с p3');
  ok(r.nodes.some((n) => n.props?.surface?.sky), 'небо помечено surface.sky');
  const sc = { ...createScene({ width: 640, height: 360 }), camera3d: { hor: 120, f: 500, camH: 2.5, dz: 2, cx: 320 }, nodes: r.nodes };
  ok(validateScene(sc).length === 0, 'сцена из мира проходит проверку');
  const lights = collectLights(sc, 0), L = lights.find((l) => l.group === 'lamp');
  const pp = W3.camera(sc.camera3d, 640).P(L.p3);
  ok(L && near(L.x, pp[0], 0.01) && near(L.y, pp[1], 0.01) && L.radius3 > 0 && lights.some((l) => l.group === 'window'), 'свет с p3 проецируется камерой сцены, окна — группа window');
  const nm = renderSVG(sc, 0, { mode: 'normal' });
  ok(nm.length > 1000 && !nm.includes('NaN'), 'проход normal мира без NaN');
}

/* ---------- этапы roadmap 2.5D: гладкие нормали, материалы, BVH, камера ---------- */
section('2.5D: normalGrad, lathe, matId, BVH, cameraModel');
{
  const { probeRaster, svgToPng, canPng } = await import('../mcp/render.mjs');
  const { decodePNG } = await import('../mcp/normals.mjs');
  const { buildBVH, bruteOccluded } = await import('../mcp/bvh.mjs');
  await probeRaster();
  const angle = (a, b) => { const la = Math.hypot(...a), lb = Math.hypot(...b); return (Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb)))) * 180) / Math.PI; };
  const dec = (im, x, y) => { const o = (y * im.width + x) * 4; return [im.data[o] / 127.5 - 1, im.data[o + 1] / 127.5 - 1, im.data[o + 2] / 127.5 - 1]; };

  if (canPng()) {
    // сфера градиентом нормали: декодированная нормаль в каждой точке ≤ 2° от аналитической
    const s = createScene({ width: 256, height: 256 });
    ops.addNode(s, { id: 'b', type: 'ellipse', props: { x: 128, y: 128, rx: 100, ry: 100, fill: '#ffffff', surface: { plane: [0, 0, -1, -5], base: true, normalGrad: { kind: 'sphere', c: [0, 0], r: 100 } } } });
    const im = decodePNG(await svgToPng(renderSVG(s, 0, { mode: 'normal' }), 256));
    let worst = 0, cnt = 0;
    for (let y = -90; y <= 90; y += 5) for (let x = -90; x <= 90; x += 5) {
      const dx = (x + 0.5) / 100, dy = (y + 0.5) / 100, r2 = dx * dx + dy * dy;
      if (r2 > 0.81) continue;
      const n = dec(im, 128 + x, 128 + y);
      worst = Math.max(worst, angle(n, [dx, -dy, -Math.sqrt(1 - r2)])); cnt++;
    }
    ok(cnt > 900 && worst <= 2, `normalGrad сферы: худшая ошибка ${worst.toFixed(2)}° (≤ 2°) на ${cnt} точках`);

    // тело вращения (cyl → lathe): нормаль поперёк цилиндра гладкая и совпадает с аналитической
    const cam = { hor: 100, f: 400, camH: 1, dz: 2 };
    const wb = W3.buildWorld({ width: 400, height: 300, camera3d: cam, seed: 1, items: [{ type: 'cyl', X: 0, Z: 4, r: 1, y: [0, 2], color: '#c0a080', n: 24 }] });
    const sc = W3.toScene(wb.S, {});
    const ni = decodePNG(await svgToPng(renderSVG(sc, 0, { mode: 'normal' }), 400));
    const C = W3.camera(sc.camera3d, 400);
    let wl = 0;
    for (const a of [-0.8, -0.5, -0.2, 0, 0.3, 0.6, 0.8]) {
      const p = [a, 1, 4 - Math.sqrt(1 - a * a)], [px, py] = C.P(p);
      const v = [p[0] - C.pos[0], p[1] - C.pos[1], p[2] - C.pos[2]];
      // нормаль поверхности цилиндра; в точке силуэта её проекция на луч зрения меняет оценку — берём видимые точки
      if (v[0] * a + v[2] * (p[2] - 4) > 0) continue;
      wl = Math.max(wl, angle(dec(ni, Math.floor(px), Math.floor(py)), [a, 0, p[2] - 4]));
    }
    ok(wl <= 4, `lathe: нормаль цилиндра гладкая, худшая ошибка ${wl.toFixed(2)}° (≤ 4°)`);

    // проход matId: номер материала по scene.materials в R·256 + G
    const sm = { ...createScene({ width: 64, height: 64 }), materials: { a: { noise: {} }, b: { grime: {} } } };
    ops.addNode(sm, { id: 'r', type: 'rect', props: { x: 32, y: 32, width: 64, height: 64, fill: '#808080', surface: { plane: [0, 1, 0, 0], base: true, mat: 'b' } } });
    const mi = decodePNG(await svgToPng(renderSVG(sm, 0, { mode: 'matId' }), 64));
    const o = (32 * 64 + 32) * 4;
    ok(((mi.data[o] << 8) | mi.data[o + 1]) === 2 && mi.data[o + 3] === 255, 'matId: материал b → номер 2');
  }
  ok(encodeMatId(1) === '#000100' && encodeMatId(258) === '#010200' && materialIndex({ materials: { x: {}, y: {} } }).get('y') === 2, 'encodeMatId / materialIndex');

  // BVH против перебора: 10 000 лучей, треугольники с коробками
  const rnd = makeRng(11);
  const tris = [], boxes = [];
  for (let i = 0; i < 1500; i++) { const c = [rnd() * 20 - 10, rnd() * 6, rnd() * 20]; tris.push([0, 1, 2].map(() => [c[0] + rnd() - 0.5, c[1] + rnd() - 0.5, c[2] + rnd() - 0.5])); }
  for (let i = 0; i < 60; i++) { const x = rnd() * 20 - 10, y = rnd() * 4, z = rnd() * 20; boxes.push([x, x + rnd() * 1.5, y, y + rnd() * 1.5, z, z + rnd() * 1.5]); }
  const bvh = buildBVH({ boxes, tris });
  let mism = 0, hits = 0;
  for (let i = 0; i < 10000; i++) {
    const o = [rnd() * 24 - 12, rnd() * 6, rnd() * 24 - 2];
    let d = [rnd() - 0.5, rnd() - 0.3, rnd() - 0.5]; const l = Math.hypot(...d); d = d.map((v) => v / l);
    const tm = rnd() < 0.3 ? 2 + rnd() * 5 : 1e9;
    const a = bvh.occluded(...o, ...d, tm), b = bruteOccluded({ boxes, tris }, ...o, ...d, tm);
    if (a !== b) mism++; if (b) hits++;
  }
  ok(mism === 0 && hits > 1000, `BVH = перебор на 10 000 лучах (попаданий ${hits}, расхождений ${mism})`);
  const tc = bvh.closest(0, 3, -50, 0, 0, 1);
  ok(tc === Infinity || tc > 0, 'BVH closest: расстояние до ближайшего попадания');

  // камера: без поворота — прежняя формула; с поворотом — луч и проекция согласованы; keepVerticals — вертикали вертикальны
  const c0 = cameraModel({ hor: 200, f: 900, camH: 3, dz: 2 }, 1280);
  const p0 = [1.3, 0.7, 6];
  ok(c0.plain && near(c0.P(p0)[0], 640 + (900 * 1.3) / 8) && near(c0.P(p0)[1], 200 + (900 * 2.3) / 8), 'cameraModel без поворота = формула P(X,Y,Z)');
  const c1 = cameraModel({ hor: 200, f: 900, camH: 3, dz: 2, yaw: 12, pitch: -8 }, 1280);
  const rr = c1.ray(400, 300), q = c1.P([c1.pos[0] + rr[0] * 5, c1.pos[1] + rr[1] * 5, c1.pos[2] + rr[2] * 5]);
  ok(!c1.plain && near(q[0], 400, 1e-6) && near(q[1], 300, 1e-6), 'cameraModel с yaw/pitch: P(луч(x, y)) = (x, y)');
  const c2 = cameraModel({ hor: 200, f: 900, camH: 3, dz: 2, yaw: 15, pitch: 10, keepVerticals: true }, 1280);
  ok(near(c2.P([2, 0, 7])[0], c2.P([2, 5, 7])[0], 1e-6) && c2.horEff > 200, 'keepVerticals: вертикаль остаётся вертикалью, горизонт сдвинут');
}

console.log(fails ? `\n✗ провалено ${fails}, прошло ${passed}` : `\n✓ все проверки прошли (${passed})`);
process.exit(fails ? 1 : 0);
