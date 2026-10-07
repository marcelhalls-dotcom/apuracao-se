#!/usr/bin/env python3
"""Build mapa/{uf}/ parallel to SE mapa/ from TSE open data + resultados API.

Usage: python3 build_uf_mapa.py AL
Outputs under site/mapa/al/ (lowercase).
Never invents numbers — only aggregates TSE rows and copies API metadata.
"""
from __future__ import annotations
import csv, json, os, sys, collections, re, unicodedata, urllib.request

UF = (sys.argv[1] if len(sys.argv) > 1 else 'AL').upper()
uf = UF.lower()
SITE = os.environ.get('CMV_SITE') or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))  # raiz do repo (ou CMV_SITE)
OUT = os.path.join(SITE, 'mapa', uf)
RAW = f'/tmp/tse-{uf}'
API = os.path.join(RAW, 'api')
IBGE_UF = {'AL': 27, 'SE': 28, 'BA': 29, 'PE': 26, 'CE': 23, 'MA': 21, 'PB': 25, 'PI': 22, 'RN': 24,
           'ES': 32, 'RJ': 33, 'MG': 31, 'SP': 35, 'PR': 41, 'SC': 42, 'RS': 43, 'GO': 52, 'MT': 51, 'MS': 50,
           'DF': 53, 'PA': 15, 'AM': 13, 'TO': 17, 'RO': 11, 'AC': 12, 'AP': 16, 'RR': 14}.get(UF)
# DF: deputado distrital é o cargo 8 no TSE; aqui ocupa a vaga interna '7' (mesma UI de deputado estadual, rótulos trocados no site)
CARGO_MAP = {'8': '7'} if UF == 'DF' else {}
assert IBGE_UF, f'IBGE code missing for {UF}'

os.makedirs(OUT, exist_ok=True)
for c in ('1', '3', '5', '6', '7'):
    os.makedirs(os.path.join(OUT, c), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'secao', c), exist_ok=True)
os.makedirs(os.path.join(OUT, 'mun'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'secao'), exist_ok=True)

def dumps(o):
    return json.dumps(o, ensure_ascii=False, separators=(',', ':'))

def ncd(x):
    """CD_MUNICIPIO normalizado (eleitorado vem '08036', detalhe/votação vêm 8036)."""
    return str(int(x)).zfill(5)

def fold(s):
    s = unicodedata.normalize('NFKD', s or '')
    s = ''.join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r'[^A-Z0-9]', '', s.upper())

# ---------- candidatos from TSE resultados API ----------
def load_cands():
    by = {}
    nat_pres = {}
    # national president totals for mun file `t` field
    br = json.load(open(os.path.join(API, 'c1-br.json')))
    for agr in br['carg'][0].get('agr') or []:
        for par in agr.get('par') or []:
            sg = par.get('sg') or ''
            for cand in par.get('cand') or []:
                nat_pres[str(cand['n'])] = {
                    'sg': sg, 'nm': cand.get('nm'), 'nu': cand.get('nmu') or cand.get('nm'),
                    'sq': cand.get('sqcand'), 't': int(str(cand.get('vap') or '0').replace('.', '')),
                }
    for c in ('1', '3', '5', '6', '7'):
        d = json.load(open(os.path.join(API, f'c{c}.json')))
        lst = []
        for agr in d['carg'][0].get('agr') or []:
            for par in agr.get('par') or []:
                sg = par.get('sg') or ''
                for cand in par.get('cand') or []:
                    n = str(cand['n'])
                    lst.append({
                        'n': n,
                        'nm': cand.get('nm') or '',
                        'nu': cand.get('nmu') or cand.get('nm') or '',
                        'sg': sg,
                        'sq': str(cand.get('sqcand') or ''),
                        't': int(str(cand.get('vap') or '0').replace('.', '')),
                        'st': cand.get('st') or '',
                        'e': cand.get('e') or 'n',
                    })
        lst.sort(key=lambda x: -x['t'])
        by[c] = lst
        # KPIs from header
        if c == '3':
            by['_meta'] = {
                'secoes': int(d.get('s', {}).get('ts') or 0),
                'aptos': int(d.get('e', {}).get('te') or 0),
                'comparecimento': int(d.get('e', {}).get('c') or 0),
                'abstencoes': int(d.get('e', {}).get('a') or 0),
                'pst': d.get('s', {}).get('pst') or '',
            }
    by['_pres_br'] = nat_pres
    return by

CANDS = load_cands()
wanted = {c: {x['n'] for x in CANDS[c]} for c in ('1', '3', '5', '6', '7')}
meta_by = {c: {x['n']: x for x in CANDS[c]} for c in ('1', '3', '5', '6', '7')}

# ---------- geo from eleitorado (unique locais) ----------
ele_path = os.path.join(RAW, f'eleitorado_local_votacao_2026_{UF}.csv')
mun_map = {}  # cd -> nm
loc_order = []  # list of dicts
loc_i = {}  # (cd,z,nl) -> idx
sec_order = []  # (cd,z,s) ordered
sec_i = {}
sec_loc = {}  # secKey -> loc idx

# DF: um só município (Brasília) — a unidade geográfica de 1º nível passa a ser a ZONA ELEITORAL do TSE
DFZ = (UF == 'DF')
def unit_cd(cd_raw, z):
    return f'Z{int(z):02d}' if DFZ else ncd(cd_raw)
def _f(x):
    try: return float(str(x).replace(',', '.'))
    except Exception: return None
z_bairro = collections.defaultdict(collections.Counter)  # DF: zona -> bairro -> eleitores
z_xy = collections.defaultdict(lambda: [0.0, 0.0, 0])  # DF: zona -> [soma lat*el, soma lon*el, el]

with open(ele_path, encoding='latin1') as f:
    # Prefer unique locais; also collect sections
    seen_loc = {}
    for r in csv.DictReader(f, delimiter=';'):
        if r['SG_UF'] != UF: continue
        cd, nm = unit_cd(r['CD_MUNICIPIO'], r['NR_ZONA']), r['NM_MUNICIPIO']
        mun_map[cd] = nm
        z, nl = int(r['NR_ZONA']), str(int(r['NR_LOCAL_VOTACAO']))
        if DFZ:
            el = int(r.get('QT_ELEITOR_SECAO') or 0) or 1
            z_bairro[cd][(r.get('NM_BAIRRO') or '').strip().upper()] += el
            la, lo = _f(r.get('NR_LATITUDE')), _f(r.get('NR_LONGITUDE'))
            if la is not None and lo is not None and -16.1 < la < -15.4 and -48.4 < lo < -47.2:
                a = z_xy[cd]; a[0] += la * el; a[1] += lo * el; a[2] += el
        key = (cd, z, nl)
        if key not in seen_loc:
            seen_loc[key] = {
                'cd': cd, 'z': z, 'nl': nl,
                'nm': r['NM_LOCAL_VOTACAO'],
                'b': (r.get('NM_BAIRRO') or '').strip() or 'Sem bairro',
                'e': (r.get('DS_ENDERECO') or '').strip(),
            }

if DFZ:
    # nome da zona = bairros predominantes (até 2, o 2º só se tiver >= 25% do eleitorado da zona)
    for cd in list(mun_map):
        tot = sum(z_bairro[cd].values()) or 1
        top = [b for b, n in z_bairro[cd].most_common(2) if b]
        names = top[:1] + [b for b in top[1:] if z_bairro[cd][b] / tot >= 0.25 and b not in top[0] and top[0] not in b]
        mun_map[cd] = f'ZONA {int(cd[1:]):02d} · ' + ' / '.join(names)
    print('DF zonas:', {cd: mun_map[cd] for cd in sorted(mun_map)})
# Stable mun order by name
muns_sorted = sorted(mun_map.items(), key=lambda x: fold(x[1]))
mun_i = {cd: i for i, (cd, _) in enumerate(muns_sorted)}
geo_mun = [{'cd': cd, 'nm': nm} for cd, nm in muns_sorted]

# locais ordered by mun index, zona, nl
loc_items = sorted(seen_loc.values(), key=lambda L: (mun_i[L['cd']], L['z'], L['nl']))
geo_loc = []
for i, L in enumerate(loc_items):
    loc_i[(L['cd'], L['z'], L['nl'])] = i
    geo_loc.append({
        'm': mun_i[L['cd']], 'z': L['z'], 'nl': L['nl'],
        'nm': L['nm'], 'b': L['b'], 'e': L['e'],
    })

geo = {
    'mun': geo_mun,
    'loc': geo_loc,
    'fonte': f'TSE eleitorado_local_votacao_2026_{UF} + votacao_secao_2026 (1º turno)',
}
open(os.path.join(OUT, f'geo-{uf}.json'), 'w').write(dumps(geo))
print('geo', len(geo_mun), 'mun', len(geo_loc), 'loc')

# ---------- IBGE geojson with TSE cd + i ----------
import gzip
def ibge_get(url):
    req = urllib.request.Request(url, headers={'Accept': 'application/json', 'Accept-Encoding': 'gzip'})
    raw = urllib.request.urlopen(req, timeout=60).read()
    try: return json.loads(gzip.decompress(raw))
    except Exception: return json.loads(raw)
if DFZ:
    # Contorno do DF (IBGE) como fundo + um ponto por zona eleitoral no centro (ponderado por eleitores)
    # dos locais de votação do TSE. Sem polígonos inventados.
    malha = ibge_get(f'https://servicodados.ibge.gov.br/api/v3/malhas/estados/{IBGE_UF}?formato=application/vnd.geo+json&qualidade=intermediaria')
    features = [{'type': 'Feature', 'properties': {'outline': 1, 'nm': 'Distrito Federal'}, 'geometry': f['geometry']} for f in malha['features']]
    for cd in sorted(mun_map):
        a = z_xy[cd]; assert a[2], f'zona sem coordenadas: {cd}'
        features.append({'type': 'Feature', 'properties': {'cd': cd, 'nm': mun_map[cd], 'i': mun_i[cd]},
                         'geometry': {'type': 'Point', 'coordinates': [round(a[1] / a[2], 5), round(a[0] / a[2], 5)]}})
    print('geojson DF: contorno', len(malha['features']), '+ pontos', len(features) - len(malha['features']))
    open(os.path.join(OUT, f'{uf}-mun.geojson'), 'w').write(dumps({'type': 'FeatureCollection', 'features': features}))
else:
    req = urllib.request.Request(
        f'https://servicodados.ibge.gov.br/api/v1/localidades/estados/{IBGE_UF}/municipios',
        headers={'Accept': 'application/json', 'Accept-Encoding': 'gzip'})
    raw = urllib.request.urlopen(req, timeout=60).read()
    try: ibge_list = json.loads(gzip.decompress(raw))
    except Exception: ibge_list = json.loads(raw)
    ibge_by_fold = {fold(x['nome']): str(x['id']) for x in ibge_list}
    # name aliases
    aliases = {}
    for cd, nm in mun_map.items():
        k = fold(nm)
        aliases[k] = cd
        # common short forms
        aliases[fold(nm.replace("D'", 'D ').replace("D'", 'D'))] = cd

    # malha
    req = urllib.request.Request(
        f'https://servicodados.ibge.gov.br/api/v3/malhas/estados/{IBGE_UF}?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio',
        headers={'Accept': 'application/json', 'Accept-Encoding': 'gzip'})
    raw = urllib.request.urlopen(req, timeout=60).read()
    try: malha = json.loads(gzip.decompress(raw))
    except Exception: malha = json.loads(raw)

    # map IBGE id -> TSE cd: nome exato (normalizado); fallback tabela TSE->IBGE (sem prefixo "fuzzy")
    tse_by_ibge = {}
    miss = []
    csv_map = {}
    try:
        for r in csv.DictReader(open('/tmp/tse_ibge.csv', encoding='utf-8')):
            if r['uf'] == UF: csv_map[r['codigo_ibge']] = r['codigo_tse'].zfill(5)
    except FileNotFoundError: pass
    cd_norm = {cd.zfill(5): cd for cd in mun_map}
    for nome_fold, ibge_id in ibge_by_fold.items():
        cd = aliases.get(nome_fold)
        via = 'nome'
        if not cd and ibge_id in csv_map and csv_map[ibge_id] in cd_norm:
            cd = cd_norm[csv_map[ibge_id]]; via = 'tabela'
            print('  via tabela:', nome_fold, ibge_id, '->', cd, mun_map[cd])
        if cd: tse_by_ibge[ibge_id] = cd
        else: miss.append((nome_fold, ibge_id))
    dup = [cd for cd, n in collections.Counter(tse_by_ibge.values()).items() if n > 1]
    assert not dup, f'cd TSE duplicado no mapa: {dup}'
    print('ibge map', len(tse_by_ibge), 'miss', miss[:5], len(miss))

    features = []
    for f in malha['features']:
        ibge = str(f['properties'].get('codarea') or f['properties'].get('id') or '')
        cd = tse_by_ibge.get(ibge)
        if not cd:
            # leave without cd — skip choropleth link
            continue
        i = mun_i[cd]
        nm = mun_map[cd]
        features.append({
            'type': 'Feature',
            'properties': {'ibge': ibge, 'nm': nm, 'cd': cd, 'i': i},
            'geometry': f['geometry'],
        })
    # ensure all mun present: if some missing from malha, warn
    have = {f['properties']['cd'] for f in features}
    missing_geo = [cd for cd in mun_map if cd not in have]
    print('geojson features', len(features), 'missing_geo', missing_geo[:5], len(missing_geo))
    open(os.path.join(OUT, f'{uf}-mun.geojson'), 'w').write(dumps({'type': 'FeatureCollection', 'features': features}))

# mun-index
mun_idx = {
    'muns': [{'i': i, 'cd': cd, 'nm': nm, 'key': fold(nm)} for i, (cd, nm) in enumerate(muns_sorted)],
    'aliases': {fold(nm): i for i, (cd, nm) in enumerate(muns_sorted)},
}
if DFZ:
    # chat: "zona 01".."zona 21" e nomes de bairro apontam para a zona com mais eleitores naquele bairro
    best = {}
    for cd, cnt in z_bairro.items():
        for b, n in cnt.items():
            if b and (b not in best or n > best[b][1]): best[b] = (cd, n)
    for b, (cd, n) in best.items():
        k = fold(b)
        if len(k) >= 5: mun_idx['aliases'].setdefault(k, mun_i[cd])
    for cd in mun_map:
        mun_idx['aliases'][fold(f'ZONA {int(cd[1:]):02d}')] = mun_i[cd]
        mun_idx['aliases'][fold(f'{int(cd[1:])}A ZONA')] = mun_i[cd]
open(os.path.join(OUT, 'mun-index.json'), 'w').write(dumps(mun_idx))

# ---------- detalhe: build sec order + aptos/comparecimento ----------
# Guardamos só os números usados (aptos, comparecimento, brancos, nulos, legenda) por cargo — cabe SP/MG em memória.
DET = os.path.join(RAW, f'detalhe_votacao_secao_2026_{UF}.csv')
det = {}  # (cd,z,s) -> {cargo: [aptos, comp, brancos, nulos, legenda]}
with open(DET, encoding='latin1', newline='') as f:
    rd = csv.reader(f, delimiter=';'); H = {h: i for i, h in enumerate(next(rd))}
    iU, iM, iZ, iS, iC, iL = H['SG_UF'], H['CD_MUNICIPIO'], H['NR_ZONA'], H['NR_SECAO'], H['CD_CARGO'], H['NR_LOCAL_VOTACAO']
    iA, iCo, iB, iN, iLe = H['QT_APTOS'], H['QT_COMPARECIMENTO'], H['QT_VOTOS_BRANCOS'], H['QT_VOTOS_NULOS'], H['QT_VOTOS_LEGENDA']
    num = lambda x: int(x or 0)
    for r in rd:
        if r[iU] != UF: continue
        cd = unit_cd(r[iM], r[iZ]); k = (cd, int(r[iZ]), int(r[iS]))
        det.setdefault(k, {})[CARGO_MAP.get(r[iC], r[iC])] = [num(r[iA]), num(r[iCo]), num(r[iB]), num(r[iN]), num(r[iLe])]
        lk = (cd, int(r[iZ]), str(int(r[iL])))
        if lk in loc_i:
            sec_loc[k] = loc_i[lk]

# order sections by loc index then section number
sec_keys = sorted(det.keys(), key=lambda k: (sec_loc.get(k, 10**9), k[0], k[1], k[2]))
for i, k in enumerate(sec_keys):
    sec_i[k] = i

# secoes.json rows: [loc, secao, aptos, comparecimento] using cargo 3 (gov) as ref
rows = []
for k in sec_keys:
    li = sec_loc.get(k)
    if li is None: continue
    d3 = det[k].get('3') or next(iter(det[k].values()))
    rows.append([li, k[2], d3[0], d3[1]])

secoes = {
    'fonte': f'TSE votacao_secao_2026_{UF} + detalhe_votacao_secao_2026 (1º turno)',
    'cols': ['loc', 'secao', 'aptos', 'comparecimento'],
    's': rows,
    'pres': [],
}
open(os.path.join(OUT, 'secao', 'secoes.json'), 'w').write(dumps(secoes))

# det per cargo: [brancos, nulos, legenda] aligned to sec index
for c in ('1', '3', '5', '6', '7'):
    arr = []
    for k in sec_keys:
        r = det[k].get(c)
        arr.append([0, 0, 0] if not r else [r[2], r[3], r[4]])
    open(os.path.join(OUT, 'secao', f'det-{c}.json'), 'w').write(dumps(arr))
print('secoes', len(rows), flush=True)
n_secoes_det = len(sec_keys)
del det

# ---------- aggregate votes (numpy; memória ~12 bytes por linha do CSV) ----------
import numpy as np
from array import array
VOT_FILES = [
    os.path.join(RAW, 'votacao', f'votacao_secao_2026_{UF}.csv'),
    os.path.join(RAW, f'votacao_secao_2026_pres_{UF}.csv'),
]
cand_keys = [(c, meta['n']) for c in ('1', '3', '5', '6', '7') for meta in CANDS[c]]
cand_id = {ck: i for i, ck in enumerate(cand_keys)}
A_cid, A_si, A_v = array('i'), array('i'), array('i')
missing_sec = 0
for fn in VOT_FILES:
    if not os.path.exists(fn):
        print('SKIP missing', fn); continue
    with open(fn, encoding='latin1', newline='') as f:
        rd = csv.reader(f, delimiter=';'); H = {h: i for i, h in enumerate(next(rd))}
        iU, iM, iZ, iS, iC, iN, iV = H['SG_UF'], H['CD_MUNICIPIO'], H['NR_ZONA'], H['NR_SECAO'], H['CD_CARGO'], H['NR_VOTAVEL'], H['QT_VOTOS']
        for r in rd:
            if r[iU] and r[iU] != UF: continue
            ci = cand_id.get((CARGO_MAP.get(r[iC], r[iC]), r[iN]))
            if ci is None: continue
            si = sec_i.get((unit_cd(r[iM], r[iZ]), int(r[iZ]), int(r[iS])))
            if si is None:
                missing_sec += 1
                continue
            A_cid.append(ci); A_si.append(si); A_v.append(int(r[iV]))
    print('lido', os.path.basename(fn), len(A_v), flush=True)
print('missing_sec rows', missing_sec)

cid_all = np.frombuffer(A_cid, dtype=np.int32); si_all = np.frombuffer(A_si, dtype=np.int32); v_all = np.frombuffer(A_v, dtype=np.int32)
loc_of_sec = np.full(n_secoes_det, -1, dtype=np.int64)
for k, i in sec_i.items():
    li = sec_loc.get(k)
    if li is not None: loc_of_sec[i] = li
mun_of_loc = np.array([L['m'] for L in geo_loc], dtype=np.int64)
NS, NL, NM = n_secoes_det, max(1, len(geo_loc)), max(1, len(geo_mun))
cargo_of_cid = np.array([int(c) for c, _ in cand_keys], dtype=np.int32)

def group_sum(keys, vals):
    u, inv = np.unique(keys, return_inverse=True)
    return u, np.bincount(inv, weights=vals).astype(np.int64)

def by_cand(keys, vals, base):
    c_of = keys // base; idx = keys % base
    bounds = np.searchsorted(c_of, np.arange(len(cand_keys) + 1))
    return lambda ci: [[int(i), int(v)] for i, v in zip(idx[bounds[ci]:bounds[ci + 1]], vals[bounds[ci]:bounds[ci + 1]]) if v]

# write candidate files + index (um cargo por vez: pico de memória menor em SP/MG)
PRES_E = {}
for fn in os.listdir(os.path.join(SITE, 'mapa', 'pe', '1')):
    PRES_E[fn[:-5]] = json.load(open(os.path.join(SITE, 'mapa', 'pe', '1', fn))).get('e', [])
idx_cargos = {}
problems = []
votes_mun = {}  # (c,n) -> {mun_i: v}
for c in ('1', '3', '5', '6', '7'):
    sel = cargo_of_cid[cid_all] == int(c)
    cid = cid_all[sel].astype(np.int64); si_a = si_all[sel].astype(np.int64); v_a = v_all[sel].astype(np.int64)
    del sel
    # (cand, seção) / (cand, local) / (cand, município) somados; ordenados por cand e depois por índice
    sk, sv = group_sum(cid * NS + si_a, v_a)
    li_a = loc_of_sec[si_a]; okl = li_a >= 0
    lk_, lv_ = group_sum(cid[okl] * NL + li_a[okl], v_a[okl])
    mk_, mv_ = group_sum(cid[okl] * NM + mun_of_loc[li_a[okl]], v_a[okl])
    del cid, si_a, v_a, li_a, okl
    sec_of, loc_of, mun_pairs_of = by_cand(sk, sv, NS), by_cand(lk_, lv_, NL), by_cand(mk_, mv_, NM)
    lst = []
    for meta in CANDS[c]:
        n = meta['n']; ci = cand_id[(c, n)]
        loc_pairs = loc_of(ci)
        sec_pairs = sec_of(ci)
        votes_mun[(c, n)] = dict(mun_pairs_of(ci))
        tot = sum(v for _, v in loc_pairs)
        ref = meta['t']
        if abs(tot - ref) > 1 and c != '1':
            if abs(tot - ref) > 5:
                problems.append((c, n, tot, ref))
        obj = {'c': int(c), 'n': n, 'nm': meta['nm'], 'sg': meta['sg'], 't': tot, 'v': loc_pairs}
        if meta.get('sq'): obj['sq'] = meta['sq']
        if c == '1':
            # convenção (igual PE/BA/AL): t = total nacional, tse = total na UF, e = quebra por UF
            if abs(tot - ref) > 5: problems.append((c, n, tot, ref))
            br = CANDS['_pres_br'].get(n)
            obj = {'c': 1, 'n': n, 'nm': meta['nm'], 'sg': meta['sg'], 't': br['t'] if br else tot,
                   'sq': meta.get('sq') or '', 'tse': tot, 'e': PRES_E.get(n, []), 'v': loc_pairs}
        open(os.path.join(OUT, c, f'{n}.json'), 'w').write(dumps(obj))
        open(os.path.join(OUT, 'secao', c, f'{n}.json'), 'w').write(dumps({
            'c': int(c), 'n': n, 't': sum(v for _, v in sec_pairs), 's': sec_pairs
        }))
        rel = f'mapa/{uf}/{c}/{n}.json'
        lst.append({
            'n': n, 'nm': meta['nm'], 'sg': meta['sg'], 't': obj['t'],
            'a': rel, 'nu': meta['nu'], 'sq': meta.get('sq') or '',
        })
        if c == '1': lst[-1]['tse'] = tot
    if c == '1': lst.sort(key=lambda x: -x['tse'])
    idx_cargos[c] = lst
    del sk, sv, lk_, lv_, mk_, mv_, sec_of, loc_of, mun_pairs_of
    print('cargo', c, 'ok', flush=True)
del cid_all, si_all, v_all, A_cid, A_si, A_v

meta_idx = dict(CANDS.get('_meta') or {})
# contagens p/ o painel da home (evita baixar geo-<uf>.json só para contar municípios/locais)
meta_idx['nmun'] = len(geo_mun); meta_idx['nloc'] = len(geo_loc)
index = {
    'geo': f'mapa/{uf}/geo-{uf}.json',
    'munGeo': f'mapa/{uf}/{uf}-mun.geojson',
    'formato': 'compact-v2',
    'gerado': '2026-10-07',
    'uf': UF,
    'meta': meta_idx,
    'nota': f'Arquivos compactos UF={UF}: votos por local. UI agrega município/zona/bairro/seção.',
    'cargos': idx_cargos,
}
open(os.path.join(OUT, 'index.json'), 'w').write(dumps(index))

# mun summary files
pres_br = CANDS['_pres_br']
for i, (cd, nm) in enumerate(muns_sorted):
    cargos = {}
    for c in ('1', '3', '5', '6', '7'):
        rows = []
        for meta in CANDS[c]:
            n = meta['n']
            v = votes_mun[(c, n)].get(i, 0)
            if not v: continue
            item = {'n': n, 'nm': meta['nu'] or meta['nm'], 'sg': meta['sg'], 'v': v, 't': meta['t']}
            if c == '1' and n in pres_br:
                item['t'] = pres_br[n]['t']
            rows.append(item)
        rows.sort(key=lambda x: -x['v'])
        cargos[c] = rows
    open(os.path.join(OUT, 'mun', f'{cd}.json'), 'w').write(dumps({
        'cd': cd, 'nm': nm, 'i': i, 'cargos': cargos
    }))

print('PROBLEMS', problems[:20], 'count', len(problems))
print('DONE', OUT)
# size
import subprocess
subprocess.check_call(['du', '-sh', OUT])
import resource
print('pico de memória (MB)', resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024)
