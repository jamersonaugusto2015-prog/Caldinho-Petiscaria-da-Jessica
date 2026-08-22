/**
 * O pedido, do carrinho à entrega: itens, endereço, pagamento, cancelamento e
 * a conversa em volta dele.
 */

import type { AppliedPromotion, ComboChoice, Product } from '../catalog/types';
export interface CartItemExtra {
  id: string;
  name: string;
  price: number;
}

export interface CartItem {
  id: string;
  product: Product;
  size?: string;
  selectedExtras: CartItemExtra[];
  comboChoices?: ComboChoice[];
  observation?: string;
  quantity: number;
  itemTotalPrice: number;
  isFree?: boolean;
  freeToken?: string;
}

/** Como o pedido chega ao cliente: motoboy leva ou o cliente retira no balcao. */
export type Fulfillment = 'delivery' | 'pickup';

export type OrderStatus =
  | 'recebido'
  | 'em_preparo'
  | 'pronto'
  | 'saiu_entrega'
  | 'entregue'
  | 'cancelado';

/** 'pendente' = a loja deve esse dinheiro ao cliente e ainda não devolveu. */
export type RefundStatus = 'pendente' | 'devolvido' | 'falhou';

export type PaymentMethod = 'pix' | 'card' | 'cash';

/** Quando o dinheiro entra: agora no site, ou com o motoboy/balcão. */
export type PaymentTiming = 'online' | 'delivery';

/**
 * Quem emite a cobrança PIX.
 * - 'mercadopago': cobrança na conta do Mercado Pago, com QR Code que expira e
 *   confirmação automática do pagamento.
 * - 'local': BR Code gerado aqui a partir da chave PIX da loja. Cai direto na
 *   conta do banco, sem taxa e sem intermediário, mas ninguém avisa o sistema
 *   quando o dinheiro entra: a cozinha confirma na mão.
 */
export type PixProvider = 'mercadopago' | 'local';

export interface PaymentDetails {
  method: PaymentMethod;
  /** Ausente em pedidos antigos — veja `normalizePaymentTiming` em `contract/payment/payment.ts`. */
  timing?: PaymentTiming;
  pixQrCode?: string;
  pixCopyPaste?: string;
  mpPaymentId?: string;
  mpTicketUrl?: string;
  changeForAmount?: number;
  cardBrand?: string;
  isPaid: boolean;
  /** Quem confirmou um pagamento manual (a cozinha compartilha um PIN). */
  confirmedBy?: string;
  refundStatus?: RefundStatus;
  refundedAt?: string;
  refundedBy?: string;
  mpRefundId?: string;
  refundError?: string;
}

export interface DeliveryAddress {
  id: string;
  label: string; // e.g., 'Casa', 'Trabalho'
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  complement?: string;
  cep?: string;
  lat?: number; // latitude real
  lng?: number; // longitude real
  distanceKm: number;
}

export interface Order {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  address: DeliveryAddress;
  /** Ausente em pedidos antigos, gravados antes da retirada existir: leia como 'delivery'. */
  fulfillment?: Fulfillment;
  items: CartItem[];
  subtotal: number;
  discount: number;
  /** Desconto vindo das promoções automáticas (separado do cupom). */
  promoDiscount?: number;
  /** Quais promoções pegaram neste pedido — base do relatório de resultado. */
  appliedPromotions?: AppliedPromotion[];
  deliveryFee: number;
  total: number;
  distanceKm: number;
  status: OrderStatus;
  payment: PaymentDetails;
  createdAt: string; // ISO string
  /** Quando o pedido foi entregue. Ausente em pedidos gravados antes deste campo. */
  deliveredAt?: string;
  estimatedDeliveryMinutes: number;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  driverLat?: number; // latitude real (GPS do entregador)
  driverLng?: number;
  /**
   * Quando o ponto acima foi tirado. Sem ele o mapa do cliente não tem como
   * separar "o motoboy está aqui" de "o motoboy estava aqui há dez minutos e o
   * celular dele dormiu" — os dois desenham o mesmo pino. Ausente nos pedidos
   * gravados antes do carimbo existir, e num ponto semeado, que é palpite.
   */
  driverLocationAt?: string;
  rating?: number;
  ratingComment?: string;
  cancellationReason?: string;
  cancelledAt?: string;
  cancelledBy?: CancelActor;
  cancellationRequest?: CancellationRequest;
  complaint?: OrderComplaint;
  loyaltyPointsEarned: number;
}

export type CancelActor = 'cliente' | 'loja';

export interface CancellationRequest {
  reason: string;
  requestedAt: string;
  status: 'pendente' | 'aceito' | 'recusado';
  respondedAt?: string;
  responseNote?: string;
}

/** Reclamação pós-entrega. O prazo está em `contract/constants.ts`. */
export interface OrderComplaint {
  text: string;
  openedAt: string;
  status: 'aberta' | 'resolvida';
  resolvedAt?: string;
}

export interface ChatMessage {
  id: string;
  orderId: string;
  sender: 'client' | 'store' | 'driver';
  senderName: string;
  text: string;
  timestamp: string;
}
