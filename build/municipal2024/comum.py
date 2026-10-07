"""Configuração comum do pipeline municipal 2024 (Prefeito e Vereador, 1º turno 06/10/2024 e 2º turno 27/10/2024).

Tudo vem dos Dados Abertos do TSE (cdn.tse.jus.br). Nada de segredos aqui: credenciais do R2 só por variável de ambiente.
Pastas (podem ser trocadas por variável de ambiente):
  M2024_WORK  (padrão /workspace/m2024)  → raw/ (zips do TSE, apagados quando não servem mais), out/ (JSON gerados), state/ (checkpoints)
  M2024_DOCS  (padrão /workspace/eleicoes-se/rebrand/municipal2024) → progress.md e verificacao/<UF>.md|json
"""
import json, os, re, unicodedata

WORK = os.environ.get('M2024_WORK', '/workspace/m2024')
RAW = os.path.join(WORK, 'raw')
OUT = os.path.join(WORK, 'out')          # out/pub/m2024/<uf>/...  e  out/pro/m2024/<uf>/...
STATE = os.path.join(WORK, 'state')
DOCS = os.environ.get('M2024_DOCS', '/workspace/eleicoes-se/rebrand/municipal2024')
PREFIX = 'm2024'
BUCKET_PUB, BUCKET_PRO = 'cademeuvoto-dados', 'cademeuvoto-dados-pro'
CDN = 'https://cdn.tse.jus.br/estatistica/sead/odsele'
CDN_FOTOS = 'https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2024/fotos'
# DF não tem eleição municipal
UFS = ['SE', 'AL', 'AC', 'AM', 'AP', 'BA', 'CE', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR',
       'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SP', 'TO']
# arquivos nacionais (um zip com um CSV por UF, exceto o eleitorado, que é um CSV só)
NACIONAIS = {
    'detalhe_secao': ('detalhe_votacao_secao/detalhe_votacao_secao_2024.zip', 'detalhe_votacao_secao_2024_{UF}.csv'),
    'cand_munzona': ('votacao_candidato_munzona/votacao_candidato_munzona_2024.zip', 'votacao_candidato_munzona_2024_{UF}.csv'),
    'partido_munzona': ('votacao_partido_munzona/votacao_partido_munzona_2024.zip', 'votacao_partido_munzona_2024_{UF}.csv'),
    'cand': ('consulta_cand/consulta_cand_2024.zip', 'consulta_cand_2024_{UF}.csv'),
    'redes': ('consulta_cand/rede_social_candidato_2024.zip', 'rede_social_candidato_2024_{UF}.csv'),
    'vagas': ('consulta_vagas/consulta_vagas_2024.zip', 'consulta_vagas_2024_{UF}.csv'),
    'eleitorado': ('eleitorado_locais_votacao/eleitorado_local_votacao_2024.zip', 'eleitorado_local_votacao_2024.csv'),
}
CAPITAIS = {'AC': 'RIO BRANCO', 'AL': 'MACEIÓ', 'AM': 'MANAUS', 'AP': 'MACAPÁ', 'BA': 'SALVADOR', 'CE': 'FORTALEZA',
            'ES': 'VITÓRIA', 'GO': 'GOIÂNIA', 'MA': 'SÃO LUÍS', 'MG': 'BELO HORIZONTE', 'MS': 'CAMPO GRANDE',
            'MT': 'CUIABÁ', 'PA': 'BELÉM', 'PB': 'JOÃO PESSOA', 'PE': 'RECIFE', 'PI': 'TERESINA', 'PR': 'CURITIBA',
            'RJ': 'RIO DE JANEIRO', 'RN': 'NATAL', 'RO': 'PORTO VELHO', 'RR': 'BOA VISTA', 'RS': 'PORTO ALEGRE',
            'SC': 'FLORIANÓPOLIS', 'SE': 'ARACAJU', 'SP': 'SÃO PAULO', 'TO': 'PALMAS'}
ELEITO = {'ELEITO', 'ELEITO POR QP', 'ELEITO POR MÉDIA', 'ELEITO POR MEDIA'}

def dumps(o):
    return json.dumps(o, ensure_ascii=False, separators=(',', ':'))

def fold(s):
    s = unicodedata.normalize('NFKD', s or '')
    return re.sub(r'[^A-Z0-9]', '', ''.join(c for c in s if not unicodedata.combining(c)).upper())

def bairro_norm(s):
    return re.sub(r'\s+', ' ', (s or '').strip().upper())

def state_path(uf):
    return os.path.join(STATE, f'{uf.lower()}.json')

def load_state(uf):
    try: return json.load(open(state_path(uf)))
    except FileNotFoundError: return {'uf': uf.upper(), 'etapas': {}}

def save_state(st):
    os.makedirs(STATE, exist_ok=True)
    p = state_path(st['uf']); tmp = p + '.tmp'
    json.dump(st, open(tmp, 'w'), ensure_ascii=False, indent=1); os.replace(tmp, p)

for d in (RAW, OUT, STATE, DOCS, os.path.join(DOCS, 'verificacao')):
    os.makedirs(d, exist_ok=True)
