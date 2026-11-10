// Пути и запись файлов для экспорта: относительный путь в POSIX-виде, запись с созданием папки.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, sep } from 'node:path';

/** Путь to относительно from с прямыми косыми (для манифестов, res://, Unity). */
export const posixRel = (from, to) => relative(from, to).split(sep).join('/');

/** Записать файл, создав папку при необходимости. */
export function writeFileEnsured(p, data) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
}
