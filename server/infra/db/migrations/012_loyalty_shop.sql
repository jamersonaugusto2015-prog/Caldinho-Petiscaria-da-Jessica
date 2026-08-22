-- 012_loyalty_shop — rebuild: os selos passam a ser POR LOJA.
--
-- O `customer_id` é um UUID do aparelho, e o mesmo aparelho pode pedir em duas
-- lojas. Com a PK antiga (`customer_id` sozinho), os selos ganhos na pizzaria
-- valeriam um caldinho grátis na outra loja — a segunda pagando o brinde da
-- primeira. A PK composta é o que separa as duas carteiras.

CREATE TABLE loyalty_novo (
  shop_id INTEGER NOT NULL,
  customer_id TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, customer_id)
);

INSERT INTO loyalty_novo (shop_id, customer_id, points)
SELECT 1, customer_id, points FROM loyalty;

DROP TABLE loyalty;
ALTER TABLE loyalty_novo RENAME TO loyalty;
