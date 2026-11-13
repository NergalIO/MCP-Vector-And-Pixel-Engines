// @ts-check
// Пути и запись файлов для экспорта: корень пакета, относительный путь в POSIX-виде, запись с созданием папки.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Корень пакета Kontur (папка с engine/, mcp/, player/). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Путь to относительно from с прямыми косыми (для манифестов, res://, Unity). */
export const posixRel = (from, to) => relative(from, to).split(sep).join('/');

/** Записать файл, создав папку при необходимости. */
export function writeFileEnsured(p, data) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
}
