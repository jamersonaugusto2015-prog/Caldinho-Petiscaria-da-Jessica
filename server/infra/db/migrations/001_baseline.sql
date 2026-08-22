-- 001_baseline — o schema que já existia em produção no dia em que as migrações
-- versionadas nasceram.
--
-- Tudo aqui é `IF NOT EXISTS` de propósito: esta migração precisa rodar tanto
-- num banco vazio (e criar tudo) quanto no banco de produção que já tem todas
-- as tabelas (e não fazer nada). É a única migração com essa dupla função — as
-- próximas partem de um schema conhecido e podem ser diretas.

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  customer_id TEXT
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

-- Credencial por motoboy. Mora fora da linha do motoboy de propósito: o JSON
-- da tabela drivers é serializado para a cozinha e para o app, e um token
-- guardado lá vazaria junto na primeira rota que esquecesse de removê-lo.
CREATE TABLE IF NOT EXISTS driver_tokens (
  token TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Inscrições de push do navegador. A coluna room é a MESMA string que a
-- audiência do pedido produz (kitchen, driver:<id>, customer:<id>), então
-- socket e push endereçam as pessoas do mesmo jeito: um esquema, dois canos.
-- O endpoint é a chave porque ele é o navegador: reinscrever a mesma aba tem
-- que sobrescrever a linha, não criar uma segunda e notificar em dobro.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  room TEXT NOT NULL,
  role TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loyalty (
  customer_id TEXT PRIMARY KEY,
  points INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS free_redeems (
  token TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS geo_cache (
  query TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Índices para as consultas reais do app: kanban por status, relatórios
-- ordenados por data e chat por pedido. Sem eles, cada consulta é uma varredura
-- da tabela inteira que piora conforme os anos passam.
--
-- O índice de histórico por cliente NÃO está aqui: ele depende de
-- `orders.customer_id`, que num banco antigo só existe depois da 002. Criá-lo
-- aqui derrubava o boot dessas lojas com "no such column".
CREATE INDEX IF NOT EXISTS idx_driver_tokens_driver ON driver_tokens (driver_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_room ON push_subscriptions (room);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_order_id ON chat_messages (order_id);
