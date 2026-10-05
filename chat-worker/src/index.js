import CONTEXT from '../context.json';

const SYSTEM_PROMPT = `Você é o assistente oficial do painel "Apuração Sergipe" (marcelhalls-dotcom.github.io/apuracao-se).
Responda SEMPRE em português do Brasil, de forma clara e objetiva.

ESCOPO PERMITIDO (única área):
- Eleições em Sergipe 2026 (Governador, Senador, Dep. Federal, Dep. Estadual)
- Presidente 2026 no Brasil e o recorte de Sergipe
- Comparativos/referências a 2022 quando houver no contexto
- Suplentes, cadeiras por partido/federação, votos por município quando constarem no contexto

FORA DE ESCOPO:
- Qualquer outro tema (receitas, programação, saúde, fofoca, política genérica sem relação com esses resultados, etc.)
- Recuse educadamente e diga que só responde sobre as eleições de Sergipe 2026/2022 e a disputa presidencial (BR/SE).

REGRAS DE DADOS (obrigatórias):
- Use APENAS os números do "CONTEXTO_DADOS" abaixo (origem TSE / arquivos do painel).
- NUNCA invente votos, percentuais, nomes ou situações.
- Se a pergunta exigir um detalhe que não está no contexto (ex.: colégio específico sem dado), diga que esse detalhe não está disponível neste assistente e sugira consultar o Mapa de Votação no painel.
- Cite brevemente que a fonte é o TSE (dados oficiais).
- Prefira listas curtas e totais; não despeje JSON.

CONTEXTO_DADOS (JSON compacto):
${JSON.stringify(CONTEXT)}`;

function corsHeaders(origin, allowed) {
  const o = origin === allowed ? allowed : allowed;
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

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
function hourKey(d = new Date()) {
  return d.toISOString().slice(0, 13); // YYYY-MM-DDTHH
}

async function checkRate(env, ip) {
  const hourLimit = Number(env.RATE_HOUR || 20);
  const dayLimit = Number(env.RATE_DAY || 60);
  const d = dayKey();
  const h = hourKey();
  const kH = `rl:h:${ip}:${h}`;
  const kD = `rl:d:${ip}:${d}`;
  const [cH, cD] = await Promise.all([env.RATE.get(kH), env.RATE.get(kD)]);
  const nH = Number(cH || 0);
  const nD = Number(cD || 0);
  if (nH >= hourLimit) {
    return { ok: false, msg: `Limite horário atingido (${hourLimit} perguntas/hora). Tente novamente mais tarde.` };
  }
  if (nD >= dayLimit) {
    return { ok: false, msg: `Limite diário atingido (${dayLimit} perguntas/dia). Volte amanhã.` };
  }
  await Promise.all([
    env.RATE.put(kH, String(nH + 1), { expirationTtl: 3600 * 2 }),
    env.RATE.put(kD, String(nD + 1), { expirationTtl: 86400 * 2 }),
  ]);
  return { ok: true, remainingHour: hourLimit - nH - 1, remainingDay: dayLimit - nD - 1 };
}

function sanitizeMessages(input, maxChars, maxHist) {
  if (!Array.isArray(input)) return { error: 'Campo messages inválido.' };
  const cleaned = [];
  for (const m of input) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    let content = String(m.content || '').trim();
    if (!content) continue;
    if (content.length > maxChars) {
      return { error: `Cada mensagem pode ter no máximo ${maxChars} caracteres.` };
    }
    cleaned.push({ role: m.role, content });
  }
  if (!cleaned.length) return { error: 'Envie pelo menos uma mensagem.' };
  if (cleaned[cleaned.length - 1].role !== 'user') {
    return { error: 'A última mensagem deve ser do usuário.' };
  }
  return { messages: cleaned.slice(-maxHist) };
}

/** Optional: fetch municipality totals from Pages mapa files when user asks about a city. */
async function maybeEnrichMunicipio(userText) {
  const t = userText.toLowerCase();
  // only if mentions município-ish words and a known cargo number pattern
  if (!/(aracaju|munic[ií]pio|votos em|em )/.test(t)) return null;
  // Keep enrichment light: only for governador numbers already in context sample
  return null;
}

export default {
  async fetch(request, env) {
    const allowed = env.ALLOWED_ORIGIN || 'https://marcelhalls-dotcom.github.io';
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, allowed);

    if (request.method === 'OPTIONS') {
      // Preflight: only echo allowed origin (not *)
      if (origin && origin !== allowed) {
        return new Response('CORS', { status: 403, headers: cors });
      }
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === 'GET') {
      return json(200, {
        ok: true,
        service: 'apuracao-se-chat',
        scope: 'Eleições Sergipe 2026/2022 + Presidente BR/SE',
        limits: {
          max_chars: Number(env.MAX_MSG_CHARS || 500),
          max_history: Number(env.MAX_HISTORY || 8),
          rate_hour: Number(env.RATE_HOUR || 20),
          rate_day: Number(env.RATE_DAY || 60),
        },
      }, cors);
    }

    if (request.method !== 'POST') {
      return json(405, { error: 'Use POST /chat' }, cors);
    }

    // Strict CORS for browser calls
    if (origin && origin !== allowed) {
      return json(403, { error: 'Origem não permitida.' }, cors);
    }

    const url = new URL(request.url);
    if (url.pathname !== '/' && url.pathname !== '/chat') {
      return json(404, { error: 'Não encontrado' }, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'JSON inválido.' }, cors);
    }

    const maxChars = Number(env.MAX_MSG_CHARS || 500);
    const maxHist = Number(env.MAX_HISTORY || 8);
    const parsed = sanitizeMessages(body.messages, maxChars, maxHist);
    if (parsed.error) return json(400, { error: parsed.error }, cors);

    const ip = clientIp(request);
    const rate = await checkRate(env, ip);
    if (!rate.ok) {
      return json(429, { error: rate.msg }, cors);
    }

    if (!env.AI_ROUTER_API_KEY) {
      return json(500, { error: 'Serviço temporariamente indisponível (config).' }, cors);
    }

    const routerBase = (env.ROUTER_BASE || '').replace(/\/$/, '');
    const model = env.ROUTER_MODEL || 'cademeuvoto';
    const maxTokens = Number(env.MAX_TOKENS || 1800);

    const payload = {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...parsed.messages,
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
    };

    let upstream;
    try {
      upstream = await fetch(`${routerBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.AI_ROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return json(502, { error: 'Falha ao contactar o modelo. Tente de novo.' }, cors);
    }

    const raw = await upstream.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = null; }

    if (!upstream.ok) {
      return json(502, {
        error: 'O modelo não respondeu agora. Tente novamente em instantes.',
        status: upstream.status,
      }, cors);
    }

    const answer = (((data || {}).choices || [])[0] || {}).message?.content || '';
    if (!answer.trim()) {
      return json(502, { error: 'Resposta vazia do modelo.' }, cors);
    }

    return json(200, {
      reply: answer.trim(),
      model: data.model || model,
      remaining: { hour: rate.remainingHour, day: rate.remainingDay },
    }, cors);
  },
};
