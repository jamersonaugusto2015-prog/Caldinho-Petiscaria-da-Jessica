import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Order, OrderStatus } from '../../../contract/order/types';
import { kitchenApi as api } from '../../lib/api';
import { mergeById } from '../../lib/liveSession';
import { useAlertMemory } from '../../lib/alertChannel';
import { orderAlertFor } from '../../../contract/order/alerts';
import { useKitchenToast } from './KitchenNotificationsStore';
import { useKitchenSoundAlert } from './KitchenSoundStore';
import { useKitchenReportsSync } from './KitchenReportsStore';

interface KitchenOrdersContextType {
  orders: Order[];
  newOrderFlashId: string | null;
  /** Pedido com uma ação de cancelamento/devolução em andamento, para travar o botão. */
  busyOrderId: string | null;
  /** true só durante a primeira carga; uma recarga em segundo plano não acende de novo. */
  loading: boolean;
  /** erro da carga inicial — some assim que os pedidos chegam uma vez. */
  error: string | null;
  reload: () => void;
  updateOrderStatus: (orderId: string, newStatus: OrderStatus, driverName?: string) => Promise<void>;
  cancelOrder: (orderId: string, reason?: string) => Promise<void>;
  confirmPayment: (orderId: string) => Promise<void>;
  resolveCancelRequest: (orderId: string, accept: boolean, note?: string) => Promise<void>;
  resolveComplaint: (orderId: string) => Promise<void>;
  refundOrder: (orderId: string) => Promise<void>;
}

interface KitchenOrdersSyncContextType {
  receiveNewOrder: (order: Order) => void;
  applyOrder: (order: Order) => void;
  refetch: () => void;
}

const KitchenOrdersContext = createContext<KitchenOrdersContextType | undefined>(undefined);
const KitchenOrdersSyncContext = createContext<KitchenOrdersSyncContextType | undefined>(undefined);

export const KitchenOrdersProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const triggerToast = useKitchenToast();
  const { deliver } = useKitchenSoundAlert();
  const memory = useAlertMemory();
  const { loadReport, loadTrends } = useKitchenReportsSync();
  const [orders, setOrders] = useState<Order[]>([]);
  const [newOrderFlashId, setNewOrderFlashId] = useState<string | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(
    (isInitial: boolean) => {
      if (isInitial) {
        setLoading(true);
        setError(null);
      }
      api
        .get<Order[]>('/orders')
        .then((list) => {
          // A lista recarregada é o "já sabíamos disso": sem semear a memória, a
          // reconexão faria todo cancelamento pendente gritar de novo.
          memory.seed(list);
          setOrders(list);
          if (isInitial) setError(null);
        })
        .catch(() => {
          if (isInitial) {
            setError('Não deu para carregar os pedidos. Confira a conexão e tente de novo.');
          } else {
            // Recarga em segundo plano: os pedidos na tela continuam sendo os
            // últimos confirmados — só avisa que podem estar desatualizados.
            triggerToast('Não deu para atualizar os pedidos. Mostrando os últimos carregados.');
          }
        })
        .finally(() => {
          if (isInitial) setLoading(false);
        });
    },
    [memory, triggerToast]
  );

  const refetch = useCallback(() => fetchOrders(false), [fetchOrders]);
  const loadInitial = useCallback(() => fetchOrders(true), [fetchOrders]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const applyOrder = useCallback(
    (order: Order) => {
      deliver(orderAlertFor('kitchen', 'order:updated', order, memory.contextFor(order)));
      memory.remember(order);
      setOrders((previous) => mergeById(previous, order));
    },
    [deliver, memory]
  );

  const receiveNewOrder = useCallback(
    (order: Order) => {
      setOrders((previous) => mergeById(previous, order));
      deliver(orderAlertFor('kitchen', 'order:new', order, memory.contextFor(order)));
      memory.remember(order);
      // A piscada do card e a atualização dos relatórios não são alerta: elas
      // não interrompem ninguém e continuam sendo assunto desta loja.
      setNewOrderFlashId(order.id);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setNewOrderFlashId(null), 3000);
      void loadTrends();
      void loadReport();
    },
    [deliver, loadReport, loadTrends, memory]
  );

  const updateOrderStatus = useCallback(
    async (orderId: string, newStatus: OrderStatus, driverName?: string) => {
      try {
        const updated = await api.patch<Order>(`/orders/${orderId}/status`, {
          status: newStatus,
          ...(driverName ? { driverName } : {}),
        });
        applyOrder(updated);
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao atualizar pedido.');
      }
    },
    [applyOrder, triggerToast]
  );

  const cancelOrder = useCallback(
    async (orderId: string, reason?: string) => {
      setBusyOrderId(orderId);
      try {
        const updated = await api.post<Order>(`/orders/${orderId}/cancel`, { reason });
        applyOrder(updated);
        triggerToast(
          updated.payment.refundStatus === 'pendente'
            ? `Pedido ${orderId} cancelado. Devolva o dinheiro em "A devolver".`
            : `Pedido ${orderId} cancelado.`
        );
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao cancelar pedido.');
      } finally {
        setBusyOrderId((current) => (current === orderId ? null : current));
      }
    },
    [applyOrder, triggerToast]
  );

  const confirmPayment = useCallback(
    async (orderId: string) => {
      try {
        const updated = await api.patch<Order>(`/orders/${orderId}/payment`, {});
        applyOrder(updated);
        triggerToast('Pagamento confirmado.');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao confirmar pagamento.');
      }
    },
    [applyOrder, triggerToast]
  );

  const resolveCancelRequest = useCallback(
    async (orderId: string, accept: boolean, note?: string) => {
      setBusyOrderId(orderId);
      try {
        const updated = await api.post<Order>(`/orders/${orderId}/cancel-request/resolve`, {
          accept,
          ...(note ? { note } : {}),
        });
        applyOrder(updated);
        triggerToast(
          accept
            ? updated.payment.refundStatus === 'pendente'
              ? 'Cancelamento aceito. Devolva o dinheiro em "A devolver".'
              : 'Cancelamento aceito.'
            : 'Cancelamento recusado. O cliente foi avisado.'
        );
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao responder a solicitação.');
      } finally {
        setBusyOrderId((current) => (current === orderId ? null : current));
      }
    },
    [applyOrder, triggerToast]
  );

  const resolveComplaint = useCallback(
    async (orderId: string) => {
      setBusyOrderId(orderId);
      try {
        const updated = await api.post<Order>(`/orders/${orderId}/complaint/resolve`, {});
        applyOrder(updated);
        triggerToast('Reclamação marcada como resolvida.');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao resolver a reclamação.');
      } finally {
        setBusyOrderId((current) => (current === orderId ? null : current));
      }
    },
    [applyOrder, triggerToast]
  );

  const refundOrder = useCallback(
    async (orderId: string) => {
      setBusyOrderId(orderId);
      try {
        const updated = await api.post<Order>(`/orders/${orderId}/refund`, {});
        applyOrder(updated);
        triggerToast(`Devolução do pedido ${orderId} concluída.`);
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao devolver o dinheiro.');
        // A falha grava `refundError` no pedido: recarrega para a tela mostrar o motivo.
        refetch();
      } finally {
        setBusyOrderId((current) => (current === orderId ? null : current));
      }
    },
    [applyOrder, refetch, triggerToast]
  );

  const value = useMemo<KitchenOrdersContextType>(
    () => ({
      orders,
      newOrderFlashId,
      busyOrderId,
      loading,
      error,
      reload: loadInitial,
      updateOrderStatus,
      cancelOrder,
      confirmPayment,
      resolveCancelRequest,
      resolveComplaint,
      refundOrder,
    }),
    [
      orders,
      newOrderFlashId,
      busyOrderId,
      loading,
      error,
      loadInitial,
      updateOrderStatus,
      cancelOrder,
      confirmPayment,
      resolveCancelRequest,
      resolveComplaint,
      refundOrder,
    ]
  );

  const sync = useMemo<KitchenOrdersSyncContextType>(
    () => ({ receiveNewOrder, applyOrder, refetch }),
    [receiveNewOrder, applyOrder, refetch]
  );

  return (
    <KitchenOrdersSyncContext.Provider value={sync}>
      <KitchenOrdersContext.Provider value={value}>{children}</KitchenOrdersContext.Provider>
    </KitchenOrdersSyncContext.Provider>
  );
};

export const useKitchenOrders = () => {
  const context = useContext(KitchenOrdersContext);
  if (!context) throw new Error('useKitchenOrders deve ser usado dentro de KitchenProvider');
  return context;
};

export const useKitchenOrdersSync = () => {
  const context = useContext(KitchenOrdersSyncContext);
  if (!context) throw new Error('useKitchenOrdersSync deve ser usado dentro de KitchenProvider');
  return context;
};
