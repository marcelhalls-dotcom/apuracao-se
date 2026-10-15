// Contadores atômicos no D1 (hora/dia). O binding de Rate Limiting (RL_BURST) é só a primeira barreira contra rajadas.
import { now } from './http.js';
const hourKey = (t = new Date()) => t.toISOString().slice(0, 13);
const dayKey = (t = new Date()) => t.toISOString().slice(0, 10);

export async function bump(env, chave, ttlSec) {
  const r = await env.DB.prepare(
    `INSERT INTO contadores (chave, valor, expira_em) VALUES (?1, 1, ?2)
     ON CONFLICT(chave) DO UPDATE SET
       valor = CASE WHEN contadores.expira_em <= ?3 THEN 1 ELSE contadores.valor + 1 END,
       expira_em = CASE WHEN contadores.expira_em <= ?3 THEN ?2 ELSE contadores.expira_em END
     RETURNING valor`
  ).bind(chave, now() + ttlSec, now()).first();
  return r ? r.valor : 1;
}
export async function peek(env, chave) {
  const r = await env.DB.prepare('SELECT valor FROM contadores WHERE chave = ?1 AND expira_em > ?2').bind(chave, now()).first();
  return r ? r.valor : 0;
}
/** Verifica limites hora/dia sem incrementar. */
export async function checkHD(env, prefix, hourLim, dayLim) {
  const [h, d] = await Promise.all([peek(env, `${prefix}:h:${hourKey()}`), peek(env, `${prefix}:d:${dayKey()}`)]);
  if (h >= hourLim) return { ok: false, janela: 'hora', usados: h, limite: hourLim };
  if (d >= dayLim) return { ok: false, janela: 'dia', usados: d, limite: dayLim };
  return { ok: true, h, d };
}
export async function bumpHD(env, prefix) {
  const [h, d] = await Promise.all([bump(env, `${prefix}:h:${hourKey()}`, 7200), bump(env, `${prefix}:d:${dayKey()}`, 172800)]);
  return { h, d };
}
export async function burst(env, key) {
  if (!env.RL_BURST) return true;
  try { const { success } = await env.RL_BURST.limit({ key }); return success; } catch { return true; }
}
