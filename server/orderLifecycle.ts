import { COMPLAINT_WINDOW_HOURS, Order, OrderStatus, StoreSettings } from '../src/types';
import { STATUS_ORDER } from '../src/shared/constants';
import { isPickup } from '../src/shared/fulfillment';
import { DomainError } from './errors';

/** Textos escritos pelo cliente aparecem inteiros na tela da cozinha e vice-versa. */
export const CANCEL_TEXT_MAX = 300;
export const COMPLAINT_TEXT_MAX = 500;

/** Status em que o pedido já saiu das mãos do cliente, mas ainda dá para desfazer. */
const CANCEL_REQUEST_STATUSES: OrderStatus[] = ['em_preparo', 'pronto', 'saiu_entrega'];

export type OrderLifecycleEvent =
  | {
      type: 'advance';
      status: OrderStatus;
      actor: 'kitchen' | 'driver';
      driverId?: string;
    }
  | { type: 'assign'; driverId: string }
  | { type: 'cancel'; reason: string }
  | { type: 'request-cancel'; reason: string }
  | { type: 'resolve-cancel'; accept: boolean; note?: string }
  | { type: 'complain'; text: string }
  | { type: 'resolve-complaint' }
  | { type: 'rate'; rating: number; comment?: string }
  | { type: 'move'; driverId: string; lat: number; lng: number };

export interface OrderLifecycleDeps {
  getSettings: () => StoreSettings;
  getDriver: (id: string) => { id: string; name: string; phone?: string; active: boolean } | null;
  earnStamp: (customerId: string) => number | null;
  saveOrder: (order: Order) => void;
}

export interface OrderLifecycleResult {
  order: Order;
  loyaltyPoints?: number;
}

/**
 * The single place where an order's mutable lifecycle is changed.
 * HTTP and socket handlers remain adapters: they authenticate and translate
 * requests into one of these events, then persist/emit the result.
 */
export function applyOrderEvent(
  current: Order,
  event: OrderLifecycleEvent,
  deps: OrderLifecycleDeps
): OrderLifecycleResult {
  const order: Order = {
    ...current,
    payment: { ...current.payment },
  };
  let loyaltyPoints: number | undefined;

  if (event.type === 'advance') {
    if (!STATUS_ORDER.includes(event.status)) {
      throw new DomainError(400, 'Status inválido.');
    }
    if (event.status === 'cancelado') {
      throw new DomainError(400, 'Use a rota de cancelamento para cancelar o pedido.');
    }
    // Retirada não passa por motoboy: de `pronto` o pedido vai direto para `entregue`.
    if (event.status === 'saiu_entrega' && isPickup(order)) {
      throw new DomainError(400, 'Pedido de retirada na loja não sai para entrega.');
    }
    if (event.actor === 'driver') {
      if (event.status !== 'entregue' || order.status !== 'saiu_entrega') {
        throw new DomainError(400, 'Ação não permitida para o entregador.');
      }
      if (!event.driverId || order.driverId !== event.driverId) {
        throw new DomainError(403, 'Esta corrida não está atribuída a você.');
      }
    }
    if (STATUS_ORDER.indexOf(event.status) <= STATUS_ORDER.indexOf(order.status)) {
      throw new DomainError(400, 'Transição de status inválida.');
    }

    order.status = event.status;
    if (event.status === 'saiu_entrega' && event.actor !== 'driver') {
      order.driverLat = undefined;
      order.driverLng = undefined;
    }
    if (event.status === 'saiu_entrega') {
      const settings = deps.getSettings();
      order.driverLat = order.driverLat ?? settings.storeLat;
      order.driverLng = order.driverLng ?? settings.storeLng;
    }
    if (event.status === 'entregue' && order.customerId && order.customerId !== 'anon') {
      order.loyaltyPointsEarned = 1;
      loyaltyPoints = deps.earnStamp(order.customerId) ?? undefined;
    }
  }

  if (event.type === 'assign') {
    if (isPickup(order)) {
      throw new DomainError(400, 'Pedido de retirada na loja não tem corrida.');
    }
    const driver = deps.getDriver(event.driverId);
    if (!driver || !driver.active) {
      throw new DomainError(403, 'Motoboy não encontrado.');
    }
    if (order.driverId && order.driverId !== event.driverId) {
      throw new DomainError(403, 'Esta corrida já foi aceita por outro entregador.');
    }
    if (order.status !== 'pronto' && order.status !== 'saiu_entrega') {
      throw new DomainError(400, 'A corrida ainda não está disponível.');
    }
    order.driverId = driver.id;
    order.driverName = driver.name;
    order.driverPhone = driver.phone || '';
    if (order.status === 'pronto') {
      order.status = 'saiu_entrega';
      const settings = deps.getSettings();
      order.driverLat = order.driverLat ?? settings.storeLat;
      order.driverLng = order.driverLng ?? settings.storeLng;
    }
  }

  if (event.type === 'cancel') {
    if (order.status === 'entregue' || order.status === 'cancelado') {
      throw new DomainError(400, 'Este pedido não pode mais ser cancelado.');
    }
    order.status = 'cancelado';
    order.cancellationReason = event.reason.trim().slice(0, CANCEL_TEXT_MAX) || 'Pedido cancelado';
  }

  if (event.type === 'request-cancel') {
    if (!CANCEL_REQUEST_STATUSES.includes(order.status)) {
      throw new DomainError(400, 'Este pedido não aceita mais um pedido de cancelamento.');
    }
    if (order.cancellationRequest?.status === 'pendente') {
      throw new DomainError(400, 'Já existe um pedido de cancelamento aguardando resposta.');
    }
    const reason = event.reason.trim().slice(0, CANCEL_TEXT_MAX);
    if (!reason) {
      throw new DomainError(400, 'Diga o motivo do cancelamento.');
    }
    order.cancellationRequest = {
      reason,
      requestedAt: new Date().toISOString(),
      status: 'pendente',
    };
  }

  if (event.type === 'resolve-cancel') {
    const pending = order.cancellationRequest;
    if (!pending || pending.status !== 'pendente') {
      throw new DomainError(400, 'Não há pedido de cancelamento aguardando resposta.');
    }
    const note = (event.note ?? '').trim().slice(0, CANCEL_TEXT_MAX);
    if (!event.accept && !note) {
      throw new DomainError(400, 'Explique ao cliente por que o cancelamento foi recusado.');
    }
    // O cancelamento em si é do cancellation.ts: aqui só fica a resposta da loja.
    order.cancellationRequest = {
      ...pending,
      status: event.accept ? 'aceito' : 'recusado',
      respondedAt: new Date().toISOString(),
      responseNote: note || undefined,
    };
  }

  if (event.type === 'complain') {
    if (order.status !== 'entregue') {
      throw new DomainError(400, 'A reclamação só pode ser aberta depois da entrega.');
    }
    if (order.complaint) {
      throw new DomainError(400, 'Este pedido já tem uma reclamação aberta.');
    }
    const deadline = new Date(order.createdAt).getTime() + COMPLAINT_WINDOW_HOURS * 3600 * 1000;
    if (!Number.isFinite(deadline) || Date.now() > deadline) {
      throw new DomainError(400, `O prazo de ${COMPLAINT_WINDOW_HOURS} horas para reclamar já passou.`);
    }
    const text = event.text.trim().slice(0, COMPLAINT_TEXT_MAX);
    if (!text) {
      throw new DomainError(400, 'Conte o que aconteceu com o pedido.');
    }
    order.complaint = {
      text,
      openedAt: new Date().toISOString(),
      status: 'aberta',
    };
  }

  if (event.type === 'resolve-complaint') {
    if (!order.complaint) {
      throw new DomainError(400, 'Este pedido não tem reclamação aberta.');
    }
    if (order.complaint.status === 'resolvida') {
      throw new DomainError(400, 'Esta reclamação já foi resolvida.');
    }
    order.complaint = {
      ...order.complaint,
      status: 'resolvida',
      resolvedAt: new Date().toISOString(),
    };
  }

  if (event.type === 'rate') {
    if (order.status === 'cancelado') {
      throw new DomainError(400, 'Um pedido cancelado não pode ser avaliado.');
    }
    if (!Number.isFinite(event.rating) || event.rating < 1 || event.rating > 5) {
      throw new DomainError(400, 'Avaliação inválida.');
    }
    order.rating = event.rating;
    order.ratingComment = event.comment?.slice(0, 300);
  }

  if (event.type === 'move') {
    if (order.status !== 'saiu_entrega' || order.driverId !== event.driverId) {
      throw new DomainError(400, 'A localização não pertence a esta corrida.');
    }
    order.driverLat = event.lat;
    order.driverLng = event.lng;
  }

  deps.saveOrder(order);
  return { order, loyaltyPoints };
}
