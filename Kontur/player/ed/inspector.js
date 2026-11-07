// Инспектор: свойства выбранных объектов, ромбики ключей, IK, кости, модификаторы.
import { K, E, on, emit, node, kidsOf, ancestors, getVal, setVal, keyState, toggleKey, stateOverride, begin, preview, commit, edit, select, toast, esc, fmtN, uid, worldM, applyPt } from './core.js';
import { isPathLike, geomOf, pathKey } from './geom.js';
import { toPathNode, centerPivot } from './actions.js';
import { setTool } from './tools.js';

const root = document.getElementById('inspect');
const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
const STEP = { rotation: 1, skewX: 1, opacity: 0.01, scale: 0.01, scaleX: 0.01, scaleY: 0.01, textReveal: 0.01, energy: 0.05, falloff: 0.1, amount: 0.01, frequency: 0.05, speed: 0.05, trimStart: 0.01, trimEnd: 0.01, trimOffset: 0.01, ikWeight: 0.01, blur: 0.1 };
const RANGE = { opacity: [0, 1], textReveal: [0, 1], trimStart: [0, 1], trimEnd: [0, 1], ikWeight: [0, 1], strokeWidth: [0, 1e6], blur: [0, 1e3], energy: [0, 100], sides: [3, 64], points: [2, 128], fontSize: [1, 1e4] };
// [свойство, подпись, вид]: вид — число (по умолчанию), 'color', 'paint', 'bool', 'text', 'area', массив вариантов
const SHAPE = {
  rect: [['width', 'Ширина'], ['height', 'Высота'], ['radius', 'Скругление']],
  ellipse: [['rx', 'Радиус X'], ['ry', 'Радиус Y']],
  circle: [['r', 'Радиус']],
  polygon: [['sides', 'Сторон'], ['radius', 'Радиус'], ['cornerRadius', 'Скругление']],
  star: [['points', 'Лучей'], ['outerRadius', 'Внешний R'], ['innerRadius', 'Внутренний R'], ['cornerRadius', 'Скругление']],
  line: [['x1', 'X1'], ['y1', 'Y1'], ['x2', 'X2'], ['y2', 'Y2']],
  text: [['text', 'Текст', 'area'], ['fontSize', 'Кегль'], ['fontWeight', 'Насыщенность'], ['fontFamily', 'Шрифт', 'text'], ['textAlign', 'Выравнивание', ['left', 'center', 'right']], ['letterSpacing', 'Трекинг'], ['textReveal', 'Проявление']],
  image: [['width', 'Ширина'], ['height', 'Высота'], ['pixelated', 'Пиксельно', 'bool'], ['frame', 'Кадр листа']],
  blob: [['radius', 'Радиус'], ['points', 'Точек'], ['amount', 'Сила'], ['frequency', 'Частота'], ['speed', 'Скорость'], ['seed', 'Зерно']],
  light: [['z', 'Высота'], ['color', 'Цвет', 'color'], ['energy', 'Энергия'], ['radius', 'Радиус'], ['falloff', 'Спад']],
  path: [],
  group: [],
};
const LOOK = [['fill', 'Заливка', 'paint'], ['stroke', 'Обводка', 'paint'], ['strokeWidth', 'Толщина'], ['blend', 'Наложение', BLENDS], ['blur', 'Размытие'], ['shade', 'Тень (растр)', 'bool']];
const TRIM = [['trimStart', 'Обрезка с'], ['trimEnd', 'Обрезка до'], ['trimOffset', 'Сдвиг обрезки']];
const KNOWN = new Set(['x', 'y', 'rotation', 'scale', 'scaleX', 'scaleY', 'skewX', 'anchorX', 'anchorY', 'opacity', 'visible', 'locked', 'bone', 'boneLength', 'ik', 'ikWeight', 'clip', 'mask', 'd', 'shape', ...Object.values(SHAPE).flat().map((f) => f[0]), ...LOOK.map((f) => f[0]), ...TRIM.map((f) => f[0])]);

const sel = () => E.sel.map(node).filter(Boolean);
let raf = 0;
on('sel scene', () => render());
on('frame preview', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; refresh(); }); });
on('focusProp', (p) => { const el = root.querySelector(`[data-prop="${p}"]`); if (el) { el.focus(); el.select?.(); } });

/* ---------- поля ---------- */
const kindOf = (f) => f[2] || 'num';
const isNumKind = (k) => k === 'num';
const show = (v) => (v == null ? '' : typeof v === 'number' ? fmtN(v, 3) : typeof v === 'object' ? JSON.stringify(v) : String(v));
function parse(kind, s, prop) {
  if (kind === 'bool') return !!s;
  if (isNumKind(kind)) { const v = Number(String(s).replace(',', '.')); if (!Number.isFinite(v)) throw new Error(`${prop}: нужно число`); const r = RANGE[prop]; return r ? Math.min(r[1], Math.max(r[0], v)) : v; }
  if (kind === 'paint' || kind === 'any') { const t = String(s).trim(); if (/^[[{]/.test(t)) return JSON.parse(t); return t || 'none'; }
  return s;
}
function field(f, n) {
  const [prop, label] = f, kind = kindOf(f);
  const v = getVal(n, prop), so = stateOverride(n, prop);
  const ks = keyState(n, prop);
  const kd = ['num', 'color', 'paint'].includes(kind) || Array.isArray(kind) ? `<button class="kd ${ks || ''}" data-key="${prop}" title="${ks === 'on' ? 'Снять ключ' : 'Поставить ключ'} в момент плейхеда"></button>` : '<span></span>';
  let ctl;
  if (kind === 'bool') ctl = `<input type="checkbox" data-prop="${prop}" data-kind="bool" ${v ? 'checked' : ''}>`;
  else if (Array.isArray(kind)) ctl = `<select data-prop="${prop}" data-kind="sel">${kind.map((o) => `<option ${o === (v ?? kind[0]) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  else if (kind === 'area') ctl = `<textarea data-prop="${prop}" data-kind="text" rows="2">${esc(v ?? '')}</textarea>`;
  else if (kind === 'color' || kind === 'paint') {
    const hex = typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : typeof v === 'string' && /^#[0-9a-f]{3}$/i.test(v) ? '#' + v.slice(1).replace(/./g, '$&$&') : '#000000';
    ctl = `<input type="color" data-prop="${prop}" data-kind="pick" value="${hex}" ${typeof v === 'object' && v ? 'disabled title="Градиент — правьте текстом"' : ''}><input data-prop="${prop}" data-kind="${kind === 'paint' ? 'paint' : 'text'}" value="${esc(show(v))}">`;
  } else ctl = `<input data-prop="${prop}" data-kind="${kind}" value="${esc(show(v))}">`;
  return `<div class="fld${so ? ' st' : ''}">${kd}<label class="${isNumKind(kind) ? 'scrub' : ''}" data-scrub="${isNumKind(kind) ? prop : ''}" title="${esc(prop)}${so ? ` — из состояния «${esc(so.group)}»` : ''}${isNumKind(kind) ? ' · тяните мышью' : ''}">${esc(label)}</label><div class="ctl">${ctl}</div></div>`;
}
const fields = (list, n) => list.map((f) => field(f, n)).join('');

/* ---------- отрисовка ---------- */
function render() {
  const ns = sel();
  if (!ns.length) {
    root.innerHTML = `<div class="empty">Ничего не выбрано.<br><br>Щелчок по объекту на холсте или в списке — выбор, двойной щелчок — внутрь группы или к точкам контура. Shift — добавить к выбору, Ctrl — объект внутри группы, рамка — выбор областью.<br><br>Настройки сцены, состояния, клипы и пиксельный режим — во вкладке «Сцена».</div>`;
    return;
  }
  const n = ns[0], multi = ns.length > 1;
  let h = multi
    ? `<h3>Выбрано: ${ns.length}</h3><div class="note">Правка поля меняет его у всех выбранных.</div>`
    : `<h3><input id="i-name" value="${esc(n.id)}" aria-label="Имя объекта"><span class="note">${esc(n.type)}</span></h3>` + (n.parent ? `<div class="note">в группе <a href="#" data-goto="${esc(n.parent)}">${esc(n.parent)}</a></div>` : '');
  h += `<h4>Положение</h4><div class="pair">${field(['x', 'X'], n)}${field(['y', 'Y'], n)}</div>${field(['rotation', 'Поворот'], n)}`;
  h += `<div class="pair">${field(['scaleX', 'Масштаб X'], n)}${field(['scaleY', 'Масштаб Y'], n)}</div>`;
  h += `<details${n.props?.anchorX || n.props?.anchorY || n.props?.skewX || n.props?.scale != null ? ' open' : ''}><summary class="note">Опора, скос, общий масштаб</summary><div class="pair">${field(['anchorX', 'Опора X'], n)}${field(['anchorY', 'Опора Y'], n)}</div>${field(['skewX', 'Скос'], n)}${field(['scale', 'Масштаб'], n)}</details>`;
  if (!ns.every((x) => x.type === 'light')) h += `<div class="btns"><button id="i-pivc" title="Перенести опорную точку (центр поворота и масштаба) в центр рамки — картинка не сдвинется">⊕ Опора в центр</button></div>`;
  h += field(['opacity', 'Непрозрачность'], n) + field(['visible', 'Видимость', 'bool'], n);
  const types = new Set(ns.map((x) => x.type));
  if (types.size === 1 && SHAPE[n.type]?.length) h += `<h4>${{ text: 'Текст', image: 'Картинка', light: 'Свет', blob: 'Клякса' }[n.type] || 'Фигура'}</h4>` + fields(SHAPE[n.type], n);
  if (!multi && n.type === 'image') h += `<div class="fld"><span></span><label>Файл</label><div class="ctl"><span class="note" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(String(n.props?.src || ''))}">${esc(String(n.props?.src || '').replace(/^\/asset\?p=/, '').split(/[\\/]|%5C|%2F/i).pop().slice(0, 40))}</span><button id="i-src">Заменить…</button></div></div>`;
  if (!types.has('light') && !types.has('group')) h += `<h4>Вид</h4>` + fields(LOOK, n);
  if (!multi && (n.type === 'path' || pathKey(n))) h += fields(TRIM, n);
  if (types.has('group')) h += `<h4>Вид</h4>` + fields([['blend', 'Наложение', BLENDS], ['blur', 'Размытие']], n);
  if (!multi) h += extra(n);
  root.innerHTML = h;
  wire(ns);
}

function extra(n) {
  let h = '';
  const opts = (cur, filter) => `<option value="">—</option>` + E.scene.nodes.filter(filter).map((x) => `<option ${x.id === cur ? 'selected' : ''}>${esc(x.id)}</option>`).join('');
  // контур
  if (isPathLike(n) && n.type !== 'image') h += `<div class="btns"><button id="i-points" title="Инструмент «Точки» (A)">Править точки</button>${!pathKey(n) && n.type !== 'path' ? '<button id="i-topath">Превратить в контур</button>' : ''}</div>`;
  // кость и IK
  const B = node(n.parent), canIK = !!(B && B.parent);
  if (n.type === 'group' || n.props?.bone) {
    h += `<h4>Кость</h4>${field(['bone', 'Кость', 'bool'], n)}${n.props?.bone ? field(['boneLength', 'Длина'], n) : ''}<div class="note">Тяните кость на холсте — она повернётся вокруг сустава; Ctrl — сдвинуть.</div>`;
  }
  if (canIK || n.props?.ik) {
    const ik = n.props?.ik;
    h += `<h4>IK — конец цепочки</h4>`;
    if (ik) {
      h += `<div class="note">${esc(B?.parent || '?')} → ${esc(n.parent)} → ${esc(n.id)} тянется к цели</div>`;
      h += `<div class="fld"><span></span><label>Цель</label><div class="ctl"><select id="ik-target">${opts(ik.target, (x) => x.id !== n.id && ![n.parent, B?.parent].includes(x.id))}</select></div></div>`;
      h += `<div class="fld"><span></span><label>Сгиб наоборот</label><div class="ctl"><input type="checkbox" id="ik-flip" ${ik.flip ? 'checked' : ''}></div></div>`;
      h += `<div class="fld"><span></span><label title="Конец повторяет поворот цели">Как цель</label><div class="ctl"><input type="checkbox" id="ik-orient" ${ik.orient ? 'checked' : ''}></div></div>`;
      h += field(['ikWeight', 'Вес IK'], n) + `<div class="btns"><button id="ik-off">Снять IK</button></div>`;
    } else h += `<div class="btns"><button id="ik-on" title="Создать цель в точке объекта: двигайте цель — ${esc(n.parent)} и ${esc(B.parent)} повернутся">Добавить IK</button></div>`;
  }
  // обрезка и маска
  h += `<h4>Обрезка и маска</h4><div class="fld"><span></span><label title="Объект виден только внутри формы">Обрезать по</label><div class="ctl"><select id="i-clip">${opts(n.props?.clip, (x) => x.id !== n.id && x.type !== 'light')}</select></div></div>`;
  h += `<div class="fld"><span></span><label title="Яркость маски = непрозрачность">Маска</label><div class="ctl"><select id="i-mask">${opts(n.props?.mask, (x) => x.id !== n.id && x.type !== 'light')}</select></div></div>`;
  // модификаторы
  if (n.mods?.length) h += `<h4>Модификаторы</h4>` + n.mods.map((m, i) => `<div class="fld"><span></span><label style="color:var(--mod)">${esc(m.type)}</label><div class="ctl"><span class="note" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(JSON.stringify(m))}">${esc(Object.entries(m).filter(([k]) => k !== 'type').map(([k, v]) => `${k} ${typeof v === 'object' ? '…' : v}`).join(', '))}</span><button data-delmod="${i}" title="Удалить модификатор">×</button></div></div>`).join('');
  // состояния
  const st = (E.scene.states || []).map((g) => [g.name, Object.entries(g.values || {}).filter(([, p]) => p[n.id]).map(([v]) => v)]).filter(([, v]) => v.length);
  if (st.length) h += `<h4>Состояния</h4><div class="note">${st.map(([g, v]) => `${esc(g)}: ${v.map(esc).join(', ')}`).join('<br>')}</div>`;
  // прочие свойства
  const other = Object.keys(n.props || {}).filter((k) => !KNOWN.has(k));
  if (other.length) h += `<h4>Другие свойства</h4>` + other.map((k) => field([k, k, typeof n.props[k] === 'number' ? 'num' : typeof n.props[k] === 'boolean' ? 'bool' : 'any'], n)).join('');
  // правки поверх скрипта
  if (E.edits?.mode && (E.edits.nodes || []).includes(n.id)) h += `<h4>Правки поверх скрипта</h4><div class="btns"><button id="i-reset" title="Вернуть объект к сцене из build-скрипта">Сбросить правки объекта</button></div>`;
  return h;
}

/* ---------- обработчики ---------- */
function wire(ns) {
  const apply = (prop, v) => edit(prop, () => { for (const n of ns) setVal(n, prop, v); });
  for (const el of root.querySelectorAll('[data-prop]')) {
    const prop = el.dataset.prop, kind = el.dataset.kind;
    if (kind === 'pick') { el.oninput = () => { begin(); for (const n of ns) setVal(n, prop, el.value); preview(); }; el.onchange = () => commit(prop); continue; }
    if (kind === 'bool') { el.onchange = () => apply(prop, el.checked); continue; }
    if (kind === 'sel') { el.onchange = () => apply(prop, el.value); continue; }
    const go = () => { try { apply(prop, parse(kind, el.value, prop)); } catch (e) { toast(e.message, true); render(); } };
    if (el.tagName === 'TEXTAREA') { el.onchange = go; el.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) el.blur(); e.stopPropagation(); }; continue; }
    el.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') el.blur();
      if (e.key === 'Escape') { render(); }
      if (isNumKind(kind) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const st = (STEP[prop] || 1) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
        el.value = fmtN(Number(el.value || 0) + st, 4); go();
      }
    };
    el.onchange = go;
  }
  for (const b of root.querySelectorAll('[data-key]')) b.onclick = () => edit('ключ', () => { for (const n of ns) toggleKey(n, b.dataset.key); });
  for (const lab of root.querySelectorAll('[data-scrub]')) {
    const prop = lab.dataset.scrub;
    if (!prop) continue;
    lab.onpointerdown = (e) => {
      e.preventDefault(); lab.setPointerCapture(e.pointerId);
      const x0 = e.clientX, base = ns.map((n) => getVal(n, prop));
      if (base.some((v) => typeof v !== 'number')) return;
      let moved = false;
      lab.onpointermove = (ev) => {
        const dx = ev.clientX - x0;
        if (!moved && Math.abs(dx) < 2) return;
        if (!moved) { moved = true; begin(); }
        const st = (STEP[prop] || 1) * (ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1);
        const r = RANGE[prop];
        ns.forEach((n, i) => { let v = base[i] + dx * st; if (r) v = Math.min(r[1], Math.max(r[0], v)); setVal(n, prop, v); });
        preview();
      };
      lab.onpointerup = () => { lab.onpointermove = null; lab.onpointerup = null; if (moved) commit(prop); };
    };
  }
  const n = ns[0], $ = (id) => root.querySelector('#' + id);
  $('i-name')?.addEventListener('change', (e) => {
    const nv = e.target.value.trim();
    if (!nv || nv === n.id) return;
    if (edit('имя', () => K.ops.updateNode(E.scene, n.id, { newId: nv }))) { E.sel = [nv]; if (E.scope === n.id) E.scope = nv; emit('sel'); }
  });
  $('i-name')?.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });
  root.querySelector('[data-goto]')?.addEventListener('click', (e) => { e.preventDefault(); select(e.target.dataset.goto); });
  $('i-pivc')?.addEventListener('click', () => centerPivot(ns.map((x) => x.id)));
  $('i-points')?.addEventListener('click', () => setTool('direct'));
  $('i-topath')?.addEventListener('click', () => edit('в контур', () => { if (toPathNode(n, geomOf(n))) toast('Анимация размеров фигуры снята', true); }));
  $('i-src')?.addEventListener('click', () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      let src;
      if (E.live && E.source === '__live') { const r = await fetch('/asset?name=' + encodeURIComponent(f.name), { method: 'POST', body: f }); if (!r.ok) return toast('Не загружено: ' + (await r.text()), true); src = (await r.json()).url; }
      else src = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
      edit('картинка', () => { n.props.src = src; });
    };
    inp.click();
  });
  const setProp = (p, v, label) => edit(label, () => { if (v) (n.props ||= {})[p] = v; else if (n.props) delete n.props[p]; });
  $('i-clip')?.addEventListener('change', (e) => setProp('clip', e.target.value, 'обрезка'));
  $('i-mask')?.addEventListener('change', (e) => setProp('mask', e.target.value, 'маска'));
  for (const b of root.querySelectorAll('[data-delmod]')) b.onclick = () => edit('модификатор', () => { n.mods.splice(+b.dataset.delmod, 1); if (!n.mods.length) delete n.mods; });
  const ik = n.props?.ik;
  $('ik-target')?.addEventListener('change', (e) => edit('IK', () => K.ops.setIK(E.scene, n.id, e.target.value ? { ...ik, target: e.target.value } : null)));
  $('ik-flip')?.addEventListener('change', (e) => edit('IK', () => K.ops.setIK(E.scene, n.id, { ...ik, flip: e.target.checked })));
  $('ik-orient')?.addEventListener('change', (e) => edit('IK', () => K.ops.setIK(E.scene, n.id, { ...ik, orient: e.target.checked })));
  $('ik-off')?.addEventListener('click', () => edit('снять IK', () => K.ops.setIK(E.scene, n.id, null)));
  $('ik-on')?.addEventListener('click', () => {
    const tid = uid(n.id + '_target');
    const p = applyPt(worldM(n.id), [getVal(n, 'anchorX'), getVal(n, 'anchorY')]);
    if (edit('IK', () => { E.scene.nodes.push({ id: tid, type: 'group', props: { x: Math.round(p[0] * 100) / 100, y: Math.round(p[1] * 100) / 100 } }); E.ver++; K.invalidate(E.scene); K.ops.setIK(E.scene, n.id, { target: tid }); })) {
      select(tid);
      toast('Цель IK создана — двигайте её (оранжевый крест)');
    }
  });
  $('i-reset')?.addEventListener('click', () => resetEdits([n.id]));
}

/** Вернуть объекты к сцене из скрипта (на сервере). */
export async function resetEdits(ids) {
  const r = await fetch('/edits/reset', { method: 'POST', body: JSON.stringify(ids ? { ids } : {}) });
  if (!r.ok) toast('Не сброшено: ' + (await r.text()), true); else toast(ids ? 'Правки объекта сброшены' : 'Все правки сброшены');
}

/** Обновить значения полей без пересборки (плейхед, перетаскивание). */
function refresh() {
  const ns = sel();
  if (!ns.length) return;
  const n = ns[0];
  for (const el of root.querySelectorAll('[data-prop]')) {
    if (el === document.activeElement) continue;
    const prop = el.dataset.prop, kind = el.dataset.kind, v = getVal(n, prop);
    if (kind === 'bool') el.checked = !!v;
    else if (kind === 'pick') { if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) el.value = v; }
    else if (kind === 'sel') el.value = v ?? el.options[0]?.value ?? '';
    else { const s = show(v); if (el.value !== s) el.value = s; }
  }
  for (const b of root.querySelectorAll('[data-key]')) b.className = 'kd ' + (keyState(n, b.dataset.key) || '');
}
