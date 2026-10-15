import { json, readJson, now, HttpError } from '../lib/http.js';
import { sha256, uuid } from '../lib/crypto.js';
import { planoEfetivo, usoNoCiclo } from '../lib/plan.js';
import { UFS } from './auth.js';

const TIPOS = ['candidato', 'comparar', 'resumo', 'municipio'];
const NIVEIS = ['municipio', 'local', 'secao'];
const FORMATOS = ['pdf', 'xlsx'];
const JANELA_REUSO = 24 * 3600, JANELA_ESTORNO = 15 * 60, MAX_ESTORNOS = 3;

export function specNormalizada(b) {
  const alvo = Array.isArray(b.alvo) ? b.alvo.map(String).map(s => s.slice(0, 20)).sort() : (b.alvo == null ? null : String(b.alvo).slice(0, 40));
  return { tipo: b.tipo, uf: b.uf, cargo: String(b.cargo || ''), alvo, nivel: b.nivel };
}

/** POST /relatorios/iniciar — reserva 1 relatório da cota (atômico). */
export async function iniciar(request, env, sess) {
  const b = await readJson(request);
  const u = sess.user;
  const tipo = String(b.tipo || ''), uf = String(b.uf || '').toLowerCase();
  let nivel = String(b.nivel || 'municipio');
  const formatos = (Array.isArray(b.formatos) ? b.formatos : ['pdf']).map(String).filter(f => FORMATOS.includes(f));
  if (!TIPOS.includes(tipo)) throw new HttpError(400, 'Tipo de relatório inválido.');
  if (!UFS.includes(uf)) throw new HttpError(400, 'UF inválida.');
  if (!NIVEIS.includes(nivel)) throw new HttpError(400, 'Nível inválido.');
  if (!/^[0-9]{1,2}$/.test(String(b.cargo || '0'))) throw new HttpError(400, 'Cargo inválido.');
  if (!formatos.length) formatos.push('pdf');

  const p = await planoEfetivo(env, u);
  if (p.plano !== 'pro') {
    if (nivel !== 'municipio') throw new HttpError(402, 'Detalhe por local de votação e seção é exclusivo da Assinatura.', { motivo: 'nivel', plano: p.plano });
    if (formatos.includes('xlsx')) throw new HttpError(402, 'Planilha Excel é exclusiva da Assinatura.', { motivo: 'excel', plano: p.plano });
  }
  const spec = specNormalizada({ ...b, tipo, uf, nivel });
  const specHash = await sha256(JSON.stringify(spec));
  const t = now();
  const extra = { marca_dagua: p.plano !== 'pro', licenciado_para: p.plano === 'pro' ? u.nome : null, plano: p.plano };

  // Mesmo relatório nas últimas 24 h: não conta de novo.
  const reuso = await env.DB.prepare(
    "SELECT id FROM relatorios WHERE usuario_id = ?1 AND assinatura_spec = ?2 AND criado_em > ?3 AND status IN ('iniciado','ok') ORDER BY criado_em DESC LIMIT 1"
  ).bind(u.id, specHash, t - JANELA_REUSO).first();
  if (reuso) {
    const usados = await usoNoCiclo(env, u.id, p.ciclo);
    return json(200, { ok: true, id: reuso.id, reaproveitado: true, usados, limite: p.limite, restantes: Math.max(0, p.limite - usados), ...extra });
  }

  const id = uuid();
  const r = await env.DB.prepare(
    `INSERT INTO relatorios (id, usuario_id, criado_em, ciclo, tipo, uf, cargo, alvo, nivel, formatos, assinatura_spec, status, origem)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'iniciado', ?12
     WHERE (SELECT COUNT(*) FROM relatorios WHERE usuario_id = ?2 AND ciclo = ?4 AND status != 'estornado') < ?13`
  ).bind(id, u.id, t, p.ciclo, tipo, uf, spec.cargo, JSON.stringify(spec.alvo), nivel, formatos.join(','), specHash,
    b.origem === 'chat' ? 'chat' : 'botao', p.limite).run();
  const usados = await usoNoCiclo(env, u.id, p.ciclo);
  if (!r.meta || r.meta.changes !== 1) {
    throw new HttpError(402, p.plano === 'pro'
      ? `Você usou os ${p.limite} relatórios deste ciclo. A cota renova na próxima fatura.`
      : `Você usou os ${p.limite} relatórios grátis deste mês. Assine para gerar mais, ou aguarde a renovação no dia 1º.`,
      { motivo: 'cota', plano: p.plano, usados, limite: p.limite, renova_em: p.renova_em });
  }
  return json(200, { ok: true, id, reaproveitado: false, usados, limite: p.limite, restantes: Math.max(0, p.limite - usados), ...extra });
}

async function meuRelatorio(env, u, id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, 'Relatório não encontrado.');
  const r = await env.DB.prepare('SELECT * FROM relatorios WHERE id = ?1 AND usuario_id = ?2').bind(id, u.id).first();
  if (!r) throw new HttpError(404, 'Relatório não encontrado.');
  return r;
}
export async function concluir(request, env, sess, id) {
  const r = await meuRelatorio(env, sess.user, id);
  if (r.status === 'iniciado') await env.DB.prepare("UPDATE relatorios SET status = 'ok', finalizado_em = ?2 WHERE id = ?1").bind(id, now()).run();
  return json(200, { ok: true });
}
/** Falha nos primeiros 15 min devolve o crédito (no máx. 3 por ciclo). */
export async function falhou(request, env, sess, id) {
  const r = await meuRelatorio(env, sess.user, id);
  const t = now();
  if (r.status !== 'iniciado') return json(200, { ok: true, estornado: false });
  const est = await env.DB.prepare("SELECT COUNT(*) AS n FROM relatorios WHERE usuario_id = ?1 AND ciclo = ?2 AND estornado_por = 'auto'").bind(sess.user.id, r.ciclo).first();
  if (t - r.criado_em <= JANELA_ESTORNO && (est ? est.n : 0) < MAX_ESTORNOS) {
    await env.DB.prepare("UPDATE relatorios SET status = 'estornado', estornado_por = 'auto', finalizado_em = ?2 WHERE id = ?1").bind(id, t).run();
    return json(200, { ok: true, estornado: true });
  }
  await env.DB.prepare("UPDATE relatorios SET status = 'falhou', finalizado_em = ?2 WHERE id = ?1").bind(id, t).run();
  return json(200, { ok: true, estornado: false });
}
export async function listar(request, env, sess) {
  const r = await env.DB.prepare('SELECT id, criado_em, ciclo, tipo, uf, cargo, nivel, formatos, status FROM relatorios WHERE usuario_id = ?1 ORDER BY criado_em DESC LIMIT 100').bind(sess.user.id).all();
  return json(200, { relatorios: r.results });
}
