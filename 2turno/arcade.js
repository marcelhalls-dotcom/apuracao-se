/* Modo Arcade do /2turno/: arte e sons originais (pixel art em SVG, sons por WebAudio). Mesmos dados e mesma lógica da página normal (evento cmv:dados). */
(function () {
  'use strict';
  const fmt = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  // Lutador genérico idêntico para os dois lados (o direito é espelhado). Pixel art 8x12.
  const PIX = ['..XXXX..','..XHHX..','..XHHX..','...XX...','.CCCCCC.','CCCCCCCC','H.CCCC.H','..CCCC..','..PP.PP.','..PP.PP.','..PP.PP.','.BBB.BBB'];
  function lutador(cor) {
    let r = '';
    PIX.forEach((l, y) => [...l].forEach((ch, x) => { const c = { X: '#111', H: '#e5c39a', C: cor, P: '#222', B: '#000' }[ch]; if (c) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`; }));
    return `<svg viewBox="0 0 8 12" shape-rendering="crispEdges">${r}</svg>`;
  }
  let ctx = null, mudo = false, ultimo = null, aberto = false;
  function som(freqs, dur = 0.09, tipo = 'square') {
    if (!ctx || mudo) return;
    freqs.forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = tipo; o.frequency.value = f; g.gain.value = 0.06;
      const t = ctx.currentTime + i * dur; o.connect(g).connect(ctx.destination); o.start(t); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.stop(t + dur); });
  }
  function montar() {
    const el = document.createElement('div'); el.id = 'arcade'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Modo arcade da apuração');
    el.innerHTML = `
      <div class="ar-sim" id="ar-sim" hidden>SIMULAÇÃO · dados fictícios</div>
      <div class="ar-intro" id="ar-intro"><h2>ROUND 2</h2><h2 class="l2">TURNO</h2><h2 class="l3">VOTE!</h2><button type="button" id="ar-start">▶ APERTE PARA COMEÇAR</button></div>
      <div class="ar-top"><button type="button" id="ar-voltar">← VERSÃO NORMAL</button><button type="button" id="ar-mudo" aria-pressed="false">🔊 SOM</button></div>
      <div class="ar-hud">
        <div class="e"><div class="ar-nome">LULA · 13</div><div class="vida"><i id="ar-v-l"></i></div><div class="ar-pct" id="ar-p-l">—</div><div id="ar-s-l"></div></div>
        <div class="ar-vs">VS</div>
        <div class="d"><div class="ar-nome">FLÁVIO · 22</div><div class="vida"><i id="ar-v-f"></i></div><div class="ar-pct" id="ar-p-f">—</div><div id="ar-s-f"></div></div>
      </div>
      <div class="ar-arena"><div class="ar-placa" id="ar-man">—</div><div class="luta">${lutador('#7c3aed')}</div><div class="luta dir">${lutador('#7c3aed')}</div></div>
      <div class="ar-apur"><i id="ar-apur"></i></div>
      <div class="ar-info"><span id="ar-pst">—</span> · <span id="ar-hora"></span><br>Barras = % dos votos válidos apurados (TSE). Atualiza a cada 5 s.</div>`;
    document.body.appendChild(el);
    const q = id => document.getElementById(id);
    q('ar-start').onclick = () => { try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); } catch (_) {} som([523, 659, 784, 1047], 0.12); q('ar-intro').hidden = true; };
    q('ar-mudo').onclick = e => { mudo = !mudo; e.currentTarget.textContent = mudo ? '🔇 MUDO' : '🔊 SOM'; e.currentTarget.setAttribute('aria-pressed', String(mudo)); };
    q('ar-voltar').onclick = () => fechar();
    return el;
  }
  function abrir() { const el = document.getElementById('arcade') || montar(); el.hidden = false; aberto = true; document.getElementById('ar-intro').hidden = false; if (ultimo) pintar(ultimo); history.replaceState(null, '', paramArcade(true)); }
  function fechar() { document.getElementById('arcade').hidden = true; aberto = false; history.replaceState(null, '', paramArcade(false)); }
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
    q('ar-apur').style.width = Math.min(100, d.pst) + '%';
    q('ar-pst').textContent = 'Urnas apuradas: ' + fmt(d.pst); q('ar-hora').textContent = d.hora;
  }
  window.addEventListener('cmv:dados', e => {
    const d = e.detail, jaEleito = ultimo && (ultimo.eleitoL || ultimo.eleitoF), mudou = ultimo && (ultimo.pl !== d.pl || ultimo.pst !== d.pst);
    ultimo = d;
    if (aberto) { pintar(d); if (mudou) som([330, 440], 0.06); if ((d.eleitoL || d.eleitoF) && !jaEleito) som([523, 659, 784, 1047, 1319], 0.15, 'triangle'); }
  });
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('btn-arcade'); if (b) b.onclick = abrir;
    if (new URLSearchParams(location.search).get('arcade') === '1') abrir();
  });
})();
