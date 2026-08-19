import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Server } from 'socket.io';
import type { CartItem, Order, Product } from '../src/types';
import { DomainError } from './errors';

// server/db.ts opens a real sqlite file at DATA_DIR the moment it is imported, and this repo's
// dev DATA_DIR already has a live Mercado Pago access token connected. This override MUST run
// before ./cancellation / ./orderStore are loaded (hence the dynamic imports below), or these
// tests would run against production data and could trigger a real Mercado Pago API call.
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'caldinho-cancel-test-'));
delete process.env.MP_ACCESS_TOKEN;

const { cancelOrder, defaultCancelReason } = await import('./cancellation');
const { getOrder, insertOrder } = await import('./orderStore');
const { consumeFreeItems } = await import('./loyalty');
const { createFreeRedeem, peekFreeRedeem } = await import('./db');

const freeProduct: Product = {
  id: 'prod-caldinho',
  name: 'Caldinho de Feijão',
  description: '',
  category: 'caldinhos',
  basePrice: 12,
  image: '',
  available: true,
  rating: 5,
  reviewsCount: 0,
  prepTimeMinutes: 10,
};

function freeItem(token: string): CartItem {
  return {
    id: 'item-1',
    product: freeProduct,
    selectedExtras: [],
    quantity: 1,
    itemTotalPrice: 0,
    isFree: true,
    freeToken: token,
  };
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'CX-CANCEL',
    customerId: 'anon',
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
    status: 'recebido',
    payment: { method: 'cash', isPaid: false },
    createdAt: '2026-08-18T14:30:00.000Z',
    estimatedDeliveryMinutes: 30,
    loyaltyPointsEarned: 0,
    ...overrides,
  };
}

function fakeIo() {
  const emitted: string[] = [];
  const io = {
    to: () => ({ emit: (event: string) => emitted.push(event) }),
  } as unknown as Server;
  return { io, emitted };
}

test('cancelling gives the loyalty free-item token back to the customer', () => {
  const { io } = fakeIo();
  const token = createFreeRedeem(freeProduct.id);
  const items = [freeItem(token)];
  consumeFreeItems(items);
  assert.equal(peekFreeRedeem(token, freeProduct.id), false);

  const order = makeOrder({ id: 'CX-CANCEL-TOKEN', items });
  insertOrder(order);
  cancelOrder(io, { order, reason: 'Cliente desistiu', by: 'cliente' });

  assert.equal(peekFreeRedeem(token, freeProduct.id), true);
});

test('cancelling records who cancelled it and when, in the stored order', () => {
  const { io, emitted } = fakeIo();
  const order = makeOrder({ id: 'CX-CANCEL-WHO' });
  insertOrder(order);

  const result = cancelOrder(io, { order, reason: 'Sem caldinho hoje', by: 'loja' });

  assert.equal(result.status, 'cancelado');
  assert.equal(result.cancelledBy, 'loja');
  assert.ok(result.cancelledAt && !Number.isNaN(Date.parse(result.cancelledAt)));
  assert.equal(result.cancellationReason, 'Sem caldinho hoje');

  const stored = getOrder('CX-CANCEL-WHO');
  assert.equal(stored?.status, 'cancelado');
  assert.equal(stored?.cancelledBy, 'loja');
  assert.equal(stored?.cancelledAt, result.cancelledAt);
  // customerId 'anon' drops the customer room, so a cancelled order fans out to
  // exactly two rooms (kitchen + drivers): more than that would mean cancelOrder
  // emitted more than once.
  assert.equal(emitted.length, 2);
});

test('cancelling a paid order leaves the money owed to the customer', () => {
  const { io } = fakeIo();
  const order = makeOrder({
    id: 'CX-CANCEL-PAID',
    payment: { method: 'pix', isPaid: true, mpPaymentId: '123' },
  });
  insertOrder(order);

  const result = cancelOrder(io, { order, reason: 'Cancelado pela loja', by: 'loja' });

  assert.equal(result.payment.refundStatus, 'pendente');
  assert.equal(getOrder('CX-CANCEL-PAID')?.payment.refundStatus, 'pendente');
});

test('cancelling an unpaid order flags no refund at all', () => {
  const { io } = fakeIo();
  const order = makeOrder({ id: 'CX-CANCEL-UNPAID', payment: { method: 'cash', isPaid: false } });
  insertOrder(order);

  const result = cancelOrder(io, { order, reason: defaultCancelReason('cliente'), by: 'cliente' });

  assert.equal(result.payment.refundStatus, undefined);
  assert.equal(getOrder('CX-CANCEL-UNPAID')?.payment.refundStatus, undefined);
});

test('cancelling twice does not hand the free-item token out a second time', () => {
  const { io } = fakeIo();
  const token = createFreeRedeem(freeProduct.id);
  const items = [freeItem(token)];
  consumeFreeItems(items);

  const order = makeOrder({ id: 'CX-CANCEL-TWICE', items });
  insertOrder(order);
  cancelOrder(io, { order, reason: 'Cliente desistiu', by: 'cliente' });
  assert.equal(peekFreeRedeem(token, freeProduct.id), true);

  // O cliente gasta o token devolvido num pedido novo. Um segundo cancelamento
  // do mesmo pedido não pode ressuscitar esse token já gasto.
  consumeFreeItems(items);
  const stored = getOrder('CX-CANCEL-TWICE')!;
  assert.throws(
    () => cancelOrder(io, { order: stored, reason: 'De novo', by: 'cliente' }),
    (error: unknown) => error instanceof DomainError && error.status === 400
  );
  assert.equal(peekFreeRedeem(token, freeProduct.id), false);
});
