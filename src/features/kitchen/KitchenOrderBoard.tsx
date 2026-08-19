import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Clock,
  MapPin,
  MessageCircle,
  MessagesSquare,
  Printer,
  Star,
  Users,
  Wallet,
} from 'lucide-react';
import type { Order, OrderStatus } from '../../types';
import { whatsAppLink } from '../../lib/whatsapp';
import { useKitchenOrders } from './KitchenOrdersStore';
import { useKitchenCatalog } from './KitchenCatalogStore';
import { useKitchenDrivers } from './KitchenDriversStore';
import { useKitchenSettings } from './KitchenSettingsStore';
import { useKitchenReports } from './KitchenReportsStore';
import { useKitchenChat } from './KitchenChatStore';
import { RevenueChart } from './RevenueChart';
import { KitchenDriverPanel } from './KitchenDriverPanel';
import { KitchenCancelOrderModal } from './KitchenCancelOrderModal';
import { Heading, Panel, Empty } from './KitchenPanels';
import { OrderReceiptModal } from '../../components/print/OrderReceiptModal';
import { useNow } from './useNow';
import {
  ABANDONED_PIX_MINUTES,
  hasPendingCancelRequest,
  isAbandonedPix,
  isOrderLate,
  money,
  owesRefund,
  pendingRefundTotal,
  refundFailed,
  shortDate,
} from './kitchenOrderRules';
import type { KitchenTab } from './kitchenTabs';

const ACTIVE_STATUSES: OrderStatus[] = ['recebido', 'em_preparo', 'pronto', 'saiu_entrega'];
const COLUMNS: { id: OrderStatus; title: string; color: string }[] = [
  { id: 'recebido', title: 'Aguardando aceite', color: 'border-blue-500' },
  { id: 'em_preparo', title: 'Em preparo', color: 'border-amber-500' },
  { id: 'pronto', title: 'Pronto para entrega', color: 'border-violet-500' },
  { id: 'saiu_entrega', title: 'Saiu para entrega', color: 'border-purple-500' },
  { id: 'entregue', title: 'Entregue', color: 'border-emerald-500' },
  { id: 'cancelado', title: 'Cancelados', color: 'border-red-500' },
];

export const KitchenOrderBoard: React.FC<{ activeTab: KitchenTab }> = ({ activeTab }) => {
  const { orders, busyOrderId, updateOrderStatus, cancelOrder, confirmPayment } = useKitchenOrders();
  const { products, coupons, toggleProductAvailability } = useKitchenCatalog();
  const { drivers } = useKitchenDrivers();
  const { settings } = useKitchenSettings();
  const { report, trends, loadReport, loadTrends } = useKitchenReports();
  const { unread, openThread } = useKitchenChat();
  // Prazos e abandono são comparados com `createdAt` no render; o tique só evita
  // que um pedido fique marcado como no prazo até chegar o próximo evento.
  const now = useNow(30000);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [printOrder, setPrintOrder] = useState<Order | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [from, setFrom] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [to, setTo] = useState(() => new Date().toLocaleDateString('en-CA'));

  useEffect(() => {
    if (activeTab === 'financeiro') void loadTrends();
    if (activeTab === 'relatorios') void loadReport(from, to);
    // The tab is the lifecycle boundary; report filters are loaded explicitly by the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);


  const activeOrders = useMemo(() => orders.filter((order) => ACTIVE_STATUSES.includes(order.status)), [orders]);
  const totalRevenue = useMemo(
    () => orders.reduce((sum, order) => sum + (order.status === 'cancelado' ? 0 : order.total), 0),
    [orders]
  );
  const completedOrders = orders.filter((order) => order.status !== 'cancelado');
  const averageTicket = completedOrders.length ? totalRevenue / completedOrders.length : 0;
  const customers = useMemo(() => {
    const map = new Map<string, { name: string; phone: string; count: number; total: number }>();
    orders.forEach((order) => {
      const key = order.customerPhone || order.customerName;
      const item = map.get(key) || { name: order.customerName, phone: order.customerPhone, count: 0, total: 0 };
      item.count += 1;
      if (order.status !== 'cancelado') item.total += order.total;
      map.set(key, item);
    });
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [orders]);
  const refundDue = useMemo(() => pendingRefundTotal(orders), [orders]);


  if (activeTab === 'dashboard') {
    return (
      <div className="space-y-5">
        <Heading icon={<BarChart3 />} title="Dashboard" subtitle="Visão geral da loja em tempo real." />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Metric label="Vendas" value={money(totalRevenue)} />
          <Metric label="Pedidos ativos" value={String(activeOrders.length)} />
          <Metric label="Ticket médio" value={money(averageTicket)} accent />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric label="Itens no cardápio" value={String(products.length)} />
          <Metric label="Pausados" value={String(products.filter((p) => !p.available).length)} />
          <Metric label="Cupons" value={String(coupons.length)} />
          <Metric label="Motoboys" value={String(drivers.length)} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel title="Pedidos recentes">
            {orders.slice(0, 6).map((order) => (
              <div key={order.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-0 border-[#F5F5F4] text-xs">
                <span className="font-extrabold">{order.id}</span>
                <span className="truncate text-[#57534E]">{order.customerName}</span>
                <span className="font-extrabold">{money(order.total)}</span>
              </div>
            ))}
            {orders.length === 0 && <Empty text="Nenhum pedido ainda." />}
          </Panel>
          <Panel title="Status do cardápio">
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {products.map((product) => (
                <div key={product.id} className="flex items-center gap-2 py-1.5 text-xs">
                  <span className={`w-2 h-2 rounded-full ${product.available ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  <span className={`flex-1 truncate ${product.available ? '' : 'line-through text-red-700'}`}>{product.name}</span>
                  <button className="text-[10px] font-bold" onClick={() => void toggleProductAvailability(product.id, product.available)}>
                    {product.available ? 'Pausar' : 'Reativar'}
                  </button>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  if (activeTab === 'orders') {
    return (
      <div className="space-y-4">
        <Heading title="Gestão de pedidos" subtitle={`${activeOrders.length} pedido(s) ativo(s).`} />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
          {COLUMNS.map((column) => {
            const columnOrders = orders.filter((order) => order.status === column.id);
            return (
              <div key={column.id} className={`bg-white rounded-2xl p-4 border-t-4 ${column.color} border-x border-b border-[#E7E5E4] min-h-[220px]`}>
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-extrabold text-sm">{column.title}</h3>
                  <span className="text-xs font-black bg-[#F5F5F4] rounded-full px-2 py-0.5">{columnOrders.length}</span>
                </div>
                <div className="space-y-3">
                  {columnOrders.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      now={now}
                      busy={busyOrderId === order.id}
                      unreadCount={unread[order.id] || 0}
                      expanded={!!expanded[order.id]}
                      onToggle={() => setExpanded((prev) => ({ ...prev, [order.id]: !prev[order.id] }))}
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
                  {columnOrders.length === 0 && <Empty text="Nenhum pedido nesta coluna." />}
                </div>
              </div>
            );
          })}
        </div>
        {printOrder && <OrderReceiptModal order={printOrder} storeName={settings.storeName} onClose={() => setPrintOrder(null)} />}
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
  }

  if (activeTab === 'clientes') {
    return (
      <div className="space-y-4">
        <Heading icon={<Users />} title="Clientes" subtitle={`${customers.length} cliente(s) identificados.`} />
        <Panel>
          {customers.map((customer) => (
            <div key={customer.phone || customer.name} className="flex items-center gap-3 py-3 border-b last:border-0 border-[#F5F5F4]">
              <div className="w-9 h-9 rounded-full bg-[#FEF2F2] text-[#B91C1C] flex items-center justify-center font-black">{customer.name[0]}</div>
              <div className="flex-1 min-w-0"><div className="font-extrabold text-sm truncate">{customer.name}</div><div className="text-[11px] text-[#57534E]">{customer.phone || '—'}</div></div>
              <div className="text-center text-xs"><strong>{customer.count}</strong><span className="block text-[9px] text-[#57534E]">pedidos</span></div>
              <div className="text-right text-xs font-extrabold text-[#B91C1C]">{money(customer.total)}</div>
            </div>
          ))}
          {customers.length === 0 && <Empty text="Nenhum cliente ainda." />}
        </Panel>
      </div>
    );
  }

  if (activeTab === 'motoboys') {
    return <KitchenDriverPanel />;
  }

  if (activeTab === 'financeiro') {
    const points = period === 'daily' ? trends?.daily : period === 'weekly' ? trends?.weekly : trends?.monthly;
    return (
      <div className="space-y-4"><Heading icon={<Wallet />} title="Financeiro" subtitle="Receita, pedidos e formas de pagamento." /><div className="flex gap-1 bg-[#F5F5F4] rounded-full p-1 w-fit">{(['daily', 'weekly', 'monthly'] as const).map((option) => <button key={option} onClick={() => setPeriod(option)} className={`px-3 py-1.5 rounded-full text-xs font-bold ${period === option ? 'bg-[#1C1917] text-white' : ''}`}>{option === 'daily' ? 'Diário' : option === 'weekly' ? 'Semanal' : 'Mensal'}</button>)}</div><Panel title="Faturamento">{points ? <RevenueChart points={points} periodLabel={period === 'daily' ? 'diário' : period === 'weekly' ? 'semanal' : 'mensal'} /> : <Empty text="Carregando dados..." />}</Panel><div className="grid grid-cols-1 sm:grid-cols-4 gap-3"><Metric label="Faturamento total" value={money(totalRevenue)} /><Metric label="Pedidos" value={String(completedOrders.length)} /><Metric label="Ticket médio" value={money(averageTicket)} accent /><Metric label="A devolver" value={money(refundDue)} accent={refundDue > 0} /></div><p className="text-[11px] text-[#57534E]">O faturamento não conta os pedidos cancelados. O dinheiro já cobrado deles aparece em "A devolver" até a devolução ser feita.</p></div>
    );
  }

  if (activeTab === 'relatorios') {
    return (
      <div className="space-y-4"><Heading icon={<BarChart3 />} title="Relatórios" subtitle="Desempenho e vendas por período." /><Panel><div className="flex flex-wrap items-center gap-2 mb-4"><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="input" /><span className="text-xs">até</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="input" /><button className="btn-primary" onClick={() => void loadReport(from, to)}>Gerar</button></div><div className="grid grid-cols-2 md:grid-cols-4 gap-3"><Metric label="Faturado" value={money(report?.totalRevenue || 0)} /><Metric label="Pedidos" value={String(report?.totalOrders || 0)} /><Metric label="Ticket médio" value={money(report?.avgTicket || 0)} accent /><Metric label="Nota média" value={report?.avgRating ? report.avgRating.toFixed(1) : '—'} /></div></Panel><div className="grid grid-cols-1 lg:grid-cols-2 gap-3"><Panel title="Por horário">{report && report.hourlyDistribution.length ? report.hourlyDistribution.map((item) => <div key={item.hour} className="flex items-center gap-2 text-xs py-1"><span className="w-12">{item.hour}</span><div className="h-2 rounded bg-[#B91C1C]" style={{ width: `${Math.max(4, item.orders * 12)}px` }} /><strong>{item.orders}</strong></div>) : <Empty text="Sem dados." />}</Panel><Panel title="Mais vendidos">{report && report.topSellingProducts.length ? report.topSellingProducts.map((item, index) => <div key={item.name} className="flex items-center gap-2 text-xs py-2 border-b last:border-0 border-[#F5F5F4]"><strong className="text-[#B91C1C]">#{index + 1}</strong><span className="flex-1">{item.name}</span><span>{item.count} un · {money(item.total)}</span></div>) : <Empty text="Sem dados." />}</Panel></div></div>
    );
  }

  return null;
};

const Metric: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => <div className="bg-white rounded-2xl p-4 border border-[#E7E5E4] shadow-xs"><span className="text-[10px] text-[#57534E] uppercase font-bold">{label}</span><div className={`font-extrabold text-xl mt-1 ${accent ? 'text-[#B91C1C]' : ''}`}>{value}</div></div>;

const Flag: React.FC<{ tone: 'alert' | 'warn'; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase px-2 py-1 rounded-full ${tone === 'alert' ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#FFFBEB] text-[#B45309]'}`}>{children}</span>
);

/** O dinheiro cobrado de um pedido cancelado só some da tela depois de devolvido. */
const PaymentLine: React.FC<{ order: Order; onConfirmPayment: () => void }> = ({ order, onConfirmPayment }) => {
  const { refundStatus, refundedAt, refundError, isPaid } = order.payment;
  if (refundStatus === 'pendente') return <span className="block font-bold text-[#B91C1C]"><AlertTriangle className="inline w-3 h-3 mr-1" />Devolução pendente de {money(order.total)}</span>;
  if (refundStatus === 'falhou') return <span className="block font-bold text-[#B91C1C]"><AlertTriangle className="inline w-3 h-3 mr-1" />Devolução falhou{refundError ? `: ${refundError}` : ''}</span>;
  if (refundStatus === 'devolvido') return <span className="block font-bold text-[#059669]">Valor devolvido{refundedAt ? ` em ${shortDate(refundedAt)}` : ''}</span>;
  if (order.status === 'cancelado') return <span className="block font-bold text-[#57534E]">{isPaid ? 'Pago · devolução não registrada' : 'Não chegou a ser pago'}</span>;
  if (isPaid) return <span className="text-emerald-700 font-bold">Pagamento confirmado</span>;
  return <button onClick={onConfirmPayment} className="w-full py-1.5 rounded-full bg-amber-100 text-amber-800 font-bold">Confirmar pagamento</button>;
};

const OrderCard: React.FC<{ order: Order; now: number; busy: boolean; unreadCount: number; expanded: boolean; onToggle: () => void; onPrint: () => void; onChat: () => void; onAdvance: (status: OrderStatus) => void; onConfirmPayment: () => void; onCancel: () => void; onCancelAbandoned: () => void }> = ({ order, now, busy, unreadCount, expanded, onToggle, onPrint, onChat, onAdvance, onConfirmPayment, onCancel, onCancelAbandoned }) => {
  const next: Partial<Record<OrderStatus, OrderStatus>> = { recebido: 'em_preparo', em_preparo: 'pronto', pronto: 'saiu_entrega', saiu_entrega: 'entregue' };
  const abandoned = isAbandonedPix(order, now);
  const late = isOrderLate(order, now);
  const requested = hasPendingCancelRequest(order);
  const owed = owesRefund(order) || refundFailed(order);
  const flagged = abandoned || late || requested || owed;
  return <div className={`rounded-2xl p-3 space-y-2 shadow-xs border ${flagged ? 'border-[#FCA5A5]' : 'border-[#E7E5E4]'}`}><div className="flex items-start gap-2"><button onClick={onToggle} className="flex-1 text-left min-w-0"><div className="flex items-center justify-between gap-2"><strong className="text-xs">{order.id}</strong><span className="text-sm font-extrabold text-[#B91C1C]">{money(order.total)}</span></div><div className="text-[11px] text-[#57534E] truncate">{order.customerName} · {order.address.neighborhood || order.address.city}</div></button><button onClick={onChat} className="relative p-1.5 rounded-full hover:bg-[#F5F5F4]" title="Conversar com o cliente"><MessagesSquare className="w-3.5 h-3.5" />{unreadCount > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-4 px-1 h-4 rounded-full bg-[#B91C1C] text-white text-[9px] font-black flex items-center justify-center">{unreadCount}</span>}</button><button onClick={onPrint} className="p-1.5 rounded-full hover:bg-[#F5F5F4]" title="Imprimir"><Printer className="w-3.5 h-3.5" /></button>{expanded ? <ChevronUp className="w-4 h-4 mt-1" /> : <ChevronDown className="w-4 h-4 mt-1" />}</div>{flagged && <div className="flex flex-wrap gap-1.5">{requested && <Flag tone="alert">Cliente pediu cancelamento</Flag>}{owed && <Flag tone="alert"><AlertTriangle className="w-3 h-3" />Devolver {money(order.total)}</Flag>}{late && <Flag tone="warn"><Clock className="w-3 h-3" />Atrasado</Flag>}{abandoned && <Flag tone="warn">PIX não pago há {ABANDONED_PIX_MINUTES} min</Flag>}</div>}{abandoned && <button onClick={onCancelAbandoned} disabled={busy} className="w-full py-1.5 rounded-full border border-red-200 bg-red-50 text-red-700 text-[11px] font-bold disabled:opacity-40">{busy ? 'Cancelando...' : 'Cancelar pedido abandonado'}</button>}{expanded && <div className="space-y-2 text-[11px]"><div className="bg-[#F5F5F4] rounded-xl p-2"><strong>{order.address.street}, {order.address.number}</strong>{order.address.complement && <span> · {order.address.complement}</span>}{order.customerPhone && <a className="block text-[#059669] mt-1" href={whatsAppLink(order.customerPhone, `Olá, ${order.customerName}!`) } target="_blank" rel="noreferrer"><MessageCircle className="inline w-3 h-3 mr-1" />WhatsApp</a>}{order.driverName && <span className="block text-[#7C3AED]">🛵 {order.driverName}</span>}{order.driverLat && order.driverLng && <span className="block text-[#2563EB]"><MapPin className="inline w-3 h-3 mr-1" />GPS ativo</span>}</div><div className="space-y-1">{order.items.map((item) => <div key={item.id} className="flex justify-between gap-2"><span>{item.quantity}x {item.product.name}{item.isFree ? ' (grátis)' : ''}</span><strong>{money(item.itemTotalPrice)}</strong></div>)}</div><PaymentLine order={order} onConfirmPayment={onConfirmPayment} />{order.cancellationReason && <span className="block text-[#57534E]">Motivo: {order.cancellationReason}</span>}{next[order.status] && <button onClick={() => onAdvance(next[order.status]!)} className="w-full py-1.5 rounded-full bg-[#B91C1C] text-white font-bold">Avançar para {next[order.status]!.replace('_', ' ')}</button>}{order.status !== 'entregue' && order.status !== 'cancelado' && <button onClick={onCancel} disabled={busy} className="w-full py-1.5 rounded-full border border-red-200 bg-red-50 text-red-700 font-bold disabled:opacity-40">Cancelar pedido</button>}{order.rating && <span className="text-amber-700 font-bold"><Star className="inline w-3 h-3 fill-current" /> {order.rating}/5</span>}</div>}</div>;
};
