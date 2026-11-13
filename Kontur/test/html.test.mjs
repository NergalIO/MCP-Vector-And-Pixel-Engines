// Шаблоны разметки студии (player/ed/html.js): подстановки экранируются, вложенные фрагменты — нет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { html, raw, joinHTML, setHTML, esc } from '../player/ed/html.js';

const s = (h) => String(h);

test('подстановки экранируются, в том числе в атрибутах', () => {
  const id = `x"><img src=x onerror='alert(1)'>&`;
  assert.equal(s(html`<li data-id="${id}">${id}</li>`), '<li data-id="x&quot;&gt;&lt;img src=x onerror=&#39;alert(1)&#39;&gt;&amp;">x&quot;&gt;&lt;img src=x onerror=&#39;alert(1)&#39;&gt;&amp;</li>');
  assert.equal(esc(`<'&">`), '&lt;&#39;&amp;&quot;&gt;');
});

test('вложенные фрагменты, массивы, raw и пустые значения', () => {
  const items = ['a<b', 'c'].map((t) => html`<i>${t}</i>`);
  assert.equal(s(html`<p>${items}</p>`), '<p><i>a&lt;b</i><i>c</i></p>');
  assert.equal(s(html`${null}${undefined}${false}${0}${''}`), '0');
  assert.equal(s(html`<b>${raw('<svg/>')}</b>`), '<b><svg/></b>');
  assert.equal(s(joinHTML([html`<a>1</a>`, '2<'], html`<br>`)), '<a>1</a><br>2&lt;');
  assert.equal(s(joinHTML(['a', 'b'], ', ')), 'a, b');
});

test('setHTML: фрагмент — разметкой, обычная строка — текстом', () => {
  const el = {};
  setHTML(el, html`<b>${'<i>'}</b>`);
  assert.equal(el.innerHTML, '<b>&lt;i&gt;</b>');
  setHTML(el, '<b>');
  assert.equal(el.innerHTML, '&lt;b&gt;');
  setHTML(el, [html`<i></i>`, 'x']);
  assert.equal(el.innerHTML, '<i></i>x');
});

test('модули студии пишут разметку только через setHTML', () => {
  const dir = new URL('../player/ed/', import.meta.url);
  const bad = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'html.js')) {
    readFileSync(new URL(f, dir), 'utf8').split('\n').forEach((line, i) => {
      if (/\.(?:innerHTML|outerHTML)\s*=(?!=)|insertAdjacentHTML\s*\(/.test(line)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});
