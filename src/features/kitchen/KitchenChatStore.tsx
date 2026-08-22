import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../../../contract/order/types';
import { kitchenApi as api } from '../../lib/api';
import { chatAlertFor } from '../../../contract/order/alerts';
import { useKitchenToast } from './KitchenNotificationsStore';
import { useKitchenSettings } from './KitchenSettingsStore';
import { useKitchenSoundAlert } from './KitchenSoundStore';

interface KitchenChatContextType {
  openOrderId: string | null;
  messages: ChatMessage[];
  loadingThread: boolean;
  /** erro ao carregar a conversa aberta — some assim que ela carrega uma vez. */
  error: string | null;
  sending: boolean;
  unread: Record<string, number>;
  totalUnread: number;
  openThread: (orderId: string) => void;
  closeThread: () => void;
  sendMessage: (text: string) => Promise<void>;
  /** tenta carregar de novo a conversa aberta. */
  reload: () => void;
}

interface KitchenChatSyncContextType {
  receiveMessage: (message: ChatMessage) => void;
}

const KitchenChatContext = createContext<KitchenChatContextType | undefined>(undefined);
const KitchenChatSyncContext = createContext<KitchenChatSyncContextType | undefined>(undefined);

export const KitchenChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const triggerToast = useKitchenToast();
  const { deliver } = useKitchenSoundAlert();
  const { settings } = useKitchenSettings();
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      // A conversa aberta na tela não vira alerta nem contador: a mensagem já
      // apareceu na frente de quem ia ser avisado.
      if (openOrderIdRef.current === message.orderId) return;
      // O contador é estado, não alerta: ele fica no crachá até alguém abrir.
      setUnread((previous) => ({ ...previous, [message.orderId]: (previous[message.orderId] || 0) + 1 }));
      deliver(chatAlertFor('kitchen', message));
    },
    [appendMessage, deliver]
  );

  const loadThread = useCallback((orderId: string) => {
    setLoadingThread(true);
    setError(null);
    api
      .get<ChatMessage[]>(`/orders/${orderId}/chat`)
      .then((history) => {
        setThreads((previous) => ({ ...previous, [orderId]: history }));
        setError(null);
      })
      .catch(() => {
        // Não apaga mensagens que já estavam na tela (ex.: reabrir a conversa) —
        // só avisa que a lista pode estar incompleta e oferece tentar de novo.
        setError('Não deu para carregar essa conversa. Confira a conexão e tente de novo.');
      })
      .finally(() => setLoadingThread(false));
  }, []);

  const openThread = useCallback(
    (orderId: string) => {
      setOpenOrderId(orderId);
      openOrderIdRef.current = orderId;
      setUnread((previous) => {
        if (!previous[orderId]) return previous;
        const next = { ...previous };
        delete next[orderId];
        return next;
      });
      loadThread(orderId);
    },
    [loadThread]
  );

  const closeThread = useCallback(() => {
    setOpenOrderId(null);
    openOrderIdRef.current = null;
    setError(null);
  }, []);

  const reload = useCallback(() => {
    if (openOrderIdRef.current) loadThread(openOrderIdRef.current);
  }, [loadThread]);

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
      error,
      sending,
      unread,
      totalUnread,
      openThread,
      closeThread,
      sendMessage,
      reload,
    }),
    [
      openOrderId,
      messages,
      loadingThread,
      error,
      sending,
      unread,
      totalUnread,
      openThread,
      closeThread,
      sendMessage,
      reload,
    ]
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
