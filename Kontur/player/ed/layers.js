// Список слоёв: дерево, видимость, замок, переименование, перетаскивание (порядок и вложение).
import { K, E, on, emit, node, kidsOf, ancestors, edit, select } from './core.js';
import { html, setHTML } from './html.js';
import { reparent, groupSel, ungroupSel, duplicateSel, deleteSel, restack } from './actions.js';

const ul = document.getElementById('layers');
const TY = { group: 'grp', rect: 'rect', ellipse: 'ell', circle: 'circ', polygon: 'poly', star: 'star', path: 'path', line: 'line', blob: 'blob', text: 'txt', image: 'img', light: 'свет' };
let order = [], lastClick = null, drag = null, raf = 0;

on('scene sel scope', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); });
on('replace', () => {
  // большие сцены открываются со свёрнутыми группами
  E.collapsed = new Set(E.scene.nodes.length > 120 ? E.scene.nodes.filter((n) => kidsOf(n.id).length).map((n) => n.id) : []);
});

document.getElementById('l-group').onclick = groupSel;
document.getElementById('l-ungroup').onclick = ungroupSel;
document.getElementById('l-dup').onclick = duplicateSel;
document.getElementById('l-del').onclick = deleteSel;
document.getElementById('l-up').onclick = () => restack('up');
document.getElementById('l-down').onclick = () => restack('down');

function render() {
  // выбранное всегда видно: предки раскрываются
  for (const id of E.sel) for (const a of ancestors(id)) E.collapsed.delete(a);
  const states = new Set();
  for (const g of E.scene.states || []) for (const p of Object.values(g.values || {})) for (const id of Object.keys(p)) states.add(id);
  const iks = new Set(E.scene.nodes.filter((n) => n.props?.ik).map((n) => n.id));
  const rows = [];
  order = [];
  const walk = (p, depth) => {
    for (const n of [...kidsOf(p)].reverse()) {
      order.push(n.id);
      const kids = kidsOf(n.id).length, open = !E.collapsed.has(n.id);
      const k = n.keys ? Object.keys(n.keys).length : 0, m = n.mods?.length || 0;
      const vis = n.props?.visible !== false, lock = !!n.props?.locked;
      const cls = [E.sel.includes(n.id) && 'sel', E.scope === n.id && 'scope', !vis && 'dim'].filter(Boolean).join(' ');
      const badges = html`${k ? html`<span class="badge k" title="Анимированных свойств: ${k}">${k}</span>` : ''}${m ? html`<span class="badge m" title="Модификаторов: ${m}">∿${m}</span>` : ''}${states.has(n.id) ? html`<span class="badge s" title="Меняется в состояниях">S</span>` : ''}${n.props?.bone ? html`<span class="badge b" title="Кость">B</span>` : ''}${iks.has(n.id) ? html`<span class="badge b" title="Конец IK-цепочки">IK</span>` : ''}`;
      const icons = html`<span class="ic${vis ? '' : ' set'}" data-vis title="${vis ? 'Скрыть' : 'Показать'}">${vis ? '👁' : '—'}</span><span class="ic${lock ? ' set' : ''}" data-lock title="${lock ? 'Разблокировать' : 'Заблокировать'}">${lock ? '🔒' : '🔓'}</span>`;
      rows.push(html`<li data-id="${n.id}" class="${cls}" style="padding-left:${4 + depth * 13}px" title="${n.id}"><span class="car" data-car>${kids ? (open ? '▾' : '▸') : ''}</span><span class="ty">${TY[n.type] || n.type}</span><span class="nm">${n.id}</span>${badges}${icons}</li>`);
      if (kids && open) walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  setHTML(ul, rows.length ? rows : html`<li class="note">Сцена пуста — рисуйте инструментами слева</li>`);
  const first = ul.querySelector('li.sel');
  if (first && E.focus !== 'layers') first.scrollIntoView({ block: 'nearest' });
}

const liOf = (el) => el?.closest?.('li[data-id]');
ul.addEventListener('pointerdown', (e) => {
  const li = liOf(e.target);
  if (!li || e.button !== 0 || e.target.closest('input')) return;
  E.focus = 'layers';
  const id = li.dataset.id;
  if (e.target.closest('[data-car]')) { E.collapsed.has(id) ? E.collapsed.delete(id) : E.collapsed.add(id); render(); return; }
  if (e.target.closest('[data-vis]')) { const n = node(id); edit(n.props?.visible === false ? 'показать' : 'скрыть', () => { if (n.props?.visible === false) delete n.props.visible; else (n.props ||= {}).visible = false; }); return; }
  if (e.target.closest('[data-lock]')) { const n = node(id); edit('замок', () => { if (n.props?.locked) delete n.props.locked; else (n.props ||= {}).locked = true; }); return; }
  drag = { id, y: e.clientY, active: false, pointer: e.pointerId, mods: { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey } };
  ul.setPointerCapture(e.pointerId);
});
ul.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.active) {
    if (Math.abs(e.clientY - drag.y) < 5) return;
    drag.active = true;
    if (!E.sel.includes(drag.id)) select(drag.id);
  }
  clearDrop();
  const li = liOf(document.elementFromPoint(e.clientX, e.clientY));
  if (!li) { drag.drop = null; return; }
  const r = li.getBoundingClientRect(), u = (e.clientY - r.top) / r.height, tid = li.dataset.id, t = node(tid);
  const zone = u < 0.3 ? 'before' : u > 0.7 ? 'after' : t.type === 'group' ? 'in' : u < 0.5 ? 'before' : 'after';
  li.classList.add('drop-' + zone);
  drag.drop = { id: tid, zone };
});
ul.addEventListener('pointerup', (e) => {
  const d = drag; drag = null; clearDrop();
  if (!d) return;
  if (!d.active) return click(d.id, d.mods);
  if (!d.drop || E.sel.includes(d.drop.id)) return;
  const ids = E.scene.nodes.filter((n) => E.sel.includes(n.id) && !ancestors(n.id).some((a) => E.sel.includes(a))).map((n) => n.id);
  const t = node(d.drop.id);
  // в списке верх = передний план = позже в массиве сцены
  // вставка «после ref» по одному идёт в обратном порядке, чтобы сохранить взаимный порядок
  if (d.drop.zone === 'in') { const kids = kidsOf(t.id); reparent([...ids].reverse(), t.id, kids.length ? kids[kids.length - 1].id : t.id, 'after'); E.collapsed.delete(t.id); }
  else reparent(d.drop.zone === 'before' ? [...ids].reverse() : ids, t.parent ?? null, t.id, d.drop.zone === 'before' ? 'after' : 'before');
});
ul.addEventListener('pointercancel', () => { drag = null; clearDrop(); });
function clearDrop() { for (const el of ul.querySelectorAll('.drop-before,.drop-after,.drop-in')) el.classList.remove('drop-before', 'drop-after', 'drop-in'); }

function click(id, { shift, ctrl }) {
  if (shift && lastClick && order.includes(lastClick)) {
    const a = order.indexOf(lastClick), b = order.indexOf(id);
    select(order.slice(Math.min(a, b), Math.max(a, b) + 1));
  } else if (ctrl) select(id, { toggle: true });
  else { select(id); lastClick = id; }
  // выбор в списке переводит «внутрь» нужной группы
  const p = node(id)?.parent ?? null;
  if (E.scope !== p) { E.scope = p; emit('scope'); }
}

ul.addEventListener('dblclick', (e) => {
  const li = liOf(e.target);
  if (!li || e.target.closest('[data-vis],[data-lock],[data-car]')) return;
  const id = li.dataset.id, nm = li.querySelector('.nm');
  setHTML(nm, html`<input value="${id}" aria-label="Новое имя">`);
  const inp = nm.firstChild;
  inp.focus(); inp.select();
  let done = false;
  const finish = (ok) => {
    if (done) return; done = true;
    const v = inp.value.trim();
    if (ok && v && v !== id) {
      if (edit('имя', () => K.ops.updateNode(E.scene, id, { newId: v }))) { E.sel = E.sel.map((x) => (x === id ? v : x)); if (E.scope === id) E.scope = v; if (E.collapsed.delete(id)) E.collapsed.add(v); emit('sel'); return; }
    }
    render();
  };
  inp.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); };
  inp.onblur = () => finish(true);
});
