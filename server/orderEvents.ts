import { Server } from 'socket.io';
import type { Order } from '../contract/order/types';
import type { ShopId } from '../contract/shop/types';
import { orderAudience } from '../contract/order/audience';
import { OrderPushContext, sendOrderPush } from './push';
import { stripCustomerContact, stripPaymentSecrets } from '../contract/order/views';
// A redação mora em `orderViews.ts`, junto com a vista usada pelas rotas HTTP.
// Reexportado porque `routes.ts` ainda importa `stripPaymentSecrets` daqui.
export { stripCustomerContact, stripPaymentSecrets };
export type { OrderPushContext };

/**
 * O adaptador de socket da audiência do pedido.
 *
 * Quem recebe o quê é decisão de `orderAudience.ts`; aqui só se percorre a
 * lista e se emite. `except` vem no destinatário porque a sala compartilhada
 * `drivers` inclui o dono da corrida, que já recebeu a vista completa na sala
 * dele — sem descontar, ele receberia a redigida por cima e perderia o
 * endereço no meio da entrega.
 */
export function emitOrder(
  io: Server,
  shopId: ShopId,
  event: 'order:new' | 'order:updated',
  order: Order,
  ctx: OrderPushContext = {}
): void {
  for (const recipient of orderAudience(shopId, order)) {
    const target = recipient.except
      ? io.to(recipient.room).except(recipient.except)
      : io.to(recipient.room);
    target.emit(event, recipient.order);
  }

  // O push sai daqui dentro, não do call site. Enquanto fosse uma segunda
  // chamada em cada rota, uma rota nova ia emitir o socket e esquecer o push —
  // que é a mesma forma como a redação virou dois caminhos e um deles vazou
  // (ADR-0010). Um lugar só decide quem é avisado, dos dois jeitos.
  sendOrderPush(shopId, order, event, ctx);
}

/**
 * O que o pedido era ANTES do evento. A tabela de alertas precisa disso para
 * separar notícia de repetição: sem o status anterior, cada `order:updated`
 * pareceria uma mudança e o cliente receberia a mesma notificação de novo a
 * cada movimento do GPS do motoboy.
 */
export function orderEventContext(before: Order): OrderPushContext {
  return {
    previousStatus: before.status,
    hadPendingCancelRequest: before.cancellationRequest?.status === 'pendente',
    hadOpenComplaint: before.complaint?.status === 'aberta',
  };
}

