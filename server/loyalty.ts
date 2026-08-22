import { db, getSettings } from './db';
import { randomBytes } from 'crypto';
import { loadProduct } from './orderStore';
import { DomainError } from './errors';
import { LOYALTY_STAMP_COST } from '../contract/constants';
import type { CartItem } from '../contract/order/types';
import type { ShopId } from '../contract/shop/types';

/**
 * Os selos de fidelidade e os brindes que eles compram.
 *
 * Tudo aqui é POR LOJA, e não por cliente. O `customerId` é um UUID do
 * aparelho, e o mesmo aparelho pede na pizzaria e no caldinho: sem o `shopId`,
 * os selos ganhos numa loja comprariam o brinde da outra — com a segunda
 * pagando a conta da primeira. A migração `012_loyalty_shop` é o que separa as
 * duas carteiras no banco; estas funções são o que as separa no código.
 */

// ---------------------------------------------------------------------------
// Selos
// ---------------------------------------------------------------------------

export function getLoyaltyPoints(shopId: ShopId, customerId: string): number {
  const row = db
    .prepare('SELECT points FROM loyalty WHERE shop_id = ? AND customer_id = ?')
    .get(shopId, customerId) as { points: number } | undefined;
  return row ? row.points : 0;
}

export function addLoyaltyPoints(shopId: ShopId, customerId: string, points: number): number {
  if (!Number.isFinite(points)) return getLoyaltyPoints(shopId, customerId);
  db.prepare(
    `INSERT INTO loyalty (shop_id, customer_id, points) VALUES (?, ?, ?)
     ON CONFLICT(shop_id, customer_id) DO UPDATE SET points = points + excluded.points`
  ).run(shopId, customerId, points);
  return getLoyaltyPoints(shopId, customerId);
}

export function deductLoyaltyPoints(shopId: ShopId, customerId: string, points: number): number {
  db.prepare(
    `INSERT INTO loyalty (shop_id, customer_id, points) VALUES (?, ?, ?)
     ON CONFLICT(shop_id, customer_id) DO UPDATE SET points = excluded.points`
  ).run(shopId, customerId, Math.max(0, getLoyaltyPoints(shopId, customerId) - points));
  return getLoyaltyPoints(shopId, customerId);
}

export const getCustomerStamps = (shopId: ShopId, customerId: string): number =>
  getLoyaltyPoints(shopId, customerId);

/** Um selo por pedido. O dispositivo anônimo não junta selo: não há a quem creditar. */
export function earnStamp(shopId: ShopId, customerId: string): number | null {
  if (!customerId || customerId === 'anon') return null;
  return addLoyaltyPoints(shopId, customerId, 1);
}

// ---------------------------------------------------------------------------
// Brindes
// ---------------------------------------------------------------------------

/** Cria o vale-brinde. O token é a prova; ele vale UMA vez e só naquele produto. */
export function createFreeRedeem(shopId: ShopId, productId: string, customerId: string): string {
  // `randomBytes` no lugar de `Date.now()+Math.random()`: o token É a prova do
  // brinde, e o par previsível deixava adivinhar o de outro cliente.
  const token = `LFT-${randomBytes(16).toString('hex')}`;
  db.prepare(
    'INSERT INTO free_redeems (token, shop_id, product_id, customer_id) VALUES (?, ?, ?, ?)'
  ).run(token, shopId, productId, customerId);
  return token;
}

export function peekFreeRedeem(
  shopId: ShopId,
  token: string,
  productId: string,
  customerId?: string
): boolean {
  const row = db
    .prepare('SELECT product_id, used, customer_id FROM free_redeems WHERE shop_id = ? AND token = ?')
    .get(shopId, token) as
    | { product_id: string; used: number; customer_id: string }
    | undefined;
  if (!row || row.used !== 0 || row.product_id !== productId) return false;
  // O brinde é de quem resgatou: um `customerId` conhecido tem que bater com o
  // dono do token. Sem isto, um cliente usava o vale de outro na mesma loja.
  if (customerId && row.customer_id && row.customer_id !== customerId) return false;
  return true;
}

export function consumeFreeRedeem(
  shopId: ShopId,
  token: string,
  productId: string,
  customerId?: string
): boolean {
  if (!peekFreeRedeem(shopId, token, productId, customerId)) return false;
  db.prepare('UPDATE free_redeems SET used = 1 WHERE shop_id = ? AND token = ?').run(shopId, token);
  return true;
}

export const hasFreeRedeem = (
  shopId: ShopId,
  token: string,
  productId: string,
  customerId?: string
): boolean => peekFreeRedeem(shopId, token, productId, customerId);

/**
 * Troca selos por um item grátis.
 *
 * O CUSTO e a CATEGORIA resgatável vêm das configurações da loja. Eram fixos —
 * `LOYALTY_STAMP_COST = 10` e a categoria `'caldinhos'` escrita no código —, o
 * que obrigava toda loja da plataforma à mesma regra de fidelidade e não queria
 * dizer nada numa pizzaria.
 *
 * Categoria vazia = qualquer item do cardápio pode ser resgatado.
 */
export function redeemFreeCaldinho(
  shopId: ShopId,
  customerId: string,
  productId: string
): { points: number; token: string } {
  if (!customerId || customerId === 'anon') {
    throw new DomainError(400, 'Cliente inválido.');
  }
  const settings = getSettings(shopId);
  const custo = settings.loyaltyStampCost || LOYALTY_STAMP_COST;

  const points = getLoyaltyPoints(shopId, customerId);
  if (points < custo) {
    throw new DomainError(400, 'Selos insuficientes.');
  }
  const product = loadProduct(shopId, productId);
  const categoria = settings.loyaltyRedeemCategory.trim();
  if (!product || (categoria && product.category !== categoria)) {
    throw new DomainError(400, 'Este produto não pode ser resgatado com selos.');
  }

  let newPoints = points;
  let token = '';
  try {
    db.transaction(() => {
      newPoints = deductLoyaltyPoints(shopId, customerId, custo);
      token = createFreeRedeem(shopId, productId, customerId);
    })();
  } catch {
    // A transação desfaz o débito quando falha: nenhum selo é perdido aqui.
    throw new DomainError(
      400,
      'Não deu para resgatar o brinde. Seus selos continuam guardados. Tente de novo.'
    );
  }
  return { points: newPoints, token };
}

export function consumeFreeItems(shopId: ShopId, items: CartItem[], customerId?: string): void {
  for (const it of items) {
    if (!it.isFree) continue;
    if (!it.freeToken || !consumeFreeRedeem(shopId, it.freeToken, it.product.id, customerId)) {
      throw new DomainError(400, 'Item grátis de fidelidade inválido. Verifique seus selos.');
    }
  }
}

/** Desfaz `consumeFreeItems` quando a cobrança falha depois do token reservado. */
export function releaseFreeItems(shopId: ShopId, items: CartItem[]): void {
  for (const it of items) {
    if (!it.isFree || !it.freeToken) continue;
    db.prepare(
      'UPDATE free_redeems SET used = 0 WHERE shop_id = ? AND token = ? AND product_id = ?'
    ).run(shopId, it.freeToken, it.product.id);
  }
}
