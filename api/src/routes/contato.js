// Portado de site/chat-worker/src/index.js — formulário de contato (KV CONTATO), mesmas regras.
import { json as j0, clientIp } from '../lib/http.js';
import { bearerIsAdmin } from '../lib/session.js';
const json = (status, body, extra = {}) => j0(status, body, extra);
function dayKey(d = new Date()) { return d.toISOString().slice(0, 10); }
function hourKey(d = new Date()) { return d.toISOString().slice(0, 13); }
const CONTATO_ASSUNTOS = { duvida: 'Dúvida', planos: 'Planos', imprensa: 'Imprensa', outro: 'Outro' };
const CONTATO_MAX_MSG = 2000;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}


function isAdmin(request, env) {
  return bearerIsAdmin(request, env);
}

async function checkContatoRate(env, ip) {
  const hourLimit = Number(env.CONTATO_RATE_HOUR || 5);
  const dayLimit = Number(env.CONTATO_RATE_DAY || 20);
  const kH = `ct:h:${ip}:${hourKey()}`;
  const kD = `ct:d:${ip}:${dayKey()}`;
  const [cH, cD] = await Promise.all([env.RATE.get(kH), env.RATE.get(kD)]);
  const nH = Number(cH || 0), nD = Number(cD || 0);
  if (nH >= hourLimit) return { ok: false, msg: 'Você enviou muitas mensagens na última hora. Tente novamente mais tarde.' };
  if (nD >= dayLimit) return { ok: false, msg: 'Limite diário de mensagens atingido. Tente novamente amanhã.' };
  await Promise.all([
    env.RATE.put(kH, String(nH + 1), { expirationTtl: 7200 }),
    env.RATE.put(kD, String(nD + 1), { expirationTtl: 172800 }),
  ]);
  return { ok: true };
}

async function handleContatoPost(request, env, cors) {
  if (!env.CONTATO) return json(500, { error: 'Serviço de contato indisponível no momento.' }, cors);
  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Dados inválidos.' }, cors); }
  body = body || {};
  // honeypot: bots preenchem o campo oculto; respondemos ok sem gravar
  if (cleanText(body.website, 200)) return json(200, { ok: true }, cors);
  const t0 = Number(body.t0 || 0);
  if (t0 && Date.now() - t0 < 2500) return json(200, { ok: true }, cors); // envio "instantâneo" = robô
  const nome = cleanText(body.nome, 120);
  const email = cleanText(body.email, 200).toLowerCase();
  const telefone = cleanText(body.telefone, 30);
  const assunto = cleanText(body.assunto, 20);
  const mensagem = cleanText(body.mensagem, CONTATO_MAX_MSG + 1);
  const erros = [];
  if (nome.length < 2) erros.push('Informe seu nome.');
  if (!EMAIL_RE.test(email)) erros.push('Informe um e-mail válido.');
  if (telefone && !/^[0-9()+\-.\s]{8,30}$/.test(telefone)) erros.push('Telefone inválido (use só números, espaços, parênteses, + ou -).');
  if (!CONTATO_ASSUNTOS[assunto]) erros.push('Escolha o assunto.');
  if (mensagem.length < 10) erros.push('A mensagem precisa ter pelo menos 10 caracteres.');
  if (mensagem.length > CONTATO_MAX_MSG) erros.push(`A mensagem pode ter no máximo ${CONTATO_MAX_MSG} caracteres.`);
  if (body.aceite !== true) erros.push('É preciso concordar com o uso dos dados para responder ao contato.');
  if (erros.length) return json(400, { error: erros.join(' '), erros }, cors);

  const rate = await checkContatoRate(env, clientIp(request));
  if (!rate.ok) return json(429, { error: rate.msg }, cors);

  const now = new Date();
  const id = now.toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8);
  const rec = {
    id, recebido_em: now.toISOString(), nome, email, telefone, assunto, assunto_label: CONTATO_ASSUNTOS[assunto], mensagem,
    pagina: cleanText(body.pagina, 60), origem: request.headers.get('Origin') || '',
    ua: cleanText(request.headers.get('User-Agent'), 160),
  };
  await env.CONTATO.put('contato:' + id, JSON.stringify(rec), { metadata: { nome, assunto, ts: rec.recebido_em } });
  return json(200, { ok: true, id }, cors);
}

async function handleContatoList(request, env, cors) {
  if (!isAdmin(request, env)) return json(401, { error: 'Não autorizado.' }, cors);
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);
  const all = [];
  let cursor;
  do {
    const r = await env.CONTATO.list({ prefix: 'contato:', cursor, limit: 1000 });
    all.push(...r.keys.map(k => k.name));
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  all.sort().reverse();
  const keys = all.slice(0, limit);
  const items = (await Promise.all(keys.map(k => env.CONTATO.get(k, 'json')))).filter(Boolean);
  if (url.searchParams.get('format') === 'csv') {
    const cols = ['id', 'recebido_em', 'nome', 'email', 'telefone', 'assunto_label', 'mensagem', 'pagina', 'origem'];
    const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const csv = '\ufeff' + [cols.join(','), ...items.map(it => cols.map(c => esc(it[c])).join(','))].join('\r\n');
    return new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });
  }
  return json(200, { total: all.length, retornados: items.length, items }, { 'Cache-Control': 'no-store', ...cors });
}

async function handleContatoDelete(request, env, cors, id) {
  if (!isAdmin(request, env)) return json(401, { error: 'Não autorizado.' }, cors);
  if (!/^[0-9TZ-]+-[0-9a-f]{8}$/.test(id)) return json(400, { error: 'id inválido' }, cors);
  const key = 'contato:' + id;
  const had = await env.CONTATO.get(key);
  if (!had) return json(404, { error: 'Não encontrado' }, cors);
  await env.CONTATO.delete(key);
  return json(200, { ok: true, removido: id }, cors);
}
export { handleContatoPost, handleContatoList, handleContatoDelete };
