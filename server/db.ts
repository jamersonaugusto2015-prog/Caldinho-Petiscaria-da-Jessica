import Database from 'better-sqlite3';
import fs from 'fs';
import type { SizeOption } from '../contract/catalog/types';
import type { OpeningHour, ShopId, StoreSettings } from '../contract/shop/types';
import { DEFAULT_OPENING_HOURS, DEFAULT_SIZE_OPTIONS, DEFAULT_STORE_SETTINGS } from '../contract/shop/defaults';
import { normalizePixProvider } from '../contract/payment/pix';
import { DATA_DIR } from './paths';
import { MIGRATIONS } from './infra/db/migrations/index';
import { runMigrations } from './infra/db/runner';
import { seedShop } from './infra/db/seed/createShop';
import { parseStoredSettings } from '../contract/shop/settings';
import { isValidShopSlug } from '../contract/shop/tenant';
import { config } from './config';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(`${DATA_DIR}/caldinho.db`);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/**
 * O schema não nasce mais aqui. Ele vem de `server/infra/db/migrations/`, uma
 * lista ordenada e versionada em `schema_version`. O que existia antes era um
 * `db.exec` de 100 linhas com `IF NOT EXISTS` mais duas funções que varriam
 * tabelas inteiras a cada boot para quase nunca achar nada.
 *
 * Falhar aqui derruba o boot de propósito: servir com o schema pela metade é
 * pior do que não servir.
 */
const freshMigrations = runMigrations(db, MIGRATIONS);
if (freshMigrations.length > 0) {
  console.log(`🗂  Migrações aplicadas: ${freshMigrations.join(', ')}`);
}

/**
 * A loja que já existia antes do multi-tenant. A migração `005_shops` cria a
 * linha com este id; nenhum outro lugar do sistema inventa o número.
 */
export const LOJA_PADRAO: ShopId = 1;

export const DEFAULT_SETTINGS: StoreSettings = DEFAULT_STORE_SETTINGS;

/**
 * A loja 1 ganha catálogo, configurações, PIN e credenciais — uma vez só, e sem
 * sobrescrever nada que o dono já tenha editado.
 *
 * As lojas seguintes nascem pelo painel super-admin (Fase 9), que chama
 * `createShop` direto. Este passo existe só para a loja que veio antes do painel.
 */
seedShop(db, LOJA_PADRAO);

/**
 * O slug da loja original vem do ambiente, para BATER com o domínio de produção.
 *
 * A migração 005 cria a loja 1 com o slug provisório `loja` — que não resolve
 * em domínio nenhum. Em produção o cliente chega por `Host`, e um slug que não
 * casa com o domínio devolve 404 com a loja no ar mas invisível. Aqui, se
 * `DEFAULT_SHOP_SLUG` estiver definido, a loja 1 passa a atender por ele. É
 * idempotente e vale tanto no banco novo quanto no já migrado (a 005 não roda
 * de novo, mas isto sim), então é o único ponto que conserta os dois casos.
 */
if (config.DEFAULT_SHOP_SLUG) {
  const slug = config.DEFAULT_SHOP_SLUG.trim().toLowerCase();
  if (!isValidShopSlug(slug)) {
    throw new Error(
      `DEFAULT_SHOP_SLUG inválido: "${slug}". Use minúsculas, números e hífens (ex.: caldinhodajessica).`
    );
  }
  const atual = db.prepare('SELECT slug FROM shops WHERE id = ?').get(LOJA_PADRAO) as
    | { slug: string }
    | undefined;
  if (atual && atual.slug !== slug) {
    // Recusa se o slug já for de OUTRA loja: dois donos no mesmo endereço é pior
    // que o 404. O índice único de `shops.slug` também barraria, mas com um erro
    // de constraint cru — melhor uma mensagem que diz o que fazer.
    const ocupado = db.prepare('SELECT id FROM shops WHERE slug = ? AND id != ?').get(slug, LOJA_PADRAO);
    if (ocupado) {
      throw new Error(`DEFAULT_SHOP_SLUG "${slug}" já pertence a outra loja. Escolha outro.`);
    }
    db.prepare('UPDATE shops SET slug = ? WHERE id = ?').run(slug, LOJA_PADRAO);
    console.log(`🏷  Loja 1 passou a atender pelo slug "${slug}".`);
  }
}

// ---------- Acesso à tabela `meta` (configuração da loja) ----------

/**
 * A tabela `meta` guarda a configuração da loja em pares chave/valor. Estes dois
 * são a ÚNICA porta para ela.
 *
 * Existiam quatro cópias deste upsert espalhadas (`backup.ts`, `mercadopago.ts`,
 * `index.ts`, `routes.ts`), e nenhuma sabia de loja. Depois da migração
 * `018_meta_shop`, a PK virou `(shop_id, key)` — e um `ON CONFLICT(key)` que não
 * bate mais com nenhuma restrição não falha em silêncio: ele derruba a rota.
 *
 * SEGREDO NÃO MORA AQUI. PIN, tokens de papel e credenciais do Mercado Pago
 * ficam em `shop_secrets` (`server/infra/secrets.ts`), fora do que
 * `GET /settings` serializa.
 */
export function getMetaValue(shopId: ShopId, key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM meta WHERE shop_id = ? AND key = ?').get(shopId, key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setMetaValue(shopId: ShopId, key: string, value: string): void {
  db.prepare(
    `INSERT INTO meta (shop_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(shop_id, key) DO UPDATE SET value = excluded.value`
  ).run(shopId, key, value);
}

export function deleteMetaValue(shopId: ShopId, key: string): void {
  db.prepare('DELETE FROM meta WHERE shop_id = ? AND key = ?').run(shopId, key);
}

// ---------- Helpers de settings ----------
export function getSettings(shopId: ShopId): StoreSettings {
  const get = (key: string, fallback: string): string => {
    const row = db.prepare('SELECT value FROM meta WHERE shop_id = ? AND key = ?').get(shopId, key) as
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
  /**
   * O resultado passa por `parseStoredSettings` antes de sair daqui: a tabela
   * `meta` guarda TEXTO, e esse texto já foi editado na mão, restaurado de
   * backup antigo e gravado por versões anteriores com outras regras. Um
   * `routeFactor` de 0.2 vindo do banco faria a conta de frete dizer que a rua
   * é mais curta que a linha reta — e ninguém veria erro nenhum.
   *
   * Valor ruim cai no padrão em vez de derrubar: recusar a configuração inteira
   * por causa de um campo torto fecharia a loja.
   */
  return parseStoredSettings({
    storeName: get('store_name', DEFAULT_SETTINGS.storeName),
    city: get('store_city', DEFAULT_SETTINGS.city),
    storeAddress: get('store_address', DEFAULT_SETTINGS.storeAddress),
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
    pixProvider: normalizePixProvider(get('pix_provider', DEFAULT_SETTINGS.pixProvider)),
    pixKey: get('pix_key', DEFAULT_SETTINGS.pixKey),
    pixMerchantName: get('pix_merchant_name', DEFAULT_SETTINGS.pixMerchantName),
    pixMerchantCity: get('pix_merchant_city', DEFAULT_SETTINGS.pixMerchantCity),
    cardOnDeliveryEnabled:
      get('card_on_delivery_enabled', String(DEFAULT_SETTINGS.cardOnDeliveryEnabled)) === 'true',
    storeWhatsApp: get('store_whatsapp', DEFAULT_SETTINGS.storeWhatsApp),
    orderSoundUrl: get('order_sound_url', DEFAULT_SETTINGS.orderSoundUrl),
    openingHours,
    sizeOptions,
    pickupEnabled: get('pickup_enabled', String(DEFAULT_SETTINGS.pickupEnabled)) === 'true',
    pickupReadyMinutes: num('pickup_ready_minutes', DEFAULT_SETTINGS.pickupReadyMinutes),
    loyaltyStampCost: num('loyalty_stamp_cost', DEFAULT_SETTINGS.loyaltyStampCost),
    loyaltyRedeemCategory: get('loyalty_redeem_category', DEFAULT_SETTINGS.loyaltyRedeemCategory),
    timezone: get('timezone', DEFAULT_SETTINGS.timezone),
    orderEnabled: get('order_enabled', 'true') === 'true',
    forceOpen: get('force_open', 'false') === 'true',
  }, DEFAULT_SETTINGS);
}
