#!/bin/bash
# golive.sh <uf> <Nome> "<commit msg>" <others...>
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; SITE="$(cd "$HERE/../.." && pwd)"
U=$1; NOME=$2; MSG=$3; shift 3
cd "$SITE"
git add index.html relatorios.js chat-worker/src/index.js
git commit -qm "$MSG"; git push -q origin HEAD 2>&1 | tail -2
git log -1 --format='%h %ci'
for i in $(seq 1 60); do
  curl -s "https://cademeuvoto.com.br/?nc=$RANDOM$i" | grep -q "nome: '$NOME', prep: '[a-z]*', em: '[a-z]*', status: 'ready'" && curl -s "https://cademeuvoto.com.br/mapa/$U/index.json?nc=$i" | grep -q "\"uf\":\"${U^^}\"" && { echo "live after $i"; break; }
  sleep 10
done
cd "$HERE" && timeout 500 node e2e_uf.js https://cademeuvoto.com.br/ $U "$@" 2>&1 | grep -E "FAIL|RESUMO|TSE no|cabeçalho"
