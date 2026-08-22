import { db } from './db';
import { toCents } from '../contract/pricing/money';
import type { Product } from '../contract/catalog/types';
import type { Driver } from '../contract/driver/types';
import type { Order, OrderStatus } from '../contract/order/types';
import type { ShopId } from '../contract/shop/types';
export { DomainError } from './errors';

/**
 * O acesso a pedidos, produtos e motoboys — agora sempre com a loja na frente.
 *
 * Toda função de LISTA leva `shopId` como primeiro parâmetro, e não como opção
 * no fim: assim é impossível esquecer. Com duas lojas, uma consulta sem filtro
 * não dá erro nenhum — ela devolve os pedidos das duas misturados, e a cozinha
 * de uma lê o telefone do cliente da outra.
 *
 * As funções que buscam por `id` (`getOrder`, `loadProduct`) recebem o `shopId`
 * pelo mesmo motivo: sem ele, saber o id de um pedido de outra loja bastaria
 * para lê-lo inteiro.
 */

export function loadProduct(shopId: ShopId, id: string): Product | null {
  if (!id) return null;
  const row = db
    .prepare('SELECT data FROM products WHERE shop_id = ? AND id = ?')
    .get(shopId, id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Product) : null;
}

export function loadDriver(shopId: ShopId, id: string): Driver | null {
  if (!id) return null;
  const row = db
    .prepare('SELECT data FROM drivers WHERE shop_id = ? AND id = ?')
    .get(shopId, id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Driver) : null;
}

export function saveDriver(shopId: ShopId, driver: Driver): void {
  db.prepare('UPDATE drivers SET data = ? WHERE shop_id = ? AND id = ?').run(
    JSON.stringify(driver),
    shopId,
    driver.id
  );
}

export function getOrder(shopId: ShopId, id: string): Order | null {
  const row = db
    .prepare('SELECT data FROM orders WHERE shop_id = ? AND id = ?')
    .get(shopId, id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Order) : null;
}

/**
 * As colunas fora do JSON existem para o SQLite poder somar e filtrar sem
 * desserializar o pedido inteiro. Elas são derivadas do `order`, nunca
 * informadas por fora: uma coluna que discorda do JSON é pior que não existir.
 */
function orderColumns(shopId: ShopId, order: Order) {
  return {
    shop_id: shopId,
    status: order.status,
    created_at: order.createdAt,
    customer_id: order.customerId,
    driver_id: order.driverId ?? null,
    // A regra ÚNICA de centavos (money.ts): `order.total * 100` cru perde um
    // centavo em valores de fronteira e a coluna passava a discordar do JSON.
    total_cents: toCents(order.total ?? 0),
    is_paid: order.payment?.isPaid ? 1 : 0,
    rating: order.rating ?? null,
    delivered_at: order.deliveredAt ?? null,
  };
}

export function insertOrder(shopId: ShopId, order: Order): void {
  const c = orderColumns(shopId, order);
  db.prepare(
    `INSERT INTO orders
       (id, data, shop_id, status, created_at, customer_id, driver_id, total_cents, is_paid, rating, delivered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    order.id,
    JSON.stringify(order),
    c.shop_id,
    c.status,
    c.created_at,
    c.customer_id,
    c.driver_id,
    c.total_cents,
    c.is_paid,
    c.rating,
    c.delivered_at
  );
}

/** Grava a entrada do pedido junto com o consumo dos selos, numa transação só. */
export function insertOrderWithBeforeInsert(
  shopId: ShopId,
  order: Order,
  beforeInsert: () => void
): void {
  db.transaction(() => {
    beforeInsert();
    insertOrder(shopId, order);
  })();
}

export function saveOrder(shopId: ShopId, order: Order): void {
  const c = orderColumns(shopId, order);
  db.prepare(
    `UPDATE orders SET
       data = ?, status = ?, driver_id = ?, total_cents = ?, is_paid = ?, rating = ?, delivered_at = ?
     WHERE shop_id = ? AND id = ?`
  ).run(
    JSON.stringify(order),
    c.status,
    c.driver_id,
    c.total_cents,
    c.is_paid,
    c.rating,
    c.delivered_at,
    shopId,
    order.id
  );
}

/**
 * O id do pedido é único no mundo, não por loja: é ele que o webhook do Mercado
 * Pago devolve em `external_reference`, e é por ele que a Fase 7 descobre de
 * qual loja é o pagamento. Por isso esta checagem NÃO leva `shopId`.
 */
export function orderIdExists(id: string): boolean {
  return !!db.prepare('SELECT 1 FROM orders WHERE id = ?').get(id);
}

/** Descobre a loja de um pedido pelo id. O caminho de volta do webhook. */
export function shopIdOfOrder(id: string): ShopId | null {
  const row = db.prepare('SELECT shop_id FROM orders WHERE id = ?').get(id) as
    | { shop_id: number }
    | undefined;
  return row ? row.shop_id : null;
}

/** Apaga a linha reservada de um pedido cuja cobrança nunca fechou. */
export function deleteOrder(shopId: ShopId, id: string): void {
  db.prepare('DELETE FROM orders WHERE shop_id = ? AND id = ?').run(shopId, id);
}

export interface ListOrdersFilter {
  status?: OrderStatus | OrderStatus[];
  customerId?: string;
  /**
   * Janela por data de criação, em ISO. É o que os relatórios usam: sem ela,
   * pedir "o faturamento desta semana" lia e desserializava o histórico
   * INTEIRO da loja para descartar quase tudo em JavaScript.
   */
  from?: string;
  to?: string;
  /** Sem limite = a loja inteira. Use limite em tela que não precisa do histórico todo. */
  limit?: number;
}

/**
 * A única porta para listar pedidos.
 *
 * Substitui `listAllOrders()`, que não tinha filtro nenhum e alimentava 4 telas.
 * Com duas lojas, ela misturaria os pedidos das duas em silêncio — sem erro,
 * sem log, sem nada que denunciasse.
 */
export function listOrders(shopId: ShopId, filter: ListOrdersFilter = {}): Order[] {
  const where: string[] = ['shop_id = ?'];
  const params: (string | number)[] = [shopId];

  if (filter.status !== undefined) {
    const lista = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (lista.length === 0) return [];
    where.push(`status IN (${lista.map(() => '?').join(', ')})`);
    params.push(...lista);
  }
  if (filter.customerId) {
    where.push('customer_id = ?');
    params.push(filter.customerId);
  }
  if (filter.from) {
    where.push('created_at >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    where.push('created_at <= ?');
    params.push(filter.to);
  }

  let sql = `SELECT data FROM orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC`;
  if (filter.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(Math.max(0, Math.floor(filter.limit)));
  }

  return (db.prepare(sql).all(...params) as { data: string }[]).map(
    (r) => JSON.parse(r.data) as Order
  );
}
