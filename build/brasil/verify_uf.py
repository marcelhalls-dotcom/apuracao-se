#!/usr/bin/env python3
"""Confere mapa/{uf}/index.json (somado das seções) contra o JSON oficial do TSE, candidato a candidato."""
import json, os, sys
SITE = os.environ.get('CMV_SITE') or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))  # raiz do repo (ou CMV_SITE)
I = lambda x: int(str(x or '0').replace('.', ''))
for uf in sys.argv[1:]:
    idx = json.load(open(f'{SITE}/mapa/{uf}/index.json'))
    bad = 0; n = 0
    for c, ele in (('1', 6257), ('3', 6259), ('5', 6259), ('6', 6259), ('7', 6259)):
        tc = 8 if (uf == 'df' and c == '7') else int(c)  # DF: distrital = cargo 8 no TSE
        d = json.load(open(f'{SITE}/tse/ele2026/{ele}/dados/{uf}/{uf}-c{tc:04d}-e00{ele}-u.json'))
        api = {str(x['n']): I(x.get('vap')) for a in d['carg'][0]['agr'] for p in a['par'] for x in p['cand']}
        mine = {x['n']: (x['tse'] if c == '1' else x['t']) for x in idx['cargos'][c]}
        for k, v in api.items():
            n += 1
            if mine.get(k) != v:
                bad += 1
                if bad <= 10: print(' DIFF', uf, c, k, mine.get(k), v)
        if set(mine) != set(api): print(' SET DIFF', uf, c, set(mine) ^ set(api))
    sec = json.load(open(f'{SITE}/mapa/{uf}/secao/secoes.json'))
    print(uf, f'{n} candidatos conferidos, diferenças: {bad}; seções {len(sec["s"])} vs TSE {idx["meta"]["secoes"]}; aptos soma {sum(r[2] for r in sec["s"])} vs TSE {idx["meta"]["aptos"]}')
