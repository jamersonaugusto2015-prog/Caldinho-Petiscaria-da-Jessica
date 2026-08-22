import { CANCEL_REQUEST_RESPONSE_MINUTES } from '../../../contract/constants';
import type { Order } from '../../../contract/order/types';
/** Minutos sem pagamento a partir dos quais um PIX é tratado como abandonado. */
export const ABANDONED_PIX_MINUTES = 30;

const MINUTE_MS = 60000;


export { PAYMENT_METHOD_LABEL } from '../../../contract/payment/payment';

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

export const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/** O servidor não tem timer: o prazo dos 5 minutos é sempre calculado na tela. */
export const cancelRequestDeadline = (requestedAt: string) =>
  new Date(requestedAt).getTime() + CANCEL_REQUEST_RESPONSE_MINUTES * MINUTE_MS;

export const hasPendingCancelRequest = (order: Order) =>
  order.cancellationRequest?.status === 'pendente';

export const isCancelRequestOverdue = (order: Order, now: number) =>
  !!order.cancellationRequest &&
  order.cancellationRequest.status === 'pendente' &&
  now > cancelRequestDeadline(order.cancellationRequest.requestedAt);

export const isOrderLate = (order: Order, now: number) =>
  order.status !== 'entregue' &&
  order.status !== 'cancelado' &&
  now > new Date(order.createdAt).getTime() + order.estimatedDeliveryMinutes * MINUTE_MS;

export const hasOpenComplaint = (order: Order) => order.complaint?.status === 'aberta';

export const owesRefund = (order: Order) => order.payment.refundStatus === 'pendente';

export const refundFailed = (order: Order) => order.payment.refundStatus === 'falhou';

export const isAbandonedPix = (order: Order, now: number) =>
  order.payment.method === 'pix' &&
  !order.payment.isPaid &&
  order.status !== 'entregue' &&
  order.status !== 'cancelado' &&
  now > new Date(order.createdAt).getTime() + ABANDONED_PIX_MINUTES * MINUTE_MS;

/** Texto do relógio regressivo: `2:07` enquanto há prazo, `há 3 min` depois dele. */
export const countdownLabel = (deadline: number, now: number) => {
  const remaining = deadline - now;
  if (remaining <= 0) {
    const lateMinutes = Math.floor(-remaining / MINUTE_MS);
    return lateMinutes < 1 ? 'agora' : `há ${lateMinutes} min`;
  }
  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export const pendingRefundTotal = (orders: Order[]) =>
  orders.reduce((sum, order) => sum + (owesRefund(order) ? order.total : 0), 0);
