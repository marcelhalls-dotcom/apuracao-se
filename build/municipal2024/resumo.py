#!/usr/bin/env python3
"""Junta os relatórios de verificação por UF num resumo nacional: <DOCS>/RESUMO.md e RESUMO.json."""
import json, os
from comum import DOCS, UFS, load_state

def main():
    tot = {k: 0 for k in ('municipios', 'candidatos_prefeito', 'candidatos_vereador', 'secoes', 'locais', 'arquivos_publicos',
                          'bytes_publicos', 'arquivos_privados', 'bytes_privados')}
    cob = {k: 0 for k in ('locais', 'locais_com_bairro', 'locais_com_coord', 'locais_sem_cadastro', 'eleitores', 'eleitores_com_bairro', 'eleitores_com_coord')}
    red = {k: 0 for k in ('candidatos', 'com_rede', 'eleitos', 'eleitos_com_rede', 'links', 'links_grupo_whatsapp_omitidos')}
    linhas = []; problemas = []; fotos = {'alvo': 0, 'com_foto_no_tse': 0, 'bytes': 0}; seg = 0
    for UF in UFS:
        p = os.path.join(DOCS, 'verificacao', f'{UF}.json')
        if not os.path.exists(p): linhas.append(f'| {UF} | — |'); continue
        v = json.load(open(p)); st = load_state(UF)
        for k in tot: tot[k] += v['totais'].get(k, 0)
        for k in cob: cob[k] += v['cobertura_locais'].get(k, 0)
        for k in red: red[k] += v['redes'].get(k, 0)
        f = st.get('fotos') or {}
        fotos['alvo'] += f.get('alvo', 0); fotos['com_foto_no_tse'] += f.get('com_foto_no_tse', 0); fotos['bytes'] += f.get('bytes_enviados', 0)
        seg += st.get('segundos_total') or 0
        a = v['ausentes_conferidos_no_relatorio']; cr = a['conferencia_completa_relatorio']; e = v['eleitos']
        c = v['cobertura_locais']
        linhas.append(f"| {UF} | {'✅' if v['ok'] else '❌'} | {v['pares_candidato_municipio']} | {v['diferencas']} | {v['ausentes_no_munzona']} | "
                      f"{cr['candidatos_iguais']}/{cr['candidatos_diferentes']} | {cr['n_nulo_tecnico_diferentes']} | {v['secoes_nominal_x_detalhe_diferentes']} | "
                      f"{v['legenda']['partidos_com_diferenca']} | {e['divergencias_consulta_cand_x_munzona_x_saida']} | {e['n_eleitos_diferente_de_vagas']} | "
                      f"{len(v['sem_situacao_na_base_atual'])} | {len(v['carga'].get('suplementares_ignoradas', []))} | "
                      f"{100 * c['locais_com_bairro'] / max(1, c['locais']):.1f}% | {100 * c['locais_com_coord'] / max(1, c['locais']):.1f}% |")
        for x in v['sem_situacao_na_base_atual']: problemas.append(f"- {UF} · {x[1]} ({x[0]}) · {'Prefeito' if x[2] == 11 else 'Vereador'}: base atual do TSE sem situação final")
        for x in v['carga'].get('suplementares_ignoradas', []): problemas.append(f"- {UF} · {x[4]} ({x[3]}) · {x[1]} em {x[2]} (cargo {x[5]}) — fora do escopo, só 06/10 e 27/10/2024")
        for d in e['eleitos_diferente_de_vagas']: problemas.append(f"- {UF} · {d['nm']} ({d['cd']}) · cargo {d['c']}: {d['eleitos']} eleitos para {d['vagas']} vagas")
        for d in e['divergencias']: problemas.append(f"- {UF} · {d['nm']} ({d['cd']}) · cargo {d['c']}: eleitos divergem entre consulta_cand e munzona")
        for d in cr['nulo_tecnico_diferentes']: problemas.append(f"- {UF} · {d[1]} ({d[0]}) · cargo {d[2]}: votos de candidatos fora do Anexo IX = {d[4]}, “nulos técnico” do relatório = {d[5]}")
    pc = lambda a, b: f'{100 * a / b:.1f}%' if b else '-'
    L = ['# Municipais 2024 — resumo nacional da importação', '',
         f"Municípios {tot['municipios']:,} · candidatos Prefeito {tot['candidatos_prefeito']:,} · Vereador {tot['candidatos_vereador']:,} · seções {tot['secoes']:,} · locais {tot['locais']:,}".replace(',', '.'),
         f"Arquivos: públicos {tot['arquivos_publicos']:,} ({tot['bytes_publicos'] / 1e6:.0f} MB) · privados {tot['arquivos_privados']:,} ({tot['bytes_privados'] / 1e6:.0f} MB)".replace(',', '.'),
         f"Locais com bairro {pc(cob['locais_com_bairro'], cob['locais'])} · com coordenadas {pc(cob['locais_com_coord'], cob['locais'])} (ponderado por eleitores: bairro {pc(cob['eleitores_com_bairro'], cob['eleitores'])}, coordenadas {pc(cob['eleitores_com_coord'], cob['eleitores'])})",
         f"Redes sociais: {pc(red['com_rede'], red['candidatos'])} dos candidatos ({red['com_rede']:,}/{red['candidatos']:,}); eleitos {pc(red['eleitos_com_rede'], red['eleitos'])}; links {red['links']:,}; links de grupo de WhatsApp omitidos {red['links_grupo_whatsapp_omitidos']}".replace(',', '.'),
         f"Fotos (sob demanda): {fotos['com_foto_no_tse']:,}/{fotos['alvo']:,} ({fotos['bytes'] / 1e6:.0f} MB enviados)".replace(',', '.'),
         f"Tempo de pipeline somado: {seg / 60:.0f} min", '',
         '| UF | OK | pares cand×mun | dif. munzona | fora do munzona | relatório iguais/dif. | nulo téc. dif. | seção×detalhe | legenda dif. | eleitos div. | eleitos≠vagas | sem situação | suplementares | bairro | coord. |',
         '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'] + linhas + ['', '## Problemas de dados encontrados', ''] + problemas
    open(os.path.join(DOCS, 'RESUMO.md'), 'w').write('\n'.join(L) + '\n')
    json.dump({'totais': tot, 'cobertura': cob, 'redes': red, 'fotos': fotos, 'segundos': seg}, open(os.path.join(DOCS, 'RESUMO.json'), 'w'), ensure_ascii=False, indent=1)
    print('\n'.join(L[:8]))

if __name__ == '__main__':
    main()
