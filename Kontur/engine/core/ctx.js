/** Контекст одного вычисления кадра. */
import { index } from './model.js';
import { PASS_MODES, RELIEF_DEFAULT, isPassMode, materialIndex } from './surface.js';

export class Ctx {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.c = index(scene);
    this.defs = [];
    this.prefix = opts.idPrefix || 'k';
    this.depth = 0;
    this.inRepeat = new Set();
    this.symStack = []; // имена символов, вычисляемых сейчас (вложенные экземпляры)
    this.patterns = new Map();
    this.mode = opts.mode || 'color';
    if (this.mode !== 'color' && this.mode !== 'height' && !isPassMode(this.mode)) throw new Error(`Неизвестный режим рендера: ${this.mode} (есть color, height, ${PASS_MODES.join(', ')}, mask:<метка>)`);
    // проходы отложенного света: данные о поверхности вместо цвета (см. dataPaint)
    this.data = isPassMode(this.mode);
    this.maskTag = this.mode.startsWith('mask:') ? this.mode.slice(5) : null;
    this.matIdx = this.mode === 'matId' ? materialIndex(scene) : null;
    this.surfCur = null; this.opCur = 1; this.scaleCur = 1; this.linCur = [1, 0, 0, 1];
    this.relief = { ...RELIEF_DEFAULT, ...(scene.relief || {}), ...(opts.relief || {}) };
    this.inClip = 0;
    this.evals = 0; // вычислений узлов в этом кадре (предел — MAX_EVAL_NODES в evaluate.js)
    this.defIds = new Set();
    this.recorders = [];
    this.cache = !!opts.cache;
    // состояния: выбранный вариант каждой группы → подмена свойств узлов
    if (scene.states?.length) {
      this.over = new Map();
      for (const g of scene.states) {
        const vals = g.values || {};
        const v = opts.states?.[g.name] ?? g.default ?? Object.keys(vals)[0];
        const patch = vals[v];
        if (!patch) continue;
        for (const id in patch) this.over.set(id, { ...(this.over.get(id) || {}), ...patch[id] });
      }
    }
    if (opts.only) {
      // рендер подмножества: только эти узлы (с потомками); предки дают трансформации, но не рисуются
      const ids = new Set(Array.isArray(opts.only) ? opts.only : [...opts.only]);
      this.allowed = new Set(); this.ancestors = new Set();
      const kids = this.c.children;
      const addDown = (id) => { this.allowed.add(id); for (const k of kids.get(id) || []) addDown(k.id); };
      for (const id of ids) {
        if (!this.c.byId.has(id)) continue;
        addDown(id);
        let par = this.c.byId.get(id).parent;
        while (par) { this.ancestors.add(par); par = this.c.byId.get(par)?.parent; }
      }
    }
  }
  id(key, kind) { return `${this.prefix}-${kind}-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`; }
  /** Добавить определение в <defs> (без повторов) и отметить его во всех записываемых поддеревьях. */
  addDef(def) {
    const id = def.attrs?.id;
    if (!id || !this.defIds.has(id)) { this.defs.push(def); if (id) this.defIds.add(id); }
    for (const r of this.recorders) r.push(def);
  }
  /** Общий def (паттерн, фильтр) по ключу: создаётся один раз, при повторе регистрируется заново. */
  share(key, def) { this.patterns.set(key, def); this.addDef(def); return `url(#${def.attrs.id})`; }
  reuse(key) { const def = this.patterns.get(key); this.addDef(def); return `url(#${def.attrs.id})`; }
}
