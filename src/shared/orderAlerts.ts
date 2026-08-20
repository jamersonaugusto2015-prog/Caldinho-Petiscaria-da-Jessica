import { ChatMessage, Order, OrderStatus } from '../types';
import { isPickup } from './fulfillment';
import { statusMessageFor } from './constants';

/**
 * Quem precisa saber, e quão alto.
 *
 * A pergunta "chegou um evento do pedido — algum humano precisa saber disso?"
 * era respondida três vezes, de três jeitos: a cozinha com som, voz e piscada;
 * o motoboy com um toast mudo; o cliente com confete. Três cópias da mesma
 * ideia, livres para discordar — e discordavam, porque ninguém escreveu a regra
 * em lugar nenhum: cada loja de estado deduzia a sua na hora.
 *
 * Esta é a tabela. Ela decide o *conteúdo* e a *intensidade* do alerta e nada
 * mais: não toca som, não vibra, não desenha nada. Quem entrega é o canal
 * (`src/lib/alertChannel.ts` no navegador, o push no servidor), e os dois leem
 * daqui — então a notificação que chega com o app fechado diz exatamente o que
 * o banner diria com o app aberto.
 *
 * Puro de propósito: roda no `tsx --test`, sem DOM e sem React, do mesmo jeito
 * que `orderFlow.ts`.
 */

export type AlertRole = 'kitchen' | 'driver' | 'client';

/**
 * Quanto o alerta pode incomodar.
 *
 * - `silent`  — aparece na tela, não faz barulho.
 * - `notice`  — merece um toque: vibra curto e vale uma notificação do sistema.
 * - `demand`  — alguém precisa largar o que está fazendo: som, vibração longa,
 *               repetição. É o novo pedido na cozinha e a corrida oferecida ao
 *               motoboy — os dois eventos em que o dinheiro está parado esperando.
 */
export type AlertUrgency = 'silent' | 'notice' | 'demand';

export interface AlertChannels {
  /** Faixa dentro do app. Sempre ligada: o alerta tem que existir na tela. */
  banner: boolean;
  sound: boolean;
  /** Locução pt-BR. Só onde a pessoa está de mãos ocupadas (a cozinha). */
  voice: boolean;
  /** Padrão para `navigator.vibrate`, ou `null` quando não vibra. */
  vibrate: number[] | null;
  /** Notificação do sistema — a única que atravessa o app fechado. */
  system: boolean;
  /** Quantas vezes o som se repete. 1 = toca uma vez. */
  repeat: number;
}

export interface OrderAlert {
  /**
   * Chave de deduplicação. O mesmo alerta chegando duas vezes — reconexão,
   * `order:updated` repetido, duas abas — não toca duas vezes.
   */
  key: string;
  role: AlertRole;
  title: string;
  body: string;
  urgency: AlertUrgency;
  channels: AlertChannels;
  /** Agrupa a notificação do sistema: a nova substitui a anterior do mesmo pedido. */
  tag: string;
  /** Para onde o toque na notificação leva. */
  href: string;
  /** Pedido que o alerta descreve, quando existe um. */
  orderId?: string;
  /** Confete: comemoração, não urgência. Só o cliente tem. */
  celebrate?: boolean;
}

export interface AlertContext {
  /** Status conhecido antes deste evento. Ausente = primeira vez que vemos o pedido. */
  previousStatus?: OrderStatus;
  /** Motoboy autenticado. Obrigatório para o papel `driver`. */
  driverId?: string;
  /** Já havia pedido de cancelamento pendente antes deste evento? */
  hadPendingCancelRequest?: boolean;
  /** A reclamação já estava aberta antes deste evento? */
  hadOpenComplaint?: boolean;
}

export type OrderAlertEvent = 'order:new' | 'order:updated';

// ---------------------------------------------------------------------------
// A escala
// ---------------------------------------------------------------------------

const SILENT: AlertChannels = { banner: true, sound: false, voice: false, vibrate: null, system: false, repeat: 1 };
const NOTICE: AlertChannels = { banner: true, sound: false, voice: false, vibrate: [45], system: true, repeat: 1 };
const DEMAND: AlertChannels = {
  banner: true,
  sound: true,
  voice: false,
  vibrate: [0, 160, 90, 160, 90, 320],
  system: true,
  repeat: 2,
};

export const URGENCY_CHANNELS: Record<AlertUrgency, AlertChannels> = {
  silent: SILENT,
  notice: NOTICE,
  demand: DEMAND,
};

function channelsFor(urgency: AlertUrgency, overrides?: Partial<AlertChannels>): AlertChannels {
  return { ...URGENCY_CHANNELS[urgency], ...overrides };
}

const HOME: Record<AlertRole, string> = {
  kitchen: '/cozinha',
  driver: '/entregador',
  client: '/',
};

interface AlertDraft {
  key: string;
  title: string;
  body: string;
  urgency: AlertUrgency;
  channels?: Partial<AlertChannels>;
  tag?: string;
  celebrate?: boolean;
}

function build(role: AlertRole, orderId: string | undefined, draft: AlertDraft): OrderAlert {
  return {
    key: draft.key,
    role,
    title: draft.title,
    body: draft.body,
    urgency: draft.urgency,
    channels: channelsFor(draft.urgency, draft.channels),
    tag: draft.tag ?? (orderId ? `${role}:${orderId}` : `${role}:geral`),
    href: HOME[role],
    orderId,
    celebrate: draft.celebrate,
  };
}

function money(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function itemCount(order: Order): number {
  return order.items.reduce((sum, item) => sum + (item.quantity ?? 1), 0);
}

const pendingCancelRequest = (order: Order): boolean => order.cancellationRequest?.status === 'pendente';
const openComplaint = (order: Order): boolean => order.complaint?.status === 'aberta';

/** A corrida está no balcão, sem dono, esperando alguém aceitar. */
export function isRideOffered(order: Order): boolean {
  return order.status === 'pronto' && !order.driverId && !isPickup(order);
}

// ---------------------------------------------------------------------------
// Cozinha
// ---------------------------------------------------------------------------

function kitchenAlert(event: OrderAlertEvent, order: Order, ctx: AlertContext): OrderAlert | null {
  if (event === 'order:new') {
    // O pedido novo é o único evento do app que vale acordar alguém do outro
    // lado da loja: tem dinheiro parado e um relógio correndo.
    return build('kitchen', order.id, {
      key: `kitchen:new:${order.id}`,
      title: `Novo pedido ${order.id}`,
      body: `${order.customerName} · ${itemCount(order)} ${itemCount(order) === 1 ? 'item' : 'itens'} · ${money(order.total)}`,
      urgency: 'demand',
      channels: { voice: true },
    });
  }

  // O cliente pediu para cancelar e a cozinha tem cinco minutos para responder.
  // Perder este é perder o prazo, então ele grita igual ao pedido novo.
  if (pendingCancelRequest(order) && !ctx.hadPendingCancelRequest) {
    return build('kitchen', order.id, {
      key: `kitchen:cancel-request:${order.id}`,
      title: `Cancelamento pedido — ${order.id}`,
      body: order.cancellationRequest?.reason?.trim() || 'O cliente pediu para cancelar. Responda em 5 minutos.',
      urgency: 'demand',
      tag: `kitchen:cancel:${order.id}`,
    });
  }

  if (openComplaint(order) && !ctx.hadOpenComplaint) {
    return build('kitchen', order.id, {
      key: `kitchen:complaint:${order.id}`,
      title: `Reclamação no pedido ${order.id}`,
      body: order.complaint?.text?.trim() || 'O cliente abriu uma reclamação.',
      urgency: 'notice',
      tag: `kitchen:complaint:${order.id}`,
    });
  }

  return null;
}

// ---------------------------------------------------------------------------
// Motoboy
// ---------------------------------------------------------------------------

function driverAlert(order: Order, ctx: AlertContext): OrderAlert | null {
  const mine = Boolean(ctx.driverId) && order.driverId === ctx.driverId;

  if (isRideOffered(order)) {
    // Vale para `order:new` e para `order:updated`: a corrida entra no balcão
    // quando a cozinha marca pronto, que é um update, não um pedido novo.
    // A chave prende no pedido, não no evento, para os dois não tocarem em par.
    return build('driver', order.id, {
      key: `driver:offer:${order.id}`,
      title: 'Nova corrida disponível',
      body: `${order.address?.neighborhood || 'Bairro não informado'} · ${order.distanceKm.toFixed(1)} km · ${money(order.deliveryFee)}`,
      urgency: 'demand',
      tag: `driver:offer:${order.id}`,
    });
  }

  if (!mine) return null;

  if (order.status === 'cancelado' && ctx.previousStatus !== 'cancelado') {
    return build('driver', order.id, {
      key: `driver:cancelled:${order.id}`,
      title: `Corrida ${order.id} cancelada`,
      body: order.cancelledBy === 'cliente' ? 'O cliente cancelou o pedido.' : 'A loja cancelou o pedido.',
      urgency: 'demand',
    });
  }

  if (order.status === 'entregue' && ctx.previousStatus !== 'entregue') {
    return build('driver', order.id, {
      key: `driver:done:${order.id}`,
      title: `Corrida ${order.id} concluída`,
      body: `Taxa: ${money(order.deliveryFee)}`,
      urgency: 'notice',
    });
  }

  return null;
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

function clientAlert(event: OrderAlertEvent, order: Order, ctx: AlertContext): OrderAlert | null {
  // O pedido acabou de ser feito por ele, na tela dele. Avisar seria eco.
  if (event === 'order:new') return null;

  const answered = order.cancellationRequest?.status;
  if (answered === 'recusado' || answered === 'aceito') {
    // A loja respondeu o pedido de cancelamento. O cliente está esperando esta
    // resposta — e no caso de recusa ela vem com um motivo que ele precisa ler.
    const accepted = answered === 'aceito';
    if (ctx.hadPendingCancelRequest) {
      return build('client', order.id, {
        key: `client:cancel-answer:${order.id}:${answered}`,
        title: accepted ? 'Cancelamento aceito' : 'Cancelamento recusado',
        body: accepted
          ? `O pedido ${order.id} foi cancelado. O estorno entra na fila.`
          : order.cancellationRequest?.responseNote?.trim() || 'A loja recusou o cancelamento.',
        urgency: 'demand',
        tag: `client:cancel:${order.id}`,
      });
    }
  }

  if (!ctx.previousStatus || ctx.previousStatus === order.status) return null;

  const delivered = order.status === 'entregue';
  return build('client', order.id, {
    key: `client:status:${order.id}:${order.status}`,
    title: `Pedido ${order.id}`,
    body: statusMessageFor(order.status, order.fulfillment, Boolean(order.driverId)),
    // Sair para entrega é a hora de estar perto da porta; entregue e cancelado
    // encerram a espera. Os degraus do meio não valem interromper ninguém.
    urgency:
      order.status === 'saiu_entrega' || order.status === 'cancelado' || delivered ? 'notice' : 'silent',
    celebrate: delivered,
  });
}

// ---------------------------------------------------------------------------
// A porta de entrada
// ---------------------------------------------------------------------------

/**
 * O alerta que este papel merece por este evento, ou `null` quando o evento não
 * é da conta dele. `null` é uma resposta legítima e a mais comum: a maior parte
 * dos eventos do socket é sincronização de estado, não notícia.
 */
export function orderAlertFor(
  role: AlertRole,
  event: OrderAlertEvent,
  order: Order,
  ctx: AlertContext = {}
): OrderAlert | null {
  if (role === 'kitchen') return kitchenAlert(event, order, ctx);
  if (role === 'driver') return driverAlert(order, ctx);
  return clientAlert(event, order, ctx);
}

/** Mensagem no chat do pedido. O próprio eco de quem enviou nunca alerta. */
export function chatAlertFor(role: AlertRole, message: ChatMessage): OrderAlert | null {
  const from = message.sender;
  if (role === 'kitchen' && from === 'store') return null;
  if (role === 'client' && from === 'client') return null;
  if (role === 'driver') return null;

  const who = from === 'client' ? 'O cliente' : 'A loja';
  return build(role, message.orderId, {
    key: `${role}:chat:${message.id}`,
    title: `Mensagem no pedido ${message.orderId}`,
    body: `${who}: ${message.text.trim().slice(0, 120)}`,
    urgency: 'notice',
    tag: `${role}:chat:${message.orderId}`,
  });
}
