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

const ReceiptBody: React.FC<{ order: Order; storeName: string }> = ({ order, storeName }) => {
  const date = new Date(order.createdAt);
  const fmtDate = date.toLocaleDateString('pt-BR');
  const fmtTime = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const obs = order.items.map((it) => it.observation).filter(Boolean).join(' | ');

  return (
    <div className="text-black font-mono text-[13px] leading-snug">
      <div className="text-center font-bold text-[16px] uppercase px-1">{storeName}</div>
      <div className="text-center text-[12px]">{order.address.city}</div>
      <Divider />

      <div className="font-bold text-[13px]">PEDIDO: {order.id}</div>
      <Line>
        <span>Data:</span>
        <span>
          {fmtDate} {fmtTime}
        </span>
      </Line>
      <Divider />

      <div className="text-[13px]">
        <div>
          <span className="font-bold">Cliente:</span> {order.customerName}
        </div>
        {order.customerPhone && <div>{order.customerPhone}</div>}
      </div>
      <div className="mt-0.5 break-words text-[13px]">
        <span className="font-bold">End:</span> {order.address.street}, {order.address.number}
        {order.address.neighborhood && <> - {order.address.neighborhood}</>}
        {order.address.complement && <div className="pl-4 italic">{order.address.complement}</div>}
      </div>
      {order.distanceKm > 0 && (
        <div className="text-[13px]">
          <span className="font-bold">Dist:</span> {order.distanceKm.toFixed(1)} km
        </div>
      )}
      <Divider />

      <div className="space-y-1">
        {order.items.map((it) => (
          <div key={it.id}>
            <Line>
              <span className="break-words pr-1">
                {it.quantity}x {it.product.name}
                {it.isFree && <span className="font-bold"> (GRATIS)</span>}
              </span>
              <span className="shrink-0">R$ {it.itemTotalPrice.toFixed(2)}</span>
            </Line>
            {it.size && <div className="pl-4 text-[12px]">{it.size}</div>}
            {it.comboChoices && it.comboChoices.length > 0 && (
              <div className="pl-4 text-[12px]">
                {it.comboChoices.map((c) => `${c.slotLabel}: ${c.optionLabel}`).join(' | ')}
              </div>
            )}
            {it.selectedExtras.length > 0 && (
              <div className="pl-4 text-[12px]">+ {it.selectedExtras.map((e) => e.name).join(', ')}</div>
            )}
          </div>
        ))}
      </div>
      <Divider />

      <Line>
        <span>Subtotal</span>
        <span>R$ {order.subtotal.toFixed(2)}</span>
      </Line>
      {order.discount > 0 && (
        <Line>
          <span>Desconto</span>
          <span>- R$ {order.discount.toFixed(2)}</span>
        </Line>
      )}
      <Line>
        <span>Entrega{order.distanceKm > 0 ? ` (${order.distanceKm.toFixed(1)} km)` : ''}</span>
        <span>{order.deliveryFee > 0 ? `R$ ${order.deliveryFee.toFixed(2)}` : 'GRATIS'}</span>
      </Line>
      <Line>
        <span className="font-bold text-[16px]">TOTAL</span>
        <span className="font-bold text-[16px]">R$ {order.total.toFixed(2)}</span>
      </Line>
      <Divider />

      <div className="text-[13px]">
        <span className="font-bold">Pagamento:</span> {order.payment.method.toUpperCase()}{' '}
        {order.payment.isPaid ? '(PAGO)' : '(PENDENTE)'}
        {order.payment.changeForAmount && (
          <div>Troco para: R$ {order.payment.changeForAmount.toFixed(2)}</div>
        )}
      </div>
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

      <div className="text-center font-bold uppercase text-[13px]">Obrigado pela preferencia!</div>
      <div className="text-center text-[12px]">Acompanhe seu pedido no app</div>
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
            <h3 className="text-sm font-extrabold text-[#1C1917]">Impressão Térmica</h3>
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
