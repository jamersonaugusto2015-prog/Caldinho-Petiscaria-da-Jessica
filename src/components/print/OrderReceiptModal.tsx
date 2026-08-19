import React from 'react';
import { createPortal } from 'react-dom';
import { X, Printer } from 'lucide-react';
import { Order } from '../../types';

interface OrderReceiptModalProps {
  order: Order;
  storeName: string;
  onClose: () => void;
}

const Divider: React.FC = () => (
  <div className="receipt-divider border-b border-dashed border-[#444] my-1.5" />
);

const Line: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex justify-between gap-2 text-[13px] leading-snug">{children}</div>
);

/** Formata em R$ mesmo quando o campo falta ou está corrompido num pedido antigo. */
const money = (n: unknown): string => (typeof n === 'number' && isFinite(n) ? n.toFixed(2) : '0.00');

const ReceiptBody: React.FC<{ order: Order; storeName: string }> = ({ order, storeName }) => {
  const date = new Date(order.createdAt);
  const fmtDate = date.toLocaleDateString('pt-BR');
  const fmtTime = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const items = Array.isArray(order.items) ? order.items : [];
  const address = order.address;
  const payment = order.payment;
  const distanceKm = typeof order.distanceKm === 'number' && order.distanceKm > 0 ? order.distanceKm : 0;
  const obs = items.map((it) => it.observation).filter(Boolean).join(' | ');
  const isCancelled = order.status === 'cancelado';
  const cancelledAtFmt = order.cancelledAt ? new Date(order.cancelledAt) : null;

  return (
    <div className="text-black font-mono text-[13px] leading-snug">
      <div className="text-center font-bold text-[16px] uppercase px-1">{storeName}</div>
      <div className="text-center text-[12px]">{address?.city || ''}</div>
      <Divider />

      <div className="font-bold text-[13px]">PEDIDO: {order.id}</div>
      <Line>
        <span>Data:</span>
        <span>
          {fmtDate} {fmtTime}
        </span>
      </Line>
      <Divider />

      {isCancelled && (
        <>
          <div className="bg-black text-white text-center font-bold text-[16px] uppercase py-1.5 my-1">
            *** PEDIDO CANCELADO ***
          </div>
          <div className="text-[13px]">
            {cancelledAtFmt && (
              <div>
                <span className="font-bold">Cancelado em:</span>{' '}
                {cancelledAtFmt.toLocaleDateString('pt-BR')}{' '}
                {cancelledAtFmt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
            <div>
              <span className="font-bold">Cancelado por:</span>{' '}
              {order.cancelledBy === 'cliente' ? 'Cliente' : order.cancelledBy === 'loja' ? 'Loja' : '—'}
            </div>
            <div className="break-words">
              <span className="font-bold">Motivo:</span> {order.cancellationReason || 'Não informado'}
            </div>
          </div>
          <Divider />
        </>
      )}

      <div className="text-[13px]">
        <div>
          <span className="font-bold">Cliente:</span> {order.customerName}
        </div>
        {order.customerPhone && <div>{order.customerPhone}</div>}
      </div>
      {address ? (
        <div className="mt-0.5 break-words text-[13px]">
          <span className="font-bold">End:</span> {address.street}, {address.number}
          {address.neighborhood && <> - {address.neighborhood}</>}
          {address.complement && <div className="pl-4 italic">{address.complement}</div>}
        </div>
      ) : (
        <div className="mt-0.5 text-[13px]">
          <span className="font-bold">End:</span> (não informado)
        </div>
      )}
      {distanceKm > 0 && (
        <div className="text-[13px]">
          <span className="font-bold">Dist:</span> {distanceKm.toFixed(1)} km
        </div>
      )}
      <Divider />

      <div className="space-y-1">
        {items.map((it) => (
          <div key={it.id}>
            <Line>
              <span className="break-words pr-1">
                {it.quantity}x {it.product?.name || 'Item'}
                {it.isFree && <span className="font-bold"> (GRATIS)</span>}
              </span>
              <span className="shrink-0">R$ {money(it.itemTotalPrice)}</span>
            </Line>
            {it.size && <div className="pl-4 text-[12px]">{it.size}</div>}
            {it.comboChoices && it.comboChoices.length > 0 && (
              <div className="pl-4 text-[12px]">
                {it.comboChoices.map((c) => `${c.slotLabel}: ${c.optionLabel}`).join(' | ')}
              </div>
            )}
            {it.selectedExtras && it.selectedExtras.length > 0 && (
              <div className="pl-4 text-[12px]">+ {it.selectedExtras.map((e) => e.name).join(', ')}</div>
            )}
          </div>
        ))}
      </div>
      <Divider />

      <Line>
        <span>Subtotal</span>
        <span>R$ {money(order.subtotal)}</span>
      </Line>
      {order.discount > 0 && (
        <Line>
          <span>Desconto</span>
          <span>- R$ {money(order.discount)}</span>
        </Line>
      )}
      <Line>
        <span>Entrega{distanceKm > 0 ? ` (${distanceKm.toFixed(1)} km)` : ''}</span>
        <span>{order.deliveryFee > 0 ? `R$ ${money(order.deliveryFee)}` : 'GRATIS'}</span>
      </Line>
      <Line>
        <span className="font-bold text-[16px]">TOTAL</span>
        <span className="font-bold text-[16px]">R$ {money(order.total)}</span>
      </Line>
      <Divider />

      <div className="text-[13px]">
        <span className="font-bold">Pagamento:</span> {(payment?.method || '—').toUpperCase()}{' '}
        {isCancelled
          ? payment?.isPaid
            ? '(PAGO — PEDIDO CANCELADO)'
            : '(NÃO COBRADO — PEDIDO CANCELADO)'
          : payment?.isPaid
          ? '(PAGO)'
          : '(PENDENTE)'}
        {!!payment?.changeForAmount && <div>Troco para: R$ {money(payment.changeForAmount)}</div>}
      </div>
      {isCancelled && payment?.refundStatus === 'pendente' && (
        <div className="bg-black text-white text-[13px] font-bold px-1.5 py-1 my-0.5">
          DEVOLVER R$ {money(order.total)} AO CLIENTE
        </div>
      )}
      {isCancelled && payment?.refundStatus === 'devolvido' && (
        <div className="text-[13px] font-bold">Valor já devolvido ao cliente.</div>
      )}
      {isCancelled && payment?.refundStatus === 'falhou' && (
        <div className="bg-black text-white text-[13px] font-bold px-1.5 py-1 my-0.5">
          DEVOLUÇÃO FALHOU — DEVOLVER R$ {money(order.total)} MANUALMENTE
        </div>
      )}
      {obs && (
        <div className="mt-0.5 break-words text-[13px]">
          <span className="font-bold">Obs:</span> {obs}
        </div>
      )}
      {order.driverName && (
        <div className="text-[13px]">
          <span className="font-bold">Entregador:</span> {order.driverName}
        </div>
      )}
      <Divider />

      {isCancelled ? (
        <div className="text-center font-bold uppercase text-[13px]">Não entregar — pedido cancelado</div>
      ) : (
        <>
          <div className="text-center font-bold uppercase text-[13px]">Obrigado pela preferencia!</div>
          <div className="text-center text-[12px]">Acompanhe seu pedido no app</div>
        </>
      )}
    </div>
  );
};

export const OrderReceiptModal: React.FC<OrderReceiptModalProps> = ({ order, storeName, onClose }) => {
  const [printing, setPrinting] = React.useState(false);
  const printGuard = React.useRef(false);

  const handlePrint = () => {
    // Evita impressões repetidas (duplo clique / múltiplas chamadas)
    if (printGuard.current || printing) return;
    printGuard.current = true;
    setPrinting(true);
    window.print();
    setTimeout(() => {
      printGuard.current = false;
      setPrinting(false);
    }, 1500);
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl overflow-hidden max-h-[92vh] flex flex-col w-full max-w-md">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#E7E5E4] shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-extrabold text-[#1C1917]">Impressão Térmica</h3>
              {order.status === 'cancelado' && (
                <span className="text-[10px] bg-[#B91C1C] text-white font-black px-2 py-0.5 rounded-full uppercase">
                  Cancelado
                </span>
              )}
            </div>
            <p className="text-[10px] text-[#57534E]">
              Cupom 80mm (1 página) • Pedido {order.id} — configure a impressora como "papel térmico 80mm"
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-[#F5F5F4] text-[#57534E]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto bg-[#E7E5E4] p-4 flex justify-center">
          <div className="print-area bg-white p-3 w-[80mm] max-w-full shadow-md">
            <ReceiptBody order={order} storeName={storeName} />
          </div>
        </div>

        <div className="shrink-0 p-4 border-t border-[#E7E5E4] flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-full bg-[#E7E5E4] text-[#1C1917] text-xs font-bold hover:bg-[#D6D3D1] transition"
          >
            Fechar
          </button>
          <button
            onClick={handlePrint}
            disabled={printing}
            className="flex-1 py-3 rounded-full bg-[#1C1917] text-white text-xs font-extrabold flex items-center justify-center gap-2 hover:bg-[#292524] transition disabled:opacity-60"
          >
            <Printer className="w-4 h-4" />
            {printing ? 'Imprimindo...' : 'Imprimir'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
