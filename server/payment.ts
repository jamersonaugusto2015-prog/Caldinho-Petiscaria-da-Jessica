import { Server } from 'socket.io';
import { Order, PaymentDetails, StoreSettings } from '../src/types';
import { getOrder, saveOrder } from './orderStore';
import { DomainError } from './errors';
import { emitOrder } from './orderEvents';
import type {
  CardPaymentInput,
  CardPaymentPatch,
  OrderPaymentAdapter,
  PixPaymentInput,
  PixPaymentPatch,
} from './orderIntake';
import {
  createCardCharge,
  createPixCharge,
  fetchPayment,
  isMercadoPagoConnected,
  refundPayment as refundMercadoPagoPayment,
} from './mercadopago';
import { generatePixCopyPaste } from './pix';

export async function collectPixPayment(opts: {
  orderId: string;
  amount: number;
  settings: StoreSettings;
  payerName: string;
  notificationUrl: string;
}): Promise<Pick<PaymentDetails, 'mpPaymentId' | 'pixCopyPaste' | 'pixQrCode' | 'mpTicketUrl'>> {
  const { orderId, amount, settings, payerName, notificationUrl } = opts;
  const payment: Pick<PaymentDetails, 'mpPaymentId' | 'pixCopyPaste' | 'pixQrCode' | 'mpTicketUrl'> = {};

  if (isMercadoPagoConnected()) {
    try {
      const charge = await createPixCharge({
        orderId,
        amount,
        description: `${settings.storeName} · Pedido ${orderId}`,
        payerName,
        notificationUrl,
      });
      payment.mpPaymentId = charge.paymentId;
      payment.pixCopyPaste = charge.qrCode;
      payment.pixQrCode = charge.qrCodeBase64;
      payment.mpTicketUrl = charge.ticketUrl;
    } catch (err) {
      if (!settings.pixKey) {
        const msg = err instanceof Error ? err.message : 'Falha ao gerar PIX no Mercado Pago.';
        throw new DomainError(400, msg);
      }
    }
  }

  if (!payment.pixCopyPaste && settings.pixKey) {
    payment.pixCopyPaste = generatePixCopyPaste({
      pixKey: settings.pixKey,
      amount,
      merchantName: settings.pixMerchantName,
      merchantCity: settings.pixMerchantCity,
      txid: orderId,
    });
  }

  if (!payment.pixCopyPaste) {
    throw new DomainError(
      400,
      'PIX indisponível. Conecte o Mercado Pago ou cadastre uma chave PIX na cozinha.'
    );
  }

  return payment;
}

/** Production adapter used by Order Intake. Tests can inject createFakePaymentAdapter instead. */
export const liveOrderPaymentAdapter: OrderPaymentAdapter = {
  collectPix: (input: PixPaymentInput): Promise<PixPaymentPatch> => collectPixPayment(input),
  isCardAvailable: () => isMercadoPagoConnected(),
  collectCard: (input: CardPaymentInput): Promise<CardPaymentPatch> => collectCardPayment(input),
};

export async function collectCardPayment(opts: {
  orderId: string;
  amount: number;
  settings: StoreSettings;
  cardToken: string;
  paymentMethodId: string;
  installments: number;
  issuerId?: string;
  payerEmail: string;
  identificationType: string;
  identificationNumber: string;
  notificationUrl: string;
}): Promise<{ mpPaymentId: string; cardBrand: string; isPaid: boolean }> {
  const { cardToken } = opts;
  if (typeof cardToken !== 'string' || !cardToken.trim()) {
    throw new DomainError(400, 'Preencha o cartão nesta tela. Não usamos a página do Mercado Pago.');
  }

  try {
    const charge = await createCardCharge({
      orderId: opts.orderId,
      amount: opts.amount,
      description: `${opts.settings.storeName} · Pedido ${opts.orderId}`,
      cardToken: cardToken.trim(),
      paymentMethodId: opts.paymentMethodId,
      installments: opts.installments,
      issuerId: opts.issuerId,
      payerEmail: opts.payerEmail,
      identificationType: opts.identificationType,
      identificationNumber: opts.identificationNumber,
      notificationUrl: opts.notificationUrl,
    });
    if (charge.status === 'rejected') {
      throw new DomainError(
        400,
        `Cartão recusado${charge.statusDetail ? ` (${charge.statusDetail})` : ''}. Tente outro cartão.`
      );
    }
    return {
      mpPaymentId: charge.paymentId,
      cardBrand: charge.paymentMethodId || String(opts.paymentMethodId || ''),
      isPaid: charge.status === 'approved',
    };
  } catch (err) {
    if (err instanceof DomainError) throw err;
    const msg = err instanceof Error ? err.message : 'Falha ao cobrar o cartão.';
    throw new DomainError(400, msg);
  }
}

export function markOrderPaid(io: Server, order: Order): Order {
  // Guarda única para o webhook, a consulta do PIX e a confirmação manual da
  // cozinha: num pedido cancelado o dinheiro chegaria sem pedido por trás.
  if (order.status === 'cancelado') {
    throw new DomainError(400, 'Este pedido foi cancelado. O pagamento não pode ser registrado.');
  }
  if (order.payment.isPaid) return order;
  order.payment.isPaid = true;
  saveOrder(order);
  emitOrder(io, 'order:updated', order);
  return order;
}

/**
 * Marca que a loja deve esse dinheiro ao cliente. Só escreve no objeto: quem
 * cancela grava o pedido uma vez só, depois de anexar os outros campos.
 * `payment.ts` continua sendo o único módulo que decide o estado de pagamento.
 */
export function markRefundDue(order: Order): Order {
  if (!order.payment.isPaid) return order;
  if (order.payment.refundStatus === 'devolvido' || order.payment.refundStatus === 'pendente') {
    return order;
  }
  order.payment.refundStatus = 'pendente';
  return order;
}

/**
 * Devolve o dinheiro de um pedido já pago. Mesma forma idempotente de
 * markOrderPaid: se já está 'devolvido', devolve o pedido sem repetir a chamada.
 * Uma falha do Mercado Pago grava 'falhou' + refundError e sobe um DomainError
 * 502 — nunca 'devolvido', porque o dinheiro não saiu.
 */
export async function refundPayment(
  io: Server,
  request: { orderId: string; by?: string }
): Promise<Order | null> {
  const order = getOrder(request.orderId);
  if (!order) return null;
  if (order.payment.refundStatus === 'devolvido') return order;
  // 'falhou' continua devendo: a tentativa anterior não tirou dinheiro nenhum,
  // então a cozinha precisa poder tentar de novo pelo mesmo botão.
  if (order.payment.refundStatus !== 'pendente' && order.payment.refundStatus !== 'falhou') {
    throw new DomainError(400, 'Este pedido não tem devolução pendente.');
  }

  const settle = (patch: Partial<PaymentDetails>): Order => {
    order.payment = { ...order.payment, ...patch };
    saveOrder(order);
    emitOrder(io, 'order:updated', order);
    return order;
  };

  // Dinheiro na entrega nunca passou pelo Mercado Pago: não há o que estornar
  // online, a devolução acontece no balcão e aqui só fica o registro.
  if (!order.payment.mpPaymentId) {
    return settle({
      refundStatus: 'devolvido',
      refundedAt: new Date().toISOString(),
      refundedBy: request.by,
      refundError: undefined,
    });
  }

  try {
    // Sem valor: o Mercado Pago devolve a cobrança inteira. Mandar o total daqui
    // viraria uma devolução parcial e um centavo de diferença seria recusado.
    const refund = await refundMercadoPagoPayment(order.payment.mpPaymentId);
    return settle({
      refundStatus: 'devolvido',
      refundedAt: new Date().toISOString(),
      refundedBy: request.by,
      mpRefundId: refund.refundId,
      refundError: undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao devolver o dinheiro.';
    settle({ refundStatus: 'falhou', refundError: message.slice(0, 300) });
    throw new DomainError(502, `${message} Tente devolver de novo.`);
  }
}

/**
 * Trust asymmetry: `mercadopago` settlements are verified against Mercado Pago's live API
 * below (fetchPayment + status === 'approved') before an order is marked paid. `kitchen`
 * settlements are trusted unconditionally — settlePayment has no way to check that money
 * actually changed hands for a cash/manual confirmation, it only records who claims it did.
 */
export type PaymentSettlement =
  | { source: 'mercadopago'; paymentId: string }
  | { source: 'kitchen'; orderId: string; confirmedBy?: string };

/** One settlement interface for kitchen confirmation, PIX polling and webhooks. */
export async function settlePayment(io: Server, request: PaymentSettlement): Promise<Order | null> {
  if (request.source === 'kitchen') {
    const order = getOrder(request.orderId);
    if (!order) return null;
    if (request.confirmedBy) {
      (order.payment as PaymentDetails & { confirmedBy?: string }).confirmedBy = request.confirmedBy;
    }
    return markOrderPaid(io, order);
  }
  const pay = await fetchPayment(request.paymentId);
  if (!pay || !pay.externalReference || pay.status !== 'approved') return null;
  const order = getOrder(pay.externalReference);
  if (!order) return null;
  return markOrderPaid(io, order);
}
