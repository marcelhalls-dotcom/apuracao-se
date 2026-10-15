// Perguntas reais ao assistente via API LOCAL (wrangler dev). Uso: API=http://127.0.0.1:8788 node test/chat-qa.mjs [saida.json]
// Cria 1 usuário gratuito e 1 assinante (cortesia via admin local) e imprime perguntas/respostas.
import fs from 'node:fs';
const API = process.env.API || 'http://127.0.0.1:8788';
const ORIGIN = 'http://localhost:8080';
const ADMIN_TOKEN = (fs.readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/^ADMIN_TOKEN=(.*)$/m) || [])[1];
const RUN = Date.now().toString(36);
const rnd = () => Math.floor(Math.random() * 250) + 1;
class C {
  constructor() { this.cookie = null; this.ip = `10.${rnd()}.${rnd()}.${rnd()}`; }
  async req(method, path, body, extra = {}) {
    const h = { 'CF-Connecting-IP': this.ip, Origin: ORIGIN, ...extra };
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const r = await fetch(API + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j };
  }
}
const codigo = async to => { const e = (await (await fetch(`${API}/__dev/outbox?to=${encodeURIComponent(to)}`)).json()).emails; return e[e.length - 1].text.match(/\b(\d{6})\b/)[1]; };
async function entrar(nome) {
  await fetch(API + '/__dev/reset-limites', { method: 'POST', headers: { Origin: ORIGIN } });
  const em = `${nome}-${RUN}@teste.local`, c = new C();
  const r = await c.req('POST', '/auth/cadastro', { nome, email: em, uf: 'al', perfil: 'candidato', telefone: '(82) 99999-0000', cidade: 'Maceió', aceite_termos: true });
  if (r.status !== 200) throw new Error('cadastro ' + JSON.stringify(r.body));
  const v = await c.req('POST', '/auth/verificar', { email: em, codigo: await codigo(em) });
  if (v.status !== 200) throw new Error('verificar ' + JSON.stringify(v.body));
  const me = await c.req('GET', '/me'); c.id = me.body.usuario?.id || me.body.user?.id || me.body.id; return c;
}
const free = await entrar('qafree');
const pro = await entrar('qapro');
const adm = await fetch(`${API}/admin/usuarios/${pro.id}/cortesia`, { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN_TOKEN, Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ dias: 30, motivo: 'qa chat local' }) });
console.log('cortesia', adm.status);
const casos = JSON.parse(process.env.CASOS || 'null') || [
  ['free', 'al', ['Quantos votos JHC teve em Maceió?', 'E em Arapiraca?']],
  ['free', 'al', ['Quem vai ao 2º turno para Governador em Alagoas?']],
  ['pro', 'al', ['Em quais bairros de Maceió JHC teve mais votos?']],
  ['free', 'al', ['Em quais bairros de Maceió JHC teve mais votos?']],
  ['free', 'se', ['Quem foi eleito Governador em Sergipe?', 'E em Aracaju, quantos votos o Fábio teve?']],
  ['pro', 'se', ['Em quais bairros de Aracaju o Fábio teve mais votos?']],
  ['free', 'sp', ['Quantos votos Tarcísio e Haddad tiveram em Campinas?']],
  ['free', 'df', ['Como Celina Leão e Leandro Grass foram em Ceilândia?']],
  ['free', 'df', ['Quem foram os deputados distritais mais votados?']],
  ['free', 'rj', ['Quem vai ao 2º turno para Governador no Rio de Janeiro?']],
  ['free', 'se', ['Como ficou a votação para Presidente no Brasil?']],
  ['free', 'se', ['E em São Paulo, quem venceu para governador?']],
  ['free', 'al', ['Qual a previsão do tempo amanhã?']],
];
const out = [];
for (const [quem, uf, perguntas] of casos) {
  const c = quem === 'pro' ? pro : free; const hist = [];
  for (const q of perguntas) {
    hist.push({ role: 'user', content: q });
    const t0 = Date.now();
    const r = await c.req('POST', '/chat', { messages: hist, uf });
    const resp = r.body.reply || r.body.erro || r.body.error || JSON.stringify(r.body);
    hist.push({ role: 'assistant', content: resp });
    out.push({ quem, uf, q, status: r.status, ms: Date.now() - t0, uf_resp: r.body.uf, restante: r.body.remaining, retrieval: r.body.retrieval, resp });
    console.log(`\n### [${quem}/${uf}] ${q}\n(status ${r.status}, ${Date.now() - t0} ms, uf=${r.body.uf}, restante=${JSON.stringify(r.body.remaining)}, ret=${JSON.stringify(r.body.retrieval)})\n${resp}`);
    await fetch(API + '/__dev/reset-limites', { method: 'POST', headers: { Origin: ORIGIN } });
  }
}
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
