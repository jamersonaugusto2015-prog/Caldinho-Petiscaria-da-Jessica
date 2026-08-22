import assert from 'node:assert/strict';
import test from 'node:test';
import type { CartItem, Order } from '../contract/order/types';
import { orderForDriver, stripCustomerContact, stripPaymentSecrets } from '../contract/order/views';
function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'item-1',
    product: {
      id: 'prod-caldinho',
      name: 'Caldinho de Feijão',
      description: '',
      category: 'caldinhos',
      basePrice: 12,
      image: '',
      available: true,
      rating: 5,
    },
    selectedExtras: [],
    observation: 'Portão azul, deixar com a vizinha do 302',
    quantity: 2,
    itemTotalPrice: 24,
    ...overrides,
  } as CartItem;
}

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'CX-TEST',
    customerId: 'cust-1',
    customerName: 'Ana Maria',
    customerPhone: '81999998888',
    address: {
      id: 'addr-1',
      label: 'Casa da minha mãe',
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
    items: [item()],
    subtotal: 24,
    discount: 0,
    deliveryFee: 6,
    total: 30,
    distanceKm: 3,
    status: 'saiu_entrega',
    payment: { method: 'pix', isPaid: true, pixCopyPaste: 'segredo', pixQrCode: 'segredo' },
    createdAt: new Date(0).toISOString(),
    estimatedDeliveryMinutes: 30,
    driverId: 'drv-1',
    driverName: 'Marcos Motoboy',
    driverPhone: '81988887777',
    loyaltyPointsEarned: 0,
    ...overrides,
  } as Order;
}

test('o dono da corrida recebe nome, telefone e endereço do cliente', () => {
  const view = orderForDriver(order(), 'drv-1');

  assert.equal(view.customerId, 'cust-1');
  assert.equal(view.customerName, 'Ana Maria');
  assert.equal(view.customerPhone, '81999998888');
  assert.equal(view.address.label, 'Casa da minha mãe');
  assert.equal(view.address.street, 'Rua da Aurora');
  assert.equal(view.address.number, '100');
  assert.equal(view.address.complement, 'Apto 302');
  assert.equal(view.address.cep, '50050000');
  assert.equal(view.address.lat, -8.05);
  assert.equal(view.address.lng, -34.9);
  assert.equal(view.items[0].observation, 'Portão azul, deixar com a vizinha do 302');
});

test('quem não é dono da corrida não recebe nada que identifique o cliente', () => {
  const view = orderForDriver(order(), 'drv-2');

  assert.equal(view.customerName, '');
  assert.equal(view.customerPhone, '');
  assert.equal(view.address.label, '');
  assert.equal(view.address.street, '');
  assert.equal(view.address.number, '');
  assert.equal(view.address.complement, undefined);
  assert.equal(view.address.cep, undefined);
  assert.equal(view.address.lat, undefined);
  assert.equal(view.address.lng, undefined);
  assert.equal(view.items[0].observation, undefined);
});

test('o customerId não sobrevive à redação — era a chave para ler o pedido inteiro', () => {
  // Com o customerId em mãos, qualquer um chamava GET /orders?customerId=… e
  // recebia o pedido completo, redação nenhuma.
  const view = orderForDriver(order(), 'drv-2');
  assert.equal(view.customerId, '');
});

test('quem não é dono também não recebe o telefone do motoboy dono', () => {
  const view = orderForDriver(order(), 'drv-2');
  assert.equal(view.driverPhone, undefined);
});

test('a versão redigida mantém o que serve para decidir a corrida', () => {
  const view = orderForDriver(order(), 'drv-2');

  assert.equal(view.id, 'CX-TEST');
  assert.equal(view.status, 'saiu_entrega');
  assert.equal(view.driverId, 'drv-1');
  assert.equal(view.address.neighborhood, 'Boa Vista');
  assert.equal(view.address.city, 'Recife - PE');
  assert.equal(view.address.distanceKm, 3);
  assert.equal(view.distanceKm, 3);
  assert.equal(view.items.length, 1);
  assert.equal(view.items[0].product.name, 'Caldinho de Feijão');
  assert.equal(view.items[0].quantity, 2);
  assert.equal(view.subtotal, 24);
  assert.equal(view.deliveryFee, 6);
  assert.equal(view.total, 30);
  assert.equal(view.payment.method, 'pix');
  assert.equal(view.payment.isPaid, true);
});

test('os segredos do PIX não vão para motoboy nenhum, dono ou não', () => {
  const dono = orderForDriver(order(), 'drv-1');
  assert.equal(dono.payment.pixCopyPaste, undefined);
  assert.equal(dono.payment.pixQrCode, undefined);

  const outro = orderForDriver(order(), 'drv-2');
  assert.equal(outro.payment.pixCopyPaste, undefined);
  assert.equal(outro.payment.pixQrCode, undefined);
});

test('viewerDriverId vazio, nulo ou indefinido nunca vira dono', () => {
  for (const viewer of [null, undefined, '']) {
    const view = orderForDriver(order(), viewer);
    assert.equal(view.customerName, '', `viewer ${JSON.stringify(viewer)} virou dono`);
    assert.equal(view.customerId, '');
    assert.equal(view.address.street, '');
  }
});

test('corrida sem motoboy e visitante sem sessão não casam em dono', () => {
  // '' === '' seria verdade numa comparação crua: uma corrida ainda sem dono
  // entregaria o contato a quem não provou ser ninguém.
  for (const viewer of [null, undefined, '']) {
    const view = orderForDriver(order({ driverId: undefined, driverPhone: undefined }), viewer);
    assert.equal(view.customerName, '');
    assert.equal(view.customerId, '');
    assert.equal(view.customerPhone, '');
    assert.equal(view.address.street, '');
  }

  const semDono = orderForDriver(order({ driverId: '' }), '');
  assert.equal(semDono.customerName, '');
  assert.equal(semDono.customerId, '');
});

test('stripPaymentSecrets só mexe no pagamento', () => {
  const original = order();
  const safe = stripPaymentSecrets(original);

  assert.equal(safe.payment.pixCopyPaste, undefined);
  assert.equal(safe.payment.pixQrCode, undefined);
  assert.equal(safe.payment.method, 'pix');
  assert.equal(safe.customerName, 'Ana Maria');
  assert.equal(safe.address.street, 'Rua da Aurora');
  // O pedido de origem continua inteiro: a vista é uma cópia.
  assert.equal(original.payment.pixCopyPaste, 'segredo');
});

test('stripCustomerContact não altera o pedido de origem', () => {
  const original = order();
  const redacted = stripCustomerContact(original);

  assert.equal(redacted.customerName, '');
  assert.equal(original.customerName, 'Ana Maria');
  assert.equal(original.address.street, 'Rua da Aurora');
  assert.equal(original.items[0].observation, 'Portão azul, deixar com a vizinha do 302');
});

test('a redação limpa a observação de todos os itens, não só do primeiro', () => {
  const view = orderForDriver(
    order({
      items: [
        item({ id: 'item-1', observation: 'sem cebola' }),
        item({ id: 'item-2', observation: 'casa do portão verde ao lado do mercadinho' }),
        item({ id: 'item-3', observation: undefined }),
      ],
    }),
    'drv-2'
  );

  assert.equal(view.items.length, 3);
  for (const cartItem of view.items) {
    assert.equal(cartItem.observation, undefined);
  }
});
