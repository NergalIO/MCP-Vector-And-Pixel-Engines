/** Вычисление сцены → дерево отображения {tag, attrs, children}. */
import { Ctx } from './ctx.js';
import { typeAnimated } from './types.js';
import { geomBox, geomToPath, measureGeom, toGeom, translateGeom } from './geom.js';
import { clamp, fmt } from './math.js';
import { ditherElements, effectiveDither, imageElement, paintAttr, trimDash } from './paint.js';
import { modIsStatic } from './modifiers.js';
import { solveIK } from './rig.js';
import { PASS_BG, modeInfo, dataPaint, floodFilter, grayHex, heightFilter, linOf, matrixFilter, normalGradPaints, normalMapMatrix, paintAlpha, resolveSurface } from './surface.js';
import { nodeGeom, propValue } from './values.js';
import { index } from './model.js';

/**
 * Значения свойств кадра, общие для всех проходов: propValue не зависит от режима (только от времени, состояний и IK),
 * поэтому анимированные значения узла (дорожки, модификаторы) считаются один раз на кадр, а не в каждом из девяти
 * проходов. Память — на индексе сцены (сбрасывается с ним), ключ — момент и состояния.
 */
function frameMemo(ctx, t, opts) {
  const key = `${t}|${opts.states ? JSON.stringify(opts.states) : ''}`;
  let f = ctx.c.frame;
  if (!f || f.key !== key) ctx.c.frame = f = { key, nodes: new Map() };
  return f.nodes;
}
function frameVals(fm, node, T, copy) {
  let e = fm.get(node);
  if (!e || e.T !== T || e.copy !== copy) fm.set(node, (e = { T, copy, v: new Map() }));
  return e.v;
}

export function evalNode(node, t, ctx, key, copy, extraScale = 1) {
  const p = node.props || {};
  // временное окно и локальное время
  if (p.inPoint != null && t < p.inPoint) return null;
  if (p.outPoint != null && t >= p.outPoint) return null;
  const lt = (t - (p.timeOffset ?? 0)) * (p.timeScale ?? 1);
  const rep = p.repeat;
  if (rep && rep.count > 1 && !ctx.inRepeat.has(node)) {
    const out = { tag: 'g', attrs: { 'data-node': ctx.symStack.length ? null : node.id }, children: [] };
    const n = Math.min(500, Math.round(rep.count));
    for (let i = 0; i < n; i++) {
      const ti = t - (rep.delay ?? 0) * (rep.reverse ? n - 1 - i : i);
      const tr = [];
      const cx = rep.cx ?? 0, cy = rep.cy ?? 0;
      if (rep.x || rep.y) tr.push(`translate(${fmt((rep.x ?? 0) * i)} ${fmt((rep.y ?? 0) * i)})`);
      if (rep.rotation) tr.push(`rotate(${fmt(rep.rotation * i)} ${fmt(cx)} ${fmt(cy)})`);
      if (rep.scale != null && rep.scale !== 1 && rep.scaleAround) tr.push(`translate(${fmt(cx)} ${fmt(cy)}) scale(${fmt(rep.scale ** i)}) translate(${fmt(-cx)} ${fmt(-cy)})`);
      const op = rep.opacity != null ? rep.opacity ** i : 1;
      ctx.inRepeat.add(node);
      const child = evalNode(node, ti, ctx, `${key}r${i}`, copy * 1000 + i, rep.scale != null && !rep.scaleAround ? rep.scale ** i : 1);
      ctx.inRepeat.delete(node);
      if (child) out.children.push({ tag: 'g', attrs: { transform: tr.join(' ') || null, opacity: op < 1 ? fmt(op) : null }, children: [child] });
    }
    return out;
  }
  const T = lt;
  const mm = ctx.fm && (node.mods || node.keys) ? frameVals(ctx.fm, node, T, copy) : null;
  const Pt = mm ? (n) => { let v = mm.get(n); if (v === undefined && !mm.has(n)) { v = propValue(node, n, T, ctx, copy); mm.set(n, v); } return v; } : (n) => propValue(node, n, T, ctx, copy);
  if (Pt('visible') === false) return null;
  let skipOwn = false;
  if (ctx.allowed && !ctx.inClip && !ctx.allowed.has(node.id)) { if (!ctx.ancestors.has(node.id)) return null; skipOwn = true; }
  const H = ctx.mode === 'height' && !ctx.inClip;
  let rel = null;
  if (H) {
    const r = Pt('relief');
    if (r === false) return null;
    const bl = Pt('blend');
    if (bl && bl !== 'normal') return null;      // фактуры/свет в режиме наложения — не рельеф
    if (Pt('opacity') < 0.6) return null;        // полупрозрачные декоративные слои
    if (node.type !== 'group' && node.type !== 'image' && paintAlpha(Pt('fill')) < 0.6 && paintAlpha(Pt('stroke')) < 0.6 && !(r && typeof r === 'object')) {
      // собственная фигура прозрачна (виньетка, засветка) — дети всё равно участвуют
      skipOwn = true;
    }
    rel = { ...(ctx.reliefCur || ctx.relief), ...(r && typeof r === 'object' ? r : {}) };
  }
  // проходы отложенного света: поверхность (наследуется) и накопленная непрозрачность вместо атрибута opacity
  const D = ctx.data && !ctx.inClip;
  let surf = null, opAcc = 1;
  if (D) {
    surf = resolveSurface(ctx.surfCur, Pt('surface'));
    opAcc = ctx.opCur * clamp(Pt('opacity'));
    if (opAcc <= 0.0005) return null;
    const bl = Pt('blend');
    if (bl && bl !== 'normal' && !surf) return null;   // фактуры и засветки в режиме наложения — только в цвете
  }
  const opacity = H || D ? 1 : Pt('opacity');
  if (opacity <= 0.0005 && !p.keepHidden) return null;

  const x = Pt('x'), y = Pt('y'), rot = Pt('rotation'), sc = Pt('scale') * extraScale;
  const sx = sc * Pt('scaleX'), sy = sc * Pt('scaleY'), skx = Pt('skewX'), ax = Pt('anchorX'), ay = Pt('anchorY');
  const scaleHere = ctx.scaleCur * (Math.sqrt(Math.abs(sx * sy)) || 0);
  let tf = '';
  if (x || y) tf += `translate(${fmt(x)} ${fmt(y)})`;
  if (rot) tf += ` rotate(${fmt(rot)})`;
  if (skx) tf += ` skewX(${fmt(skx)})`;
  if (sx !== 1 || sy !== 1) tf += ` scale(${fmt(sx)} ${fmt(sy)})`;
  if (ax || ay) tf += ` translate(${fmt(-ax)} ${fmt(-ay)})`;

  const nkey = `${node.id}${key}`;
  // opacity = 1 не пишется: у resvg элемент с opacity целиком за кадром ломает рендер
  const g = { tag: 'g', attrs: { 'data-node': ctx.symStack.length ? null : node.id, transform: tf.trim() || null, opacity: opacity < 1 ? fmt(clamp(opacity)) : null }, children: [] };

  // фильтры
  const blur = Pt('blur'), shadow = Pt('shadow'), glow = Pt('glow');
  if (!H && !D && !skipOwn && (blur > 0.01 || shadow || glow)) {
    const fid = ctx.id(nkey, 'f');
    const prims = [];
    let src = 'SourceGraphic';
    if (blur > 0.01) { prims.push({ tag: 'feGaussianBlur', attrs: { in: 'SourceGraphic', stdDeviation: fmt(blur), result: 'b' } }); src = 'b'; }
    const merge = [];
    if (glow) {
      prims.push({ tag: 'feGaussianBlur', attrs: { in: src, stdDeviation: fmt(glow.blur ?? 12), result: 'gb' } });
      prims.push({ tag: 'feFlood', attrs: { 'flood-color': glow.color ?? '#ffffff', 'flood-opacity': fmt(glow.strength ?? 0.9) } });
      prims.push({ tag: 'feComposite', attrs: { in2: 'gb', operator: 'in', result: 'gc' } });
      merge.push('gc');
    }
    if (shadow) {
      prims.push({ tag: 'feDropShadow', attrs: { in: src, dx: fmt(shadow.x ?? 0), dy: fmt(shadow.y ?? 8), stdDeviation: fmt(shadow.blur ?? 12), 'flood-color': shadow.color ?? '#000', 'flood-opacity': fmt(shadow.opacity ?? 0.5), result: 'sh' } });
      merge.push('sh');
    } else merge.push(src);
    prims.push({ tag: 'feMerge', attrs: {}, children: merge.map((m) => ({ tag: 'feMergeNode', attrs: { in: m } })) });
    ctx.addDef({ tag: 'filter', attrs: { id: fid, x: '-50%', y: '-50%', width: '200%', height: '200%', 'color-interpolation-filters': 'sRGB' }, children: prims });
    g.attrs.filter = `url(#${fid})`;
  }
  const blend = Pt('blend');
  if (!H && !D && !skipOwn && blend && blend !== 'normal') g.attrs.style = `mix-blend-mode:${blend}`;
  const kids = ctx.c.children.get(node.id) || [];

  // собственная фигура
  // surface.geo — узел только геометрии (плоскость для восстановления позиции): в цвете не рисуется
  if (!D && !skipOwn && node.type !== 'group' && Pt('surface')?.geo) skipOwn = true;
  if (skipOwn) {
    // предок выбранных узлов: только трансформация
  } else if (node.type === 'image') {
    const el = imageElement(node, Pt, T, ctx, nkey);
    const w = Pt('width'), h = Pt('height');
    // фильтр высоты — на обёртке: у кадра спрайт-листа (вложенный <svg>) фильтр иначе видит весь лист
    if (H) g.children.push({ tag: 'g', attrs: { filter: heightFilter(ctx, rel, true, [-w / 2, -h / 2, w, h]) }, children: [el] });
    else if (D) {
      // картинка с поверхностью — «тело» (персонаж, спрайт): заливка цветом прохода по альфе;
      // карты normalSrc / emissiveSrc / specSrc заменяют заливку в своих проходах
      const s2 = surf ? { ...surf, base: surf.base || !surf.bump } : null;
      const col = dataPaint(ctx, s2, opAcc);
      const region = [-w / 2, -h / 2, w, h];
      const alt = (prop) => imageElement(node, (n) => (n === 'src' ? Pt(prop) : Pt(n)), T, ctx, nkey);
      const nSrc = Pt('normalSrc'), eSrc = Pt('emissiveSrc'), spSrc = Pt('specSrc');
      if (col && ctx.mode === 'normal' && nSrc) {
        const lin = linOf(ctx.linCur, rot, skx, sx, sy);
        g.children.push({ tag: 'g', attrs: { filter: matrixFilter(ctx, normalMapMatrix(lin, { yUp: Pt('normalYUp') !== false }), region) }, children: [alt('normalSrc')] });
      } else if (ctx.mode === 'emissive' && eSrc && s2) {
        if (col) g.children.push({ tag: 'g', attrs: { filter: floodFilter(ctx, col, region) }, children: [el] });
        g.children.push(alt('emissiveSrc'));
      } else if (col && ctx.mode === 'planeD' && spSrc && s2?.plane) {
        const q = clamp(Math.round((s2.plane[3] + 200) * 100), 0, 65535);
        const vals = `0 0 0 0 ${fmt((q >> 8) / 255)} 0 0 0 0 ${fmt((q & 255) / 255)} 0.2126 0.7152 0.0722 0 0 0 0 0 1 0`;
        g.children.push({ tag: 'g', attrs: { filter: matrixFilter(ctx, vals, region) }, children: [alt('specSrc')] });
      } else if (col) g.children.push({ tag: 'g', attrs: { filter: floodFilter(ctx, col, region) }, children: [el] });
    }
    else g.children.push(el);
  } else if (node.type === 'instance') {
    evalInstance(node, Pt, T, ctx, key, copy, g);
  } else if (node.type === 'light') {
    // источник света ничего не рисует: его собирает collectLights
  } else if (node.type !== 'group') {
    const dith = H || D ? null : effectiveDither(node, Pt, ctx);
    const hv = H ? grayHex(rel.height) : null;
    const rawFill = Pt('fill'), rawStroke = Pt('stroke');
    let fill, stroke, sw = Pt('strokeWidth');
    if (D) {
      // проход: цвет данных; у фигуры без заливки (линии) — только контур (ink) и покрытие (cover)
      const hasFill = paintAlpha(rawFill) > 0, hasStroke = paintAlpha(rawStroke) > 0;
      const pa = (v) => Math.min(1, paintAlpha(v));
      const fc = hasFill ? dataPaint(ctx, surf, opAcc * pa(rawFill)) : null;
      fill = fc || 'none';
      if (ctx.mode === 'ink') {
        stroke = surf?.ink ? '#000000' : 'none';
        if (surf?.ink) sw = surf.sw ?? (hasStroke ? sw : 2);
      } else if (hasStroke && (hasFill || surf?.base || ctx.mode === 'cover')) {
        stroke = (hasFill ? fc : dataPaint(ctx, surf, opAcc * pa(rawStroke))) || 'none';
      } else stroke = 'none';
    } else {
      fill = H ? (rawFill && rawFill !== 'none' ? hv : 'none') : dith ? 'none' : paintAttr(rawFill, nkey, 'fg', ctx);
      stroke = H ? (rawStroke && rawStroke !== 'none' ? hv : 'none') : paintAttr(rawStroke, nkey, 'sg', ctx);
    }
    // полупрозрачный лист с одной краской: fill-opacity / stroke-opacity вместо opacity группы
    const single = !H && !D && opacity < 1 && !kids.length && !dith && !g.attrs.filter && !g.attrs.style && (fill === 'none') !== (stroke === 'none');
    if (single) g.attrs.opacity = null;
    if (node.type === 'text') {
      const txt = String(Pt('text') ?? '');
      const reveal = clamp(Pt('textReveal'));
      const shown = txt.slice(0, Math.round(txt.length * reveal));
      const anchor = { left: 'start', center: 'middle', right: 'end' }[Pt('textAlign')] || 'middle';
      // текст по кривой: путь — в <defs>, начало — pathOffset (0..1) плюс выравнивание
      const tp = textPathOf(node, Pt, T, ctx, nkey);
      const startOffset = tp ? fmt(100 * ((Pt('pathOffset') ?? 0) + (anchor === 'middle' ? 0.5 : anchor === 'end' ? 1 : 0))) + '%' : null;
      g.children.push({
        tag: 'text',
        attrs: {
          x: tp ? null : 0, y: tp ? null : 0, 'text-anchor': anchor, 'dominant-baseline': 'central',
          'font-size': fmt(Pt('fontSize')), 'font-family': Pt('fontFamily'), 'font-weight': Pt('fontWeight'),
          'letter-spacing': fmt(Pt('letterSpacing')), fill, stroke, 'stroke-width': stroke !== 'none' ? fmt(sw) : null,
          'fill-opacity': single && fill !== 'none' ? fmt(clamp(opacity)) : null, 'stroke-opacity': single && stroke !== 'none' ? fmt(clamp(opacity)) : null,
          filter: H ? heightFilter(ctx, rel, false) : null,
        },
        ...(tp ? { children: [{ tag: 'textPath', attrs: { href: '#' + tp, startOffset }, text: shown }] } : { text: shown }),
      });
    } else {
      const geom = nodeGeom(node, T, ctx, copy);
      // вырожденные фигуры (< 0.3 px по ширине или высоте) не рисуются: resvg на них падает
      const [bw, bh] = geomBox(geom), kpx = scaleHere;
      const thin = fill !== 'none' && stroke === 'none' ? bw * kpx < 0.3 || bh * kpx < 0.3 : D && bw * kpx < 0.3 && bh * kpx < 0.3;
      if (thin) { fill = 'none'; stroke = 'none'; }
      const d = geomToPath(geom);
      const attrs = { d, fill, stroke, 'fill-rule': p.fillRule || null };
      if (single && fill !== 'none') attrs['fill-opacity'] = fmt(clamp(opacity));
      if (single && stroke !== 'none') attrs['stroke-opacity'] = fmt(clamp(opacity));
      if (stroke !== 'none') {
        attrs['stroke-width'] = fmt(sw);
        attrs['stroke-linecap'] = Pt('lineCap');
        attrs['stroke-linejoin'] = Pt('lineJoin');
        const ts = Pt('trimStart'), te = Pt('trimEnd'), to = Pt('trimOffset');
        const dash = Pt('dash');
        if (ts > 0 || te < 1) {
          const L = measureGeom(geom, 12).length;
          const td = trimDash(ts, te, to, L);
          if (td && td.hide) attrs.stroke = 'none';
          else if (td) { attrs['stroke-dasharray'] = td.dash; attrs['stroke-dashoffset'] = 0; }
        } else if (Array.isArray(dash) && dash.length) {
          attrs['stroke-dasharray'] = dash.map(fmt).join(' ');
          attrs['stroke-dashoffset'] = fmt(Pt('dashOffset') ?? 0);
        }
      }
      if (p.strokeFirst) attrs['paint-order'] = 'stroke';
      if (H && (fill !== 'none' || attrs.stroke !== 'none')) attrs.filter = heightFilter(ctx, rel, false);
      if (thin) { /* ничего */ }
      else if (dith) {
        const filled = ditherElements(geom, d, dith, Pt('fill'), p.fillRule, ctx, nkey);
        if (filled) g.children.push(filled);
        if (attrs.stroke !== 'none') g.children.push({ tag: 'path', attrs });
      } else if (D && ctx.mode === 'normal' && surf?.normalGrad && attrs.fill !== 'none') {
        // градиент нормали: слои одной формы, второй и далее — lighten (лишние каналы канальных слоёв — 0)
        const paints = normalGradPaints(ctx, surf.normalGrad);
        if (!paints.length) g.children.push({ tag: 'path', attrs });
        paints.forEach((pt, i) => g.children.push({ tag: 'path', attrs: { ...attrs, fill: pt, stroke: i ? 'none' : attrs.stroke, style: i ? 'mix-blend-mode:lighten' : null } }));
      } else if (!D || attrs.fill !== 'none' || attrs.stroke !== 'none') g.children.push({ tag: 'path', attrs });
    }
  }

  // дети (рельеф, поверхность и прозрачность в проходах наследуются)
  const prevRel = ctx.reliefCur, prevSurf = ctx.surfCur, prevOp = ctx.opCur, prevScale = ctx.scaleCur, prevLin = ctx.linCur;
  if (rel) ctx.reliefCur = rel;
  if (D) { ctx.surfCur = surf; ctx.opCur = opAcc; ctx.linCur = linOf(ctx.linCur, rot, skx, sx, sy); }
  ctx.scaleCur = scaleHere;
  for (const ch of kids) {
    if (ctx.c.clipRefs.has(ch.id)) continue;
    const e = evalWithClip(ch, T, ctx, key, copy);
    if (e) g.children.push(e);
  }
  ctx.reliefCur = prevRel; ctx.surfCur = prevSurf; ctx.opCur = prevOp; ctx.scaleCur = prevScale; ctx.linCur = prevLin;
  if (D && !g.children.length) return null;
  return g;
}

/**
 * Путь для текста по кривой (свойство path) → id определения <path> в <defs> или null.
 * path: строка d, фигура ({shape…}, {points…}) или id узла (его геометрия со сдвигом x/y) — в координатах
 * родителя текста; собственные x/y/поворот текста к пути тоже применяются (обычно у такого текста x = y = 0).
 */
function textPathOf(node, Pt, T, ctx, nkey) {
  const v = Pt('path');
  if (v == null || v === '') return null;
  let geom;
  const ref = typeof v === 'string' && ctx.c.byId.get(v);
  if (ref && ref !== node) {
    geom = nodeGeom(ref, T, ctx, 0);
    const dx = propValue(ref, 'x', T, ctx), dy = propValue(ref, 'y', T, ctx);
    if (dx || dy) geom = translateGeom(geom, dx, dy);
  } else geom = toGeom(v, T);
  if (!geom.length) return null;
  const id = ctx.id(nkey, 'tp');
  ctx.addDef({ tag: 'path', attrs: { id, d: geomToPath(geom) } });
  return id;
}

/**
 * Сцена-оболочка символа: его узлы со своим индексом и кэшами. Хранится в кэше текущей сцены — любая правка
 * сцены (и символов в ней) сбрасывает и её.
 */
export function symbolScene(scene, c, name) {
  const sym = scene.symbols?.[name];
  if (!sym || !Array.isArray(sym.nodes)) return null;
  if (!c.symScenes) c.symScenes = new Map();
  let e = c.symScenes.get(name);
  if (!e || e.sym !== sym || e.nodes !== sym.nodes) {
    e = { sym, nodes: sym.nodes, scene: { ...scene, nodes: sym.nodes, duration: sym.duration ?? scene.duration, states: undefined, clips: undefined } };
    c.symScenes.set(name, e);
  }
  return e.scene;
}
/** Время символа для экземпляра: явное symbolTime или локальное время узла; по длительности символа — по кругу или с остановкой. */
export function instanceTime(sym, T, Pt) {
  let st = Pt('symbolTime');
  if (st == null) st = T;
  const dur = sym.duration;
  if (dur > 0) st = Pt('loop') === false ? clamp(st, 0, dur) : ((st % dur) + dur) % dur;
  return st;
}
const SYMBOL_DEPTH = 8;
/**
 * Экземпляр символа: узлы символа вычисляются как дети узла instance во времени символа. Состояния, выбор
 * подмножества (only) и IK основной сцены внутрь не проходят; IK внутри символа решается по его узлам.
 * data-node у внутренних элементов нет — в редакторе выбирается сам экземпляр.
 */
function evalInstance(node, Pt, T, ctx, key, copy, g) {
  const name = Pt('symbol');
  const ss = name != null && symbolScene(ctx.scene, ctx.c, name);
  if (!ss || ctx.symStack.includes(name) || ctx.symStack.length >= SYMBOL_DEPTH) return;
  const st = instanceTime(ss, T, Pt);
  const saved = [ctx.scene, ctx.c, ctx.over, ctx.allowed, ctx.ikRot];
  ctx.scene = ss; ctx.c = index(ss); ctx.over = null; ctx.allowed = null; ctx.ikRot = null;
  ctx.symStack.push(name);
  try {
    if (ctx.c.ik.length) solveIK(ctx, st);
    const k2 = `${key}~${node.id}`;
    for (const ch of ctx.c.children.get(null) || []) {
      if (ctx.c.clipRefs.has(ch.id)) continue;
      const e = evalWithClip(ch, st, ctx, k2, copy);
      if (e) g.children.push(e);
    }
  } finally {
    ctx.symStack.pop();
    [ctx.scene, ctx.c, ctx.over, ctx.allowed, ctx.ikRot] = saved;
  }
}

/**
 * Статичное поддерево: ничего не зависит от времени (нет ключей, анимирующих модификаторов, спрайт-листов
 * по fps, IK, состояний). Его вычисленный вид можно переиспользовать между кадрами (opts.cache — плеер).
 */
export function staticTree(c, n) {
  const memo = c.stat;
  if (memo.has(n.id)) return memo.get(n.id);
  memo.set(n.id, false); // защита от циклов
  const p = n.props || {};
  let s = !c.ikAffected.has(n.id) && !c.stateAffected.has(n.id) && p.inPoint == null && p.outPoint == null;
  if (s && n.keys) for (const k in n.keys) if (n.keys[k].length > 1) { s = false; break; }
  if (s && n.mods) s = n.mods.every(modIsStatic);
  const live = (v) => v && typeof v === 'object' && v.shape === 'blob' && (v.speed ?? 0.5) !== 0;
  if (s && typeAnimated(n)) s = false; // клякса с движением, спрайт-лист, свет (реестр типов)
  if (s && (live(p.d) || live(p.shape))) s = false;
  if (s) for (const k of ['clip', 'mask']) if (p[k] && c.byId.has(p[k]) && !staticTree(c, c.byId.get(p[k]))) s = false;
  if (s && n.type === 'text' && typeof p.path === 'string' && c.byId.has(p.path) && !staticTree(c, c.byId.get(p.path))) s = false;
  if (s) for (const ch of c.children.get(n.id) || []) if (!staticTree(c, ch)) { s = false; break; }
  memo.set(n.id, s);
  return s;
}

const sameLin = (a, b) => a === b || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]);
export function evalWithClip(node, t, ctx, key, copy) {
  const mi = modeInfo(ctx.mode);
  if (ctx.cache && !ctx.recording && !ctx.allowed && (mi.cache || mi.data) && !ctx.inClip && copy === 0 && staticTree(ctx.c, node)) {
    const ck = `${node.id}|${key}|${ctx.prefix}|${ctx.mode}`;
    const hit = ctx.c.evalCache.get(ck);
    // вид кэшируется вместе с накопленным масштабом предков (от него зависит отсев «тонких» фигур), а в проходах
    // данных — ещё с унаследованной поверхностью (мемо resolveSurface: тот же объект у статичных предков),
    // накопленной непрозрачностью и линейной частью матрицы (нормали картинок)
    if (hit && hit.scale === ctx.scaleCur && (!mi.data || (hit.surf === ctx.surfCur && hit.op === ctx.opCur && sameLin(hit.lin, ctx.linCur)))) { for (const d of hit.defs) ctx.addDef(d); return hit.el; }
    const defs = [];
    ctx.recording = true; ctx.recorders.push(defs);
    let el;
    try { el = evalWithClipRaw(node, t, ctx, key, copy); }
    finally { ctx.recorders.pop(); ctx.recording = false; }
    ctx.c.evalCache.set(ck, { el, defs, scale: ctx.scaleCur, surf: ctx.surfCur, op: ctx.opCur, lin: ctx.linCur });
    return el;
  }
  return evalWithClipRaw(node, t, ctx, key, copy);
}

export function evalWithClipRaw(node, t, ctx, key, copy) {
  const el = evalNode(node, t, ctx, key, copy);
  if (!el) return null;
  const p = node.props || {};
  let wrap = el;
  for (const kind of ['clip', 'mask']) {
    const ref = p[kind];
    if (!ref) continue;
    const src = ctx.c.byId.get(ref);
    if (!src) continue;
    ctx.inClip++;
    const content = evalNode(src, t, ctx, `${key}${kind}`, copy);
    ctx.inClip--;
    if (!content) { if (kind === 'clip') return null; continue; }
    const id = ctx.id(`${node.id}${key}-${ref}`, kind === 'clip' ? 'c' : 'm');
    if (kind === 'clip') {
      ctx.addDef({ tag: 'clipPath', attrs: { id, clipPathUnits: 'userSpaceOnUse' }, children: flattenShapes(content) });
      wrap = { tag: 'g', attrs: { 'clip-path': `url(#${id})` }, children: [wrap] };
    } else {
      ctx.addDef({ tag: 'mask', attrs: { id, maskUnits: 'userSpaceOnUse', x: -1e5, y: -1e5, width: 2e5, height: 2e5 }, children: [content] });
      wrap = { tag: 'g', attrs: { mask: `url(#${id})` }, children: [wrap] };
    }
  }
  return wrap;
}

/** clipPath не допускает <g>: переносим трансформации прямо на фигуры. */
export function flattenShapes(n, tf = '', out = []) {
  const t2 = [tf, n.attrs?.transform].filter(Boolean).join(' ');
  if (n.tag === 'g') { for (const c of n.children || []) flattenShapes(c, t2, out); }
  else if (n.tag === 'path' || n.tag === 'text') out.push({ ...n, attrs: { ...n.attrs, transform: t2 || null, 'clip-rule': n.attrs?.['fill-rule'] || null } });
  return out;
}

/** Вычислить сцену в момент t. Возвращает дерево отображения {tag, attrs, children}. */
export function evaluate(scene, t, opts = {}) {
  const ctx = new Ctx(scene, opts);
  if (ctx.c.ik.length) solveIK(ctx, t);
  ctx.fm = frameMemo(ctx, t, opts);
  const roots = ctx.c.children.get(null) || [];
  const body = [];
  for (const n of roots) {
    if (ctx.c.clipRefs.has(n.id)) continue;
    const e = evalWithClip(n, t, ctx, '', 0);
    if (e) body.push(e);
  }
  const showBg = opts.background ?? !opts.only;
  const bgFill = ctx.mode === 'height' ? grayHex(ctx.relief.background)
    : ctx.data ? PASS_BG[ctx.mode] ?? (ctx.maskTag ? '#000000' : null)
    : scene.background && scene.background !== 'none' ? paintAttr(scene.background, 'bg', 'bg', ctx) : null;
  const bg = showBg && bgFill ? [{ tag: 'rect', attrs: { x: 0, y: 0, width: scene.width, height: scene.height, fill: bgFill } }] : [];
  // viewBox: [x, y, w, h] — кадрирование (например, для вырезки слоя)
  const vb = opts.viewBox || [0, 0, scene.width, scene.height];
  const ow = opts.width ?? vb[2];
  // пиксельный режим: без сглаживания краёв (растр потом увеличивается без фильтрации)
  // проходы с данными (нормали, плоскости) — без сглаживания: смешанный край дал бы мусорную нормаль
  const crisp = opts.crisp ?? !!modeInfo(ctx.mode).crisp;
  return {
    tag: 'svg',
    attrs: { xmlns: 'http://www.w3.org/2000/svg', 'xmlns:xlink': 'http://www.w3.org/1999/xlink', viewBox: vb.map(fmt).join(' '), width: ow, height: opts.height ?? Math.round((ow * vb[3]) / vb[2]),
      'shape-rendering': crisp ? 'crispEdges' : null, 'image-rendering': crisp ? 'optimizeSpeed' : null, 'text-rendering': crisp ? 'optimizeSpeed' : null },
    children: [{ tag: 'defs', attrs: {}, children: ctx.defs }, ...bg, ...body],
  };
}
