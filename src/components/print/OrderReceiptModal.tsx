import React from 'react';
import { createPortal } from 'react-dom';
import { X, Printer } from 'lucide-react';
import { Order } from '../../types';
import { isPickup } from '../../shared/fulfillment';
import { needsCardMachine, paymentLabel } from '../../shared/payment';

interface OrderReceiptModalProps {
  order: Order;
  storeName: string;
  onClose: () => void;
}

/** Larguras de rolo térmico usuais. A área útil é sempre menor que o papel. */
const PAPER_WIDTHS = [58, 80] as const;
type PaperWidth = (typeof PAPER_WIDTHS)[number];
const PAPER_STORAGE_KEY = 'caldinho:receiptPaperWidth';

const readStoredPaper = (): PaperWidth => {
  if (typeof window === 'undefined') return 80;
  const stored = Number(window.localStorage.getItem(PAPER_STORAGE_KEY));
  return PAPER_WIDTHS.includes(stored as PaperWidth) ? (stored as PaperWidth) : 80;
};

const Rule: React.FC<{ strong?: boolean }> = ({ strong }) => (
  <div className={strong ? 'receipt-rule-strong' : 'receipt-rule'} />
);

/** Linha rótulo/valor: o valor nunca quebra, o rótulo cede espaço. */
const Line: React.FC<{
  label: React.ReactNode;
  value: React.ReactNode;
  size?: string;
  hang?: boolean;
}> = ({ label, value, size = '', hang }) => (
  <div className={`flex justify-between gap-2 ${size}`}>
    <span className={`min-w-0 break-words ${hang ? 'receipt-hang' : ''}`}>{label}</span>
    <span className="shrink-0 whitespace-nowrap tabular-nums">{value}</span>
  </div>
);

/** Bloco de dado: rótulo curto em cima, valor embaixo, sem quebra feia no meio. */
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="break-words">
    <span className="receipt-sm">{label} </span>
    {children}
  </div>
);

/** Real brasileiro: vírgula decimal. Tolera pedido antigo com campo faltando. */
const money = (n: unknown): string =>
  `R$ ${(typeof n === 'number' && isFinite(n) ? n : 0).toFixed(2).replace('.', ',')}`;

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
  const pickupOrder = isPickup(order);
  const cancelledAt = order.cancelledAt ? new Date(order.cancelledAt) : null;
  const amountDue = !isCancelled && !payment?.isPaid ? order.total : 0;

  return (
    <div className="receipt">
      {/* Cabeçalho: nome da loja é o maior bloco de texto do cupom. */}
      <div className="receipt-lg text-center uppercase tracking-wide break-words">{storeName}</div>
      {address?.city && <div className="receipt-sm text-center uppercase">{address.city}</div>}

      <Rule strong />

      {/* Nº do pedido: é o que a cozinha e o entregador procuram primeiro. */}
      <div className="receipt-xl text-center tracking-wider break-all">{order.id}</div>
      <div className="receipt-sm text-center">
        {fmtDate} às {fmtTime}
      </div>

      <Rule />

      {/* Tipo de entrega em destaque: erro aqui manda o motoboy para o lugar errado. */}
      <div className="receipt-lg text-center uppercase">
        {pickupOrder ? 'Retirada na loja' : 'Entrega'}
        {!pickupOrder && distanceKm > 0 && (
          <span className="receipt-sm normal-case"> · {distanceKm.toFixed(1).replace('.', ',')} km</span>
        )}
      </div>

      {isCancelled && (
        <div className="receipt-box receipt-lg text-center uppercase">
          Pedido cancelado
          {cancelledAt && (
            <div className="receipt-sm normal-case">
              Em {cancelledAt.toLocaleDateString('pt-BR')} às{' '}
              {cancelledAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              {' · '}
              {order.cancelledBy === 'cliente' ? 'pelo cliente' : order.cancelledBy === 'loja' ? 'pela loja' : '—'}
            </div>
          )}
          {order.cancellationReason && (
            <div className="receipt-sm normal-case break-words">Motivo: {order.cancellationReason}</div>
          )}
        </div>
      )}

      <Rule />

      <Field label="CLIENTE">
        <div className="break-words">{order.customerName}</div>
      </Field>
      {order.customerPhone && <div className="tabular-nums">{order.customerPhone}</div>}

      {!pickupOrder && (
        <div className="mt-1">
          <Field label="ENDEREÇO">
            {address ? (
              <>
                <div className="break-words">
                  {address.street}, {address.number}
                </div>
                {address.neighborhood && <div className="break-words">{address.neighborhood}</div>}
                {address.complement && <div className="break-words">{address.complement}</div>}
              </>
            ) : (
              <div>(não informado)</div>
            )}
          </Field>
        </div>
      )}

      <Rule strong />

      <div className="space-y-1.5">
        {items.map((it) => (
          <div key={it.id}>
            <Line
              label={
                <>
                  {it.quantity}x {it.product?.name || 'Item'}
                  {it.isFree && ' (GRÁTIS)'}
                </>
              }
              value={money(it.itemTotalPrice)}
              hang
            />
            {it.size && <div className="receipt-sm pl-3">{it.size}</div>}
            {it.comboChoices && it.comboChoices.length > 0 && (
              <div className="receipt-sm pl-3 break-words">
                {it.comboChoices.map((c) => `${c.slotLabel}: ${c.optionLabel}`).join(' | ')}
              </div>
            )}
            {it.selectedExtras && it.selectedExtras.length > 0 && (
              <div className="receipt-sm pl-3 break-words">
                + {it.selectedExtras.map((e) => e.name).join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>

      <Rule />

      <Line label="Subtotal" value={money(order.subtotal)} size="receipt-sm" />
      {order.discount > 0 && (
        <Line label="Desconto" value={`- ${money(order.discount)}`} size="receipt-sm" />
      )}
      <Line
        label={pickupOrder ? 'Retirada' : 'Entrega'}
        value={order.deliveryFee > 0 ? money(order.deliveryFee) : 'GRÁTIS'}
        size="receipt-sm"
      />

      <Rule strong />
      <Line label="TOTAL" value={money(order.total)} size="receipt-xl" />
      <Rule strong />

      <Field label="PAGAMENTO">
        <div className="uppercase break-words">
          {payment ? paymentLabel(payment, order.fulfillment) : '—'}
        </div>
      </Field>
      {!!payment?.changeForAmount && <div className="receipt-sm">Troco para {money(payment.changeForAmount)}</div>}

      {/* Quanto o entregador tem que receber — a linha mais consultada na porta. */}
      {amountDue > 0 && (
        <div className="receipt-box receipt-lg text-center uppercase">
          A receber {money(amountDue)}
        </div>
      )}
      {!isCancelled && payment?.isPaid && <div className="receipt-lg text-center uppercase">— Pago —</div>}

      {!!payment && needsCardMachine(payment) && !isCancelled && (
        <div className="receipt-box receipt-lg text-center uppercase">Levar maquininha</div>
      )}

      {isCancelled && payment?.refundStatus === 'pendente' && (
        <div className="receipt-box receipt-lg text-center uppercase">
          Devolver {money(order.total)} ao cliente
        </div>
      )}
      {isCancelled && payment?.refundStatus === 'devolvido' && (
        <div className="receipt-sm text-center">Valor já devolvido ao cliente.</div>
      )}
      {isCancelled && payment?.refundStatus === 'falhou' && (
        <div className="receipt-box receipt-lg text-center uppercase">
          Devolução falhou — devolver {money(order.total)} à mão
        </div>
      )}

      {(obs || order.driverName) && <Rule />}
      {obs && (
        <Field label="OBSERVAÇÕES">
          <div className="break-words">{obs}</div>
        </Field>
      )}
      {order.driverName && (
        <Field label="ENTREGADOR">
          <div className="break-words">{order.driverName}</div>
        </Field>
      )}

      <Rule strong />

      {isCancelled ? (
        <div className="receipt-lg text-center uppercase">Não entregar</div>
      ) : (
        <>
          <div className="text-center uppercase">Obrigado pela preferência!</div>
          <div className="receipt-sm text-center">Acompanhe seu pedido no app</div>
        </>
      )}
    </div>
  );
};

export const OrderReceiptModal: React.FC<OrderReceiptModalProps> = ({ order, storeName, onClose }) => {
  const [printing, setPrinting] = React.useState(false);
  const [paperWidth, setPaperWidth] = React.useState<PaperWidth>(readStoredPaper);
  const printGuard = React.useRef(false);

  const chooseWidth = (width: PaperWidth) => {
    setPaperWidth(width);
    try {
      window.localStorage.setItem(PAPER_STORAGE_KEY, String(width));
    } catch {
      /* modo anônimo / storage cheio: a escolha só não persiste */
    }
  };

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

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="receipt-print-root fixed inset-0 z-[90] bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      {/* @page não lê variável CSS, então a regra da largura do rolo é injetada
          aqui e trocada junto com o seletor 58/80mm. `size: <w> auto` deixa o
          rolo cortar no fim do conteúdo em vez de cuspir uma folha inteira. */}
      <style>{`@media print { @page { size: ${paperWidth}mm auto; margin: 0; } html, body { width: ${paperWidth}mm !important; } }`}</style>

      <div className="receipt-modal bg-white rounded-2xl overflow-hidden max-h-[92vh] flex flex-col w-full max-w-md">
        <div className="receipt-no-print flex items-start justify-between gap-3 px-4 py-3 border-b border-[#E7E5E4] shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-extrabold text-[#1C1917]">Cupom do pedido</h3>
              {order.status === 'cancelado' && (
                <span className="text-[10px] bg-[#B91C1C] text-white font-black px-2 py-0.5 rounded-full uppercase">
                  Cancelado
                </span>
              )}
            </div>
            <p className="text-[10px] text-[#57534E] truncate">Pedido {order.id}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 p-2 rounded-full hover:bg-[#F5F5F4] text-[#57534E]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="receipt-no-print flex items-center gap-2 px-4 py-2.5 border-b border-[#E7E5E4] shrink-0">
          <span className="text-[10px] font-bold text-[#57534E]">Largura do papel</span>
          <div className="flex rounded-full bg-[#F5F5F4] p-0.5" role="group">
            {PAPER_WIDTHS.map((width) => (
              <button
                key={width}
                onClick={() => chooseWidth(width)}
                aria-pressed={paperWidth === width}
                className={`px-3 py-1 rounded-full text-[10px] font-extrabold transition ${
                  paperWidth === width ? 'bg-[#1C1917] text-white' : 'text-[#57534E] hover:text-[#1C1917]'
                }`}
              >
                {width}mm
              </button>
            ))}
          </div>
        </div>

        <div className="receipt-scroll overflow-y-auto bg-[#E7E5E4] p-4 flex justify-center">
          <div
            className={`print-area bg-white px-3 py-4 max-w-full shadow-md ${
              paperWidth === 58 ? 'receipt-narrow' : ''
            }`}
            style={{ ['--receipt-w' as string]: `${paperWidth}mm`, width: `${paperWidth}mm` }}
          >
            <ReceiptBody order={order} storeName={storeName} />
          </div>
        </div>

        <div className="receipt-no-print shrink-0 p-4 border-t border-[#E7E5E4] flex gap-2">
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
