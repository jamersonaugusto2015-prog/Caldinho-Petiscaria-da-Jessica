-- 009_driver_tokens_shop — rebuild: a credencial do motoboy passa a saber a
-- loja e a morrer junto com ele.
--
-- Sem o `ON DELETE CASCADE`, apagar um motoboy deixava o token dele vivo — e um
-- token vivo sem dono é uma credencial que ainda abre a porta.
--
-- ⚠ `INNER JOIN`: token de motoboy que não existe mais não é copiado. É
-- exatamente o lixo que esta migração existe para varrer.

CREATE TABLE driver_tokens_novo (
  token TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

INSERT INTO driver_tokens_novo (token, shop_id, driver_id, created_at)
SELECT t.token, d.shop_id, t.driver_id, t.created_at
FROM driver_tokens t
INNER JOIN drivers d ON d.id = t.driver_id;

DROP TABLE driver_tokens;
ALTER TABLE driver_tokens_novo RENAME TO driver_tokens;

CREATE INDEX IF NOT EXISTS idx_driver_tokens_shop_driver ON driver_tokens (shop_id, driver_id);
