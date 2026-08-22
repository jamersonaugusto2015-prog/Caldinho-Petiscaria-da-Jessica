import type { ShopId } from './types';

/**
 * O endereço de cada canal em tempo real, prefixado pela loja.
 *
 * As salas eram `kitchen`, `drivers`, `driver:<id>` e `customer:<id>` — sem
 * loja nenhuma. Com duas lojas no mesmo servidor, a cozinha da loja A entraria
 * na MESMA sala `kitchen` da loja B e receberia cada pedido novo da outra:
 * nome, telefone e endereço do cliente, na tela, sem erro nenhum aparecendo.
 *
 * O prefixo mora aqui, num módulo puro, e não espalhado em template strings:
 * o socket e o push precisam produzir EXATAMENTE a mesma string, senão o
 * cliente se inscreve num canal onde o evento nunca cai. Uma função, dois
 * adaptadores.
 */

/** A cozinha de uma loja. */
export function kitchenRoom(shopId: ShopId): string {
  return `shop:${shopId}:kitchen`;
}

/** Todos os motoboys de uma loja (o "pool" de corridas abertas). */
export function driversRoom(shopId: ShopId): string {
  return `shop:${shopId}:drivers`;
}

/** A sala privada de um motoboy. É por ela que passa o contato do cliente. */
export function driverRoom(shopId: ShopId, driverId: string): string {
  return `shop:${shopId}:driver:${driverId}`;
}

/**
 * A sala de um cliente.
 *
 * O `customerId` é um UUID do aparelho, e o MESMO aparelho pede em duas lojas.
 * Sem o prefixo, as duas lojas falariam com ele pelo mesmo canal e o pedido de
 * uma apareceria no acompanhamento da outra.
 */
export function customerRoom(shopId: ShopId, customerId: string): string {
  return `shop:${shopId}:customer:${customerId}`;
}

/** Todo mundo conectado a uma loja: cozinha, motoboys e clientes. */
export function shopRoom(shopId: ShopId): string {
  return `shop:${shopId}`;
}
