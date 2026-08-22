-- 005_shops — a Loja passa a existir no banco.
--
-- Até aqui NENHUMA das 13 tabelas sabia que lojas existem. Esta é a raiz de
-- tudo que vem depois: cada tabela vai ganhar um `shop_id` que aponta para cá.
--
-- O `id` é INTEGER e não TEXT porque ele entra em índice composto de quase toda
-- tabela do sistema. O `slug` é o subdomínio (`loja-x` atende em
-- `loja-x.dominio.com.br`) e é por ele que o middleware de tenant descobre de
-- quem é a requisição — pelo `Host`, nunca pelo corpo.

CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  -- Loja desligada recebe 404 no middleware, em vez de servir meio app.
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- `UNIQUE` de coluna nova só entra por índice separado no SQLite. Sem ele, duas
-- lojas com o mesmo subdomínio seriam aceitas e a resolução por `Host` viraria
-- sorteio.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shops_slug ON shops (slug);

-- A loja 1 é a que já está em produção. Todo dado existente pertence a ela, e
-- é para este `id` que os backfills das próximas migrações apontam. O `slug`
-- provisório é trocado pelo painel super-admin (Fase 9).
INSERT INTO shops (id, slug, name, active, created_at)
SELECT 1, 'loja', 'Loja', 1, '2026-01-01T00:00:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM shops WHERE id = 1);
