import assert from 'node:assert/strict';
import test from 'node:test';
import type { Order, StoreSettings } from '../src/types';
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

const deps = (saved: Order[], earned: { count: number }) => ({
  getSettings: () => ({ storeLat: -8.05, storeLng: -34.9 } as StoreSettings),
  getDriver: (id: string) => (id === 'driver-1' ? { id, name: 'João', active: true } : null),
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
    /Esta corrida não está atribuída/
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
