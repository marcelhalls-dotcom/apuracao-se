/* Cadê Meu Voto · Modo Arcade: cena em canvas (pixel art 100% original, gerada por código).
 * Lutadores idênticos e espelhados (só a faixa muda), praça com público genérico e urna estilizada. Sem imagens externas. */
(function () {
  'use strict';
  const W = 320, H = 180, SW = 44, SH = 60;
  const reduz = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Paletas em 4 tons (escuro, médio, claro, brilho)
  const MAT = {
    A: ['#07070a', '#15151c', '#26262f', '#3a3a46'],      // cabelo escuro
    S: ['#7a4a2c', '#a8683f', '#c98f62', '#e2b48c'],      // pele genérica
    K: ['#22262d', '#353b45', '#4b5361', '#646e7f'],      // kimono grafite
    B: ['#141821', '#232934', '#343c4a', '#465062'],      // bandana cinza-escuro
    G: ['#10131a', '#1d222c', '#2c3340', '#40495a'],      // luvas cinza-escuro
  };
  const FAIXA = { pt: ['#6d0a0d', '#a51218', '#d4262c', '#f0646a'], pl: ['#0a2a63', '#123f91', '#1f5fc8', '#5b8fe6'] };
  const OUT = '#05050a';

  // ---------- gerador de sprite ----------
  function grade() { return { m: new Array(SW * SH).fill(null), t: new Array(SW * SH).fill(0) }; }
  function pinta(g, x, y, mat, tom) { x = Math.round(x); y = Math.round(y); if (x < 1 || y < 1 || x >= SW - 1 || y >= SH - 1) return; g.m[y * SW + x] = mat; g.t[y * SW + x] = tom; }
  // Elipse sombreada: luz vinda de cima/frente (direita, pois o sprite base olha para a direita)
  function elipse(g, cx, cy, rx, ry, mat) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, d = dx * dx + dy * dy; if (d > 1) continue;
      const l = -dx * 0.55 + dy * 0.75 + d * 0.5; // maior = mais escuro
      pinta(g, x, y, mat, l > 0.95 ? 0 : l > 0.35 ? 1 : l > -0.25 ? 2 : 3);
    }
  }
  function membro(g, pts, r, mat) { // cadeia de segmentos grossos
    for (let i = 0; i < pts.length - 1; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[i + 1], n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2);
      for (let k = 0; k <= n; k++) { const t = k / n; elipse(g, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, r, r, mat); } }
  }
  function caixa(g, x0, y0, x1, y1, mat) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const u = (x - x0) / Math.max(1, x1 - x0), v = (y - y0) / Math.max(1, y1 - y0); const l = (1 - u) * 0.6 + v * 0.6; pinta(g, x, y, mat, l > 0.95 ? 0 : l > 0.55 ? 1 : l > 0.2 ? 2 : 3); } }

  // pose: { bob, bracos: 'guarda'|'carga'|'disparo', fita }
  function desenhaPose(p) {
    const g = grade(), b = p.bob, hx = 23, base = SH - 3;
    // pernas (base larga), calça do kimono
    membro(g, [[19, 36 + b], [13, 45], [10, base - 2]], 3.2, 'K');
    membro(g, [[26, 36 + b], [32, 45], [34, base - 2]], 3.2, 'K');
    caixa(g, 7, base - 2, 12, base, 'S'); caixa(g, 32, base - 2, 38, base, 'S');
    // braço de trás (desenhado antes do tronco)
    const br = p.bracos;
    let tras, frente, lt, lf;
    if (br === 'carga') { tras = [[18, 22 + b], [14, 30 + b], [17, 34 + b]]; frente = [[28, 22 + b], [24, 30 + b], [19, 33 + b]]; lt = [17, 34 + b]; lf = [20, 32 + b]; }
    else if (br === 'disparo') { tras = [[18, 22 + b], [28, 25 + b], [38, 26 + b]]; frente = [[28, 22 + b], [34, 23 + b], [40, 23 + b]]; lt = [38, 27 + b]; lf = [40, 23 + b]; }
    else { const s = p.sw || 0; tras = [[18, 22 + b], [17, 30 + b], [25, 26 + b + s]]; frente = [[28, 21 + b], [34, 26 + b], [36, 17 + b - s]]; lt = [26, 25 + b + s]; lf = [36, 16 + b - s]; }
    membro(g, tras, 2.6, 'S'); elipse(g, lt[0], lt[1], 3.2, 3, 'G');
    // tronco musculoso (kimono sem mangas, gola em V mostrando peito)
    elipse(g, 23, 28 + b, 8, 9, 'K');
    for (let y = 20; y < 29; y++) for (let x = 23 - (28 - y) * 0.45; x <= 23 + (28 - y) * 0.45; x++) pinta(g, x, y + b, 'S', y < 24 ? 2 : 1);
    elipse(g, 18, 22 + b, 3.4, 3, 'S'); elipse(g, 28, 22 + b, 3.4, 3, 'S'); // ombros
    caixa(g, 15, 33 + b, 31, 35 + b, 'F'); // faixa
    membro(g, [[17, 35 + b], [14 - p.fita, 41 + b]], 0.9, 'F'); // ponta da faixa
    // cabeça
    elipse(g, hx + 1, 13 + b, 5.2, 6, 'S');
    for (let x = 18; x <= 30; x++) for (let y = 5; y <= 9; y++) if (((x - 24) / 6.2) ** 2 + ((y - 10) / 5) ** 2 <= 1) pinta(g, x, y + b, 'A', y < 7 ? 2 : 1);
    caixa(g, 18, 9 + b, 29, 10 + b, 'B'); // bandana
    membro(g, [[18, 10 + b], [13 - p.fita, 11 + b + p.fita * 0.4], [9 - p.fita * 1.5, 13 + b]], 0.9, 'B'); // pontas ao vento
    pinta(g, 27, 13 + b, 'A', 0); pinta(g, 28, 13 + b, 'A', 0); // olho genérico
    pinta(g, 27, 12 + b, 'A', 1); pinta(g, 28, 17 + b, 'S', 0); pinta(g, 29, 17 + b, 'S', 0); // sobrancelha e boca
    // braço da frente
    membro(g, frente, 2.8, 'S'); elipse(g, lf[0], lf[1], 3.4, 3.2, 'G');
    return { g, maoTras: lt, maoFrente: lf };
  }
  function rasteriza(pose, faixa) {
    const { g, maoFrente } = desenhaPose(pose); const c = document.createElement('canvas'); c.width = SW; c.height = SH; const x = c.getContext('2d');
    const pal = Object.assign({}, MAT, { F: FAIXA[faixa] });
    for (let y = 0; y < SH; y++) for (let i = 0; i < SW; i++) {
      const m = g.m[y * SW + i];
      if (m) { x.fillStyle = pal[m][g.t[y * SW + i]]; x.fillRect(i, y, 1, 1); }
      else if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => g.m[(y + b) * SW + i + a])) { x.fillStyle = OUT; x.fillRect(i, y, 1, 1); }
    }
    return { c, mao: maoFrente };
  }
  // 6 frames de guarda (balanço) + carga + disparo, para cada faixa. Cacheado uma vez.
  const BOB = [0, 1, 2, 2, 1, 0], SWG = [0, 0, 1, 1, 1, 0], FITA = [0, 1, 2, 2, 1, 0];
  let SPR = null;
  function sprites() {
    if (SPR) return SPR; SPR = {};
    for (const f of ['pt', 'pl']) SPR[f] = { idle: BOB.map((b, i) => rasteriza({ bob: b, sw: SWG[i], fita: FITA[i], bracos: 'guarda' }, f)), carga: rasteriza({ bob: 2, fita: 2, bracos: 'carga' }, f), disparo: rasteriza({ bob: 0, fita: 2, bracos: 'disparo' }, f) };
    return SPR;
  }

  // ---------- cenário ----------
  function rng(s) { return () => (s = (s * 16807) % 2147483647) / 2147483647; }
  const PUB = ['#6b7280', '#8b5e3c', '#a16207', '#0f766e', '#4d7c0f', '#78716c', '#d6d3d1', '#57534e', '#92400e', '#7c6f9b', '#c2a26b', '#3f6f5e'];
  const PELE = ['#5c3a24', '#8a5a3b', '#b07a52', '#d1a07a', '#e6c2a0'];
  let fundo = null, publico = [];
  function montaFundo() {
    const c = document.createElement('canvas'); c.width = W + 40; c.height = H; const x = c.getContext('2d');
    // céu de fim de tarde com faixas (dither)
    const ceu = ['#2a1b4d', '#3d2463', '#5b2f73', '#86407a', '#b8577a', '#e07c6c', '#f2a35e'];
    ceu.forEach((cor, i) => { x.fillStyle = cor; x.fillRect(0, i * 12, W + 40, 13); if (i) for (let k = 0; k < W + 40; k += 2) { x.fillStyle = ceu[i - 1]; x.fillRect(k + (i % 2), i * 12, 1, 1); } });
    x.fillStyle = '#ffd98a'; x.fillRect(250, 50, 14, 14); x.fillStyle = '#ffe9b8'; x.fillRect(252, 52, 10, 10); // sol
    // prédios distantes
    const r = rng(7); for (let i = 0; i < 26; i++) { const w = 10 + r() * 16, h = 20 + r() * 40, px = i * 14 - 6; x.fillStyle = '#2b2440'; x.fillRect(px, 92 - h, w, h); x.fillStyle = '#3a3157'; x.fillRect(px, 92 - h, 2, h);
      x.fillStyle = '#f5c56b'; for (let yy = 96 - h; yy < 88; yy += 5) for (let xx = px + 3; xx < px + w - 2; xx += 4) if (r() > 0.6) x.fillRect(xx, yy, 1, 2); }
    // palmeiras / árvores da praça
    for (const px of [30, 290]) { x.fillStyle = '#4a3222'; x.fillRect(px, 62, 3, 40); x.fillStyle = '#1f4d2c'; for (let k = 0; k < 6; k++) { x.fillRect(px - 12 + k * 4, 58 + (k % 2) * 3, 6, 3); } x.fillStyle = '#2f6b3d'; x.fillRect(px - 6, 56, 14, 4); }
    return c;
  }
  function montaPublico() {
    const r = rng(42); publico = [];
    for (let fila = 0; fila < 3; fila++) for (let i = 0; i < 64; i++) publico.push({ x: i * 5.4 + (fila % 2) * 2.5 + r() * 2 - 12, y: 104 + fila * 7, cor: PUB[Math.floor(r() * PUB.length)], pele: PELE[Math.floor(r() * PELE.length)], fase: r() * 6.28, f: fila });
  }
  function urna(x, t) { // urna eletrônica gigante estilizada (genérica)
    const ux = 132, uy = 76;
    x.fillStyle = '#05050a'; x.fillRect(ux - 1, uy - 1, 58, 46);
    x.fillStyle = '#d9d2c1'; x.fillRect(ux, uy, 56, 44); x.fillStyle = '#efe9db'; x.fillRect(ux, uy, 56, 3); x.fillStyle = '#b3ab98'; x.fillRect(ux, uy + 40, 56, 4);
    x.fillStyle = '#1b2a2a'; x.fillRect(ux + 4, uy + 6, 26, 18); x.fillStyle = (Math.floor(t / 600) % 2) ? '#7ee0b0' : '#5cc495'; x.fillRect(ux + 6, uy + 8, 22, 14);
    x.fillStyle = '#1b2a2a'; x.fillRect(ux + 9, uy + 11, 12, 2); x.fillRect(ux + 9, uy + 15, 8, 2); // "tela"
    for (let r0 = 0; r0 < 4; r0++) for (let c0 = 0; c0 < 3; c0++) { x.fillStyle = '#20232b'; x.fillRect(ux + 35 + c0 * 6, uy + 6 + r0 * 6, 5, 5); x.fillStyle = '#e5e7eb'; x.fillRect(ux + 37 + c0 * 6, uy + 8 + r0 * 6, 1, 1); }
    x.fillStyle = '#f2f2f2'; x.fillRect(ux + 4, uy + 30, 12, 6); x.fillStyle = '#e07b2a'; x.fillRect(ux + 18, uy + 30, 12, 6); x.fillStyle = '#2fa84f'; x.fillRect(ux + 33, uy + 30, 18, 6); // branco, corrige, confirma
    x.fillStyle = '#6b6457'; x.fillRect(ux + 18, uy + 44, 20, 20); x.fillStyle = '#4a4539'; x.fillRect(ux + 34, uy + 44, 4, 20); // pedestal
  }
  function chao(x) { // calçada de pedras portuguesas (ondas)
    for (let y = 124; y < H; y++) for (let i = 0; i < W; i++) { const onda = Math.sin(i / 9 + y / 4) > 0.15; x.fillStyle = onda ? (y < 140 ? '#2b2b33' : '#1c1c22') : (y < 140 ? '#cfc8b8' : '#a9a293'); x.fillRect(i, y, 1, 1); }
    x.fillStyle = '#05050a'; x.fillRect(0, 123, W, 1);
  }

  // ---------- loop ----------
  let cv, cx, raf = 0, t0 = 0, golpe = null, faiscas = [];
  const PX_L = 96, PX_F = W - 96, CHAO = 172; // posições simétricas
  function desenha(t) {
    const S = sprites(), cam = reduz() ? 0 : Math.sin(t / 1800) * 3;
    cx.drawImage(fundo, -20 + cam * 0.3, 0);
    for (const p of publico) { const pul = reduz() ? 0 : Math.max(0, Math.sin(t / 260 + p.fase)) * (2 - p.f * 0.3); const px = Math.round(p.x + cam * (0.6 + p.f * 0.2)), py = Math.round(p.y - pul);
      cx.fillStyle = '#05050a'; cx.fillRect(px - 1, py - 1, 6, 16); cx.fillStyle = p.cor; cx.fillRect(px, py + 4, 4, 11); cx.fillStyle = p.pele; cx.fillRect(px, py, 4, 4);
      if (Math.sin(p.fase * 3) > 0.7) { cx.fillStyle = p.pele; cx.fillRect(px + (p.fase > 3 ? -1 : 4), py - 3 - pul, 1, 4); } } // braços para cima
    urna(cx, t); chao(cx);
    // fase do golpe
    let pose = 'idle', fx = null, glow = 0;
    if (golpe) { const e = t - golpe.s;
      if (e < 600) { pose = 'carga'; glow = e / 600; }
      else if (e < 1000) { pose = 'disparo'; fx = (e - 600) / 400; }
      else if (e < 1700) { pose = 'disparo'; if (!golpe.f) { golpe.f = 1; for (let i = 0; i < 26; i++) { const a = i / 26 * 6.283; faiscas.push({ x: W / 2, y: golpeY, vx: Math.cos(a) * (0.5 + 0.35 * (i % 3)), vy: Math.sin(a) * (0.5 + 0.35 * (i % 3)), v: 1 }); } } }
      else golpe = null; }
    const fr = Math.floor(t / 140) % 6;
    const lado = (spr, px, esp) => { const s = pose === 'idle' ? spr.idle[fr] : spr[pose]; cx.save(); cx.translate(px, CHAO - SH); if (esp) { cx.scale(-1, 1); cx.drawImage(s.c, -SW / 2, 0); } else cx.drawImage(s.c, -SW / 2, 0); cx.restore(); return s; };
    // sombras no chão
    cx.fillStyle = 'rgba(0,0,0,.35)'; cx.fillRect(PX_L - 16, CHAO - 2, 32, 3); cx.fillRect(PX_F - 16, CHAO - 2, 32, 3);
    const sl = lado(S.pt, PX_L, false); lado(S.pl, PX_F, true);
    const my = CHAO - SH + sl.mao[1], mxL = PX_L - SW / 2 + sl.mao[0], mxF = PX_F + SW / 2 - sl.mao[0];
    golpeY = my;
    if (glow > 0) for (const m of [mxL + 2, mxF - 2]) { bola(m, my, 3 + glow * 6, glow * 0.45); bola(m, my, 2 + glow * 3, glow); };
    if (fx !== null) { const xl = mxL + (W / 2 - mxL) * fx, xf = mxF + (W / 2 - mxF) * fx; bola(xl, my, 6, 1); bola(xf, my, 6, 1); rastro(xl, my, -1); rastro(xf, my, 1); }
    faiscas = faiscas.filter(f => (f.v -= 0.035) > 0);
    for (const f of faiscas) { f.x += f.vx; f.y += f.vy; if (Math.abs(f.x - W / 2) > 30) continue; // faíscas só no centro, longe dos corpos
      cx.fillStyle = f.v > 0.6 ? '#ffffff' : f.v > 0.3 ? '#ffe28a' : '#f59e0b'; cx.fillRect(Math.round(f.x), Math.round(f.y), 2, 2); }
    if (golpe && golpe.f && t - golpe.s < 1250) bola(W / 2, my, 10 - (t - golpe.s - 1000) / 40, 1);
  }
  let golpeY = 120;
  function bola(x0, y0, r, a) { // energia neutra (branco/amarelo), pixelada
    const c = ['#fff7d6', '#ffe28a', '#ffffff'];
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const d = Math.hypot(x, y) / r; if (d > 1) continue; cx.globalAlpha = Math.min(1, a * (d > 0.75 ? 0.5 : 1)); cx.fillStyle = d < 0.4 ? c[2] : d < 0.75 ? c[0] : c[1]; cx.fillRect(Math.round(x0 + x), Math.round(y0 + y), 1, 1); }
    cx.globalAlpha = 1;
  }
  function rastro(x0, y0, dir) { cx.fillStyle = 'rgba(255,226,138,.55)'; for (let i = 1; i < 6; i++) cx.fillRect(Math.round(x0 + dir * i * 4), Math.round(y0 - 1 + (i % 2)), 3, 2); }
  function quadro(t) { desenha(t); raf = requestAnimationFrame(quadro); }
  window.CMVCena = {
    iniciar(canvas) { cv = canvas; cv.width = W; cv.height = H; cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false; fundo = fundo || montaFundo(); if (!publico.length) montaPublico();
      cancelAnimationFrame(raf); if (reduz()) desenha(0); else raf = requestAnimationFrame(quadro); },
    parar() { cancelAnimationFrame(raf); raf = 0; },
    especial() { if (!cx || reduz() || golpe) return false; golpe = { s: performance.now() }; faiscas = []; return true; },
    ativo: () => !!golpe,
  };
})();
