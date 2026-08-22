-- 014_products_shop — rebuild: o produto passa a ser da loja.
--
-- Mesma razão da categoria: o `id` do produto vem do template de catálogo
-- (`cal-1`, `com-2`), e toda loja nova nasce com os mesmos ids. Sem a PK
-- composta, a segunda loja não conseguiria ser criada.

CREATE TABLE products_novo (
  shop_id INTEGER NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (shop_id, id)
);

INSERT INTO products_novo (shop_id, id, data) SELECT 1, id, data FROM products;

DROP TABLE products;
ALTER TABLE products_novo RENAME TO products;

-- A busca por categoria era `WHERE data LIKE '%"category":"%'`, uma varredura
-- de texto em cima do JSON. `json_extract` num índice resolve de verdade.
CREATE INDEX IF NOT EXISTS idx_products_shop_category
  ON products (shop_id, json_extract(data, '$.category'));
