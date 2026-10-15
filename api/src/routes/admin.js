import { json, readJson, now, HttpError } from '../lib/http.js';
import { uuid } from '../lib/crypto.js';
import { isAdminEmail, bearerIsAdmin, destroyAllSessions, createSession } from '../lib/session.js';
import { planoEfetivo, usoNoCiclo, mesBRT } from '../lib/plan.js';
import { publicUser } from './conta.js';
import { EMAIL_RE, normEmail, clean, UFS, PERFIS, guardEmissao, emitirCodigo } from './auth.js';

export function adminDe(request, env, sess) {
  if (sess && isAdminEmail(env, sess.user.email)) return sess.user.email;
  if (bearerIsAdmin(request, env)) return 'token';
  return null;
}
async function audit(env, admin, acao, alvo, detalhe) {
  await env.DB.prepare('INSERT INTO auditoria_admin (id, admin, acao, alvo, detalhe, em) VALUES (?1,?2,?3,?4,?5,?6)')
    .bind(uuid(), admin, acao, alvo, detalhe ? JSON.stringify(detalhe).slice(0, 2000) : null, now()).run();
}
const csvCell = v => { const s = v == null ? '' : String(v); const t = /^[=+\-@\t\r]/.test(s) ? "'" + s : s; return /[",\n;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };

async function getUser(env, id) {
  const u = await env.DB.prepare('SELECT * FROM usuarios WHERE id = ?1 OR email = lower(?1)').bind(String(id)).first();
  if (!u) throw new HttpError(404, 'Usuário não encontrado.');
  return u;
}

export async function adminRouter(request, env, sess, path, url) {
  const admin = adminDe(request, env, sess);
  if (!admin) throw new HttpError(403, 'Acesso restrito.');
  const m = request.method;

  // Sessão de TESTE sem e-mail (só para verificação pós-deploy). Desligado por padrão: exige TEST_SESSIONS=1,
  // o token de admin (não vale sessão de admin) e um e-mail do subdomínio reservado teste.cademeuvoto.com.br (sem MX: nada é enviado).
  if (m === 'POST' && path === '/admin/teste/sessao') {
    if (env.TEST_SESSIONS !== '1' || admin !== 'token') throw new HttpError(404, 'Não encontrado.');
    const b = await readJson(request);
    const email = normEmail(b.email);
    if (!/^teste-[a-z0-9-]{1,40}@teste\.cademeuvoto\.com\.br$/.test(email)) throw new HttpError(400, 'Só e-mails teste-*@teste.cademeuvoto.com.br.');
    let u = await env.DB.prepare('SELECT * FROM usuarios WHERE email = ?1').bind(email).first();
    if (!u) {
      const id = uuid(), t = now();
      await env.DB.prepare("INSERT INTO usuarios (id, email, nome, uf, perfil, email_verificado_em, criado_em) VALUES (?1,?2,?3,'se','outro',?4,?4)")
        .bind(id, email, clean(b.nome || 'TESTE', 120), t).run();
      u = { id };
    }
    const s = await createSession(env, u.id, 'teste-pos-deploy');
    await audit(env, admin, 'sessao_teste', u.id, { email });
    return json(200, { ok: true, id: u.id, token: s.token, cookie: env.COOKIE_NAME || '__Host-cmv' });
  }

  if (m === 'GET' && path === '/admin/usuarios') {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 5000);
    const rows = (await env.DB.prepare(
      `SELECT u.*, (SELECT status FROM assinaturas a WHERE a.usuario_id = u.id ORDER BY atualizado_em DESC LIMIT 1) AS assinatura_status
       FROM usuarios u WHERE u.status != 'excluido' AND (?1 = '' OR u.email LIKE '%' || ?1 || '%' OR lower(u.nome) LIKE '%' || ?1 || '%')
       ORDER BY u.criado_em DESC LIMIT ?2`).bind(q, limit).all()).results;
    if (url.searchParams.get('format') === 'csv') {
      const cols = ['id', 'criado_em', 'email', 'nome', 'telefone', 'cidade', 'uf', 'perfil', 'optin_novidades', 'status', 'assinatura_status', 'cortesia_ate', 'ultimo_login_em'];
      const lines = [cols.join(',')].concat(rows.map(r => cols.map(c => csvCell(c.endsWith('_em') || c === 'cortesia_ate' ? (r[c] ? new Date(r[c] * 1000).toISOString() : '') : r[c])).join(',')));
      await audit(env, admin, 'exportar_csv', null, { n: rows.length });
      return new Response('\ufeff' + lines.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="usuarios.csv"', 'Cache-Control': 'no-store' } });
    }
    return json(200, { usuarios: rows.map(r => ({ ...publicUser(r), status: r.status, assinatura_status: r.assinatura_status, cortesia_ate: r.cortesia_ate, ultimo_login_em: r.ultimo_login_em })) });
  }
  if (m === 'GET' && path === '/admin/metricas') {
    const t = now(), mes = mesBRT().key;
    const one = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).first()) || {};
    const [tot, sem, ativos, cort, rel, relMes] = await Promise.all([
      one("SELECT COUNT(*) n FROM usuarios WHERE status = 'ativo' AND email_verificado_em IS NOT NULL"),
      one("SELECT COUNT(*) n FROM usuarios WHERE criado_em > ?1 AND email_verificado_em IS NOT NULL", t - 7 * 86400),
      one("SELECT COUNT(DISTINCT usuario_id) n FROM assinaturas WHERE status IN ('active','trialing','past_due')"),
      one("SELECT COUNT(*) n FROM usuarios WHERE cortesia_ate > ?1", t),
      one("SELECT COUNT(*) n FROM relatorios WHERE status != 'estornado'"),
      one("SELECT COUNT(*) n FROM relatorios WHERE status != 'estornado' AND ciclo LIKE '%' || ?1", mes),
    ]);
    return json(200, { usuarios: tot.n, novos_7d: sem.n, assinantes: ativos.n, cortesias: cort.n, relatorios_total: rel.n, relatorios_mes_gratis_cortesia: relMes.n });
  }
  if (m === 'GET' && path === '/admin/assinaturas') {
    const rows = (await env.DB.prepare('SELECT a.*, u.email, u.nome FROM assinaturas a LEFT JOIN usuarios u ON u.id = a.usuario_id ORDER BY a.atualizado_em DESC LIMIT 1000').all()).results;
    return json(200, { assinaturas: rows });
  }
  if (m === 'GET' && path === '/admin/auditoria') {
    const rows = (await env.DB.prepare('SELECT * FROM auditoria_admin ORDER BY em DESC LIMIT 500').all()).results;
    return json(200, { auditoria: rows });
  }
  // Conta criada pelo admin (ex.: Campanha/Institucional, testes). O titular confirma o e-mail no 1º login por código.
  if (m === 'POST' && path === '/admin/usuarios') {
    const b = await readJson(request);
    const email = normEmail(b.email), nome = clean(b.nome, 120);
    if (!EMAIL_RE.test(email) || nome.length < 2) throw new HttpError(400, 'Informe nome e e-mail válidos.');
    const uf = UFS.includes(String(b.uf || '').toLowerCase()) ? String(b.uf).toLowerCase() : null;
    const perfil = PERFIS.includes(b.perfil) ? b.perfil : 'outro';
    const ex = await env.DB.prepare('SELECT id FROM usuarios WHERE email = ?1').bind(email).first();
    if (ex) return json(200, { ok: true, id: ex.id, existente: true });
    const id = uuid();
    await env.DB.prepare('INSERT INTO usuarios (id, email, nome, uf, perfil, criado_em) VALUES (?1,?2,?3,?4,?5,?6)').bind(id, email, nome, uf, perfil, now()).run();
    await audit(env, admin, 'criar_usuario', id, { email });
    return json(200, { ok: true, id, existente: false });
  }
  let mm;
  if ((mm = path.match(/^\/admin\/usuarios\/([^/]+)(\/[a-z-]+)?$/))) {
    const u = await getUser(env, decodeURIComponent(mm[1]));
    const acao = mm[2] || '';
    if (m === 'GET' && !acao) {
      const p = await planoEfetivo(env, u);
      const rel = (await env.DB.prepare('SELECT id, criado_em, ciclo, tipo, uf, cargo, nivel, formatos, status, estornado_por FROM relatorios WHERE usuario_id = ?1 ORDER BY criado_em DESC LIMIT 100').bind(u.id).all()).results;
      return json(200, { usuario: { ...publicUser(u), status: u.status, cortesia_ate: u.cortesia_ate, cortesia_limite: u.cortesia_limite, cortesia_motivo: u.cortesia_motivo, stripe_customer_id: u.stripe_customer_id },
        plano: p, usados: await usoNoCiclo(env, u.id, p.ciclo), relatorios: rel });
    }
    if (m === 'POST' && acao === '/cortesia') {
      const b = await readJson(request);
      const dias = Math.max(1, Math.min(Number(b.dias) || 30, 3660));
      const limite = b.limite ? Math.max(1, Math.min(Number(b.limite), 10000)) : null;
      const ate = now() + dias * 86400;
      await env.DB.prepare('UPDATE usuarios SET cortesia_ate = ?2, cortesia_limite = ?3, cortesia_motivo = ?4 WHERE id = ?1')
        .bind(u.id, ate, limite, String(b.motivo || '').slice(0, 200) || null).run();
      await audit(env, admin, 'cortesia', u.id, { dias, limite, motivo: b.motivo });
      return json(200, { ok: true, cortesia_ate: ate });
    }
    if (m === 'DELETE' && acao === '/cortesia') {
      await env.DB.prepare('UPDATE usuarios SET cortesia_ate = NULL, cortesia_limite = NULL, cortesia_motivo = NULL WHERE id = ?1').bind(u.id).run();
      await audit(env, admin, 'cortesia_remover', u.id);
      return json(200, { ok: true });
    }
    if (m === 'POST' && acao === '/bloquear') {
      if (isAdminEmail(env, u.email)) throw new HttpError(400, 'Não é possível bloquear um administrador.');
      await env.DB.prepare("UPDATE usuarios SET status = 'bloqueado' WHERE id = ?1 AND status = 'ativo'").bind(u.id).run();
      await destroyAllSessions(env, u.id);
      await audit(env, admin, 'bloquear', u.id);
      return json(200, { ok: true });
    }
    if (m === 'POST' && acao === '/desbloquear') {
      await env.DB.prepare("UPDATE usuarios SET status = 'ativo' WHERE id = ?1 AND status = 'bloqueado'").bind(u.id).run();
      await audit(env, admin, 'desbloquear', u.id);
      return json(200, { ok: true });
    }
    if (m === 'POST' && acao === '/enviar-codigo') {
      if (u.status !== 'ativo') throw new HttpError(400, 'Conta não está ativa.');
      const ip = await guardEmissao(env, request, u.email);
      await emitirCodigo(env, request, u.email, u.email_verificado_em ? 'login' : 'cadastro', u.nome, ip);
      await audit(env, admin, 'enviar_codigo', u.id);
      return json(200, { ok: true });
    }
    if (m === 'POST' && acao === '/estornar-relatorio') {
      const b = await readJson(request);
      const r = await env.DB.prepare("UPDATE relatorios SET status = 'estornado', estornado_por = ?3 WHERE id = ?1 AND usuario_id = ?2 AND status != 'estornado'")
        .bind(String(b.relatorio_id || ''), u.id, 'admin:' + admin).run();
      if (!r.meta.changes) throw new HttpError(404, 'Relatório não encontrado ou já estornado.');
      await audit(env, admin, 'estornar', u.id, { relatorio: b.relatorio_id });
      return json(200, { ok: true });
    }
  }
  throw new HttpError(404, 'Rota não encontrada.');
}
