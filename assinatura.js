/* Cadê Meu Voto — contas, plano e acesso aos dados de detalhe (API cademeuvoto-api).
 * Teste local: ?api=http://localhost:8787&dados=http://127.0.0.1:8766 na URL. */
(function (global) {
  'use strict';
  const API_BASE = (() => {
    try { const q = new URLSearchParams(location.search).get('api'); if (q) return q.replace(/\/$/, ''); } catch (_) {}
    return 'https://api.cademeuvoto.com.br';
  })();
  // Chave PÚBLICA do Turnstile (widget "cademeuvoto-contas", domínios cademeuvoto.com.br e www).
  // A API manda a mesma chave em /config; esta só é usada se /config não responder.
  const TURNSTILE_SITEKEY = '0x4AAAAAAFQo_ACurP4e8Mye';
  const PRIV_RE = /^mapa\/(?:[a-z]{2}\/)?(?:[1-7]\/\d{1,6}\.json|secao\/|geo-loc-[a-z]{2}\.json)/;
  const UFS = [['ac','Acre'],['al','Alagoas'],['am','Amazonas'],['ap','Amapá'],['ba','Bahia'],['ce','Ceará'],['df','Distrito Federal'],['es','Espírito Santo'],['go','Goiás'],['ma','Maranhão'],['mg','Minas Gerais'],['ms','Mato Grosso do Sul'],['mt','Mato Grosso'],['pa','Pará'],['pb','Paraíba'],['pe','Pernambuco'],['pi','Piauí'],['pr','Paraná'],['rj','Rio de Janeiro'],['rn','Rio Grande do Norte'],['ro','Rondônia'],['rr','Roraima'],['rs','Rio Grande do Sul'],['sc','Santa Catarina'],['se','Sergipe'],['sp','São Paulo'],['to','Tocantins']];
  const PERFIS = [['candidato','Candidato(a)'],['campanha','Equipe de campanha / partido'],['imprensa','Imprensa'],['pesquisa','Pesquisa / academia'],['orgao_publico','Órgão público'],['cidadao','Cidadão(ã)'],['outro','Outro']];

  let ME = { logado: false };
  let CONFIG = null;
  let readyResolve; const ready = new Promise(r => { readyResolve = r; });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtData = ts => ts ? new Date(ts * 1000).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';

  async function api(path, { method = 'GET', body } = {}) {
    const init = { method, credentials: 'include', headers: {} };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    let r;
    try { r = await fetch(API_BASE + path, init); }
    catch (e) { const err = new Error('Sem conexão com o servidor. Tente de novo.'); err.rede = true; throw err; }
    const ct = r.headers.get('Content-Type') || '';
    const data = ct.includes('json') ? await r.json().catch(() => ({})) : await r.blob();
    if (!r.ok) { const err = new Error((data && data.error) || ('Erro ' + r.status)); err.status = r.status; err.data = data; throw err; }
    return data;
  }

  function setMe(m) {
    const antes = ME && ME.logado ? ME.plano : 'anon';
    ME = m && m.logado ? m : { logado: false };
    const depois = ME.logado ? ME.plano : 'anon';
    renderHeader();
    if (document.body.dataset.view === 'conta') renderConta();
    if (antes !== depois) global.dispatchEvent(new CustomEvent('cmv:plano', { detail: { antes, depois } }));
  }
  async function refresh() {
    try { setMe(await api('/me')); } catch (e) { if (!e.rede) setMe(null); }
    return ME;
  }

  /* ---------------- estilos ---------------- */
  const css = `
  .cmv-entrar{display:inline-flex;align-items:center;min-height:36px;padding:6px 14px;border-radius:999px;border:1px solid rgba(96,165,250,.45);background:transparent;color:#BFDBFE;font:inherit;font-size:.86rem;font-weight:600;cursor:pointer;white-space:nowrap;text-decoration:none;margin-right:6px}
  .cmv-entrar:hover{background:rgba(96,165,250,.12)}
  .cmv-entrar .cmv-badge{margin-left:6px;font-size:.66rem;padding:1px 7px;border-radius:999px;background:rgba(34,197,94,.18);color:#86EFAC;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
  .cmv-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px}
  .cmv-modal[hidden]{display:none}
  .cmv-modal .cmv-back{position:absolute;inset:0;background:rgba(2,6,23,.72)}
  .cmv-modal .cmv-box{position:relative;width:100%;max-width:440px;max-height:92vh;overflow:auto;background:#1e293b;border:1px solid rgba(148,163,184,.25);border-radius:16px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.5);color:#f8fafc}
  .cmv-box h2{margin:0 0 6px;font-size:1.2rem;color:#f8fafc}.cmv-box p{color:#cbd5e1;font-size:.92rem;line-height:1.45;margin:6px 0 12px}
  .cmv-x{position:absolute;top:10px;right:12px;background:none;border:0;color:#94a3b8;font-size:1.5rem;cursor:pointer;line-height:1}
  .cmv-tabs{display:flex;gap:6px;margin:4px 0 14px}.cmv-tabs button{flex:1;padding:8px;border-radius:10px;border:1px solid rgba(148,163,184,.3);background:transparent;color:#cbd5e1;font:inherit;cursor:pointer}
  .cmv-tabs button[aria-selected=true]{background:rgba(56,189,248,.15);border-color:#38bdf8;color:#f8fafc;font-weight:700}
  .cmv-f{display:grid;gap:10px}.cmv-f label{display:grid;gap:4px;font-size:.84rem;color:#cbd5e1}
  .cmv-f input,.cmv-f select{padding:10px 12px;border-radius:10px;border:1px solid rgba(148,163,184,.35);background:#0f172a;color:#f8fafc;font:inherit;font-size:1rem}
  .cmv-f .cmv-chk{display:flex;gap:8px;align-items:flex-start;font-size:.82rem}.cmv-f .cmv-chk input{margin-top:3px}
  .cmv-f .cmv-codigo{font-size:1.6rem;letter-spacing:.4em;text-align:center;font-family:ui-monospace,monospace}
  .cmv-btn{display:inline-flex;justify-content:center;align-items:center;padding:11px 16px;border-radius:10px;border:0;background:#22c55e;color:#052e16;font:inherit;font-weight:700;cursor:pointer;text-decoration:none}
  .cmv-btn[disabled]{opacity:.6;cursor:wait}.cmv-btn.sec{background:transparent;border:1px solid rgba(148,163,184,.4);color:#e2e8f0}.cmv-btn.perigo{background:#ef4444;color:#fff}
  .cmv-msg{font-size:.86rem;margin:4px 0;min-height:1.2em}.cmv-msg.erro{color:#fca5a5}.cmv-msg.ok{color:#86efac}
  .cmv-link{background:none;border:0;color:#7dd3fc;cursor:pointer;font:inherit;font-size:.84rem;padding:0;text-decoration:underline}
  .cmv-paywall{border:1px dashed rgba(250,204,21,.45);background:rgba(250,204,21,.06);border-radius:12px;padding:12px 14px;margin:8px 0;color:#fde68a;font-size:.88rem;line-height:1.45}
  .cmv-paywall .cmv-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.cmv-paywall .cmv-btn{padding:7px 12px;font-size:.84rem}
  .cmv-conta{max-width:760px;margin:0 auto;display:grid;gap:16px}.cmv-conta .card h2{margin-bottom:8px}
  .cmv-uso{height:10px;border-radius:999px;background:rgba(148,163,184,.2);overflow:hidden;margin:6px 0}.cmv-uso>div{height:100%;background:#38bdf8}
  .cmv-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:.92rem}.cmv-kv dt{color:#94a3b8}.cmv-kv dd{margin:0}
  .cmv-acoes{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
  @media (max-width:480px){.cmv-entrar{padding:6px 10px;font-size:.8rem}}`;
  function injectCss() { const s = document.createElement('style'); s.id = 'cmv-css'; s.textContent = css; document.head.appendChild(s); }

  /* ---------------- cabeçalho ---------------- */
  function renderHeader() {
    let b = document.getElementById('cmv-entrar');
    if (!b) {
      const cta = document.querySelector('.site-header .btn-cta');
      if (!cta) return;
      b = document.createElement('a'); b.id = 'cmv-entrar'; b.className = 'cmv-entrar'; b.href = '#conta';
      b.addEventListener('click', ev => { if (!ME.logado) { ev.preventDefault(); abrirLogin(); } });
      cta.parentNode.insertBefore(b, cta);
      const dr = document.querySelector('#nav-drawer .drawer-panel');
      if (dr) {
        const h = document.createElement('h3'); h.textContent = 'Sua conta';
        const a = document.createElement('a'); a.id = 'cmv-drawer-conta'; a.href = '#conta'; a.dataset.view = 'conta';
        a.addEventListener('click', ev => { if (!ME.logado) { ev.preventDefault(); abrirLogin(); } });
        dr.appendChild(h); dr.appendChild(a);
      }
    }
    if (ME.logado) {
      const nome = (ME.usuario.nome || '').split(' ')[0] || 'Conta';
      b.innerHTML = esc(nome) + (ME.plano === 'pro' ? '<span class="cmv-badge">Assinante</span>' : '');
      b.title = 'Minha conta';
    } else { b.textContent = 'Entrar'; b.title = 'Entrar ou criar conta grátis'; }
    const d = document.getElementById('cmv-drawer-conta');
    if (d) d.textContent = ME.logado ? 'Minha conta' : 'Entrar / criar conta';
  }

  /* ---------------- modal genérico ---------------- */
  function modal(html, { onClose } = {}) {
    fecharModal();
    const m = document.createElement('div'); m.className = 'cmv-modal'; m.id = 'cmv-modal';
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="cmv-back"></div><div class="cmv-box"><button type="button" class="cmv-x" aria-label="Fechar">×</button>' + html + '</div>';
    const close = () => { m.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    m.querySelector('.cmv-back').addEventListener('click', close);
    m.querySelector('.cmv-x').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    m._close = close;
    document.body.appendChild(m);
    const f = m.querySelector('input,select,button.cmv-btn'); if (f) setTimeout(() => f.focus(), 30);
    return m;
  }
  function fecharModal() { const m = document.getElementById('cmv-modal'); if (m && m._close) m._close(); }

  /* ---------------- Turnstile (só se o servidor exigir) ---------------- */
  async function cfg() { if (!CONFIG) { try { CONFIG = await api('/config'); } catch (_) { CONFIG = { turnstile_sitekey: /(^|\.)cademeuvoto\.com\.br$/.test(location.hostname) ? TURNSTILE_SITEKEY : '' }; } } return CONFIG; }
  let tsLoad = null;
  function loadTurnstile() {
    if (!tsLoad) tsLoad = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
      s.onload = () => res(global.turnstile); s.onerror = () => rej(new Error('Turnstile indisponível')); document.head.appendChild(s);
    });
    return tsLoad;
  }
  async function montarTurnstile(slot) {
    const c = await cfg();
    if (!c.turnstile_sitekey) return () => null;
    const ts = await loadTurnstile();
    let token = null;
    const id = ts.render(slot, { sitekey: c.turnstile_sitekey, language: 'pt-br', callback: t => { token = t; }, 'expired-callback': () => { token = null; } });
    return () => { const t = token; token = null; try { ts.reset(id); } catch (_) {} return t; };
  }

  /* ---------------- login / cadastro ---------------- */
  let pendentes = [];
  function abrirLogin(opts = {}) {
    return new Promise(resolve => {
      pendentes.push(resolve);
      const ufAtual = String(global.CURRENT_UF || 'se').toLowerCase();
      const m = modal(`
        <h2>${esc(opts.titulo || 'Entre no Cadê Meu Voto')}</h2>
        <p>${esc(opts.texto || 'Sem senha: enviamos um código de 6 dígitos para o seu e-mail.')}</p>
        <div class="cmv-tabs" role="tablist">
          <button type="button" role="tab" data-tab="entrar" aria-selected="${opts.cadastro ? 'false' : 'true'}">Já tenho conta</button>
          <button type="button" role="tab" data-tab="cadastro" aria-selected="${opts.cadastro ? 'true' : 'false'}">Criar conta grátis</button>
        </div>
        <form class="cmv-f" data-form="entrar" ${opts.cadastro ? 'hidden' : ''} novalidate>
          <label>E-mail<input type="email" name="email" autocomplete="email" required inputmode="email"></label>
          <div class="cmv-ts"></div>
          <button class="cmv-btn" type="submit">Receber código</button>
          <div class="cmv-msg" aria-live="polite"></div>
        </form>
        <form class="cmv-f" data-form="cadastro" ${opts.cadastro ? '' : 'hidden'} novalidate>
          <label>Nome<input name="nome" autocomplete="name" required maxlength="120"></label>
          <label>E-mail<input type="email" name="email" autocomplete="email" required inputmode="email"></label>
          <label>WhatsApp (opcional)<input name="telefone" autocomplete="tel" inputmode="tel" maxlength="30" placeholder="(79) 99999-0000"></label>
          <label>Cidade<input name="cidade" autocomplete="address-level2" maxlength="80"></label>
          <label>Estado (UF)<select name="uf" required>${UFS.map(([c, n]) => `<option value="${c}"${c === ufAtual ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>Perfil<select name="perfil" required><option value="">Escolha…</option>${PERFIS.map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}</select></label>
          <label class="cmv-chk"><input type="checkbox" name="aceite_termos"> <span>Li e aceito os <a href="#termos" target="_blank">Termos de uso</a> e a <a href="#privacidade" target="_blank">Política de Privacidade</a>.</span></label>
          <label class="cmv-chk"><input type="checkbox" name="optin_novidades"> <span>Quero receber novidades por e-mail (opcional).</span></label>
          <div class="cmv-ts"></div>
          <button class="cmv-btn" type="submit">Criar conta e receber código</button>
          <div class="cmv-msg" aria-live="polite"></div>
        </form>
        <form class="cmv-f" data-form="codigo" hidden novalidate>
          <p class="cmv-para"></p>
          <label>Código de 6 dígitos<input class="cmv-codigo" name="codigo" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" required></label>
          <button class="cmv-btn" type="submit">Entrar</button>
          <div class="cmv-msg" aria-live="polite"></div>
          <div><button type="button" class="cmv-link" data-reenviar disabled>Reenviar código</button> · <button type="button" class="cmv-link" data-trocar>Usar outro e-mail</button></div>
        </form>`, { onClose: () => { const p = pendentes; pendentes = []; p.forEach(r => r(ME.logado)); } });
      const forms = { entrar: m.querySelector('[data-form=entrar]'), cadastro: m.querySelector('[data-form=cadastro]'), codigo: m.querySelector('[data-form=codigo]') };
      const tsGet = {};
      const show = which => {
        for (const [k, f] of Object.entries(forms)) f.hidden = k !== which;
        m.querySelectorAll('.cmv-tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === which ? 'true' : 'false'));
        m.querySelector('.cmv-tabs').hidden = which === 'codigo';
        if (which !== 'codigo' && !tsGet[which]) montarTurnstile(forms[which].querySelector('.cmv-ts')).then(g => { tsGet[which] = g; }).catch(() => {});
        const f = forms[which].querySelector('input:not([type=checkbox]),select'); if (f) setTimeout(() => f.focus(), 30);
      };
      m.querySelectorAll('.cmv-tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
      let emailAtual = '', origem = 'entrar', timer = null;
      const msg = (f, t, cls) => { const e = f.querySelector('.cmv-msg'); e.textContent = t || ''; e.className = 'cmv-msg' + (cls ? ' ' + cls : ''); };
      const cooldown = (s) => {
        const b = forms.codigo.querySelector('[data-reenviar]'); let n = s; b.disabled = true;
        clearInterval(timer); b.textContent = `Reenviar código (${n}s)`;
        timer = setInterval(() => { n--; if (n <= 0) { clearInterval(timer); b.disabled = false; b.textContent = 'Reenviar código'; } else b.textContent = `Reenviar código (${n}s)`; }, 1000);
      };
      const irCodigo = (email) => {
        emailAtual = email;
        forms.codigo.querySelector('.cmv-para').innerHTML = `Enviamos um código para <strong>${esc(email)}</strong>. Ele vale por 10 minutos. Não chegou? Veja Spam e Promoções.`;
        show('codigo'); cooldown(60);
      };
      forms.entrar.addEventListener('submit', async ev => {
        ev.preventDefault();
        const f = forms.entrar, btn = f.querySelector('button[type=submit]');
        const email = f.email.value.trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) return msg(f, 'Informe um e-mail válido.', 'erro');
        btn.disabled = true; msg(f, 'Enviando…');
        try { await api('/auth/codigo', { method: 'POST', body: { email, turnstile: tsGet.entrar ? tsGet.entrar() : null } }); origem = 'entrar'; irCodigo(email); msg(f, ''); }
        catch (e) { msg(f, e.message, 'erro'); }
        finally { btn.disabled = false; }
      });
      forms.cadastro.addEventListener('submit', async ev => {
        ev.preventDefault();
        const f = forms.cadastro, btn = f.querySelector('button[type=submit]');
        const body = { nome: f.nome.value.trim(), email: f.email.value.trim().toLowerCase(), telefone: f.telefone.value.trim(), cidade: f.cidade.value.trim(),
          uf: f.uf.value, perfil: f.perfil.value, aceite_termos: f.aceite_termos.checked, optin_novidades: f.optin_novidades.checked };
        if (!body.aceite_termos) return msg(f, 'Para criar a conta, aceite os Termos e a Política de Privacidade.', 'erro');
        body.turnstile = tsGet.cadastro ? tsGet.cadastro() : null;
        btn.disabled = true; msg(f, 'Enviando…');
        try { await api('/auth/cadastro', { method: 'POST', body }); origem = 'cadastro'; irCodigo(body.email); msg(f, ''); }
        catch (e) { msg(f, e.message, 'erro'); }
        finally { btn.disabled = false; }
      });
      forms.codigo.addEventListener('submit', async ev => {
        ev.preventDefault();
        const f = forms.codigo, btn = f.querySelector('button[type=submit]');
        const codigo = f.codigo.value.replace(/\D/g, '');
        if (codigo.length !== 6) return msg(f, 'Digite os 6 dígitos.', 'erro');
        btn.disabled = true; msg(f, 'Conferindo…');
        try { const me = await api('/auth/verificar', { method: 'POST', body: { email: emailAtual, codigo } }); setMe(me); msg(f, 'Pronto!', 'ok'); setTimeout(() => m._close(), 250); }
        catch (e) { msg(f, e.message, 'erro'); f.codigo.select(); }
        finally { btn.disabled = false; }
      });
      forms.codigo.codigo.addEventListener('input', e => { if (e.target.value.replace(/\D/g, '').length === 6) forms.codigo.requestSubmit(); });
      forms.codigo.querySelector('[data-reenviar]').addEventListener('click', async () => {
        try { await api('/auth/codigo', { method: 'POST', body: { email: emailAtual, turnstile: null } }); msg(forms.codigo, 'Novo código enviado.', 'ok'); cooldown(60); }
        catch (e) { msg(forms.codigo, e.message, 'erro'); if (e.data && e.data.aguarde) cooldown(e.data.aguarde); }
      });
      forms.codigo.querySelector('[data-trocar]').addEventListener('click', () => show(origem));
      show(opts.cadastro ? 'cadastro' : 'entrar');
    });
  }
  async function requireLogin(opts) {
    await ready;
    if (ME.logado) return true;
    return abrirLogin(opts || { titulo: 'Entre para continuar', texto: 'É grátis. Sem senha: enviamos um código de 6 dígitos para o seu e-mail.' });
  }

  /* ---------------- paywall ---------------- */
  const TXT = {
    nivel: 'O detalhe por zona, bairro, local de votação e seção é exclusivo da Assinatura.',
    excel: 'A planilha em Excel é exclusiva da Assinatura.',
    cota: 'Você usou os relatórios grátis deste mês.',
    plano: 'O detalhe por local de votação e por seção é exclusivo da Assinatura.',
    login: 'Entre na sua conta (grátis) para continuar.',
    'chat-limite': 'Você chegou ao limite de perguntas do assistente.',
  };
  function paywall(motivo, mensagem) {
    if (motivo === 'login' && !ME.logado) return requireLogin();
    const m = modal(`<h2>Assinatura Cadê Meu Voto</h2><p>${esc(mensagem || TXT[motivo] || TXT.nivel)}</p>
      <p>Na <strong>Assinatura (R$ 49,90/mês)</strong>: mapa completo até a seção eleitoral, 50 relatórios por mês sem marca-d’água, Excel e assistente com detalhe completo.</p>
      <div class="cmv-acoes"><a class="cmv-btn" href="#planos" data-ir-planos>Ver planos</a>${ME.logado ? '' : '<button type="button" class="cmv-btn sec" data-entrar>Já sou assinante: entrar</button>'}</div>`);
    m.querySelector('[data-ir-planos]').addEventListener('click', () => m._close());
    const e = m.querySelector('[data-entrar]'); if (e) e.addEventListener('click', () => { m._close(); abrirLogin(); });
    return Promise.resolve(false);
  }
  function paywallBox(motivo, texto) {
    const d = document.createElement('div'); d.className = 'cmv-paywall';
    d.innerHTML = `${esc(texto || TXT[motivo] || TXT.nivel)}<div class="cmv-acts"><a class="cmv-btn" href="#planos">Conhecer a Assinatura</a>${ME.logado ? '' : '<button type="button" class="cmv-btn sec">Entrar</button>'}</div>`;
    const b = d.querySelector('button'); if (b) b.addEventListener('click', () => abrirLogin());
    return d;
  }

  /* ---------------- dados privados ---------------- */
  function isPrivate(p) { return PRIV_RE.test(String(p || '')); }
  async function getPrivate(p) {
    const r = await fetch(API_BASE + '/dados/' + String(p).replace(/^\/+/, ''), { credentials: 'include' });
    if (r.status === 401 || r.status === 402) { const d = await r.json().catch(() => ({})); const e = new Error(d.error || 'Exclusivo da Assinatura'); e.status = r.status; e.paywall = d.motivo || 'plano'; throw e; }
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }

  /* ---------------- relatórios (cota) ---------------- */
  function specParaApi(s, formatos) {
    let t = s.template || 'resumo';
    if (t === 'custom') t = (s.a && s.b) ? 'comparar' : ((s.numero || s.n || s.a) ? 'candidato' : (s.cd || s.mun ? 'municipio' : 'resumo'));
    const alvo = t === 'comparar' ? [String(s.a || ''), String(s.b || '')] : t === 'candidato' ? String(s.numero || s.n || s.a || '') : t === 'municipio' ? String(s.cd || s.mun || '') : null;
    const secoes = !(s.options && s.options.secoes === false);
    return { tipo: t, uf: String(global.CURRENT_UF || 'se').toLowerCase(), cargo: String(s.cargo || s.c || '0'), alvo,
      nivel: pro() ? (secoes && t !== 'resumo' ? 'secao' : 'local') : 'municipio', formatos: formatos || ['pdf'], origem: s.origem === 'chat' ? 'chat' : 'botao' };
  }
  async function iniciarRelatorio(spec, formatos) {
    const ok = await requireLogin({ titulo: 'Entre para gerar o relatório', texto: 'É grátis: 2 relatórios por mês. Sem senha: enviamos um código de 6 dígitos para o seu e-mail.' });
    if (!ok) { const e = new Error('É preciso entrar para gerar relatórios.'); e.cancelado = true; throw e; }
    try {
      const r = await api('/relatorios/iniciar', { method: 'POST', body: specParaApi(spec, formatos) });
      refresh();
      return r;
    } catch (e) {
      if (e.status === 401) { setMe(null); return iniciarRelatorio(spec, formatos); }
      if (e.status === 402) { paywall(e.data && e.data.motivo, e.message); e.cancelado = true; }
      throw e;
    }
  }
  const concluir = id => id && api(`/relatorios/${id}/concluir`, { method: 'POST', body: {} }).catch(() => {});
  const falhou = id => id && api(`/relatorios/${id}/falhou`, { method: 'POST', body: {} }).then(() => refresh()).catch(() => {});

  /* ---------------- Excel (carrega SheetJS só quando preciso) ---------------- */
  let xlsxP = null;
  function loadXlsx() {
    if (global.XLSX) return Promise.resolve(global.XLSX);
    if (!xlsxP) xlsxP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/xlsx.full.min.js?v=0.20.3'; s.onload = () => res(global.XLSX); s.onerror = () => { xlsxP = null; rej(new Error('Falha ao carregar o gerador de Excel.')); }; document.head.appendChild(s); });
    return xlsxP;
  }

  /* ---------------- página "Minha conta" ---------------- */
  function ensureContaView() {
    let v = document.getElementById('view-conta');
    if (!v) {
      v = document.createElement('section'); v.className = 'view'; v.id = 'view-conta';
      const root = document.getElementById('views-root') || document.querySelector('main');
      root.appendChild(v);
    }
    return v;
  }
  async function renderConta() {
    const v = ensureContaView();
    if (!ME.logado) {
      v.innerHTML = `<div class="page-head center"><div class="eyebrow">Conta</div><h1>Minha conta</h1><p>Entre para ver seus relatórios, seu plano e seus dados.</p></div>
        <div class="cmv-conta"><div class="card"><button type="button" class="cmv-btn" data-entrar>Entrar ou criar conta grátis</button></div></div>`;
      v.querySelector('[data-entrar]').addEventListener('click', () => abrirLogin());
      return;
    }
    const u = ME.usuario, r = ME.relatorios, a = ME.assinatura;
    const pct = r.limite ? Math.min(100, Math.round(100 * r.usados / r.limite)) : 0;
    const planoTxt = ME.plano === 'pro' ? (ME.origem === 'cortesia' ? 'Assinatura (cortesia até ' + fmtData(ME.cortesia_ate) + ')' : 'Assinatura') : 'Gratuito';
    let assTxt = '';
    if (a && ME.origem === 'assinatura') {
      if (a.em_tolerancia) assTxt = `<p class="cmv-msg erro">Não conseguimos cobrar sua assinatura. Atualize o pagamento até ${fmtData(a.tolerancia_ate)} para não perder o acesso.</p>`;
      else if (a.cancelar_no_fim) assTxt = `<p>Sua assinatura foi cancelada e continua ativa até ${fmtData(a.periodo_fim)}.</p>`;
      else assTxt = `<p>Próxima renovação: ${fmtData(a.periodo_fim)}.</p>`;
    }
    v.innerHTML = `<div class="page-head center"><div class="eyebrow">Conta</div><h1>Minha conta</h1><p>Olá, ${esc(u.nome.split(' ')[0])}!</p></div>
    <div class="cmv-conta">
      <div class="card"><h2>Seu plano: ${esc(planoTxt)}</h2>
        <div>Relatórios ${ME.plano === 'pro' && ME.origem === 'assinatura' ? 'neste ciclo' : 'neste mês'}: <strong>${r.usados} de ${r.limite}</strong> · renova em ${fmtData(r.renova_em)}</div>
        <div class="cmv-uso" aria-hidden="true"><div style="width:${pct}%"></div></div>
        <div>Assistente: até ${ME.chat.hora} perguntas por hora e ${ME.chat.dia} por dia${ME.chat.nivel === 'municipio' ? ' (dados por município)' : ' (detalhe completo)'}.</div>
        ${assTxt}
        <div class="cmv-acoes">${ME.plano === 'pro' && ME.origem === 'assinatura' ? '<button type="button" class="cmv-btn sec" data-portal>Gerenciar assinatura</button>' : (ME.plano !== 'pro' ? '<button type="button" class="cmv-btn" data-assinar>Assinar por R$ 49,90/mês</button>' : '')}</div>
        <div class="cmv-msg" data-msg-plano aria-live="polite"></div>
      </div>
      <div class="card"><h2>Seus dados</h2>
        <form class="cmv-f" data-form="dados" novalidate>
          <label>Nome<input name="nome" value="${esc(u.nome)}" maxlength="120" autocomplete="name"></label>
          <label>E-mail<input value="${esc(u.email)}" disabled></label>
          <label>WhatsApp (opcional)<input name="telefone" value="${esc(u.telefone || '')}" maxlength="30" inputmode="tel"></label>
          <label>Cidade<input name="cidade" value="${esc(u.cidade || '')}" maxlength="80"></label>
          <label>Estado (UF)<select name="uf">${UFS.map(([c, n]) => `<option value="${c}"${c === u.uf ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>Perfil<select name="perfil">${PERFIS.map(([c, n]) => `<option value="${c}"${c === u.perfil ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="cmv-chk"><input type="checkbox" name="optin_novidades"${u.optin_novidades ? ' checked' : ''}> <span>Quero receber novidades por e-mail.</span></label>
          <button class="cmv-btn" type="submit">Salvar alterações</button>
          <div class="cmv-msg" aria-live="polite"></div>
        </form>
        <p style="font-size:.82rem">Para trocar o e-mail, escreva para acesso@cademeuvoto.com.br.</p>
      </div>
      <div class="card"><h2>Privacidade (LGPD)</h2>
        <p>Você pode baixar uma cópia dos seus dados ou excluir sua conta a qualquer momento.</p>
        <div class="cmv-acoes"><button type="button" class="cmv-btn sec" data-exportar>Baixar meus dados</button><button type="button" class="cmv-btn sec" data-sair>Sair</button><button type="button" class="cmv-btn sec" data-sair-todos>Sair de todos os aparelhos</button><button type="button" class="cmv-btn perigo" data-excluir>Excluir minha conta</button></div>
        <div class="cmv-msg" data-msg-priv aria-live="polite"></div>
      </div>
    </div>`;
    const fd = v.querySelector('[data-form=dados]');
    fd.addEventListener('submit', async ev => {
      ev.preventDefault();
      const m = fd.querySelector('.cmv-msg');
      try {
        setMe(await api('/conta', { method: 'PATCH', body: { nome: fd.nome.value, telefone: fd.telefone.value, cidade: fd.cidade.value, uf: fd.uf.value, perfil: fd.perfil.value, optin_novidades: fd.optin_novidades.checked } }));
        const m2 = document.querySelector('#view-conta [data-form=dados] .cmv-msg'); if (m2) { m2.textContent = 'Dados salvos.'; m2.className = 'cmv-msg ok'; }
      } catch (e) { m.textContent = e.message; m.className = 'cmv-msg erro'; }
    });
    const msgPlano = v.querySelector('[data-msg-plano]'), msgPriv = v.querySelector('[data-msg-priv]');
    const as = v.querySelector('[data-assinar]');
    if (as) as.addEventListener('click', () => assinar(msgPlano));
    const po = v.querySelector('[data-portal]');
    if (po) po.addEventListener('click', async () => { try { location.href = (await api('/stripe/portal', { method: 'POST', body: {} })).url; } catch (e) { msgPlano.textContent = e.message; msgPlano.className = 'cmv-msg erro'; } });
    v.querySelector('[data-exportar]').addEventListener('click', async () => {
      try { const dados = await api('/conta/dados'); const blob = dados instanceof Blob ? dados : new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
        if (global.CMV_PWA) await global.CMV_PWA.salvar(blob, 'meus-dados-cademeuvoto.json');
        else { const url = URL.createObjectURL(blob); const a2 = document.createElement('a'); a2.href = url; a2.download = 'meus-dados-cademeuvoto.json'; document.body.appendChild(a2); a2.click(); a2.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); } }
      catch (e) { msgPriv.textContent = e.message; msgPriv.className = 'cmv-msg erro'; }
    });
    v.querySelector('[data-sair]').addEventListener('click', sair);
    v.querySelector('[data-sair-todos]').addEventListener('click', async () => { await api('/auth/sair-todos', { method: 'POST', body: {} }).catch(() => {}); setMe(null); });
    v.querySelector('[data-excluir]').addEventListener('click', excluirConta);
  }
  async function assinar(msgEl) {
    const ok = await requireLogin({ titulo: 'Entre para assinar', texto: 'Crie sua conta grátis ou entre com seu e-mail.' });
    if (!ok) return;
    try { location.href = (await api('/stripe/checkout', { method: 'POST', body: {} })).url; }
    catch (e) {
      if (e.data && e.data.motivo === 'stripe-desligado') {
        const m = modal(`<h2>Assinatura</h2><p>A assinatura on-line abre em breve. Deixe seu contato que liberamos seu acesso.</p><div class="cmv-acoes"><a class="cmv-btn" href="#planos-contato" data-ok>Falar com a equipe</a></div>`);
        m.querySelector('[data-ok]').addEventListener('click', () => m._close());
      } else if (msgEl) { msgEl.textContent = e.message; msgEl.className = 'cmv-msg erro'; }
      else paywall('plano', e.message);
    }
  }
  async function sair() { await api('/auth/sair', { method: 'POST', body: {} }).catch(() => {}); setMe(null); }
  function excluirConta() {
    const m = modal(`<h2>Excluir conta</h2><p>Isso apaga seus dados pessoais e encerra sua assinatura, se houver. Não dá para desfazer.</p>
      <form class="cmv-f" novalidate><button type="button" class="cmv-btn perigo" data-pedir>Enviar código de confirmação</button>
      <label hidden>Código recebido por e-mail<input class="cmv-codigo" name="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>
      <button class="cmv-btn perigo" type="submit" hidden>Excluir definitivamente</button><div class="cmv-msg" aria-live="polite"></div></form>`);
    const f = m.querySelector('form'), msg = f.querySelector('.cmv-msg');
    f.querySelector('[data-pedir]').addEventListener('click', async ev => {
      try { await api('/conta/excluir/codigo', { method: 'POST', body: {} }); ev.target.hidden = true; f.querySelector('label').hidden = false; f.querySelector('[type=submit]').hidden = false; msg.textContent = 'Código enviado para o seu e-mail.'; msg.className = 'cmv-msg ok'; }
      catch (e) { msg.textContent = e.message; msg.className = 'cmv-msg erro'; }
    });
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      try { await api('/conta/excluir', { method: 'POST', body: { codigo: f.codigo.value } }); m._close(); setMe(null); location.hash = '#inicio'; alert('Sua conta foi excluída.'); }
      catch (e) { msg.textContent = e.message; msg.className = 'cmv-msg erro'; }
    });
  }

  /* ---------------- planos ---------------- */
  function wirePlanos() {
    document.querySelectorAll('[data-assinar-plano]').forEach(b => b.addEventListener('click', ev => { ev.preventDefault(); assinar(); }));
  }

  /* ---------------- início ---------------- */
  function pro() { return !!(ME.logado && ME.plano === 'pro'); }
  function boot() {
    injectCss(); renderHeader(); wirePlanos();
    refresh().finally(() => readyResolve());
    if (/assinatura=ok/.test(location.hash)) setTimeout(refresh, 2500); // webhook pode chegar depois do retorno
    global.addEventListener('hashchange', () => { if ((location.hash || '').startsWith('#conta')) renderConta(); });
  }
  global.CMV = {
    API_BASE, ready, refresh, api, pro, me: () => ME, logado: () => !!ME.logado,
    marcaDagua: () => !pro(), licenciadoPara: () => (pro() ? ME.usuario.nome : null),
    isPrivate, getPrivate, requireLogin, abrirLogin, paywall, paywallBox, iniciarRelatorio, concluir, falhou, loadXlsx, renderConta, assinar, sair,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
