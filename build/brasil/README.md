# build/brasil — como adicionar uma UF e atualizar o snapshot do TSE

Scripts que geram os dados por UF do Cadê Meu Voto. Eles **não contêm tokens nem segredos** e
**não incluem dados brutos**. Os CSVs do TSE ficam em `/tmp` e não vão para o git.
Por padrão os caminhos são relativos à raiz do repo. Para mudar, use `CMV_SITE` (raiz do site)
e `CMV_OUT` (pasta de screenshots e relatórios; padrão `../rebrand/brasil`).

Regra de ouro: **nunca inventar números**. Tudo vem do TSE e é conferido contra o JSON oficial antes de publicar.

## Scripts

| Script | O que faz |
|---|---|
| `snapshot_tse.py ce ma …` | Baixa o JSON oficial (`resultados.tse.jus.br/oficial`) para `tse/` (gov/sen/fed/est 6259 + presidente 6257) e **todas as fotos** dos candidatos (retry/backoff, 6 threads). O site lê `tse/` primeiro, então o navegador não faz pedido ao TSE. Também copia os JSON para `/tmp/tse-<uf>/api/`. |
| `build_uf_mapa.py CE` | Gera `mapa/<uf>/` (index, geo, geojson IBGE, mun, secao, det) somando os CSVs por seção. Presidente: `t` = total nacional, `tse` = total na UF, `e` = quebra por UF. |
| `build_context.py ce` | Gera `mapa/<uf>/context.json` para o chat: cadeiras via `agr.vag`; "2º turno" não conta como eleito. |
| `fetch_fotos.py ce` | Gera `fotos/<uf>/<cargo>/<n>.jpg` (114×160, usadas no PDF) a partir do snapshot local, sem usar a rede. |
| `verify_uf.py ce` | Confere candidato a candidato (`index.json` × JSON do TSE), seções e aptos. Precisa dar **0 diferenças**. |
| `e2e_uf.js <base> <uf> [outras…]` | Playwright por cliques: todas as abas, mapa, comparar, relatórios, gramática, hemiciclo = `agr.vag`, rótulos sem sobreposição, sem alerta, **0 pedidos ao TSE**, isolamento entre UFs. Gera `<uf>-home.png`, `<uf>-governo.png` e `<uf>-e2e.json`. Precisa de `playwright-core` (`PW_CORE=…`) e Chrome (`CHROME_PATH=…`). |
| `golive.sh <uf> "<Nome>" "<msg>" <outras…>` | Commit + push do front, espera o deploy do Pages e roda o E2E ao vivo. |
| `progress.py` | Atualiza `nordeste-progress.md` (estado local em `progress.json`, que não é versionado). |

## Adicionar uma UF nova (ex.: SP)

1. **CSVs do TSE** em `/tmp/tse-<uf>/`, a partir de `https://cdn.tse.jus.br/estatistica/sead/odsele/`:
   - `votacao_secao/votacao_secao_2026_<UF>.zip` → `votacao/votacao_secao_2026_<UF>.csv`
   - `votacao_secao/votacao_secao_2026_BR.zip`, filtrado por `SG_UF` → `votacao_secao_2026_pres_<UF>.csv` (com cabeçalho)
   - `detalhe_votacao_secao/detalhe_votacao_secao_2026.zip`: o arquivo `_<UF>.csv` mais as linhas da UF no `_BR.csv` → `detalhe_votacao_secao_2026_<UF>.csv`
   - `eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip` → `eleitorado_local_votacao_2026_<UF>.csv`
   - Opcional, mas recomendado: tabela TSE→IBGE em `/tmp/tse_ibge.csv` (betafcc/Municipios-Brasileiros-TSE). Só é usada como reserva quando o nome não bate. Ela tem erros conhecidos (BA), por isso o nome exato vem primeiro.
2. Se faltar, adicionar o código IBGE da UF em `IBGE_UF` (`build_uf_mapa.py`).
3. Rodar:
   ```
   python3 snapshot_tse.py <uf>
   python3 build_uf_mapa.py <UF>
   python3 build_context.py <uf>
   python3 fetch_fotos.py <uf>
   python3 verify_uf.py <uf>    # exigir 0 diferenças
   ```
4. **Publicar os dados primeiro** (commit só de `mapa/<uf> fotos/<uf> tse/ele2026/*/dados/<uf> tse/ele2026/6259/fotos/<uf>`) e dar push.
5. No `index.html`:
   - Em `UF_REGISTRY`, preencher `prep`/`em` (do/no, da/na, de/em), `capital`, `fed`, `est` (de `agr.vag`) e `ale`, e mudar `status` para `'ready'`.
   - Em `UF_DESTAQUES`, colocar os 2 primeiros ao governo e ao Senado.
6. Testar localmente (`python3 -m http.server 8765` na raiz e `node e2e_uf.js http://127.0.0.1:8765/ <uf> se …`). Depois rodar `golive.sh`.
7. O chat Worker aceita qualquer UF com `mapa/<uf>/context.json` publicado. Não precisa de deploy.

## Atualizar o snapshot de uma UF já publicada

`snapshot_tse.py <uf>` regrava os JSON e baixa só as fotos que faltam. Depois rodar `build_context.py <uf>` e `verify_uf.py <uf>`, e então fazer commit e push.
Se os CSVs do TSE mudarem (retotalização), refazer o passo 3 inteiro.

## Tamanho

Cada UF ocupa cerca de 1,5–1,8 KB por seção, contando mapa, fotos e snapshot. O site publicado no Pages tinha 259 MB em 07/10/2026, com 9 UFs.
SP, MG e RJ não cabem com folga no Pages. O plano é mover os dados pesados para o Cloudflare R2 (`dados.cademeuvoto.com.br`).
Isso está **bloqueado até o R2 ser ativado** na conta Cloudflare. Quando estiver ativo, este README ganha o passo `upload_r2.py`.
