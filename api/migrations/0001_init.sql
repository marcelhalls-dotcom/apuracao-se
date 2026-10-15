-- cademeuvoto-api: esquema inicial
CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL DEFAULT '',
  telefone TEXT, cidade TEXT, uf TEXT, perfil TEXT,
  email_verificado_em INTEGER,
  termos_versao TEXT, termos_aceitos_em INTEGER,
  optin_novidades INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ativo',          -- ativo | bloqueado | excluido
  stripe_customer_id TEXT UNIQUE,
  cortesia_ate INTEGER, cortesia_limite INTEGER, cortesia_motivo TEXT,
  ultimo_login_em INTEGER,
  excluido_em INTEGER,
  criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS usuarios_criado ON usuarios(criado_em);
CREATE TABLE IF NOT EXISTS codigos (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  finalidade TEXT NOT NULL,                      -- login | cadastro | excluir
  codigo_hash TEXT NOT NULL,
  expira_em INTEGER NOT NULL,
  tentativas INTEGER NOT NULL DEFAULT 0,
  usado_em INTEGER,
  ip_hash TEXT,
  criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS codigos_email ON codigos(email, criado_em);
CREATE TABLE IF NOT EXISTS sessoes (
  token_hash TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  criada_em INTEGER NOT NULL,
  expira_em INTEGER NOT NULL,
  ultimo_uso INTEGER,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessoes_usuario ON sessoes(usuario_id);
CREATE TABLE IF NOT EXISTS assinaturas (
  stripe_subscription_id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  stripe_customer_id TEXT,
  status TEXT NOT NULL,
  price_id TEXT,
  periodo_inicio INTEGER, periodo_fim INTEGER,
  cancelar_no_fim INTEGER NOT NULL DEFAULT 0,
  past_due_desde INTEGER,
  evento_em INTEGER NOT NULL DEFAULT 0,          -- event.created do último evento aplicado (ordem)
  atualizado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS assinaturas_usuario ON assinaturas(usuario_id, atualizado_em);
CREATE TABLE IF NOT EXISTS relatorios (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  criado_em INTEGER NOT NULL,
  ciclo TEXT NOT NULL,
  tipo TEXT, uf TEXT, cargo TEXT, alvo TEXT, nivel TEXT, formatos TEXT,
  assinatura_spec TEXT,
  status TEXT NOT NULL DEFAULT 'iniciado',       -- iniciado | ok | falhou | estornado
  origem TEXT,                                   -- botao | chat
  finalizado_em INTEGER,
  estornado_por TEXT                             -- auto | admin:<email>
);
CREATE INDEX IF NOT EXISTS rel_usuario_ciclo ON relatorios(usuario_id, ciclo);
CREATE INDEX IF NOT EXISTS rel_usuario_spec ON relatorios(usuario_id, assinatura_spec, criado_em);
CREATE TABLE IF NOT EXISTS stripe_eventos (id TEXT PRIMARY KEY, tipo TEXT, recebido_em INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS contadores (chave TEXT PRIMARY KEY, valor INTEGER NOT NULL, expira_em INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS contadores_expira ON contadores(expira_em);
CREATE TABLE IF NOT EXISTS auditoria_admin (
  id TEXT PRIMARY KEY, admin TEXT, acao TEXT, alvo TEXT, detalhe TEXT, em INTEGER NOT NULL
);
