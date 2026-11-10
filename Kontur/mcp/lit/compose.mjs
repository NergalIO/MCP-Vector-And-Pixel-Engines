// Сборка HDR-кадра: альбедо × свет (живописный режим, персонажи-спрайты, «плоские» узлы), блики, свечение, туман,
// воздушная перспектива и небо (градиент с облаками, звёздами и луной из прохода color).
import { clamp01, smoothstep, Y3, lin22, LIN8 } from './util.mjs';
import { lightColors } from './shade.mjs';

/** Цвет кадра col (линейный HDR, n·3) и свечение emL (n·3). */
export function composeSurface(G, st, { light, lampL, specT, lin }) {
  const { n, mask, cover, chm, em, Pz } = G, L = st.sun.dir;
  const { sunC, skyC, gC } = lightColors(st);
  const P = st.paint;
  // персонажи: спрайты уже нарисованы со светотенью — свет нормируется и смешивается с единицей
  const ca = st.characters.amount ?? 0.45, ref = [0, 1, 2].map((c) => skyC[c] * 0.8 + sunC[c] * 0.75);
  const col = new Float32Array(n * 3), emL = new Float32Array(n * 3);
  const emI = st.emissive ?? 0.25;
  const fogK = st.fog?.density ?? 0, fogS = st.fog?.start ?? 6, fogAmt = st.fog?.amount ?? 0.6, fogC = (st.fog?.color || [0, 0, 0]).map(lin22);
  // «плоские» пиксели: покрыты узлами без поверхности поверх неба — фон + солнце для нормали к камере, без теней
  const flatSun = clamp01(-L[2]);
  const sepLamps = lampL !== light;
  // живописный режим: опорная яркость «полного света», тон тени, нормированный по яркости (сдвиг тона, не затемнение)
  const refL = Math.max(1e-4, Y3(skyC[0] + sunC[0], skyC[1] + sunC[1], skyC[2] + sunC[2]));
  const pTint = P ? (() => { const y = Math.max(1e-4, Y3(...P.shadow)); return P.shadow.map((v) => v / y); })() : null;
  const pR0 = P ? P.range[0] : 0, pR1 = P ? P.range[1] : 1;
  const li3 = [0, 0, 0], al3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const ch = chm[i];
    if (P && mask[i]) {
      const j = i * 3, b0 = light[j], b1 = light[j + 1], b2 = light[j + 2], l = Y3(b0, b1, b2);
      // 1) цвет солнца и неба окрашивает поверхность лишь на долю chroma — локальный цвет сохраняется
      // 2) тень: доля s от «полного света» сдвигает тон к paint.shadow и подсвечивается заливкой fill
      const s = 1 - smoothstep(pR0, pR1, l / refL), ls = Y3(lampL[j], lampL[j + 1], lampL[j + 2]) / refL;
      const pS = s * (1 - smoothstep(0, pR1, ls));
      for (let c = 0; c < 3; c++) {
        const b = l + ((c === 0 ? b0 : c === 1 ? b1 : b2) - l) * P.chroma;
        li3[c] = b * (1 + (pTint[c] - 1) * s * P.amount) + refL * P.fill * s * pTint[c] + lampL[j + c];
      }
      const la = Y3(lin[j], lin[j + 1], lin[j + 2]), kd = 1 - pS * P.desat;
      for (let c = 0; c < 3; c++) al3[c] = la + (lin[j + c] - la) * kd;
    }
    for (let c = 0; c < 3; c++) {
      const j = i * 3 + c;
      let li = P && mask[i] ? li3[c] : light[j] + (sepLamps ? lampL[j] : 0);
      if (ch > 0) li = li * (1 - ch) + ((1 - ca) + ca * (li / ref[c]) * 0.85) * ch;
      if (!mask[i] && cover[i]) li = skyC[c] * 0.5 + gC[c] * 0.5 + sunC[c] * flatSun;
      emL[j] = LIN8[em[i * 4 + c]] * emI;
      let v = (P && mask[i] && ch < 1 ? al3[c] * (1 - ch) + lin[j] * ch : lin[j]) * li + (mask[i] ? specT[j] : 0) + emL[j];
      if (mask[i] && fogK > 0) { const fa = 1 - Math.exp(-Math.min(200, Math.max(0, Pz[i] - fogS)) * fogK); v = v * (1 - fa) + fogC[c] * fa * fogAmt; }
      col[j] = v;
    }
  }
  // воздушная перспектива: с глубиной цвет теряет насыщенность, сдвигается к aerial.color и чуть светлеет (дымка)
  const AE = st.aerial;
  if (AE) {
    const ay = Math.max(1e-4, Y3(...AE.color)), aT = AE.color.map((v) => v / ay), aL = AE.color.map(lin22);
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const a = (1 - Math.exp(-Math.min(200, Math.max(0, Pz[i] - AE.start)) * AE.density)) * AE.amount;
      if (a <= 1e-4) continue;
      const j = i * 3, l = Y3(col[j], col[j + 1], col[j + 2]), kd = 1 - a * AE.desat;
      for (let c = 0; c < 3; c++) col[j + c] = (l + (col[j + c] - l) * kd) * (1 + (aT[c] - 1) * a * AE.shift) + aL[c] * a * AE.lift;
    }
  }
  return { col, emL };
}

/** Небо (на месте в col): пиксели без поверхности и покрытия. gradient — свой градиент с облаками из прохода color. */
export function composeSky(G, st, col, lin) {
  const { W, H, n, k, W0, H0, mask, cover } = G;
  const bd = st.backdrop || { mode: 'albedo' };
  if (!(bd.mode === 'gradient' && bd.colors?.length === 3)) {
    for (let i = 0; i < n; i++) if (!mask[i] && !cover[i]) for (let c = 0; c < 3; c++) col[i * 3 + c] = lin[i * 3 + c];
    return;
  }
  const [ga, gb, gc] = bd.colors.map((c) => c.map(lin22));
  // медиана неба по строке: облака — то, что светлее медианы
  const rm = new Float32Array(H * 3), buf = [];
  for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) {
    buf.length = 0;
    for (let x = 0; x < W; x++) { const i = y * W + x; if (!mask[i]) buf.push(lin[i * 3 + c]); }
    if (buf.length) { buf.sort((p, q) => p - q); const m = buf.length >> 1; rm[y * 3 + c] = buf.length % 2 ? buf[m] : (buf[m - 1] + buf[m]) / 2; }
  }
  const cloudK = bd.clouds ?? 1.2;
  const moon = bd.moon ? { x: (bd.moon.x <= 1 ? bd.moon.x * W0 : bd.moon.x) * k, y: (bd.moon.y ?? 120) * k, r: (bd.moon.r ?? 38) * k } : null;
  let sd = 3;
  const srnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const tH = Math.max(0.01, (G.cam.cm.horEff + 120) / H0);
  for (let y = 0; y < H; y++) {
    const tY = clamp01(y / H / tH);
    const gcol = [0, 1, 2].map((c) => (tY < 0.6 ? ga[c] + (gb[c] - ga[c]) * (tY / 0.6) : gb[c] + (gc[c] - gb[c]) * ((tY - 0.6) / 0.4)));
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const star = bd.stars ? srnd() > 0.9993 : false; // ГСЧ звёзд идёт по всем пикселям: узор не зависит от сцены
      if (mask[i] || cover[i]) continue;
      let cl = 0;
      for (let c = 0; c < 3; c++) cl += lin[i * 3 + c] - rm[y * 3 + c];
      cl = clamp01(cl / 3);
      for (let c = 0; c < 3; c++) {
        let v = gcol[c] + cl * cloudK * (gb[c] * 0.6 + 0.4);
        if (star) v += 0.9 * (1 - tY) ** 2;
        if (moon) { const d2 = (x - moon.x) ** 2 + (y - moon.y) ** 2; if (d2 < moon.r * moon.r) v += [0.9, 0.9, 0.8][c]; v += Math.exp(-d2 / (9000 * k * k)) * 0.2 * [0.5, 0.6, 1][c]; }
        col[i * 3 + c] = v;
      }
    }
  }
}
