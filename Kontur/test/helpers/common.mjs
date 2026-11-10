// Мелочи, общие для тестов и замеров.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/** Пример examples/<n>.json как объект. */
export const ex = (n) => JSON.parse(readFileSync(new URL(`../../examples/${n}.json`, import.meta.url), 'utf8'));

/** Есть растеризатор — true; нет — тест t пропущен, false. mcp/render.mjs грузится лениво: ex() нужен и замерам. */
export async function needRaster(t) {
  const { probeRaster } = await import('../../mcp/render.mjs');
  if (await probeRaster()) return true;
  t.skip('нет растеризатора');
  return false;
}

/** Запустить скрипт тем же node; ненулевой код — исключение (вывод в e.stdout / e.stderr). */
export const runNode = (script, ...args) => execFileSync(process.execPath, [script, ...args], { stdio: 'pipe' });
