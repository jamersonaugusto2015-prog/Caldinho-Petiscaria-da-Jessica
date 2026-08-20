import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useCheckout } from './CheckoutStore';
import { api } from '../../lib/api';
import { useLiveSession } from '../../lib/liveSession';
import { chatAlertFor } from '../../shared/orderAlerts';
import { X, Send } from 'lucide-react';
import { ChatMessage } from '../../types';

interface ChatModalProps {
  orderId: string;
  customerName?: string;
  onClose: () => void;
}

export const ChatModal: React.FC<ChatModalProps> = ({ orderId, customerName, onClose }) => {
  const { sendChatMessage, customerId, alertChannel } = useCheckout();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sendError, setSendError] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);

  const loadThread = useCallback(
    (signal?: { cancelled: boolean }) => {
      setIsLoading(true);
      setLoadError(false);
      api
        .get<ChatMessage[]>(`/orders/${orderId}/chat?customerId=${encodeURIComponent(customerId)}`)
        .then((data) => {
          if (signal?.cancelled) return;
          setMessages(Array.isArray(data) ? data : []);
        })
        .catch(() => {
          if (!signal?.cancelled) setLoadError(true);
        })
        .finally(() => {
          if (!signal?.cancelled) setIsLoading(false);
        });
    },
    [orderId, customerId]
  );

  useEffect(() => {
    const signal = { cancelled: false };
    loadThread(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [loadThread]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  useLiveSession({
    join: false,
    onChatMessage: (msg) => {
      // Payload de socket não é garantido: protege contra evento malformado.
      if (!msg || !msg.id || msg.orderId !== orderId) return;
      // Ignora o eco das próprias mensagens (elas já entraram de forma otimista)
      if (msg.sender === 'client') return;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      alertChannel.deliver(chatAlertFor('client', msg));
    },
    onReconnect: () => {
      // As mensagens enviadas enquanto o socket estava fora nunca chegam por
      // evento: sem recarregar, a loja responde e o cliente vê a tela parada.
      loadThread();
    },
  });

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    // Evita duplo envio em toque duplo (comum em celular com tela travando)
    if (sendingRef.current) return;
    const text = inputText.trim();
    if (!text) return;
    sendingRef.current = true;
    setSendError(false);
    const localId = 'msg-local-' + Date.now();
    const optimistic: ChatMessage = {
      id: localId,
      orderId,
      sender: 'client',
      senderName: customerName?.trim() || 'Cliente',
      text,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInputText('');
    sendChatMessage(orderId, 'client', optimistic.senderName, text)
      .catch(() => {
        // falha ao enviar: remove a mensagem otimista, devolve o texto e avisa o cliente
        setMessages((prev) => prev.filter((m) => m.id !== localId));
        setInputText(text);
        setSendError(true);
      })
      .finally(() => {
        sendingRef.current = false;
      });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end justify-center">
      <div className="bg-white text-[#1C1917] w-full max-w-[430px] h-full rounded-t-3xl border border-[#E7E5E4] shadow-2xl flex flex-col overflow-hidden relative">
        {/* `pt-safe`: a folha ocupa a tela inteira, então o cabeçalho nascia sob
            o relógio do iPhone — o número do pedido ficava escondido atrás da
            barra de status. */}
        <div className="p-3.5 pt-safe border-b border-[#E7E5E4] bg-white flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#B91C1C] flex items-center justify-center text-white font-bold text-xs">
              💬
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-xs font-extrabold text-[#1C1917]">Chat do Pedido {orderId}</h3>
              <p className="truncate text-[10px] text-[#57534E]">
                Comunicação direta com o Restaurante e Entregador
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Fechar o chat"
            className="relative shrink-0 p-1.5 rounded-full hover:bg-[#F5F5F4] text-[#57534E] hover:text-[#1C1917] before:absolute before:-inset-2 before:content-['']"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div ref={listRef} className="p-4 flex-1 overflow-y-auto overscroll-contain space-y-3 bg-[#F5F5F4]/40 text-xs">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-[#A8A29E] text-center">
              Carregando conversa...
            </div>
          ) : loadError ? (
            <div className="h-full flex items-center justify-center text-[#A8A29E] text-center">
              Não foi possível carregar as mensagens. Puxe pra baixo ou reabra o chat.
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[#A8A29E] text-center">
              Nenhuma mensagem ainda. Digite sua dúvida ou recado abaixo.
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.sender === 'client';
              return (
                <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  <div className="text-[9px] text-[#A8A29E] mb-0.5 px-1 font-semibold">
                    {msg.senderName} ({msg.timestamp})
                  </div>
                  <div
                    className={`max-w-[80%] p-3 rounded-2xl ${
                      isMe
                        ? 'bg-[#B91C1C] text-white rounded-tr-none'
                        : 'bg-white text-[#1C1917] border border-[#E7E5E4] rounded-tl-none shadow-xs'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <form onSubmit={handleSend} className="p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] bg-white border-t border-[#E7E5E4] flex flex-col gap-2 shrink-0">
          {sendError && (
            <p className="text-[10px] text-[#B91C1C] font-semibold px-1">
              Não foi possível enviar. Verifique sua internet e tente de novo.
            </p>
          )}
          <div className="flex gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Escreva sua mensagem aqui..."
            className="flex-1 bg-[#F5F5F4] border border-[#E7E5E4] rounded-full px-4 py-2 text-xs text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
          />
          {/* 36 px de alvo para enviar recado com o pedido na rua é pouco. Os
              44 px também esticam o campo ao lado (a linha é `stretch`), que
              tinha 30 px. */}
          <button
            type="submit"
            aria-label="Enviar mensagem"
            className="bg-[#B91C1C] hover:bg-[#991B1B] text-white min-h-11 min-w-11 flex items-center justify-center rounded-full font-bold shadow-xs transition"
          >
            <Send className="w-4 h-4" />
          </button>
          </div>
        </form>
      </div>
    </div>
  );
};
