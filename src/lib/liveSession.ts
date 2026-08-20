import { useEffect, useRef } from 'react';
import type { Order, PublicStoreSettings, ChatMessage } from '../types';
import { socket, useSocketEvent } from './socket';

export type LiveRole = 'kitchen' | 'driver';

export interface LiveSessionOptions {
  role?: LiveRole;
  token?: string;
  customerId?: string;
  join?: boolean;
  onOrderNew?: (order: Order) => void;
  onOrderUpdated?: (order: Order) => void;
  onSettingsUpdated?: (settings: Partial<PublicStoreSettings>) => void;
  onLoyaltyUpdated?: (payload: { customerId: string; points: number }) => void;
  onChatMessage?: (message: ChatMessage) => void;
  /** Events broadcast while the socket was down are lost: reconcile state here. */
  onReconnect?: () => void;
}

/** Shared order merge used by client, kitchen and driver stores. */
export function mergeById<T extends { id: string }>(items: T[], incoming: T): T[] {
  const exists = items.some((item) => item.id === incoming.id);
  return exists ? items.map((item) => (item.id === incoming.id ? incoming : item)) : [incoming, ...items];
}

/**
 * Small live-session seam: owns socket joining and forwards shared events.
 * Role-specific stores keep only their own side effects (sound, toast, filters).
 */
export function useLiveSession({
  role,
  token,
  customerId,
  join = true,
  onOrderNew,
  onOrderUpdated,
  onSettingsUpdated,
  onLoyaltyUpdated,
  onChatMessage,
  onReconnect,
}: LiveSessionOptions): void {
  const reconnectRef = useRef(onReconnect);
  reconnectRef.current = onReconnect;

  useEffect(() => {
    if (!join) return;
    const joinSession = () => {
      // Nada de identidade no payload: o servidor resolve o motoboy pelo token.
      // Mandar um driverId daqui deixava qualquer um entrar na sala privada de outro.
      if (role) socket.emit('join', { role, token });
      if (customerId) socket.emit('join', { customerId });
    };
    joinSession();
    socket.on('connect', joinSession);
    return () => socket.off('connect', joinSession);
  }, [customerId, join, role, token]);

  useEffect(() => {
    let missedEvents = !socket.connected;
    const onDisconnect = () => {
      missedEvents = true;
    };
    const onConnect = () => {
      if (!missedEvents) return;
      missedEvents = false;
      reconnectRef.current?.();
    };
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    return () => {
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
    };
  }, []);

  useSocketEvent<Order>('order:new', (order) => {
    if (customerId && order.customerId !== customerId) return;
    onOrderNew?.(order);
  });
  useSocketEvent<Order>('order:updated', (order) => {
    if (customerId && order.customerId !== customerId) return;
    onOrderUpdated?.(order);
  });
  useSocketEvent<Partial<PublicStoreSettings>>('settings:updated', (settings) => onSettingsUpdated?.(settings));
  useSocketEvent<{ customerId: string; points: number }>('loyalty:updated', (payload) => {
    if (!customerId || payload.customerId === customerId) onLoyaltyUpdated?.(payload);
  });
  useSocketEvent<ChatMessage>('chat:message', (message) => onChatMessage?.(message));
}
