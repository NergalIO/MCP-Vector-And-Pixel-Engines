/** Сериализация дерева отображения в SVG. */
import { evaluate } from './evaluate.js';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function treeToString(n) {
  let a = '';
  for (const k in n.attrs) { const v = n.attrs[k]; if (v != null && v !== '') a += ` ${k}="${esc(v)}"`; }
  if (n.text != null) return `<${n.tag}${a}>${esc(n.text)}</${n.tag}>`;
  if (!n.children || !n.children.length) return `<${n.tag}${a}/>`;
  return `<${n.tag}${a}>${n.children.map(treeToString).join('')}</${n.tag}>`;
}
/** SVG-строка кадра. */
export function renderSVG(scene, t, opts = {}) { return treeToString(evaluate(scene, t, opts)); }
