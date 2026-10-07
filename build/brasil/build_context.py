#!/usr/bin/env python3
"""mapa/{uf}/context.json para o chat (só números do snapshot TSE; não inventa)."""
import json, os, sys
SITE = os.environ.get('CMV_SITE') or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))  # raiz do repo (ou CMV_SITE)
def I(x): return int(str(x or '0').replace('.', ''))
def cands(d):
    out = []
    for agr in d['carg'][0].get('agr') or []:
        for par in agr.get('par') or []:
            for c in par.get('cand') or []:
                st = c.get('st') or ''
                out.append({'n': str(c['n']), 'nome': c.get('nmu') or c.get('nm'), 'partido': par.get('sg') or '',
                            'votos': I(c.get('vap')), 'pct': c.get('pvap') or '', 'sit': st,
                            'eleito': st.lower().startswith('eleito')})
    return sorted(out, key=lambda x: -x['votos'])
def vagas(d): return sum(I(a.get('vag')) for a in d['carg'][0].get('agr') or [])
def build(uf):
    T = os.path.join(SITE, 'tse/ele2026')
    L = lambda ele, c: json.load(open(f'{T}/{ele}/dados/{uf}/{uf}-c{c:04d}-e00{ele}-u.json'))
    g, s, f, e, p = L(6259, 3), L(6259, 5), L(6259, 6), L(6259, 8 if uf == 'df' else 7), L(6257, 1)
    pst = lambda d: float(str(d['s'].get('pst') or '0').replace(',', '.'))
    meta = {'secoes': I(g['s']['ts']), 'aptos': I(g['e']['te']), 'comparecimento': I(g['e']['c']),
            'abstencoes': I(g['e']['a']), 'pst': g['s']['pst']}
    sen_eleitos = sum(1 for c in cands(s) if c['eleito'])
    def dep(d, top):
        cs = cands(d)
        return {'vagas': vagas(d), 'qe': d['carg'][0].get('qe') or '', 'eleitos': [c for c in cs if c['eleito']], 'top': cs[:top]}
    ctx = {'fonte': 'TSE resultados oficiais', 'uf': uf.upper(), 'ciclo': '2026',
           'nota': 'Números oficiais do TSE. Não inventar. Se faltar dado, dizer que não está disponível neste contexto. "2º turno" = vai ao segundo turno (ainda não eleito).',
           'meta': meta, 'cadeiras': {'camara': vagas(f), 'assembleia': vagas(e), 'senado_2026': sen_eleitos},
           'cargos': {'governador': {'apuracao_pct': pst(g), 'candidatos': cands(g)},
                      'senado': {'apuracao_pct': pst(s), 'candidatos': cands(s)},
                      f'presidente_{uf}': {'apuracao_pct': pst(p), 'candidatos': cands(p)},
                      'deputado_federal': dep(f, 15), 'deputado_estadual': dep(e, 20)}}
    if uf == 'df':
        # DF não tem Assembleia nem municípios: Câmara Legislativa (CLDF), deputados distritais (cargo 8 no TSE)
        ctx['nota'] += (' DISTRITO FEDERAL: não há Assembleia Legislativa nem deputados estaduais. A casa é a Câmara Legislativa do'
                        ' Distrito Federal (CLDF), com deputados distritais (cargo 8 no TSE). Neste contexto, "deputado_estadual" e'
                        ' "assembleia" significam deputado distrital e CLDF; sempre use "deputado distrital" e "Câmara Legislativa".'
                        ' O DF tem um único município (Brasília); o detalhe geográfico é por zona eleitoral (TSE).')
        ctx['legislativo_local'] = 'Câmara Legislativa do Distrito Federal (CLDF) — deputados distritais'
    os.makedirs(f'{SITE}/mapa/{uf}', exist_ok=True)
    json.dump(ctx, open(f'{SITE}/mapa/{uf}/context.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    gv = ctx['cargos']['governador']['candidatos']
    print(uf, 'gov', [(c['nome'], c['votos'], c['pct'], c['sit']) for c in gv[:3]])
    print(uf, 'sen', [(c['nome'], c['votos'], c['sit']) for c in ctx['cargos']['senado']['candidatos'][:3]])
    print(uf, 'cadeiras', ctx['cadeiras'], 'nv fed/est', f['carg'][0].get('nv'), e['carg'][0].get('nv'))
for u in sys.argv[1:]: build(u.lower())
