import React from 'react';
import { createPortal } from 'react-dom';
import { X, Printer } from 'lucide-react';
import { Order } from '../../types';
import { isPickup } from '../../shared/fulfillment';
import { needsCardMachine, paymentLabel } from '../../shared/payment';
import { comboChoiceLines } from '../../shared/comboChoices';

interface OrderReceiptModalProps {
  order: Order;
  storeName: string;
  storeCity?: string;
  storeLogo?: string;
  onClose: () => void;
}

/** Larguras de rolo térmico usuais. A área útil é sempre menor que o papel. */
const PAPER_WIDTHS = [58, 80] as const;
type PaperWidth = (typeof PAPER_WIDTHS)[number];
const PAPER_STORAGE_KEY = 'caldinho:receiptPaperWidth';
const LAYOUT_STORAGE_KEY = 'caldinho:receiptLayout';

/**
 * Três modelos de cupom. A diferença é só de forma — nenhum deles esconde
 * dado do pedido, senão a escolha viraria uma armadilha.
 */
const LAYOUTS = [
  { value: 'compacto', label: 'Compacto', hint: 'Logo pequeno ao lado do nome. Gasta menos papel.' },
  { value: 'classico', label: 'Clássico', hint: 'Logo grande e centralizado, nome em destaque.' },
  { value: 'ampliado', label: 'Ampliado', hint: 'Mesma forma do compacto, com letra maior.' },
] as const;
type ReceiptLayout = (typeof LAYOUTS)[number]['value'];

const WIDTH_OPTIONS = PAPER_WIDTHS.map((width) => ({ value: String(width), label: `${width}mm` }));

/** localStorage falha em modo anônimo ou cheio: a escolha só não persiste. */
const remember = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* silêncio proposital */
  }
};

const readStoredPaper = (): PaperWidth => {
  if (typeof window === 'undefined') return 80;
  const stored = Number(window.localStorage.getItem(PAPER_STORAGE_KEY));
  return PAPER_WIDTHS.includes(stored as PaperWidth) ? (stored as PaperWidth) : 80;
};

const readStoredLayout = (): ReceiptLayout => {
  if (typeof window === 'undefined') return 'compacto';
  const stored = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
  return LAYOUTS.some((item) => item.value === stored) ? (stored as ReceiptLayout) : 'compacto';
};

/** Seletor em pílulas: rótulo à esquerda, opções à direita, sempre alinhados. */
const Segmented: React.FC<{
  label: string;
  options: readonly { value: string; label: string; hint?: string }[];
  value: string;
  onChange: (value: string) => void;
}> = ({ label, options, value, onChange }) => (
  <div className="flex items-center gap-2">
    <span className="w-[3.4rem] shrink-0 text-[10px] font-bold text-[#57534E]">{label}</span>
    <div className="flex rounded-full bg-[#F5F5F4] p-0.5" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          title={option.hint}
          className={`rounded-full px-3 py-1 text-[10px] font-extrabold transition ${
            value === option.value ? 'bg-[#1C1917] text-white' : 'text-[#57534E] hover:text-[#1C1917]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  </div>
);

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

/** Rótulo curto à esquerda, valor à direita: as colunas alinham e o olho
    varre um campo por vez sem precisar de uma linha divisória entre eles. */
const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex gap-1.5">
    <span className="receipt-sm w-[5.8em] shrink-0">{label}</span>
    <span className="min-w-0 flex-1 break-words">{children}</span>
  </div>
);

/** Bloco de dado: rótulo curto em cima, valor embaixo — para texto longo. */
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="break-words">
    <span className="receipt-sm">{label} </span>
    {children}
  </div>
);

/** Real brasileiro: vírgula decimal. Tolera pedido antigo com campo faltando. */
const money = (n: unknown): string =>
  `R$ ${(typeof n === 'number' && isFinite(n) ? n : 0).toFixed(2).replace('.', ',')}`;

const ReceiptBody: React.FC<{
  order: Order;
  storeName: string;
  storeCity: string;
  storeLogo: string;
  layout: ReceiptLayout;
}> = ({ order, storeName, storeCity, storeLogo, layout }) => {
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
  const itemCount = items.reduce((sum, it) => sum + (it.quantity || 0), 0);
  const headerCity = storeCity || address?.city || '';

  return (
    <div className="receipt">
      {/* Identidade da loja. No Clássico o logo é grande e centralizado; nos
          outros ele fica pequeno à esquerda com o nome ao lado — um cabeçalho
          de uma linha só, que come bem menos rolo. Sem logo, o nome centraliza. */}
      {layout === 'classico' ? (
        <>
          {storeLogo && <img src={storeLogo} alt="" className="receipt-logo" />}
          <div className="receipt-lg text-center uppercase tracking-wide break-words">{storeName}</div>
          {headerCity && <div className="receipt-sm text-center uppercase">{headerCity}</div>}
        </>
      ) : (
        <div className="flex items-center gap-2">
          {storeLogo && <img src={storeLogo} alt="" className="receipt-logo-inline" />}
          <div className={`min-w-0 flex-1 ${storeLogo ? '' : 'text-center'}`}>
            <div className="receipt-lg uppercase leading-tight break-words">{storeName}</div>
            {headerCity && <div className="receipt-sm uppercase">{headerCity}</div>}
          </div>
        </div>
      )}

      <Rule />

      {/* Nº do pedido: é o que a cozinha e o entregador procuram primeiro. */}
      <div className="receipt-xl text-center tracking-wider break-all">{order.id}</div>
      <div className="receipt-sm text-center">
        {fmtDate} · {fmtTime}
      </div>
      {/* Tipo de entrega em destaque: erro aqui manda o motoboy para o lugar errado. */}
      <div className="receipt-lg mt-1 text-center uppercase tracking-wide">
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

      <Rule strong />

      {/* Quem recebe e onde. Os rótulos alinhados dispensam divisórias aqui. */}
      <div className="space-y-0.5">
        <Row label="CLIENTE">{order.customerName}</Row>
        {order.customerPhone && (
          <Row label="FONE">
            <span className="tabular-nums">{order.customerPhone}</span>
          </Row>
        )}
        {!pickupOrder && (
          <Row label="ENDEREÇO">
            {address ? (
              <>
                <div>
                  {address.street}, {address.number}
                </div>
                {address.neighborhood && <div>{address.neighborhood}</div>}
                {address.complement && <div>{address.complement}</div>}
              </>
            ) : (
              '(não informado)'
            )}
          </Row>
        )}
      </div>

      <Rule />

      <div className="receipt-sm">ITENS ({itemCount})</div>
      <div className="mt-1 space-y-1.5">
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
                {comboChoiceLines(it.comboChoices).join(' | ')}
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

      {/* Somas coladas na lista, separadas só por respiro. */}
      <div className="mt-2 space-y-0.5">
        <Line label="Subtotal" value={money(order.subtotal)} size="receipt-sm" />
        {order.discount > 0 && (
          <Line label="Desconto" value={`- ${money(order.discount)}`} size="receipt-sm" />
        )}
        <Line
          label={pickupOrder ? 'Retirada' : 'Entrega'}
          value={order.deliveryFee > 0 ? money(order.deliveryFee) : 'GRÁTIS'}
          size="receipt-sm"
        />
      </div>

      <Rule strong />
      <Line label="TOTAL" value={money(order.total)} size="receipt-xl" />

      <div className="mt-2 space-y-0.5">
        <Row label="PAGAMENTO">
          <span className="uppercase">{payment ? paymentLabel(payment, order.fulfillment) : '—'}</span>
        </Row>
        {!!payment?.changeForAmount && (
          <Row label="TROCO">
            <span className="tabular-nums">para {money(payment.changeForAmount)}</span>
          </Row>
        )}
      </div>

      {/* Quanto o entregador tem que receber — a linha mais consultada na porta. */}
      {amountDue > 0 && (
        <div className="receipt-box receipt-lg text-center uppercase">
          A receber {money(amountDue)}
        </div>
      )}
      {!isCancelled && payment?.isPaid && <div className="receipt-lg mt-1 text-center uppercase">— Pago —</div>}

      {!!payment && needsCardMachine(payment) && !isCancelled && (
        <div className="receipt-box receipt-lg text-center uppercase">Levar maquininha</div>
      )}

      {isCancelled && payment?.refundStatus === 'pendente' && (
        <div className="receipt-box receipt-lg text-center uppercase">
          Devolver {money(order.total)} ao cliente
        </div>
      )}
      {isCancelled && payment?.refundStatus === 'devolvido' && (
        <div className="receipt-sm mt-1 text-center">Valor já devolvido ao cliente.</div>
      )}
      {isCancelled && payment?.refundStatus === 'falhou' && (
        <div className="receipt-box receipt-lg text-center uppercase">
          Devolução falhou — devolver {money(order.total)} à mão
        </div>
      )}

      <Rule />

      {(obs || order.driverName) && (
        <div className="mb-1 space-y-1">
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
        </div>
      )}

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

export const OrderReceiptModal: React.FC<OrderReceiptModalProps> = ({
  order,
  storeName,
  storeCity = '',
  storeLogo = '',
  onClose,
}) => {
  const [printing, setPrinting] = React.useState(false);
  const [paperWidth, setPaperWidth] = React.useState<PaperWidth>(readStoredPaper);
  const [layout, setLayout] = React.useState<ReceiptLayout>(readStoredLayout);
  const printGuard = React.useRef(false);

  const chooseWidth = (width: PaperWidth) => {
    setPaperWidth(width);
    remember(PAPER_STORAGE_KEY, String(width));
  };

  const chooseLayout = (next: ReceiptLayout) => {
    setLayout(next);
    remember(LAYOUT_STORAGE_KEY, next);
  };

  const layoutHint = LAYOUTS.find((item) => item.value === layout)?.hint ?? '';

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
    /* Inset em cima e embaixo com piso de 1rem (o `p-4` do desenho): no tablet
       da cozinha em modo instalado o cabeçalho do modal nascia debaixo do
       relógio e o botão "Imprimir" ficava sob a barra de gestos.
       Nada disto chega ao papel: a regra de impressão zera o padding deste
       elemento com `!important` e solta a altura do modal. */
    <div className="receipt-print-root fixed inset-0 z-[90] bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
      {/* @page não lê variável CSS, então a regra da largura do rolo é injetada
          aqui e trocada junto com o seletor 58/80mm. `size: <w> auto` deixa o
          rolo cortar no fim do conteúdo em vez de cuspir uma folha inteira. */}
      <style>{`@media print { @page { size: ${paperWidth}mm auto; margin: 0; } html, body { width: ${paperWidth}mm !important; } }`}</style>

      {/* `max-h-full` (a caixa preta já sem os insets) no lugar de `92vh`: no
          Safari `vh` mede a janela sem a barra de endereço, e a barra de botões
          do rodapé caía abaixo da dobra. Na impressão vira `none !important`. */}
      <div className="receipt-modal bg-white rounded-2xl overflow-hidden max-h-full flex flex-col w-full max-w-md">
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
            className="tap-44 shrink-0 p-2 rounded-full hover:bg-[#F5F5F4] text-[#57534E]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="receipt-no-print shrink-0 space-y-2 border-b border-[#E7E5E4] px-4 py-3">
          <Segmented label="Modelo" options={LAYOUTS} value={layout} onChange={(value) => chooseLayout(value as ReceiptLayout)} />
          <Segmented
            label="Papel"
            options={WIDTH_OPTIONS}
            value={String(paperWidth)}
            onChange={(value) => chooseWidth(Number(value) as PaperWidth)}
          />
          {layoutHint && <p className="pl-[3.9rem] text-[10px] leading-snug text-[#A8A29E]">{layoutHint}</p>}
        </div>

        <div className="receipt-scroll overflow-y-auto bg-[#E7E5E4] p-4 flex justify-center">
          <div
            className={`print-area max-w-full bg-white px-3 py-4 shadow-md ${
              paperWidth === 58 ? 'receipt-narrow' : ''
            } ${layout === 'ampliado' ? 'receipt-airy' : ''}`}
            style={{ ['--receipt-w' as string]: `${paperWidth}mm`, width: `${paperWidth}mm` }}
          >
            <ReceiptBody
              order={order}
              storeName={storeName}
              storeCity={storeCity}
              storeLogo={storeLogo}
              layout={layout}
            />
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
