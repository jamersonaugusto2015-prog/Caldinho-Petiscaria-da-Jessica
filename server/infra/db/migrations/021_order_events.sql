-- 021_order_events — a trilha que nunca existiu.
--
-- Hoje um pedido guarda só o status ATUAL. Quando a cozinha diz "esse pedido
-- saiu às 19h" e o cliente diz "chegou às 21h", não há como saber quem tem
-- razão: a informação nunca foi gravada. Também não há como responder "quem
-- cancelou" nem "quanto tempo esse pedido ficou parado no preparo".
--
-- Uma linha por transição, escrita por `applyOrderEvent`. Só cresce, nunca
-- muda: é registro, não estado.

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- Nulo na primeira linha: o pedido não vinha de status nenhum.
  from_status TEXT,
  to_status TEXT NOT NULL,
  -- 'kitchen' | 'driver' | 'client' | 'system'
  actor TEXT NOT NULL,
  -- Qual motoboy, quando o ator é um. Sem FK: o registro tem que sobreviver à
  -- saída do motoboy da equipe, senão a trilha se apaga junto com ele.
  actor_id TEXT,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events (order_id, id);
CREATE INDEX IF NOT EXISTS idx_order_events_shop_at ON order_events (shop_id, at);

-- Semeia a primeira linha de cada pedido que já existe. Não dá para inventar o
-- histórico que não foi gravado, mas dá para registrar o estado em que cada
-- pedido está hoje — assim a trilha começa completa a partir de agora, em vez
-- de os pedidos antigos ficarem sem nenhuma linha.
INSERT INTO order_events (shop_id, order_id, from_status, to_status, actor, at)
SELECT shop_id, id, NULL, status, 'system', created_at FROM orders;
