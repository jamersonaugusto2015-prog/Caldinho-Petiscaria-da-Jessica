import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { Order, PublicStoreSettings } from '../../types';
import { driverApi as api } from '../../lib/api';
import { mergeById, useLiveSession } from '../../lib/liveSession';
import { getDriverProfile, getStoredRoleToken } from '../../lib/auth';
import { useDriverLocation, DriverLocationStatus } from './useDriverLocation';

function localDateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface DriverContextType {
  profile: ReturnType<typeof getDriverProfile>;
  settings: PublicStoreSettings | null;
  isOnline: boolean;
  toggleOnline: () => Promise<void>;
  myDeliveries: Order[];
  availableOrders: Order[];
  completedToday: Order[];
  cancelledDeliveries: Order[];
  dismissCancellation: (orderId: string) => void;
  earningsToday: number;
  feeForOrder: (order: Order) => number;
  acceptAndStart: (orderId: string) => Promise<void>;
  confirmDelivery: (orderId: string) => Promise<void>;
  notificationToast: string | null;
  triggerToast: (msg: string) => void;
  locationStatus: DriverLocationStatus;
  retryLocation: () => void;
}

const DriverContext = createContext<DriverContextType | undefined>(undefined);

export const DriverProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [profile, setProfile] = useState(getDriverProfile());
  const [settings, setSettings] = useState<PublicStoreSettings | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [notificationToast, setNotificationToast] = useState<string | null>(null);
  const [dismissedCancellations, setDismissedCancellations] = useState<Set<string>>(new Set());

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerToast = useCallback((msg: string) => {
    setNotificationToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setNotificationToast(null), 4000);
  }, []);

  const refetchOrders = useCallback(() => {
    const driverId = profile?.id;
    const qs = driverId ? `?driverId=${encodeURIComponent(driverId)}` : '';
    api.get<Order[]>(`/orders${qs}`).then(setOrders).catch(() => {});
  }, [profile?.id]);

  useEffect(() => {
    refetchOrders();
    api.get<PublicStoreSettings>('/settings').then(setSettings).catch(() => {});
  }, [refetchOrders]);

  useLiveSession({
    role: 'driver',
    token: getStoredRoleToken('driver'),
    driverId: profile?.id,
    onSettingsUpdated: (next) => setSettings((previous) => (previous ? { ...previous, ...next } : previous)),
    onOrderNew: (order) => {
      setOrders((previous) => mergeById(previous, order));
      if (order.status === 'pronto' && !order.driverId) {
        triggerToast(`🛵 Nova corrida disponível: ${order.id}`);
      }
    },
    onOrderUpdated: (order) => {
      setOrders((previous) => mergeById(previous, order));
      if (order.status === 'pronto' && !order.driverId) {
        triggerToast(`🛵 Nova corrida disponível: ${order.id}`);
      }
      if (order.driverId === profile?.id && order.status === 'entregue') {
        triggerToast(`✅ Corrida ${order.id} concluída!`);
      }
      if (order.driverId === profile?.id && order.status === 'cancelado') {
        triggerToast(
          `⚠️ Corrida ${order.id} foi cancelada${order.cancelledBy === 'cliente' ? ' pelo cliente' : ' pela loja'}.`
        );
      }
    },
    onReconnect: refetchOrders,
  });

  const myDeliveries = orders.filter(
    (o) => o.driverId === profile?.id && (o.status === 'pronto' || o.status === 'saiu_entrega')
  );
  const availableOrders = orders.filter((o) => o.status === 'pronto' && !o.driverId);

  const todayKey = localDateKey(new Date().toISOString());
  const completedToday = orders.filter(
    (o) => o.driverId === profile?.id && o.status === 'entregue' && localDateKey(o.createdAt) === todayKey
  );

  // Corrida cancelada some do "myDeliveries" (não é pronto/saiu_entrega), então não segura o GPS
  // ligado. Isolamos aqui só para o motoboy confirmar que viu — limitado ao dia de hoje pra não
  // acumular cancelamentos antigos toda vez que a lista é buscada de novo.
  const cancelledDeliveries = orders.filter(
    (o) =>
      o.driverId === profile?.id &&
      o.status === 'cancelado' &&
      localDateKey(o.cancelledAt || o.createdAt) === todayKey &&
      !dismissedCancellations.has(o.id)
  );

  const dismissCancellation = useCallback((orderId: string) => {
    setDismissedCancellations((previous) => {
      const next = new Set(previous);
      next.add(orderId);
      return next;
    });
  }, []);

  const feeForOrder = (order: Order): number =>
    settings && settings.driverFeePerDelivery > 0 ? settings.driverFeePerDelivery : order.deliveryFee;

  const earningsToday = completedToday.reduce((sum, o) => sum + feeForOrder(o), 0);

  const hasActiveDelivery = myDeliveries.length > 0;
  const { status: locationStatus, start: startLocationWatch, stop: stopLocationWatch } = useDriverLocation(
    profile?.id
  );

  useEffect(() => {
    if (isOnline || hasActiveDelivery) startLocationWatch();
    else stopLocationWatch();
  }, [isOnline, hasActiveDelivery, startLocationWatch, stopLocationWatch]);

  const retryLocation = useCallback(() => {
    stopLocationWatch();
    startLocationWatch();
  }, [startLocationWatch, stopLocationWatch]);

  const setOnlinePresence = useCallback(
    async (next: boolean) => {
      setIsOnline(next);
      if (profile?.id) {
        try {
          await api.post(`/drivers/${profile.id}/presence`, { online: next });
        } catch {
          triggerToast('Não foi possível atualizar sua presença.');
        }
      }
    },
    [profile, triggerToast]
  );

  const toggleOnline = async () => {
    const next = !isOnline;
    await setOnlinePresence(next);
    triggerToast(next ? '🛵 Você está ONLINE e disponível para corridas!' : 'Você está offline.');
  };

  const acceptAndStart = async (orderId: string) => {
    if (!profile?.name) {
      triggerToast('Faça login novamente para aceitar corridas.');
      return;
    }
    try {
      const updated = await api.post<Order>(`/orders/${orderId}/assign`, {
        driverId: profile.id,
        driverName: profile.name,
      });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      triggerToast(`🚀 Corrida ${orderId} aceita! Dirija até a loja.`);
      if (!isOnline) await setOnlinePresence(true);
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao aceitar corrida.');
    }
  };

  const confirmDelivery = async (orderId: string) => {
    if (!profile?.name) return;
    try {
      const updated = await api.patch<Order>(`/orders/${orderId}/status`, {
        status: 'entregue',
        driverId: profile.id,
        driverName: profile.name,
      });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      const fee = feeForOrder(updated);
      triggerToast(`✅ Entrega concluída! + R$ ${fee.toFixed(2)}`);
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao confirmar entrega.');
    }
  };

  return (
    <DriverContext.Provider
      value={{
        profile,
        settings,
        isOnline,
        toggleOnline,
        myDeliveries,
        availableOrders,
        completedToday,
        cancelledDeliveries,
        dismissCancellation,
        earningsToday,
        feeForOrder,
        acceptAndStart,
        confirmDelivery,
        notificationToast,
        triggerToast,
        locationStatus,
        retryLocation,
      }}
    >
      {children}
    </DriverContext.Provider>
  );
};

export const useDriver = () => {
  const context = useContext(DriverContext);
  if (!context) throw new Error('useDriver deve ser usado dentro de DriverProvider');
  return context;
};
