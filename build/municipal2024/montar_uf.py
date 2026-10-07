#!/usr/bin/env python3
"""Monta os JSON de uma UF (municipais 2024) a partir dos CSVs do TSE já extraídos em raw/<uf>/ e verifica os totais.

  python3 montar_uf.py SE

Saída em out/pub/m2024/<uf>/ (bucket público) e out/pro/m2024/<uf>/ (bucket privado, assinantes), e o relatório de
verificação em <DOCS>/verificacao/<UF>.json|md. Termina com código 2 se a soma por seção não bater com o TSE.
"""
import json, os, random, shutil, sys, time
import duckdb, numpy as np
import relatorio
from comum import RAW, OUT, DOCS, PREFIX, CAPITAIS, ELEITO, NACIONAIS, dumps, bairro_norm, load_state, save_state

def csv(p):
    return f"read_csv('{p}', delim=';', header=true, encoding='latin-1', all_varchar=true, quote='\"')"

def coord(lat, lon):
    try: la, lo = float(str(lat).replace(',', '.')), float(str(lon).replace(',', '.'))
    except (TypeError, ValueError): return None, None
    if -34 < la < 6 and -74 < lo < -34: return round(la, 6), round(lo, 6)
    return None, None

def w(base, key, obj, stats):
    p = os.path.join(base, key); os.makedirs(os.path.dirname(p), exist_ok=True)
    s = dumps(obj).encode(); open(p, 'wb').write(s)
    stats[0] += 1; stats[1] += len(s)

def main(UF):
    t0 = time.time(); UF = UF.upper(); uf = UF.lower(); d = os.path.join(RAW, uf)
    f = lambda k: os.path.join(d, NACIONAIS[k][1].format(UF=UF))
    pub = os.path.join(OUT, 'pub'); pro = os.path.join(OUT, 'pro'); prop = os.path.join(OUT, 'proposta')
    for b in (pub, pro, prop): shutil.rmtree(os.path.join(b, PREFIX, uf), ignore_errors=True)
    con = duckdb.connect(); con.execute("SET threads=8; SET memory_limit='11GB'; SET preserve_insertion_order=false")
    X = lambda sql, *a: con.execute(sql, list(a)) if a else con.execute(sql)
    # ---------- carga ----------
    X(f"""create table v as select lpad(CD_MUNICIPIO,5,'0') cd, NR_ZONA::int z, NR_SECAO::int s, CD_CARGO::int c, NR_TURNO::int t,
          NR_VOTAVEL::int nv, SQ_CANDIDATO::bigint sq, NR_LOCAL_VOTACAO::int nl, QT_VOTOS::int q, CD_ELEICAO el
          from {csv(os.path.join(d, f'votacao_secao_2024_{UF}.csv'))} where CD_CARGO in ('11','13') order by cd, c, t""")
    X(f"""create table det as select lpad(CD_MUNICIPIO,5,'0') cd, any_value(NM_MUNICIPIO) nm, NR_ZONA::int z, NR_SECAO::int s, CD_CARGO::int c, NR_TURNO::int t,
          sum(QT_APTOS::int) aptos, sum(QT_COMPARECIMENTO::int) comp, sum(QT_ABSTENCOES::int) abst, sum(QT_VOTOS_NOMINAIS::int) nom,
          sum(QT_VOTOS_BRANCOS::int) br, sum(QT_VOTOS_NULOS::int) nu, sum(QT_VOTOS_LEGENDA::int) leg, sum(QT_VOTOS_ANULADOS_APU_SEP::int) anul,
          any_value(NR_LOCAL_VOTACAO::int) nl, any_value(NM_LOCAL_VOTACAO) nm_local, any_value(DS_LOCAL_VOTACAO_ENDERECO) end_local, count(*) nlin
          from {csv(f('detalhe_secao'))} where CD_CARGO in ('11','13') group by all""")
    X(f"""create table cand as select SG_UE cd, CD_CARGO::int c, NR_TURNO::int t, SQ_CANDIDATO::bigint sq, NR_CANDIDATO::int nu, NM_CANDIDATO nome,
          NM_URNA_CANDIDATO urna, SG_PARTIDO sg, NR_PARTIDO::int np, SG_FEDERACAO fed, NM_COLIGACAO col, DS_COMPOSICAO_COLIGACAO comp_col,
          DS_SITUACAO_CANDIDATURA sit, DS_SIT_TOT_TURNO st, DS_GENERO gen, CD_ELEICAO el
          from {csv(f('cand'))} where CD_CARGO in ('11','13')""")
    X(f"""create table mz as select lpad(CD_MUNICIPIO,5,'0') cd, CD_CARGO::int c, NR_TURNO::int t, SQ_CANDIDATO::bigint sq, any_value(NR_CANDIDATO::int) nu,
          any_value(NM_URNA_CANDIDATO) urna, any_value(SG_PARTIDO) sg, sum(QT_VOTOS_NOMINAIS::bigint) nom, sum(QT_VOTOS_NOMINAIS_VALIDOS::bigint) nomv,
          string_agg(distinct NM_TIPO_DESTINACAO_VOTOS, '|') dest, string_agg(distinct DS_SIT_TOT_TURNO, '|') st, any_value(NM_MUNICIPIO) nm, any_value(DS_SITUACAO_CANDIDATURA) sitc
          from {csv(f('cand_munzona'))} where CD_CARGO in ('11','13') group by cd, c, t, sq""")
    X(f"""create table pm as select lpad(CD_MUNICIPIO,5,'0') cd, CD_CARGO::int c, NR_TURNO::int t, NR_PARTIDO::int np, any_value(SG_PARTIDO) sg,
          sum(QT_VOTOS_LEGENDA_VALIDOS::bigint) leg, sum(QT_TOTAL_VOTOS_LEG_VALIDOS::bigint) tot, sum(QT_VOTOS_NOMINAIS_VALIDOS::bigint) nomv,
          sum(QT_VOTOS_LEGENDA_ANUL_SUBJUD::bigint + QT_VOTOS_LEGENDA_ANULADOS::bigint) leg_anul
          from {csv(f('partido_munzona'))} where CD_CARGO in ('11','13') group by cd, c, t, np""")
    X(f"""create table vagas as select SG_UE cd, CD_CARGO::int c, sum(QT_VAGA::int) n from {csv(f('vagas'))} where CD_CARGO in ('11','13') group by all""")
    X(f"""create table redes as select SQ_CANDIDATO::bigint sq, list(DS_URL order by NR_ORDEM_REDE_SOCIAL::int) urls from {csv(f('redes'))} group by sq""")
    ele = os.path.join(RAW, NACIONAIS['eleitorado'][1])
    X(f"""create table loc as select lpad(CD_MUNICIPIO,5,'0') cd, NR_ZONA::int z, NR_LOCAL_VOTACAO::int nl, mode(NM_LOCAL_VOTACAO) nome, mode(DS_ENDERECO) ender,
          mode(NM_BAIRRO) bairro, mode(NR_CEP) cep, mode(NR_LATITUDE) lat, mode(NR_LONGITUDE) lon, sum(QT_ELEITOR_SECAO::int) eleit,
          list(distinct NR_LOCAL_VOTACAO_ORIGINAL::int) orig
          from {csv(ele)} where SG_UF='{UF}' and NR_TURNO='1' group by all""")
    info = {k: X(f'select count(*) from {k}').fetchone()[0] for k in ('v', 'det', 'cand', 'mz', 'pm', 'vagas', 'redes', 'loc')}
    info['eleicoes_votos'] = X("select el, t, count(*) from v group by all order by all").fetchall()
    info['eleicoes_cand'] = X("select el, t, count(*) from cand group by all order by all").fetchall()
    info['det_duplicadas'] = X("select count(*) from det where nlin>1").fetchone()[0]
    print(UF, 'carga', info, f'{time.time() - t0:.1f}s', flush=True)

    # ---------- verificação 1: soma por seção = votação nominal do TSE por município ----------
    X("""create table sv as select cd, c, t, sq, sum(q)::bigint q from v where sq > 0 group by all""")
    dif = X("""select coalesce(a.cd,b.cd) cd, coalesce(a.c,b.c) c, coalesce(a.t,b.t) t, coalesce(a.sq,b.sq) sq, coalesce(a.q,0) secao, coalesce(b.nom,0) tse, b.urna, b.dest
               from sv a full outer join mz b on a.cd=b.cd and a.c=b.c and a.t=b.t and a.sq=b.sq
               where coalesce(a.q,0) <> coalesce(b.nom,0) order by 1,2,3""").fetchall()
    tem_mz = {(r[0], r[1], r[2], r[3]) for r in X("select cd, c, t, sq from mz").fetchall()}
    dif_valor = [r for r in dif if (r[0], r[1], r[2], r[3]) in tem_mz]          # candidato presente nas duas fontes e votos diferentes
    ausentes = [r for r in dif if (r[0], r[1], r[2], r[3]) not in tem_mz]       # candidato que a base atual do munzona não traz
    ver = {'uf': UF, 'pares_candidato_municipio': X("select count(*) from mz").fetchone()[0],
           'votos_nominais_secao': X("select sum(q) from sv").fetchone()[0], 'votos_nominais_tse': X("select sum(nom) from mz").fetchone()[0],
           'diferencas': len(dif_valor), 'diferencas_exemplos': [list(map(str, r)) for r in dif_valor[:50]],
           'ausentes_no_munzona': len(ausentes), 'ausentes_votos': sum(r[4] for r in ausentes)}
    # legenda (vereador): seção × votacao_partido_munzona
    dl = X("""with a as (select cd, nv np, sum(q)::bigint q from v where c=13 and nv between 10 and 94 and sq <= 0 group by all),
                   b as (select cd, np, leg + leg_anul leg from pm where c=13 and t=1)
              select count(*), coalesce(sum(abs(coalesce(a.q,0)-coalesce(b.leg,0))),0) from a full outer join b on a.cd=b.cd and a.np=b.np
              where coalesce(a.q,0) <> coalesce(b.leg,0)""").fetchone()
    ver['legenda'] = {'votos_secao': X("select sum(q) from v where c=13 and nv between 10 and 94 and sq <= 0").fetchone()[0],
                      'votos_tse': X("select sum(leg+leg_anul) from pm where c=13 and t=1").fetchone()[0], 'partidos_com_diferenca': dl[0], 'soma_abs_diferenca': dl[1]}
    # consistência interna: soma dos candidatos na seção = QT_VOTOS_NOMINAIS do detalhe da seção
    ds = X("""with a as (select cd,z,s,c,t,sum(q) q from v where sq>0 group by all)
              select count(*) from a join det b using (cd,z,s,c,t) where a.q <> b.nom""").fetchone()[0]
    ver['secoes_nominal_x_detalhe_diferentes'] = ds
    ver['votos_outros_ignorados'] = X("select coalesce(sum(q),0) from v where sq<=0 and not (nv in (95,96) or (c=13 and nv between 10 and 94))").fetchone()[0]

    # ---------- dados por município ----------
    vag = {(r[0], r[1]): r[2] for r in X("select cd, c, n from vagas").fetchall()}
    redes = {r[0]: r[1] for r in X("select r.sq, r.urls from redes r join (select distinct sq from cand) c using (sq)").fetchall()}
    cands = {}
    for r in X("""select cd, c, sq, any_value(nu), any_value(nome), any_value(urna), any_value(sg), any_value(np), any_value(fed), any_value(col), any_value(comp_col),
                         any_value(sit), max(case when t=1 then st end), max(case when t=2 then st end), any_value(gen)
                  from cand group by cd, c, sq""").fetchall():
        cands.setdefault(r[0], {}).setdefault(r[1], {})[r[2]] = r
    mzd = {}
    for r in X("select cd, c, t, sq, nom, nomv, dest, st, nu, urna, sg, sitc from mz").fetchall():
        mzd[(r[0], r[1], r[2], r[3])] = r
    pmd = {}
    for r in X("select cd, np, sg, leg, tot, nomv, leg_anul from pm where c=13 and t=1").fetchall():
        pmd.setdefault(r[0], []).append(r)
    locd = {}
    for r in X("select cd, z, nl, nome, ender, bairro, cep, lat, lon, eleit, orig from loc").fetchall():
        locd[(r[0], r[1], r[2])] = r
        for o in (r[10] or []):
            if o is not None and o != r[2]: locd.setdefault((r[0], r[1], -o), r)  # fallback pelo número original
    detrows = {}
    for r in X("select cd, nm, z, s, c, t, aptos, comp, abst, nom, br, nu, leg, anul, nl, nm_local, end_local from det order by cd, z, s").fetchall():
        detrows.setdefault(r[0], []).append(r)
    muns = sorted(detrows)
    nm_mun = {cd: detrows[cd][0][1] for cd in muns}
    runoff = {r[0] for r in X("select distinct cd from v where c=11 and t=2").fetchall()}
    NUL = (None, '#NULO', '#NE', '')
    # ---------- segunda fonte: relatório oficial de totalização (PDF) ----------
    pedidos = {(r[0], nm_mun.get(r[0], ''), r[2]) for r in ausentes}
    sem_sit = set()
    for cd in muns:
        for c in (11, 13):
            cc = cands.get(cd, {}).get(c, {})
            tf = 2 if (c == 11 and cd in runoff) else 1
            tem = any((r[13] if tf == 2 else r[12]) not in NUL for r in cc.values()) or \
                  any(((mzd.get((cd, c, tf, sq)) or [None] * 8)[7]) not in NUL for sq in cc)
            if not tem: sem_sit.add((cd, c)); pedidos.add((cd, nm_mun[cd], tf))
    rel = relatorio.relatorios(UF, pedidos) if pedidos else {}
    nv_de = {(r[0], r[1], r[2]): r[3] for r in X("select cd, c, sq, any_value(nv) from v where sq>0 group by all").fetchall()}
    pdf_dif, pdf_ok, pdf_nv = [], 0, []
    for r in ausentes:
        cd, c, t, sq, secv = r[0], r[1], r[2], r[3], r[4]
        R = rel.get((cd, t)); nr = nv_de.get((cd, c, sq))
        if not R or c not in R or nr not in R[c]: pdf_nv.append([cd, nm_mun.get(cd), c, t, str(sq), secv]); continue
        if R[c][nr][0] == secv: pdf_ok += 1
        else: pdf_dif.append([cd, nm_mun.get(cd), c, t, str(sq), nr, secv, R[c][nr][0]])
    # conferência completa de cada município×turno lido no relatório: todo candidato com voto na seção deve estar no Anexo IX
    # com o mesmo número de votos; os que não estão (registro cancelado antes da eleição) somam exatamente os "votos nulos técnico".
    svd = {}
    for r in X("select cd, c, t, sq, q from sv").fetchall(): svd.setdefault((r[0], r[2]), []).append(r)
    rel_ok, rel_dif, nt_ok, nt_dif = 0, [], 0, []
    for (cd, t), R in rel.items():
        if not R: continue
        for c in (11, 13):
            if c not in R: continue
            ntsum = 0
            for _, c2, _, sq, q in svd.get((cd, t), []):
                if c2 != c: continue
                nr = nv_de.get((cd, c, sq))
                if nr in R[c]:
                    if R[c][nr][0] == q: rel_ok += 1
                    else: rel_dif.append([cd, nm_mun.get(cd), c, t, str(sq), nr, q, R[c][nr][0]])
                else: ntsum += q
            esp = (R.get('nt') or {}).get(c, 0)
            if ntsum == esp: nt_ok += 1
            else: nt_dif.append([cd, nm_mun.get(cd), c, t, ntsum, esp])
    nao_ver = [x for x in pdf_nv if (x[0], x[2], x[3]) in {(d[0], d[2], d[3]) for d in nt_dif} or not rel.get((x[0], x[3]))]
    ver['ausentes_conferidos_no_relatorio'] = {'iguais': pdf_ok, 'diferentes': len(pdf_dif), 'exemplos_diferentes': pdf_dif[:30],
                                               'fora_do_anexo_ix_nulo_tecnico': len(pdf_nv) - len(nao_ver), 'nao_verificaveis': len(nao_ver),
                                               'exemplos_nao_verificaveis': nao_ver[:30], 'municipios_turnos_lidos': len(rel),
                                               'conferencia_completa_relatorio': {'candidatos_iguais': rel_ok, 'candidatos_diferentes': len(rel_dif),
                                                   'exemplos': rel_dif[:30], 'nulo_tecnico_iguais': nt_ok, 'nulo_tecnico_diferentes': nt_dif[:30], 'n_nulo_tecnico_diferentes': len(nt_dif)}}
    ver['sem_situacao_na_base_atual'] = sorted([[cd, nm_mun[cd], c] for cd, c in sem_sit])
    stp, stv, stt = [0, 0], [0, 0], [0, 0]   # (arquivos, bytes) público / privado / proposta
    idx_muns = []; elcheck = []; cob = {'locais': 0, 'locais_com_bairro': 0, 'locais_com_coord': 0, 'locais_sem_cadastro': 0,
                                         'eleitores': 0, 'eleitores_com_bairro': 0, 'eleitores_com_coord': 0}
    rede_cob = {'candidatos': 0, 'com_rede': 0, 'eleitos': 0, 'eleitos_com_rede': 0, 'links': 0, 'links_grupo_whatsapp_omitidos': 0}
    ncand = {11: 0, 13: 0}; nsec_tot = 0; amostras_top3 = {}
    for cd in muns:
        rows = detrows[cd]; nm = rows[0][1]
        # seções (1º turno; o 2º turno usa as mesmas seções)
        sec = sorted({(r[2], r[3]) for r in rows if r[5] == 1})
        skey = np.array([z * 100000 + s for z, s in sec], dtype=np.int64)
        secnl = {}
        for r in rows:
            if r[5] == 1: secnl[(r[2], r[3])] = (r[14], r[15], r[16])
        lockeys = sorted({(z, secnl[(z, s)][0]) for z, s in sec})
        row_de_local = {}
        for (z, s), val in secnl.items(): row_de_local.setdefault((z, val[0]), val)
        lidx = {k: i for i, k in enumerate(lockeys)}
        zonas = sorted({z for z, _ in lockeys}); zidx = {z: i for i, z in enumerate(zonas)}
        bairros = []; bidx = {}; locais = []; locais_pub = []
        for (z, nl) in lockeys:
            L = locd.get((cd, z, nl)) or locd.get((cd, z, -nl))
            # nome/endereço do detalhe da seção quando o cadastro do eleitorado não tem o local
            anyrow = row_de_local[(z, nl)]
            nome = (L[3] if L else anyrow[1]) or ''; ender = (L[4] if L else anyrow[2]) or ''
            b = bairro_norm(L[5]) if L else ''
            if b in ('', '-', '#NULO', 'NULO', '#NE'): b = ''
            if b not in bidx: bidx[b] = len(bairros); bairros.append(b)
            la, lo = coord(L[7], L[8]) if L else (None, None)
            cep = (L[6] if L and L[6] not in (None, '-1', '#NULO') else None)
            el = L[9] if L else 0
            cob['eleitores'] += el or 0; cob['eleitores_com_bairro'] += (el or 0) if b else 0; cob['eleitores_com_coord'] += (el or 0) if la is not None else 0
            locais.append([zidx[z], nl, nome, ender, bidx[b], cep, la, lo])
            locais_pub.append([la, lo, bidx[b], z, nl, nome])
            cob['locais'] += 1; cob['locais_com_bairro'] += bool(b); cob['locais_com_coord'] += la is not None; cob['locais_sem_cadastro'] += L is None
        sec_li = np.array([lidx[(z, secnl[(z, s)][0])] for z, s in sec], dtype=np.int64)
        loc_bi = np.array([l[4] for l in locais], dtype=np.int64); loc_zi = np.array([l[0] for l in locais], dtype=np.int64)
        nsec_tot += len(sec)
        # estatísticas por seção (aptos, comparecimento, brancos, nulos, nominais, legenda) por cargo/turno
        detc = {}
        for r in rows:
            kk = f'{r[4]}' + ('t2' if r[5] == 2 else '')
            i = int(np.searchsorted(skey, r[2] * 100000 + r[3]))
            if i >= len(skey) or skey[i] != r[2] * 100000 + r[3]: continue
            detc.setdefault(kk, [None] * len(sec))[i] = [r[6], r[7], r[10], r[11], r[9]] + ([r[12]] if r[4] == 13 else [])
        def tot(kk):
            a = [x for x in detc.get(kk, []) if x]
            if not a: return None
            s = [sum(x[j] for x in a) for j in range(len(a[0]))]
            o = {'aptos': s[0], 'comp': s[1], 'br': s[2], 'nu': s[3], 'nom': s[4]}
            if len(s) > 5: o['leg'] = s[5]
            return o
        # votos da seção
        V = con.execute("select z, s, c, t, nv, sq, q from v where cd=?", [cd]).fetchnumpy()
        vk = V['z'].astype(np.int64) * 100000 + V['s'].astype(np.int64)
        vsi = np.searchsorted(skey, vk); vsi[vsi >= len(skey)] = 0
        okm = skey[vsi] == vk
        c_ = V['c']; t_ = V['t']; nv_ = V['nv']; sq_ = V['sq'].astype(np.int64); q_ = V['q'].astype(np.int64)
        out_pub = {'cd': cd, 'nm': nm, 'uf': UF, 'fonte': 'TSE — Dados Abertos (votacao_secao_2024, votacao_candidato_munzona_2024, consulta_cand_2024)',
                   'vagas': {'11': vag.get((cd, 11)), '13': vag.get((cd, 13))}}
        pro_files = {}; agg = {'zonas': zonas, 'bairros': bairros, 'zona': {}, 'bairro': {}, 'bstat': {}}
        top = {'cd': cd, 'nm': nm, 'uf': UF, 'bairros': bairros, 'c': {}}
        tem2t = bool(((c_ == 11) & (t_ == 2)).any())
        av = [c for c in (11, 13) if (cd, c) in sem_sit]
        if av: out_pub['aviso_situacao'] = {'cargos': av, 'texto': 'A base atual do TSE (consulta_cand de 07/10/2026) não informa a situação final deste cargo neste município (possível anulação/retotalização). A situação mostrada vem do Relatório Resultado da Totalização oficial de 2024.'}
        t1 = {'nsec': len(sec), 'nloc': len(locais)}
        for kk in ('11', '13', '11t2'):
            tt = tot(kk)
            if tt: t1[kk] = tt
        out_pub['secoes'] = t1
        for c in (11, 13):
            cc = cands.get(cd, {}).get(c, {})
            sqs = set(cc) | {int(x) for x in np.unique(sq_[(c_ == c) & (sq_ > 0)])}
            def votos(t, sq): return int(q_[(c_ == c) & (t_ == t) & (sq_ == sq)].sum())
            tot1 = {sq: 0 for sq in sqs}
            m1 = (c_ == c) & (t_ == 1) & (sq_ > 0) & okm
            u, inv = np.unique(sq_[m1], return_inverse=True); sums = np.bincount(inv, weights=q_[m1]).astype(np.int64)
            for a, b in zip(u, sums): tot1[int(a)] = int(b)
            ordem = sorted(sqs, key=lambda s: (-tot1[s], s))
            nidx = {s: i for i, s in enumerate(ordem)}
            # válidos = nominais válidos (TSE) + legenda válida (vereador)
            def dest_de(s, t):
                m = mzd.get((cd, c, t, s))
                if m: return m[6]
                R = rel.get((cd, t))
                if R and c in R and (cd, c, s) in nv_de:   # só quem teve voto na seção (evita confundir com substituto de mesmo número)
                    nu0 = (cc[s][3] if s in cc else nv_de.get((cd, c, s)))
                    return R[c][nu0][1] if nu0 in R[c] else 'Nulo técnico'
                return None
            def valido(d): return d is None or d.startswith('Válido')
            validos1 = sum(tot1[s] for s in sqs if valido(dest_de(s, 1))) + (sum(r[3] for r in pmd.get(cd, [])) if c == 13 else 0)
            lista = []
            for s in ordem:
                r = cc.get(s); m = mzd.get((cd, c, 1, s)); m2 = mzd.get((cd, c, 2, s))
                def ok(x): return None if x in NUL else x
                st1 = ok(r[12] if r else None) or ok(m[7] if m else None); st2 = ok(r[13] if r else None) or ok(m2[7] if m2 else None)
                fs = 'consulta_cand' if (r and (ok(r[12]) or ok(r[13]))) else ('munzona' if (st1 or st2) else None)
                nu_ = r[3] if r else (m[8] if m else None)
                if (cd, c) in sem_sit:
                    tf = 2 if (c == 11 and cd in runoff) else 1
                    R = rel.get((cd, tf)) or {}; px = (R.get(c) or {}).get(nu_) if (cd, c, s) in nv_de else None
                    if px:
                        if tf == 2: st2 = px[2].upper()
                        else: st1 = px[2].upper()
                        fs = 'relatorio_totalizacao_2024'
                    elif tf == 2 and cd in runoff:
                        R1 = (rel.get((cd, 1)) or {}).get(c) or {}
                        if nu_ in R1 and (cd, c, s) in nv_de: st1 = R1[nu_][2].upper(); fs = 'relatorio_totalizacao_2024'
                fin = st2 if (c == 11 and st2) else st1
                # base atual sem situação para este candidato: guarda a do relatório de 2024 só como informação (não decide "eleito")
                st_rel = {}
                for tt_ in (1, 2):
                    if (st1 if tt_ == 1 else st2) is None:
                        R = (rel.get((cd, tt_)) or {}).get(c) or {}
                        if nu_ in R and (cd, c, s) in nv_de: st_rel[tt_] = R[nu_][2].upper()
                item = {'n': nidx[s], 'nu': r[3] if r else (m[8] if m else None), 'nm': (r[5] if r else (m[9] if m else '')),
                        'sg': r[6] if r else (m[10] if m else None), 'sq': str(s), 'v': tot1[s],
                        'p': round(100 * tot1[s] / validos1, 2) if (validos1 and valido(dest_de(s, 1))) else None, 'st': st1,
                        'sit': (m[11] if m else None) or (r[11] if r and r[11] not in NUL else None), 'dest': dest_de(s, 1), 'e': fin in ELEITO, 'fs': fs}
                if st_rel: item['st_rel2024'] = st_rel.get(1) or st_rel.get(2)
                if item['sit'] in NUL: item['sit'] = None
                if r and r[10]: item['col'] = r[10]
                if r and r[8] and r[8] != '#NULO': item['fed'] = r[8]
                if c == 11 and (m2 or st2):
                    v2 = votos(2, s); item['v2'] = v2; item['st2'] = st2
                lista.append(item)
                rr = redes.get(s) or []
                if rr:
                    boas = [u for u in rr if 'chat.whatsapp.com' not in u.lower()]
                    rede_cob['links_grupo_whatsapp_omitidos'] += len(rr) - len(boas); rr = boas
                rede_cob['candidatos'] += 1; rede_cob['com_rede'] += bool(rr); rede_cob['links'] += len(rr)
                if item['e']: rede_cob['eleitos'] += 1; rede_cob['eleitos_com_rede'] += bool(rr)
                if rr: out_pub.setdefault('_redes', {})[str(s)] = rr
            if c == 11 and tem2t:
                val2 = sum(it['v2'] for it in lista if 'v2' in it and valido(dest_de(int(it['sq']), 2)))
                for it in lista:
                    if 'v2' in it: it['p2'] = round(100 * it['v2'] / val2, 2) if val2 else None
            ncand[c] += len(lista)
            out_pub[f'c{c}'] = lista
            top['c'][str(c)] = [[it['nm'], it['sg'], it['nu'], 1 if it['e'] else 0] for it in lista]
            # checagem de eleitos: consulta_cand × votacao_candidato_munzona × saída
            tf = 2 if (c == 11 and cd in runoff) else 1
            def fcc(s):
                r = cc.get(s)
                if not r: return None
                return (r[13] if (c == 11 and r[13] not in NUL) else r[12])
            def fmz(s):
                a = (mzd.get((cd, c, 2, s)) or [None] * 8)[7] if c == 11 else None
                return a if a not in NUL else (mzd.get((cd, c, 1, s)) or [None] * 8)[7]
            el_cc = sorted(str(s) for s in sqs if fcc(s) in ELEITO)
            el_mz = sorted(str(s) for s in sqs if fmz(s) in ELEITO)
            if (cd, c) in sem_sit:   # base atual sem situação: compara com o relatório oficial
                el_cc = el_mz = sorted(it['sq'] for it in lista if it['e'])
            el_out = sorted(it['sq'] for it in lista if it['e'])
            if not any(fmz(s) not in NUL for s in sqs): el_mz = el_cc   # munzona sem linhas/sem situação p/ esse cargo
            elcheck.append({'cd': cd, 'nm': nm, 'c': c, 'cc': el_cc, 'mz': el_mz, 'out': el_out, 'vagas': vag.get((cd, c)), 'sem_sit': (cd, c) in sem_sit,
                            'nomes': [it['nm'] for it in lista if it['e']]})
            # agregados: local / bairro / zona / seção
            for t in ((1, 2) if c == 11 else (1,)):
                kk = f'{c}' + ('t2' if t == 2 else '')
                m = (c_ == c) & (t_ == t) & (sq_ > 0) & okm
                if not m.any(): continue
                si = vsi[m]; ci = np.array([nidx[int(s)] for s in sq_[m]], dtype=np.int64); qq = q_[m]; nc = len(ordem)
                li = sec_li[si]
                def grp(key, n):
                    k = key * nc + ci; u, inv = np.unique(k, return_inverse=True); s = np.bincount(inv, weights=qq).astype(np.int64)
                    return u // nc, u % nc, s
                g, cn, s = grp(li, len(locais))
                porcand = {}
                for a, b, x in zip(g.tolist(), cn.tolist(), s.tolist()): porcand.setdefault(b, []).append([a, x])
                gs, cs, ss = grp(si, len(sec))
                porcand_s = {}
                for a, b, x in zip(gs.tolist(), cs.tolist(), ss.tolist()): porcand_s.setdefault(b, []).append([a, x])
                if c == 11:
                    pro_files.setdefault('11.json', {})[f't{t}'] = {str(n): {'loc': porcand.get(n, []), 'sec': porcand_s.get(n, [])} for n in range(nc) if n in porcand}
                else:
                    pro_files['13-loc.json'] = {str(n): v for n, v in sorted(porcand.items())}
                    if len(sec) > 1500:   # municípios grandes: um arquivo de seções por zona
                        sec_zi = loc_zi[sec_li]; porz = {}
                        for a, b, x in zip(gs.tolist(), cs.tolist(), ss.tolist()):
                            porz.setdefault(int(sec_zi[a]), {}).setdefault(str(b), []).append([a, x])
                        for zi_, sel in porz.items(): pro_files[f'13-sec-z{zonas[zi_]}.json'] = sel
                    else:
                        pro_files['13-sec.json'] = {str(n): v for n, v in sorted(porcand_s.items())}
                for nomeg, key, n in (('bairro', loc_bi[li], len(bairros)), ('zona', loc_zi[li], len(zonas))):
                    g, cn, s = grp(key, n); rk = [[] for _ in range(n)]
                    for a, b, x in zip(g.tolist(), cn.tolist(), s.tolist()): rk[a].append([b, x])
                    for r_ in rk: r_.sort(key=lambda p: (-p[1], p[0]))
                    agg[nomeg][kk] = rk
            if c == 13:
                m = (c_ == 13) & (t_ == 1) & (sq_ <= 0) & (nv_ >= 10) & (nv_ <= 94) & okm
                legl = {}
                for nb, vv in zip(loc_bi[sec_li[vsi[m]]].tolist(), q_[m].tolist()): pass
                bi = loc_bi[sec_li[vsi[m]]]; npt = nv_[m].astype(np.int64)
                k = bi * 100 + npt; u, inv = np.unique(k, return_inverse=True); s = np.bincount(inv, weights=q_[m]).astype(np.int64)
                rk = [[] for _ in bairros]
                for a, x in zip(u.tolist(), s.tolist()): rk[a // 100].append([a % 100, x])
                for r_ in rk: r_.sort(key=lambda p: -p[1])
                agg['bairro']['leg13'] = rk
                out_pub['leg13'] = sorted([{'np': r[1], 'sg': r[2], 'leg': r[3], 'tot': r[4], 'nomv': r[5]} for r in pmd.get(cd, [])], key=lambda x: -(x['tot'] or 0))
        # estatística por bairro (aptos/comparecimento por cargo)
        for kk, arr in detc.items():
            bs = [[0] * 5 for _ in bairros]
            for i, x in enumerate(arr):
                if not x: continue
                b = loc_bi[sec_li[i]]
                for j in range(5): bs[b][j] += x[j]
            agg['bstat'][kk] = bs
        # top 3 por bairro (prefeito 1º/2º turno e vereador) + vereadores eleitos com seus votos no bairro
        el11 = {it['n'] for it in out_pub['c11'] if it['e']}; el13 = {it['n'] for it in out_pub['c13'] if it['e']}
        tb = []
        for b in range(len(bairros)):
            o = {'b': b, 'nloc': int((loc_bi == b).sum()), 'aptos': agg['bstat'].get('11', [[0]])[b][0] if agg['bstat'].get('11') else None}
            r11 = agg['bairro'].get('11', [[]] * len(bairros))[b]; r13 = agg['bairro'].get('13', [[]] * len(bairros))[b]
            o['p'] = {'top3': r11[:3], 'eleito': [p for p in r11 if p[0] in el11][:1]}
            if '11t2' in agg['bairro']: o['p2'] = {'top': agg['bairro']['11t2'][b]}
            o['v'] = {'top3': r13[:3], 'eleitos': [p for p in r13 if p[0] in el13]}
            o['v']['eleitos_sem_voto'] = len(el13) - len(o['v']['eleitos'])
            tb.append(o)
        top['top'] = tb
        top['nota'] = 'n = índice em c[cargo] = [nome de urna, partido, número, eleito]; pares [n, votos]. Vereador: top3 pode incluir não eleitos; "eleitos" lista os vereadores eleitos com voto no bairro.'
        # proposta grátis (só nomes, sem votos) — NÃO é publicada; fica local até a decisão do Marcel
        prop_obj = {'cd': cd, 'nm': nm, 'uf': UF, 'bairros': bairros, 'c': top['c'],
                    'top': [{'b': o['b'], 'p': [p[0] for p in o['p']['top3']], 'v': [p[0] for p in o['v']['top3']],
                             've': [p[0] for p in o['v']['eleitos'][:3]]} for o in tb]}
        # gravação
        redes_mun = out_pub.pop('_redes', {})
        w(pub, f'{PREFIX}/{uf}/mun/{cd}.json', out_pub, stp)
        w(pub, f'{PREFIX}/{uf}/locais/{cd}.json', {'cd': cd, 'nm': nm, 'uf': UF, 'ano': 2024, 'bairros': bairros,
                                                   'campos': ['lat', 'lon', 'bairro', 'zona', 'nr_local', 'nome'], 'l': locais_pub}, stp)
        if redes_mun: w(pub, f'{PREFIX}/{uf}/redes/{cd}.json', redes_mun, stp)
        base = f'{PREFIX}/{uf}/det/{cd}/'
        w(pro, base + 'geo.json', {'cd': cd, 'nm': nm, 'uf': UF, 'zonas': zonas, 'bairros': bairros,
                                   'campos_local': ['zona_i', 'nr_local', 'nome', 'endereco', 'bairro_i', 'cep', 'lat', 'lon'], 'locais': locais,
                                   'secoes': [[int(sec_li[i]), s] for i, (z, s) in enumerate(sec)],
                                   'campos_det': ['aptos', 'comparecimento', 'brancos', 'nulos', 'nominais', 'legenda'], 'det': detc,
                                   'arquivos': sorted(pro_files)}, stv)
        for k, o in pro_files.items(): w(pro, base + k, o, stv)
        w(pro, base + 'agg.json', agg, stv)
        w(pro, f'{PREFIX}/{uf}/top3/{cd}.json', top, stv)
        w(prop, f'{PREFIX}/{uf}/top3/{cd}.json', prop_obj, stt)
        e11 = [it for it in out_pub['c11'] if it['e']]
        idx_muns.append({'cd': cd, 'nm': nm, 'nsec': len(sec), 'nloc': len(locais), 'nbairros': len([b for b in bairros if b]),
                         'aptos': (t1.get('11') or {}).get('aptos'), 'pref': (e11[0]['nm'] + ' (' + (e11[0]['sg'] or '') + ')') if e11 else None,
                         't2': tem2t, 'vagas13': vag.get((cd, 13))})
        if nm in (CAPITAIS.get(UF),):
            amostras_top3[nm] = (bairros, tb, out_pub)
    # índice da UF
    w(pub, f'{PREFIX}/{uf}/index.json', {'uf': UF, 'ano': 2024, 'turnos': ['06/10/2024', '27/10/2024'], 'muns': idx_muns,
                                         'fonte': 'TSE — Dados Abertos', 'gerado': time.strftime('%Y-%m-%dT%H:%M:%S%z')}, stp)
    # ---------- verificação 2: eleitos ----------
    cap = CAPITAIS.get(UF); rnd = random.Random(2024 + sum(map(ord, UF)))
    outros = [e['cd'] for e in elcheck if e['nm'] != cap]
    amostra = {e['cd'] for e in elcheck if e['nm'] == cap} | set(rnd.sample(sorted(set(outros)), min(8, len(set(outros)))))
    div = [e for e in elcheck if not (e['cc'] == e['mz'] == e['out'])]
    vagas_dif = [e for e in elcheck if e['vagas'] is not None and len(e['out']) != e['vagas']]
    ver['eleitos'] = {'municipios_cargo_conferidos': len(elcheck), 'divergencias_consulta_cand_x_munzona_x_saida': len(div),
                      'divergencias': [{k: e[k] for k in ('cd', 'nm', 'c', 'cc', 'mz', 'out', 'nomes')} for e in div[:30]],
                      'eleitos_diferente_de_vagas': [{'cd': e['cd'], 'nm': e['nm'], 'c': e['c'], 'eleitos': len(e['out']), 'vagas': e['vagas']} for e in vagas_dif[:60]],
                      'n_eleitos_diferente_de_vagas': len(vagas_dif),
                      'amostra': [{'cd': e['cd'], 'nm': e['nm'], 'cargo': 'Prefeito' if e['c'] == 11 else 'Vereador', 'eleitos': len(e['out']), 'vagas': e['vagas'],
                                   'confere': e['cc'] == e['mz'] == e['out'], 'nomes': e['nomes'] if e['c'] == 11 else e['nomes'][:5] + (['…'] if len(e['nomes']) > 5 else [])}
                                  for e in elcheck if e['cd'] in amostra]}
    ver['cobertura_locais'] = cob; ver['redes'] = rede_cob; ver['carga'] = {k: (v if not isinstance(v, list) else [list(map(str, x)) for x in v]) for k, v in info.items()}
    ver['totais'] = {'municipios': len(muns), 'candidatos_prefeito': ncand[11], 'candidatos_vereador': ncand[13], 'secoes': nsec_tot,
                     'locais': cob['locais'], 'arquivos_publicos': stp[0], 'bytes_publicos': stp[1], 'arquivos_privados': stv[0], 'bytes_privados': stv[1],
                     'arquivos_proposta_local': stt[0], 'bytes_proposta_local': stt[1]}
    ver['segundos'] = round(time.time() - t0, 1)
    ver['ok'] = ver['diferencas'] == 0 and not pdf_dif and not rel_dif and ver['secoes_nominal_x_detalhe_diferentes'] == 0
    json.dump(ver, open(os.path.join(DOCS, 'verificacao', f'{UF}.json'), 'w'), ensure_ascii=False, indent=1)
    escrever_md(ver)
    # amostras para o relatório final
    am = {}
    for nm, (bairros, tb, op) in amostras_top3.items():
        c11 = op['c11']; c13 = op['c13']
        lst = []
        for o in sorted(tb, key=lambda o: -(o['aptos'] or 0))[:3]:
            lst.append({'bairro': bairros[o['b']] or '(sem bairro)', 'aptos': o['aptos'],
                        'prefeito_top3': [(c11[n]['nm'], c11[n]['sg'], v, c11[n]['e']) for n, v in o['p']['top3']],
                        'vereador_top3': [(c13[n]['nm'], c13[n]['sg'], v, c13[n]['e']) for n, v in o['v']['top3']],
                        'vereadores_eleitos_mais_votados_no_bairro': [(c13[n]['nm'], c13[n]['sg'], v) for n, v in o['v']['eleitos'][:5]]})
        am[nm] = lst
    json.dump(am, open(os.path.join(DOCS, 'verificacao', f'{UF}-amostra-bairros.json'), 'w'), ensure_ascii=False, indent=1)
    st = load_state(UF); st['totais'] = ver['totais']; st['ok_verificacao'] = ver['ok']; st['segundos_montagem'] = ver['segundos']; save_state(st)
    print(UF, 'ok' if ver['ok'] else 'DIFERENÇAS', ver['totais'], f"{ver['segundos']}s", flush=True)
    return 0 if ver['ok'] else 2

def escrever_md(v):
    L = [f"# Verificação — {v['uf']} (municipais 2024)", '',
         f"Gerado em {time.strftime('%d/%m/%Y %H:%M')} (BRT). Fonte: TSE — Dados Abertos.", '',
         '## 1. Soma dos votos por seção × votação nominal do TSE por município', '',
         f"- Pares candidato×município×turno conferidos: {v['pares_candidato_municipio']:,}".replace(',', '.'),
         f"- Votos nominais (soma das seções): {v['votos_nominais_secao']:,}".replace(',', '.'),
         f"- Votos nominais (TSE, votacao_candidato_munzona): {v['votos_nominais_tse']:,}".replace(',', '.'),
         f"- **Diferenças (candidato presente nas duas fontes): {v['diferencas']}** {'✅' if v['diferencas'] == 0 else '❌'}",
         f"- Candidatos com voto na seção que a base atual do munzona (regerada pelo TSE em 07/10/2026) não traz: {v['ausentes_no_munzona']} ({v['ausentes_votos']} votos)",
         f"  - conferidos com o Relatório Resultado da Totalização (PDF oficial, Anexo IX): iguais {v['ausentes_conferidos_no_relatorio']['iguais']} · diferentes **{v['ausentes_conferidos_no_relatorio']['diferentes']}** · fora do Anexo IX e cobertos pelos “votos nulos técnico” do relatório (registro cancelado): {v['ausentes_conferidos_no_relatorio']['fora_do_anexo_ix_nulo_tecnico']} · não verificáveis {v['ausentes_conferidos_no_relatorio']['nao_verificaveis']}",
         f"  - conferência completa dos municípios lidos no relatório: {v['ausentes_conferidos_no_relatorio']['conferencia_completa_relatorio']['candidatos_iguais']} candidatos iguais, {v['ausentes_conferidos_no_relatorio']['conferencia_completa_relatorio']['candidatos_diferentes']} diferentes; nulo técnico igual em {v['ausentes_conferidos_no_relatorio']['conferencia_completa_relatorio']['nulo_tecnico_iguais']} município×cargo, diferente em {v['ausentes_conferidos_no_relatorio']['conferencia_completa_relatorio']['n_nulo_tecnico_diferentes']}",
         f"- Município×cargo sem situação final na base atual do TSE (situação tirada do relatório oficial de 2024): {len(v['sem_situacao_na_base_atual'])} {v['sem_situacao_na_base_atual']}", '']
    if v['diferencas']:
        L += ['Exemplos (cd, cargo, turno, sq, seção, TSE, nome, destinação):', ''] + [f'- {" | ".join(r)}' for r in v['diferencas_exemplos'][:20]] + ['']
    lg = v['legenda']
    L += ['## 2. Votos de legenda (Vereador)', '', f"- Seções: {lg['votos_secao']} · TSE (votacao_partido_munzona, válidos+anulados): {lg['votos_tse']} · partidos com diferença: {lg['partidos_com_diferenca']} (soma |dif| = {lg['soma_abs_diferenca']})", '',
          '## 3. Consistência interna', '', f"- Seções em que a soma dos candidatos ≠ QT_VOTOS_NOMINAIS do detalhe: {v['secoes_nominal_x_detalhe_diferentes']}",
          f"- Votos de outros tipos ignorados: {v['votos_outros_ignorados']}", '']
    e = v['eleitos']
    L += ['## 4. Eleitos (consulta_cand × votacao_candidato_munzona × arquivos gerados)', '',
          f"- Município×cargo conferidos: {e['municipios_cargo_conferidos']} · divergências: **{e['divergencias_consulta_cand_x_munzona_x_saida']}**",
          f"- Município×cargo com nº de eleitos ≠ vagas: {e['n_eleitos_diferente_de_vagas']}", '', '### Amostra (capital + municípios sorteados)', '',
          '| Município | Cargo | Eleitos | Vagas | Confere | Nomes |', '|---|---|---|---|---|---|']
    for a in e['amostra']:
        L.append(f"| {a['nm']} | {a['cargo']} | {a['eleitos']} | {a['vagas']} | {'✅' if a['confere'] else '❌'} | {', '.join(a['nomes'])} |")
    if e['divergencias']:
        L += ['', '### Divergências', ''] + [f"- {d['nm']} ({d['cd']}) cargo {d['c']}: consulta_cand={d['cc']} munzona={d['mz']} saída={d['out']}" for d in e['divergencias']]
    if e['eleitos_diferente_de_vagas']:
        L += ['', '### Eleitos ≠ vagas', ''] + [f"- {d['nm']} ({d['cd']}) cargo {d['c']}: {d['eleitos']} eleitos / {d['vagas']} vagas" for d in e['eleitos_diferente_de_vagas']]
    c = v['cobertura_locais']; r = v['redes']; t = v['totais']
    pc = lambda a, b: f'{100 * a / b:.1f}%' if b else '-'
    L += ['', '## 5. Cobertura', '', f"- Locais de votação: {c['locais']} · com bairro: {pc(c['locais_com_bairro'], c['locais'])} · com coordenadas: {pc(c['locais_com_coord'], c['locais'])} · sem cadastro no eleitorado: {c['locais_sem_cadastro']}",
          f"- Redes sociais: {r['com_rede']}/{r['candidatos']} candidatos ({pc(r['com_rede'], r['candidatos'])}); eleitos {r['eleitos_com_rede']}/{r['eleitos']} ({pc(r['eleitos_com_rede'], r['eleitos'])}); links de grupo de WhatsApp omitidos: {r['links_grupo_whatsapp_omitidos']}",
          '', '## 6. Totais', '', f"- Municípios {t['municipios']} · candidatos Prefeito {t['candidatos_prefeito']} · Vereador {t['candidatos_vereador']} · seções {t['secoes']} · locais {t['locais']}",
          f"- Arquivos públicos {t['arquivos_publicos']} ({t['bytes_publicos'] / 1e6:.1f} MB) · privados {t['arquivos_privados']} ({t['bytes_privados'] / 1e6:.1f} MB)",
          f"- Tempo de montagem: {v['segundos']} s", '']
    open(os.path.join(DOCS, 'verificacao', f"{v['uf']}.md"), 'w').write('\n'.join(L))

if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
