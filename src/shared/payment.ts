import { Fulfillment, PaymentDetails, PaymentMethod, PaymentTiming } from '../types';

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: 'PIX',
  card: 'Cartão',
  cash: 'Dinheiro',
};

/**
 * Dinheiro nunca é cobrado antes; PIX hoje só roda online. O cartão é o único
 * método que o cliente escolhe: pagar agora no site ou na maquininha do motoboy.
 */
export function allowedTimings(method: PaymentMethod): PaymentTiming[] {
  if (method === 'cash') return ['delivery'];
  if (method === 'pix') return ['online'];
  return ['online', 'delivery'];
}

/** Pedido antigo não tem o campo: dinheiro sempre foi na entrega, o resto era online. */
export function normalizePaymentTiming(method: PaymentMethod, value: unknown): PaymentTiming {
  const allowed = allowedTimings(method);
  if (value === 'online' || value === 'delivery') {
    if (allowed.includes(value)) return value;
  }
  return allowed[0];
}

/** Só o pagamento online passa pelo Mercado Pago na hora de criar o pedido. */
export function requiresOnlineCharge(method: PaymentMethod, timing: PaymentTiming): boolean {
  return timing === 'online' && method !== 'cash';
}

export function paymentTiming(payment: Pick<PaymentDetails, 'method' | 'timing'>): PaymentTiming {
  return normalizePaymentTiming(payment.method, payment.timing);
}

export function isPaidOnDelivery(payment: Pick<PaymentDetails, 'method' | 'timing'>): boolean {
  return paymentTiming(payment) === 'delivery';
}

/** O motoboy precisa levar a maquininha nesse caso. */
export function needsCardMachine(payment: Pick<PaymentDetails, 'method' | 'timing'>): boolean {
  return payment.method === 'card' && isPaidOnDelivery(payment);
}

/** "na entrega" vira "na retirada" quando o cliente busca o pedido na loja. */
export function timingLabel(
  payment: Pick<PaymentDetails, 'method' | 'timing'>,
  fulfillment?: Fulfillment
): string {
  if (!isPaidOnDelivery(payment)) return 'online';
  return fulfillment === 'pickup' ? 'na retirada' : 'na entrega';
}

/** Rótulo curto e completo: "Cartão na entrega", "PIX online", "Dinheiro na retirada". */
export function paymentLabel(
  payment: Pick<PaymentDetails, 'method' | 'timing'>,
  fulfillment?: Fulfillment
): string {
  return `${PAYMENT_METHOD_LABEL[payment.method]} ${timingLabel(payment, fulfillment)}`;
}
