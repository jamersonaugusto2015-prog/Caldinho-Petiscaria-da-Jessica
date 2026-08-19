import assert from 'node:assert/strict';
import test from 'node:test';
import type { Server } from 'socket.io';
import { Order } from '../src/types';
import { emitOrder, stripCustomerContact, stripPaymentSecrets } from './orderEvents';

interface Emission {
  rooms: string[];
  except: string[];
  event: string;
  order: Order;
}

function fakeIo(): { io: Server; sent: Emission[] } {
  const sent: Emission[] = [];
  const chain = (rooms: string[], except: string[]) => ({
    to: (room: string) => chain([...rooms, room], except),
    except: (room: string) => chain(rooms, [...except, room]),
    emit: (event: string, order: Order) => {
      sent.push({ rooms, except, event, order });
      return true;
    },
  });
  return { io: chain([], []) as unknown as Server, sent };
}

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'CX-TEST',
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
      complement: 'Apto 302',
      cep: '50050000',
      lat: -8.05,
      lng: -34.9,
      distanceKm: 3,
    },
    items: [],
    subtotal: 30,
    discount: 0,
    deliveryFee: 6,
    total: 36,
    distanceKm: 3,
    status: 'saiu_entrega',
    payment: { method: 'pix', isPaid: true, pixCopyPaste: 'segredo', pixQrCode: 'segredo' },
    createdAt: new Date(0).toISOString(),
    estimatedDeliveryMinutes: 30,
    loyaltyPointsEarned: 0,
    ...overrides,
  } as Order;
}

const forRoom = (sent: Emission[], room: string) => sent.filter((e) => e.rooms.includes(room));

test('an assigned order reaches only its own driver with the customer contact', () => {
  const { io, sent } = fakeIo();
  emitOrder(io, 'order:updated', order({ driverId: 'drv-1' }));

  const mine = forRoom(sent, 'driver:drv-1');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].order.customerName, 'Ana Maria');
  assert.equal(mine[0].order.customerPhone, '81999998888');
  assert.equal(mine[0].order.address.street, 'Rua da Aurora');
});

test('the other drivers get the same order without the customer contact', () => {
  const { io, sent } = fakeIo();
  emitOrder(io, 'order:updated', order({ driverId: 'drv-1' }));

  const pool = forRoom(sent, 'drivers');
  assert.equal(pool.length, 1);
  assert.deepEqual(pool[0].except, ['driver:drv-1']);
  assert.equal(pool[0].order.id, 'CX-TEST');
  assert.equal(pool[0].order.customerName, '');
  assert.equal(pool[0].order.customerPhone, '');
  assert.equal(pool[0].order.address.street, '');
  assert.equal(pool[0].order.address.number, '');
  assert.equal(pool[0].order.address.complement, undefined);
  assert.equal(pool[0].order.address.cep, undefined);
  assert.equal(pool[0].order.address.lat, undefined);
  assert.equal(pool[0].order.address.lng, undefined);
});

test('an unassigned ready order still reaches the whole pool with its address', () => {
  const { io, sent } = fakeIo();
  emitOrder(io, 'order:new', order({ status: 'pronto', driverId: undefined }));

  const pool = forRoom(sent, 'drivers');
  assert.equal(pool.length, 1);
  assert.deepEqual(pool[0].except, []);
  assert.equal(pool[0].order.address.street, 'Rua da Aurora');
});

test('a cancelled unassigned order reaches the pool stripped of the customer contact', () => {
  const { io, sent } = fakeIo();
  emitOrder(io, 'order:updated', order({ status: 'cancelado', driverId: undefined }));

  const pool = forRoom(sent, 'drivers');
  assert.equal(pool.length, 1);
  // O card precisa sumir da lista, mas ninguém vai entregar este pedido: nome,
  // telefone e endereço não têm por que ir para a sala compartilhada.
  assert.equal(pool[0].order.id, 'CX-TEST');
  assert.equal(pool[0].order.status, 'cancelado');
  assert.equal(pool[0].order.customerName, '');
  assert.equal(pool[0].order.customerPhone, '');
  assert.equal(pool[0].order.address.street, '');
  assert.equal(pool[0].order.address.number, '');
  assert.equal(pool[0].order.address.complement, undefined);
  assert.equal(pool[0].order.address.cep, undefined);
  assert.equal(pool[0].order.address.lat, undefined);
  assert.equal(pool[0].order.address.lng, undefined);
});

test('orders drivers have no business seeing are not sent to them at all', () => {
  const { io, sent } = fakeIo();
  emitOrder(io, 'order:new', order({ status: 'recebido', driverId: undefined }));

  assert.equal(forRoom(sent, 'drivers').length, 0);
  assert.equal(forRoom(sent, 'kitchen').length, 1);
  assert.equal(forRoom(sent, 'customer:cust-1').length, 1);
});

test('no driver room ever receives the PIX payment secrets', () => {
  const { io, sent } = fakeIo();
  emitOrder(io, 'order:updated', order({ driverId: 'drv-1' }));

  for (const emission of sent) {
    if (emission.rooms.some((room) => room.startsWith('driver'))) {
      assert.equal(emission.order.payment.pixCopyPaste, undefined);
      assert.equal(emission.order.payment.pixQrCode, undefined);
    }
  }
  assert.equal(forRoom(sent, 'kitchen')[0].order.payment.pixCopyPaste, 'segredo');
});

test('the customer keeps receiving their own full order', () => {
  const { io, sent } = fakeIo();
  emitOrder(io, 'order:updated', order({ driverId: 'drv-1' }));

  const mine = forRoom(sent, 'customer:cust-1');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].order.customerName, 'Ana Maria');
});

test('stripCustomerContact keeps what the pool needs to drop the card', () => {
  const redacted = stripCustomerContact(stripPaymentSecrets(order({ driverId: 'drv-1' })));
  assert.equal(redacted.id, 'CX-TEST');
  assert.equal(redacted.status, 'saiu_entrega');
  assert.equal(redacted.driverId, 'drv-1');
  assert.equal(redacted.total, 36);
});
