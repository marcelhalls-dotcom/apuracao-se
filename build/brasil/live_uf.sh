#!/bin/bash
# live_uf.sh <uf> "<regress ufs>" — espera deploy (UF ready no HTML), E2E ao vivo, 1ª visita, regressão
U=$1; REG=$2; cd "$(dirname "$0")"
for i in $(seq 1 60); do curl -s "https://cademeuvoto.com.br/?nc=$RANDOM$i" | grep -q "  $U: { code: '$U', nome: '[^']*', prep: '[a-z]*', em: '[a-z]*', status: 'ready'" && { echo "live after $i"; break; }; sleep 10; done
timeout 900 node e2e_uf.js https://cademeuvoto.com.br/ $U se rn > /tmp/live-$U.log 2>&1; echo "== $U $(grep -c '^FAIL' /tmp/live-$U.log) falhas"; grep -E "^FAIL|RESUMO|ERRO" /tmp/live-$U.log
timeout 300 node firstview_uf.js https://cademeuvoto.com.br/ $U > /tmp/fv-$U.json 2>&1; python3 -c "
import json;d=json.load(open('/tmp/fv-$U.json'));print('1a visita', {k:(v['pedidos'],v['kb'],v['dados_pedidos'],v['dados_kb'],v['tse'],v['pages_dados']) for k,v in d['views'].items()})"
for r in $REG; do timeout 900 node e2e_uf.js https://cademeuvoto.com.br/ $r $U > /tmp/reg-$r.log 2>&1; echo "== reg $r"; grep -E "^FAIL|RESUMO|ERRO" /tmp/reg-$r.log; done
echo LIVEDONE
