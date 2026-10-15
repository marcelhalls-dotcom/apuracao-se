// Reconhecimento de candidatos e UFs no texto do usuário (acentos, nomes curtos como "JHC", nomes parciais).
// Regra geral: comparar PALAVRAS inteiras (não pedaços), para "JHC" casar e "ELE"/"QUE" nunca casarem.

export function softNorm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/BAPTISTA/g, 'BATISTA')
    .replace(/[^A-Z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const toks = s => softNorm(s).split(' ').filter(Boolean);

// palavras comuns / siglas que nunca podem ser tomadas como nome de candidato sozinhas
const STOP = new Set(`A O E OS AS UM UMA UNS DE DA DO DAS DOS EM NO NA NOS NAS AO AOS ATE POR PRA PRO PARA COM SEM SOB SOBRE
QUE QUEM QUAL QUAIS COMO ONDE QUANDO QUANTO QUANTOS QUANTA QUANTAS SE SIM NAO NEM MAS OU JA SO LA AQUI ALI ISSO ISTO ESSE ESSA ESTE ESTA
ELE ELA ELES ELAS EU TU NOS VOS SEU SUA SEUS SUAS MEU MINHA TEU TUA FOI ERA SAO TEM TEVE TER VAI VAO VEM BEM MAL MAIS MENOS MUITO POUCO
TODO TODA TODOS TODAS TUDO NADA CADA OUTRO OUTRA ANO ANOS DIA DIAS HOJE ONTEM VEZ VEZES CASO LADO PAIS MAE PAI FILHO FILHA NOVO NOVA
VOTO VOTOS VOTOU VOTAR VOTADO VOTADA VOTADOS TURNO TURNOS VICE DEP DEPS SEN GOV PRES CHAPA LISTA TOP RANK GERAL TOTAL CIDADE BAIRRO ZONA
SECAO LOCAL ESCOLA MAPA PDF DADOS DADO TSE IA OI OLA BOM BOA DIA NOITE TARDE OBRIGADO OBRIGADA FAVOR
PT PL PP PSD MDB PSB PDT PV UP PCO PCB PSOL REDE NOVO AVANTE PODE SD PMB DC PRTB MOBILIZA AGIR SOLIDARIEDADE UNIAO PSDB CIDADANIA PCDOB
AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SP TO BR UF UFS ALE CLDF SUL NORTE LESTE OESTE RIO`.split(/\s+/));
// sobrenomes/prenomes muito comuns: sozinhos valem pouco (precisam de outro pedaço do nome)
const COMUNS = new Set(`SILVA SANTOS SOUZA SOUSA OLIVEIRA LIMA COSTA PEREIRA FERREIRA ALVES RODRIGUES GOMES MARTINS ARAUJO RIBEIRO CARVALHO
ALMEIDA LOPES SOARES FERNANDES VIEIRA BARBOSA ROCHA DIAS NASCIMENTO ANDRADE MOREIRA NUNES MARQUES MACHADO MENDES FREITAS CARDOSO RAMOS
GONCALVES SANTANA TEIXEIRA JUNIOR NETO FILHO SOBRINHO JOSE JOAO MARIA ANTONIO FRANCISCO CARLOS PAULO PEDRO LUCAS LUIZ LUIS MARCOS ANA
PROFESSOR PROFESSORA DOUTOR DOUTORA PASTOR PASTORA DELEGADO DELEGADA CAPITAO SARGENTO SOLDADO CABO CORONEL TENENTE IRMAO IRMA ENFERMEIRA
ENFERMEIRO
ALAGOAS SERGIPE BAHIA PERNAMBUCO PARAIBA PARANA PIAUI CEARA MARANHAO AMAZONAS RORAIMA RONDONIA TOCANTINS AMAPA ACRE GOIAS BRASIL
BRASILIA BRASILEIRO BRASILEIRA NORDESTE MINAS GERAIS GROSSO JANEIRO GRANDE NORTE CATARINA ESPIRITO SANTO CAPITAL ESTADO INTERIOR
GOVERNADOR SENADOR SENADORA DEPUTADO DEPUTADA PREFEITO PREFEITA VEREADOR VEREADORA PRESIDENTE`.split(/\s+/));

// a frase P (lista de tokens) aparece inteira, em sequência, em Q? devolve a posição ou -1
function frase(Q, P) {
  if (!P.length || P.length > Q.length) return -1;
  outer: for (let i = 0; i + P.length <= Q.length; i++) {
    for (let j = 0; j < P.length; j++) if (Q[i + j] !== P[j]) continue outer;
    return i;
  }
  return -1;
}

// número de candidato no texto: com pista ("número 45", "nº 45", "o 45", "candidato 45") vale muito; solto vale pouco;
// anos, "top 10", "10 mais votados", porcentagens e milhares não contam
function numeros(text) {
  const out = new Map();
  const re = /(\d{2,5})/g; let m;
  const t = String(text || '');
  while ((m = re.exec(t))) {
    const n = m[1], ini = m.index, fim = ini + n.length;
    const antes = t.slice(Math.max(0, ini - 14), ini).toLowerCase(), depois = t.slice(fim, fim + 16).toLowerCase();
    if (/[\d.,]$/.test(antes) || /^[\d.,]\d/.test(depois)) continue;              // parte de 1.234 ou 12,5
    if (/^\s*(%|por\s*cento|mil\b|votos?\b|mais\b|primeir|maiores|menores|deputad|candidat|senador|cadeir|vagas?\b|municip|cidades|anos?\b|°|º)/.test(depois)) continue;
    if (/top\s*$/.test(antes)) continue;
    const ano = /^(19|20)\d\d$/.test(n);
    const pista = /(n[uú]mero|n[º°o.]\s*|num\.?|candidat[oa]\s*|\bo\s+|\ba\s+|do\s+|da\s+)$/.test(antes);
    if (ano && !pista) continue;
    out.set(n, Math.max(out.get(n) || 0, pista ? 90 : 15));
  }
  return out;
}

/**
 * Candidatos citados no texto. index.cargos = { '3': [{ n, nm (nome civil), nu (nome de urna), sg, t }...] }.
 * Pontuação: nome de urna inteiro (palavras em sequência) 100+; nome civil inteiro 80; nome+sobrenome 50;
 * palavra distintiva do nome de urna (≥5 letras, não comum) 20; outra palavra ≥5 do nome de urna 12; número 15/90.
 */
export function detectCandidates(text, mapaIndex, ignorar = []) {
  let Q = toks(text);
  // nomes de municípios citados não contam como nome de candidato ("Campinas" ≠ "Matheus Campinas")
  for (const nm of ignorar) { const P = toks(nm); let i; while (P.length && (i = frase(Q, P)) >= 0) Q = Q.slice(0, i).concat(['§'], Q.slice(i + P.length)); }
  if (!Q.length) return [];
  const nums = numeros(text);
  const achados = [];
  for (const [cargo, list] of Object.entries((mapaIndex && mapaIndex.cargos) || {})) {
    for (const c of list || []) {
      // votos de legenda (deputados, número de 2 dígitos = partido) não são candidatos
      if (cargo !== '1' && cargo !== '3' && cargo !== '5' && String(c.n).length === 2) continue;
      const U = toks(c.nu || c.nm), N = toks(c.nm);
      let s = 0, ini = -1, fim = -1;
      // nome de urna inteiro; se for uma palavra só e curta, precisa não ser palavra comum
      const pu = frase(Q, U);
      const curtoComum = U.length === 1 && (U[0].length < 2 || STOP.has(U[0]));
      if (pu >= 0 && !curtoComum) { s = 100 + 5 * U.length; ini = pu; fim = pu + U.length - 1; }
      // nome civil inteiro
      if (s < 80 && N.length >= 2) { const pn = frase(Q, N); if (pn >= 0) { s = 80; ini = pn; fim = pn + N.length - 1; } }
      // prenome + último sobrenome do nome civil (ex.: "Arthur Lira")
      if (s < 50 && N.length >= 2) {
        const a = N[0], b = N[N.length - 1];
        if (a.length >= 3 && b.length >= 3 && !STOP.has(a) && !STOP.has(b)) {
          const ia = Q.indexOf(a), ib = Q.indexOf(b);
          if (ia >= 0 && ib >= 0 && ib >= ia && ib - ia <= 3) { s = 50; ini = ia; fim = ib; }
        }
      }
      // pedaços do nome de urna (só palavras ≥5 letras: "JHC" sozinho não vira "MARINA JHC")
      if (s < 20) {
        let best = 0, pos = -1;
        U.forEach((w, k) => {
          if (w.length < 5 || STOP.has(w)) return;
          const i = Q.indexOf(w); if (i < 0) return;
          const v = COMUNS.has(w) ? 0 : 20;
          if (v > best) { best = v; pos = i; }
        });
        if (best) { s = best; ini = fim = pos; }
      }
      // palavras do nome civil (fraco)
      if (s < 8) {
        for (const w of N) if (w.length >= 6 && !COMUNS.has(w) && !STOP.has(w) && Q.includes(w)) { s = 8; ini = fim = Q.indexOf(w); break; }
      }
      const ns = nums.get(String(c.n)) || 0;
      if (ns > s) { s = ns; ini = fim = -1; }
      else if (ns && s) s += 10;
      if (s >= 8) achados.push({ cargo, n: String(c.n), nm: c.nm, nu: c.nu, sg: c.sg, t: c.t, a: c.a, s, ini, fim });
    }
  }
  // um nome contido em outro já reconhecido sai (ex.: "Renan Filho" não traz também o "Renan" do Senado)
  const fortes = achados.filter(h => h.s >= 100);
  const filtrados = achados.filter(h => !(h.ini >= 0 && fortes.some(f => f !== h && f.ini <= h.ini && f.fim >= h.fim && (f.fim - f.ini) > (h.fim - h.ini))));
  filtrados.sort((a, b) => b.s - a.s || (b.t || 0) - (a.t || 0));
  const top = filtrados[0] ? filtrados[0].s : 0;
  let out;
  if (top >= 100) out = filtrados.filter(h => h.s >= 50).concat(filtrados.filter(h => h.s >= 12 && h.s < 50).slice(0, 3));
  else if (top >= 50) out = filtrados.filter(h => h.s >= 20);
  else if (top >= 12) out = filtrados.filter(h => h.s >= 12);
  else out = filtrados.filter(h => h.s >= 8);
  return out.slice(0, 8).map(({ s, ini, fim, ...h }) => h);
}

/* ---------- UFs citadas na pergunta ---------- */
const UF_NOMES = [
  ['RIO GRANDE DO NORTE', 'rn'], ['RIO GRANDE DO SUL', 'rs'], ['MATO GROSSO DO SUL', 'ms'], ['MATO GROSSO', 'mt'], ['RIO DE JANEIRO', 'rj'],
  ['DISTRITO FEDERAL', 'df'], ['BRASILIA', 'df'], ['ESPIRITO SANTO', 'es'], ['SANTA CATARINA', 'sc'], ['MINAS GERAIS', 'mg'], ['SAO PAULO', 'sp'],
  ['SERGIPE', 'se'], ['ALAGOAS', 'al'], ['BAHIA', 'ba'], ['PERNAMBUCO', 'pe'], ['PARAIBA', 'pb'], ['CEARA', 'ce'], ['PIAUI', 'pi'], ['MARANHAO', 'ma'],
  ['AMAZONAS', 'am'], ['AMAPA', 'ap'], ['ACRE', 'ac'], ['RONDONIA', 'ro'], ['RORAIMA', 'rr'], ['TOCANTINS', 'to'], ['PARANA', 'pr'], ['GOIAS', 'go'],
];
export const UFS = 'ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr rj rn ro rr rs sc se sp to'.split(' ');

/**
 * UFs citadas explicitamente. ignorar = nomes de municípios da UF ativa já reconhecidos (ex.: "São Paulo do Potengi" no RN não é SP).
 * Siglas: maiúsculas ("SP", "DF") ou minúsculas depois de em/no/na/do/da/de ("governador de sp"). "Pará" só com acento ("para" é preposição).
 */
export function detectUfs(text, ignorar = []) {
  const raw = String(text || '');
  let Q = ' ' + softNorm(raw) + ' ';
  for (const nm of ignorar) { const k = softNorm(nm); if (k) Q = Q.split(' ' + k + ' ').join(' '); }
  const found = [];
  const add = u => { if (!found.includes(u)) found.push(u); };
  let rest = Q;
  for (const [nome, uf] of UF_NOMES) {
    if (rest.includes(' ' + nome + ' ')) { add(uf); rest = rest.split(' ' + nome + ' ').join(' '); }
  }
  if (/(^|[^A-Za-zÀ-ú])par[áÁ](?![A-Za-zÀ-ú])/i.test(raw) || /estado do par[aá](?![A-Za-zÀ-ú])/i.test(raw)) add('pa');
  const mostlyUpper = raw.replace(/[^A-Za-z]/g, '').length > 12 && raw === raw.toUpperCase();
  if (!mostlyUpper) {
    for (const m of raw.matchAll(/\b([A-Z]{2})\b/g)) { const u = m[1].toLowerCase(); if (UFS.includes(u)) add(u); }
  }
  for (const m of raw.matchAll(/\b(?:em|no|na|do|da|de|pelo|pela)\s+([a-z]{2})\b/g)) {
    const u = m[1]; if (UFS.includes(u) && u !== 'se' && u !== 'es' && u !== 'ma' && u !== 'to') add(u);
  }
  return found;
}
