import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, Clock, Inbox, MessageCircle } from 'lucide-react';
import type { Order } from '../../types';
import { useKitchenOrders } from './KitchenOrdersStore';
import { useKitchenChat } from './KitchenChatStore';
import { Heading, Panel, Empty } from './KitchenPanels';
import { useNow } from './useNow';
import {
  cancelRequestDeadline,
  countdownLabel,
  hasOpenComplaint,
  hasPendingCancelRequest,
  isCancelRequestOverdue,
  isOrderLate,
  money,
  shortDateTime,
} from './kitchenOrderRules';

type ResolveMode = 'accept' | 'refuse';

export const KitchenRequestsPanel: React.FC = () => {
  const { orders, busyOrderId, resolveCancelRequest, resolveComplaint } = useKitchenOrders();
  const { unread, totalUnread, openThread } = useKitchenChat();
  const now = useNow();
  const [resolving, setResolving] = useState<{ order: Order; mode: ResolveMode } | null>(null);

  const requests = useMemo(
    () =>
      orders
        .filter(hasPendingCancelRequest)
        .sort(
          (a, b) =>
            new Date(a.cancellationRequest!.requestedAt).getTime() -
            new Date(b.cancellationRequest!.requestedAt).getTime()
        ),
    [orders]
  );

  const complaints = useMemo(
    () =>
      orders
        .filter(hasOpenComplaint)
        .sort((a, b) => new Date(b.complaint!.openedAt).getTime() - new Date(a.complaint!.openedAt).getTime()),
    [orders]
  );

  const unreadOrders = useMemo(
    () => orders.filter((order) => (unread[order.id] || 0) > 0),
    [orders, unread]
  );

  const subtitle = `${requests.length} cancelamento(s), ${complaints.length} reclamação(ões), ${totalUnread} mensagem(ns) não lida(s).`;

  return (
    <div className="space-y-4">
      <Heading icon={<Inbox />} title="Solicitações" subtitle={subtitle} />

      <Panel title="Pedidos de cancelamento">
        <div className="space-y-3">
          {requests.map((order) => (
            <CancelRequestRow
              key={order.id}
              order={order}
              now={now}
              busy={busyOrderId === order.id}
              onChat={() => openThread(order.id)}
              onAccept={() => setResolving({ order, mode: 'accept' })}
              onRefuse={() => setResolving({ order, mode: 'refuse' })}
            />
          ))}
          {requests.length === 0 && <Empty text="Nenhum cliente pediu cancelamento." />}
        </div>
      </Panel>

      <Panel title="Reclamações abertas">
        <div className="space-y-3">
          {complaints.map((order) => (
            <div key={order.id} className="rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-xs">{order.id}</strong>
                <span className="text-[11px] text-[#57534E]">{shortDateTime(order.complaint!.openedAt)}</span>
              </div>
              <div className="text-[11px] text-[#57534E]">
                {order.customerName} · {money(order.total)}
              </div>
              <p className="text-xs text-[#1C1917] italic">“{order.complaint!.text}”</p>
              <div className="flex gap-2">
                <button className="btn-secondary flex-1" onClick={() => openThread(order.id)}>
                  <MessageCircle className="w-3.5 h-3.5" />
                  Responder no chat
                </button>
                <button
                  className="btn-secondary flex-1"
                  disabled={busyOrderId === order.id}
                  onClick={() => void resolveComplaint(order.id)}
                >
                  <Check className="w-3.5 h-3.5" />
                  Marcar resolvida
                </button>
              </div>
            </div>
          ))}
          {complaints.length === 0 && <Empty text="Nenhuma reclamação aberta." />}
        </div>
      </Panel>

      <Panel title="Mensagens não lidas">
        <div className="space-y-2">
          {unreadOrders.map((order) => (
            <button
              key={order.id}
              onClick={() => openThread(order.id)}
              className="w-full flex items-center gap-2 py-2 border-b last:border-0 border-[#F5F5F4] text-xs text-left"
            >
              <span className="font-extrabold">{order.id}</span>
              <span className="flex-1 truncate text-[#57534E]">{order.customerName}</span>
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#B91C1C] text-white">
                {unread[order.id]}
              </span>
            </button>
          ))}
          {unreadOrders.length === 0 && <Empty text="Nenhuma mensagem nova." />}
        </div>
      </Panel>

      {resolving && (
        <ResolveRequestModal
          order={resolving.order}
          mode={resolving.mode}
          busy={busyOrderId === resolving.order.id}
          onClose={() => setResolving(null)}
          onConfirm={(note) => {
            void resolveCancelRequest(resolving.order.id, resolving.mode === 'accept', note);
            setResolving(null);
          }}
        />
      )}
    </div>
  );
};

const CancelRequestRow: React.FC<{
  order: Order;
  now: number;
  busy: boolean;
  onChat: () => void;
  onAccept: () => void;
  onRefuse: () => void;
}> = ({ order, now, busy, onChat, onAccept, onRefuse }) => {
  const request = order.cancellationRequest!;
  const overdue = isCancelRequestOverdue(order, now);
  const late = isOrderLate(order, now);
  const clock = countdownLabel(cancelRequestDeadline(request.requestedAt), now);

  return (
    <div
      className={`rounded-2xl border p-3 space-y-2 ${
        overdue ? 'border-[#FCA5A5] bg-[#FEF2F2]' : 'border-[#E7E5E4] bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <strong className="text-xs">{order.id}</strong>
        <span
          className={`flex items-center gap-1 text-[11px] font-extrabold ${
            overdue ? 'text-[#B91C1C]' : 'text-[#1C1917]'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          {overdue ? `Prazo vencido ${clock}` : `Responda em ${clock}`}
        </span>
      </div>

      <div className="text-[11px] text-[#57534E]">
        {order.customerName} · {money(order.total)} · pedido às {shortDateTime(order.createdAt)}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {late && (
          <span className="text-[9px] font-black uppercase px-2 py-1 rounded-full bg-[#FEF2F2] text-[#B91C1C]">
            Pedido atrasado
          </span>
        )}
        {order.payment.isPaid && (
          <span className="text-[9px] font-black uppercase px-2 py-1 rounded-full bg-[#ECFDF5] text-[#059669]">
            Pago
          </span>
        )}
        <span className="text-[9px] font-black uppercase px-2 py-1 rounded-full bg-[#F5F5F4] text-[#57534E]">
          {order.status.replace('_', ' ')}
        </span>
      </div>

      <p className="text-xs italic">“{request.reason}”</p>

      {order.payment.isPaid && (
        <p className="flex items-start gap-1.5 text-[11px] font-bold text-[#B91C1C]">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Aceitar vai gerar uma devolução de {money(order.total)}.
        </p>
      )}

      <div className="flex gap-2">
        <button className="btn-danger flex-1" disabled={busy} onClick={onAccept}>
          Aceitar
        </button>
        <button className="btn-secondary flex-1" disabled={busy} onClick={onRefuse}>
          Recusar
        </button>
        <button className="btn-secondary" onClick={onChat} title="Conversar com o cliente">
          <MessageCircle className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

const ResolveRequestModal: React.FC<{
  order: Order;
  mode: ResolveMode;
  busy: boolean;
  onClose: () => void;
  onConfirm: (note?: string) => void;
}> = ({ order, mode, busy, onClose, onConfirm }) => {
  const [note, setNote] = useState('');
  const accepting = mode === 'accept';
  const ready = accepting || note.trim().length > 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    onConfirm(note.trim() || undefined);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-2xl p-5 w-full max-w-md space-y-3">
        <div>
          <h3 className="font-extrabold text-lg">
            {accepting ? 'Aceitar o cancelamento?' : 'Recusar o cancelamento?'}
          </h3>
          <p className="text-xs text-[#57534E]">
            {order.id} · {order.customerName} · {money(order.total)}
          </p>
        </div>

        {accepting ? (
          <div
            className={`rounded-2xl border p-3 text-xs font-bold leading-snug ${
              order.payment.isPaid
                ? 'border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]'
                : 'border-[#E7E5E4] bg-[#F5F5F4] text-[#57534E]'
            }`}
          >
            {order.payment.isPaid
              ? `Este pedido está pago. Cancelar vai gerar uma devolução de ${money(order.total)}.`
              : 'O pedido será cancelado. Não há dinheiro a devolver.'}
          </div>
        ) : (
          <>
            <p className="text-xs text-[#57534E]">A justificativa abaixo é mostrada ao cliente.</p>
            <textarea
              autoFocus
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Ex: o pedido já saiu para entrega"
              className="input w-full resize-none"
            />
          </>
        )}

        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>
            Voltar
          </button>
          <button className={accepting ? 'btn-danger flex-1' : 'btn-primary flex-1'} disabled={!ready || busy}>
            {busy ? 'Enviando...' : accepting ? 'Aceitar e cancelar' : 'Recusar'}
          </button>
        </div>
      </form>
    </div>
  );
};
