import { COMPLAINT_WINDOW_HOURS, Driver, Order, OrderStatus, StoreSettings } from '../src/types';
import { isPickup } from '../src/shared/fulfillment';
import { handoverRecipient, isHandover, transitionProblem } from '../src/shared/orderFlow';
import { lastKnownPosition } from './driverLocation';
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
  | { type: 'move'; driverId: string; lat: number; lng: number; at: string };

export interface OrderLifecycleDeps {
  getSettings: () => StoreSettings;
  getDriver: (id: string) => Driver | null;
  earnStamp: (customerId: string) => number | null;
  saveOrder: (order: Order) => void;
}

export interface OrderLifecycleResult {
  order: Order;
  loyaltyPoints?: number;
}

/**
 * A corrida nasce marcada onde o motoboy está de verdade. A loja é só o último
 * recurso: semear sempre com ela deixava o motoboy parado na porta da loja no
 * mapa do cliente, mesmo quando o servidor já sabia a posição dele.
 *
 * A posição conhecida vem na frente do que já está no pedido. Semear é carimbar
 * um palpite, e um palpite não pode ganhar de um ponto de GPS real só por ter
 * chegado antes: entre aceitar a corrida e retirar o pedido na loja o motoboy
 * anda, e o carimbo da loja feito no aceite ficaria colado no pedido a viagem
 * inteira. Todo ponto de GPS grava nos dois lugares (`driverLocation`), então a
 * última posição conhecida nunca é mais velha do que a do pedido.
 */
function seedDriverPosition(order: Order, deps: OrderLifecycleDeps): void {
  const driver = order.driverId ? deps.getDriver(order.driverId) : null;
  const known = lastKnownPosition(driver);
  const settings = deps.getSettings();
  order.driverLat = known?.lat ?? order.driverLat ?? settings.storeLat;
  order.driverLng = known?.lng ?? order.driverLng ?? settings.storeLng;
  // O carimbo acompanha o ponto conhecido, ou some junto com ele. A coordenada
  // da loja é palpite, e um palpite carimbado como agora faria o mapa do cliente
  // jurar que o motoboy está na porta da loja neste instante — quando ninguém
  // sabe onde ele está. Sem carimbo, `locationFreshness` responde `unknown`, que
  // é a verdade.
  order.driverLocationAt = known ? driver?.locationAt : undefined;
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
    // Quem pode mover o pedido, e de onde para onde, é do `orderFlow`: servidor e
    // quadro da cozinha leem a mesma tabela. Aqui ficam só os efeitos.
    const problem = transitionProblem(order, event.status, event.actor, { driverId: event.driverId });
    if (problem) {
      // "Esta corrida não é sua" é 403; todo o resto é 400.
      throw new DomainError(problem.forbidden ? 403 : 400, problem.message);
    }

    // Lido antes de mexer no status: depois da atribuição o pedido já saiu de `pronto`.
    const despacho = isHandover(order, event.status) && handoverRecipient(order) === 'driver';

    order.status = event.status;
    if (despacho) {
      // Despacho feito pela cozinha (motoboy que não usa o app): não há ponto de
      // GPS por trás do pedido, então a posição antiga sai e é semeada de novo.
      if (event.actor !== 'driver') {
        order.driverLat = undefined;
        order.driverLng = undefined;
      }
      seedDriverPosition(order, deps);
    }
    // Sem esta marca, os ganhos do dia saem pela data de criação: um pedido feito
    // às 23h50 e entregue às 00h10 cai no dia errado.
    if (event.status === 'entregue') {
      order.deliveredAt = new Date().toISOString();
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
    // Aceitar a corrida não é sair para entrega: o motoboy ainda vai até a loja.
    // Quem move `pronto → saiu_entrega` é ele, ao retirar o pedido.
    seedDriverPosition(order, deps);
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
    order.driverLocationAt = event.at;
  }

  deps.saveOrder(order);
  return { order, loyaltyPoints };
}
