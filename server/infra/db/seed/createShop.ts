import { randomBytes } from 'crypto';
import type Database from 'better-sqlite3';
import { hashPasswordSync } from '../../../auth';
import { DEFAULT_STORE_SETTINGS } from '../../../../contract/shop/defaults';
import { isValidShopSlug } from '../../../../contract/shop/tenant';
import type { ShopId, StoreSettings } from '../../../../contract/shop/types';
import { INITIAL_PRODUCTS } from './catalogTemplate';

/**
 * Nascimento de uma loja: catálogo, categorias, cupons, configurações, PIN e
 * credenciais de equipe.
 *
 * Isto era um punhado de funções `seedX()` soltas no `db.ts`, cada uma
 * conferindo "a tabela está vazia?" e rodando a cada boot. Só fazia sentido com
 * UMA loja. Agora é uma operação com nome: a rota do painel super-admin
 * (Fase 9) chama exatamente esta função, e o boot chama para a loja 1.
 *
 * Tudo aqui é `INSERT OR IGNORE` / `DO NOTHING`: chamar duas vezes na mesma
 * loja não sobrescreve nada que o dono já tenha editado.
 */

const CATEGORIAS_PADRAO = [
  { id: 'caldinhos', label: 'Caldinhos', emoji: '🍲', color: '#C2410C', sort: 0 },
  { id: 'petiscos', label: 'Petiscos', emoji: '🍤', color: '#7C3AED', sort: 1 },
  { id: 'bebidas', label: 'Bebidas', emoji: '🥤', color: '#2563EB', sort: 2 },
  { id: 'combos', label: 'Combos', emoji: '🍱', color: '#059669', sort: 3 },
];

const CUPONS_PADRAO = [
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

/** As configurações viram pares chave/valor da tabela `meta`. */
export function settingsRows(base: StoreSettings): [string, string][] {
  return [
    ['store_name', base.storeName],
    ['store_city', base.city],
    ['store_lat', String(base.storeLat)],
    ['store_lng', String(base.storeLng)],
    ['store_address', base.storeAddress],
    ['pickup_enabled', String(base.pickupEnabled)],
    ['pickup_ready_minutes', String(base.pickupReadyMinutes)],
    ['delivery_price_per_km', String(base.deliveryPricePerKm)],
    ['delivery_base_fee', String(base.deliveryBaseFee)],
    ['delivery_min_fee', String(base.deliveryMinFee)],
    ['free_delivery_above', String(base.freeDeliveryAbove)],
    ['max_delivery_km', String(base.maxDeliveryKm)],
    ['min_order_value', String(base.minOrderValue)],
    ['route_factor', String(base.routeFactor)],
    ['driver_fee_per_delivery', String(base.driverFeePerDelivery)],
    ['pix_provider', base.pixProvider],
    ['pix_key', base.pixKey],
    ['pix_merchant_name', base.pixMerchantName],
    ['pix_merchant_city', base.pixMerchantCity],
    ['card_on_delivery_enabled', String(base.cardOnDeliveryEnabled)],
    ['store_whatsapp', base.storeWhatsApp],
    ['order_sound_url', base.orderSoundUrl],
    ['opening_hours', JSON.stringify(base.openingHours)],
    ['size_options', JSON.stringify(base.sizeOptions)],
    ['order_enabled', String(base.orderEnabled)],
    ['force_open', String(base.forceOpen)],
  ];
}

export interface NovaLojaOptions {
  /** PIN inicial da cozinha. Sem ele, `1234` — que o painel obriga a trocar. */
  kitchenPin?: string;
  settings?: Partial<StoreSettings>;
}

/**
 * Enche uma loja recém-criada. A linha em `shops` já tem que existir.
 *
 * Roda inteira numa transação: uma loja com catálogo mas sem PIN, ou com
 * configurações mas sem token de equipe, é uma loja que ninguém consegue abrir.
 */
export function seedShop(
  db: Database.Database,
  shopId: ShopId,
  options: NovaLojaOptions = {}
): void {
  const settings: StoreSettings = { ...DEFAULT_STORE_SETTINGS, ...options.settings };

  db.transaction(() => {
    /**
     * O catálogo de exemplo entra SÓ numa loja que nunca teve catálogo.
     *
     * O `INSERT OR IGNORE` sozinho não bastava: ele não sobrescreve o que o
     * dono editou, mas RESSUSCITA o que o dono apagou — este seed roda a cada
     * boot para a loja 1, e um produto, categoria ou cupom padrão removidos de
     * propósito voltavam ao cardápio no deploy seguinte. É exatamente a
     * promessa que a migração 004 faz e que este arquivo desfazia.
     */
    const tem = (tabela: 'products' | 'categories' | 'coupons') =>
      db.prepare(`SELECT 1 FROM ${tabela} WHERE shop_id = ? LIMIT 1`).get(shopId) !== undefined;
    if (!tem('products') && !tem('categories') && !tem('coupons')) {
      const categoria = db.prepare('INSERT INTO categories (shop_id, id, data) VALUES (?, ?, ?)');
      for (const c of CATEGORIAS_PADRAO) categoria.run(shopId, c.id, JSON.stringify(c));

      const produto = db.prepare('INSERT INTO products (shop_id, id, data) VALUES (?, ?, ?)');
      for (const p of INITIAL_PRODUCTS) produto.run(shopId, p.id, JSON.stringify(p));

      const cupom = db.prepare('INSERT INTO coupons (shop_id, code, data) VALUES (?, ?, ?)');
      for (const c of CUPONS_PADRAO) cupom.run(shopId, c.code, JSON.stringify(c));
    }

    // Configuração: preenche SÓ as chaves que faltam. Chave nova de uma versão
    // futura ganha o padrão; o que o dono já salvou fica como está.
    const config = db.prepare(
      'INSERT INTO meta (shop_id, key, value) VALUES (?, ?, ?) ON CONFLICT(shop_id, key) DO NOTHING'
    );
    for (const [key, value] of settingsRows(settings)) config.run(shopId, key, value);

    // O teste vem ANTES do insert porque o scrypt custa ~30 ms — e o boot da
    // loja 1 pagava esse preço todo dia para um DO NOTHING descartar o hash.
    const temSegredo = db.prepare('SELECT 1 FROM shop_secrets WHERE shop_id = ? AND key = ?');
    const segredo = db.prepare('INSERT INTO shop_secrets (shop_id, key, value) VALUES (?, ?, ?)');
    if (!temSegredo.get(shopId, 'kitchen_pin_hash')) {
      segredo.run(shopId, 'kitchen_pin_hash', hashPasswordSync(options.kitchenPin || '1234'));
    }

    // Um token por papel, aleatório e por loja. A credencial da cozinha da loja
    // A não pode valer nada no host da loja B.
    for (const papel of ['kitchen', 'driver'] as const) {
      if (!temSegredo.get(shopId, `role_token_${papel}`)) {
        segredo.run(shopId, `role_token_${papel}`, `tok-${papel}-${randomBytes(24).toString('hex')}`);
      }
    }
  })();
}

/**
 * Cria a linha da loja E a enche. É o que a rota `POST /api/platform/shops`
 * vai chamar na Fase 9.
 */
export function createShop(
  db: Database.Database,
  shop: { slug: string; name: string },
  options: NovaLojaOptions = {}
): ShopId {
  // O `Host` chega minúsculo (`slugFromHost` normaliza), então um slug com
  // maiúscula criaria uma loja INALCANÇÁVEL: toda requisição dela viraria 404
  // sem dizer por quê. A rota do painel já valida via zod; isto aqui é a
  // defesa de quem chamar direto (script, teste, REPL).
  if (!isValidShopSlug(shop.slug)) {
    throw new Error(
      `Slug inválido: "${shop.slug}". Use minúsculas, números e hífens (ex.: pizzaria-do-joao).`
    );
  }
  /**
   * UMA transação para a linha em `shops` E o seed. O `seedShop` abria a sua
   * própria — então uma falha lá (disco cheio, hash que explode) desfazia o
   * seed mas DEIXAVA a linha em `shops`: uma loja meio-criada, sem PIN nem
   * token, e o slug queimado para sempre (o índice único recusa recriar). Com
   * as duas juntas, ou a loja nasce inteira ou não nasce. O `db.transaction`
   * aninhado do `seedShop` vira um savepoint dentro desta.
   */
  const criar = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO shops (slug, name, active, created_at) VALUES (?, ?, 1, ?)')
      .run(shop.slug, shop.name, new Date().toISOString());
    const novoId = Number(info.lastInsertRowid);
    // O nome vai também para as CONFIGURAÇÕES (o que o cliente vê), não só para
    // a linha administrativa em `shops`.
    seedShop(db, novoId, {
      ...options,
      settings: { storeName: shop.name, pixMerchantName: shop.name, ...options.settings },
    });
    return novoId;
  });
  return criar();
}
