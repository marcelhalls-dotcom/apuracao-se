/* Cadê Meu Voto: apuração ao vivo do 2º turno para Presidente (TSE, eleição 6258).
 * Somente leitura de dados públicos do TSE. Sem cookies, sem login, sem dado de usuário. */
(function () {
  'use strict';
  const INTERVALO = 5000;
  const SQ_LULA = '280002542548', SQ_FLAVIO = '280002551544';
  const TSE = 'https://resultados.tse.jus.br/oficial/ele2026';
  // O TSE libera CORS para cademeuvoto.com.br e responde por CDN (max-age ~55 s). Um proxy no Worker foi testado,
  // mas o TSE devolve 403 para a saída da Cloudflare; por isso a leitura é direta.
  const FONTES_2T = [TSE + '/6258/dados/br/br-c0001-e006258-u.json'];
  const FONTES_1T = ['https://dados.cademeuvoto.com.br/tse/ele2026/6257/dados/br/br-c0001-e006257-u.json', TSE + '/6257/dados/br/br-c0001-e006257-u.json'];
  const SIM = (() => { const v = new URLSearchParams(location.search).get('sim'); return v === null ? null : Math.max(0, Math.min(100, Number(v) || 0)); })();

  const $ = id => document.getElementById(id);
  const n = s => { const v = parseFloat(String(s ?? '').replace(/\./g, '').replace(',', '.')); return isNaN(v) ? 0 : v; };
  const int = new Intl.NumberFormat('pt-BR');
  const pct = (v, d = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
  const mi = v => (v / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + ' mi';
  const txt = (id, s) => { const el = $(id); if (el) el.textContent = s; };

  let t1 = null;      // resumo do 1º turno: { te, a, pa, cands[] }
  let falhas = 0;

  async function getJSON(urls) {
    let erro;
    for (const u of urls) {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(u, { credentials: 'omit', cache: 'no-cache', signal: ctl.signal });
        clearTimeout(t);
        if (r.ok) return await r.json();
        erro = new Error('HTTP ' + r.status);
      } catch (e) { erro = e; }
    }
    throw erro || new Error('sem dados');
  }

  function candidatos(d) {
    const out = [];
    const carg = (d.carg || [])[0] || {};
    for (const a of carg.agr || []) for (const p of a.par || []) for (const c of p.cand || []) {
      out.push({ sq: String(c.sqcand), nmu: c.nmu, n: c.n, sg: p.sg, vap: n(c.vap), pvap: n(c.pvap), st: String(c.st || ''), e: c.e });
    }
    return out.sort((x, y) => y.vap - x.vap);
  }

  // Simulação (só com ?sim=NN): usa a proporção do 1º turno para fingir NN% das urnas. Nunca é usada sem o parâmetro.
  function simular(p) {
    const te = t1 ? t1.te : 158745502, f = p / 100, est = Math.round(te * f), a = Math.round(est * 0.215), c = est - a;
    const vv = Math.round(c * 0.94), L = Math.round(vv * (0.488 + 0.01 * Math.sin(p))), F = vv - L;
    const s = x => String(x).replace('.', ',');
    return { ele: '6258', t: '2', tf: 'n', dg: '25/10/2026', hg: new Date().toTimeString().slice(0, 8),
      s: { ts: '499248', st: String(Math.round(499248 * f)), pst: s((p).toFixed(2)) },
      e: { te: String(te), est: String(est), c: String(c), a: String(a) },
      v: { vv: String(vv), vb: String(Math.round(c * 0.02)), tvn: String(Math.round(c * 0.04)) },
      carg: [{ agr: [{ par: [{ sg: 'PT', cand: [{ sqcand: SQ_LULA, nmu: 'LULA', n: '13', vap: String(L), pvap: s((vv ? 100 * L / vv : 0).toFixed(2)), st: '' }] },
        { sg: 'PL', cand: [{ sqcand: SQ_FLAVIO, nmu: 'FLAVIO BOLSONARO', n: '22', vap: String(F), pvap: s((vv ? 100 * F / vv : 0).toFixed(2)), st: '' }] }] }] }] };
  }

  function render(d) {
    const s = d.s || {}, e = d.e || {}, v = d.v || {};
    const ts = n(s.ts), st = n(s.st), pst = ts ? 100 * st / ts : 0;
    const te = n(e.te), est = n(e.est), c = n(e.c), a = n(e.a), vv = n(v.vv);
    const cs = candidatos(d);
    const L = cs.find(x => x.sq === SQ_LULA) || { vap: 0, pvap: 0, st: '' };
    const F = cs.find(x => x.sq === SQ_FLAVIO) || { vap: 0, pvap: 0, st: '' };
    const concluido = d.tf === 's';
    const comecou = st > 0;

    txt('pst', pct(pst));
    $('pst-bar').style.width = Math.min(100, pst) + '%';
    txt('hora', d.hg ? `TSE ${d.dg || ''} ${d.hg}` : '—');
    $('aguardando').hidden = comecou;

    const pl = vv ? 100 * L.vap / vv : 50, pf = vv ? 100 * F.vap / vv : 50;
    $('bar-l').style.width = (comecou ? pl : 50) + '%';
    $('bar-f').style.width = (comecou ? pf : 50) + '%';
    txt('bp-l', comecou ? 'Lula ' + pct(pl) : 'Lula');
    txt('bp-f', comecou ? pct(pf) + ' Flávio' : 'Flávio');
    txt('pct-l', comecou ? pct(pl) : '—'); txt('pct-f', comecou ? pct(pf) : '—');
    txt('vot-l', comecou ? int.format(L.vap) + ' votos' : '0 votos'); txt('vot-f', comecou ? int.format(F.vap) + ' votos' : '0 votos');

    // Títulos: "eleito" só com totalização concluída pelo TSE (tf = s) e situação do candidato "Eleito".
    const eleitoL = concluido && /^eleito/i.test(L.st), eleitoF = concluido && /^eleito/i.test(F.st);
    const lider = L.vap > F.vap ? 'l' : F.vap > L.vap ? 'f' : '';
    const selo = (id, eleito, lid) => { $(id).innerHTML = ''; if (!comecou) return; const sp = document.createElement('span'); if (eleito) { sp.className = 'eleito'; sp.textContent = 'Eleito (TSE)'; } else if (lid) sp.textContent = 'Lidera'; else return; $(id).appendChild(sp); };
    selo('sel-l', eleitoL, lider === 'l'); selo('sel-f', eleitoF, lider === 'f');
    let man = 'Aguardando início da apuração (17h)';
    if (eleitoL) man = 'Lula eleito, segundo o TSE'; else if (eleitoF) man = 'Flávio Bolsonaro eleito, segundo o TSE';
    else if (comecou) man = lider === 'l' ? 'Lula lidera' : lider === 'f' ? 'Flávio Bolsonaro lidera' : 'Empate';
    txt('manchete', man);
    txt('dif', comecou ? `Diferença: ${int.format(Math.abs(L.vap - F.vap))} votos · válidos apurados: ${int.format(vv)}` : 'Os percentuais aparecem quando o TSE divulgar os primeiros boletins.');

    // Abstenção ao vivo: abstenções ÷ eleitores das seções já apuradas (TSE).
    if (t1) { txt('a1', pct(t1.pa)); txt('a1n', mi(t1.a) + ' não votaram'); }
    if (comecou && est > 0) {
      const pa2 = 100 * a / est;
      txt('a2', pct(pa2)); txt('a2n', mi(a) + ' até agora');
      if (t1) {
        const dpp = pa2 - t1.pa;
        txt('da', (dpp > 0 ? '+' : dpp < 0 ? '−' : '') + Math.abs(dpp).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' p.p.');
        const pos = Math.max(0, Math.min(100, (2 - dpp) / 17 * 100));
        const m = $('termo-atual'); m.hidden = false; m.style.left = pos + '%';
        txt('termo-txt', dpp >= 0
          ? `Ao vivo, a abstenção está ${Math.abs(dpp).toFixed(1).replace('.', ',')} p.p. ACIMA da do 1º turno (marcador amarelo). Para Lula virar só com novos eleitores, o BTG estima que ela precisaria CAIR de 3 a 13 p.p. (faixa vermelha).`
          : `Ao vivo, a abstenção está ${Math.abs(dpp).toFixed(1).replace('.', ',')} p.p. ABAIXO da do 1º turno (marcador amarelo). Pelo BTG, Lula precisaria de uma queda de 3 a 13 p.p. (faixa vermelha) para empatar só com novos eleitores.`);
      }
    } else { txt('a2', '—'); txt('a2n', 'aguardando apuração'); txt('da', '—'); $('termo-atual').hidden = true; }

    // Quanto Lula precisa dos votos válidos restantes (estimativa: eleitores das seções não apuradas × taxa de válidos já observada).
    if (comecou && est > 0 && !concluido) {
      const R = Math.max(0, te - est) * (vv / est);
      const gap = F.vap - L.vap;
      let alvo = '', exp = '';
      if (R < 1) { alvo = '—'; exp = 'Praticamente todas as seções estão apuradas.'; }
      else {
        const need = (gap + R) / (2 * R) * 100;
        if (need > 100) { alvo = '> 100%'; exp = `A diferença (${int.format(gap)}) é maior que os ~${mi(R)} de votos válidos estimados que faltam.`; }
        else if (need <= 0) { alvo = '0%'; exp = 'Lula já está à frente por mais do que os votos estimados que faltam.'; }
        else { alvo = pct(need, 1); exp = `${gap >= 0 ? 'Para virar' : 'Para manter a frente'}, Lula precisa de ${pct(need, 1)} dos ~${mi(R)} de votos válidos que faltam (estimativa: eleitores das seções não apuradas × taxa de votos válidos já observada). Hoje ele tem ${pct(pl, 1)}.`; }
      }
      txt('precisa', alvo); txt('precisa-txt', exp);
    } else if (concluido) { txt('precisa', '—'); txt('precisa-txt', 'Totalização concluída pelo TSE.'); }
    else { txt('precisa', '—'); txt('precisa-txt', 'Disponível quando a apuração começar.'); }
  }

  function renderT1(d) {
    const e = d.e || {}, v = d.v || {};
    const te = n(e.te), a = n(e.a), c = n(e.c), vv = n(v.vv);
    t1 = { te, a, pa: te ? 100 * a / te : 0 };
    txt('c-abs', mi(a).replace(' mi', ' milhões')); txt('c-pa', pct(t1.pa, 1));
    txt('c-pp8', pct(8e6 / te * 100, 1).replace('%', ' p.p.'));
    $('t1-res').textContent = `Totalizado pelo TSE. Eleitorado: ${int.format(te)} · comparecimento: ${int.format(c)} (${pct(100 * c / te)}) · abstenção: ${int.format(a)} (${pct(t1.pa)}) · válidos: ${int.format(vv)}.`;
    const lista = $('t1-lista'); lista.innerHTML = '';
    const cor = { PT: 'var(--pt)', PL: 'var(--pl-claro)' };
    for (const c of candidatos(d)) {
      const div = document.createElement('div'); div.className = 't1-item';
      const nm = document.createElement('div'); nm.textContent = `${c.nmu} (${c.sg})`;
      const sit = document.createElement('small'); sit.textContent = ' ' + (c.st || ''); nm.appendChild(sit);
      const pv = document.createElement('div'); pv.textContent = `${pct(c.pvap)} · ${int.format(c.vap)}`;
      const b = document.createElement('div'); b.className = 'b'; const i = document.createElement('i');
      i.style.width = c.pvap + '%'; i.style.background = cor[c.sg] || '#64748B'; b.appendChild(i);
      div.append(nm, pv, b); lista.appendChild(div);
    }
  }

  async function ciclo() {
    try {
      const d = SIM !== null ? simular(SIM) : await getJSON(FONTES_2T);
      render(d); falhas = 0;
      const el = $('status'); el.className = 'status vivo'; el.textContent = SIM !== null ? 'SIMULAÇÃO (dados fictícios)' : (d.tf === 's' ? 'Totalização concluída' : 'Ao vivo · TSE');
    } catch (e) {
      falhas++;
      const el = $('status'); el.className = 'status erro'; el.textContent = 'Sem conexão com o TSE, tentando de novo…';
    }
    setTimeout(ciclo, document.hidden ? INTERVALO * 3 : INTERVALO);
  }

  (async function iniciar() {
    if (SIM !== null) { const b = document.createElement('div'); b.className = 'sim'; b.textContent = `SIMULAÇÃO com ${SIM}% das urnas: números fictícios, só para teste`; document.body.prepend(b); }
    try { renderT1(await getJSON(FONTES_1T)); } catch (_) { txt('t1-res', 'Não foi possível carregar o 1º turno agora.'); }
    ciclo();
  })();
})();
