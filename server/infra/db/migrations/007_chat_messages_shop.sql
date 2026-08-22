-- 007_chat_messages_shop — rebuild: a conversa passa a pertencer à loja e ao
-- pedido de verdade.
--
-- É RECONSTRUÇÃO e não `ADD COLUMN` porque o ganho aqui é a chave estrangeira
-- com `ON DELETE CASCADE`, e o SQLite só aceita FK em coluna nova de tabela
-- nova. Sem ela, apagar um pedido deixava as mensagens dele órfãs para sempre.
--
-- ⚠ O `INNER JOIN` é deliberado: mensagem cujo pedido não existe mais NÃO é
-- copiada. Ela já era lixo inacessível (nenhuma tela sabe abrir uma conversa
-- sem pedido) e, com a FK nova, seria justamente o que impediria a migração de
-- terminar.

CREATE TABLE chat_messages_novo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  data TEXT NOT NULL
);

INSERT INTO chat_messages_novo (id, shop_id, order_id, data)
SELECT m.id, o.shop_id, m.order_id, m.data
FROM chat_messages m
INNER JOIN orders o ON o.id = m.order_id;

DROP TABLE chat_messages;
ALTER TABLE chat_messages_novo RENAME TO chat_messages;

CREATE INDEX IF NOT EXISTS idx_chat_shop_order ON chat_messages (shop_id, order_id, id);
