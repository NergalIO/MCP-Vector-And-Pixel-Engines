// Запуск редактора: источники сцен, живая связь с MCP-сервером, панель инструментов, вкладки, клавиши, перетаскивание файлов.
import { K, E, on, emit, node, kidsOf, isLocked, isHidden, edit, undo, redo, canUndo, canRedo, select, toast, loadInto, remoteReplace, clearHistory, busy, pushing, preview } from './core.js';
import { html, raw, setHTML } from './html.js';
import { initView, fit, layout, zoomAt, zoomTo, spaceKey, stage, stagePt, setRenderer } from './view.js';
import './overlay.js';
import { TOOLS, setTool, nudge, deleteAnchors, finishPen, addImageFile } from './tools.js';
import { deleteSel, copySel, cutSel, paste, duplicateSel, groupSel, ungroupSel, restack } from './actions.js';
import './inspector.js';
import './layers.js';
import { deleteKeys, seek, syncAuto, syncClips } from './timeline.js';
import { showScenePanel } from './scenepanel.js';
import { schedule as schedulePreview } from './preview.js';

const $ = (id) => document.getElementById(id);
$('ver').textContent = 'v' + K.VERSION;
on('toast', (m) => toast(m, true));

/* ---------- панель инструментов ---------- */
const I = (d) => html`<svg viewBox="0 0 24 24" aria-hidden="true">${raw(d)}</svg>`;
const TOOLBAR = [
  ['select', 'Выбор и трансформация (V)', 'v', I('<path d="M6 3v15l4-4 3 7 2.5-1-3-7H18z"/>')],
  ['direct', 'Точки контура (A)', 'a', I('<path d="M6 3v15l4-4 3 7 2.5-1-3-7H18z" fill="currentColor"/>')],
  ['pen', 'Перо: щелчок — угол, протяжка — гладкая точка, щелчок по первой — замкнуть, Enter — закончить (P)', 'p', I('<path d="M12 19l7-7 3 3-7 7z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18z"/><circle cx="11" cy="11" r="2"/>')],
  ['pencil', 'Карандаш: рисуйте от руки (N)', 'n', I('<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>')],
  null,
  ['rect', 'Прямоугольник (R; Shift — квадрат, Alt — от центра)', 'r', I('<rect x="4" y="5" width="16" height="14" rx="1"/>')],
  ['ellipse', 'Эллипс (O)', 'o', I('<ellipse cx="12" cy="12" rx="9" ry="7"/>')],
  ['polygon', 'Многоугольник (U)', 'u', I('<path d="M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z"/>')],
  ['star', 'Звезда (S)', 's', I('<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>')],
  ['line', 'Линия (L; Shift — шаг 45°)', 'l', I('<path d="M5 19L19 5"/>')],
  ['text', 'Текст (T)', 't', I('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>')],
  ['image', 'Картинка (I) — или перетащите файл на холст', 'i', I('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>')],
  null,
  ['bone', 'Кость: протяните от сустава к концу; от конца выбранной кости — следующая (K)', 'k', I('<path d="M7 17L17 7"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/>')],
  ['light', 'Свет: точечный источник (J)', 'j', I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>')],
  ['hand', 'Рука: двигать вид (H; или пробел + мышь, колёсико — масштаб)', 'h', I('<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>')],
];
const KEYS = {};
setHTML($('tools'), html`${TOOLBAR.map((t) => (t ? html`<button data-tool="${t[0]}" title="${t[1]}" aria-label="${t[1]}">${t[3]}</button>` : html`<hr>`))}<hr><div class="swatches" title="Заливка и обводка новых фигур"><input type="color" id="fillc" value="${E.fill}" aria-label="Заливка новых фигур"><input type="color" id="strokec" value="${E.stroke}" aria-label="Обводка новых фигур"></div>`);
for (const t of TOOLBAR) if (t) KEYS[t[2]] = t[0];
$('tools').onclick = (e) => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); };
$('fillc').oninput = (e) => (E.fill = e.target.value);
$('strokec').oninput = (e) => (E.stroke = e.target.value);
on('tool', () => { for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === E.tool); });

/* ---------- вид ---------- */
const toggleBtn = (id, key, after) => { const b = $(id); const sync = () => b.classList.toggle('on', !!E[key]); b.onclick = () => { E[key] = !E[key]; sync(); after?.(); }; sync(); };
toggleBtn('v-bones', 'showBones', () => emit('overlay'));
toggleBtn('v-snap', 'snap');
toggleBtn('v-pixel', 'pixelPreview', () => { emit('previewmode'); if (E.pixelPreview && !E.scene.pixel?.enabled) toast('Пиксельный режим сцены выключен — показан пиксель по умолчанию. Настройки: вкладка «Сцена»'); });
toggleBtn('v-light', 'lightPreview', () => { emit('previewmode'); if (E.lightPreview && !E.scene.nodes.some((n) => n.type === 'light')) toast('В сцене нет источников света — поставьте их инструментом «Свет» (J)'); });
toggleBtn('v-deferred', 'deferredPreview', () => {
  if (E.deferredPreview && !E.live) { E.deferredPreview = false; toast('Отложенный свет считается сервером Kontur MCP — откройте студию через него (kontur-mcp / npm run preview)', true); }
  else if (E.deferredPreview && !E.scene.camera3d) { E.deferredPreview = false; toast('Нужна 2.5D-сцена: камера camera3d и узлы с surface (инструменты camera3d_set и world_build)', true); }
  emit('previewmode');
});
on('previewmode', () => { $('v-pixel').classList.toggle('on', E.pixelPreview); $('v-light').classList.toggle('on', E.lightPreview); $('v-deferred').classList.toggle('on', !!E.deferredPreview); schedulePreview(); });
{ const b = $('v-canvas'); const sync = () => b.classList.toggle('on', !!E.canvasRender); b.onclick = () => { setRenderer(!E.canvasRender); sync(); }; sync(); }
$('v-fit').onclick = fit;
$('zoom').ondblclick = () => zoomTo(1);
on('view-reset', () => { layout(); });

/* ---------- вкладки ---------- */
const TABS = ['edit', 'scene', 'json'];
function showTab(name) {
  for (const t of TABS) { $('tab-' + t).setAttribute('aria-selected', t === name); $('pane-' + t).hidden = t !== name; }
  if (name === 'scene') showScenePanel();
  if (name === 'json') $('json').value = JSON.stringify(E.scene, null, 1);
}
for (const t of TABS) $('tab-' + t).onclick = () => showTab(t);
on('goto', (id) => { showTab('edit'); select(id); });
$('apply').onclick = () => {
  const msg = $('jsonmsg');
  let s;
  try { s = JSON.parse($('json').value); } catch (e) { msg.textContent = 'JSON не разобран: ' + e.message; msg.style.color = 'var(--bad)'; return; }
  const errs = K.validateScene(s);
  if (errs.length) { msg.textContent = errs.slice(0, 3).join('; '); msg.style.color = 'var(--bad)'; return; }
  msg.style.color = '';
  edit('JSON', () => { E.scene.nodes = s.nodes; for (const k of Object.keys(E.scene)) if (!(k in s)) delete E.scene[k]; Object.assign(E.scene, s); E.ver++; });
  msg.textContent = 'Применено (Ctrl+Z — отменить).';
  emit('replace');
};
$('json').onkeydown = (e) => e.stopPropagation();

/* ---------- шапка: история, правки, связь ---------- */
$('undo').onclick = undo; $('redo').onclick = redo;
on('scene sel pushed live', () => { $('undo').disabled = !canUndo(); $('redo').disabled = !canRedo(); });
on('live pushed', () => {
  const el = $('live');
  el.classList.toggle('on', E.live && E.source === '__live');
  el.classList.toggle('busy', E.saving);
  el.querySelector('span').textContent = E.source !== '__live' ? (E.live ? 'не связано с MCP' : 'автономно') : E.saving ? 'сохранение…' : 'MCP · сохранено';
  const ed = E.edits, box = $('edits');
  if (E.source === '__live' && ed?.mode) setHTML(box, html`<span title="${ed.path || ''}">правки поверх скрипта: <b>${ed.count || 0}</b></span>${ed.warnings?.length > 0 && html`<span class="warn" title="${ed.warnings.join('\n')}">⚠ ${ed.warnings.length}</span>`}`);
  else if (E.source === '__live') setHTML(box, html`<span title="${E.path || ''}">${(E.path || '').split(/[\\/]/).pop()}</span>`);
  else setHTML(box, E.source === 'file' ? html`<span>файл из браузера — сохраняйте «Скачать JSON»</span>` : html`<span>пример — правки не сохраняются на диск</span>`);
});
$('download').onclick = download;
function download() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(E.scene, null, 1)], { type: 'application/json' }));
  a.download = (E.path || 'scene.json').split(/[\\/]/).pop().replace(/\.edits\.json$/, '.json');
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- баннеры: запись состояния, группа ---------- */
function banner() {
  const b = $('banner');
  if (E.record) { b.className = 'banner'; setHTML(b, html`● Запись состояния «${E.record.group} = ${E.record.value}» — правки идут в этот вариант <button id="b-stop">Стоп</button>`); b.hidden = false; $('b-stop').onclick = () => { E.record = null; emit('record'); emit('states'); }; return; }
  if (E.scope && node(E.scope)) { b.className = 'banner scope'; setHTML(b, html`Внутри группы «${E.scope}» <button id="b-out">Выйти (Esc)</button>`); b.hidden = false; $('b-out').onclick = exitScope; return; }
  // JS-выражения из файла сцены не исполняются без согласия: доверие — ровно к этому коду (изменённый снова выключен)
  const js = K.untrustedExprs(E.scene);
  if (js.length) {
    b.className = 'banner expr';
    setHTML(b, html`<span title="${js.join('\n\n— — —\n\n').slice(0, 3000)}">JS-выражения в сцене: ${js.length} — выключены, пока вы не доверитесь коду (наведите, чтобы увидеть код)</span><button id="b-trust">Доверять</button>`);
    b.hidden = false;
    $('b-trust').onclick = () => { K.trustExpr(js); preview(); banner(); toast(`Доверено JS-выражений: ${js.length}`); };
    return;
  }
  b.hidden = true;
}
on('record scope sel scene replace', banner);
function exitScope() { const s = E.scope; E.scope = node(s)?.parent ?? null; select(s); emit('scope'); }

/* ---------- клавиши ---------- */
const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
// Запасной путь для Ctrl+C/X/V: некоторые оболочки (Electron, встроенные браузеры) не отдают странице keydown,
// а сразу присылают событие буфера обмена. Если keydown дошёл, он уже отменил действие и этих событий не будет.
for (const [type, fn] of [['copy', copySel], ['cut', cutSel], ['paste', paste]]) {
  document.addEventListener(type, (e) => { if (typing({ target: document.activeElement || document.body })) return; e.preventDefault(); fn(); });
}
addEventListener('keydown', (e) => {
  if (typing(e)) return;
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), code = e.code;
  if (code === 'Space') { e.preventDefault(); if (!e.repeat) spaceKey(true); return; }
  if (ctrl && code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (ctrl && code === 'KeyY') { e.preventDefault(); redo(); return; }
  if (ctrl && code === 'KeyC') { e.preventDefault(); copySel(); return; }
  if (ctrl && code === 'KeyX') { e.preventDefault(); cutSel(); return; }
  if (ctrl && code === 'KeyV') { e.preventDefault(); paste(); return; }
  if (ctrl && code === 'KeyD') { e.preventDefault(); duplicateSel(); return; }
  if (ctrl && code === 'KeyG') { e.preventDefault(); e.shiftKey ? ungroupSel() : groupSel(); return; }
  if (ctrl && code === 'KeyA') { e.preventDefault(); select(kidsOf(E.scope).filter((n) => !isLocked(n.id) && !isHidden(n.id)).map((n) => n.id)); return; }
  if (ctrl && code === 'KeyS') { e.preventDefault(); if (E.source === '__live') toast('Сохраняется автоматически' + (E.edits?.mode ? ' — в файл правок' : '')); else download(); return; }
  if (ctrl && (code === 'BracketRight' || code === 'BracketLeft')) { e.preventDefault(); restack(code === 'BracketRight' ? (e.shiftKey ? 'top' : 'up') : e.shiftKey ? 'bottom' : 'down'); return; }
  if (ctrl && (k === '0' || code === 'Digit0')) { e.preventDefault(); fit(); return; }
  if (ctrl && (k === '1' || code === 'Digit1')) { e.preventDefault(); zoomTo(1); return; }
  if (ctrl && (k === '=' || k === '+')) { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); return; }
  if (ctrl && k === '-') { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(0.8, r.width / 2, r.height / 2); return; }
  if (ctrl) return;
  if (k === 'escape') {
    if (E.pen) return finishPen();
    if (E.tool === 'direct' && E.anchorSel.size) { E.anchorSel.clear(); emit('overlay'); return; }
    if (E.tool !== 'select') return setTool('select');
    if (E.scope) return exitScope();
    if (E.keySel.size) { E.keySel.clear(); emit('sel'); return; }
    return select([]);
  }
  if (k === 'enter') { if (E.pen) return finishPen(); if (E.sel.length === 1 && node(E.sel[0])?.type === 'group') { E.scope = E.sel[0]; const c = kidsOf(E.scope); select(c.length ? c[c.length - 1].id : []); emit('scope'); } return; }
  if (k === 'delete' || k === 'backspace') {
    e.preventDefault();
    if (E.focus === 'timeline' && deleteKeys()) return;
    if (E.tool === 'direct' && E.anchorSel.size) { deleteAnchors(); return; }
    if (E.pen) return;
    deleteSel(); return;
  }
  if (k.startsWith('arrow')) {
    e.preventDefault();
    const st = e.shiftKey ? 10 : 1;
    if (E.focus !== 'timeline' && (E.sel.length || E.anchorSel.size)) { const d = { arrowleft: [-st, 0], arrowright: [st, 0], arrowup: [0, -st], arrowdown: [0, st] }[k]; nudge(d[0], d[1]); return; }
    if (k === 'arrowleft' || k === 'arrowright') seek(E.t + (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / (E.scene.fps || 24)));
    return;
  }
  if (k === ',' || k === '.') { seek(E.t + (k === ',' ? -1 : 1) / (E.scene.fps || 24)); return; }
  if (k === 'home') { seek(E.player.clip ? E.player.clip.start : 0); return; }
  if (k === 'end') { seek(E.player.clip ? E.player.clip.end : E.scene.duration); return; }
  if (KEYS[k] && !e.altKey) { setTool(KEYS[k]); return; }
});
addEventListener('keyup', (e) => { if (e.code === 'Space' && !typing(e)) { e.preventDefault(); spaceKey(false); } });
document.addEventListener('pointerdown', (e) => { if (e.target.closest('#timeline')) E.focus = 'timeline'; else if (e.target.closest('#stage')) E.focus = 'canvas'; }, true);

/* ---------- перетаскивание файлов ---------- */
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files || [])];
  for (const f of files) {
    if (/^image\//.test(f.type)) {
      const [sx, sy] = stagePt(e), inStage = e.target.closest?.('#stage');
      const at = inStage ? (() => { const parent = E.scope ?? null; return K.mat.apply(K.mat.inv(K.mat.mul([E.zoom, 0, 0, E.zoom, E.panX, E.panY], parent ? K.nodeWorldMatrix(E.scene, parent, E.t, { states: E.states }) : K.mat.id())), sx, sy); })() : null;
      await addImageFile(f, at);
    } else if (/json$/i.test(f.name) || f.type === 'application/json') {
      try { const s = JSON.parse(await f.text()); const errs = K.validateScene(s); if (errs.length) throw new Error(errs[0]); openLocal(s, 'file', f.name); }
      catch (err) { toast('Файл не подошёл: ' + err.message, true); }
    }
  }
});

/* ---------- источники сцен ---------- */
const EMBED = window.KONTUR_EXAMPLES || null;
const examples = {};
const NAMES = { bay: 'Пример: ремонтный отсек', flow: 'Пример: поток', liquid: 'Пример: жидкие линии', reveal: 'Пример: логотип' };
let liveList = [];
async function fetchLive() {
  if (!location.protocol.startsWith('http') || EMBED) return null;
  try { const r = await fetch('/scene.json', { cache: 'no-store' }); if (!r.ok) return null; return await r.json(); } catch { return null; }
}
function openLocal(s, source, name) {
  E.source = source; E.path = name || null; E.edits = null;
  clearHistory(); E.sel = []; E.scope = null; E.states = {}; E.record = null;
  E.player.states = E.states;
  loadInto(s, { keepTime: false });
  emit('replace'); fit(); emit('live'); syncClips();
  if (source === 'file') { if (![...$('pick').options].some((o) => o.value === '__file')) $('pick').append(new Option('Файл: ' + name, '__file')); $('pick').value = '__file'; }
}
function applyLive(d, fresh) {
  E.rev = d.rev; E.path = d.path || null; E.edits = d.edits || null; E.history = d.history; E.synced = structuredClone(d.scene);
  if (fresh) { E.source = '__live'; clearHistory(); E.sel = []; E.scope = null; E.record = null; for (const k of Object.keys(E.states)) delete E.states[k]; loadInto(d.scene, { keepTime: false }); emit('replace'); fit(); syncClips(); }
  else remoteReplace(d.scene);
  emit('live');
}
async function refreshScenesList() {
  try { const r = await fetch('/scenes', { cache: 'no-store' }); if (r.ok) liveList = (await r.json()).scenes || []; } catch {}
  fillPicker();
}
function fillPicker() {
  const pick = $('pick');
  pick.replaceChildren();
  if (E.live) {
    const cur = (E.path || '').toLowerCase();
    const og = document.createElement('optgroup'); og.label = 'Сцены рядом (MCP)';
    for (const s of liveList) og.append(new Option(`${s.name}${s.build ? ' · скрипт' : ''}${s.edits ? ' · правки' : ''}`, 'live:' + s.path));
    if (!liveList.some((s) => s.path.toLowerCase() === cur)) og.prepend(new Option('Текущая (MCP)', 'live:' + (E.path || '')));
    pick.append(og);
  }
  const og2 = document.createElement('optgroup'); og2.label = 'Примеры';
  for (const k of Object.keys(examples)) og2.append(new Option(NAMES[k] || k, 'ex:' + k));
  if (og2.children.length) pick.append(og2);
  syncPicker();
}
function syncPicker() {
  const pick = $('pick');
  if (E.source === '__live') { const o = [...pick.options].find((o) => o.value.toLowerCase() === ('live:' + (E.path || '')).toLowerCase()); if (o) pick.value = o.value; }
}
$('pick').onchange = async () => {
  const v = $('pick').value;
  if (v.startsWith('ex:')) { openLocal(structuredClone(examples[v.slice(3)]), 'example', v.slice(3) + '.json'); return; }
  if (v.startsWith('live:')) {
    const p = v.slice(5);
    if (E.source !== '__live' || p.toLowerCase() !== (E.path || '').toLowerCase()) {
      if (p && p.toLowerCase() !== (E.path || '').toLowerCase()) { const r = await fetch('/open', { method: 'POST', body: JSON.stringify({ path: p }) }); if (!r.ok) return toast('Не открылась: ' + (await r.text()), true); }
      const d = await fetchLive(); if (d) applyLive(d, true);
      refreshScenesList();
    }
  }
};

function connect() {
  const es = new EventSource('/events');
  let stale = -1;
  const pull = async () => {
    if (busy() || pushing()) { setTimeout(pull, 300); return; }
    const d = await fetchLive();
    if (!d || d.rev <= E.rev) { if (d) { E.edits = d.edits; emit('live'); } return; }
    const pathChanged = (d.path || '').toLowerCase() !== (E.path || '').toLowerCase();
    if (E.source === '__live') applyLive(d, pathChanged);
    else { E.rev = d.rev; }
    if (pathChanged) refreshScenesList();
  };
  es.addEventListener('scene', (e) => { const r = +e.data; if (r > E.rev && r !== stale) { stale = r; pull(); } });
  es.onopen = () => { E.live = true; emit('live'); };
  es.onerror = () => { E.live = false; emit('live'); };
}

/* ---------- запуск ---------- */
initView();
const live = await fetchLive();
if (EMBED) Object.assign(examples, EMBED);
else if (!live) {
  for (const n of ['bay', 'flow', 'liquid', 'reveal']) {
    try {
      const r = await fetch(`../examples/${n}.json`);
      if (!r.ok) continue;
      const sc = await r.json();
      for (const nd of sc.nodes) if (nd.type === 'image' && nd.props?.src && !/^(data:|https?:|blob:|\/)/.test(nd.props.src)) nd.props.src = `../examples/${nd.props.src}`;
      examples[n] = sc;
    } catch {}
  }
}
setTool('select');
syncAuto();
if (live) { E.live = true; applyLive(live, true); connect(); await refreshScenesList(); }
else { const first = Object.keys(examples)[0]; openLocal(first ? structuredClone(examples[first]) : K.createScene({ width: 1280, height: 720, duration: 4 }), 'example', first ? first + '.json' : null); fillPicker(); }
emit('tool'); emit('live');
// для автоматических проверок и отладки
window.__kontur = { E, K, TOOLS, emit };
