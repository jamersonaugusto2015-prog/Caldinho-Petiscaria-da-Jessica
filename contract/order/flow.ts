import type { Order, OrderStatus } from './types';
import { isPickup } from './fulfillment';

/**
 * Quem pode mover o pedido, de onde para onde.
 *
 * Esta regra vivia espalhada em cinco lugares: a comparação de índice em
 * `orderLifecycle`, a guarda de retirada, o ramo do motoboy, e o `NEXT_STATUS`
 * mais o `canDropIn` do quadro da cozinha. Cinco cópias da mesma ideia, livres
 * para discordar — e discordavam: o quadro oferecia "Saiu para entrega" no
 * botão enquanto o arrastar deixava pular direto para "Entregue".
 *
 * Servidor e cozinha leem daqui. O servidor continua sendo quem decide; o
 * quadro usa as mesmas funções só para não oferecer o que será recusado.
 */

export type FlowActor = 'kitchen' | 'driver';

/** Quem recebe o pedido no balcão da loja. */
export type HandoverRecipient = 'driver' | 'customer';

const DELIVERY_FLOW: OrderStatus[] = ['recebido', 'em_preparo', 'pronto', 'saiu_entrega', 'entregue'];
const PICKUP_FLOW: OrderStatus[] = ['recebido', 'em_preparo', 'pronto', 'entregue'];

export const CLOSED_STATUSES: OrderStatus[] = ['entregue', 'cancelado'];

export function statusFlow(order: Pick<Order, 'fulfillment'>): OrderStatus[] {
  return isPickup(order) ? PICKUP_FLOW : DELIVERY_FLOW;
}

export function isClosed(status: OrderStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

/**
 * A passagem de balcão: o pedido sai da mão da cozinha.
 *
 * É um gesto só com dois destinos. Na entrega o motoboy leva e o pedido segue
 * vivo; na retirada o cliente leva e o pedido acaba ali. Nomear os dois como a
 * mesma coisa é o que impede a regra de se partir em duas de novo.
 *
 * Os dois destinos têm verbos diferentes de propósito, os mesmos que o mercado
 * brasileiro usa: o pedido é **despachado** quando sai com o motoboy e
 * **retirado** quando o cliente leva. Enquanto "retirar" servia para os dois, a
 * mesma palavra na tela da cozinha queria dizer duas coisas.
 */
export function handoverRecipient(order: Pick<Order, 'fulfillment'>): HandoverRecipient {
  return isPickup(order) ? 'customer' : 'driver';
}

export function handoverStep(order: Pick<Order, 'fulfillment'>): { from: OrderStatus; to: OrderStatus } {
  return { from: 'pronto', to: isPickup(order) ? 'entregue' : 'saiu_entrega' };
}

export function isHandover(order: Pick<Order, 'fulfillment' | 'status'>, to: OrderStatus): boolean {
  const step = handoverStep(order);
  return order.status === step.from && to === step.to;
}

export function nextStatus(order: Pick<Order, 'fulfillment' | 'status'>): OrderStatus | null {
  const flow = statusFlow(order);
  const index = flow.indexOf(order.status);
  if (index < 0) return null;
  return flow[index + 1] ?? null;
}

const ACTION_LABEL: Record<OrderStatus, string> = {
  recebido: 'Aceitar pedido',
  em_preparo: 'Marcar pronto',
  pronto: 'Pronto',
  saiu_entrega: 'Saiu para entrega',
  entregue: 'Marcar entregue',
  cancelado: 'Cancelar',
};

/** Rótulo do botão que avança o pedido, do ponto de vista da cozinha. */
export function actionLabel(order: Pick<Order, 'fulfillment' | 'status' | 'driverId'>): string | null {
  const to = nextStatus(order);
  if (!to) return null;
  if (isHandover(order, to)) {
    // Verbos separados: despachar (sai com o motoboy) x retirar (o cliente leva).
    return handoverRecipient(order) === 'customer' ? 'Cliente retirou' : 'Pedido despachado';
  }
  if (to === 'em_preparo') return ACTION_LABEL.recebido;
  if (to === 'pronto') return isPickup(order) ? 'Pronto para retirar' : 'Marcar pronto';
  if (to === 'entregue') return 'Marcar entregue';
  return ACTION_LABEL[to];
}

export interface TransitionOptions {
  /** Motoboy autenticado, quando quem age é o app do entregador. */
  driverId?: string;
}

export interface TransitionProblem {
  /** Chega ao usuário como está: uma frase, em português. */
  message: string;
  /**
   * A transição existe, mas não é de quem pediu — outro motoboy é o dono da
   * corrida. Separado do resto porque "não pode" e "não é seu" são respostas
   * diferentes para quem chama.
   */
  forbidden?: boolean;
}

const problem = (message: string, forbidden = false): TransitionProblem => ({ message, forbidden });

/** Devolve o motivo pelo qual a transição não pode acontecer, ou `null` se pode. */
export function transitionProblem(
  order: Pick<Order, 'fulfillment' | 'status' | 'driverId'>,
  to: OrderStatus,
  actor: FlowActor,
  options: TransitionOptions = {}
): TransitionProblem | null {
  if (to === 'cancelado') return problem('Use a rota de cancelamento para cancelar o pedido.');
  if (isClosed(order.status)) return problem('Este pedido já foi encerrado.');

  const flow = statusFlow(order);
  if (!flow.includes(to)) {
    return isPickup(order) && to === 'saiu_entrega'
      ? problem('Pedido de retirada na loja não sai para entrega.')
      : problem('Este status não existe para este pedido.');
  }

  const from = flow.indexOf(order.status);
  const target = flow.indexOf(to);
  if (from < 0) return problem('Este status não existe para este pedido.');
  if (target <= from) return problem('Este pedido já passou dessa etapa.');

  // A passagem de balcão é um portão, não um degrau que dá para pular. Sem ela
  // um pedido de entrega era marcado como entregue sem nunca ter saído da loja
  // — e o motoboy atribuído recebia a taxa de uma corrida que não fez.
  const step = handoverStep(order);
  const handoverIndex = flow.indexOf(step.to);
  if (target > handoverIndex && from < handoverIndex) {
    return problem('O pedido precisa passar pelo balcão antes de ser concluído.');
  }

  if (actor === 'driver') {
    const allowed = isHandover(order, to) || (order.status === 'saiu_entrega' && to === 'entregue');
    if (!allowed) return problem('Ação não permitida para o entregador.');
    if (isPickup(order)) return problem('Pedido de retirada na loja não tem corrida.');
    if (!options.driverId || order.driverId !== options.driverId) {
      return problem('Esta corrida não está atribuída a você.', true);
    }
  }

  return null;
}

export function canTransition(
  order: Pick<Order, 'fulfillment' | 'status' | 'driverId'>,
  to: OrderStatus,
  actor: FlowActor,
  options: TransitionOptions = {}
): boolean {
  return transitionProblem(order, to, actor, options) === null;
}
