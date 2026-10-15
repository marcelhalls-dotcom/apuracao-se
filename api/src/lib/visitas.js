// Contador anônimo de visitantes por estado (08/10/2026).
//
// Privacidade: o servidor não guarda IP, cookie, hash nem identificador. Quem sabe se o navegador já foi contado hoje é
// o próprio navegador (marca em localStorage com a data BRT). Ao abrir o site, a 1ª chamada a /me leva
// ?visita=1 (1º acesso do dia neste navegador) ou ?acesso=1 (demais aberturas). O Worker só soma +1 numa linha
// (dia, local) do D1, com o estado vindo da geolocalização aproximada da Cloudflare (request.cf.regionCode).
//
// Fora dos totais (linha '_teste'): navigator.webdriver (wd=1, Playwright/Selenium), navegador sem interface
// (HeadlessChrome etc.), robôs/curl, e a saída dos testes automáticos (WARP da Cloudflare atendido em IAD,
// ou "Brasil" atendido em IAD — um visitante real no Brasil não cai em Ashburn/EUA).
import { now } from './http.js';

export const UFS_BR = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
const UFSET = new Set(UFS_BR);
const ROBO_RE = /headless|playwright|puppeteer|selenium|webdriver|phantom|lighthouse|pagespeed|\bbot\b|bot\/|crawl|spider|slurp|curl\/|wget|python|node-fetch|undici|axios|go-http|java\/|okhttp|httpclient|scrapy|preview|facebookexternalhit|whatsapp/i;

/** Dia em BRT (UTC−3, sem horário de verão) — AAAA-MM-DD. */
export function diaBRT(ms = Date.now()) { return new Date(ms - 3 * 3600 * 1000).toISOString().slice(0, 10); }

/** Decide se e onde contar. Retorna null (não conta) ou { local, visitante }. Função pura (testável). */
export function classificarVisita({ params, ua, cf, originOk }) {
  const tipo = params.get('visita') === '1' ? 'visita' : params.get('acesso') === '1' ? 'acesso' : null;
  if (!tipo || !originOk) return null;             // só a 1ª chamada da página, vinda do próprio site
  const c = cf || {};
  const pais = String(c.country || '').toUpperCase();
  const colo = String(c.colo || '').toUpperCase();
  const teste = params.get('wd') === '1' || !ua || ROBO_RE.test(ua)
    || (colo === 'IAD' && (pais === 'BR' || Number(c.asn) === 13335));
  let local;
  if (teste) local = '_teste';
  else if (pais === 'BR') { const uf = String(c.regionCode || '').toUpperCase(); local = UFSET.has(uf) ? 'BR-' + uf : 'BR-??'; }
  else local = /^[A-Z]{2}$/.test(pais) && pais !== 'XX' && pais !== 'T1' ? pais : '??';
  return { local, visitante: tipo === 'visita' ? 1 : 0 };
}

export async function registrarVisita(env, v, ms = Date.now()) {
  await env.DB.prepare(
    `INSERT INTO visitas_dia (dia, local, visitantes, acessos) VALUES (?1, ?2, ?3, 1)
     ON CONFLICT(dia, local) DO UPDATE SET visitantes = visitantes + excluded.visitantes, acessos = acessos + 1`
  ).bind(diaBRT(ms), v.local, v.visitante).run();
}

/** Para /me: conta em segundo plano (não atrasa a resposta; erro aqui nunca derruba o /me). */
export function contarVisita(request, env, ctx, url, originOk) {
  let v = null;
  try {
    let cf = request.cf;
    // Só no desenvolvimento local (DEV_MODE=1 + e-mail mock): o teste informa a geolocalização simulada.
    if (env.DEV_MODE === '1' && env.EMAIL_PROVIDER === 'mock' && request.headers.get('X-Dev-Cf')) cf = JSON.parse(request.headers.get('X-Dev-Cf'));
    v = classificarVisita({ params: url.searchParams, ua: request.headers.get('User-Agent') || '', cf, originOk });
  } catch (_) {}
  if (!v) return;
  const p = registrarVisita(env, v).catch(e => console.error('[visitas]', e && e.message));
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
}

/** GET /admin/estatisticas — agregados por estado/país: hoje, 7 e 30 dias (BRT), série diária e testes ignorados. */
export async function estatisticas(env) {
  const hoje = diaBRT();
  const d = n => diaBRT(Date.now() - n * 86400000);
  const d7 = d(6), d30 = d(29);
  const rows = (await env.DB.prepare(
    'SELECT dia, local, visitantes, acessos FROM visitas_dia WHERE dia >= ?1 ORDER BY dia').bind(d30).all()).results || [];
  const desde = await env.DB.prepare('SELECT MIN(dia) AS dia FROM visitas_dia').first();
  const per = desdeDia => {
    const m = new Map(); let vis = 0, ac = 0;
    for (const r of rows) {
      if (r.dia < desdeDia || r.local === '_teste') continue;
      const o = m.get(r.local) || { local: r.local, visitantes: 0, acessos: 0 };
      o.visitantes += r.visitantes; o.acessos += r.acessos; m.set(r.local, o);
      vis += r.visitantes; ac += r.acessos;
    }
    const por_local = [...m.values()].sort((a, b) => b.visitantes - a.visitantes || b.acessos - a.acessos || a.local.localeCompare(b.local));
    const brasil = por_local.filter(x => x.local.startsWith('BR-'));
    return { desde: desdeDia, visitantes: vis, acessos: ac,
      brasil: { visitantes: brasil.reduce((s, x) => s + x.visitantes, 0), acessos: brasil.reduce((s, x) => s + x.acessos, 0) },
      por_local };
  };
  const ign = desdeDia => rows.filter(r => r.local === '_teste' && r.dia >= desdeDia).reduce((s, r) => s + r.acessos, 0);
  const serie = [];
  for (let i = 29; i >= 0; i--) {
    const dia = d(i); let vis = 0, ac = 0;
    for (const r of rows) if (r.dia === dia && r.local !== '_teste') { vis += r.visitantes; ac += r.acessos; }
    serie.push({ dia, visitantes: vis, acessos: ac });
  }
  return {
    atualizado_em: now(), fuso: 'BRT (UTC-3)', hoje, contando_desde: (desde && desde.dia) || null,
    nota: 'Visitantes = navegadores no 1º acesso de cada dia (somados nos períodos). Estado pela localização aproximada da conexão. Sem IP, cookie ou dado pessoal.',
    periodos: { hoje: per(hoje), d7: per(d7), d30: per(d30) },
    ignorados_testes: { hoje: ign(hoje), d7: ign(d7), d30: ign(d30) },
    serie,
  };
}
