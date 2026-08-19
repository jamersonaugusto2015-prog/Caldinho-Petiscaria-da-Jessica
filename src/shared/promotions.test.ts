import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPromotions,
  bestProductPromotion,
  describePromotion,
  describeWindow,
  discountedUnitPrice,
  marginPercent,
  promotionStatus,
  type PromotionCartLine,
} from './promotions';
import type { Promotion } from '../types';

function promo(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: 'promo-1',
    name: 'Promoção',
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
    discountPercent: 10,
    ...overrides,
  };
}

function line(overrides: Partial<PromotionCartLine> = {}): PromotionCartLine {
  return {
    productId: 'p1',
    categoryId: 'caldinhos',
    name: 'Caldinho',
    quantity: 1,
    unitPrice: 20,
    ...overrides,
  };
}

/** Contexto de carrinho com o subtotal já batendo com as linhas. */
function ctx(lines: PromotionCartLine[], overrides: Partial<Parameters<typeof applyPromotions>[1]> = {}) {
  const subtotal =
    Math.round(lines.reduce((sum, l) => sum + (l.isFree ? 0 : l.unitPrice * l.quantity), 0) * 100) / 100;
  return {
    lines,
    subtotal,
    deliveryFee: 8,
    channel: 'delivery' as const,
    hasCoupon: false,
    at: new Date('2026-08-19T19:00:00'),
    ...overrides,
  };
}

// ---------- Janela e estado ----------

test('promotionStatus diz pausada quando a promoção está desligada', () => {
  assert.equal(promotionStatus(promo({ enabled: false })), 'pausada');
});

test('promotionStatus diz esgotada quando o limite de usos foi atingido', () => {
  assert.equal(promotionStatus(promo({ maxUses: 10, usedCount: 10 })), 'esgotada');
});

test('promotionStatus separa agendada de expirada pelas datas', () => {
  const at = new Date('2026-08-19T12:00:00');
  assert.equal(promotionStatus(promo({ window: { weekdays: [], startDate: '2026-09-01' } }), at), 'agendada');
  assert.equal(promotionStatus(promo({ window: { weekdays: [], endDate: '2026-08-18' } }), at), 'expirada');
});

test('promotionStatus respeita o dia da semana escolhido', () => {
  const quarta = new Date('2026-08-19T12:00:00'); // 19/08/2026 é uma quarta
  assert.equal(promotionStatus(promo({ window: { weekdays: [3] } }), quarta), 'ativa');
  assert.equal(promotionStatus(promo({ window: { weekdays: [0, 6] } }), quarta), 'fora_da_janela');
});

test('promotionStatus aceita uma janela de horário que atravessa a meia-noite', () => {
  const window = { weekdays: [], startTime: '22:00', endTime: '02:00' };
  assert.equal(promotionStatus(promo({ window }), new Date('2026-08-19T23:30:00')), 'ativa');
  assert.equal(promotionStatus(promo({ window }), new Date('2026-08-19T01:30:00')), 'ativa');
  assert.equal(promotionStatus(promo({ window }), new Date('2026-08-19T15:00:00')), 'fora_da_janela');
});

// ---------- Preço ----------

test('discountedUnitPrice aplica porcentagem, valor fixo e "por apenas"', () => {
  assert.equal(discountedUnitPrice(promo({ discountPercent: 25 }), 20), 15);
  assert.equal(discountedUnitPrice(promo({ discountPercent: undefined, discountFixed: 7 }), 20), 13);
  assert.equal(discountedUnitPrice(promo({ discountPercent: undefined, fixedPrice: 12 }), 20), 12);
});

test('discountedUnitPrice nunca sobe o preço nem deixa o item negativo', () => {
  assert.equal(discountedUnitPrice(promo({ discountPercent: undefined, fixedPrice: 30 }), 20), 20);
  assert.equal(discountedUnitPrice(promo({ discountPercent: undefined, discountFixed: 50 }), 20), 0);
});

test('marginPercent devolve null sem custo cadastrado', () => {
  assert.equal(marginPercent(20, undefined), null);
  assert.equal(marginPercent(20, 8), 60);
});

// ---------- Aplicação no carrinho ----------

test('desconto por item abate o valor de todas as unidades da linha', () => {
  const out = applyPromotions([promo({ discountPercent: 50 })], ctx([line({ quantity: 3 })]));
  assert.equal(out.itemDiscount, 30);
  assert.equal(out.applied[0].discount, 30);
});

test('o mesmo item nunca acumula duas promoções de desconto: vale a melhor', () => {
  const out = applyPromotions(
    [promo({ id: 'a', discountPercent: 10 }), promo({ id: 'b', name: 'Melhor', discountPercent: 40 })],
    ctx([line()])
  );
  assert.equal(out.itemDiscount, 8);
  assert.equal(out.applied.length, 1);
  assert.equal(out.applied[0].id, 'b');
});

test('leve 3 pague 2 zera a unidade mais barata do grupo', () => {
  const promocao = promo({ kind: 'leve_pague', buyQty: 3, payQty: 2, discountPercent: undefined });
  const out = applyPromotions(
    [promocao],
    ctx([line({ productId: 'p1', unitPrice: 20, quantity: 2 }), line({ productId: 'p2', unitPrice: 12, quantity: 1 })])
  );
  assert.equal(out.itemDiscount, 12);
});

test('leve 3 pague 2 não faz nada com menos de 3 unidades', () => {
  const promocao = promo({ kind: 'leve_pague', buyQty: 3, payQty: 2, discountPercent: undefined });
  const out = applyPromotions([promocao], ctx([line({ quantity: 2 })]));
  assert.equal(out.itemDiscount, 0);
});

test('o escopo por categoria só pega os itens daquela categoria', () => {
  const promocao = promo({ scope: 'categorias', categoryIds: ['bebidas'], discountPercent: 50 });
  const out = applyPromotions(
    [promocao],
    ctx([line({ categoryId: 'caldinhos', unitPrice: 20 }), line({ productId: 'p2', categoryId: 'bebidas', unitPrice: 10 })])
  );
  assert.equal(out.itemDiscount, 5);
});

test('pedido abaixo do mínimo não recebe a promoção', () => {
  const out = applyPromotions([promo({ minOrderValue: 100, discountPercent: 50 })], ctx([line()]));
  assert.equal(out.itemDiscount, 0);
});

test('o canal filtra a promoção: só entrega não vale na retirada', () => {
  const promocao = promo({ channel: 'delivery', discountPercent: 50 });
  const out = applyPromotions([promocao], ctx([line()], { channel: 'pickup', deliveryFee: 0 }));
  assert.equal(out.itemDiscount, 0);
});

test('com cupom aplicado, a promoção que não empilha fica de fora e é reportada', () => {
  const out = applyPromotions([promo({ discountPercent: 50 })], ctx([line()], { hasCoupon: true }));
  assert.equal(out.itemDiscount, 0);
  assert.equal(out.blockedByCoupon.length, 1);
});

test('a promoção marcada para empilhar continua valendo com cupom', () => {
  const out = applyPromotions(
    [promo({ discountPercent: 50, stacksWithCoupon: true })],
    ctx([line()], { hasCoupon: true })
  );
  assert.equal(out.itemDiscount, 10);
  assert.equal(out.blockedByCoupon.length, 0);
});

test('frete grátis abate no máximo a taxa cobrada', () => {
  const promocao = promo({ kind: 'frete', deliveryFree: true, discountPercent: undefined });
  const out = applyPromotions([promocao], ctx([line()], { deliveryFee: 8 }));
  assert.equal(out.deliveryDiscount, 8);
});

test('desconto de frete maior que a taxa não vira crédito', () => {
  const promocao = promo({ kind: 'frete', deliveryFree: false, deliveryDiscount: 20, discountPercent: undefined });
  const out = applyPromotions([promocao], ctx([line()], { deliveryFee: 6 }));
  assert.equal(out.deliveryDiscount, 6);
});

test('o brinde vira desconto do valor do produto escolhido', () => {
  const promocao = promo({ kind: 'brinde', giftProductId: 'g1', minOrderValue: 50, discountPercent: undefined });
  const out = applyPromotions(
    [promocao],
    ctx([line({ unitPrice: 60 })], { products: [{ id: 'g1', name: 'Refri', basePrice: 7 }] })
  );
  assert.equal(out.itemDiscount, 7);
  assert.equal(out.applied[0].giftProductName, 'Refri');
});

test('o desconto total nunca passa do subtotal', () => {
  const promocao = promo({ discountPercent: undefined, discountFixed: 999 });
  const out = applyPromotions([promocao], ctx([line({ unitPrice: 20 })]));
  assert.equal(out.itemDiscount, 20);
});

test('item grátis da fidelidade fica fora da conta da promoção', () => {
  const out = applyPromotions(
    [promo({ discountPercent: 50 })],
    ctx([line({ unitPrice: 20, isFree: true }), line({ productId: 'p2', unitPrice: 20 })])
  );
  assert.equal(out.itemDiscount, 10);
});

// ---------- Vitrine ----------

test('bestProductPromotion devolve o menor preço entre as promoções válidas', () => {
  const product = { id: 'p1', category: 'caldinhos', basePrice: 20 };
  const best = bestProductPromotion(
    product,
    [promo({ id: 'a', discountPercent: 10 }), promo({ id: 'b', discountPercent: 40 })],
    { at: new Date('2026-08-19T19:00:00') }
  );
  assert.equal(best?.price, 12);
  assert.equal(best?.promo.id, 'b');
});

test('bestProductPromotion ignora promoção pausada', () => {
  const best = bestProductPromotion({ id: 'p1', category: 'caldinhos', basePrice: 20 }, [
    promo({ enabled: false, discountPercent: 40 }),
  ]);
  assert.equal(best, null);
});

// ---------- Texto ----------

test('describePromotion resume a regra em uma frase', () => {
  assert.equal(describePromotion(promo({ discountPercent: 20 })), '20% de desconto');
  assert.equal(
    describePromotion(promo({ kind: 'leve_pague', buyQty: 3, payQty: 2 })),
    'Leve 3, pague 2'
  );
});

test('describeWindow lista dias e horário', () => {
  assert.equal(
    describeWindow({ weekdays: [1, 2], startTime: '17:00', endTime: '20:00' }),
    'Seg, Ter · 17:00 às 20:00'
  );
  assert.equal(describeWindow({ weekdays: [] }), 'Todos os dias');
});
