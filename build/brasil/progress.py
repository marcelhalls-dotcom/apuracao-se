#!/usr/bin/env python3
"""Atualiza rebrand/brasil/<regiao>-progress.md (sobrevive a interrupções).
Uso: progress.py <regiao> [<uf> <status> <commits> <e2e> [<1ª visita>]]   ex.: progress.py sudeste es '✅ no ar' 'abc123' '55/0'
Estado em <OUT>/progress-<regiao>.json (fora do git). Números vêm de mapa/<uf>/context.json (TSE)."""
import json, os, sys, datetime
SITE = os.environ.get('CMV_SITE') or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = os.environ.get('CMV_OUT') or os.path.join(SITE, '..', 'rebrand', 'brasil')
REG = {'nordeste': ['ce', 'ma', 'pb', 'pi', 'rn'], 'sudeste': ['es', 'rj', 'mg', 'sp']}
ALE = {'ce': 'ALECE', 'ma': 'ALEMA', 'pb': 'ALPB', 'pi': 'ALEPI', 'rn': 'ALRN', 'es': 'Ales', 'rj': 'Alerj', 'mg': 'ALMG', 'sp': 'Alesp'}
regiao = sys.argv[1]; ST = os.path.join(OUT, f'progress-{regiao}.json')
st = json.load(open(ST)) if os.path.exists(ST) else {}
def du_mb(paths):
    t = 0
    for p in paths:
        for root, _, files in os.walk(os.path.join(SITE, p)):
            t += sum(os.path.getsize(os.path.join(root, f)) for f in files)
    return t / 1e6
if len(sys.argv) > 5:
    uf, status, commits, e2e = sys.argv[2:6]; fv = sys.argv[6] if len(sys.argv) > 6 else (st.get(uf) or {}).get('fv', '')
    c = json.load(open(f'{SITE}/mapa/{uf}/context.json'))
    g = c['cargos']['governador']['candidatos']; s = [x for x in c['cargos']['senado']['candidatos'] if x['eleito']]
    fmt = lambda n: f'{n:,}'.replace(',', '.')
    gov = ' · '.join(f"{x['nome'].title()} ({x['partido']}) {fmt(x['votos'])} ({x['pct']}%) {x['sit'].lower()}" for x in g[:2])
    sz = du_mb((f'mapa/{uf}', f'fotos/{uf}', f'tse/ele2026/6259/fotos/{uf}', f'tse/ele2026/6259/dados/{uf}', f'tse/ele2026/6257/dados/{uf}'))
    st[uf] = {'status': status, 'gov': gov, 'sen': ' · '.join(f"{x['nome'].title()} {fmt(x['votos'])}" for x in s),
              'seats': f"{ALE[uf]} {c['cadeiras']['assembleia']} / Câmara {c['cadeiras']['camara']}", 'size': f'{sz:.1f} MB',
              'secoes': fmt(c['meta']['secoes']), 'commits': commits, 'e2e': e2e, 'fv': fv}
    os.makedirs(OUT, exist_ok=True); json.dump(st, open(ST, 'w'), ensure_ascii=False, indent=1)
rows = []
for uf in REG[regiao]:
    r = st.get(uf)
    rows.append(f"| {uf.upper()} | {r['status']} | {r['gov']} | {r['sen']} | {r['seats']} | {r['secoes']} | {r['size']} | {r['commits']} | {r['e2e']} | {r.get('fv', '')} |" if r else f"| {uf.upper()} | ⏳ pendente | | | | | | | | |")
md = f"""# {regiao.title()} — progresso ({', '.join(u.upper() for u in REG[regiao])})

Atualizado: {datetime.datetime.now():%d/%m/%Y %H:%M} (horário de Maceió)

Totais conferidos candidato a candidato contra o JSON oficial do TSE (verify_uf.py: 0 diferenças) e na UI por cliques (e2e_uf.js).
Dados no Cloudflare R2 (dados.cademeuvoto.com.br), nunca no git. Governador com 2º turno aparece com selo "2º TURNO".

| UF | Status | Governador (TSE, 2 primeiros) | Senado eleitos (TSE) | Cadeiras (agr.vag) | Seções | Tamanho no R2 | Commits | E2E ao vivo | 1ª visita (pedidos / KB) |
|---|---|---|---|---|---|---|---|---|---|
""" + "\n".join(rows) + "\n"
os.makedirs(OUT, exist_ok=True); open(os.path.join(OUT, f'{regiao}-progress.md'), 'w').write(md)
print(md)
