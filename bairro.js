/* Cadê Meu Voto — "Mais votados no seu bairro".
 *
 * Privacidade (regra do recurso):
 *  - A localização só é pedida depois de um toque do usuário ("Usar minha localização" ou o aviso de 20 min).
 *    Ao abrir a página, o aviso de 20 min só é retomado se a permissão JÁ tiver sido dada antes (nunca abre o pedido sozinho).
 *  - As coordenadas ficam só na memória desta aba. Nada de coordenada vai para servidor nenhum: o aparelho baixa
 *    arquivos públicos (lista de municípios e locais de votação) e faz a conta aqui. Só o código do município
 *    e o nome do bairro aparecem nos endereços dos arquivos buscados.
 *  - No armazenamento local ficam apenas: a escolha do aviso de 20 min e os bairros já avisados no dia.
 */
(function (global) {
  'use strict';
  const LS_AVISO = 'cmv_bairro_aviso', LS_VISTOS = 'cmv_bairro_vistos';
  const DWELL_MS = 20 * 60 * 1000;      // 20 min visíveis no mesmo bairro
  const TICK_MS = 15 * 1000;
  const RAIO_MESMO = 400;               // m: dentro disso é "o mesmo lugar" mesmo que o local mais próximo mude
  const MAX_DIST_LOCAL = 5000;          // m: mais longe que isso do local de votação mais próximo → não arrisca bairro
  const MIN_APTOS = 500;
  const UFS = [['ac', 'Acre'], ['al', 'Alagoas'], ['ap', 'Amapá'], ['am', 'Amazonas'], ['ba', 'Bahia'], ['ce', 'Ceará'], ['df', 'Distrito Federal'],
    ['es', 'Espírito Santo'], ['go', 'Goiás'], ['ma', 'Maranhão'], ['mt', 'Mato Grosso'], ['ms', 'Mato Grosso do Sul'], ['mg', 'Minas Gerais'],
    ['pa', 'Pará'], ['pb', 'Paraíba'], ['pr', 'Paraná'], ['pe', 'Pernambuco'], ['pi', 'Piauí'], ['rj', 'Rio de Janeiro'], ['rn', 'Rio Grande do Norte'],
    ['rs', 'Rio Grande do Sul'], ['ro', 'Rondônia'], ['rr', 'Roraima'], ['sc', 'Santa Catarina'], ['sp', 'São Paulo'], ['se', 'Sergipe'], ['to', 'Tocantins']];
  const UFN = Object.fromEntries(UFS);

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const titulo = s => String(s || '').toLowerCase().replace(/(^|[\s\-/(])([\p{L}])/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(De|Da|Do|Das|Dos|E)\b/g, w => w.toLowerCase());
  const fmt = n => Number(n || 0).toLocaleString('pt-BR');
  const pct = (v, t) => t ? (100 * v / t).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '—';
  const base = () => String(global.DATA_BASE || 'https://dados.cademeuvoto.com.br').replace(/\/$/, '');
  const url = p => base() + '/' + p;
  const isPro = () => !!(global.CMV && typeof global.CMV.pro === 'function' && global.CMV.pro());

  /* ---------------- dados (com cache em memória) ---------------- */
  const cache = new Map();
  function getJSON(p) {
    if (!cache.has(p)) cache.set(p, fetch(url(p)).then(r => { if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; } return r.json(); })
      .catch(e => { cache.delete(p); throw e; }));
    return cache.get(p);
  }
  const privCache = new Map();
  function getPriv(p) {
    if (!privCache.has(p)) privCache.set(p, global.CMV.getPrivate(p).catch(e => { privCache.delete(p); throw e; }));
    return privCache.get(p);
  }
  const municipios = () => getJSON('m2024/municipios.json');

  /* ---------------- geografia (tudo no aparelho) ---------------- */
  function dist(la1, lo1, la2, lo2) {
    const R = 6371000, k = Math.PI / 180, a = (la2 - la1) * k, b = (lo2 - lo1) * k;
    const x = Math.sin(a / 2) ** 2 + Math.cos(la1 * k) * Math.cos(la2 * k) * Math.sin(b / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  /** Local de votação mais próximo (2026 e 2024) entre os municípios cujo centro está mais perto. */
  async function localMaisProximo(lat, lon) {
    const mj = await municipios();
    const perto = mj.m.filter(r => r[3] != null).map(r => [dist(lat, lon, r[3], r[4]), r]).sort((a, b) => a[0] - b[0]).slice(0, 3);
    if (!perto.length || perto[0][0] > 120000) return null;
    const arqs = [];
    for (const [, r] of perto) for (const ano of ['e2026', 'm2024']) arqs.push(getJSON(`${ano}/${r[0]}/locais/${r[1]}.json`).then(d => ({ d, uf: r[0], ano })).catch(() => null));
    let best = null; const cob = {};
    for (const x of await Promise.all(arqs)) {
      if (!x) continue;
      const k = x.uf + ':' + x.d.cd; cob[k] = cob[k] || { tot: 0, sem: 0 };
      for (const l of x.d.l) {
        cob[k].tot++;
        if (l[0] == null || l[1] == null) { cob[k].sem++; continue; }
        const dd = dist(lat, lon, l[0], l[1]);
        if (!best || dd < best.dist) best = { dist: dd, uf: x.uf, cd: x.d.cd, mun: x.d.nm, bairro: x.d.bairros[l[2]], local: l[5], ano: x.ano };
      }
    }
    if (!best) return null;
    const c = cob[best.uf + ':' + best.cd];
    best.semCoord = c && c.tot ? c.sem / c.tot : 0;
    best.longe = best.dist > MAX_DIST_LOCAL;
    return best;
  }

  /* ---------------- estado da tela ---------------- */
  const st = { stage: 'intro', sel: null, msg: '', picker: { uf: '', cd: '', b: '' } };
  let root = null;
  function view() { return document.getElementById('view-bairro'); }
  function ensureRoot() {
    const v = view(); if (!v) return null;
    root = v.querySelector('.bx-root');
    if (!root) { root = document.createElement('div'); root.className = 'bx-root'; v.appendChild(root); }
    return root;
  }
  function render() {
    injectCss();
    if (!ensureRoot()) return;
    if (st.stage === 'picker') return renderPicker();
    if (st.stage === 'locating') return renderLocating();
    if (st.stage === 'result' && st.sel) return renderResultado();
    renderIntro();
  }

  const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="9.5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

  function avisoToggleHtml(id) {
    return `<label class="bx-switch" for="${id}"><input type="checkbox" id="${id}" data-bx-aviso${avisoLigado() ? ' checked' : ''}><span class="bx-sw" aria-hidden="true"></span>
      <span><strong>Me avise quando eu estiver no mesmo bairro por 20 min</strong><br><small>Funciona só com o site aberto e visível na tela. A posição fica apenas na memória do aparelho; aqui guardamos só esta escolha e os bairros já avisados no dia.</small></span></label>`;
  }
  function ligarToggles(scope) {
    scope.querySelectorAll('[data-bx-aviso]').forEach(inp => inp.addEventListener('change', () => setAviso(inp.checked, true)));
  }
  function syncToggles() { document.querySelectorAll('[data-bx-aviso]').forEach(i => { i.checked = avisoLigado(); }); }

  function renderIntro() {
    root.innerHTML = `
      <div class="page-head"><div class="eyebrow">Eleições 2024 e 2026</div><h1>Mais votados no seu bairro</h1>
        <p>Veja quem foram os mais votados no seu bairro para Vereador e Prefeito (2024) e para Presidente, Governador, Senador, Deputado Federal e Deputado Estadual (2026).</p></div>
      <div class="bx-card bx-consent" id="bx-consent">
        <h2>Antes de usar a localização</h2>
        <ul>
          <li><strong>Para quê:</strong> descobrir o seu bairro pelo local de votação mais próximo de você.</li>
          <li><strong>O que é usado:</strong> a posição do seu aparelho, só agora. A conta é feita no próprio aparelho.</li>
          <li><strong>O que não fazemos:</strong> sua localização não é enviada ao nosso servidor nem fica guardada. Só o bairro é usado para buscar os resultados.</li>
        </ul>
        <p class="bx-note">O navegador vai pedir sua permissão. Se preferir, escolha o bairro na lista — funciona igual.</p>
        ${st.msg ? `<p class="bx-msg" role="alert">${esc(st.msg)}</p>` : ''}
        <div class="bx-acts"><button type="button" class="btn-primary" data-bx="geo">Usar minha localização</button>
          <button type="button" class="btn-ghost" data-bx="picker">Escolher meu bairro</button></div>
      </div>
      <div class="bx-card">${avisoToggleHtml('bx-aviso-tela')}</div>
      <p class="bx-fonte">Fonte: TSE — votação por seção das Eleições Municipais 2024 e das Eleições Gerais 2026 (1º turno). Bairro conforme o cadastro dos locais de votação da Justiça Eleitoral. <a href="#privacidade">Privacidade</a></p>`;
    root.querySelector('[data-bx=geo]').addEventListener('click', usarLocalizacao);
    root.querySelector('[data-bx=picker]').addEventListener('click', () => abrirPicker());
    ligarToggles(root);
  }

  function renderLocating() {
    root.innerHTML = `<div class="page-head"><div class="eyebrow">Mais votados no seu bairro</div><h1>Procurando seu bairro…</h1>
      <p>Calculando, no seu aparelho, o local de votação mais próximo.</p></div><div class="bx-card bx-wait" role="status">Aguarde um instante…</div>`;
  }

  function usarLocalizacao() {
    st.msg = '';
    if (!navigator.geolocation) { st.msg = 'Este navegador não oferece localização. Escolha o bairro na lista.'; return abrirPicker(); }
    st.stage = 'locating'; render();
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const r = await localMaisProximo(pos.coords.latitude, pos.coords.longitude);
        if (!r) { st.msg = 'Não encontramos locais de votação perto de você. Escolha o bairro na lista.'; return abrirPicker(); }
        if (r.longe) { st.msg = `O local de votação mais próximo fica a ${fmt(Math.round(r.dist / 1000))} km. Escolha o bairro na lista para ter certeza.`; return abrirPicker({ uf: r.uf, cd: r.cd }); }
        mostrar({ uf: r.uf, cd: r.cd, mun: r.mun, bairro: r.bairro, origem: 'geo', local: r.local, dist: r.dist, semCoord: r.semCoord });
      } catch (e) { st.msg = 'Não foi possível carregar os locais de votação agora. Tente de novo ou escolha o bairro na lista.'; abrirPicker(); }
    }, err => {
      st.msg = err && err.code === 1 ? 'Sem permissão para usar a localização. Tudo bem: escolha o bairro na lista.' : 'Não conseguimos obter sua localização. Escolha o bairro na lista.';
      abrirPicker();
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
  }

  /* ---------------- escolha manual: UF → município → bairro ---------------- */
  function abrirPicker(pre) {
    st.stage = 'picker';
    const uf0 = (pre && pre.uf) || st.picker.uf || String(global.CURRENT_UF || 'se').toLowerCase();
    st.picker = { uf: uf0, cd: (pre && pre.cd) || (uf0 === st.picker.uf ? st.picker.cd : ''), b: '' };
    if (location.hash.split('?')[0] !== '#bairro') location.hash = '#bairro';
    render();
    try { global.scrollTo({ top: 0, behavior: 'instant' }); } catch (_) { global.scrollTo(0, 0); }
  }
  async function bairrosDe(uf, cd) {
    const [a, b] = await Promise.all([getJSON(`m2024/${uf}/top3-livre/${cd}.json`).catch(() => null), getJSON(`e2026/${uf}/top3-livre/${cd}.json`).catch(() => null)]);
    const m = new Map();
    for (const f of [b, a]) if (f) for (const nm of f.bairros) { const k = norm(nm); if (!k) continue; const prev = m.get(k); if (!prev || (/[^\x00-\x7f]/.test(nm) && !/[^\x00-\x7f]/.test(prev))) m.set(k, nm); }
    return [...m.values()].sort((x, y) => x.localeCompare(y, 'pt-BR'));
  }
  async function renderPicker() {
    const p = st.picker;
    root.innerHTML = `<div class="page-head"><div class="eyebrow">Mais votados no seu bairro</div><h1>Escolha seu bairro</h1>
      <p>Estado, município e bairro, como aparecem no cadastro dos locais de votação.</p></div>
      <div class="bx-card bx-picker" id="bx-picker">
        ${st.msg ? `<p class="bx-msg" role="alert">${esc(st.msg)}</p>` : ''}
        <label>Estado<select data-p="uf">${UFS.map(([c, n]) => `<option value="${c}"${c === p.uf ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>Município<select data-p="cd" disabled><option>Carregando…</option></select></label>
        <label>Bairro<select data-p="b" disabled><option value="">Escolha o município</option></select></label>
        <div class="bx-acts"><button type="button" class="btn-primary" data-bx="ver" disabled>Ver mais votados</button>
          <button type="button" class="btn-ghost" data-bx="voltar">Voltar</button></div>
      </div>`;
    const sUf = root.querySelector('[data-p=uf]'), sCd = root.querySelector('[data-p=cd]'), sB = root.querySelector('[data-p=b]'), ver = root.querySelector('[data-bx=ver]');
    root.querySelector('[data-bx=voltar]').addEventListener('click', () => { st.stage = st.sel ? 'result' : 'intro'; st.msg = ''; render(); });
    const carregaBairros = async () => {
      sB.disabled = true; ver.disabled = true; sB.innerHTML = '<option value="">Carregando…</option>';
      if (!p.cd) { sB.innerHTML = '<option value="">Escolha o município</option>'; return; }
      const lst = await bairrosDe(p.uf, p.cd);
      sB.innerHTML = '<option value="">Escolha o bairro</option>' + lst.map(b => `<option value="${esc(b)}">${esc(titulo(b))}</option>`).join('');
      sB.disabled = !lst.length;
      if (!lst.length) sB.innerHTML = '<option value="">Sem bairros cadastrados</option>';
    };
    const carregaMuns = async () => {
      sCd.disabled = true; sCd.innerHTML = '<option>Carregando…</option>';
      const mj = await municipios();
      const lst = mj.m.filter(r => r[0] === p.uf).sort((a, b) => a[2].localeCompare(b[2], 'pt-BR'));
      if (!lst.some(r => r[1] === p.cd)) p.cd = '';
      sCd.innerHTML = '<option value="">Escolha o município</option>' + lst.map(r => `<option value="${r[1]}"${r[1] === p.cd ? ' selected' : ''}>${esc(titulo(r[2]))}</option>`).join('');
      sCd.disabled = false;
      await carregaBairros();
    };
    sUf.addEventListener('change', () => { p.uf = sUf.value; p.cd = ''; carregaMuns(); });
    sCd.addEventListener('change', () => { p.cd = sCd.value; carregaBairros(); });
    sB.addEventListener('change', () => { p.b = sB.value; ver.disabled = !p.b; });
    ver.addEventListener('click', async () => {
      const mj = await municipios(); const r = mj.m.find(x => x[0] === p.uf && x[1] === p.cd);
      st.msg = '';
      mostrar({ uf: p.uf, cd: p.cd, mun: r ? r[2] : '', bairro: p.b, origem: 'manual' });
    });
    try { await carregaMuns(); } catch (e) { sCd.innerHTML = '<option>Erro ao carregar. Tente de novo.</option>'; }
  }

  /* ---------------- resultado ---------------- */
  function mostrar(sel) {
    st.sel = sel; st.stage = 'result';
    if (location.hash.split('?')[0] !== '#bairro') location.hash = '#bairro';
    render();
    try { global.scrollTo({ top: 0, behavior: 'instant' }); } catch (_) { global.scrollTo(0, 0); }
  }

  const iniciais = nm => esc(String(nm || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join(''));
  function fotoHtml(src, nm) {
    const ini = `<span class="bx-ini" aria-hidden="true">${iniciais(nm)}</span>`;
    if (!src) return `<span class="bx-foto">${ini}</span>`;
    return `<span class="bx-foto">${ini}<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()"></span>`;
  }
  function badge(e, semEleito, sit) {
    if (semEleito) return '';
    if (sit === '2t') return '<span class="bx-badge t2">Vai ao 2º turno</span>';   // nunca "Eleito" antes do 2º turno
    return e ? '<span class="bx-badge ok">Eleito</span>' : '<span class="bx-badge">Não eleito</span>';
  }
  const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  // Governador 2026 já vai nos arquivos, mas só aparece na tela com esta chave ligada (aguarda o OK do Marcel).
  const GOVERNADOR_2026 = true;
  let travaVotos = false;   // versão grátis: no lugar dos votos, botão "Mostrar votos" (os votos nem são baixados)
  const travaHtml = (nm, onde) => `<button type="button" class="bx-trava ${onde}" data-bx-votos aria-label="Mostrar votos de ${esc(titulo(nm))} — exclusivo da Assinatura">${LOCK}<span>Mostrar votos</span></button>`;
  /** item: {nm, sg, nu, e, foto, v?, p?} */
  function lista(items, o = {}) {
    if (!items.length) return '<p class="bx-vazio">Sem votos registrados.</p>';
    return `<ol class="bx-lista${o.compacta ? ' compacta' : ''}">${items.map((c, i) => `<li>
      <span class="bx-pos">${(o.start || 0) + i + 1}º</span>${o.compacta ? '' : fotoHtml(c.foto, c.nm)}
      <span class="bx-nome"><strong>${esc(titulo(c.nm))}</strong><small>${esc(c.sg)} · ${esc(c.nu)}</small>${c.v == null && travaVotos ? travaHtml(c.nm, 'n') : ''}</span>
      <span class="bx-dir">${c.v != null ? `<span class="bx-votos"><strong>${fmt(c.v)}</strong><small>${c.p}</small></span>` : (travaVotos ? travaHtml(c.nm, 'd') : '')}${badge(c.e, o.semEleito, c.s)}</span></li>`).join('')}</ol>`;
  }
  function aviso(txt, cls) { return `<p class="bx-aviso${cls ? ' ' + cls : ''}">${esc(txt)}</p>`; }
  function secao(id, titulo_, ano, corpo) {
    return `<section class="bx-sec" id="${id}" aria-labelledby="${id}-h"><h2 id="${id}-h">${esc(titulo_)} <span>${ano}</span></h2>${corpo}</section>`;
  }

  async function renderResultado() {
    const s = st.sel, uf = s.uf, cd = s.cd, nb = norm(s.bairro);
    const ufU = uf.toUpperCase();
    root.innerHTML = `<div class="page-head"><div class="eyebrow">Mais votados no seu bairro</div><h1>${esc(titulo(s.bairro))}</h1><p>${esc(titulo(s.mun))} — ${esc(ufU)}</p></div><div class="bx-card bx-wait" role="status">Carregando…</div>`;
    const [l24, l26] = await Promise.all([getJSON(`m2024/${uf}/top3-livre/${cd}.json`).catch(() => null), getJSON(`e2026/${uf}/top3-livre/${cd}.json`).catch(() => null)]);
    if (st.sel !== s) return;
    const pro = isPro();
    travaVotos = !pro;
    let priv = null, privErro = null;
    if (pro) {
      try {
        const tarefas = [l24 ? getPriv(`m2024/${uf}/top3/${cd}.json`) : null, l26 ? getPriv(`e2026/${uf}/top3/${cd}.json`) : null,
          l24 ? getJSON(`m2024/${uf}/mun/${cd}.json`) : null, l24 ? getPriv(`m2024/${uf}/det/${cd}/agg.json`) : null];
        const [t24, t26, mun24, agg] = await Promise.all(tarefas.map(t => t && t.catch(e => { privErro = e; return null; })));
        priv = { t24, t26, mun24, agg };
      } catch (e) { privErro = e; }
      if (st.sel !== s) return;
    }
    const b24 = l24 ? l24.bairros.findIndex(b => norm(b) === nb) : -1;
    const b26 = l26 ? l26.bairros.findIndex(b => norm(b) === nb) : -1;
    const munNome = titulo(s.mun || (l24 && l24.nm) || (l26 && l26.nm) || '');
    let html = `<div class="page-head"><div class="eyebrow">Mais votados no seu bairro</div><h1>${esc(titulo(s.bairro))}</h1><p>${esc(munNome)} — ${esc(ufU)}</p></div>`;
    html += `<div class="bx-loc">${PIN}<span>${s.origem === 'geo'
      ? `Bairro aproximado pelo local de votação mais próximo${s.local ? `: ${esc(titulo(s.local))}` : ''}${s.dist != null ? ` (a cerca de ${fmt(Math.max(50, Math.round(s.dist / 50) * 50))} m)` : ''}.`
      : 'Bairro escolhido por você.'}</span><button type="button" class="bx-link" data-bx="trocar">Trocar bairro</button></div>`;
    if (s.origem === 'geo' && s.semCoord > 0.25) html += aviso('Neste município, parte dos locais de votação não tem coordenadas no cadastro do TSE, então o bairro pode não ser o seu. Se não for, use "Trocar bairro".', 'info');
    if (pro && privErro && privErro.status !== 404) html += aviso(privErro.paywall ? 'Entre com a conta da Assinatura para ver os votos.' : 'Não foi possível carregar os votos agora; mostrando a versão resumida.', 'info');

    html += secoes2024(l24, b24, uf, munNome, pro ? priv : null);
    html += secoes2026(l26, b26, uf, munNome, pro ? priv : null);
    if (pro && priv) html += comparativo(priv, b24, b26, l24, l26);
    if (!pro) html += `<a class="bx-cta" href="#planos" data-bx-cta>Ver votos e ranking completo — Assinatura <span aria-hidden="true">→</span></a>`;
    html += `<div class="bx-acts bx-fim"><button type="button" class="btn-ghost" disabled aria-disabled="true" title="Em breve">Mandar recado aos eleitos <small>em breve</small></button></div>`;
    html += `<div class="bx-card bx-mini">${avisoToggleHtml('bx-aviso-res')}</div>`;
    html += `<p class="bx-fonte">Fonte: TSE — ${l24 ? 'Eleições Municipais 2024 (votação por seção)' : ''}${l24 && l26 ? ' e ' : ''}${l26 ? 'Eleições Gerais 2026, 1º turno (votação por seção)' : ''}. Bairro conforme o cadastro dos locais de votação. Ordem pelos votos recebidos nos locais de votação do bairro.</p>`;
    root.innerHTML = html;
    root.querySelector('[data-bx=trocar]').addEventListener('click', () => abrirPicker({ uf: s.uf, cd: s.cd }));
    ligarToggles(root);
    // "Mostrar votos" (grátis): mesmo fluxo do botão Assinar — entra se preciso, depois assinatura/planos
    root.querySelectorAll('[data-bx-votos]').forEach(b => b.addEventListener('click', () => {
      if (global.CMV && typeof global.CMV.assinar === 'function') global.CMV.assinar(); else location.hash = '#planos';
    }));
    const dd = root.querySelector('[data-bx=drill]');
    if (dd) dd.addEventListener('click', () => drill(dd, uf, cd, b24, priv));
  }

  function semBairroMsg(ano, munNome, l, bi) {
    if (bi < 0) return aviso(`Este bairro não aparece nos locais de votação de ${ano}; mostramos o resultado de ${munNome}.`, 'info');
    if (!l.top[bi].ok) return aviso(`Bairro com menos de ${fmt(l.min_aptos || MIN_APTOS)} eleitores: mostramos o resultado de ${munNome}.`, 'info');
    return '';
  }

  function secoes2024(l, bi, uf, munNome, priv) {
    if (!l) {
      const t = uf === 'df' ? 'No Distrito Federal não há eleição para Prefeito e Vereador.' : 'Resultado de 2024 indisponível para este município.';
      return secao('bx-ver', 'Vereador', '2024', aviso(t, 'info'));
    }
    const av = l.avisos || {};
    const supl = c => av.suplementar && av.suplementar.cargos.includes(c);
    const rel = c => av.relatorio && av.relatorio.cargos.includes(c);
    const notas = c => (supl(c) ? aviso(av.suplementar.texto + ' Por isso não indicamos eleito para este cargo aqui.', 'supl') : '') +
      (rel(c) ? aviso('Eleito conforme relatório oficial de totalização de 2024.', 'rel') : '');
    const usaBairro = bi >= 0 && l.top[bi].ok;
    const msg = semBairroMsg(2024, munNome, l, bi);
    const foto = sq => sq ? url(`m2024/${uf}/fotos/${sq}.jpg`) : null;
    if (!priv || !priv.t24 || !priv.mun24) {
      const ref = (c, i) => { const r = l.c[c][i]; return { nm: r[0], sg: r[1], nu: r[2], e: r[3], foto: foto(r[4]) }; };  // tenta sempre; sem foto → iniciais
      const src = usaBairro ? l.top[bi] : l.mun;
      const ver = notas(13) + msg + lista(src.v.map(i => ref('13', i)), { semEleito: supl(13) }) +
        (supl(13) ? '' : `<h3>Eleitos mais votados aqui</h3>${lista(src.ve.map(i => ref('13', i)), { semEleito: false })}`);
      const pre = notas(11) + msg + lista(src.p.map(i => ref('11', i)), { semEleito: supl(11) }) +
        (l.t2 ? `<p class="bx-note">Houve 2º turno em ${esc(munNome)}. Votos do 2º turno por bairro: Assinatura.</p>` : '');
      return secao('bx-ver', 'Vereador', '2024', ver) + secao('bx-pre', 'Prefeito', '2024', pre);
    }
    // Assinatura: votos, % (dos votos nominais do cargo no bairro), ranking completo, eleitos com voto, 2º turno, detalhe por local
    const m = priv.mun24, agg = priv.agg, t = priv.t24;
    const cand = (c, n, v, tot) => { const x = (c === '11' ? m.c11 : m.c13)[n] || {}; return { nm: x.nm, sg: x.sg, nu: x.nu, e: x.e ? 1 : 0, foto: foto(x.sq), v, p: pct(v, tot) }; };
    const tb = bi >= 0 ? t.top.findIndex(x => norm(t.bairros[x.b]) === norm(l.bairros[bi])) : -1;
    const ab = agg && bi >= 0 ? agg.bairros.findIndex(b => norm(b) === norm(l.bairros[bi])) : -1;
    const nominais = (k, idx) => agg && agg.bstat[k] && agg.bstat[k][idx] ? agg.bstat[k][idx][4] : null;
    const rank = (k) => {
      if (ab >= 0 && agg.bairro[k]) return agg.bairro[k][ab].slice().sort((a, b) => b[1] - a[1]);
      return null;
    };
    let ver, pre;
    if (bi >= 0 && tb >= 0) {
      const B = t.top[tb];
      const nomV = nominais('13', ab) || B.v.top3.reduce((a, x) => a + x[1], 0);
      const nomP = nominais('11', ab) || B.p.top3.reduce((a, x) => a + x[1], 0);
      const rkV = rank('13') || B.v.top3, rkP = rank('11') || B.p.top3;
      ver = notas(13) + `<p class="bx-note">${fmt(B.aptos)} eleitores aptos · ${B.nloc} ${B.nloc === 1 ? 'local' : 'locais'} de votação · % dos votos nominais de Vereador no bairro.</p>` +
        lista(rkV.slice(0, 3).map(([n, v]) => cand('13', n, v, nomV)), { semEleito: supl(13) }) +
        (supl(13) ? '' : `<h3>Todos os eleitos com voto aqui (${B.v.eleitos.length})</h3>` + lista(B.v.eleitos.map(([n, v]) => cand('13', n, v, nomV)), { compacta: true }) +
          (B.v.eleitos_sem_voto ? `<p class="bx-note">${B.v.eleitos_sem_voto} eleito(s) sem voto neste bairro.</p>` : '')) +
        (rkV.length > 3 ? `<details class="bx-mais"><summary>Ranking completo (${rkV.length} candidatos)</summary>${lista(rkV.slice(3).map(([n, v]) => cand('13', n, v, nomV)), { compacta: true, start: 3, semEleito: supl(13) })}</details>` : '');
      pre = notas(11) + lista(rkP.slice(0, 3).map(([n, v]) => cand('11', n, v, nomP)), { semEleito: supl(11) }) +
        (rkP.length > 3 ? `<details class="bx-mais"><summary>Ranking completo (${rkP.length} candidatos)</summary>${lista(rkP.slice(3).map(([n, v]) => cand('11', n, v, nomP)), { compacta: true, start: 3, semEleito: supl(11) })}</details>` : '');
      if (B.p2 && B.p2.top && B.p2.top.length) {
        const nom2 = nominais('11t2', ab) || B.p2.top.reduce((a, x) => a + x[1], 0);
        pre += `<h3>2º turno</h3>` + lista(B.p2.top.map(([n, v]) => { const c = cand('11', n, v, nom2); c.e = (m.c11[n] || {}).e ? 1 : 0; return c; }), { semEleito: supl(11) });
      }
      if (agg) pre += `<div class="bx-acts"><button type="button" class="btn-ghost" data-bx="drill">Ver por local de votação (2024)</button></div><div class="bx-drill" hidden></div>`;
      if (!B.aptos || B.aptos < MIN_APTOS) ver = aviso(`Bairro pequeno (${fmt(B.aptos)} eleitores): poucos votos podem mudar a ordem.`, 'info') + ver;
    } else {
      // bairro ausente em 2024: resultado do município
      const totP = (m.secoes['11'] || {}).nom, totV = (m.secoes['13'] || {}).nom;
      const c11 = m.c11.filter(x => x.v).sort((a, b) => b.v - a.v), c13 = m.c13.filter(x => x.v).sort((a, b) => b.v - a.v);
      ver = notas(13) + msg + lista(c13.slice(0, 3).map(x => cand('13', x.n, x.v, totV)), { semEleito: supl(13) });
      pre = notas(11) + msg + lista(c11.slice(0, 3).map(x => cand('11', x.n, x.v, totP)), { semEleito: supl(11) });
    }
    return secao('bx-ver', 'Vereador', '2024', ver) + secao('bx-pre', 'Prefeito', '2024', pre);
  }

  function secoes2026(l, bi, uf, munNome, priv) {
    // Ordem: Presidente, (Governador — só com GOVERNADOR_2026), Senador, Deputado Federal, Deputado Estadual/Distrital.
    // Cargo ausente no arquivo (arquivo antigo, sem Presidente) é pulado.
    const ordem = ['1', ...(GOVERNADOR_2026 ? ['3'] : []), '5', '6', '7'].filter(c => !l || !l.cargos || l.cargos[c]);
    if (!l) return secao('bx-2026', 'Presidente, Senador e Deputados', '2026', aviso('Resultado de 2026 indisponível para este município.', 'info'));
    const usaBairro = bi >= 0 && l.top[bi].ok;
    const msg = semBairroMsg(2026, munNome, l, bi);
    const fotoC = (c, sq) => sq ? url(c === '1' ? `tse/ele2026/6257/fotos/br/${sq}.jpeg` : `tse/ele2026/6259/fotos/${uf}/${sq}.jpeg`) : null;
    const t2 = c => (l.t2 && l.t2[c]) ? `<p class="bx-note bx-t2">1º turno. O 2º turno é em ${esc(l.t2[c])}; o resultado dele aparece aqui depois da apuração.</p>` : '';
    const nomeCargo = c => (l.cargos && l.cargos[c]) || { 1: 'Presidente', 3: 'Governador', 5: 'Senador', 6: 'Deputado Federal', 7: 'Deputado Estadual' }[c];
    let html = '';
    const t = priv && priv.t26;
    const tb = t && bi >= 0 ? t.top.findIndex(x => norm(t.bairros[x.b]) === norm(l.bairros[bi])) : -1;
    for (const c of ordem) {
      let corpo;
      if (!t) {
        const ref = i => { const r = l.c[i]; return { nm: r[1], sg: r[2], nu: r[3], e: r[4], foto: fotoC(r[0], r[5]), s: r[6] }; };
        const src = usaBairro ? l.top[bi] : l.mun;
        corpo = msg + t2(c) + lista((src[c] || []).map(ref));
      } else {
        const ref = (i, v, tot) => { const r = t.c[i]; return { nm: r[1], sg: r[2], nu: r[3], e: r[4], foto: fotoC(r[0], r[5]), s: r[6], v, p: pct(v, tot) }; };
        const B = tb >= 0 && t.top[tb].aptos >= MIN_APTOS ? t.top[tb][c] : (tb >= 0 ? t.top[tb][c] : t.mun[c]);
        const info = tb >= 0 ? `<p class="bx-note">${fmt(t.top[tb].aptos)} eleitores aptos · ${t.top[tb].nloc} ${t.top[tb].nloc === 1 ? 'local' : 'locais'} de votação · % dos votos nominais do cargo no bairro.</p>` : msg;
        if (!B) { corpo = aviso('Sem votos registrados.', 'info'); }
        else {
          const rk = B.rk || B.top3;
          corpo = (c === ordem[0] ? info : '') + t2(c) + lista(rk.slice(0, 3).map(([i, v]) => ref(i, v, B.nom))) +
            (B.eleitos && B.eleitos.length ? `<h3>Eleitos com voto aqui (${B.eleitos.length})</h3>` + lista(B.eleitos.map(([i, v]) => ref(i, v, B.nom)), { compacta: true }) : '') +
            (rk.length > 3 ? `<details class="bx-mais"><summary>Ranking (${rk.length} mais votados)</summary>${lista(rk.slice(3).map(([i, v]) => ref(i, v, B.nom)), { compacta: true, start: 3 })}</details>` : '');
        }
        if (c === ordem[ordem.length - 1]) corpo += `<p class="bx-note"><a href="#mapa?uf=${uf}">Abrir o Mapa de Votação</a> para ver 2026 por local e seção.</p>`;
      }
      html += secao('bx-c' + c, nomeCargo(c), '2026', corpo);
    }
    return html;
  }

  function comparativo(priv, b24, b26, l24, l26) {
    const t24 = priv.t24, t26 = priv.t26;
    const x24 = t24 && b24 >= 0 ? t24.top.find(x => norm(t24.bairros[x.b]) === norm(l24.bairros[b24])) : null;
    const x26 = t26 && b26 >= 0 ? t26.top.find(x => norm(t26.bairros[x.b]) === norm(l26.bairros[b26])) : null;
    if (!x24 && !x26) return '';
    const v = (a, b) => (a && b) ? ` <small>(${b >= a ? '+' : ''}${pct(b - a, a)})</small>` : '';
    const ab = priv.agg && b24 >= 0 ? priv.agg.bairros.findIndex(b => norm(b) === norm(l24.bairros[b24])) : -1;
    const comp24 = ab >= 0 && priv.agg.bstat['13'] ? priv.agg.bstat['13'][ab] : null;
    return secao('bx-cmp', '2024 × 2026 neste bairro', '', `<table class="bx-tab"><thead><tr><th></th><th>2024</th><th>2026</th></tr></thead><tbody>
      <tr><th>Eleitores aptos</th><td>${x24 ? fmt(x24.aptos) : '—'}</td><td>${x26 ? fmt(x26.aptos) : '—'}${v(x24 && x24.aptos, x26 && x26.aptos)}</td></tr>
      <tr><th>Locais de votação</th><td>${x24 ? x24.nloc : '—'}</td><td>${x26 ? x26.nloc : '—'}</td></tr>
      ${comp24 ? `<tr><th>Comparecimento 2024</th><td>${fmt(comp24[1])} <small>(${pct(comp24[1], comp24[0])})</small></td><td>—</td></tr>` : ''}
      </tbody></table><p class="bx-note">Aptos de 2026 pelo cadastro do eleitorado por local de votação; 2024 pela votação por seção.</p>`);
  }

  async function drill(btn, uf, cd, b24, priv) {
    const box = btn.parentElement.nextElementSibling;
    if (!box) return;
    if (!box.hidden) { box.hidden = true; btn.textContent = 'Ver por local de votação (2024)'; return; }
    box.hidden = false; box.innerHTML = '<p class="bx-note" role="status">Carregando os locais…</p>'; btn.disabled = true;
    try {
      const [geo, p11, v13] = await Promise.all([getPriv(`m2024/${uf}/det/${cd}/geo.json`), getPriv(`m2024/${uf}/det/${cd}/11.json`), getPriv(`m2024/${uf}/det/${cd}/13-loc.json`)]);
      const nb = norm(st.sel.bairro), bix = geo.bairros.findIndex(b => norm(b) === nb);
      const locs = []; geo.locais.forEach((l, i) => { if (l[4] === bix) locs.push(i); });
      const sel = new Set(locs);
      const por = (obj, get) => { const r = {}; for (const n in obj) for (const [li, v] of get(obj[n])) if (sel.has(li)) (r[li] = r[li] || []).push([+n, v]); return r; };
      const pp = por(p11.t1 || {}, x => x.loc || []), vv = por(v13, x => x);
      const m = priv.mun24, nm = (c, n) => { const x = (c === '11' ? m.c11 : m.c13)[n] || {}; return `${esc(titulo(x.nm))} <small>(${esc(x.sg)})</small>`; };
      const top = (arr, c) => (arr || []).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v]) => `<li>${nm(c, n)} — ${fmt(v)}</li>`).join('');
      box.innerHTML = locs.length ? locs.map(i => { const l = geo.locais[i]; return `<div class="bx-local"><h4>${esc(titulo(l[2]))}</h4><small>${esc(titulo(l[3] || ''))} · zona ${geo.zonas[l[0]]}, local ${l[1]}</small>
        <div class="bx-local-g"><div><b>Prefeito (1º turno)</b><ol>${top(pp[i], '11')}</ol></div><div><b>Vereador</b><ol>${top(vv[i], '13')}</ol></div></div></div>`; }).join('')
        : '<p class="bx-note">Nenhum local de votação deste bairro em 2024.</p>';
      btn.textContent = 'Esconder locais de votação';
    } catch (e) { box.innerHTML = aviso(e.paywall ? 'Detalhe exclusivo da Assinatura.' : 'Não foi possível carregar o detalhe agora.', 'info'); }
    btn.disabled = false;
  }

  /* ---------------- aviso de 20 minutos no mesmo bairro ---------------- */
  const dw = { watchId: null, timer: null, anchor: null, acc: 0, last: 0, busy: false, sessaoOk: false };
  function avisoLigado() { try { return localStorage.getItem(LS_AVISO) === '1'; } catch (_) { return false; } }
  function setAviso(on, porToque) {
    try { if (on) localStorage.setItem(LS_AVISO, '1'); else localStorage.removeItem(LS_AVISO); } catch (_) {}
    syncToggles();
    if (on) dwellStart(!!porToque); else dwellStop(true);
  }
  function hoje() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function lerVistos() { try { return JSON.parse(localStorage.getItem(LS_VISTOS) || '{}') || {}; } catch (_) { return {}; } }
  function gravarVisto(k) {
    const v = lerVistos(), h = hoje(); v[k] = h;
    for (const x of Object.keys(v)) if (v[x] !== h) delete v[x];   // só o dia de hoje importa
    try { localStorage.setItem(LS_VISTOS, JSON.stringify(v)); } catch (_) {}
  }
  function dwellStart(porToque) {
    if (!avisoLigado() || !navigator.geolocation || dw.watchId != null) return;
    if (document.visibilityState === 'hidden') return;
    const go = () => {
      if (dw.watchId != null || document.visibilityState === 'hidden' || !avisoLigado()) return;
      dw.sessaoOk = true;
      dw.watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: false, maximumAge: 60000, timeout: 60000 });
      dw.last = Date.now();
      dw.timer = setInterval(tick, TICK_MS);
    };
    if (porToque || dw.sessaoOk) return go();
    // ao abrir a página: só retoma se a permissão já foi dada; nunca dispara o pedido de permissão sozinho
    if (navigator.permissions && navigator.permissions.query) navigator.permissions.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted') go(); }).catch(() => {});
  }
  function dwellPause() {
    if (dw.timer) tick();
    if (dw.watchId != null) { try { navigator.geolocation.clearWatch(dw.watchId); } catch (_) {} }
    dw.watchId = null; clearInterval(dw.timer); dw.timer = null;
  }
  function dwellStop(reset) { dwellPause(); if (reset) { dw.anchor = null; dw.acc = 0; } }
  function tick() {
    const now = Date.now();
    if (dw.anchor && dw.timer) dw.acc += Math.max(0, Math.min(now - dw.last, 2 * 60 * 1000)); // aparelho dormindo não conta
    dw.last = now;
    if (dw.anchor && dw.acc >= DWELL_MS) avisar();
  }
  function onPosErr(err) {
    if (err && err.code === 1) {   // permissão negada: desliga o aviso e oferece a lista
      setAviso(false);
      st.msg = 'Sem permissão de localização, o aviso de 20 minutos não funciona. Você pode escolher o bairro na lista.';
      if (document.body.dataset.view === 'bairro') { if (st.stage === 'intro') render(); }
    }
  }
  async function onPos(pos) {
    const { latitude: lat, longitude: lon, accuracy } = pos.coords;
    if (accuracy && accuracy > 2000) return;
    if (dw.anchor && dist(lat, lon, dw.anchor.lat, dw.anchor.lon) <= RAIO_MESMO) return;
    if (dw.busy) return;
    dw.busy = true;
    try {
      const r = await localMaisProximo(lat, lon);
      if (!r || r.longe) { tick(); dw.anchor = null; dw.acc = 0; return; }
      const key = `${r.uf}:${r.cd}:${norm(r.bairro)}`;
      if (dw.anchor && dw.anchor.key === key) { dw.anchor.lat = lat; dw.anchor.lon = lon; return; }
      tick();
      dw.anchor = { key, lat, lon, r }; dw.acc = 0; dw.last = Date.now();
    } catch (_) { /* rede: tenta na próxima posição */ } finally { dw.busy = false; }
  }
  function avisar() {
    const a = dw.anchor; if (!a) return;
    if (lerVistos()[a.key] === hoje()) return;
    gravarVisto(a.key);
    mostrarToast(a.r);
  }
  function mostrarToast(r) {
    injectCss();
    let t = document.getElementById('bx-toast');
    if (t) t.remove();
    t = document.createElement('div'); t.id = 'bx-toast'; t.className = 'bx-toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite');
    t.innerHTML = `<div class="bx-toast-ic">${PIN}</div><div class="bx-toast-tx"><strong>Você está em ${esc(titulo(r.bairro))}.</strong> Veja quem foram os mais votados aqui</div>
      <div class="bx-toast-acts"><button type="button" class="btn-primary" data-t="ver">Ver</button><button type="button" class="btn-ghost" data-t="fechar">Agora não</button>
      <button type="button" class="bx-link" data-t="parar">Não avisar mais</button></div>`;
    document.body.appendChild(t);
    const fechar = () => t.remove();
    t.querySelector('[data-t=ver]').addEventListener('click', () => { fechar(); mostrar({ uf: r.uf, cd: r.cd, mun: r.mun, bairro: r.bairro, origem: 'geo', local: r.local, dist: r.dist, semCoord: r.semCoord }); });
    t.querySelector('[data-t=fechar]').addEventListener('click', fechar);
    t.querySelector('[data-t=parar]').addEventListener('click', () => { setAviso(false); fechar(); });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') dwellPause(); else dwellStart(false);
  });

  /* ---------------- Minha conta: cartão com o mesmo interruptor ---------------- */
  function contaCard(container) {
    if (!container || container.querySelector('#bx-conta-card')) return;
    injectCss();
    const box = container.querySelector('.cmv-conta') || container;
    const d = document.createElement('div'); d.className = 'card'; d.id = 'bx-conta-card';
    d.innerHTML = `<h2>Localização</h2><p>Usada só no recurso <a href="#bairro">Mais votados no seu bairro</a>, no seu aparelho. Nunca enviamos sua localização ao servidor.</p>${avisoToggleHtml('bx-aviso-conta')}`;
    box.appendChild(d); ligarToggles(d);
  }

  /* ---------------- estilo ---------------- */
  let cssOk = false;
  function injectCss() {
    if (cssOk) return; cssOk = true;
    const s = document.createElement('style'); s.id = 'bx-css';
    s.textContent = `
.bx-root { max-width: 760px; margin: 0 auto; }
.bx-card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 18px; margin: 0 0 14px; }
.bx-card h2 { margin: 0 0 10px; font-size: 1.05rem; }
.bx-consent ul { margin: 0 0 10px; padding-left: 18px; color: var(--muted); }
.bx-consent li { margin: 4px 0; }
.bx-note { color: var(--subtext); font-size: .85rem; margin: 6px 0; }
.bx-msg { background: rgba(245,158,11,.12); border: 1px solid rgba(245,158,11,.35); color: var(--text); border-radius: 10px; padding: 8px 10px; font-size: .9rem; }
.bx-acts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.bx-acts .btn-primary, .bx-acts .btn-ghost { min-height: 44px; }
.bx-acts small { opacity: .75; font-size: .75rem; margin-left: 4px; }
.bx-picker label { display: grid; gap: 4px; margin: 0 0 12px; font-size: .85rem; color: var(--subtext); }
.bx-picker select { min-height: 44px; border-radius: 10px; border: 1px solid var(--line-2); background: var(--bg-2); color: var(--text); padding: 0 10px; font-size: 1rem; }
.bx-switch { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; }
.bx-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.bx-sw { flex: 0 0 auto; width: 44px; height: 26px; border-radius: 999px; background: rgba(148,163,184,.3); position: relative; transition: background .2s; margin-top: 2px; }
.bx-sw::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform .2s; }
.bx-switch input:checked + .bx-sw { background: var(--brand); }
.bx-switch input:checked + .bx-sw::after { transform: translateX(18px); }
.bx-switch input:focus-visible + .bx-sw { outline: 2px solid var(--accent); outline-offset: 2px; }
.bx-switch small { color: var(--subtext); }
.bx-loc { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: .88rem; color: var(--muted); margin: -8px 0 14px; }
.bx-loc svg { width: 18px; height: 18px; color: var(--accent); flex: 0 0 auto; }
.bx-loc span { flex: 1 1 200px; }
.bx-link { background: none; border: 0; color: var(--accent); text-decoration: underline; cursor: pointer; font: inherit; padding: 8px 4px; min-height: 44px; }
.bx-sec { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px; margin: 0 0 14px; }
.bx-sec h2 { margin: 0 0 10px; font-size: 1.05rem; display: flex; align-items: baseline; gap: 8px; }
.bx-sec h2 span { font-size: .78rem; color: var(--subtext); font-weight: 600; }
.bx-sec h3 { margin: 14px 0 6px; font-size: .82rem; text-transform: uppercase; letter-spacing: .06em; color: var(--subtext); }
.bx-lista { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.bx-lista li { display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 6px 8px; border-radius: 12px; background: rgba(148,163,184,.06); }
.bx-lista.compacta li { min-height: 40px; padding: 4px 8px; }
.bx-pos { width: 26px; flex: 0 0 auto; color: var(--subtext); font-weight: 700; font-size: .85rem; text-align: right; }
.bx-foto { position: relative; flex: 0 0 auto; width: 44px; height: 56px; border-radius: 8px; overflow: hidden; background: rgba(148,163,184,.18); display: inline-flex; align-items: center; justify-content: center; }
.bx-foto img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.bx-ini { color: var(--muted); font-weight: 700; font-size: .85rem; }
.bx-nome { flex: 1 1 auto; min-width: 0; display: grid; }
.bx-nome strong { font-size: .95rem; overflow-wrap: anywhere; }
.bx-nome small { color: var(--subtext); font-size: .8rem; }
.bx-dir { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.bx-votos { display: grid; text-align: right; line-height: 1.15; }
.bx-votos small { color: var(--subtext); font-size: .75rem; }
.bx-trava { display: inline-flex; align-items: center; gap: 5px; min-height: 34px; padding: 0 10px; border-radius: 999px; border: 1px solid rgba(96,165,250,.5); background: rgba(37,99,235,.16); color: var(--accent); font: inherit; font-size: .74rem; font-weight: 700; white-space: nowrap; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.bx-trava svg { width: 14px; height: 14px; flex: none; }
.bx-trava.n { display: none; }
.bx-trava:hover { background: rgba(37,99,235,.28); }
.bx-trava:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.bx-badge.t2 { color: #b45309; border-color: #f59e0b; background: rgba(245,158,11,.12); }
.bx-badge { font-size: .7rem; font-weight: 700; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--line-2); color: var(--subtext); white-space: nowrap; }
.bx-badge.ok { color: var(--text); border-color: rgba(148,163,184,.55); background: rgba(148,163,184,.16); }
.bx-aviso { font-size: .82rem; color: var(--muted); border-left: 3px solid var(--line-2); padding: 4px 0 4px 10px; margin: 6px 0 10px; }
.bx-aviso.supl, .bx-aviso.rel { border-left-color: var(--corrige); }
.bx-vazio { color: var(--subtext); font-size: .88rem; }
.bx-mais summary { cursor: pointer; color: var(--accent); min-height: 44px; display: flex; align-items: center; font-size: .9rem; }
.bx-cta { display: flex; justify-content: center; gap: 6px; text-decoration: none; font-size: .9rem; padding: 12px; border: 1px dashed var(--line-2); border-radius: 12px; margin: 4px 0 14px; color: var(--accent); }
.bx-fonte { color: var(--subtext); font-size: .78rem; margin: 10px 0 24px; }
.bx-fim { justify-content: center; margin: 0 0 14px; }
.bx-tab { width: 100%; border-collapse: collapse; font-size: .9rem; }
.bx-tab th, .bx-tab td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--line); }
.bx-tab small { color: var(--subtext); }
.bx-local { border-top: 1px solid var(--line); padding: 10px 0; }
.bx-local h4 { margin: 0; font-size: .92rem; }
.bx-local small { color: var(--subtext); }
.bx-local-g { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: .84rem; margin-top: 6px; }
.bx-local-g ol { margin: 4px 0 0; padding-left: 18px; }
@media (max-width: 520px) { .bx-local-g { grid-template-columns: 1fr; } .bx-badge.t2 { color: #b45309; border-color: #f59e0b; background: rgba(245,158,11,.12); }
.bx-badge { font-size: .66rem; padding: 2px 6px; } }
@media (max-width: 440px) { .bx-lista li { padding: 6px 8px 6px 6px; gap: 8px; } .bx-pos { width: 22px; }
  .bx-trava.d { display: none; } .bx-trava.n { display: inline-flex; justify-self: start; margin-top: 4px; min-height: 32px; padding: 0 10px; font-size: .72rem; } }
.bx-toast { position: fixed; z-index: 90; left: max(12px, env(safe-area-inset-left)); right: max(12px, env(safe-area-inset-right)); bottom: calc(12px + env(safe-area-inset-bottom) + var(--bn-h, 0px));
  max-width: 520px; margin: 0 auto; background: var(--card-2, #162447); color: var(--text); border: 1px solid var(--line-2); border-radius: 16px; padding: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.45);
  display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: start; }
.bx-toast-ic svg { width: 24px; height: 24px; color: var(--accent); }
.bx-toast-acts { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.bx-toast-acts .btn-primary, .bx-toast-acts .btn-ghost { min-height: 44px; }
`;
    document.head.appendChild(s);
  }

  /* ---------------- início ---------------- */
  function boot() {
    injectCss();
    if (avisoLigado()) dwellStart(false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  global.Bairro = { render, contaCard, setAviso, avisoLigado, abrirPicker,
    _teste: { dw, localMaisProximo, norm, DWELL_MS } };
})(window);
