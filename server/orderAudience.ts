import { Order, OrderStatus } from '../src/types';
import { isPickup } from '../src/shared/fulfillment';
import { orderForDriver } from './orderViews';

/**
 * Quem precisa saber deste pedido — e nada sobre por onde o aviso viaja.
 *
 * `emitOrder` respondia as duas perguntas na mesma linha, dentro de uma chamada
 * do socket.io. O push nasceu precisando só da primeira: as mesmas quatro
 * pontas (cozinha, dono da corrida, pool, cliente), as mesmas vistas redigidas,
 * outro cano. Com a fan-out grudada no `io`, a única forma de ter isso era
 * copiar a função inteira — e a cópia é onde a regra do pool começa a discordar
 * de si mesma, porque ninguém lembra de arrumar as duas.
 *
 * Aqui a audiência é um valor: uma lista de destinatários, cada um com a sala
 * que o endereça e a vista que ele tem direito de ver. O socket é um adaptador
 * (`orderEvents.ts`), o push é outro (`push.ts`), e os dois leem daqui.
 *
 * A redação continua morando em `orderViews.ts` (ADR-0010): este módulo CHAMA
 * `orderForDriver`, nunca reimplementa o que ela tira. Se um transporte novo
 * aparecer, ele herda a redação sem saber que ela existe.
 */

export type AudienceRole = 'kitchen' | 'driver' | 'client';

export interface OrderRecipient {
  role: AudienceRole;
  /** Sala socket.io — e a mesma chave que endereça as inscrições de push. */
  room: string;
  /**
   * Sala a descontar de `room`. Só o pool usa: o dono da corrida já recebeu a
   * vista completa na sala dele e não pode receber a redigida por cima.
   */
  except?: string;
  /** O motoboy dono da corrida, quando o destinatário é um só. */
  driverId?: string;
  customerId?: string;
  /** A vista que ESTE destinatário tem direito de ver. */
  order: Order;
}

/**
 * Status que a lista do motoboy acompanha. Fora deles o pedido não aparece em
 * tela nenhuma do app do motoboy, então o evento não tem para onde ir.
 */
export const DRIVER_LIST_STATUSES: OrderStatus[] = [
  'pronto',
  'saiu_entrega',
  'entregue',
  'cancelado',
];

export function orderAudience(order: Order): OrderRecipient[] {
  const recipients: OrderRecipient[] = [];

  // A cozinha vê o pedido inteiro: é ela quem cobra, atende e devolve dinheiro.
  recipients.push({ role: 'kitchen', room: 'kitchen', order });

  if (order.driverId) {
    recipients.push({
      role: 'driver',
      room: `driver:${order.driverId}`,
      driverId: order.driverId,
      order: orderForDriver(order, order.driverId),
    });
  }

  // O pool precisa do evento tendo dono ou não: sem ele, um pedido que a cozinha
  // levou de `pronto` a `saiu_entrega` sozinha some da cozinha e continua listado
  // como corrida disponível na tela de todo mundo até um refetch.
  if (!isPickup(order) && DRIVER_LIST_STATUSES.includes(order.status)) {
    // Vai redigido mesmo com a corrida aberta: o motoboy decide pelo bairro, pela
    // distância e pela taxa — que a redação preserva de propósito —, nunca pelo
    // nome, telefone ou rua do cliente, que são só do dono da corrida.
    recipients.push({
      role: 'driver',
      room: 'drivers',
      except: order.driverId ? `driver:${order.driverId}` : undefined,
      order: orderForDriver(order, null),
    });
  }

  // `anon` é o dispositivo que nunca se identificou: não há sala para ele, e
  // uma sala chamada `customer:anon` juntaria estranhos no mesmo canal.
  if (order.customerId && order.customerId !== 'anon') {
    recipients.push({
      role: 'client',
      room: `customer:${order.customerId}`,
      customerId: order.customerId,
      order,
    });
  }

  return recipients;
}
