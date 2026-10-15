// Testes ponta a ponta da API local (wrangler dev + D1/R2/KV locais + e-mail mock). Uso: node test/api.test.mjs
import Stripe from 'stripe';
import fs from 'node:fs';
const API = process.env.API || 'http://127.0.0.1:8787';
const ORIGIN = 'http://localhost:8080';
const ADMIN_TOKEN = (fs.readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/^ADMIN_TOKEN=(.*)$/m) || [])[1];
const WHSEC = 'whsec_local_test';
const RUN = Date.now().toString(36);
const results = [];
let falhas = 0;
function check(nome, cond, info) {
  results.push({ nome, ok: !!cond, info: cond ? undefined : info });
  if (!cond) falhas++;
  console.log(`${cond ? '✔' : '✘'} ${nome}${cond ? '' : '  → ' + JSON.stringify(info)}`);
}
const rnd = () => Math.floor(Math.random() * 250) + 1;
class Cliente {
  constructor(ip) { this.cookie = null; this.setCookieRaw = null; this.ip = ip || `10.${rnd()}.${rnd()}.${rnd()}`; }
  async req(method, path, body, { origin = ORIGIN, headers = {} } = {}) {
    const h = { 'CF-Connecting-IP': this.ip, ...headers };
    if (origin) h.Origin = origin;
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const r = await fetch(API + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) { this.setCookieRaw = sc; const v = sc.split(';')[0]; this.cookie = /=$/.test(v) || /Max-Age=0/.test(sc) ? null : v; }
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = txt; }
    return { status: r.status, body: j, headers: r.headers };
  }
}
const outbox = async to => (await (await fetch(`${API}/__dev/outbox?to=${encodeURIComponent(to)}`)).json()).emails;
const ultimoCodigo = async to => { const e = await outbox(to); const m = e.length && e[e.length - 1].text.match(/\b(\d{6})\b/); return m && m[1]; };
const email = n => `${n}-${RUN}@teste.local`;
const cad = (nome, em) => ({ nome, email: em, uf: 'se', perfil: 'candidato', telefone: '(79) 99999-0000', cidade: 'Aracaju', aceite_termos: true });

async function entrar(nome, em) {
  const c = new Cliente();
  const r = await c.req('POST', '/auth/cadastro', cad(nome, em));
  if (r.status !== 200) throw new Error('cadastro ' + r.status + ' ' + JSON.stringify(r.body));
  const v = await c.req('POST', '/auth/verificar', { email: em, codigo: await ultimoCodigo(em) });
  if (v.status !== 200) throw new Error('verificar ' + v.status + JSON.stringify(v.body));
  c.me = v.body;
  return c;
}

// ---------------- básicos / CSRF
{
  const a = new Cliente();
  check('GET / responde', (await a.req('GET', '/')).status === 200);
  const cfg = await a.req('GET', '/config');
  check('GET /config sem sitekey em dev, stripe desligado', cfg.status === 200 && cfg.body.stripe === false);
  const opt = await fetch(API + '/auth/codigo', { method: 'OPTIONS', headers: { Origin: ORIGIN } });
  check('CORS preflight: origem exata + credenciais', opt.status === 204 && opt.headers.get('access-control-allow-origin') === ORIGIN && opt.headers.get('access-control-allow-credentials') === 'true');
  check('CSRF: POST sem Origin → 403', (await a.req('POST', '/auth/codigo', { email: 'x@y.com' }, { origin: null })).status === 403);
  check('CSRF: POST de origem estranha → 403', (await a.req('POST', '/auth/codigo', { email: 'x@y.com' }, { origin: 'https://evil.example' })).status === 403);
  const ct = await fetch(API + '/auth/codigo', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' }, body: '{"email":"x@y.com"}' });
  check('CSRF: corpo não-JSON (text/plain) → 415', ct.status === 415);
  check('/me sem sessão → logado:false', (await a.req('GET', '/me')).body.logado === false);
}

// limite de cadastros por IP (5/h)
{
  const ip = `10.250.${rnd()}.${rnd()}`;
  const st = [];
  for (let i = 0; i < 6; i++) st.push((await new Cliente(ip).req('POST', '/auth/cadastro', cad('Pessoa IP', email('ip' + i)))).status);
  check('limite de cadastro por IP: 6º na hora → 429', st.slice(0, 5).every(x => x === 200) && st[5] === 429, st);
}

// usuários cujo teste precisa esperar o intervalo de 60 s entre códigos
const emDel = email('excluir'), emLock = email('trava');
const del = await entrar('Pessoa Excluir', emDel);
const lockC = new Cliente();
await lockC.req('POST', '/auth/cadastro', cad('Pessoa Trava', emLock));
const tLento = Date.now();

// ---------------- cadastro e login
{
  const em = email('livre');
  const c = new Cliente();
  const bad = await c.req('POST', '/auth/cadastro', { email: 'nao-e-email', nome: 'A' });
  check('cadastro inválido → 400 com lista de erros', bad.status === 400 && Array.isArray(bad.body.erros) && bad.body.erros.length >= 4, bad.body);
  const semTermos = await c.req('POST', '/auth/cadastro', { ...cad('Fulana', em), aceite_termos: false });
  check('cadastro sem aceitar termos → 400', semTermos.status === 400);
  const r = await c.req('POST', '/auth/cadastro', cad('Fulana de Tal', em));
  check('cadastro válido → 200', r.status === 200, r.body);
  const mails = await outbox(em);
  check('e-mail mock com código em pt-BR', mails.length === 1 && /^Seu código de acesso: \d{6}$/.test(mails[0].subject) && /vale por 10 minutos/.test(mails[0].text), mails[0]);
  const again = await c.req('POST', '/auth/cadastro', cad('Fulana de Tal', em));
  check('novo código antes de 60 s → 429', again.status === 429 && again.body.aguarde > 0, again.body);
  const codigo = await ultimoCodigo(em);
  const errado = String((Number(codigo) + 1) % 1000000).padStart(6, '0');
  const w = await c.req('POST', '/auth/verificar', { email: em, codigo: errado });
  check('código errado → 400 e restam 4', w.status === 400 && w.body.restantes === 4, w.body);
  const v = await c.req('POST', '/auth/verificar', { email: em, codigo });
  check('código certo → 200 e sessão', v.status === 200 && v.body.logado && v.body.plano === 'free', v.body);
  const sc = c.setCookieRaw || '';
  check('cookie __Host-cmv; Secure; HttpOnly; SameSite=Lax; Path=/; 30 dias', /^__Host-cmv=/.test(sc) && /Secure/.test(sc) && /HttpOnly/.test(sc) && /SameSite=Lax/.test(sc) && /Path=\//.test(sc) && /Max-Age=2592000/.test(sc) && !/Domain=/i.test(sc), sc);
  const reuse = await new Cliente().req('POST', '/auth/verificar', { email: em, codigo });
  check('código já usado não serve de novo', reuse.status === 400);
  const me = await c.req('GET', '/me');
  check('/me: grátis, 2 relatórios, assistente bloqueado (só na Assinatura)', me.body.plano === 'free' && me.body.relatorios.limite === 2 && me.body.chat.hora === 0 && me.body.chat.dia === 0 && me.body.chat.nivel === 'bloqueado' && me.body.recursos.marca_dagua === true && me.body.recursos.excel === false, me.body);
  // anti-enumeração
  const x = new Cliente();
  const r1 = await x.req('POST', '/auth/codigo', { email: email('naoexiste') });
  const r2 = await x.req('POST', '/auth/codigo', { email: email('livre2') });
  check('pedido de código: resposta idêntica p/ e-mail inexistente', r1.status === 200 && r2.status === 200 && r1.body.mensagem === r2.body.mensagem);
  check('e-mail inexistente não recebe nada', (await outbox(email('naoexiste'))).length === 0);
  // sair
  const s = await c.req('POST', '/auth/sair');
  check('sair → cookie apagado (Max-Age=0)', s.status === 200 && /Max-Age=0/.test(c.setCookieRaw));
}

// ---------------- cota de relatórios (grátis)
let free, freeId;
{
  free = await entrar('Usuário Grátis', email('gratis'));
  freeId = free.me.usuario.id;
  const base = { tipo: 'candidato', uf: 'se', cargo: '3', alvo: '55', nivel: 'municipio', formatos: ['pdf'] };
  const loc = await free.req('POST', '/relatorios/iniciar', { ...base, nivel: 'local' });
  check('grátis: nível local → 402', loc.status === 402 && loc.body.motivo === 'nivel');
  const xl = await free.req('POST', '/relatorios/iniciar', { ...base, formatos: ['pdf', 'xlsx'] });
  check('grátis: Excel → 402', xl.status === 402 && xl.body.motivo === 'excel');
  const r1 = await free.req('POST', '/relatorios/iniciar', base);
  check('grátis: 1º relatório → 200 (1/2) com marca d’água', r1.status === 200 && r1.body.usados === 1 && r1.body.marca_dagua === true && r1.body.licenciado_para === null, r1.body);
  const r1b = await free.req('POST', '/relatorios/iniciar', { ...base, formatos: ['pdf'] });
  check('mesmo relatório em 24 h não conta de novo', r1b.status === 200 && r1b.body.reaproveitado === true && r1b.body.usados === 1, r1b.body);
  await free.req('POST', `/relatorios/${r1.body.id}/concluir`);
  const cmp = await free.req('POST', '/relatorios/iniciar', { tipo: 'comparar', uf: 'se', cargo: '3', alvo: ['55', '10'], nivel: 'municipio' });
  check('grátis: comparação A×B municipal conta 1 → 200 (2/2)', cmp.status === 200 && cmp.body.usados === 2, cmp.body);
  const r3 = await free.req('POST', '/relatorios/iniciar', { ...base, alvo: '10' });
  check('grátis: 3º relatório → 402 cota', r3.status === 402 && r3.body.motivo === 'cota' && r3.body.usados === 2 && r3.body.renova_em > 0, r3.body);
  const f = await free.req('POST', `/relatorios/${cmp.body.id}/falhou`);
  check('falha em até 15 min devolve o crédito', f.body.estornado === true);
  const r4 = await free.req('POST', '/relatorios/iniciar', { ...base, alvo: '10' });
  check('após estorno, pode gerar de novo', r4.status === 200 && r4.body.usados === 2, r4.body);
  // atomicidade
  const par = await entrar('Usuário Paralelo', email('paralelo'));
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => par.req('POST', '/relatorios/iniciar', { ...base, alvo: String(100 + i) })));
  const oks = rs.filter(r => r.status === 200).length, neg = rs.filter(r => r.status === 402).length;
  check('atomicidade: 8 pedidos simultâneos → exatamente 2 aprovados', oks === 2 && neg === 6, rs.map(r => r.status));
  const lst = await free.req('GET', '/relatorios');
  check('GET /relatorios lista os do usuário', lst.status === 200 && lst.body.relatorios.length === 3, lst.body);
}

// ---------------- dados privados
{
  const anon = new Cliente();
  check('/dados sem login → 401', (await anon.req('GET', '/dados/mapa/3/55.json')).status === 401);
  check('/dados grátis → 402', (await free.req('GET', '/dados/mapa/3/55.json')).status === 402);
  check('/dados caminho fora da lista → 404', (await free.req('GET', '/dados/mapa/index.json')).status === 404);
  check('/dados com ../ → 404', (await free.req('GET', '/dados/mapa/../.dev.vars')).status === 404);
  check('/dados mapa/se/... (SE é raiz legada) → 404', (await free.req('GET', '/dados/mapa/se/3/55.json')).status === 404);
  // "Mais votados no seu bairro": votos por bairro de 2024/2026 com a mesma regra
  check('/dados m2024 top3 sem login → 401', (await anon.req('GET', '/dados/m2024/se/top3/31054.json')).status === 401);
  check('/dados m2024 top3 grátis → 402', (await free.req('GET', '/dados/m2024/se/top3/31054.json')).status === 402);
  check('/dados e2026 top3 grátis → 402', (await free.req('GET', '/dados/e2026/se/top3/31054.json')).status === 402);
  check('/dados m2024 det grátis → 402', (await free.req('GET', '/dados/m2024/se/det/31054/agg.json')).status === 402);
  check('/dados m2024 arquivo público (top3-livre) → 404', (await free.req('GET', '/dados/m2024/se/top3-livre/31054.json')).status === 404);
  check('/dados m2024 caminho estranho → 404', (await free.req('GET', '/dados/m2024/se/top3/../../x.json')).status === 404 && (await free.req('GET', '/dados/m2024/se/top3/3105.json')).status === 404);
}

// ---------------- admin + cortesia (usuário pago manual)
let pro, proId, admin;
{
  admin = await entrar('Admin Local', 'admin@teste.local').catch(async () => {
    // já existe de execução anterior: faz login
    const c = new Cliente(); await c.req('POST', '/auth/codigo', { email: 'admin@teste.local' });
    const v = await c.req('POST', '/auth/verificar', { email: 'admin@teste.local', codigo: await ultimoCodigo('admin@teste.local') }); c.me = v.body; return c;
  });
  check('admin reconhecido no /me', admin.me && admin.me.admin === true, admin.me);
  pro = await entrar('Maria Assinante', email('pago'));
  proId = pro.me.usuario.id;
  check('não-admin em /admin → 403', (await free.req('GET', '/admin/usuarios')).status === 403);
  const g = await admin.req('POST', `/admin/usuarios/${proId}/cortesia`, { dias: 30, motivo: 'teste local' });
  check('admin concede cortesia (30 dias)', g.status === 200 && g.body.cortesia_ate > 0, g.body);
  const me = await pro.req('GET', '/me');
  check('/me pago: plano pro (cortesia), 50 relatórios, chat 20/100 completo, Excel, sem marca', me.body.plano === 'pro' && me.body.origem === 'cortesia' && me.body.relatorios.limite === 50 && me.body.chat.hora === 20 && me.body.chat.dia === 100 && me.body.recursos.excel && !me.body.recursos.marca_dagua && me.body.recursos.licenciado_para === 'Maria Assinante', me.body);
  const d1 = await pro.req('GET', '/dados/mapa/3/55.json');
  check('/dados pago: candidato por local (SE raiz) → 200', d1.status === 200 && Array.isArray(d1.body.v) && /private/.test(d1.headers.get('cache-control')), d1.status);
  const d2 = await pro.req('GET', '/dados/mapa/geo-loc-se.json');
  check('/dados pago: geo-loc-se → 200 com locais', d2.status === 200 && d2.body.loc.length === 1251);
  const d3 = await pro.req('GET', '/dados/mapa/al/secao/secoes.json');
  check('/dados pago: seções AL → 200', d3.status === 200);
  const d4 = await pro.req('GET', '/dados/mapa/df/geo-loc-df.json');
  check('/dados pago: DF geo-loc (zonas + 622 locais) → 200', d4.status === 200 && d4.body.loc.length === 622 && d4.body.mun.length === 19);
  const d6 = await pro.req('GET', '/dados/m2024/se/top3/31054.json');
  check('/dados pago: m2024 top3 Aracaju → 200 com votos por bairro', d6.status === 200 && d6.body.cd === '31054' && d6.body.top.length > 10 && Array.isArray(d6.body.top[0].p.top3[0]), d6.status);
  const d7 = await pro.req('GET', '/dados/e2026/se/top3/31054.json');
  check('/dados pago: e2026 top3 Aracaju → 200 com aptos e município', d7.status === 200 && d7.body.top[0].aptos > 0 && d7.body.mun && d7.body.mun.aptos > 0, d7.status);
  const etag = d1.headers.get('etag');
  const d5 = await pro.req('GET', '/dados/mapa/3/55.json', undefined, { headers: { 'If-None-Match': etag } });
  check('/dados: If-None-Match → 304', d5.status === 304, d5.status);
  const r = await pro.req('POST', '/relatorios/iniciar', { tipo: 'candidato', uf: 'al', cargo: '6', alvo: '1234', nivel: 'secao', formatos: ['pdf', 'xlsx'] });
  check('pago: relatório por seção + Excel → 200, “Licenciado para”', r.status === 200 && r.body.marca_dagua === false && r.body.licenciado_para === 'Maria Assinante', r.body);
  const lst = await admin.req('GET', `/admin/usuarios?q=${RUN}`);
  check('admin lista usuários (busca)', lst.status === 200 && lst.body.usuarios.length >= 4, lst.body);
  const det = await admin.req('GET', `/admin/usuarios/${proId}`);
  check('admin vê detalhe + plano + relatórios', det.status === 200 && det.body.plano.plano === 'pro' && det.body.relatorios.length === 1);
  const csvR = await fetch(`${API}/admin/usuarios?format=csv&q=${RUN}`, { headers: { Authorization: 'Bearer ' + ADMIN_TOKEN } });
  const csvBuf = new Uint8Array(await csvR.arrayBuffer());
  const csv = (csvBuf[0] === 0xef && csvBuf[1] === 0xbb && csvBuf[2] === 0xbf ? '\ufeff' : '') + new TextDecoder('utf-8', { ignoreBOM: true }).decode(csvBuf).replace(/^\ufeff/, '');
  check('admin CSV via Bearer (BOM + cabeçalho)', csvR.status === 200 && csv.startsWith('\ufeffid,criado_em,email'), csv.slice(0, 80));
  const met = await fetch(`${API}/admin/metricas`, { headers: { Authorization: 'Bearer ' + ADMIN_TOKEN } });
  check('admin métricas via Bearer', met.status === 200 && (await met.json()).cortesias >= 1);
  check('Bearer errado → 403', (await fetch(`${API}/admin/metricas`, { headers: { Authorization: 'Bearer errado' } })).status === 403);
  const est = await admin.req('POST', `/admin/usuarios/${freeId}/estornar-relatorio`, { relatorio_id: (await free.req('GET', '/relatorios')).body.relatorios[0].id });
  check('admin estorna relatório', est.status === 200);
  const aud = await admin.req('GET', '/admin/auditoria');
  check('auditoria registra cortesia/estorno/CSV', aud.status === 200 && ['cortesia', 'estornar', 'exportar_csv'].every(a => aud.body.auditoria.some(x => x.acao === a)));
  // conta criada pelo admin + envio de código pelo admin (usado no teste real de e-mail)
  const emA = email('criadoadmin');
  const cr = await admin.req('POST', '/admin/usuarios', { email: emA, nome: 'Conta Criada', uf: 'se', perfil: 'campanha' });
  check('admin cria conta', cr.status === 200 && cr.body.id && cr.body.existente === false, cr.body);
  const env1 = await admin.req('POST', `/admin/usuarios/${cr.body.id}/enviar-codigo`);
  check('admin envia código; titular entra com ele', env1.status === 200 && (await new Cliente().req('POST', '/auth/verificar', { email: emA, codigo: await ultimoCodigo(emA) })).status === 200);
  // bloqueio derruba sessões
  const vit = await entrar('Pessoa Bloqueada', email('bloq'));
  await admin.req('POST', `/admin/usuarios/${vit.me.usuario.id}/bloquear`);
  check('bloquear derruba a sessão', (await vit.req('GET', '/me')).body.logado === false);
  check('admin não pode ser bloqueado', (await admin.req('POST', `/admin/usuarios/admin@teste.local/bloquear`)).status === 400);
}

// ---------------- chat
{
  check('chat sem login → 401', (await new Cliente().req('POST', '/chat', { messages: [{ role: 'user', content: 'oi' }], uf: 'se' })).status === 401);
  const q = { messages: [{ role: 'user', content: 'Quantos votos o Fábio 55 para governador teve por bairro em Aracaju?' }], uf: 'se' };
  // assistente só na Assinatura: grátis → 402, sem chamar o modelo (o mock grava dev/last-system.txt a cada chamada) e sem contar uso
  const ultimo = new URL('../dev/last-system.txt', import.meta.url);
  const mt = () => { try { return fs.statSync(ultimo).mtimeMs; } catch { return 0; } };
  const t0 = mt();
  const f = await free.req('POST', '/chat', q);
  check('chat grátis → 402 (Assinatura) com mensagem em pt-BR', f.status === 402 && f.body.motivo === 'chat-assinatura' && /assistente com IA faz parte da Assinatura \(R\$ 9,90\/mês\)/.test(f.body.error) && !/49,90/.test(f.body.error) && !f.body.reply, f.body);
  const st = [];
  for (let i = 0; i < 7; i++) st.push((await free.req('POST', '/chat', { messages: [{ role: 'user', content: 'quem ganhou em Lagarto?' }], uf: 'se' })).status);
  check('chat grátis: sempre 402 (nunca 200/429; não conta uso)', st.every(x => x === 402), st);
  check('chat grátis: o modelo NÃO foi chamado', mt() === t0, { antes: t0, depois: mt() });
  const p = await pro.req('POST', '/chat', q);
  check('chat pago: detalhe por bairro via R2 privado, 20/h', p.status === 200 && /plano=assinatura restrito=false detalhe=true/.test(p.body.reply) && p.body.remaining.hour === 19 && p.body.remaining.day === 99, p.body);
  check('chat pago: o modelo foi chamado', mt() > t0);
}

// ---------------- LGPD
{
  const exp = await pro.req('GET', '/conta/dados');
  check('LGPD exportar: JSON com dados e relatórios', exp.status === 200 && exp.body.usuario.email === email('pago') && exp.body.relatorios.length === 1 && /attachment/.test(exp.headers.get('content-disposition')));
  const pt = await pro.req('PATCH', '/conta', { nome: 'Maria A. Assinante', cidade: 'Maceió', uf: 'al' });
  check('LGPD corrigir: PATCH /conta', pt.status === 200 && pt.body.usuario.nome === 'Maria A. Assinante' && pt.body.usuario.uf === 'al');
  check('PATCH /conta UF inválida → 400', (await pro.req('PATCH', '/conta', { uf: 'xx' })).status === 400);
  check('PATCH /conta não troca e-mail', (await pro.req('PATCH', '/conta', { email: 'outro@x.com' })).status === 400);
}

// ---------------- Stripe (webhook assinado localmente; checkout desligado)
{
  check('checkout com Stripe desligada → 503', (await pro.req('POST', '/stripe/checkout')).status === 503);
  const hook = async (evt, segredo = WHSEC) => {
    const payload = JSON.stringify(evt);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: segredo });
    const r = await fetch(API + '/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': header, 'Content-Type': 'application/json' }, body: payload });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const t = Math.floor(Date.now() / 1000);
  const sub = (id, uid, status, extra = {}) => ({ id, object: 'subscription', customer: 'cus_' + uid.slice(0, 8), status, cancel_at_period_end: false, metadata: { usuario_id: uid },
    items: { data: [{ current_period_start: t - 86400, current_period_end: t + 29 * 86400, price: { id: 'price_test' } }] }, ...extra });
  const ev = (id, type, obj, created) => ({ id, object: 'event', type, created, data: { object: obj } });
  const semAss = await fetch(API + '/stripe/webhook', { method: 'POST', body: '{}' });
  check('webhook sem assinatura → 400', semAss.status === 400);
  check('webhook com segredo errado → 400', (await hook(ev('evt_bad', 'customer.subscription.created', sub('sub_x', freeId, 'active'), t), 'whsec_errado')).status === 400);
  const u = await entrar('Assinante Stripe', email('stripe'));
  const uid = u.me.usuario.id;
  const sid = 'sub_' + RUN;
  const e1 = await hook(ev('evt1_' + RUN, 'customer.subscription.created', sub(sid, uid, 'active'), t - 100));
  check('webhook subscription.created ativa → ok', e1.status === 200 && e1.body.resultado === 'ok', e1.body);
  let me = (await u.req('GET', '/me')).body;
  check('assinante Stripe → plano pro (assinatura), 50 relatórios', me.plano === 'pro' && me.origem === 'assinatura' && me.relatorios.limite === 50, me);
  check('evento repetido → duplicado', (await hook(ev('evt1_' + RUN, 'customer.subscription.created', sub(sid, uid, 'active'), t - 100))).body.duplicado === true);
  const e2 = await hook(ev('evt2_' + RUN, 'customer.subscription.updated', sub(sid, uid, 'active', { cancel_at_period_end: true }), t - 50));
  me = (await u.req('GET', '/me')).body;
  check('cancelamento agendado mantém acesso até o fim do período', e2.body.resultado === 'ok' && me.plano === 'pro' && me.assinatura.cancelar_no_fim === true, me.assinatura);
  const old = await hook(ev('evt0_' + RUN, 'customer.subscription.updated', sub(sid, uid, 'canceled'), t - 1000));
  check('evento antigo fora de ordem é ignorado', old.body.resultado === 'fora-de-ordem' && (await u.req('GET', '/me')).body.plano === 'pro', old.body);
  await hook(ev('evt3_' + RUN, 'customer.subscription.updated', sub(sid, uid, 'past_due'), t - 10));
  me = (await u.req('GET', '/me')).body;
  check('past_due recente → continua pro (tolerância de 7 dias)', me.plano === 'pro' && me.assinatura.em_tolerancia === true, me.assinatura);
  await hook(ev('evt4_' + RUN, 'customer.subscription.deleted', sub(sid, uid, 'canceled'), t));
  me = (await u.req('GET', '/me')).body;
  check('subscription.deleted → volta ao grátis', me.plano === 'free', me);
  // tolerância vencida
  const u2 = await entrar('Assinante Atrasado', email('atrasado'));
  const sid2 = 'sub2_' + RUN;
  await hook(ev('evt5_' + RUN, 'customer.subscription.created', sub(sid2, u2.me.usuario.id, 'active'), t - 9 * 86400));
  await hook(ev('evt6_' + RUN, 'customer.subscription.updated', sub(sid2, u2.me.usuario.id, 'past_due'), t - 8 * 86400));
  check('past_due há 8 dias → grátis (tolerância vencida)', (await u2.req('GET', '/me')).body.plano === 'free');
  check('portal com Stripe desligada → 503', (await u.req('POST', '/stripe/portal')).status === 503);
}

// ---------------- contato (porta do worker antigo)
{
  const c = new Cliente();
  const r = await c.req('POST', '/contato', { nome: 'Teste Contato', email: 'contato-teste@teste.local', assunto: 'duvida', mensagem: 'Mensagem de teste local do formulário.', aceite: true });
  check('contato: POST grava no KV local', r.status === 200 && r.body.ok && r.body.id, r.body);
  const l = await fetch(`${API}/contato/list?limit=5`, { headers: { Authorization: 'Bearer ' + ADMIN_TOKEN } });
  check('contato: lista com Bearer', l.status === 200 && (await l.json()).items.length >= 1);
}

// ---------------- contador anônimo de visitantes + /admin/estatisticas
{
  const UA_CEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
  const geo = o => ({ 'User-Agent': UA_CEL, 'X-Dev-Cf': JSON.stringify(o) });
  const est = async () => (await admin.req('GET', '/admin/estatisticas')).body;
  const loc = (b, l) => (b.periodos.hoje.por_local.find(x => x.local === l) || { visitantes: 0, acessos: 0 });
  const antes = await est();
  check('/admin/estatisticas (admin com sessão) → 200 com hoje/7d/30d e série de 30 dias', antes.periodos && antes.periodos.hoje && antes.periodos.d7 && antes.periodos.d30 && antes.serie.length === 30 && /UTC-3/.test(antes.fuso), antes);
  const v = new Cliente();
  const r1 = await v.req('GET', '/me?visita=1', undefined, { headers: geo({ country: 'BR', regionCode: 'AL', colo: 'GRU' }) });
  check('/me?visita=1 continua respondendo normal (logado:false)', r1.status === 200 && r1.body.logado === false, r1.body);
  await v.req('GET', '/me?acesso=1', undefined, { headers: geo({ country: 'BR', regionCode: 'AL', colo: 'GRU' }) });
  await v.req('GET', '/me?visita=1', undefined, { headers: geo({ country: 'PT', regionCode: '11', colo: 'LIS' }) });
  await v.req('GET', '/me', undefined, { headers: geo({ country: 'BR', regionCode: 'AL', colo: 'GRU' }) });                       // refresh interno: não conta
  await v.req('GET', '/me?visita=1', undefined, { origin: null, headers: geo({ country: 'BR', regionCode: 'AL', colo: 'GRU' }) }); // sem Origin: não conta
  await v.req('GET', '/me?visita=1&wd=1', undefined, { headers: geo({ country: 'BR', regionCode: 'AL', colo: 'GRU' }) });          // webdriver
  await v.req('GET', '/me?visita=1', undefined, { headers: { ...geo({ country: 'BR', regionCode: 'AL', colo: 'GRU' }), 'User-Agent': 'Mozilla/5.0 HeadlessChrome/140.0' } });
  await v.req('GET', '/me?visita=1', undefined, { headers: geo({ country: 'BR', regionCode: 'SE', colo: 'IAD', asn: 13335 }) });   // saída dos testes (WARP/IAD)
  await new Promise(r => setTimeout(r, 400)); // waitUntil
  const depois = await est();
  const dAL = { v: loc(depois, 'BR-AL').visitantes - loc(antes, 'BR-AL').visitantes, a: loc(depois, 'BR-AL').acessos - loc(antes, 'BR-AL').acessos };
  check('visitante em AL: +1 visitante e +2 acessos (refresh interno e sem Origin não contam)', dAL.v === 1 && dAL.a === 2, dAL);
  check('visitante de Portugal agrupado em PT', loc(depois, 'PT').visitantes - loc(antes, 'PT').visitantes === 1);
  check('webdriver, HeadlessChrome e WARP/IAD → só em "ignorados", fora dos totais', depois.ignorados_testes.hoje - antes.ignorados_testes.hoje === 3 && !depois.periodos.hoje.por_local.some(x => x.local === '_teste'), { antes: antes.ignorados_testes, depois: depois.ignorados_testes });
  check('totais: Brasil = soma dos estados; 7 e 30 dias incluem hoje', depois.periodos.hoje.brasil.visitantes === depois.periodos.hoje.por_local.filter(x => x.local.startsWith('BR-')).reduce((s, x) => s + x.visitantes, 0) && depois.periodos.d7.visitantes >= depois.periodos.hoje.visitantes && depois.periodos.d30.visitantes >= depois.periodos.d7.visitantes);
  check('estatísticas sem dado pessoal (sem IP/e-mail na resposta)', !/@|\b10\.\d+\.\d+\.\d+\b/.test(JSON.stringify(depois)));
  check('/admin/estatisticas sem sessão → 401', (await new Cliente().req('GET', '/admin/estatisticas')).status === 401);
  const gratis = await entrar('Pessoa Stats', email('stats'));
  check('/admin/estatisticas conta grátis → 403', (await gratis.req('GET', '/admin/estatisticas')).status === 403);
  check('/admin/estatisticas só com Bearer (sem sessão do Marcel) → 401', (await new Cliente().req('GET', '/admin/estatisticas', undefined, { headers: { Authorization: 'Bearer ' + ADMIN_TOKEN } })).status === 401);
}

// ---------------- etapa lenta: espera o intervalo de 60 s entre códigos
{
  const espera = 61000 - (Date.now() - tLento);
  if (espera > 0) { console.log(`… aguardando ${Math.ceil(espera / 1000)} s (intervalo entre códigos)`); await new Promise(r => setTimeout(r, espera)); }
  // trava após 10 erros em 1 h
  for (let i = 0; i < 5; i++) await lockC.req('POST', '/auth/verificar', { email: emLock, codigo: '000000' });
  const r2 = await lockC.req('POST', '/auth/codigo', { email: emLock });
  check('após 5 erros o código é cancelado; novo código pode ser pedido', r2.status === 200, r2.body);
  for (let i = 0; i < 5; i++) await lockC.req('POST', '/auth/verificar', { email: emLock, codigo: '000000' });
  const certo = await ultimoCodigo(emLock);
  const tr = await lockC.req('POST', '/auth/verificar', { email: emLock, codigo: certo });
  check('10 erros na hora → e-mail travado por 1 h (mesmo com código certo)', tr.status === 429, tr.body);
  // exclusão de conta
  const ec = await del.req('POST', '/conta/excluir/codigo');
  check('exclusão: código enviado', ec.status === 200, ec.body);
  const mails = await outbox(emDel);
  check('exclusão: e-mail com assunto específico', /^Código para excluir sua conta: \d{6}$/.test(mails[mails.length - 1].subject));
  const ex = await del.req('POST', '/conta/excluir', { codigo: await ultimoCodigo(emDel) });
  check('exclusão: conta apagada + cookie removido', ex.status === 200 && /Max-Age=0/.test(del.setCookieRaw), ex.body);
  const busca = await admin.req('GET', `/admin/usuarios?q=${encodeURIComponent(emDel)}`);
  check('exclusão: dados pessoais sumiram (e-mail não aparece mais)', busca.body.usuarios.length === 0);
  const relog = new Cliente();
  await relog.req('POST', '/auth/codigo', { email: emDel });
  check('exclusão: e-mail antigo não recebe código de login', (await outbox(emDel)).filter(m => /acesso/.test(m.subject)).length === 1); // só o do cadastro original
}

fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./out/api-results.json', import.meta.url), JSON.stringify({ quando: new Date().toISOString(), total: results.length, falhas, results }, null, 1));
console.log(`\n${results.length - falhas}/${results.length} verificações OK`);
process.exit(falhas ? 1 : 0);
