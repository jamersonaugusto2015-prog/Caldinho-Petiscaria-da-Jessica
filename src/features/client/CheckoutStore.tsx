import React, { useCallback, useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import type { Product } from '../../../contract/catalog/types';
import type { ChatMessage, Order, PaymentMethod, PaymentTiming } from '../../../contract/order/types';
import type { PublicStoreSettings } from '../../../contract/shop/types';
import { api } from '../../lib/api';
import { mergeById, useLiveSession } from '../../lib/liveSession';
import { useAlertChannel, useAlertMemory, type AlertChannel } from '../../lib/alertChannel';
import { bannerTextFor } from '../../ui/alertBanner';
import { orderAlertFor, type AlertUrgency } from '../../../contract/order/alerts';
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
  /** Canal de alertas do cliente: o cabeçalho usa para pedir a permissão. */
  alertChannel: AlertChannel;
}

type CheckoutProviderProps = {
  customerId: string;
  products: Product[];
  settings: PublicStoreSettings;
  triggerToast: (message: string, urgency?: AlertUrgency) => void;
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
  const memory = useAlertMemory();
  const channel = useAlertChannel({
    onBanner: (alert) => triggerToast(bannerTextFor(alert), alert.urgency),
  });

  const fetchOrders = useCallback(
    () => api.get<Order[]>(`/orders?customerId=${encodeURIComponent(customerId)}`),
    [customerId]
  );

  useEffect(() => {
    void Promise.all([
      fetchOrders().then((list) => {
        // Semeia a memória com o que já era verdade: o histórico carregado não
        // é notícia, e sem isso todo pedido antigo alertaria ao abrir o app.
        memory.seed(list);
        setOrders(list);
      }),
      api.get<{ points: number }>(`/loyalty?customerId=${encodeURIComponent(customerId)}`).then((result) => setLoyaltyPoints(result.points)),
    ]).catch(() => {});
  }, [customerId, fetchOrders, memory]);

  const applyIncoming = useCallback(
    (order: Order) => {
      setOrders((previous) => mergeById(previous, order));
      const alert = orderAlertFor('client', 'order:updated', order, memory.contextFor(order));
      memory.remember(order);
      channel.deliver(alert);
    },
    [channel, memory]
  );

  useLiveSession({
    customerId,
    join: false,
    onOrderUpdated: applyIncoming,
    onOrderNew: (order) => {
      setOrders((previous) => mergeById(previous, order));
      memory.remember(order);
    },
    onLoyaltyUpdated: ({ points }) => setLoyaltyPoints(points),
    onReconnect: () => {
      // O celular do cliente dormiu e o socket caiu: o `saiu_entrega` que
      // passou nesse intervalo nunca chegaria. A lista recarregada volta a
      // passar pela tabela — a chave do alerta impede o aviso repetido.
      void fetchOrders()
        .then((list) => list.forEach(applyIncoming))
        .catch(() => {});
    },
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
      // Guarda o `recebido` inicial: sem ele a primeira mudança de status não
      // teria com o que ser comparada e passaria em branco.
      memory.remember(result.order);
      setTrackingOrderId(result.order.id);
      setLoyaltyPoints(result.loyaltyPoints);
      clearCart();
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
      triggerToast(`Pedido ${result.order.id} enviado.`);
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
      triggerToast('Avaliação enviada. Obrigado.');
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
      triggerToast('Reclamação registrada. A loja responde pelo chat do pedido.');
      return true;
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : 'Não foi possível registrar a reclamação.');
      return false;
    }
  };

  const redeemLoyaltyReward = async (productId: string) => {
    const custoSelos = settings.loyaltyStampCost || 10;
    if (loyaltyPoints < custoSelos) {
      return { success: false, message: `Complete ${custoSelos} pedidos entregues para ganhar seu item grátis.` };
    }
    if (!settings.isOpen) {
      setClosedModalOpen(true);
      return {
        success: false,
        message: 'Loja fechada no momento. Volte quando reabrirmos para resgatar seu item grátis.',
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
        observation: 'Item grátis do cartão fidelidade',
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
      return { success: true, message: `${product.name} grátis adicionado ao carrinho.` };
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
    alertChannel: channel,
  };
  return <CheckoutContext.Provider value={value}>{children}</CheckoutContext.Provider>;
};

export const useCheckout = (): CheckoutContextValue => {
  const context = React.useContext(CheckoutContext);
  if (!context) throw new Error('useCheckout deve ser usado dentro de CheckoutProvider');
  return context;
};
