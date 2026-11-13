// Разметка с экранированием по умолчанию: html`<b title="${t}">${name}</b>` экранирует каждую подстановку
// (& < > " '), а вложенные html`…`, массивы из них и raw(…) вставляет как есть. Строка из файла сцены
// (имя узла, ключ свойства, путь к файлу) так не станет разметкой, даже если забыть про esc().
//   setHTML(el, html`…`) — вставка в элемент; обычная строка вставится как текст.
//   null, undefined и false дают пустое место: ${cond && html`…`}.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

class Html {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
const part = (v) => (v == null || v === false ? '' : v instanceof Html ? v.s : Array.isArray(v) ? v.map(part).join('') : esc(v));

export function html(strings, ...vals) {
  let s = strings[0];
  for (let i = 0; i < vals.length; i++) s += part(vals[i]) + strings[i + 1];
  return new Html(s);
}
/** Готовая разметка без экранирования — только для своих строк, не для данных сцены. */
export const raw = (s) => new Html(String(s));
/** Фрагменты через разделитель: joinHTML(list, html`<br>`); строка-разделитель экранируется, как подстановка. */
export const joinHTML = (list, sep = '') => new Html(list.map(part).join(part(sep)));
/** Содержимое элемента из разметки html`…`; обычная строка вставляется как текст. */
export function setHTML(el, h) { el.innerHTML = part(h); }
