#!/usr/bin/env python3
"""Fotos 2024 só de quem aparece no "Cadê Meu Eleito?" — guardadas sob demanda (lazy), como em 2026.

Conjunto: todos os candidatos a Prefeito, todos os eleitos (Prefeito e Vereador) e todo vereador que aparece em algum
top 3 de bairro. As fotos do TSE (foto_cand2024_<UF>_div.zip, 13,6 GB no total) NÃO são baixadas inteiras: lemos do zip
remoto só os arquivos necessários (uma requisição HTTP Range por foto) e enviamos como estão (JPEG ~30 KB) para o bucket
público em m2024/<uf>/fotos/<sq>.jpg. Idempotente (pula o que já existe no R2 com o mesmo tamanho).

  python3 fotos.py SE AL ...     # padrão: todas as UFs com checkpoint "subido"
"""
import json, os, struct, sys, urllib.request, zipfile, zlib
from concurrent.futures import ThreadPoolExecutor
from comum import OUT, PREFIX, UFS, CDN_FOTOS, BUCKET_PUB, load_state, save_state
import relatorio, subir

def alvo(uf):
    """sq dos candidatos que precisam de foto, a partir dos JSON gerados."""
    pub = os.path.join(OUT, 'pub', PREFIX, uf, 'mun'); pro = os.path.join(OUT, 'pro', PREFIX, uf, 'top3')
    sqs = set()
    for f in os.listdir(pub):
        m = json.load(open(os.path.join(pub, f)))
        c13 = m['c13']
        sqs |= {c['sq'] for c in m['c11']} | {c['sq'] for c in c13 if c['e']}
        t = json.load(open(os.path.join(pro, f)))
        for o in t['top']:
            sqs |= {c13[n]['sq'] for n, _ in o['v']['top3']}
    return sqs

def pegar(url, zi):
    ini = zi.header_offset; fim = ini + 30 + len(zi.filename.encode()) + 256 + zi.compress_size
    for tent in range(6):
        try:
            b = urllib.request.urlopen(urllib.request.Request(url, headers={'Range': f'bytes={ini}-{fim}'}), timeout=60).read(); break
        except Exception:
            if tent == 5: raise
    n, e = struct.unpack('<HH', b[26:30]); d = b[30 + n + e: 30 + n + e + zi.compress_size]
    if zi.compress_type == zipfile.ZIP_DEFLATED: d = zlib.decompress(d, -15)
    assert len(d) == zi.file_size
    return d

def uf_fotos(UF):
    uf = UF.lower(); url = f'{CDN_FOTOS}/foto_cand2024_{UF}_div.zip'
    sqs = alvo(uf)
    z = zipfile.ZipFile(relatorio.RangeFile(url, bloco=1 << 22))
    por_sq = {}
    for zi in z.infolist():
        nm = os.path.basename(zi.filename)
        if nm.startswith('F' + UF) and nm.lower().endswith(('.jpg', '.jpeg')):
            por_sq[nm[3:].split('_')[0].split('.')[0]] = zi
    remoto = subir.listar(BUCKET_PUB, f'{PREFIX}/{uf}/fotos/')
    tem = [s for s in sqs if s in por_sq]; sem = [s for s in sqs if s not in por_sq]
    todo = [s for s in tem if remoto.get(f'{PREFIX}/{uf}/fotos/{s}.jpg', (None, -1))[1] != por_sq[s].file_size]
    s3 = subir.client()
    def um(s):
        d = pegar(url, por_sq[s])
        s3.put_object(Bucket=BUCKET_PUB, Key=f'{PREFIX}/{uf}/fotos/{s}.jpg', Body=d, ContentType='image/jpeg',
                      CacheControl='public, max-age=2592000, immutable')
        return len(d)
    with ThreadPoolExecutor(24) as ex: tam = sum(ex.map(um, todo))
    r = {'alvo': len(sqs), 'com_foto_no_tse': len(tem), 'sem_foto_no_tse': len(sem), 'enviadas_agora': len(todo), 'bytes_enviados': tam}
    st = load_state(UF); st['fotos'] = r; save_state(st)
    # lista de quem tem foto, para o app não pedir foto inexistente
    lst = sorted(tem); p = os.path.join(OUT, 'pub', PREFIX, uf, 'fotos.json')
    open(p, 'w').write(json.dumps({'uf': UF, 'sq': lst}, separators=(',', ':')))
    subir.put(BUCKET_PUB, f'{PREFIX}/{uf}/fotos.json', open(p, 'rb').read())
    return r

if __name__ == '__main__':
    args = [a.upper() for a in sys.argv[1:]]
    alvo_ufs = args or [u for u in UFS if load_state(u).get('etapas', {}).get('subido')]
    for UF in alvo_ufs:
        print(UF, json.dumps(uf_fotos(UF)), flush=True)
