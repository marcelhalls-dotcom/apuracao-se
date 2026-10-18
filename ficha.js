/* Cadê Meu Voto — ficha do candidato com o patrimônio declarado (TSE, bem_candidato_2026).
 * Abre ao tocar no candidato (rankings, eleitos, cards, bairro, mapa). Sem dependências externas.
 * Gratuito: total declarado + nº de bens (arquivo público patrimonio/2026/<uf>.json no R2 de dados).
 * Assinante: bens (tipo e valor), composição, evolução desde 2022/2024 e ranking (arquivo privado via API /dados, com plano).
 * A descrição livre dos bens (DS_BEM_CANDIDATO) não existe em nenhum arquivo: só tipo e valor. */
(function (global) {
  'use strict';
  const doc = global.document;
  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const BRL0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const INT = new Intl.NumberFormat('pt-BR');
  const AVISO = 'Valor declarado pelo próprio candidato à Justiça Eleitoral no registro da candidatura de 2026, em geral pelo valor de aquisição (não é valor de mercado). O Cadê Meu Voto não altera nem estima esses valores.';
  const cargoNome = (c, uf) => ({ 1: 'Presidente', 3: 'Governador', 5: 'Senador', 6: 'Deputado Federal', 7: uf === 'df' ? 'Deputado Distrital' : 'Deputado Estadual', 8: 'Deputado Distrital' })[c] || 'Candidato';
  const sqn = s => String(s || '').trim().replace(/^0+/, '');
  const okUf = u => /^[a-z]{2}$/.test(u);
  const el = (t, c, txt) => { const e = doc.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
  const pub = new Map(), pro = new Map();

  const CSS = `
  .fc-ov{position:fixed;inset:0;z-index:95;background:rgba(2,6,23,.62);display:flex;justify-content:flex-end}
  .fc-pn{width:min(460px,100%);height:100%;overflow-y:auto;overscroll-behavior:contain;background:var(--bg-2,#0D1A33);border-left:1px solid var(--line-2,rgba(148,163,184,.28));box-shadow:-18px 0 50px rgba(2,6,23,.5);padding:16px 18px calc(28px + env(safe-area-inset-bottom));color:var(--text,#F1F5F9)}
  .fc-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
  .fc-top .fc-k{font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--subtext,#94A3B8);font-weight:700}
  .fc-x{appearance:none;border:0;background:transparent;color:var(--muted,#CBD5E1);font-size:1.7rem;width:44px;height:44px;cursor:pointer;border-radius:10px;flex:none}
  .fc-x:hover{background:rgba(148,163,184,.12)}
  .fc-hd{display:flex;gap:12px;align-items:center;min-width:0}
  .fc-hd .avatar{width:60px;height:60px;flex:none;border-radius:14px;overflow:hidden}
  .fc-nm{font-size:1.2rem;font-weight:800;letter-spacing:-.01em;line-height:1.2;overflow-wrap:anywhere}
  .fc-sub{color:var(--subtext,#94A3B8);font-size:.86rem;overflow-wrap:anywhere}
  .fc-pat{margin-top:16px;padding:16px;border-radius:14px;background:linear-gradient(135deg,rgba(37,99,235,.18),rgba(37,99,235,.05));border:1px solid rgba(96,165,250,.3)}
  .fc-pat .fc-l{font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:#BFDBFE;font-weight:700}
  .fc-pat .fc-v{font-size:1.9rem;font-weight:800;letter-spacing:-.02em;line-height:1.15;margin-top:2px;overflow-wrap:anywhere}
  .fc-pat .fc-v.fc-nada{font-size:1.25rem}
  .fc-pat .fc-m{color:var(--muted,#CBD5E1);font-size:.85rem;margin-top:4px}
  .fc-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .fc-chip{font-size:.8rem;padding:5px 10px;border-radius:12px;background:rgba(148,163,184,.12);color:var(--muted,#CBD5E1);max-width:100%}
  .fc-chip.up{background:rgba(245,158,11,.14);color:#FCD34D}.fc-chip.down{background:rgba(96,165,250,.14);color:#BFDBFE}
  .fc-h{margin:20px 0 8px;font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--subtext,#94A3B8);font-weight:700}
  .fc-cat{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;font-size:.88rem;margin-bottom:8px}
  .fc-bar{grid-column:1/-1;height:6px;border-radius:99px;background:rgba(148,163,184,.14);overflow:hidden}.fc-bar i{display:block;height:100%;background:var(--accent,#60A5FA);border-radius:99px}
  .fc-bens{width:100%;border-collapse:collapse;font-size:.86rem}.fc-bens td{padding:8px 2px;border-top:1px solid var(--line,rgba(148,163,184,.16));vertical-align:top;overflow-wrap:anywhere}
  .fc-bens td.v{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:600;padding-left:10px}
  .fc-seg{display:inline-flex;border:1px solid var(--line-2,rgba(148,163,184,.28));border-radius:999px;overflow:hidden;margin-bottom:6px;max-width:100%}
  .fc-seg button{appearance:none;border:0;background:transparent;color:var(--muted,#CBD5E1);font:inherit;font-size:.8rem;font-weight:600;padding:7px 12px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .fc-seg button[aria-pressed="true"]{background:var(--brand,#2563EB);color:#fff}
  .fc-pos{font-size:.86rem;color:var(--muted,#CBD5E1);margin:4px 0 8px}
  .fc-rk{list-style:none;margin:0;padding:0}
  .fc-rk li{display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:8px;align-items:center;padding:7px 4px;border-top:1px solid var(--line,rgba(148,163,184,.16));font-size:.85rem;cursor:pointer;border-radius:8px}
  .fc-rk li:hover{background:rgba(148,163,184,.08)}.fc-rk li.eu{background:rgba(96,165,250,.14)}
  .fc-rk .i{color:var(--subtext,#94A3B8);font-weight:700;text-align:right}.fc-rk .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fc-rk .n small{display:block;color:var(--subtext,#94A3B8);font-size:.74rem}.fc-rk .v{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
  .fc-fonte{margin-top:18px;font-size:.76rem;color:var(--subtext,#94A3B8);border-top:1px solid var(--line,rgba(148,163,184,.16));padding-top:12px}
  .fc-wait{color:var(--subtext,#94A3B8);font-size:.88rem;margin-top:14px}
  .fc-pw{margin-top:16px}
  [data-ficha-sq][role="button"]{cursor:pointer}
  .rank-item:has([data-ficha-sq]),.el-row:has([data-ficha-sq]),.kpi-row:has([data-ficha-sq]),.cand:has([data-ficha-sq]),.bx-lista li[data-ficha-sq]{cursor:pointer}
  .fc-btn{display:inline-flex;align-items:center;gap:6px;margin-left:8px;padding:3px 10px;border-radius:999px;border:1px solid rgba(96,165,250,.45);background:transparent;color:#BFDBFE;font:inherit;font-size:.76rem;font-weight:600;cursor:pointer;vertical-align:middle}
  @media (max-width:640px){.fc-ov{align-items:flex-end}.fc-pn{width:100%;height:auto;max-height:92%;border-left:0;border-top:1px solid var(--line-2,rgba(148,163,184,.28));border-radius:18px 18px 0 0;padding:12px 16px calc(24px + env(safe-area-inset-bottom))}.fc-pat .fc-v{font-size:1.6rem}}
  `;
  function css() { if (doc.getElementById('fc-css')) return; const s = el('style'); s.id = 'fc-css'; s.textContent = CSS; doc.head.appendChild(s); }

  function urlPub(uf) {
    const base = global.DATA_BASE || 'https://dados.cademeuvoto.com.br';
    const u = base + '/patrimonio/2026/' + uf + '.json';
    return global.cmvComVersao ? global.cmvComVersao(u) : u;
  }
  async function carregaPub(uf) {
    if (!pub.has(uf)) pub.set(uf, (async () => {
      if (global.cmvDadosV && global.cmvDadosV.then) { try { await global.cmvDadosV; } catch (_) {} }
      const r = await fetch(urlPub(uf)); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
    })().catch(e => { pub.delete(uf); throw e; }));
    return pub.get(uf);
  }
  async function carregaPro(uf) {
    if (!pro.has(uf)) pro.set(uf, global.CMV.getPrivate('patrimonio/2026/' + uf + '.json').catch(e => { pro.delete(uf); throw e; }));
    return pro.get(uf);
  }
  const ehPro = () => !!(global.CMV && global.CMV.pro && global.CMV.pro());
  // espera a sessão (/me) antes de decidir grátis × Assinatura — evita mostrar o aviso a quem assina e tocou cedo
  const planoPronto = () => (global.CMV && global.CMV.ready) ? Promise.race([global.CMV.ready, new Promise(r => setTimeout(r, 5000))]).catch(() => {}) : Promise.resolve();

  let ov = null, ultimoFoco = null;
  function fechar() {
    if (!ov) return;
    ov.remove(); ov = null; doc.documentElement.style.overflow = '';
    if (ultimoFoco && ultimoFoco.focus) { try { ultimoFoco.focus({ preventScroll: true }); } catch (_) {} }
  }
  function painel() {
    css();
    if (ov) return ov.querySelector('.fc-body');
    ultimoFoco = doc.activeElement;
    ov = el('div', 'fc-ov');
    const pn = el('div', 'fc-pn'); pn.setAttribute('role', 'dialog'); pn.setAttribute('aria-modal', 'true'); pn.setAttribute('aria-labelledby', 'fc-nome');
    const top = el('div', 'fc-top'); top.appendChild(el('span', 'fc-k', 'Ficha do candidato'));
    const x = el('button', 'fc-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Fechar ficha'); x.addEventListener('click', fechar);
    top.appendChild(x); pn.appendChild(top);
    const body = el('div', 'fc-body'); pn.appendChild(body); ov.appendChild(pn);
    ov.addEventListener('click', e => { if (e.target === ov) fechar(); });
    ov.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); fechar(); return; }
      if (e.key !== 'Tab') return;
      const f = [...pn.querySelectorAll('button, a[href], [tabindex="0"]')].filter(n => n.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && doc.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && doc.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    doc.body.appendChild(ov); doc.documentElement.style.overflow = 'hidden';
    x.focus();
    return body;
  }

  function avatar(sq, nome, uf) {
    try {
      if (typeof makeAvatar === 'function') {
        const a = makeAvatar(sq, nome, uf === 'br' ? (global.CURRENT_UF || 'se') : uf, uf === 'br' ? '6257' : '6259', false);
        a.removeAttribute('role'); a.removeAttribute('tabindex'); a.removeAttribute('data-ficha-sq'); a.removeAttribute('aria-label'); a.title = '';
        return a;
      }
    } catch (_) {}
    return el('div', 'avatar');
  }
  function variacao(atual, a) {
    const onde = a.ano === 2024 ? `${a.cargo}${a.ue ? ', ' + a.ue : ''}` : `${a.cargo}${a.uf && a.uf !== 'BR' ? ', ' + a.uf : ''}`;
    if (!a.n || !a.t) return { c: '', t: `${a.ano} (${onde}): não declarou bens` };
    const p = (atual - a.t) / a.t * 100;
    const s = (p >= 0 ? '+' : '−') + Math.abs(p).toLocaleString('pt-BR', { maximumFractionDigits: p > -10 && p < 10 ? 1 : 0 }) + '%';
    return { c: p >= 0 ? 'up' : 'down', t: `${s} desde ${a.ano}: ${BRL0.format(a.t)} (${onde})` };
  }

  function rankingBox(sq, P, uf, e) {
    const wrap = el('div');
    wrap.appendChild(el('div', 'fc-h', 'Ranking de patrimônio declarado'));
    const seg = el('div', 'fc-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Ranking por');
    const bC = el('button', null, cargoNome(e[2], uf) + (uf === 'br' ? '' : ' · ' + uf.toUpperCase())); bC.type = 'button';
    const bP = el('button', null, 'Partido ' + (e[3] || '—')); bP.type = 'button';
    seg.appendChild(bC); seg.appendChild(bP); wrap.appendChild(seg);
    const pos = el('div', 'fc-pos'); const ol = el('ol', 'fc-rk'); wrap.appendChild(pos); wrap.appendChild(ol);
    const montar = porPartido => {
      bC.setAttribute('aria-pressed', porPartido ? 'false' : 'true'); bP.setAttribute('aria-pressed', porPartido ? 'true' : 'false');
      const lst = Object.entries(P.c).filter(([, x]) => x[2] === e[2] && (!porPartido || x[3] === e[3])).sort((a, b) => b[1][0] - a[1][0] || a[1][4].localeCompare(b[1][4]));
      const i = lst.findIndex(([k]) => k === sq);
      pos.textContent = `${i + 1}º de ${INT.format(lst.length)} ${porPartido ? 'no partido ' + (e[3] || '') + ' (' + cargoNome(e[2], uf) + ')' : 'entre os candidatos a ' + cargoNome(e[2], uf) + (uf === 'br' ? '' : ' em ' + uf.toUpperCase())}`;
      ol.replaceChildren();
      const mostrar = lst.slice(0, 10); if (i >= 10) mostrar.push(lst[i]);
      mostrar.forEach(([k, x]) => {
        const li = el('li', k === sq ? 'eu' : null); li.tabIndex = 0;
        li.appendChild(el('span', 'i', String(lst.findIndex(([q]) => q === k) + 1)));
        const n = el('span', 'n', x[4] || '—'); n.appendChild(el('small', null, x[3] || '')); li.appendChild(n);
        li.appendChild(el('span', 'v', x[1] ? BRL0.format(x[0]) : 'sem bens'));
        const go = () => { if (k !== sq) abrir(k, uf, x[4]); };
        li.addEventListener('click', go); li.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
        ol.appendChild(li);
      });
    };
    bC.addEventListener('click', () => montar(false)); bP.addEventListener('click', () => montar(true));
    montar(false);
    return wrap;
  }

  async function abrir(sqIn, ufIn, nomeIn) {
    const sq = sqn(sqIn), uf = String(ufIn || global.CURRENT_UF || 'se').toLowerCase();
    if (!sq || !okUf(uf)) return;
    const body = painel(); body.replaceChildren();
    const hd = el('div', 'fc-hd'); hd.appendChild(avatar(sq, nomeIn || '', uf));
    const info = el('div'); info.style.minWidth = '0';
    const nm = el('div', 'fc-nm', nomeIn || 'Candidato'); nm.id = 'fc-nome'; info.appendChild(nm);
    const sub = el('div', 'fc-sub', ''); info.appendChild(sub); hd.appendChild(info); body.appendChild(hd);
    const wait = el('div', 'fc-wait', 'Carregando patrimônio declarado…'); wait.setAttribute('role', 'status'); body.appendChild(wait);
    let P;
    try { [P] = await Promise.all([carregaPub(uf), planoPronto()]); } catch (_) { wait.textContent = 'Não foi possível carregar o patrimônio agora. Tente de novo em instantes.'; return; }
    if (!ov || body.parentNode == null) return;
    const e = P.c && P.c[sq];
    wait.remove();
    if (!e) { body.appendChild(el('div', 'fc-wait', 'Patrimônio declarado indisponível para este candidato.')); fonte(body); return; }
    if (!nomeIn && e[4]) nm.textContent = e[4];
    sub.textContent = [cargoNome(e[2], uf), e[3], uf === 'br' ? 'Brasil' : uf.toUpperCase()].filter(Boolean).join(' · ');
    const pat = el('div', 'fc-pat');
    pat.appendChild(el('div', 'fc-l', 'Patrimônio declarado'));
    pat.appendChild(el('div', 'fc-v' + (e[1] ? '' : ' fc-nada'), e[1] ? BRL.format(e[0]) : 'Nenhum bem declarado'));
    pat.appendChild(el('div', 'fc-m', e[1] ? `${INT.format(e[1])} ${e[1] === 1 ? 'bem declarado' : 'bens declarados'} no registro da candidatura de 2026` : 'O candidato não declarou bens no registro da candidatura de 2026.'));
    body.appendChild(pat);
    if (!ehPro()) {
      const txt = 'A lista de bens, a composição, a evolução desde 2022 e 2024 e o ranking de patrimônio por cargo e partido são exclusivos da Assinatura.';
      const box = global.CMV && global.CMV.paywallBox ? global.CMV.paywallBox('plano', txt) : el('div', 'cmv-paywall', txt);
      box.classList.add('fc-pw'); body.appendChild(box);
      fonte(body); return;
    }
    const w2 = el('div', 'fc-wait', 'Carregando detalhes da Assinatura…'); body.appendChild(w2);
    let D;
    try { D = await carregaPro(uf); }
    catch (err) {
      w2.remove();
      if (err && (err.status === 401 || err.status === 402) && global.CMV && global.CMV.paywallBox) { const b = global.CMV.paywallBox(err.paywall || 'plano', err.message); b.classList.add('fc-pw'); body.appendChild(b); }
      else body.appendChild(el('div', 'fc-wait', 'Não foi possível carregar os detalhes agora.'));
      fonte(body); return;
    }
    if (!ov) return;
    w2.remove();
    const d = D.c && D.c[sq];
    if (d && d.ant && d.ant.length) {
      const ch = el('div', 'fc-chips'); d.ant.forEach(a => { const v = variacao(e[0], a); ch.appendChild(el('span', 'fc-chip ' + v.c, v.t)); }); pat.appendChild(ch);
    }
    if (d && d.b && d.b.length) {
      body.appendChild(el('div', 'fc-h', 'Composição'));
      (D.grupos || []).map((g, i) => [g, d.g[i] || 0]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).forEach(([g, v]) => {
        const r = el('div', 'fc-cat'); r.appendChild(el('span', null, g)); r.appendChild(el('strong', null, BRL0.format(v)));
        const bar = el('div', 'fc-bar'); const i = el('i'); i.style.width = (e[0] ? Math.min(100, v / e[0] * 100) : 0).toFixed(1) + '%'; bar.appendChild(i); r.appendChild(bar); body.appendChild(r);
      });
      body.appendChild(el('div', 'fc-h', `Bens declarados (${INT.format(d.b.length)}) · tipo e valor`));
      const tb = el('table', 'fc-bens'); const tbody = el('tbody');
      [...d.b].sort((a, b) => b[1] - a[1]).forEach(([cd, v]) => { const tr = el('tr'); tr.appendChild(el('td', null, (D.tipos && D.tipos[cd]) || 'Outros bens e direitos')); tr.appendChild(el('td', 'v', BRL.format(v))); tbody.appendChild(tr); });
      tb.appendChild(tbody); body.appendChild(tb);
    }
    body.appendChild(rankingBox(sq, P, uf, e));
    fonte(body);
  }
  function fonte(body) { body.appendChild(el('div', 'fc-fonte', 'Fonte: TSE — Dados Abertos, bens declarados pelos candidatos (2026). ' + AVISO)); }

  function botao(sq, uf, nome) {
    css();
    const b = el('button', 'fc-btn', 'Ficha e patrimônio'); b.type = 'button';
    b.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); abrir(sq, uf, nome); });
    return b;
  }

  const LINHA = '.rank-item, .el-row, .kpi-row, .cand, .bx-lista > li';
  function alvo(t) {
    let a = t.closest('[data-ficha-sq]');
    if (!a) { const row = t.closest(LINHA); if (row) a = row.querySelector('[data-ficha-sq]'); }
    return a;
  }
  doc.addEventListener('click', ev => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey) return;
    const t = ev.target; if (!(t instanceof Element)) return;
    if (t.closest('.fc-ov')) return;
    const a = alvo(t); if (!a) return;
    const inter = t.closest('button, input, select, textarea, label, summary, [data-bx-votos]');
    if (inter && !inter.matches('[data-ficha-sq]')) return;
    const link = t.closest('a[href]');
    if (link && !link.classList.contains('kpi')) return;   // links internos de verdade seguem; o card do início abre a ficha no candidato
    ev.preventDefault();
    abrir(a.getAttribute('data-ficha-sq'), a.getAttribute('data-ficha-uf'), a.getAttribute('data-ficha-nome'));
  });
  doc.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const a = ev.target instanceof Element && ev.target.matches('[data-ficha-sq][role="button"]') ? ev.target : null;
    if (!a) return;
    ev.preventDefault(); ev.stopPropagation();
    abrir(a.getAttribute('data-ficha-sq'), a.getAttribute('data-ficha-uf'), a.getAttribute('data-ficha-nome'));
  });
  global.addEventListener('hashchange', () => { ultimoFoco = null; fechar(); });   // trocou de página: a ficha não fica por cima
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', css); else css();
  global.CMV_FICHA = { abrir, botao, fechar };
})(window);
