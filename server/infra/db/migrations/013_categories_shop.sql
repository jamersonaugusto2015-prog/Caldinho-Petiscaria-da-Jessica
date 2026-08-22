-- 013_categories_shop — rebuild: a categoria passa a ser da loja.
--
-- PK composta porque o `id` da categoria é escolhido por quem cadastra
-- ('caldinhos', 'bebidas'). Duas lojas vão querer o MESMO id, e com a PK antiga
-- a segunda receberia "UNIQUE constraint failed" ao criar a própria categoria.

CREATE TABLE categories_novo (
  shop_id INTEGER NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (shop_id, id)
);

INSERT INTO categories_novo (shop_id, id, data) SELECT 1, id, data FROM categories;

DROP TABLE categories;
ALTER TABLE categories_novo RENAME TO categories;
