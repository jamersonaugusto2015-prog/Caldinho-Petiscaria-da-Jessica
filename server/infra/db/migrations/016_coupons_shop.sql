-- 016_coupons_shop — rebuild: o cupom passa a ser da loja.
--
-- O código é escolhido pelo dono ('PRIMEIRO30', 'FRETEGRATIS'). Duas lojas vão
-- escolher o mesmo, e com a PK antiga a segunda seria recusada. Pior: sem o
-- filtro por loja, um cupom da loja A daria desconto num pedido da loja B.

CREATE TABLE coupons_novo (
  shop_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (shop_id, code)
);

INSERT INTO coupons_novo (shop_id, code, data) SELECT 1, code, data FROM coupons;

DROP TABLE coupons;
ALTER TABLE coupons_novo RENAME TO coupons;
