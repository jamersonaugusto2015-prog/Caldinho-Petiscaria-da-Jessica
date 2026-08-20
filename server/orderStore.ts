import { db } from './db';
import { Driver, Order, Product } from '../src/types';

export { DomainError } from './errors';

export function loadProduct(id: string): Product | null {
  if (!id) return null;
  const row = db.prepare('SELECT data FROM products WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Product) : null;
}

export function loadDriver(id: string): Driver | null {
  if (!id) return null;
  const row = db.prepare('SELECT data FROM drivers WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Driver) : null;
}

export function saveDriver(driver: Driver): void {
  db.prepare('UPDATE drivers SET data = ? WHERE id = ?').run(JSON.stringify(driver), driver.id);
}

export function getOrder(id: string): Order | null {
  const row = db.prepare('SELECT data FROM orders WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Order) : null;
}

export function insertOrder(order: Order): void {
  db.prepare(
    'INSERT INTO orders (id, data, status, created_at, customer_id) VALUES (?, ?, ?, ?, ?)'
  ).run(order.id, JSON.stringify(order), order.status, order.createdAt, order.customerId);
}

/** Persist an intake atomically with loyalty-token consumption. */
export function insertOrderWithBeforeInsert(order: Order, beforeInsert: () => void): void {
  db.transaction(() => {
    beforeInsert();
    insertOrder(order);
  })();
}

export function saveOrder(order: Order): void {
  db.prepare('UPDATE orders SET data = ?, status = ? WHERE id = ?').run(
    JSON.stringify(order),
    order.status,
    order.id
  );
}

export function orderIdExists(id: string): boolean {
  const row = db.prepare('SELECT 1 FROM orders WHERE id = ?').get(id);
  return !!row;
}

/** Removes a reserved order row whose charge never succeeded, so it never reaches the kitchen. */
export function deleteOrder(id: string): void {
  db.prepare('DELETE FROM orders WHERE id = ?').run(id);
}

export function listOrdersByStatus(status: string): Order[] {
  const rows = db.prepare('SELECT data FROM orders WHERE status = ?').all(status) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Order);
}

export function listOrdersByCustomer(customerId: string): Order[] {
  const rows = db
    .prepare('SELECT data FROM orders WHERE customer_id = ? ORDER BY created_at DESC')
    .all(customerId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Order);
}

export function listAllOrders(): Order[] {
  const rows = db.prepare('SELECT data FROM orders ORDER BY created_at DESC').all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Order);
}
