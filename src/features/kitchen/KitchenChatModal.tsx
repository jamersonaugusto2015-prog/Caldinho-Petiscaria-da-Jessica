import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { useKitchenChat } from './KitchenChatStore';
import { useKitchenOrders } from './KitchenOrdersStore';
import { Empty } from './KitchenPanels';

const SENDER_LABEL: Record<string, string> = { client: 'Cliente', store: 'Loja', driver: 'Motoboy' };

export const KitchenChatModal: React.FC = () => {
  const { openOrderId, messages, loadingThread, sending, closeThread, sendMessage } = useKitchenChat();
  const { orders } = useKitchenOrders();
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDraft('');
  }, [openOrderId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  if (!openOrderId) return null;

  const order = orders.find((item) => item.id === openOrderId);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || sending) return;
    void sendMessage(draft);
    setDraft('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* No celular esta é uma folha colada no rodapé: `pb-safe` para o campo de
          escrever não ficar atrás da barra de gestos do iOS, e `dvh` no lugar de
          `vh` porque `vh` ignora a barra do Safari e a folha nascia alta demais. */}
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl flex flex-col h-[85dvh] sm:h-[75dvh] pb-safe">
        <div className="flex shrink-0 items-center gap-2 p-4 border-b border-[#E7E5E4]">
          <div className="w-9 h-9 rounded-2xl bg-[#B91C1C] text-white flex items-center justify-center shrink-0">
            <MessageCircle className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <strong className="block text-sm truncate">Conversa · {openOrderId}</strong>
            <span className="text-[11px] text-[#57534E] truncate block">
              {order ? order.customerName : 'Pedido não está mais na lista'}
            </span>
          </div>
          <button
            onClick={closeThread}
            // 28px de alvo: fechar a conversa com o dedo acertava o nome do cliente.
            className="flex shrink-0 items-center justify-center rounded-full p-1.5 hover:bg-[#F5F5F4] pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* `overscroll-contain`: chegar ao fim da conversa e continuar puxando
            arrastava a página atrás da folha (e disparava o recarregar do Safari). */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 space-y-2 bg-[#F5F5F4]">
          {loadingThread && messages.length === 0 && <Empty text="Carregando a conversa..." />}
          {!loadingThread && messages.length === 0 && <Empty text="Nenhuma mensagem ainda." />}
          {messages.map((message) => {
            const mine = message.sender === 'store';
            return (
              <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs ${
                    mine
                      ? 'bg-[#B91C1C] text-white'
                      : 'bg-white border border-[#E7E5E4] text-[#1C1917]'
                  }`}
                >
                  <span className={`block text-[9px] font-black uppercase tracking-wider ${mine ? 'text-white/70' : 'text-[#A8A29E]'}`}>
                    {SENDER_LABEL[message.sender] || message.sender} · {message.timestamp}
                  </span>
                  <span className="block mt-0.5 whitespace-pre-wrap break-words">{message.text}</span>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        <form onSubmit={submit} className="flex shrink-0 gap-2 p-3 border-t border-[#E7E5E4]">
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Escreva para o cliente"
            maxLength={500}
            className="input min-w-0 flex-1"
          />
          <button className="btn-primary shrink-0" disabled={!draft.trim() || sending}>
            {sending ? 'Enviando...' : 'Enviar'}
          </button>
        </form>
      </div>
    </div>
  );
};
