-- 006_orders_shop — `orders` ganha a loja e as colunas que estavam escondidas
-- dentro do JSON.
--
-- `ADD COLUMN` é online: não recria a tabela, não trava, não perde linha. Serve
-- aqui porque a chave primária de `orders` continua sendo o `id` — o id do
-- pedido já é único no mundo inteiro, e é isso que faz o webhook do Mercado
-- Pago conseguir achar a loja a partir do `external_reference` (Fase 7).
--
-- As colunas novas duplicam campos que já existem no JSON de propósito. Sem
-- elas, "quanto essa loja faturou hoje" exige ler e desserializar TODO pedido
-- em JavaScript. Com elas, é um `SUM` no SQLite.

-- ⚠ SEM `REFERENCES shops(id)`, e não por esquecimento: o SQLite recusa
-- ("Cannot add a REFERENCES column with non-NULL default value") uma coluna
-- nova que tenha ao mesmo tempo chave estrangeira e valor padrão. E o padrão é
-- obrigatório aqui — as linhas que já existem precisam nascer apontando para a
-- loja 1. A alternativa seria RECONSTRUIR a maior tabela do sistema só para
-- ganhar uma FK que protege pouco: loja não é apagada, é desativada.
-- ⚠ O `DEFAULT 1` existe SÓ para o backfill das linhas antigas — NOT NULL em
-- tabela populada exige um default, e removê-lo depois pediria reconstruir a
-- tabela. NENHUM insert novo pode contar com ele: esquecer o shop_id
-- arquivaria a linha na loja 1, em silêncio.
ALTER TABLE orders ADD COLUMN shop_id INTEGER NOT NULL DEFAULT 1;

-- Aqui a FK cabe: coluna nova, sem valor padrão. Quem entregou o pedido.
ALTER TABLE orders ADD COLUMN driver_id TEXT REFERENCES drivers(id);

-- Dinheiro em centavos inteiros, a regra de `contract/pricing/money.ts`.
-- Somar REAL em ponto flutuante acumula erro; somar INTEGER não.
ALTER TABLE orders ADD COLUMN total_cents INTEGER NOT NULL DEFAULT 0;

ALTER TABLE orders ADD COLUMN is_paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN rating INTEGER;
ALTER TABLE orders ADD COLUMN delivered_at TEXT;

-- Preenche as colunas novas a partir do JSON que já está gravado. `json_extract`
-- é do próprio SQLite: nenhuma linha precisa passar pelo JavaScript.
UPDATE orders SET
  total_cents  = CAST(ROUND(COALESCE(json_extract(data, '$.total'), 0) * 100) AS INTEGER),
  is_paid      = CASE WHEN json_extract(data, '$.payment.isPaid') IN (1, 'true') THEN 1 ELSE 0 END,
  rating       = json_extract(data, '$.rating'),
  delivered_at = json_extract(data, '$.deliveredAt');

-- O `driver_id` é preenchido separado e só quando o motoboy AINDA existe: um
-- pedido de 2024 pode citar alguém que já foi apagado da equipe, e a FK acima
-- recusaria a linha inteira — derrubando a migração por causa de um histórico.
UPDATE orders SET driver_id = json_extract(data, '$.driverId')
WHERE json_extract(data, '$.driverId') IN (SELECT id FROM drivers);

-- Os índices antigos não têm a loja na frente. Com duas lojas, o kanban da
-- cozinha A varreria os pedidos da B para depois descartá-los — e o índice
-- deixaria de servir exatamente quando começasse a importar.
DROP INDEX IF EXISTS idx_orders_status;
DROP INDEX IF EXISTS idx_orders_customer_created;
DROP INDEX IF EXISTS idx_orders_created_at;

CREATE INDEX IF NOT EXISTS idx_orders_shop_status ON orders (shop_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_shop_customer ON orders (shop_id, customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_shop_created ON orders (shop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_shop_driver ON orders (shop_id, driver_id, status);
