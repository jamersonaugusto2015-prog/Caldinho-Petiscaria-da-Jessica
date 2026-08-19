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

export function statusMessageFor(status: OrderStatus, fulfillment?: Fulfillment): string {
  if (fulfillment === 'pickup' && PICKUP_STATUS_MESSAGES[status]) {
    return PICKUP_STATUS_MESSAGES[status] as string;
  }
  return STATUS_MESSAGES[status];
}

export const STATUS_ORDER: OrderStatus[] = [
  'recebido',
  'em_preparo',
  'pronto',
  'saiu_entrega',
  'entregue',
  'cancelado',
];

/** Selos para resgatar 1 caldinho grátis. */
export const LOYALTY_STAMP_COST = 10;
