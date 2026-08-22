import type { Order } from '../contract/order/types';
import type { RevenuePoint, RevenueTrends, SalesReport } from '../contract/report/types';
// `roundMoney` é a regra única de dinheiro; o `round2` do módulo geo que
// morava aqui era um segundo dialeto (Math.round puro) aplicado à receita.
import { roundMoney as round2 } from '../contract/pricing/money';
/**
 * O dia a que um instante pertence, no fuso DA LOJA.
 *
 * Antes isto usava os getters locais de `Date`, que seguem o fuso do PROCESSO.
 * Com uma loja em Recife e outra em Manaus no mesmo servidor, o pedido das
 * 23h50 de uma cairia no dia seguinte da outra — e o relatório de faturamento
 * de cada uma estaria errado em um dia, todo dia.
 *
 * `timeZone` vazio = o fuso do processo, que é o comportamento de sempre.
 */
export function localDateKey(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (!timeZone) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  // `en-CA` porque ele formata data como `AAAA-MM-DD`, que é exatamente a chave
  // que queremos — sem montar a string peça por peça.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** A hora do dia no fuso da loja. Usada na distribuição por hora do relatório. */
export function localHour(iso: string, timeZone?: string): number {
  const d = new Date(iso);
  if (!timeZone) return d.getHours();
  const hora = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(d);
  return Number(hora) || 0;
}

export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // segunda = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

export interface ReportRange {
  from?: string;
  to?: string;
  /** Fuso IANA da loja. Vazio = o fuso do processo. */
  timeZone?: string;
}

export function buildSalesReport(orders: Order[], range: ReportRange = {}): SalesReport {
  const from = String(range.from || '').slice(0, 10);
  const to = String(range.to || '').slice(0, 10);

  const inRange = (o: Order) => {
    const key = localDateKey(o.createdAt, range.timeZone);
    if (from && key < from) return false;
    if (to && key > to) return false;
    return true;
  };

  const filtered = orders.filter(inRange);
  const active = filtered.filter((o) => o.status !== 'cancelado');
  const totalRevenue = round2(active.reduce((s, o) => s + o.total, 0));
  const totalOrders = filtered.filter((o) => o.status !== 'cancelado').length;
  const avgTicket = totalOrders ? round2(totalRevenue / totalOrders) : 0;

  const topMap = new Map<string, { name: string; count: number; total: number }>();
  for (const o of active) {
    for (const item of o.items) {
      const cur = topMap.get(item.product.id) || { name: item.product.name, count: 0, total: 0 };
      cur.count += item.quantity;
      cur.total = round2(cur.total + item.itemTotalPrice);
      topMap.set(item.product.id, cur);
    }
  }
  const topSellingProducts = [...topMap.values()].sort((a, b) => b.count - a.count).slice(0, 5);

  const hourlyMap = new Map<number, number>();
  for (const o of active) {
    const hour = localHour(o.createdAt, range.timeZone);
    hourlyMap.set(hour, (hourlyMap.get(hour) || 0) + 1);
  }
  const hourlyDistribution = [...hourlyMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, ordersCount]) => ({ hour: `${hour}:00`, orders: ordersCount }));

  // Nota média das avaliações (pedidos entregues e avaliados)
  const rated = active.filter((o) => o.rating != null && o.rating > 0);
  const avgRating = rated.length
    ? round2(rated.reduce((s, o) => s + (o.rating || 0), 0) / rated.length)
    : 0;

  return {
    totalRevenue,
    totalOrders,
    avgTicket,
    topSellingProducts,
    hourlyDistribution,
    avgRating,
  };
}

export function buildRevenueTrends(orders: Order[], now: Date = new Date()): RevenueTrends {
  const active = orders.filter((o) => o.status !== 'cancelado');

  const add = (
    map: Map<string, { revenue: number; orders: number }>,
    key: string,
    total: number
  ) => {
    const cur = map.get(key) || { revenue: 0, orders: 0 };
    cur.revenue = round2(cur.revenue + total);
    cur.orders += 1;
    map.set(key, cur);
  };

  // Diário: últimos 30 dias
  const dailyMap = new Map<string, { revenue: number; orders: number }>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dailyMap.set(localDateKey(d.toISOString()), { revenue: 0, orders: 0 });
  }
  for (const o of active) {
    const k = localDateKey(o.createdAt);
    if (dailyMap.has(k)) add(dailyMap, k, o.total);
  }
  const daily = [...dailyMap.entries()].map(([date, v]) => ({
    label: `${date.slice(8, 10)}/${date.slice(5, 7)}`,
    date,
    revenue: v.revenue,
    orders: v.orders,
  }));

  // Semanal: últimas 12 semanas (segunda a domingo)
  const weeklyMap = new Map<string, { revenue: number; orders: number }>();
  for (let i = 11; i >= 0; i--) {
    const wk = new Date(now);
    wk.setDate(wk.getDate() - i * 7);
    weeklyMap.set(localDateKey(startOfWeek(wk).toISOString()), { revenue: 0, orders: 0 });
  }
  for (const o of active) {
    const k = localDateKey(startOfWeek(new Date(o.createdAt)).toISOString());
    if (weeklyMap.has(k)) add(weeklyMap, k, o.total);
  }
  const weekly = [...weeklyMap.entries()].map(([date, v]) => ({
    label: `${date.slice(8, 10)}/${date.slice(5, 7)}`,
    date,
    revenue: v.revenue,
    orders: v.orders,
  }));

  // Mensal: últimos 12 meses
  const monthlyMap = new Map<string, { revenue: number; orders: number }>();
  for (let i = 11; i >= 0; i--) {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    monthlyMap.set(key, { revenue: 0, orders: 0 });
  }
  for (const o of active) {
    const d = new Date(o.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (monthlyMap.has(key)) add(monthlyMap, key, o.total);
  }
  const monthShort = (d: Date) => d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  const monthly = [...monthlyMap.entries()].map(([key, v]) => {
    const [y, m] = key.split('-').map(Number);
    return {
      label: `${monthShort(new Date(y, m - 1, 1))}/${String(y).slice(2)}`,
      date: key,
      revenue: v.revenue,
      orders: v.orders,
    };
  });

  return { daily, weekly, monthly };
}
