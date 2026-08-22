-- 010_push_subscriptions_shop — a inscrição de push passa a saber a loja.
--
-- A coluna `room` já carrega o destino (`kitchen`, `driver:<id>`,
-- `customer:<id>`). A partir da Fase 6 ela ganha o prefixo `shop:{id}:`, e o
-- `shop_id` aqui é o que permite achar as inscrições de uma loja sem sair
-- lendo string.
--
-- A PK continua sendo o `endpoint`: ele É o navegador, e um navegador só pode
-- ter uma linha, senão a notificação chega em dobro.

-- ⚠ O `DEFAULT 1` existe SÓ para o backfill das linhas antigas — NOT NULL em
-- tabela populada exige um default, e removê-lo depois pediria reconstruir a
-- tabela. NENHUM insert novo pode contar com ele: esquecer o shop_id
-- arquivaria a linha na loja 1, em silêncio.
ALTER TABLE push_subscriptions ADD COLUMN shop_id INTEGER NOT NULL DEFAULT 1;

DROP INDEX IF EXISTS idx_push_subscriptions_room;
CREATE INDEX IF NOT EXISTS idx_push_shop_room ON push_subscriptions (shop_id, room);
