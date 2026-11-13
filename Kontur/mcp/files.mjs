// @ts-check
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
 * Кеш содержимого файлов: по id (обычно путь) хранится только последняя версия — key (отметка fileStamp); правка
 * файла заменяет запись, а не копит в памяти все прежние версии. Не больше max записей и maxWeight суммарного
 * «веса» (weigh(value), например байты); самые давно использованные вытесняются. get → undefined, если записи нет.
 * @param {{ max?: number, maxWeight?: number, weigh?: (value: any) => number }} [opts]
 */
export function stampCache({ max = 64, maxWeight = Infinity, weigh = () => 0 } = {}) {
  const m = new Map(); // id → { key, value, w }; порядок — давность использования
  let weight = 0, last; // last — id последней записи в порядке: повторное обращение к ней (горячие циклы) не переставляет
  const drop = (id) => { const e = m.get(id); if (e) { weight -= e.w; m.delete(id); } };
  return {
    get(id, key) {
      const e = m.get(id);
      if (!e || e.key !== key) return undefined;
      if (id !== last) { m.delete(id); m.set(id, e); last = id; }
      return e.value;
    },
    set(id, key, value) {
      drop(id);
      const w = +weigh(value) || 0;
      m.set(id, { key, value, w }); weight += w; last = id;
      for (const k of m.keys()) { if ((m.size <= max && weight <= maxWeight) || k === id) break; drop(k); }
      return value;
    },
    get size() { return m.size; },
    get weight() { return weight; },
  };
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
