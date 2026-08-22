import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { Driver } from '../../../contract/driver/types';
import type { Order } from '../../../contract/order/types';
import type { PublicStoreSettings } from '../../../contract/shop/types';
import { driverApi as api } from '../../lib/api';
import { mergeById, useLiveSession } from '../../lib/liveSession';
import { AlertBannerProvider, bannerTextFor, useAlertBanner } from '../../ui/alertBanner';
import { useAlertChannel, useAlertMemory, type AlertChannel } from '../../lib/alertChannel';
import { orderAlertFor, type AlertUrgency } from '../../../contract/order/alerts';
import { getDriverProfile, getStoredRoleToken, saveDriverProfile } from '../../lib/auth';
import { socket } from '../../lib/socket';
import { usePageLifecycle } from '../../lib/pageLifecycle';
import { useDriverLocation, useWakeLock, DriverLocationStatus } from './useDriverLocation';
import { formatMoney } from '../../../contract/pricing/money';

/**
 * O que a tela do motoboy mostra sobre a própria presença.
 *
 * `reconnecting` é o estado que faltava: com o celular no bolso o socket cai, e
 * antes disso significar "offline" o app precisa de um nome para "eu ainda
 * quero corridas, só estou sem linha". Sem ele, a queda do socket virava
 * OFFLINE na cozinha enquanto o app do motoboy seguia dizendo ONLINE.
 */
export type DriverPresenceState = 'online' | 'reconnecting' | 'offline';

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
  /** Intenção do motoboy: o que o botão ONLINE diz. */
  isOnline: boolean;
  /** Intenção + socket + ciclo de vida da página, para a tela mostrar. */
  presenceState: DriverPresenceState;
  toggleOnline: () => Promise<void>;
  myDeliveries: Order[];
  availableOrders: Order[];
  completedToday: Order[];
  cancelledDeliveries: Order[];
  dismissCancellation: (orderId: string) => void;
  earningsToday: number;
  feeForOrder: (order: Order) => number;
  acceptAndStart: (orderId: string) => Promise<void>;
  /** "Peguei o pedido": leva a corrida de 'pronto' para 'saiu_entrega'. */
  startRoute: (orderId: string) => Promise<void>;
  confirmDelivery: (orderId: string) => Promise<void>;
  triggerToast: (msg: string, urgency?: AlertUrgency) => void;
  /** Canal de alertas do motoboy: a tela usa para pedir a permissão. */
  alertChannel: AlertChannel;
  locationStatus: DriverLocationStatus;
  /** Quando chegou o último ponto de GPS, em ms. `null` = nenhum ainda. */
  lastFixAt: number | null;
  retryLocation: () => void;
}

const DriverContext = createContext<DriverContextType | undefined>(undefined);

/** A faixa envolve a loja: o motoboy recebe avisos antes de qualquer corrida. */
export const DriverProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AlertBannerProvider>
    <DriverStore>{children}</DriverStore>
  </AlertBannerProvider>
);

const DriverStore: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const triggerToast = useAlertBanner();
  const memory = useAlertMemory();
  const channel = useAlertChannel({
    onBanner: (alert) => triggerToast(bannerTextFor(alert), alert.urgency),
  });
  const [orders, setOrders] = useState<Order[]>([]);
  const [profile, setProfile] = useState(getDriverProfile());
  const [settings, setSettings] = useState<PublicStoreSettings | null>(null);
  // A presença mora no servidor. Começamos pelo perfil salvo para não piscar
  // "OFFLINE" a cada recarga e confirmamos logo em seguida com o servidor.
  const [isOnline, setIsOnline] = useState(() => Boolean(getDriverProfile()?.online));
  const [dismissedCancellations, setDismissedCancellations] = useState<Set<string>>(new Set());

  const refetchOrders = useCallback(() => {
    // Sem driverId na query: o servidor deriva o motoboy da credencial da requisição.
    api
      .get<Order[]>('/orders')
      .then((list) => {
        // A lista recarregada é o que já sabíamos: sem semear, cada reconexão
        // ofereceria de novo, aos gritos, toda corrida parada no balcão.
        memory.seed(list);
        setOrders(list);
      })
      .catch(() => {});
  }, [memory]);

  const driverId = profile?.id;

  useEffect(() => {
    refetchOrders();
    api.get<PublicStoreSettings>('/settings').then(setSettings).catch(() => {});
  }, [refetchOrders]);

  const lifecycle = usePageLifecycle();
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  // A primeira leitura é a verdade: o perfil salvo no aparelho pode ter ficado
  // ONLINE de ontem. Depois dela o app passa a ser o dono da intenção.
  const presenceSyncedRef = useRef(false);

  const syncPresence = useCallback(() => {
    if (!driverId) return;
    api
      .get<Driver>(`/drivers/${encodeURIComponent(driverId)}/presence`)
      .then((driver) => {
        // A leitura seguinte só LIGA, nunca desliga. Um `online: false` vindo do
        // servidor depois disso quase sempre é a janela de graça tendo expirado
        // com o celular no bolso — e aí quem sabe se o turno acabou é este app,
        // não o servidor. Desligar aqui era o que fazia o motoboy voltar do
        // bolso já fora do quadro da cozinha, sem ter tocado em nada.
        if (!presenceSyncedRef.current || driver.online) setIsOnline(Boolean(driver.online));
        presenceSyncedRef.current = true;
        saveDriverProfile(driver);
        setProfile(driver);
      })
      .catch(() => {});
  }, [driverId]);

  // Reconferir a presença não é coisa de uma vez só: o app dizia ONLINE e a
  // cozinha OFFLINE porque a única leitura acontecia na troca de `driverId`.
  // Toda volta pra frente é uma chance de os dois lados terem divergido
  // enquanto a tela estava bloqueada (a reconexão do socket avisa logo abaixo).
  useEffect(() => {
    if (lifecycle !== 'foreground') return;
    syncPresence();
  }, [lifecycle, syncPresence]);

  // A corrida oferecida agora toca e vibra: o motoboy está com o celular no
  // bolso e o capacete na cabeça — um toast mudo não chega até ele.
  const applyIncoming = useCallback(
    (event: 'order:new' | 'order:updated', order: Order) => {
      setOrders((previous) => mergeById(previous, order));
      channel.deliver(orderAlertFor('driver', event, order, { ...memory.contextFor(order), driverId }));
      memory.remember(order);
    },
    [channel, driverId, memory]
  );

  useLiveSession({
    role: 'driver',
    token: getStoredRoleToken('driver'),
    onSettingsUpdated: (next) => setSettings((previous) => (previous ? { ...previous, ...next } : previous)),
    onOrderNew: (order) => applyIncoming('order:new', order),
    onOrderUpdated: (order) => applyIncoming('order:updated', order),
    onReconnect: () => {
      refetchOrders();
      // Depois de um reload/queda de rede, o servidor pode ter agendado offline;
      // reler a presença evita a tela ficar “Offline” com o servidor ainda online.
      syncPresence();
    },
  });

  // Reentrar na sala não prova que o motoboy quer corrida: o socket também
  // volta pra quem tocou OFFLINE e deixou o app aberto. Quem sabe da intenção é
  // este app, então é ele que a declara — a cada conexão, junto do token que
  // diz *quem* ele é (ADR-0009). É isto que devolve a presença sozinha depois
  // da tela bloqueada passar da janela de graça do servidor.
  const intentRef = useRef(isOnline);
  intentRef.current = isOnline;

  useEffect(() => {
    const token = getStoredRoleToken('driver');
    if (!token) return;
    const assertIntent = () => {
      // Antes da primeira leitura do servidor a intenção é só o palpite do
      // localStorage: declarar aqui poria o motoboy online só por abrir o app.
      if (!presenceSyncedRef.current) return;
      socket.emit('join', { role: 'driver', token, online: intentRef.current });
    };
    assertIntent();
    socket.on('connect', assertIntent);
    return () => {
      socket.off('connect', assertIntent);
    };
  }, [isOnline]);

  const myDeliveries = orders.filter(
    (o) => o.driverId === profile?.id && (o.status === 'pronto' || o.status === 'saiu_entrega')
  );
  const availableOrders = orders.filter((o) => o.status === 'pronto' && !o.driverId);

  const todayKey = localDateKey(new Date().toISOString());
  // O ganho conta no dia em que a entrega terminou, não no dia em que o pedido nasceu:
  // um pedido feito 23h50 e entregue 00h10 cairia no dia errado. `deliveredAt` só falta
  // em pedidos antigos, gravados antes do campo existir — aí o createdAt é o que há.
  const completedToday = orders.filter(
    (o) =>
      o.driverId === profile?.id &&
      o.status === 'entregue' &&
      localDateKey(o.deliveredAt || o.createdAt) === todayKey
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
  const {
    status: locationStatus,
    lastFixAt,
    start: startLocationWatch,
    stop: stopLocationWatch,
  } = useDriverLocation(profile?.id);

  // Corrida na rua segura a tela acesa: tela apagada é watch de GPS suspenso e
  // socket caído — o motoboy some do mapa do cliente no meio do trajeto.
  useWakeLock(hasActiveDelivery);

  // Presença = intenção + socket vivo + onde a página está. Perder o socket
  // deixou de zerar a intenção: com o celular no bolso o motoboy fica
  // "Reconectando", e não "Offline" — o servidor guarda a vaga dele na janela
  // de graça e a reconexão redeclara a intenção.
  const presenceState: DriverPresenceState = !isOnline
    ? 'offline'
    : connected && lifecycle !== 'offline'
      ? 'online'
      : 'reconnecting';

  useEffect(() => {
    if (isOnline || hasActiveDelivery) startLocationWatch();
    else stopLocationWatch();
  }, [isOnline, hasActiveDelivery, startLocationWatch, stopLocationWatch]);

  const retryLocation = useCallback(() => {
    stopLocationWatch();
    startLocationWatch();
  }, [startLocationWatch, stopLocationWatch]);

  const setOnlinePresence = useCallback(
    async (next: boolean): Promise<boolean> => {
      setIsOnline(next);
      if (!profile?.id) return true;
      try {
        const updated = await api.post<Driver>(`/drivers/${profile.id}/presence`, { online: next });
        saveDriverProfile(updated);
        setProfile(updated);
        return true;
      } catch {
        // Sem gravar no servidor a presença não vale: volta ao estado anterior.
        setIsOnline(!next);
        triggerToast('Não deu para mudar sua presença. Você continua como estava. Toque de novo.');
        return false;
      }
    },
    [profile, triggerToast]
  );

  const toggleOnline = async () => {
    const next = !isOnline;
    const ok = await setOnlinePresence(next);
    if (!ok) return;
    triggerToast(next ? 'Você está online e disponível para corridas.' : 'Você está offline.');
  };

  const acceptAndStart = async (orderId: string) => {
    if (!isOnline) {
      triggerToast('Fique online para aceitar corridas.');
      return;
    }
    if (!profile?.name) {
      triggerToast('Faça login novamente para aceitar corridas.');
      return;
    }
    try {
      // Corpo vazio de propósito: o servidor resolve o motoboy pela credencial.
      const updated = await api.post<Order>(`/orders/${orderId}/assign`, {});
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      // Aceitar não é sair para entrega: a corrida segue 'pronto' até o motoboy
      // pegar o pedido no balcão. "Retirar" é o que o cliente faz, não o motoboy.
      triggerToast(`Corrida ${orderId} aceita. Vá à loja e pegue no balcão.`);
      if (!isOnline) await setOnlinePresence(true);
    } catch (err) {
      triggerToast(
        err instanceof Error
          ? err.message
          : 'Não deu para aceitar a corrida. Outro motoboy pode ter pegado antes. Atualize a lista.'
      );
    }
  };

  // Passo "peguei o pedido": pronto → saiu_entrega. É o que de fato tira o motoboy da loja.
  const startRoute = async (orderId: string) => {
    if (!profile?.name) return;
    try {
      const updated = await api.patch<Order>(`/orders/${orderId}/status`, { status: 'saiu_entrega' });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      triggerToast('Pedido com você. Siga para o endereço do cliente.');
    } catch (err) {
      triggerToast(
        err instanceof Error ? err.message : 'Não deu para registrar a saída. Confira a internet e toque de novo.'
      );
    }
  };

  const confirmDelivery = async (orderId: string) => {
    if (!profile?.name) return;
    try {
      const updated = await api.patch<Order>(`/orders/${orderId}/status`, { status: 'entregue' });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      const fee = feeForOrder(updated);
      triggerToast(`Entrega concluída. + ${formatMoney(fee)} nos ganhos de hoje.`);
    } catch (err) {
      triggerToast(
        err instanceof Error ? err.message : 'Não deu para confirmar a entrega. Confira a internet e toque de novo.'
      );
    }
  };

  return (
    <DriverContext.Provider
      value={{
        profile,
        settings,
        isOnline,
        presenceState,
        toggleOnline,
        myDeliveries,
        availableOrders,
        completedToday,
        cancelledDeliveries,
        dismissCancellation,
        earningsToday,
        feeForOrder,
        acceptAndStart,
        startRoute,
        confirmDelivery,
        triggerToast,
        alertChannel: channel,
        locationStatus,
        lastFixAt,
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
