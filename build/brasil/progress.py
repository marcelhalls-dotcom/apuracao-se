#!/usr/bin/env python3
"""Atualiza rebrand/brasil/nordeste-progress.md. Uso: progress.py <uf> <status> <commits> <e2e>"""
import json, os, sys, subprocess, datetime
SITE = os.environ.get('CMV_SITE') or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))  # raiz do repo (ou CMV_SITE); ST = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'progress.json')  # estado local, não versionado
OUT = os.environ.get('CMV_OUT') or os.path.join(SITE, '..', 'rebrand', 'brasil')
st = json.load(open(ST)) if os.path.exists(ST) else {}
def tracked_mb(path='.'):
    out = subprocess.run(f"git ls-files -z {path} | xargs -0 -r stat -c %s", shell=True, cwd=SITE, capture_output=True, text=True).stdout.split()
    return sum(map(int, out)) / 1e6
if len(sys.argv) > 4:
    uf, status, commits, e2e = sys.argv[1:5]
    c = json.load(open(f'{SITE}/mapa/{uf}/context.json'))
    g = c['cargos']['governador']['candidatos']; s = [x for x in c['cargos']['senado']['candidatos'] if x['eleito']]
    fmt = lambda n: f'{n:,}'.replace(',', '.')
    gov = ' · '.join(f"{x['nome'].title()} ({x['partido']}) {fmt(x['votos'])} ({x['pct']}%) {x['sit'].lower()}" for x in g[:2])
    sz = sum(tracked_mb(p) for p in (f'mapa/{uf}', f'fotos/{uf}', f'tse/ele2026/6259/fotos/{uf}', f'tse/ele2026/6259/dados/{uf}', f'tse/ele2026/6257/dados/{uf}'))
    ale = {'ce': 'ALECE', 'ma': 'ALEMA', 'pb': 'ALPB', 'pi': 'ALEPI', 'rn': 'ALRN'}[uf]
    st[uf] = {'status': status, 'gov': gov, 'sen': ' · '.join(f"{x['nome'].title()} {fmt(x['votos'])}" for x in s),
              'seats': f"{ale} {c['cadeiras']['assembleia']} / Câmara {c['cadeiras']['camara']}", 'size': f'{sz:.1f} MB',
              'secoes': fmt(c['meta']['secoes']), 'commits': commits, 'e2e': e2e}
    json.dump(st, open(ST, 'w'), ensure_ascii=False, indent=1)
rows = []
for uf in ('ce', 'ma', 'pb', 'pi', 'rn'):
    r = st.get(uf)
    rows.append(f"| {uf.upper()} | {r['status']} | {r['gov']} | {r['sen']} | {r['seats']} | {r['secoes']} | {r['size']} | {r['commits']} | {r['e2e']} |" if r else f"| {uf.upper()} | ⏳ pendente | | | | | | | |")
pack = subprocess.run("git count-objects -v | awk '/size-pack/{print $2}'", shell=True, cwd=SITE, capture_output=True, text=True).stdout.strip()
md = f"""# Nordeste — progresso (CE, MA, PB, PI, RN)

Atualizado: {datetime.datetime.now():%d/%m/%Y %H:%M} (horário de Maceió)

Totais conferidos candidato a candidato contra o JSON oficial do TSE (verify_uf.py: 0 diferenças) e na UI por cliques (e2e_uf.js).
Governador com 2º turno aparece com selo "2º TURNO".

| UF | Status | Governador (TSE, 2 primeiros) | Senado eleitos (TSE) | Cadeiras (agr.vag) | Seções | Tamanho publicado da UF | Commits (dados → seletor) | E2E ao vivo |
|---|---|---|---|---|---|---|---|---|
""" + "\n".join(rows) + f"""

Site publicado (arquivos versionados): **{tracked_mb():.0f} MB** · teto combinado 600 MB · histórico git (pack): {int(pack or 0)/1024:.0f} MB
"""
os.makedirs(OUT, exist_ok=True); open(os.path.join(OUT, 'nordeste-progress.md'), 'w').write(md)
print(md)
