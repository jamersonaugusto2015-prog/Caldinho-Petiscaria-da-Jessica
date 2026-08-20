import assert from 'node:assert/strict';
import test from 'node:test';
import type { Driver, Order, OrderStatus, StoreSettings } from '../src/types';
import { DomainError } from './errors';
import { applyOrderEvent } from './orderLifecycle';

const baseOrder = (): Order => ({
  id: 'CX-LIFE',
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
  items: [],
  subtotal: 20,
  discount: 0,
  deliveryFee: 5,
  total: 25,
  distanceKm: 1,
  status: 'saiu_entrega',
  payment: { method: 'pix', isPaid: true },
  createdAt: '2026-08-18T14:30:00.000Z',
  estimatedDeliveryMinutes: 30,
  driverId: 'driver-1',
  loyaltyPointsEarned: 0,
});

const driver = (overrides: Partial<Driver> = {}): Driver => ({
  id: 'driver-1',
  name: 'João',
  active: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

const deps = (saved: Order[], earned: { count: number }, motoboy: Driver = driver()) => ({
  getSettings: () => ({ storeLat: -8.05, storeLng: -34.9 } as StoreSettings),
  getDriver: (id: string) => (id === motoboy.id ? motoboy : null),
  earnStamp: () => {
    earned.count += 1;
    return 7;
  },
  saveOrder: (order: Order) => {
    saved.push(order);
  },
});

test('lifecycle advances delivery and awards one stamp', () => {
  const saved: Order[] = [];
  const earned = { count: 0 };
  const result = applyOrderEvent(baseOrder(), { type: 'advance', status: 'entregue', actor: 'driver', driverId: 'driver-1' }, deps(saved, earned));

  assert.equal(result.order.status, 'entregue');
  assert.equal(result.loyaltyPoints, 7);
  assert.equal(earned.count, 1);
  assert.equal(saved.length, 1);
});

test('lifecycle rejects a delivery update from another driver', () => {
  assert.throws(
    () => applyOrderEvent(baseOrder(), { type: 'advance', status: 'entregue', actor: 'driver', driverId: 'driver-2' }, deps([], { count: 0 })),
    (error: unknown) => {
      // "Não é sua" é 403 e continua sendo: quem chama distingue isso de "não pode".
      assert.ok(error instanceof DomainError);
      assert.equal(error.status, 403);
      assert.match(error.message, /Esta corrida não está atribuída/);
      return true;
    }
  );
});

test('a entrega grava a hora em que aconteceu', () => {
  const before = Date.now();
  const result = applyOrderEvent(
    baseOrder(),
    { type: 'advance', status: 'entregue', actor: 'driver', driverId: 'driver-1' },
    deps([], { count: 0 })
  );

  // Os ganhos do dia saem daqui: pela data de criação, um pedido feito às 23h50 e
  // entregue às 00h10 cairia no dia errado.
  assert.ok(result.order.deliveredAt);
  assert.ok(new Date(result.order.deliveredAt as string).getTime() >= before);
});

const openRide = (): Order => ({ ...baseOrder(), status: 'pronto', driverId: undefined });

test('aceitar a corrida não faz o pedido sair para entrega', () => {
  const saved: Order[] = [];
  const result = applyOrderEvent(openRide(), { type: 'assign', driverId: 'driver-1' }, deps(saved, { count: 0 }));

  // O motoboy ainda vai até a loja; o cliente não pode ler "saiu para entrega".
  assert.equal(result.order.status, 'pronto');
  assert.equal(result.order.driverId, 'driver-1');
  assert.equal(result.order.driverName, 'João');
  assert.equal(saved.length, 1);
});

test('o motoboy retira o pedido na loja e aí sim o pedido sai', () => {
  const accepted = applyOrderEvent(openRide(), { type: 'assign', driverId: 'driver-1' }, deps([], { count: 0 }));
  const result = applyOrderEvent(
    accepted.order,
    { type: 'advance', status: 'saiu_entrega', actor: 'driver', driverId: 'driver-1' },
    deps([], { count: 0 })
  );

  assert.equal(result.order.status, 'saiu_entrega');
});

test('o motoboy não retira o pedido da corrida de outro', () => {
  const mine = { ...openRide(), driverId: 'driver-1' };
  assert.throws(
    () =>
      applyOrderEvent(
        mine,
        { type: 'advance', status: 'saiu_entrega', actor: 'driver', driverId: 'driver-2' },
        deps([], { count: 0 })
      ),
    /Esta corrida não está atribuída/
  );
});

test('o motoboy não pula de pronto direto para entregue', () => {
  assert.throws(
    () =>
      applyOrderEvent(
        { ...openRide(), driverId: 'driver-1' },
        { type: 'advance', status: 'entregue', actor: 'driver', driverId: 'driver-1' },
        deps([], { count: 0 })
      ),
    /precisa passar pelo balcão/
  );
});

test('a cozinha não fecha o pedido de entrega sem ele sair da loja — era isso que pagava taxa por corrida não feita', () => {
  const saved: Order[] = [];
  const earned = { count: 0 };

  assert.throws(
    () =>
      applyOrderEvent(
        { ...openRide(), driverId: 'driver-1' },
        { type: 'advance', status: 'entregue', actor: 'kitchen' },
        deps(saved, earned)
      ),
    (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.status, 400);
      assert.match(error.message, /precisa passar pelo balcão/);
      return true;
    }
  );

  // Nada foi gravado: nem o status, nem o selo de fidelidade.
  assert.equal(saved.length, 0);
  assert.equal(earned.count, 0);
});

test('a cozinha despacha o pedido com ou sem motoboy atribuído', () => {
  const semMotoboy = applyOrderEvent(
    openRide(),
    { type: 'advance', status: 'saiu_entrega', actor: 'kitchen' },
    deps([], { count: 0 })
  );
  // Uma loja cujo motoboy não usa o app travaria aqui.
  assert.equal(semMotoboy.order.status, 'saiu_entrega');

  const comMotoboy = applyOrderEvent(
    { ...openRide(), driverId: 'driver-1' },
    { type: 'advance', status: 'saiu_entrega', actor: 'kitchen' },
    deps([], { count: 0 }, driver({ lat: -8.11, lng: -34.95 }))
  );
  assert.equal(comMotoboy.order.status, 'saiu_entrega');
  assert.equal(comMotoboy.order.driverLat, -8.11);
  assert.equal(comMotoboy.order.driverLng, -34.95);
});

test('a cozinha fecha o pedido depois que ele saiu para entrega', () => {
  const result = applyOrderEvent(
    baseOrder(),
    { type: 'advance', status: 'entregue', actor: 'kitchen' },
    deps([], { count: 0 })
  );
  assert.equal(result.order.status, 'entregue');
});

test('um status que não existe no fluxo continua sendo status inválido', () => {
  assert.throws(
    () =>
      applyOrderEvent(
        openRide(),
        { type: 'advance', status: 'a_caminho_da_lua' as OrderStatus, actor: 'kitchen' },
        deps([], { count: 0 })
      ),
    /Status inválido/
  );
});

test('a corrida nasce marcada na última posição conhecida do motoboy', () => {
  const perto = driver({ lat: -8.11, lng: -34.95 });
  const accepted = applyOrderEvent(
    openRide(),
    { type: 'assign', driverId: 'driver-1' },
    deps([], { count: 0 }, perto)
  );
  assert.equal(accepted.order.driverLat, -8.11);
  assert.equal(accepted.order.driverLng, -34.95);

  const saiu = applyOrderEvent(
    { ...openRide(), driverId: 'driver-1' },
    { type: 'advance', status: 'saiu_entrega', actor: 'driver', driverId: 'driver-1' },
    deps([], { count: 0 }, perto)
  );
  assert.equal(saiu.order.driverLat, -8.11);
  assert.equal(saiu.order.driverLng, -34.95);
});

test('sem posição conhecida a corrida cai para as coordenadas da loja', () => {
  const result = applyOrderEvent(openRide(), { type: 'assign', driverId: 'driver-1' }, deps([], { count: 0 }));
  assert.equal(result.order.driverLat, -8.05);
  assert.equal(result.order.driverLng, -34.9);
});

test('a posição só entra na corrida do dono e só enquanto ela está na rua', () => {
  const moved = applyOrderEvent(
    baseOrder(),
    { type: 'move', driverId: 'driver-1', lat: -8.07, lng: -34.88, at: '2026-08-20T12:00:00.000Z' },
    deps([], { count: 0 })
  );
  assert.equal(moved.order.driverLat, -8.07);
  assert.equal(moved.order.driverLng, -34.88);

  assert.throws(
    () =>
      applyOrderEvent(
        baseOrder(),
        { type: 'move', driverId: 'driver-2', lat: -8.07, lng: -34.88, at: '2026-08-20T12:00:00.000Z' },
        deps([], { count: 0 })
      ),
    /não pertence a esta corrida/
  );
  assert.throws(
    () =>
      applyOrderEvent(
        { ...baseOrder(), status: 'pronto' },
        { type: 'move', driverId: 'driver-1', lat: -8.07, lng: -34.88, at: '2026-08-20T12:00:00.000Z' },
        deps([], { count: 0 })
      ),
    /não pertence a esta corrida/
  );
});

test('lifecycle owns cancellation and rating writes', () => {
  const saved: Order[] = [];
  const earned = { count: 0 };
  const cancelled = applyOrderEvent(baseOrder(), { type: 'cancel', reason: 'Cliente desistiu' }, deps(saved, earned));
  assert.equal(cancelled.order.status, 'cancelado');
  assert.equal(cancelled.order.cancellationReason, 'Cliente desistiu');

  const rated = applyOrderEvent(baseOrder(), { type: 'rate', rating: 5, comment: 'Ótimo!' }, deps(saved, earned));
  assert.equal(rated.order.rating, 5);
  assert.equal(rated.order.ratingComment, 'Ótimo!');
  assert.equal(saved.length, 2);
});

test('a cancelled order can no longer be given stars', () => {
  assert.throws(
    () =>
      applyOrderEvent(
        { ...baseOrder(), status: 'cancelado' },
        { type: 'rate', rating: 5 },
        deps([], { count: 0 })
      ),
    /cancelado não pode ser avaliado/
  );
});

test('the customer may ask to cancel once the order left their hands', () => {
  for (const status of ['em_preparo', 'pronto', 'saiu_entrega'] as const) {
    const saved: Order[] = [];
    const result = applyOrderEvent(
      { ...baseOrder(), status },
      { type: 'request-cancel', reason: 'Pedi errado' },
      deps(saved, { count: 0 })
    );
    assert.equal(result.order.cancellationRequest?.status, 'pendente');
    assert.equal(result.order.cancellationRequest?.reason, 'Pedi errado');
    assert.ok(result.order.cancellationRequest?.requestedAt);
    assert.equal(saved.length, 1);
  }
});

test('a cancel request is refused before preparation and after delivery', () => {
  for (const status of ['recebido', 'entregue', 'cancelado'] as const) {
    assert.throws(
      () =>
        applyOrderEvent(
          { ...baseOrder(), status },
          { type: 'request-cancel', reason: 'Pedi errado' },
          deps([], { count: 0 })
        ),
      /não aceita mais um pedido de cancelamento/
    );
  }
});

test('a second cancel request is refused while the first waits for an answer', () => {
  const pending = {
    ...baseOrder(),
    cancellationRequest: {
      reason: 'Pedi errado',
      requestedAt: '2026-08-18T14:35:00.000Z',
      status: 'pendente' as const,
    },
  };
  assert.throws(
    () => applyOrderEvent(pending, { type: 'request-cancel', reason: 'De novo' }, deps([], { count: 0 })),
    /Já existe um pedido de cancelamento/
  );
});

test('accepting a request only records the answer — the cancelling itself is not lifecycle work', () => {
  const saved: Order[] = [];
  const pending = {
    ...baseOrder(),
    cancellationRequest: {
      reason: 'Pedi errado',
      requestedAt: '2026-08-18T14:35:00.000Z',
      status: 'pendente' as const,
    },
  };

  const result = applyOrderEvent(pending, { type: 'resolve-cancel', accept: true }, deps(saved, { count: 0 }));

  assert.equal(result.order.cancellationRequest?.status, 'aceito');
  assert.ok(result.order.cancellationRequest?.respondedAt);
  assert.equal(result.order.status, 'saiu_entrega');
  assert.equal(saved.length, 1);
});

test('refusing a request keeps the order alive and demands a note for the customer', () => {
  const pending = {
    ...baseOrder(),
    cancellationRequest: {
      reason: 'Pedi errado',
      requestedAt: '2026-08-18T14:35:00.000Z',
      status: 'pendente' as const,
    },
  };

  assert.throws(
    () => applyOrderEvent(pending, { type: 'resolve-cancel', accept: false }, deps([], { count: 0 })),
    /por que o cancelamento foi recusado/
  );

  const result = applyOrderEvent(
    pending,
    { type: 'resolve-cancel', accept: false, note: 'Já está na rua' },
    deps([], { count: 0 })
  );
  assert.equal(result.order.cancellationRequest?.status, 'recusado');
  assert.equal(result.order.cancellationRequest?.responseNote, 'Já está na rua');
  assert.equal(result.order.status, 'saiu_entrega');
});

test('there is nothing to resolve without a pending request', () => {
  assert.throws(
    () => applyOrderEvent(baseOrder(), { type: 'resolve-cancel', accept: true }, deps([], { count: 0 })),
    /Não há pedido de cancelamento/
  );
});

test('a complaint can only be opened once and only after delivery', () => {
  const saved: Order[] = [];
  const earned = { count: 0 };
  const delivered = { ...baseOrder(), status: 'entregue' as const, createdAt: new Date().toISOString() };

  const opened = applyOrderEvent(delivered, { type: 'complain', text: 'Veio frio' }, deps(saved, earned));
  assert.equal(opened.order.complaint?.status, 'aberta');
  assert.equal(opened.order.complaint?.text, 'Veio frio');

  assert.throws(() => applyOrderEvent(opened.order, { type: 'complain', text: 'De novo' }, deps(saved, earned)));
  assert.throws(() =>
    applyOrderEvent(baseOrder(), { type: 'complain', text: 'Ainda na rua' }, deps(saved, earned))
  );
});

test('the kitchen closes a complaint, and only an open one', () => {
  const saved: Order[] = [];
  const earned = { count: 0 };
  const delivered = { ...baseOrder(), status: 'entregue' as const, createdAt: new Date().toISOString() };
  const opened = applyOrderEvent(delivered, { type: 'complain', text: 'Veio frio' }, deps(saved, earned));

  const resolved = applyOrderEvent(opened.order, { type: 'resolve-complaint' }, deps(saved, earned));
  assert.equal(resolved.order.complaint?.status, 'resolvida');
  assert.ok(resolved.order.complaint?.resolvedAt);
  assert.equal(resolved.order.complaint?.text, 'Veio frio');

  assert.throws(() => applyOrderEvent(resolved.order, { type: 'resolve-complaint' }, deps(saved, earned)));
  assert.throws(() => applyOrderEvent(baseOrder(), { type: 'resolve-complaint' }, deps(saved, earned)));
});

const pickupOrder = (): Order => ({
  ...baseOrder(),
  fulfillment: 'pickup',
  status: 'pronto',
  deliveryFee: 0,
  distanceKm: 0,
  driverId: undefined,
});

test('retirada vai de pronto direto para entregue e ganha o selo', () => {
  const saved: Order[] = [];
  const earned = { count: 0 };
  const result = applyOrderEvent(
    pickupOrder(),
    { type: 'advance', status: 'entregue', actor: 'kitchen' },
    deps(saved, earned)
  );

  // Na entrega este passo é um pulo; na retirada ele **é** a passagem de balcão:
  // o cliente leva o pedido e acaba ali. O portão não pode barrar este caso.
  assert.equal(result.order.status, 'entregue');
  assert.equal(earned.count, 1);
});

test('a retirada não é corrida de motoboy nem quando o motoboy pede', () => {
  assert.throws(
    () =>
      applyOrderEvent(
        pickupOrder(),
        { type: 'advance', status: 'entregue', actor: 'driver', driverId: 'driver-1' },
        deps([], { count: 0 })
      ),
    /não tem corrida/
  );
});

test('retirada nunca sai para entrega', () => {
  assert.throws(
    () =>
      applyOrderEvent(
        pickupOrder(),
        { type: 'advance', status: 'saiu_entrega', actor: 'kitchen' },
        deps([], { count: 0 })
      ),
    /não sai para entrega/
  );
});

test('retirada não pode ser aceita por um motoboy', () => {
  assert.throws(
    () => applyOrderEvent(pickupOrder(), { type: 'assign', driverId: 'driver-1' }, deps([], { count: 0 })),
    /não tem corrida/
  );
});
