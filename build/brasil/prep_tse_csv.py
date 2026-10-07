#!/usr/bin/env python3
"""Prepara os CSVs do TSE em /tmp/tse-<uf>/ a partir dos zips em /tmp/tsezip (ou TSEZIP=...).
Uso: prep_tse_csv.py ES RJ ...   — uma passada só pelos arquivos BR para todas as UFs pedidas.
Zips esperados (https://cdn.tse.jus.br/estatistica/sead/odsele/):
  votacao_secao/votacao_secao_2026_<UF>.zip, votacao_secao/votacao_secao_2026_BR.zip,
  detalhe_votacao_secao/detalhe_votacao_secao_2026.zip, eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip
Não altera nenhum número: só extrai e filtra linhas por SG_UF."""
import os, sys, subprocess, zipfile, io
Z = os.environ.get('TSEZIP', '/tmp/tsezip')
UFS = [u.upper() for u in sys.argv[1:]]
assert UFS, 'informe as UFs'
for U in UFS:
    raw = f'/tmp/tse-{U.lower()}'; os.makedirs(f'{raw}/votacao', exist_ok=True)
    dst = f'{raw}/votacao/votacao_secao_2026_{U}.csv'
    if not os.path.exists(dst):
        with zipfile.ZipFile(f'{Z}/votacao_secao_2026_{U}.zip') as z: z.extract(f'votacao_secao_2026_{U}.csv', f'{raw}/votacao')
    with zipfile.ZipFile(f'{Z}/eleitorado_local_votacao_2026.zip') as z: z.extract(f'eleitorado_local_votacao_2026_{U}.csv', raw)
    print(U, 'votacao + eleitorado ok', flush=True)

def filtra(zipf, member, outs, header_too=True):
    """Copia as linhas de `member` cuja coluna SG_UF está em outs (dict UF->arquivo aberto em append binário)."""
    with zipfile.ZipFile(zipf) as z, z.open(member) as f:
        hdr = f.readline(); cols = hdr.decode('latin1').strip().split(';'); iu = cols.index('"SG_UF"')
        for fo in outs.values():
            if header_too: fo.write(hdr)
        for line in f:
            # SG_UF vem entre aspas; split simples basta até a coluna SG_UF (campos anteriores não têm ';')
            u = line.split(b';', iu + 1)[iu].strip(b'"').decode()
            fo = outs.get(u)
            if fo: fo.write(line)

# presidente por seção (BR filtrado por UF), com cabeçalho
outs = {U: open(f'/tmp/tse-{U.lower()}/votacao_secao_2026_pres_{U}.csv', 'wb') for U in UFS}
filtra(f'{Z}/votacao_secao_2026_BR.zip', 'votacao_secao_2026_BR.csv', outs)
for fo in outs.values(): fo.close()
print('pres ok', flush=True)
# detalhe: arquivo da UF (com cabeçalho) + linhas da UF no _BR.csv (sem repetir cabeçalho)
outs = {}
for U in UFS:
    fo = open(f'/tmp/tse-{U.lower()}/detalhe_votacao_secao_2026_{U}.csv', 'wb')
    with zipfile.ZipFile(f'{Z}/detalhe_votacao_secao_2026.zip') as z, z.open(f'detalhe_votacao_secao_2026_{U}.csv') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''): fo.write(chunk)
    outs[U] = fo
filtra(f'{Z}/detalhe_votacao_secao_2026.zip', 'detalhe_votacao_secao_2026_BR.csv', outs, header_too=False)
for fo in outs.values(): fo.close()
print('detalhe ok', flush=True)
for U in UFS:
    print(subprocess.run(['du', '-sh', f'/tmp/tse-{U.lower()}'], capture_output=True, text=True).stdout.strip())
