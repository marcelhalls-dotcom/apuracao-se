#!/usr/bin/env python3
"""Orquestra o import municipal 2024, UF por UF, com checkpoint (retoma de onde parou).

  python3 rodar.py              # todas as UFs (SE e AL primeiro), pulando as já concluídas
  python3 rodar.py SE AL        # só essas
  python3 rodar.py --refazer SE # ignora o checkpoint da UF

Etapas por UF: baixado → montado (verificação = 0 diferenças) → subido (público + privado, idempotente) → limpo (apaga os
CSVs brutos da UF; os JSON gerados ficam em out/). Se a verificação falhar, a UF NÃO sobe e fica marcada como bloqueada.
O progresso fica em <DOCS>/progress.md.
"""
import json, os, subprocess, sys, time
from comum import UFS, DOCS, load_state, save_state
import baixar, subir

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable

def agora(): return time.strftime('%d/%m/%Y %H:%M:%S')

def progresso():
    L = ['# Import municipal 2024 — progresso', '', f'Atualizado em {agora()} (BRT). Checkpoints em /workspace/m2024/state/*.json; '
         'verificação por UF em verificacao/<UF>.md.', '',
         '| UF | Etapa | Verificação | Municípios | Seções | Arquivos púb/priv | MB púb/priv | Tempo | Atualizado |', '|---|---|---|---|---|---|---|---|---|']
    for UF in UFS:
        st = load_state(UF); e = st.get('etapas', {}); t = st.get('totais', {})
        etapa = 'limpo' if e.get('limpo') else 'subido' if e.get('subido') else 'montado' if e.get('montado') else 'baixado' if e.get('baixado') else ('BLOQUEADO' if st.get('bloqueado') else '—')
        if st.get('bloqueado') and not e.get('subido'): etapa = 'BLOQUEADO: ' + st['bloqueado']
        v = '✅ 0 dif.' if st.get('ok_verificacao') else ('❌' if 'ok_verificacao' in st else '')
        L.append(f"| {UF} | {etapa} | {v} | {t.get('municipios', '')} | {t.get('secoes', '')} | "
                 f"{t.get('arquivos_publicos', '')}/{t.get('arquivos_privados', '')} | "
                 f"{(t.get('bytes_publicos') or 0) / 1e6:.1f}/{(t.get('bytes_privados') or 0) / 1e6:.1f} | {st.get('segundos_total', '')} | {st.get('atualizado', '')} |")
    open(os.path.join(DOCS, 'progress.md'), 'w').write('\n'.join(L) + '\n')

def rodar(UF, refazer=False):
    st = load_state(UF)
    if refazer: st['etapas'] = {}; st.pop('bloqueado', None)
    e = st.setdefault('etapas', {}); t0 = time.time()
    if e.get('limpo'): return True
    if not e.get('montado'):
        baixar.uf(UF); e['baixado'] = agora(); st['atualizado'] = agora(); save_state(st); progresso()
        r = subprocess.run([PY, os.path.join(HERE, 'montar_uf.py'), UF], cwd=HERE)
        st = load_state(UF); e = st.setdefault('etapas', {})
        if r.returncode != 0:
            st['bloqueado'] = f'verificação/montagem falhou (código {r.returncode})'; st['atualizado'] = agora(); save_state(st); progresso(); return False
        e['montado'] = agora(); st.pop('bloqueado', None); save_state(st); progresso()
    if not e.get('subido'):
        res = subir.subir_uf(UF)
        st['upload'] = res
        if res['pub']['faltando_apos_envio'] or res['pro']['faltando_apos_envio']:
            st['bloqueado'] = 'upload incompleto'; save_state(st); progresso(); return False
        e['subido'] = agora(); save_state(st); subir.indice(); progresso()
    baixar.limpar(UF); e['limpo'] = agora()
    st['segundos_total'] = round((st.get('segundos_total') or 0) + time.time() - t0); st['atualizado'] = agora(); save_state(st); progresso()
    return True

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]; refazer = '--refazer' in sys.argv
    alvo = [a.upper() for a in args] or UFS
    falhas = []
    for UF in alvo:
        print(f'== {UF} {agora()}', flush=True)
        try:
            if not rodar(UF, refazer): falhas.append(UF)
        except Exception as ex:
            st = load_state(UF); st['bloqueado'] = f'erro: {type(ex).__name__}: {str(ex)[:200]}'; st['atualizado'] = agora(); save_state(st); progresso()
            falhas.append(UF); print('ERRO', UF, ex, flush=True)
    print('falhas:', falhas)
    sys.exit(1 if falhas else 0)
