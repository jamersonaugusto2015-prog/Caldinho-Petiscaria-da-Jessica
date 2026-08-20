import { Fulfillment, OrderStatus } from '../types';

export const STATUS_MESSAGES: Record<OrderStatus, string> = {
  recebido: 'Pedido Recebido pela Cozinha!',
  em_preparo: 'Seu Caldinho está em Preparo! 🔥',
  pronto: 'Pedido Pronto! Aguardando Entregador 🛵',
  saiu_entrega: 'Saiu para Entrega! O Motoboy já está a caminho 🚀',
  entregue: 'Pedido Entregue! Bom apetite! ⭐',
  cancelado: 'Pedido Cancelado.',
};

/** Na retirada não existe motoboy: os avisos falam do balcão, não da porta de casa. */
const PICKUP_STATUS_MESSAGES: Partial<Record<OrderStatus, string>> = {
  pronto: 'Pedido Pronto para Retirar na loja! 🏪',
  entregue: 'Pedido Retirado! Bom apetite! ⭐',
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
    return 'Pedido Pronto! O Motoboy está indo buscar na loja 🛵';
  }
  return STATUS_MESSAGES[status];
}


/** Selos para resgatar 1 caldinho grátis. */
export const LOYALTY_STAMP_COST = 10;
