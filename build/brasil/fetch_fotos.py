#!/usr/bin/env python3
"""fotos/{uf}/{c}/{n}.jpg (114x160, p/ PDF e seletores) a partir do snapshot local tse/ (sem rede)."""
import json, os, sys
from PIL import Image
SITE = os.environ.get('CMV_SITE') or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))  # raiz do repo (ou CMV_SITE)
for uf in sys.argv[1:]:
    ok = miss = 0
    for c in (3, 5, 6, 7):
        d = json.load(open(f'{SITE}/tse/ele2026/6259/dados/{uf}/{uf}-c{c:04d}-e006259-u.json'))
        os.makedirs(f'{SITE}/fotos/{uf}/{c}', exist_ok=True)
        for a in d['carg'][0]['agr']:
            for p in a['par']:
                for x in p['cand']:
                    src = f'{SITE}/tse/ele2026/6259/fotos/{uf}/{x.get("sqcand")}.jpeg'
                    if not os.path.exists(src): miss += 1; continue
                    im = Image.open(src).convert('RGB'); im.thumbnail((114, 160))
                    im.save(f'{SITE}/fotos/{uf}/{c}/{x["n"]}.jpg', quality=82, optimize=True); ok += 1
    print(uf, 'fotos PDF', ok, 'sem foto', miss)
