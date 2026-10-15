import { json, readJson, clientIp, now, HttpError, clearCookie } from '../lib/http.js';
import { randomCode6, hmac, sha256, uuid, timingSafeEqual } from '../lib/crypto.js';
import { checkHD, bumpHD, bump, peek, burst } from '../lib/rate.js';
import { verifyTurnstile } from '../lib/turnstile.js';
import { createSession, destroySession, destroyAllSessions } from '../lib/session.js';
import { enviarEmail } from '../email/send.js';
import { emailCodigo } from '../email/templates.js';
import { mePayload } from './conta.js';

export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
export const PERFIS = ['candidato', 'campanha', 'imprensa', 'pesquisa', 'orgao_publico', 'cidadao', 'outro'];
export const UFS = ['ac','al','am','ap','ba','ce','df','es','go','ma','mg','ms','mt','pa','pb','pe','pi','pr','rj','rn','ro','rr','rs','sc','se','sp','to'];
const CODE_TTL = 600, MAX_TENT = 5, COOLDOWN = 60;
const GENERIC = 'Se houver uma conta com esse e-mail, o código chega em até 1 minuto. Veja também Spam e Promoções.';

export const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
export const normEmail = e => String(e || '').trim().toLowerCase();

async function ipHash(env, request) { return (await hmac(env.CODE_PEPPER, 'ip:' + clientIp(request))).slice(0, 32); }

/** Limites antes de emitir um código (por e-mail e por IP). Lança HttpError 429. */
async function guardEmissao(env, request, email) {
  const ip = await ipHash(env, request);
  if (!(await burst(env, 'cod:' + ip))) throw new HttpError(429, 'Muitas tentativas. Aguarde um minuto.');
  const last = await env.DB.prepare('SELECT criado_em FROM codigos WHERE email = ?1 ORDER BY criado_em DESC LIMIT 1').bind(email).first();
  if (last && now() - last.criado_em < COOLDOWN) {
    throw new HttpError(429, `Aguarde ${COOLDOWN - (now() - last.criado_em)} s para pedir outro código.`, { aguarde: COOLDOWN - (now() - last.criado_em) });
  }
  const pe = await checkHD(env, 'cod:e:' + email, 5, 10);
  if (!pe.ok) throw new HttpError(429, pe.janela === 'hora' ? 'Limite de códigos por hora atingido para este e-mail. Tente mais tarde.' : 'Limite diário de códigos atingido para este e-mail. Tente amanhã.');
  const pi = await checkHD(env, 'cod:ip:' + ip, 10, 30);
  if (!pi.ok) throw new HttpError(429, 'Muitos pedidos de código desta rede. Tente mais tarde.');
  return ip;
}

async function emitirCodigo(env, request, email, finalidade, nome, ip) {
  const codigo = randomCode6();
  const t = now();
  await env.DB.batch([
    env.DB.prepare('UPDATE codigos SET usado_em = ?2 WHERE email = ?1 AND usado_em IS NULL').bind(email, t),
    env.DB.prepare('INSERT INTO codigos (id, email, finalidade, codigo_hash, expira_em, ip_hash, criado_em) VALUES (?1,?2,?3,?4,?5,?6,?7)')
      .bind(uuid(), email, finalidade, await hmac(env.CODE_PEPPER, `${email}:${finalidade}:${codigo}`), t + CODE_TTL, ip, t),
  ]);
  await Promise.all([bumpHD(env, 'cod:e:' + email), bumpHD(env, 'cod:ip:' + ip)]);
  const m = emailCodigo({ nome, codigo, finalidade, minutos: CODE_TTL / 60, site: env.SITE_BASE });
  await enviarEmail(env, { to: email, ...m, meta: { finalidade, codigo } });
}

/** POST /auth/cadastro */
export async function cadastro(request, env) {
  const b = await readJson(request);
  const email = normEmail(b.email);
  const nome = clean(b.nome, 120);
  const telefone = clean(b.telefone, 30) || null;
  const cidade = clean(b.cidade, 80) || null;
  const uf = String(b.uf || '').toLowerCase();
  const perfil = String(b.perfil || '');
  const erros = [];
  if (nome.length < 2) erros.push('Informe seu nome.');
  if (!EMAIL_RE.test(email) || email.length > 200) erros.push('Informe um e-mail válido.');
  if (telefone && !/^[0-9()+\-.\s]{8,30}$/.test(telefone)) erros.push('WhatsApp inválido.');
  if (!UFS.includes(uf)) erros.push('Escolha o estado (UF).');
  if (!PERFIS.includes(perfil)) erros.push('Escolha o perfil.');
  if (b.aceite_termos !== true) erros.push('É preciso aceitar os Termos de uso e a Política de Privacidade.');
  if (erros.length) throw new HttpError(400, erros.join(' '), { erros });
  const ts = await verifyTurnstile(env, b.turnstile, clientIp(request));
  if (!ts.ok) throw new HttpError(403, 'Confirme que você não é um robô e tente de novo.', { motivo: ts.motivo });

  const ip0 = await ipHash(env, request);
  const pc = await checkHD(env, 'cad:ip:' + ip0, 5, 20);
  if (!pc.ok) throw new HttpError(429, 'Muitos cadastros desta rede. Tente mais tarde.');
  const ip = await guardEmissao(env, request, email);
  await bumpHD(env, 'cad:ip:' + ip0);

  const t = now();
  const ex = await env.DB.prepare('SELECT * FROM usuarios WHERE email = ?1').bind(email).first();
  if (ex && ex.status !== 'ativo') return json(200, { ok: true, mensagem: 'Enviamos um código para o seu e-mail.' });
  if (ex && ex.email_verificado_em) {
    // já tem conta: manda código de login (mesma resposta — não revela se o e-mail existe)
    await emitirCodigo(env, request, email, 'login', ex.nome, ip);
    return json(200, { ok: true, mensagem: 'Enviamos um código para o seu e-mail.' });
  }
  if (ex) {
    await env.DB.prepare(`UPDATE usuarios SET nome=?2, telefone=?3, cidade=?4, uf=?5, perfil=?6, termos_versao=?7, termos_aceitos_em=?8, optin_novidades=?9 WHERE id=?1`)
      .bind(ex.id, nome, telefone, cidade, uf, perfil, env.TERMOS_VERSAO || '', t, b.optin_novidades === true ? 1 : 0).run();
  } else {
    await env.DB.prepare(`INSERT INTO usuarios (id, email, nome, telefone, cidade, uf, perfil, termos_versao, termos_aceitos_em, optin_novidades, criado_em)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`)
      .bind(uuid(), email, nome, telefone, cidade, uf, perfil, env.TERMOS_VERSAO || '', t, b.optin_novidades === true ? 1 : 0, t).run();
  }
  await emitirCodigo(env, request, email, 'cadastro', nome, ip);
  return json(200, { ok: true, mensagem: 'Enviamos um código para o seu e-mail.' });
}

/** POST /auth/codigo — pedido de código de login (resposta sempre genérica). */
export async function pedirCodigo(request, env) {
  const b = await readJson(request);
  const email = normEmail(b.email);
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Informe um e-mail válido.');
  const ts = await verifyTurnstile(env, b.turnstile, clientIp(request));
  if (!ts.ok) throw new HttpError(403, 'Confirme que você não é um robô e tente de novo.', { motivo: ts.motivo });
  const ip = await guardEmissao(env, request, email);
  const u = await env.DB.prepare("SELECT * FROM usuarios WHERE email = ?1 AND status = 'ativo'").bind(email).first();
  if (u) await emitirCodigo(env, request, email, u.email_verificado_em ? 'login' : 'cadastro', u.nome, ip);
  else await bumpHD(env, 'cod:ip:' + ip); // conta mesmo sem enviar (evita sondagem barata)
  return json(200, { ok: true, mensagem: GENERIC });
}

/** Confere um código (usado no login e na exclusão). Retorna true/false e aplica travas. */
export async function conferirCodigo(env, request, email, codigo, finalidades) {
  const ip = await ipHash(env, request);
  const pv = await checkHD(env, 'ver:ip:' + ip, 20, 100);
  if (!pv.ok) throw new HttpError(429, 'Muitas tentativas desta rede. Tente mais tarde.');
  const lockKey = 'ver:lock:' + email;
  const errosH = await peek(env, 'ver:err:' + email + ':' + new Date().toISOString().slice(0, 13));
  if (errosH >= 10 || (await peek(env, lockKey)) > 0) throw new HttpError(429, 'Muitas tentativas erradas. Este e-mail ficou bloqueado por 1 hora.');
  await bumpHD(env, 'ver:ip:' + ip);
  const t = now();
  const row = await env.DB.prepare('SELECT * FROM codigos WHERE email = ?1 AND usado_em IS NULL AND expira_em > ?2 ORDER BY criado_em DESC LIMIT 1').bind(email, t).first();
  if (!row || !finalidades.includes(row.finalidade)) throw new HttpError(400, 'Código inválido ou expirado. Peça um novo.');
  const ok = /^\d{6}$/.test(codigo) && timingSafeEqual(row.codigo_hash, await hmac(env.CODE_PEPPER, `${email}:${row.finalidade}:${codigo}`));
  if (!ok) {
    const tent = row.tentativas + 1;
    await env.DB.prepare('UPDATE codigos SET tentativas = ?2, usado_em = CASE WHEN ?2 >= ?3 THEN ?4 ELSE usado_em END WHERE id = ?1')
      .bind(row.id, tent, MAX_TENT, t).run();
    const n = await bump(env, 'ver:err:' + email + ':' + new Date().toISOString().slice(0, 13), 7200);
    if (n >= 10) await bump(env, lockKey, 3600);
    const rest = Math.max(0, MAX_TENT - tent);
    throw new HttpError(400, rest ? `Código incorreto. Restam ${rest} tentativa(s).` : 'Código incorreto. Este código foi cancelado; peça um novo.', { restantes: rest });
  }
  await env.DB.prepare('UPDATE codigos SET usado_em = ?2 WHERE id = ?1').bind(row.id, t).run();
  return row;
}

/** POST /auth/verificar */
export async function verificar(request, env) {
  const b = await readJson(request);
  const email = normEmail(b.email);
  const codigo = String(b.codigo || '').replace(/\D/g, '');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Informe um e-mail válido.');
  await conferirCodigo(env, request, email, codigo, ['login', 'cadastro']);
  const u = await env.DB.prepare("SELECT * FROM usuarios WHERE email = ?1 AND status = 'ativo'").bind(email).first();
  if (!u) throw new HttpError(400, 'Código inválido ou expirado. Peça um novo.');
  const t = now();
  await env.DB.prepare('UPDATE usuarios SET email_verificado_em = COALESCE(email_verificado_em, ?2), ultimo_login_em = ?2 WHERE id = ?1').bind(u.id, t).run();
  const s = await createSession(env, u.id, request.headers.get('User-Agent'));
  const fresh = await env.DB.prepare('SELECT * FROM usuarios WHERE id = ?1').bind(u.id).first();
  return json(200, await mePayload(env, fresh), { 'Set-Cookie': s.cookie });
}

export async function sair(request, env, sess) {
  if (sess) await destroySession(env, sess.tokenHash);
  return json(200, { ok: true }, { 'Set-Cookie': clearCookie(env) });
}
export async function sairTodos(request, env, sess) {
  if (!sess) throw new HttpError(401, 'Entre na sua conta.');
  await destroyAllSessions(env, sess.user.id);
  return json(200, { ok: true }, { 'Set-Cookie': clearCookie(env) });
}
export { emitirCodigo, guardEmissao };
