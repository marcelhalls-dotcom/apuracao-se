// Plano efetivo e ciclo de cota.
import { now } from './http.js';

const TZ = 'America/Sao_Paulo';
export function mesBRT(ts = Date.now()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).formatToParts(new Date(ts));
  const y = p.find(x => x.type === 'year').value, m = p.find(x => x.type === 'month').value;
  return { y: Number(y), m: Number(m), key: `${y}-${m}` };
}
/** Início do próximo mês civil em BRT (UTC-3, sem horário de verão desde 2019). */
export function proximoMesBRT(ts = Date.now()) {
  const { y, m } = mesBRT(ts);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return Math.floor(Date.UTC(ny, nm - 1, 1, 3, 0, 0) / 1000);
}
const ATIVOS = new Set(['active', 'trialing']);

export async function assinaturaAtual(env, usuarioId) {
  return env.DB.prepare('SELECT * FROM assinaturas WHERE usuario_id = ?1 ORDER BY atualizado_em DESC LIMIT 1').bind(usuarioId).first();
}

export async function planoEfetivo(env, user) {
  const t = now();
  const grace = Number(env.GRACE_DAYS || 7) * 86400;
  const sub = await assinaturaAtual(env, user.id);
  if (sub) {
    const emGraca = sub.status === 'past_due' && sub.past_due_desde && (t - sub.past_due_desde) < grace;
    if (ATIVOS.has(sub.status) || emGraca) {
      return {
        plano: 'pro', origem: 'assinatura', limite: Number(env.PRO_REPORTS || 50),
        ciclo: `sub:${sub.stripe_subscription_id}:${sub.periodo_inicio || 0}`,
        renova_em: sub.periodo_fim || null,
        assinatura: { status: sub.status, cancelar_no_fim: !!sub.cancelar_no_fim, periodo_fim: sub.periodo_fim, em_tolerancia: !!emGraca,
          tolerancia_ate: emGraca ? sub.past_due_desde + grace : null },
      };
    }
  }
  if (user.cortesia_ate && user.cortesia_ate > t) {
    const mes = mesBRT();
    return {
      plano: 'pro', origem: 'cortesia', limite: Number(user.cortesia_limite || env.CORTESIA_REPORTS || 50),
      ciclo: `cort:${mes.key}`, renova_em: proximoMesBRT(), cortesia_ate: user.cortesia_ate,
      assinatura: sub ? { status: sub.status } : null,
    };
  }
  const mes = mesBRT();
  return {
    plano: 'free', origem: null, limite: Number(env.FREE_REPORTS || 2),
    ciclo: `free:${mes.key}`, renova_em: proximoMesBRT(),
    assinatura: sub ? { status: sub.status, cancelar_no_fim: !!sub.cancelar_no_fim } : null,
  };
}

export async function usoNoCiclo(env, usuarioId, ciclo) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM relatorios WHERE usuario_id = ?1 AND ciclo = ?2 AND status != 'estornado'").bind(usuarioId, ciclo).first();
  return r ? r.n : 0;
}
