import assert from 'node:assert/strict';
import test from 'node:test';
import type { Product } from '../contract/catalog/types';
import type { CartItem, Order } from '../contract/order/types';
import { buildRevenueTrends, buildSalesReport, localDateKey, startOfWeek, localHour } from './reports';

// A loja roda com TZ=America/Recife (UTC-3, sem horário de verão) em produção; fixamos o
// fuso do processo aqui para que os testes de fronteira de dia sejam determinísticos
// independentemente de onde rodam.
process.env.TZ = 'America/Recife';

function makeProduct(id: string, name: string): Product {
  return {
    id,
    name,
    description: '',
    category: 'caldinhos',
    basePrice: 10,
    image: '',
    available: true,
    rating: 5,
    reviewsCount: 0,
    prepTimeMinutes: 10,
  };
}

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'item-1',
    product: makeProduct('p1', 'Caldinho de Feijão'),
    selectedExtras: [],
    quantity: 1,
    itemTotalPrice: 10,
    ...overrides,
  };
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'CX-REPORT',
    customerId: 'customer-1',
    customerName: 'Ana',
    customerPhone: '',
    address: {
      id: 'addr-1',
      label: 'Casa',
      street: 'Rua Teste',
      number: '10',
      neighborhood: 'Centro',
      city: 'Recife',
      distanceKm: 1,
    },
    items: [makeItem()],
    subtotal: 10,
    discount: 0,
    deliveryFee: 5,
    total: 15,
    distanceKm: 1,
    status: 'entregue',
    payment: { method: 'pix', isPaid: true },
    createdAt: '2026-08-18T14:30:00.000Z',
    estimatedDeliveryMinutes: 30,
    loyaltyPointsEarned: 0,
    ...overrides,
  };
}

test('localDateKey buckets an order placed just before local midnight into the previous day', () => {
  // 2026-08-18T02:30:00Z is 2026-08-17T23:30 in America/Recife (UTC-3).
  assert.equal(localDateKey('2026-08-18T02:30:00.000Z'), '2026-08-17');
  // 2026-08-18T03:30:00Z is already 2026-08-18T00:30 local.
  assert.equal(localDateKey('2026-08-18T03:30:00.000Z'), '2026-08-18');
});

test('startOfWeek anchors on Monday local time', () => {
  // 2026-08-18 is a Tuesday in America/Recife.
  const monday = startOfWeek(new Date('2026-08-18T14:30:00.000Z'));
  assert.equal(localDateKey(monday.toISOString()), '2026-08-17');
});

test('buildSalesReport filters by local date range across the timezone boundary', () => {
  const justBeforeMidnight = makeOrder({ id: 'CX-1', createdAt: '2026-08-18T02:30:00.000Z', total: 20 });
  const justAfterMidnight = makeOrder({ id: 'CX-2', createdAt: '2026-08-18T03:30:00.000Z', total: 30 });

  const onlyThe18th = buildSalesReport([justBeforeMidnight, justAfterMidnight], {
    from: '2026-08-18',
    to: '2026-08-18',
  });
  assert.equal(onlyThe18th.totalOrders, 1);
  assert.equal(onlyThe18th.totalRevenue, 30);

  const onlyThe17th = buildSalesReport([justBeforeMidnight, justAfterMidnight], {
    from: '2026-08-17',
    to: '2026-08-17',
  });
  assert.equal(onlyThe17th.totalOrders, 1);
  assert.equal(onlyThe17th.totalRevenue, 20);
});

test('buildSalesReport excludes cancelled orders from revenue, ticket and top products', () => {
  const cancelled = makeOrder({ id: 'CX-CANC', status: 'cancelado', total: 999 });
  const active = makeOrder({ id: 'CX-OK', total: 15 });
  const report = buildSalesReport([cancelled, active]);
  assert.equal(report.totalOrders, 1);
  assert.equal(report.totalRevenue, 15);
  assert.equal(report.avgTicket, 15);
});

test('buildSalesReport ranks top-selling products by quantity and sums their revenue', () => {
  const orderA = makeOrder({
    id: 'CX-A',
    items: [
      makeItem({ product: makeProduct('p1', 'Caldinho de Feijão'), quantity: 3, itemTotalPrice: 30 }),
      makeItem({ id: 'item-2', product: makeProduct('p2', 'Caldinho de Camarão'), quantity: 1, itemTotalPrice: 12 }),
    ],
  });
  const orderB = makeOrder({
    id: 'CX-B',
    items: [makeItem({ product: makeProduct('p1', 'Caldinho de Feijão'), quantity: 2, itemTotalPrice: 20 })],
  });
  const report = buildSalesReport([orderA, orderB]);
  assert.equal(report.topSellingProducts[0].name, 'Caldinho de Feijão');
  assert.equal(report.topSellingProducts[0].count, 5);
  assert.equal(report.topSellingProducts[0].total, 50);
  assert.equal(report.topSellingProducts[1].name, 'Caldinho de Camarão');
  assert.equal(report.topSellingProducts[1].count, 1);
});

test('buildSalesReport buckets hourly distribution by local hour, sorted ascending', () => {
  const early = makeOrder({ id: 'CX-EARLY', createdAt: '2026-08-18T11:00:00.000Z' }); // 08:00 local
  const late = makeOrder({ id: 'CX-LATE', createdAt: '2026-08-18T22:00:00.000Z' }); // 19:00 local
  const lateAgain = makeOrder({ id: 'CX-LATE-2', createdAt: '2026-08-18T22:30:00.000Z' }); // 19:00 local
  const report = buildSalesReport([late, early, lateAgain]);
  assert.deepEqual(
    report.hourlyDistribution,
    [
      { hour: '8:00', orders: 1 },
      { hour: '19:00', orders: 2 },
    ]
  );
});

test('buildSalesReport averages only orders that received a rating', () => {
  const rated = makeOrder({ id: 'CX-RATED', rating: 4 });
  const ratedAgain = makeOrder({ id: 'CX-RATED-2', rating: 2 });
  const unrated = makeOrder({ id: 'CX-UNRATED' });
  const report = buildSalesReport([rated, ratedAgain, unrated]);
  assert.equal(report.avgRating, 3);
});

test('buildSalesReport with no orders returns a fully zeroed report, not undefined fields', () => {
  const report = buildSalesReport([]);
  assert.deepEqual(report, {
    totalRevenue: 0,
    totalOrders: 0,
    avgTicket: 0,
    topSellingProducts: [],
    hourlyDistribution: [],
    avgRating: 0,
  });
});

test('buildRevenueTrends zero-fills empty windows instead of leaving gaps', () => {
  const now = new Date('2026-08-18T14:30:00.000Z');
  const trends = buildRevenueTrends([], now);
  assert.equal(trends.daily.length, 30);
  assert.equal(trends.weekly.length, 12);
  assert.equal(trends.monthly.length, 12);
  assert.ok(trends.daily.every((p) => p.revenue === 0 && p.orders === 0));
  assert.ok(trends.weekly.every((p) => p.revenue === 0 && p.orders === 0));
  assert.ok(trends.monthly.every((p) => p.revenue === 0 && p.orders === 0));
  // The most recent bucket in each window is "today" local time.
  assert.equal(trends.daily[trends.daily.length - 1].date, '2026-08-18');
});

test('buildRevenueTrends places an order just before local midnight in the correct daily bucket', () => {
  const now = new Date('2026-08-18T14:30:00.000Z');
  const order = makeOrder({ id: 'CX-EDGE', createdAt: '2026-08-18T02:30:00.000Z', total: 40 });
  const trends = buildRevenueTrends([order], now);
  const bucket17 = trends.daily.find((p) => p.date === '2026-08-17');
  const bucket18 = trends.daily.find((p) => p.date === '2026-08-18');
  assert.ok(bucket17);
  assert.ok(bucket18);
  assert.equal(bucket17!.revenue, 40);
  assert.equal(bucket17!.orders, 1);
  assert.equal(bucket18!.revenue, 0);
  assert.equal(bucket18!.orders, 0);
});

test('buildRevenueTrends excludes cancelled orders from every window', () => {
  const now = new Date('2026-08-18T14:30:00.000Z');
  const cancelled = makeOrder({ id: 'CX-CANC', status: 'cancelado', createdAt: now.toISOString(), total: 500 });
  const trends = buildRevenueTrends([cancelled], now);
  assert.ok(trends.daily.every((p) => p.revenue === 0));
  assert.ok(trends.weekly.every((p) => p.revenue === 0));
  assert.ok(trends.monthly.every((p) => p.revenue === 0));
});

test('buildRevenueTrends aggregates weekly totals for orders within the same Monday-Sunday week', () => {
  const now = new Date('2026-08-18T14:30:00.000Z'); // Tuesday
  const monday = makeOrder({ id: 'CX-MON', createdAt: '2026-08-17T13:00:00.000Z', total: 10 });
  const sunday = makeOrder({ id: 'CX-SUN', createdAt: '2026-08-23T13:00:00.000Z', total: 20 });
  const trends = buildRevenueTrends([monday, sunday], now);
  const bucket = trends.weekly.find((p) => p.date === '2026-08-17');
  assert.ok(bucket);
  assert.equal(bucket!.orders, 2);
  assert.equal(bucket!.revenue, 30);
});

test('buildRevenueTrends aggregates monthly totals by local calendar month', () => {
  const now = new Date('2026-08-18T14:30:00.000Z');
  const order = makeOrder({ id: 'CX-MONTH', createdAt: '2026-08-05T13:00:00.000Z', total: 25 });
  const trends = buildRevenueTrends([order], now);
  const bucket = trends.monthly.find((p) => p.date === '2026-08');
  assert.ok(bucket);
  assert.equal(bucket!.revenue, 25);
  assert.equal(bucket!.orders, 1);
});

test('o dia de um pedido segue o fuso DA LOJA, não o do servidor', () => {
  // 2026-03-10T02:30:00Z é 23h30 do dia 9 em Recife (UTC-3) e 22h30 do dia 9 em
  // Manaus (UTC-4). Com o fuso do processo, duas lojas no mesmo servidor
  // veriam o mesmo pedido em dias diferentes do relatório uma da outra.
  const instante = '2026-03-10T02:30:00.000Z';
  assert.equal(localDateKey(instante, 'America/Recife'), '2026-03-09');
  assert.equal(localDateKey(instante, 'America/Manaus'), '2026-03-09');
  // Meia hora depois já virou o dia em Recife, mas não em Manaus.
  const depois = '2026-03-10T03:30:00.000Z';
  assert.equal(localDateKey(depois, 'America/Recife'), '2026-03-10');
  assert.equal(localDateKey(depois, 'America/Manaus'), '2026-03-09');
});

test('a hora do relatório também segue o fuso da loja', () => {
  const instante = '2026-03-10T02:30:00.000Z';
  assert.equal(localHour(instante, 'America/Recife'), 23);
  assert.equal(localHour(instante, 'America/Manaus'), 22);
});

test('sem fuso configurado, tudo continua como sempre foi', () => {
  const instante = '2026-03-10T02:30:00.000Z';
  assert.equal(localDateKey(instante, undefined), localDateKey(instante));
  assert.equal(localHour(instante, undefined), new Date(instante).getHours());
});

test('a janela do relatório é recortada no fuso da loja', () => {
  const pedido = makeOrder({ createdAt: '2026-03-10T02:30:00.000Z', total: 50 });
  // Em Recife o pedido é do dia 9.
  const emRecife = buildSalesReport([pedido], { from: '2026-03-09', to: '2026-03-09', timeZone: 'America/Recife' });
  assert.equal(emRecife.totalOrders, 1);
  // E não é do dia 10.
  const noDia10 = buildSalesReport([pedido], { from: '2026-03-10', to: '2026-03-10', timeZone: 'America/Recife' });
  assert.equal(noDia10.totalOrders, 0);
});
