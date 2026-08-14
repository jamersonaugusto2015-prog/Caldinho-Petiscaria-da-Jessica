import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { Order, PublicStoreSettings } from '../../types';
import { api } from '../../lib/api';
import { socket, useSocketEvent } from '../../lib/socket';
import { getDriverProfile } from '../../lib/auth';

function localDateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface DriverContextType {
  orders: Order[];
  profile: ReturnType<typeof getDriverProfile>;
  settings: PublicStoreSettings | null;
  isOnline: boolean;
  toggleOnline: () => Promise<void>;
  myDeliveries: Order[];
  availableOrders: Order[];
  completedToday: Order[];
  earningsToday: number;
  feeForOrder: (order: Order) => number;
  acceptAndStart: (orderId: string) => Promise<void>;
  confirmDelivery: (orderId: string) => Promise<void>;
  notificationToast: string | null;
  triggerToast: (msg: string) => void;
}

const DriverContext = createContext<DriverContextType | undefined>(undefined);

export const DriverProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [profile, setProfile] = useState(getDriverProfile());
  const [settings, setSettings] = useState<PublicStoreSettings | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [notificationToast, setNotificationToast] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerToast = useCallback((msg: string) => {
    setNotificationToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setNotificationToast(null), 4000);
  }, []);

  useEffect(() => {
    api.get<Order[]>('/orders').then(setOrders).catch(() => {});
    api.get<PublicStoreSettings>('/settings').then(setSettings).catch(() => {});
  }, []);

  const startLocationWatch = useCallback(() => {
    if (watchIdRef.current != null || !navigator.geolocation) return;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const last = lastPosRef.current;
        if (last && Math.abs(last.lat - lat) < 0.00015 && Math.abs(last.lng - lng) < 0.00015) return;
        lastPosRef.current = { lat, lng };
        const driverId = profile?.id;
        if (driverId) socket.emit('driver:location', { driverId, lat, lng });
      },
      () => {
        /* geolocalização indisponível/negada: a posição fica na loja */
      },
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
  }, [profile]);

  const stopLocationWatch = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  useEffect(() => stopLocationWatch, [stopLocationWatch]);

  const toggleOnline = async () => {
    const next = !isOnline;
    setIsOnline(next);
    if (profile?.id) {
      try {
        await api.post(`/drivers/${profile.id}/presence`, { online: next });
      } catch {
        triggerToast('Não foi possível atualizar sua presença.');
      }
    }
    if (next) {
      startLocationWatch();
      triggerToast('🛵 Você está ONLINE e disponível para corridas!');
    } else {
      stopLocationWatch();
      triggerToast('Você está offline.');
    }
  };

  // Corridas disponíveis (cozinha marcou como pronto, sem entregador)
  useSocketEvent<Order>('order:new', (order) => {
    setOrders((prev) => (prev.some((o) => o.id === order.id) ? prev : [order, ...prev]));
    if (order.status === 'pronto' && !order.driverId) {
      triggerToast(`🛵 Nova corrida disponível: ${order.id}`);
    }
  });

  useSocketEvent<Order>('order:updated', (order) => {
    setOrders((prev) => {
      const exists = prev.some((o) => o.id === order.id);
      return exists ? prev.map((o) => (o.id === order.id ? order : o)) : [order, ...prev];
    });
    if (order.status === 'pronto' && !order.driverId) {
      triggerToast(`🛵 Nova corrida disponível: ${order.id}`);
    }
    if (order.driverId === profile?.id && order.status === 'entregue') {
      triggerToast(`✅ Corrida ${order.id} concluída!`);
    }
  });

  const myDeliveries = orders.filter(
    (o) => o.driverId === profile?.id && (o.status === 'pronto' || o.status === 'saiu_entrega')
  );
  const availableOrders = orders.filter((o) => o.status === 'pronto' && !o.driverId);

  const todayKey = localDateKey(new Date().toISOString());
  const completedToday = orders.filter(
    (o) => o.driverId === profile?.id && o.status === 'entregue' && localDateKey(o.createdAt) === todayKey
  );

  const feeForOrder = (order: Order): number =>
    settings && settings.driverFeePerDelivery > 0 ? settings.driverFeePerDelivery : order.deliveryFee;

  const earningsToday = completedToday.reduce((sum, o) => sum + feeForOrder(o), 0);

  const acceptAndStart = async (orderId: string) => {
    if (!profile?.name) {
      triggerToast('Faça login novamente para aceitar corridas.');
      return;
    }
    try {
      const updated = await api.post<Order>(`/orders/${orderId}/assign`, { driverName: profile.name });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      triggerToast(`🚀 Corrida ${orderId} aceita! Dirija até a loja.`);
      if (!isOnline) startLocationWatch();
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao aceitar corrida.');
    }
  };

  const confirmDelivery = async (orderId: string) => {
    if (!profile?.name) return;
    try {
      const updated = await api.patch<Order>(`/orders/${orderId}/status`, {
        status: 'entregue',
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
        orders,
        profile,
        settings,
        isOnline,
        toggleOnline,
        myDeliveries,
        availableOrders,
        completedToday,
        earningsToday,
        feeForOrder,
        acceptAndStart,
        confirmDelivery,
        notificationToast,
        triggerToast,
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
