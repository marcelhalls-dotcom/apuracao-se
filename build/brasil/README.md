# build/brasil — como adicionar uma UF e atualizar o snapshot do TSE

> **Desde 07/10/2026 os dados pesados (`mapa/`, `fotos/`, `tse/`) ficam no Cloudflare R2**, servidos em
> `https://dados.cademeuvoto.com.br` (bucket `cademeuvoto-dados`). O GitHub Pages só publica o app
> (`index.html`, `relatorios.js`, `historico.json`, fontes, ícones). Essas três pastas estão no `.gitignore`:
> **não fazer commit de dados no repo**. Os scripts continuam gerando os arquivos na pasta local do repo, e o
> `upload_r2.py` envia para o R2.

Scripts que geram os dados por UF do Cadê Meu Voto. Eles **não contêm tokens nem segredos** e
**não incluem dados brutos**. Os CSVs do TSE ficam em `/tmp` e não vão para o git.
Por padrão os caminhos são relativos à raiz do repo. Para mudar, use `CMV_SITE` (raiz do site)
e `CMV_OUT` (pasta de screenshots e relatórios; padrão `../rebrand/brasil`).

Regra de ouro: **nunca inventar números**. Tudo vem do TSE e é conferido contra o JSON oficial antes de publicar.

## Scripts

| Script | O que faz |
|---|---|
| `prep_tse_csv.py ES RJ …` | Extrai/filtra os CSVs do TSE (zips em `/tmp/tsezip`, ou `TSEZIP=`) para `/tmp/tse-<uf>/`, numa passada só pelos arquivos BR. Só filtra linhas por `SG_UF`. |
| `snapshot_tse.py ce ma …` | Baixa o JSON oficial (`resultados.tse.jus.br/oficial`) para `tse/` (gov/sen/fed/est 6259 + presidente 6257) e **todas as fotos** dos candidatos (retry/backoff com Retry-After, 3 threads + pausa entre pedidos — `CMV_TSE_THREADS`/`CMV_TSE_PAUSA` — para não sobrecarregar o TSE). O site lê `tse/` primeiro, então o navegador não faz pedido ao TSE. Também copia os JSON para `/tmp/tse-<uf>/api/`. |
| `build_uf_mapa.py CE` | Gera `mapa/<uf>/` (index, geo, geojson IBGE, mun, secao, det) somando os CSVs por seção. Usa numpy e agrega um cargo por vez: SP (15,6 milhões de linhas) leva ~2 min com pico de ~1,1 GB de RAM. O `index.json` traz `meta.nmun`/`meta.nloc` para a home não precisar baixar o `geo-<uf>.json`. Presidente: `t` = total nacional, `tse` = total na UF, `e` = quebra por UF. |
| `build_context.py ce` | Gera `mapa/<uf>/context.json` para o chat: cadeiras via `agr.vag`; "2º turno" não conta como eleito. |
| `fetch_fotos.py ce` | Gera `fotos/<uf>/<cargo>/<n>.jpg` (114×160, usadas no PDF) a partir do snapshot local, sem usar a rede. |
| `verify_uf.py ce` | Confere candidato a candidato (`index.json` × JSON do TSE), seções e aptos. Precisa dar **0 diferenças**. |
| `e2e_uf.js <base> <uf> [outras…]` | Playwright por cliques: todas as abas, mapa, comparar, relatórios, gramática, hemiciclo = `agr.vag`, rótulos sem sobreposição, sem alerta, **0 pedidos ao TSE**, isolamento entre UFs. Gera `<uf>-home.png`, `<uf>-governo.png` e `<uf>-e2e.json`. Precisa de `playwright-core` (`PW_CORE=…`) e Chrome (`CHROME_PATH=…`). |
| `upload_r2.py [prefixos…]` | Envia `mapa/`, `fotos/` e `tse/` locais para o R2 (incremental: só o que mudou, comparando MD5 × ETag; 24 threads). `--dry-run` mostra o que iria. Prefixos limitam o envio, ex.: `mapa/sp fotos/sp tse/ele2026/6259/dados/sp tse/ele2026/6259/fotos/sp`. Credenciais **só por variável de ambiente**: `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY`, ou `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`), do qual deriva as chaves S3 como manda a doc da Cloudflare. Define `Content-Type` (json, geo+json, jpeg) e `Cache-Control` (dados 1 dia + stale-while-revalidate 7 dias; fotos do PDF 7 dias; fotos do TSE 30 dias). |
| `firstview_uf.js <base> <uf>` | Mede a 1ª visita (cache vazio) de início, governo e mapa: pedidos, KB, pedidos ao R2, ao TSE e ao Pages. Grava `<uf>-firstview.json`. |
| `live_uf.sh <uf> "<regressão>"` | Espera o deploy com a UF pronta, roda o E2E ao vivo, mede a 1ª visita e faz a regressão nas UFs listadas. |
| `golive.sh <uf> "<Nome>" "<msg>" <outras…>` | Commit + push do front, espera o deploy do Pages e roda o E2E ao vivo. |
| `progress.py` | Atualiza `nordeste-progress.md` (estado local em `progress.json`, que não é versionado). |

## Adicionar uma UF nova (ex.: SP)

1. **CSVs do TSE** em `/tmp/tse-<uf>/` (`prep_tse_csv.py <UF>` faz tudo isto a partir dos zips), a partir de `https://cdn.tse.jus.br/estatistica/sead/odsele/`:
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
4. **Publicar os dados primeiro, no R2** (não no git):
   ```
   export CLOUDFLARE_API_TOKEN=…  CLOUDFLARE_ACCOUNT_ID=640c5dffbaf852bac0e1a376c01c38f7
   python3 upload_r2.py --dry-run mapa/<uf> fotos/<uf> tse/ele2026/6259/dados/<uf> tse/ele2026/6259/fotos/<uf> tse/ele2026/6257/dados/<uf>
   python3 upload_r2.py           mapa/<uf> fotos/<uf> tse/ele2026/6259/dados/<uf> tse/ele2026/6259/fotos/<uf> tse/ele2026/6257/dados/<uf>
   ```
   Sem prefixo, envia tudo o que mudou. Rodar de novo depois do envio deve mostrar 0 arquivos a enviar.
   A UF ainda não aparece no seletor, então subir os dados antes é seguro.
5. No `index.html`:
   - Em `UF_REGISTRY`, preencher `prep`/`em` (do/no, da/na, de/em), `capital`, `fed`, `est` (de `agr.vag`) e `ale`, e mudar `status` para `'ready'`. Se a capital pede artigo ("no Rio de Janeiro"), use `capEm: 'no'`.
   - Em `UF_DESTAQUES`, colocar os 2 primeiros ao governo e ao Senado.
6. Testar localmente: `python3 -m http.server 8765` na raiz e `node e2e_uf.js http://127.0.0.1:8765/ <uf> se …`.
   O site local lê os dados do R2 (por isso a origem `http://127.0.0.1:8765` está liberada no CORS). Para testar
   com dados locais antes do upload, abrir `http://127.0.0.1:8765/?dados=http://127.0.0.1:8765` (o E2E espera o R2,
   então use isso só para olhar). Depois rodar `golive.sh` (commit só do front).
7. O chat Worker lê `mapa/<uf>/context.json` e os mapas do R2 (`DATA_BASE` no `chat-worker/wrangler.toml`).
   Aceita qualquer UF com esses arquivos no R2. Não precisa de deploy.

### Como o site acha os dados

`index.html` define `DATA_BASE = 'https://dados.cademeuvoto.com.br'` e a função `dataUrl(p)`, que prefixa todo
caminho começando com `mapa/`, `fotos/` ou `tse/`. `relatorios.js` usa a mesma função. O parâmetro `?dados=<url>`
troca a origem (útil para teste). Na zona Cloudflare há uma Cache Rule (host `dados` → cache na borda respeitando o
`Cache-Control` do objeto) e uma Transform Rule de resposta que põe `Vary: Origin` e o `Access-Control-Allow-Origin`
para as origens permitidas (cademeuvoto.com.br, www, marcelhalls-dotcom.github.io, 127.0.0.1:8765).

### Pasta local sem os dados (clone novo ou box resetado)

Os scripts precisam dos dados locais (ex.: `snapshot_tse.py` usa o JSON do presidente em `tse/ele2026/6257`).
Para recuperar a última versão que estava no git: `git restore --source=6265084 --worktree -- mapa fotos tse`
(fica fora do git por causa do `.gitignore`).

## Atualizar o snapshot de uma UF já publicada

`snapshot_tse.py <uf>` regrava os JSON e baixa só as fotos que faltam. Depois rodar `build_context.py <uf>` e `verify_uf.py <uf>`, e então `upload_r2.py` (sem commit de dados).
Os navegadores podem levar até 1 dia (`max-age`) para ver o dado novo. Para algo urgente, purgar o cache de `dados.cademeuvoto.com.br` no painel da Cloudflare.
Se os CSVs do TSE mudarem (retotalização), refazer o passo 3 inteiro.

## Desempenho (UFs grandes)

- Fotos dos candidatos só são pedidas quando o avatar chega perto da tela (IntersectionObserver em `makeAvatar`).
  Sem isso, a 1ª visita da BA fazia 1.167 pedidos; agora faz 29 em qualquer UF.
- 1ª visita medida ao vivo com `firstview_uf.js` (07/10/2026): ~29 pedidos e 0,7–1,2 MB por view, inclusive SP/MG.
  O mapa de SP baixa `geo-sp.json` (~357 KB comprimido) + `sp-mun.geojson` (~70 KB).
- Seções só carregam ao abrir um colégio: `secao/secoes.json` + `secao/<cargo>/<n>.json` (em SP ~0,9 MB comprimido,
  2 pedidos, depois ficam em cache). Um arquivo por candidato mantém poucas leituras no R2.
- Mapa: só os 5 municípios com mais votos ganham rótulo; os que não cabem vão para uma coluna com linha guia.
  Com mais de 300/600 municípios o contorno fica mais fino.

## Tamanho

Cada UF ocupa cerca de 1,4–2,8 KB por seção no R2, contando mapa, fotos e snapshot (RJ é a mais pesada por seção).
Em 07/10/2026, com 13 UFs (SE + Nordeste + Sudeste), o R2 tinha 49.360 objetos / 753,6 MB; só SP ocupa 259 MB.
As 14 UFs que faltam (Norte, Centro-Oeste e Sul) somam 155.183 seções, cerca de 0,35 GB a mais. O Brasil inteiro
deve ficar perto de 1,1 GB, bem abaixo dos 10 GB-mês grátis do R2 (https://developers.cloudflare.com/r2/pricing/).
O ponto de atenção é o número de leituras (Class B, 10 milhões/mês grátis), que o cache na borda reduz.
