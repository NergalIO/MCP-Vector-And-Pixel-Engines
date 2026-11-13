#!/usr/bin/env node
// CLI: рендер сцены без MCP.
//   node scripts/render.mjs scene.json frame  <t> out.png|out.svg [width]
//   node scripts/render.mjs scene.json sheet  out.png [кадров=8]
//   node scripts/render.mjs scene.json video  out.mp4|out.gif|out.webm [fps] [width]
//   node scripts/render.mjs scene.json html   out.html
import { readFileSync, writeFileSync } from 'node:fs';
import { validateScene } from '../engine/kontur.js';
import { dirname, resolve } from 'node:path';
import { svgToPng, frameSVG, contactSheetSVG, exportVideo, standaloneHTML, inlineAssets } from '../mcp/render.mjs';

const [file, mode, ...a] = process.argv.slice(2);
if (!file || !mode) { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 7).join('\n')); process.exit(1); }
const raw = JSON.parse(readFileSync(file, 'utf8'));
const errs = validateScene(raw);
const scene = inlineAssets(raw, dirname(resolve(file)));
if (errs.length) { console.error('Ошибки сцены:\n' + errs.join('\n')); process.exit(1); }

if (mode === 'frame') {
  const [t, out, width] = a;
  const svg = frameSVG(scene, +t, width ? +width : undefined);
  writeFileSync(out, out.endsWith('.svg') ? svg : await svgToPng(svg, width ? +width : undefined));
} else if (mode === 'sheet') {
  const [out, n = 8] = a;
  const times = Array.from({ length: +n }, (_, i) => (scene.duration * i) / +n);
  const svg = contactSheetSVG(scene, times, { cols: 4 });
  writeFileSync(out, out.endsWith('.svg') ? svg : await svgToPng(svg));
} else if (mode === 'video') {
  const [out, fps, width] = a;
  const r = await exportVideo(scene, out, { fps: fps ? +fps : undefined, width: width ? +width : undefined, onProgress: (i, n) => { if (i % 30 === 0 || i === n) process.stderr.write(`\r${i}/${n}`); } });
  console.error(`\n✓ ${r.frames} кадров → ${r.path}`);
} else if (mode === 'html') {
  writeFileSync(a[0], standaloneHTML(scene));
} else { console.error('Неизвестный режим ' + mode); process.exit(1); }
console.error('✓ готово');
