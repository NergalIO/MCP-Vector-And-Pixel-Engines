/** Сериализация дерева отображения в SVG. */
import { evaluate } from './evaluate.js';
import { parseColor } from './color.js';
import { defsOf, urlRef } from './ir.js';

const NEEDS_ESC = /[&<>"]/;
/** Экранирование для XML. Сначала одна проверка: в путях и числах (почти все атрибуты) экранировать нечего. */
export const esc = (s) => { s = String(s); return NEEDS_ESC.test(s) ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : s; };
export function treeToString(n) {
  let a = '';
  for (const k in n.attrs) { const v = n.attrs[k]; if (v != null && v !== '') a += ` ${k}="${esc(v)}"`; }
  if (n.text != null) return `<${n.tag}${a}>${esc(n.text)}</${n.tag}>`;
  if (!n.children || !n.children.length) return `<${n.tag}${a}/>`;
  let s = `<${n.tag}${a}>`;
  for (const c of n.children) s += treeToString(c);
  return s + `</${n.tag}>`;
}
/** SVG-строка кадра. */
export function renderSVG(scene, t, opts = {}) { return treeToString(evaluate(scene, t, opts)); }

/* ---------- краски цвета фона ---------- */
const PAINTS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color'];
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'text', 'tspan', 'textPath']);
// источники цвета помимо красок: картинки, фильтры (матрицы цвета и arithmetic дают новые цвета), CSS
const OPAQUE = new Set(['image', 'feImage', 'filter', 'style', 'foreignObject', 'use']);
/**
 * Проверка «краска v — цвета фона bg»: none, прозрачная, тот же цвет или url(#id) на определение (градиент, паттерн)
 * из defs, которое само рисует только цветом фона (вместе с его href); неизвестная ссылка — «другой цвет».
 */
function bgPaint(bg, tree) {
  const ref = parseColor(bg);
  if (!ref) return null;
  const defs = defsOf(tree), seen = new Map();
  const same = (v) => {
    if (v === 'none') return true;
    if (v.startsWith('url(')) {
      const def = defs.get(urlRef(v));
      if (!def) return false;
      if (!seen.has(def)) { seen.set(def, false); seen.set(def, allBg(def, null, same) && hrefBg(def)); } // false — защита от циклов
      return seen.get(def);
    }
    const c = parseColor(v);
    return !!c && (c[3] === 0 || (Math.abs(c[0] - ref[0]) < 0.002 && Math.abs(c[1] - ref[1]) < 0.002 && Math.abs(c[2] - ref[2]) < 0.002));
  };
  const hrefBg = (def) => { const h = def.attrs?.href || def.attrs?.['xlink:href']; return !h || same(`url(${h})`); };
  return same;
}
/**
 * Всё поддерево рисует только цветом фона? Нет картинок, фильтров, стилей с краской; отсутствующий fill у фигуры —
 * чёрный (умолчание SVG, fill — унаследованный от предков). Ложное «нет» безопасно, поэтому сомнительное
 * (currentColor, style) считается другим цветом.
 */
function allBg(n, fill, same) {
  if (OPAQUE.has(n.tag)) return false;
  const a = n.attrs || {};
  if (a.style && /fill|stroke|color|blend/.test(a.style)) return false;
  for (const k of PAINTS) { const v = a[k]; if (v != null && v !== '' && !same(String(v))) return false; }
  if (a.fill != null && a.fill !== '') fill = a.fill;
  if (fill == null && SHAPES.has(n.tag) && !same('#000000')) return false;
  if (n.tag === 'stop' && (a['stop-color'] == null || a['stop-color'] === '') && !same('#000000')) return false; // остановка без цвета — чёрная
  for (const c of n.children || []) if (!allBg(c, fill, same)) return false;
  return true;
}
/** Корень кадра: defs и прямоугольник фона (его не трогаем) и тело. */
const isBgRect = (n, bg) => n.tag === 'rect' && n.attrs?.fill === bg && n.attrs.x === 0 && n.attrs.y === 0;

/**
 * Убрать невидимое: всё, что рисует цветом фона bg до первой краски другого цвета, ложится фоном на фон и ничего
 * не меняет (обычное наложение ассоциативно, прозрачность, клипы и маски группы этого не нарушают; группы с фильтром
 * не трогаем). Растеризатор упирается в заливку, поэтому в проходах данных (тысячи чёрных фигур под свечением,
 * маской персонажей) это прямо сокращает растр. Дерево не изменяется (в нём поддеревья из кэша кадра) — изменённые
 * узлы копируются. Возвращает { tree, dropped, solid } — solid: тело пусто, кадр одного цвета.
 */
export function dropUnderBg(tree, bg) {
  const same = bgPaint(bg, tree);
  if (!same) return { tree, dropped: 0, solid: false };
  let open = true, dropped = 0;
  const visit = (n, fill) => {
    if (!open) return n;
    if (allBg(n, fill, same)) { dropped++; return null; }
    const a = n.attrs || {};
    if (a.filter || OPAQUE.has(n.tag) || n.text != null || !n.children?.length) { open = false; return n; }
    const f = a.fill != null && a.fill !== '' ? a.fill : fill;
    let changed = false;
    const kids = [];
    for (const c of n.children) { const r = visit(c, f); if (r !== c) changed = true; if (r) kids.push(r); }
    return changed ? { ...n, children: kids } : n;
  };
  const out = [];
  let changed = false, body = 0;
  for (const c of tree.children) {
    if (c.tag === 'defs' || (open && isBgRect(c, bg))) { out.push(c); continue; }
    const r = visit(c, null);
    if (r !== c) changed = true;
    if (r) { out.push(r); body++; }
  }
  return { tree: changed ? { ...tree, children: out } : tree, dropped, solid: body === 0 };
}
/** Кадр заведомо одного цвета bg (каждая краска — цвета фона, нет картинок и фильтров)? */
export const isSolid = (tree, bg) => dropUnderBg(tree, bg).solid;
