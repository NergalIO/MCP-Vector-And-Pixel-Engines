/** Мировые матрицы, двухзвенный IK, источники света. */
import { Ctx } from './ctx.js';
import { DEG, clamp, mat } from './math.js';
import { cameraModel } from './surface.js';
import { propValue } from './values.js';

/** Локальные значения трансформации узла в его локальное время T. */
export function localTf(node, T, ctx) {
  const P = (n) => propValue(node, n, T, ctx, 0);
  const sc = P('scale');
  return { x: P('x'), y: P('y'), rotation: P('rotation'), skewX: P('skewX'), scaleX: sc * P('scaleX'), scaleY: sc * P('scaleY'), anchorX: P('anchorX'), anchorY: P('anchorY') };
}
export const localTime = (node, T) => (T - (node.props?.timeOffset ?? 0)) * (node.props?.timeScale ?? 1);

/** Мировая матрица узла (включая его собственную трансформацию) и его локальное время. */
export function worldOf(ctx, id, t) {
  const chain = [];
  let n = id ? ctx.c.byId.get(id) : null;
  while (n) { chain.unshift(n); n = n.parent ? ctx.c.byId.get(n.parent) : null; }
  let m = mat.id(), T = t;
  for (const x of chain) { T = localTime(x, T); m = mat.mul(m, mat.compose(localTf(x, T, ctx))); }
  return { m, T };
}

/** Мировая матрица узла в момент t (с учётом IK и состояний). */
export function nodeWorldMatrix(scene, id, t = 0, opts = {}) {
  const ctx = new Ctx(scene, opts);
  if (ctx.c.ik.length) solveIK(ctx, t);
  return worldOf(ctx, id, t).m;
}

export const wrapDeg = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
/** Двухзвенный IK: поворачивает деда (A) и родителя (B) конечного узла E так, чтобы E оказался в точке цели. */
export function solveIK(ctx, t) {
  ctx.ikRot = new Map();
  const by = ctx.c.byId;
  for (const ch of ctx.c.ik) {
    const A = by.get(ch.root), B = by.get(ch.mid), E = by.get(ch.end), tgt = by.get(ch.cfg.target);
    const { m: PA, T: TP } = worldOf(ctx, A.parent, t);
    const TA = localTime(A, TP), TB = localTime(B, TA), TE = localTime(E, TB);
    const a = localTf(A, TA, ctx), b = localTf(B, TB, ctx), e = localTf(E, TE, ctx);
    const wIK = clamp(propValue(E, 'ikWeight', TE, ctx) ?? 1);
    // цель — точка опоры (anchor) целевого узла
    const tw = worldOf(ctx, tgt.id, t);
    const ta = localTf(tgt, tw.T, ctx);
    const [gx, gy] = mat.apply(mat.inv(PA), ...mat.apply(tw.m, ta.anchorX, ta.anchorY));
    // звенья в повёрнутой системе A (до поворота): u0 — к суставу B, w — от B к E
    const u0 = [a.scaleX * (b.x - a.anchorX), a.scaleY * (b.y - a.anchorY)];
    const w2 = [b.scaleX * (e.x - b.anchorX), b.scaleY * (e.y - b.anchorY)];
    const s = Math.sqrt(Math.abs(a.scaleX * a.scaleY)) || 1, refl = a.scaleX * a.scaleY < 0, sg = refl ? -1 : 1;
    const wF = [Math.sign(a.scaleX || 1) * w2[0], Math.sign(a.scaleY || 1) * w2[1]];
    const L1 = Math.hypot(...u0), L2 = s * Math.hypot(...wF);
    if (L1 < 1e-6 || L2 < 1e-6) continue;
    const dx = gx - a.x, dy = gy - a.y;
    const D = clamp(Math.hypot(dx, dy), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
    const phi = Math.acos(clamp((D * D - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1));
    const angU = Math.atan2(u0[1], u0[0]), angW = Math.atan2(wF[1], wF[0]);
    // сторона сгиба: явно (bend: 1|-1) или как в текущей (FK) позе
    let side = ch.cfg.bend;
    if (side !== 1 && side !== -1) {
      const rel = wrapDeg(sg * b.rotation + (angW - angU) / DEG);
      side = rel < 0 ? -1 : 1;
    }
    if (ch.cfg.flip) side = -side;
    const thB = sg * (angU + side * phi - angW);
    const sec = [s * Math.cos(sg * thB + angW) * Math.hypot(...wF), s * Math.sin(sg * thB + angW) * Math.hypot(...wF)];
    const thA = Math.atan2(dy, dx) - Math.atan2(u0[1] + sec[1], u0[0] + sec[0]);
    const blend = (fk, ik) => fk + wrapDeg(ik - fk) * wIK;
    ctx.ikRot.set(A.id, blend(a.rotation, thA / DEG));
    ctx.ikRot.set(B.id, blend(b.rotation, thB / DEG));
    if (ch.cfg.orient) {
      // конечное звено повторяет поворот цели (например, стопа стоит ровно на полу)
      const MB = worldOf(ctx, B.id, t).m;
      const angB = Math.atan2(MB[1], MB[0]), angT = Math.atan2(tw.m[1], tw.m[0]);
      const r = (MB[0] * MB[3] - MB[1] * MB[2] < 0 ? angB - angT : angT - angB) / DEG + (ch.cfg.orientOffset ?? 0);
      ctx.ikRot.set(E.id, blend(e.rotation, r));
    }
  }
}

/** Источники света в момент t: мировая позиция, высота, цвет, энергия, радиус. */
export function collectLights(scene, t = 0, opts = {}) {
  const ctx = new Ctx(scene, opts);
  if (ctx.c.ik.length) solveIK(ctx, t);
  const out = [];
  for (const n of scene.nodes) {
    if (n.type !== 'light') continue;
    const { m, T } = worldOf(ctx, n.id, t);
    const P = (k) => propValue(n, k, T, ctx);
    if (P('visible') === false || P('enabled') === false) continue;
    let hidden = false;
    for (let p = n.parent; p && !hidden; p = ctx.c.byId.get(p)?.parent) { const pn = ctx.c.byId.get(p); if (pn && propValue(pn, 'visible', t, ctx) === false) hidden = true; }
    if (hidden) continue;
    const [x, y] = mat.apply(m, P('anchorX'), P('anchorY'));
    const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const l = { id: n.id, x, y, z: P('z'), color: P('color'), energy: P('energy') * clamp(P('opacity')), radius: P('radius') * k, falloff: P('falloff') ?? 1 };
    const p3 = P('p3'), c3 = scene.camera3d, cm = c3 && cameraModel({ dz: 0, ...c3 }, scene.width);
    if (Array.isArray(p3) && p3.length >= 3) {
      // 3D-источник: radius — в единицах мира; для 2D-превью и экспорта — проекция камерой
      l.p3 = p3.slice(0, 3); l.radius3 = P('radius'); l.group = P('group') || 'lamp';
      const sh = P('shadows'); if (sh != null) l.shadows = !!sh;
      if (c3) {
        const zz = Math.max(0.05, cm.depth(p3));
        if (cm.plain) { l.x = cm.cx + (cm.f * p3[0]) / zz; l.y = cm.horEff + (cm.f * (cm.camH - p3[1])) / zz; }
        else [l.x, l.y] = cm.P(p3);
        l.radius = l.radius3 * (cm.f / zz); l.z = Math.max(20, l.radius * 0.25);
      }
    }
    out.push(l);
  }
  return out;
}
