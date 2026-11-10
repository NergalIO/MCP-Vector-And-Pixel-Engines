/**
 * Хранилище сцены MCP-сервера: текущая сцена, файл, правки поверх сцены из скрипта, история (дельты по узлам),
 * транзакции mutate, атомарная запись. Состояние экспортируется живыми привязками (`import { scene }` всегда видит
 * актуальную сцену); менять его можно только функциями этого модуля.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, watchFile, unwatchFile, statSync, renameSync, copyFileSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScene, validateScene, validateStructure, repairScene, migrate, invalidate, evaluate, applyEdits, diffScenes, editsCount } from '../engine/kontur.js';
import { inlineAssets, mapImageSrcs, resolveSrc } from './render.mjs';
import { posixRel } from './paths.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const log = (...a) => process.stderr.write('[kontur] ' + a.join(' ') + '\n');

/* ------------------------------------------------------------------ состояние (живые привязки) */
export let scenePath = resolve(process.env.KONTUR_SCENE || 'kontur-scene.json');
export let scene = createScene();
export let rev = 0;
/** Только чтение: файл сцены есть, но не загрузился — сервер его не перезапишет, пока сцену не сохранят в другой файл. */
export let readOnly = null;
/** Что починено при загрузке (висячие ссылки и т. п.). */
export let loadNotes = [];
export let editsMode = false, editsLocked = false, base = null, editsPath = null, edits = null, editWarnings = [];
export let previewUrl = null;
export const setPreviewUrl = (u) => { previewUrl = u; };

const HISTORY_MAX = 200;
const history = [], future = [];
const listeners = new Set();
/** Подписка на изменения сцены: fn(rev, { ids }) — ids изменённых узлов (null — неизвестно/вся сцена). */
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function broadcast(info = { ids: null }) { for (const fn of listeners) { try { fn(rev, info); } catch (e) { log('подписчик:', e.message); } } }

/* ------------------------------------------------------------------ загрузка */
/** Прочитать сцену: структура проверяется, висячие ссылки чинятся (с заметками), затем полная проверка. */
export function loadFrom(p) {
  const s = JSON.parse(readFileSync(p, 'utf8'));
  // старые версии формата приводятся к текущей; висячие ссылки чинятся
  let notes = migrate(s).map((m) => `формат: миграция ${m}`);
  if (validateStructure(s).length) notes = notes.concat(repairScene(s));
  const errs = validateScene(s);
  if (errs.length) throw new Error('Сцена с ошибками:\n' + errs.join('\n'));
  if (notes.length) log(`${p}: починено при загрузке — ${notes.length}:\n  ` + notes.join('\n  '));
  Object.defineProperty(s, '__notes', { value: notes, enumerable: false, configurable: true });
  return s;
}

export const editsPathFor = (f) => f.replace(/(\.kontur)?\.json$/i, '') + '.edits.json';
export const buildScriptFor = (f) => (/\.kontur\.json$/i.test(f) ? f.replace(/\.kontur\.json$/i, '.build.mjs') : null);
function readEdits(f) { try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { log('файл правок не прочитан:', e.message); editsLocked = true; return null; } }

function setScene(s) { scene = s; resetJsonCache(); }
function clearHistory() { history.length = 0; future.length = 0; }
function dropEdits() { stopWatch(); editsMode = false; base = null; edits = null; editsPath = null; editWarnings = []; }

/** Открыть файл сцены. withEdits: 'auto' (если есть файл правок или build-скрипт рядом) | true | false. */
export function openScene(f, withEdits = 'auto') {
  const raw = loadFrom(f);
  const ep = editsPathFor(f), bs = buildScriptFor(f);
  const on = withEdits === true || (withEdits === 'auto' && (existsSync(ep) || (bs && existsSync(bs))));
  stopWatch();
  scenePath = f; editsLocked = false; readOnly = null; loadNotes = raw.__notes || []; backedUp.delete(f);
  if (on) {
    base = raw; editsPath = ep; edits = existsSync(ep) ? readEdits(ep) : null; editsMode = true;
    const r = applyEdits(base, edits);
    editWarnings = r.warnings;
    const errs = validateScene(r.scene);
    if (errs.length) { editWarnings.push('Правки ломают сцену и пока не применены (файл правок не трогается): ' + errs.slice(0, 3).join('; ')); editsLocked = true; setScene(raw); }
    else setScene(r.scene);
    startWatch();
  } else { dropEdits(); setScene(raw); }
  clearHistory();
}
/** Открыть с откатом: при ошибке остаётся прежняя сцена. Оповещает превью. */
export function openPath(f, withEdits = 'auto') {
  openScene(resolve(f), withEdits);
  invalidate(scene); rev++; broadcast();
}

/** Загрузка при старте: ошибка не теряет файл — сервер переходит в режим «только чтение» для него. */
export function initialLoad(p = scenePath) {
  scenePath = resolve(p);
  if (!existsSync(scenePath)) return;
  try { openScene(scenePath); log('загружена сцена', scenePath, editsMode ? `(правки: ${editsPath})` : ''); }
  catch (e) {
    readOnly = `файл ${scenePath} не загрузился (${e.message.split('\n')[0]}) — он не будет перезаписан; сохраните сцену в другой файл (scene_save_as) или откройте другую`;
    log('не удалось загрузить сцену:', e.message, '— режим только чтения для этого файла');
  }
}

let watching = null;
function startWatch() {
  const f = scenePath;
  let last = statSync(f).mtimeMs;
  watchFile(f, { interval: 700 }, (cur) => {
    if (!editsMode || f !== scenePath || cur.mtimeMs === last) return;
    last = cur.mtimeMs;
    setTimeout(() => reloadBase(f), 200); // файл мог ещё дописываться
  });
  watching = f;
}
export function stopWatch() { if (watching) unwatchFile(watching); watching = null; }
/** Исходная сцена пересобрана скриптом: перечитать и заново наложить правки. */
function reloadBase(f) {
  let raw;
  try { raw = loadFrom(f); } catch (e) { log('исходная сцена не прочиталась после изменения:', e.message); return; }
  base = raw;
  const r = applyEdits(base, edits);
  editWarnings = r.warnings;
  setScene(validateScene(r.scene).length ? raw : r.scene);
  clearHistory(); // история относится к прежней версии сцены
  invalidate(scene); rev++; broadcast();
  log('исходная сцена обновилась — правки наложены заново' + (editWarnings.length ? `, предупреждений: ${editWarnings.length}` : ''));
}
export function editsInfo() {
  if (!editsMode) return { mode: false };
  const ids = edits ? [...new Set([...Object.keys(edits.nodes || {}), ...(edits.removed || []), ...(edits.order || []).map((o) => o.id)])] : [];
  return { mode: true, path: editsPath, count: editsCount(edits), nodes: ids, removed: edits?.removed || [], added: (edits?.order || []).filter((o) => o.add).map((o) => o.id), scene: Object.keys(edits?.scene || {}), warnings: editWarnings, locked: editsLocked };
}
/** Сцена со сброшенными правками (всех или указанных узлов) — значения из исходной сцены. */
export function resetEdits(ids) {
  if (!editsMode) throw new Error('Сцена открыта без файла правок');
  const cur = diffScenes(base, scene);
  if (!ids || !ids.length) return applyEdits(base, null).scene;
  const kill = new Set(ids);
  for (const id of kill) delete cur.nodes[id];
  cur.removed = cur.removed.filter((id) => !kill.has(id));
  cur.order = cur.order.filter((o) => !kill.has(o.id));
  if (kill.has('__scene')) cur.scene = {};
  return applyEdits(base, cur).scene;
}

/* ------------------------------------------------------------------ растровые ассеты: пути относительно папки сцены */
export const baseDir = () => dirname(scenePath);
export const S = () => inlineAssets(scene, baseDir());
/** Ссылки на картинки растровых слоёв (src, normalSrc, heightSrc…) через fn. */
export const mapSrc = (sc, fn) => mapImageSrcs(sc, fn);
export const toAbs = (dir) => (src) => resolveSrc(src, dir) || src;
export const toRel = (dir) => (src) => {
  if (typeof src !== 'string' || !isAbsolute(src)) return src;
  const r = posixRel(dir, src);
  return r.startsWith('..') || isAbsolute(r) ? src : r;
};
export const rebase = (sc, from, to) => mapSrc(mapSrc(sc, toAbs(from)), toRel(to));

/* ------------------------------------------------------------------ запись */
const backedUp = new Set();
/**
 * Атомарная запись: во временный файл рядом, затем переименование поверх (сбой посреди записи не оставит
 * обрезанный файл). Перед первой записью в сессии прежнее содержимое копируется в <файл>.bak.
 */
export function writeAtomic(f, data) {
  mkdirSync(dirname(f), { recursive: true });
  if (!backedUp.has(f) && existsSync(f)) { try { copyFileSync(f, f + '.bak'); } catch (e) { log('не удалось сделать .bak:', e.message); } }
  backedUp.add(f);
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, f);
}
export function save() {
  try {
    if (readOnly) { log('не сохранено: ' + readOnly); return false; }
    if (!editsMode) { writeAtomic(scenePath, JSON.stringify(scene, null, 1)); return true; }
    if (editsLocked) { log('файл правок не перезаписан: он не применился к сцене'); return false; }
    const d = diffScenes(base, scene);
    // правки объектов, которых сейчас нет в исходной сцене, не теряются: скрипт мог убрать их временно
    if (edits?.nodes) { const have = new Set(base.nodes.map((n) => n.id)); for (const [id, e] of Object.entries(edits.nodes)) if (!have.has(id) && !d.nodes[id]) d.nodes[id] = e; }
    edits = d;
    editWarnings = applyEdits(base, edits).warnings;
    writeAtomic(editsPath, JSON.stringify(edits, null, 1));
    return true;
  } catch (e) { log('ошибка сохранения:', e.message); return false; }
}

/* ------------------------------------------------------------------ история: дельты по узлам */
// JSON каждого узла после последней транзакции: следующая транзакция не сериализует сцену заново, если её не меняли
let jsonCache = null; // { rev, scene, head, nodes: Map<id, json>, order: id[] }
function resetJsonCache() { jsonCache = null; }
// настройки сцены без узлов; место ключа nodes сохраняется (порядок ключей в файле не прыгает)
const headOf = (s) => JSON.stringify(s, (k, v) => (k === 'nodes' && v === s.nodes ? 0 : v));
/** Записать в объект сцены настройки head и узлы nodes, сохранив сам объект. */
function assignScene(s, head, nodes) {
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, head);
  s.nodes = nodes;
  invalidate(s);
  return s;
}
function snap(s, cached = true) {
  if (cached && jsonCache && jsonCache.rev === rev && jsonCache.scene === s && jsonCache.order.length === s.nodes.length) return jsonCache;
  const nodes = new Map(), order = [];
  for (const n of s.nodes) { nodes.set(n.id, JSON.stringify(n)); order.push(n.id); }
  return { rev, scene: s, head: headOf(s), nodes, order };
}
/** Разница двух снимков: { head?: [до, после], order?: [до, после], nodes: Map<id, [до|null, после|null]> }. */
function delta(a, b) {
  const d = { nodes: new Map() };
  if (a.head !== b.head) d.head = [a.head, b.head];
  if (a.order.length !== b.order.length || a.order.some((id, i) => id !== b.order[i])) d.order = [a.order, b.order];
  for (const [id, j] of a.nodes) { const k = b.nodes.get(id); if (k !== j) d.nodes.set(id, [j, k ?? null]); }
  for (const [id, k] of b.nodes) if (!a.nodes.has(id)) d.nodes.set(id, [null, k]);
  return d;
}
const isEmpty = (d) => !d.head && !d.order && !d.nodes.size;
/** Применить дельту к сцене в сторону side (0 — назад, 1 — вперёд). Неизменённые узлы остаются теми же объектами. */
function applyDelta(s, d, side) {
  const by = new Map(s.nodes.map((n) => [n.id, n]));
  for (const [id, pair] of d.nodes) { const j = pair[side]; if (j == null) by.delete(id); else by.set(id, JSON.parse(j)); }
  // без изменения порядка набор узлов тот же (добавление и удаление меняют порядок)
  const order = d.order ? d.order[side] : s.nodes.map((n) => n.id);
  const head = d.head ? JSON.parse(d.head[side]) : { ...s };
  // объект сцены сохраняется (кэши движка привязаны к нему через WeakMap — сбрасываются в assignScene)
  return assignScene(s, head, order.map((id) => by.get(id)).filter(Boolean));
}
const changedIds = (d) => (d.head || d.order ? null : [...d.nodes.keys()]);

/**
 * Транзакция: снимок → изменение → проверка (структура + вычисление затронутых узлов) → дельта в историю →
 * сохранение → оповещение превью. При ошибке сцена возвращается к снимку.
 */
export function mutate(label, fn) {
  const s0 = scene, before = snap(s0);
  try {
    const res = fn();
    invalidate(scene);
    const errs = validateStructure(scene);
    if (errs.length) throw new Error(errs.slice(0, 8).join('\n'));
    const after = snap(scene, false);
    const d = delta(before, after);
    const ids = changedIds(d);
    // ранняя проверка вычислением: только изменённые узлы (или вся сцена, если менялись порядок и настройки)
    const only = ids ? ids.filter((id) => after.nodes.has(id)) : undefined;
    if (!only || only.length) { evaluate(scene, 0, only ? { only } : {}); evaluate(scene, scene.duration * 0.5, only ? { only } : {}); }
    if (!isEmpty(d)) {
      history.push({ label, d }); if (history.length > HISTORY_MAX) history.shift();
      future.length = 0;
    }
    rev++; after.rev = rev; jsonCache = after;
    save(); broadcast({ ids, label });
    return res;
  } catch (e) {
    // откат: исходная сцена восстанавливается из снимка
    scene = s0;
    assignScene(s0, JSON.parse(before.head), before.order.map((id) => JSON.parse(before.nodes.get(id))));
    resetJsonCache();
    throw e;
  }
}
/** Заменить сцену целиком (как одна правка истории). */
export function replaceScene(label, s) {
  const errs = validateScene(s);
  if (errs.length) throw new Error(errs.join('\n'));
  // объект текущей сцены остаётся, меняется содержимое — дельта посчитается по узлам
  return mutate(label, () => assignScene(scene, { ...s }, s.nodes));
}
export function undo() {
  const h = history.pop();
  if (!h) return null;
  applyDelta(scene, h.d, 0); future.push(h); resetJsonCache();
  rev++; save(); broadcast({ ids: changedIds(h.d), label: 'undo' });
  return h.label;
}
export function redo() {
  const h = future.pop();
  if (!h) return null;
  applyDelta(scene, h.d, 1); history.push(h); resetJsonCache();
  rev++; save(); broadcast({ ids: changedIds(h.d), label: 'redo' });
  return h.label;
}
export const historyInfo = () => ({ undo: history.map((h) => h.label), redo: future.map((h) => h.label).reverse() });

/* ------------------------------------------------------------------ смена файла */
/** Новая пустая сцена. Если текущий файл нельзя затирать (сцена из скрипта или только чтение) — пишется рядом в scene-N.json. */
export function newScene(opts) {
  let note = '';
  if (editsMode || readOnly) {
    dropEdits(); readOnly = null;
    let i = 1, f;
    do f = resolve(dirname(scenePath), `scene-${i++}.json`); while (existsSync(f));
    scenePath = f; note = ` Файл: ${f}.`;
  }
  replaceScene('новая сцена', createScene(opts));
  return note;
}
/** Сохранить в другой файл; дальнейшее автосохранение пойдёт туда (целиком, без файла правок). */
export function saveAs(p) {
  const old = baseDir();
  dropEdits(); readOnly = null;
  scenePath = resolve(p);
  setScene(rebase(scene, old, baseDir()));
  invalidate(scene);
  const ok = save();
  rev++; broadcast();
  return ok;
}
/** Открыть пример (файл из папки движка): ассеты переводятся относительно папки текущей сцены. */
export function openExample(f) {
  const s = rebase(loadFrom(f), dirname(f), baseDir());
  replaceScene('открыть пример', s);
}
