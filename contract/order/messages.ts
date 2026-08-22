/**
 * O que o cliente lê em cada etapa do pedido. Um texto por status, e as
 * exceções da retirada — onde não existe motoboy e falar em "entregador" seria
 * mentira.
 */
import type { Fulfillment, OrderStatus } from './types';
export const STATUS_MESSAGES: Record<OrderStatus, string> = {
  recebido: 'A cozinha recebeu seu pedido.',
  em_preparo: 'Seu pedido está em preparo.',
  pronto: 'Pedido pronto. Aguardando entregador.',
  saiu_entrega: 'Saiu para entrega. O motoboy está a caminho.',
  entregue: 'Pedido entregue. Bom apetite.',
  cancelado: 'Pedido cancelado.',
};

/** Na retirada não existe motoboy: os avisos falam do balcão, não da porta de casa. */
const PICKUP_STATUS_MESSAGES: Partial<Record<OrderStatus, string>> = {
  pronto: 'Pedido pronto para retirar na loja.',
  entregue: 'Pedido retirado. Bom apetite.',
};

/**
 * Aceitar a corrida não é sair para entrega: o motoboy ainda precisa buscar o
 * pedido na loja. Enquanto isso o status continua `pronto`, e dizer "aguardando
 * entregador" a quem já tem motoboy a caminho da loja seria mentir para menos.
 */
export function statusMessageFor(
  status: OrderStatus,
  fulfillment?: Fulfillment,
  driverAssigned?: boolean
): string {
  if (fulfillment === 'pickup' && PICKUP_STATUS_MESSAGES[status]) {
    return PICKUP_STATUS_MESSAGES[status] as string;
  }
  if (status === 'pronto' && driverAssigned) {
    return 'Pedido pronto. O motoboy está indo buscar na loja.';
  }
  return STATUS_MESSAGES[status];
}
