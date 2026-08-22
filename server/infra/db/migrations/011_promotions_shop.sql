-- 011_promotions_shop — a promoção passa a ser da loja.
--
-- O `id` continua sendo a PK sozinho: promoção é criada com id gerado pelo
-- servidor, então já não colide entre lojas. O `shop_id` é o filtro de leitura.

-- ⚠ O `DEFAULT 1` existe SÓ para o backfill das linhas antigas — NOT NULL em
-- tabela populada exige um default, e removê-lo depois pediria reconstruir a
-- tabela. NENHUM insert novo pode contar com ele: esquecer o shop_id
-- arquivaria a linha na loja 1, em silêncio.
ALTER TABLE promotions ADD COLUMN shop_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_promotions_shop ON promotions (shop_id);
