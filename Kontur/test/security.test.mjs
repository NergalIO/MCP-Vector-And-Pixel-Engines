// Безопасность: валидация сцены, политика JS-выражений, пределы памяти, ассеты, экспорт без удаления чужих файлов,
// CSP превью и проверка аргументов инструментов. Экранирование в студии проверяет CSP (встроенные обработчики
// запрещены) и сквозной прогон в браузере; здесь — всё, что проверяется без браузера.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { createScene, ops, evaluate, validateStructure, compileExpr, trustExpr, untrustAllExpr, untrustedExprs, exprPolicy } from '../engine/kontur.js';
import { checkArgs } from '../mcp/schema_check.mjs';
import { checkRaster, MAX_SIDE } from '../mcp/limits.mjs';
import { decodePNG, crc32 } from '../mcp/normals.mjs';
import { resolveSrc, inlineAssets, fileToDataURI } from '../mcp/render.mjs';
import { EXPORT_LIST } from '../mcp/export_dir.mjs';
import { needRaster } from './helpers/common.mjs';
import { startServer, txt } from './helpers/mcp-child.mjs';

const tmp = (p) => mkdtempSync(join(tmpdir(), `kontur-${p}-`));
/** Маленькая сцена: один красный квадрат. */
function square() {
  const s = createScene({ width: 64, height: 64, duration: 1 });
  ops.addNode(s, { id: 'r', type: 'rect', props: { x: 32, y: 32, width: 20, height: 20, fill: '#ff0000' } });
  return s;
}

test('валидатор: id — строка, start/end клипа и размеры сцены — числа', () => {
  const a = createScene();
  a.nodes.push({ id: 5, type: 'rect' });
  assert.match(validateStructure(a).join('\n'), /id узла должен быть строкой/);
  // строки проходили сравнение end > start и попадали в разметку студии
  const b = createScene();
  b.clips = [{ name: 'x', start: '"><img src=x onerror=alert(1)>', end: 'z' }];
  assert.match(validateStructure(b).join('\n'), /start и end должны быть числами/);
  assert.match(validateStructure(createScene({ width: '9' })).join('\n'), /scene\.width должен быть числом/);
  assert.deepEqual(validateStructure(square()), []);
});

test('expr: JS из сцены не исполняется без доверия, доверие — к точному тексту кода', (t) => {
  if (exprPolicy().allowJS) return t.skip('KONTUR_TRUST_EXPR=1 в окружении');
  const code = 'let s = 0; for (let k = 0; k < 4; k++) s += k; return s;';
  const s = square();
  s.nodes[0].mods = [{ type: 'expr', prop: 'x', code }];
  try {
    assert.ok(compileExpr(code).disabled, 'недоверенный JS выключен');
    assert.throws(() => compileExpr(code, { strict: true }), /JS-выражения выключены/);
    assert.deepEqual(untrustedExprs(s), [code]);
    trustExpr(untrustedExprs(s));
    assert.equal(compileExpr(code)(0, 0, {}, 0, {}), 6);
    assert.deepEqual(untrustedExprs(s), []);
    assert.ok(compileExpr(code + ' ').disabled, 'изменённый код снова выключен');
  } finally { untrustAllExpr(); }
  assert.ok(compileExpr(code).disabled);
  // безопасное подмножество: строка не растёт без предела (a = a + a в коде повторено 20 раз)
  const grow = compileExpr('let a = "xxxxxxxxxx";' + ' a = a + a;'.repeat(20), { strict: true });
  assert.throws(() => grow(0, 0, {}, 0, {}), /строка длиннее/);
});

test('пределы: размер кадра, PNG-бомба, вложенные repeat', () => {
  assert.throws(() => checkRaster(MAX_SIDE + 1, 10), /больше предела/);
  assert.doesNotThrow(() => checkRaster(3840, 2160));
  // PNG 1×1, а сжатые данные распаковываются в 50 МБ
  const chunk = (type, d) => {
    const b = Buffer.alloc(12 + d.length);
    b.writeUInt32BE(d.length, 0); b.write(type, 4, 'ascii'); d.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + d.length)), 8 + d.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const bomb = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(50e6))), chunk('IEND', Buffer.alloc(0))]);
  assert.ok(bomb.length < 100e3);
  assert.throws(() => decodePNG(bomb), (e) => e.code === 'ERR_BUFFER_TOO_LARGE');
  ihdr.writeUInt32BE(100000, 0); ihdr.writeUInt32BE(100000, 4);
  assert.throws(() => decodePNG(Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))])), /больше предела/);
  // 500 × 500 × 500 копий — ошибка сразу, а не нехватка памяти
  const s = createScene();
  ops.addNode(s, { id: 'g', type: 'group', props: { repeat: { count: 500 } } });
  ops.addNode(s, { id: 'h', type: 'group', parent: 'g', props: { repeat: { count: 500 } } });
  ops.addNode(s, { id: 'r', type: 'rect', parent: 'h', props: { repeat: { count: 500 } } });
  const t0 = Date.now();
  assert.throws(() => evaluate(s, 0), /вложенные повторы/);
  assert.ok(Date.now() - t0 < 1000);
});

test('ассеты: по ссылкам из сцены читаются только картинки', () => {
  const d = tmp('assets');
  writeFileSync(join(d, 'id_rsa'), '-----BEGIN PRIVATE KEY-----');
  writeFileSync(join(d, 'notes.txt'), 'секрет');
  assert.equal(resolveSrc(join(d, 'id_rsa'), d), null);
  assert.equal(resolveSrc('notes.txt', d), null);
  const s = inlineAssets({ nodes: [{ id: 'i', type: 'image', props: { src: join(d, 'id_rsa') } }] }, d);
  assert.equal(s.nodes[0].props.src, join(d, 'id_rsa'), 'не встроено в data: URI');
  assert.throws(() => fileToDataURI(join(d, 'notes.txt')), /только картинку/);
});

test('аргументы инструментов проверяются по схеме', () => {
  const schema = { type: 'object', properties: { t: { type: 'number' }, format: { type: 'string', enum: ['png', 'svg'] }, keys: { type: 'array', items: { type: 'object', properties: { t: { type: 'number' } }, required: ['t'] } }, parent: { type: ['string', 'null'] } }, required: ['t'] };
  assert.deepEqual(checkArgs(schema, { t: 1, format: 'svg', keys: [{ t: 0 }], parent: null }), []);
  const errs = checkArgs(schema, { format: 'jpg', keys: [{ v: 1 }], parent: 3 });
  assert.equal(errs.length, 4, errs.join('\n'));
  assert.match(errs.join('\n'), /t: обязательный/);
  assert.match(errs.join('\n'), /format: допустимо/);
  assert.match(errs.join('\n'), /keys\[0\]\.t: обязательный/);
  assert.match(errs.join('\n'), /parent: нужно строка или null/);
  assert.match(checkArgs(schema, { t: '1' }).join(), /t: нужно число/);
});

test('экспорт Unity и Godot удаляет только свои файлы', async (t) => {
  if (!(await needRaster(t))) return;
  const { exportUnity } = await import('../mcp/unity.mjs');
  const { exportGodot } = await import('../mcp/godot.mjs');
  const scene = square();

  // Unity: экспорт прямо в Assets — там чужие материалы и анимации
  const u = tmp('unity');
  mkdirSync(join(u, 'Materials')); writeFileSync(join(u, 'Materials', 'Player.mat'), 'свой материал');
  mkdirSync(join(u, 'Animations')); writeFileSync(join(u, 'Animations', 'Walk.anim'), 'своя анимация');
  const r1 = await exportUnity(scene, u, {});
  assert.ok(existsSync(join(u, 'Materials', 'Player.mat')) && existsSync(join(u, 'Animations', 'Walk.anim')), 'чужие файлы на месте');
  assert.match(r1.summary, /без списка/, 'сводка предупреждает о папке без списка');
  const listPath = join(u, EXPORT_LIST);
  const list = JSON.parse(readFileSync(listPath, 'utf8'));
  assert.ok(list.files.length > 0 && list.files.every((f) => !f.startsWith('Materials/Player') && !f.startsWith('Animations/Walk')));
  // своё устаревшее удаляется; подделанная запись за пределы папки — нет
  const outside = join(u, '..', `${basename(u)}-outside.txt`);
  writeFileSync(outside, 'не трогать');
  writeFileSync(join(u, 'Layers', 'L99_old.png'), 'x');
  list.files.push('Layers/L99_old.png', `../${basename(outside)}`);
  writeFileSync(listPath, JSON.stringify(list));
  const r2 = await exportUnity(scene, u, {});
  assert.ok(!existsSync(join(u, 'Layers', 'L99_old.png')), 'устаревший свой слой удалён');
  assert.ok(existsSync(outside), 'файл вне папки экспорта не тронут');
  assert.ok(existsSync(join(u, 'Materials', 'Player.mat')) && existsSync(join(u, 'Animations', 'Walk.anim')));
  assert.doesNotMatch(r2.summary, /без списка/);

  // Godot: свои картинки пользователя в layers/ рядом со слоями экспорта
  const g = tmp('godot');
  mkdirSync(join(g, 'layers')); writeFileSync(join(g, 'layers', 'my_art.png'), 'своя картинка');
  await exportGodot(scene, g, {});
  await exportGodot(scene, g, {});
  assert.ok(existsSync(join(g, 'layers', 'my_art.png')));
  assert.ok(existsSync(join(g, 'scene.tscn')) && existsSync(join(g, EXPORT_LIST)));
});

test('превью: CSP студии и ассетов, MCP: неверные аргументы — понятная ошибка', async (t) => {
  const dir = tmp('csp');
  const scenePath = join(dir, 'scene.json');
  writeFileSync(scenePath, JSON.stringify(square()));
  writeFileSync(join(dir, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" onload="alert(1)"/>');
  const token = 'test-token-' + Date.now();
  const port = 20000 + Math.floor(Math.random() * 20000);
  const S = startServer({ env: { KONTUR_SCENE: scenePath, KONTUR_PORT: String(port), KONTUR_TOKEN: token } });
  t.after(() => S.srv.kill());
  await S.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const url = (await S.call('preview_url')).content[0].text.match(/http:\/\/\S+?\//)[0];

  const page = await fetch(url + 'player/index.html');
  const csp = page.headers.get('content-security-policy') || '';
  const html = await page.text();
  const inline = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
  const hash = `'sha256-${createHash('sha256').update(inline, 'utf8').digest('base64')}'`;
  const scriptSrc = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('script-src')) || '';
  assert.ok(scriptSrc.includes(hash), 'inline-скрипт страницы разрешён по хэшу');
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), 'встроенные обработчики запрещены');
  assert.match(csp, /frame-ancestors 'none'/);

  const asset = await fetch(url + 'asset?p=' + encodeURIComponent(join(dir, 'pic.svg')), { headers: { 'x-kontur-token': token } });
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-security-policy') || '', /sandbox/);

  const bad = await S.rpc('tools/call', { name: 'render_frame', arguments: { t: 'x', width: 'big' } });
  assert.equal(bad.result.isError, true);
  assert.match(txt(bad.result), /t: нужно число/);
  assert.match(txt(bad.result), /width: нужно число/);
});
