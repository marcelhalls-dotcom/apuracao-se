// Portado de site/chat-worker/src/index.js (apuracao-se-chat), com controle por plano.
const SYSTEM_BASE = `Você é o assistente do "Cadê Meu Voto" (cademeuvoto.com.br), painel independente com os resultados oficiais do TSE das eleições gerais de 2026 em todo o Brasil: os 26 estados e o Distrito Federal. O 1º turno foi em 4/10/2026; o 2º turno (Presidente e Governador onde houver) é em 25/10/2026.
Responda SEMPRE em português do Brasil, de forma clara, curta e objetiva (listas quando ajudar). Números no formato brasileiro (1.234.567; 52,2%).

ESCOPO:
- Governador, Senador, Deputado Federal e Deputado Estadual (no DF: Deputado Distrital) da UF_ATIVA — e de outras UFs que vierem em CONTEXTO_OUTRAS_UFS.
- Presidente: resultado nacional (PRESIDENTE_BRASIL) e o recorte de cada UF.
- Cadeiras por partido/federação, suplentes quando houver, comparações com 2022 quando houver no contexto.
- Votos por município (no DF, zona eleitoral/região administrativa) e, para assinantes, por bairro, local de votação e seção, quando vierem no BLOCO_RETRIEVAL.
- Pedidos de relatório/PDF: diga que o painel gera o PDF e descreva o conteúdo; o sistema anexa o botão de download.
FORA DE ESCOPO: qualquer outro tema (inclusive opinião sobre candidatos, previsões e pesquisas). Recuse com educação.

REGRAS DE DADOS:
- Use APENAS números do CONTEXTO_DADOS, CONTEXTO_OUTRAS_UFS, PRESIDENTE_BRASIL e BLOCO_RETRIEVAL (origem: TSE / arquivos do painel). NUNCA invente nem estime votos.
- Se pedirem uma UF cujos dados não vieram aqui, diga que não tem esses números agora e peça para escolher a UF no seletor do site.
- Se faltar o detalhe pedido, diga que não está disponível. Cite brevemente a fonte (TSE).
- Situação "2º turno" = vai ao segundo turno e NÃO está eleito. Nunca chame de eleito quem está no 2º turno. "Eleito por QP"/"Eleito por média" = eleito.
- Nomes: use o nome de urna (ex.: "JHC") e, se ajudar, o nome civil. Se o nome do candidato for ambíguo (vários candidatos), diga quais encontrou e pergunte qual.
- DISTRITO FEDERAL: não há municípios nem Assembleia. Diga "Câmara Legislativa do Distrito Federal (CLDF)" e "deputado(s) distrital(is)". O detalhe geográfico do DF é por zona eleitoral do TSE (no BLOCO_RETRIEVAL do DF, o campo "municipio" é a zona; o nome traz a região administrativa principal).`;

import { detectCandidates, softNorm } from './nomes.js';

const CARGO_LABEL = { '1': 'Presidente', '3': 'Governador', '5': 'Senador', '6': 'Dep. Federal', '7': 'Dep. Estadual' };


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
  if (typeof caches === 'undefined' || !caches.default) {
    const r = await fetch(url); if (!r.ok) throw new Error('fetch ' + r.status + ' ' + url); return r.json();
  }
  const cache = caches.default;
  const creq = new Request(url, { method: 'GET' });
  let hit = await cache.match(creq);
  if (hit) {
    try { return await hit.json(); } catch { /* refetch */ }
  }
  let res;
  for (let t = 0; t < 2; t++) { // 1 nova tentativa em falha de rede/5xx
    try { res = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } }); if (res.ok || res.status < 500) break; } catch (e) { if (t) throw e; }
  }
  if (!res || !res.ok) throw new Error('fetch ' + (res && res.status) + ' ' + url);
  const data = await res.json();
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
  try { await cache.put(creq, new Response(JSON.stringify(data), { headers })); } catch { /* ignore */ }
  return data;
}

function detectCargos(text) {
  const t = text.toLowerCase();
  const found = [];
  const rules = [
    [/dep(utado)?s?\s*estadua|\bestadual\b|alese|distrita|\bcldf\b|c[aâ]mara\s+legislativa|assembleia/, '7'],
    [/dep(utado)?s?\s*feder|\bfederal\b|c[aâ]mara(?!\s+legislativa)/, '6'],
    [/senador|\bsenado\b/, '5'],
    [/governador|\bgoverno\b/, '3'],
    [/presidente|presid[eê]ncia/, '1'],
  ];
  for (const [re, c] of rules) if (re.test(t)) found.push(c);
  return [...new Set(found)];
}

// nomes curtos de município que também são palavras comuns
const MUN_CURTO_NAO = new Set(['BORA', 'OLEO', 'URU', 'POA', 'IPUA', 'ITAI', 'AVAI']);
function detectMuns(text, munIndex) {
  const key = normKey(text);
  const hits = [];
  hits.citados = []; // trechos do texto reconhecidos como município (não podem virar nome de candidato)
  const aliases = Object.entries(munIndex.aliases || {}).sort((a, b) => b[0].length - a[0].length);
  const seen = new Set();
  // grupos: um nome que cobre várias unidades (DF: "Ceilândia" = 3 zonas eleitorais)
  for (const [g, list] of Object.entries(munIndex.grupos || {}).sort((a, b) => b[0].length - a[0].length)) {
    if (g.length < 5 || !key.includes(g)) continue;
    for (const mi of list) {
      if (seen.has(mi)) continue;
      seen.add(mi);
      const meta = (munIndex.muns || []).find(m => m.i === mi);
      if (meta) hits.push(meta);
    }
    hits.citados.push(g);
  }
  const palavras = new Set(softNorm(text).split(' '));
  for (const [alias, mi] of aliases) {
    const curto = alias.length < 5;
    if (curto && (alias.length < 3 || MUN_CURTO_NAO.has(alias) || !palavras.has(alias))) continue;
    if ((curto || key.includes(alias)) && !seen.has(mi)) {
      seen.add(mi);
      hits.citados.push(alias);
      const meta = (munIndex.muns || []).find(m => m.i === mi);
      if (meta) hits.push(meta);
    }
  }
  return hits;
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

// Arquivos privados (detalhe por local/seção) vêm do bucket R2 DADOS_PRO — só para plano 'pro'.
const r2Cache = new Map();
async function r2Json(env, key) {
  if (r2Cache.has(key)) return r2Cache.get(key);
  if (!env.DADOS_PRO) throw new Error('DADOS_PRO ausente');
  const obj = await env.DADOS_PRO.get(key);
  if (!obj) throw new Error('r2 404 ' + key);
  const data = await obj.json();
  if (r2Cache.size > 40) r2Cache.delete(r2Cache.keys().next().value);
  r2Cache.set(key, data);
  return data;
}
const privBase = uf => (uf === 'se' ? 'mapa' : `mapa/${uf}`);

async function buildRetrieval(env, messages, uf, plano = 'free') {
  const pages = (env.PAGES_BASE || 'https://marcelhalls-dotcom.github.io/apuracao-se').replace(/\/$/, '');
  const ufNorm = String(uf || 'se').toLowerCase();
  // DF: a vaga 7 do painel é deputado distrital (CLDF, cargo 8 no TSE)
  const CL = ufNorm === 'df' ? { ...CARGO_LABEL, '7': 'Dep. Distrital' } : CARGO_LABEL;
  // dados pesados (mapa/) ficam no R2 (dados.cademeuvoto.com.br); DATA_BASE vazio = mesmo host do site
  const data = (env.DATA_BASE || pages).replace(/\/$/, '');
  const mapaBase = ufNorm === 'se' ? `${data}/mapa` : `${data}/mapa/${ufNorm}`;
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const blob = messages.map(m => m.content).join('\n');
  // Pergunta atual manda; histórico só como fallback (evita "contaminar" com nomes de turnos anteriores)
  const text = lastUser || blob;

  const out = { fonte: 'mapa TSE (arquivos do painel)', itens: [] };
  if (ufNorm === 'df') out.nota_df = 'DF: "municipio" nestes itens = zona eleitoral do TSE (o DF não tem municípios); Dep. Distrital = Câmara Legislativa (CLDF).';

  let munIndex, mapaIndex, geo;
  try {
    munIndex = await cachedJson(`${mapaBase}/mun-index.json`);
  } catch (e) {
    out.erro = 'Não foi possível carregar índice de municípios.';
    return out;
  }
  try {
    mapaIndex = await cachedJson(`${mapaBase}/index.json`);
  } catch (e) {
    mapaIndex = { cargos: {} };
  }

  // seguimento: só as perguntas anteriores do USUÁRIO (as respostas citam muitos municípios e cargos)
  const userBlob = messages.filter(m => m.role === 'user').map(m => m.content).slice(0, -1).slice(-3).join('\n');
  let muns = detectMuns(lastUser, munIndex);
  if (!muns.length && userBlob) muns = detectMuns(userBlob, munIndex);
  let cargos = detectCargos(lastUser);
  if (!cargos.length && userBlob) cargos = detectCargos(userBlob);
  const munNomes = [...muns.map(m => m.nm), ...(muns.citados || [])];
  let cands = detectCandidates(lastUser, mapaIndex, munNomes);
  // pergunta de seguimento ("e em Arapiraca?"): procura o candidato nas perguntas anteriores do usuário (não nas respostas)
  if (!cands.length) {
    const ant = messages.filter(m => m.role === 'user').map(m => m.content).slice(0, -1).reverse();
    for (const q of ant) { cands = detectCandidates(q, mapaIndex, munNomes); if (cands.length) break; }
  }

  // município sem cargo: todos os cargos
  if (muns.length && !cargos.length && !cands.length) cargos = ['7', '6', '5', '3', '1'];
  // if candidate implies cargo
  for (const c of cands) if (!cargos.includes(c.cargo)) cargos.push(c.cargo);
  // "mais votado" / "top" with mun -> need ranking
  const wantsRank = /mais\s+votad|top\s*\d+|ranking|quem\s+(foi|venceu|ganhou)/i.test(text);

  // Fetch mun rankings
  for (const mun of muns.slice(0, 3)) {
    try {
      const munData = await cachedJson(`${mapaBase}/mun/${mun.cd}.json`);
      const slice = { municipio: munData.nm, cd: munData.cd, rankings: {} };
      const useCargos = cargos.length ? cargos : Object.keys(munData.cargos || {});
      for (const cg of useCargos) {
        const rows = (munData.cargos && munData.cargos[cg]) || [];
        const topN = /top\s*5/i.test(text) ? 5 : (/top\s*(\d+)/i.test(text) ? Number(RegExp.$1) : (wantsRank ? 10 : 8));
        slice.rankings[CL[cg] || cg] = rows.slice(0, Math.min(topN, 15)).map(r => ({
          numero: r.n, nome: r.nm, partido: r.sg, votos_no_municipio: r.v, [cg === '1' ? 'votos_totais_brasil' : 'votos_totais_uf']: r.t,
        }));
      }
      // candidate-specific totals in this mun
      if (cands.length) {
        slice.candidatos_pedidos = [];
        for (const c of cands.slice(0, 4)) {
          const rows = (munData.cargos && munData.cargos[c.cargo]) || [];
          const hit = rows.find(r => String(r.n) === String(c.n));
          slice.candidatos_pedidos.push({
            cargo: CL[c.cargo] || c.cargo,
            numero: c.n, nome: c.nm || (hit && hit.nm), partido: c.sg || (hit && hit.sg),
            votos_no_municipio: hit ? hit.v : 0,
            [c.cargo === '1' ? 'votos_totais_brasil' : 'votos_totais_uf']: c.t || (hit && hit.t) || 0,
          });
        }
      }
      out.itens.push(slice);
    } catch (e) {
      out.itens.push({ municipio: mun.nm, erro: 'Falha ao ler ranking municipal' });
    }
  }

  // Bairro/zona/local detail for candidate (+ mun opcional)
  if (wantsGeoDetail(text) && cands.length && plano !== 'pro') {
    out.itens.push({
      restrito: true,
      nota: 'O detalhe por bairro, zona, local de votação e seção é exclusivo da Assinatura. Diga isso ao usuário com gentileza, '
        + 'ofereça os totais por município que estão neste bloco e indique a página Planos (cademeuvoto.com.br/#planos). Não invente números de bairro/local.',
    });
  }
  if (wantsGeoDetail(text) && cands.length && plano === 'pro') {
    try {
      geo = await r2Json(env, `${privBase(ufNorm)}/geo-loc-${ufNorm}.json`);
    } catch { geo = null; }
    if (geo) {
      const mode = /zona/.test(text.toLowerCase()) ? 'zona' : (/col[eé]gio|local|escola/.test(text.toLowerCase()) ? 'local' : 'bairro');
      const localQ = extractLocalQuery(text);
      const localHits = mode === 'local' ? findLocalsByQuery(geo, localQ, 5) : [];

      // Match exato/fuzzy de colégio/local — mesmo sem município no texto
      if (localHits.length && cands.length) {
        for (const c of cands.slice(0, 2)) {
          try {
            const cand = await r2Json(env, `${privBase(ufNorm)}/${c.cargo}/${c.n}.json`);
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
                cargo: CL[c.cargo] || c.cargo,
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
              const cand = await r2Json(env, `${privBase(ufNorm)}/${c.cargo}/${c.n}.json`);
              const agg = aggregateCandidateInMun(geo, cand, mun.i, mode);
              out.itens.push({
                detalhe: mode,
                municipio: mun.nm,
                candidato: {
                  cargo: CL[c.cargo] || c.cargo,
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
      nota: 'Candidatos reconhecidos na pergunta (totais na UF; Presidente = total no Brasil). Para detalhe local, peça o município.',
      candidatos: cands.slice(0, 6).map(c => ({ cargo: CL[c.cargo] || c.cargo, numero: c.n, nome_urna: c.nu || null, nome: c.nm, partido: c.sg, [c.cargo === '1' ? 'votos_totais_brasil' : 'votos_totais_uf']: c.t })),
    });
  }

  out.detectado = {
    municipios: muns.map(m => m.nm),
    cargos: cargos.map(c => CL[c] || c),
    candidatos: cands.slice(0, 8).map(c => `${c.n} ${c.nu || c.nm} (${CL[c.cargo] || c.cargo})`),
  };
  return out;
}


function detectReportIntent(text, retrieval) {
  const t = String(text || '').toLowerCase();
  const wants = /relat[oó]rio|gerar\s+pdf|baixar\s+(o\s+)?pdf|exportar\s+pdf|quero\s+o\s+relat/i.test(t);
  if (!wants) return null;

  const det = (retrieval && retrieval.detectado) || {};
  const cands = det.candidatos || [];
  const muns = det.municipios || [];

  // parse "44321 MARCEL... (Dep. Estadual)" lines from detectado
  const parseCand = (line) => {
    const m = String(line).match(/^(\d+)\s+(.+?)\s+\(([^)]+)\)\s*$/);
    if (!m) return null;
    const cargoLabel = m[3];
    const cargoMap = {
      'Presidente': '1', 'Governador': '3', 'Senador': '5',
      'Dep. Federal': '6', 'Dep. Estadual': '7',
    };
    return { n: m[1], nm: m[2], cargo: cargoMap[cargoLabel] || null };
  };

  if (/resumo|panorama|vis[aã]o\s+geral|elei[cç][aã]o\s+completa/i.test(t) && !/candidato|munic[ií]pio/.test(t)) {
    return { template: 'resumo', options: { hist: true, fotos: false } };
  }

  const parsed = cands.map(parseCand).filter(Boolean);
  const first = parsed[0];
  const second = parsed[1];
  const wantsCand = /candidato|votos?\s+d[oe]|votação\s+do|votacao\s+do|relat[oó]rio|mapa\s+eleitoral|compar/i.test(t);
  const wantsMun = /relat[oó]rio\s+do\s+munic|munic[ií]pio\s+de\s+|na\s+cidade\s+de\s+/i.test(t);
  const wantsCompare = /compar|versus|\svs\.?\s|dois\s+candidat|ambos|e\s+o\s+candidat|mapa\s+eleitoral\s+dos\s+dois|zonead/i.test(t)
    || (parsed.length >= 2 && wantsCand);

  if (wantsCompare && first && second && first.cargo) {
    const cargo = first.cargo === second.cargo ? first.cargo : first.cargo;
    return {
      template: 'comparar',
      cargo,
      a: first.n,
      b: second.n,
      nomeA: first.nm,
      nomeB: second.nm,
      options: { hist: true, fotos: true, zoneado: true },
    };
  }

  if (wantsCand && first && first.cargo) {
    return {
      template: 'candidato',
      cargo: first.cargo,
      numero: first.n,
      a: first.n,
      nome: first.nm,
      options: { hist: true, topMun: 15, detalhe: 'bairro', fotos: true },
    };
  }

  if (wantsMun || (!wantsCand && muns.length && /munic[ií]pio|cidade/.test(t))) {
    const munName = muns[0] || null;
    let cd = null;
    for (const it of (retrieval.itens || [])) {
      if (it.cd) { cd = String(it.cd); break; }
    }
    return {
      template: 'municipio',
      mun: munName || undefined,
      cd: cd || undefined,
      options: { topN: 10, fotos: false },
    };
  }

  if (parsed.length >= 2 && first && second && first.cargo) {
    return {
      template: 'comparar',
      cargo: first.cargo,
      a: first.n,
      b: second.n,
      nomeA: first.nm,
      nomeB: second.nm,
      options: { hist: true, fotos: true, zoneado: true },
    };
  }
  if (first && first.cargo) {
    return {
      template: 'candidato',
      cargo: first.cargo,
      numero: first.n,
      a: first.n,
      nome: first.nm,
      options: { hist: true, topMun: 15, detalhe: 'bairro', fotos: true },
    };
  }

  return { template: 'resumo', options: { hist: true, fotos: false } };
}


/** Nomes de municípios da UF citados no texto (para "São Paulo do Potengi" não virar a UF SP). */
async function munsCitados(env, uf, text) {
  const u = String(uf || 'se').toLowerCase();
  const data = (env.DATA_BASE || env.PAGES_BASE || '').replace(/\/$/, '');
  try {
    const mi = await cachedJson(u === 'se' ? `${data}/mapa/mun-index.json` : `${data}/mapa/${u}/mun-index.json`);
    return detectMuns(text, mi).map(m => m.nm).filter(Boolean);
  } catch { return []; }
}

export { SYSTEM_BASE, CARGO_LABEL, sanitizeMessages, cachedJson, buildRetrieval, detectReportIntent, munsCitados };
