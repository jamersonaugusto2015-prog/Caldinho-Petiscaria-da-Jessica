-- 015_free_redeems_shop — rebuild: o brinde de fidelidade passa a apontar para
-- o produto DAQUELA loja.
--
-- ⚠ Tem que vir DEPOIS da 014: a chave estrangeira composta aponta para
-- `products(shop_id, id)`, que só existe a partir daquela reconstrução.
--
-- ⚠ `INNER JOIN`: um token que aponta para produto apagado não é copiado. Ele
-- já não podia ser resgatado (o resgate confere o produto), e com a FK nova
-- seria o que travaria a migração.

CREATE TABLE free_redeems_novo (
  token TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  customer_id TEXT,
  used INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (shop_id, product_id) REFERENCES products(shop_id, id) ON DELETE CASCADE
);

INSERT INTO free_redeems_novo (token, shop_id, product_id, used)
SELECT f.token, p.shop_id, f.product_id, f.used
FROM free_redeems f
INNER JOIN products p ON p.id = f.product_id AND p.shop_id = 1;

DROP TABLE free_redeems;
ALTER TABLE free_redeems_novo RENAME TO free_redeems;

CREATE INDEX IF NOT EXISTS idx_free_redeems_shop ON free_redeems (shop_id, used);
