// @ts-check
// Папка экспорта (Godot, Unity): Kontur помнит, какие файлы он в ней записал (.kontur-files.json), и перед новым
// экспортом удаляет только их. Чужие файлы в той же папке (Assets/Materials проекта Unity, свои сцены Godot) не
// трогаются никогда. Папка без списка (экспорт старой версией или чужая папка) не чистится: файлы перезаписываются.
import { readFileSync, existsSync, unlinkSync, rmdirSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { writeFileEnsured } from './paths.mjs';

/** Имя файла со списком (точка в начале: Unity и Godot такие файлы не импортируют). */
export const EXPORT_LIST = '.kontur-files.json';
const inside = (f, dir) => f.startsWith(dir + sep);
/** Файлы, которые движок кладёт рядом с нашим (Godot: X.png.import) — уходят вместе с ним. */
const SIDECARS = ['.import'];

/**
 * Удалить файлы прошлого экспорта в dir (по списку). Возвращает { removed, legacy }: legacy — списка нет, но есть
 * что-то из markers (подпапки, которые создаёт экспорт), — значит, папку заполнял старый экспорт или не Kontur, и
 * лишние файлы прошлых версий могли остаться.
 */
export function cleanExportDir(dir, { markers = [] } = {}) {
  const root = resolve(dir);
  let files;
  try { files = JSON.parse(readFileSync(join(root, EXPORT_LIST), 'utf8')).files; } catch { files = null; }
  if (!Array.isArray(files)) return { removed: 0, legacy: markers.some((m) => existsSync(join(root, m))) };
  let removed = 0;
  const dirs = new Set();
  for (const rel of files) {
    if (typeof rel !== 'string') continue;
    const f = resolve(root, rel);
    if (!inside(f, root)) continue; // список правили руками: за пределы папки экспорта не выходим
    try { unlinkSync(f); removed++; } catch {}
    for (const s of SIDECARS) try { unlinkSync(f + s); } catch {}
    for (let d = dirname(f); inside(d, root); d = dirname(d)) dirs.add(d);
  }
  // опустевшие папки — от самых глубоких
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) { try { if (!readdirSync(d).length) rmdirSync(d); } catch {} }
  return { removed, legacy: false };
}

/** Записать список файлов экспорта (только лежащие внутри dir; общие файлы вне папки не удаляются никогда). */
export function writeExportList(dir, files) {
  const root = resolve(dir);
  const rel = [...new Set(files.filter(Boolean).map((f) => resolve(f)).filter((f) => inside(f, root) && existsSync(f)).map((f) => relative(root, f).split(sep).join('/')))].sort();
  writeFileEnsured(join(root, EXPORT_LIST), JSON.stringify({ tool: 'kontur', note: 'файлы, записанные экспортом Kontur: следующий экспорт удалит только их', files: rel }, null, 1) + '\n');
  return rel.length;
}

/** Заметка для сводки экспорта о папке, которую заполнял не этот механизм. */
export const legacyNote = (dir) => `В ${dir} уже были файлы без списка ${EXPORT_LIST} (прошлый экспорт старой версией или чужие): они не удалялись, совпадающие перезаписаны. Устаревшие слои удалите вручную; со следующего экспорта Kontur убирает за собой сам.`;
