import { db } from './db';
import { DomainError } from './errors';
import type { Category, ComboSlot, ComboSlotOption, Coupon, ExtraOption, Product } from '../contract/catalog/types';
import type { ShopId } from '../contract/shop/types';
// ---------- Categorias ----------
export function listCategories(shopId: ShopId): Category[] {
  const rows = db.prepare('SELECT data FROM categories WHERE shop_id = ?').all(shopId) as { data: string }[];
  const cats = rows.map((r) => JSON.parse(r.data) as Category);
  cats.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  return cats;
}

export function getCategory(shopId: ShopId, id: string): Category | null {
  const row = db.prepare('SELECT data FROM categories WHERE shop_id = ? AND id = ?').get(shopId, id) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as Category) : null;
}

export function normalizeCategory(shopId: ShopId, b: Record<string, unknown>, existing?: Category): Category | null {
  const label = typeof b.label === 'string' ? b.label.trim() : existing?.label;
  if (!label) return null;
  const emoji = typeof b.emoji === 'string' && b.emoji ? b.emoji.slice(0, 8) : existing?.emoji || '🍽️';
  const color =
    typeof b.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.color)
      ? b.color
      : existing?.color || '#B91C1C';
  const sort = typeof b.sort === 'number' ? b.sort : existing?.sort ?? 0;
  return {
    id: existing?.id || 'cat-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    label: label.slice(0, 30),
    emoji,
    color,
    sort,
  };
}

function nextCategorySort(shopId: ShopId): number {
  const all = db.prepare('SELECT data FROM categories WHERE shop_id = ?').all(shopId) as { data: string }[];
  return all.reduce((m, r) => Math.max(m, (JSON.parse(r.data) as Category).sort ?? 0), -1) + 1;
}

export function createCategory(shopId: ShopId, body: Record<string, unknown>): Category {
  const cat = normalizeCategory(shopId, body);
  if (!cat) throw new DomainError(400, 'Informe o nome da categoria.');
  cat.sort = nextCategorySort(shopId);
  db.prepare('INSERT INTO categories (shop_id, id, data) VALUES (?, ?, ?)').run(shopId, cat.id, JSON.stringify(cat));
  return cat;
}

export function updateCategory(shopId: ShopId, id: string, body: Record<string, unknown>): Category {
  const existing = getCategory(shopId, id);
  if (!existing) throw new DomainError(404, 'Categoria não encontrada.');
  const cat = normalizeCategory(shopId, body, existing);
  if (!cat) throw new DomainError(400, 'Informe o nome da categoria.');
  db.prepare('UPDATE categories SET data = ? WHERE shop_id = ? AND id = ?').run(JSON.stringify(cat), shopId, cat.id);
  return cat;
}

export function deleteCategory(shopId: ShopId, id: string): void {
  const existing = getCategory(shopId, id);
  if (!existing) throw new DomainError(404, 'Categoria não encontrada.');
  const used = (
    // Era `WHERE data LIKE '%"category":"..."%'` — varredura de TEXTO em cima do
    // JSON, que casava também com uma observação do cliente que citasse a
    // categoria. `json_extract` lê o campo de verdade e usa o índice da 014.
    db.prepare(
      "SELECT COUNT(*) AS c FROM products WHERE shop_id = ? AND json_extract(data, '$.category') = ?"
    ).get(shopId, id) as {
      c: number;
    }
  ).c;
  if (used > 0) {
    throw new DomainError(
      400,
      `Não é possível excluir: ${used} produto(s) usam esta categoria. Mova-os ou remova-os primeiro.`
    );
  }
  db.prepare('DELETE FROM categories WHERE shop_id = ? AND id = ?').run(shopId, id);
}

// ---------- Produtos ----------
export function listProducts(shopId: ShopId): Product[] {
  const rows = db.prepare('SELECT data FROM products WHERE shop_id = ? ORDER BY rowid').all(shopId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Product);
}

export function getProduct(shopId: ShopId, id: string): Product | null {
  const row = db.prepare('SELECT data FROM products WHERE shop_id = ? AND id = ?').get(shopId, id) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as Product) : null;
}

export function createProduct(shopId: ShopId, body: unknown): Product {
  const p = body as Product;
  if (!p?.id || !p.name || typeof p.basePrice !== 'number') {
    throw new DomainError(400, 'Informe o nome e o preço do produto.');
  }
  // Id repetido dava um 500 cru de "UNIQUE constraint failed". Um 409 legível
  // diz o que aconteceu — e o id do produto vem do editor, então colide de vez.
  if (getProduct(shopId, p.id)) {
    throw new DomainError(409, 'Já existe um produto com esse identificador.');
  }
  db.prepare('INSERT INTO products (shop_id, id, data) VALUES (?, ?, ?)').run(shopId, p.id, JSON.stringify(p));
  return p;
}

export function normalizeExtras(raw: unknown): ExtraOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e: ExtraOption) => e && typeof e.name === 'string' && e.name.trim())
    .map((e: ExtraOption) => ({
      id: typeof e.id === 'string' && e.id ? e.id : 'ext-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      name: e.name.trim().slice(0, 60),
      price: Math.max(0, Number(e.price) || 0),
    }));
}

export function normalizeComboSlots(raw: unknown): ComboSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s: ComboSlot) => s && typeof s.label === 'string' && s.label.trim())
    .map((s: ComboSlot) => {
      const required = s.required !== false;
      const options = (Array.isArray(s.options) ? s.options : [])
        .filter((o: ComboSlotOption) => o && typeof o.label === 'string' && o.label.trim())
        .map((o: ComboSlotOption) => ({
          id: typeof o.id === 'string' && o.id ? o.id : 'opt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          label: o.label.trim().slice(0, 60),
          priceDelta: Math.max(0, Number(o.priceDelta) || 0),
        }));
      const fallbackMin = required ? 1 : 0;
      const minChoices = Math.max(0, Math.floor(Number(s.minChoices ?? fallbackMin) || fallbackMin));
      const maxChoices = Math.min(
        options.length,
        Math.max(minChoices, Math.floor(Number(s.maxChoices ?? minChoices) || minChoices))
      );
      return {
        id: typeof s.id === 'string' && s.id ? s.id : 'slot-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        label: s.label.trim().slice(0, 60),
        required,
        minChoices,
        maxChoices,
        options,
      };
    });
}

export function updateProduct(shopId: ShopId, id: string, body: Record<string, unknown>): Product {
  const p = getProduct(shopId, id);
  if (!p) throw new DomainError(404, 'Produto não encontrado.');
  const b = body;
  if (typeof b.basePrice === 'number') p.basePrice = b.basePrice;
  if (typeof b.available === 'boolean') p.available = b.available;
  if (typeof b.image === 'string' && b.image.trim()) p.image = b.image.trim();
  if (typeof b.name === 'string' && b.name.trim()) p.name = b.name.trim();
  if (typeof b.description === 'string' && b.description.trim()) p.description = b.description.trim();
  if (typeof b.prepTimeMinutes === 'number') p.prepTimeMinutes = b.prepTimeMinutes;
  if (typeof b.category === 'string' && b.category.trim()) p.category = b.category.trim();
  if (typeof b.originalPrice === 'number') p.originalPrice = b.originalPrice;
  if (b.originalPrice === null) p.originalPrice = undefined;
  // Custo do prato: `undefined` no corpo significa "apagar o custo", e é assim
  // que o editor manda quando o dono limpa o campo.
  if (typeof b.costPrice === 'number') p.costPrice = Math.max(0, b.costPrice);
  else if (b.costPrice === null || ('costPrice' in b && b.costPrice === undefined)) p.costPrice = undefined;
  if (typeof b.hasSizeOption === 'boolean') p.hasSizeOption = b.hasSizeOption;
  if (typeof b.isPopular === 'boolean') p.isPopular = b.isPopular;
  if (typeof b.isFlashPromo === 'boolean') p.isFlashPromo = b.isFlashPromo;
  if (typeof b.isFeatured === 'boolean') p.isFeatured = b.isFeatured;
  if (Array.isArray(b.allowedExtras)) p.allowedExtras = normalizeExtras(b.allowedExtras);
  if (Array.isArray(b.comboSlots)) p.comboSlots = normalizeComboSlots(b.comboSlots);
  db.prepare('UPDATE products SET data = ? WHERE shop_id = ? AND id = ?').run(JSON.stringify(p), shopId, p.id);
  return p;
}

export function deleteProduct(shopId: ShopId, id: string): void {
  const p = getProduct(shopId, id);
  if (!p) throw new DomainError(404, 'Produto não encontrado.');
  db.prepare('DELETE FROM products WHERE shop_id = ? AND id = ?').run(shopId, id);
}

/** Promoção do dia: qualquer produto pode ser o destaque. `null` desmarca todos. */
export function setFeaturedProduct(shopId: ShopId, id: string | null): void {
  const rows = db.prepare('SELECT data FROM products WHERE shop_id = ?').all(shopId) as { data: string }[];
  const tx = db.transaction(() => {
    for (const r of rows) {
      const p: Product = JSON.parse(r.data);
      p.isFeatured = id !== null && p.id === id;
      db.prepare('UPDATE products SET data = ? WHERE shop_id = ? AND id = ?').run(JSON.stringify(p), shopId, p.id);
    }
  });
  tx();
}

export function clearFeaturedProduct(shopId: ShopId): void {
  setFeaturedProduct(shopId, null);
}

// ---------- Cupons ----------
/** Ordem de inserção — usada pela intake para localizar um cupom pelo código, onde a ordem não importa. */
export function listCoupons(shopId: ShopId): Coupon[] {
  const rows = db.prepare('SELECT data FROM coupons WHERE shop_id = ?').all(shopId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Coupon);
}

export function listCouponsSorted(shopId: ShopId): Coupon[] {
  const rows = db.prepare('SELECT data FROM coupons WHERE shop_id = ? ORDER BY code').all(shopId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Coupon);
}

export function saveCoupon(shopId: ShopId, body: unknown): Coupon {
  const c = body as Coupon;
  if (!c?.code || !(typeof c.discountPercent === 'number' || typeof c.discountFixed === 'number')) {
    throw new DomainError(400, 'Informe o código do cupom e o desconto.');
  }
  const coupon: Coupon = {
    code: c.code.trim().toUpperCase(),
    discountPercent: typeof c.discountPercent === 'number' ? c.discountPercent : undefined,
    discountFixed: typeof c.discountFixed === 'number' ? c.discountFixed : undefined,
    minOrderValue: Number(c.minOrderValue) || 0,
    description: c.description?.trim() || 'Cupom de desconto',
  };
  db.prepare(
    `INSERT INTO coupons (shop_id, code, data) VALUES (?, ?, ?)
     ON CONFLICT(shop_id, code) DO UPDATE SET data = excluded.data`
  ).run(shopId, coupon.code, JSON.stringify(coupon));
  return coupon;
}

export function deleteCoupon(shopId: ShopId, code: string): void {
  db.prepare('DELETE FROM coupons WHERE shop_id = ? AND code = ?').run(shopId, code.toUpperCase());
}
