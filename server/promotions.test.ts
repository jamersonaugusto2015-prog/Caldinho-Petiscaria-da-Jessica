import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// server/db.ts abre o sqlite real assim que é importado. Este override precisa
// rodar antes de ./promotions carregar, daí o import dinâmico abaixo.
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'caldinho-promo-test-'));

const {
  createPromotion,
  deletePromotion,
  getPromotion,
  listPromotions,
  normalizePromotion,
  registerPromotionUses,
  resetPromotionUses,
  updatePromotion,
} = await import('./promotions');
const { db } = await import('./db');

function reset() {
  db.prepare('DELETE FROM promotions').run();
}

const base = {
  name: 'Happy hour',
  kind: 'desconto',
  discountPercent: 20,
  scope: 'categorias',
  categoryIds: ['caldinhos'],
};

test('normalizePromotion guarda só uma forma de preço', () => {
  const promo = normalizePromotion({ ...base, discountPercent: 20, discountFixed: 5, fixedPrice: 12 });
  assert.equal(promo.fixedPrice, 12);
  assert.equal(promo.discountPercent, undefined);
  assert.equal(promo.discountFixed, undefined);
});

test('normalizePromotion recusa desconto sem valor nenhum', () => {
  assert.throws(() => normalizePromotion({ ...base, discountPercent: 0 }), /Informe o desconto/);
});

test('normalizePromotion recusa nome vazio', () => {
  assert.throws(() => normalizePromotion({ ...base, name: '   ' }), /nome/i);
});

test('normalizePromotion recusa leve/pague invertido', () => {
  assert.throws(
    () => normalizePromotion({ name: 'x', kind: 'leve_pague', buyQty: 2, payQty: 3, scope: 'todos' }),
    /leve precisa ser maior/
  );
});

test('normalizePromotion recusa escopo por categoria sem categoria escolhida', () => {
  assert.throws(() => normalizePromotion({ ...base, categoryIds: [] }), /categoria/);
});

test('normalizePromotion força o canal entrega e escopo total no frete', () => {
  const promo = normalizePromotion({ name: 'Frete', kind: 'frete', deliveryFree: true, channel: 'pickup' });
  assert.equal(promo.channel, 'delivery');
  assert.equal(promo.scope, 'todos');
});

test('normalizePromotion recusa desconto de frete zerado sem frete grátis', () => {
  assert.throws(
    () => normalizePromotion({ name: 'Frete', kind: 'frete', deliveryFree: false, deliveryDiscount: 0 }),
    /quanto abater/
  );
});

test('normalizePromotion exige o produto do brinde', () => {
  assert.throws(() => normalizePromotion({ name: 'Brinde', kind: 'brinde' }), /brinde/);
});

test('normalizePromotion limpa a janela: dias fora de 0..6 e horário inválido caem fora', () => {
  const promo = normalizePromotion({
    ...base,
    window: { weekdays: [1, 1, 9, -2, 6], startTime: '25:00', endTime: '20:00', startDate: '19/08/2026' },
  });
  assert.deepEqual(promo.window.weekdays, [1, 6]);
  assert.equal(promo.window.startTime, undefined);
  assert.equal(promo.window.endTime, '20:00');
  assert.equal(promo.window.startDate, undefined);
});

test('normalizePromotion limita a porcentagem a 100 e não aceita valores negativos', () => {
  const promo = normalizePromotion({ ...base, discountPercent: 500 });
  assert.equal(promo.discountPercent, 100);
  const outro = normalizePromotion({ ...base, minOrderValue: -50 });
  assert.equal(outro.minOrderValue, 0);
});

test('createPromotion grava e listPromotions devolve', () => {
  reset();
  const created = createPromotion(base);
  assert.equal(listPromotions().length, 1);
  assert.equal(getPromotion(created.id)?.name, 'Happy hour');
});

test('updatePromotion preserva o histórico e os contadores', () => {
  reset();
  const created = createPromotion(base);
  registerPromotionUses([{ id: created.id, name: created.name, kind: 'desconto', discount: 4 }], 40);
  const updated = updatePromotion(created.id, { name: 'Outro nome' });
  assert.equal(updated.name, 'Outro nome');
  assert.equal(updated.usedCount, 1);
  assert.equal(updated.totalDiscount, 4);
  assert.equal(updated.totalRevenue, 40);
});

test('registerPromotionUses soma pedido, desconto e faturamento', () => {
  reset();
  const created = createPromotion(base);
  const entry = { id: created.id, name: created.name, kind: 'desconto' as const, discount: 3.5 };
  registerPromotionUses([entry], 30);
  registerPromotionUses([entry], 20);
  const promo = getPromotion(created.id);
  assert.equal(promo?.totalOrders, 2);
  assert.equal(promo?.usedCount, 2);
  assert.equal(promo?.totalDiscount, 7);
  assert.equal(promo?.totalRevenue, 50);
});

test('registerPromotionUses ignora promoção já apagada', () => {
  reset();
  const created = createPromotion(base);
  deletePromotion(created.id);
  assert.doesNotThrow(() =>
    registerPromotionUses([{ id: created.id, name: 'x', kind: 'desconto', discount: 1 }], 10)
  );
});

test('resetPromotionUses zera o contador sem apagar o faturamento', () => {
  reset();
  const created = createPromotion(base);
  registerPromotionUses([{ id: created.id, name: created.name, kind: 'desconto', discount: 5 }], 50);
  const promo = resetPromotionUses(created.id);
  assert.equal(promo.usedCount, 0);
  assert.equal(promo.totalRevenue, 50);
});

test('updatePromotion e deletePromotion falham em id inexistente', () => {
  assert.throws(() => updatePromotion('nao-existe', {}), /não encontrada/);
  assert.throws(() => deletePromotion('nao-existe'), /não encontrada/);
});
