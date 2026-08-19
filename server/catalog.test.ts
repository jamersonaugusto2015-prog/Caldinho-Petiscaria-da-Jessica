import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// server/db.ts opens a real sqlite file at DATA_DIR the moment it is imported, and this repo's
// dev DATA_DIR already has live data. This override MUST run before ./catalog is loaded (hence
// the dynamic import below), or these tests would run against real data.
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'caldinho-catalog-test-'));

const {
  createCategory,
  createProduct,
  deleteCategory,
  deleteCoupon,
  deleteProduct,
  getCategory,
  getProduct,
  listCategories,
  listCoupons,
  listCouponsSorted,
  listProducts,
  normalizeCategory,
  normalizeComboSlots,
  normalizeExtras,
  saveCoupon,
  setCaldinhoDoDia,
  updateCategory,
  updateProduct,
} = await import('./catalog');
const { DomainError } = await import('./errors');

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-' + Math.random().toString(36).slice(2, 8),
    name: 'Caldinho de Feijão',
    description: 'Quentinho',
    category: 'caldinhos',
    basePrice: 12,
    image: '',
    available: true,
    rating: 5,
    reviewsCount: 0,
    prepTimeMinutes: 10,
    ...overrides,
  };
}

test('normalizeCategory rejects a blank label', () => {
  assert.equal(normalizeCategory({ label: '   ' }), null);
  assert.equal(normalizeCategory({}), null);
});

test('normalizeCategory falls back to defaults for a missing emoji, color and sort', () => {
  const cat = normalizeCategory({ label: 'Sobremesas' })!;
  assert.equal(cat.label, 'Sobremesas');
  assert.equal(cat.emoji, '🍽️');
  assert.equal(cat.color, '#B91C1C');
  assert.equal(cat.sort, 0);
});

test('normalizeCategory rejects a color that is not a 6-digit hex', () => {
  const cat = normalizeCategory({ label: 'Bebidas', color: 'not-a-color' })!;
  assert.equal(cat.color, '#B91C1C');
  const valid = normalizeCategory({ label: 'Bebidas', color: '#123abc' })!;
  assert.equal(valid.color, '#123abc');
});

test('normalizeCategory truncates an overlong label to 30 chars', () => {
  const cat = normalizeCategory({ label: 'x'.repeat(50) })!;
  assert.equal(cat.label.length, 30);
});

test('normalizeCategory keeps the existing id, emoji, color and sort on patch when omitted', () => {
  const existing = { id: 'cat-1', label: 'Antiga', emoji: '🍤', color: '#2563EB', sort: 3 };
  const patched = normalizeCategory({ label: 'Nova' }, existing)!;
  assert.equal(patched.id, 'cat-1');
  assert.equal(patched.emoji, '🍤');
  assert.equal(patched.color, '#2563EB');
  assert.equal(patched.sort, 3);
  assert.equal(patched.label, 'Nova');
});

test('createCategory assigns the next sort slot after existing categories', async () => {
  const first = createCategory({ label: 'Primeira' });
  const second = createCategory({ label: 'Segunda' });
  assert.equal(second.sort, first.sort + 1);
  const ids = listCategories().map((c) => c.id);
  assert.ok(ids.includes(first.id));
  assert.ok(ids.includes(second.id));
});

test('createCategory throws a DomainError for a missing label', () => {
  assert.throws(
    () => createCategory({}),
    (err: unknown) => err instanceof DomainError && err.status === 400 && err.message === 'Informe o nome da categoria.'
  );
});

test('updateCategory throws a 404 DomainError for an unknown id', () => {
  assert.throws(
    () => updateCategory('missing', { label: 'X' }),
    (err: unknown) => err instanceof DomainError && err.status === 404
  );
});

test('deleteCategory refuses to delete a category still used by a product', async () => {
  const cat = createCategory({ label: 'Petiscos' });
  createProduct(makeProduct({ category: cat.id }));
  assert.throws(
    () => deleteCategory(cat.id),
    (err: unknown) =>
      err instanceof DomainError &&
      err.status === 400 &&
      err.message === 'Não é possível excluir: 1 produto(s) usam esta categoria. Mova-os ou remova-os primeiro.'
  );
  assert.ok(getCategory(cat.id));
});

test('deleteCategory removes a category with no products attached', async () => {
  const cat = createCategory({ label: 'Sem uso' });
  deleteCategory(cat.id);
  assert.equal(getCategory(cat.id), null);
});

test('createProduct rejects a product missing id, name or a numeric basePrice', () => {
  assert.throws(() => createProduct({ name: 'X', basePrice: 10 }), DomainError);
  assert.throws(() => createProduct({ id: 'x', basePrice: 10 }), DomainError);
  assert.throws(() => createProduct({ id: 'x', name: 'X', basePrice: 'free' }), DomainError);
});

test('createProduct persists a valid product and it is listable', () => {
  const p = createProduct(makeProduct({ id: 'p-valid' }));
  assert.equal(p.id, 'p-valid');
  assert.ok(listProducts().some((x) => x.id === 'p-valid'));
});

test('updateProduct merges only the fields present in the patch', () => {
  const p = createProduct(makeProduct({ id: 'p-merge', basePrice: 10, available: true }));
  const updated = updateProduct('p-merge', { basePrice: 15 });
  assert.equal(updated.basePrice, 15);
  assert.equal(updated.available, true); // unrelated field untouched
  assert.equal(updated.name, p.name);
});

test('updateProduct clears originalPrice when explicitly set to null', () => {
  createProduct(makeProduct({ id: 'p-promo', originalPrice: 20 }));
  const updated = updateProduct('p-promo', { originalPrice: null });
  assert.equal(updated.originalPrice, undefined);
});

test('updateProduct throws a 404 DomainError for an unknown id', () => {
  assert.throws(
    () => updateProduct('missing', { basePrice: 5 }),
    (err: unknown) => err instanceof DomainError && err.status === 404
  );
});

test('deleteProduct throws a 404 DomainError for an unknown id', () => {
  assert.throws(() => deleteProduct('missing'), (err: unknown) => err instanceof DomainError && err.status === 404);
});

test('normalizeExtras drops entries without a usable name and floors price at zero', () => {
  const extras = normalizeExtras([
    { name: 'Bacon', price: 3 },
    { name: '   ' },
    { name: 'Queijo', price: -5 },
  ]);
  assert.equal(extras.length, 2);
  assert.equal(extras[0].name, 'Bacon');
  assert.equal(extras[0].price, 3);
  assert.equal(extras[1].price, 0);
});

test('normalizeExtras generates an id when none is supplied', () => {
  const extras = normalizeExtras([{ name: 'Bacon', price: 3 }]);
  assert.ok(extras[0].id.startsWith('ext-'));
});

test('normalizeComboSlots drops slots without a label and options without a label', () => {
  const slots = normalizeComboSlots([
    { label: 'Escolha o caldinho', options: [{ label: 'Feijão' }, { label: '  ' }] },
    { label: '   ', options: [{ label: 'Deve sumir' }] },
  ]);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].options.length, 1);
  assert.equal(slots[0].options[0].label, 'Feijão');
});

test('normalizeComboSlots defaults required to true unless explicitly false', () => {
  const [withDefault, explicitFalse] = normalizeComboSlots([
    { label: 'A', options: [] },
    { label: 'B', options: [], required: false },
  ]);
  assert.equal(withDefault.required, true);
  assert.equal(explicitFalse.required, false);
});

test('updateProduct applies normalizeExtras and normalizeComboSlots to the patch', () => {
  createProduct(makeProduct({ id: 'p-combo' }));
  const updated = updateProduct('p-combo', {
    allowedExtras: [{ name: 'Bacon', price: 2 }],
    comboSlots: [{ label: 'Sabor', options: [{ label: 'Feijão', priceDelta: 1 }] }],
  });
  assert.equal(updated.allowedExtras?.length, 1);
  assert.equal(updated.comboSlots?.length, 1);
  assert.equal(updated.comboSlots?.[0].options[0].priceDelta, 1);
});

test('setCaldinhoDoDia makes the given id exclusively true, clearing every other product', () => {
  createProduct(makeProduct({ id: 'p-a', isCaldinhoDoDia: true }));
  createProduct(makeProduct({ id: 'p-b', isCaldinhoDoDia: false }));
  setCaldinhoDoDia('p-b');
  const products = listProducts();
  assert.equal(products.find((p) => p.id === 'p-a')?.isCaldinhoDoDia, false);
  assert.equal(products.find((p) => p.id === 'p-b')?.isCaldinhoDoDia, true);
});

test('setCaldinhoDoDia with an id that matches nothing clears every product', () => {
  createProduct(makeProduct({ id: 'p-c', isCaldinhoDoDia: true }));
  setCaldinhoDoDia('does-not-exist');
  assert.equal(getProduct('p-c')?.isCaldinhoDoDia, false);
});

test('saveCoupon rejects a coupon without a code or a numeric discount', () => {
  assert.throws(() => saveCoupon({ discountPercent: 10 }), DomainError);
  assert.throws(() => saveCoupon({ code: 'X' }), DomainError);
});

test('saveCoupon normalizes the code to uppercase and defaults minOrderValue and description', () => {
  const coupon = saveCoupon({ code: '  promo10 ', discountPercent: 10 });
  assert.equal(coupon.code, 'PROMO10');
  assert.equal(coupon.minOrderValue, 0);
  assert.equal(coupon.description, 'Cupom de desconto');
});

test('saveCoupon upserts: saving the same code twice replaces the stored coupon', () => {
  saveCoupon({ code: 'DUP', discountPercent: 5 });
  saveCoupon({ code: 'DUP', discountFixed: 8 });
  const stored = listCoupons().filter((c) => c.code === 'DUP');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].discountFixed, 8);
  assert.equal(stored[0].discountPercent, undefined);
});

test('deleteCoupon removes by code case-insensitively', () => {
  saveCoupon({ code: 'GONE', discountPercent: 5 });
  deleteCoupon('gone');
  assert.ok(!listCoupons().some((c) => c.code === 'GONE'));
});

test('listCouponsSorted returns coupons ordered by code', () => {
  saveCoupon({ code: 'ZZZ', discountPercent: 1 });
  saveCoupon({ code: 'AAA', discountPercent: 1 });
  const codes = listCouponsSorted().map((c) => c.code);
  const sorted = [...codes].sort();
  assert.deepEqual(codes, sorted);
});
