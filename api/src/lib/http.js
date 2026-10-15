// Utilitários HTTP: JSON, CORS com credenciais, cookies.
export function allowList(env) {
  return String(env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
}
export function originInfo(request, env) {
  const list = allowList(env);
  const origin = request.headers.get('Origin') || '';
  const ok = !!origin && list.includes(origin);
  return { origin, ok, list };
}
export function corsHeaders(request, env) {
  const { origin, ok, list } = originInfo(request, env);
  return {
    'Access-Control-Allow-Origin': ok ? origin : (list[0] || ''),
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
export function json(status, body, headers = {}) {
  const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) v.forEach(x => h.append(k, x)); else if (v != null) h.set(k, v);
  }
  return new Response(JSON.stringify(body), { status, headers: h });
}
export async function readJson(request, max = 20000) {
  const ct = request.headers.get('Content-Type') || '';
  if (!ct.toLowerCase().includes('application/json')) { const e = new Error('Envie JSON (Content-Type: application/json).'); e.status = 415; throw e; }
  const txt = await request.text();
  if (txt.length > max) { const e = new Error('Corpo grande demais.'); e.status = 413; throw e; }
  try { return JSON.parse(txt || '{}') || {}; } catch { const e = new Error('JSON inválido.'); e.status = 400; throw e; }
}
export function getCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}
export function sessionCookie(env, token, maxAgeSec) {
  const name = env.COOKIE_NAME || '__Host-cmv';
  // __Host-: Secure + Path=/ + sem Domain → vale só para api.cademeuvoto.com.br
  return `${name}=${encodeURIComponent(token)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}
export function clearCookie(env) {
  const name = env.COOKIE_NAME || '__Host-cmv';
  return `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}
export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || '0.0.0.0';
}
export const now = () => Math.floor(Date.now() / 1000);
export class HttpError extends Error {
  constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra || {}; }
}
