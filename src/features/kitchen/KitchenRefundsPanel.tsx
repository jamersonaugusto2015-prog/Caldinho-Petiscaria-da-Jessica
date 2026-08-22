import React, { useMemo } from 'react';
import { AlertTriangle, Undo2 } from 'lucide-react';
import type { Order } from '../../../contract/order/types';
import { useKitchenOrders } from './KitchenOrdersStore';
import { Heading, Panel, Empty } from './KitchenPanels';
import { PAYMENT_METHOD_LABEL, owesRefund, refundFailed, shortDate, shortDateTime } from './kitchenOrderRules';
import { formatMoney } from '../../../contract/pricing/money';

export const KitchenRefundsPanel: React.FC = () => {
  const { orders, busyOrderId, refundOrder } = useKitchenOrders();

  const { pending, failed, done, pendingTotal } = useMemo(() => {
    const pendingList = orders.filter(owesRefund);
    const failedList = orders.filter(refundFailed);
    const doneList = orders
      .filter((order) => order.payment.refundStatus === 'devolvido')
      .sort((a, b) => (b.payment.refundedAt || '').localeCompare(a.payment.refundedAt || ''));
    return {
      pending: pendingList,
      failed: failedList,
      done: doneList,
      pendingTotal: [...pendingList, ...failedList].reduce((sum, order) => sum + order.total, 0),
    };
  }, [orders]);

  const queue = [...pending, ...failed];

  return (
    <div className="space-y-4">
      <Heading
        icon={<Undo2 />}
        title="A devolver"
        subtitle={`${queue.length} ${queue.length === 1 ? 'devolução' : 'devoluções'} em aberto · ${formatMoney(pendingTotal)}.`}
      />

      <Panel title="Devoluções em aberto">
        <div className="space-y-3">
          {queue.map((order) => (
            <RefundRow
              key={order.id}
              order={order}
              busy={busyOrderId === order.id}
              onRefund={() => void refundOrder(order.id)}
            />
          ))}
          {queue.length === 0 && <Empty text="Nenhum dinheiro a devolver." />}
        </div>
      </Panel>

      <Panel title="Já devolvidos">
        <div className="space-y-1">
          {done.map((order) => (
            <div
              key={order.id}
              className="flex items-center gap-2 py-2 border-b last:border-0 border-[#F5F5F4] text-xs"
            >
              <span className="font-extrabold">{order.id}</span>
              <span className="min-w-0 flex-1 truncate text-[#57534E]">{order.customerName}</span>
              <span className="text-[10px] text-[#57534E]">
                {order.payment.refundedAt ? `em ${shortDate(order.payment.refundedAt)}` : '—'}
              </span>
              <span className="font-extrabold text-[#059669]">{formatMoney(order.total)}</span>
            </div>
          ))}
          {done.length === 0 && <Empty text="Nenhuma devolução concluída ainda." />}
        </div>
      </Panel>
    </div>
  );
};

const RefundRow: React.FC<{ order: Order; busy: boolean; onRefund: () => void }> = ({
  order,
  busy,
  onRefund,
}) => {
  const failed = refundFailed(order);

  return (
    <div
      className={`rounded-2xl border p-3 space-y-2 ${
        failed ? 'border-[#FCA5A5] bg-[#FEF2F2]' : 'border-[#E7E5E4] bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <strong className="text-xs">{order.id}</strong>
        <span className="text-sm font-extrabold text-[#B91C1C]">{formatMoney(order.total)}</span>
      </div>
      <div className="text-[11px] text-[#57534E]">
        {order.customerName} · {PAYMENT_METHOD_LABEL[order.payment.method]}
        {order.cancelledAt && ` · cancelado em ${shortDateTime(order.cancelledAt)}`}
      </div>
      {order.payment.method === 'cash' && (
        <p className="text-[11px] text-[#57534E]">
          Não houve cobrança online: confirmar aqui só registra a devolução.
        </p>
      )}
      {failed && order.payment.refundError && (
        <p className="flex items-start gap-1.5 text-[11px] font-bold text-[#B91C1C]">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Falhou: {order.payment.refundError}
        </p>
      )}
      <button className="btn-primary w-full" disabled={busy} onClick={onRefund}>
        {busy ? 'Devolvendo…' : failed ? `Tentar de novo · ${formatMoney(order.total)}` : `Devolver ${formatMoney(order.total)}`}
      </button>
    </div>
  );
};
