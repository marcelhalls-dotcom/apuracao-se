#!/usr/bin/env python3
"""Baixa (com retomada) os arquivos do TSE no box e extrai os CSVs de uma UF.

  python3 baixar.py nacionais        # os 7 zips nacionais (≈270 MB) em raw/
  python3 baixar.py uf SE            # votacao_secao_2024_SE.zip + extrai os CSVs da UF em raw/se/
  python3 baixar.py limpar SE        # apaga raw/se/ e o zip da votação por seção da UF (o R2 é o depósito durável)

Só o servidor (box) fala com o TSE; o navegador nunca.
"""
import os, subprocess, sys, zipfile
from comum import RAW, CDN, NACIONAIS

def baixar(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    part = dest + '.part'
    for tent in range(6):
        r = subprocess.run(['curl', '-sfL', '--retry', '5', '--retry-delay', '3', '-C', '-', '-o', part, url])
        if r.returncode == 0:
            # confere se o zip está íntegro antes de aceitar
            try:
                zipfile.ZipFile(part).testzip(); os.replace(part, dest); return dest
            except Exception as e:
                print('zip inválido, baixando de novo:', e); os.remove(part)
        print(f'falha ao baixar {url} (tentativa {tent + 1})', file=sys.stderr)
    raise SystemExit(f'não consegui baixar {url}')

def nacionais():
    for chave, (path, _) in NACIONAIS.items():
        baixar(f'{CDN}/{path}', os.path.join(RAW, os.path.basename(path)))

def extrair(zip_path, membro, dest_dir):
    dest = os.path.join(dest_dir, membro)
    if os.path.exists(dest) and os.path.getsize(dest) > 0: return dest
    with zipfile.ZipFile(zip_path) as z:
        tmp = dest + '.tmp'
        with z.open(membro) as src, open(tmp, 'wb') as out:
            while True:
                b = src.read(1 << 22)
                if not b: break
                out.write(b)
        os.replace(tmp, dest)
    return dest

def uf(UF):
    UF = UF.upper(); d = os.path.join(RAW, UF.lower()); os.makedirs(d, exist_ok=True)
    nacionais()
    z = baixar(f'{CDN}/votacao_secao/votacao_secao_2024_{UF}.zip', os.path.join(RAW, f'votacao_secao_2024_{UF}.zip'))
    extrair(z, f'votacao_secao_2024_{UF}.csv', d)
    for chave, (path, membro) in NACIONAIS.items():
        if chave == 'eleitorado':
            extrair(os.path.join(RAW, os.path.basename(path)), membro, RAW)  # um CSV nacional, extraído uma vez
            continue
        extrair(os.path.join(RAW, os.path.basename(path)), membro.format(UF=UF), d)
    return d

def limpar(UF):
    import shutil
    UF = UF.upper()
    shutil.rmtree(os.path.join(RAW, UF.lower()), ignore_errors=True)
    try: os.remove(os.path.join(RAW, f'votacao_secao_2024_{UF}.zip'))
    except FileNotFoundError: pass

if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'nacionais': nacionais()
    elif cmd == 'uf': print(uf(sys.argv[2]))
    elif cmd == 'limpar': limpar(sys.argv[2])
