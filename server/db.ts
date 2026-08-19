import Database from 'better-sqlite3';
import fs from 'fs';
import { randomBytes } from 'crypto';
import { INITIAL_PRODUCTS } from '../src/data/initialData';
import { OpeningHour, SizeOption, StoreSettings } from '../src/types';
import { DEFAULT_OPENING_HOURS, DEFAULT_SIZE_OPTIONS, DEFAULT_STORE_SETTINGS } from '../src/shared/defaults';
import { hashPasswordSync } from './auth';
import { DATA_DIR } from './paths';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(`${DATA_DIR}/caldinho.db`);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS drivers (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS coupons (
    code TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS loyalty (
    customer_id TEXT PRIMARY KEY,
    points INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS free_redeems (
    token TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS geo_cache (
    query TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ---------- Migrações ----------
function migrateOrdersCustomerId() {
  const cols = db.prepare('PRAGMA table_info(orders)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'customer_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN customer_id TEXT');
  }
}
migrateOrdersCustomerId();

// Índices para as consultas reais do app (kanban por status, histórico por
// cliente, relatórios ordenados por data e chat por pedido). Sem eles, cada
// consulta é um full table scan que piora conforme o banco cresce ao longo
// dos anos. CREATE INDEX IF NOT EXISTS é idempotente: seguro em todo boot.
// Roda depois das migrações acima: idx_orders_customer_created usa customer_id,
// que só existe a partir daqui em um banco antigo (migrado, não recriado).
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_order_id ON chat_messages(order_id);
`);

// ---------- Seeds ----------
function seedCategories() {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM categories').get() as { c: number }).c;
  if (count > 0) return;
  const defaults = [
    { id: 'caldinhos', label: 'Caldinhos', emoji: '🍲', color: '#C2410C', sort: 0 },
    { id: 'petiscos', label: 'Petiscos', emoji: '🍤', color: '#7C3AED', sort: 1 },
    { id: 'bebidas', label: 'Bebidas', emoji: '🥤', color: '#2563EB', sort: 2 },
    { id: 'combos', label: 'Combos', emoji: '🍱', color: '#059669', sort: 3 },
  ];
  const insert = db.prepare('INSERT INTO categories (id, data) VALUES (?, ?)');
  const tx = db.transaction(() => {
    for (const c of defaults) insert.run(c.id, JSON.stringify(c));
  });
  tx();
}

function seedProducts() {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM products').get() as { c: number }).c;
  if (count > 0) return;
  const insert = db.prepare('INSERT INTO products (id, data) VALUES (?, ?)');
  const tx = db.transaction(() => {
    for (const p of INITIAL_PRODUCTS) insert.run(p.id, JSON.stringify(p));
  });
  tx();
}

function seedCoupons() {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM coupons').get() as { c: number }).c;
  if (count > 0) return;
  const defaults = [
    {
      code: 'CALDINHO10',
      discountPercent: 10,
      minOrderValue: 30,
      description: '10% de desconto em todo o cardápio!',
    },
    {
      code: 'PRIMEIRO30',
      discountFixed: 8.0,
      minOrderValue: 35,
      description: 'R$ 8,00 OFF no seu primeiro pedido do dia!',
    },
    {
      code: 'FRETEGRATIS',
      discountFixed: 5.0,
      minOrderValue: 50,
      description: 'R$ 5,00 de desconto na entrega!',
    },
  ];
  const insert = db.prepare('INSERT INTO coupons (code, data) VALUES (?, ?)');
  const tx = db.transaction(() => {
    for (const c of defaults) insert.run(c.code, JSON.stringify(c));
  });
  tx();
}

function seedDrivers() {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM drivers').get() as { c: number }).c;
  if (count > 0) return;
  db.prepare('INSERT INTO drivers (id, data) VALUES (?, ?)').run(
    'drv-1',
    JSON.stringify({
      id: 'drv-1',
      name: 'Marcos Motoboy',
      phone: '(81) 98765-4321',
      password: hashPasswordSync('1234'),
      bikeModel: 'Honda Biz 125',
      plate: 'PCD-1A23',
      active: true,
      online: false,
      createdAt: new Date().toISOString(),
    })
  );
}

// Migra senhas de motoboys em texto claro para hash
function upgradeDriverPasswords() {
  const rows = db.prepare('SELECT id, data FROM drivers').all() as { id: string; data: string }[];
  for (const row of rows) {
    const d = JSON.parse(row.data);
    if (typeof d.password === 'string' && !d.password.startsWith('scrypt:')) {
      d.password = hashPasswordSync(d.password);
      db.prepare('UPDATE drivers SET data = ? WHERE id = ?').run(JSON.stringify(d), row.id);
    }
  }
}
upgradeDriverPasswords();

export const DEFAULT_SETTINGS: StoreSettings = DEFAULT_STORE_SETTINGS;

function seedSettings() {
  const upsert = db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING'
  );
  const base = DEFAULT_SETTINGS;
  const rows: [string, string][] = [
    ['store_name', base.storeName],
    ['store_city', base.city],
    ['store_lat', String(base.storeLat)],
    ['store_lng', String(base.storeLng)],
    ['delivery_price_per_km', String(base.deliveryPricePerKm)],
    ['delivery_base_fee', String(base.deliveryBaseFee)],
    ['delivery_min_fee', String(base.deliveryMinFee)],
    ['free_delivery_above', String(base.freeDeliveryAbove)],
    ['max_delivery_km', String(base.maxDeliveryKm)],
    ['min_order_value', String(base.minOrderValue)],
    ['route_factor', String(base.routeFactor)],
    ['driver_fee_per_delivery', String(base.driverFeePerDelivery)],
    ['pix_key', base.pixKey],
    ['pix_merchant_name', base.pixMerchantName],
    ['pix_merchant_city', base.pixMerchantCity],
    ['store_whatsapp', base.storeWhatsApp],
    ['order_sound_url', base.orderSoundUrl],
    ['opening_hours', JSON.stringify(base.openingHours)],
    ['size_options', JSON.stringify(base.sizeOptions)],
    ['order_enabled', String(base.orderEnabled)],
    ['force_open', String(base.forceOpen)],
  ];
  const tx = db.transaction(() => {
    for (const [k, v] of rows) upsert.run(k, v);
  });
  tx();

  // PIN padrão da cozinha: 1234 (hash scrypt)
  const pinRow = db.prepare("SELECT value FROM meta WHERE key = 'kitchen_pin_hash'").get();
  if (!pinRow) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('kitchen_pin_hash', ?)").run(
      hashPasswordSync('1234')
    );
  }

  // Tokens de papel: gerados aleatoriamente uma única vez e persistidos
  for (const role of ['kitchen', 'driver']) {
    const key = `role_token_${role}`;
    const existing = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    if (!existing) {
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(
        key,
        `tok-${role}-${randomBytes(24).toString('hex')}`
      );
    }
  }
}

seedCategories();
seedProducts();
seedCoupons();
seedDrivers();
seedSettings();

// ---------- Helpers de settings ----------
export function getSettings(): StoreSettings {
  const get = (key: string, fallback: string): string => {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : fallback;
  };
  const num = (key: string, fallback: number): number => {
    const v = Number(get(key, String(fallback)));
    return Number.isFinite(v) ? v : fallback;
  };
  let openingHours: (OpeningHour | null)[];
  try {
    openingHours = JSON.parse(get('opening_hours', JSON.stringify(DEFAULT_OPENING_HOURS)));
  } catch {
    openingHours = DEFAULT_OPENING_HOURS;
  }
  let sizeOptions: SizeOption[];
  try {
    sizeOptions = JSON.parse(get('size_options', JSON.stringify(DEFAULT_SIZE_OPTIONS)));
  } catch {
    sizeOptions = DEFAULT_SIZE_OPTIONS;
  }
  return {
    storeName: get('store_name', DEFAULT_SETTINGS.storeName),
    city: get('store_city', DEFAULT_SETTINGS.city),
    storeLat: num('store_lat', DEFAULT_SETTINGS.storeLat),
    storeLng: num('store_lng', DEFAULT_SETTINGS.storeLng),
    deliveryPricePerKm: num('delivery_price_per_km', DEFAULT_SETTINGS.deliveryPricePerKm),
    deliveryBaseFee: num('delivery_base_fee', DEFAULT_SETTINGS.deliveryBaseFee),
    deliveryMinFee: num('delivery_min_fee', DEFAULT_SETTINGS.deliveryMinFee),
    freeDeliveryAbove: num('free_delivery_above', DEFAULT_SETTINGS.freeDeliveryAbove),
    maxDeliveryKm: num('max_delivery_km', DEFAULT_SETTINGS.maxDeliveryKm),
    minOrderValue: num('min_order_value', DEFAULT_SETTINGS.minOrderValue),
    routeFactor: num('route_factor', DEFAULT_SETTINGS.routeFactor),
    driverFeePerDelivery: num('driver_fee_per_delivery', DEFAULT_SETTINGS.driverFeePerDelivery),
    pixKey: get('pix_key', DEFAULT_SETTINGS.pixKey),
    pixMerchantName: get('pix_merchant_name', DEFAULT_SETTINGS.pixMerchantName),
    pixMerchantCity: get('pix_merchant_city', DEFAULT_SETTINGS.pixMerchantCity),
    storeWhatsApp: get('store_whatsapp', DEFAULT_SETTINGS.storeWhatsApp),
    orderSoundUrl: get('order_sound_url', DEFAULT_SETTINGS.orderSoundUrl),
    openingHours,
    sizeOptions,
    orderEnabled: get('order_enabled', 'true') === 'true',
    forceOpen: get('force_open', 'false') === 'true',
  };
}

export function getRoleToken(role: 'kitchen' | 'driver'): string {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(`role_token_${role}`) as
    | { value: string }
    | undefined;
  return row ? row.value : '';
}

// ---------- Fidelidade por cliente ----------
export function getLoyaltyPoints(customerId: string): number {
  const row = db.prepare('SELECT points FROM loyalty WHERE customer_id = ?').get(customerId) as
    | { points: number }
    | undefined;
  return row ? row.points : 0;
}

export function addLoyaltyPoints(customerId: string, points: number): number {
  if (!Number.isFinite(points)) return getLoyaltyPoints(customerId);
  db.prepare(
    'INSERT INTO loyalty (customer_id, points) VALUES (?, ?) ON CONFLICT(customer_id) DO UPDATE SET points = points + excluded.points'
  ).run(customerId, points);
  return getLoyaltyPoints(customerId);
}

export function deductLoyaltyPoints(customerId: string, points: number): number {
  db.prepare(
    'INSERT INTO loyalty (customer_id, points) VALUES (?, ?) ON CONFLICT(customer_id) DO UPDATE SET points = excluded.points'
  ).run(customerId, Math.max(0, getLoyaltyPoints(customerId) - points));
  return getLoyaltyPoints(customerId);
}

// ---------- Resgate de fidelidade ----------
export function createFreeRedeem(productId: string): string {
  const token = `LFT-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  db.prepare('INSERT INTO free_redeems (token, product_id) VALUES (?, ?)').run(token, productId);
  return token;
}

export function peekFreeRedeem(token: string, productId: string): boolean {
  const row = db.prepare('SELECT product_id, used FROM free_redeems WHERE token = ?').get(token) as
    | { product_id: string; used: number }
    | undefined;
  return !!row && row.used === 0 && row.product_id === productId;
}

export function consumeFreeRedeem(token: string, productId: string): boolean {
  if (!peekFreeRedeem(token, productId)) return false;
  db.prepare('UPDATE free_redeems SET used = 1 WHERE token = ?').run(token);
  return true;
}
