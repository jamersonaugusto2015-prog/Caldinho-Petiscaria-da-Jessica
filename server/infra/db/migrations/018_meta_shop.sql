-- 018_meta_shop — rebuild: as configurações passam a ser por loja.
--
-- A tabela `meta` é onde mora TUDO que a loja configurou: nome, coordenadas,
-- taxas, chave PIX, horário, hash do PIN, tokens de papel. Com uma PK só de
-- `key`, a segunda loja sobrescreveria a configuração da primeira na primeira
-- vez que alguém salvasse — inclusive o PIN e a chave PIX.
--
-- Os SEGREDOS saem daqui na 019. Esta migração só reparte o que sobra.

CREATE TABLE meta_novo (
  shop_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (shop_id, key)
);

INSERT INTO meta_novo (shop_id, key, value) SELECT 1, key, value FROM meta;

DROP TABLE meta;
ALTER TABLE meta_novo RENAME TO meta;
