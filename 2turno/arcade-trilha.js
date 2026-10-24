/* Cadê Meu Voto — trilha do Modo Arcade. Composição ORIGINAL no estilo FM de fliperama do início dos anos 90.
   Ré menor/dórico, 168 BPM, 16 compassos (A + B), sintetizada em WebAudio (FM simulado). */
(function () {
  'use strict';
  const BPM = 168, PASSO = 60 / BPM / 4, N = 256;
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  // [baixo, tríade] por compasso; compasso 15 tem dois acordes (meia barra cada)
  const Dm = [38, [62, 65, 69]], Bb = [34, [62, 65, 70]], C = [36, [64, 67, 72]], G = [31, [62, 67, 71]], A = [33, [61, 64, 69]], Am = [33, [60, 64, 69]], Gm = [31, [62, 67, 70]];
  const HARM = [Dm, Dm, Bb, C, Dm, Dm, G, A, Bb, C, Am, Dm, Bb, C, [Gm, A], A];
  // melodia em colcheias: número = nota MIDI, -1 = segura, 0 = pausa
  const MEL = [
    69,-1,-1,74,-1,72,74,-1,  77,-1,76,74,72,-1,74,-1,  70,-1,-1,72,74,-1,77,-1,  76,-1,-1,-1,72,0,74,76,
    77,-1,-1,79,81,-1,79,77,  76,-1,74,-1,72,74,-1,-1,  71,-1,74,-1,79,-1,77,76,  73,-1,-1,-1,76,-1,0,0,
    77,-1,74,-1,70,-1,74,77,  79,-1,-1,76,72,-1,79,-1,  76,-1,72,-1,69,72,76,-1,  74,-1,-1,-1,-1,-1,0,0,
    82,-1,81,79,77,-1,74,-1,  79,-1,-1,77,76,-1,72,76,  74,-1,70,-1,73,-1,76,-1,  81,-1,-1,-1,0,0,0,0];
  const BAIXO = [[0, 0], [3, 1], [6, 0], [8, 1], [10, 0], [11, 1], [14, 0]]; // passo, oitava (sincopado)
  window.CMVTrilha = function (ac, destino) {
    const saida = ac.createGain(); saida.connect(destino);
    // reverb leve (impulso gerado) + delay curto
    const rev = ac.createConvolver(), rl = Math.floor(ac.sampleRate * 1.1), ir = ac.createBuffer(2, rl, ac.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < rl; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3); }
    rev.buffer = ir; const rw = ac.createGain(); rw.gain.value = 0.18; rev.connect(rw).connect(saida);
    const dl = ac.createDelay(1), fb = ac.createGain(), dw = ac.createGain(); dl.delayTime.value = PASSO * 3; fb.gain.value = 0.28; dw.gain.value = 0.22;
    dl.connect(fb).connect(dl); dl.connect(dw).connect(saida);
    const seco = ac.createGain(); seco.connect(saida); seco.connect(rev);
    const leadBus = ac.createGain(); leadBus.connect(seco); leadBus.connect(dl);
    const vib = ac.createOscillator(), vg = ac.createGain(); vib.frequency.value = 5.5; vg.gain.value = 14; vib.connect(vg); vib.start(); // vibrato (cents)
    const nl = ac.sampleRate, ruido = ac.createBuffer(1, nl, nl), rd = ruido.getChannelData(0); for (let i = 0; i < nl; i++) rd[i] = Math.random() * 2 - 1;
    // voz FM: portadora + modulador com envelope de índice
    function fm(f, t, d, vol, razao, indice, tipoP, alvo, ataque) {
      const p = ac.createOscillator(), m = ac.createOscillator(), mg = ac.createGain(), g = ac.createGain();
      p.type = tipoP || 'sine'; p.frequency.value = f; m.frequency.value = f * razao;
      mg.gain.setValueAtTime(f * indice, t); mg.gain.exponentialRampToValueAtTime(f * indice * 0.15 + 1, t + d);
      m.connect(mg).connect(p.frequency); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (ataque || 0.005));
      g.gain.exponentialRampToValueAtTime(0.0001, t + d); p.connect(g).connect(alvo || seco); p.start(t); m.start(t); p.stop(t + d + 0.02); m.stop(t + d + 0.02);
    }
    function lead(f, t, d) {
      [-7, 7].forEach(det => { const o = ac.createOscillator(), g = ac.createGain(); o.type = det < 0 ? 'square' : 'sawtooth'; o.frequency.value = f; o.detune.value = det; vg.connect(o.detune);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.012); g.gain.setValueAtTime(0.05, t + d * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g).connect(leadBus); o.start(t); o.stop(t + d + 0.02); o.onended = () => { try { vg.disconnect(o.detune); } catch (_) {} }; });
    }
    function ruidoHit(t, d, vol, fq, tipo) { const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = ruido; f.type = tipo; f.frequency.value = fq;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); s.connect(f).connect(g).connect(seco); s.start(t, Math.random() * 0.8, d + 0.02); }
    function tom(t, f0, f1, d, vol) { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g).connect(seco); o.start(t); o.stop(t + d + 0.02); }
    const kick = t => tom(t, 160, 42, 0.16, 0.7), snare = t => { ruidoHit(t, 0.13, 0.32, 1500, 'highpass'); tom(t, 240, 170, 0.08, 0.25); }, hat = (t, v) => ruidoHit(t, 0.025, v, 8000, 'highpass');
    function agenda(i, t) {
      const bar = Math.floor(i / 16), s = i % 16; let h = HARM[bar]; if (Array.isArray(h[0])) h = h[s < 8 ? 0 : 1];
      const virada = bar % 8 === 7 && s >= 8;
      // baixo slap FM em oitavas
      BAIXO.forEach(([p, o]) => { if (p === s) fm(hz(h[0] + 12 * o), t, PASSO * 1.5, 0.3, 1, o ? 3 : 2, 'triangle'); });
      // stabs de metal (brass FM) nos contratempos
      if (s === 2 || s === 6 || (s === 11 && bar % 2) || s === 14) h[1].forEach(n => fm(hz(n), t, PASSO * 1.3, 0.045, 1, 2.6, 'sine', null, 0.012));
      // melodia
      if (s % 2 === 0) { const k = i / 2, n = MEL[k]; if (n > 0) { let len = 1; while (MEL[(k + len) % 128] === -1) len++; lead(hz(n), t, PASSO * 2 * len * 0.95); } }
      // bateria
      if (virada) { if (s % 2 === 0 || s >= 12) snare(t); if (s >= 12) tom(t, 220 - (s - 12) * 35, 80, 0.12, 0.35); }
      else { if (s === 0 || s === 10 || (s === 7 && bar % 4 === 3)) kick(t); if (s === 4 || s === 12) snare(t); if (s % 2 === 0) hat(t, s % 4 === 2 ? 0.11 : 0.06); }
      if (bar % 8 === 0 && s === 0) ruidoHit(t, 0.9, 0.12, 5000, 'highpass'); // prato no início das partes
    }
    return { agenda, PASSO, N, saida };
  };
})();
