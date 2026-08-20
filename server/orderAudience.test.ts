import assert from 'node:assert/strict';
import test from 'node:test';
import { Order } from '../src/types';
import { OrderRecipient, orderAudience } from './orderAudience';

// A audiência é um valor puro: nada de `io` falso, nada de banco. O que estes
// testes provam é quem recebe o quê — e o socket e o push herdam a resposta.

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

const inRoom = (audience: OrderRecipient[], room: string) => audience.filter((r) => r.room === room);

test('a cozinha está sempre na audiência, com o pedido inteiro', () => {
  const audience = orderAudience(order({ driverId: 'drv-1' }));
  const kitchen = inRoom(audience, 'kitchen');
  assert.equal(kitchen.length, 1);
  assert.equal(kitchen[0].role, 'kitchen');
  assert.equal(kitchen[0].order.customerName, 'Ana Maria');
  assert.equal(kitchen[0].order.payment.pixCopyPaste, 'segredo');
});

test('a corrida aceita entra na sala do dono com o contato do cliente', () => {
  const audience = orderAudience(order({ driverId: 'drv-1' }));
  const mine = inRoom(audience, 'driver:drv-1');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].role, 'driver');
  assert.equal(mine[0].driverId, 'drv-1');
  assert.equal(mine[0].order.customerName, 'Ana Maria');
  assert.equal(mine[0].order.customerPhone, '81999998888');
  assert.equal(mine[0].order.address.street, 'Rua da Aurora');
});

test('o pool recebe o mesmo pedido sem o contato do cliente, descontando o dono', () => {
  const audience = orderAudience(order({ driverId: 'drv-1', driverPhone: '81988887777' }));
  const pool = inRoom(audience, 'drivers');
  assert.equal(pool.length, 1);
  assert.equal(pool[0].except, 'driver:drv-1');
  assert.equal(pool[0].driverId, undefined);
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

test('a corrida sem dono chega ao pool inteiro já redigida', () => {
  const audience = orderAudience(order({ status: 'pronto', driverId: undefined }));
  const pool = inRoom(audience, 'drivers');
  assert.equal(pool.length, 1);
  assert.equal(pool[0].except, undefined);
  // O motoboy decide pelo bairro, pela distância e pela taxa; o nome, o telefone
  // e a rua são só do dono da corrida.
  assert.equal(pool[0].order.address.neighborhood, 'Boa Vista');
  assert.equal(pool[0].order.distanceKm, 3);
  assert.equal(pool[0].order.deliveryFee, 6);
  assert.equal(pool[0].order.customerName, '');
  assert.equal(pool[0].order.customerPhone, '');
  assert.equal(pool[0].order.address.street, '');
  // Com o id do cliente na mão, a rota do cliente devolvia o resto do pedido.
  assert.equal(pool[0].order.customerId, '');
});

test('o pedido que a cozinha despachou sozinha ainda alcança o pool', () => {
  // Sem este destinatário a corrida some da cozinha e continua listada como
  // disponível na tela de todos os motoboys até um refetch.
  const audience = orderAudience(order({ status: 'saiu_entrega', driverId: undefined }));
  const pool = inRoom(audience, 'drivers');
  assert.equal(pool.length, 1);
  assert.equal(pool[0].order.status, 'saiu_entrega');
  assert.equal(pool[0].order.customerName, '');
});

test('o pedido entregue alcança o pool para o card sair da lista', () => {
  const audience = orderAudience(order({ status: 'entregue', driverId: 'drv-1' }));
  const pool = inRoom(audience, 'drivers');
  assert.equal(pool.length, 1);
  assert.equal(pool[0].except, 'driver:drv-1');
  assert.equal(pool[0].order.customerName, '');
});

test('o pedido de retirada nunca chega aos motoboys', () => {
  const audience = orderAudience(
    order({ status: 'pronto', driverId: undefined, fulfillment: 'pickup' })
  );
  assert.equal(inRoom(audience, 'drivers').length, 0);
});

test('o cancelado sem dono chega ao pool sem o contato do cliente', () => {
  const audience = orderAudience(order({ status: 'cancelado', driverId: undefined }));
  const pool = inRoom(audience, 'drivers');
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

test('status que não é da conta do motoboy não gera destinatário de motoboy', () => {
  const audience = orderAudience(order({ status: 'recebido', driverId: undefined }));
  assert.equal(audience.filter((r) => r.role === 'driver').length, 0);
  assert.equal(inRoom(audience, 'kitchen').length, 1);
  assert.equal(inRoom(audience, 'customer:cust-1').length, 1);
});

test('nenhum destinatário motoboy carrega os segredos do PIX', () => {
  const audience = orderAudience(order({ driverId: 'drv-1' }));
  for (const recipient of audience.filter((r) => r.role === 'driver')) {
    assert.equal(recipient.order.payment.pixCopyPaste, undefined);
    assert.equal(recipient.order.payment.pixQrCode, undefined);
  }
});

test('o cliente continua recebendo o próprio pedido inteiro', () => {
  const audience = orderAudience(order({ driverId: 'drv-1' }));
  const mine = inRoom(audience, 'customer:cust-1');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].role, 'client');
  assert.equal(mine[0].customerId, 'cust-1');
  assert.equal(mine[0].order.customerName, 'Ana Maria');
});

test('o dispositivo anônimo não tem sala', () => {
  const anon = orderAudience(order({ customerId: 'anon' }));
  assert.equal(anon.filter((r) => r.role === 'client').length, 0);
  const nameless = orderAudience(order({ customerId: '' }));
  assert.equal(nameless.filter((r) => r.role === 'client').length, 0);
});
