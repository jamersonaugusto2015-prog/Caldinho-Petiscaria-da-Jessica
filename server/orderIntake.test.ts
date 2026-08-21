import assert from 'node:assert/strict';
import test from 'node:test';
import { CartItem, ComboChoice, Order, Product, Promotion, StoreSettings } from '../src/types';
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

/** Promoção do tipo desconto, ligada o tempo todo, valendo no cardápio inteiro. */
function livePromotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: 'promo-1',
    name: 'Quarta em dobro',
    kind: 'desconto',
    enabled: true,
    scope: 'todos',
    productIds: [],
    categoryIds: [],
    minOrderValue: 0,
    channel: 'ambos',
    maxUses: 0,
    usedCount: 0,
    stacksWithCoupon: false,
    highlight: true,
    window: { weekdays: [] },
    createdAt: '2026-01-01T00:00:00.000Z',
    totalDiscount: 0,
    totalRevenue: 0,
    totalOrders: 0,
    discountPercent: 50,
    ...overrides,
  };
}

test('o servidor aplica a promoção sozinho e grava o desconto no pedido', async () => {
  const state = deps({ listPromotions: () => [livePromotion()] });
  const result = await placeOrder(
    { items: [item()], address: address(), paymentMethod: 'cash', customerId: 'customer-1' },
    state.base
  );

  assert.equal(result.order.subtotal, 18);
  assert.equal(result.order.promoDiscount, 9);
  assert.equal(result.order.total, 9);
  assert.equal(result.order.appliedPromotions?.[0].name, 'Quarta em dobro');
});

test('a promoção pausada não mexe no preço do pedido', async () => {
  const state = deps({ listPromotions: () => [livePromotion({ enabled: false })] });
  const result = await placeOrder(
    { items: [item()], address: address(), paymentMethod: 'cash', customerId: 'customer-1' },
    state.base
  );
  assert.equal(result.order.promoDiscount, 0);
  assert.equal(result.order.total, 18);
});

test('o contador da promoção só sobe junto com o pedido gravado', async () => {
  const registered: { discount: number; total: number }[] = [];
  const state = deps({
    listPromotions: () => [livePromotion()],
    registerPromotionUses: (applied, total) =>
      registered.push({ discount: applied?.[0]?.discount ?? 0, total }),
  });
  await placeOrder(
    { items: [item()], address: address(), paymentMethod: 'cash', customerId: 'customer-1' },
    state.base
  );
  assert.deepEqual(registered, [{ discount: 9, total: 9 }]);
});

test('cobrança que falha não deixa a promoção contada', async () => {
  const registered: number[] = [];
  const state = deps({
    listPromotions: () => [livePromotion()],
    registerPromotionUses: (_applied, total) => registered.push(total),
  });
  state.base.payment.collectCard = async () => {
    throw new DomainError(400, 'Cartão recusado.');
  };
  await assert.rejects(() =>
    placeOrder(
      {
        items: [item()],
        address: address(),
        paymentMethod: 'card',
        customerId: 'customer-1',
        cardToken: 'tok_test',
        cardPaymentMethodId: 'visa',
      },
      state.base
    )
  );
  assert.deepEqual(registered, []);
  assert.deepEqual(state.saved, []);
});

const comboProduct: Product = {
  id: 'combo-test',
  name: 'Combo Teste',
  description: '',
  category: 'combos',
  basePrice: 30,
  image: '',
  available: true,
  rating: 5,
  reviewsCount: 0,
  prepTimeMinutes: 20,
  comboSlots: [
    {
      id: 'slot-caldinho',
      label: 'Escolha 2 caldinhos',
      required: true,
      minChoices: 2,
      maxChoices: 2,
      options: [
        { id: 'feijao', label: 'Feijão', priceDelta: 0 },
        { id: 'camarao', label: 'Camarão', priceDelta: 4 },
        { id: 'mocoto', label: 'Mocotó', priceDelta: 0 },
      ],
    },
    {
      id: 'slot-petisco',
      label: 'Petisco',
      required: true,
      options: [{ id: 'batata', label: 'Batata' }],
    },
  ],
};

function comboItem(choices: ComboChoice[]): CartItem {
  return {
    id: 'item-combo',
    product: comboProduct,
    selectedExtras: [],
    comboChoices: choices,
    quantity: 1,
    itemTotalPrice: comboProduct.basePrice,
  };
}

function comboDeps() {
  const state = deps({ loadProduct: (id) => (id === comboProduct.id ? comboProduct : null) });
  return state;
}

test('combo válido com múltiplas escolhas por bloco é aceito e soma os acréscimos', async () => {
  const state = comboDeps();
  const result = await placeOrder(
    {
      items: [
        comboItem([
          { slotId: 'slot-caldinho', slotLabel: 'Escolha 2 caldinhos', optionId: 'feijao', optionLabel: 'Feijão', priceDelta: 0 },
          { slotId: 'slot-caldinho', slotLabel: 'Escolha 2 caldinhos', optionId: 'camarao', optionLabel: 'Camarão', priceDelta: 4 },
          { slotId: 'slot-petisco', slotLabel: 'Petisco', optionId: 'batata', optionLabel: 'Batata', priceDelta: 0 },
        ]),
      ],
      address: address(),
      paymentMethod: 'cash',
      customerId: 'customer-1',
    },
    state.base
  );
  assert.equal(result.order.items[0].comboChoices?.length, 3);
  assert.equal(result.order.items[0].itemTotalPrice, 34);
});

test('combo sem escolhas obrigatórias suficientes é recusado', async () => {
  const state = comboDeps();
  await assert.rejects(
    () =>
      placeOrder(
        {
          items: [
            comboItem([
              { slotId: 'slot-caldinho', slotLabel: 'Escolha 2 caldinhos', optionId: 'feijao', optionLabel: 'Feijão', priceDelta: 0 },
              { slotId: 'slot-petisco', slotLabel: 'Petisco', optionId: 'batata', optionLabel: 'Batata', priceDelta: 0 },
            ]),
          ],
          address: address(),
          paymentMethod: 'cash',
          customerId: 'customer-1',
        },
        state.base
      ),
    (err: unknown) => err instanceof DomainError && err.status === 400
  );
  assert.deepEqual(state.saved, []);
});

test('combo sem nenhuma escolha é recusado', async () => {
  const state = comboDeps();
  await assert.rejects(
    () =>
      placeOrder(
        {
          items: [comboItem([])],
          address: address(),
          paymentMethod: 'cash',
          customerId: 'customer-1',
        },
        state.base
      ),
    (err: unknown) => err instanceof DomainError && err.status === 400
  );
  assert.deepEqual(state.saved, []);
});

test('combo com mais escolhas que o máximo é recusado', async () => {
  const state = comboDeps();
  await assert.rejects(
    () =>
      placeOrder(
        {
          items: [
            comboItem([
              { slotId: 'slot-caldinho', slotLabel: 'Escolha 2 caldinhos', optionId: 'feijao', optionLabel: 'Feijão', priceDelta: 0 },
              { slotId: 'slot-caldinho', slotLabel: 'Escolha 2 caldinhos', optionId: 'camarao', optionLabel: 'Camarão', priceDelta: 4 },
              { slotId: 'slot-caldinho', slotLabel: 'Escolha 2 caldinhos', optionId: 'mocoto', optionLabel: 'Mocotó', priceDelta: 0 },
              { slotId: 'slot-petisco', slotLabel: 'Petisco', optionId: 'batata', optionLabel: 'Batata', priceDelta: 0 },
            ]),
          ],
          address: address(),
          paymentMethod: 'cash',
          customerId: 'customer-1',
        },
        state.base
      ),
    (err: unknown) => err instanceof DomainError && err.status === 400
  );
  assert.deepEqual(state.saved, []);
});

test('a mesma opção pode ser escolhida mais de uma vez no mesmo bloco', async () => {
  const state = comboDeps();
  const result = await placeOrder(
    {
      items: [
        comboItem([
          { slotId: 'slot-caldinho', slotLabel: 'Escolha 2 caldinhos', optionId: 'feijao', optionLabel: 'Feijão', priceDelta: 0 },
          { slotId: 'slot-caldinho', slotLabel: 'Escolha 2 caldinhos', optionId: 'feijao', optionLabel: 'Feijão', priceDelta: 0 },
          { slotId: 'slot-petisco', slotLabel: 'Petisco', optionId: 'batata', optionLabel: 'Batata', priceDelta: 0 },
        ]),
      ],
      address: address(),
      paymentMethod: 'cash',
      customerId: 'customer-1',
    },
    state.base
  );
  assert.equal(result.order.items[0].comboChoices?.length, 3);
  assert.equal(result.order.items[0].itemTotalPrice, 30);
});

test('a mesma opção repetida além do máximo é recusada', async () => {
  const state = comboDeps();
  await assert.rejects(
    () =>
      placeOrder(
        {
          items: [
            comboItem([
              { slotId: 'slot-caldinho', slotLabel: 'Escolha 2 caldinhos', optionId: 'feijao', optionLabel: 'Feijão', priceDelta: 0 },
              { slotId: 'slot-caldinho', slotLabel: 'Escolha 2 caldinhos', optionId: 'feijao', optionLabel: 'Feijão', priceDelta: 0 },
              { slotId: 'slot-caldinho', slotLabel: 'Escolha 2 caldinhos', optionId: 'feijao', optionLabel: 'Feijão', priceDelta: 0 },
              { slotId: 'slot-petisco', slotLabel: 'Petisco', optionId: 'batata', optionLabel: 'Batata', priceDelta: 0 },
            ]),
          ],
          address: address(),
          paymentMethod: 'cash',
          customerId: 'customer-1',
        },
        state.base
      ),
    (err: unknown) => err instanceof DomainError && err.status === 400
  );
  assert.deepEqual(state.saved, []);
});

test('opção de combo que não existe mais no cardápio é recusada', async () => {
  const state = comboDeps();
  await assert.rejects(
    () =>
      placeOrder(
        {
          items: [
            comboItem([
              { slotId: 'slot-caldinho', slotLabel: 'Escolha 2 caldinhos', optionId: 'fantasma', optionLabel: 'Sumiu', priceDelta: 0 },
              { slotId: 'slot-caldinho', slotLabel: 'Escolha 2 caldinhos', optionId: 'feijao', optionLabel: 'Feijão', priceDelta: 0 },
              { slotId: 'slot-petisco', slotLabel: 'Petisco', optionId: 'batata', optionLabel: 'Batata', priceDelta: 0 },
            ]),
          ],
          address: address(),
          paymentMethod: 'cash',
          customerId: 'customer-1',
        },
        state.base
      ),
    (err: unknown) => err instanceof DomainError && err.status === 400
  );
  assert.deepEqual(state.saved, []);
});
