#!/usr/bin/env python3
"""Mesmo formato do 2024 para 2026: índice público de locais (lat/lon → bairro, sem votos) e top 3 por bairro
(Senador, Dep. Federal, Dep. Estadual) para assinantes. Prefixo NOVO `e2026/` — não toca em nada de `mapa/`.

  python3 locais2026.py            # todas as 27 UFs (inclui DF)
  python3 locais2026.py AL SE      # só essas
  python3 locais2026.py --subir    # também envia ao R2 (idempotente)

Entradas: mapa/<uf>/ local do site (votos por local, já verificados contra o TSE no build/brasil), snapshot oficial
tse/ele2026/6259/dados/<uf>/ (situação: eleito/suplente) e eleitorado_local_votacao_2026 (lat/lon) baixado do TSE no box.
"""
import json, os, sys, zipfile
import duckdb, numpy as np
from comum import RAW, OUT, CDN, DOCS, dumps, bairro_norm
import baixar, subir

SITE = os.environ.get('CMV_SITE', '/workspace/eleicoes-se/site')
# 1 = Presidente (eleição 6257, situação NACIONAL do br-c0001); 3 = Governador (6259) — vai nos arquivos, mas a tela só mostra
# Governador com a chave GOVERNADOR_2026 ligada no bairro.js (aguarda o OK do Marcel).
CARGOS = {'1': 'Presidente', '3': 'Governador', '5': 'Senador', '6': 'Deputado Federal', '7': 'Deputado Estadual'}
def sit_code(e, st):
    # Nunca marca como eleito quem vai ao 2º turno (o TSE manda e='s' com st='2º turno').
    st = (st or '').lower()
    if '2º turno' in st or '2o turno' in st: return '2t'
    return 'e' if e else 'n'
UFS27 = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR',
         'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']
PFX = 'e2026'

def coord(lat, lon):
    try: la, lo = float(str(lat).replace(',', '.')), float(str(lon).replace(',', '.'))
    except (TypeError, ValueError): return None, None
    return (round(la, 6), round(lo, 6)) if (-34 < la < 6 and -74 < lo < -34) else (None, None)

def mapa_dir(uf): return os.path.join(SITE, 'mapa') if uf == 'se' else os.path.join(SITE, 'mapa', uf)

def eleitorado():
    z = baixar.baixar(f'{CDN}/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip', os.path.join(RAW, 'eleitorado_local_votacao_2026.zip'))
    membro = [n for n in zipfile.ZipFile(z).namelist() if n.endswith('_BRASIL.csv')][0]
    return baixar.extrair(z, membro, RAW)

RK = 15  # tamanho do ranking por bairro no arquivo privado (o detalhe completo continua no Mapa)

def main(ufs, subir_r2):
    csvp = eleitorado(); con = duckdb.connect()
    con.execute(f"""create table loc as select SG_UF uf, lpad(CD_MUNICIPIO,5,'0') cd, NR_ZONA::int z, NR_LOCAL_VOTACAO::int nl, mode(NR_LATITUDE) lat, mode(NR_LONGITUDE) lon,
                    mode(NM_BAIRRO) bairro, sum(QT_ELEITOR_SECAO::int) eleit from read_csv('{csvp}', delim=';', header=true, encoding='latin-1', all_varchar=true)
                    where NR_TURNO='1' group by all""")
    resumo = {}
    for UF in ufs:
        uf = UF.lower(); md = mapa_dir(uf)
        geo = json.load(open(os.path.join(md, f'geo-{uf}.json'))); idx = json.load(open(os.path.join(md, 'index.json')))
        ll = {(r[0], r[1], r[2]): r[3:] for r in con.execute("select cd, z, nl, lat, lon, bairro, eleit from loc where uf=?", [UF]).fetchall()}
        muns = geo['mun']; locs = geo['loc']; nloc = len(locs)
        loc_m = np.array([l['m'] for l in locs]); bairro_l = [bairro_norm(l.get('b')) for l in locs]
        # bairros por município
        bidx = {}; loc_b = np.zeros(nloc, dtype=np.int64); bairros_m = {}
        for i, l in enumerate(locs):
            key = (l['m'], bairro_l[i])
            if key not in bidx:
                bairros_m.setdefault(l['m'], []).append(bairro_l[i]); bidx[key] = len(bairros_m[l['m']]) - 1
            loc_b[i] = bidx[key]
        # situação oficial (snapshot TSE)
        sit = {}
        for c in CARGOS:
            cc_tse = '8' if (uf == 'df' and c == '7') else c   # DF: Deputado Distrital é o cargo 8 no TSE (no site fica em 7/)
            if c == '1': p = os.path.join(SITE, 'tse', 'ele2026', '6257', 'dados', 'br', 'br-c0001-e006257-u.json')
            else: p = os.path.join(SITE, 'tse', 'ele2026', '6259', 'dados', uf, f'{uf}-c000{cc_tse}-e006259-u.json')
            d = json.load(open(p))
            for cg in d['carg']:
                for a in cg['agr']:
                    for pa in a['par']:
                        for ca in pa['cand']:
                            sc = sit_code(ca.get('e') == 's', ca.get('st'))
                            sit[(c, ca['n'])] = (sc == 'e', sc)
        cob = {'locais': nloc, 'com_coord': 0, 'com_bairro': sum(1 for b in bairro_l if b), 'sem_cadastro': 0}
        out_pub = os.path.join(OUT, 'pub'); out_pro = os.path.join(OUT, 'pro'); out_prop = os.path.join(OUT, 'proposta')
        locpub = {}; loc_el = np.zeros(nloc, dtype=np.int64)
        for i, l in enumerate(locs):
            cd = muns[l['m']]['cd']; r = ll.get((cd, int(l['z']), int(l['nl'])))
            la, lo = coord(r[0], r[1]) if r else (None, None)
            cob['com_coord'] += la is not None; cob['sem_cadastro'] += r is None
            loc_el[i] = int(r[3] or 0) if r else 0
            locpub.setdefault(l['m'], []).append([la, lo, int(loc_b[i]), int(l['z']), int(l['nl']), l.get('nm', '')])
        # votos por bairro × candidato, por cargo
        ag = {}; verif = {'candidatos': 0, 'diferencas': 0}
        for c in CARGOS:
            lst = idx['cargos'].get(c, [])
            for ci, cand in enumerate(lst):
                f = json.load(open(os.path.join(SITE, cand['a'])))
                v = f['v'] if isinstance(f['v'], list) else json.loads(f['v'])
                if not v: continue
                a = np.array(v, dtype=np.int64); li, q = a[:, 0], a[:, 1]
                verif['candidatos'] += 1
                alvo = int(f['tse']) if 'tse' in f else int(cand['t'])   # Presidente/Governador: total do TSE na UF
                if int(q.sum()) != alvo: verif['diferencas'] += 1; verif.setdefault('dif', []).append([c, cand['n'], int(q.sum()), alvo])
                verif.setdefault('por_cargo', {}).setdefault(c, [0, 0]); verif['por_cargo'][c][0] += 1; verif['por_cargo'][c][1] += int(q.sum())
                key = loc_m[li] * 100000 + loc_b[li]
                u, inv = np.unique(key, return_inverse=True); s = np.bincount(inv, weights=q).astype(np.int64)
                for k, x in zip(u.tolist(), s.tolist()):
                    ag.setdefault(c, {}).setdefault(k // 100000, {}).setdefault(k % 100000, []).append([ci, x])
        nfiles = [0, 0]
        for m, mun in enumerate(muns):
            cd = mun['cd']; bairros = bairros_m.get(m, [])
            pl = os.path.join(out_pub, PFX, uf, 'locais', f'{cd}.json'); os.makedirs(os.path.dirname(pl), exist_ok=True)
            open(pl, 'w').write(dumps({'cd': cd, 'nm': mun['nm'], 'uf': UF, 'ano': 2026, 'bairros': bairros,
                                       'campos': ['lat', 'lon', 'bairro', 'zona', 'nr_local', 'nome'], 'l': locpub.get(m, [])})); nfiles[0] += 1
            usados = {}; top = []
            def ref(c, ci):
                k = (c, ci)
                if k not in usados:
                    cand = idx['cargos'][c][ci]; e, st = sit.get((c, cand['n']), (False, None))
                    usados[k] = len(usados); refs.append([c, cand.get('nu') or cand['nm'], cand['sg'], cand['n'], 1 if e else 0, str(cand.get('sq') or ''), st or 'n'])
                return usados[k]
            refs = []
            for b in range(len(bairros)):
                sel = (loc_m == m) & (loc_b == b)
                o = {'b': b, 'nloc': int(sel.sum()), 'aptos': int(loc_el[sel].sum())}
                for c in CARGOS:
                    rk = sorted(ag.get(c, {}).get(m, {}).get(b, []), key=lambda p: -p[1])
                    eleitos = [p for p in rk if sit.get((c, idx['cargos'][c][p[0]]['n']), (False,))[0]]
                    o[c] = {'top3': [[ref(c, p[0]), p[1]] for p in rk[:3]], 'eleitos': [[ref(c, p[0]), p[1]] for p in eleitos],
                            'rk': [[ref(c, p[0]), p[1]] for p in rk[:RK]], 'nom': int(sum(p[1] for p in rk))}
                top.append(o)
            # resultado do município inteiro (soma de todos os bairros) — usado quando o bairro é pequeno demais
            mo = {'aptos': int(loc_el[loc_m == m].sum()), 'nloc': int((loc_m == m).sum())}
            for c in CARGOS:
                tot = {}
                for pares in ag.get(c, {}).get(m, {}).values():
                    for ci, x in pares: tot[ci] = tot.get(ci, 0) + x
                rk = sorted(tot.items(), key=lambda p: -p[1])
                mo[c] = {'top3': [[ref(c, ci), x] for ci, x in rk[:3]], 'rk': [[ref(c, ci), x] for ci, x in rk[:RK]], 'nom': int(sum(tot.values())),
                         'eleitos': [[ref(c, ci), x] for ci, x in rk if sit.get((c, idx['cargos'][c][ci]['n']), (False,))[0]]}
            obj = {'cd': cd, 'nm': mun['nm'], 'uf': UF, 'ano': 2026, 'turno': 1, 'bairros': bairros, 't2': {'1': '25/10/2026'}, 'cargos': dict(CARGOS, **({'7': 'Deputado Distrital'} if uf == 'df' else {})),
                   'c': refs, 'campos_c': ['cargo', 'nome de urna', 'partido', 'número', 'eleito', 'sq', 'situação (e=eleito, 2t=vai ao 2º turno, n=não eleito)'], 'top': top, 'mun': mo,
                   'nota': f'Pares [i, votos], i = índice em c. Top 3 pode incluir não eleitos; "eleitos" lista os eleitos do cargo com voto no bairro; rk = ranking (até {RK}); nom = votos nominais do cargo no bairro.'}
            pt = os.path.join(out_pro, PFX, uf, 'top3', f'{cd}.json'); os.makedirs(os.path.dirname(pt), exist_ok=True)
            open(pt, 'w').write(dumps(obj)); nfiles[1] += 1
        r = {'municipios': len(muns), 'arquivos_publicos': nfiles[0], 'arquivos_privados': nfiles[1], 'cobertura': cob, 'verificacao': verif}
        if subir_r2:
            r['upload'] = {'pub': subir.subir_dir(subir.BUCKET_PUB, out_pub, f'{PFX}/{uf}/'),
                           'pro': subir.subir_dir(subir.BUCKET_PRO, out_pro, f'{PFX}/{uf}/')}
        resumo[UF] = r; print(UF, json.dumps(r, ensure_ascii=False), flush=True)
    os.makedirs(os.path.join(DOCS, 'verificacao'), exist_ok=True)
    prev = {}
    pth = os.path.join(DOCS, 'verificacao', 'e2026-locais-top3.json')
    if os.path.exists(pth): prev = json.load(open(pth))
    prev.update(resumo); json.dump(prev, open(pth, 'w'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    args = [a.upper() for a in sys.argv[1:] if not a.startswith('--')]
    main(args or UFS27, '--subir' in sys.argv)
