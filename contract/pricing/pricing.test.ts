import assert from 'node:assert/strict';
import test from 'node:test';
import { computeCartItemTotal, computeCartTotals, computeUnitPrice, findCoupon } from './pricing';
import { DEFAULT_STORE_SETTINGS } from '../shop/defaults';
import type { Coupon, Product, Promotion } from '../catalog/types';
import type { CartItem, DeliveryAddress } from '../order/types';
const address: DeliveryAddress = {
  id: 'a',
  label: '',
  street: '',
  number: '',
  neighborhood: '',
  city: '',
  lat: -8.06,
  lng: -34.9,
  distanceKm: 0,
};

const baseProduct: Product = {
  id: 'p1',
  name: 'Caldinho de Camarão',
  description: '',
  category: 'caldinhos',
  basePrice: 10,
  image: '',
  available: true,
  rating: 5,
  reviewsCount: 0,
  prepTimeMinutes: 15,
};

/** computeCartTotals wants full CartItem shape; only the fields under test vary. */
function cartItem(overrides: Partial<Omit<CartItem, 'product'>> & { product?: Partial<Product> } = {}): CartItem {
  const { product, ...rest } = overrides;
  return {
    id: 'item-1',
    product: { ...baseProduct, ...product },
    selectedExtras: [],
    quantity: 1,
    itemTotalPrice: 0,
    ...rest,
  };
}

test('computeUnitPrice returns the base price when no size is chosen', () => {
  assert.equal(computeUnitPrice(20), 20);
});

test('computeUnitPrice adds the size delta for a known size', () => {
  assert.equal(computeUnitPrice(20, 'Médio (500ml)'), 24);
});

test('computeUnitPrice ignores an unrecognized size label', () => {
  assert.equal(computeUnitPrice(20, 'tamanho-inexistente'), 20);
});

test('computeCartItemTotal is 0 for a free (loyalty) item regardless of extras', () => {
  const item = {
    product: { basePrice: 10 },
    selectedExtras: [{ price: 5 }],
    quantity: 3,
    isFree: true,
  };
  assert.equal(computeCartItemTotal(item), 0);
});

test('computeCartItemTotal sums base + extras + combo delta, times quantity, rounded to cents', () => {
  const item = {
    product: { basePrice: 10 },
    selectedExtras: [{ price: 1.111 }],
    comboChoices: [{ priceDelta: 0.5 }],
    quantity: 3,
  };
  // (10 + 1.111 + 0.5) * 3 = 34.833 -> rounds to 34.83, never 34.833 leaking into totals
  assert.equal(computeCartItemTotal(item), 34.83);
});

test('computeCartItemTotal sums every combo choice delta (múltiplas escolhas por bloco)', () => {
  const item = {
    product: { basePrice: 30 },
    selectedExtras: [],
    comboChoices: [
      { slotId: 's1', slotLabel: 'Caldinhos', optionId: 'a', optionLabel: 'Feijão', priceDelta: 0 },
      { slotId: 's1', slotLabel: 'Caldinhos', optionId: 'b', optionLabel: 'Camarão', priceDelta: 4 },
      { slotId: 's1', slotLabel: 'Caldinhos', optionId: 'c', optionLabel: 'Mocotó', priceDelta: 1.5 },
    ],
    quantity: 2,
  };
  // (30 + 0 + 4 + 1.5) * 2 = 71
  assert.equal(computeCartItemTotal(item), 71);
});

test('computeCartItemTotal soma o delta de cada repetição da mesma opção', () => {
  const item = {
    product: { basePrice: 30 },
    selectedExtras: [],
    comboChoices: [
      { slotId: 's1', slotLabel: 'Caldinhos', optionId: 'b', optionLabel: 'Camarão', priceDelta: 4 },
      { slotId: 's1', slotLabel: 'Caldinhos', optionId: 'b', optionLabel: 'Camarão', priceDelta: 4 },
    ],
    quantity: 1,
  };
  // 30 + 4 + 4 = 38
  assert.equal(computeCartItemTotal(item), 38);
});

test('computeCartTotals sums items, applies percent coupon and delivery fee', () => {
  const cart = [
    cartItem({
      selectedExtras: [{ id: 'e1', name: 'Torresmo', price: 1.111 }],
      comboChoices: [{ slotId: 's1', slotLabel: 'Molho', optionId: 'o1', optionLabel: 'Picante', priceDelta: 0.5 }],
      quantity: 3,
    }),
  ];
  const coupon: Coupon = { code: 'PROMO10', discountPercent: 10, minOrderValue: 0, description: '' };
  const totals = computeCartTotals(cart, coupon, address, DEFAULT_STORE_SETTINGS);
  assert.equal(totals.subtotal, 34.83);
  assert.equal(totals.discount, 3.48);
  assert.equal(totals.deliveryFee, 9.78);
  assert.equal(totals.total, 41.13);
});

test('computeCartTotals clamps a fixed discount so it never exceeds the subtotal', () => {
  const cart = [cartItem()];
  const coupon: Coupon = { code: 'BIG', discountFixed: 999, minOrderValue: 0, description: '' };
  const totals = computeCartTotals(cart, coupon, address, DEFAULT_STORE_SETTINGS);
  assert.equal(totals.subtotal, 10);
  assert.equal(totals.discount, 10);
  assert.equal(totals.total, totals.deliveryFee); // subtotal fully discounted, only freight remains
});

test('computeCartTotals waives delivery once the subtotal clears the free-delivery threshold', () => {
  const cart = [cartItem({ product: { basePrice: 70 } })];
  const nearby: DeliveryAddress = { ...address, lat: DEFAULT_STORE_SETTINGS.storeLat, lng: DEFAULT_STORE_SETTINGS.storeLng };
  const totals = computeCartTotals(cart, null, nearby, DEFAULT_STORE_SETTINGS);
  assert.equal(totals.subtotal, 70);
  assert.equal(totals.deliveryFee, 0);
  assert.equal(totals.total, 70);
});

test('computeCartTotals reports -1 for an address outside the delivery radius', () => {
  const cart = [cartItem()];
  const farAway: DeliveryAddress = { ...address, lat: -8.3, lng: -35.3 };
  const totals = computeCartTotals(cart, null, farAway, DEFAULT_STORE_SETTINGS);
  assert.equal(totals.deliveryFee, -1);
  assert.equal(totals.total, -1);
});

test('computeCartTotals never returns a negative total', () => {
  const cart = [cartItem({ product: { basePrice: 1 } })];
  const coupon: Coupon = { code: 'ALL', discountFixed: 1, minOrderValue: 0, description: '' };
  const noFreight: DeliveryAddress = { ...address, distanceKm: 0, lat: undefined, lng: undefined };
  const totals = computeCartTotals(cart, coupon, noFreight, DEFAULT_STORE_SETTINGS);
  assert.ok(totals.total >= 0);
});

test('findCoupon matches case-insensitively and trims whitespace', () => {
  const coupons: Coupon[] = [{ code: 'PROMO10', discountPercent: 10, minOrderValue: 0, description: '' }];
  assert.equal(findCoupon(' promo10 ', coupons)?.code, 'PROMO10');
  assert.equal(findCoupon('nope', coupons), undefined);
});

test('retirada na loja não cobra frete nem sai da área de entrega', () => {
  const cart = [cartItem({ quantity: 2 })];
  const farAway = { ...address, lat: -9.5, lng: -36.5 };
  const totals = computeCartTotals(cart, null, farAway, DEFAULT_STORE_SETTINGS, 'pickup');

  assert.equal(totals.deliveryFee, 0);
  assert.equal(totals.total, totals.subtotal);
});

/** Promoção de 50% valendo sempre, no cardápio inteiro. */
function halfOffPromotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: 'promo-1',
    name: 'Metade do preço',
    kind: 'desconto',
    enabled: true,
    scope: 'todos',
    productIds: [],
    categoryIds: [],
    minOrderValue: 0,
    channel: 'ambos',
    maxUses: 0,
    usedCount: 0,
    stacksWithCoupon: true,
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

test('computeCartTotals separa o desconto do cupom do desconto da promoção', () => {
  const cart = [cartItem({ product: { basePrice: 20 }, quantity: 1 })];
  const coupon: Coupon = { code: 'X', discountPercent: 10, minOrderValue: 0, description: '' };
  const totals = computeCartTotals(cart, coupon, address, DEFAULT_STORE_SETTINGS, 'delivery', {
    promotions: [halfOffPromotion()],
  });
  assert.equal(totals.discount, 2);
  assert.equal(totals.promoDiscount, 10);
  assert.equal(totals.total, 20 - 2 - 10 + totals.deliveryFee);
});

test('computeCartTotals abate o frete da promoção de entrega grátis', () => {
  const cart = [cartItem({ product: { basePrice: 20 } })];
  const promo = halfOffPromotion({
    kind: 'frete',
    deliveryFree: true,
    discountPercent: undefined,
    channel: 'delivery',
  });
  const totals = computeCartTotals(cart, null, address, DEFAULT_STORE_SETTINGS, 'delivery', {
    promotions: [promo],
  });
  assert.equal(totals.deliveryFee, 0);
  assert.ok(totals.promoDeliveryDiscount > 0);
});

test('computeCartTotals na retirada aplica a promoção de item e ignora a de frete', () => {
  const cart = [cartItem({ product: { basePrice: 20 } })];
  const totals = computeCartTotals(cart, null, address, DEFAULT_STORE_SETTINGS, 'pickup', {
    promotions: [
      halfOffPromotion(),
      halfOffPromotion({ id: 'p2', kind: 'frete', deliveryFree: true, discountPercent: undefined, channel: 'delivery' }),
    ],
  });
  assert.equal(totals.promoDiscount, 10);
  assert.equal(totals.deliveryFee, 0);
  assert.equal(totals.total, 10);
});
