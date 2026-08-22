-- 008_drivers_shop — o motoboy passa a ser DA LOJA (ADR-0009 continua valendo:
-- ele é da loja, não da plataforma).
--
-- O `name` sai do JSON e vira coluna para poder ganhar um `UNIQUE(shop_id, name)`.
-- Hoje a checagem de nome repetido é um laço em JavaScript em `routes.ts`, que
-- lê a equipe inteira e compara — e que perde a corrida quando dois cadastros
-- chegam juntos. Um índice único não perde.

-- ⚠ O `DEFAULT 1` existe SÓ para o backfill das linhas antigas — NOT NULL em
-- tabela populada exige um default, e removê-lo depois pediria reconstruir a
-- tabela. NENHUM insert novo pode contar com ele: esquecer o shop_id
-- arquivaria a linha na loja 1, em silêncio.
ALTER TABLE drivers ADD COLUMN shop_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE drivers ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE drivers ADD COLUMN active INTEGER NOT NULL DEFAULT 1;

UPDATE drivers SET
  name   = COALESCE(json_extract(data, '$.name'), ''),
  active = CASE WHEN json_extract(data, '$.active') IN (0, 'false') THEN 0 ELSE 1 END;

-- Antes do índice, desfaz as colisões que um banco antigo pode carregar: a
-- checagem de nome repetido era um laço em JS que perdia corrida, então
-- "Marcos" e "marcos" podem coexistir — e dois motoboys sem nome no JSON
-- viram '' os dois. Sem isto, o CREATE UNIQUE INDEX abaixo explode e o boot
-- fica PRESO nesta migração, sem caminho de recuperação no código. A primeira
-- linha fica como está; as seguintes ganham o próprio `rowid`.
--
-- O sufixo é o `id` INTEIRO, não `substr(id,1,4)` nem `rowid`:
--  * `substr(id,1,4)` é `drv-` para todo motoboy real (id = `drv-`+uuid), então
--    dois sem nome virariam `motoboy-drv-` iguais e o índice quebraria igual.
--  * `rowid` é único por linha, MAS o nome renomeado (`Ana <rowid>`) ainda pode
--    bater num nome literal já existente (`Ana`+`Ana`+`Ana 2`: o 2º Ana viraria
--    `Ana 2` e colidiria) — o exato boot travado que esta migração evita.
--  * O `id` é a PK (única) e ninguém digita `drv-`+uuid como nome de motoboy,
--    então `Ana drv-...` não colide com nada — nem com outro renomeado, nem com
--    um nome digitado à mão. É o único sufixo à prova de colisão.
UPDATE drivers SET name = CASE
    WHEN name = '' THEN 'motoboy-' || id
    ELSE name || ' ' || id
  END
WHERE rowid IN (
  SELECT depois.rowid FROM drivers antes
  JOIN drivers depois
    ON depois.shop_id = antes.shop_id
   AND depois.name = antes.name COLLATE NOCASE
   AND depois.rowid > antes.rowid
);

-- `COLLATE NOCASE`: "Marcos" e "marcos" são a mesma pessoa para quem lê o
-- quadro da cozinha, então precisam ser a mesma pessoa para o banco também.
CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_shop_name ON drivers (shop_id, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_drivers_shop_active ON drivers (shop_id, active);
