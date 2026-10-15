import { json, HttpError } from '../lib/http.js';
import { planoEfetivo } from '../lib/plan.js';

// Somente arquivos de detalhe (local de votação/seção). Tudo que é municipal continua no bucket público.
export const PRIVADO_RE = /^mapa\/(?:[a-z]{2}\/)?(?:[1-7]\/\d{1,6}\.json|secao\/(?:secoes\.json|det-[1-7]\.json|[1-7]\/\d{1,6}\.json)|geo-loc-[a-z]{2}\.json)$/;
// Municipais 2024 e locais/bairros 2026 ("Mais votados no seu bairro"): votos por bairro (top3/) e detalhe por local/seção (det/).
// A versão grátis (só nomes, sem votos) fica no bucket público em <prefixo>/<uf>/top3-livre/ e não passa por aqui.
export const PRIVADO_M_RE = /^(?:m2024\/[a-z]{2}\/(?:top3\/\d{5}\.json|det\/\d{5}\/(?:geo|agg|11|13-loc|13-sec|13-sec-z\d{1,4})\.json)|e2026\/[a-z]{2}\/top3\/\d{5}\.json)$/;

/** GET /dados/<chave> — entrega arquivos privados a quem tem Assinatura (ou cortesia). */
export async function dados(request, env, sess, chave) {
  const bairro = PRIVADO_M_RE.test(chave);
  if (!bairro && !PRIVADO_RE.test(chave)) throw new HttpError(404, 'Arquivo não encontrado.');
  const m = chave.match(/^mapa\/([a-z]{2})\//);
  if (m && m[1] === 'se') throw new HttpError(404, 'Arquivo não encontrado.'); // SE usa a raiz legada
  if (!sess) throw new HttpError(401, bairro ? 'Entre na sua conta para ver os votos por bairro.' : 'Entre na sua conta para ver o detalhe por local de votação.', { motivo: 'login' });
  const p = await planoEfetivo(env, sess.user);
  if (p.plano !== 'pro') throw new HttpError(402, bairro ? 'Votos, percentuais e ranking completo por bairro são exclusivos da Assinatura.' : 'O detalhe por local de votação e por seção é exclusivo da Assinatura.', { motivo: 'plano', plano: p.plano });
  if (!env.DADOS_PRO) throw new HttpError(503, 'Detalhe por local de votação ainda não disponível.', { motivo: 'em-preparacao' });
  const obj = await env.DADOS_PRO.get(chave, { onlyIf: request.headers });
  if (!obj) throw new HttpError(404, 'Arquivo não encontrado.');
  const h = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, max-age=3600',
    'ETag': obj.httpEtag,
    'X-Content-Type-Options': 'nosniff',
  });
  if (!('body' in obj) || !obj.body) return new Response(null, { status: 304, headers: h });
  return new Response(obj.body, { status: 200, headers: h });
}
