import React, { useEffect, useRef, useState } from 'react';
import { useClient } from './ClientStore';
import { api } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
import { X, Send } from 'lucide-react';
import { ChatMessage } from '../../types';

interface ChatModalProps {
  orderId: string;
  customerName?: string;
  onClose: () => void;
}

export const ChatModal: React.FC<ChatModalProps> = ({ orderId, customerName, onClose }) => {
  const { sendChatMessage } = useClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<ChatMessage[]>(`/orders/${orderId}/chat`).then(setMessages).catch(() => {});
  }, [orderId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  useSocketEvent<ChatMessage>('chat:message', (msg) => {
    if (msg.orderId !== orderId) return;
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
  });

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text) return;
    const optimistic: ChatMessage = {
      id: 'msg-local-' + Date.now(),
      orderId,
      sender: 'client',
      senderName: customerName?.trim() || 'Cliente',
      text,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInputText('');
    sendChatMessage(orderId, 'client', optimistic.senderName, text).catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end justify-center">
      <div className="bg-white text-[#1C1917] w-full max-w-[430px] h-full rounded-t-3xl border border-[#E7E5E4] shadow-2xl flex flex-col overflow-hidden relative">
        <div className="p-3.5 border-b border-[#E7E5E4] bg-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#B91C1C] flex items-center justify-center text-white font-bold text-xs">
              💬
            </div>
            <div>
              <h3 className="text-xs font-extrabold text-[#1C1917]">Chat do Pedido {orderId}</h3>
              <p className="text-[10px] text-[#57534E]">
                Comunicação direta com o Restaurante e Entregador
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[#F5F5F4] text-[#57534E] hover:text-[#1C1917]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div ref={listRef} className="p-4 flex-1 overflow-y-auto space-y-3 bg-[#F5F5F4]/40 text-xs">
          {messages.length === 0 ? (
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

        <form onSubmit={handleSend} className="p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] bg-white border-t border-[#E7E5E4] flex gap-2 shrink-0">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Escreva sua mensagem aqui..."
            className="flex-1 bg-[#F5F5F4] border border-[#E7E5E4] rounded-full px-4 py-2 text-xs text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
          />
          <button
            type="submit"
            className="bg-[#B91C1C] hover:bg-[#991B1B] text-white p-2.5 rounded-full font-bold shadow-xs transition"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
