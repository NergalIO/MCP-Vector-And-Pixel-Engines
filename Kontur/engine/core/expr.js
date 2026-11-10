/**
 * Безопасные выражения модификатора expr: подмножество JS без доступа к среде.
 *
 * Поддерживается: const/let/var, if/else, return, блоки, присваивание локальных переменных (= += -= *= /=),
 * числа, строки, true/false/null/undefined/NaN/Infinity, массивы [a, b], операторы
 * ?: ?? || && === !== == != < > <= >= + - * / % ** ! унарные - + typeof, скобки,
 * чтение полей (a.b, a[i]) и вызов только разрешённых функций: Math.*, ctx.noise1/noise3/fbm/lerp/clamp/ease,
 * Number.isFinite, isNaN, isFinite. Циклов нет — выражение всегда завершается.
 * Поля constructor, prototype, __proto__ и т. п. закрыты: выйти к Function нельзя.
 *
 * Код, который не укладывается в подмножество, исполняется как настоящий JS (new Function) только
 * если это разрешено политикой: в браузере — да, в Node — при KONTUR_TRUST_EXPR=1 (или setExprPolicy).
 */
import { BoundedCache } from './cache.js';

const KEYWORDS = new Set(['const', 'let', 'var', 'if', 'else', 'return', 'true', 'false', 'null', 'undefined', 'typeof', 'NaN', 'Infinity']);
const BLOCKED = new Set(['constructor', 'prototype', '__proto__', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__', 'caller', 'callee', 'arguments', 'call', 'apply', 'bind', 'valueOf', 'toString', 'toLocaleString', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable']);
const PUNCT = ['===', '!==', '**=', '...', '==', '!=', '<=', '>=', '&&', '||', '??', '**', '+=', '-=', '*=', '/=', '%=', '=>', '?.', '(', ')', '[', ']', '{', '}', ',', ';', '?', ':', '.', '+', '-', '*', '/', '%', '<', '>', '!', '='];

class ExprSyntaxError extends Error {}

function tokenize(src) {
  const out = [];
  let i = 0, line = 1;
  const err = (m) => { throw new ExprSyntaxError(`${m} (строка ${line})`); };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; out.nl = true; if (out.length) out[out.length - 1].nlAfter = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) err('незакрытый комментарий'); for (let k = i; k < e; k++) if (src[k] === '\n') line++; i = e + 2; continue; }
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      const m = /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(src.slice(i));
      out.push({ k: 'num', v: Number(m[0]), line }); i += m[0].length; continue;
    }
    if (c === "'" || c === '"') {
      let s = '', j = i + 1;
      for (; j < src.length && src[j] !== c; j++) {
        if (src[j] === '\n') err('перевод строки внутри строки');
        if (src[j] === '\\') { const n = src[++j]; s += n === 'n' ? '\n' : n === 't' ? '\t' : n; } else s += src[j];
      }
      if (j >= src.length) err('незакрытая строка');
      out.push({ k: 'str', v: s, line }); i = j + 1; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
      out.push({ k: KEYWORDS.has(m[0]) ? 'kw' : 'id', v: m[0], line }); i += m[0].length; continue;
    }
    const p = PUNCT.find((q) => src.startsWith(q, i));
    if (!p) err(`недопустимый символ «${c}»`);
    out.push({ k: 'p', v: p, line }); i += p.length;
  }
  out.push({ k: 'eof', v: '', line });
  return out;
}

/* ---------- разбор в дерево ---------- */
function parse(src) {
  const T = tokenize(src);
  let p = 0;
  const peek = () => T[p];
  const err = (m, t = T[p]) => { throw new ExprSyntaxError(`${m}${t.k === 'eof' ? ' в конце' : ` около «${t.v}»`} (строка ${t.line})`); };
  const is = (v, k = 'p') => T[p].k === k && T[p].v === v;
  const isKw = (v) => is(v, 'kw');
  const eat = (v, k = 'p') => { if (!is(v, k)) err(`ожидалось «${v}»`); return T[p++]; };
  const semi = () => { if (is(';')) p++; };

  function program() { const body = []; while (peek().k !== 'eof') body.push(statement()); return { type: 'block', body }; }
  function statement() {
    if (is(';')) { p++; return { type: 'empty' }; }
    if (is('{')) { p++; const body = []; while (!is('}')) { if (peek().k === 'eof') err('ожидалось «}»'); body.push(statement()); } p++; return { type: 'block', body }; }
    if (isKw('const') || isKw('let') || isKw('var')) {
      p++;
      const decls = [];
      do {
        const id = T[p]; if (id.k !== 'id') err('ожидалось имя переменной'); p++;
        let init = null;
        if (is('=')) { p++; init = assign(); }
        decls.push({ name: id.v, init });
      } while (is(',') && ++p);
      semi();
      return { type: 'decl', decls };
    }
    if (isKw('if')) {
      p++; eat('('); const test = expression(); eat(')');
      const then = statement();
      let other = null;
      if (isKw('else')) { p++; other = statement(); }
      return { type: 'if', test, then, other };
    }
    if (isKw('return')) {
      const r = T[p++];
      if (is(';') || is('}') || peek().k === 'eof' || r.nlAfter) { semi(); return { type: 'return', arg: null }; }
      const arg = expression(); semi();
      return { type: 'return', arg };
    }
    const e = expression(); semi();
    return { type: 'expr', e };
  }
  function expression() {
    let e = assign();
    while (is(',')) { p++; e = { type: 'seq', a: e, b: assign() }; }
    return e;
  }
  function assign() {
    const left = ternary();
    if (peek().k === 'p' && ['=', '+=', '-=', '*=', '/=', '%=', '**='].includes(peek().v)) {
      const op = T[p++].v;
      if (left.type !== 'id') err('присваивать можно только локальной переменной', T[p - 1]);
      return { type: 'assign', op, name: left.name, value: assign() };
    }
    return left;
  }
  function ternary() {
    const test = binary(0);
    if (!is('?')) return test;
    p++; const a = assign(); eat(':'); const b = assign();
    return { type: 'cond', test, a, b };
  }
  const LEVELS = [['??'], ['||'], ['&&'], ['===', '!==', '==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
  function binary(lvl) {
    if (lvl === LEVELS.length) return power();
    let a = binary(lvl + 1);
    while (peek().k === 'p' && LEVELS[lvl].includes(peek().v)) { const op = T[p++].v; a = { type: 'bin', op, a, b: binary(lvl + 1) }; }
    return a;
  }
  function power() {
    const a = unary();
    if (is('**')) { p++; return { type: 'bin', op: '**', a, b: power() }; }
    return a;
  }
  function unary() {
    if (peek().k === 'p' && ['!', '-', '+'].includes(peek().v)) { const op = T[p++].v; return { type: 'un', op, a: unary() }; }
    if (isKw('typeof')) { p++; return { type: 'un', op: 'typeof', a: unary() }; }
    return postfix();
  }
  function postfix() {
    let e = primary();
    for (;;) {
      if (is('.')) { p++; const id = T[p]; if (id.k !== 'id' && id.k !== 'kw') err('ожидалось имя поля'); p++; e = { type: 'member', obj: e, key: { type: 'lit', v: id.v } }; }
      else if (is('[')) { p++; const key = expression(); eat(']'); e = { type: 'member', obj: e, key }; }
      else if (is('(')) {
        p++; const args = [];
        while (!is(')')) { args.push(assign()); if (!is(')')) eat(','); }
        p++; e = { type: 'call', callee: e, args };
      } else return e;
    }
  }
  function primary() {
    const t = T[p];
    if (t.k === 'num' || t.k === 'str') { p++; return { type: 'lit', v: t.v }; }
    if (t.k === 'kw') {
      const lits = { true: true, false: false, null: null, undefined, NaN, Infinity };
      if (t.v in lits) { p++; return { type: 'lit', v: lits[t.v] }; }
      err('неожиданное слово');
    }
    if (t.k === 'id') { p++; return { type: 'id', name: t.v }; }
    if (is('(')) { p++; const e = expression(); eat(')'); return e; }
    if (is('[')) {
      p++; const items = [];
      while (!is(']')) { items.push(assign()); if (!is(']')) eat(','); }
      p++; return { type: 'array', items };
    }
    err('неожиданный символ');
  }
  return program();
}

/* ---------- компиляция дерева в замыкания ---------- */
const SAFE_MATH = Object.create(null);
for (const k of Object.getOwnPropertyNames(Math)) SAFE_MATH[k] = Math[k];
const GLOBALS = { Math: SAFE_MATH, Number: { isFinite: Number.isFinite, isNaN: Number.isNaN, isInteger: Number.isInteger, EPSILON: Number.EPSILON, MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER }, isNaN, isFinite, parseFloat, parseInt };
const SAFE_FNS = new Set([...Object.values(SAFE_MATH).filter((f) => typeof f === 'function'), Number.isFinite, Number.isNaN, Number.isInteger, isNaN, isFinite, parseFloat, parseInt]);
const PARAMS = ['t', 'v', 'n', 'i', 'ctx'];
/** Разрешить вызов функций из выражений (помощники ctx: noise1, fbm, ease…). Функции должны быть чистыми. */
export function allowExprFunctions(...fns) { for (const f of fns) if (typeof f === 'function') SAFE_FNS.add(f); }

function getField(obj, key) {
  if (obj == null) throw new Error(`выражение: чтение поля «${String(key)}» у ${obj}`);
  if (typeof key !== 'number' && typeof key !== 'string') throw new Error('выражение: имя поля должно быть строкой или числом');
  if (BLOCKED.has(key)) throw new Error(`выражение: поле «${key}» недоступно`);
  if (typeof obj === 'string') return key === 'length' ? obj.length : typeof key === 'number' ? obj[key] : undefined;
  if (typeof obj !== 'object' && typeof obj !== 'function') return undefined;
  if (Array.isArray(obj)) return key === 'length' ? obj.length : obj[key];
  // только собственные поля: прототипы недоступны
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function compileNode(n, scope) {
  switch (n.type) {
    case 'lit': { const v = n.v; return () => v; }
    case 'array': { const items = n.items.map((x) => compileNode(x, scope)); return (f) => items.map((g) => g(f)); }
    case 'id': {
      const name = n.name;
      const pi = PARAMS.indexOf(name);
      if (pi >= 0) return (f) => (name in f.L ? f.L[name] : f.a[pi]);
      if (name in GLOBALS) { const g = GLOBALS[name]; return (f) => (name in f.L ? f.L[name] : g); }
      return (f) => { if (!(name in f.L)) throw new Error(`выражение: неизвестное имя «${name}»`); return f.L[name]; };
    }
    case 'member': { const o = compileNode(n.obj, scope), k = compileNode(n.key, scope); return (f) => getField(o(f), k(f)); }
    case 'call': {
      const callee = compileNode(n.callee, scope), args = n.args.map((x) => compileNode(x, scope));
      return (f) => {
        const fn = callee(f);
        if (typeof fn !== 'function' || !SAFE_FNS.has(fn)) throw new Error('выражение: вызывать можно только Math.* и функции ctx');
        return fn(...args.map((g) => g(f)));
      };
    }
    case 'un': {
      const a = compileNode(n.a, scope);
      switch (n.op) {
        case '!': return (f) => !a(f);
        case '-': return (f) => -a(f);
        case '+': return (f) => +a(f);
        default: return (f) => typeof a(f);
      }
    }
    case 'bin': {
      const a = compileNode(n.a, scope), b = compileNode(n.b, scope);
      switch (n.op) {
        case '+': return (f) => a(f) + b(f);
        case '-': return (f) => a(f) - b(f);
        case '*': return (f) => a(f) * b(f);
        case '/': return (f) => a(f) / b(f);
        case '%': return (f) => a(f) % b(f);
        case '**': return (f) => a(f) ** b(f);
        case '<': return (f) => a(f) < b(f);
        case '>': return (f) => a(f) > b(f);
        case '<=': return (f) => a(f) <= b(f);
        case '>=': return (f) => a(f) >= b(f);
        case '===': return (f) => a(f) === b(f);
        case '!==': return (f) => a(f) !== b(f);
        // eslint-disable-next-line eqeqeq
        case '==': return (f) => a(f) == b(f);
        // eslint-disable-next-line eqeqeq
        case '!=': return (f) => a(f) != b(f);
        case '&&': return (f) => a(f) && b(f);
        case '||': return (f) => a(f) || b(f);
        case '??': return (f) => a(f) ?? b(f);
      }
      break;
    }
    case 'cond': { const t = compileNode(n.test, scope), a = compileNode(n.a, scope), b = compileNode(n.b, scope); return (f) => (t(f) ? a(f) : b(f)); }
    case 'seq': { const a = compileNode(n.a, scope), b = compileNode(n.b, scope); return (f) => (a(f), b(f)); }
    case 'assign': {
      const name = n.name, val = compileNode(n.value, scope);
      if (!scope.has(name)) throw new ExprSyntaxError(`присваивание необъявленной переменной «${name}»`);
      const ops = { '=': (x, y) => y, '+=': (x, y) => x + y, '-=': (x, y) => x - y, '*=': (x, y) => x * y, '/=': (x, y) => x / y, '%=': (x, y) => x % y, '**=': (x, y) => x ** y };
      const op = ops[n.op];
      return (f) => (f.L[name] = op(f.L[name], val(f)));
    }
  }
  throw new ExprSyntaxError(`неподдержанная конструкция ${n.type}`);
}
/** Оператор → функция (f) => true, если выполнен return (значение в f.r). */
function compileStmt(n, scope) {
  switch (n.type) {
    case 'empty': return () => false;
    case 'block': {
      const list = n.body.map((s) => compileStmt(s, scope));
      return (f) => { for (let k = 0; k < list.length; k++) if (list[k](f)) return true; return false; };
    }
    case 'decl': {
      for (const d of n.decls) scope.add(d.name);
      const ds = n.decls.map((d) => [d.name, d.init ? compileNode(d.init, scope) : null]);
      return (f) => { for (const [name, init] of ds) f.L[name] = init ? init(f) : undefined; return false; };
    }
    case 'if': {
      const t = compileNode(n.test, scope), a = compileStmt(n.then, scope), b = n.other ? compileStmt(n.other, scope) : null;
      return (f) => (t(f) ? a(f) : b ? b(f) : false);
    }
    case 'return': { const a = n.arg ? compileNode(n.arg, scope) : null; return (f) => { f.r = a ? a(f) : undefined; return true; }; }
    case 'expr': { const e = compileNode(n.e, scope); return (f) => { e(f); return false; }; }
  }
  throw new ExprSyntaxError(`неподдержанный оператор ${n.type}`);
}

/**
 * Скомпилировать безопасное выражение. Возвращает функцию (t, v, n, i, ctx) → значение (как тело JS-функции:
 * без return — undefined). Бросает ExprSyntaxError, если код выходит за подмножество.
 */
export function compileSafeExpr(code) {
  const tree = parse(String(code));
  const run = compileStmt(tree, new Set());
  const fn = (t, v, n, i, ctx) => {
    const f = { a: [t, v, n, i, ctx], L: Object.create(null), r: undefined };
    run(f);
    return f.r;
  };
  fn.safe = true;
  return fn;
}
export const isExprSyntaxError = (e) => e instanceof ExprSyntaxError;

/* ---------- политика: можно ли исполнять настоящий JS ---------- */
const envTrust = () => {
  try { return globalThis.process?.env?.KONTUR_TRUST_EXPR === '1'; } catch { return false; }
};
const policy = { allowJS: typeof window !== 'undefined' || envTrust() };
/** allowJS: исполнять ли код вне безопасного подмножества как JS. По умолчанию: браузер — да, Node — KONTUR_TRUST_EXPR=1. */
export function setExprPolicy(p = {}) { if ('allowJS' in p) policy.allowJS = !!p.allowJS; exprCache.clear(); return { ...policy }; }
export const exprPolicy = () => ({ ...policy });

export const exprCache = new BoundedCache(2000);
const JS_OFF = 'JS-выражения выключены (безопасный режим): код выходит за подмножество выражений. Разрешить: KONTUR_TRUST_EXPR=1 или setExprPolicy({ allowJS: true })';
/**
 * Функция выражения expr. strict — для добавления модификатора: код, требующий JS при выключенном JS,
 * — ошибка. Без strict (вычисление загруженной сцены) такой модификатор просто не действует (fn.disabled).
 */
export function compileExpr(code, { strict = false } = {}) {
  const key = (strict ? 's|' : 'l|') + code;
  if (exprCache.has(key)) return exprCache.get(key);
  let fn;
  try { fn = compileSafeExpr(code); }
  catch (safeErr) {
    if (!isExprSyntaxError(safeErr)) throw safeErr;
    let js;
    try { js = new Function('t', 'v', 'n', 'i', 'ctx', code); } // только разбор: тело не исполняется
    catch (e) { throw new Error(`Ошибка в выражении: ${e.message}`); }
    if (policy.allowJS) fn = js;
    else if (strict) throw new Error(`${JS_OFF}. Не поддержано: ${safeErr.message}`);
    else { fn = () => undefined; fn.disabled = `${JS_OFF}. ${safeErr.message}`; }
  }
  exprCache.set(key, fn);
  return fn;
}
