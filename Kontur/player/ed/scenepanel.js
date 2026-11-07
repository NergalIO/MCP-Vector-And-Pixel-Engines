// Вкладка «Сцена»: размеры и время, состояния (переключение и запись), клипы, пиксельный режим, свет, дизеринг, правки поверх скрипта.
import { K, E, on, emit, edit, esc, toast, node, stateValue, setVal } from './core.js';
import { resetEdits } from './inspector.js';
import { syncClips } from './timeline.js';

const root = document.getElementById('scenepanel');
let raf = 0;
on('scene replace live states', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (!document.getElementById('pane-scene').hidden) render(); }); });
export function showScenePanel() { render(); }

const num = (id, label, v, title = '') => `<div class="fld"><span></span><label title="${esc(title)}">${label}</label><div class="ctl"><input id="${id}" value="${esc(v ?? '')}"></div></div>`;
const chk = (id, label, v, title = '') => `<div class="fld"><span></span><label title="${esc(title)}">${label}</label><div class="ctl"><input type="checkbox" id="${id}" ${v ? 'checked' : ''}></div></div>`;
const col = (id, label, v) => `<div class="fld"><span></span><label>${label}</label><div class="ctl"><input type="color" id="${id}-c" value="${/^#[0-9a-f]{6}$/i.test(v || '') ? v : '#000000'}"><input id="${id}" value="${esc(typeof v === 'object' ? JSON.stringify(v) : v ?? '')}"></div></div>`;

function render() {
  const s = E.scene;
  let h = `<h4>Кадр и время</h4><div class="pair">${num('s-w', 'Ширина', s.width)}${num('s-h', 'Высота', s.height)}</div><div class="pair">${num('s-dur', 'Длина, с', s.duration)}${num('s-fps', 'Кадров/с', s.fps)}</div>`;
  h += col('s-bg', 'Фон', s.background) + chk('s-loop', 'Повтор', s.loop !== false);

  // состояния
  h += `<h4>Состояния объектов</h4><div class="note">Именованные варианты: дверь открыта/закрыта, лампа вкл/выкл. Кнопка ● — запись: правки на холсте и в свойствах идут в этот вариант.</div>`;
  for (const g of s.states || []) {
    const cur = stateValue(g);
    h += `<div class="grp"><div class="row"><b>${esc(g.name)}</b><span class="spacer"></span><button data-delgroup="${esc(g.name)}" title="Удалить группу">×</button></div><div>`;
    for (const [v, patch] of Object.entries(g.values || {})) {
      const rec = E.record?.group === g.name && E.record?.value === v;
      const cnt = Object.keys(patch || {}).length;
      h += `<span class="chip${v === cur ? ' cur' : ''}" data-state="${esc(g.name)}" data-val="${esc(v)}" title="Объектов меняется: ${cnt}${(g.default ?? Object.keys(g.values)[0]) === v ? ' · по умолчанию' : ''}">${(g.default ?? Object.keys(g.values)[0]) === v ? '★ ' : ''}${esc(v)}<button class="rec${rec ? ' on' : ''}" data-rec title="${rec ? 'Остановить запись' : 'Записывать правки в этот вариант'}">●</button></span>`;
    }
    h += `</div><div class="row" style="margin-top:4px"><input data-newval="${esc(g.name)}" placeholder="новый вариант" style="flex:1"><button data-default="${esc(g.name)}" title="Сделать показанный вариант основным (★)">★ основной</button><button data-delval="${esc(g.name)}" title="Удалить показанный вариант">− вариант</button></div></div>`;
  }
  h += `<div class="row"><input id="s-newgroup" placeholder="новая группа (например, door)" style="flex:1"><button id="s-addgroup">+ группа</button></div>`;

  // клипы
  h += `<h4>Клипы</h4>`;
  for (const c of s.clips || []) {
    h += `<div class="grp" data-clip="${esc(c.name)}"><div class="row"><input data-c="name" value="${esc(c.name)}" style="flex:1" aria-label="Имя клипа"><button data-delclip title="Удалить клип">×</button></div>`
      + `<div class="row" style="margin-top:4px"><span class="note">с</span><input data-c="start" value="${c.start}" style="width:58px"><span class="note">до</span><input data-c="end" value="${c.end}" style="width:58px"><span class="note">fps</span><input data-c="fps" value="${c.fps ?? ''}" placeholder="—" style="width:42px"><label class="note"><input type="checkbox" data-c="loop" ${c.loop !== false ? 'checked' : ''}> повтор</label></div>`
      + `<div class="row" style="margin-top:4px"><span class="note">потом</span><select data-c="next"><option value="">—</option>${(s.clips || []).filter((x) => x.name !== c.name).map((x) => `<option ${x.name === c.next ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div></div>`;
  }
  if (!(s.clips || []).length) h += `<div class="note">Клипов нет: «+ клип» на таймлайне создаёт клип от плейхеда.</div>`;

  // пиксели
  const px = s.pixel || {};
  h += `<h4>Пиксельный режим</h4>${chk('px-on', 'Включён', px.enabled, 'Кадр рисуется в низком разрешении без сглаживания и увеличивается «ближайшим»')}`;
  h += `${num('px-size', 'Пиксель', px.size ?? 4, 'Размер пикселя в единицах сцены')}<div class="note" style="margin-left:18px">${s.width}×${s.height} → ${Math.round(s.width / (px.size || 4))}×${Math.round(s.height / (px.size || 4))}</div>`;
  h += `<div class="fld"><span></span><label title="Цвета через запятую или пробел; пусто — без палитры">Палитра</label><div class="ctl"><input id="px-pal" value="${esc((px.palette || []).join(' '))}" placeholder="#000 #fff …"></div></div>${chk('px-aa', 'Сглаживание', px.aa)}`;

  // свет
  const lights = s.nodes.filter((n) => n.type === 'light');
  h += `<h4>Свет</h4>${col('s-amb', 'Окружение', s.ambient || '#4a4f5c')}<div class="note">${lights.length ? `Источников: ${lights.map((l) => `<a href="#" data-goto="${esc(l.id)}">${esc(l.id)}</a>`).join(', ')}. Превью — кнопка «Свет» под холстом.` : 'Источников нет: инструмент «Свет» (J) ставит точечный свет. В Godot он станет PointLight2D.'}</div>`;

  // дизеринг
  const d = s.dither || {};
  h += `<h4>Дизеринг теней</h4>${chk('d-on', 'Включён', d.enabled, 'Растр вместо плоской заливки у слоёв с «Тень (растр)»')}<div class="fld"><span></span><label>Узор</label><div class="ctl"><select id="d-pat">${Object.keys(K.DITHER_PATTERNS).map((p) => `<option ${p === (d.pattern || 'bayer4') ? 'selected' : ''}>${p}</option>`).join('')}</select></div></div>${num('d-cell', 'Ячейка, px', d.cell ?? 3)}`;

  // правки
  if (E.edits?.mode) {
    h += `<h4>Правки поверх скрипта</h4><div class="note">Файл: ${esc(E.edits.path || '')}<br>Изменено объектов: ${E.edits.count || 0}. Исходный файл сцены не перезаписывается: build-скрипт может пересобрать сцену, правки лягут сверху.</div>`;
    if (E.edits.warnings?.length) h += `<ul class="warnlist">${E.edits.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`;
    h += `<div class="btns"><button id="e-reset" ${E.edits.count ? '' : 'disabled'}>Сбросить все правки</button></div>`;
  }
  root.innerHTML = h;
  wire();
}

function wire() {
  const s = E.scene, $ = (id) => root.querySelector('#' + id);
  const numIn = (id, fn, label) => { const el = $(id); if (!el) return; el.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') el.blur(); }; el.onchange = () => { const v = Number(el.value.replace(',', '.')); if (!Number.isFinite(v) || v <= 0) { toast('Нужно положительное число', true); render(); return; } edit(label, () => fn(v)); emit('view-reset'); }; };
  numIn('s-w', (v) => (s.width = Math.round(v)), 'ширина');
  numIn('s-h', (v) => (s.height = Math.round(v)), 'высота');
  numIn('s-dur', (v) => (s.duration = v), 'длина');
  numIn('s-fps', (v) => (s.fps = Math.round(v)), 'fps');
  const paint = (id, fn, label) => {
    const t = $(id), c = $(id + '-c');
    t.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') t.blur(); };
    t.onchange = () => { let v = t.value.trim(); try { if (/^[[{]/.test(v)) v = JSON.parse(v); } catch { return toast('JSON не разобран', true); } edit(label, () => fn(v || 'none')); };
    c.onchange = () => edit(label, () => fn(c.value));
  };
  paint('s-bg', (v) => (s.background = v), 'фон');
  paint('s-amb', (v) => (s.ambient = v), 'окружение');
  $('s-loop').onchange = (e) => edit('повтор', () => { s.loop = e.target.checked; E.player.loop = e.target.checked; });

  // состояния
  for (const chip of root.querySelectorAll('[data-state]')) {
    const g = chip.dataset.state, v = chip.dataset.val;
    chip.onclick = (e) => {
      if (e.target.closest('[data-rec]')) {
        E.record = E.record?.group === g && E.record?.value === v ? null : { group: g, value: v };
        if (E.record) E.states[g] = v;
        E.player.refresh(); emit('states'); emit('record');
        return;
      }
      E.states[g] = v;
      if (E.record?.group === g && E.record.value !== v) E.record = null;
      E.player.refresh(); emit('states'); emit('record');
    };
  }
  for (const inp of root.querySelectorAll('[data-newval]')) {
    inp.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter') return;
      const name = inp.value.trim(), g = s.states.find((x) => x.name === inp.dataset.newval);
      if (!name || g.values[name]) return toast(name ? 'Такой вариант уже есть' : 'Введите имя', true);
      if (edit('вариант', () => { g.values[name] = {}; })) { E.states[g.name] = name; E.player.refresh(); emit('states'); }
    };
  }
  for (const b of root.querySelectorAll('[data-default]')) b.onclick = () => { const g = s.states.find((x) => x.name === b.dataset.default); edit('основной вариант', () => { g.default = stateValue(g); }); };
  for (const b of root.querySelectorAll('[data-delval]')) b.onclick = () => {
    const g = s.states.find((x) => x.name === b.dataset.delval), v = stateValue(g);
    if (Object.keys(g.values).length < 2) return toast('В группе должен остаться хотя бы один вариант — удалите группу целиком', true);
    edit('удалить вариант', () => { delete g.values[v]; if (g.default === v) g.default = Object.keys(g.values)[0]; });
    delete E.states[g.name]; if (E.record?.group === g.name) E.record = null; E.player.refresh(); emit('record');
  };
  for (const b of root.querySelectorAll('[data-delgroup]')) b.onclick = () => { const name = b.dataset.delgroup; edit('удалить состояния', () => K.ops.removeState(s, name)); delete E.states[name]; if (E.record?.group === name) E.record = null; emit('record'); };
  const addGroup = () => {
    const name = $('s-newgroup').value.trim();
    if (!name) return toast('Введите имя группы', true);
    if ((s.states || []).some((g) => g.name === name)) return toast('Такая группа уже есть', true);
    if (edit('состояния', () => K.ops.setState(s, { name, values: { 'обычное': {}, 'другое': {} }, default: 'обычное' }))) {
      E.states[name] = 'другое'; E.record = { group: name, value: 'другое' }; E.player.refresh(); emit('record');
      toast('Запись варианта «другое»: меняйте объекты — изменения попадут в вариант. ● — остановить');
    }
  };
  $('s-addgroup').onclick = addGroup;
  $('s-newgroup').onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') addGroup(); };

  // клипы
  for (const box of root.querySelectorAll('[data-clip]')) {
    const name = box.dataset.clip;
    const cl = () => s.clips.find((c) => c.name === name);
    box.querySelector('[data-delclip]').onclick = () => { edit('удалить клип', () => K.ops.removeClip(s, name)); syncClips(); };
    for (const el of box.querySelectorAll('[data-c]')) {
      const k = el.dataset.c;
      el.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') el.blur(); };
      el.onchange = () => {
        const c = cl();
        let v = el.type === 'checkbox' ? el.checked : el.value.trim();
        if (['start', 'end', 'fps'].includes(k)) { if (v === '' && k === 'fps') v = undefined; else { v = Number(String(v).replace(',', '.')); if (!Number.isFinite(v)) return toast('Нужно число', true); } }
        if (k === 'name') { if (!v || s.clips.some((x) => x.name === v)) return toast('Имя пустое или занято', true); }
        edit('клип', () => {
          if (k === 'name') { for (const x of s.clips) if (x.next === c.name) x.next = v; c.name = v; }
          else if (v === undefined || v === '') delete c[k]; else c[k] = v;
          if (c.end <= c.start) throw new Error('Конец клипа должен быть позже начала');
        });
        syncClips();
      };
    }
  }

  // пиксели
  const setPx = () => {
    const pal = $('px-pal').value.split(/[\s,;]+/).filter(Boolean);
    const size = Number($('px-size').value.replace(',', '.'));
    if (!(size >= 1)) return toast('Размер пикселя — от 1', true);
    edit('пиксели', () => K.ops.setPixel(s, $('px-on').checked ? { enabled: true, size, palette: pal.length ? pal : undefined, aa: $('px-aa').checked || undefined } : { enabled: false }));
    if ($('px-on').checked && !E.pixelPreview) { E.pixelPreview = true; emit('previewmode'); }
  };
  for (const id of ['px-on', 'px-aa', 'px-size', 'px-pal']) { $(id).onchange = setPx; $(id).onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); }; }

  // дизеринг
  const setD = () => edit('дизеринг', () => { s.dither = { pattern: 'bayer4', cell: 3, density: 0.6, angle: 90, ...(s.dither || {}), enabled: $('d-on').checked, pattern: $('d-pat').value, cell: Number($('d-cell').value) || 3 }; });
  for (const id of ['d-on', 'd-pat', 'd-cell']) $(id).onchange = setD;

  for (const a of root.querySelectorAll('[data-goto]')) a.onclick = (e) => { e.preventDefault(); emit('goto', a.dataset.goto); };
  $('e-reset')?.addEventListener('click', () => resetEdits(null));
}
