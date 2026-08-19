import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Bike,
  ClipboardList,
  PauseCircle,
  Receipt,
  Ticket,
  TrendingUp,
  Users,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';
import type { Order, OrderStatus } from '../../types';
import { useKitchenOrders } from './KitchenOrdersStore';
import { useKitchenCatalog } from './KitchenCatalogStore';
import { useKitchenDrivers } from './KitchenDriversStore';
import { useKitchenSettings } from './KitchenSettingsStore';
import { useKitchenReports } from './KitchenReportsStore';
import { RevenueChart } from './RevenueChart';
import { KitchenDriverPanel } from './KitchenDriverPanel';
import { KitchenOrdersBoard } from './KitchenOrdersBoard';
import { Heading, Panel, Empty, SwitchToggle } from './KitchenPanels';
import { OrderReceiptModal } from '../../components/print/OrderReceiptModal';
import { money, pendingRefundTotal, shortDateTime } from './kitchenOrderRules';
import type { KitchenTab } from './kitchenTabs';

const ACTIVE_STATUSES: OrderStatus[] = ['recebido', 'em_preparo', 'pronto', 'saiu_entrega'];

export const KitchenOrderBoard: React.FC<{ activeTab: KitchenTab }> = ({ activeTab }) => {
  const { orders } = useKitchenOrders();
  const { products, coupons, toggleProductAvailability } = useKitchenCatalog();
  const { drivers } = useKitchenDrivers();
  const { settings } = useKitchenSettings();
  const { report, trends, loadReport, loadTrends } = useKitchenReports();
  const [printOrder, setPrintOrder] = useState<Order | null>(null);
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
    const pausedCount = products.filter((product) => !product.available).length;
    return (
      <div className="space-y-4 sm:space-y-5">
        <Heading icon={<BarChart3 />} title="Dashboard" subtitle="Visão geral da loja em tempo real." />

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3">
          <Metric className="col-span-2 lg:col-span-1" icon={<Wallet className="w-4 h-4" />} label="Vendas" value={money(totalRevenue)} />
          <Metric icon={<ClipboardList className="w-4 h-4" />} label="Pedidos ativos" value={String(activeOrders.length)} />
          <Metric icon={<TrendingUp className="w-4 h-4" />} label="Ticket médio" value={money(averageTicket)} accent />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
          <Metric icon={<UtensilsCrossed className="w-4 h-4" />} label="Itens no cardápio" value={String(products.length)} />
          <Metric icon={<PauseCircle className="w-4 h-4" />} label="Pausados" value={String(pausedCount)} accent={pausedCount > 0} />
          <Metric icon={<Ticket className="w-4 h-4" />} label="Cupons" value={String(coupons.length)} />
          <Metric icon={<Bike className="w-4 h-4" />} label="Motoboys" value={String(drivers.length)} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-4 items-start">
          <Panel title="Pedidos recentes">
            <p className="text-[11px] text-[#57534E] -mt-2 mb-2">Toque em um pedido para abrir a comanda.</p>
            <div className="max-h-80 overflow-y-auto -mx-1 px-1">
              {orders.slice(0, 8).map((order) => (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => setPrintOrder(order)}
                  title={`Ver a comanda do pedido ${order.id}`}
                  className="w-full text-left flex items-center gap-2.5 py-2.5 border-b last:border-0 border-[#F5F5F4] transition hover:bg-[#FAFAF9] active:scale-[0.99] rounded-xl"
                >
                  <span className="w-9 h-9 shrink-0 rounded-xl bg-[#FEF2F2] text-[#B91C1C] flex items-center justify-center">
                    <Receipt className="w-4 h-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <strong className="text-xs">{order.id}</strong>
                      <StatusPill status={order.status} />
                    </span>
                    <span className="block text-[11px] text-[#57534E] truncate">
                      {order.customerName} · {shortDateTime(order.createdAt)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-extrabold tabular-nums">{money(order.total)}</span>
                </button>
              ))}
            </div>
            {orders.length === 0 && <Empty text="Nenhum pedido ainda." />}
          </Panel>

          <Panel title="Status do cardápio">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 -mt-2 mb-2 text-[11px] font-bold">
              <span className="text-emerald-700">{products.length - pausedCount} no ar</span>
              <span className="text-[#B91C1C]">{pausedCount} pausado(s)</span>
              <span className="text-[#57534E] font-normal">Use o interruptor para pausar ou reativar.</span>
            </div>
            <div className="max-h-80 overflow-y-auto pr-1">
              {products.map((product) => (
                <div key={product.id} className="flex items-center gap-2 py-2 border-b last:border-0 border-[#F5F5F4] text-xs">
                  <span className={`w-2 h-2 shrink-0 rounded-full ${product.available ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  <span className={`flex-1 min-w-0 truncate ${product.available ? '' : 'line-through text-red-700'}`} title={product.name}>
                    {product.name}
                  </span>
                  <SwitchToggle
                    checked={product.available}
                    label={product.available ? `Pausar ${product.name}` : `Reativar ${product.name}`}
                    onChange={() => void toggleProductAvailability(product.id, product.available)}
                  />
                </div>
              ))}
              {products.length === 0 && <Empty text="Nenhum produto no cardápio." />}
            </div>
          </Panel>
        </div>

        {printOrder && (
          <OrderReceiptModal order={printOrder} storeName={settings.storeName} onClose={() => setPrintOrder(null)} />
        )}
      </div>
    );
  }

  if (activeTab === 'orders') {
    return <KitchenOrdersBoard />;
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

const Metric: React.FC<{ label: string; value: string; accent?: boolean; icon?: React.ReactNode; className?: string }> = ({ label, value, accent, icon, className = '' }) => (
  <div className={`bg-white rounded-2xl p-3 sm:p-4 border border-[#E7E5E4] shadow-xs min-w-0 ${className}`}>
    <span className="flex items-center gap-1.5 text-[10px] text-[#57534E] uppercase font-bold">
      {icon && <span className="text-[#B91C1C] shrink-0">{icon}</span>}
      <span className="truncate">{label}</span>
    </span>
    <div className={`font-extrabold text-lg sm:text-xl mt-1 truncate tabular-nums ${accent ? 'text-[#B91C1C]' : ''}`} title={value}>{value}</div>
  </div>
);

const STATUS_PILL: Record<OrderStatus, { label: string; className: string }> = {
  recebido: { label: 'Novo', className: 'bg-[#EFF6FF] text-[#1D4ED8]' },
  em_preparo: { label: 'Em preparo', className: 'bg-[#FFFBEB] text-[#B45309]' },
  pronto: { label: 'Pronto', className: 'bg-[#F5F3FF] text-[#6D28D9]' },
  saiu_entrega: { label: 'A caminho', className: 'bg-[#F5F3FF] text-[#7C3AED]' },
  entregue: { label: 'Concluído', className: 'bg-[#ECFDF5] text-[#047857]' },
  cancelado: { label: 'Cancelado', className: 'bg-[#FEF2F2] text-[#B91C1C]' },
};

const StatusPill: React.FC<{ status: OrderStatus }> = ({ status }) => {
  const pill = STATUS_PILL[status];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${pill.className}`}>{pill.label}</span>;
};
