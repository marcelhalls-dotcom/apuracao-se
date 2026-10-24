/* Modo Arcade do /2turno/: arte e sons originais (pixel art em SVG, sons por WebAudio). Mesmos dados e mesma lógica da página normal (evento cmv:dados). */
(function () {
  'use strict';
  const fmt = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  // Lutador original (16x17), guarda alta: cabelo escuro, bandana e luvas cinza-escuro, kimono grafite, braços musculosos, rosto genérico.
  // Idêntico nos dois lados (o direito é espelhado); a ÚNICA diferença é a faixa (F). Nenhum rosto real.
  const PIX = [".....AAAAA......", "....AAAAAAA.....", ".BB.BBBBBBBB....", "..B.ASSSSES.....", "....SSSSSS......", ".....SSS.....GG.", "..SKKKVKKKSSSGGG", ".SSKKKVKKK...GG.", ".SS.KKKKKK......", ".GG.KKKKKK......", ".GG.FFFFFF......", "....KKKKKKK.....", "...KKK..KKK.....", "..KKK....KKK....", "..KK......KK....", ".KK........KK...", ".SSS.......SSS.."];
  function lutador(faixa) {
    let r = '';
    PIX.forEach((l, y) => [...l].forEach((ch, x) => { const c = { A: '#0f0f0f', B: '#2d3340', S: '#c98f62', E: '#000', K: '#4b5563', V: '#2b313b', G: '#1f2430', F: faixa }[ch]; if (c) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`; }));
    return `<svg viewBox="0 0 16 17" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
  }
  const PT = '#c4161c', PL = '#1f5fc8';
  let ctx = null, mudo = false, ultimo = null, aberto = false;
  function som(freqs, dur = 0.09, tipo = 'square') {
    if (!ctx || mudo) return;
    freqs.forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = tipo; o.frequency.value = f; g.gain.value = 0.06;
      const t = ctx.currentTime + i * dur; o.connect(g).connect(ctx.destination); o.start(t); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.stop(t + dur); });
  }
  // iOS/Safari: destrava o áudio SINCRONAMENTE dentro do gesto (sem await/setTimeout antes).
  let silAudio = null;
  function destravar() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) {}
    try { if (!silAudio) { silAudio = new Audio('/2turno/silencio.wav?v=20261024arc7'); silAudio.loop = true; silAudio.setAttribute('playsinline', ''); silAudio.volume = 0.01; } const pr = silAudio.play(); if (pr && pr.catch) pr.catch(() => {}); } catch (_) {}
    try { const AC = window.AudioContext || window.webkitAudioContext; if (!ctx && AC) ctx = new AC(); if (ctx) { if (ctx.state !== 'running') { const pr = ctx.resume(); if (pr && pr.catch) pr.catch(() => {}); }
      const buf = ctx.createBuffer(1, 1, 22050), src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start(0); } } catch (_) {}
  }
  function pararSilencio() { try { if (silAudio) silAudio.pause(); } catch (_) {} }
  // Trilha de fase — chiptune ORIGINAL (Lá menor, 150 BPM, 8 compassos, i–VI–III–VII), scheduler com lookahead.
  const MUS = (() => {
    const BPM = 150, PASSO = 60 / BPM / 4, LOOK = 0.12, N = 128;
    const ACORDES = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G (MIDI)
    // lead: 1 nota por colcheia (2 passos); 0 = pausa. 8 compassos = 64 colcheias
    const LEAD = [69,0,72,74,76,0,74,72, 71,72,74,0,72,71,69,0, 65,0,69,72,77,76,74,72, 74,0,72,0,69,0,0,0,
                  72,0,76,79,81,0,79,76, 74,76,79,0,76,74,72,0, 74,0,71,74,79,0,78,79, 81,0,79,76,74,0,71,0];
    const hz = m => 440 * Math.pow(2, (m - 69) / 12);
    let bus = null, ruido = null, tm = null, passo = 0, prox = 0, tocando = false, querida = false;
    function nota(f, t, d, tipo, vol) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = tipo; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g).connect(bus); o.start(t); o.stop(t + d + 0.01); }
    function bateria(t, tipo) {
      if (tipo === 'k') { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
        g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12); o.connect(g).connect(bus); o.start(t); o.stop(t + 0.13); return; }
      const sr = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), d = tipo === 's' ? 0.12 : 0.03;
      sr.buffer = ruido; f.type = 'highpass'; f.frequency.value = tipo === 's' ? 1200 : 7000; g.gain.setValueAtTime(tipo === 's' ? 0.28 : 0.1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      sr.connect(f).connect(g).connect(bus); sr.start(t, Math.random() * 0.5, d + 0.01); }
    function agenda(i, t) {
      const ac = ACORDES[Math.floor(i / 32)], b = i % 16;
      if (i % 2 === 0) nota(hz(ac[0] - 24 + (i % 4 === 2 ? 12 : 0)), t, PASSO * 1.6, 'triangle', 0.32); // baixo pulsante
      nota(hz(ac[i % 3] + 12), t, PASSO * 0.8, 'square', 0.035);                                       // arpejo
      if (i % 2 === 0 && LEAD[i / 2]) nota(hz(LEAD[i / 2]), t, PASSO * 1.8, 'square', 0.07);             // lead
      if (b === 0 || b === 8 || b === 10) bateria(t, 'k'); if (b === 4 || b === 12) bateria(t, 's'); if (i % 2 === 1) bateria(t, 'h');
    }
    function tick() { if (!ctx || ctx.state !== 'running') return; while (prox < ctx.currentTime + LOOK) { agenda(passo, prox); prox += PASSO; passo = (passo + 1) % N; } }
    function iniciar(atraso = 0) {
      querida = true; if (mudo || tocando || !ctx || document.hidden) return;
      if (!bus) { bus = ctx.createGain(); bus.gain.value = 0.22; bus.connect(ctx.destination);
        const n = ctx.sampleRate, bf = ctx.createBuffer(1, n, n), d = bf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; ruido = bf; }
      bus.gain.cancelScheduledValues(ctx.currentTime); bus.gain.setValueAtTime(0.22, ctx.currentTime);
      tocando = true; passo = 0; prox = ctx.currentTime + 0.05 + atraso; tick(); tm = setInterval(tick, 25);
    }
    function parar(esquecer) { if (esquecer) querida = false; if (!tocando) return; tocando = false; clearInterval(tm); tm = null;
      try { bus.gain.cancelScheduledValues(ctx.currentTime); bus.gain.setTargetAtTime(0, ctx.currentTime, 0.03); } catch (_) {} }
    function retomar() { if (querida && !tocando) iniciar(); }
    function abaixar() { if (!tocando) return; const t = ctx.currentTime; bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(0.09, t + 0.08); bus.gain.setValueAtTime(0.09, t + 1.5); bus.gain.linearRampToValueAtTime(0.22, t + 2.1); }
    document.addEventListener('visibilitychange', () => { if (document.hidden) parar(false); });
    return { iniciar, parar, retomar, abaixar, get tocando() { return tocando; } };
  })();
  // "ROUND 2... VOTE!": melodia 8-bit sintetizada + voz opcional do próprio navegador (speechSynthesis), só após o clique.
  function narrar() {
    som([392, 392, 523, 0, 659, 784, 1047], 0.13);
    if (!mudo && 'speechSynthesis' in window) { try { const u = new SpeechSynthesisUtterance('Round 2... Vote!'); u.lang = 'en-US'; u.rate = 0.9; u.pitch = 0.6; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (_) {} }
  }
  // Golpe especial simétrico: dois projéteis neutros idênticos saem juntos e se anulam no centro. Ninguém é atingido.
  function especial(gesto) {
    const el = document.getElementById('arcade'); if (!el || el.hidden || !window.CMVCena) return;
    if (!CMVCena.especial()) return;
    somEspecial(gesto);
  }
  // Som original do golpe (tudo agendado no relógio do AudioContext no próprio clique — sem setTimeout — p/ iOS).
  function somEspecial(gesto) {
    if (mudo) return;
    MUS.abaixar();
    if (gesto && 'speechSynthesis' in window) { try { const u = new SpeechSynthesisUtterance('Vota-kên!'); u.lang = 'pt-BR'; u.rate = 1.25; u.pitch = 0.4; u.volume = 1; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (_) {} }
    if (!ctx) return;
    try {
      const t0 = ctx.currentTime + 0.02, out = ctx.destination;
      // 1) carga: varredura ascendente 0–600 ms
      const o1 = ctx.createOscillator(), g1 = ctx.createGain(); o1.type = 'square'; o1.frequency.setValueAtTime(90, t0); o1.frequency.exponentialRampToValueAtTime(880, t0 + 0.58);
      g1.gain.setValueAtTime(0.0001, t0); g1.gain.exponentialRampToValueAtTime(0.05, t0 + 0.1); g1.gain.setValueAtTime(0.05, t0 + 0.55); g1.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      o1.connect(g1).connect(out); o1.start(t0); o1.stop(t0 + 0.61);
      // 2) disparo (600 ms): "VO-TA-KEN!" em chiptune (3 sílabas) por cima/fallback da voz
      [[523, 0.08], [659, 0.08], [988, 0.22]].reduce((t, [f, d]) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + d);
        g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g).connect(out); o.start(t); o.stop(t + d + 0.01); return t + d + 0.02; }, t0 + 0.6);
      // 3) choque central (1000 ms): explosão 8-bit (ruído filtrado + grave)
      const n = Math.floor(ctx.sampleRate * 0.6), buf = ctx.createBuffer(1, n, ctx.sampleRate), dd = buf.getChannelData(0);
      for (let i = 0, v = 0; i < n; i++) { if (i % 6 === 0) v = Math.random() * 2 - 1; dd[i] = v * (1 - i / n); }
      const ns = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g3 = ctx.createGain(); ns.buffer = buf; lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, t0 + 1); lp.frequency.exponentialRampToValueAtTime(200, t0 + 1.6);
      g3.gain.setValueAtTime(0.12, t0 + 1); g3.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6); ns.connect(lp).connect(g3).connect(out); ns.start(t0 + 1);
      const o4 = ctx.createOscillator(), g4 = ctx.createGain(); o4.type = 'triangle'; o4.frequency.setValueAtTime(140, t0 + 1); o4.frequency.exponentialRampToValueAtTime(40, t0 + 1.5);
      g4.gain.setValueAtTime(0.15, t0 + 1); g4.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5); o4.connect(g4).connect(out); o4.start(t0 + 1); o4.stop(t0 + 1.52);
    } catch (_) {}
  }
  // Timer central: NUNCA conta para um "fim de luta". Aguardando: 17:00 e contagem até o início; depois: % de urnas apuradas.
  const INICIO = Date.parse('2026-10-25T17:00:00-03:00');
  function relogio() {
    const q = id => document.getElementById(id); if (!q('ar-tm') || (ultimo && ultimo.comecou)) return;
    const f = Math.max(0, INICIO - Date.now()), h = Math.floor(f / 36e5), m = Math.floor(f % 36e5 / 6e4), s = Math.floor(f % 6e4 / 1e3), z = v => String(v).padStart(2, '0');
    q('ar-tm').textContent = '17:00'; q('ar-tm2').textContent = f ? `INÍCIO EM ${z(h)}:${z(m)}:${z(s)}` : 'INÍCIO';
  }
  setInterval(relogio, 1000);
  function montar() {
    const el = document.createElement('div'); el.id = 'arcade'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Modo arcade da apuração');
    el.innerHTML = `
      <div class="ar-sim" id="ar-sim" hidden>SIMULAÇÃO · dados fictícios</div>
      <div class="ar-intro" id="ar-intro"><h2>ROUND 2</h2><h2 class="l2">TURNO</h2><h2 class="l3">VOTE!</h2><button type="button" id="ar-start">▶ APERTE PARA COMEÇAR</button></div>
      <div class="ar-sel" id="ar-sel" hidden><h3>SELECT YOUR FIGHTER</h3><div class="sel-grid">
        <figure class="sel-c pt"><span class="sel-tag">PLAYER 1</span><img src="/2turno/lula.jpeg" alt="Foto oficial de Lula (TSE)" width="161" height="225"><b>LULA · 13</b><small>faixa PT · Foto: TSE</small></figure>
        <div class="sel-vs">VS</div>
        <figure class="sel-c pl"><span class="sel-tag">PLAYER 2</span><img src="/2turno/flavio.jpeg" alt="Foto oficial de Flávio Bolsonaro (TSE)" width="161" height="225"><b>FLÁVIO · 22</b><small>faixa PL · Foto: TSE</small></figure></div>
        <p>Mesma altura, mesma força. Quem decide é a urna.</p><button type="button" id="ar-luta">▶ LUTAR!</button></div>
      <div class="ar-top"><button type="button" id="ar-voltar">← VERSÃO NORMAL</button><button type="button" id="ar-mudo" aria-pressed="false">🔊 SOM</button></div>
      <div class="ar-hud">
        <div class="e"><div class="ar-nome">LULA · 13</div><div class="vida"><i id="ar-v-l"></i></div><div class="ar-pct" id="ar-p-l">—</div><div id="ar-s-l"></div></div>
        <div class="ar-timer" id="ar-timer" aria-label="Urnas apuradas"><b id="ar-tm">17:00</b><small id="ar-tm2">INÍCIO</small></div>
        <div class="d"><div class="ar-nome">FLÁVIO · 22</div><div class="vida"><i id="ar-v-f"></i></div><div class="ar-pct" id="ar-p-f">—</div><div id="ar-s-f"></div></div>
      </div>
      <div class="ar-arena"><div class="ar-placa" id="ar-man">—</div><canvas id="ar-cv" width="320" height="180" aria-label="Cena arcade: dois lutadores idênticos numa praça com uma urna eletrônica ao centro"></canvas></div>
      <div class="ar-golpe"><button type="button" id="ar-especial">⚡ GOLPE ESPECIAL</button></div>
      <div class="ar-apur"><i id="ar-apur"></i></div>
      <div class="ar-info"><span id="ar-pst">—</span> · <span id="ar-hora"></span><br>Barras = % dos votos válidos apurados (TSE). Atualiza a cada 5 s.</div>`;
    document.body.appendChild(el);
    ['touchend', 'click'].forEach(t => el.addEventListener(t, () => { if (!mudo) { destravar(); MUS.retomar(); } }, { capture: true, passive: true }));
    const q = id => document.getElementById(id);
    q('ar-start').onclick = () => { destravar(); narrar(); MUS.iniciar(1.3); q('ar-intro').hidden = true; q('ar-sel').hidden = false; };
    q('ar-luta').onclick = () => { destravar(); MUS.iniciar(); q('ar-sel').hidden = true; som([392, 523, 659], 0.1); setTimeout(especial, 400); };
    q('ar-especial').onclick = () => { destravar(); especial(true); };
    q('ar-mudo').onclick = e => { mudo = !mudo; if (mudo && 'speechSynthesis' in window) speechSynthesis.cancel(); if (mudo) { pararSilencio(); MUS.parar(false); } else { destravar(); som([523, 784], 0.07); MUS.retomar(); } e.currentTarget.textContent = mudo ? '🔇 MUDO' : '🔊 SOM'; e.currentTarget.setAttribute('aria-pressed', String(mudo)); };
    q('ar-voltar').onclick = () => fechar();
    return el;
  }
  function abrir() { const el = document.getElementById('arcade') || montar(); el.hidden = false; aberto = true; document.getElementById('ar-intro').hidden = false; document.getElementById('ar-sel').hidden = true; if (window.CMVCena) CMVCena.iniciar(document.getElementById('ar-cv')); relogio(); if (ultimo) pintar(ultimo); history.replaceState(null, '', paramArcade(true)); }
  function fechar() { pararSilencio(); MUS.parar(true); if (window.CMVCena) CMVCena.parar(); if ('speechSynthesis' in window) speechSynthesis.cancel(); document.getElementById('arcade').hidden = true; aberto = false; history.replaceState(null, '', paramArcade(false)); }
  function paramArcade(on) { const u = new URL(location.href); on ? u.searchParams.set('arcade', '1') : u.searchParams.delete('arcade'); return u.pathname + u.search; }
  function pintar(d) {
    const q = id => document.getElementById(id); if (!q('arcade')) return;
    q('ar-sim').hidden = !d.sim;
    // Sem dados: as duas barras vazias e iguais. Com dados: o mesmo % válido da página normal.
    q('ar-v-l').style.width = (d.comecou ? d.pl : 0) + '%'; q('ar-v-f').style.width = (d.comecou ? d.pf : 0) + '%';
    q('ar-p-l').textContent = d.comecou ? fmt(d.pl) : '—'; q('ar-p-f').textContent = d.comecou ? fmt(d.pf) : '—';
    const selo = (id, eleito, lid) => { q(id).textContent = !d.comecou ? '' : eleito ? '★ ELEITO (TSE)' : lid ? 'LIDERA' : ''; };
    selo('ar-s-l', d.eleitoL, d.lider === 'l'); selo('ar-s-f', d.eleitoF, d.lider === 'f');
    q('ar-man').textContent = d.comecou ? d.man.toUpperCase() : 'AGUARDANDO INÍCIO (17H)';
    if (d.comecou) { q('ar-tm').textContent = fmt(d.pst).replace(',00', ''); q('ar-tm2').textContent = 'URNAS APURADAS'; } else relogio();
    q('ar-apur').style.width = Math.min(100, d.pst) + '%';
    q('ar-pst').textContent = 'Urnas apuradas: ' + fmt(d.pst); q('ar-hora').textContent = d.hora;
  }
  window.addEventListener('cmv:dados', e => {
    const d = e.detail, jaEleito = ultimo && (ultimo.eleitoL || ultimo.eleitoF), mudou = ultimo && (ultimo.pl !== d.pl || ultimo.pst !== d.pst);
    ultimo = d;
    if (aberto) { pintar(d); if (mudou) especial(); if ((d.eleitoL || d.eleitoF) && !jaEleito) som([523, 659, 784, 1047, 1319], 0.15, 'triangle'); }
  });
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('btn-arcade'); if (b) b.onclick = abrir;
    if (new URLSearchParams(location.search).get('arcade') === '1') abrir();
  });
})();
