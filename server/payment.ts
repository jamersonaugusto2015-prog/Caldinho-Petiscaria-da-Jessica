import { Server } from 'socket.io';
import type { Order, PaymentDetails } from '../contract/order/types';
import type { StoreSettings } from '../contract/shop/types';
import { getOrder, saveOrder, shopIdOfOrder } from './orderStore';
import type { ShopId } from '../contract/shop/types';
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
import { generatePixCopyPaste, generatePixQrCodeBase64 } from './pix';
import { usesLocalPix } from '../contract/payment/pix';
export async function collectPixPayment(opts: {
  /** A loja que RECEBE. Sem ela a cobrança do PIX cai na conta errada. */
  shopId: ShopId;
  orderId: string;
  amount: number;
  settings: StoreSettings;
  payerName: string;
  notificationUrl: string;
}): Promise<Pick<PaymentDetails, 'mpPaymentId' | 'pixCopyPaste' | 'pixQrCode' | 'mpTicketUrl'>> {
  const { shopId, orderId, amount, settings, payerName, notificationUrl } = opts;
  const payment: Pick<PaymentDetails, 'mpPaymentId' | 'pixCopyPaste' | 'pixQrCode' | 'mpTicketUrl'> = {};
  // A loja escolhe nas configurações quem cobra o PIX. Em 'local' o Mercado
  // Pago não é chamado nem como reserva: o dono desligou de propósito, e cair
  // no Mercado Pago escondido mandaria o dinheiro para a conta errada.
  const local = usesLocalPix(settings.pixProvider);

  if (!local && isMercadoPagoConnected(shopId)) {
    try {
      const charge = await createPixCharge({
        shopId,
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
      local
        ? 'PIX indisponível. Cadastre a chave PIX da loja nas configurações da cozinha.'
        : 'PIX indisponível. Conecte o Mercado Pago ou cadastre uma chave PIX na cozinha.'
    );
  }

  // Cobrança da chave da loja não vem com imagem pronta: desenhamos o QR Code
  // do mesmo copia e cola para o cliente apontar a câmera do banco.
  if (!payment.pixQrCode) {
    payment.pixQrCode = await generatePixQrCodeBase64(payment.pixCopyPaste);
  }

  return payment;
}

/**
 * O adaptador de cobrança de UMA loja.
 *
 * Virou fábrica na Fase 7: antes era uma constante, e uma constante não tem
 * como saber de quem é o dinheiro. Com duas lojas, a segunda cobraria na conta
 * da primeira — o pedido fecharia, o cliente pagaria, e o dinheiro entraria na
 * conta errada sem nenhum erro em lugar nenhum.
 *
 * `server/domain/deps.ts` é quem amarra a loja.
 */
export function liveOrderPaymentAdapter(shopId: ShopId): OrderPaymentAdapter {
  return {
    collectPix: (input: PixPaymentInput): Promise<PixPaymentPatch> =>
      collectPixPayment({ ...input, shopId }),
    isCardAvailable: () => isMercadoPagoConnected(shopId),
    collectCard: (input: CardPaymentInput): Promise<CardPaymentPatch> =>
      collectCardPayment({ ...input, shopId }),
  };
}

export async function collectCardPayment(opts: {
  /** A loja que RECEBE. Sem ela a cobrança do cartão cai na conta errada. */
  shopId: ShopId;
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
      shopId: opts.shopId,
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

export function markOrderPaid(
  io: Server,
  shopId: ShopId,
  order: Order,
  moneyArrived = false
): Order {
  if (order.status === 'cancelado') {
    // Confirmação MANUAL (cozinha) num pedido cancelado continua recusada: é um
    // toque de tela, não dinheiro comprovado.
    if (!moneyArrived) {
      throw new DomainError(400, 'Este pedido foi cancelado. O pagamento não pode ser registrado.');
    }
    // Já o dinheiro que o Mercado Pago confirmou como aprovado chegou de fato
    // (o cliente pagou o QR ainda válido depois do cancelamento). Sumir com um
    // log deixaria o valor na conta da loja sem rastro; aqui ele é registrado e
    // a devolução abre, para aparecer no painel de reembolsos.
    if (order.payment.isPaid) return order;
    order.payment.isPaid = true;
    markRefundDue(order);
    saveOrder(shopId, order);
    emitOrder(io, shopId, 'order:updated', order);
    return order;
  }
  if (order.payment.isPaid) return order;
  order.payment.isPaid = true;
  saveOrder(shopId, order);
  emitOrder(io, shopId, 'order:updated', order);
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
  request: { shopId: ShopId; orderId: string; by?: string }
): Promise<Order | null> {
  const order = getOrder(request.shopId, request.orderId);
  if (!order) return null;
  if (order.payment.refundStatus === 'devolvido') return order;
  // 'falhou' continua devendo: a tentativa anterior não tirou dinheiro nenhum,
  // então a cozinha precisa poder tentar de novo pelo mesmo botão.
  if (order.payment.refundStatus !== 'pendente' && order.payment.refundStatus !== 'falhou') {
    throw new DomainError(400, 'Este pedido não tem devolução pendente.');
  }

  const settle = (patch: Partial<PaymentDetails>): Order => {
    order.payment = { ...order.payment, ...patch };
    saveOrder(request.shopId, order);
    emitOrder(io, request.shopId, 'order:updated', order);
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
    const refund = await refundMercadoPagoPayment(request.shopId, order.payment.mpPaymentId);
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
  | { source: 'mercadopago'; shopId: ShopId; paymentId: string }
  | { source: 'kitchen'; shopId: ShopId; orderId: string; confirmedBy?: string };

/**
 * Costura de teste: por padrão consulta o Mercado Pago de verdade. O teste
 * injeta um pagamento falso aqui para exercitar o guarda cruzado (a linha que
 * impede a loja B de quitar o pedido da loja A) SEM tocar a rede.
 */
export interface SettleDeps {
  fetchPayment?: typeof fetchPayment;
  // Também injetável: deixa o teste provar que o guarda `shopIdOfOrder !== shopId`
  // bloqueia MESMO se `getOrder` devolvesse o pedido de outra loja (defesa em
  // profundidade — as duas camadas barram o cruzamento, uma sem depender da outra).
  getOrder?: typeof getOrder;
}

/** One settlement interface for kitchen confirmation, PIX polling and webhooks. */
export async function settlePayment(
  io: Server,
  request: PaymentSettlement,
  deps: SettleDeps = {}
): Promise<Order | null> {
  if (request.source === 'kitchen') {
    const order = getOrder(request.shopId, request.orderId);
    if (!order) return null;
    if (request.confirmedBy) {
      (order.payment as PaymentDetails & { confirmedBy?: string }).confirmedBy = request.confirmedBy;
    }
    return markOrderPaid(io, request.shopId, order);
  }

  /**
   * A loja vem do `Host` do webhook — o `notification_url` de cada cobrança é
   * montado com o host da loja que cobrou. É com o token DELA que a consulta
   * abaixo é feita: com o token da loja errada, o Mercado Pago responderia 404
   * (o pagamento não é da conta dela) e o pedido nunca seria quitado.
   */
  const { shopId } = request;
  const pay = await (deps.fetchPayment ?? fetchPayment)(shopId, request.paymentId);
  if (!pay || !pay.externalReference || pay.status !== 'approved') return null;

  /**
   * Defesa em profundidade: a LINHA do pedido também tem que dizer esta loja.
   *
   * Mesmo com o `Host` certo e a assinatura válida, um `external_reference`
   * apontando para pedido de outra loja não pode quitar nada. O id do pedido é
   * único no mundo (não por loja) exatamente para esta conferência ser possível.
   */
  const donoDoPedido = shopIdOfOrder(pay.externalReference);
  if (donoDoPedido === null || donoDoPedido !== shopId) return null;

  const order = (deps.getOrder ?? getOrder)(shopId, pay.externalReference);
  if (!order) return null;
  // Dinheiro comprovado como aprovado pelo Mercado Pago: um cancelado vira
  // devolução em vez de ser recusado.
  return markOrderPaid(io, shopId, order, true);
}
