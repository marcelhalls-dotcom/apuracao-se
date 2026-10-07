#!/usr/bin/env python3
"""Sobe os dados pesados (mapa/, fotos/, tse/) para o bucket R2 servido em https://dados.cademeuvoto.com.br.

Uso:
  python3 upload_r2.py                 # tudo (incremental: só envia o que mudou — compara MD5/ETag)
  python3 upload_r2.py mapa/sp fotos/sp tse/ele2026/6259/dados/sp ...   # só esses prefixos
  python3 upload_r2.py --dry-run ...

Credenciais SOMENTE do ambiente (nada gravado em disco):
  R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY   (token S3 do R2), ou
  CLOUDFLARE_API_TOKEN — conforme a doc da Cloudflare (r2/api/tokens, "Get S3 API credentials from an API token"):
  Access Key ID = id do token; Secret = SHA-256 do valor do token. Token precisa de "Workers R2 Storage: Edit".
  CLOUDFLARE_ACCOUNT_ID (padrão: conta Gerenciamento), R2_BUCKET (padrão: cademeuvoto-dados).
Requer: pip install boto3
"""
import hashlib, json, mimetypes, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

SITE = os.environ.get('CMV_SITE') or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
ACCOUNT = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '640c5dffbaf852bac0e1a376c01c38f7')
BUCKET = os.environ.get('R2_BUCKET', 'cademeuvoto-dados')
ROOTS = ['mapa', 'fotos', 'tse']  # caminhos idênticos aos do site: DATA_BASE + '/' + caminho

def creds():
    if os.environ.get('R2_ACCESS_KEY_ID') and os.environ.get('R2_SECRET_ACCESS_KEY'):
        return os.environ['R2_ACCESS_KEY_ID'], os.environ['R2_SECRET_ACCESS_KEY']
    tok = os.environ.get('CLOUDFLARE_API_TOKEN')
    if not tok: sys.exit('Defina R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY ou CLOUDFLARE_API_TOKEN no ambiente.')
    req = urllib.request.Request(f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/tokens/verify',
                                 headers={'Authorization': 'Bearer ' + tok})
    tid = json.load(urllib.request.urlopen(req, timeout=30))['result']['id']
    return tid, hashlib.sha256(tok.encode()).hexdigest()

def headers_for(key):
    ext = key.rsplit('.', 1)[-1].lower()
    if ext == 'json': ct = 'application/json; charset=utf-8'
    elif ext == 'geojson': ct = 'application/geo+json; charset=utf-8'
    elif ext in ('jpg', 'jpeg'): ct = 'image/jpeg'
    else: ct = mimetypes.guess_type(key)[0] or 'application/octet-stream'
    if key.startswith('tse/') and '/fotos/' in key:
        cc = 'public, max-age=2592000'                      # foto TSE por sqcand: 30 dias
    elif ext in ('jpg', 'jpeg'):
        cc = 'public, max-age=604800'                       # fotos/<uf>/<cargo>/<n>.jpg: 7 dias
    else:
        cc = 'public, max-age=86400, stale-while-revalidate=604800'  # dados: 1 dia (+7 dias servindo velho enquanto revalida)
    return ct, cc

def local_files(prefixes):
    out = []
    for p in prefixes:
        base = os.path.join(SITE, p)
        if os.path.isfile(base): out.append(p); continue
        for d, _, fs in os.walk(base):
            for f in fs:
                if f.startswith('.'): continue
                out.append(os.path.relpath(os.path.join(d, f), SITE).replace(os.sep, '/'))
    return sorted(set(out))

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry-run' in sys.argv
    files = local_files(args or ROOTS)
    import boto3
    from botocore.config import Config
    ak, sk = creds()
    s3 = boto3.client('s3', endpoint_url=f'https://{ACCOUNT}.r2.cloudflarestorage.com', aws_access_key_id=ak,
                      aws_secret_access_key=sk, region_name='auto',
                      config=Config(max_pool_connections=32, retries={'max_attempts': 8, 'mode': 'adaptive'}))
    remote = {}
    for pre in sorted({f.split('/')[0] for f in files}):
        for page in s3.get_paginator('list_objects_v2').paginate(Bucket=BUCKET, Prefix=pre + '/'):
            for o in page.get('Contents', []): remote[o['Key']] = o['ETag'].strip('"')
    todo = []
    for f in files:
        md5 = hashlib.md5(open(os.path.join(SITE, f), 'rb').read()).hexdigest()
        if remote.get(f) != md5: todo.append(f)
    size = sum(os.path.getsize(os.path.join(SITE, f)) for f in todo)
    print(f'{len(files)} arquivos locais · {len(todo)} a enviar ({size/1e6:.1f} MB) · bucket {BUCKET}')
    if dry or not todo: return
    done = [0]
    def put(f):
        ct, cc = headers_for(f)
        with open(os.path.join(SITE, f), 'rb') as fh:
            s3.put_object(Bucket=BUCKET, Key=f, Body=fh.read(), ContentType=ct, CacheControl=cc)
        done[0] += 1
        if done[0] % 2000 == 0: print(' ', done[0], 'enviados')
    with ThreadPoolExecutor(24) as ex: list(ex.map(put, todo))
    print('OK', len(todo), 'enviados')

if __name__ == '__main__':
    main()
