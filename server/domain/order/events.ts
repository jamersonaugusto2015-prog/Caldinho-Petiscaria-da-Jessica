import { db } from '../../db';
import type { OrderStatus } from '../../../contract/order/types';
import type { ShopId } from '../../../contract/shop/types';

/**
 * A trilha do pedido: quem mudou o quê, e quando.
 *
 * Isto não existia. Um pedido guardava só o status ATUAL, então quando a
 * cozinha dizia "saiu às 19h" e o cliente dizia "chegou às 21h", não havia como
 * saber quem tinha razão — a informação nunca chegou a ser gravada. Também não
 * dava para responder "quem cancelou" nem "quanto tempo esse pedido ficou
 * parado no preparo".
 *
 * Só cresce, nunca muda: é registro, não estado.
 */

export type OrderEventActor = 'kitchen' | 'driver' | 'client' | 'system';

export interface OrderEvent {
  /** Nulo na primeira linha: o pedido não vinha de status nenhum. */
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actor: OrderEventActor;
  /** Qual motoboy, quando o ator é um. */
  actorId?: string;
  at: string;
}

export function recordOrderEvent(shopId: ShopId, orderId: string, event: OrderEvent): void {
  db.prepare(
    `INSERT INTO order_events (shop_id, order_id, from_status, to_status, actor, actor_id, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    shopId,
    orderId,
    event.fromStatus,
    event.toStatus,
    event.actor,
    event.actorId ?? null,
    event.at
  );
}

export function listOrderEvents(shopId: ShopId, orderId: string): OrderEvent[] {
  const rows = db
    .prepare(
      `SELECT from_status, to_status, actor, actor_id, at
       FROM order_events WHERE shop_id = ? AND order_id = ? ORDER BY id`
    )
    .all(shopId, orderId) as {
    from_status: OrderStatus | null;
    to_status: OrderStatus;
    actor: OrderEventActor;
    actor_id: string | null;
    at: string;
  }[];

  return rows.map((r) => ({
    fromStatus: r.from_status,
    toStatus: r.to_status,
    actor: r.actor,
    actorId: r.actor_id ?? undefined,
    at: r.at,
  }));
}
