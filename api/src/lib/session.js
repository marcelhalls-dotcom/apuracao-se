import { getCookie, sessionCookie, now } from './http.js';
import { randomToken, sha256, timingSafeEqual } from './crypto.js';

export async function createSession(env, usuarioId, ua) {
  const token = randomToken(32);
  const days = Number(env.SESSION_DAYS || 30);
  const t = now();
  await env.DB.prepare('INSERT INTO sessoes (token_hash, usuario_id, criada_em, expira_em, ultimo_uso, user_agent) VALUES (?1,?2,?3,?4,?3,?5)')
    .bind(await sha256(token), usuarioId, t, t + days * 86400, String(ua || '').slice(0, 160)).run();
  return { token, cookie: sessionCookie(env, token, days * 86400) };
}

/** Lê a sessão do cookie. Renova a validade (janela deslizante) no máximo 1x/hora. */
export async function getSession(request, env) {
  const tok = getCookie(request, env.COOKIE_NAME || '__Host-cmv');
  if (!tok || tok.length < 20 || tok.length > 100) return null;
  const h = await sha256(tok);
  const row = await env.DB.prepare(
    `SELECT s.token_hash, s.usuario_id, s.expira_em, s.ultimo_uso, u.* FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token_hash = ?1`).bind(h).first();
  const t = now();
  if (!row || row.expira_em <= t || row.status !== 'ativo') return null;
  if (!row.ultimo_uso || t - row.ultimo_uso > 3600) {
    const days = Number(env.SESSION_DAYS || 30);
    await env.DB.prepare('UPDATE sessoes SET ultimo_uso = ?2, expira_em = ?3 WHERE token_hash = ?1').bind(h, t, t + days * 86400).run();
  }
  return { tokenHash: h, user: row };
}
export async function destroySession(env, tokenHash) {
  await env.DB.prepare('DELETE FROM sessoes WHERE token_hash = ?1').bind(tokenHash).run();
}
export async function destroyAllSessions(env, usuarioId) {
  await env.DB.prepare('DELETE FROM sessoes WHERE usuario_id = ?1').bind(usuarioId).run();
}
export function isAdminEmail(env, email) {
  const list = String(env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return !!email && list.includes(String(email).toLowerCase());
}
export function bearerIsAdmin(request, env) {
  const h = request.headers.get('Authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  return !!env.ADMIN_TOKEN && !!tok && timingSafeEqual(tok, env.ADMIN_TOKEN);
}
