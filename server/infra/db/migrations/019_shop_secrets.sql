-- 019_shop_secrets — os segredos saem do `meta` e ganham tabela própria, por loja.
--
-- Duas razões para separar, e nenhuma é estética:
--
-- 1. `GET /settings` serializa a `meta` para o painel. Todo segredo que mora
--    lá depende de alguém lembrar de removê-lo da resposta — e um `io.emit`
--    sem sala em `routes.ts` já vazava a chave PIX para todo mundo conectado.
--    Segredo em tabela separada não tem como escorregar junto.
-- 2. O backup exporta o banco. Com os segredos numa tabela própria, dá para
--    exportar a loja sem exportar as credenciais dela.

CREATE TABLE IF NOT EXISTS shop_secrets (
  shop_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (shop_id, key)
);

-- Move o que já existe. A lista é explícita: mover "tudo que parece segredo"
-- por padrão de nome levaria junto qualquer chave nova que combinasse por acaso.
INSERT OR REPLACE INTO shop_secrets (shop_id, key, value)
SELECT shop_id, key, value FROM meta
WHERE key IN (
  'kitchen_pin_hash',
  'role_token_kitchen',
  'role_token_driver',
  'mp_access_token',
  'mp_refresh_token',
  'mp_public_key',
  'mp_user_id',
  'mp_expires_at',
  'mp_live_mode',
  'backup_service_account'
);

DELETE FROM meta WHERE key IN (
  'kitchen_pin_hash',
  'role_token_kitchen',
  'role_token_driver',
  'mp_access_token',
  'mp_refresh_token',
  'mp_public_key',
  'mp_user_id',
  'mp_expires_at',
  'mp_live_mode',
  'backup_service_account'
);
