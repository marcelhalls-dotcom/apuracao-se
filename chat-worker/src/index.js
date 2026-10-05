import CONTEXT from '../context.json';

const SYSTEM_BASE = `Você é o assistente oficial do painel "Apuração Sergipe" (marcelhalls-dotcom.github.io/apuracao-se).
Responda SEMPRE em português do Brasil, de forma clara e objetiva.

ESCOPO PERMITIDO:
- Eleições em Sergipe 2026 (Governador, Senador, Dep. Federal, Dep. Estadual)
- Presidente 2026 no Brasil e o recorte de Sergipe
- Comparativos/referências a 2022 quando houver no contexto
- Suplentes, cadeiras por partido/federação
- Votos por município, zona, bairro e colégio quando houver no BLOCO_RETRIEVAL ou no CONTEXTO_DADOS

FORA DE ESCOPO: qualquer outro tema. Recuse educadamente.

REGRAS DE DADOS:
- Use APENAS números do CONTEXTO_DADOS e do BLOCO_RETRIEVAL (origem TSE / arquivos do painel).
- NUNCA invente votos. Se faltar o detalhe, diga que não está disponível.
- Cite brevemente a fonte TSE.
- Quando o BLOCO_RETRIEVAL trouxer ranking municipal ou detalhe de bairro/zona, use esses números com prioridade.`;

const CARGO_LABEL = { '1': 'Presidente', '3': 'Governador', '5': 'Senador', '6': 'Dep. Federal', '7': 'Dep. Estadual' };

function corsHeaders(allowed) {
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP')
    || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || '0.0.0.0';
}

function dayKey(d = new Date()) { return d.toISOString().slice(0, 10); }
function hourKey(d = new Date()) { return d.toISOString().slice(0, 13); }

async function checkRate(env, ip) {
  const hourLimit = Number(env.RATE_HOUR || 20);
  const dayLimit = Number(env.RATE_DAY || 60);
  const kH = `rl:h:${ip}:${hourKey()}`;
  const kD = `rl:d:${ip}:${dayKey()}`;
  const [cH, cD] = await Promise.all([env.RATE.get(kH), env.RATE.get(kD)]);
  const nH = Number(cH || 0);
  const nD = Number(cD || 0);
  if (nH >= hourLimit) return { ok: false, msg: `Limite horário atingido (${hourLimit} perguntas/hora). Tente novamente mais tarde.` };
  if (nD >= dayLimit) return { ok: false, msg: `Limite diário atingido (${dayLimit} perguntas/dia). Volte amanhã.` };
  await Promise.all([
    env.RATE.put(kH, String(nH + 1), { expirationTtl: 7200 }),
    env.RATE.put(kD, String(nD + 1), { expirationTtl: 172800 }),
  ]);
  return { ok: true, remainingHour: hourLimit - nH - 1, remainingDay: dayLimit - nD - 1 };
}

function sanitizeMessages(input, maxChars, maxHist, histTrunc) {
  if (!Array.isArray(input)) return { error: 'Campo messages inválido.' };
  const cleaned = [];
  for (const m of input) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    let content = String(m.content || '').trim();
    if (!content) continue;
    cleaned.push({ role: m.role, content });
  }
  if (!cleaned.length) return { error: 'Envie pelo menos uma mensagem.' };
  if (cleaned[cleaned.length - 1].role !== 'user') return { error: 'A última mensagem deve ser do usuário.' };

  // Só a pergunta nova do usuário é limitada; histórico antigo é truncado (não rejeitado).
  const last = cleaned[cleaned.length - 1];
  if (last.content.length > maxChars) {
    return { error: `Cada pergunta pode ter no máximo ${maxChars} caracteres.` };
  }

  const sliced = cleaned.slice(-maxHist);
  const trunc = Math.max(200, Number(histTrunc) || 1500);
  return {
    messages: sliced.map((m, i) => {
      const isLast = i === sliced.length - 1;
      if (isLast) return m;
      if (m.content.length <= trunc) return m;
      return { role: m.role, content: m.content.slice(0, trunc) + '…' };
    }),
  };
}

function normKey(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

async function cachedJson(url) {
  const cache = caches.default;
  const creq = new Request(url, { method: 'GET' });
  let hit = await cache.match(creq);
  if (hit) {
    try { return await hit.json(); } catch { /* refetch */ }
  }
  const res = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error('fetch ' + res.status + ' ' + url);
  const data = await res.json();
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
  try { await cache.put(creq, new Response(JSON.stringify(data), { headers })); } catch { /* ignore */ }
  return data;
}

function detectCargos(text) {
  const t = text.toLowerCase();
  const found = [];
  const rules = [
    [/dep(utado)?s?\s*estadua|\bestadual\b|alese/, '7'],
    [/dep(utado)?s?\s*feder|\bfederal\b|c[aâ]mara/, '6'],
    [/senador|\bsenado\b/, '5'],
    [/governador|\bgoverno\b/, '3'],
    [/presidente|presid[eê]ncia/, '1'],
  ];
  for (const [re, c] of rules) if (re.test(t)) found.push(c);
  return [...new Set(found)];
}

function detectMuns(text, munIndex) {
  const key = normKey(text);
  const hits = [];
  const aliases = Object.entries(munIndex.aliases || {}).sort((a, b) => b[0].length - a[0].length);
  const seen = new Set();
  for (const [alias, mi] of aliases) {
    if (alias.length < 5) continue;
    if (key.includes(alias) && !seen.has(mi)) {
      seen.add(mi);
      const meta = (munIndex.muns || []).find(m => m.i === mi);
      if (meta) hits.push(meta);
    }
  }
  return hits;
}

function softNorm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/BAPTISTA/g, 'BATISTA')
    .replace(/[^A-Z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectCandidates(text, mapaIndex) {
  const key = normKey(text);
  const hits = [];
  for (const [cargo, list] of Object.entries(mapaIndex.cargos || {})) {
    for (const c of list) {
      const n = String(c.n);
      const nk = normKey(c.nm || '');
      const nuk = normKey(c.nu || '');
      const numHit = new RegExp(`(?:^|[^0-9])${n}(?:[^0-9]|$)`).test(text);
      const nameHit = (nk.length >= 5 && key.includes(nk)) || (nuk.length >= 5 && key.includes(nuk));
      let partial = false;
      const nameParts = `${c.nm || ''} ${c.nu || ''}`.split(/\s+/).filter(p => normKey(p).length >= 5);
      if (nameParts.length >= 2) {
        const a = normKey(nameParts[0]);
        const b = normKey(nameParts[nameParts.length - 1]);
        if (a.length >= 5 && b.length >= 5 && key.includes(a) && key.includes(b)) partial = true;
      }
      // nome de urna multi-token: todos tokens >=4 no texto (ex.: MARCEL + ENFERMAGEM)
      if (!nameHit && !partial && nuk.length >= 8) {
        const utoks = softNorm(c.nu || '').split(' ').filter(t => t.length >= 4);
        if (utoks.length >= 2 && utoks.every(t => key.includes(t))) partial = true;
      }
      if (!nameHit && !partial) {
        const tokens = `${c.nm || ''} ${c.nu || ''}`.split(/\s+/).map(normKey).filter(t => t.length >= 5);
        if (tokens.some(t => t.length >= 6 && key.includes(t))) partial = true;
      }
      if (numHit || nameHit || partial) {
        hits.push({ cargo, n, nm: c.nm, nu: c.nu, sg: c.sg, t: c.t, a: c.a });
      }
    }
  }
  const uniq = [];
  const sk = new Set();
  for (const h of hits) {
    const k = h.cargo + ':' + h.n;
    if (sk.has(k)) continue;
    sk.add(k);
    uniq.push(h);
  }
  // Prefer urna-name / fuller matches: score by overlap with query
  const score = (c) => {
    let s = 0;
    const nu = normKey(c.nu || '');
    const nm = normKey(c.nm || '');
    if (nu && key.includes(nu)) s += 100;
    if (nm && key.includes(nm)) s += 80;
    for (const t of softNorm(c.nu || '').split(' ')) if (t.length >= 5 && key.includes(t)) s += 10;
    for (const t of softNorm(c.nm || '').split(' ')) if (t.length >= 5 && key.includes(t)) s += 4;
    return s;
  };
  uniq.sort((a, b) => score(b) - score(a));
  if (uniq.length && score(uniq[0]) >= 100) {
    return uniq.filter(c => score(c) >= 50).slice(0, 6);
  }
  return uniq.slice(0, 10);
}

function extractLocalQuery(text) {
  const m = String(text || '').match(
    /col[eé]gio\s+([^,.?!\n]+)|escola\s+([^,.?!\n]+)|local(?:\s+de\s+vota[cç][aã]o)?\s+([^,.?!\n]+)/i
  );
  if (!m) return '';
  return softNorm(m[1] || m[2] || m[3] || '');
}

function findLocalsByQuery(geo, querySoft, limit = 5) {
  if (!querySoft || querySoft.length < 4) return [];
  const qTokens = querySoft.split(' ').filter(t => t.length >= 3 && !['COLEGIO', 'ESCOLA', 'EMEF', 'CE', 'EE'].includes(t));
  if (!qTokens.length) return [];
  const scored = [];
  for (let i = 0; i < (geo.loc || []).length; i++) {
    const L = geo.loc[i];
    const nk = softNorm(L.nm || '');
    if (!nk) continue;
    let hit = 0;
    for (const t of qTokens) if (nk.includes(t)) hit++;
    if (hit < qTokens.length) continue;
    // prefer shorter names / exact-ish
    const bonus = nk.includes(qTokens.join(' ')) ? 5 : 0;
    scored.push({ i, L, score: hit * 10 + bonus - Math.min(nk.length, 80) / 100 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function votesAtLocal(cand, locIdx) {
  let v = 0;
  for (const pair of cand.v || []) {
    if (pair[0] === locIdx) v += pair[1] || 0;
  }
  return v;
}

function wantsGeoDetail(text) {
  const t = text.toLowerCase();
  return /bairro|zona|col[eé]gio|local de vota|escola|seção|secao/.test(t);
}

function aggregateCandidateInMun(geo, cand, munIdx, mode) {
  const locs = geo.loc || [];
  const by = new Map();
  let total = 0;
  for (const pair of cand.v || []) {
    const li = pair[0], v = pair[1];
    const L = locs[li];
    if (!L || L.m !== munIdx || !v) continue;
    total += v;
    let k;
    if (mode === 'zona') k = 'Zona ' + L.z;
    else if (mode === 'local') k = (L.nm || ('Local ' + L.nl)) + (L.nl ? ` (#${L.nl})` : '');
    else k = L.b || 'Sem bairro';
    by.set(k, (by.get(k) || 0) + v);
  }
  const top = [...by.entries()].map(([nm, v]) => ({ nm, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, mode === 'local' ? 15 : 12);
  return { total, top };
}

async function buildRetrieval(env, messages) {
  const pages = (env.PAGES_BASE || 'https://marcelhalls-dotcom.github.io/apuracao-se').replace(/\/$/, '');
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const blob = messages.map(m => m.content).join('\n');
  // Pergunta atual manda; histórico só como fallback (evita "contaminar" com nomes de turnos anteriores)
  const text = lastUser || blob;

  const out = { fonte: 'mapa TSE (arquivos do painel)', itens: [] };

  let munIndex, mapaIndex, geo;
  try {
    munIndex = await cachedJson(`${pages}/mapa/mun-index.json`);
  } catch (e) {
    out.erro = 'Não foi possível carregar índice de municípios.';
    return out;
  }
  try {
    mapaIndex = await cachedJson(`${pages}/mapa/index.json?v=nu1`);
  } catch (e) {
    mapaIndex = { cargos: {} };
  }

  let muns = detectMuns(lastUser, munIndex);
  if (!muns.length) muns = detectMuns(blob, munIndex);
  let cargos = detectCargos(lastUser);
  if (!cargos.length) cargos = detectCargos(blob);
  let cands = detectCandidates(lastUser, mapaIndex);
  if (!cands.length) cands = detectCandidates(blob, mapaIndex);

  // defaults when mun asked without cargo: provide all SE cargos
  if (muns.length && !cargos.length && !cands.length) cargos = ['7', '6', '5', '3', '1'];
  // if candidate implies cargo
  for (const c of cands) if (!cargos.includes(c.cargo)) cargos.push(c.cargo);
  // "mais votado" / "top" with mun -> need ranking
  const wantsRank = /mais\s+votad|top\s*\d+|ranking|quem\s+(foi|venceu|ganhou)/i.test(text);

  // Fetch mun rankings
  for (const mun of muns.slice(0, 3)) {
    try {
      const munData = await cachedJson(`${pages}/mapa/mun/${mun.cd}.json`);
      const slice = { municipio: munData.nm, cd: munData.cd, rankings: {} };
      const useCargos = cargos.length ? cargos : Object.keys(munData.cargos || {});
      for (const cg of useCargos) {
        const rows = (munData.cargos && munData.cargos[cg]) || [];
        const topN = /top\s*5/i.test(text) ? 5 : (/top\s*(\d+)/i.test(text) ? Number(RegExp.$1) : (wantsRank ? 10 : 8));
        slice.rankings[CARGO_LABEL[cg] || cg] = rows.slice(0, Math.min(topN, 15)).map(r => ({
          numero: r.n, nome: r.nm, partido: r.sg, votos_no_municipio: r.v, votos_totais_se: r.t,
        }));
      }
      // candidate-specific totals in this mun
      if (cands.length) {
        slice.candidatos_pedidos = [];
        for (const c of cands.slice(0, 4)) {
          const rows = (munData.cargos && munData.cargos[c.cargo]) || [];
          const hit = rows.find(r => String(r.n) === String(c.n));
          slice.candidatos_pedidos.push({
            cargo: CARGO_LABEL[c.cargo] || c.cargo,
            numero: c.n, nome: c.nm || (hit && hit.nm), partido: c.sg || (hit && hit.sg),
            votos_no_municipio: hit ? hit.v : 0,
            votos_totais_se: c.t || (hit && hit.t) || 0,
          });
        }
      }
      out.itens.push(slice);
    } catch (e) {
      out.itens.push({ municipio: mun.nm, erro: 'Falha ao ler ranking municipal' });
    }
  }

  // Bairro/zona/local detail for candidate (+ mun opcional)
  if (wantsGeoDetail(text) && cands.length) {
    try {
      geo = await cachedJson(`${pages}/mapa/geo-se.json`);
    } catch { geo = null; }
    if (geo) {
      const mode = /zona/.test(text.toLowerCase()) ? 'zona' : (/col[eé]gio|local|escola/.test(text.toLowerCase()) ? 'local' : 'bairro');
      const localQ = extractLocalQuery(text);
      const localHits = mode === 'local' ? findLocalsByQuery(geo, localQ, 5) : [];

      // Match exato/fuzzy de colégio/local — mesmo sem município no texto
      if (localHits.length && cands.length) {
        for (const c of cands.slice(0, 2)) {
          try {
            const cand = await cachedJson(`${pages}/mapa/${c.cargo}/${c.n}.json`);
            const locais = [];
            for (const hit of localHits.slice(0, 3)) {
              const L = hit.L;
              const munMeta = (munIndex.muns || []).find(m => m.i === L.m);
              locais.push({
                local: L.nm,
                numero_local: L.nl,
                bairro: L.b,
                zona: L.z,
                municipio: munMeta ? munMeta.nm : String(L.m),
                votos_no_local: votesAtLocal(cand, hit.i),
              });
            }
            out.itens.push({
              detalhe: 'local_exato',
              candidato: {
                cargo: CARGO_LABEL[c.cargo] || c.cargo,
                numero: c.n,
                nome: cand.nm || c.nm,
                nome_urna: c.nu || cand.nu || null,
                partido: cand.sg || c.sg,
              },
              consulta_local: localQ,
              locais,
            });
          } catch (e) {
            out.itens.push({ detalhe: 'local_exato', candidato: c.n, erro: 'Falha ao detalhar local do candidato' });
          }
        }
      } else if (muns.length) {
        for (const mun of muns.slice(0, 2)) {
          for (const c of cands.slice(0, 2)) {
            try {
              const cand = await cachedJson(`${pages}/mapa/${c.cargo}/${c.n}.json`);
              const agg = aggregateCandidateInMun(geo, cand, mun.i, mode);
              out.itens.push({
                detalhe: mode,
                municipio: mun.nm,
                candidato: {
                  cargo: CARGO_LABEL[c.cargo] || c.cargo,
                  numero: c.n,
                  nome: cand.nm || c.nm,
                  nome_urna: c.nu || null,
                  partido: cand.sg || c.sg,
                },
                votos_no_municipio: agg.total,
                top: agg.top,
              });
            } catch (e) {
              out.itens.push({ detalhe: mode, municipio: mun.nm, candidato: c.n, erro: 'Falha ao detalhar mapa do candidato' });
            }
          }
        }
      }
    }
  }

  // Candidate without mun: still useful state totals already in CONTEXT; skip
  if (!out.itens.length && cands.length) {
    out.itens.push({
      nota: 'Candidatos mencionados (totais estaduais no índice); peça o município para detalhe local.',
      candidatos: cands.slice(0, 6).map(c => ({ cargo: CARGO_LABEL[c.cargo] || c.cargo, numero: c.n, nome: c.nm, partido: c.sg, votos_se: c.t })),
    });
  }

  out.detectado = {
    municipios: muns.map(m => m.nm),
    cargos: cargos.map(c => CARGO_LABEL[c] || c),
    candidatos: cands.slice(0, 8).map(c => `${c.n} ${c.nu || c.nm} (${CARGO_LABEL[c.cargo] || c.cargo})`),
  };
  return out;
}

export default {
  async fetch(request, env) {
    const allowed = env.ALLOWED_ORIGIN || 'https://marcelhalls-dotcom.github.io';
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(allowed);

    if (request.method === 'OPTIONS') {
      if (origin && origin !== allowed) return new Response('CORS', { status: 403, headers: cors });
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === 'GET') {
      return json(200, {
        ok: true,
        service: 'apuracao-se-chat',
        scope: 'Eleições Sergipe 2026/2022 + Presidente BR/SE + mapa municipal',
        limits: {
          max_chars: Number(env.MAX_MSG_CHARS || 1000),
          max_history: Number(env.MAX_HISTORY || 8),
          rate_hour: Number(env.RATE_HOUR || 20),
          rate_day: Number(env.RATE_DAY || 60),
        },
      }, cors);
    }

    if (request.method !== 'POST') return json(405, { error: 'Use POST /chat' }, cors);
    if (origin && origin !== allowed) return json(403, { error: 'Origem não permitida.' }, cors);

    const url = new URL(request.url);
    if (url.pathname !== '/' && url.pathname !== '/chat') return json(404, { error: 'Não encontrado' }, cors);

    let body;
    try { body = await request.json(); }
    catch { return json(400, { error: 'JSON inválido.' }, cors); }

    const maxChars = Number(env.MAX_MSG_CHARS || 1000);
    const maxHist = Number(env.MAX_HISTORY || 8);
    const histTrunc = Number(env.HIST_TRUNC_CHARS || 1500);
    const parsed = sanitizeMessages(body.messages, maxChars, maxHist, histTrunc);
    if (parsed.error) return json(400, { error: parsed.error }, cors);

    const ip = clientIp(request);
    const rate = await checkRate(env, ip);
    if (!rate.ok) return json(429, { error: rate.msg }, cors);
    if (!env.AI_ROUTER_API_KEY) return json(500, { error: 'Serviço temporariamente indisponível (config).' }, cors);

    let retrieval = { itens: [] };
    try {
      retrieval = await buildRetrieval(env, parsed.messages);
    } catch (e) {
      retrieval = { erro: 'Falha na recuperação de dados municipais.', itens: [] };
    }

    const system = `${SYSTEM_BASE}

CONTEXTO_DADOS (JSON compacto estadual):
${JSON.stringify(CONTEXT)}

BLOCO_RETRIEVAL (município/bairro/zona sob demanda a partir dos arquivos mapa do painel):
${JSON.stringify(retrieval)}`;

    const routerBase = (env.ROUTER_BASE || '').replace(/\/$/, '');
    const model = env.ROUTER_MODEL || 'cademeuvoto';
    const maxTokens = Number(env.MAX_TOKENS || 1800);

    let upstream;
    try {
      upstream = await fetch(`${routerBase}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AI_ROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, ...parsed.messages],
          max_tokens: maxTokens,
          temperature: 0.2,
        }),
      });
    } catch {
      return json(502, { error: 'Falha ao contactar o modelo. Tente de novo.' }, cors);
    }

    const raw = await upstream.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = null; }
    if (!upstream.ok) {
      return json(502, { error: 'O modelo não respondeu agora. Tente novamente em instantes.', status: upstream.status }, cors);
    }
    const answer = (((data || {}).choices || [])[0] || {}).message?.content || '';
    if (!answer.trim()) return json(502, { error: 'Resposta vazia do modelo.' }, cors);

    return json(200, {
      reply: answer.trim(),
      model: (data && data.model) || model,
      remaining: { hour: rate.remainingHour, day: rate.remainingDay },
      retrieval: retrieval.detectado || null,
    }, cors);
  },
};
