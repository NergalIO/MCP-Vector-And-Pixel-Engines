// End-to-end smoke test: drives the MCP server over stdio against a throwaway server instance.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { decodePng } from '../src/png.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelforge-test-'));
const PORT = 7499;
const env = { ...process.env, PIXELFORGE_PORT: String(PORT), PIXELFORGE_DATA: path.join(tmp, 'sprites') };
const outDir = process.argv[2] || tmp;

const mcp = spawn(process.execPath, [path.join(ROOT, 'src', 'mcp.js')], { env, stdio: ['pipe', 'pipe', 'inherit'] });
const pending = new Map();
let nextId = 1;
readline.createInterface({ input: mcp.stdout }).on('line', (l) => {
  const m = JSON.parse(l);
  pending.get(m.id)?.(m);
});
const rpc = (method, params) => new Promise((res) => {
  const id = nextId++;
  pending.set(id, res);
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
async function tool(name, args) {
  const r = await rpc('tools/call', { name, arguments: args });
  if (r.error || r.result.isError) throw new Error(`${name}: ${JSON.stringify(r.error || r.result.content)}`);
  return r.result.content;
}
const text = (c) => c.find((x) => x.type === 'text')?.text;

try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
  assert.equal(init.result.serverInfo.name, 'pixelforge');
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const { result: { tools } } = await rpc('tools/list', {});
  console.log(`tools: ${tools.length} → ${tools.map((t) => t.name).join(', ')}`);

  const meta = JSON.parse(text(await tool('create_sprite', { name: 'Slime', width: 16, height: 16, layers: ['body', 'fx'] })));
  assert.equal(meta.id, 'slime');

  await tool('draw_ellipse', { sprite: 'slime', x: 2, y: 6, width: 12, height: 9, color: '#00e436', filled: true });
  await tool('draw_ascii', {
    sprite: 'slime', x: 5, y: 9,
    rows: ['W.W.', 'K.K.'],
    legend: { W: '#ffffff', K: '#000000' },
  });
  await tool('outline', { sprite: 'slime', color: '#1d2b53' });
  await tool('draw_pixels', { sprite: 'slime', layer: 'fx', pixels: [[3, 3, '#ffec27'], [12, 2, '#ffec27']] });
  await tool('manage_frames', { sprite: 'slime', action: 'add', copy_from: 0, count: 3 });
  await tool('transform', { sprite: 'slime', action: 'shift', frame: 1, dy: 1 });
  await tool('transform', { sprite: 'slime', action: 'flip', frame: 2, layer: 'fx' });
  await tool('manage_frames', { sprite: 'slime', action: 'duration', duration: 150 });
  await tool('set_tags', { sprite: 'slime', tags: [{ name: 'idle', from: 0, to: 1 }, { name: 'hop', from: 2, to: 3 }] });

  const ascii = text(await tool('read_pixels', { sprite: 'slime', frame: 0 }));
  console.log(ascii);
  assert.match(ascii, /legend/);

  const prev = await tool('preview', { sprite: 'slime', mode: 'sheet', grid: true });
  const img = prev.find((c) => c.type === 'image');
  fs.writeFileSync(path.join(outDir, 'smoke_preview.png'), Buffer.from(img.data, 'base64'));
  const decoded = decodePng(Buffer.from(img.data, 'base64'));
  console.log(`preview ${decoded.width}x${decoded.height}`);

  const exp = text(await tool('export', { sprite: 'slime', path: path.join(tmp, 'out'), format: 'sheet' }));
  const sheet = decodePng(fs.readFileSync(path.join(tmp, 'out', 'slime.png')));
  assert.equal(sheet.width, 64); assert.equal(sheet.height, 16);
  const sheetJson = JSON.parse(fs.readFileSync(path.join(tmp, 'out', 'slime.json'), 'utf8'));
  assert.equal(sheetJson.frames.length, 4);
  assert.equal(sheetJson.tags[1].name, 'hop');
  console.log(exp);
  await tool('export', { sprite: 'slime', path: path.join(tmp, 'out', 'slime_anim.png'), format: 'apng', scale: 4 });
  await tool('export', { sprite: 'slime', path: path.join(tmp, 'out', 'frames'), format: 'frames', tag: 'hop' });
  assert.ok(fs.existsSync(path.join(tmp, 'out', 'frames', 'slime_3.png')));

  const imp = JSON.parse(text(await tool('import_png', { path: path.join(tmp, 'out', 'slime.png'), name: 'slime reimport', frame_width: 16, frame_height: 16 })));
  assert.equal(imp.frames, 4);
  const a = text(await tool('read_pixels', { sprite: 'slime', frame: 1 }));
  const b = text(await tool('read_pixels', { sprite: imp.id, frame: 1 }));
  assert.equal(a.split('\n').slice(2).join('\n'), b.split('\n').slice(2).join('\n'));

  await tool('clear', { sprite: 'slime', frame: 3 });
  const undo = JSON.parse(text(await tool('undo', { sprite: 'slime' })));
  assert.equal(undo.undone, 1);
  const bad = await rpc('tools/call', { name: 'fill', arguments: { sprite: 'nope', x: 0, y: 0, color: '#fff' } });
  assert.equal(bad.result.isError, true);

  console.log('SMOKE TEST PASSED');
} finally {
  try {
    const h = await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json();
    process.kill(h.pid);
  } catch {}
  mcp.kill();
}
