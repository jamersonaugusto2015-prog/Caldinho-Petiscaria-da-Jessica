import { randomUUID } from 'crypto';
import { db } from '../../db';
import type { ChatMessage } from '../../../contract/order/types';
import type { ShopId } from '../../../contract/shop/types';

/**
 * Monta uma mensagem de chat com id e horário — o formato estava COPIADO no
 * router de chat e no de reclamação, livres para divergir. Um lugar só.
 * `senderName` e `text` ganham o mesmo teto nos dois caminhos.
 */
export function buildChatMessage(input: {
  orderId: string;
  sender: ChatMessage['sender'];
  senderName?: string;
  text: string;
}): ChatMessage {
  return {
    id: 'msg-' + randomUUID(),
    orderId: input.orderId,
    sender: input.sender,
    senderName: (input.senderName?.trim() || 'Cliente').slice(0, 80),
    text: String(input.text).slice(0, 500),
    timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  };
}

/**
 * As mensagens trocadas em volta de um pedido.
 *
 * O SQL disto estava em três lugares diferentes de `routes.ts` — dois inserts
 * copiados e uma leitura — e nenhum deles filtrava por loja. O `shop_id` entra
 * na consulta e não só no insert: saber o id de um pedido de outra loja não
 * pode bastar para ler a conversa dele.
 */

export function listChatMessages(shopId: ShopId, orderId: string): ChatMessage[] {
  const rows = db
    .prepare('SELECT data FROM chat_messages WHERE shop_id = ? AND order_id = ? ORDER BY id')
    .all(shopId, orderId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as ChatMessage);
}

export function insertChatMessage(shopId: ShopId, message: ChatMessage): ChatMessage {
  db.prepare('INSERT INTO chat_messages (shop_id, order_id, data) VALUES (?, ?, ?)').run(
    shopId,
    message.orderId,
    JSON.stringify(message)
  );
  return message;
}
