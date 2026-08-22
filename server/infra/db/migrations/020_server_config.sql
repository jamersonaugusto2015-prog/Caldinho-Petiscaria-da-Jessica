-- 020_server_config — o que pertence ao SERVIDOR, não a nenhuma loja.
--
-- O par VAPID é o caso: ele identifica o SERVIDOR DE PUSH para o navegador, não
-- a loja. Guardá-lo por loja quebraria push de verdade — a inscrição que o
-- navegador guardou foi assinada com uma chave pública específica, e trocar a
-- chave mata em silêncio todos os inscritos.

CREATE TABLE IF NOT EXISTS server_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Só a loja 1 existe quando isto roda (nada entre 005 e 019 cria outra),
-- então descartar o shop_id é seguro AQUI. Se um dia uma migração entrar
-- antes desta e criar lojas, este SELECT colapsaria as chaves VAPID de duas
-- lojas numa linha só — revisite.
INSERT OR REPLACE INTO server_config (key, value)
SELECT key, value FROM meta WHERE key IN ('vapid_public_key', 'vapid_private_key');

DELETE FROM meta WHERE key IN ('vapid_public_key', 'vapid_private_key');
