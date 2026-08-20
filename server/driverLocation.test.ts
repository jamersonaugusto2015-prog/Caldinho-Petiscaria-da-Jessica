import assert from 'node:assert/strict';
import test from 'node:test';
import { Driver, Order } from '../src/types';
import {
  DriverLocationDeps,
  LOCATION_STALE_AFTER_MS,
  LOCATION_TOUCH_MS,
  LocatedDriver,
  isValidCoordinate,
  lastKnownPosition,
  locationFreshness,
  locationTakenAt,
  recordDriverLocation,
} from './driverLocation';

function driver(overrides: Partial<LocatedDriver> = {}): LocatedDriver {
  return {
    id: 'drv-1',
    name: 'Marcos Motoboy',
    phone: '81988887777',
    active: true,
    online: true,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'CX-1',
    customerId: 'cust-1',
    customerName: 'Ana Maria',
    customerPhone: '81999998888',
    address: {
      id: 'addr-1',
      label: 'Casa',
      street: 'Rua da Aurora',
      number: '100',
      neighborhood: 'Boa Vista',
      city: 'Recife - PE',
      distanceKm: 3,
    },
    items: [],
    subtotal: 30,
    discount: 0,
    deliveryFee: 6,
    total: 36,
    distanceKm: 3,
    status: 'saiu_entrega',
    payment: { method: 'dinheiro', isPaid: false },
    createdAt: new Date(0).toISOString(),
    estimatedDeliveryMinutes: 30,
    driverId: 'drv-1',
    loyaltyPointsEarned: 0,
    ...overrides,
  } as Order;
}

interface Harness {
  deps: DriverLocationDeps;
  saved: Driver[];
  moves: { orderId: string; driverId: string; lat: number; lng: number }[];
  statusesAsked: string[];
  loads: number;
}

function harness(options: {
  driver?: Driver | null;
  orders?: Order[];
  applyMove?: (order: Order, driverId: string, lat: number, lng: number) => Order;
  onLoad?: (call: number) => Driver | null;
} = {}): Harness {
  const saved: Driver[] = [];
  const moves: Harness['moves'] = [];
  const statusesAsked: string[] = [];
  const state = { loads: 0 };
  const orders = options.orders ?? [];

  const deps: DriverLocationDeps = {
    loadDriver: () => {
      state.loads += 1;
      if (options.onLoad) return options.onLoad(state.loads);
      return options.driver === undefined ? driver() : options.driver;
    },
    saveDriver: (d) => {
      saved.push({ ...d });
    },
    listOrdersByStatus: (status) => {
      statusesAsked.push(status);
      return orders.filter((o) => o.status === status);
    },
    applyMove: (o, driverId, lat, lng) => {
      if (options.applyMove) return options.applyMove(o, driverId, lat, lng);
      moves.push({ orderId: o.id, driverId, lat, lng });
      return { ...o, driverLat: lat, driverLng: lng };
    },
  };

  return {
    deps,
    saved,
    moves,
    statusesAsked,
    get loads() {
      return state.loads;
    },
  } as Harness;
}

// --- isValidCoordinate -------------------------------------------------------

test('isValidCoordinate recusa o que não é número', () => {
  assert.equal(isValidCoordinate('-8.05', '-34.9'), false);
  assert.equal(isValidCoordinate(-8.05, '-34.9'), false);
  assert.equal(isValidCoordinate(null, -34.9), false);
  assert.equal(isValidCoordinate(undefined, undefined), false);
  assert.equal(isValidCoordinate({ lat: -8 }, -34.9), false);
  assert.equal(isValidCoordinate(true, false), false);
});

test('isValidCoordinate recusa NaN e infinito', () => {
  assert.equal(isValidCoordinate(NaN, -34.9), false);
  assert.equal(isValidCoordinate(-8.05, NaN), false);
  assert.equal(isValidCoordinate(Infinity, 0), false);
  assert.equal(isValidCoordinate(0, -Infinity), false);
});

test('isValidCoordinate recusa valores fora da faixa', () => {
  // Este 1e12 entrava no banco e no mapa.
  assert.equal(isValidCoordinate(1e12, -34.9), false);
  assert.equal(isValidCoordinate(-8.05, 1e12), false);
  assert.equal(isValidCoordinate(90.1, 0), false);
  assert.equal(isValidCoordinate(-90.1, 0), false);
  assert.equal(isValidCoordinate(0, 180.1), false);
  assert.equal(isValidCoordinate(0, -180.1), false);
});

test('isValidCoordinate aceita coordenada normal e as bordas válidas', () => {
  assert.equal(isValidCoordinate(-8.05, -34.9), true);
  assert.equal(isValidCoordinate(0, 0), true);
  assert.equal(isValidCoordinate(90, 180), true);
  assert.equal(isValidCoordinate(-90, -180), true);
});

// --- lastKnownPosition -------------------------------------------------------

test('lastKnownPosition devolve a última posição do motoboy', () => {
  assert.deepEqual(lastKnownPosition(driver({ lat: -8.05, lng: -34.9 })), {
    lat: -8.05,
    lng: -34.9,
  });
});

test('lastKnownPosition devolve null sem posição, com posição pela metade ou inválida', () => {
  assert.equal(lastKnownPosition(driver()), null);
  assert.equal(lastKnownPosition(driver({ lat: -8.05 })), null);
  assert.equal(lastKnownPosition(driver({ lng: -34.9 })), null);
  assert.equal(lastKnownPosition(driver({ lat: 1e12, lng: -34.9 })), null);
  assert.equal(lastKnownPosition(driver({ lat: NaN, lng: NaN })), null);
});

test('lastKnownPosition devolve null para motoboy nulo ou indefinido', () => {
  assert.equal(lastKnownPosition(null), null);
  assert.equal(lastKnownPosition(undefined), null);
});

// --- recordDriverLocation ----------------------------------------------------

test('recordDriverLocation move só as corridas do próprio motoboy em saiu_entrega', () => {
  const h = harness({
    orders: [
      order({ id: 'CX-MINHA', driverId: 'drv-1', status: 'saiu_entrega' }),
      order({ id: 'CX-OUTRO', driverId: 'drv-2', status: 'saiu_entrega' }),
      order({ id: 'CX-PRONTO', driverId: 'drv-1', status: 'pronto' }),
      order({ id: 'CX-ENTREGUE', driverId: 'drv-1', status: 'entregue' }),
      order({ id: 'CX-SEM-DONO', driverId: undefined, status: 'saiu_entrega' }),
    ],
  });

  const moved = recordDriverLocation('drv-1', -8.05, -34.9, h.deps);

  assert.deepEqual(h.statusesAsked, ['saiu_entrega']);
  assert.deepEqual(
    moved.map((o) => o.id),
    ['CX-MINHA']
  );
  assert.deepEqual(h.moves, [{ orderId: 'CX-MINHA', driverId: 'drv-1', lat: -8.05, lng: -34.9 }]);
  assert.equal(moved[0].driverLat, -8.05);
  assert.equal(moved[0].driverLng, -34.9);
});

test('recordDriverLocation ignora motoboy inativo ou inexistente', () => {
  const inativo = harness({
    driver: driver({ active: false }),
    orders: [order()],
  });
  assert.deepEqual(recordDriverLocation('drv-1', -8.05, -34.9, inativo.deps), []);
  assert.deepEqual(inativo.moves, []);
  assert.deepEqual(inativo.saved, []);

  const inexistente = harness({ driver: null, orders: [order()] });
  assert.deepEqual(recordDriverLocation('drv-1', -8.05, -34.9, inexistente.deps), []);
  assert.deepEqual(inexistente.moves, []);
  assert.deepEqual(inexistente.saved, []);
});

test('recordDriverLocation ignora coordenada inválida e id vazio', () => {
  for (const [lat, lng] of [
    [1e12, -34.9],
    [NaN, -34.9],
    [-8.05, Infinity],
    ['-8.05', '-34.9'],
    [null, null],
  ] as [unknown, unknown][]) {
    const h = harness({ orders: [order()] });
    assert.deepEqual(recordDriverLocation('drv-1', lat, lng, h.deps), []);
    assert.deepEqual(h.saved, []);
    assert.equal(h.loads, 0, 'nem chegou a ler o motoboy');
  }

  const semId = harness({ orders: [order()] });
  assert.deepEqual(recordDriverLocation('', -8.05, -34.9, semId.deps), []);
  assert.deepEqual(semId.saved, []);
});

test('recordDriverLocation não estoura quando applyMove lança e ainda move as demais', () => {
  const h = harness({
    orders: [
      order({ id: 'CX-1', status: 'saiu_entrega' }),
      order({ id: 'CX-ENTREGUE-NO-MEIO', status: 'saiu_entrega' }),
      order({ id: 'CX-3', status: 'saiu_entrega' }),
    ],
    applyMove: (o, driverId, lat, lng) => {
      // A corrida pode ter sido entregue entre a leitura e o ponto.
      if (o.id === 'CX-ENTREGUE-NO-MEIO') throw new Error('pedido já entregue');
      return { ...o, driverLat: lat, driverLng: lng, driverId };
    },
  });

  const moved = recordDriverLocation('drv-1', -8.05, -34.9, h.deps);

  assert.deepEqual(
    moved.map((o) => o.id),
    ['CX-1', 'CX-3']
  );
  // A posição do motoboy é gravada mesmo assim.
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].lat, -8.05);
});

test('recordDriverLocation grava a posição no motoboy', () => {
  const h = harness({ driver: driver({ lat: -8.0, lng: -34.8 }) });

  recordDriverLocation('drv-1', -8.05, -34.9, h.deps);

  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].id, 'drv-1');
  assert.equal(h.saved[0].lat, -8.05);
  assert.equal(h.saved[0].lng, -34.9);
});

test('recordDriverLocation não grava de novo quando a posição não mudou e o carimbo é novo', () => {
  const now = Date.parse('2026-08-20T12:00:00.000Z');
  const h = harness({
    driver: driver({ lat: -8.05, lng: -34.9, locationAt: new Date(now - 1000).toISOString() }),
  });

  recordDriverLocation('drv-1', -8.05, -34.9, h.deps, now);

  assert.deepEqual(h.saved, []);
});

test('recordDriverLocation renova o carimbo do motoboy parado no farol', () => {
  // Parado é diferente de sumido: sem renovar, o motoboy no semáforo apareceria
  // "sem sinal" na cozinha e o pino dele viraria "último ponto conhecido".
  const now = Date.parse('2026-08-20T12:00:00.000Z');
  const h = harness({
    driver: driver({
      lat: -8.05,
      lng: -34.9,
      locationAt: new Date(now - LOCATION_TOUCH_MS - 1).toISOString(),
    }),
  });

  recordDriverLocation('drv-1', -8.05, -34.9, h.deps, now);

  assert.equal(h.saved.length, 1);
  assert.equal((h.saved[0] as LocatedDriver).locationAt, new Date(now).toISOString());
});

test('recordDriverLocation relê o motoboy pelas deps antes de gravar', () => {
  // Entre o ponto do GPS e a gravação cabe um toque em "ficar offline".
  // Gravar o objeto lido antes ressuscitaria a presença desligada.
  const h = harness({
    onLoad: () => driver({ online: false }),
    orders: [order()],
  });

  recordDriverLocation('drv-1', -8.05, -34.9, h.deps);

  assert.equal(h.loads, 1, 'o motoboy precisa ser relido, não recebido de fora');
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].online, false, 'a presença desligada não pode voltar');
  assert.equal(h.saved[0].lat, -8.05);
});

test('recordDriverLocation devolve lista vazia quando o motoboy não tem corrida em rua', () => {
  const h = harness({ orders: [order({ status: 'pronto' })] });

  assert.deepEqual(recordDriverLocation('drv-1', -8.05, -34.9, h.deps), []);
  assert.equal(h.saved.length, 1, 'a posição continua sendo lembrada');
});

// --- idade da posição --------------------------------------------------------

test('recordDriverLocation carimba a hora em que o ponto foi tomado', () => {
  const now = Date.parse('2026-08-20T12:00:00.000Z');
  const h = harness({ driver: driver({ lat: -8.0, lng: -34.8 }) });

  recordDriverLocation('drv-1', -8.05, -34.9, h.deps, now);

  assert.equal(h.saved.length, 1);
  assert.equal((h.saved[0] as LocatedDriver).locationAt, '2026-08-20T12:00:00.000Z');
  assert.equal(locationTakenAt(h.saved[0]), now);
});

test('locationTakenAt devolve null sem carimbo ou com carimbo estragado', () => {
  assert.equal(locationTakenAt(driver()), null);
  assert.equal(locationTakenAt(driver({ locationAt: 'ontem' })), null);
  assert.equal(locationTakenAt(null), null);
  assert.equal(locationTakenAt(undefined), null);
});

test('locationFreshness separa o pino ao vivo do último ponto conhecido', () => {
  const now = Date.parse('2026-08-20T12:00:00.000Z');
  const emRota = driver({
    lat: -8.05,
    lng: -34.9,
    locationAt: new Date(now - LOCATION_STALE_AFTER_MS + 1000).toISOString(),
  });
  const noBolso = driver({
    lat: -8.05,
    lng: -34.9,
    locationAt: new Date(now - LOCATION_STALE_AFTER_MS - 1).toISOString(),
  });

  assert.equal(locationFreshness(emRota, now), 'live');
  // Tela bloqueada: o watch calou e o pino parou de andar. O mapa do cliente
  // precisa saber que este ponto é de onde ele ESTAVA.
  assert.equal(locationFreshness(noBolso, now), 'stale');
});

test('locationFreshness não deixa passar por ao vivo o ponto sem idade', () => {
  const now = Date.parse('2026-08-20T12:00:00.000Z');
  // Linhas gravadas antes do carimbo existir: idade desconhecida nunca é "live".
  assert.equal(locationFreshness(driver({ lat: -8.05, lng: -34.9 }), now), 'unknown');
  assert.equal(locationFreshness(driver({ locationAt: new Date(now).toISOString() }), now), 'unknown');
  assert.equal(locationFreshness(driver(), now), 'unknown');
  assert.equal(locationFreshness(null, now), 'unknown');
});
