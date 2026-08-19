import { OrderStatus } from '../types';

export const STATUS_MESSAGES: Record<OrderStatus, string> = {
  recebido: 'Pedido Recebido pela Cozinha!',
  em_preparo: 'Seu Caldinho está em Preparo! 🔥',
  pronto: 'Pedido Pronto! Aguardando Entregador 🛵',
  saiu_entrega: 'Saiu para Entrega! O Motoboy já está a caminho 🚀',
  entregue: 'Pedido Entregue! Bom apetite! ⭐',
  cancelado: 'Pedido Cancelado.',
};

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
