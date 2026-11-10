// Источники файлов сцены: data: URI или путь относительно папки сцены; отметка файла (путь + время изменения) для кешей.
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/** Байты data: URI (base64 или процентное кодирование) или null, если это не data: URI. */
export function dataURIToBuffer(uri) {
  const m = /^data:[^;,]*(;base64)?,(.*)$/s.exec(String(uri));
  if (!m) return null;
  return m[1] ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]));
}
/** data: URI из байтов; mime — тип (по умолчанию — fallback). */
export const toDataURI = (buf, mime, fallback = 'application/octet-stream') => `data:${mime || fallback};base64,${Buffer.from(buf).toString('base64')}`;

/** Байты источника src: data: URI или файл (относительный путь — от baseDir). */
export function readSrc(src, baseDir) {
  src = String(src);
  return dataURIToBuffer(src) ?? readFileSync(resolve(baseDir || '.', src));
}

/**
 * Отметка файла для ключа кеша: `путь|mtime`, без файла — `путь|missing` (missing: 'key') или null (missing: 'null').
 * throttleMs > 0 — stat не чаще раза в столько мс на путь (для вызовов из горячих циклов).
 */
const stamps = new Map();
export function fileStamp(p, { throttleMs = 0, missing = 'key' } = {}) {
  const now = throttleMs > 0 ? Date.now() : 0;
  const hit = throttleMs > 0 ? stamps.get(p) : null;
  if (hit && now - hit.at < throttleMs) return hit.key;
  let key;
  try { key = `${p}|${statSync(p).mtimeMs}`; } catch { key = missing === 'null' ? null : `${p}|missing`; }
  if (throttleMs > 0) stamps.set(p, { key, at: now });
  return key;
}
