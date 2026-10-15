const enc = new TextEncoder();
export function randomToken(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function randomCode6() {
  // rejeição para evitar viés de módulo
  const a = new Uint32Array(1);
  const lim = Math.floor(0xFFFFFFFF / 1000000) * 1000000;
  do { crypto.getRandomValues(a); } while (a[0] >= lim);
  return String(a[0] % 1000000).padStart(6, '0');
}
export function uuid() { return crypto.randomUUID(); }
function hex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); }
export async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
export async function hmac(secret, s) {
  if (!secret) throw new Error('pepper ausente');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(s)));
}
export function timingSafeEqual(a, b) {
  const x = enc.encode(String(a || '')), y = enc.encode(String(b || ''));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}
