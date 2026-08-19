import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react';
import {
  AlertTriangle,
  Ban,
  Bike,
  ChevronDown,
  Clock,
  GripVertical,
  MapPin,
  MessageCircle,
  MessagesSquare,
  Minimize2,
  Printer,
  Search,
  Star,
  Store,
  X,
} from 'lucide-react';
import type { Order, OrderStatus } from '../../types';
import { STATUS_ORDER } from '../../shared/constants';
import { isPickup } from '../../shared/fulfillment';
import { needsCardMachine, paymentLabel } from '../../shared/payment';
import { whatsAppLink } from '../../lib/whatsapp';
import { useKitchenOrders } from './KitchenOrdersStore';
import { useKitchenSettings } from './KitchenSettingsStore';
import { useKitchenChat } from './KitchenChatStore';
import { KitchenCancelOrderModal } from './KitchenCancelOrderModal';
import { OrderReceiptModal } from '../../components/print/OrderReceiptModal';
import { useNow } from './useNow';
import {
  ABANDONED_PIX_MINUTES,
  hasPendingCancelRequest,
  isAbandonedPix,
  isOrderLate,
  money,
  owesRefund,
  refundFailed,
  shortDate,
} from './kitchenOrderRules';

interface ColumnMeta {
  id: OrderStatus;
  title: string;
  short: string;
  dot: string;
  text: string;
  drop: string;
}

/**
 * As colunas não têm mais a faixa colorida no topo: a cor vive no ponto ao lado
 * do título, que é o suficiente para achar a coluna sem pintar o painel inteiro.
 */
const COLUMNS: ColumnMeta[] = [
  { id: 'recebido', title: 'Aguardando aceite', short: 'Novos', dot: 'bg-[#2563EB]', text: 'text-[#1D4ED8]', drop: 'border-[#93C5FD] bg-[#EFF6FF]' },
  { id: 'em_preparo', title: 'Em preparo', short: 'Preparo', dot: 'bg-[#D97706]', text: 'text-[#B45309]', drop: 'border-[#FCD34D] bg-[#FFFBEB]' },
  { id: 'pronto', title: 'Pronto', short: 'Pronto', dot: 'bg-[#7C3AED]', text: 'text-[#6D28D9]', drop: 'border-[#C4B5FD] bg-[#F5F3FF]' },
  { id: 'saiu_entrega', title: 'Saiu para entrega', short: 'Na rua', dot: 'bg-[#4F46E5]', text: 'text-[#4338CA]', drop: 'border-[#A5B4FC] bg-[#EEF2FF]' },
  { id: 'entregue', title: 'Entregue / retirado', short: 'Concluídos', dot: 'bg-[#059669]', text: 'text-[#047857]', drop: 'border-[#6EE7B7] bg-[#ECFDF5]' },
  { id: 'cancelado', title: 'Cancelados', short: 'Cancelados', dot: 'bg-[#B91C1C]', text: 'text-[#B91C1C]', drop: 'border-[#FCA5A5] bg-[#FEF2F2]' },
];

const CLOSED_STATUSES: OrderStatus[] = ['entregue', 'cancelado'];

const NEXT_STATUS: Record<'delivery' | 'pickup', Partial<Record<OrderStatus, OrderStatus>>> = {
  delivery: { recebido: 'em_preparo', em_preparo: 'pronto', pronto: 'saiu_entrega', saiu_entrega: 'entregue' },
  pickup: { recebido: 'em_preparo', em_preparo: 'pronto', pronto: 'entregue' },
};

const NEXT_LABEL: Record<'delivery' | 'pickup', Partial<Record<OrderStatus, string>>> = {
  delivery: { recebido: 'Aceitar pedido', em_preparo: 'Marcar pronto', pronto: 'Saiu para entrega', saiu_entrega: 'Marcar entregue' },
  pickup: { recebido: 'Aceitar pedido', em_preparo: 'Pronto para retirar', pronto: 'Cliente retirou' },
};

/** Só dá para empurrar um pedido para a frente — o servidor recusa voltar atrás. */
const canDropIn = (order: Order, target: OrderStatus): boolean => {
  if (target === order.status) return false;
  if (CLOSED_STATUSES.includes(order.status)) return false;
  if (target === 'cancelado') return true; // cai no modal de motivo, não avança sozinho
  if (target === 'saiu_entrega' && isPickup(order)) return false;
  return STATUS_ORDER.indexOf(target) > STATUS_ORDER.indexOf(order.status);
};

const elapsedLabel = (iso: string, now: number): string => {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
};

const destinationOf = (order: Order): string =>
  isPickup(order) ? 'Retirada na loja' : order.address.neighborhood || order.address.city || 'Entrega';

/** Coluna sob o dedo/cursor. `elementsFromPoint` devolve a pilha inteira, então
 *  o próprio card arrastado (que está por cima) não atrapalha a leitura. */
const statusUnderPointer = (event: MouseEvent | TouchEvent | PointerEvent): OrderStatus | null => {
  const source =
    'changedTouches' in event && event.changedTouches.length ? event.changedTouches[0] : (event as MouseEvent);
  if (typeof source.clientX !== 'number') return null;
  const hit = document
    .elementsFromPoint(source.clientX, source.clientY)
    .find((node) => node instanceof HTMLElement && node.dataset.dropStatus);
  return hit ? ((hit as HTMLElement).dataset.dropStatus as OrderStatus) : null;
};

/** A partir daqui cabem as quatro colunas de trabalho lado a lado sem rolagem. */
const WIDE_QUERY = '(min-width: 1280px)';

const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [query]);
  return matches;
};

export const KitchenOrdersBoard: React.FC = () => {
  const { orders, busyOrderId, newOrderFlashId, updateOrderStatus, cancelOrder, confirmPayment } = useKitchenOrders();
  const { settings } = useKitchenSettings();
  const { unread, openThread } = useKitchenChat();
  const now = useNow(30000);
  const reduceMotion = useReducedMotion();
  const wide = useMediaQuery(WIDE_QUERY);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [printOrder, setPrintOrder] = useState<Order | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [query, setQuery] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [dragOrder, setDragOrder] = useState<Order | null>(null);
  const [hoverStatus, setHoverStatus] = useState<OrderStatus | null>(null);
  // Entregues e cancelados chegam recolhidos: são consulta, não trabalho do dia.
  const [collapsed, setCollapsed] = useState<OrderStatus[]>(CLOSED_STATUSES);
  // Sem escolha do usuário, abre na primeira etapa que tem pedido — não numa tela vazia.
  const [tab, setTab] = useState<OrderStatus | null>(null);

  const columns = onlyOpen ? COLUMNS.filter((column) => !CLOSED_STATUSES.includes(column.id)) : COLUMNS;

  const visibleOrders = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return orders;
    return orders.filter((order) =>
      [order.id, order.customerName, order.customerPhone, destinationOf(order)]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term))
    );
  }, [orders, query]);

  const byStatus = useMemo(() => {
    const map = new Map<OrderStatus, Order[]>(COLUMNS.map((column) => [column.id, [] as Order[]]));
    visibleOrders.forEach((order) => map.get(order.status)?.push(order));
    return map;
  }, [visibleOrders]);

  const activeColumn =
    (tab ? columns.find((column) => column.id === tab) : undefined) ??
    columns.find((column) => (byStatus.get(column.id)?.length ?? 0) > 0) ??
    columns[0];

  const openCount = orders.filter((order) => !CLOSED_STATUSES.includes(order.status)).length;
  const lateCount = orders.filter((order) => isOrderLate(order, now)).length;

  const toggleCollapsed = (status: OrderStatus) =>
    setCollapsed((prev) => (prev.includes(status) ? prev.filter((id) => id !== status) : [...prev, status]));

  const handleDrag = (event: MouseEvent | TouchEvent | PointerEvent) => setHoverStatus(statusUnderPointer(event));

  const handleDragEnd = (order: Order, event: MouseEvent | TouchEvent | PointerEvent) => {
    const target = statusUnderPointer(event) ?? hoverStatus;
    setDragOrder(null);
    setHoverStatus(null);
    if (!target || !canDropIn(order, target)) return;
    if (target === 'cancelado') setCancelTarget(order);
    else void updateOrderStatus(order.id, target);
  };

  const cardsOf = (column: ColumnMeta) => {
    const columnOrders = byStatus.get(column.id) ?? [];
    const isTarget = !!dragOrder && hoverStatus === column.id && canDropIn(dragOrder, column.id);
    const isAllowed = !!dragOrder && canDropIn(dragOrder, column.id);
    return (
      <>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(230px,100%),1fr))] items-start gap-2.5">
          <AnimatePresence initial={false}>
            {columnOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                now={now}
                busy={busyOrderId === order.id}
                flash={newOrderFlashId === order.id}
                unreadCount={unread[order.id] || 0}
                expanded={!!expanded[order.id]}
                reduceMotion={!!reduceMotion}
                dragging={dragOrder?.id === order.id}
                onToggle={() => setExpanded((prev) => ({ ...prev, [order.id]: !prev[order.id] }))}
                onDragStart={() => setDragOrder(order)}
                onDrag={handleDrag}
                onDragEnd={(event) => handleDragEnd(order, event)}
                onPrint={() => setPrintOrder(order)}
                onChat={() => openThread(order.id)}
                onAdvance={(status) => void updateOrderStatus(order.id, status)}
                onConfirmPayment={() => void confirmPayment(order.id)}
                onCancel={() => setCancelTarget(order)}
                onCancelAbandoned={() =>
                  void cancelOrder(order.id, `PIX não pago em ${ABANDONED_PIX_MINUTES} minutos.`)
                }
              />
            ))}
          </AnimatePresence>
        </div>

        {columnOrders.length === 0 && (
          <p
            className={`rounded-xl border border-dashed px-3 py-6 text-center text-[11px] font-semibold transition-colors duration-200 ${
              isTarget ? 'border-[#B91C1C] text-[#B91C1C]' : 'border-[#E7E5E4] text-[#A8A29E]'
            }`}
          >
            {isAllowed ? 'Solte aqui' : query ? 'Nada encontrado aqui.' : 'Nenhum pedido.'}
          </p>
        )}
      </>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-0 sm:w-auto sm:max-w-xs sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#A8A29E]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Código, cliente ou bairro"
            aria-label="Buscar pedidos"
            className="h-10 w-full rounded-xl border border-[#E7E5E4] bg-white pl-9 pr-9 text-xs font-semibold text-[#1C1917] outline-none transition-colors duration-200 placeholder:font-medium placeholder:text-[#A8A29E] focus-visible:border-[#B91C1C] focus-visible:ring-2 focus-visible:ring-[#B91C1C]/20"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-[#78716C] transition-colors duration-200 hover:bg-[#F5F5F4] hover:text-[#1C1917]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <FilterSwitch checked={onlyOpen} onChange={setOnlyOpen} label="Só em andamento" />

        <div className="ml-auto flex items-center gap-2 text-[11px] font-bold">
          <span className="rounded-xl border border-[#E7E5E4] bg-white px-3 py-2 text-[#57534E]">
            {openCount} em andamento
          </span>
          {lateCount > 0 && (
            <span className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[#B91C1C]">
              {lateCount} atrasado(s)
            </span>
          )}
        </div>
      </div>

      {/* Os atalhos também são alvo de soltura: no celular é assim que o pedido troca de coluna. */}
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
        {columns.map((column) => {
          const count = byStatus.get(column.id)?.length ?? 0;
          const selected = wide ? !collapsed.includes(column.id) : activeColumn?.id === column.id;
          const isTarget = !!dragOrder && hoverStatus === column.id && canDropIn(dragOrder, column.id);
          return (
            <button
              key={column.id}
              type="button"
              data-drop-status={column.id}
              aria-pressed={selected}
              title={wide ? (selected ? 'Recolher coluna' : 'Mostrar coluna') : 'Ver esta etapa'}
              onClick={() => (wide ? toggleCollapsed(column.id) : setTab(column.id))}
              className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-bold transition-colors duration-200 active:scale-[0.98] ${
                isTarget
                  ? 'border-[#B91C1C] bg-[#FEF2F2] text-[#B91C1C]'
                  : selected
                    ? 'border-[#D6D3D1] bg-white text-[#1C1917]'
                    : 'border-transparent bg-[#EFEDEC] text-[#78716C] hover:bg-[#E7E5E4]'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${column.dot}`} />
              {column.short}
              <span className="tabular-nums text-[#A8A29E]">{count}</span>
            </button>
          );
        })}
      </div>

      {wide ? (
        <div
          className="grid items-stretch gap-3"
          style={{
            gridTemplateColumns: columns
              .map((column) => (collapsed.includes(column.id) ? '52px' : 'minmax(0, 1fr)'))
              .join(' '),
          }}
        >
          {columns.map((column) => {
            const count = byStatus.get(column.id)?.length ?? 0;
            const isTarget = !!dragOrder && hoverStatus === column.id && canDropIn(dragOrder, column.id);
            const isAllowed = !!dragOrder && canDropIn(dragOrder, column.id);

            if (collapsed.includes(column.id)) {
              return (
                <button
                  key={column.id}
                  type="button"
                  data-drop-status={column.id}
                  onClick={() => toggleCollapsed(column.id)}
                  title={`Abrir ${column.title}`}
                  className={`flex min-h-[240px] w-full flex-col items-center gap-3 rounded-2xl border py-3 transition-colors duration-200 ${
                    isTarget ? column.drop : 'border-[#E7E5E4] bg-[#FAFAF9] hover:bg-[#F5F5F4]'
                  } ${dragOrder && !isAllowed ? 'opacity-55' : ''}`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${column.dot}`} />
                  <span className={`rounded-full bg-white px-1.5 py-0.5 text-[10px] font-black tabular-nums ${column.text}`}>
                    {count}
                  </span>
                  <span className="text-xs font-extrabold text-[#57534E] [writing-mode:vertical-rl]">
                    {column.title}
                  </span>
                </button>
              );
            }

            return (
              <section
                key={column.id}
                data-drop-status={column.id}
                className={`flex min-h-[240px] min-w-0 flex-col rounded-2xl border p-3 transition-colors duration-200 ${
                  isTarget ? column.drop : 'border-[#E7E5E4] bg-[#FAFAF9]'
                } ${dragOrder && !isAllowed ? 'opacity-55' : ''}`}
              >
                <header className="mb-3 flex items-center gap-2 px-1">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${column.dot}`} />
                  <h3 className="min-w-0 flex-1 truncate text-xs font-extrabold text-[#1C1917]">{column.title}</h3>
                  <span className={`rounded-full bg-white px-2 py-0.5 text-[10px] font-black tabular-nums ${column.text}`}>
                    {count}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(column.id)}
                    title="Recolher coluna"
                    aria-label={`Recolher ${column.title}`}
                    className="text-[#A8A29E] transition-colors duration-200 hover:text-[#1C1917]"
                  >
                    <Minimize2 className="h-3.5 w-3.5" />
                  </button>
                </header>
                {cardsOf(column)}
              </section>
            );
          })}
        </div>
      ) : (
        activeColumn && (
          <section
            data-drop-status={activeColumn.id}
            className={`min-h-[240px] rounded-2xl border p-3 transition-colors duration-200 ${
              dragOrder && hoverStatus === activeColumn.id && canDropIn(dragOrder, activeColumn.id)
                ? activeColumn.drop
                : 'border-[#E7E5E4] bg-[#FAFAF9]'
            }`}
          >
            <header className="mb-3 flex items-center gap-2 px-1">
              <span className={`h-2 w-2 shrink-0 rounded-full ${activeColumn.dot}`} />
              <h3 className="min-w-0 flex-1 truncate text-xs font-extrabold text-[#1C1917]">{activeColumn.title}</h3>
              <span className={`rounded-full bg-white px-2 py-0.5 text-[10px] font-black tabular-nums ${activeColumn.text}`}>
                {byStatus.get(activeColumn.id)?.length ?? 0}
              </span>
            </header>
            {cardsOf(activeColumn)}
          </section>
        )
      )}

      {printOrder && (
        <OrderReceiptModal order={printOrder} storeName={settings.storeName} onClose={() => setPrintOrder(null)} />
      )}
      {cancelTarget && (
        <KitchenCancelOrderModal
          order={cancelTarget}
          busy={busyOrderId === cancelTarget.id}
          onClose={() => setCancelTarget(null)}
          onConfirm={(reason) => {
            void cancelOrder(cancelTarget.id, reason);
            setCancelTarget(null);
          }}
        />
      )}
    </div>
  );
};
const FilterSwitch: React.FC<{ checked: boolean; onChange: (next: boolean) => void; label: string }> = ({
  checked,
  onChange,
  label,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className={`flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-[11px] font-bold outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[#B91C1C]/30 active:scale-[0.98] ${
      checked ? 'border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]' : 'border-[#E7E5E4] bg-white text-[#57534E]'
    }`}
  >
    <span className={`relative h-4 w-7 shrink-0 rounded-full transition-colors duration-200 ${checked ? 'bg-[#B91C1C]' : 'bg-[#D6D3D1]'}`}>
      <span
        className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-[left] duration-200 ease-out ${
          checked ? 'left-[14px]' : 'left-0.5'
        }`}
      />
    </span>
    {label}
  </button>
);

const Flag: React.FC<{ tone: 'alert' | 'warn' | 'info'; children: React.ReactNode }> = ({ tone, children }) => {
  const skin =
    tone === 'alert'
      ? 'bg-[#FEF2F2] text-[#B91C1C]'
      : tone === 'warn'
        ? 'bg-[#FFFBEB] text-[#B45309]'
        : 'bg-[#F5F5F4] text-[#57534E]';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${skin}`}>
      {children}
    </span>
  );
};

/** O dinheiro cobrado de um pedido cancelado só some da tela depois de devolvido. */
const PaymentLine: React.FC<{ order: Order; onConfirmPayment: () => void }> = ({ order, onConfirmPayment }) => {
  const { refundStatus, refundedAt, refundError, isPaid, changeForAmount } = order.payment;
  const how = (
    <span className="block text-[#57534E]">
      {paymentLabel(order.payment, order.fulfillment)}
      {needsCardMachine(order.payment) && <strong className="text-[#7C3AED]"> · levar maquininha</strong>}
      {changeForAmount ? <strong className="text-[#B45309]"> · troco p/ {money(changeForAmount)}</strong> : null}
    </span>
  );
  const wrap = (node: React.ReactNode) => (
    <div className="space-y-1">
      {how}
      {node}
    </div>
  );
  if (refundStatus === 'pendente')
    return wrap(
      <span className="block font-bold text-[#B91C1C]">
        <AlertTriangle className="mr-1 inline h-3 w-3" />
        Devolução pendente de {money(order.total)}
      </span>
    );
  if (refundStatus === 'falhou')
    return wrap(
      <span className="block font-bold text-[#B91C1C]">
        <AlertTriangle className="mr-1 inline h-3 w-3" />
        Devolução falhou{refundError ? `: ${refundError}` : ''}
      </span>
    );
  if (refundStatus === 'devolvido')
    return wrap(
      <span className="block font-bold text-[#059669]">
        Valor devolvido{refundedAt ? ` em ${shortDate(refundedAt)}` : ''}
      </span>
    );
  if (order.status === 'cancelado')
    return wrap(
      <span className="block font-bold text-[#57534E]">
        {isPaid ? 'Pago · devolução não registrada' : 'Não chegou a ser pago'}
      </span>
    );
  if (isPaid) return wrap(<span className="font-bold text-[#047857]">Pagamento confirmado</span>);
  return wrap(
    <button
      onClick={onConfirmPayment}
      className="w-full rounded-lg border border-[#FDE68A] bg-[#FFFBEB] py-1.5 font-bold text-[#B45309] transition-colors duration-200 hover:bg-[#FEF3C7]"
    >
      Confirmar pagamento
    </button>
  );
};

interface OrderCardProps {
  order: Order;
  now: number;
  busy: boolean;
  flash: boolean;
  unreadCount: number;
  expanded: boolean;
  reduceMotion: boolean;
  dragging: boolean;
  onToggle: () => void;
  onDragStart: () => void;
  onDrag: (event: MouseEvent | TouchEvent | PointerEvent) => void;
  onDragEnd: (event: MouseEvent | TouchEvent | PointerEvent) => void;
  onPrint: () => void;
  onChat: () => void;
  onAdvance: (status: OrderStatus) => void;
  onConfirmPayment: () => void;
  onCancel: () => void;
  onCancelAbandoned: () => void;
}

const OrderCard: React.FC<OrderCardProps> = ({
  order,
  now,
  busy,
  flash,
  unreadCount,
  expanded,
  reduceMotion,
  dragging,
  onToggle,
  onDragStart,
  onDrag,
  onDragEnd,
  onPrint,
  onChat,
  onAdvance,
  onConfirmPayment,
  onCancel,
  onCancelAbandoned,
}) => {
  const dragControls = useDragControls();
  const pickup = isPickup(order);
  const mode = pickup ? 'pickup' : 'delivery';
  const next = NEXT_STATUS[mode][order.status];
  const nextLabel = NEXT_LABEL[mode][order.status];
  const abandoned = isAbandonedPix(order, now);
  const late = isOrderLate(order, now);
  const requested = hasPendingCancelRequest(order);
  const owed = owesRefund(order) || refundFailed(order);
  const flagged = abandoned || late || requested || owed;
  const closed = CLOSED_STATUSES.includes(order.status);
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const itemLabel = `${itemCount} ${itemCount === 1 ? 'item' : 'itens'}`;
  const preview = order.items[0]
    ? `${order.items[0].quantity}x ${order.items[0].product.name}${order.items.length > 1 ? ` +${order.items.length - 1}` : ''}`
    : 'Sem itens';

  return (
    <motion.article
      layout={!reduceMotion}
      initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 480, damping: 38, mass: 0.7 }}
      drag={!closed && !reduceMotion}
      dragControls={dragControls}
      dragListener={false}
      dragSnapToOrigin
      dragElastic={0.14}
      dragMomentum={false}
      whileDrag={{ scale: 1.03, rotate: -0.6, zIndex: 40, boxShadow: '0 18px 40px rgba(28,25,23,0.18)' }}
      onDragStart={onDragStart}
      onDrag={(event) => onDrag(event)}
      onDragEnd={(event) => onDragEnd(event)}
      className={`relative select-none rounded-xl border bg-white shadow-[0_1px_2px_rgba(28,25,23,0.06)] ${
        dragging ? 'cursor-grabbing' : ''
      } ${flagged ? 'border-[#FCA5A5]' : 'border-[#E7E5E4]'} ${flash ? 'order-pop' : ''}`}
    >
      <div className="flex items-start gap-1 p-2.5">
        {!closed && (
          <button
            type="button"
            aria-label={`Arrastar o pedido ${order.id} para outra coluna`}
            title="Arraste para mudar de coluna"
            onPointerDown={(event) => {
              event.preventDefault(); // sem isto o arrasto vira seleção de texto na página
              dragControls.start(event);
            }}
            className="-ml-1 touch-none cursor-grab rounded-lg py-1 text-[#D6D3D1] transition-colors duration-200 hover:text-[#78716C] active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}

        <button type="button" onClick={onToggle} aria-expanded={expanded} className="min-w-0 flex-1 text-left">
          <div className="flex items-baseline justify-between gap-2">
            <strong className="truncate text-[11px] font-black tracking-tight text-[#1C1917]">{order.id}</strong>
            <span className="shrink-0 text-sm font-extrabold tabular-nums text-[#B91C1C]">{money(order.total)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#78716C]">
            <span className="min-w-0 flex-1 truncate font-bold text-[#57534E]">{order.customerName}</span>
            <span className={`shrink-0 tabular-nums ${late ? 'font-bold text-[#B91C1C]' : ''}`}>
              {elapsedLabel(order.createdAt, now)}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-[10px] text-[#A8A29E]">
            {pickup ? <Store className="h-3 w-3 shrink-0" /> : <Bike className="h-3 w-3 shrink-0" />}
            <span className="truncate">{destinationOf(order)}</span>
            <span className="shrink-0">· {itemLabel}</span>
          </div>
        </button>

        <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.18 }} className="pt-1 text-[#A8A29E]">
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </div>

      {flagged && (
        <div className="flex flex-wrap gap-1 px-2.5 pb-2">
          {requested && <Flag tone="alert">Pediu cancelamento</Flag>}
          {owed && (
            <Flag tone="alert">
              <AlertTriangle className="h-2.5 w-2.5" />
              Devolver {money(order.total)}
            </Flag>
          )}
          {late && (
            <Flag tone="warn">
              <Clock className="h-2.5 w-2.5" />
              Atrasado
            </Flag>
          )}
          {abandoned && <Flag tone="warn">PIX parado {ABANDONED_PIX_MINUTES} min</Flag>}
        </div>
      )}

      {!expanded && (
        <p className="truncate border-t border-[#F5F5F4] px-2.5 py-1.5 text-[10px] font-semibold text-[#78716C]">
          {preview}
        </p>
      )}

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-[#F5F5F4] px-2.5 py-2 text-[11px]">
              <div className="rounded-lg bg-[#FAFAF9] p-2">
                {pickup ? (
                  <strong className="text-[#047857]">Retirada no balcão</strong>
                ) : (
                  <strong className="text-[#1C1917]">
                    {order.address.street}, {order.address.number}
                  </strong>
                )}
                {order.address.complement && <span className="text-[#57534E]"> · {order.address.complement}</span>}
                {order.customerPhone && (
                  <a
                    className="mt-1 block font-bold text-[#047857]"
                    href={whatsAppLink(order.customerPhone, `Olá, ${order.customerName}!`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MessageCircle className="mr-1 inline h-3 w-3" />
                    WhatsApp
                  </a>
                )}
                {order.driverName && <span className="block text-[#4338CA]">Motoboy: {order.driverName}</span>}
                {order.driverLat && order.driverLng && (
                  <span className="block text-[#2563EB]">
                    <MapPin className="mr-1 inline h-3 w-3" />
                    GPS ativo
                  </span>
                )}
              </div>

              <div className="space-y-1">
                {order.items.map((item) => (
                  <div key={item.id} className="flex justify-between gap-2">
                    <span className="min-w-0">
                      {item.quantity}x {item.product.name}
                      {item.isFree ? ' (grátis)' : ''}
                    </span>
                    <strong className="shrink-0 tabular-nums">{money(item.itemTotalPrice)}</strong>
                  </div>
                ))}
              </div>

              <PaymentLine order={order} onConfirmPayment={onConfirmPayment} />

              {order.cancellationReason && <span className="block text-[#57534E]">Motivo: {order.cancellationReason}</span>}
              {order.rating && (
                <span className="font-bold text-[#B45309]">
                  <Star className="mr-1 inline h-3 w-3 fill-current" />
                  {order.rating}/5
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {abandoned && (
        <div className="px-2.5 pb-2">
          <button
            onClick={onCancelAbandoned}
            disabled={busy}
            className="w-full rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] py-1.5 text-[11px] font-bold text-[#B91C1C] transition-colors duration-200 hover:bg-[#FEE2E2] disabled:opacity-40"
          >
            {busy ? 'Cancelando...' : 'Cancelar pedido abandonado'}
          </button>
        </div>
      )}

      <div className="flex items-center gap-1 border-t border-[#F5F5F4] p-2">
        {next ? (
          <button
            onClick={() => onAdvance(next)}
            disabled={busy}
            className="h-8 min-w-0 flex-1 rounded-lg bg-[#B91C1C] px-2 text-[11px] font-bold text-white transition-colors duration-200 hover:bg-[#991B1B] active:scale-[0.98] disabled:opacity-40"
          >
            <span className="truncate">{nextLabel}</span>
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate px-1 text-[10px] font-bold uppercase tracking-wide text-[#A8A29E]">
            {order.status === 'cancelado' ? 'Cancelado' : 'Finalizado'}
          </span>
        )}

        <button
          onClick={onChat}
          title="Conversar com o cliente"
          aria-label="Conversar com o cliente"
          className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E7E5E4] text-[#57534E] transition-colors duration-200 hover:bg-[#F5F5F4] hover:text-[#1C1917]"
        >
          <MessagesSquare className="h-3.5 w-3.5" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#B91C1C] px-1 text-[9px] font-black text-white">
              {unreadCount}
            </span>
          )}
        </button>

        <button
          onClick={onPrint}
          title="Ver a comanda"
          aria-label="Ver a comanda"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E7E5E4] text-[#57534E] transition-colors duration-200 hover:bg-[#F5F5F4] hover:text-[#1C1917]"
        >
          <Printer className="h-3.5 w-3.5" />
        </button>

        {!closed && (
          <button
            onClick={onCancel}
            disabled={busy}
            title="Cancelar pedido"
            aria-label="Cancelar pedido"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E7E5E4] text-[#78716C] transition-colors duration-200 hover:border-[#FCA5A5] hover:bg-[#FEF2F2] hover:text-[#B91C1C] disabled:opacity-40"
          >
            <Ban className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </motion.article>
  );
};
