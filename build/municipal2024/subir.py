#!/usr/bin/env python3
"""Sobe os JSON de uma UF para o R2 de forma idempotente (só envia o que mudou: MD5 local × ETag remoto).

  python3 subir.py SE            # out/pub/m2024/se → cademeuvoto-dados ; out/pro/m2024/se → cademeuvoto-dados-pro
  python3 subir.py indice        # m2024/index.json (público) a partir dos checkpoints
  python3 subir.py SE --dry-run

Credenciais só do ambiente (CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID, como em build/brasil/upload_r2.py, ou
R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY). Nada é impresso nem gravado. Lista/escreve só dentro de m2024/<uf>/:
nunca apaga nada e nunca toca nos dados de 2026.
"""
import hashlib, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from comum import OUT, PREFIX, BUCKET_PUB, BUCKET_PRO, UFS, dumps, load_state, save_state

ACCOUNT = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '640c5dffbaf852bac0e1a376c01c38f7')
CC = {BUCKET_PUB: 'public, max-age=86400, stale-while-revalidate=604800', BUCKET_PRO: 'private, max-age=86400'}

def creds():
    ak, sk = os.environ.get('R2_ACCESS_KEY_ID'), os.environ.get('R2_SECRET_ACCESS_KEY')
    if ak and sk: return ak, sk
    tok = os.environ['CLOUDFLARE_API_TOKEN']
    req = urllib.request.Request(f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/tokens/verify', headers={'Authorization': 'Bearer ' + tok})
    return json.load(urllib.request.urlopen(req, timeout=30))['result']['id'], hashlib.sha256(tok.encode()).hexdigest()

_s3 = None
def client():
    global _s3
    if _s3 is None:
        import boto3; from botocore.config import Config
        ak, sk = creds()
        _s3 = boto3.client('s3', endpoint_url=f'https://{ACCOUNT}.r2.cloudflarestorage.com', aws_access_key_id=ak, aws_secret_access_key=sk,
                           region_name='auto', config=Config(max_pool_connections=48, retries={'max_attempts': 10, 'mode': 'adaptive'}))
    return _s3

def listar(bucket, prefix):
    out = {}
    for page in client().get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=prefix):
        for o in page.get('Contents', []): out[o['Key']] = (o['ETag'].strip('"'), o['Size'])
    return out

def md5b(b): return hashlib.md5(b).hexdigest()

def put(bucket, key, body):
    cc = CC[bucket]
    if bucket == BUCKET_PUB and key.endswith('/index.json'): cc = 'public, max-age=300, stale-while-revalidate=3600'   # índices mudam a cada UF
    client().put_object(Bucket=bucket, Key=key, Body=body, ContentType='application/json; charset=utf-8', CacheControl=cc)

def subir_dir(bucket, base, prefix, dry=False):
    assert prefix.split('/')[0] in (PREFIX, 'e2026') and prefix.endswith('/') and prefix.count('/') >= 2
    locais = {}
    root = os.path.join(base, prefix)
    for dp, _, fs in os.walk(root):
        for f in fs:
            if f.endswith('.json'):
                p = os.path.join(dp, f); locais[os.path.relpath(p, base)] = p
    remoto = listar(bucket, prefix)
    todo = []
    for k, p in locais.items():
        b = open(p, 'rb').read()
        if remoto.get(k, (None,))[0] != md5b(b): todo.append((k, b))
    orfaos = sorted(set(remoto) - set(locais))
    if not dry and todo:
        with ThreadPoolExecutor(16) as ex: list(ex.map(lambda kb: put(bucket, kb[0], kb[1]), todo))
    # confere: tudo o que existe localmente está no bucket com o mesmo MD5
    if not dry:
        remoto = listar(bucket, prefix)
        faltando = [k for k, p in locais.items() if remoto.get(k, (None,))[0] != md5b(open(p, 'rb').read())]
    else: faltando = []
    return {'bucket': bucket, 'arquivos': len(locais), 'enviados': len(todo) if not dry else 0, 'a_enviar': len(todo),
            'bytes': sum(os.path.getsize(p) for p in locais.values()), 'faltando_apos_envio': len(faltando), 'orfaos_remotos': len(orfaos)}

def subir_uf(UF, dry=False):
    uf = UF.lower(); pre = f'{PREFIX}/{uf}/'
    r = {'pub': subir_dir(BUCKET_PUB, os.path.join(OUT, 'pub'), pre, dry), 'pro': subir_dir(BUCKET_PRO, os.path.join(OUT, 'pro'), pre, dry)}
    return r

def indice(dry=False):
    ufs = {}
    for UF in UFS:
        st = load_state(UF)
        if st.get('etapas', {}).get('subido'):
            t = st.get('totais', {}); ufs[UF.lower()] = {'muns': t.get('municipios'), 'secoes': t.get('secoes'), 'locais': t.get('locais')}
    obj = {'ano': 2024, 'eleicao': 'Eleições Municipais 2024', 'turnos': {'1': '06/10/2024', '2': '27/10/2024'}, 'cargos': {'11': 'Prefeito', '13': 'Vereador'},
           'ufs': ufs, 'fonte': 'TSE — Dados Abertos', 'gerado': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
           'layout': {'publico': ['m2024/<uf>/index.json', 'm2024/<uf>/mun/<cd>.json', 'm2024/<uf>/locais/<cd>.json', 'm2024/<uf>/redes/<cd>.json'],
                      'assinantes': ['m2024/<uf>/top3/<cd>.json', 'm2024/<uf>/det/<cd>/{geo,agg,11,13-loc,13-sec|13-sec-z<zona>}.json']}}
    b = dumps(obj).encode()
    p = os.path.join(OUT, 'pub', PREFIX, 'index.json'); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'wb').write(b)
    if not dry: put(BUCKET_PUB, f'{PREFIX}/index.json', b)
    return {'ufs': len(ufs)}

if __name__ == '__main__':
    dry = '--dry-run' in sys.argv
    if sys.argv[1] == 'indice': print(indice(dry))
    else: print(json.dumps(subir_uf(sys.argv[1].upper(), dry)))
