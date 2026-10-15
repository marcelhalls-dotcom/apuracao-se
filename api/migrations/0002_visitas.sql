-- Estatísticas anônimas de visitantes (08/10/2026). Só agregados: NENHUM IP, cookie, hash ou identificador é guardado.
-- Uma linha por dia (BRT) e local: 'BR-SE' (estado), 'BR-??' (Brasil, estado desconhecido), 'US' (país), '??' (desconhecido)
-- ou '_teste' (testes automáticos/robôs, fora dos totais).
-- visitantes = navegadores no 1º acesso do dia (marca do próprio navegador, em localStorage); acessos = páginas abertas.
CREATE TABLE IF NOT EXISTS visitas_dia (
  dia TEXT NOT NULL,
  local TEXT NOT NULL,
  visitantes INTEGER NOT NULL DEFAULT 0,
  acessos INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, local)
) WITHOUT ROWID;
