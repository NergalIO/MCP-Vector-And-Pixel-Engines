// Таймлайн: воспроизведение, клипы, дорожки ключей (перетаскивание, плавность, удаление), автоключ.
import { K, E, on, node, ancestors, begin, preview, commit, edit, select, fmtN, toast } from './core.js';
import { html, setHTML } from './html.js';

const $ = (id) => document.getElementById(id);
const tracks = $('tracks');
let raf = 0, drag = null;

on('sel scene replace', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); });
on('frame', () => {
  const D = E.scene.duration || 1;
  for (const h of tracks.querySelectorAll('.head')) h.style.left = (E.t / D) * 100 + '%';
  if (document.activeElement !== $('clock')) $('clock').value = E.t.toFixed(2);
  $('play').textContent = E.player.playing ? '❚❚' : '▶';
  $('play').setAttribute('aria-label', E.player.playing ? 'Пауза' : 'Воспроизвести');
  const cn = E.player.clip?.name || '';
  if ($('clip').value !== cn) { $('clip').value = cn; for (const b of tracks.querySelectorAll('.cliprange')) b.classList.toggle('on', b.dataset.clip === cn); }
});

/* ---------- транспорт ---------- */
$('play').onclick = () => E.player.toggle();
$('speed').onchange = (e) => (E.player.speed = +e.target.value);
$('loop').onchange = (e) => (E.player.loop = e.target.checked);
$('clock').onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); };
$('clock').onchange = (e) => { const v = Number(String(e.target.value).replace(',', '.')); if (Number.isFinite(v)) seek(v); };
$('clip').onchange = () => { try { E.player.setClip($('clip').value || null); } catch { E.player.setClip(null); } E.player.draw(); render(); };
$('autokey').onclick = () => { E.autoKey = !E.autoKey; syncAuto(); toast(E.autoKey ? 'Автоключ: изменения ставят ключи в момент плейхеда' : 'Автоключ выключен'); };
export function syncAuto() { $('autokey').classList.toggle('on', E.autoKey); }
$('addclip').onclick = () => {
  const name = uid2('clip');
  const start = Math.round(E.t * 100) / 100, end = Math.min(E.scene.duration, Math.round((E.t + 1) * 100) / 100);
  if (end - start < 0.05) return toast('Плейхед в конце шкалы — передвиньте его левее', true);
  if (edit('клип', () => K.ops.setClip(E.scene, { name, start, end }))) { syncClips(); $('clip').value = name; E.player.setClip(name); toast(`Клип «${name}»: ${start}–${end} с — края тяните на линейке, имя — во вкладке «Сцена»`); }
};
const uid2 = (b) => { let i = 1; while ((E.scene.clips || []).some((c) => c.name === b + i)) i++; return b + i; };
export function syncClips() {
  const sel = $('clip'), cur = E.player.clip?.name || sel.value;
  setHTML(sel, html`<option value="">Вся шкала</option>${(E.scene.clips || []).map((c) => html`<option value="${c.name}">${c.name} · ${c.start}–${c.end}s</option>`)}`);
  const ok = (E.scene.clips || []).some((c) => c.name === cur);
  sel.value = ok ? cur : '';
  try { E.player.setClip(ok ? cur : null); } catch { E.player.setClip(null); }
  $('dur').textContent = `/ ${E.scene.duration}s · ${E.scene.fps} fps`;
}
on('scene replace', syncClips);
export function seek(t) {
  E.player.pause();
  const fps = E.scene.fps || 24;
  E.player.seek(Math.max(0, Math.min(E.scene.duration, Math.round(t * fps) / fps)));
}

/* ---------- дорожки ---------- */
/** Глобальное время ключа (с учётом timeOffset/timeScale узла и предков). */
function globalT(n, lt) {
  let T = lt;
  for (const id of [n.id, ...ancestors(n.id)]) { const p = node(id)?.props || {}; T = T / (p.timeScale ?? 1) + (p.timeOffset ?? 0); }
  return T;
}
function rows() {
  const ns = E.sel.map(node).filter(Boolean), out = [];
  if (ns.length === 1) {
    const n = ns[0];
    if (n.keys && Object.keys(n.keys).length) out.push({ label: n.id, n, sum: true });
    for (const p of Object.keys(n.keys || {})) out.push({ label: '  ' + p, n, prop: p });
    for (const m of n.mods || []) out.push({ label: '  ∿ ' + m.type, mod: m });
  } else if (ns.length > 1) for (const n of ns.slice(0, 40)) out.push({ label: n.id, n, sum: true });
  else for (const n of E.scene.nodes) if (n.keys && Object.keys(n.keys).length && out.length < 80) out.push({ label: n.id, n, sum: true });
  return out;
}
function render() {
  const D = E.scene.duration || 1, pct = (t) => (Math.max(0, Math.min(D, t)) / D) * 100 + '%';
  tracks.replaceChildren();
  const lane = (label, cls = '', lcls = '') => {
    const l = document.createElement('div'); l.className = 'lbl ' + lcls; l.textContent = label; l.title = label.trim();
    const ln = document.createElement('div'); ln.className = 'lane ' + cls;
    const head = document.createElement('div'); head.className = 'head'; head.style.left = pct(E.t); ln.append(head);
    tracks.append(l, ln);
    return [l, ln];
  };
  const [, ruler] = lane('', 'ruler');
  const step = D <= 2 ? 0.25 : D <= 6 ? 0.5 : D <= 14 ? 1 : D <= 40 ? 2 : 5;
  for (let t = 0; t <= D + 1e-9; t += step) { const k = document.createElement('div'); k.className = 'tick'; k.style.left = pct(t); setHTML(k, html`<span>${+t.toFixed(2)}</span>`); ruler.append(k); }
  for (const c of E.scene.clips || []) {
    const b = document.createElement('div');
    b.className = 'cliprange' + (E.player.clip?.name === c.name ? ' on' : '');
    b.dataset.clip = c.name;
    b.style.left = pct(c.start); b.style.width = ((Math.min(D, c.end) - c.start) / D) * 100 + '%';
    setHTML(b, html`<span class="eg" data-edge="start" style="left:0"></span>${c.name}<span class="eg" data-edge="end" style="right:0"></span>`);
    b.title = `${c.name}: ${c.start}–${c.end} с · тяните края или весь клип`;
    b.onpointerdown = (e) => clipDown(e, c, b);
    ruler.append(b);
  }
  const rs = rows();
  for (const r of rs) {
    const [lbl, ln] = lane(r.label, '', r.sum ? 'node' : '');
    if (r.sum && E.sel.length !== 1) lbl.onclick = () => select(r.n.id);
    if (r.mod) {
      const m = document.createElement('div'); m.className = 'modbar';
      const s = r.mod.start ?? 0, e = r.mod.end ?? D;
      m.style.left = pct(s); m.style.width = ((Math.min(D, e) - s) / D) * 100 + '%';
      ln.append(m);
      continue;
    }
    const groups = new Map(); // время → ключи
    const props = r.prop ? [r.prop] : Object.keys(r.n.keys || {});
    for (const p of props) for (const k of r.n.keys[p] || []) { const T = Math.round(globalT(r.n, k.t) * 1e4) / 1e4; if (!groups.has(T)) groups.set(T, []); groups.get(T).push({ k, p }); }
    const ts = [...groups.keys()].sort((a, b) => a - b);
    if (ts.length > 1) { const s = document.createElement('div'); s.className = 'seg'; s.style.left = pct(ts[0]); s.style.width = ((ts[ts.length - 1] - ts[0]) / D) * 100 + '%'; ln.append(s); }
    for (const T of ts) {
      const ks = groups.get(T), k0 = ks[0].k;
      const d = document.createElement('div');
      const allSel = ks.every((x) => E.keySel.has(x.k));
      d.className = 'kf' + (r.sum && !r.prop ? ' sum' : '') + (k0.hold || k0.ease === 'hold' ? ' hold' : k0.ease === 'linear' ? ' lin' : '') + (allSel ? ' sel' : '');
      d.style.left = pct(T); d.dataset.t = T;
      d.title = `${T.toFixed(2)} с${r.prop ? ' · ' + (k0.hold ? 'hold' : k0.ease || 'inOutCubic') + ' · ' + fmtV(k0.v) : ` · ключей ${ks.length}`}\nПКМ — плавность, двойной щелчок — перейти`;
      d.onpointerdown = (e) => keyDown(e, ks, r.n, ln);
      d.oncontextmenu = (e) => { e.preventDefault(); if (!allSel) { E.keySel = new Set(ks.map((x) => x.k)); render(); } easeMenu(e.clientX, e.clientY); };
      d.ondblclick = () => seek(T);
      ln.append(d);
    }
  }
  if (!rs.length) { const [l] = lane(E.sel.length ? 'нет ключей' : 'нет анимации'); l.style.fontStyle = 'italic'; }
  for (const ln of tracks.querySelectorAll('.lane')) ln.addEventListener('pointerdown', laneDown);
  $('tlhint').textContent = E.sel.length ? (E.keySel.size ? `ключей выбрано: ${E.keySel.size} · Del — удалить` : 'ромбик в свойствах — ключ в момент плейхеда') : 'выберите объект, чтобы увидеть его ключи';
}
const fmtV = (v) => { const s = typeof v === 'number' ? fmtN(v, 3) : typeof v === 'string' ? v : JSON.stringify(v); return s.length > 40 ? s.slice(0, 38) + '…' : s; };

/* перемотка по дорожке */
function laneDown(e) {
  if (e.target.closest('.kf, .cliprange') || e.button !== 0) return;
  E.focus = 'timeline';
  const ln = e.currentTarget, D = E.scene.duration;
  ln.setPointerCapture(e.pointerId);
  if (!e.shiftKey && E.keySel.size) { E.keySel.clear(); for (const el of tracks.querySelectorAll('.kf.sel')) el.classList.remove('sel'); }
  const move = (ev) => { const r = ln.getBoundingClientRect(); seek(((ev.clientX - r.left) / r.width) * D); };
  move(e);
  ln.onpointermove = move;
  ln.onpointerup = () => { ln.onpointermove = null; ln.onpointerup = null; };
}

/* перетаскивание ключей */
function keyDown(e, ks, n, ln) {
  if (e.button !== 0) return;
  e.stopPropagation();
  E.focus = 'timeline';
  const objs = ks.map((x) => x.k);
  if (e.shiftKey) { const on = objs.every((k) => E.keySel.has(k)); for (const k of objs) on ? E.keySel.delete(k) : E.keySel.add(k); render(); return; }
  if (!objs.every((k) => E.keySel.has(k))) { E.keySel = new Set(objs); for (const el of tracks.querySelectorAll('.kf.sel')) el.classList.remove('sel'); e.currentTarget.classList.add('sel'); }
  const D = E.scene.duration, fps = E.scene.fps || 24, w = ln.getBoundingClientRect().width;
  // все выбранные ключи: какие массивы и какие исходные времена
  const owners = [];
  for (const x of E.scene.nodes) for (const [p, arr] of Object.entries(x.keys || {})) for (const k of arr) if (E.keySel.has(k)) owners.push({ n: x, p, arr, k, t0: k.t });
  drag = { x0: e.clientX, moved: false, owners };
  const tgt = e.currentTarget;
  tgt.setPointerCapture(e.pointerId);
  tgt.onpointermove = (ev) => {
    const dx = ev.clientX - drag.x0;
    if (!drag.moved && Math.abs(dx) < 3) return;
    if (!drag.moved) { drag.moved = true; begin(); }
    let dt = (dx / w) * D;
    if (!ev.altKey) dt = Math.round(dt * fps) / fps;
    for (const o of drag.owners) o.k.t = Math.max(0, Math.round((o.t0 + dt) * 1e4) / 1e4);
    for (const o of drag.owners) o.arr.sort((a, b) => a.t - b.t);
    preview();
    for (const el of tracks.querySelectorAll('.kf.sel')) el.style.left = (Math.max(0, Math.min(D, +el.dataset.t + dt)) / D) * 100 + '%';
  };
  tgt.onpointerup = () => {
    tgt.onpointermove = null; tgt.onpointerup = null;
    const d = drag; drag = null;
    if (!d?.moved) { seekToKey(n, ks); render(); return; }
    // ключ, попавший на занятое время, заменяет прежний
    for (const o of d.owners) {
      const dup = o.arr.filter((k) => k !== o.k && Math.abs(k.t - o.k.t) < 1e-4);
      for (const k of dup) o.arr.splice(o.arr.indexOf(k), 1);
    }
    commit('ключи');
  };
}
function seekToKey(n, ks) { seek(globalT(n, ks[0].k.t)); }

/** Меню плавности для выбранных ключей. */
function easeMenu(x, y) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu'; m.id = 'menu';
  const names = ['linear', 'hold', 'inOutCubic', 'inOutSine', 'outCubic', 'inCubic', 'outBack', 'inBack', 'inOutBack', 'outElastic', 'outBounce', ...Object.keys(K.easings).filter((k) => !['linear', 'hold', 'inOutCubic', 'inOutSine', 'outCubic', 'inCubic', 'outBack', 'inBack', 'inOutBack', 'outElastic', 'outBounce'].includes(k))].filter((k) => k === 'hold' || K.easings[k]);
  setHTML(m, html`<div class="note" style="padding:2px 10px">Плавность к следующему ключу</div>${names.map((k) => html`<button data-ease="${k}">${k}</button>`)}<hr><button data-del>Удалить ключи</button>`);
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px'; m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  m.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.del != null) deleteKeys();
    else edit('плавность', () => { for (const k of E.keySel) { k.ease = b.dataset.ease; delete k.hold; } });
    closeMenu(); render();
  };
  setTimeout(() => addEventListener('pointerdown', outside), 0);
}
const outside = (e) => { if (!e.target.closest('#menu')) closeMenu(); };
function closeMenu() { $('menu')?.remove(); removeEventListener('pointerdown', outside); }

/** Удалить выбранные ключи (значение в момент удаления остаётся свойством). */
export function deleteKeys() {
  if (!E.keySel.size) return false;
  edit('удалить ключи', () => {
    for (const n of E.scene.nodes) {
      if (!n.keys) continue;
      for (const [p, arr] of Object.entries(n.keys)) {
        const left = arr.filter((k) => !E.keySel.has(k));
        if (left.length === arr.length) continue;
        if (!left.length) { const v = arr[0].v; delete n.keys[p]; (n.props ||= {})[p] = v; }
        else n.keys[p] = left;
      }
      if (!Object.keys(n.keys).length) delete n.keys;
    }
  });
  E.keySel.clear();
  render();
  return true;
}

/* края и положение клипа */
function clipDown(e, c, el) {
  e.stopPropagation();
  if (e.button !== 0) return;
  const edge = e.target.dataset.edge || null, ln = el.parentElement, w = ln.getBoundingClientRect().width;
  const D = E.scene.duration, fps = E.scene.fps || 24, x0 = e.clientX, s0 = c.start, e0 = c.end;
  let moved = false;
  el.setPointerCapture(e.pointerId);
  el.onpointermove = (ev) => {
    const dx = ev.clientX - x0;
    if (!moved && Math.abs(dx) < 3) return;
    if (!moved) { moved = true; begin(); }
    const dt = Math.round(((dx / w) * D) * fps) / fps;
    const cl = E.scene.clips.find((x) => x.name === c.name);
    if (edge === 'start') cl.start = Math.max(0, Math.min(e0 - 1 / fps, Math.round((s0 + dt) * 1e4) / 1e4));
    else if (edge === 'end') cl.end = Math.min(D, Math.max(s0 + 1 / fps, Math.round((e0 + dt) * 1e4) / 1e4));
    else { const len = e0 - s0, ns = Math.max(0, Math.min(D - len, s0 + dt)); cl.start = Math.round(ns * 1e4) / 1e4; cl.end = Math.round((ns + len) * 1e4) / 1e4; }
    el.style.left = (cl.start / D) * 100 + '%'; el.style.width = ((cl.end - cl.start) / D) * 100 + '%';
  };
  el.onpointerup = () => {
    el.onpointermove = null; el.onpointerup = null;
    if (moved) { commit('клип'); syncClips(); return; }
    $('clip').value = c.name; E.player.setClip(c.name); E.player.draw(); render();
  };
}
