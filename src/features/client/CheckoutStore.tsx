import React, { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import type {
  ChatMessage,
  Order,
  OrderStatus,
  PaymentMethod,
  PaymentTiming,
  Product,
  PublicStoreSettings,
} from '../../types';
import { api } from '../../lib/api';
import { mergeById, useLiveSession } from '../../lib/liveSession';
import { LOYALTY_STAMP_COST, statusMessageFor } from '../../shared/constants';
import { useCart } from './CartStore';

export interface CheckoutContextValue {
  customerId: string;
  orders: Order[];
  trackingOrderId: string | null;
  setTrackingOrderId: (id: string | null) => void;
  /** Aplica uma versão mais nova de um pedido (poll de PIX, etc.) ao histórico local. */
  applyOrderUpdate: (order: Order) => void;
  placeOrder: (
    paymentMethod: PaymentMethod,
    paymentTiming: PaymentTiming,
    changeFor?: number,
    customer?: { name: string; phone: string },
    card?: {
      token: string;
      paymentMethodId: string;
      installments: number;
      issuerId?: string;
      email: string;
      identificationType: string;
      identificationNumber: string;
    }
  ) => Promise<{ order: Order } | { error: string } | null>;
  rateOrder: (orderId: string, rating: number, comment?: string) => Promise<void>;
  cancelOrder: (orderId: string, reason?: string) => Promise<boolean>;
  /** Pede o cancelamento depois que o preparo começou; a loja responde em CANCEL_REQUEST_RESPONSE_MINUTES. */
  requestOrderCancellation: (orderId: string, reason: string) => Promise<boolean>;
  openOrderComplaint: (orderId: string, text: string) => Promise<boolean>;
  loyaltyPoints: number;
  redeemLoyaltyReward: (productId: string) => Promise<{ success: boolean; message: string }>;
  sendChatMessage: (orderId: string, sender: 'client' | 'store' | 'driver', senderName: string, text: string) => Promise<void>;
}

type CheckoutProviderProps = {
  customerId: string;
  products: Product[];
  settings: PublicStoreSettings;
  triggerToast: (message: string) => void;
  children: React.ReactNode;
};

const CheckoutContext = React.createContext<CheckoutContextValue | undefined>(undefined);

const initialTrackingOrder = (): string | null => {
  try {
    const query = new URLSearchParams(window.location.search);
    const order = query.get('order');
    if (query.get('card') && order) {
      window.history.replaceState({}, '', window.location.pathname);
      return order;
    }
  } catch {
    /* ignore */
  }
  return null;
};

export const CheckoutProvider: React.FC<CheckoutProviderProps> = ({
  customerId,
  products,
  settings,
  triggerToast,
  children,
}) => {
  const { cart, appliedCoupon, selectedAddress, fulfillment, clearCart, addToCart, setClosedModalOpen } = useCart();
  const [orders, setOrders] = useState<Order[]>([]);
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(initialTrackingOrder);
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const previousStatus = useRef<Record<string, OrderStatus>>({});

  useEffect(() => {
    void Promise.all([
      api.get<Order[]>(`/orders?customerId=${encodeURIComponent(customerId)}`).then(setOrders),
      api.get<{ points: number }>(`/loyalty?customerId=${encodeURIComponent(customerId)}`).then((result) => setLoyaltyPoints(result.points)),
    ]).catch(() => {});
  }, [customerId]);

  useLiveSession({
    customerId,
    join: false,
    onOrderUpdated: (order) => {
      setOrders((previous) => mergeById(previous, order));
      const before = previousStatus.current[order.id];
      previousStatus.current[order.id] = order.status;
      if (before && before !== order.status) {
        triggerToast(`${order.id}: ${statusMessageFor(order.status, order.fulfillment)}`);
        if (order.status === 'entregue') confetti({ particleCount: 100, spread: 90, origin: { y: 0.5 } });
      }
    },
    onOrderNew: (order) => setOrders((previous) => mergeById(previous, order)),
    onLoyaltyUpdated: ({ points }) => setLoyaltyPoints(points),
  });

  const placeOrder: CheckoutContextValue['placeOrder'] = async (
    paymentMethod,
    paymentTiming,
    changeFor,
    customer,
    card
  ) => {
    try {
      const result = await api.post<{ order: Order; loyaltyPoints: number }>('/orders', {
        items: cart,
        couponCode: appliedCoupon?.code,
        address: fulfillment === 'pickup' ? undefined : selectedAddress,
        fulfillment,
        paymentMethod,
        paymentTiming,
        changeForAmount: changeFor,
        customerName: customer?.name,
        customerPhone: customer?.phone,
        customerId,
        ...(card
          ? {
              cardToken: card.token,
              cardPaymentMethodId: card.paymentMethodId,
              cardInstallments: card.installments,
              cardIssuerId: card.issuerId,
              cardEmail: card.email,
              cardDocType: card.identificationType,
              cardDocNumber: card.identificationNumber,
            }
          : {}),
      });
      setOrders((previous) => [result.order, ...previous]);
      setTrackingOrderId(result.order.id);
      setLoyaltyPoints(result.loyaltyPoints);
      clearCart();
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
      triggerToast(`Pedido ${result.order.id} enviado com sucesso! 🍲🚀`);
      return { order: result.order };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao enviar pedido.';
      triggerToast(message);
      return { error: message };
    }
  };

  const rateOrder = async (orderId: string, rating: number, comment?: string) => {
    try {
      const updated = await api.post<Order>(`/orders/${orderId}/rating`, { rating, comment, customerId });
      setOrders((previous) => previous.map((order) => (order.id === orderId ? updated : order)));
      triggerToast('Obrigado pela sua avaliação! ⭐');
    } catch {
      triggerToast('Não foi possível registrar a avaliação. Tente novamente.');
    }
  };

  const applyOrderUpdate = (order: Order) => setOrders((previous) => mergeById(previous, order));

  const cancelOrder = async (orderId: string, reason?: string): Promise<boolean> => {
    try {
      const updated = await api.post<Order>(`/orders/${orderId}/cancel`, { reason, customerId });
      setOrders((previous) => previous.map((order) => (order.id === orderId ? updated : order)));
      triggerToast(`Pedido ${orderId} cancelado.`);
      return true;
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : 'Não foi possível cancelar.');
      return false;
    }
  };

  const requestOrderCancellation = async (orderId: string, reason: string): Promise<boolean> => {
    try {
      const updated = await api.post<Order>(`/orders/${orderId}/cancel-request`, { customerId, reason });
      setOrders((previous) => previous.map((order) => (order.id === orderId ? updated : order)));
      triggerToast('Pedido de cancelamento enviado. A loja tem 5 minutos para responder.');
      return true;
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : 'Não foi possível pedir o cancelamento.');
      return false;
    }
  };

  const openOrderComplaint = async (orderId: string, text: string): Promise<boolean> => {
    try {
      const updated = await api.post<Order>(`/orders/${orderId}/complaint`, { customerId, text });
      setOrders((previous) => previous.map((order) => (order.id === orderId ? updated : order)));
      triggerToast('Reclamação registrada. A loja responde pelo chat do pedido. 💬');
      return true;
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : 'Não foi possível registrar a reclamação.');
      return false;
    }
  };

  const redeemLoyaltyReward = async (productId: string) => {
    if (loyaltyPoints < LOYALTY_STAMP_COST) {
      return { success: false, message: `Complete ${LOYALTY_STAMP_COST} pedidos entregues para ganhar seu caldinho grátis.` };
    }
    if (!settings.isOpen) {
      setClosedModalOpen(true);
      return {
        success: false,
        message: 'Loja fechada no momento. Volte quando reabrirmos para resgatar seu caldinho grátis.',
      };
    }
    const product = products.find((item) => item.id === productId);
    if (!product) {
      return { success: false, message: 'Produto do resgate não encontrado no cardápio.' };
    }
    try {
      const result = await api.post<{ points: number; token: string }>('/loyalty/redeem', { customerId, productId });
      setLoyaltyPoints(result.points);
      const added = addToCart({
        product,
        selectedExtras: [],
        observation: 'GRÁTIS - Resgate Fidelidade! 🎉',
        quantity: 1,
        isFree: true,
        freeToken: result.token,
      });
      if (!added) {
        return {
          success: false,
          message: 'A loja fechou durante o resgate e o item não entrou no carrinho. Fale com a loja pelo WhatsApp para não perder seu selo.',
        };
      }
      confetti({ particleCount: 120, spread: 100, origin: { y: 0.6 } });
      return { success: true, message: `Parabéns! 1x ${product.name} grátis no carrinho! 🎉` };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Não foi possível resgatar.' };
    }
  };

  const sendChatMessage = async (orderId: string, sender: 'client' | 'store' | 'driver', senderName: string, text: string) => {
    try {
      await api.post<ChatMessage>(`/orders/${orderId}/chat`, { orderId, sender, senderName, text, customerId });
    } catch {
      triggerToast('Não foi possível enviar a mensagem. Tente novamente.');
    }
  };

  const value: CheckoutContextValue = {
    customerId,
    orders,
    trackingOrderId,
    setTrackingOrderId,
    applyOrderUpdate,
    placeOrder,
    rateOrder,
    cancelOrder,
    requestOrderCancellation,
    openOrderComplaint,
    loyaltyPoints,
    redeemLoyaltyReward,
    sendChatMessage,
  };
  return <CheckoutContext.Provider value={value}>{children}</CheckoutContext.Provider>;
};

export const useCheckout = (): CheckoutContextValue => {
  const context = React.useContext(CheckoutContext);
  if (!context) throw new Error('useCheckout deve ser usado dentro de CheckoutProvider');
  return context;
};
