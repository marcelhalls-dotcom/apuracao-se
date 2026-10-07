# Eleições Municipais 2024 — Prefeito e Vereador (todo o Brasil)

Pipeline que importa os resultados de **06/10/2024 (1º turno)** e **27/10/2024 (2º turno de Prefeito)** de todos os
municípios das 26 UFs (o DF não tem eleição municipal) para o Cadê Meu Voto. É a base do futuro **"Cadê Meu Eleito?"**
(top 3 e eleitos por bairro). Segue o mesmo espírito de `build/brasil/` (2026): tudo é baixado **no servidor (box)**,
direto dos Dados Abertos do TSE; o navegador do usuário nunca fala com o TSE. Nada aqui muda a interface do site.

## Fontes (TSE — Dados Abertos, `cdn.tse.jus.br/estatistica/sead/odsele/`)

| Arquivo | Uso |
|---|---|
| `votacao_secao/votacao_secao_2024_<UF>.zip` | votos por seção, candidato e local (base de todos os agregados) |
| `detalhe_votacao_secao_2024.zip` | aptos, comparecimento, brancos, nulos, legenda por seção |
| `votacao_candidato_munzona_2024.zip` | **verificação**: total nominal por candidato/município; situação |
| `votacao_partido_munzona_2024.zip` | votos de legenda (separados dos nominais) |
| `consulta_cand_2024.zip` | candidatos e situação (eleito / eleito por QP / por média / suplente…) — CPF e e-mail **não** são usados |
| `rede_social_candidato_2024.zip` | links de redes sociais (links de grupo de WhatsApp são omitidos) |
| `consulta_vagas_2024.zip` | vagas por município |
| `eleitorado_local_votacao_2024.zip` | locais de votação: nome, endereço, **bairro**, CEP, latitude/longitude |
| `relatorio_resultado_totalizacao/Relatorio_Resultado_Totalizacao_2024_<UF>.zip` | 2ª fonte oficial (PDF do SISTOT, Anexo IX) — só para os casos que a base do munzona não traz (ver abaixo) |

## Como rodar

```bash
python3 -m venv /workspace/.venv-m2024 && /workspace/.venv-m2024/bin/pip install duckdb numpy boto3
cd site/build/municipal2024
/workspace/.venv-m2024/bin/python rodar.py            # todas as UFs (SE e AL primeiro); retoma do checkpoint
/workspace/.venv-m2024/bin/python rodar.py SP         # uma UF
/workspace/.venv-m2024/bin/python rodar.py --refazer SE
/workspace/.venv-m2024/bin/python locais2026.py       # índice de locais + top 3 por bairro de 2026 (prefixo novo e2026/)
```

Precisa de `pdftotext` (poppler-utils). Credenciais do R2 **só por variável de ambiente** (`CLOUDFLARE_API_TOKEN` e
`CLOUDFLARE_ACCOUNT_ID`, como no `build/brasil/upload_r2.py`, ou `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`); nunca são
impressas nem gravadas.

Etapas por UF (checkpoint em `/workspace/m2024/state/<uf>.json`): **baixado → montado (verificado) → subido → limpo**.
Se a verificação não fechar com 0 diferenças, a UF não sobe. O upload é idempotente (MD5 local × ETag remoto), só mexe em
`m2024/<uf>/` e nunca apaga nada. Os zips brutos são apagados ao fim de cada UF — o R2 é o depósito durável.
Progresso: `rebrand/municipal2024/progress.md`; relatório de verificação: `rebrand/municipal2024/verificacao/<UF>.md`.

| Script | Função |
|---|---|
| `comum.py` | configuração (pastas, UFs, buckets, utilitários) |
| `baixar.py` | download com retomada + extração dos CSVs da UF |
| `montar_uf.py` | agrega com DuckDB/numpy, grava os JSON e verifica |
| `relatorio.py` | lê do zip remoto (HTTP Range) só os PDFs de totalização necessários e extrai o Anexo IX |
| `subir.py` | upload idempotente para os dois buckets + `m2024/index.json` |
| `rodar.py` | orquestra UF por UF e atualiza o `progress.md` |
| `locais2026.py` | mesmo formato de locais/top 3 para 2026 (prefixo `e2026/`) |
| `fotos.py` | fotos sob demanda (só Prefeito, eleitos e quem aparece em top 3 de bairro), lidas do zip remoto do TSE |
| `resumo.py` | junta as verificações por UF em `rebrand/municipal2024/RESUMO.md` |

## Layout no R2

`cd` = código TSE do município (5 dígitos). Índices `n` apontam para a lista de candidatos do município (`c11`/`c13`,
em ordem de votos no 1º turno).

**Público — `cademeuvoto-dados` (dados.cademeuvoto.com.br)** — só resumo municipal e locais (sem votos por local):

- `m2024/index.json` — UFs disponíveis
- `m2024/<uf>/index.json` — municípios (seções, locais, aptos, prefeito eleito, se teve 2º turno, vagas)
- `m2024/<uf>/mun/<cd>.json` — totais do município: Prefeito (1º e 2º turno, %, situação), Vereadores (votos, %,
  situação, partido/federação/coligação), legenda por partido (separada), aptos/comparecimento/brancos/nulos, vagas
- `m2024/<uf>/locais/<cd>.json` — **índice compacto de locais**: `[lat, lon, bairro_i, zona, nr_local, nome]` + lista de
  bairros. Sem votos. Serve para o celular achar o local/bairro mais próximo **no aparelho** (nada de coordenada do
  usuário sai do celular)
- `m2024/<uf>/redes/<cd>.json` — `{sq: [urls]}`
- `m2024/<uf>/fotos/<sq>.jpg` + `m2024/<uf>/fotos.json` (lista de quem tem foto) — JPEG original do TSE (~30 KB), só
  candidatos a Prefeito, eleitos e vereadores que aparecem em algum top 3 de bairro (as 13,6 GB de fotos do TSE não são copiadas inteiras)
- `e2026/<uf>/locais/<cd>.json` — o mesmo índice de locais para 2026 (27 UFs, inclui DF)

**Assinantes — `cademeuvoto-dados-pro`** (mesmo prefixo; servido só via Worker):

- `m2024/<uf>/top3/<cd>.json` — **top 3 por bairro** com votos: Prefeito (1º turno, eleito e 2º turno) e Vereador
  (top 3 — pode incluir não eleitos — e a lista dos vereadores eleitos com seus votos no bairro)
- `m2024/<uf>/det/<cd>/geo.json` — zonas, bairros, locais (endereço, CEP, lat/lon), seções e estatística por seção
- `m2024/<uf>/det/<cd>/agg.json` — ranking completo por zona e por bairro (cargos 11, 11t2, 13) + legenda por bairro
- `m2024/<uf>/det/<cd>/11.json` — Prefeito: votos por local e por seção (t1/t2)
- `m2024/<uf>/det/<cd>/13-loc.json` — Vereador: votos por local
- `m2024/<uf>/det/<cd>/13-sec.json` (ou `13-sec-z<zona>.json` em municípios com mais de 1.500 seções) — Vereador por seção

- `e2026/<uf>/top3/<cd>.json` — top 3 por bairro de 2026 (Senador, Dep. Federal, Dep. Estadual/Distrital) com os eleitos
  e seus votos no bairro, no mesmo formato

Uma versão "grátis" proposta do top 3 (só nomes, sem votos) é gerada **localmente** em `out/proposta/` e **não** é
publicada até decisão do Marcel.

## Verificação (por UF)

1. **Soma dos votos das seções = votação nominal do TSE (`votacao_candidato_munzona`) por candidato e município: 0
   diferenças** para todo candidato presente nas duas fontes.
2. A base atual do munzona (regerada pelo TSE em 07/10/2026) **não traz** alguns candidatos/município×cargo que estão na
   votação por seção. Para esses, os votos são conferidos com o **Relatório Resultado da Totalização** oficial (PDF do
   SISTOT, Anexo IX) — conferência completa do município: todo candidato do anexo bate com a soma das seções e os votos de
   candidatos fora do anexo (registro cancelado antes da eleição) somam exatamente os "votos nulos técnico" do relatório.
3. Soma dos candidatos por seção = `QT_VOTOS_NOMINAIS` do detalhe da seção; legenda por partido × `votacao_partido_munzona`.
4. Eleitos: `consulta_cand` × `votacao_candidato_munzona` × arquivos gerados, em todos os municípios, com amostra
   (capital + sorteados) no relatório; nº de eleitos × vagas. Quando a base atual do TSE não informa a situação final de
   um cargo num município (possível anulação/retotalização), a situação vem do relatório oficial de 2024 e o arquivo do
   município leva `aviso_situacao`. Candidato que a base atual deixou sem situação mas que o relatório de 2024 dava
   como eleito fica com `e: false` e o campo informativo `st_rel2024`.

## Eleições suplementares

O TSE publica no mesmo arquivo de votação por seção algumas eleições suplementares (2025/2026) de municípios em que a
eleição de 2024 foi anulada (outro `CD_ELEICAO`). Elas ficam **fora** (o escopo é 06/10 e 27/10/2024): o arquivo do
município ganha `eleicao_suplementar` e `aviso_suplementar`, e ninguém é marcado como eleito naquele cargo.

## Privacidade

- O app calcula o bairro **no aparelho** a partir de `locais/<cd>.json`; nenhuma coordenada do usuário é enviada ou guardada.
- Não usamos CPF, e-mail, título de eleitor ou data de nascimento dos candidatos.
- `aptos` por bairro vem junto do top 3 para a interface poder esconder bairros com poucos eleitores.
