import assert from 'node:assert/strict';
import test from 'node:test';
import { CartItem, Order, Product, StoreSettings } from '../src/types';
import {
  createFakePaymentAdapter,
  OrderIntakeDependencies,
  placeOrder,
} from './orderIntake';
import { DomainError } from './errors';

const product: Product = {
  id: 'caldinho-feijao',
  name: 'Caldinho de feijão',
  description: '',
  category: 'caldinhos',
  basePrice: 18,
  image: '',
  available: true,
  rating: 5,
  reviewsCount: 0,
  prepTimeMinutes: 15,
};

const settings: StoreSettings = {
  storeName: 'Teste',
  city: 'Recife',
  storeLat: -8.05,
  storeLng: -34.9,
  storeAddress: 'Rua da Aurora, 100',
  pickupEnabled: true,
  pickupReadyMinutes: 20,
  deliveryPricePerKm: 2,
  deliveryBaseFee: 5,
  deliveryMinFee: 5,
  freeDeliveryAbove: 0,
  maxDeliveryKm: 20,
  minOrderValue: 0,
  routeFactor: 1.35,
  driverFeePerDelivery: 0,
  pixKey: '',
  pixMerchantName: 'Teste',
  pixMerchantCity: 'Recife',
  cardOnDeliveryEnabled: true,
  storeWhatsApp: '',
  orderSoundUrl: '',
  openingHours: Array(7).fill({ open: '00:00', close: '23:59' }),
  sizeOptions: [],
  orderEnabled: true,
  forceOpen: true,
};

function address() {
  return {
    id: 'addr-1',
    label: 'Casa',
    street: 'Rua Teste',
    number: '10',
    neighborhood: 'Centro',
    city: 'Recife',
    lat: settings.storeLat,
    lng: settings.storeLng,
    distanceKm: 0,
  };
}

function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'item-1',
    product,
    selectedExtras: [],
    quantity: 1,
    itemTotalPrice: product.basePrice,
    ...overrides,
  };
}

function deps(overrides: Partial<OrderIntakeDependencies> = {}) {
  const saved: Order[] = [];
  const consumed: CartItem[][] = [];
  const released: CartItem[][] = [];
  const releasedOrderIds: string[] = [];
  const base: OrderIntakeDependencies = {
    settings,
    loadProduct: (id) => (id === product.id ? product : null),
    listCoupons: () => [],
    payment: createFakePaymentAdapter(),
    peekFreeRedeem: () => true,
    consumeFreeItems: (items) => consumed.push(items),
    persistOrder: (order, beforePersist) => {
      beforePersist();
      saved.push(order);
    },
    updateOrder: (order) => {
      const idx = saved.findIndex((o) => o.id === order.id);
      if (idx >= 0) saved[idx] = order;
      else saved.push(order);
    },
    releaseOrder: (id) => {
      releasedOrderIds.push(id);
      const idx = saved.findIndex((o) => o.id === id);
      if (idx >= 0) saved.splice(idx, 1);
    },
    releaseFreeItems: (items) => released.push(items),
    getLoyaltyPoints: () => 4,
    createOrderId: () => 'CX-TEST',
    now: () => '2026-08-18T14:30:00.000Z',
    ...overrides,
  };
  return { base, saved, consumed, released, releasedOrderIds };
}

test('placeOrder resolves, prices, charges and persists through one interface', async () => {
  const state = deps();
  const result = await placeOrder(
    {
      items: [item()],
      address: address(),
      paymentMethod: 'card',
      customerId: 'customer-1',
      customerName: 'Ana',
      cardToken: 'tok_test',
      cardPaymentMethodId: 'visa',
    },
    state.base
  );

  assert.equal(result.order.id, 'CX-TEST');
  assert.equal(result.order.total, 18);
  assert.equal(result.order.payment.isPaid, true);
  assert.equal(result.loyaltyPoints, 4);
  assert.deepEqual(state.saved, [result.order]);
});

test('an unknown payment method is rejected instead of silently becoming pix', async () => {
  const state = deps();
  await assert.rejects(
    () =>
      placeOrder(
        { items: [item()], address: address(), paymentMethod: 'dinheiro', customerId: 'customer-1' },
        state.base
      ),
    (err: unknown) => err instanceof DomainError && err.status === 400
  );
  assert.deepEqual(state.saved, []);
});

test('a card order is rejected when no card adapter is available, never persisted unpaid', async () => {
  const state = deps();
  state.base.payment.isCardAvailable = () => false;
  await assert.rejects(
    () =>
      placeOrder(
        { items: [item()], address: address(), paymentMethod: 'card', customerId: 'customer-1' },
        state.base
      ),
    (err: unknown) => err instanceof DomainError && err.status === 400
  );
  assert.deepEqual(state.saved, []);
});

test('invalid loyalty token fails before charging or persistence', async () => {
  let charged = false;
  const state = deps({
    peekFreeRedeem: () => false,
    payment: {
      ...createFakePaymentAdapter(),
      isCardAvailable: () => {
        charged = true;
        return true;
      },
    },
  });

  await assert.rejects(
    () =>
      placeOrder(
        {
          items: [item({ isFree: true, freeToken: 'bad-token' })],
          address: address(),
          paymentMethod: 'card',
        },
        state.base
      ),
    (error: unknown) => error instanceof DomainError && error.status === 400
  );
  assert.equal(charged, false);
  assert.equal(state.saved.length, 0);
});

test('free tokens are consumed in the same persistence callback', async () => {
  const state = deps();
  const result = await placeOrder(
    {
      items: [item({ isFree: true, freeToken: 'valid-token' })],
      address: address(),
      paymentMethod: 'cash',
    },
    state.base
  );

  assert.equal(result.order.total, 0);
  assert.deepEqual(state.consumed, [[result.order.items[0]]]);
});

test('an order id collision is retried instead of failing the insert', async () => {
  let existsCalls = 0;
  const state = deps({
    createOrderId: undefined,
    orderIdExists: () => {
      existsCalls += 1;
      return existsCalls === 1; // first generated id "collides", second is free
    },
  });

  const result = await placeOrder(
    {
      items: [item()],
      address: address(),
      paymentMethod: 'cash',
    },
    state.base
  );

  assert.ok(existsCalls >= 2, 'a colliding id must be regenerated, not used');
  assert.match(result.order.id, /^CX-[0-9A-Z]+$/);
  assert.equal(state.saved.length, 1);
});

test('a replayed free-item token blocks the charge before it is attempted', async () => {
  let collectCardCalled = false;
  const state = deps({
    consumeFreeItems: () => {
      throw new DomainError(400, 'Item grátis de fidelidade inválido. Verifique seus selos.');
    },
    payment: {
      ...createFakePaymentAdapter(),
      async collectCard(input) {
        collectCardCalled = true;
        return { mpPaymentId: `fake-${input.orderId}`, cardBrand: 'visa', isPaid: true };
      },
    },
  });

  await assert.rejects(
    () =>
      placeOrder(
        {
          items: [item({ isFree: true, freeToken: 'replayed-token' })],
          address: address(),
          paymentMethod: 'card',
          cardToken: 'tok_test',
        },
        state.base
      ),
    (error: unknown) => error instanceof DomainError && error.status === 400
  );

  assert.equal(collectCardCalled, false);
  assert.equal(state.saved.length, 0);
});

test('a failed charge releases the reserved order row and the loyalty token', async () => {
  const state = deps({
    payment: {
      ...createFakePaymentAdapter(),
      async collectCard() {
        throw new DomainError(400, 'Cartão recusado.');
      },
    },
  });

  await assert.rejects(
    () =>
      placeOrder(
        {
          items: [item({ isFree: true, freeToken: 'valid-token' }), item()],
          address: address(),
          paymentMethod: 'card',
          cardToken: 'tok_test',
        },
        state.base
      ),
    (error: unknown) => error instanceof DomainError
  );

  assert.equal(state.saved.length, 0);
  assert.equal(state.releasedOrderIds.length, 1);
  assert.equal(state.released.length, 1);
});

test('retirada na loja dispensa endereço, zera o frete e grava o endereço da loja', async () => {
  const state = deps();
  const result = await placeOrder(
    {
      items: [item()],
      fulfillment: 'pickup',
      paymentMethod: 'cash',
      customerId: 'customer-pickup',
      customerName: 'Bruno',
    },
    state.base
  );

  assert.equal(result.order.fulfillment, 'pickup');
  assert.equal(result.order.deliveryFee, 0);
  assert.equal(result.order.distanceKm, 0);
  assert.equal(result.order.total, product.basePrice);
  assert.equal(result.order.address.label, 'Retirada na loja');
  assert.equal(result.order.address.street, settings.storeAddress);
  assert.equal(result.order.estimatedDeliveryMinutes, settings.pickupReadyMinutes);
  assert.equal(state.saved.length, 1);
});

test('retirada é recusada enquanto a loja não aceitar retirada', async () => {
  const state = deps({ settings: { ...settings, pickupEnabled: false } });
  await assert.rejects(
    () =>
      placeOrder(
        { items: [item()], fulfillment: 'pickup', paymentMethod: 'cash', customerId: 'c' },
        state.base
      ),
    (err: unknown) => err instanceof DomainError && err.status === 400
  );
  assert.equal(state.saved.length, 0);
});

test('retirada ignora o raio máximo de entrega', async () => {
  const state = deps({ settings: { ...settings, maxDeliveryKm: 1 } });
  const result = await placeOrder(
    { items: [item()], fulfillment: 'pickup', paymentMethod: 'cash', customerId: 'c' },
    state.base
  );
  assert.equal(result.order.fulfillment, 'pickup');
});

test('pedido sem fulfillment continua sendo entrega e exige endereço', async () => {
  const state = deps();
  await assert.rejects(
    () => placeOrder({ items: [item()], paymentMethod: 'cash', customerId: 'c' }, state.base),
    (err: unknown) => err instanceof DomainError && err.status === 400
  );
});

// ---------- Momento do pagamento: online x na entrega ----------

test('dinheiro nunca é cobrado na criação e nasce como pagamento na entrega', async () => {
  let charged = false;
  const state = deps({
    payment: {
      collectPix: async () => {
        charged = true;
        return {};
      },
      isCardAvailable: () => true,
      collectCard: async () => {
        charged = true;
        return { isPaid: true };
      },
    },
  });
  const result = await placeOrder(
    { items: [item()], address: address(), paymentMethod: 'cash', customerId: 'c' },
    state.base
  );
  assert.equal(charged, false);
  assert.equal(result.order.payment.timing, 'delivery');
  assert.equal(result.order.payment.isPaid, false);
});

test('cartão na entrega não passa pelo Mercado Pago e fica a receber', async () => {
  let charged = false;
  const state = deps({
    payment: {
      collectPix: async () => ({}),
      // A loja não conectou o Mercado Pago: a maquininha tem que funcionar assim mesmo.
      isCardAvailable: () => false,
      collectCard: async () => {
        charged = true;
        return { isPaid: true };
      },
    },
  });
  const result = await placeOrder(
    {
      items: [item()],
      address: address(),
      paymentMethod: 'card',
      paymentTiming: 'delivery',
      customerId: 'c',
    },
    state.base
  );
  assert.equal(charged, false);
  assert.equal(result.order.payment.method, 'card');
  assert.equal(result.order.payment.timing, 'delivery');
  assert.equal(result.order.payment.isPaid, false);
  assert.deepEqual(state.saved, [result.order]);
});

test('cartão online continua exigindo o Mercado Pago', async () => {
  const state = deps();
  state.base.payment.isCardAvailable = () => false;
  await assert.rejects(
    () =>
      placeOrder(
        {
          items: [item()],
          address: address(),
          paymentMethod: 'card',
          paymentTiming: 'online',
          customerId: 'c',
        },
        state.base
      ),
    (err: unknown) => err instanceof DomainError && err.status === 400
  );
  assert.deepEqual(state.saved, []);
});

test('cartão na entrega é recusado quando a loja não leva maquininha', async () => {
  const state = deps({ settings: { ...settings, cardOnDeliveryEnabled: false } });
  await assert.rejects(
    () =>
      placeOrder(
        {
          items: [item()],
          address: address(),
          paymentMethod: 'card',
          paymentTiming: 'delivery',
          customerId: 'c',
        },
        state.base
      ),
    (err: unknown) => err instanceof DomainError && err.status === 400
  );
  assert.deepEqual(state.saved, []);
});

test('PIX ignora um momento "na entrega" e continua online', async () => {
  let charged = false;
  const state = deps({
    payment: {
      collectPix: async () => {
        charged = true;
        return { pixCopyPaste: '000201...' };
      },
      isCardAvailable: () => true,
      collectCard: async () => ({ isPaid: true }),
    },
  });
  const result = await placeOrder(
    {
      items: [item()],
      address: address(),
      paymentMethod: 'pix',
      paymentTiming: 'delivery',
      customerId: 'c',
    },
    state.base
  );
  assert.equal(charged, true);
  assert.equal(result.order.payment.timing, 'online');
});

test('troco só é guardado em pedidos de dinheiro', async () => {
  const state = deps();
  const result = await placeOrder(
    {
      items: [item()],
      address: address(),
      paymentMethod: 'card',
      paymentTiming: 'delivery',
      changeForAmount: 50,
      customerId: 'c',
    },
    state.base
  );
  assert.equal(result.order.payment.changeForAmount, undefined);

  const cash = deps();
  const cashResult = await placeOrder(
    {
      items: [item()],
      address: address(),
      paymentMethod: 'cash',
      changeForAmount: 50,
      customerId: 'c',
    },
    cash.base
  );
  assert.equal(cashResult.order.payment.changeForAmount, 50);
});
