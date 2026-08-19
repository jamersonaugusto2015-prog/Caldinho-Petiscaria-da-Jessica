import { Server } from 'socket.io';
import { CancelActor, Order } from '../src/types';
import { getSettings } from './db';
import { emitOrder } from './orderEvents';
import { applyOrderEvent } from './orderLifecycle';
import { loadDriver, saveOrder } from './orderStore';
import { earnStamp, releaseFreeItems } from './loyalty';
import { markRefundDue } from './payment';

export interface CancelOrderRequest {
  order: Order;
  reason: string;
  by: CancelActor;
}

/**
 * Cancelar um pedido de ponta a ponta: status, selo de fidelidade e devolução.
 * Compõe os outros módulos e cada um continua dono dos seus campos —
 * `orderLifecycle` decide o status, `payment` decide o estado do pagamento,
 * `loyalty` devolve o token do brinde.
 *
 * Chamar duas vezes é seguro: o segundo cancelamento morre na regra do
 * `orderLifecycle` antes de devolver o token de novo. Isso importa porque o
 * cliente pode já ter gasto o token devolvido num pedido novo.
 */
export function cancelOrder(io: Server, request: CancelOrderRequest): Order {
  const { reason, by } = request;

  const result = applyOrderEvent(
    request.order,
    { type: 'cancel', reason },
    {
      getSettings,
      getDriver: loadDriver,
      earnStamp,
      // O cancelamento grava uma vez só, no fim, depois de anexar quem cancelou
      // e a devolução pendente. Sem isso o pedido iria ao banco pela metade.
      saveOrder: () => {},
    }
  );
  const order = result.order;

  order.cancelledAt = new Date().toISOString();
  order.cancelledBy = by;

  // O brinde já tinha sido consumido na criação do pedido; sem isso o cliente
  // perde os selos por um pedido que nunca chegou.
  releaseFreeItems(order.items);

  markRefundDue(order);

  saveOrder(order);
  emitOrder(io, 'order:updated', order);
  return order;
}

/** Motivo padrão quando quem cancela não escreve nada. */
export function defaultCancelReason(by: CancelActor): string {
  return by === 'loja' ? 'Cancelado pela loja' : 'Cancelado pelo cliente';
}
