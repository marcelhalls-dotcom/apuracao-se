import { json, readJson, HttpError } from '../lib/http.js';
import { planoEfetivo } from '../lib/plan.js';
import { checkHD, bumpHD, burst } from '../lib/rate.js';
import { SYSTEM_BASE, sanitizeMessages, cachedJson, buildRetrieval, detectReportIntent, munsCitados } from '../chat/retrieval.js';
import CONTEXT_SE from '../chat/context.json';
import { detectUfs, UFS } from '../chat/nomes.js';

const UF_NOME = { ac: 'Acre', al: 'Alagoas', am: 'Amazonas', ap: 'Amapá', ba: 'Bahia', ce: 'Ceará', df: 'Distrito Federal', es: 'Espírito Santo',
  go: 'Goiás', ma: 'Maranhão', mg: 'Minas Gerais', ms: 'Mato Grosso do Sul', mt: 'Mato Grosso', pa: 'Pará', pb: 'Paraíba', pe: 'Pernambuco',
  pi: 'Piauí', pr: 'Paraná', rj: 'Rio de Janeiro', rn: 'Rio Grande do Norte', ro: 'Rondônia', rr: 'Roraima', rs: 'Rio Grande do Sul',
  sc: 'Santa Catarina', se: 'Sergipe', sp: 'São Paulo', to: 'Tocantins' };

// "2º turno" nunca é eleito (o TSE marca e='s' também para quem vai ao 2º turno; alguns contextos herdaram isso)
function corrigirTurno(o) {
  if (Array.isArray(o)) return o.map(corrigirTurno);
  if (!o || typeof o !== 'object') return o;
  const r = {};
  for (const [k, v] of Object.entries(o)) r[k] = corrigirTurno(v);
  const sit = String(r.sit || r.st || '').toLowerCase();
  if (/2[ºo°]\s*turno|segundo turno/.test(sit) && 'eleito' in r) r.eleito = false;
  return r;
}
const PRES_BR = corrigirTurno(CONTEXT_SE.cargos && CONTEXT_SE.cargos.presidente_br);
async function contextoUf(env, uf) {
  if (uf === 'se') { const { presidente_br, ...cargos } = CONTEXT_SE.cargos || {}; return corrigirTurno({ ...CONTEXT_SE, cargos }); }
  return corrigirTurno(await cachedJson(`${String(env.DATA_BASE).replace(/\/$/, '')}/mapa/${uf}/context.json`));
}
// resumo de outra UF citada na pergunta: só os cargos majoritários e os eleitos (cabe no prompt)
function resumoUf(ctx) {
  const c = ctx.cargos || {}, o = { uf: ctx.uf, cargos: {} };
  for (const [k, v] of Object.entries(c)) {
    if (!v || typeof v !== 'object') continue;
    if (Array.isArray(v.candidatos)) o.cargos[k] = { candidatos: v.candidatos.slice(0, 5) };
    else if (Array.isArray(v.eleitos)) o.cargos[k] = { vagas: v.vagas, eleitos: v.eleitos.slice(0, 12), nota: v.eleitos.length > 12 ? 'lista parcial (os 12 mais votados entre os eleitos)' : undefined };
  }
  return o;
}

const NIVEL_PRO = `
PLANO DO USUÁRIO: ASSINATURA. Pode usar o detalhe por bairro, zona, local de votação e seção que vier no BLOCO_RETRIEVAL.`;

/** POST /chat — exige login e Assinatura (20/hora, 100/dia). */
export async function chat(request, env, sess) {
  if (!sess) throw new HttpError(401, 'Entre na sua conta para usar o assistente. Ele faz parte da Assinatura (R$ 9,90/mês).', { motivo: 'login' });
  const body = await readJson(request, 60000);
  const parsed = sanitizeMessages(body.messages, Number(env.MAX_MSG_CHARS || 1000), Number(env.MAX_HISTORY || 8), Number(env.HIST_TRUNC_CHARS || 1500));
  if (parsed.error) throw new HttpError(400, parsed.error);
  const u = sess.user;
  const p = await planoEfetivo(env, u);
  const pro = p.plano === 'pro';
  // O assistente com IA é exclusivo da Assinatura: sem assinatura → 402, sem chamar o modelo e sem contar uso.
  if (!pro) throw new HttpError(402, 'O assistente com IA faz parte da Assinatura (R$ 9,90/mês). Veja a página Planos para assinar.', { motivo: 'chat-assinatura', plano: p.plano });
  const lh = Number(env.CHAT_PRO_HOUR || 20);
  const ld = Number(env.CHAT_PRO_DAY || 100);
  if (!(await burst(env, 'chat:' + u.id))) throw new HttpError(429, 'Calma! Muitas mensagens seguidas. Aguarde um minuto.');
  const lim = await checkHD(env, 'chat:u:' + u.id, lh, ld);
  if (!lim.ok) {
    throw new HttpError(429, lim.janela === 'hora'
      ? `Você usou as ${lh} perguntas desta hora. Tente de novo na próxima hora.`
      : `Você usou as ${ld} perguntas de hoje. O limite renova amanhã.`,
      { motivo: 'chat-limite', janela: lim.janela, plano: p.plano });
  }
  if (!env.AI_ROUTER_API_KEY) throw new HttpError(500, 'Serviço temporariamente indisponível (config).');

  const ufSel = UFS.includes(String(body.uf || '').toLowerCase()) ? String(body.uf).toLowerCase() : 'se';
  const lastUser = [...parsed.messages].reverse().find(m => m.role === 'user')?.content || '';
  // UFs citadas na pergunta ("e em SP?", "no Rio Grande do Sul"): uma só, diferente da selecionada → responde com os dados dela
  const citadas = detectUfs(lastUser, await munsCitados(env, ufSel, lastUser)).filter(u => UFS.includes(u));
  const ufReq = citadas.length === 1 ? citadas[0] : ufSel;
  const outras = citadas.filter(u => u !== ufReq).slice(0, 3);
  let retrieval;
  try { retrieval = await buildRetrieval(env, parsed.messages, ufReq, p.plano); }
  catch { retrieval = { erro: 'Falha na recuperação de dados municipais.', itens: [] }; }
  let ctxJson;
  try { ctxJson = await contextoUf(env, ufReq); }
  catch { ctxJson = { uf: ufReq.toUpperCase(), erro: 'Dados desta UF não estão disponíveis agora. Diga isso ao usuário; não use números de outro estado.' }; }
  const extras = [];
  for (const u of outras) { try { extras.push(resumoUf(await contextoUf(env, u))); } catch { extras.push({ uf: u.toUpperCase(), erro: 'indisponível agora' }); } }
  const system = `${SYSTEM_BASE}
${NIVEL_PRO}

UF_SELECIONADA_NO_SITE: ${ufSel.toUpperCase()} (${UF_NOME[ufSel]})
UF_ATIVA (dados abaixo): ${ufReq.toUpperCase()} (${UF_NOME[ufReq]})${ufReq !== ufSel ? ' — o usuário perguntou desta UF; responda sobre ela.' : ''}

PRESIDENTE_BRASIL (1º turno, total nacional):
${JSON.stringify(PRES_BR || null)}

CONTEXTO_DADOS (JSON compacto da UF ativa):
${JSON.stringify(ctxJson)}
${extras.length ? `
CONTEXTO_OUTRAS_UFS (resumo das outras UFs citadas):
${JSON.stringify(extras)}
` : ''}
BLOCO_RETRIEVAL (município/bairro/zona sob demanda a partir dos arquivos mapa do painel):
${JSON.stringify(retrieval)}`;

  let upstream;
  try {
    upstream = await fetch(`${String(env.ROUTER_BASE || '').replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AI_ROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: env.ROUTER_MODEL || 'cademeuvoto', messages: [{ role: 'system', content: system }, ...parsed.messages],
        max_tokens: Number(env.MAX_TOKENS || 1800), temperature: 0.2, user: u.id }),
    });
  } catch { throw new HttpError(502, 'Falha ao contactar o modelo. Tente de novo.'); }
  const data = await upstream.json().catch(() => null);
  if (!upstream.ok) throw new HttpError(502, 'O modelo não respondeu agora. Tente novamente em instantes.');
  const answer = (((data || {}).choices || [])[0] || {}).message?.content || '';
  if (!answer.trim()) throw new HttpError(502, 'Resposta vazia do modelo.');
  const c = await bumpHD(env, 'chat:u:' + u.id); // só conta perguntas respondidas
  let report = detectReportIntent(lastUser, retrieval);
  if (report && !pro && report.options) report = { ...report, options: { ...report.options, detalhe: 'municipio', zoneado: false } };
  return json(200, {
    reply: answer.trim(),
    model: (data && data.model) || env.ROUTER_MODEL,
    plano: p.plano,
    remaining: { hour: Math.max(0, lh - c.h), day: Math.max(0, ld - c.d) },
    uf: ufReq,
    retrieval: retrieval.detectado || null,
    report: report || null,
  });
}
