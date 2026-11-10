// Видео анимированной референсной сцены: node examples/ref/anim.mjs [имя=stairs] [--width 1280] [--jobs 6]
//   [--from 0] [--to N] [--crf 18] [--force] [--no-video]
// Сцена собирается и анимируется (<имя>.anim.mjs: export T, FPS, animate), JSON пишется в <имя>.json.
// Кадры с отложенным светом считают параллельно процессы-воркеры: out/frames/<имя>/f_0000.png (готовые кадры
// пропускаются — прерванный рендер продолжается), затем ffmpeg собирает out/<имя>.mp4 (петля T секунд).
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { availableParallelism, freemem } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const name = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || 'stairs';
const width = +opt('--width', 1280);
const anim = await import(`./${name}.anim.mjs`);
const NF = Math.round(anim.T * anim.FPS);
const from = +opt('--from', 0), to = Math.min(NF, +opt('--to', NF));
const dir = resolve(here, 'out', 'frames', name);
const frame = (i) => resolve(dir, `f_${String(i).padStart(4, '0')}.png`);
const jsonPath = resolve(here, `${name}.json`);

if (args.includes('--worker')) {
  // воркер: кадры i ≡ k (mod n) из [from, to)
  const k = +opt('--worker', 0), n = +opt('--of', 1);
  const { renderLit } = await import('../../mcp/lighting.mjs');
  const { probeRaster } = await import('../../mcp/render.mjs');
  await probeRaster();
  const scene = JSON.parse(readFileSync(jsonPath, 'utf8'));
  for (let i = from; i < to; i++) {
    if (i % n !== k || (existsSync(frame(i)) && !args.includes('--force'))) continue;
    // чуть позже момента кадра: ключи hold стоят ровно на i/FPS
    const r = await renderLit(scene, i / anim.FPS + 1e-4, { width, baseDir: here, pngLevel: 1 }); // промежуточный кадр: сжатие быстрое, ffmpeg всё равно перекодирует
    writeFileSync(frame(i), r.png);
    process.stdout.write(`${i} `);
  }
  process.exit(0);
}

const t0 = Date.now();
const { makeScene } = await import('./common.mjs');
const def = (await import(`./${name}.build.mjs`)).default;
const { scene } = makeScene(def);
const info = anim.animate(scene);
writeFileSync(jsonPath, JSON.stringify(scene));
mkdirSync(dir, { recursive: true });
// воркеров — по ядрам и памяти (кадр 1280 ≈ 1.5 ГБ на процесс)
const jobs = +opt('--jobs', Math.max(1, Math.min(availableParallelism() - 2, Math.floor(freemem() / 1.6e9), 8)));
console.log(`${name}: ${NF} кадров (${anim.T} с × ${anim.FPS} к/с), ветер на ${info.wind} узлах, кадры ${from}…${to - 1}, воркеров ${jobs}`);
const todo = Array.from({ length: to - from }, (_, j) => from + j).filter((i) => args.includes('--force') || !existsSync(frame(i))).length;
// кадры уже параллельны по процессам: пулу потоков каждого — своя доля ядер (иначе jobs × ядра потоков)
const childEnv = { ...process.env, KONTUR_THREADS: process.env.KONTUR_THREADS || String(Math.max(1, Math.floor(availableParallelism() / jobs))) };
let done = 0;
await Promise.all(Array.from({ length: jobs }, (_, k) => new Promise((ok, fail) => {
  const p = spawn(process.execPath, [fileURLToPath(import.meta.url), name, '--worker', String(k), '--of', String(jobs), '--width', String(width), '--from', String(from), '--to', String(to), ...(args.includes('--force') ? ['--force'] : [])], { stdio: ['ignore', 'pipe', 'inherit'], env: childEnv });
  p.stdout.on('data', (b) => {
    done += String(b).trim().split(/\s+/).filter(Boolean).length;
    const el = (Date.now() - t0) / 1000;
    process.stdout.write(`\r  кадров ${done}/${todo}, ${el.toFixed(0)} с, осталось ≈${done ? ((el / done) * (todo - done)).toFixed(0) : '?'} с   `);
  });
  p.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`воркер ${k}: код ${code}`))));
})));
console.log(`\n  кадры готовы за ${((Date.now() - t0) / 1000).toFixed(0)} с`);
if (!args.includes('--no-video') && from === 0 && to === NF) {
  const mp4 = resolve(here, 'out', `${name}.mp4`);
  await new Promise((ok, fail) => {
    const p = spawn('ffmpeg', ['-y', '-v', 'error', '-framerate', String(anim.FPS), '-i', resolve(dir, 'f_%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', opt('--crf', '18'), '-preset', 'slow', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg: код ${code}`))));
  });
  console.log(`  видео: ${mp4}`);
}
