"""Gera os arquivos GRÁTIS (só nomes, sem votos) do recurso "Mais votados no seu bairro".

Entrada (local, gerado por montar_uf.py / locais2026.py):
  out/pub/m2024/<uf>/mun/<cd>.json, out/pro/m2024/<uf>/top3/<cd>.json, out/pub/m2024/<uf>/fotos.json,
  out/pro/e2026/<uf>/top3/<cd>.json, out/pub/{m2024,e2026}/<uf>/locais/<cd>.json
Saída (bucket PÚBLICO, só no passo de deploy):
  out/proposta/m2024/<uf>/top3-livre/<cd>.json   — Prefeito/Vereador 2024: ordem do top 3 + eleito, sem votos
  out/proposta/e2026/<uf>/top3-livre/<cd>.json   — Presidente/Governador/Senador/Dep. Federal/Dep. Estadual 2026 (DF: Distrital); t2 = data do 2º turno por cargo
  out/proposta/m2024/municipios.json             — [uf, cd, nome, lat, lon] (centro médio dos locais) p/ achar o município no aparelho

Regras (decisão de 07/10/2026): bairro com menos de MIN_APTOS eleitores aptos não ganha ranking próprio (ok=0) —
o app mostra só o resultado do município. Nada de votos ou percentuais aqui; isso fica nos arquivos privados (top3/).
"""
import json, os, glob, sys

OUT = os.environ.get('M2024_OUT', '/workspace/m2024/out')
PROP = os.path.join(OUT, 'proposta')
MIN_APTOS = 500


def dumps(o):
    return json.dumps(o, ensure_ascii=False, separators=(',', ':'))


def grava(rel, obj):
    p = os.path.join(PROP, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w').write(dumps(obj))


def livre2024(uf):
    n = 0
    fotos = set()
    fj = os.path.join(OUT, 'pub', 'm2024', uf, 'fotos.json')
    if os.path.exists(fj): fotos = set(json.load(open(fj))['sq'])
    for fm in sorted(glob.glob(os.path.join(OUT, 'pub', 'm2024', uf, 'mun', '*.json'))):
        mun = json.load(open(fm)); cd = mun['cd']
        pt = os.path.join(OUT, 'pro', 'm2024', uf, 'top3', f'{cd}.json')
        if not os.path.exists(pt): continue
        t = json.load(open(pt))
        full = {'11': mun['c11'], '13': mun['c13']}
        usados = {'11': {}, '13': {}}; refs = {'11': [], '13': []}

        def ref(c, i):
            if i not in usados[c]:
                x = full[c][i]; sq = str(x.get('sq') or '')
                usados[c][i] = len(refs[c])
                refs[c].append([x['nm'], x['sg'], x['nu'], 1 if x.get('e') else 0, sq, 1 if sq in fotos else 0])
            return usados[c][i]

        def ordem(c, lst):
            return [ref(c, x['n']) for x in lst]

        # resultado do município (para bairros pequenos e para a tela "município")
        c11 = sorted([x for x in mun['c11'] if x.get('v')], key=lambda x: -x['v'])
        c13 = sorted([x for x in mun['c13'] if x.get('v')], key=lambda x: -x['v'])
        mo = {'aptos': mun['secoes'].get('11', {}).get('aptos'), 'p': ordem('11', c11[:3]),
              'v': ordem('13', c13[:3]), 've': ordem('13', [x for x in c13 if x.get('e')][:3])}
        top = []
        for b in t['top']:
            ok = 1 if (b.get('aptos') or 0) >= MIN_APTOS else 0
            o = {'b': b['b'], 'ok': ok}
            if ok:
                o['p'] = [ref('11', i) for i, _ in b['p']['top3']]
                o['v'] = [ref('13', i) for i, _ in b['v']['top3']]
                o['ve'] = [ref('13', i) for i, _ in b['v']['eleitos'][:3]]
            top.append(o)
        av = {}
        if mun.get('aviso_situacao'): av['relatorio'] = {'cargos': mun['aviso_situacao']['cargos'],
                                                         'texto': 'Situação conforme relatório oficial de totalização de 2024.'}
        if mun.get('eleicao_suplementar'):
            cg = sorted({int(c) for e in mun['eleicao_suplementar'] for c in str(e.get('cargos', '')).split(',') if c.strip()})
            av['suplementar'] = {'cargos': cg, 'texto': mun.get('aviso_suplementar') or 'Houve eleição suplementar para este cargo.',
                                 'data': ', '.join(e.get('data', '') for e in mun['eleicao_suplementar'])}
        obj = {'cd': cd, 'nm': mun['nm'], 'uf': mun['uf'], 'ano': 2024, 'min_aptos': MIN_APTOS, 'bairros': t['bairros'],
               't2': 1 if '11t2' in mun['secoes'] else 0, 'c': refs,
               'campos_c': ['nome de urna', 'partido', 'número', 'eleito', 'sq', 'tem_foto'], 'mun': mo, 'top': top,
               'fonte': 'TSE — Eleições Municipais 2024 (votação por seção)'}
        if av: obj['avisos'] = av
        grava(f'm2024/{uf}/top3-livre/{cd}.json', obj); n += 1
    return n


def livre2026(uf):
    n = 0
    for pt in sorted(glob.glob(os.path.join(OUT, 'pro', 'e2026', uf, 'top3', '*.json'))):
        t = json.load(open(pt)); cd = t['cd']
        usados = {}; refs = []

        def ref(i):
            if i not in usados:
                usados[i] = len(refs); refs.append(t['c'][i])
            return usados[i]
        cargos = [c for c in t['cargos']]
        mo = {'aptos': t['mun']['aptos']}
        for c in cargos:
            if c in t['mun']: mo[c] = [ref(i) for i, _ in t['mun'][c]['top3']]
        top = []
        for b in t['top']:
            ok = 1 if (b.get('aptos') or 0) >= MIN_APTOS else 0
            o = {'b': b['b'], 'ok': ok}
            if ok:
                for c in cargos:
                    if c in b: o[c] = [ref(i) for i, _ in b[c]['top3']]
            top.append(o)
        grava(f'e2026/{uf}/top3-livre/{cd}.json', {
            'cd': cd, 'nm': t['nm'], 'uf': t['uf'], 'ano': 2026, 'turno': 1, 't2': t.get('t2', {}), 'min_aptos': MIN_APTOS, 'bairros': t['bairros'],
            'cargos': t['cargos'], 'c': refs, 'campos_c': t['campos_c'], 'mun': mo, 'top': top,
            'fonte': 'TSE — Eleições Gerais 2026, 1º turno (votação por seção)'})
        n += 1
    return n


def municipios():
    """Centro médio dos locais de votação com coordenada (2024 e 2026 juntos)."""
    acc = {}
    for ano in ('m2024', 'e2026'):
        for f in glob.glob(os.path.join(OUT, 'pub', ano, '*', 'locais', '*.json')):
            d = json.load(open(f)); uf = d['uf'].lower(); k = (uf, d['cd'])
            a = acc.setdefault(k, [d['nm'], 0.0, 0.0, 0])
            for l in d['l']:
                if l[0] is not None and l[1] is not None:
                    a[1] += l[0]; a[2] += l[1]; a[3] += 1
    rows = []
    for (uf, cd), (nm, la, lo, q) in sorted(acc.items()):
        rows.append([uf, cd, nm, round(la / q, 3) if q else None, round(lo / q, 3) if q else None])
    grava('m2024/municipios.json', {'campos': ['uf', 'cd', 'nome', 'lat', 'lon'],
                                    'nota': 'lat/lon = média dos locais de votação com coordenada (TSE 2024/2026); null = sem coordenada.',
                                    'm': rows})
    return len(rows), sum(1 for r in rows if r[3] is None)


if __name__ == '__main__':
    ufs = sorted({os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(OUT, 'pro', 'e2026', '*', 'top3'))} |
                 {os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(OUT, 'pro', 'm2024', '*', 'top3'))})
    if len(sys.argv) > 1: ufs = [u.lower() for u in sys.argv[1:]]
    for uf in ufs:
        print(uf.upper(), 'm2024', livre2024(uf), 'e2026', livre2026(uf), flush=True)
    print('municipios', municipios())
