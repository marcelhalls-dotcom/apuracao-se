// cademeuvoto-api — contas, cotas, dados privados, chat e assinatura.
import { json, corsHeaders, originInfo, HttpError, now } from './lib/http.js';
import { getSession } from './lib/session.js';
import * as auth from './routes/auth.js';
import * as conta from './routes/conta.js';
import * as rel from './routes/relatorios.js';
import { dados } from './routes/dados.js';
import { adminRouter } from './routes/admin.js';
import * as stripe from './routes/stripe.js';
import { chat } from './routes/chat.js';
import { handleContatoPost, handleContatoList, handleContatoDelete } from './routes/contato.js';
import { DEV_OUTBOX } from './email/send.js';
import { contarVisita, estatisticas } from './lib/visitas.js';
import { isAdminEmail } from './lib/session.js';

const SEM_ORIGEM = new Set(['/stripe/webhook']); // chamadas servidor→servidor (assinatura própria)

function devOn(env) { return env.DEV_MODE === '1' && env.EMAIL_PROVIDER === 'mock'; }

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const m = request.method;
  const { origin, ok: originOk } = originInfo(request, env);

  if (m === 'OPTIONS') return new Response(null, { status: originOk ? 204 : 403 });

  // CSRF: toda escrita precisa vir do site (Origin exato) — exceto webhook e rotas admin com Bearer.
  const escrita = m !== 'GET' && m !== 'HEAD';
  const bearer = (request.headers.get('Authorization') || '').startsWith('Bearer ');
  if (escrita && !SEM_ORIGEM.has(path) && !(bearer && (path.startsWith('/admin/') || path.startsWith('/contato/item/'))) && !originOk) {
    throw new HttpError(403, 'Origem não permitida.');
  }

  if (path === '/' && m === 'GET') return json(200, { ok: true, service: 'cademeuvoto-api' });
  if (path === '/config' && m === 'GET') {
    return json(200, { turnstile_sitekey: env.TURNSTILE_REQUIRED === '1' ? (env.TURNSTILE_SITEKEY || '') : '', stripe: env.STRIPE_ENABLED === '1',
      termos_versao: env.TERMOS_VERSAO, limites: { free_relatorios: Number(env.FREE_REPORTS || 2) } }, { 'Cache-Control': 'public, max-age=300' });
  }
  if (path === '/stripe/webhook' && m === 'POST') return stripe.webhook(request, env);

  // Dev local apenas (DEV_MODE=1 + e-mail mock): caixa de saída e carga do R2 local.
  if (path.startsWith('/__dev/')) {
    if (!devOn(env)) throw new HttpError(404, 'Não encontrado.');
    if (path === '/__dev/outbox' && m === 'GET') {
      const to = (url.searchParams.get('to') || '').toLowerCase();
      return json(200, { emails: DEV_OUTBOX.filter(e => !to || e.to === to).slice(-20) });
    }
    if (path === '/__dev/reset-limites' && m === 'POST') {
      await env.DB.prepare('DELETE FROM contadores').run();
      return json(200, { ok: true });
    }
    if (path.startsWith('/__dev/r2/') && m === 'PUT') {
      const key = decodeURIComponent(path.slice('/__dev/r2/'.length));
      await env.DADOS_PRO.put(key, await request.arrayBuffer(), { httpMetadata: { contentType: 'application/json' } });
      return json(200, { ok: true, key });
    }
    throw new HttpError(404, 'Não encontrado.');
  }

  // Contato (rotas idênticas às do worker antigo)
  if (path === '/contato' && m === 'POST') return handleContatoPost(request, env, {});
  if (path === '/contato/list' && m === 'GET') return handleContatoList(request, env, {});
  if (path.startsWith('/contato/item/') && (m === 'POST' || m === 'DELETE')) return handleContatoDelete(request, env, {}, decodeURIComponent(path.slice(14)));

  if (path === '/auth/cadastro' && m === 'POST') return auth.cadastro(request, env);
  if (path === '/auth/codigo' && m === 'POST') return auth.pedirCodigo(request, env);
  if (path === '/auth/verificar' && m === 'POST') return auth.verificar(request, env);

  const sess = await getSession(request, env);
  if (path === '/me' && m === 'GET') { contarVisita(request, env, ctx, url, originOk); return conta.me(request, env, sess); }
  // Estatísticas de visitantes: só a conta do Marcel (ADMIN_EMAILS) com sessão; sem sessão 401, outra conta 403.
  if (path === '/admin/estatisticas' && m === 'GET') {
    if (!sess) throw new HttpError(401, 'Entre na sua conta.', { motivo: 'login' });
    if (!isAdminEmail(env, sess.user.email)) throw new HttpError(403, 'Acesso restrito.');
    return json(200, await estatisticas(env));
  }
  if (path === '/auth/sair' && m === 'POST') return auth.sair(request, env, sess);
  if (path === '/auth/sair-todos' && m === 'POST') return auth.sairTodos(request, env, sess);
  if (path.startsWith('/dados/') && (m === 'GET' || m === 'HEAD')) return dados(request, env, sess, decodeURIComponent(path.slice(7)));
  if (path === '/chat' && m === 'POST') return chat(request, env, sess);
  if (path.startsWith('/admin/')) return adminRouter(request, env, sess, path, url);

  if (!sess) throw new HttpError(401, 'Entre na sua conta.', { motivo: 'login' });
  if (path === '/conta/dados' && m === 'GET') return conta.exportar(request, env, sess);
  if (path === '/conta' && m === 'PATCH') return conta.corrigir(request, env, sess);
  if (path === '/conta/excluir/codigo' && m === 'POST') return conta.excluirCodigo(request, env, sess);
  if (path === '/conta/excluir' && m === 'POST') return conta.excluir(request, env, sess, { cancelarStripe: stripe.cancelarAssinatura });
  if (path === '/relatorios/iniciar' && m === 'POST') return rel.iniciar(request, env, sess);
  if (path === '/relatorios' && m === 'GET') return rel.listar(request, env, sess);
  let mm;
  if ((mm = path.match(/^\/relatorios\/([0-9a-f-]{36})\/(concluir|falhou)$/)) && m === 'POST') {
    return mm[2] === 'concluir' ? rel.concluir(request, env, sess, mm[1]) : rel.falhou(request, env, sess, mm[1]);
  }
  if (path === '/stripe/checkout' && m === 'POST') return stripe.checkout(request, env, sess);
  if (path === '/stripe/portal' && m === 'POST') return stripe.portal(request, env, sess);
  throw new HttpError(404, 'Rota não encontrada.');
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    let res;
    try { res = await route(request, env, ctx); }
    catch (e) {
      if (e instanceof HttpError || (e && e.status && e.status < 500)) res = json(e.status, { error: e.message, ...(e.extra || {}) });
      else { console.error('[erro]', e && e.stack || e); res = json(500, { error: 'Erro interno. Tente de novo em instantes.' }); }
    }
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  },

  // Limpeza diária: códigos/sessões/contadores vencidos.
  async scheduled(event, env, ctx) {
    const t = now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM codigos WHERE expira_em < ?1').bind(t - 86400),
      env.DB.prepare('DELETE FROM sessoes WHERE expira_em < ?1').bind(t),
      env.DB.prepare('DELETE FROM contadores WHERE expira_em < ?1').bind(t),
      env.DB.prepare('DELETE FROM stripe_eventos WHERE recebido_em < ?1').bind(t - 90 * 86400),
    ]);
  },
};
