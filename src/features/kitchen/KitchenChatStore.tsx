import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../../types';
import { kitchenApi as api } from '../../lib/api';
import { useKitchenToast } from './KitchenNotificationsStore';
import { useKitchenSettings } from './KitchenSettingsStore';

interface KitchenChatContextType {
  openOrderId: string | null;
  messages: ChatMessage[];
  loadingThread: boolean;
  sending: boolean;
  unread: Record<string, number>;
  totalUnread: number;
  openThread: (orderId: string) => void;
  closeThread: () => void;
  sendMessage: (text: string) => Promise<void>;
}

interface KitchenChatSyncContextType {
  receiveMessage: (message: ChatMessage) => void;
}

const KitchenChatContext = createContext<KitchenChatContextType | undefined>(undefined);
const KitchenChatSyncContext = createContext<KitchenChatSyncContextType | undefined>(undefined);

export const KitchenChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const triggerToast = useKitchenToast();
  const { settings } = useKitchenSettings();
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);

  // A conversa aberta e o nome da loja são lidos por refs: o handler do socket e
  // o envio vivem fora do render e não podem capturar um valor antigo.
  const openOrderIdRef = useRef<string | null>(openOrderId);
  openOrderIdRef.current = openOrderId;
  const storeNameRef = useRef(settings.storeName);
  storeNameRef.current = settings.storeName;

  const appendMessage = useCallback((message: ChatMessage) => {
    setThreads((previous) => {
      const thread = previous[message.orderId] || [];
      if (thread.some((item) => item.id === message.id)) return previous;
      return { ...previous, [message.orderId]: [...thread, message] };
    });
  }, []);

  const receiveMessage = useCallback(
    (message: ChatMessage) => {
      appendMessage(message);
      if (message.sender === 'store') return;
      if (openOrderIdRef.current === message.orderId) return;
      setUnread((previous) => ({ ...previous, [message.orderId]: (previous[message.orderId] || 0) + 1 }));
      triggerToast(`💬 Nova mensagem no pedido ${message.orderId}.`);
    },
    [appendMessage, triggerToast]
  );

  const openThread = useCallback((orderId: string) => {
    setOpenOrderId(orderId);
    openOrderIdRef.current = orderId;
    setUnread((previous) => {
      if (!previous[orderId]) return previous;
      const next = { ...previous };
      delete next[orderId];
      return next;
    });
    setLoadingThread(true);
    api
      .get<ChatMessage[]>(`/orders/${orderId}/chat`)
      .then((history) => setThreads((previous) => ({ ...previous, [orderId]: history })))
      .catch(() => {})
      .finally(() => setLoadingThread(false));
  }, []);

  const closeThread = useCallback(() => {
    setOpenOrderId(null);
    openOrderIdRef.current = null;
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const orderId = openOrderIdRef.current;
      const body = text.trim();
      if (!orderId || !body) return;
      setSending(true);
      try {
        const message = await api.post<ChatMessage>(`/orders/${orderId}/chat`, {
          sender: 'store',
          senderName: storeNameRef.current,
          text: body,
        });
        appendMessage(message);
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao enviar a mensagem.');
      } finally {
        setSending(false);
      }
    },
    [appendMessage, triggerToast]
  );

  const messages = useMemo(
    () => (openOrderId ? threads[openOrderId] || [] : []),
    [openOrderId, threads]
  );

  const totalUnread = useMemo(
    () => Object.keys(unread).reduce((sum, orderId) => sum + unread[orderId], 0),
    [unread]
  );

  const value = useMemo<KitchenChatContextType>(
    () => ({
      openOrderId,
      messages,
      loadingThread,
      sending,
      unread,
      totalUnread,
      openThread,
      closeThread,
      sendMessage,
    }),
    [openOrderId, messages, loadingThread, sending, unread, totalUnread, openThread, closeThread, sendMessage]
  );

  const sync = useMemo<KitchenChatSyncContextType>(() => ({ receiveMessage }), [receiveMessage]);

  return (
    <KitchenChatSyncContext.Provider value={sync}>
      <KitchenChatContext.Provider value={value}>{children}</KitchenChatContext.Provider>
    </KitchenChatSyncContext.Provider>
  );
};

export const useKitchenChat = () => {
  const context = useContext(KitchenChatContext);
  if (!context) throw new Error('useKitchenChat deve ser usado dentro de KitchenProvider');
  return context;
};

export const useKitchenChatSync = () => {
  const context = useContext(KitchenChatSyncContext);
  if (!context) throw new Error('useKitchenChatSync deve ser usado dentro de KitchenProvider');
  return context;
};
