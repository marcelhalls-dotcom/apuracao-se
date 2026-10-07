#!/usr/bin/env python3
"""Snapshot TSE resultados (JSON + fotos) para site/tse/ (espelho de resultados.tse.jus.br/oficial/).
Uso: snapshot_tse.py ce ma ...   — retry/backoff exponencial, 6 threads, nunca sobrescreve foto existente.
Também grava cópias em /tmp/tse-{uf}/api/ para o build_uf_mapa.py."""
import json, os, sys, time, random, shutil, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
SITE = os.environ.get('CMV_SITE') or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))  # raiz do repo (ou CMV_SITE)
BASE = 'https://resultados.tse.jus.br/oficial'
UA = {'User-Agent': 'Mozilla/5.0 (cademeuvoto snapshot)', 'Accept': '*/*'}

def get(url, tries=8):
    delay = 1.0
    for t in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404: raise
            ra = e.headers.get('Retry-After') if e.headers else None
            time.sleep(float(ra) if ra and ra.isdigit() else delay + random.random())
        except Exception:
            time.sleep(delay + random.random())
        delay = min(delay * 2, 30)
    raise RuntimeError('falhou ' + url)

def save(rel, data):
    p = os.path.join(SITE, 'tse', rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'wb').write(data); return p

def snap(uf):
    api = f'/tmp/tse-{uf}/api'; os.makedirs(api, exist_ok=True)
    sqs = []
    for c in (3, 5, 6, 7):
        rel = f'ele2026/6259/dados/{uf}/{uf}-c{c:04d}-e006259-u.json'
        b = get(f'{BASE}/{rel}'); json.loads(b); save(rel, b); open(f'{api}/c{c}.json', 'wb').write(b)
        d = json.loads(b)
        for agr in d['carg'][0].get('agr') or []:
            for par in agr.get('par') or []:
                for cand in par.get('cand') or []:
                    if cand.get('sqcand'): sqs.append(cand['sqcand'])
    rel = f'ele2026/6257/dados/{uf}/{uf}-c0001-e006257-u.json'
    b = get(f'{BASE}/{rel}'); json.loads(b); save(rel, b); open(f'{api}/c1.json', 'wb').write(b)
    shutil.copy(os.path.join(SITE, 'tse/ele2026/6257/dados/br/br-c0001-e006257-u.json'), f'{api}/c1-br.json')
    sqs = sorted(set(sqs)); miss = []
    def foto(sq):
        rel = f'ele2026/6259/fotos/{uf}/{sq}.jpeg'
        if os.path.exists(os.path.join(SITE, 'tse', rel)): return 'have'
        try: save(rel, get(f'{BASE}/{rel}')); return 'ok'
        except urllib.error.HTTPError as e: miss.append((sq, e.code)); return 'miss'
        except Exception as e: miss.append((sq, str(e))); return 'miss'
    with ThreadPoolExecutor(6) as ex: res = list(ex.map(foto, sqs))
    print(uf, 'json ok; fotos', len(sqs), {k: res.count(k) for k in set(res)}, 'faltando', miss[:5])

for uf in [a.lower() for a in sys.argv[1:]]: snap(uf)
