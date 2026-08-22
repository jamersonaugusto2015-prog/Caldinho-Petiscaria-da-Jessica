import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import type { Server } from 'socket.io';
import type { Order } from '../contract/order/types';
import { customerRoom, driverRoom, driversRoom, kitchenRoom } from '../contract/shop/rooms';
// Quem decide a audiência é `orderAudience.ts` e ele é testado sozinho, sem
// `io` nenhum. O que sobra aqui é o adaptador: a mesma audiência, expressa em
// salas do socket.io — inclusive o `.except()` do dono da corrida.
//
// `emitOrder` dispara o push junto, e `push.ts` puxa `db.ts`, que abre o sqlite
// real assim que é importado. O DATA_DIR de desenvolvimento deste repo é o
// banco de verdade do usuário, então o override precisa rodar ANTES do import —
// daí o import dinâmico, como em `driverSession.test.ts`.
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'caldinho-order-events-test-'));
process.env.DATA_DIR = DATA_DIR;

const { emitOrder, stripCustomerContact, stripPaymentSecrets } = await import('./orderEvents');

// Única loja usada neste arquivo: a migração 005_shops garante o id 1 em todo banco novo.
const LOJA = 1;

after(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
});

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
  emitOrder(io, LOJA, 'order:updated', order({ driverId: 'drv-1' }));

  const mine = forRoom(sent, driverRoom(LOJA, 'drv-1'));
  assert.equal(mine.length, 1);
  assert.equal(mine[0].order.customerName, 'Ana Maria');
  assert.equal(mine[0].order.customerPhone, '81999998888');
  assert.equal(mine[0].order.address.street, 'Rua da Aurora');
});

test('the other drivers get the same order without the customer contact', () => {
  const { io, sent } = fakeIo();
  emitOrder(io, LOJA, 'order:updated', order({ driverId: 'drv-1', driverPhone: '81988887777' }));

  const pool = forRoom(sent, driversRoom(LOJA));
  assert.equal(pool.length, 1);
  assert.deepEqual(pool[0].except, [driverRoom(LOJA, 'drv-1')]);
  assert.equal(pool[0].order.id, 'CX-TEST');
  assert.equal(pool[0].order.customerId, '');
  assert.equal(pool[0].order.driverPhone, undefined);
  assert.equal(pool[0].order.customerName, '');
  assert.equal(pool[0].order.customerPhone, '');
  assert.equal(pool[0].order.address.street, '');
  assert.equal(pool[0].order.address.number, '');
  assert.equal(pool[0].order.address.complement, undefined);
  assert.equal(pool[0].order.address.cep, undefined);
  assert.equal(pool[0].order.address.lat, undefined);
  assert.equal(pool[0].order.address.lng, undefined);
});

test('an open ride reaches the whole pool already redacted', () => {
  const { io, sent } = fakeIo();
  emitOrder(io, LOJA, 'order:new', order({ status: 'pronto', driverId: undefined }));

  const pool = forRoom(sent, driversRoom(LOJA));
  assert.equal(pool.length, 1);
  assert.deepEqual(pool[0].except, []);
  // O motoboy decide pelo bairro, pela distância e pela taxa; o nome, o telefone
  // e a rua são só do dono da corrida.
  assert.equal(pool[0].order.address.neighborhood, 'Boa Vista');
  assert.equal(pool[0].order.distanceKm, 3);
  assert.equal(pool[0].order.deliveryFee, 6);
  assert.equal(pool[0].order.customerName, '');
  assert.equal(pool[0].order.customerPhone, '');
  assert.equal(pool[0].order.address.street, '');
});

test('customerId does not survive the redaction', () => {
  const { io, sent } = fakeIo();
  emitOrder(io, LOJA, 'order:new', order({ status: 'pronto', driverId: undefined }));

  // Com o id do cliente na mão, a rota do cliente devolvia o resto do pedido.
  assert.equal(forRoom(sent, driversRoom(LOJA))[0].order.customerId, '');
});

test('an order the kitchen sent out with no driver still reaches the pool', () => {
  const { io, sent } = fakeIo();
  emitOrder(io, LOJA, 'order:updated', order({ status: 'saiu_entrega', driverId: undefined }));

  // Sem este evento a corrida some da cozinha e continua listada como disponível
  // na tela de todos os motoboys até um refetch.
  const pool = forRoom(sent, driversRoom(LOJA));
  assert.equal(pool.length, 1);
  assert.equal(pool[0].order.status, 'saiu_entrega');
  assert.equal(pool[0].order.customerName, '');
});

test('a delivered order reaches the pool so the card leaves the list', () => {
  const { io, sent } = fakeIo();
  emitOrder(io, LOJA, 'order:updated', order({ status: 'entregue', driverId: 'drv-1' }));

  const pool = forRoom(sent, driversRoom(LOJA));
  assert.equal(pool.length, 1);
  assert.deepEqual(pool[0].except, [driverRoom(LOJA, 'drv-1')]);
  assert.equal(pool[0].order.customerName, '');
});

test('a pickup order never reaches the drivers', () => {
  const { io, sent } = fakeIo();
  emitOrder(io, LOJA, 'order:updated', order({ status: 'pronto', driverId: undefined, fulfillment: 'pickup' }));

  assert.equal(forRoom(sent, driversRoom(LOJA)).length, 0);
});

test('a cancelled unassigned order reaches the pool stripped of the customer contact', () => {
  const { io, sent } = fakeIo();
  emitOrder(io, LOJA, 'order:updated', order({ status: 'cancelado', driverId: undefined }));

  const pool = forRoom(sent, driversRoom(LOJA));
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
  emitOrder(io, LOJA, 'order:new', order({ status: 'recebido', driverId: undefined }));

  assert.equal(forRoom(sent, driversRoom(LOJA)).length, 0);
  assert.equal(forRoom(sent, kitchenRoom(LOJA)).length, 1);
  assert.equal(forRoom(sent, customerRoom(LOJA, 'cust-1')).length, 1);
});

test('no driver room ever receives the PIX payment secrets', () => {
  const { io, sent } = fakeIo();
  emitOrder(io, LOJA, 'order:updated', order({ driverId: 'drv-1' }));

  for (const emission of sent) {
    if (emission.rooms.some((room) => room.startsWith('driver'))) {
      assert.equal(emission.order.payment.pixCopyPaste, undefined);
      assert.equal(emission.order.payment.pixQrCode, undefined);
    }
  }
  assert.equal(forRoom(sent, kitchenRoom(LOJA))[0].order.payment.pixCopyPaste, 'segredo');
});

test('the customer keeps receiving their own full order', () => {
  const { io, sent } = fakeIo();
  emitOrder(io, LOJA, 'order:updated', order({ driverId: 'drv-1' }));

  const mine = forRoom(sent, customerRoom(LOJA, 'cust-1'));
  assert.equal(mine.length, 1);
  assert.equal(mine[0].order.customerName, 'Ana Maria');
});

test('the socket fan-out is exactly the audience, room for room', async () => {
  const { orderAudience } = await import('../contract/order/audience');
  for (const sample of [
    order({ driverId: 'drv-1' }),
    order({ status: 'pronto', driverId: undefined }),
    order({ status: 'recebido', driverId: undefined }),
    order({ status: 'pronto', driverId: undefined, fulfillment: 'pickup' }),
    order({ status: 'entregue', driverId: 'drv-1', customerId: 'anon' }),
  ]) {
    const { io, sent } = fakeIo();
    emitOrder(io, LOJA, 'order:updated', sample);
    const audience = orderAudience(LOJA, sample);
    assert.equal(sent.length, audience.length);
    audience.forEach((recipient, index) => {
      assert.deepEqual(sent[index].rooms, [recipient.room]);
      assert.deepEqual(sent[index].except, recipient.except ? [recipient.except] : []);
      // O transporte não redige: ele entrega a vista que a audiência montou.
      assert.deepEqual(sent[index].order, recipient.order);
    });
  }
});

test('stripCustomerContact keeps what the pool needs to drop the card', () => {
  const redacted = stripCustomerContact(stripPaymentSecrets(order({ driverId: 'drv-1' })));
  assert.equal(redacted.id, 'CX-TEST');
  assert.equal(redacted.status, 'saiu_entrega');
  assert.equal(redacted.driverId, 'drv-1');
  assert.equal(redacted.total, 36);
});
