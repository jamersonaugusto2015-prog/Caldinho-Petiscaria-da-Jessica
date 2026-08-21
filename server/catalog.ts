import { db } from './db';
import { DomainError } from './errors';
import { Category, ComboSlot, ComboSlotOption, Coupon, ExtraOption, Product } from '../src/types';

// ---------- Categorias ----------
export function listCategories(): Category[] {
  const rows = db.prepare('SELECT data FROM categories').all() as { data: string }[];
  const cats = rows.map((r) => JSON.parse(r.data) as Category);
  cats.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  return cats;
}

export function getCategory(id: string): Category | null {
  const row = db.prepare('SELECT data FROM categories WHERE id = ?').get(id) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as Category) : null;
}

export function normalizeCategory(b: Record<string, unknown>, existing?: Category): Category | null {
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

function nextCategorySort(): number {
  const all = db.prepare('SELECT data FROM categories').all() as { data: string }[];
  return all.reduce((m, r) => Math.max(m, (JSON.parse(r.data) as Category).sort ?? 0), -1) + 1;
}

export function createCategory(body: Record<string, unknown>): Category {
  const cat = normalizeCategory(body);
  if (!cat) throw new DomainError(400, 'Informe o nome da categoria.');
  cat.sort = nextCategorySort();
  db.prepare('INSERT INTO categories (id, data) VALUES (?, ?)').run(cat.id, JSON.stringify(cat));
  return cat;
}

export function updateCategory(id: string, body: Record<string, unknown>): Category {
  const existing = getCategory(id);
  if (!existing) throw new DomainError(404, 'Categoria não encontrada.');
  const cat = normalizeCategory(body, existing);
  if (!cat) throw new DomainError(400, 'Informe o nome da categoria.');
  db.prepare('UPDATE categories SET data = ? WHERE id = ?').run(JSON.stringify(cat), cat.id);
  return cat;
}

export function deleteCategory(id: string): void {
  const existing = getCategory(id);
  if (!existing) throw new DomainError(404, 'Categoria não encontrada.');
  const used = (
    db.prepare('SELECT COUNT(*) AS c FROM products WHERE data LIKE ?').get(`%"category":"${id}"%`) as {
      c: number;
    }
  ).c;
  if (used > 0) {
    throw new DomainError(
      400,
      `Não é possível excluir: ${used} produto(s) usam esta categoria. Mova-os ou remova-os primeiro.`
    );
  }
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

// ---------- Produtos ----------
export function listProducts(): Product[] {
  const rows = db.prepare('SELECT data FROM products ORDER BY rowid').all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Product);
}

export function getProduct(id: string): Product | null {
  const row = db.prepare('SELECT data FROM products WHERE id = ?').get(id) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as Product) : null;
}

export function createProduct(body: unknown): Product {
  const p = body as Product;
  if (!p?.id || !p.name || typeof p.basePrice !== 'number') {
    throw new DomainError(400, 'Dados do produto inválidos.');
  }
  db.prepare('INSERT INTO products (id, data) VALUES (?, ?)').run(p.id, JSON.stringify(p));
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

export function updateProduct(id: string, body: Record<string, unknown>): Product {
  const p = getProduct(id);
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
  if (typeof b.isCaldinhoDoDia === 'boolean') p.isCaldinhoDoDia = b.isCaldinhoDoDia;
  if (Array.isArray(b.allowedExtras)) p.allowedExtras = normalizeExtras(b.allowedExtras);
  if (Array.isArray(b.comboSlots)) p.comboSlots = normalizeComboSlots(b.comboSlots);
  db.prepare('UPDATE products SET data = ? WHERE id = ?').run(JSON.stringify(p), p.id);
  return p;
}

export function deleteProduct(id: string): void {
  const p = getProduct(id);
  if (!p) throw new DomainError(404, 'Produto não encontrado.');
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
}

/** Promoção do dia: qualquer produto pode ser o destaque. `null` desmarca todos. */
export function setCaldinhoDoDia(id: string | null): void {
  const rows = db.prepare('SELECT data FROM products').all() as { data: string }[];
  const tx = db.transaction(() => {
    for (const r of rows) {
      const p: Product = JSON.parse(r.data);
      p.isCaldinhoDoDia = id !== null && p.id === id;
      db.prepare('UPDATE products SET data = ? WHERE id = ?').run(JSON.stringify(p), p.id);
    }
  });
  tx();
}

export function clearCaldinhoDoDia(): void {
  setCaldinhoDoDia(null);
}

// ---------- Cupons ----------
/** Ordem de inserção — usada pela intake para localizar um cupom pelo código, onde a ordem não importa. */
export function listCoupons(): Coupon[] {
  const rows = db.prepare('SELECT data FROM coupons').all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Coupon);
}

export function listCouponsSorted(): Coupon[] {
  const rows = db.prepare('SELECT data FROM coupons ORDER BY code').all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Coupon);
}

export function saveCoupon(body: unknown): Coupon {
  const c = body as Coupon;
  if (!c?.code || !(typeof c.discountPercent === 'number' || typeof c.discountFixed === 'number')) {
    throw new DomainError(400, 'Dados do cupom inválidos.');
  }
  const coupon: Coupon = {
    code: c.code.trim().toUpperCase(),
    discountPercent: typeof c.discountPercent === 'number' ? c.discountPercent : undefined,
    discountFixed: typeof c.discountFixed === 'number' ? c.discountFixed : undefined,
    minOrderValue: Number(c.minOrderValue) || 0,
    description: c.description?.trim() || 'Cupom de desconto',
  };
  db.prepare(
    'INSERT INTO coupons (code, data) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET data = excluded.data'
  ).run(coupon.code, JSON.stringify(coupon));
  return coupon;
}

export function deleteCoupon(code: string): void {
  db.prepare('DELETE FROM coupons WHERE code = ?').run(code.toUpperCase());
}
