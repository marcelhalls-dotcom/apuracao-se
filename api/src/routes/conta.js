import { json, readJson, now, HttpError, clearCookie } from '../lib/http.js';
import { planoEfetivo, usoNoCiclo } from '../lib/plan.js';
import { isAdminEmail } from '../lib/session.js';
import { clean, PERFIS, UFS } from './auth.js';
import { guardEmissao, emitirCodigo, conferirCodigo } from './auth.js';

export function publicUser(u) {
  return { id: u.id, email: u.email, nome: u.nome, telefone: u.telefone, cidade: u.cidade, uf: u.uf, perfil: u.perfil,
    optin_novidades: !!u.optin_novidades, criado_em: u.criado_em, termos_versao: u.termos_versao };
}
export async function mePayload(env, u) {
  const p = await planoEfetivo(env, u);
  const usados = await usoNoCiclo(env, u.id, p.ciclo);
  const chat = p.plano === 'pro'
    ? { hora: Number(env.CHAT_PRO_HOUR || 20), dia: Number(env.CHAT_PRO_DAY || 100), nivel: 'completo', disponivel: true }
    : { hora: 0, dia: 0, nivel: 'bloqueado' }; // assistente só na Assinatura
  return {
    logado: true,
    usuario: publicUser(u),
    plano: p.plano, origem: p.origem,
    relatorios: { usados, limite: p.limite, restantes: Math.max(0, p.limite - usados), renova_em: p.renova_em },
    recursos: {
      detalhe_local: p.plano === 'pro', secoes: p.plano === 'pro', excel: p.plano === 'pro', marca_dagua: p.plano !== 'pro',
      licenciado_para: p.plano === 'pro' ? u.nome : null,
    },
    chat,
    assinatura: p.assinatura || null,
    cortesia_ate: p.cortesia_ate || null,
    admin: isAdminEmail(env, u.email),
    stripe: env.STRIPE_ENABLED === '1',
  };
}

export async function me(request, env, sess) {
  if (!sess) return json(200, { logado: false });
  return json(200, await mePayload(env, sess.user));
}

/** GET /conta/dados — exportação LGPD (art. 18, II e V). */
export async function exportar(request, env, sess) {
  const u = sess.user;
  const [rel, ses, ass] = await Promise.all([
    env.DB.prepare('SELECT id, criado_em, ciclo, tipo, uf, cargo, alvo, nivel, formatos, status, origem FROM relatorios WHERE usuario_id = ?1 ORDER BY criado_em DESC').bind(u.id).all(),
    env.DB.prepare('SELECT criada_em, expira_em, ultimo_uso, user_agent FROM sessoes WHERE usuario_id = ?1').bind(u.id).all(),
    env.DB.prepare('SELECT stripe_subscription_id, status, periodo_inicio, periodo_fim, cancelar_no_fim, atualizado_em FROM assinaturas WHERE usuario_id = ?1').bind(u.id).all(),
  ]);
  const body = {
    gerado_em: new Date().toISOString(),
    controlador: 'Cadê Meu Voto — cademeuvoto.com.br',
    usuario: { ...publicUser(u), email_verificado_em: u.email_verificado_em, termos_aceitos_em: u.termos_aceitos_em, ultimo_login_em: u.ultimo_login_em,
      cortesia_ate: u.cortesia_ate, stripe_customer_id: u.stripe_customer_id ? 'sim (dados de pagamento ficam na Stripe)' : null },
    relatorios: rel.results, sessoes: ses.results, assinaturas: ass.results,
  };
  return new Response(JSON.stringify(body, null, 2), { status: 200, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Disposition': 'attachment; filename="meus-dados-cademeuvoto.json"' } });
}

/** PATCH /conta — correção (art. 18, III). E-mail não muda aqui (troca de e-mail = suporte). */
export async function corrigir(request, env, sess) {
  const b = await readJson(request);
  const u = sess.user;
  const upd = {};
  if ('nome' in b) { const v = clean(b.nome, 120); if (v.length < 2) throw new HttpError(400, 'Nome muito curto.'); upd.nome = v; }
  if ('telefone' in b) { const v = clean(b.telefone, 30); if (v && !/^[0-9()+\-.\s]{8,30}$/.test(v)) throw new HttpError(400, 'WhatsApp inválido.'); upd.telefone = v || null; }
  if ('cidade' in b) upd.cidade = clean(b.cidade, 80) || null;
  if ('uf' in b) { const v = String(b.uf || '').toLowerCase(); if (!UFS.includes(v)) throw new HttpError(400, 'UF inválida.'); upd.uf = v; }
  if ('perfil' in b) { if (!PERFIS.includes(b.perfil)) throw new HttpError(400, 'Perfil inválido.'); upd.perfil = b.perfil; }
  if ('optin_novidades' in b) upd.optin_novidades = b.optin_novidades === true ? 1 : 0;
  const keys = Object.keys(upd);
  if (!keys.length) throw new HttpError(400, 'Nada para alterar.');
  const sets = keys.map((k, i) => `${k} = ?${i + 2}`).join(', ');
  await env.DB.prepare(`UPDATE usuarios SET ${sets} WHERE id = ?1`).bind(u.id, ...keys.map(k => upd[k])).run();
  const fresh = await env.DB.prepare('SELECT * FROM usuarios WHERE id = ?1').bind(u.id).first();
  return json(200, await mePayload(env, fresh));
}

/** POST /conta/excluir/codigo — envia código de confirmação de exclusão. */
export async function excluirCodigo(request, env, sess) {
  const u = sess.user;
  const ip = await guardEmissao(env, request, u.email);
  await emitirCodigo(env, request, u.email, 'excluir', u.nome, ip);
  return json(200, { ok: true, mensagem: 'Enviamos um código de confirmação para o seu e-mail.' });
}

/** POST /conta/excluir {codigo} — eliminação (art. 18, VI). */
export async function excluir(request, env, sess, { cancelarStripe } = {}) {
  const b = await readJson(request);
  const u = sess.user;
  await conferirCodigo(env, request, u.email, String(b.codigo || '').replace(/\D/g, ''), ['excluir']);
  // Assinatura ativa: cancela na Stripe imediatamente (se Stripe ligada).
  const sub = await env.DB.prepare("SELECT stripe_subscription_id FROM assinaturas WHERE usuario_id = ?1 AND status IN ('active','trialing','past_due')").bind(u.id).first();
  if (sub && cancelarStripe) {
    try { await cancelarStripe(env, sub.stripe_subscription_id); }
    catch (e) { throw new HttpError(502, 'Não conseguimos cancelar sua assinatura agora. Tente de novo em alguns minutos ou escreva para acesso@cademeuvoto.com.br.'); }
  }
  const t = now();
  const anon = `excluido-${u.id}@invalid`;
  // Relatórios ficam anonimizados (sem vínculo pessoal) para estatística; dados pessoais são apagados.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessoes WHERE usuario_id = ?1').bind(u.id),
    env.DB.prepare('DELETE FROM codigos WHERE email = ?1').bind(u.email),
    env.DB.prepare("UPDATE relatorios SET alvo = NULL, assinatura_spec = NULL WHERE usuario_id = ?1").bind(u.id),
    env.DB.prepare(`UPDATE usuarios SET email = ?2, nome = '(excluído)', telefone = NULL, cidade = NULL, perfil = NULL, optin_novidades = 0,
      status = 'excluido', cortesia_ate = NULL, cortesia_motivo = NULL, ultimo_login_em = NULL, excluido_em = ?3 WHERE id = ?1`).bind(u.id, anon, t),
  ]);
  return json(200, { ok: true, mensagem: 'Sua conta foi excluída.' }, { 'Set-Cookie': clearCookie(env) });
}
