// @ts-check
/**
 * Сессия MCP-сервера: открытая сцена и её файл, правки поверх сцены из скрипта, история (дельты по узлам),
 * транзакции mutate, отложенная атомарная запись, подписчики на изменения (превью).
 *
 * Всё состояние — в экземпляре Session: инструменты получают сессию явно (tools/index.mjs), поэтому в одном процессе
 * может быть несколько независимых сессий (тесты), а состояние не прячется в переменных модулей. Поля сессии
 * читаются напрямую (session.scene, session.scenePath…), меняются — только её методами.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, watchFile, unwatchFile, statSync, renameSync, copyFileSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { createScene, validateScene, validateStructure, repairScene, migrate, invalidate, evaluate, applyEdits, diffScenes, editsCount } from '../engine/kontur.js';
import { inlineAssets, mapImageSrcs, resolveSrc } from './render.mjs';
import { posixRel } from './paths.mjs';
import { log } from './log.mjs';

/** @typedef {Record<string, any>} Scene  сцена Kontur (формат — docs/scene.schema.json) */
/** @typedef {{ ids: string[] | null, label?: string }} ChangeInfo  ids изменённых узлов (null — неизвестно или вся сцена) */

const HISTORY_MAX = 200;
const SAVE_MAX_WAIT = 2000;
/** Задержка отложенной записи по умолчанию (мс): KONTUR_SAVE_DELAY, 0 — писать на каждой правке. */
const envSaveDelay = () => Math.max(0, Number(process.env.KONTUR_SAVE_DELAY ?? 300) || 0);

/* ------------------------------------------------------------------ файлы сцен */
/**
 * Прочитать сцену: структура проверяется, висячие ссылки чинятся (с заметками), затем полная проверка.
 * Заметки о починке — в неперечисляемом поле __notes.
 * @param {string} p
 * @returns {Scene}
 */
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
/** Файл правок для сцены: room.kontur.json → room.edits.json. @param {string} f */
export const editsPathFor = (f) => f.replace(/(\.kontur)?\.json$/i, '') + '.edits.json';
/** Скрипт, который собирает сцену: room.kontur.json → room.build.mjs (у других имён — null). @param {string} f */
export const buildScriptFor = (f) => (/\.kontur\.json$/i.test(f) ? f.replace(/\.kontur\.json$/i, '.build.mjs') : null);

/**
 * Атомарная запись: во временный файл рядом, затем переименование поверх (сбой посреди записи не оставит
 * обрезанный файл). Перед первой записью в файл (по набору backedUp) прежнее содержимое копируется в <файл>.bak.
 * @param {string} f @param {string} data @param {Set<string>} [backedUp]
 */
export function writeAtomic(f, data, backedUp = new Set()) {
  mkdirSync(dirname(f), { recursive: true });
  if (!backedUp.has(f) && existsSync(f)) { try { copyFileSync(f, f + '.bak'); } catch (e) { log('не удалось сделать .bak:', e.message); } }
  backedUp.add(f);
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, f);
}

/* ------------------------------------------------------------------ растровые ассеты: пути относительно папки сцены */
/** Ссылки на картинки растровых слоёв (src, normalSrc, heightSrc…) через fn. @type {(sc: Scene, fn: (src: any) => any) => Scene} */
export const mapSrc = (sc, fn) => mapImageSrcs(sc, fn);
/** Ссылка → абсолютный путь (если это локальная картинка). @param {string} dir */
export const toAbs = (dir) => (/** @type {any} */ src) => resolveSrc(src, dir) || src;
/** Абсолютный путь внутри dir → относительный (с прямыми косыми); остальное — как есть. @param {string} dir */
export const toRel = (dir) => (/** @type {any} */ src) => {
  if (typeof src !== 'string' || !isAbsolute(src)) return src;
  const r = posixRel(dir, src);
  return r.startsWith('..') || isAbsolute(r) ? src : r;
};
/** Ссылки на картинки, заданные относительно from, — относительно to. @type {(sc: Scene, from: string, to: string) => Scene} */
export const rebase = (sc, from, to) => mapSrc(mapSrc(sc, toAbs(from)), toRel(to));

/* ------------------------------------------------------------------ история: дельты по узлам */
/** @typedef {{ rev: number, scene: Scene, head: string, nodes: Map<string, string>, order: string[] }} Snap */
/** @typedef {{ head?: [string, string], order?: [string[], string[]], nodes: Map<string, [string | null, string | null]> }} Delta */

// настройки сцены без узлов; место ключа nodes сохраняется (порядок ключей в файле не прыгает)
const headOf = (/** @type {Scene} */ s) => JSON.stringify(s, (k, v) => (k === 'nodes' && v === s.nodes ? 0 : v));
/** Записать в объект сцены настройки head и узлы nodes, сохранив сам объект. @param {Scene} s @param {Scene} head @param {any[]} nodes */
function assignScene(s, head, nodes) {
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, head);
  s.nodes = nodes;
  invalidate(s);
  return s;
}
/** Разница двух снимков. @param {Snap} a @param {Snap} b @returns {Delta} */
function delta(a, b) {
  /** @type {Delta} */
  const d = { nodes: new Map() };
  if (a.head !== b.head) d.head = [a.head, b.head];
  if (a.order.length !== b.order.length || a.order.some((id, i) => id !== b.order[i])) d.order = [a.order, b.order];
  for (const [id, j] of a.nodes) { const k = b.nodes.get(id); if (k !== j) d.nodes.set(id, [j, k ?? null]); }
  for (const [id, k] of b.nodes) if (!a.nodes.has(id)) d.nodes.set(id, [null, k]);
  return d;
}
const isEmpty = (/** @type {Delta} */ d) => !d.head && !d.order && !d.nodes.size;
/**
 * Применить дельту к сцене в сторону side (0 — назад, 1 — вперёд). Неизменённые узлы остаются теми же объектами.
 * @param {Scene} s @param {Delta} d @param {0 | 1} side
 */
function applyDelta(s, d, side) {
  const by = new Map(s.nodes.map((/** @type {any} */ n) => [n.id, n]));
  for (const [id, pair] of d.nodes) { const j = pair[side]; if (j == null) by.delete(id); else by.set(id, JSON.parse(j)); }
  // без изменения порядка набор узлов тот же (добавление и удаление меняют порядок)
  const order = d.order ? d.order[side] : s.nodes.map((/** @type {any} */ n) => n.id);
  const head = d.head ? JSON.parse(d.head[side]) : { ...s };
  // объект сцены сохраняется (кэши движка привязаны к нему через WeakMap — сбрасываются в assignScene)
  return assignScene(s, head, order.map((id) => by.get(id)).filter(Boolean));
}
const changedIds = (/** @type {Delta} */ d) => (d.head || d.order ? null : [...d.nodes.keys()]);

/* ------------------------------------------------------------------ сессия */
/** Открытые сессии: при выходе процесса их несохранённые правки записываются. */
const live = new Set();
process.on('exit', () => { for (const s of live) s.flushSave(); });

export class Session {
  /** Путь к файлу сцены (туда идёт автосохранение). */
  scenePath;
  /** @type {Scene} Текущая сцена. */
  scene = createScene();
  /** Номер версии: растёт на каждом изменении. */
  rev = 0;
  /** @type {string | null} Только чтение: файл есть, но не загрузился — не перезаписывается, пока сцену не сохранят в другой. */
  readOnly = null;
  /** @type {string[]} Что починено при загрузке (висячие ссылки и т. п.). */
  loadNotes = [];
  /** Режим правок: сцена из скрипта (base) + файл правок (edits) поверх. */
  editsMode = false;
  /** Файл правок не применился к сцене — не перезаписывается. */
  editsLocked = false;
  /** @type {Scene | null} */ base = null;
  /** @type {string | null} */ editsPath = null;
  /** @type {any} */ edits = null;
  /** @type {string[]} */ editWarnings = [];
  /** @type {string | null} Адрес превью (ставит http.mjs). */
  previewUrl = null;

  /** @type {{ label: string, d: Delta }[]} */ #history = [];
  /** @type {{ label: string, d: Delta }[]} */ #future = [];
  /** @type {Set<(rev: number, info: ChangeInfo) => void>} */ #listeners = new Set();
  /** @type {Snap | null} JSON узлов после последней транзакции: следующая не сериализует сцену заново */ #jsonCache = null;
  /** @type {Set<string>} файлы, для которых в этой сессии уже сделан .bak */ #backedUp = new Set();
  /** @type {string | null} */ #watching = null;
  #saveDelay;
  #dirty = false;
  #editsStale = false;
  /** @type {NodeJS.Timeout | null} */ #saveTimer = null;
  #dirtySince = 0;

  /**
   * @param {{ scenePath?: string, saveDelay?: number }} [opts] scenePath — файл сцены (по умолчанию KONTUR_SCENE или
   *   ./kontur-scene.json); saveDelay — задержка отложенной записи, мс (по умолчанию KONTUR_SAVE_DELAY или 300).
   */
  constructor({ scenePath = process.env.KONTUR_SCENE || 'kontur-scene.json', saveDelay = envSaveDelay() } = {}) {
    this.scenePath = resolve(scenePath);
    this.#saveDelay = saveDelay;
    live.add(this);
  }
  /** Записать несохранённое, перестать следить за файлом и забыть сессию (выход процесса её больше не пишет). */
  close() { this.flushSave(); this.stopWatch(); live.delete(this); }

  /* ---------------- подписчики */
  /** Подписка на изменения сцены: fn(rev, { ids }). Возвращает отписку. @param {(rev: number, info: ChangeInfo) => void} fn */
  onChange(fn) { this.#listeners.add(fn); return () => this.#listeners.delete(fn); }
  /** @param {ChangeInfo} [info] */
  broadcast(info = { ids: null }) { for (const fn of this.#listeners) { try { fn(this.rev, info); } catch (e) { log('подписчик:', e.message); } } }
  /** @param {string | null} u */
  setPreviewUrl(u) { this.previewUrl = u; }

  /* ---------------- загрузка */
  /** @param {Scene} s */
  #setScene(s) { this.scene = s; this.#jsonCache = null; }
  #clearHistory() { this.#history.length = 0; this.#future.length = 0; }
  #dropEdits() { this.stopWatch(); this.editsMode = false; this.base = null; this.edits = null; this.editsPath = null; this.editWarnings = []; }
  /** @param {string} f */
  #readEdits(f) {
    try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { log('файл правок не прочитан:', e.message); this.editsLocked = true; return null; }
  }

  /**
   * Открыть файл сцены (без оповещения подписчиков). withEdits: 'auto' — если рядом есть файл правок или
   * build-скрипт; true — хранить правки отдельно; false — писать прямо в файл.
   * @param {string} f @param {boolean | 'auto'} [withEdits]
   */
  openScene(f, withEdits = 'auto') {
    this.flushSave(); // несохранённые правки — в прежний файл (или в этот же, если его открывают заново)
    const raw = loadFrom(f);
    this.#editsStale = false;
    const ep = editsPathFor(f), bs = buildScriptFor(f);
    const on = withEdits === true || (withEdits === 'auto' && (existsSync(ep) || !!(bs && existsSync(bs))));
    this.stopWatch();
    this.scenePath = f; this.editsLocked = false; this.readOnly = null; this.loadNotes = /** @type {any} */ (raw).__notes || []; this.#backedUp.delete(f);
    if (on) {
      this.base = raw; this.editsPath = ep; this.edits = existsSync(ep) ? this.#readEdits(ep) : null; this.editsMode = true;
      const r = applyEdits(raw, this.edits);
      this.editWarnings = r.warnings;
      const errs = validateScene(r.scene);
      if (errs.length) { this.editWarnings.push('Правки ломают сцену и пока не применены (файл правок не трогается): ' + errs.slice(0, 3).join('; ')); this.editsLocked = true; this.#setScene(raw); }
      else this.#setScene(r.scene);
      this.#startWatch();
    } else { this.#dropEdits(); this.#setScene(raw); }
    this.#clearHistory();
  }
  /** Открыть сцену и оповестить превью; при ошибке остаётся прежняя. @param {string} f @param {boolean | 'auto'} [withEdits] */
  openPath(f, withEdits = 'auto') {
    this.openScene(resolve(f), withEdits);
    invalidate(this.scene); this.rev++; this.broadcast();
  }
  /** Загрузка при старте: ошибка не теряет файл — сессия переходит в режим «только чтение» для него. @param {string} [p] */
  initialLoad(p = this.scenePath) {
    this.scenePath = resolve(p);
    if (!existsSync(this.scenePath)) return;
    try { this.openScene(this.scenePath); log('загружена сцена', this.scenePath, this.editsMode ? `(правки: ${this.editsPath})` : ''); }
    catch (e) {
      this.readOnly = `файл ${this.scenePath} не загрузился (${e.message.split('\n')[0]}) — он не будет перезаписан; сохраните сцену в другой файл (scene_save_as) или откройте другую`;
      log('не удалось загрузить сцену:', e.message, '— режим только чтения для этого файла');
    }
  }

  /* ---------------- правки поверх сцены из скрипта */
  #startWatch() {
    const f = this.scenePath;
    let last = statSync(f).mtimeMs;
    watchFile(f, { interval: 700 }, (cur) => {
      if (!this.editsMode || f !== this.scenePath || cur.mtimeMs === last) return;
      last = cur.mtimeMs;
      setTimeout(() => this.#reloadBase(f), 200); // файл мог ещё дописываться
    });
    this.#watching = f;
  }
  stopWatch() { if (this.#watching) unwatchFile(this.#watching); this.#watching = null; }
  /** Исходная сцена пересобрана скриптом: перечитать и заново наложить правки. @param {string} f */
  #reloadBase(f) {
    let raw;
    try { raw = loadFrom(f); } catch (e) { log('исходная сцена не прочиталась после изменения:', e.message); return; }
    this.#syncEdits(); // правки последних мгновений ещё не в edits: считаются от прежней исходной сцены
    this.base = raw;
    const r = applyEdits(raw, this.edits);
    this.editWarnings = r.warnings;
    this.#setScene(validateScene(r.scene).length ? raw : r.scene);
    this.#clearHistory(); // история относится к прежней версии сцены
    invalidate(this.scene); this.rev++; this.broadcast();
    log('исходная сцена обновилась — правки наложены заново' + (this.editWarnings.length ? `, предупреждений: ${this.editWarnings.length}` : ''));
  }
  /** Правки (разница исходной сцены и текущей) — пересчитываются, только если сцена менялась с прошлого раза. */
  #syncEdits() {
    if (!this.editsMode || this.editsLocked || !this.#editsStale || !this.base) return;
    this.#editsStale = false;
    const base = this.base, d = diffScenes(base, this.scene);
    // правки объектов, которых сейчас нет в исходной сцене, не теряются: скрипт мог убрать их временно
    if (this.edits?.nodes) {
      const have = new Set(base.nodes.map((/** @type {any} */ n) => n.id));
      for (const [id, e] of Object.entries(this.edits.nodes)) if (!have.has(id) && !d.nodes[id]) d.nodes[id] = e;
    }
    this.edits = d;
    this.editWarnings = applyEdits(base, d).warnings;
  }
  /** Сведения о правках: файл, изменённые, добавленные и удалённые узлы, предупреждения. */
  editsInfo() {
    if (!this.editsMode) return { mode: false };
    this.#syncEdits();
    const e = this.edits;
    const ids = e ? [...new Set([...Object.keys(e.nodes || {}), ...(e.removed || []), ...(e.order || []).map((/** @type {any} */ o) => o.id)])] : [];
    return { mode: true, path: this.editsPath, count: editsCount(e), nodes: ids, removed: e?.removed || [], added: (e?.order || []).filter((/** @type {any} */ o) => o.add).map((/** @type {any} */ o) => o.id), scene: Object.keys(e?.scene || {}), warnings: this.editWarnings, locked: this.editsLocked };
  }
  /** Сцена со сброшенными правками (всех или указанных узлов) — значения из исходной сцены. @param {string[]} [ids] */
  resetEdits(ids) {
    if (!this.editsMode || !this.base) throw new Error('Сцена открыта без файла правок');
    const cur = diffScenes(this.base, this.scene);
    if (!ids || !ids.length) return applyEdits(this.base, null).scene;
    const kill = new Set(ids);
    for (const id of kill) delete cur.nodes[id];
    cur.removed = cur.removed.filter((/** @type {string} */ id) => !kill.has(id));
    cur.order = cur.order.filter((/** @type {any} */ o) => !kill.has(o.id));
    if (kill.has('__scene')) cur.scene = {};
    return applyEdits(this.base, cur).scene;
  }

  /* ---------------- ассеты */
  /** Папка сцены: от неё считаются относительные пути картинок. */
  baseDir() { return dirname(this.scenePath); }
  /**
   * Путь для записи из аргумента инструмента: абсолютный — как есть, относительный — от папки сцены
   * (а не от рабочей папки сервера: у MCP-клиента она любая, часто системная).
   * @param {string} p
   */
  resolvePath(p) { return resolve(this.baseDir(), p); }
  /**
   * Путь к существующему файлу для чтения: относительный ищется в папке сцены, затем в рабочей папке сервера.
   * Нигде нет — путь от папки сцены (для сообщения об ошибке).
   * @param {string} p
   */
  findPath(p) {
    if (isAbsolute(p)) return resolve(p);
    const own = resolve(this.baseDir(), p);
    if (existsSync(own)) return own;
    const cwd = resolve(p);
    return existsSync(cwd) ? cwd : own;
  }
  /** Сцена, где локальные картинки встроены как data: URI (для рендера и экспорта). */
  inlined() { return inlineAssets(this.scene, this.baseDir()); }

  /* ---------------- запись */
  /** Записать сцену (или файл правок) сейчас же. Отложенная запись, если была, больше не нужна. */
  save() {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = null; this.#dirty = false;
    try {
      if (this.readOnly) { log('не сохранено: ' + this.readOnly); return false; }
      if (!this.editsMode) { writeAtomic(this.scenePath, JSON.stringify(this.scene, null, 1), this.#backedUp); return true; }
      if (this.editsLocked || !this.editsPath) { log('файл правок не перезаписан: он не применился к сцене'); return false; }
      this.#syncEdits();
      writeAtomic(this.editsPath, JSON.stringify(this.edits, null, 1), this.#backedUp);
      return true;
    } catch (e) { log('ошибка сохранения:', e.message); return false; }
  }
  /*
   * Отложенная запись: правка не ждёт сериализации и записи всей сцены (у больших сцен это мегабайты на каждое
   * перетаскивание в студии) — файл пишется через saveDelay мс после последней правки, но не позже SAVE_MAX_WAIT мс
   * после первой несохранённой. Смена файла (открытие, «сохранить как», новая сцена) и выход процесса записывают
   * сразу. Сама запись синхронная (в таймере): тогда запись при выходе не может обогнать незаконченную асинхронную.
   */
  #scheduleSave() {
    this.#dirty = true; this.#editsStale = this.editsMode;
    if (!this.#saveDelay) return void this.save();
    const now = Date.now();
    if (!this.#saveTimer) this.#dirtySince = now;
    else clearTimeout(this.#saveTimer);
    const wait = Math.min(this.#saveDelay, this.#dirtySince + Math.max(this.#saveDelay, SAVE_MAX_WAIT) - now);
    this.#saveTimer = setTimeout(() => this.flushSave(), Math.max(0, wait));
    this.#saveTimer.unref(); // процесс не ждёт таймер: при выходе запись делает обработчик exit
  }
  /** Записать несохранённые изменения, если они есть. false — запись не удалась. */
  flushSave() { return this.#dirty ? this.save() : true; }
  /** Есть несохранённые изменения? */
  savePending() { return this.#dirty; }

  /* ---------------- транзакции и история */
  /** Снимок: JSON каждого узла (из кеша, если сцену после прошлой транзакции не меняли). @param {Scene} s */
  #snap(s, cached = true) {
    const c = this.#jsonCache;
    if (cached && c && c.rev === this.rev && c.scene === s && c.order.length === s.nodes.length) return c;
    const nodes = new Map(), order = [];
    for (const n of s.nodes) { nodes.set(n.id, JSON.stringify(n)); order.push(n.id); }
    return { rev: this.rev, scene: s, head: headOf(s), nodes, order };
  }
  /**
   * Транзакция: снимок → изменение → проверка (структура + вычисление затронутых узлов) → дельта в историю →
   * отложенное сохранение → оповещение превью. При ошибке сцена возвращается к снимку.
   * @template T
   * @param {string} label подпись в истории
   * @param {() => T} fn изменение (меняет session.scene на месте)
   * @returns {T}
   */
  mutate(label, fn) {
    const s0 = this.scene, before = this.#snap(s0);
    try {
      const res = fn();
      const scene = this.scene;
      invalidate(scene);
      const errs = validateStructure(scene);
      if (errs.length) throw new Error(errs.slice(0, 8).join('\n'));
      const after = this.#snap(scene, false);
      const d = delta(before, after);
      const ids = changedIds(d);
      // ранняя проверка вычислением: только изменённые узлы (или вся сцена, если менялись порядок и настройки)
      const only = ids ? ids.filter((id) => after.nodes.has(id)) : undefined;
      if (!only || only.length) { evaluate(scene, 0, only ? { only } : {}); evaluate(scene, scene.duration * 0.5, only ? { only } : {}); }
      if (!isEmpty(d)) {
        this.#history.push({ label, d }); if (this.#history.length > HISTORY_MAX) this.#history.shift();
        this.#future.length = 0;
      }
      this.rev++; after.rev = this.rev; this.#jsonCache = after;
      this.#scheduleSave(); this.broadcast({ ids, label });
      return res;
    } catch (e) {
      // откат: исходная сцена восстанавливается из снимка
      this.scene = s0;
      assignScene(s0, JSON.parse(before.head), before.order.map((id) => JSON.parse(/** @type {string} */ (before.nodes.get(id)))));
      this.#jsonCache = null;
      throw e;
    }
  }
  /** Заменить сцену целиком (как одна правка истории). @param {string} label @param {Scene} s */
  replaceScene(label, s) {
    const errs = validateScene(s);
    if (errs.length) throw new Error(errs.join('\n'));
    // объект текущей сцены остаётся, меняется содержимое — дельта посчитается по узлам
    return this.mutate(label, () => assignScene(this.scene, { ...s }, s.nodes));
  }
  /** Отменить последнюю правку. Возвращает её подпись или null. */
  undo() { return this.#step(this.#history, this.#future, 0, 'undo'); }
  /** Вернуть отменённую правку. Возвращает её подпись или null. */
  redo() { return this.#step(this.#future, this.#history, 1, 'redo'); }
  /** @param {{ label: string, d: Delta }[]} from @param {{ label: string, d: Delta }[]} to @param {0 | 1} side @param {string} label */
  #step(from, to, side, label) {
    const h = from.pop();
    if (!h) return null;
    applyDelta(this.scene, h.d, side); to.push(h); this.#jsonCache = null;
    this.rev++; this.#scheduleSave(); this.broadcast({ ids: changedIds(h.d), label });
    return h.label;
  }
  /** Подписи правок: что можно отменить (по порядку) и вернуть (ближайшая — первой). */
  historyInfo() { return { undo: this.#history.map((h) => h.label), redo: this.#future.map((h) => h.label).reverse() }; }

  /* ---------------- смена файла */
  /**
   * Новая пустая сцена. Если текущий файл нельзя затирать (сцена из скрипта или только чтение) — пишется рядом в
   * scene-N.json. Возвращает пометку о новом файле (или пустую строку).
   * @param {Record<string, any>} [opts] параметры createScene
   */
  newScene(opts) {
    let note = '';
    if (this.editsMode || this.readOnly) {
      this.flushSave();
      this.#dropEdits(); this.readOnly = null;
      let i = 1, f;
      do f = resolve(this.baseDir(), `scene-${i++}.json`); while (existsSync(f));
      this.scenePath = f; note = ` Файл: ${f}.`;
    }
    this.replaceScene('новая сцена', createScene(opts));
    this.flushSave(); // новый файл появляется сразу
    return note;
  }
  /**
   * Сохранить в другой файл (относительный путь — от папки текущей сцены); дальнейшее автосохранение
   * пойдёт туда (целиком, без файла правок).
   * @param {string} p
   */
  saveAs(p) {
    const old = this.baseDir(), target = this.resolvePath(p);
    this.flushSave(); // несохранённое — ещё в прежний файл
    this.#dropEdits(); this.readOnly = null;
    this.scenePath = target;
    this.#setScene(rebase(this.scene, old, this.baseDir()));
    invalidate(this.scene);
    const ok = this.save();
    this.rev++; this.broadcast();
    return ok;
  }
  /** Открыть пример (файл из папки движка): ассеты переводятся относительно папки текущей сцены. @param {string} f */
  openExample(f) {
    this.replaceScene('открыть пример', rebase(loadFrom(f), dirname(f), this.baseDir()));
  }
}
